// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! JavaScript API for IFC-Lite
//!
//! Modern async/await API for parsing IFC files.

use crate::gpu_geometry::{GpuGeometry, GpuInstancedGeometry, GpuInstancedGeometryCollection};
use crate::zero_copy::{
    InstanceData, InstancedGeometry, InstancedMeshCollection, MeshCollection, MeshDataJs,
    SymbolicRepresentationCollection, ZeroCopyMesh,
};
use ifc_lite_core::{EntityScanner, GeoReference, ParseEvent, RtcOffset, StreamConfig};
use js_sys::{Function, Promise};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;

/// Georeferencing information exposed to JavaScript
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct GeoReferenceJs {
    /// CRS name (e.g., "EPSG:32632")
    #[wasm_bindgen(skip)]
    pub crs_name: Option<String>,
    /// Eastings (X offset)
    pub eastings: f64,
    /// Northings (Y offset)
    pub northings: f64,
    /// Orthogonal height (Z offset)
    pub orthogonal_height: f64,
    /// X-axis abscissa (cos of rotation)
    pub x_axis_abscissa: f64,
    /// X-axis ordinate (sin of rotation)
    pub x_axis_ordinate: f64,
    /// Scale factor
    pub scale: f64,
}

#[wasm_bindgen]
impl GeoReferenceJs {
    /// Get CRS name
    #[wasm_bindgen(getter, js_name = crsName)]
    pub fn crs_name(&self) -> Option<String> {
        self.crs_name.clone()
    }

    /// Get rotation angle in radians
    #[wasm_bindgen(getter)]
    pub fn rotation(&self) -> f64 {
        self.x_axis_ordinate.atan2(self.x_axis_abscissa)
    }

    /// Transform local coordinates to map coordinates
    #[wasm_bindgen(js_name = localToMap)]
    pub fn local_to_map(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
        let cos_r = self.x_axis_abscissa;
        let sin_r = self.x_axis_ordinate;
        let s = self.scale;

        let e = s * (cos_r * x - sin_r * y) + self.eastings;
        let n = s * (sin_r * x + cos_r * y) + self.northings;
        let h = z + self.orthogonal_height;

        vec![e, n, h]
    }

    /// Transform map coordinates to local coordinates
    #[wasm_bindgen(js_name = mapToLocal)]
    pub fn map_to_local(&self, e: f64, n: f64, h: f64) -> Vec<f64> {
        let cos_r = self.x_axis_abscissa;
        let sin_r = self.x_axis_ordinate;
        let inv_scale = if self.scale.abs() < f64::EPSILON {
            1.0
        } else {
            1.0 / self.scale
        };

        let dx = e - self.eastings;
        let dy = n - self.northings;

        let x = inv_scale * (cos_r * dx + sin_r * dy);
        let y = inv_scale * (-sin_r * dx + cos_r * dy);
        let z = h - self.orthogonal_height;

        vec![x, y, z]
    }

    /// Get 4x4 transformation matrix (column-major for WebGL)
    #[wasm_bindgen(js_name = toMatrix)]
    pub fn to_matrix(&self) -> Vec<f64> {
        let cos_r = self.x_axis_abscissa;
        let sin_r = self.x_axis_ordinate;
        let s = self.scale;

        vec![
            s * cos_r,
            s * sin_r,
            0.0,
            0.0,
            -s * sin_r,
            s * cos_r,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            self.eastings,
            self.northings,
            self.orthogonal_height,
            1.0,
        ]
    }
}

impl From<GeoReference> for GeoReferenceJs {
    fn from(geo: GeoReference) -> Self {
        Self {
            crs_name: geo.crs_name,
            eastings: geo.eastings,
            northings: geo.northings,
            orthogonal_height: geo.orthogonal_height,
            x_axis_abscissa: geo.x_axis_abscissa,
            x_axis_ordinate: geo.x_axis_ordinate,
            scale: geo.scale,
        }
    }
}

/// RTC offset information exposed to JavaScript
#[wasm_bindgen]
#[derive(Debug, Clone, Default)]
pub struct RtcOffsetJs {
    /// X offset (subtracted from positions)
    pub x: f64,
    /// Y offset
    pub y: f64,
    /// Z offset
    pub z: f64,
}

#[wasm_bindgen]
impl RtcOffsetJs {
    /// Check if offset is significant (>10km)
    #[wasm_bindgen(js_name = isSignificant)]
    pub fn is_significant(&self) -> bool {
        const THRESHOLD: f64 = 10000.0;
        self.x.abs() > THRESHOLD || self.y.abs() > THRESHOLD || self.z.abs() > THRESHOLD
    }

    /// Convert local coordinates to world coordinates
    #[wasm_bindgen(js_name = toWorld)]
    pub fn to_world(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
        vec![x + self.x, y + self.y, z + self.z]
    }
}

impl From<RtcOffset> for RtcOffsetJs {
    fn from(offset: RtcOffset) -> Self {
        Self {
            x: offset.x,
            y: offset.y,
            z: offset.z,
        }
    }
}

/// Statistics tracking for geometry parsing
#[derive(Default)]
struct GeometryStats {
    total: u32,
    success: u32,
    decode_failed: u32,
    no_representation: u32,
    process_failed: u32,
    empty_mesh: u32,
    outlier_filtered: u32,
}

/// Mesh collection with RTC offset for large coordinates
#[wasm_bindgen]
pub struct MeshCollectionWithRtc {
    meshes: MeshCollection,
    rtc_offset: RtcOffsetJs,
}

#[wasm_bindgen]
impl MeshCollectionWithRtc {
    /// Get the mesh collection
    #[wasm_bindgen(getter)]
    pub fn meshes(&self) -> MeshCollection {
        self.meshes.clone()
    }

    /// Get the RTC offset
    #[wasm_bindgen(getter, js_name = rtcOffset)]
    pub fn rtc_offset(&self) -> RtcOffsetJs {
        self.rtc_offset.clone()
    }

    /// Get number of meshes
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.meshes.len()
    }

    /// Get mesh at index
    pub fn get(&self, index: usize) -> Option<MeshDataJs> {
        self.meshes.get(index)
    }
}

/// Main IFC-Lite API
#[wasm_bindgen]
pub struct IfcAPI {
    initialized: bool,
}

#[wasm_bindgen]
impl IfcAPI {
    /// Create and initialize the IFC API
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        Self { initialized: true }
    }

    /// Check if API is initialized
    #[wasm_bindgen(getter)]
    pub fn is_ready(&self) -> bool {
        self.initialized
    }

    /// Parse IFC file with streaming events
    /// Calls the callback function for each parse event
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// await api.parseStreaming(ifcData, (event) => {
    ///   console.log('Event:', event);
    /// });
    /// ```
    #[wasm_bindgen(js_name = parseStreaming)]
    pub fn parse_streaming(&self, content: String, callback: Function) -> Promise {
        use futures_util::StreamExt;

        let promise = Promise::new(&mut |resolve, reject| {
            let content = content.clone();
            let callback = callback.clone();
            let reject = reject.clone();
            spawn_local(async move {
                let config = StreamConfig::default();
                let mut stream = ifc_lite_core::parse_stream(&content, config);

                while let Some(event) = stream.next().await {
                    // Convert event to JsValue and call callback
                    let event_obj = parse_event_to_js(&event);
                    if let Err(e) = callback.call1(&JsValue::NULL, &event_obj) {
                        let _ = reject.call1(&JsValue::NULL, &e);
                        return;
                    }

                    // Check if this is the completion event
                    if matches!(event, ParseEvent::Completed { .. }) {
                        if let Err(e) = resolve.call0(&JsValue::NULL) {
                            let _ = reject.call1(&JsValue::NULL, &e);
                        }
                        return;
                    }
                }

                if let Err(e) = resolve.call0(&JsValue::NULL) {
                    let _ = reject.call1(&JsValue::NULL, &e);
                }
            });
        });

        promise
    }

    /// Parse IFC file (traditional - waits for completion)
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const result = await api.parse(ifcData);
    /// console.log('Entities:', result.entityCount);
    /// ```
    #[wasm_bindgen]
    pub fn parse(&self, content: String) -> Promise {
        let promise = Promise::new(&mut |resolve, reject| {
            let content = content.clone();
            let reject = reject.clone();
            spawn_local(async move {
                // Quick scan to get entity count
                let mut scanner = EntityScanner::new(&content);
                let counts = scanner.count_by_type();

                let total_entities: usize = counts.values().sum();

                // Create result object
                let result = js_sys::Object::new();
                set_js_prop(&result, "entityCount", &JsValue::from_f64(total_entities as f64));
                set_js_prop(&result, "entityTypes", &counts_to_js(&counts));

                if let Err(e) = resolve.call1(&JsValue::NULL, &result) {
                    let _ = reject.call1(&JsValue::NULL, &e);
                }
            });
        });

        promise
    }

    /// Parse IFC file with zero-copy mesh data
    /// Maximum performance - returns mesh with direct memory access
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const mesh = await api.parseZeroCopy(ifcData);
    ///
    /// // Create TypedArray views (NO COPYING!)
    /// const memory = await api.getMemory();
    /// const positions = new Float32Array(
    ///   memory.buffer,
    ///   mesh.positions_ptr,
    ///   mesh.positions_len
    /// );
    ///
    /// // Upload directly to GPU
    /// gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    /// ```
    #[wasm_bindgen(js_name = parseZeroCopy)]
    pub fn parse_zero_copy(&self, content: String) -> ZeroCopyMesh {
        // Parse IFC file and generate geometry with optimized processing
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter, Mesh};

        // Build entity index once upfront for O(1) lookups
        let entity_index = build_entity_index(&content);

        // Create scanner and decoder with pre-built index
        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index);

        // Create geometry router (reuses processor instances)
        let router = GeometryRouter::with_units(&content, &mut decoder);

        // Collect all meshes first (better for batch merge)
        let mut meshes: Vec<Mesh> = Vec::with_capacity(2000);

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            // Decode and process the entity
            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                if let Ok(mesh) = router.process_element(&entity, &mut decoder) {
                    if !mesh.is_empty() {
                        meshes.push(mesh);
                    }
                }
            }
        }

        // Batch merge all meshes at once (more efficient)
        let mut combined_mesh = Mesh::new();
        combined_mesh.merge_all(&meshes);

        // Calculate normals if not present
        if combined_mesh.normals.len() != combined_mesh.positions.len() {
            calculate_normals(&mut combined_mesh);
        }

        ZeroCopyMesh::from(combined_mesh)
    }

    /// Parse IFC file and return individual meshes with express IDs and colors
    /// This matches the MeshData[] format expected by the viewer
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const collection = api.parseMeshes(ifcData);
    /// for (let i = 0; i < collection.length; i++) {
    ///   const mesh = collection.get(i);
    ///   console.log('Express ID:', mesh.expressId);
    ///   console.log('Positions:', mesh.positions);
    ///   console.log('Color:', mesh.color);
    /// }
    /// ```

    #[wasm_bindgen(js_name = parseMeshes)]
    pub fn parse_meshes(&self, content: String) -> MeshCollection {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter};

        // Build entity index once upfront for O(1) lookups
        let entity_index = build_entity_index(&content);

        // Create decoder with pre-built index
        let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

        // Build style index: first map geometry IDs to colors, then map element IDs to colors
        let geometry_styles = build_geometry_style_index(&content, &mut decoder);
        let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

        // OPTIMIZATION: Collect all FacetedBrep IDs for batch processing
        // Also build void relationship index (host → openings)
        let mut scanner = EntityScanner::new(&content);
        let mut faceted_brep_ids: Vec<u32> = Vec::new();
        let mut void_index: rustc_hash::FxHashMap<u32, Vec<u32>> = rustc_hash::FxHashMap::default();

        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if type_name == "IFCFACETEDBREP" {
                faceted_brep_ids.push(id);
            } else if type_name == "IFCRELVOIDSELEMENT" {
                // IfcRelVoidsElement: Attr 4 = RelatingBuildingElement, Attr 5 = RelatedOpeningElement
                if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                    if let (Some(host_id), Some(opening_id)) =
                        (entity.get_ref(4), entity.get_ref(5))
                    {
                        void_index.entry(host_id).or_default().push(opening_id);
                    }
                }
            }
        }

        // Create geometry router (without RTC offset initially)
        let mut router = GeometryRouter::with_units(&content, &mut decoder);

        // DETECT RTC OFFSET from actual building element transforms
        // This is more reliable than scanning cartesian points because it uses
        // the actual transform chain (which accumulates to world coordinates)
        let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
        let needs_shift = rtc_offset.0.abs() > 10000.0
            || rtc_offset.1.abs() > 10000.0
            || rtc_offset.2.abs() > 10000.0;

        if needs_shift {
            router.set_rtc_offset(rtc_offset);
        }

        // Batch preprocess FacetedBrep entities for maximum parallelism
        // This triangulates ALL faces from ALL BREPs in one parallel batch
        if !faceted_brep_ids.is_empty() {
            router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
        }

        // Reset scanner for main processing pass
        scanner = EntityScanner::new(&content);

        // Estimate capacity: typical IFC files have ~5-10% building elements
        let estimated_elements = content.len() / 500;
        let mut mesh_collection = MeshCollection::with_capacity(estimated_elements);

        // Store RTC offset in collection for JavaScript to use (for camera/world coordinate display)
        if needs_shift {
            mesh_collection.set_rtc_offset(rtc_offset.0, rtc_offset.1, rtc_offset.2);
        }

        // Extract building rotation from IfcSite's top-level placement
        let building_rotation = extract_building_rotation(&content, &mut decoder);
        mesh_collection.set_building_rotation(building_rotation);

        // Track geometry parsing statistics
        let mut stats = GeometryStats::default();

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            stats.total += 1;

            // Decode and process the entity
            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                // Check if entity actually has representation (attribute index 6 for IfcProduct)
                let has_representation = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                if !has_representation {
                    stats.no_representation += 1;
                    continue;
                }

                // Use process_element_with_voids for ALL elements (simplified from separate paths)
                // This ensures RTC offset is consistently applied via transform_mesh
                
                match router.process_element_with_voids(&entity, &mut decoder, &void_index) {
                Err(e) => {
                    // Log the specific error for debugging
                    web_sys::console::warn_1(&format!(
                        "[IFC-LITE] Failed to process #{} ({}): {}",
                        id, entity.ifc_type.name(), e
                    ).into());
                    stats.process_failed += 1;
                }
                Ok(mut mesh) => {
                    if !mesh.is_empty() {
                        // Calculate normals if not present or incomplete
                        // CSG operations may produce partial normals, so check for matching count
                        if mesh.normals.len() != mesh.positions.len() {
                            calculate_normals(&mut mesh);
                        }

                        // Try to get color from style index, otherwise use default
                        let color = style_index
                            .get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        // Safety filter: exclude meshes with unreasonable coordinates after RTC
                        const MAX_REASONABLE_OFFSET: f32 = 50_000.0; // 50km from RTC center
                        let mut max_coord = 0.0f32;
                        let mut outlier_vertex_count = 0;
                        let mut has_non_finite = false;

                        for chunk in mesh.positions.chunks_exact(3) {
                            let x = chunk[0];
                            let y = chunk[1];
                            let z = chunk[2];

                            // Check for NaN/inf coordinates - treat as outliers
                            if !x.is_finite() || !y.is_finite() || !z.is_finite() {
                                outlier_vertex_count += 1;
                                has_non_finite = true;
                                continue; // Don't update max_coord with non-finite values
                            }

                            let coord_mag = x.abs().max(y.abs()).max(z.abs());
                            max_coord = max_coord.max(coord_mag);
                            if coord_mag > MAX_REASONABLE_OFFSET {
                                outlier_vertex_count += 1;
                            }
                        }

                        // Warn about non-finite coordinates
                        if has_non_finite {
                            web_sys::console::warn_1(&format!(
                                "[WASM FILTER] Mesh #{} ({}) contains NaN/Inf coordinates",
                                id, entity.ifc_type.name()
                            ).into());
                        }

                        // Skip meshes where >90% of vertices are outliers (likely corrupted)
                        let total_vertices = mesh.positions.len() / 3;
                        let outlier_ratio = if total_vertices > 0 {
                            outlier_vertex_count as f32 / total_vertices as f32
                        } else {
                            0.0
                        };

                        // Only filter if >90% outliers OR if max coord is extremely large (>200km)
                        if outlier_ratio > 0.9 || max_coord > MAX_REASONABLE_OFFSET * 4.0 {
                            web_sys::console::warn_1(&format!(
                                "[WASM FILTER] Excluding mesh #{} ({}) - {:.1}% outliers, max coord: {:.2}m",
                                id, entity.ifc_type.name(), outlier_ratio * 100.0, max_coord
                            ).into());
                            stats.outlier_filtered += 1;
                            continue; // Skip this mesh
                        }

                        // Create mesh data with express ID, IFC type, and color
                        let ifc_type_name = entity.ifc_type.name().to_string();
                        let mesh_data = MeshDataJs::new(id, ifc_type_name, mesh, color);
                        mesh_collection.add(mesh_data);
                        stats.success += 1;
                    } else {
                        stats.empty_mesh += 1;
                    }
                }
                }
            } else {
                stats.decode_failed += 1;
            }
        }

        // Emit warning if significant failures occurred
        if stats.total > 0 {
            let success_rate = stats.success as f64 / stats.total as f64;
            if success_rate < 0.5 {
                web_sys::console::warn_1(&format!(
                    "[IFC-LITE] Low geometry success rate: {:.1}% ({}/{} elements). \
                     Decode failed: {}, No representation: {}, Process failed: {}, Empty: {}, Filtered: {}",
                    success_rate * 100.0, stats.success, stats.total,
                    stats.decode_failed, stats.no_representation, stats.process_failed,
                    stats.empty_mesh, stats.outlier_filtered
                ).into());
            }
        }

        mesh_collection
    }

    /// Parse IFC file and return instanced geometry grouped by geometry hash
    /// This reduces draw calls by grouping identical geometries with different transforms
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const collection = api.parseMeshesInstanced(ifcData);
    /// for (let i = 0; i < collection.length; i++) {
    ///   const geometry = collection.get(i);
    ///   console.log('Geometry ID:', geometry.geometryId);
    ///   console.log('Instances:', geometry.instanceCount);
    ///   for (let j = 0; j < geometry.instanceCount; j++) {
    ///     const inst = geometry.getInstance(j);
    ///     console.log('  Express ID:', inst.expressId);
    ///     console.log('  Transform:', inst.transform);
    ///   }
    /// }
    /// ```
    #[wasm_bindgen(js_name = parseMeshesInstanced)]
    pub fn parse_meshes_instanced(&self, content: String) -> InstancedMeshCollection {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter, Mesh};
        use rustc_hash::FxHashMap;
        use rustc_hash::FxHasher;
        use std::hash::{Hash, Hasher};

        // Build entity index once upfront for O(1) lookups
        let entity_index = build_entity_index(&content);

        // Create decoder with pre-built index
        let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

        // Build style index: first map geometry IDs to colors, then map element IDs to colors
        let geometry_styles = build_geometry_style_index(&content, &mut decoder);
        let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

        // OPTIMIZATION: Collect all FacetedBrep IDs for batch processing
        let mut scanner = EntityScanner::new(&content);
        let mut faceted_brep_ids: Vec<u32> = Vec::new();
        while let Some((id, type_name, _, _)) = scanner.next_entity() {
            if type_name == "IFCFACETEDBREP" {
                faceted_brep_ids.push(id);
            }
        }

        // Create geometry router (reuses processor instances)
        let router = GeometryRouter::with_units(&content, &mut decoder);

        // Batch preprocess FacetedBrep entities for maximum parallelism
        if !faceted_brep_ids.is_empty() {
            router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
        }

        // Reset scanner for main processing pass
        scanner = EntityScanner::new(&content);

        // Group meshes by geometry hash
        // Key: geometry hash, Value: (base mesh, Vec<(express_id, transform, color)>)
        // Note: transform is returned as Matrix4<f64> from process_element_with_transform
        #[allow(clippy::type_complexity)]
        let mut geometry_groups: FxHashMap<u64, (Mesh, Vec<(u32, [f64; 16], [f32; 4])>)> =
            FxHashMap::default();

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            // Decode and process the entity
            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                if let Ok((mut mesh, transform)) =
                    router.process_element_with_transform(&entity, &mut decoder)
                {
                    if !mesh.is_empty() {
                        // Calculate normals if not present or incomplete
                        // CSG operations may produce partial normals, so check for matching count
                        if mesh.normals.len() != mesh.positions.len() {
                            calculate_normals(&mut mesh);
                        }

                        // Compute geometry hash (same as router does)
                        let mut hasher = FxHasher::default();
                        mesh.positions.len().hash(&mut hasher);
                        mesh.indices.len().hash(&mut hasher);
                        for pos in &mesh.positions {
                            pos.to_bits().hash(&mut hasher);
                        }
                        for idx in &mesh.indices {
                            idx.hash(&mut hasher);
                        }
                        let geometry_hash = hasher.finish();

                        // Try to get color from style index, otherwise use default
                        let color = style_index
                            .get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        // Convert Matrix4<f64> to [f64; 16] array (column-major for WebGPU)
                        let mut transform_array = [0.0; 16];
                        for col in 0..4 {
                            for row in 0..4 {
                                transform_array[col * 4 + row] = transform[(row, col)];
                            }
                        }

                        // Add to group - only store mesh once per hash
                        let entry = geometry_groups.entry(geometry_hash);
                        match entry {
                            std::collections::hash_map::Entry::Occupied(mut o) => {
                                // Geometry already exists, just add instance
                                o.get_mut().1.push((id, transform_array, color));
                            }
                            std::collections::hash_map::Entry::Vacant(v) => {
                                // First instance of this geometry
                                v.insert((mesh, vec![(id, transform_array, color)]));
                            }
                        }
                    }
                }
            }
        }

        // Convert groups to InstancedGeometry
        let mut collection = InstancedMeshCollection::new();
        for (geometry_id, (mesh, instances)) in geometry_groups {
            let mut instanced_geom =
                InstancedGeometry::new(geometry_id, mesh.positions, mesh.normals, mesh.indices);

            // Convert transforms from [f64; 16] to Vec<f32>
            for (express_id, transform_array, color) in instances {
                let mut transform_f32 = Vec::with_capacity(16);
                for val in transform_array.iter() {
                    transform_f32.push(*val as f32);
                }
                instanced_geom.add_instance(InstanceData::new(express_id, transform_f32, color));
            }

            collection.add(instanced_geom);
        }

        collection
    }

    /// Parse IFC file with streaming instanced geometry batches for progressive rendering
    /// Groups identical geometries and yields batches of InstancedGeometry
    /// Uses fast-first-frame streaming: simple geometry (walls, slabs) first
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// await api.parseMeshesInstancedAsync(ifcData, {
    ///   batchSize: 25,  // Number of unique geometries per batch
    ///   onBatch: (geometries, progress) => {
    ///     for (const geom of geometries) {
    ///       renderer.addInstancedGeometry(geom);
    ///     }
    ///   },
    ///   onComplete: (stats) => {
    ///     console.log(`Done! ${stats.totalGeometries} unique geometries, ${stats.totalInstances} instances`);
    ///   }
    /// });
    /// ```
    #[wasm_bindgen(js_name = parseMeshesInstancedAsync)]
    pub fn parse_meshes_instanced_async(&self, content: String, options: JsValue) -> Promise {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter, Mesh};
        use rustc_hash::{FxHashMap, FxHasher};
        use std::hash::{Hash, Hasher};

        let promise = Promise::new(&mut |resolve, _reject| {
            let content = content.clone();
            let options = options.clone();

            spawn_local(async move {
                // Parse options
                let batch_size: usize = js_sys::Reflect::get(&options, &"batchSize".into())
                    .ok()
                    .and_then(|v| v.as_f64())
                    .map(|v| v as usize)
                    .unwrap_or(25); // Batch size = number of unique geometries per batch

                let on_batch = js_sys::Reflect::get(&options, &"onBatch".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                let on_complete = js_sys::Reflect::get(&options, &"onComplete".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                // Build entity index once upfront for O(1) lookups
                let entity_index = build_entity_index(&content);
                let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

                // Build style index
                let geometry_styles = build_geometry_style_index(&content, &mut decoder);
                let style_index =
                    build_element_style_index(&content, &geometry_styles, &mut decoder);

                // Collect FacetedBrep IDs for batch preprocessing
                let mut scanner = EntityScanner::new(&content);
                let mut faceted_brep_ids: Vec<u32> = Vec::new();
                while let Some((id, type_name, _, _)) = scanner.next_entity() {
                    if type_name == "IFCFACETEDBREP" {
                        faceted_brep_ids.push(id);
                    }
                }

                // Create geometry router
                let router = GeometryRouter::with_units(&content, &mut decoder);

                // Batch preprocess FacetedBreps
                if !faceted_brep_ids.is_empty() {
                    router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
                }

                // Reset scanner for main processing
                scanner = EntityScanner::new(&content);

                // Group meshes by geometry hash (accumulated across batches)
                // Key: geometry hash, Value: (base mesh, Vec<(express_id, transform, color)>)
                #[allow(clippy::type_complexity)]
                let mut geometry_groups: FxHashMap<
                    u64,
                    (Mesh, Vec<(u32, [f64; 16], [f32; 4])>),
                > = FxHashMap::default();
                let mut processed = 0;
                let mut total_geometries = 0;
                let mut total_instances = 0;
                let mut deferred_complex: Vec<(u32, usize, usize, ifc_lite_core::IfcType)> =
                    Vec::new();

                // First pass - process simple geometry immediately
                while let Some((id, type_name, start, end)) = scanner.next_entity() {
                    if !ifc_lite_core::has_geometry_by_name(type_name) {
                        continue;
                    }

                    let ifc_type = ifc_lite_core::IfcType::from_str(type_name);

                    // Simple geometry: process immediately
                    if matches!(
                        type_name,
                        "IFCWALL"
                            | "IFCWALLSTANDARDCASE"
                            | "IFCSLAB"
                            | "IFCBEAM"
                            | "IFCCOLUMN"
                            | "IFCPLATE"
                            | "IFCROOF"
                            | "IFCCOVERING"
                            | "IFCFOOTING"
                            | "IFCRAILING"
                            | "IFCSTAIR"
                            | "IFCSTAIRFLIGHT"
                            | "IFCRAMP"
                            | "IFCRAMPFLIGHT"
                    ) {
                        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                            if let Ok((mut mesh, transform)) =
                                router.process_element_with_transform(&entity, &mut decoder)
                            {
                                if !mesh.is_empty() {
                                    if mesh.normals.is_empty() {
                                        calculate_normals(&mut mesh);
                                    }

                                    // Compute geometry hash (before transformation)
                                    let mut hasher = FxHasher::default();
                                    mesh.positions.len().hash(&mut hasher);
                                    mesh.indices.len().hash(&mut hasher);
                                    for pos in &mesh.positions {
                                        pos.to_bits().hash(&mut hasher);
                                    }
                                    for idx in &mesh.indices {
                                        idx.hash(&mut hasher);
                                    }
                                    let geometry_hash = hasher.finish();

                                    // Get color
                                    let color = style_index
                                        .get(&id)
                                        .copied()
                                        .unwrap_or_else(|| get_default_color_for_type(&ifc_type));

                                    // Convert Matrix4<f64> to [f64; 16] array (column-major for WebGPU)
                                    let mut transform_array = [0.0; 16];
                                    for col in 0..4 {
                                        for row in 0..4 {
                                            transform_array[col * 4 + row] = transform[(row, col)];
                                        }
                                    }

                                    // Add to group
                                    let entry = geometry_groups.entry(geometry_hash);
                                    match entry {
                                        std::collections::hash_map::Entry::Occupied(mut o) => {
                                            o.get_mut().1.push((id, transform_array, color));
                                            total_instances += 1;
                                        }
                                        std::collections::hash_map::Entry::Vacant(v) => {
                                            v.insert((mesh, vec![(id, transform_array, color)]));
                                            total_geometries += 1;
                                            total_instances += 1;
                                        }
                                    }
                                    processed += 1;
                                }
                            }
                        }

                        // Yield batch when we have enough unique geometries
                        if geometry_groups.len() >= batch_size {
                            let mut batch_geometries = Vec::new();
                            let mut geometries_to_remove = Vec::new();

                            // Convert groups to InstancedGeometry
                            for (geometry_id, (mesh, instances)) in geometry_groups.iter() {
                                let mut instanced_geom = InstancedGeometry::new(
                                    *geometry_id,
                                    mesh.positions.clone(),
                                    mesh.normals.clone(),
                                    mesh.indices.clone(),
                                );

                                for (express_id, transform_array, color) in instances.iter() {
                                    let mut transform_f32 = Vec::with_capacity(16);
                                    for val in transform_array.iter() {
                                        transform_f32.push(*val as f32);
                                    }
                                    instanced_geom.add_instance(InstanceData::new(
                                        *express_id,
                                        transform_f32,
                                        *color,
                                    ));
                                }

                                batch_geometries.push(instanced_geom);
                                geometries_to_remove.push(*geometry_id);
                            }

                            // Remove processed geometries from map
                            for geometry_id in geometries_to_remove {
                                geometry_groups.remove(&geometry_id);
                            }

                            // Yield batch
                            if let Some(ref callback) = on_batch {
                                let js_geometries = js_sys::Array::new();
                                for geom in batch_geometries {
                                    js_geometries.push(&geom.into());
                                }

                                let progress = js_sys::Object::new();
                                set_js_prop(&progress, "percent", &0u32.into());
                                set_js_prop(&progress, "processed", &(processed as f64).into());
                                set_js_prop(&progress, "phase", &"simple".into());

                                let _ = callback.call2(&JsValue::NULL, &js_geometries, &progress);
                            }

                            // Yield to browser
                            gloo_timers::future::TimeoutFuture::new(0).await;
                        }
                    } else {
                        // Defer complex geometry
                        deferred_complex.push((id, start, end, ifc_type));
                    }
                }

                // Flush remaining simple geometries
                if !geometry_groups.is_empty() {
                    let mut batch_geometries = Vec::new();
                    for (geometry_id, (mesh, instances)) in geometry_groups.drain() {
                        let mut instanced_geom = InstancedGeometry::new(
                            geometry_id,
                            mesh.positions,
                            mesh.normals,
                            mesh.indices,
                        );

                        for (express_id, transform_array, color) in instances {
                            let mut transform_f32 = Vec::with_capacity(16);
                            for val in transform_array.iter() {
                                transform_f32.push(*val as f32);
                            }
                            instanced_geom.add_instance(InstanceData::new(
                                express_id,
                                transform_f32,
                                color,
                            ));
                        }

                        batch_geometries.push(instanced_geom);
                    }

                    if let Some(ref callback) = on_batch {
                        let js_geometries = js_sys::Array::new();
                        for geom in batch_geometries {
                            js_geometries.push(&geom.into());
                        }

                        let progress = js_sys::Object::new();
                        set_js_prop(&progress, "phase", &"simple_complete".into());

                        let _ = callback.call2(&JsValue::NULL, &js_geometries, &progress);
                    }

                    gloo_timers::future::TimeoutFuture::new(0).await;
                }

                // Process deferred complex geometry
                let total_elements = processed + deferred_complex.len();
                for (id, start, end, ifc_type) in deferred_complex {
                    if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                        if let Ok((mut mesh, transform)) =
                            router.process_element_with_transform(&entity, &mut decoder)
                        {
                            if !mesh.is_empty() {
                                if mesh.normals.len() != mesh.positions.len() {
                                    calculate_normals(&mut mesh);
                                }

                                // Compute geometry hash
                                let mut hasher = FxHasher::default();
                                mesh.positions.len().hash(&mut hasher);
                                mesh.indices.len().hash(&mut hasher);
                                for pos in &mesh.positions {
                                    pos.to_bits().hash(&mut hasher);
                                }
                                for idx in &mesh.indices {
                                    idx.hash(&mut hasher);
                                }
                                let geometry_hash = hasher.finish();

                                // Get color
                                let color = style_index
                                    .get(&id)
                                    .copied()
                                    .unwrap_or_else(|| get_default_color_for_type(&ifc_type));

                                // Convert transform (column-major for WebGPU)
                                let mut transform_array = [0.0; 16];
                                for col in 0..4 {
                                    for row in 0..4 {
                                        transform_array[col * 4 + row] = transform[(row, col)];
                                    }
                                }

                                // Add to group
                                let entry = geometry_groups.entry(geometry_hash);
                                match entry {
                                    std::collections::hash_map::Entry::Occupied(mut o) => {
                                        o.get_mut().1.push((id, transform_array, color));
                                        total_instances += 1;
                                    }
                                    std::collections::hash_map::Entry::Vacant(v) => {
                                        v.insert((mesh, vec![(id, transform_array, color)]));
                                        total_geometries += 1;
                                        total_instances += 1;
                                    }
                                }
                                processed += 1;
                            }
                        }
                    }

                    // Yield batch when we have enough unique geometries
                    if geometry_groups.len() >= batch_size {
                        let mut batch_geometries = Vec::new();
                        let mut geometries_to_remove = Vec::new();

                        for (geometry_id, (mesh, instances)) in geometry_groups.iter() {
                            let mut instanced_geom = InstancedGeometry::new(
                                *geometry_id,
                                mesh.positions.clone(),
                                mesh.normals.clone(),
                                mesh.indices.clone(),
                            );

                            for (express_id, transform_array, color) in instances.iter() {
                                let mut transform_f32 = Vec::with_capacity(16);
                                for val in transform_array.iter() {
                                    transform_f32.push(*val as f32);
                                }
                                instanced_geom.add_instance(InstanceData::new(
                                    *express_id,
                                    transform_f32,
                                    *color,
                                ));
                            }

                            batch_geometries.push(instanced_geom);
                            geometries_to_remove.push(*geometry_id);
                        }

                        for geometry_id in geometries_to_remove {
                            geometry_groups.remove(&geometry_id);
                        }

                        if let Some(ref callback) = on_batch {
                            let js_geometries = js_sys::Array::new();
                            for geom in batch_geometries {
                                js_geometries.push(&geom.into());
                            }

                            let progress = js_sys::Object::new();
                            let percent = (processed as f64 / total_elements as f64 * 100.0) as u32;
                            set_js_prop(&progress, "percent", &percent.into());
                            set_js_prop(&progress, "processed", &(processed as f64).into());
                            set_js_prop(&progress, "total", &(total_elements as f64).into());
                            set_js_prop(&progress, "phase", &"complex".into());

                            let _ = callback.call2(&JsValue::NULL, &js_geometries, &progress);
                        }

                        gloo_timers::future::TimeoutFuture::new(0).await;
                    }
                }

                // Final flush
                if !geometry_groups.is_empty() {
                    let mut batch_geometries = Vec::new();
                    for (geometry_id, (mesh, instances)) in geometry_groups.drain() {
                        let mut instanced_geom = InstancedGeometry::new(
                            geometry_id,
                            mesh.positions,
                            mesh.normals,
                            mesh.indices,
                        );

                        for (express_id, transform_array, color) in instances {
                            let mut transform_f32 = Vec::with_capacity(16);
                            for val in transform_array.iter() {
                                transform_f32.push(*val as f32);
                            }
                            instanced_geom.add_instance(InstanceData::new(
                                express_id,
                                transform_f32,
                                color,
                            ));
                        }

                        batch_geometries.push(instanced_geom);
                    }

                    if let Some(ref callback) = on_batch {
                        let js_geometries = js_sys::Array::new();
                        for geom in batch_geometries {
                            js_geometries.push(&geom.into());
                        }

                        let progress = js_sys::Object::new();
                        set_js_prop(&progress, "percent", &100u32.into());
                        set_js_prop(&progress, "phase", &"complete".into());

                        let _ = callback.call2(&JsValue::NULL, &js_geometries, &progress);
                    }
                }

                // Call completion callback
                if let Some(ref callback) = on_complete {
                    let stats = js_sys::Object::new();
                    set_js_prop(&stats, "totalGeometries", &(total_geometries as f64).into());
                    set_js_prop(&stats, "totalInstances", &(total_instances as f64).into());
                    let _ = callback.call1(&JsValue::NULL, &stats);
                }

                let _ = resolve.call0(&JsValue::NULL);
            });
        });

        promise
    }

    /// Parse IFC file with streaming mesh batches for progressive rendering
    /// Calls the callback with batches of meshes, yielding to browser between batches
    ///
    /// Options:
    /// - `batchSize`: Number of meshes per batch (default: 25)
    /// - `onBatch(meshes, progress)`: Called for each batch of meshes
    /// - `onRtcOffset({x, y, z, hasRtc})`: Called early with RTC offset for camera/world setup
    /// - `onColorUpdate(Map<id, color>)`: Called with style updates after initial render
    /// - `onComplete(stats)`: Called when parsing completes with stats including rtcOffset
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// await api.parseMeshesAsync(ifcData, {
    ///   batchSize: 100,
    ///   onRtcOffset: (rtc) => {
    ///     if (rtc.hasRtc) {
    ///       // Model uses large coordinates - adjust camera/world origin
    ///       viewer.setWorldOffset(rtc.x, rtc.y, rtc.z);
    ///     }
    ///   },
    ///   onBatch: (meshes, progress) => {
    ///     for (const mesh of meshes) {
    ///       scene.add(createThreeMesh(mesh));
    ///     }
    ///     console.log(`Progress: ${progress.percent}%`);
    ///   },
    ///   onComplete: (stats) => {
    ///     console.log(`Done! ${stats.totalMeshes} meshes`);
    ///     // stats.rtcOffset also available here: {x, y, z, hasRtc}
    ///   }
    /// });
    /// ```
    #[wasm_bindgen(js_name = parseMeshesAsync)]
    pub fn parse_meshes_async(&self, content: String, options: JsValue) -> Promise {
        use ifc_lite_core::{EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter};

        let promise = Promise::new(&mut |resolve, _reject| {
            let content = content.clone();
            let options = options.clone();

            spawn_local(async move {
                // Parse options - smaller default batch size for faster first frame
                let batch_size: usize = js_sys::Reflect::get(&options, &"batchSize".into())
                    .ok()
                    .and_then(|v| v.as_f64())
                    .map(|v| v as usize)
                    .unwrap_or(25); // Reduced from 50 for faster first frame

                let on_batch = js_sys::Reflect::get(&options, &"onBatch".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                let on_complete = js_sys::Reflect::get(&options, &"onComplete".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                let on_color_update = js_sys::Reflect::get(&options, &"onColorUpdate".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                let on_rtc_offset = js_sys::Reflect::get(&options, &"onRtcOffset".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                // Build entity index for lookups
                let entity_index = ifc_lite_core::build_entity_index(&content);
                let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

                // OPTIMIZATION: Defer style building for faster first frame
                // Simple geometry will use default colors initially, styles applied to complex geometry
                // This trades slightly incorrect initial colors for much faster first render
                let mut style_index: rustc_hash::FxHashMap<u32, [f32; 4]> =
                    rustc_hash::FxHashMap::default();

                // Create geometry router
                let mut router = GeometryRouter::with_units(&content, &mut decoder);

                // DETECT RTC OFFSET from actual building element transforms (same as sync version)
                let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
                let needs_shift = rtc_offset.0.abs() > 10000.0
                    || rtc_offset.1.abs() > 10000.0
                    || rtc_offset.2.abs() > 10000.0;

                if needs_shift {
                    router.set_rtc_offset(rtc_offset);
                }

                // Surface RTC offset to JavaScript callers early so they can prepare camera/world state
                if let Some(ref callback) = on_rtc_offset {
                    let rtc_info = js_sys::Object::new();
                    set_js_prop(&rtc_info, "x", &rtc_offset.0.into());
                    set_js_prop(&rtc_info, "y", &rtc_offset.1.into());
                    set_js_prop(&rtc_info, "z", &rtc_offset.2.into());
                    set_js_prop(&rtc_info, "hasRtc", &needs_shift.into());
                    let _ = callback.call1(&JsValue::NULL, &rtc_info);
                }

                // Extract building rotation from IfcSite's top-level placement
                let building_rotation = extract_building_rotation(&content, &mut decoder);

                // Process counters
                let mut processed = 0;
                let mut total_meshes = 0;
                let mut total_vertices = 0;
                let mut total_triangles = 0;
                let mut batch_meshes: Vec<MeshDataJs> = Vec::with_capacity(batch_size);
                // Track processed simple geometry IDs for color updates
                let mut processed_simple_ids: Vec<u32> = Vec::new();

                // PRE-PASS: Build void relationship index (host → openings)
                let mut scanner = EntityScanner::new(&content);
                let mut faceted_brep_ids: Vec<u32> = Vec::new();
                let mut void_index: rustc_hash::FxHashMap<u32, Vec<u32>> =
                    rustc_hash::FxHashMap::default();

                while let Some((id, type_name, start, end)) = scanner.next_entity() {
                    if type_name == "IFCFACETEDBREP" {
                        faceted_brep_ids.push(id);
                    } else if type_name == "IFCRELVOIDSELEMENT" {
                        // IfcRelVoidsElement: Attr 4 = RelatingBuildingElement, Attr 5 = RelatedOpeningElement
                        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                            if let (Some(host_id), Some(opening_id)) =
                                (entity.get_ref(4), entity.get_ref(5))
                            {
                                void_index.entry(host_id).or_default().push(opening_id);
                            }
                        }
                    }
                }

                // PROCESS PASS: Process elements with void subtraction
                let mut scanner = EntityScanner::new(&content);
                let mut deferred_complex: Vec<(u32, usize, usize, ifc_lite_core::IfcType)> =
                    Vec::new();

                // Process elements - simple geometry immediately, defer complex
                while let Some((id, type_name, start, end)) = scanner.next_entity() {
                    if !ifc_lite_core::has_geometry_by_name(type_name) {
                        continue;
                    }

                    let ifc_type = ifc_lite_core::IfcType::from_str(type_name);

                    // Simple geometry: process immediately
                    if matches!(
                        type_name,
                        "IFCWALL"
                            | "IFCWALLSTANDARDCASE"
                            | "IFCSLAB"
                            | "IFCBEAM"
                            | "IFCCOLUMN"
                            | "IFCPLATE"
                            | "IFCROOF"
                            | "IFCCOVERING"
                            | "IFCFOOTING"
                            | "IFCRAILING"
                            | "IFCSTAIR"
                            | "IFCSTAIRFLIGHT"
                            | "IFCRAMP"
                            | "IFCRAMPFLIGHT"
                    ) {
                        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                            // Check if entity actually has representation
                            let has_representation =
                                entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                            if has_representation {
                                // #endregion
                                
                                // Use process_element_with_voids to subtract openings
                                if let Ok(mut mesh) = router.process_element_with_voids(
                                    &entity,
                                    &mut decoder,
                                    &void_index,
                                ) {
                                    // #endregion
                                    
                                    if !mesh.is_empty() {
                                        if mesh.normals.len() != mesh.positions.len() {
                                            calculate_normals(&mut mesh);
                                        }

                                        let color = style_index
                                            .get(&id)
                                            .copied()
                                            .unwrap_or_else(|| get_default_color_for_type(&ifc_type));
                                        total_vertices += mesh.positions.len() / 3;
                                        total_triangles += mesh.indices.len() / 3;

                                        let ifc_type_name = ifc_type.name().to_string();
                                        let mesh_data =
                                            MeshDataJs::new(id, ifc_type_name, mesh, color);
                                        batch_meshes.push(mesh_data);
                                        processed_simple_ids.push(id);
                                        processed += 1;
                                    }
                                }
                            }
                        }

                        // Yield batch frequently for responsive UI
                        if batch_meshes.len() >= batch_size {
                            if let Some(ref callback) = on_batch {
                                let js_meshes = js_sys::Array::new();
                                for mesh in batch_meshes.drain(..) {
                                    js_meshes.push(&mesh.into());
                                }

                                let progress = js_sys::Object::new();
                                set_js_prop(&progress, "percent", &0u32.into());
                                set_js_prop(&progress, "processed", &(processed as f64).into());
                                set_js_prop(&progress, "phase", &"simple".into());

                                let _ = callback.call2(&JsValue::NULL, &js_meshes, &progress);
                                total_meshes += js_meshes.length() as usize;
                            }

                            // Yield to browser
                            gloo_timers::future::TimeoutFuture::new(0).await;
                        }
                    } else {
                        // Defer complex geometry
                        deferred_complex.push((id, start, end, ifc_type));
                    }
                }

                // Flush remaining simple elements
                if !batch_meshes.is_empty() {
                    if let Some(ref callback) = on_batch {
                        let js_meshes = js_sys::Array::new();
                        for mesh in batch_meshes.drain(..) {
                            js_meshes.push(&mesh.into());
                        }

                        let progress = js_sys::Object::new();
                        set_js_prop(&progress, "phase", &"simple_complete".into());

                        let _ = callback.call2(&JsValue::NULL, &js_meshes, &progress);
                        total_meshes += js_meshes.length() as usize;
                    }

                    gloo_timers::future::TimeoutFuture::new(0).await;
                }

                let total_elements = processed + deferred_complex.len();

                // NOW build styles - after first batches are yielded for faster first frame
                // Complex geometry will have proper IFC colors
                let geometry_styles = build_geometry_style_index(&content, &mut decoder);
                style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

                // Send color updates for already-processed simple geometry
                if let Some(ref callback) = on_color_update {
                    let color_updates = js_sys::Map::new();
                    for &id in &processed_simple_ids {
                        if let Some(&color) = style_index.get(&id) {
                            // Convert [f32; 4] to JS array
                            let js_color = js_sys::Array::new();
                            js_color.push(&color[0].into());
                            js_color.push(&color[1].into());
                            js_color.push(&color[2].into());
                            js_color.push(&color[3].into());
                            color_updates.set(&(id as f64).into(), &js_color);
                        }
                    }
                    if color_updates.size() > 0 {
                        let _ = callback.call1(&JsValue::NULL, &color_updates);
                    }
                }

                // CRITICAL: Batch preprocess FacetedBreps BEFORE complex phase
                // This triangulates ALL faces in parallel - massive speedup for repeated geometry
                if !faceted_brep_ids.is_empty() {
                    router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
                }

                // Process deferred complex geometry with proper styles and void subtraction

                for (id, start, end, ifc_type) in deferred_complex {
                    if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                        let has_openings = void_index.contains_key(&id);
                        let ifc_type_name = ifc_type.name().to_string();
                        let default_color = get_default_color_for_type(&ifc_type);

                        if has_openings {
                            // Element has openings - use void subtraction (merged mesh)
                            if let Ok(mut mesh) = router.process_element_with_voids(
                                &entity,
                                &mut decoder,
                                &void_index,
                            ) {
                                if !mesh.is_empty() {
                                    if mesh.normals.is_empty() {
                                        calculate_normals(&mut mesh);
                                    }

                                    let color = style_index
                                        .get(&id)
                                        .copied()
                                        .unwrap_or(default_color);

                                    total_vertices += mesh.positions.len() / 3;
                                    total_triangles += mesh.indices.len() / 3;

                                    let mesh_data = MeshDataJs::new(id, ifc_type_name, mesh, color);
                                    batch_meshes.push(mesh_data);
                                }
                            }
                        } else {
                            // No openings - try sub-mesh approach for per-item colors
                            // Skip submesh approach for IfcSite (terrain) - use process_element
                            // which correctly scales ObjectPlacement
                            let skip_submesh = matches!(ifc_type, ifc_lite_core::IfcType::IfcSite);

                            let sub_meshes_result = if skip_submesh {
                                Err(ifc_lite_geometry::Error::geometry("Skip submesh for IfcSite".to_string()))
                            } else {
                                router.process_element_with_submeshes(&entity, &mut decoder)
                            };

                            let has_submeshes = sub_meshes_result
                                .as_ref()
                                .map(|s| !s.is_empty())
                                .unwrap_or(false);

                            if has_submeshes {
                                // Use sub-meshes for multi-material elements (windows, doors, etc.)
                                let sub_meshes = sub_meshes_result.unwrap();
                                for sub in sub_meshes.sub_meshes {
                                    let mut mesh = sub.mesh;
                                    if mesh.is_empty() {
                                        continue;
                                    }
                                    if mesh.normals.is_empty() {
                                        calculate_normals(&mut mesh);
                                    }

                                    // Look up color by geometry item ID (resolving MappedItem chains),
                                    // then by element ID, then default
                                    let color = find_color_for_geometry(sub.geometry_id, &geometry_styles, &mut decoder)
                                        .or_else(|| style_index.get(&id).copied())
                                        .unwrap_or(default_color);

                                    total_vertices += mesh.positions.len() / 3;
                                    total_triangles += mesh.indices.len() / 3;

                                    let mesh_data =
                                        MeshDataJs::new(id, ifc_type_name.clone(), mesh, color);
                                    batch_meshes.push(mesh_data);
                                }
                            } else {
                                // Fallback: use simple single-mesh approach
                                // This handles elements without IfcStyledItem references
                                if let Ok(mut mesh) = router.process_element(&entity, &mut decoder)
                                {
                                    if !mesh.is_empty() {
                                        if mesh.normals.len() != mesh.positions.len() {
                                            calculate_normals(&mut mesh);
                                        }

                                        let color = style_index
                                            .get(&id)
                                            .copied()
                                            .unwrap_or(default_color);

                                        total_vertices += mesh.positions.len() / 3;
                                        total_triangles += mesh.indices.len() / 3;

                                        let mesh_data =
                                            MeshDataJs::new(id, ifc_type_name, mesh, color);
                                        batch_meshes.push(mesh_data);
                                    }
                                }
                            }
                        }
                    }

                    processed += 1;

                    // Yield batch
                    if batch_meshes.len() >= batch_size {
                        if let Some(ref callback) = on_batch {
                            let js_meshes = js_sys::Array::new();
                            for mesh in batch_meshes.drain(..) {
                                js_meshes.push(&mesh.into());
                            }

                            let progress = js_sys::Object::new();
                            let percent = (processed as f64 / total_elements as f64 * 100.0) as u32;
                            set_js_prop(&progress, "percent", &percent.into());
                            set_js_prop(&progress, "processed", &(processed as f64).into());
                            set_js_prop(&progress, "total", &(total_elements as f64).into());
                            set_js_prop(&progress, "phase", &"complex".into());

                            let _ = callback.call2(&JsValue::NULL, &js_meshes, &progress);
                            total_meshes += js_meshes.length() as usize;
                        }

                        gloo_timers::future::TimeoutFuture::new(0).await;
                    }
                }

                // Final flush
                if !batch_meshes.is_empty() {
                    if let Some(ref callback) = on_batch {
                        let js_meshes = js_sys::Array::new();
                        for mesh in batch_meshes.drain(..) {
                            js_meshes.push(&mesh.into());
                        }

                        let progress = js_sys::Object::new();
                        set_js_prop(&progress, "percent", &100u32.into());
                        set_js_prop(&progress, "phase", &"complete".into());

                        let _ = callback.call2(&JsValue::NULL, &js_meshes, &progress);
                        total_meshes += js_meshes.length() as usize;
                    }
                }

                // Call completion callback
                if let Some(ref callback) = on_complete {
                    let stats = js_sys::Object::new();
                    set_js_prop(&stats, "totalMeshes", &(total_meshes as f64).into());
                    set_js_prop(&stats, "totalVertices", &(total_vertices as f64).into());
                    set_js_prop(&stats, "totalTriangles", &(total_triangles as f64).into());
                    // Include RTC offset info in completion stats
                    let rtc_info = js_sys::Object::new();
                    set_js_prop(&rtc_info, "x", &rtc_offset.0.into());
                    set_js_prop(&rtc_info, "y", &rtc_offset.1.into());
                    set_js_prop(&rtc_info, "z", &rtc_offset.2.into());
                    set_js_prop(&rtc_info, "hasRtc", &needs_shift.into());
                    set_js_prop(&stats, "rtcOffset", &rtc_info);
                    // Include building rotation in completion stats
                    if let Some(rotation) = building_rotation {
                        set_js_prop(&stats, "buildingRotation", &rotation.into());
                    }
                    let _ = callback.call1(&JsValue::NULL, &stats);
                }

                let _ = resolve.call0(&JsValue::NULL);
            });
        });

        promise
    }

    /// Get WASM memory for zero-copy access
    #[wasm_bindgen(js_name = getMemory)]
    pub fn get_memory(&self) -> JsValue {
        crate::zero_copy::get_memory()
    }

    /// Get version string
    #[wasm_bindgen(getter)]
    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    /// Fast entity scanning using SIMD-accelerated Rust scanner
    /// Returns array of entity references for data model parsing
    /// Much faster than TypeScript byte-by-byte scanning (5-10x speedup)
    #[wasm_bindgen(js_name = scanEntitiesFast)]
    pub fn scan_entities_fast(&self, content: &str) -> JsValue {
        use serde::{Deserialize, Serialize};
        use serde_wasm_bindgen::to_value;

        #[derive(Serialize, Deserialize)]
        struct EntityRefJs {
            express_id: u32,
            entity_type: String,
            byte_offset: usize,
            byte_length: usize,
            line_number: usize,
        }

        let mut scanner = EntityScanner::new(content);
        let mut refs = Vec::new();
        let bytes = content.as_bytes();
        
        // Track line numbers efficiently: count newlines up to each entity start
        let mut last_position = 0;
        let mut line_count = 1; // Start at line 1

        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Count newlines between last position and current start
            if start > last_position {
                line_count += bytes[last_position..start].iter().filter(|&&b| b == b'\n').count();
            }
            
            refs.push(EntityRefJs {
                express_id: id,
                entity_type: type_name.to_string(),
                byte_offset: start,
                byte_length: end - start,
                line_number: line_count,
            });
            
            last_position = end;
        }

        to_value(&refs).unwrap_or_else(|_| js_sys::Array::new().into())
    }

    /// Fast geometry-only entity scanning
    /// Scans only entities that have geometry, skipping 99% of non-geometry entities
    /// Returns array of geometry entity references for parallel processing
    /// Much faster than scanning all entities (3x speedup for large files)
    #[wasm_bindgen(js_name = scanGeometryEntitiesFast)]
    pub fn scan_geometry_entities_fast(&self, content: &str) -> JsValue {
        use serde::{Deserialize, Serialize};
        use serde_wasm_bindgen::to_value;

        #[derive(Serialize, Deserialize)]
        struct GeometryEntityRefJs {
            express_id: u32,
            entity_type: String,
            byte_offset: usize,
            byte_length: usize,
        }

        let mut scanner = EntityScanner::new(content);
        let mut refs = Vec::new();
        
        // Only scan entities that have geometry - skip IFCCARTESIANPOINT, IFCDIRECTION, etc.
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Fast filter: only process entities that can have geometry
            if ifc_lite_core::has_geometry_by_name(type_name) {
                refs.push(GeometryEntityRefJs {
                    express_id: id,
                    entity_type: type_name.to_string(),
                    byte_offset: start,
                    byte_length: end - start,
                });
            }
        }

        to_value(&refs).unwrap_or_else(|_| js_sys::Array::new().into())
    }

    /// Extract georeferencing information from IFC content
    /// Returns null if no georeferencing is present
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const georef = api.getGeoReference(ifcData);
    /// if (georef) {
    ///   console.log('CRS:', georef.crsName);
    ///   const [e, n, h] = georef.localToMap(10, 20, 5);
    /// }
    /// ```
    #[wasm_bindgen(js_name = getGeoReference)]
    pub fn get_geo_reference(&self, content: String) -> Option<GeoReferenceJs> {
        use ifc_lite_core::{
            build_entity_index, EntityDecoder, EntityScanner, GeoRefExtractor, IfcType,
        };

        // Build entity index and decoder
        let entity_index = build_entity_index(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index);

        // Collect entity types
        let mut scanner = EntityScanner::new(&content);
        let mut entity_types: Vec<(u32, IfcType)> = Vec::new();

        while let Some((id, type_name, _, _)) = scanner.next_entity() {
            let ifc_type = IfcType::from_str(type_name);
            entity_types.push((id, ifc_type));
        }

        // Extract georeferencing
        match GeoRefExtractor::extract(&mut decoder, &entity_types) {
            Ok(Some(georef)) => Some(GeoReferenceJs::from(georef)),
            _ => None,
        }
    }

    /// Parse IFC file and return mesh with RTC offset for large coordinates
    /// This handles georeferenced models by shifting to centroid
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const result = api.parseMeshesWithRtc(ifcData);
    /// const rtcOffset = result.rtcOffset;
    /// const meshes = result.meshes;
    ///
    /// // Convert local coords back to world:
    /// if (rtcOffset.isSignificant()) {
    ///   const [wx, wy, wz] = rtcOffset.toWorld(localX, localY, localZ);
    /// }
    /// ```
    #[wasm_bindgen(js_name = parseMeshesWithRtc)]
    pub fn parse_meshes_with_rtc(&self, content: String) -> MeshCollectionWithRtc {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner, RtcOffset};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter};

        // Build entity index once upfront
        let entity_index = build_entity_index(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

        // Build style indices
        let geometry_styles = build_geometry_style_index(&content, &mut decoder);
        let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

        // OPTIMIZATION: Collect all FacetedBrep IDs for batch processing
        let mut scanner = EntityScanner::new(&content);
        let mut faceted_brep_ids: Vec<u32> = Vec::new();
        while let Some((id, type_name, _, _)) = scanner.next_entity() {
            if type_name == "IFCFACETEDBREP" {
                faceted_brep_ids.push(id);
            }
        }

        let router = GeometryRouter::with_units(&content, &mut decoder);

        // Batch preprocess FacetedBrep entities for maximum parallelism
        if !faceted_brep_ids.is_empty() {
            router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
        }

        // Reset scanner for main processing pass
        scanner = EntityScanner::new(&content);

        let estimated_elements = content.len() / 500;
        let mut mesh_collection = MeshCollection::with_capacity(estimated_elements);

        // Collect all positions to calculate RTC offset
        let mut all_positions: Vec<f32> = Vec::with_capacity(100000);

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                // Check if entity actually has representation (attribute index 6 for IfcProduct)
                let has_representation = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                if !has_representation {
                    continue;
                }

                if let Ok(mut mesh) = router.process_element(&entity, &mut decoder) {
                    if !mesh.is_empty() {
                        if mesh.normals.is_empty() {
                            calculate_normals(&mut mesh);
                        }

                        // Collect positions for RTC calculation
                        all_positions.extend_from_slice(&mesh.positions);

                        let color = style_index
                            .get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        let ifc_type_name = entity.ifc_type.name().to_string();
                        let mesh_data = MeshDataJs::new(id, ifc_type_name, mesh, color);
                        mesh_collection.add(mesh_data);
                    }
                }
            }
        }

        // Calculate RTC offset from all positions
        let rtc_offset = RtcOffset::from_positions(&all_positions);
        let rtc_offset_js = RtcOffsetJs::from(rtc_offset.clone());

        // Apply RTC offset if significant
        if rtc_offset.is_significant() {
            mesh_collection.apply_rtc_offset(rtc_offset.x, rtc_offset.y, rtc_offset.z);
        }

        MeshCollectionWithRtc {
            meshes: mesh_collection,
            rtc_offset: rtc_offset_js,
        }
    }

    /// Parse IFC file and return GPU-ready geometry for zero-copy upload
    ///
    /// This method generates geometry that is:
    /// - Pre-interleaved (position + normal per vertex)
    /// - Coordinate-converted (Z-up to Y-up)
    /// - Ready for direct GPU upload via pointer access
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const gpuGeom = api.parseToGpuGeometry(ifcData);
    ///
    /// // Get WASM memory for zero-copy views
    /// const memory = api.getMemory();
    ///
    /// // Create views directly into WASM memory (NO COPY!)
    /// const vertexView = new Float32Array(
    ///   memory.buffer,
    ///   gpuGeom.vertexDataPtr,
    ///   gpuGeom.vertexDataLen
    /// );
    /// const indexView = new Uint32Array(
    ///   memory.buffer,
    ///   gpuGeom.indicesPtr,
    ///   gpuGeom.indicesLen
    /// );
    ///
    /// // Upload directly to GPU (single copy: WASM → GPU)
    /// device.queue.writeBuffer(vertexBuffer, 0, vertexView);
    /// device.queue.writeBuffer(indexBuffer, 0, indexView);
    ///
    /// // Free when done
    /// gpuGeom.free();
    /// ```
    #[wasm_bindgen(js_name = parseToGpuGeometry)]
    pub fn parse_to_gpu_geometry(&self, content: String) -> GpuGeometry {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter};

        // Build entity index once upfront for O(1) lookups
        let entity_index = build_entity_index(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

        // Build style index for colors
        let geometry_styles = build_geometry_style_index(&content, &mut decoder);
        let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

        // Collect FacetedBrep IDs for batch preprocessing
        let mut scanner = EntityScanner::new(&content);
        let mut faceted_brep_ids: Vec<u32> = Vec::new();
        let mut void_index: rustc_hash::FxHashMap<u32, Vec<u32>> = rustc_hash::FxHashMap::default();

        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if type_name == "IFCFACETEDBREP" {
                faceted_brep_ids.push(id);
            } else if type_name == "IFCRELVOIDSELEMENT" {
                if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                    if let (Some(host_id), Some(opening_id)) =
                        (entity.get_ref(4), entity.get_ref(5))
                    {
                        void_index.entry(host_id).or_default().push(opening_id);
                    }
                }
            }
        }

        // Create geometry router (without RTC offset initially)
        let mut router = GeometryRouter::with_units(&content, &mut decoder);

        // DETECT RTC OFFSET from actual building element transforms
        let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
        let needs_shift = rtc_offset.0.abs() > 10000.0
            || rtc_offset.1.abs() > 10000.0
            || rtc_offset.2.abs() > 10000.0;

        if needs_shift {
            router.set_rtc_offset(rtc_offset);
        }

        // Batch preprocess FacetedBreps
        if !faceted_brep_ids.is_empty() {
            router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
        }

        // Reset scanner for main processing
        scanner = EntityScanner::new(&content);

        // Estimate capacity
        let estimated_vertices = content.len() / 50; // Rough estimate
        let estimated_indices = estimated_vertices * 2;
        let mut gpu_geometry = GpuGeometry::with_capacity(estimated_vertices * 6, estimated_indices);

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                // Check if entity has representation
                let has_representation = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                if !has_representation {
                    continue;
                }

                if let Ok(mut mesh) =
                    router.process_element_with_voids(&entity, &mut decoder, &void_index)
                {
                    if !mesh.is_empty() {
                        // Calculate normals if not present or incomplete
                        // CSG operations may produce partial normals, so check for matching count
                        if mesh.normals.len() != mesh.positions.len() {
                            calculate_normals(&mut mesh);
                        }

                        // Get color from style index or default
                        let color = style_index
                            .get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        // Add to GPU geometry (interleaves and converts coordinates)
                        gpu_geometry.add_mesh(
                            id,
                            entity.ifc_type.name(),
                            &mesh.positions,
                            &mesh.normals,
                            &mesh.indices,
                            color,
                        );
                    }
                }
            }
        }

        // Set RTC offset on the GPU geometry so callers can apply it
        if needs_shift {
            gpu_geometry.set_rtc_offset(rtc_offset.0, rtc_offset.1, rtc_offset.2);
        }

        gpu_geometry
    }

    /// Parse IFC file with streaming GPU-ready geometry batches
    ///
    /// Yields batches of GPU-ready geometry for progressive rendering with zero-copy upload.
    /// Uses fast-first-frame streaming: simple geometry (walls, slabs) first.
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const memory = api.getMemory();
    ///
    /// await api.parseToGpuGeometryAsync(ifcData, {
    ///   batchSize: 25,
    ///   onBatch: (gpuGeom, progress) => {
    ///     // Create zero-copy views
    ///     const vertexView = new Float32Array(
    ///       memory.buffer,
    ///       gpuGeom.vertexDataPtr,
    ///       gpuGeom.vertexDataLen
    ///     );
    ///
    ///     // Upload to GPU
    ///     device.queue.writeBuffer(vertexBuffer, 0, vertexView);
    ///
    ///     // IMPORTANT: Free immediately after upload!
    ///     gpuGeom.free();
    ///   },
    ///   onComplete: (stats) => {
    ///     console.log(`Done! ${stats.totalMeshes} meshes`);
    ///   }
    /// });
    /// ```
    #[wasm_bindgen(js_name = parseToGpuGeometryAsync)]
    pub fn parse_to_gpu_geometry_async(&self, content: String, options: JsValue) -> Promise {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter};

        let promise = Promise::new(&mut |resolve, _reject| {
            let content = content.clone();
            let options = options.clone();

            spawn_local(async move {
                // Parse options
                let batch_size: usize = js_sys::Reflect::get(&options, &"batchSize".into())
                    .ok()
                    .and_then(|v| v.as_f64())
                    .map(|v| v as usize)
                    .unwrap_or(25);

                let on_batch = js_sys::Reflect::get(&options, &"onBatch".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                let on_complete = js_sys::Reflect::get(&options, &"onComplete".into())
                    .ok()
                    .and_then(|v| v.dyn_into::<Function>().ok());

                // Build entity index
                let entity_index = build_entity_index(&content);
                let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

                // Build style index
                let geometry_styles = build_geometry_style_index(&content, &mut decoder);
                let style_index =
                    build_element_style_index(&content, &geometry_styles, &mut decoder);

                // Collect FacetedBrep IDs and void relationships
                let mut scanner = EntityScanner::new(&content);
                let mut faceted_brep_ids: Vec<u32> = Vec::new();
                let mut void_index: rustc_hash::FxHashMap<u32, Vec<u32>> =
                    rustc_hash::FxHashMap::default();

                while let Some((id, type_name, start, end)) = scanner.next_entity() {
                    if type_name == "IFCFACETEDBREP" {
                        faceted_brep_ids.push(id);
                    } else if type_name == "IFCRELVOIDSELEMENT" {
                        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                            if let (Some(host_id), Some(opening_id)) =
                                (entity.get_ref(4), entity.get_ref(5))
                            {
                                void_index.entry(host_id).or_default().push(opening_id);
                            }
                        }
                    }
                }

                // Create geometry router
                let mut router = GeometryRouter::with_units(&content, &mut decoder);

                // DETECT RTC OFFSET from actual building element transforms
                let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
                let needs_shift = rtc_offset.0.abs() > 10000.0
                    || rtc_offset.1.abs() > 10000.0
                    || rtc_offset.2.abs() > 10000.0;

                if needs_shift {
                    router.set_rtc_offset(rtc_offset);
                }

                // Batch preprocess FacetedBreps
                if !faceted_brep_ids.is_empty() {
                    router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
                }

                // Reset scanner
                scanner = EntityScanner::new(&content);

                // Processing state
                let mut current_batch = GpuGeometry::with_capacity(batch_size * 1000, batch_size * 3000);
                let mut processed = 0;
                let mut total_meshes = 0;
                let mut total_vertices = 0;
                let mut total_triangles = 0;
                let mut deferred_complex: Vec<(u32, usize, usize, ifc_lite_core::IfcType)> =
                    Vec::new();

                // Helper to flush current batch (captures RTC offset for each batch)
                let flush_batch = |batch: &mut GpuGeometry,
                                   on_batch: &Option<Function>,
                                   progress: &JsValue| {
                    if batch.mesh_count() == 0 {
                        return;
                    }

                    if let Some(ref callback) = on_batch {
                        // Swap out the batch and set RTC offset before sending
                        let mut to_send =
                            std::mem::replace(batch, GpuGeometry::with_capacity(1000, 3000));
                        if needs_shift {
                            to_send.set_rtc_offset(rtc_offset.0, rtc_offset.1, rtc_offset.2);
                        }
                        let _ = callback.call2(&JsValue::NULL, &to_send.into(), progress);
                    } else {
                        batch.clear();
                    }
                };

                // First pass - process simple geometry immediately
                while let Some((id, type_name, start, end)) = scanner.next_entity() {
                    if !ifc_lite_core::has_geometry_by_name(type_name) {
                        continue;
                    }

                    let ifc_type = ifc_lite_core::IfcType::from_str(type_name);

                    // Simple geometry: process immediately
                    if matches!(
                        type_name,
                        "IFCWALL"
                            | "IFCWALLSTANDARDCASE"
                            | "IFCSLAB"
                            | "IFCBEAM"
                            | "IFCCOLUMN"
                            | "IFCPLATE"
                            | "IFCROOF"
                            | "IFCCOVERING"
                            | "IFCFOOTING"
                            | "IFCRAILING"
                            | "IFCSTAIR"
                            | "IFCSTAIRFLIGHT"
                            | "IFCRAMP"
                            | "IFCRAMPFLIGHT"
                    ) {
                        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                            let has_representation =
                                entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                            if has_representation {
                                if let Ok(mut mesh) = router.process_element_with_voids(
                                    &entity,
                                    &mut decoder,
                                    &void_index,
                                ) {
                                    if !mesh.is_empty() {
                                        if mesh.normals.len() != mesh.positions.len() {
                                            calculate_normals(&mut mesh);
                                        }

                                        let color = style_index
                                            .get(&id)
                                            .copied()
                                            .unwrap_or_else(|| get_default_color_for_type(&ifc_type));

                                        total_vertices += mesh.positions.len() / 3;
                                        total_triangles += mesh.indices.len() / 3;

                                        current_batch.add_mesh(
                                            id,
                                            ifc_type.name(),
                                            &mesh.positions,
                                            &mesh.normals,
                                            &mesh.indices,
                                            color,
                                        );
                                        processed += 1;
                                        total_meshes += 1;
                                    }
                                }
                            }
                        }

                        // Yield batch when full
                        if current_batch.mesh_count() >= batch_size {
                            let progress = js_sys::Object::new();
                            set_js_prop(&progress, "percent", &0u32.into());
                            set_js_prop(&progress, "processed", &(processed as f64).into());
                            set_js_prop(&progress, "phase", &"simple".into());

                            flush_batch(&mut current_batch, &on_batch, &progress.into());

                            // Yield to browser
                            gloo_timers::future::TimeoutFuture::new(0).await;
                        }
                    } else {
                        // Defer complex geometry
                        deferred_complex.push((id, start, end, ifc_type));
                    }
                }

                // Flush remaining simple geometry
                if current_batch.mesh_count() > 0 {
                    let progress = js_sys::Object::new();
                    set_js_prop(&progress, "phase", &"simple_complete".into());
                    flush_batch(&mut current_batch, &on_batch, &progress.into());
                    gloo_timers::future::TimeoutFuture::new(0).await;
                }

                // Process deferred complex geometry
                let total_elements = processed + deferred_complex.len();
                for (id, start, end, ifc_type) in deferred_complex {
                    if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                        if let Ok(mut mesh) =
                            router.process_element_with_voids(&entity, &mut decoder, &void_index)
                        {
                            if !mesh.is_empty() {
                                if mesh.normals.len() != mesh.positions.len() {
                                    calculate_normals(&mut mesh);
                                }

                                let color = style_index
                                    .get(&id)
                                    .copied()
                                    .unwrap_or_else(|| get_default_color_for_type(&ifc_type));

                                total_vertices += mesh.positions.len() / 3;
                                total_triangles += mesh.indices.len() / 3;

                                current_batch.add_mesh(
                                    id,
                                    ifc_type.name(),
                                    &mesh.positions,
                                    &mesh.normals,
                                    &mesh.indices,
                                    color,
                                );
                                total_meshes += 1;
                            }
                        }
                    }

                    processed += 1;

                    // Yield batch when full
                    if current_batch.mesh_count() >= batch_size {
                        let progress = js_sys::Object::new();
                        let percent = (processed as f64 / total_elements as f64 * 100.0) as u32;
                        set_js_prop(&progress, "percent", &percent.into());
                        set_js_prop(&progress, "processed", &(processed as f64).into());
                        set_js_prop(&progress, "total", &(total_elements as f64).into());
                        set_js_prop(&progress, "phase", &"complex".into());

                        flush_batch(&mut current_batch, &on_batch, &progress.into());
                        gloo_timers::future::TimeoutFuture::new(0).await;
                    }
                }

                // Final flush
                if current_batch.mesh_count() > 0 {
                    let progress = js_sys::Object::new();
                    set_js_prop(&progress, "percent", &100u32.into());
                    set_js_prop(&progress, "phase", &"complete".into());
                    flush_batch(&mut current_batch, &on_batch, &progress.into());
                }

                // Call completion callback
                if let Some(ref callback) = on_complete {
                    let stats = js_sys::Object::new();
                    set_js_prop(&stats, "totalMeshes", &(total_meshes as f64).into());
                    set_js_prop(&stats, "totalVertices", &(total_vertices as f64).into());
                    set_js_prop(&stats, "totalTriangles", &(total_triangles as f64).into());

                    // Include RTC offset if applied
                    if needs_shift {
                        let rtc_obj = js_sys::Object::new();
                        set_js_prop(&rtc_obj, "x", &rtc_offset.0.into());
                        set_js_prop(&rtc_obj, "y", &rtc_offset.1.into());
                        set_js_prop(&rtc_obj, "z", &rtc_offset.2.into());
                        set_js_prop(&stats, "rtcOffset", &rtc_obj);
                    }

                    let _ = callback.call1(&JsValue::NULL, &stats);
                }

                let _ = resolve.call0(&JsValue::NULL);
            });
        });

        promise
    }

    /// Parse IFC file to GPU-ready instanced geometry for zero-copy upload
    ///
    /// Groups identical geometries by hash for efficient GPU instancing.
    /// Returns a collection of instanced geometries with pointer access.
    #[wasm_bindgen(js_name = parseToGpuInstancedGeometry)]
    pub fn parse_to_gpu_instanced_geometry(&self, content: String) -> GpuInstancedGeometryCollection {
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner};
        use ifc_lite_geometry::{calculate_normals, GeometryRouter, Mesh};
        use rustc_hash::FxHashMap;
        use rustc_hash::FxHasher;
        use std::hash::{Hash, Hasher};

        // Build entity index
        let entity_index = build_entity_index(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

        // Build style index
        let geometry_styles = build_geometry_style_index(&content, &mut decoder);
        let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

        // Collect FacetedBrep IDs
        let mut scanner = EntityScanner::new(&content);
        let mut faceted_brep_ids: Vec<u32> = Vec::new();

        while let Some((id, type_name, _, _)) = scanner.next_entity() {
            if type_name == "IFCFACETEDBREP" {
                faceted_brep_ids.push(id);
            }
        }

        // Create geometry router
        let router = GeometryRouter::with_units(&content, &mut decoder);

        // Batch preprocess FacetedBreps
        if !faceted_brep_ids.is_empty() {
            router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
        }

        // Reset scanner
        scanner = EntityScanner::new(&content);

        // Group meshes by geometry hash
        #[allow(clippy::type_complexity)]
        let mut geometry_groups: FxHashMap<u64, (Mesh, Vec<(u32, [f64; 16], [f32; 4])>)> =
            FxHashMap::default();

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                if let Ok((mut mesh, transform)) =
                    router.process_element_with_transform(&entity, &mut decoder)
                {
                    if !mesh.is_empty() {
                        if mesh.normals.is_empty() {
                            calculate_normals(&mut mesh);
                        }

                        // Compute geometry hash
                        let mut hasher = FxHasher::default();
                        mesh.positions.len().hash(&mut hasher);
                        mesh.indices.len().hash(&mut hasher);
                        for pos in &mesh.positions {
                            pos.to_bits().hash(&mut hasher);
                        }
                        for idx in &mesh.indices {
                            idx.hash(&mut hasher);
                        }
                        let geometry_hash = hasher.finish();

                        // Get color
                        let color = style_index
                            .get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        // Convert transform to column-major array
                        let mut transform_array = [0.0f64; 16];
                        for col in 0..4 {
                            for row in 0..4 {
                                transform_array[col * 4 + row] = transform[(row, col)];
                            }
                        }

                        // Add to group
                        let entry = geometry_groups.entry(geometry_hash);
                        match entry {
                            std::collections::hash_map::Entry::Occupied(mut o) => {
                                o.get_mut().1.push((id, transform_array, color));
                            }
                            std::collections::hash_map::Entry::Vacant(v) => {
                                v.insert((mesh, vec![(id, transform_array, color)]));
                            }
                        }
                    }
                }
            }
        }

        // Convert to GPU instanced geometry collection
        let mut collection = GpuInstancedGeometryCollection::new();

        for (geometry_id, (mesh, instances)) in geometry_groups {
            let mut gpu_instanced = GpuInstancedGeometry::new(geometry_id);

            // Set shared geometry (interleaves and converts coordinates)
            gpu_instanced.set_geometry(&mesh.positions, &mesh.normals, &mesh.indices);

            // Add instances
            for (express_id, transform, color) in instances {
                // Convert f64 transform to f32
                let mut transform_f32 = [0.0f32; 16];
                for (i, &val) in transform.iter().enumerate() {
                    transform_f32[i] = val as f32;
                }
                gpu_instanced.add_instance(express_id, &transform_f32, color);
            }

            collection.add(gpu_instanced);
        }

        collection
    }

    /// Debug: Test processing entity #953 (FacetedBrep wall)
    #[wasm_bindgen(js_name = debugProcessEntity953)]
    pub fn debug_process_entity_953(&self, content: String) -> String {
        use ifc_lite_core::{EntityDecoder, EntityScanner};
        use ifc_lite_geometry::GeometryRouter;

        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::new(&content);
        let router = GeometryRouter::with_units(&content, &mut decoder);

        // Find entity 953
        while let Some((id, _type_name, start, end)) = scanner.next_entity() {
            if id == 953 {
                match decoder.decode_at_with_id(id, start, end) {
                    Ok(entity) => match router.process_element(&entity, &mut decoder) {
                        Ok(mesh) => {
                            return format!(
                                "SUCCESS! Entity #953: {} vertices, {} triangles, empty={}",
                                mesh.vertex_count(),
                                mesh.triangle_count(),
                                mesh.is_empty()
                            );
                        }
                        Err(e) => {
                            return format!("ERROR processing entity #953: {}", e);
                        }
                    },
                    Err(e) => {
                        return format!("ERROR decoding entity #953: {}", e);
                    }
                }
            }
        }
        "Entity #953 not found".to_string()
    }

    /// Debug: Test processing a single wall
    #[wasm_bindgen(js_name = debugProcessFirstWall)]
    pub fn debug_process_first_wall(&self, content: String) -> String {
        use ifc_lite_core::{EntityDecoder, EntityScanner};
        use ifc_lite_geometry::GeometryRouter;

        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::new(&content);
        let router = GeometryRouter::with_units(&content, &mut decoder);

        // Find first wall
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if type_name.contains("WALL") {
                let ifc_type = ifc_lite_core::IfcType::from_str(type_name);
                if router.schema().has_geometry(&ifc_type) {
                    // Try to decode and process
                    match decoder.decode_at_with_id(id, start, end) {
                        Ok(entity) => match router.process_element(&entity, &mut decoder) {
                            Ok(mesh) => {
                                return format!(
                                    "SUCCESS! Wall #{}: {} vertices, {} triangles",
                                    id,
                                    mesh.vertex_count(),
                                    mesh.triangle_count()
                                );
                            }
                            Err(e) => {
                                return format!(
                                    "ERROR processing wall #{} ({}): {}",
                                    id, type_name, e
                                );
                            }
                        },
                        Err(e) => {
                            return format!("ERROR decoding wall #{}: {}", id, e);
                        }
                    }
                }
            }
        }

        "No walls found".to_string()
    }

    /// Parse IFC file and extract symbolic representations (Plan, Annotation, FootPrint)
    /// These are 2D curves used for architectural drawings instead of sectioning 3D geometry
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// const symbols = api.parseSymbolicRepresentations(ifcData);
    /// console.log('Found', symbols.totalCount, 'symbolic items');
    /// for (let i = 0; i < symbols.polylineCount; i++) {
    ///   const polyline = symbols.getPolyline(i);
    ///   console.log('Polyline for', polyline.ifcType, ':', polyline.points);
    /// }
    /// ```
    #[wasm_bindgen(js_name = parseSymbolicRepresentations)]
    pub fn parse_symbolic_representations(&self, content: String) -> SymbolicRepresentationCollection {
        use crate::zero_copy::SymbolicRepresentationCollection;
        use ifc_lite_core::{build_entity_index, EntityDecoder, EntityScanner, IfcType};

        // Build entity index for fast lookups
        let entity_index = build_entity_index(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index);

        // Create geometry router to get unit scale and detect RTC offset
        let router = ifc_lite_geometry::GeometryRouter::with_units(&content, &mut decoder);
        let unit_scale = router.unit_scale() as f32;

        // Detect RTC offset (same as mesh parsing) to align with section cuts
        let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
        let needs_rtc = rtc_offset.0.abs() > 10000.0
            || rtc_offset.1.abs() > 10000.0
            || rtc_offset.2.abs() > 10000.0;

        // RTC offset for floor plan: use X and Z (Y is vertical)
        let rtc_x = if needs_rtc { rtc_offset.0 as f32 } else { 0.0 };
        let rtc_z = if needs_rtc { rtc_offset.2 as f32 } else { 0.0 };

        let mut collection = SymbolicRepresentationCollection::new();
        let mut scanner = EntityScanner::new(&content);

        // Process all building elements that might have symbolic representations
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            // Decode the entity
            let entity = match decoder.decode_at_with_id(id, start, end) {
                Ok(e) => e,
                Err(_) => continue,
            };

            // Get representation (attribute 6 for most products)
            // Note: placement transform is computed per-representation below
            let representation_attr = match entity.get(6) {
                Some(attr) if !attr.is_null() => attr,
                _ => continue,
            };

            let representation = match decoder.resolve_ref(representation_attr) {
                Ok(Some(r)) => r,
                _ => continue,
            };

            // Get representations list (attribute 2 of IfcProductDefinitionShape)
            let representations_attr = match representation.get(2) {
                Some(attr) => attr,
                None => continue,
            };

            let representations = match decoder.resolve_ref_list(representations_attr) {
                Ok(r) => r,
                Err(_) => continue,
            };

            let ifc_type_name = entity.ifc_type.name().to_string();

            // Look for Plan, Annotation, or FootPrint representations
            for shape_rep in representations {
                if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                    continue;
                }

                // Get RepresentationIdentifier (attribute 1)
                let rep_identifier = match shape_rep.get(1) {
                    Some(attr) => attr.as_string().unwrap_or("").to_string(),
                    None => continue,
                };

                // Only process symbolic representations
                if !matches!(
                    rep_identifier.as_str(),
                    "Plan" | "Annotation" | "FootPrint" | "Axis"
                ) {
                    continue;
                }

                // Get ObjectPlacement transform for symbolic representations.
                // - Translations are accumulated directly (not rotated by parent)
                // - Rotations ARE accumulated to orient symbols correctly
                let placement_transform = get_object_placement_for_symbolic_logged(&entity, &mut decoder, unit_scale, None);

                // Check ContextOfItems (attribute 0) for WorldCoordinateSystem
                // Some Plan representations use a different coordinate system than Body
                let context_transform = if let Some(context_ref) = shape_rep.get_ref(0) {
                    if let Ok(context) = decoder.decode_by_id(context_ref) {
                        // IfcGeometricRepresentationContext has WorldCoordinateSystem at attr 2
                        // IfcGeometricRepresentationSubContext inherits from parent (attr 4)
                        if context.ifc_type == IfcType::IfcGeometricRepresentationContext {
                            if let Some(wcs_ref) = context.get_ref(2) {
                                if let Ok(wcs) = decoder.decode_by_id(wcs_ref) {
                                    parse_axis2_placement_2d(&wcs, &mut decoder, unit_scale)
                                } else {
                                    Transform2D::identity()
                                }
                            } else {
                                Transform2D::identity()
                            }
                        } else if context.ifc_type == IfcType::IfcGeometricRepresentationSubContext {
                            // SubContext inherits from parent - for now use identity
                            // TODO: could recursively get parent context's WCS
                            Transform2D::identity()
                        } else {
                            Transform2D::identity()
                        }
                    } else {
                        Transform2D::identity()
                    }
                } else {
                    Transform2D::identity()
                };

                // Compose: context_transform * placement_transform
                // The context WCS defines global positioning, placement is entity-specific
                let combined_transform = if context_transform.tx.abs() > 0.001
                    || context_transform.ty.abs() > 0.001
                    || (context_transform.cos_theta - 1.0).abs() > 0.0001
                    || context_transform.sin_theta.abs() > 0.0001
                {
                    compose_transforms(&context_transform, &placement_transform)
                } else {
                    placement_transform.clone()
                };

                // Get items list (attribute 3)
                let items_attr = match shape_rep.get(3) {
                    Some(attr) => attr,
                    None => continue,
                };

                let items = match decoder.resolve_ref_list(items_attr) {
                    Ok(i) => i,
                    Err(_) => continue,
                };

                // Process each item in the representation
                for item in items {
                    extract_symbolic_item(
                        &item,
                        &mut decoder,
                        id,
                        &ifc_type_name,
                        &rep_identifier,
                        unit_scale,
                        &combined_transform,
                        rtc_x,
                        rtc_z,
                        &mut collection,
                    );
                }
            }
        }


        // Log bounding box of all symbolic geometry
        let mut min_x = f32::MAX;
        let mut min_y = f32::MAX;
        let mut max_x = f32::MIN;
        let mut max_y = f32::MIN;
        for i in 0..collection.polyline_count() {
            if let Some(poly) = collection.get_polyline(i) {
                let points_array = poly.points();
                let points: Vec<f32> = points_array.to_vec();
                for chunk in points.chunks(2) {
                    if chunk.len() == 2 {
                        min_x = min_x.min(chunk[0]);
                        max_x = max_x.max(chunk[0]);
                        min_y = min_y.min(chunk[1]);
                        max_y = max_y.max(chunk[1]);
                    }
                }
            }
        }
        for i in 0..collection.circle_count() {
            if let Some(circle) = collection.get_circle(i) {
                min_x = min_x.min(circle.center_x() - circle.radius());
                max_x = max_x.max(circle.center_x() + circle.radius());
                min_y = min_y.min(circle.center_y() - circle.radius());
                max_y = max_y.max(circle.center_y() + circle.radius());
            }
        }

        collection
    }
}

/// Simple 2D transform for symbolic representations (translation + rotation)
#[derive(Clone, Copy, Debug)]
struct Transform2D {
    tx: f32,
    ty: f32,
    cos_theta: f32,
    sin_theta: f32,
}

impl Transform2D {
    fn identity() -> Self {
        Self { tx: 0.0, ty: 0.0, cos_theta: 1.0, sin_theta: 0.0 }
    }

    fn transform_point(&self, x: f32, y: f32) -> (f32, f32) {
        // Apply rotation then translation: p' = R * p + t
        let rx = x * self.cos_theta - y * self.sin_theta;
        let ry = x * self.sin_theta + y * self.cos_theta;
        (rx + self.tx, ry + self.ty)
    }

}

/// Compose two 2D transforms: result = a * b (apply b first, then a)
fn compose_transforms(a: &Transform2D, b: &Transform2D) -> Transform2D {
    // Combined rotation: R_combined = R_a * R_b
    let combined_cos = a.cos_theta * b.cos_theta - a.sin_theta * b.sin_theta;
    let combined_sin = a.sin_theta * b.cos_theta + a.cos_theta * b.sin_theta;

    // Combined translation: t_combined = R_a * t_b + t_a
    let rtx = b.tx * a.cos_theta - b.ty * a.sin_theta;
    let rty = b.tx * a.sin_theta + b.ty * a.cos_theta;

    Transform2D {
        tx: rtx + a.tx,
        ty: rty + a.ty,
        cos_theta: combined_cos,
        sin_theta: combined_sin,
    }
}

/// Get placement transform for symbolic 2D representations with logging.
fn get_object_placement_for_symbolic_logged(
    entity: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
    unit_scale: f32,
    log_entity_id: Option<u32>,
) -> Transform2D {
    // Get ObjectPlacement (attribute 5 for IfcProduct)
    let placement_attr = match entity.get(5) {
        Some(attr) if !attr.is_null() => attr,
        _ => return Transform2D::identity(),
    };

    let placement = match decoder.resolve_ref(placement_attr) {
        Ok(Some(p)) => p,
        _ => return Transform2D::identity(),
    };

    // Recursively resolve for symbolic representations with logging
    resolve_placement_for_symbolic_with_logging(&placement, decoder, unit_scale, 0, log_entity_id)
}

/// Recursively resolve IfcLocalPlacement for 2D symbolic representations.
/// Translations are accumulated directly (without rotating by parent rotations),
/// but rotations ARE accumulated to orient the 2D geometry correctly.
fn resolve_placement_for_symbolic_with_logging(
    placement: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
    unit_scale: f32,
    depth: usize,
    log_entity_id: Option<u32>,
) -> Transform2D {
    use ifc_lite_core::IfcType;

    // Prevent infinite recursion
    if depth > 50 || placement.ifc_type != IfcType::IfcLocalPlacement {
        return Transform2D::identity();
    }

    // Get parent transform first (attribute 0: PlacementRelTo)
    let parent_transform = if let Some(parent_attr) = placement.get(0) {
        if !parent_attr.is_null() {
            if let Ok(Some(parent)) = decoder.resolve_ref(parent_attr) {
                resolve_placement_for_symbolic_with_logging(&parent, decoder, unit_scale, depth + 1, log_entity_id)
            } else {
                Transform2D::identity()
            }
        } else {
            Transform2D::identity()
        }
    } else {
        Transform2D::identity()
    };

    // Get local transform (attribute 1: RelativePlacement)
    let local_transform = if let Some(rel_attr) = placement.get(1) {
        if !rel_attr.is_null() {
            if let Ok(Some(rel)) = decoder.resolve_ref(rel_attr) {
                if rel.ifc_type == IfcType::IfcAxis2Placement3D || rel.ifc_type == IfcType::IfcAxis2Placement2D {
                    parse_axis2_placement_2d(&rel, decoder, unit_scale)
                } else {
                    Transform2D::identity()
                }
            } else {
                Transform2D::identity()
            }
        } else {
            Transform2D::identity()
        }
    } else {
        Transform2D::identity()
    };

    // For symbolic 2D representations:
    // - Translations are added directly (NOT rotated by parent rotation)
    // - Rotations are accumulated to orient the 2D geometry
    // This prevents parent rotations from distorting child positions while
    // still allowing correct orientation of symbols.
    // Compose transforms properly: rotate local translation by parent rotation
    let combined_cos = parent_transform.cos_theta * local_transform.cos_theta
                     - parent_transform.sin_theta * local_transform.sin_theta;
    let combined_sin = parent_transform.sin_theta * local_transform.cos_theta
                     + parent_transform.cos_theta * local_transform.sin_theta;

    // Rotate local translation by parent rotation before adding to parent translation
    let rotated_local_tx = local_transform.tx * parent_transform.cos_theta 
                         - local_transform.ty * parent_transform.sin_theta;
    let rotated_local_ty = local_transform.tx * parent_transform.sin_theta 
                         + local_transform.ty * parent_transform.cos_theta;

    let composed_tx = parent_transform.tx + rotated_local_tx;
    let composed_ty = parent_transform.ty + rotated_local_ty;
    let _composed_rot = combined_sin.atan2(combined_cos).to_degrees();


    Transform2D {
        tx: composed_tx,
        ty: composed_ty,
        cos_theta: combined_cos,
        sin_theta: combined_sin,
    }
}

/// Parse IfcAxis2Placement3D/2D to get 2D translation and rotation for floor plan view
/// Floor plan uses X-Y plane (Z is up) to match section cut coordinate system
fn parse_axis2_placement_2d(
    placement: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
    unit_scale: f32,
) -> Transform2D {
    parse_axis2_placement_2d_with_logging(placement, decoder, unit_scale, false, 0)
}

/// Parse IfcAxis2Placement3D/2D with optional logging
fn parse_axis2_placement_2d_with_logging(
    placement: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
    unit_scale: f32,
    _log: bool,
    _entity_id: u32,
) -> Transform2D {
    use ifc_lite_core::IfcType;

    // Get Location (attribute 0)
    // Floor plan coordinates use X-Y plane (Z is up) to match section cut
    let is_3d = placement.ifc_type == IfcType::IfcAxis2Placement3D;

    let (tx, ty, _raw_coords) = if let Some(loc_ref) = placement.get_ref(0) {
        if let Ok(loc) = decoder.decode_by_id(loc_ref) {
            if loc.ifc_type == IfcType::IfcCartesianPoint {
                if let Some(coords_attr) = loc.get(0) {
                    if let Some(coords) = coords_attr.as_list() {
                        let raw_x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0) as f32;
                        let raw_y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32;
                        let raw_z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0) as f32;

                        // Use X-Y for floor plan (Z is up in most IFC models)
                        // Keep native IFC coordinates to match section cut
                        let x = raw_x * unit_scale;
                        let y = raw_y * unit_scale;
                        (x, y, Some((raw_x, raw_y, raw_z)))
                    } else {
                        (0.0, 0.0, None)
                    }
                } else {
                    (0.0, 0.0, None)
                }
            } else {
                (0.0, 0.0, None)
            }
        } else {
            (0.0, 0.0, None)
        }
    } else {
        (0.0, 0.0, None)
    };


    // Get RefDirection (attribute 2 for 3D, attribute 1 for 2D) to get rotation
    // RefDirection is the X-axis direction in the local coordinate system
    // Use X-Y components for floor plan rotation (Z is up)
    let (cos_theta, sin_theta) = if let Some(ref_dir_attr) = placement.get(2).or_else(|| placement.get(1)) {
        if !ref_dir_attr.is_null() {
            if let Some(ref_dir_id) = ref_dir_attr.as_entity_ref() {
                if let Ok(ref_dir) = decoder.decode_by_id(ref_dir_id) {
                    if ref_dir.ifc_type == IfcType::IfcDirection {
                        if let Some(ratios_attr) = ref_dir.get(0) {
                            if let Some(ratios) = ratios_attr.as_list() {
                                let dx = ratios.first().and_then(|v| v.as_float()).unwrap_or(1.0) as f32;
                                let dy = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32;
                                let dz = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(0.0) as f32;
                                
                                // Use X-Y for rotation (Z is up)
                                let len = (dx * dx + dy * dy).sqrt();
                                if len > 0.0001 {
                                    (dx / len, dy / len)
                                } else if is_3d && dz.abs() > 0.0001 {
                                    // Special case: RefDirection is purely in Z direction (vertical)
                                    // Local X points up/down, rotation is 0° in floor plan
                                    (1.0, 0.0)
                                } else {
                                    (1.0, 0.0)
                                }
                            } else {
                                (1.0, 0.0)
                            }
                        } else {
                            (1.0, 0.0)
                        }
                    } else {
                        (1.0, 0.0)
                    }
                } else {
                    (1.0, 0.0)
                }
            } else {
                (1.0, 0.0)
            }
        } else {
            (1.0, 0.0)
        }
    } else {
        (1.0, 0.0)
    };

    Transform2D { tx, ty, cos_theta, sin_theta }
}

/// Parse IfcCartesianTransformationOperator to get 2D transform
fn parse_cartesian_transformation_operator(
    operator: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
    unit_scale: f32,
) -> Transform2D {
    use ifc_lite_core::IfcType;

    // IfcCartesianTransformationOperator: Axis1, Axis2, LocalOrigin, Scale
    // IfcCartesianTransformationOperator2D: same, but 2D
    // IfcCartesianTransformationOperator3D: Axis1, Axis2, LocalOrigin, Scale, Axis3

    // Get LocalOrigin (attribute 2 for 2D, attribute 2 for 3D)
    let (tx, ty) = if let Some(origin_ref) = operator.get_ref(2) {
        if let Ok(origin) = decoder.decode_by_id(origin_ref) {
            if origin.ifc_type == IfcType::IfcCartesianPoint {
                if let Some(coords_attr) = origin.get(0) {
                    if let Some(coords) = coords_attr.as_list() {
                        let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                        let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                        (x, y)
                    } else { (0.0, 0.0) }
                } else { (0.0, 0.0) }
            } else { (0.0, 0.0) }
        } else { (0.0, 0.0) }
    } else { (0.0, 0.0) };

    // Get Axis1 for rotation (attribute 0)
    let (cos_theta, sin_theta) = if let Some(axis1_ref) = operator.get_ref(0) {
        if let Ok(axis1) = decoder.decode_by_id(axis1_ref) {
            if axis1.ifc_type == IfcType::IfcDirection {
                if let Some(ratios_attr) = axis1.get(0) {
                    if let Some(ratios) = ratios_attr.as_list() {
                        let dx = ratios.first().and_then(|v| v.as_float()).unwrap_or(1.0) as f32;
                        let dy = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32;
                        let len = (dx * dx + dy * dy).sqrt();
                        if len > 0.0001 {
                            (dx / len, dy / len)
                        } else {
                            (1.0, 0.0)
                        }
                    } else { (1.0, 0.0) }
                } else { (1.0, 0.0) }
            } else { (1.0, 0.0) }
        } else { (1.0, 0.0) }
    } else { (1.0, 0.0) };

    Transform2D { tx, ty, cos_theta, sin_theta }
}

/// Extract symbolic geometry from a representation item (recursive for IfcGeometricSet, IfcMappedItem)
fn extract_symbolic_item(
    item: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
    express_id: u32,
    ifc_type: &str,
    rep_identifier: &str,
    unit_scale: f32,
    transform: &Transform2D,
    rtc_x: f32,
    rtc_z: f32,
    collection: &mut crate::zero_copy::SymbolicRepresentationCollection,
) {
    use crate::zero_copy::{SymbolicCircle, SymbolicPolyline};
    use ifc_lite_core::IfcType;

    match item.ifc_type {
        IfcType::IfcGeometricSet | IfcType::IfcGeometricCurveSet => {
            // IfcGeometricSet: Elements (SET of IfcGeometricSetSelect)
            if let Some(elements_attr) = item.get(0) {
                if let Ok(elements) = decoder.resolve_ref_list(elements_attr) {
                    for element in elements {
                        extract_symbolic_item(
                            &element,
                            decoder,
                            express_id,
                            ifc_type,
                            rep_identifier,
                            unit_scale,
                            transform,
                            rtc_x,
                            rtc_z,
                            collection,
                        );
                    }
                }
            }
        }
        IfcType::IfcMappedItem => {
            // IfcMappedItem: MappingSource (IfcRepresentationMap), MappingTarget (optional transform)
            if let Some(source_id) = item.get_ref(0) {
                if let Ok(rep_map) = decoder.decode_by_id(source_id) {
                    // IfcRepresentationMap: MappingOrigin, MappedRepresentation
                    // MappingOrigin (attr 0) defines the coordinate system origin for the mapped geometry
                    let mapping_origin_transform = if let Some(origin_id) = rep_map.get_ref(0) {
                        if let Ok(origin) = decoder.decode_by_id(origin_id) {
                            parse_axis2_placement_2d(&origin, decoder, unit_scale)
                        } else {
                            Transform2D::identity()
                        }
                    } else {
                        Transform2D::identity()
                    };

                    // Check for MappingTarget (attr 1 of IfcMappedItem) - additional transform
                    let mapping_target_transform = if let Some(target_ref) = item.get_ref(1) {
                        if let Ok(target) = decoder.decode_by_id(target_ref) {
                            // IfcCartesianTransformationOperator2D/3D
                            parse_cartesian_transformation_operator(&target, decoder, unit_scale)
                        } else {
                            Transform2D::identity()
                        }
                    } else {
                        Transform2D::identity()
                    };

                    // Compose: entity_transform * mapping_target * mapping_origin
                    // The mapping origin defines where the mapped geometry's (0,0) is relative to entity
                    // The mapping target provides additional transformation
                    let origin_with_target = compose_transforms(&mapping_target_transform, &mapping_origin_transform);
                    let composed_transform = compose_transforms(transform, &origin_with_target);

                    if let Some(mapped_rep_id) = rep_map.get_ref(1) {
                        if let Ok(mapped_rep) = decoder.decode_by_id(mapped_rep_id) {
                            // Get items from the mapped representation
                            if let Some(items_attr) = mapped_rep.get(3) {
                                if let Ok(items) = decoder.resolve_ref_list(items_attr) {
                                    for sub_item in items {
                                        extract_symbolic_item(
                                            &sub_item,
                                            decoder,
                                            express_id,
                                            ifc_type,
                                            rep_identifier,
                                            unit_scale,
                                            &composed_transform,
                                            rtc_x,
                                            rtc_z,
                                            collection,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        IfcType::IfcPolyline => {
            // IfcPolyline: Points (LIST of IfcCartesianPoint)
            if let Some(points_attr) = item.get(0) {
                if let Ok(point_entities) = decoder.resolve_ref_list(points_attr) {
                    let mut points: Vec<f32> = Vec::with_capacity(point_entities.len() * 2);

                    for point_entity in point_entities.iter() {
                        if point_entity.ifc_type != IfcType::IfcCartesianPoint {
                            continue;
                        }
                        if let Some(coords_attr) = point_entity.get(0) {
                            if let Some(coords) = coords_attr.as_list() {
                                let local_x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                                let local_y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;

                                // Apply full transform (rotation + translation) to orient symbols correctly.
                                // The placement's rotation is accumulated from hierarchy to orient
                                // door swings, window symbols, etc. properly.
                                let (wx, wy) = transform.transform_point(local_x, local_y);
                                let x = wx - rtc_x;
                                // Negate Y to match section cut coordinate system (renderer flips Y)
                                let y = -wy + rtc_z;

                                // Skip invalid coordinates
                                if x.is_finite() && y.is_finite() {
                                    points.push(x);
                                    points.push(y);
                                }
                            }
                        }
                    }
                    if points.len() >= 4 {
                        // Check if closed (first == last point)
                        let n = points.len();
                        let is_closed = n >= 4
                            && (points[0] - points[n - 2]).abs() < 0.001
                            && (points[1] - points[n - 1]).abs() < 0.001;


                        collection.add_polyline(SymbolicPolyline::new(
                            express_id,
                            ifc_type.to_string(),
                            points,
                            is_closed,
                            rep_identifier.to_string(),
                        ));
                    }
                }
            }
        }
        IfcType::IfcIndexedPolyCurve => {
            // IfcIndexedPolyCurve: Points (IfcCartesianPointList2D/3D), Segments, SelfIntersect
            if let Some(points_ref) = item.get_ref(0) {
                if let Ok(points_list) = decoder.decode_by_id(points_ref) {
                    if let Some(coord_list_attr) = points_list.get(0) {
                        if let Some(coord_list) = coord_list_attr.as_list() {
                            let mut points: Vec<f32> = Vec::with_capacity(coord_list.len() * 2);
                            for coord in coord_list {
                                if let Some(coords) = coord.as_list() {
                                    let local_x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                                    let local_y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;

                                    // Apply full transform (rotation + translation)
                                    let (wx, wy) = transform.transform_point(local_x, local_y);
                                    let x = wx - rtc_x;
                                    // Negate Y to match section cut coordinate system
                                    let y = -wy + rtc_z;

                                    // Skip invalid coordinates
                                    if x.is_finite() && y.is_finite() {
                                        points.push(x);
                                        points.push(y);
                                    }
                                }
                            }
                            if points.len() >= 4 {
                                let n = points.len();
                                let is_closed = n >= 4
                                    && (points[0] - points[n - 2]).abs() < 0.001
                                    && (points[1] - points[n - 1]).abs() < 0.001;

                                collection.add_polyline(SymbolicPolyline::new(
                                    express_id,
                                    ifc_type.to_string(),
                                    points,
                                    is_closed,
                                    rep_identifier.to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        }
        IfcType::IfcCircle => {
            // IfcCircle: Position (IfcAxis2Placement2D/3D), Radius
            let radius = item.get(1).and_then(|a| a.as_float()).unwrap_or(0.0) as f32 * unit_scale;

            // Skip invalid, degenerate, or unreasonably large radii
            // Radius > 1000 units is likely erroneous data
            if radius <= 0.0 || !radius.is_finite() || radius > 1000.0 {
                return;
            }

            // Get center from Position (attribute 0)
            let (center_x, center_y) = if let Some(pos_ref) = item.get_ref(0) {
                if let Ok(placement) = decoder.decode_by_id(pos_ref) {
                    // IfcAxis2Placement2D/3D: Location
                    if let Some(loc_ref) = placement.get_ref(0) {
                        if let Ok(loc) = decoder.decode_by_id(loc_ref) {
                            if let Some(coords_attr) = loc.get(0) {
                                if let Some(coords) = coords_attr.as_list() {
                                    let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                                    let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                                    (x, y)
                                } else { (0.0, 0.0) }
                            } else { (0.0, 0.0) }
                        } else { (0.0, 0.0) }
                    } else { (0.0, 0.0) }
                } else { (0.0, 0.0) }
            } else { (0.0, 0.0) };

            // Validate center coordinates
            if !center_x.is_finite() || !center_y.is_finite() {
                return;
            }

            // Apply full transform (rotation + translation)
            let (wx, wy) = transform.transform_point(center_x, center_y);
            let world_cx = wx - rtc_x;
            // Negate Y to match section cut coordinate system
            let world_cy = -wy + rtc_z;


            collection.add_circle(SymbolicCircle::full_circle(
                express_id,
                ifc_type.to_string(),
                world_cx,
                world_cy,
                radius,
                rep_identifier.to_string(),
            ));
        }
        IfcType::IfcTrimmedCurve => {
            // IfcTrimmedCurve: BasisCurve, Trim1, Trim2, SenseAgreement, MasterRepresentation
            // For arcs, the basis curve is often IfcCircle
            if let Some(basis_ref) = item.get_ref(0) {
                if let Ok(basis_curve) = decoder.decode_by_id(basis_ref) {
                    if basis_curve.ifc_type == IfcType::IfcCircle {
                        // For simplicity, extract as polyline approximation of the arc
                        // Get radius and center
                        let radius = basis_curve.get(1).and_then(|a| a.as_float()).unwrap_or(0.0) as f32 * unit_scale;

                        // Skip invalid or degenerate radii
                        if radius <= 0.0 || !radius.is_finite() {
                            return;
                        }

                        let (center_x, center_y) = if let Some(pos_ref) = basis_curve.get_ref(0) {
                            if let Ok(placement) = decoder.decode_by_id(pos_ref) {
                                if let Some(loc_ref) = placement.get_ref(0) {
                                    if let Ok(loc) = decoder.decode_by_id(loc_ref) {
                                        if let Some(coords_attr) = loc.get(0) {
                                            if let Some(coords) = coords_attr.as_list() {
                                                let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                                                let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0) as f32 * unit_scale;
                                                (x, y)
                                            } else { (0.0, 0.0) }
                                        } else { (0.0, 0.0) }
                                    } else { (0.0, 0.0) }
                                } else { (0.0, 0.0) }
                            } else { (0.0, 0.0) }
                        } else { (0.0, 0.0) };

                        // Validate center coordinates
                        if !center_x.is_finite() || !center_y.is_finite() {
                            return;
                        }

                        // Get trim parameters (simplified - assume parameter values)
                        let trim1 = item.get(1).and_then(|a| {
                            a.as_list().and_then(|l| l.first().and_then(|v| v.as_float()))
                        }).unwrap_or(0.0) as f32;
                        let trim2 = item.get(2).and_then(|a| {
                            a.as_list().and_then(|l| l.first().and_then(|v| v.as_float()))
                        }).unwrap_or(std::f32::consts::TAU as f64) as f32;


                        // Convert to arc and tessellate as polyline
                        let start_angle = trim1.to_radians().min(trim2.to_radians());
                        let end_angle = trim1.to_radians().max(trim2.to_radians());

                        // Validate angles
                        if !start_angle.is_finite() || !end_angle.is_finite() {
                            return;
                        }

                        // Calculate start and end points for near-collinear detection
                        let start_x = center_x + radius * start_angle.cos();
                        let start_y = center_y + radius * start_angle.sin();
                        let end_x = center_x + radius * end_angle.cos();
                        let end_y = center_y + radius * end_angle.sin();

                        // Calculate chord length
                        let chord_dx = end_x - start_x;
                        let chord_dy = end_y - start_y;
                        let chord_len = (chord_dx * chord_dx + chord_dy * chord_dy).sqrt();

                        // Near-collinear arc detection (from fix-geometry-processing branch):
                        // 1. If radius is extremely large (> 100 units), this is nearly straight
                        // 2. If sagitta (arc height) < 2% of chord length, nearly straight
                        // 3. If radius > 10x chord length, nearly straight
                        let is_near_collinear = if chord_len > 0.0001 {
                            // Calculate sagitta (perpendicular distance from midpoint to chord)
                            let mid_angle = (start_angle + end_angle) / 2.0;
                            let mid_x = center_x + radius * mid_angle.cos();
                            let mid_y = center_y + radius * mid_angle.sin();

                            // Distance from midpoint to chord line
                            let sagitta = ((end_y - start_y) * mid_x - (end_x - start_x) * mid_y
                                          + end_x * start_y - end_y * start_x).abs() / chord_len;

                            radius > 100.0 || sagitta < chord_len * 0.02 || radius > chord_len * 10.0
                        } else {
                            true // Very short arc, treat as point/line
                        };

                        if is_near_collinear {
                            // Emit as simple line segment instead of tessellated arc
                            let (wsx, wsy) = transform.transform_point(start_x, start_y);
                            let (wex, wey) = transform.transform_point(end_x, end_y);
                            // Negate Y to match section cut coordinate system
                            let points = vec![wsx - rtc_x, -wsy + rtc_z, wex - rtc_x, -wey + rtc_z];
                            collection.add_polyline(SymbolicPolyline::new(
                                express_id,
                                ifc_type.to_string(),
                                points,
                                false,
                                rep_identifier.to_string(),
                            ));
                        } else {
                            // Normal arc tessellation
                            let arc_length = (end_angle - start_angle).abs();
                            let num_segments = ((arc_length * radius / 0.1) as usize).max(8).min(64);

                            let mut points = Vec::with_capacity((num_segments + 1) * 2);
                            for i in 0..=num_segments {
                                let t = i as f32 / num_segments as f32;
                                let angle = start_angle + t * (end_angle - start_angle);
                                let local_x = center_x + radius * angle.cos();
                                let local_y = center_y + radius * angle.sin();

                                // Apply full transform (rotation + translation)
                                let (wx, wy) = transform.transform_point(local_x, local_y);
                                let x = wx - rtc_x;
                                // Negate Y to match section cut coordinate system
                                let y = -wy + rtc_z;

                                // Skip NaN/Infinity points
                                if x.is_finite() && y.is_finite() {
                                    points.push(x);
                                    points.push(y);
                                }
                            }

                            // Only add if we have valid points
                            if points.len() >= 4 {
                                collection.add_polyline(SymbolicPolyline::new(
                                    express_id,
                                    ifc_type.to_string(),
                                    points,
                                    false, // Arcs are not closed
                                    rep_identifier.to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        }
        IfcType::IfcCompositeCurve => {
            // IfcCompositeCurve: Segments (LIST of IfcCompositeCurveSegment), SelfIntersect
            if let Some(segments_attr) = item.get(0) {
                if let Ok(segments) = decoder.resolve_ref_list(segments_attr) {
                    for segment in segments {
                        // IfcCompositeCurveSegment: Transition, SameSense, ParentCurve
                        if let Some(curve_ref) = segment.get_ref(2) {
                            if let Ok(parent_curve) = decoder.decode_by_id(curve_ref) {
                                extract_symbolic_item(
                                    &parent_curve,
                                    decoder,
                                    express_id,
                                    ifc_type,
                                    rep_identifier,
                                    unit_scale,
                                    transform,
                                    rtc_x,
                                    rtc_z,
                                    collection,
                                );
                            }
                        }
                    }
                }
            }
        }
        IfcType::IfcLine => {
            // IfcLine: Pnt (IfcCartesianPoint), Dir (IfcVector)
            // Lines are infinite, so we just skip them (or could extract as a segment)
            // For now, skip - symbolic representations usually use polylines
        }
        _ => {
            // Unknown curve type - skip
        }
    }
}

impl Default for IfcAPI {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert ParseEvent to JavaScript object
fn parse_event_to_js(event: &ParseEvent) -> JsValue {
    let obj = js_sys::Object::new();

    match event {
        ParseEvent::Started {
            file_size,
            timestamp,
        } => {
            set_js_prop(&obj, "type", &"started".into());
            set_js_prop(&obj, "fileSize", &(*file_size as f64).into());
            set_js_prop(&obj, "timestamp", &(*timestamp).into());
        }
        ParseEvent::EntityScanned {
            id,
            ifc_type,
            position,
        } => {
            set_js_prop(&obj, "type", &"entityScanned".into());
            set_js_prop(&obj, "id", &(*id as f64).into());
            set_js_prop(&obj, "ifcType", &ifc_type.as_str().into());
            set_js_prop(&obj, "position", &(*position as f64).into());
        }
        ParseEvent::GeometryReady {
            id,
            vertex_count,
            triangle_count,
        } => {
            set_js_prop(&obj, "type", &"geometryReady".into());
            set_js_prop(&obj, "id", &(*id as f64).into());
            set_js_prop(&obj, "vertexCount", &(*vertex_count as f64).into());
            set_js_prop(&obj, "triangleCount", &(*triangle_count as f64).into());
        }
        ParseEvent::Progress {
            phase,
            percent,
            entities_processed,
            total_entities,
        } => {
            set_js_prop(&obj, "type", &"progress".into());
            set_js_prop(&obj, "phase", &phase.as_str().into());
            set_js_prop(&obj, "percent", &(*percent as f64).into());
            set_js_prop(&obj, "entitiesProcessed", &(*entities_processed as f64).into());
            set_js_prop(&obj, "totalEntities", &(*total_entities as f64).into());
        }
        ParseEvent::Completed {
            duration_ms,
            entity_count,
            triangle_count,
        } => {
            set_js_prop(&obj, "type", &"completed".into());
            set_js_prop(&obj, "durationMs", &(*duration_ms).into());
            set_js_prop(&obj, "entityCount", &(*entity_count as f64).into());
            set_js_prop(&obj, "triangleCount", &(*triangle_count as f64).into());
        }
        ParseEvent::Error { message, position } => {
            set_js_prop(&obj, "type", &"error".into());
            set_js_prop(&obj, "message", &message.as_str().into());
            if let Some(pos) = position {
                set_js_prop(&obj, "position", &(*pos as f64).into());
            }
        }
    }

    obj.into()
}

/// Build style index: maps geometry express IDs to RGBA colors
/// Follows the chain: IfcStyledItem → IfcSurfaceStyle → IfcSurfaceStyleRendering → IfcColourRgb
fn build_geometry_style_index(
    content: &str,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> rustc_hash::FxHashMap<u32, [f32; 4]> {
    use ifc_lite_core::EntityScanner;
    use rustc_hash::FxHashMap;

    let mut style_index: FxHashMap<u32, [f32; 4]> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);

    // First pass: find all IfcStyledItem entities
    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        if type_name != "IFCSTYLEDITEM" {
            continue;
        }

        // Decode the IfcStyledItem
        let styled_item = match decoder.decode_at_with_id(id, start, end) {
            Ok(entity) => entity,
            Err(_) => continue,
        };

        // IfcStyledItem: Item (ref to geometry), Styles (list of style refs), Name
        // Attribute 0: Item (geometry reference)
        let geometry_id = match styled_item.get_ref(0) {
            Some(id) => id,
            None => continue,
        };

        // Skip if we already have a color for this geometry
        if style_index.contains_key(&geometry_id) {
            continue;
        }

        // Attribute 1: Styles (list of style assignment refs)
        let styles_attr = match styled_item.get(1) {
            Some(attr) => attr,
            None => continue,
        };

        // Extract color from styles list
        if let Some(color) = extract_color_from_styles(styles_attr, decoder) {
            style_index.insert(geometry_id, color);
        }
    }

    style_index
}

/// Build element style index: maps building element IDs to RGBA colors
/// Follows: Element → IfcProductDefinitionShape → IfcShapeRepresentation → geometry items
fn build_element_style_index(
    content: &str,
    geometry_styles: &rustc_hash::FxHashMap<u32, [f32; 4]>,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> rustc_hash::FxHashMap<u32, [f32; 4]> {
    use ifc_lite_core::EntityScanner;
    use rustc_hash::FxHashMap;

    let mut element_styles: FxHashMap<u32, [f32; 4]> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);

    // Scan all building elements
    while let Some((element_id, type_name, start, end)) = scanner.next_entity() {
        // Check if this is a building element type
        if !ifc_lite_core::has_geometry_by_name(type_name) {
            continue;
        }

        // Decode the element
        let element = match decoder.decode_at_with_id(element_id, start, end) {
            Ok(entity) => entity,
            Err(_) => continue,
        };

        // Building elements have Representation attribute at index 6
        // IfcProduct: GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation
        let repr_id = match element.get_ref(6) {
            Some(id) => id,
            None => continue,
        };

        // Decode IfcProductDefinitionShape
        let product_shape = match decoder.decode_by_id(repr_id) {
            Ok(entity) => entity,
            Err(_) => continue,
        };

        // IfcProductDefinitionShape: Name, Description, Representations (list)
        // Attribute 2: Representations
        let reprs_attr = match product_shape.get(2) {
            Some(attr) => attr,
            None => continue,
        };

        let reprs_list = match reprs_attr.as_list() {
            Some(list) => list,
            None => continue,
        };

        // Look through representations for geometry with styles
        for repr_item in reprs_list {
            let shape_repr_id = match repr_item.as_entity_ref() {
                Some(id) => id,
                None => continue,
            };

            // Decode IfcShapeRepresentation
            let shape_repr = match decoder.decode_by_id(shape_repr_id) {
                Ok(entity) => entity,
                Err(_) => continue,
            };

            // IfcShapeRepresentation: ContextOfItems, RepresentationIdentifier, RepresentationType, Items
            // Attribute 3: Items (list of geometry items)
            let items_attr = match shape_repr.get(3) {
                Some(attr) => attr,
                None => continue,
            };

            let items_list = match items_attr.as_list() {
                Some(list) => list,
                None => continue,
            };

            // Check each geometry item for a style
            for geom_item in items_list {
                let geom_id = match geom_item.as_entity_ref() {
                    Some(id) => id,
                    None => continue,
                };

                // Check if this geometry has a style, following MappedItem references if needed
                if let Some(color) =
                    find_color_for_geometry(geom_id, geometry_styles, decoder)
                {
                    element_styles.insert(element_id, color);
                    break; // Found a color for this element
                }
            }

            // If we found a color, stop looking at more representations
            if element_styles.contains_key(&element_id) {
                break;
            }
        }
    }

    element_styles
}

/// Find color for a geometry item, following MappedItem references if needed.
/// This handles the case where IfcStyledItem points to geometry inside a MappedRepresentation,
/// not to the MappedItem itself.
fn find_color_for_geometry(
    geom_id: u32,
    geometry_styles: &rustc_hash::FxHashMap<u32, [f32; 4]>,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<[f32; 4]> {
    use ifc_lite_core::IfcType;

    // First check if this geometry ID directly has a color
    if let Some(&color) = geometry_styles.get(&geom_id) {
        return Some(color);
    }

    // If not, check if it's an IfcMappedItem and follow the reference
    let geom = decoder.decode_by_id(geom_id).ok()?;

    if geom.ifc_type == IfcType::IfcMappedItem {
        // IfcMappedItem: MappingSource (IfcRepresentationMap ref), MappingTarget
        let map_source_id = geom.get_ref(0)?;

        // Decode the IfcRepresentationMap
        let rep_map = decoder.decode_by_id(map_source_id).ok()?;

        // IfcRepresentationMap: MappingOrigin (IfcAxis2Placement), MappedRepresentation (IfcShapeRepresentation)
        let mapped_repr_id = rep_map.get_ref(1)?;

        // Decode the mapped IfcShapeRepresentation
        let mapped_repr = decoder.decode_by_id(mapped_repr_id).ok()?;

        // IfcShapeRepresentation: ContextOfItems, RepresentationIdentifier, RepresentationType, Items
        // Attribute 3: Items (list of geometry items)
        let items_attr = mapped_repr.get(3)?;
        let items_list = items_attr.as_list()?;

        // Check each underlying geometry item for a color
        for item in items_list {
            if let Some(underlying_geom_id) = item.as_entity_ref() {
                // Recursively find color (handles nested MappedItems)
                if let Some(color) =
                    find_color_for_geometry(underlying_geom_id, geometry_styles, decoder)
                {
                    return Some(color);
                }
            }
        }
    }

    None
}

/// Extract RGBA color from IfcStyledItem.Styles attribute
fn extract_color_from_styles(
    styles_attr: &ifc_lite_core::AttributeValue,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<[f32; 4]> {
    // Styles can be a list or a single reference
    if let Some(list) = styles_attr.as_list() {
        for item in list {
            if let Some(style_id) = item.as_entity_ref() {
                if let Some(color) = extract_color_from_style_assignment(style_id, decoder) {
                    return Some(color);
                }
            }
        }
    } else if let Some(style_id) = styles_attr.as_entity_ref() {
        return extract_color_from_style_assignment(style_id, decoder);
    }

    None
}

/// Extract color from IfcPresentationStyleAssignment or IfcSurfaceStyle
fn extract_color_from_style_assignment(
    style_id: u32,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<[f32; 4]> {
    use ifc_lite_core::IfcType;

    let style = decoder.decode_by_id(style_id).ok()?;

    match style.ifc_type {
        IfcType::IfcPresentationStyle => {
            // IfcPresentationStyle has Styles at attr 0
            let styles_attr = style.get(0)?;
            if let Some(list) = styles_attr.as_list() {
                for item in list {
                    if let Some(inner_id) = item.as_entity_ref() {
                        if let Some(color) = extract_color_from_surface_style(inner_id, decoder) {
                            return Some(color);
                        }
                    }
                }
            }
        }
        IfcType::IfcSurfaceStyle => {
            return extract_color_from_surface_style(style_id, decoder);
        }
        _ => {
            // FIX: Handle IfcPresentationStyleAssignment (IFC2x3 entity not in IFC4 schema)
            // IfcPresentationStyleAssignment has Styles list at attribute 0
            // It's decoded as Unknown type, so we check by structure
            let styles_attr = style.get(0)?;
            if let Some(list) = styles_attr.as_list() {
                for item in list {
                    if let Some(inner_id) = item.as_entity_ref() {
                        if let Some(color) = extract_color_from_surface_style(inner_id, decoder) {
                            return Some(color);
                        }
                    }
                }
            }
        }
    }

    None
}

/// Extract color from IfcSurfaceStyle
fn extract_color_from_surface_style(
    style_id: u32,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<[f32; 4]> {
    use ifc_lite_core::IfcType;

    let style = decoder.decode_by_id(style_id).ok()?;

    if style.ifc_type != IfcType::IfcSurfaceStyle {
        return None;
    }

    // IfcSurfaceStyle: Name, Side, Styles (list of surface style elements)
    // Attribute 2: Styles
    let styles_attr = style.get(2)?;

    if let Some(list) = styles_attr.as_list() {
        for item in list {
            if let Some(element_id) = item.as_entity_ref() {
                if let Some(color) = extract_color_from_rendering(element_id, decoder) {
                    return Some(color);
                }
            }
        }
    }

    None
}

/// Extract color from IfcSurfaceStyleRendering or IfcSurfaceStyleShading
fn extract_color_from_rendering(
    rendering_id: u32,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<[f32; 4]> {
    use ifc_lite_core::IfcType;

    let rendering = decoder.decode_by_id(rendering_id).ok()?;

    match rendering.ifc_type {
        IfcType::IfcSurfaceStyleRendering | IfcType::IfcSurfaceStyleShading => {
            // Attr 0: SurfaceColour (inherited from IfcSurfaceStyleShading)
            // Attr 1: Transparency (inherited, 0.0=opaque, 1.0=transparent)
            let color_ref = rendering.get_ref(0)?;
            let [r, g, b, _] = extract_color_rgb(color_ref, decoder)?;
            
            // Read transparency and convert to alpha
            // Transparency: 0.0 = opaque, 1.0 = fully transparent
            // Alpha: 1.0 = opaque, 0.0 = fully transparent
            // So: alpha = 1.0 - transparency
            let transparency = rendering.get_float(1).unwrap_or(0.0);
            let alpha = 1.0 - transparency as f32;
            
            return Some([r, g, b, alpha.max(0.0).min(1.0)]);
        }
        _ => {}
    }

    None
}

/// Extract RGB color from IfcColourRgb
fn extract_color_rgb(
    color_id: u32,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<[f32; 4]> {
    use ifc_lite_core::IfcType;

    let color = decoder.decode_by_id(color_id).ok()?;

    if color.ifc_type != IfcType::IfcColourRgb {
        return None;
    }

    // IfcColourRgb: Name, Red, Green, Blue
    // Note: In IFC2x3, attributes are at indices 1, 2, 3 (0 is Name)
    // In IFC4, attributes are also at 1, 2, 3
    let red = color.get_float(1).unwrap_or(0.8);
    let green = color.get_float(2).unwrap_or(0.8);
    let blue = color.get_float(3).unwrap_or(0.8);

    Some([red as f32, green as f32, blue as f32, 1.0])
}

/// Get default color for IFC type (matches default-materials.ts)
fn get_default_color_for_type(ifc_type: &ifc_lite_core::IfcType) -> [f32; 4] {
    use ifc_lite_core::IfcType;

    match ifc_type {
        // Walls - light gray
        IfcType::IfcWall | IfcType::IfcWallStandardCase => [0.85, 0.85, 0.85, 1.0],

        // Slabs - darker gray
        IfcType::IfcSlab => [0.7, 0.7, 0.7, 1.0],

        // Roofs - brown-ish
        IfcType::IfcRoof => [0.6, 0.5, 0.4, 1.0],

        // Columns/Beams - steel gray
        IfcType::IfcColumn | IfcType::IfcBeam | IfcType::IfcMember => [0.6, 0.65, 0.7, 1.0],

        // Windows - light blue transparent
        IfcType::IfcWindow => [0.6, 0.8, 1.0, 0.4],

        // Doors - wood brown
        IfcType::IfcDoor => [0.6, 0.45, 0.3, 1.0],

        // Stairs
        IfcType::IfcStair => [0.75, 0.75, 0.75, 1.0],

        // Railings
        IfcType::IfcRailing => [0.4, 0.4, 0.45, 1.0],

        // Plates/Coverings
        IfcType::IfcPlate | IfcType::IfcCovering => [0.8, 0.8, 0.8, 1.0],

        // Curtain walls - glass blue
        IfcType::IfcCurtainWall => [0.5, 0.7, 0.9, 0.5],

        // Furniture - wood
        IfcType::IfcFurnishingElement => [0.7, 0.55, 0.4, 1.0],

        // Spaces - cyan transparent (matches MainToolbar)
        IfcType::IfcSpace => [0.2, 0.85, 1.0, 0.3],

        // Opening elements - red-orange transparent
        IfcType::IfcOpeningElement => [1.0, 0.42, 0.29, 0.4],

        // Site - green
        IfcType::IfcSite => [0.4, 0.8, 0.3, 1.0],

        // Default gray
        _ => [0.8, 0.8, 0.8, 1.0],
    }
}

/// Extract building rotation from IfcSite's top-level placement
/// Returns rotation angle in radians, or None if not found
fn extract_building_rotation(
    content: &str,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<f64> {
    use ifc_lite_core::EntityScanner;

    let mut scanner = EntityScanner::new(content);

    // Find IfcSite entity
    while let Some((site_id, type_name, start, end)) = scanner.next_entity() {
        if type_name != "IFCSITE" {
            continue;
        }

        // Decode IfcSite
        if let Ok(site_entity) = decoder.decode_at_with_id(site_id, start, end) {
            // Get ObjectPlacement (attribute 5 for IfcProduct)
            let placement_attr = match site_entity.get(5) {
                Some(attr) if !attr.is_null() => attr,
                _ => continue,
            };

            // Resolve placement
            let placement = match decoder.resolve_ref(placement_attr) {
                Ok(Some(p)) => p,
                _ => continue,
            };

            // Find top-level placement (parent is null)
            let top_level_placement = find_top_level_placement(&placement, decoder);
            
            // Extract rotation from top-level placement's RefDirection
            if let Some(rotation) = extract_rotation_from_placement(&top_level_placement, decoder) {
                return Some(rotation);
            }
        }
    }

    None
}

/// Find the top-level placement (one with null parent)
fn find_top_level_placement(
    placement: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> ifc_lite_core::DecodedEntity {
    use ifc_lite_core::IfcType;

    // Check if this is a local placement
    if placement.ifc_type != IfcType::IfcLocalPlacement {
        return placement.clone();
    }

    // Check parent (attribute 0: PlacementRelTo)
    let parent_attr = match placement.get(0) {
        Some(attr) if !attr.is_null() => attr,
        _ => return placement.clone(), // No parent - this is top-level
    };

    // Resolve parent and recurse
    if let Ok(Some(parent)) = decoder.resolve_ref(parent_attr) {
        find_top_level_placement(&parent, decoder)
    } else {
        placement.clone() // Parent resolution failed - return current
    }
}

/// Extract rotation angle from IfcAxis2Placement3D's RefDirection
/// Returns rotation angle in radians (atan2 of RefDirection Y/X components)
fn extract_rotation_from_placement(
    placement: &ifc_lite_core::DecodedEntity,
    decoder: &mut ifc_lite_core::EntityDecoder,
) -> Option<f64> {
    use ifc_lite_core::IfcType;

    // Get RelativePlacement (attribute 1: IfcAxis2Placement3D)
    let rel_attr = match placement.get(1) {
        Some(attr) if !attr.is_null() => attr,
        _ => return None,
    };

    let axis_placement = match decoder.resolve_ref(rel_attr) {
        Ok(Some(p)) => p,
        _ => return None,
    };

    // Check if it's IfcAxis2Placement3D
    if axis_placement.ifc_type != IfcType::IfcAxis2Placement3D {
        return None;
    }

    // Get RefDirection (attribute 2: IfcDirection)
    let ref_dir_attr = match axis_placement.get(2) {
        Some(attr) if !attr.is_null() => attr,
        _ => return None,
    };

    let ref_dir = match decoder.resolve_ref(ref_dir_attr) {
        Ok(Some(d)) => d,
        _ => return None,
    };

    if ref_dir.ifc_type != IfcType::IfcDirection {
        return None;
    }

    // Get direction ratios (attribute 0: list of floats)
    let ratios_attr = match ref_dir.get(0) {
        Some(attr) => attr,
        _ => return None,
    };

    let ratios = match ratios_attr.as_list() {
        Some(list) => list,
        _ => return None,
    };

    // Extract X and Y components (Z is up in IFC)
    let dx = ratios.first().and_then(|v| v.as_float()).unwrap_or(0.0);
    let dy = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);

    // Calculate rotation angle: atan2(dy, dx)
    // This gives the angle of the building's X-axis relative to world X-axis
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-10 {
        return None; // Zero-length direction
    }

    let rotation = dy.atan2(dx);
    Some(rotation)
}

/// Safely set a property on a JavaScript object.
/// Returns true if successful, false otherwise.
/// This avoids panicking on edge cases like non-extensible objects.
#[inline]
fn set_js_prop(obj: &JsValue, key: &str, value: &JsValue) -> bool {
    js_sys::Reflect::set(obj, &JsValue::from_str(key), value).unwrap_or(false)
}

/// Safely set a property on a JavaScript object using JsValue key.
/// Returns true if successful, false otherwise.
#[inline]
fn set_js_prop_jv(obj: &JsValue, key: &JsValue, value: &JsValue) -> bool {
    js_sys::Reflect::set(obj, key, value).unwrap_or(false)
}

/// Convert entity counts map to JavaScript object
fn counts_to_js(counts: &rustc_hash::FxHashMap<String, usize>) -> JsValue {
    let obj = js_sys::Object::new();

    for (type_name, count) in counts {
        let key = JsValue::from_str(type_name.as_str());
        let value = JsValue::from_f64(*count as f64);
        set_js_prop_jv(&obj, &key, &value);
    }

    obj.into()
}
