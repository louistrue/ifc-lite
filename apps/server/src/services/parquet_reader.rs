// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Parquet reader for extracting mesh data from cached geometry.
//!
//! Reads the cached parquet format to extract mesh bounds (for tileset generation)
//! and reconstruct filtered meshes (for GLB tile building).

use crate::services::zone_reference::MeshBounds;
use crate::types::MeshData;
use arrow::array::{Array, Float32Array, StringArray, UInt32Array};
use bytes::Bytes;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

/// Parse the combined parquet cache format.
/// Format: [geometry_len: u32][geometry_data][data_model_len: u32][data_model_data]
/// Geometry data: [mesh_parquet_len: u32][mesh_parquet][vertex_parquet_len: u32][vertex_parquet][index_parquet_len: u32][index_parquet]
fn parse_combined_parquet(data: &[u8]) -> Option<(&[u8], &[u8], &[u8])> {
    if data.len() < 4 {
        return None;
    }

    // Read geometry section length
    let geo_len = u32::from_le_bytes(data[0..4].try_into().ok()?) as usize;
    let geo_data = &data[4..4 + geo_len];

    // Parse geometry into 3 parquet sections
    let mut offset = 0;

    let mesh_len = u32::from_le_bytes(geo_data[offset..offset + 4].try_into().ok()?) as usize;
    offset += 4;
    let mesh_parquet = &geo_data[offset..offset + mesh_len];
    offset += mesh_len;

    let vertex_len = u32::from_le_bytes(geo_data[offset..offset + 4].try_into().ok()?) as usize;
    offset += 4;
    let vertex_parquet = &geo_data[offset..offset + vertex_len];
    offset += vertex_len;

    let index_len = u32::from_le_bytes(geo_data[offset..offset + 4].try_into().ok()?) as usize;
    offset += 4;
    let index_parquet = &geo_data[offset..offset + index_len];

    Some((mesh_parquet, vertex_parquet, index_parquet))
}

/// Extract mesh bounds from cached parquet data.
/// Only reads the mesh metadata table (no vertex/index data needed).
pub fn extract_mesh_bounds(cached_parquet: &[u8]) -> Result<Vec<MeshBounds>, String> {
    let (mesh_parquet, _, _) = parse_combined_parquet(cached_parquet)
        .ok_or_else(|| "Invalid parquet cache format".to_string())?;

    let builder = ParquetRecordBatchReaderBuilder::try_new(Bytes::copy_from_slice(mesh_parquet))
        .map_err(|e| format!("Failed to create parquet reader: {}", e))?;
    let reader = builder.build()
        .map_err(|e| format!("Failed to build reader: {}", e))?;

    let mut bounds = Vec::new();

    for batch_result in reader {
        let batch = batch_result.map_err(|e| format!("Failed to read batch: {}", e))?;

        let express_ids = batch.column_by_name("express_id")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .ok_or("Missing express_id column")?;
        let ifc_types = batch.column_by_name("ifc_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .ok_or("Missing ifc_type column")?;

        // Try to read AABB columns (v3 format)
        let has_bbox = batch.column_by_name("bbox_min_x").is_some();

        if has_bbox {
            let bbox_min_x = batch.column_by_name("bbox_min_x")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing bbox_min_x")?;
            let bbox_min_y = batch.column_by_name("bbox_min_y")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing bbox_min_y")?;
            let bbox_min_z = batch.column_by_name("bbox_min_z")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing bbox_min_z")?;
            let bbox_max_x = batch.column_by_name("bbox_max_x")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing bbox_max_x")?;
            let bbox_max_y = batch.column_by_name("bbox_max_y")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing bbox_max_y")?;
            let bbox_max_z = batch.column_by_name("bbox_max_z")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing bbox_max_z")?;

            for i in 0..batch.num_rows() {
                bounds.push(MeshBounds {
                    express_id: express_ids.value(i),
                    ifc_type: ifc_types.value(i).to_string(),
                    bbox_min: [bbox_min_x.value(i), bbox_min_y.value(i), bbox_min_z.value(i)],
                    bbox_max: [bbox_max_x.value(i), bbox_max_y.value(i), bbox_max_z.value(i)],
                });
            }
        } else {
            // Fallback: no AABB data (old cache format), use zero bounds
            for i in 0..batch.num_rows() {
                bounds.push(MeshBounds {
                    express_id: express_ids.value(i),
                    ifc_type: ifc_types.value(i).to_string(),
                    bbox_min: [0.0; 3],
                    bbox_max: [0.0; 3],
                });
            }
        }
    }

    Ok(bounds)
}

/// Mesh metadata from the parquet mesh table.
struct MeshMeta {
    express_id: u32,
    ifc_type: String,
    vertex_start: u32,
    vertex_count: u32,
    index_start: u32,
    index_count: u32,
    color: [f32; 4],
}

/// Extract specific meshes from cached parquet data by express ID set.
/// Returns full MeshData ready for GLB building.
pub fn extract_meshes_by_ids(
    cached_parquet: &[u8],
    target_ids: &std::collections::HashSet<u32>,
) -> Result<Vec<MeshData>, String> {
    let (mesh_parquet, vertex_parquet, index_parquet) = parse_combined_parquet(cached_parquet)
        .ok_or_else(|| "Invalid parquet cache format".to_string())?;

    // Step 1: Read mesh metadata and filter
    let mesh_reader = ParquetRecordBatchReaderBuilder::try_new(Bytes::copy_from_slice(mesh_parquet))
        .map_err(|e| format!("Mesh reader: {}", e))?
        .build()
        .map_err(|e| format!("Mesh build: {}", e))?;

    let mut target_meshes: Vec<MeshMeta> = Vec::new();

    for batch_result in mesh_reader {
        let batch = batch_result.map_err(|e| format!("Mesh batch: {}", e))?;

        let express_ids = batch.column_by_name("express_id")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .ok_or("Missing express_id")?;
        let ifc_types = batch.column_by_name("ifc_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
            .ok_or("Missing ifc_type")?;
        let vertex_starts = batch.column_by_name("vertex_start")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .ok_or("Missing vertex_start")?;
        let vertex_counts = batch.column_by_name("vertex_count")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .ok_or("Missing vertex_count")?;
        let index_starts = batch.column_by_name("index_start")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .ok_or("Missing index_start")?;
        let index_counts = batch.column_by_name("index_count")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .ok_or("Missing index_count")?;
        let color_r = batch.column_by_name("color_r")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .ok_or("Missing color_r")?;
        let color_g = batch.column_by_name("color_g")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .ok_or("Missing color_g")?;
        let color_b = batch.column_by_name("color_b")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .ok_or("Missing color_b")?;
        let color_a = batch.column_by_name("color_a")
            .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
            .ok_or("Missing color_a")?;

        for i in 0..batch.num_rows() {
            let eid = express_ids.value(i);
            if target_ids.contains(&eid) {
                target_meshes.push(MeshMeta {
                    express_id: eid,
                    ifc_type: ifc_types.value(i).to_string(),
                    vertex_start: vertex_starts.value(i),
                    vertex_count: vertex_counts.value(i),
                    index_start: index_starts.value(i),
                    index_count: index_counts.value(i),
                    color: [
                        color_r.value(i),
                        color_g.value(i),
                        color_b.value(i),
                        color_a.value(i),
                    ],
                });
            }
        }
    }

    if target_meshes.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: Read all vertex data (columnar x, y, z, nx, ny, nz)
    let vertex_reader = ParquetRecordBatchReaderBuilder::try_new(Bytes::copy_from_slice(vertex_parquet))
        .map_err(|e| format!("Vertex reader: {}", e))?
        .build()
        .map_err(|e| format!("Vertex build: {}", e))?;

    let mut all_x = Vec::new();
    let mut all_y = Vec::new();
    let mut all_z = Vec::new();
    let mut all_nx = Vec::new();
    let mut all_ny = Vec::new();
    let mut all_nz = Vec::new();

    for batch_result in vertex_reader {
        let batch = batch_result.map_err(|e| format!("Vertex batch: {}", e))?;
        let x = batch.column_by_name("x").and_then(|c| c.as_any().downcast_ref::<Float32Array>()).ok_or("Missing x")?;
        let y = batch.column_by_name("y").and_then(|c| c.as_any().downcast_ref::<Float32Array>()).ok_or("Missing y")?;
        let z = batch.column_by_name("z").and_then(|c| c.as_any().downcast_ref::<Float32Array>()).ok_or("Missing z")?;
        let nx = batch.column_by_name("nx").and_then(|c| c.as_any().downcast_ref::<Float32Array>()).ok_or("Missing nx")?;
        let ny = batch.column_by_name("ny").and_then(|c| c.as_any().downcast_ref::<Float32Array>()).ok_or("Missing ny")?;
        let nz = batch.column_by_name("nz").and_then(|c| c.as_any().downcast_ref::<Float32Array>()).ok_or("Missing nz")?;

        all_x.extend(x.values().as_ref());
        all_y.extend(y.values().as_ref());
        all_z.extend(z.values().as_ref());
        all_nx.extend(nx.values().as_ref());
        all_ny.extend(ny.values().as_ref());
        all_nz.extend(nz.values().as_ref());
    }

    // Step 3: Read all index data
    let index_reader = ParquetRecordBatchReaderBuilder::try_new(Bytes::copy_from_slice(index_parquet))
        .map_err(|e| format!("Index reader: {}", e))?
        .build()
        .map_err(|e| format!("Index build: {}", e))?;

    let mut all_i0: Vec<u32> = Vec::new();
    let mut all_i1: Vec<u32> = Vec::new();
    let mut all_i2: Vec<u32> = Vec::new();

    for batch_result in index_reader {
        let batch = batch_result.map_err(|e| format!("Index batch: {}", e))?;
        let i0 = batch.column_by_name("i0").and_then(|c| c.as_any().downcast_ref::<UInt32Array>()).ok_or("Missing i0")?;
        let i1 = batch.column_by_name("i1").and_then(|c| c.as_any().downcast_ref::<UInt32Array>()).ok_or("Missing i1")?;
        let i2 = batch.column_by_name("i2").and_then(|c| c.as_any().downcast_ref::<UInt32Array>()).ok_or("Missing i2")?;

        all_i0.extend(i0.values().as_ref());
        all_i1.extend(i1.values().as_ref());
        all_i2.extend(i2.values().as_ref());
    }

    // Step 4: Reconstruct MeshData for each target mesh
    let mut result = Vec::with_capacity(target_meshes.len());

    for meta in &target_meshes {
        let vs = meta.vertex_start as usize;
        let vc = meta.vertex_count as usize;
        let is = meta.index_start as usize;
        // index_count is in raw indices (not triangles), and stored as 3 columns (i0, i1, i2)
        // Each row in the index table is one triangle, so index_count / 3 = number of triangles
        let tri_count = meta.index_count as usize / 3;

        // Reconstruct interleaved positions [x,y,z, x,y,z, ...]
        let mut positions = Vec::with_capacity(vc * 3);
        for i in vs..vs + vc {
            if i < all_x.len() {
                positions.push(all_x[i]);
                positions.push(all_y[i]);
                positions.push(all_z[i]);
            }
        }

        // Reconstruct interleaved normals
        let mut normals = Vec::with_capacity(vc * 3);
        for i in vs..vs + vc {
            if i < all_nx.len() {
                normals.push(all_nx[i]);
                normals.push(all_ny[i]);
                normals.push(all_nz[i]);
            }
        }

        // Reconstruct flat indices (re-based to 0 for this mesh)
        let mut indices = Vec::with_capacity(tri_count * 3);
        for i in is..is + tri_count {
            if i < all_i0.len() {
                // Indices in parquet are global, rebase to local mesh vertex offset
                indices.push(all_i0[i] - meta.vertex_start);
                indices.push(all_i1[i] - meta.vertex_start);
                indices.push(all_i2[i] - meta.vertex_start);
            }
        }

        result.push(MeshData::new(
            meta.express_id,
            meta.ifc_type.clone(),
            positions,
            normals,
            indices,
            meta.color,
        ));
    }

    Ok(result)
}
