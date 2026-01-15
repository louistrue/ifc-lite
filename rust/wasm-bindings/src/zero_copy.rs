// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Zero-copy mesh data structures for WASM
//!
//! Enables direct access to WASM memory from JavaScript without copying.

use ifc_lite_geometry::Mesh;
use wasm_bindgen::prelude::*;

/// Individual mesh data with express ID and color (matches MeshData interface)
#[wasm_bindgen]
pub struct MeshDataJs {
    express_id: u32,
    ifc_type: String, // IFC type name (e.g., "IfcWall", "IfcSpace")
    positions: Vec<f32>,
    normals: Vec<f32>,
    indices: Vec<u32>,
    color: [f32; 4], // RGBA
}

#[wasm_bindgen]
impl MeshDataJs {
    /// Get express ID
    #[wasm_bindgen(getter, js_name = expressId)]
    pub fn express_id(&self) -> u32 {
        self.express_id
    }

    /// Get IFC type name (e.g., "IfcWall", "IfcSpace")
    #[wasm_bindgen(getter, js_name = ifcType)]
    pub fn ifc_type(&self) -> String {
        self.ifc_type.clone()
    }

    /// Get positions as Float32Array (copy to JS)
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.positions[..])
    }

    /// Get normals as Float32Array (copy to JS)
    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.normals[..])
    }

    /// Get indices as Uint32Array (copy to JS)
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(&self.indices[..])
    }

    /// Get color as [r, g, b, a] array
    #[wasm_bindgen(getter)]
    pub fn color(&self) -> Vec<f32> {
        self.color.to_vec()
    }

    /// Get vertex count
    #[wasm_bindgen(getter, js_name = vertexCount)]
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// Get triangle count
    #[wasm_bindgen(getter, js_name = triangleCount)]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

impl MeshDataJs {
    /// Create new mesh data
    pub fn new(express_id: u32, ifc_type: String, mesh: Mesh, color: [f32; 4]) -> Self {
        Self {
            express_id,
            ifc_type,
            positions: mesh.positions,
            normals: mesh.normals,
            indices: mesh.indices,
            color,
        }
    }
}

/// Collection of mesh data for returning multiple meshes
#[wasm_bindgen]
pub struct MeshCollection {
    meshes: Vec<MeshDataJs>,
}

#[wasm_bindgen]
impl MeshCollection {
    /// Get number of meshes
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.meshes.len()
    }

    /// Get mesh at index
    #[wasm_bindgen]
    pub fn get(&self, index: usize) -> Option<MeshDataJs> {
        self.meshes.get(index).map(|m| MeshDataJs {
            express_id: m.express_id,
            ifc_type: m.ifc_type.clone(),
            positions: m.positions.clone(),
            normals: m.normals.clone(),
            indices: m.indices.clone(),
            color: m.color,
        })
    }

    /// Get total vertex count across all meshes
    #[wasm_bindgen(getter, js_name = totalVertices)]
    pub fn total_vertices(&self) -> usize {
        self.meshes.iter().map(|m| m.positions.len() / 3).sum()
    }

    /// Get total triangle count across all meshes
    #[wasm_bindgen(getter, js_name = totalTriangles)]
    pub fn total_triangles(&self) -> usize {
        self.meshes.iter().map(|m| m.indices.len() / 3).sum()
    }
}

impl MeshCollection {
    /// Create new empty collection
    pub fn new() -> Self {
        Self { meshes: Vec::new() }
    }

    /// Create new collection with capacity hint
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            meshes: Vec::with_capacity(capacity),
        }
    }

    /// Add a mesh to the collection
    #[inline]
    pub fn add(&mut self, mesh: MeshDataJs) {
        self.meshes.push(mesh);
    }

    /// Create from vec of meshes
    pub fn from_vec(meshes: Vec<MeshDataJs>) -> Self {
        Self { meshes }
    }

    /// Get number of meshes (internal)
    pub fn len(&self) -> usize {
        self.meshes.len()
    }

    /// Check if collection is empty
    pub fn is_empty(&self) -> bool {
        self.meshes.is_empty()
    }

    /// Apply RTC offset to all meshes (shift coordinates)
    pub fn apply_rtc_offset(&mut self, x: f64, y: f64, z: f64) {
        for mesh in &mut self.meshes {
            for chunk in mesh.positions.chunks_exact_mut(3) {
                chunk[0] = (chunk[0] as f64 - x) as f32;
                chunk[1] = (chunk[1] as f64 - y) as f32;
                chunk[2] = (chunk[2] as f64 - z) as f32;
            }
        }
    }
}

impl Clone for MeshCollection {
    fn clone(&self) -> Self {
        Self {
            meshes: self
                .meshes
                .iter()
                .map(|m| MeshDataJs {
                    express_id: m.express_id,
                    ifc_type: m.ifc_type.clone(),
                    positions: m.positions.clone(),
                    normals: m.normals.clone(),
                    indices: m.indices.clone(),
                    color: m.color,
                })
                .collect(),
        }
    }
}

impl Default for MeshCollection {
    fn default() -> Self {
        Self::new()
    }
}

/// Zero-copy mesh that exposes pointers to WASM memory
#[wasm_bindgen]
pub struct ZeroCopyMesh {
    mesh: Mesh,
}

#[wasm_bindgen]
impl ZeroCopyMesh {
    /// Create a new zero-copy mesh from a Mesh
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { mesh: Mesh::new() }
    }

    /// Get pointer to positions array
    /// JavaScript can create Float32Array view: new Float32Array(memory.buffer, ptr, length)
    #[wasm_bindgen(getter)]
    pub fn positions_ptr(&self) -> *const f32 {
        self.mesh.positions.as_ptr()
    }

    /// Get length of positions array (in f32 elements, not bytes)
    #[wasm_bindgen(getter)]
    pub fn positions_len(&self) -> usize {
        self.mesh.positions.len()
    }

    /// Get pointer to normals array
    #[wasm_bindgen(getter)]
    pub fn normals_ptr(&self) -> *const f32 {
        self.mesh.normals.as_ptr()
    }

    /// Get length of normals array
    #[wasm_bindgen(getter)]
    pub fn normals_len(&self) -> usize {
        self.mesh.normals.len()
    }

    /// Get pointer to indices array
    #[wasm_bindgen(getter)]
    pub fn indices_ptr(&self) -> *const u32 {
        self.mesh.indices.as_ptr()
    }

    /// Get length of indices array
    #[wasm_bindgen(getter)]
    pub fn indices_len(&self) -> usize {
        self.mesh.indices.len()
    }

    /// Get vertex count
    #[wasm_bindgen(getter)]
    pub fn vertex_count(&self) -> usize {
        self.mesh.vertex_count()
    }

    /// Get triangle count
    #[wasm_bindgen(getter)]
    pub fn triangle_count(&self) -> usize {
        self.mesh.triangle_count()
    }

    /// Check if mesh is empty
    #[wasm_bindgen(getter)]
    pub fn is_empty(&self) -> bool {
        self.mesh.is_empty()
    }

    /// Get bounding box minimum point
    #[wasm_bindgen]
    pub fn bounds_min(&self) -> Vec<f32> {
        let (min, _) = self.mesh.bounds();
        vec![min.x, min.y, min.z]
    }

    /// Get bounding box maximum point
    #[wasm_bindgen]
    pub fn bounds_max(&self) -> Vec<f32> {
        let (_, max) = self.mesh.bounds();
        vec![max.x, max.y, max.z]
    }
}

impl From<Mesh> for ZeroCopyMesh {
    fn from(mesh: Mesh) -> Self {
        Self { mesh }
    }
}

impl Default for ZeroCopyMesh {
    fn default() -> Self {
        Self::new()
    }
}

/// Instance data for instanced rendering
#[wasm_bindgen]
pub struct InstanceData {
    express_id: u32,
    transform: Vec<f32>, // 16 floats (4x4 matrix)
    color: [f32; 4],     // RGBA
}

#[wasm_bindgen]
impl InstanceData {
    #[wasm_bindgen(getter, js_name = expressId)]
    pub fn express_id(&self) -> u32 {
        self.express_id
    }

    #[wasm_bindgen(getter)]
    pub fn transform(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.transform[..])
    }

    #[wasm_bindgen(getter)]
    pub fn color(&self) -> Vec<f32> {
        self.color.to_vec()
    }
}

impl InstanceData {
    pub fn new(express_id: u32, transform: Vec<f32>, color: [f32; 4]) -> Self {
        Self {
            express_id,
            transform,
            color,
        }
    }
}

/// Instanced geometry - one geometry definition with multiple instances
#[wasm_bindgen]
pub struct InstancedGeometry {
    geometry_id: u64,
    positions: Vec<f32>,
    normals: Vec<f32>,
    indices: Vec<u32>,
    instances: Vec<InstanceData>,
}

#[wasm_bindgen]
impl InstancedGeometry {
    #[wasm_bindgen(getter, js_name = geometryId)]
    pub fn geometry_id(&self) -> u64 {
        self.geometry_id
    }

    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.positions[..])
    }

    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.normals[..])
    }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(&self.indices[..])
    }

    #[wasm_bindgen(getter)]
    pub fn instance_count(&self) -> usize {
        self.instances.len()
    }

    #[wasm_bindgen]
    pub fn get_instance(&self, index: usize) -> Option<InstanceData> {
        self.instances.get(index).map(|inst| InstanceData {
            express_id: inst.express_id,
            transform: inst.transform.clone(),
            color: inst.color,
        })
    }
}

impl InstancedGeometry {
    pub fn new(
        geometry_id: u64,
        positions: Vec<f32>,
        normals: Vec<f32>,
        indices: Vec<u32>,
    ) -> Self {
        Self {
            geometry_id,
            positions,
            normals,
            indices,
            instances: Vec::new(),
        }
    }

    pub fn add_instance(&mut self, instance: InstanceData) {
        self.instances.push(instance);
    }
}

/// Collection of instanced geometries
#[wasm_bindgen]
pub struct InstancedMeshCollection {
    geometries: Vec<InstancedGeometry>,
}

#[wasm_bindgen]
impl InstancedMeshCollection {
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.geometries.len()
    }

    #[wasm_bindgen]
    pub fn get(&self, index: usize) -> Option<InstancedGeometry> {
        self.geometries.get(index).map(|g| InstancedGeometry {
            geometry_id: g.geometry_id,
            positions: g.positions.clone(),
            normals: g.normals.clone(),
            indices: g.indices.clone(),
            instances: g
                .instances
                .iter()
                .map(|inst| InstanceData {
                    express_id: inst.express_id,
                    transform: inst.transform.clone(),
                    color: inst.color,
                })
                .collect(),
        })
    }

    #[wasm_bindgen(getter, js_name = totalGeometries)]
    pub fn total_geometries(&self) -> usize {
        self.geometries.len()
    }

    #[wasm_bindgen(getter, js_name = totalInstances)]
    pub fn total_instances(&self) -> usize {
        self.geometries.iter().map(|g| g.instances.len()).sum()
    }
}

impl InstancedMeshCollection {
    pub fn new() -> Self {
        Self {
            geometries: Vec::new(),
        }
    }

    pub fn add(&mut self, geometry: InstancedGeometry) {
        self.geometries.push(geometry);
    }
}

impl Default for InstancedMeshCollection {
    fn default() -> Self {
        Self::new()
    }
}

/// Get WASM memory to allow JavaScript to create TypedArray views
#[wasm_bindgen]
pub fn get_memory() -> JsValue {
    wasm_bindgen::memory()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_copy_mesh_creation() {
        let mesh = ZeroCopyMesh::new();
        assert!(mesh.is_empty());
        assert_eq!(mesh.vertex_count(), 0);
        assert_eq!(mesh.triangle_count(), 0);
    }

    #[test]
    fn test_zero_copy_mesh_pointers() {
        let mesh = ZeroCopyMesh::new();

        // Pointers should be valid even for empty mesh
        assert!(!mesh.positions_ptr().is_null());
        assert!(!mesh.normals_ptr().is_null());
        assert!(!mesh.indices_ptr().is_null());
    }
}
