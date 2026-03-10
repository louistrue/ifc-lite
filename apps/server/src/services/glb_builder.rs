// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! GLB (glTF 2.0 Binary) builder for 3D Tiles content.
//!
//! Packs filtered mesh data into GLB format suitable for serving as
//! individual tile content. Each IFC element becomes a separate glTF node.

use crate::types::MeshData;
use serde_json::json;

/// Build a GLB binary from a set of meshes.
///
/// Creates a valid glTF 2.0 binary with:
/// - One buffer containing all vertex and index data
/// - One mesh per IFC element (with expressId in extras)
/// - Positions (f32), normals (f32), indices (u32)
/// - Per-mesh vertex colors from IFC style
pub fn build_glb(meshes: &[MeshData]) -> Vec<u8> {
    if meshes.is_empty() {
        return build_empty_glb();
    }

    // Collect all geometry data into flat buffers
    let mut all_positions: Vec<f32> = Vec::new();
    let mut all_normals: Vec<f32> = Vec::new();
    let mut all_indices: Vec<u32> = Vec::new();

    // Track per-mesh offsets for accessor/bufferView creation
    struct MeshInfo {
        pos_byte_offset: usize,
        pos_byte_length: usize,
        norm_byte_offset: usize,
        norm_byte_length: usize,
        idx_byte_offset: usize,
        idx_byte_length: usize,
        vertex_count: usize,
        index_count: usize,
        min_pos: [f32; 3],
        max_pos: [f32; 3],
        express_id: u32,
        color: [f32; 4],
    }

    let mut mesh_infos = Vec::with_capacity(meshes.len());

    for mesh in meshes {
        let vertex_count = mesh.positions.len() / 3;
        let index_count = mesh.indices.len();

        // Compute position bounds (already in Y-up from parquet)
        let mut min_pos = [f32::INFINITY; 3];
        let mut max_pos = [f32::NEG_INFINITY; 3];
        for i in 0..vertex_count {
            let x = mesh.positions[i * 3];
            let y = mesh.positions[i * 3 + 1];
            let z = mesh.positions[i * 3 + 2];
            min_pos[0] = min_pos[0].min(x);
            min_pos[1] = min_pos[1].min(y);
            min_pos[2] = min_pos[2].min(z);
            max_pos[0] = max_pos[0].max(x);
            max_pos[1] = max_pos[1].max(y);
            max_pos[2] = max_pos[2].max(z);
        }

        if !min_pos[0].is_finite() {
            min_pos = [0.0; 3];
            max_pos = [0.0; 3];
        }

        let pos_byte_offset = all_positions.len() * 4;
        let pos_byte_length = vertex_count * 3 * 4;
        all_positions.extend_from_slice(&mesh.positions);

        let norm_byte_offset = all_normals.len() * 4;
        let norm_byte_length = vertex_count * 3 * 4;
        all_normals.extend_from_slice(&mesh.normals);

        let idx_byte_offset = all_indices.len() * 4;
        let idx_byte_length = index_count * 4;
        all_indices.extend_from_slice(&mesh.indices);

        mesh_infos.push(MeshInfo {
            pos_byte_offset,
            pos_byte_length,
            norm_byte_offset,
            norm_byte_length,
            idx_byte_offset,
            idx_byte_length,
            vertex_count,
            index_count,
            min_pos,
            max_pos,
            express_id: mesh.express_id,
            color: mesh.color,
        });
    }

    // Binary buffer layout: [positions][normals][indices]
    let positions_total_bytes = all_positions.len() * 4;
    let normals_total_bytes = all_normals.len() * 4;
    let indices_total_bytes = all_indices.len() * 4;
    let normals_base_offset = positions_total_bytes;
    let indices_base_offset = positions_total_bytes + normals_total_bytes;
    let total_buffer_bytes = positions_total_bytes + normals_total_bytes + indices_total_bytes;

    // Build glTF JSON structure
    let mut buffer_views = Vec::new();
    let mut accessors = Vec::new();
    let mut gltf_meshes = Vec::new();
    let mut nodes = Vec::new();
    let mut materials = Vec::new();
    let mut material_map: std::collections::HashMap<[u8; 4], usize> = std::collections::HashMap::new();

    for (i, info) in mesh_infos.iter().enumerate() {
        let bv_pos_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": info.pos_byte_offset,
            "byteLength": info.pos_byte_length,
            "target": 34962 // ARRAY_BUFFER
        }));

        let bv_norm_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": normals_base_offset + info.norm_byte_offset,
            "byteLength": info.norm_byte_length,
            "target": 34962
        }));

        let bv_idx_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": indices_base_offset + info.idx_byte_offset,
            "byteLength": info.idx_byte_length,
            "target": 34963 // ELEMENT_ARRAY_BUFFER
        }));

        let acc_pos_idx = accessors.len();
        accessors.push(json!({
            "bufferView": bv_pos_idx,
            "componentType": 5126, // FLOAT
            "count": info.vertex_count,
            "type": "VEC3",
            "min": info.min_pos,
            "max": info.max_pos
        }));

        let acc_norm_idx = accessors.len();
        accessors.push(json!({
            "bufferView": bv_norm_idx,
            "componentType": 5126,
            "count": info.vertex_count,
            "type": "VEC3"
        }));

        let acc_idx_idx = accessors.len();
        accessors.push(json!({
            "bufferView": bv_idx_idx,
            "componentType": 5125, // UNSIGNED_INT
            "count": info.index_count,
            "type": "SCALAR"
        }));

        // Get or create material for this color
        let color_key = [
            (info.color[0] * 255.0) as u8,
            (info.color[1] * 255.0) as u8,
            (info.color[2] * 255.0) as u8,
            (info.color[3] * 255.0) as u8,
        ];
        let material_idx = *material_map.entry(color_key).or_insert_with(|| {
            let idx = materials.len();
            let mut mat = json!({
                "pbrMetallicRoughness": {
                    "baseColorFactor": info.color,
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.8
                }
            });
            if info.color[3] < 1.0 {
                mat["alphaMode"] = json!("BLEND");
            }
            materials.push(mat);
            idx
        });

        gltf_meshes.push(json!({
            "primitives": [{
                "attributes": {
                    "POSITION": acc_pos_idx,
                    "NORMAL": acc_norm_idx
                },
                "indices": acc_idx_idx,
                "material": material_idx,
                "mode": 4 // TRIANGLES
            }]
        }));

        nodes.push(json!({
            "mesh": i,
            "extras": {
                "expressId": info.express_id
            }
        }));
    }

    let scene_nodes: Vec<usize> = (0..nodes.len()).collect();

    let gltf_json = json!({
        "asset": {
            "version": "2.0",
            "generator": "ifc-lite-server"
        },
        "scene": 0,
        "scenes": [{
            "nodes": scene_nodes
        }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{
            "byteLength": total_buffer_bytes
        }]
    });

    let json_string = serde_json::to_string(&gltf_json).unwrap();
    // Pad JSON to 4-byte alignment
    let json_bytes = json_string.as_bytes();
    let json_padding = (4 - (json_bytes.len() % 4)) % 4;
    let json_chunk_length = json_bytes.len() + json_padding;

    // Pad binary to 4-byte alignment
    let bin_padding = (4 - (total_buffer_bytes % 4)) % 4;
    let bin_chunk_length = total_buffer_bytes + bin_padding;

    // GLB total: header(12) + json_chunk_header(8) + json + bin_chunk_header(8) + bin
    let total_length = 12 + 8 + json_chunk_length + 8 + bin_chunk_length;

    let mut glb = Vec::with_capacity(total_length);

    // GLB Header
    glb.extend_from_slice(b"glTF");                              // magic
    glb.extend_from_slice(&2u32.to_le_bytes());                  // version
    glb.extend_from_slice(&(total_length as u32).to_le_bytes()); // total length

    // JSON Chunk
    glb.extend_from_slice(&(json_chunk_length as u32).to_le_bytes()); // chunk length
    glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());              // chunk type: JSON
    glb.extend_from_slice(json_bytes);
    glb.extend(std::iter::repeat(b' ').take(json_padding));           // pad with spaces

    // Binary Chunk
    glb.extend_from_slice(&(bin_chunk_length as u32).to_le_bytes()); // chunk length
    glb.extend_from_slice(&0x004E4942u32.to_le_bytes());             // chunk type: BIN

    // Write binary data: positions, then normals, then indices
    for &f in &all_positions {
        glb.extend_from_slice(&f.to_le_bytes());
    }
    for &f in &all_normals {
        glb.extend_from_slice(&f.to_le_bytes());
    }
    for &i in &all_indices {
        glb.extend_from_slice(&i.to_le_bytes());
    }
    glb.extend(std::iter::repeat(0u8).take(bin_padding)); // pad with zeros

    glb
}

/// Build an empty GLB for tiles with no content.
fn build_empty_glb() -> Vec<u8> {
    let gltf_json = json!({
        "asset": {
            "version": "2.0",
            "generator": "ifc-lite-server"
        },
        "scene": 0,
        "scenes": [{ "nodes": [] }]
    });

    let json_string = serde_json::to_string(&gltf_json).unwrap();
    let json_bytes = json_string.as_bytes();
    let json_padding = (4 - (json_bytes.len() % 4)) % 4;
    let json_chunk_length = json_bytes.len() + json_padding;
    let total_length = 12 + 8 + json_chunk_length;

    let mut glb = Vec::with_capacity(total_length);
    glb.extend_from_slice(b"glTF");
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&(total_length as u32).to_le_bytes());
    glb.extend_from_slice(&(json_chunk_length as u32).to_le_bytes());
    glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
    glb.extend_from_slice(json_bytes);
    glb.extend(std::iter::repeat(b' ').take(json_padding));

    glb
}

/// Cache key for an individual tile GLB.
pub fn tile_cache_key(model_hash: &str, zone_id: &str, ifc_class: &str) -> String {
    format!("{}-tile-{}-{}-v1", model_hash, zone_id, ifc_class)
}
