// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Optimized Parquet serialization with quantized-mesh-style encoding.
//!
//! Key optimizations over basic Parquet:
//! 1. Per-mesh relative u16 quantized vertices (quantized-mesh style, 0–32767 range)
//! 2. Oct-encoded normals (2 bytes per normal instead of 12)
//! 3. Mesh deduplication via content hashing (instancing)
//! 4. Byte colors (0-255) instead of float (0-1)
//! 5. Material deduplication
//!
//! The u16 relative quantization maps each vertex component to 0–32767 within
//! the mesh's bounding box, following the CesiumGS quantized-mesh spec.
//! This halves vertex storage vs the previous i32 absolute encoding while
//! providing adequate precision for BIM visualization (e.g., 0.3mm for a 10m mesh).
//!
//! Typical additional compression: 5-8x over basic Parquet format.

use crate::types::MeshData;
use arrow::array::{Float32Array, StringArray, UInt8Array, UInt16Array, UInt32Array};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use bytes::Bytes;
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use parquet::schema::types::ColumnPath;
use rustc_hash::FxHashMap;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::sync::Arc;

use super::ParquetError;

/// Maximum quantized value for relative vertex encoding (quantized-mesh standard).
/// Vertices are mapped to the range [0, 32767] within the mesh's bounding box.
pub const QUANTIZED_MAX: f32 = 32767.0;

/// Vertex multiplier for legacy i32 quantization (v2 format).
/// Kept for backward compatibility reference.
pub const VERTEX_MULTIPLIER: f32 = 10_000.0;

/// Hash key for mesh geometry (for deduplication).
#[derive(Clone, PartialEq, Eq)]
struct MeshGeometryKey {
    /// Quantized positions as bytes for hashing
    positions_hash: u64,
    /// Quantized indices hash
    indices_hash: u64,
}

impl Hash for MeshGeometryKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.positions_hash.hash(state);
        self.indices_hash.hash(state);
    }
}

/// Compute a fast hash of a u32 slice.
fn hash_u32_slice(data: &[u32]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    for item in data {
        item.hash(&mut hasher);
    }
    hasher.finish()
}

/// Compute a fast hash of a f32 slice (using bit representation).
fn hash_f32_slice(data: &[f32]) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    for item in data {
        item.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

/// Convert float color (0-1) to byte (0-255).
#[inline]
fn color_to_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// Material key for deduplication.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct MaterialKey {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

impl MaterialKey {
    fn from_color(color: &[f32; 4]) -> Self {
        Self {
            r: color_to_byte(color[0]),
            g: color_to_byte(color[1]),
            b: color_to_byte(color[2]),
            a: color_to_byte(color[3]),
        }
    }
}

/// Axis-aligned bounding box for a mesh (after coordinate transform).
#[derive(Debug, Clone, Copy)]
struct MeshBounds {
    min_x: f32,
    max_x: f32,
    min_y: f32,
    max_y: f32,
    min_z: f32,
    max_z: f32,
}

impl MeshBounds {
    /// Compute AABB from positions (already in Y-up coordinate system).
    fn from_positions_yup(positions: &[f32]) -> Self {
        let mut min_x = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        let mut min_z = f32::INFINITY;
        let mut max_z = f32::NEG_INFINITY;

        let vert_count = positions.len() / 3;
        for i in 0..vert_count {
            // Z-up to Y-up: X stays, new Y = old Z, new Z = -old Y
            let x = positions[i * 3];
            let y = positions[i * 3 + 2];
            let z = -positions[i * 3 + 1];

            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            min_z = min_z.min(z);
            max_z = max_z.max(z);
        }

        // Handle degenerate cases (single vertex or flat mesh on an axis)
        if (max_x - min_x).abs() < f32::EPSILON {
            max_x = min_x + f32::EPSILON;
        }
        if (max_y - min_y).abs() < f32::EPSILON {
            max_y = min_y + f32::EPSILON;
        }
        if (max_z - min_z).abs() < f32::EPSILON {
            max_z = min_z + f32::EPSILON;
        }

        Self {
            min_x,
            max_x,
            min_y,
            max_y,
            min_z,
            max_z,
        }
    }
}

/// Quantize a value to u16 (0–32767) relative to a bounding range.
/// Following the CesiumGS quantized-mesh spec where 0 = min edge, 32767 = max edge.
#[inline]
fn quantize_relative(value: f32, min: f32, max: f32) -> u16 {
    let range = max - min;
    if range.abs() < f32::EPSILON {
        return 0;
    }
    let t = (value - min) / range;
    (t.clamp(0.0, 1.0) * QUANTIZED_MAX).round() as u16
}

/// Oct-encode a unit normal vector to 2 bytes.
/// Based on "A Survey of Efficient Representations of Independent Unit Vectors"
/// (Cigolle et al. 2014), as used in the quantized-mesh spec.
#[inline]
fn oct_encode_normal(nx: f32, ny: f32, nz: f32) -> [u8; 2] {
    let sum = nx.abs() + ny.abs() + nz.abs();
    if sum < f32::EPSILON {
        return [128, 128]; // Zero normal → center of oct-map
    }

    let mut u = nx / sum;
    let mut v = ny / sum;

    // Reflect the folds of the lower hemisphere
    if nz < 0.0 {
        let old_u = u;
        u = (1.0 - v.abs()) * if old_u >= 0.0 { 1.0 } else { -1.0 };
        v = (1.0 - old_u.abs()) * if v >= 0.0 { 1.0 } else { -1.0 };
    }

    // Map from [-1, 1] to [0, 255]
    [
        ((u * 0.5 + 0.5) * 255.0).clamp(0.0, 255.0).round() as u8,
        ((v * 0.5 + 0.5) * 255.0).clamp(0.0, 255.0).round() as u8,
    ]
}

/// Reorder triangle indices using meshoptimizer's vertex cache optimization.
/// This improves GPU vertex post-transform cache hit rates by 10-30%.
fn reorder_indices_for_vertex_cache(indices: &[u32], vertex_count: usize) -> Vec<u32> {
    meshopt::optimize_vertex_cache(indices, vertex_count)
}

/// Serialize mesh data to v3 optimized Parquet format with quantized-mesh-style encoding.
///
/// Format:
/// 1. Instances table (entity → mesh, material indices)
/// 2. Meshes table (unique geometries with bounding boxes)
/// 3. Materials table (unique colors)
/// 4. Vertices table (u16 quantized relative to per-mesh AABB)
/// 5. Indices table
///
/// This enables significant deduplication for IFC files where many elements
/// share the same geometry (windows, doors, standard components).
pub fn serialize_to_parquet_optimized(
    meshes: &[MeshData],
    include_normals: bool,
) -> Result<Bytes, ParquetError> {
    // Phase 1: Deduplicate meshes and materials
    let mut unique_meshes: Vec<&MeshData> = Vec::new();
    let mut mesh_lookup: FxHashMap<MeshGeometryKey, u32> = FxHashMap::default();
    let mut unique_materials: Vec<MaterialKey> = Vec::new();
    let mut material_lookup: FxHashMap<MaterialKey, u32> = FxHashMap::default();

    // Instance data
    let mut instance_entity_ids: Vec<u32> = Vec::with_capacity(meshes.len());
    let mut instance_ifc_types: Vec<&str> = Vec::with_capacity(meshes.len());
    let mut instance_mesh_indices: Vec<u32> = Vec::with_capacity(meshes.len());
    let mut instance_material_indices: Vec<u32> = Vec::with_capacity(meshes.len());

    for mesh in meshes {
        // Compute geometry hash for deduplication
        let positions_hash = hash_f32_slice(&mesh.positions);
        let indices_hash = hash_u32_slice(&mesh.indices);
        let geo_key = MeshGeometryKey {
            positions_hash,
            indices_hash,
        };

        // Get or create mesh index
        let mesh_idx = *mesh_lookup.entry(geo_key).or_insert_with(|| {
            let idx = unique_meshes.len() as u32;
            unique_meshes.push(mesh);
            idx
        });

        // Get or create material index
        let mat_key = MaterialKey::from_color(&mesh.color);
        let material_idx = *material_lookup.entry(mat_key).or_insert_with(|| {
            let idx = unique_materials.len() as u32;
            unique_materials.push(mat_key);
            idx
        });

        // Record instance
        instance_entity_ids.push(mesh.express_id);
        instance_ifc_types.push(&mesh.ifc_type);
        instance_mesh_indices.push(mesh_idx);
        instance_material_indices.push(material_idx);
    }

    // Phase 2: Build vertex and index buffers from unique meshes
    let total_vertices: usize = unique_meshes.iter().map(|m| m.positions.len() / 3).sum();
    let total_indices: usize = unique_meshes.iter().map(|m| m.indices.len()).sum();

    // u16 quantized vertex data (quantized-mesh style)
    let mut vertex_x: Vec<u16> = Vec::with_capacity(total_vertices);
    let mut vertex_y: Vec<u16> = Vec::with_capacity(total_vertices);
    let mut vertex_z: Vec<u16> = Vec::with_capacity(total_vertices);

    // Oct-encoded normals: separate x/y channels (avoids interleave-then-split)
    let mut oct_nx: Vec<u8> = if include_normals {
        Vec::with_capacity(total_vertices)
    } else {
        Vec::new()
    };
    let mut oct_ny: Vec<u8> = if include_normals {
        Vec::with_capacity(total_vertices)
    } else {
        Vec::new()
    };

    // Index buffer
    let mut indices: Vec<u32> = Vec::with_capacity(total_indices);

    // Mesh offsets and bounding boxes
    let mut mesh_vertex_offsets: Vec<u32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_vertex_counts: Vec<u32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_index_offsets: Vec<u32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_index_counts: Vec<u32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_min_x: Vec<f32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_max_x: Vec<f32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_min_y: Vec<f32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_max_y: Vec<f32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_min_z: Vec<f32> = Vec::with_capacity(unique_meshes.len());
    let mut mesh_max_z: Vec<f32> = Vec::with_capacity(unique_meshes.len());

    let mut vertex_offset: u32 = 0;
    let mut index_offset: u32 = 0;

    for mesh in &unique_meshes {
        let vert_count = mesh.positions.len() / 3;

        // Compute AABB in Y-up coordinates
        let bounds = MeshBounds::from_positions_yup(&mesh.positions);

        mesh_vertex_offsets.push(vertex_offset);
        mesh_vertex_counts.push(vert_count as u32);
        mesh_index_offsets.push(index_offset);
        mesh_index_counts.push(mesh.indices.len() as u32);
        mesh_min_x.push(bounds.min_x);
        mesh_max_x.push(bounds.max_x);
        mesh_min_y.push(bounds.min_y);
        mesh_max_y.push(bounds.max_y);
        mesh_min_z.push(bounds.min_z);
        mesh_max_z.push(bounds.max_z);

        // Quantize vertices to u16 relative to per-mesh AABB
        // Z-up → Y-up transform: X stays, new Y = old Z, new Z = -old Y
        for i in 0..vert_count {
            let x = mesh.positions[i * 3];
            let y = mesh.positions[i * 3 + 2]; // new Y = old Z
            let z = -mesh.positions[i * 3 + 1]; // new Z = -old Y

            vertex_x.push(quantize_relative(x, bounds.min_x, bounds.max_x));
            vertex_y.push(quantize_relative(y, bounds.min_y, bounds.max_y));
            vertex_z.push(quantize_relative(z, bounds.min_z, bounds.max_z));

            if include_normals {
                if mesh.normals.len() >= (i + 1) * 3 {
                    // Transform normals Z-up → Y-up, then oct-encode
                    let nx = mesh.normals[i * 3];
                    let ny = mesh.normals[i * 3 + 2]; // new Y = old Z
                    let nz = -mesh.normals[i * 3 + 1]; // new Z = -old Y
                    let encoded = oct_encode_normal(nx, ny, nz);
                    oct_nx.push(encoded[0]);
                    oct_ny.push(encoded[1]);
                } else {
                    // Fallback: missing normal data → default up normal
                    oct_nx.push(128);
                    oct_ny.push(128);
                }
            }
        }

        // Reorder indices for GPU vertex cache optimization, then store
        let optimized = reorder_indices_for_vertex_cache(&mesh.indices, vert_count);
        indices.extend_from_slice(&optimized);

        vertex_offset += vert_count as u32;
        index_offset += mesh.indices.len() as u32;
    }

    // Phase 3: Create Parquet tables

    // Instance table schema
    let instance_schema = Arc::new(Schema::new(vec![
        Field::new("entity_id", DataType::UInt32, false),
        Field::new("ifc_type", DataType::Utf8, false),
        Field::new("mesh_index", DataType::UInt32, false),
        Field::new("material_index", DataType::UInt32, false),
    ]));

    let instance_batch = RecordBatch::try_new(
        instance_schema,
        vec![
            Arc::new(UInt32Array::from(instance_entity_ids)),
            Arc::new(StringArray::from(instance_ifc_types)),
            Arc::new(UInt32Array::from(instance_mesh_indices)),
            Arc::new(UInt32Array::from(instance_material_indices)),
        ],
    )?;

    // Mesh table schema (with bounding boxes for dequantization)
    let mesh_schema = Arc::new(Schema::new(vec![
        Field::new("vertex_offset", DataType::UInt32, false),
        Field::new("vertex_count", DataType::UInt32, false),
        Field::new("index_offset", DataType::UInt32, false),
        Field::new("index_count", DataType::UInt32, false),
        Field::new("min_x", DataType::Float32, false),
        Field::new("max_x", DataType::Float32, false),
        Field::new("min_y", DataType::Float32, false),
        Field::new("max_y", DataType::Float32, false),
        Field::new("min_z", DataType::Float32, false),
        Field::new("max_z", DataType::Float32, false),
    ]));

    let mesh_batch = RecordBatch::try_new(
        mesh_schema,
        vec![
            Arc::new(UInt32Array::from(mesh_vertex_offsets)),
            Arc::new(UInt32Array::from(mesh_vertex_counts)),
            Arc::new(UInt32Array::from(mesh_index_offsets)),
            Arc::new(UInt32Array::from(mesh_index_counts)),
            Arc::new(Float32Array::from(mesh_min_x)),
            Arc::new(Float32Array::from(mesh_max_x)),
            Arc::new(Float32Array::from(mesh_min_y)),
            Arc::new(Float32Array::from(mesh_max_y)),
            Arc::new(Float32Array::from(mesh_min_z)),
            Arc::new(Float32Array::from(mesh_max_z)),
        ],
    )?;

    // Material table schema (byte colors)
    let material_schema = Arc::new(Schema::new(vec![
        Field::new("r", DataType::UInt8, false),
        Field::new("g", DataType::UInt8, false),
        Field::new("b", DataType::UInt8, false),
        Field::new("a", DataType::UInt8, false),
    ]));

    let material_batch = RecordBatch::try_new(
        material_schema,
        vec![
            Arc::new(UInt8Array::from(
                unique_materials.iter().map(|m| m.r).collect::<Vec<_>>(),
            )),
            Arc::new(UInt8Array::from(
                unique_materials.iter().map(|m| m.g).collect::<Vec<_>>(),
            )),
            Arc::new(UInt8Array::from(
                unique_materials.iter().map(|m| m.b).collect::<Vec<_>>(),
            )),
            Arc::new(UInt8Array::from(
                unique_materials.iter().map(|m| m.a).collect::<Vec<_>>(),
            )),
        ],
    )?;

    // Vertex table schema (u16 quantized + optional oct-encoded normals)
    let vertex_schema = if include_normals {
        Arc::new(Schema::new(vec![
            Field::new("x", DataType::UInt16, false),
            Field::new("y", DataType::UInt16, false),
            Field::new("z", DataType::UInt16, false),
            Field::new("oct_nx", DataType::UInt8, false),
            Field::new("oct_ny", DataType::UInt8, false),
        ]))
    } else {
        Arc::new(Schema::new(vec![
            Field::new("x", DataType::UInt16, false),
            Field::new("y", DataType::UInt16, false),
            Field::new("z", DataType::UInt16, false),
        ]))
    };

    let vertex_batch = if include_normals {
        RecordBatch::try_new(
            vertex_schema,
            vec![
                Arc::new(UInt16Array::from(vertex_x)),
                Arc::new(UInt16Array::from(vertex_y)),
                Arc::new(UInt16Array::from(vertex_z)),
                Arc::new(UInt8Array::from(oct_nx)),
                Arc::new(UInt8Array::from(oct_ny)),
            ],
        )?
    } else {
        RecordBatch::try_new(
            vertex_schema,
            vec![
                Arc::new(UInt16Array::from(vertex_x)),
                Arc::new(UInt16Array::from(vertex_y)),
                Arc::new(UInt16Array::from(vertex_z)),
            ],
        )?
    };

    // Index table schema
    let index_schema = Arc::new(Schema::new(vec![Field::new("i", DataType::UInt32, false)]));

    let index_batch =
        RecordBatch::try_new(index_schema, vec![Arc::new(UInt32Array::from(indices))])?;

    // Phase 4: Write to binary format
    // Header: [version:u8][flags:u8][instance_len:u32][mesh_len:u32][material_len:u32][vertex_len:u32][index_len:u32]
    // Then: [instance_parquet][mesh_parquet][material_parquet][vertex_parquet][index_parquet]
    let mut output = Vec::new();

    // Version 3 = quantized-mesh style u16 encoding
    output.push(3u8);
    // Flags: bit 0 = has_normals (oct-encoded)
    output.push(if include_normals { 1u8 } else { 0u8 });

    // Write tables
    let instance_parquet = write_parquet_buffer(&instance_batch)?;
    output.extend_from_slice(&(instance_parquet.len() as u32).to_le_bytes());

    let mesh_parquet = write_parquet_buffer(&mesh_batch)?;
    output.extend_from_slice(&(mesh_parquet.len() as u32).to_le_bytes());

    let material_parquet = write_parquet_buffer(&material_batch)?;
    output.extend_from_slice(&(material_parquet.len() as u32).to_le_bytes());

    let vertex_parquet = write_parquet_buffer(&vertex_batch)?;
    output.extend_from_slice(&(vertex_parquet.len() as u32).to_le_bytes());

    let index_parquet = write_parquet_buffer(&index_batch)?;
    output.extend_from_slice(&(index_parquet.len() as u32).to_le_bytes());

    // Append all parquet data
    output.extend_from_slice(&instance_parquet);
    output.extend_from_slice(&mesh_parquet);
    output.extend_from_slice(&material_parquet);
    output.extend_from_slice(&vertex_parquet);
    output.extend_from_slice(&index_parquet);

    Ok(Bytes::from(output))
}

/// Write a RecordBatch to a Parquet buffer with LZ4 compression.
/// Dictionary encoding is disabled for numeric columns (floats, integers) as they
/// have high entropy and dictionary encoding provides no benefit while adding significant overhead.
fn write_parquet_buffer(batch: &RecordBatch) -> Result<Vec<u8>, ParquetError> {
    let mut buffer = Vec::new();
    let cursor = Cursor::new(&mut buffer);

    // Build WriterProperties with dictionary disabled for numeric columns
    let mut props_builder = WriterProperties::builder()
        .set_compression(Compression::LZ4_RAW)
        .set_dictionary_enabled(true); // Default: enabled for strings

    // Disable dictionary encoding for all numeric columns (floats and integers)
    // This dramatically speeds up serialization for high-entropy data like vertex coordinates
    for field in batch.schema().fields() {
        let is_numeric = matches!(
            field.data_type(),
            DataType::Float32
                | DataType::Float64
                | DataType::UInt32
                | DataType::UInt64
                | DataType::Int32
                | DataType::Int64
                | DataType::UInt16
                | DataType::Int16
                | DataType::UInt8
                | DataType::Int8
        );

        if is_numeric {
            props_builder = props_builder.set_column_dictionary_enabled(
                ColumnPath::from(field.name().as_str()),
                false,
            );
        }
    }

    let props = props_builder.build();

    let mut writer = ArrowWriter::try_new(cursor, batch.schema(), Some(props))?;
    writer.write(batch)?;
    writer.close()?;

    Ok(buffer)
}

/// Statistics about the optimized serialization.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OptimizedStats {
    /// Number of input meshes
    pub input_meshes: usize,
    /// Number of unique meshes after deduplication
    pub unique_meshes: usize,
    /// Number of unique materials
    pub unique_materials: usize,
    /// Mesh reuse ratio (higher = more instancing)
    pub mesh_reuse_ratio: f32,
    /// Whether normals are included
    pub has_normals: bool,
}

/// Serialize with stats.
pub fn serialize_to_parquet_optimized_with_stats(
    meshes: &[MeshData],
    include_normals: bool,
) -> Result<(Bytes, OptimizedStats), ParquetError> {
    // First pass: count unique meshes/materials
    let mut mesh_hashes: FxHashMap<(u64, u64), u32> = FxHashMap::default();
    let mut material_keys: FxHashMap<MaterialKey, u32> = FxHashMap::default();

    for mesh in meshes {
        let pos_hash = hash_f32_slice(&mesh.positions);
        let idx_hash = hash_u32_slice(&mesh.indices);
        mesh_hashes.entry((pos_hash, idx_hash)).or_insert(0);

        let mat_key = MaterialKey::from_color(&mesh.color);
        material_keys.entry(mat_key).or_insert(0);
    }

    let unique_mesh_count = mesh_hashes.len();
    let unique_material_count = material_keys.len();

    let data = serialize_to_parquet_optimized(meshes, include_normals)?;

    let stats = OptimizedStats {
        input_meshes: meshes.len(),
        unique_meshes: unique_mesh_count,
        unique_materials: unique_material_count,
        mesh_reuse_ratio: if unique_mesh_count > 0 {
            meshes.len() as f32 / unique_mesh_count as f32
        } else {
            1.0
        },
        has_normals: include_normals,
    };

    Ok((data, stats))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_optimized_parquet_serialization() {
        // Create test data with some duplicate meshes
        let wall_positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0];
        let wall_normals = vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let wall_indices = vec![0, 1, 2];
        let wall_color = [0.8, 0.8, 0.8, 1.0];

        let meshes = vec![
            // Two walls with same geometry (should be deduplicated)
            MeshData::new(
                1,
                "IfcWall".to_string(),
                wall_positions.clone(),
                wall_normals.clone(),
                wall_indices.clone(),
                wall_color,
            ),
            MeshData::new(
                2,
                "IfcWall".to_string(),
                wall_positions.clone(),
                wall_normals.clone(),
                wall_indices.clone(),
                wall_color,
            ),
            // Different geometry
            MeshData::new(
                3,
                "IfcSlab".to_string(),
                vec![0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 2.0, 2.0, 0.0, 0.0, 2.0, 0.0],
                vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
                vec![0, 1, 2, 0, 2, 3],
                [0.5, 0.5, 0.5, 1.0],
            ),
        ];

        let (data, stats) = serialize_to_parquet_optimized_with_stats(&meshes, false).unwrap();

        // Should deduplicate the two identical walls
        assert_eq!(stats.input_meshes, 3);
        assert_eq!(stats.unique_meshes, 2);
        assert_eq!(stats.unique_materials, 2);
        assert!(stats.mesh_reuse_ratio > 1.0);

        // Should be very compact (v3 mesh table includes bounding boxes, so slightly larger)
        assert!(
            data.len() < 7000,
            "Expected compact output, got {} bytes",
            data.len()
        );

        // Verify version 3 header
        assert_eq!(data[0], 3, "Expected version 3 header");
        assert_eq!(data[1], 0, "Expected no normals flag");
    }

    #[test]
    fn test_optimized_parquet_with_normals() {
        let positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0];
        let normals = vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let indices = vec![0, 1, 2];
        let color = [0.8, 0.8, 0.8, 1.0];

        let meshes = vec![MeshData::new(
            1,
            "IfcWall".to_string(),
            positions,
            normals,
            indices,
            color,
        )];

        let (data, stats) = serialize_to_parquet_optimized_with_stats(&meshes, true).unwrap();

        assert_eq!(data[0], 3, "Expected version 3 header");
        assert_eq!(data[1], 1, "Expected normals flag set");
        assert!(stats.has_normals);
    }

    #[test]
    fn test_quantize_relative() {
        // Value at min → 0
        assert_eq!(quantize_relative(0.0, 0.0, 10.0), 0);
        // Value at max → 32767
        assert_eq!(quantize_relative(10.0, 0.0, 10.0), 32767);
        // Value at midpoint → ~16383
        let mid = quantize_relative(5.0, 0.0, 10.0);
        assert!((mid as i32 - 16383).abs() <= 1);
        // Negative range
        assert_eq!(quantize_relative(-5.0, -10.0, 0.0), 16384);
        // Degenerate range
        assert_eq!(quantize_relative(5.0, 5.0, 5.0), 0);
    }

    #[test]
    fn test_oct_encode_normal() {
        // Positive Z normal (pointing up)
        let [u, v] = oct_encode_normal(0.0, 0.0, 1.0);
        assert_eq!(u, 128); // Center of oct-map
        assert_eq!(v, 128);

        // Positive X normal
        let [u, _v] = oct_encode_normal(1.0, 0.0, 0.0);
        assert_eq!(u, 255); // Right edge

        // Negative X normal
        let [u, _v] = oct_encode_normal(-1.0, 0.0, 0.0);
        assert_eq!(u, 0); // Left edge

        // Zero normal
        let [u, v] = oct_encode_normal(0.0, 0.0, 0.0);
        assert_eq!(u, 128);
        assert_eq!(v, 128);
    }

    #[test]
    fn test_color_to_byte() {
        assert_eq!(color_to_byte(0.0), 0);
        assert_eq!(color_to_byte(1.0), 255);
        assert_eq!(color_to_byte(0.5), 128);
    }

    #[test]
    fn test_mesh_bounds() {
        // Positions in Z-up format: (x=0,y=0,z=0), (x=1,y=2,z=3)
        let positions = vec![0.0, 0.0, 0.0, 1.0, 2.0, 3.0];
        let bounds = MeshBounds::from_positions_yup(&positions);

        // After Z-up → Y-up: X stays, new Y = old Z, new Z = -old Y
        assert_eq!(bounds.min_x, 0.0);
        assert_eq!(bounds.max_x, 1.0);
        assert_eq!(bounds.min_y, 0.0); // min(old Z) = 0
        assert_eq!(bounds.max_y, 3.0); // max(old Z) = 3
        assert_eq!(bounds.min_z, -2.0); // min(-old Y) = -2
        assert_eq!(bounds.max_z, 0.0); // max(-old Y) = 0
    }
}
