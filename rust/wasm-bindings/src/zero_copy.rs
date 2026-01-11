//! Zero-copy mesh data structures for WASM
//!
//! Enables direct access to WASM memory from JavaScript without copying.

use wasm_bindgen::prelude::*;
use ifc_lite_geometry::Mesh;

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
        Self {
            mesh: Mesh::new(),
        }
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
