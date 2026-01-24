// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! GPU-ready geometry data structures for zero-copy WebGPU upload
//!
//! This module provides geometry data structures that are pre-processed for direct
//! GPU upload without intermediate copies. Data is:
//! - Interleaved (position + normal per vertex)
//! - Coordinate-converted (Z-up to Y-up)
//! - Stored contiguously for efficient memory access
//!
//! # Zero-Copy Pattern
//!
//! ```javascript
//! // Get GPU-ready geometry from WASM
//! const gpuGeom = api.parseToGpuGeometry(ifcData);
//!
//! // Get WASM memory buffer
//! const memory = api.getMemory();
//!
//! // Create views directly into WASM memory (NO COPY!)
//! const vertexView = new Float32Array(
//!   memory.buffer,
//!   gpuGeom.vertexDataPtr,
//!   gpuGeom.vertexDataLen
//! );
//!
//! // Upload directly to GPU (single copy: WASM → GPU)
//! device.queue.writeBuffer(gpuBuffer, 0, vertexView);
//!
//! // IMPORTANT: Free the geometry when done (allows WASM to reuse memory)
//! gpuGeom.free();
//! ```

use wasm_bindgen::prelude::*;

/// Metadata for a single mesh within the GPU geometry buffer
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct GpuMeshMetadata {
    /// Express ID of the IFC entity
    express_id: u32,
    /// Index into the IFC type string table
    ifc_type_idx: u16,
    /// Offset in vertex_data (in floats, not bytes)
    vertex_offset: u32,
    /// Number of vertices
    vertex_count: u32,
    /// Offset in indices array
    index_offset: u32,
    /// Number of indices
    index_count: u32,
    /// RGBA color
    color: [f32; 4],
}

#[wasm_bindgen]
impl GpuMeshMetadata {
    #[wasm_bindgen(getter, js_name = expressId)]
    pub fn express_id(&self) -> u32 {
        self.express_id
    }

    #[wasm_bindgen(getter, js_name = ifcTypeIdx)]
    pub fn ifc_type_idx(&self) -> u16 {
        self.ifc_type_idx
    }

    #[wasm_bindgen(getter, js_name = vertexOffset)]
    pub fn vertex_offset(&self) -> u32 {
        self.vertex_offset
    }

    #[wasm_bindgen(getter, js_name = vertexCount)]
    pub fn vertex_count(&self) -> u32 {
        self.vertex_count
    }

    #[wasm_bindgen(getter, js_name = indexOffset)]
    pub fn index_offset(&self) -> u32 {
        self.index_offset
    }

    #[wasm_bindgen(getter, js_name = indexCount)]
    pub fn index_count(&self) -> u32 {
        self.index_count
    }

    #[wasm_bindgen(getter)]
    pub fn color(&self) -> Vec<f32> {
        self.color.to_vec()
    }
}

/// GPU-ready geometry stored in WASM linear memory
///
/// Data layout:
/// - vertex_data: Interleaved [px, py, pz, nx, ny, nz, ...] (6 floats per vertex)
/// - indices: Triangle indices [i0, i1, i2, ...]
/// - mesh_metadata: Per-mesh metadata for draw calls
///
/// All coordinates are pre-converted from IFC Z-up to WebGL Y-up
#[wasm_bindgen]
pub struct GpuGeometry {
    /// Interleaved vertex data: [px, py, pz, nx, ny, nz, ...]
    /// Already converted from Z-up to Y-up
    vertex_data: Vec<f32>,

    /// Triangle indices
    indices: Vec<u32>,

    /// Metadata per mesh (for selection, draw call ranges, etc.)
    mesh_metadata: Vec<GpuMeshMetadata>,

    /// IFC type names (deduplicated)
    ifc_type_names: Vec<String>,

    /// RTC (Relative To Center) offset applied to coordinates
    /// Used for models with large world coordinates (>10km from origin)
    rtc_offset_x: f64,
    rtc_offset_y: f64,
    rtc_offset_z: f64,
}

#[wasm_bindgen]
impl GpuGeometry {
    /// Create a new empty GPU geometry container
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            vertex_data: Vec::new(),
            indices: Vec::new(),
            mesh_metadata: Vec::new(),
            ifc_type_names: Vec::new(),
            rtc_offset_x: 0.0,
            rtc_offset_y: 0.0,
            rtc_offset_z: 0.0,
        }
    }

    /// Set the RTC (Relative To Center) offset applied to coordinates
    pub fn set_rtc_offset(&mut self, x: f64, y: f64, z: f64) {
        self.rtc_offset_x = x;
        self.rtc_offset_y = y;
        self.rtc_offset_z = z;
    }

    /// Get X component of RTC offset
    #[wasm_bindgen(getter, js_name = rtcOffsetX)]
    pub fn rtc_offset_x(&self) -> f64 {
        self.rtc_offset_x
    }

    /// Get Y component of RTC offset
    #[wasm_bindgen(getter, js_name = rtcOffsetY)]
    pub fn rtc_offset_y(&self) -> f64 {
        self.rtc_offset_y
    }

    /// Get Z component of RTC offset
    #[wasm_bindgen(getter, js_name = rtcOffsetZ)]
    pub fn rtc_offset_z(&self) -> f64 {
        self.rtc_offset_z
    }

    /// Check if RTC offset is active (non-zero)
    #[wasm_bindgen(getter, js_name = hasRtcOffset)]
    pub fn has_rtc_offset(&self) -> bool {
        self.rtc_offset_x != 0.0 || self.rtc_offset_y != 0.0 || self.rtc_offset_z != 0.0
    }

    /// Get pointer to vertex data for zero-copy view
    ///
    /// SAFETY: View is only valid until next WASM allocation!
    /// Create view, upload to GPU, then discard view immediately.
    #[wasm_bindgen(getter, js_name = vertexDataPtr)]
    pub fn vertex_data_ptr(&self) -> *const f32 {
        self.vertex_data.as_ptr()
    }

    /// Get length of vertex data array (in f32 elements, not bytes)
    #[wasm_bindgen(getter, js_name = vertexDataLen)]
    pub fn vertex_data_len(&self) -> usize {
        self.vertex_data.len()
    }

    /// Get byte length of vertex data (for GPU buffer creation)
    #[wasm_bindgen(getter, js_name = vertexDataByteLength)]
    pub fn vertex_data_byte_length(&self) -> usize {
        self.vertex_data.len() * 4 // f32 = 4 bytes
    }

    /// Get pointer to indices array for zero-copy view
    #[wasm_bindgen(getter, js_name = indicesPtr)]
    pub fn indices_ptr(&self) -> *const u32 {
        self.indices.as_ptr()
    }

    /// Get length of indices array (in u32 elements)
    #[wasm_bindgen(getter, js_name = indicesLen)]
    pub fn indices_len(&self) -> usize {
        self.indices.len()
    }

    /// Get byte length of indices (for GPU buffer creation)
    #[wasm_bindgen(getter, js_name = indicesByteLength)]
    pub fn indices_byte_length(&self) -> usize {
        self.indices.len() * 4 // u32 = 4 bytes
    }

    /// Get number of meshes in this geometry batch
    #[wasm_bindgen(getter, js_name = meshCount)]
    pub fn mesh_count(&self) -> usize {
        self.mesh_metadata.len()
    }

    /// Get total vertex count
    #[wasm_bindgen(getter, js_name = totalVertexCount)]
    pub fn total_vertex_count(&self) -> usize {
        self.vertex_data.len() / 6 // 6 floats per vertex (pos + normal)
    }

    /// Get total triangle count
    #[wasm_bindgen(getter, js_name = totalTriangleCount)]
    pub fn total_triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Get metadata for a specific mesh
    #[wasm_bindgen(js_name = getMeshMetadata)]
    pub fn get_mesh_metadata(&self, index: usize) -> Option<GpuMeshMetadata> {
        self.mesh_metadata.get(index).cloned()
    }

    /// Get IFC type name by index
    #[wasm_bindgen(js_name = getIfcTypeName)]
    pub fn get_ifc_type_name(&self, index: u16) -> Option<String> {
        self.ifc_type_names.get(index as usize).cloned()
    }

    /// Check if geometry is empty
    #[wasm_bindgen(getter, js_name = isEmpty)]
    pub fn is_empty(&self) -> bool {
        self.vertex_data.is_empty()
    }
}

impl GpuGeometry {
    /// Create with pre-allocated capacity
    pub fn with_capacity(vertex_capacity: usize, index_capacity: usize) -> Self {
        Self {
            vertex_data: Vec::with_capacity(vertex_capacity),
            indices: Vec::with_capacity(index_capacity),
            mesh_metadata: Vec::with_capacity(256),
            ifc_type_names: Vec::with_capacity(64),
            rtc_offset_x: 0.0,
            rtc_offset_y: 0.0,
            rtc_offset_z: 0.0,
        }
    }

    /// Add a mesh with positions and normals, interleaving and converting coordinates
    pub fn add_mesh(
        &mut self,
        express_id: u32,
        ifc_type: &str,
        positions: &[f32],
        normals: &[f32],
        indices: &[u32],
        color: [f32; 4],
    ) {
        let vertex_count = positions.len() / 3;
        if vertex_count == 0 {
            return;
        }

        // Get or add IFC type name
        let ifc_type_idx = self.get_or_add_ifc_type(ifc_type);

        // Record current offsets
        let vertex_offset = (self.vertex_data.len() / 6) as u32;
        let index_offset = self.indices.len() as u32;

        // Interleave positions and normals with coordinate conversion
        // Layout: [px, py, pz, nx, ny, nz] per vertex
        self.vertex_data.reserve(vertex_count * 6);

        for i in 0..vertex_count {
            let pi = i * 3;

            // Position (convert Z-up to Y-up)
            let px = positions[pi];
            let py = positions[pi + 2]; // New Y = old Z
            let pz = -positions[pi + 1]; // New Z = -old Y

            // Normal (convert Z-up to Y-up)
            let nx = normals[pi];
            let ny = normals[pi + 2]; // New Y = old Z
            let nz = -normals[pi + 1]; // New Z = -old Y

            self.vertex_data.push(px);
            self.vertex_data.push(py);
            self.vertex_data.push(pz);
            self.vertex_data.push(nx);
            self.vertex_data.push(ny);
            self.vertex_data.push(nz);
        }

        // Add indices (offset by current vertex count)
        self.indices.reserve(indices.len());
        for &idx in indices {
            self.indices.push(idx + vertex_offset);
        }

        // Add metadata
        self.mesh_metadata.push(GpuMeshMetadata {
            express_id,
            ifc_type_idx,
            vertex_offset,
            vertex_count: vertex_count as u32,
            index_offset,
            index_count: indices.len() as u32,
            color,
        });
    }

    /// Get or add an IFC type name to the string table
    fn get_or_add_ifc_type(&mut self, ifc_type: &str) -> u16 {
        // Check if already exists
        for (i, name) in self.ifc_type_names.iter().enumerate() {
            if name == ifc_type {
                return i as u16;
            }
        }

        // Add new
        let idx = self.ifc_type_names.len() as u16;
        self.ifc_type_names.push(ifc_type.to_string());
        idx
    }

    /// Clear all data (for reuse)
    pub fn clear(&mut self) {
        self.vertex_data.clear();
        self.indices.clear();
        self.mesh_metadata.clear();
        // Keep ifc_type_names for reuse
    }
}

impl Default for GpuGeometry {
    fn default() -> Self {
        Self::new()
    }
}

/// GPU-ready instanced geometry for efficient rendering of repeated shapes
///
/// Data layout:
/// - vertex_data: Interleaved [px, py, pz, nx, ny, nz, ...] (shared geometry)
/// - indices: Triangle indices (shared geometry)
/// - instance_data: [transform (16 floats) + color (4 floats)] per instance = 20 floats
#[wasm_bindgen]
pub struct GpuInstancedGeometry {
    /// Geometry ID (hash of the geometry for deduplication)
    geometry_id: u64,

    /// Interleaved vertex data for shared geometry
    vertex_data: Vec<f32>,

    /// Triangle indices for shared geometry
    indices: Vec<u32>,

    /// Instance data: [transform (16 floats) + color (4 floats)] per instance
    instance_data: Vec<f32>,

    /// Express IDs for each instance (for selection)
    instance_express_ids: Vec<u32>,
}

#[wasm_bindgen]
impl GpuInstancedGeometry {
    /// Create new instanced geometry
    #[wasm_bindgen(constructor)]
    pub fn new(geometry_id: u64) -> Self {
        Self {
            geometry_id,
            vertex_data: Vec::new(),
            indices: Vec::new(),
            instance_data: Vec::new(),
            instance_express_ids: Vec::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = geometryId)]
    pub fn geometry_id(&self) -> u64 {
        self.geometry_id
    }

    // Vertex data pointers
    #[wasm_bindgen(getter, js_name = vertexDataPtr)]
    pub fn vertex_data_ptr(&self) -> *const f32 {
        self.vertex_data.as_ptr()
    }

    #[wasm_bindgen(getter, js_name = vertexDataLen)]
    pub fn vertex_data_len(&self) -> usize {
        self.vertex_data.len()
    }

    #[wasm_bindgen(getter, js_name = vertexDataByteLength)]
    pub fn vertex_data_byte_length(&self) -> usize {
        self.vertex_data.len() * 4
    }

    // Indices pointers
    #[wasm_bindgen(getter, js_name = indicesPtr)]
    pub fn indices_ptr(&self) -> *const u32 {
        self.indices.as_ptr()
    }

    #[wasm_bindgen(getter, js_name = indicesLen)]
    pub fn indices_len(&self) -> usize {
        self.indices.len()
    }

    #[wasm_bindgen(getter, js_name = indicesByteLength)]
    pub fn indices_byte_length(&self) -> usize {
        self.indices.len() * 4
    }

    // Instance data pointers
    #[wasm_bindgen(getter, js_name = instanceDataPtr)]
    pub fn instance_data_ptr(&self) -> *const f32 {
        self.instance_data.as_ptr()
    }

    #[wasm_bindgen(getter, js_name = instanceDataLen)]
    pub fn instance_data_len(&self) -> usize {
        self.instance_data.len()
    }

    #[wasm_bindgen(getter, js_name = instanceDataByteLength)]
    pub fn instance_data_byte_length(&self) -> usize {
        self.instance_data.len() * 4
    }

    // Instance express IDs pointer
    #[wasm_bindgen(getter, js_name = instanceExpressIdsPtr)]
    pub fn instance_express_ids_ptr(&self) -> *const u32 {
        self.instance_express_ids.as_ptr()
    }

    #[wasm_bindgen(getter, js_name = instanceCount)]
    pub fn instance_count(&self) -> usize {
        self.instance_express_ids.len()
    }

    #[wasm_bindgen(getter, js_name = vertexCount)]
    pub fn vertex_count(&self) -> usize {
        self.vertex_data.len() / 6
    }

    #[wasm_bindgen(getter, js_name = triangleCount)]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

impl GpuInstancedGeometry {
    /// Set shared geometry with interleaving and coordinate conversion
    pub fn set_geometry(&mut self, positions: &[f32], normals: &[f32], indices: &[u32]) {
        let vertex_count = positions.len() / 3;

        // Clear and reserve
        self.vertex_data.clear();
        self.vertex_data.reserve(vertex_count * 6);
        self.indices.clear();
        self.indices.reserve(indices.len());

        // Interleave with Z-up to Y-up conversion
        for i in 0..vertex_count {
            let pi = i * 3;

            // Position (convert Z-up to Y-up)
            self.vertex_data.push(positions[pi]);
            self.vertex_data.push(positions[pi + 2]); // New Y = old Z
            self.vertex_data.push(-positions[pi + 1]); // New Z = -old Y

            // Normal (convert Z-up to Y-up)
            self.vertex_data.push(normals[pi]);
            self.vertex_data.push(normals[pi + 2]); // New Y = old Z
            self.vertex_data.push(-normals[pi + 1]); // New Z = -old Y
        }

        // Copy indices directly
        self.indices.extend_from_slice(indices);
    }

    /// Add an instance with transform and color
    pub fn add_instance(&mut self, express_id: u32, transform: &[f32; 16], color: [f32; 4]) {
        // Add transform (16 floats)
        self.instance_data.extend_from_slice(transform);

        // Add color (4 floats)
        self.instance_data.extend_from_slice(&color);

        // Track express ID
        self.instance_express_ids.push(express_id);
    }
}

/// Collection of GPU-ready instanced geometries
#[wasm_bindgen]
pub struct GpuInstancedGeometryCollection {
    geometries: Vec<GpuInstancedGeometry>,
}

#[wasm_bindgen]
impl GpuInstancedGeometryCollection {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            geometries: Vec::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.geometries.len()
    }

    #[wasm_bindgen]
    pub fn get(&self, index: usize) -> Option<GpuInstancedGeometry> {
        self.geometries.get(index).map(|g| GpuInstancedGeometry {
            geometry_id: g.geometry_id,
            vertex_data: g.vertex_data.clone(),
            indices: g.indices.clone(),
            instance_data: g.instance_data.clone(),
            instance_express_ids: g.instance_express_ids.clone(),
        })
    }

    /// Get geometry by index with zero-copy access
    /// Returns a reference that provides pointer access
    #[wasm_bindgen(js_name = getRef)]
    pub fn get_ref(&self, index: usize) -> Option<GpuInstancedGeometryRef> {
        if index < self.geometries.len() {
            Some(GpuInstancedGeometryRef {
                collection_ptr: self as *const GpuInstancedGeometryCollection,
                index,
            })
        } else {
            None
        }
    }
}

impl GpuInstancedGeometryCollection {
    pub fn add(&mut self, geometry: GpuInstancedGeometry) {
        self.geometries.push(geometry);
    }

    pub fn get_mut(&mut self, index: usize) -> Option<&mut GpuInstancedGeometry> {
        self.geometries.get_mut(index)
    }
}

impl Default for GpuInstancedGeometryCollection {
    fn default() -> Self {
        Self::new()
    }
}

/// Reference to geometry in collection for zero-copy access
/// This avoids cloning when accessing geometry data
#[wasm_bindgen]
pub struct GpuInstancedGeometryRef {
    collection_ptr: *const GpuInstancedGeometryCollection,
    index: usize,
}

#[wasm_bindgen]
impl GpuInstancedGeometryRef {
    fn get_geometry(&self) -> Option<&GpuInstancedGeometry> {
        unsafe {
            let collection = &*self.collection_ptr;
            collection.geometries.get(self.index)
        }
    }

    #[wasm_bindgen(getter, js_name = geometryId)]
    pub fn geometry_id(&self) -> u64 {
        self.get_geometry().map(|g| g.geometry_id).unwrap_or(0)
    }

    #[wasm_bindgen(getter, js_name = vertexDataPtr)]
    pub fn vertex_data_ptr(&self) -> *const f32 {
        self.get_geometry()
            .map(|g| g.vertex_data.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    #[wasm_bindgen(getter, js_name = vertexDataLen)]
    pub fn vertex_data_len(&self) -> usize {
        self.get_geometry().map(|g| g.vertex_data.len()).unwrap_or(0)
    }

    #[wasm_bindgen(getter, js_name = vertexDataByteLength)]
    pub fn vertex_data_byte_length(&self) -> usize {
        self.vertex_data_len() * 4
    }

    #[wasm_bindgen(getter, js_name = indicesPtr)]
    pub fn indices_ptr(&self) -> *const u32 {
        self.get_geometry()
            .map(|g| g.indices.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    #[wasm_bindgen(getter, js_name = indicesLen)]
    pub fn indices_len(&self) -> usize {
        self.get_geometry().map(|g| g.indices.len()).unwrap_or(0)
    }

    #[wasm_bindgen(getter, js_name = indicesByteLength)]
    pub fn indices_byte_length(&self) -> usize {
        self.indices_len() * 4
    }

    #[wasm_bindgen(getter, js_name = instanceDataPtr)]
    pub fn instance_data_ptr(&self) -> *const f32 {
        self.get_geometry()
            .map(|g| g.instance_data.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    #[wasm_bindgen(getter, js_name = instanceDataLen)]
    pub fn instance_data_len(&self) -> usize {
        self.get_geometry()
            .map(|g| g.instance_data.len())
            .unwrap_or(0)
    }

    #[wasm_bindgen(getter, js_name = instanceDataByteLength)]
    pub fn instance_data_byte_length(&self) -> usize {
        self.instance_data_len() * 4
    }

    #[wasm_bindgen(getter, js_name = instanceExpressIdsPtr)]
    pub fn instance_express_ids_ptr(&self) -> *const u32 {
        self.get_geometry()
            .map(|g| g.instance_express_ids.as_ptr())
            .unwrap_or(std::ptr::null())
    }

    #[wasm_bindgen(getter, js_name = instanceCount)]
    pub fn instance_count(&self) -> usize {
        self.get_geometry()
            .map(|g| g.instance_express_ids.len())
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gpu_geometry_creation() {
        let geom = GpuGeometry::new();
        assert!(geom.is_empty());
        assert_eq!(geom.mesh_count(), 0);
    }

    #[test]
    fn test_gpu_geometry_add_mesh() {
        let mut geom = GpuGeometry::new();

        // Simple triangle
        let positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 0.0, 1.0];
        let normals = vec![0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0];
        let indices = vec![0, 1, 2];
        let color = [1.0, 0.0, 0.0, 1.0];

        geom.add_mesh(123, "IfcWall", &positions, &normals, &indices, color);

        assert!(!geom.is_empty());
        assert_eq!(geom.mesh_count(), 1);
        assert_eq!(geom.total_vertex_count(), 3);
        assert_eq!(geom.total_triangle_count(), 1);

        // Check metadata
        let meta = geom.get_mesh_metadata(0).unwrap();
        assert_eq!(meta.express_id, 123);
        assert_eq!(meta.vertex_count, 3);
        assert_eq!(meta.index_count, 3);
    }

    #[test]
    fn test_coordinate_conversion() {
        let mut geom = GpuGeometry::new();

        // Point at (1, 2, 3) in Z-up should become (1, 3, -2) in Y-up
        let positions = vec![1.0, 2.0, 3.0];
        let normals = vec![0.0, 0.0, 1.0]; // Normal pointing up in Z-up
        let indices = vec![0];
        let color = [1.0, 1.0, 1.0, 1.0];

        geom.add_mesh(1, "Test", &positions, &normals, &indices, color);

        // Vertex data is interleaved: [px, py, pz, nx, ny, nz]
        assert_eq!(geom.vertex_data[0], 1.0); // px unchanged
        assert_eq!(geom.vertex_data[1], 3.0); // py = old z
        assert_eq!(geom.vertex_data[2], -2.0); // pz = -old y

        assert_eq!(geom.vertex_data[3], 0.0); // nx unchanged
        assert_eq!(geom.vertex_data[4], 1.0); // ny = old nz (normal pointing up)
        assert_eq!(geom.vertex_data[5], 0.0); // nz = -old ny
    }

    #[test]
    fn test_instanced_geometry() {
        let mut geom = GpuInstancedGeometry::new(12345);

        let positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 0.0, 1.0];
        let normals = vec![0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0];
        let indices = vec![0, 1, 2];

        geom.set_geometry(&positions, &normals, &indices);

        // Identity transform
        let transform = [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];
        let color = [1.0, 0.0, 0.0, 1.0];

        geom.add_instance(100, &transform, color);
        geom.add_instance(101, &transform, color);

        assert_eq!(geom.instance_count(), 2);
        assert_eq!(geom.vertex_count(), 3);
        assert_eq!(geom.triangle_count(), 1);
    }
}
