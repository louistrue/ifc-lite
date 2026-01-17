// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! JavaScript API for IFC-Lite
//!
//! Modern async/await API for parsing IFC files.

use crate::gpu_geometry::{GpuGeometry, GpuInstancedGeometry, GpuInstancedGeometryCollection};
use crate::zero_copy::{
    InstanceData, InstancedGeometry, InstancedMeshCollection, MeshCollection, MeshDataJs,
    ZeroCopyMesh,
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

        let promise = Promise::new(&mut |resolve, _reject| {
            let content = content.clone();
            let callback = callback.clone();
            spawn_local(async move {
                let config = StreamConfig::default();
                let mut stream = ifc_lite_core::parse_stream(&content, config);

                while let Some(event) = stream.next().await {
                    // Convert event to JsValue and call callback
                    let event_obj = parse_event_to_js(&event);
                    let _ = callback.call1(&JsValue::NULL, &event_obj);

                    // Check if this is the completion event
                    if matches!(event, ParseEvent::Completed { .. }) {
                        resolve.call0(&JsValue::NULL).unwrap();
                        return;
                    }
                }

                resolve.call0(&JsValue::NULL).unwrap();
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
        let promise = Promise::new(&mut |resolve, _reject| {
            let content = content.clone();
            spawn_local(async move {
                // Quick scan to get entity count
                let mut scanner = EntityScanner::new(&content);
                let counts = scanner.count_by_type();

                let total_entities: usize = counts.values().sum();

                // Create result object
                let result = js_sys::Object::new();
                js_sys::Reflect::set(
                    &result,
                    &"entityCount".into(),
                    &JsValue::from_f64(total_entities as f64),
                )
                .unwrap();

                js_sys::Reflect::set(&result, &"entityTypes".into(), &counts_to_js(&counts))
                    .unwrap();

                resolve.call1(&JsValue::NULL, &result).unwrap();
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
        while let Some((_id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            // Decode and process the entity
            if let Ok(entity) = decoder.decode_at(start, end) {
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
        if combined_mesh.normals.is_empty() && !combined_mesh.positions.is_empty() {
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
                if let Ok(entity) = decoder.decode_at(start, end) {
                    if let (Some(host_id), Some(opening_id)) =
                        (entity.get_ref(4), entity.get_ref(5))
                    {
                        void_index.entry(host_id).or_default().push(opening_id);
                    }
                }
            }
        }

        // Create geometry router (reuses processor instances)
        let router = GeometryRouter::with_units(&content, &mut decoder);

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

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            // Decode and process the entity
            if let Ok(entity) = decoder.decode_at(start, end) {
                // Check if entity actually has representation (attribute index 6 for IfcProduct)
                let has_representation = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                if !has_representation {
                    continue;
                }

                if let Ok(mut mesh) =
                    router.process_element_with_voids(&entity, &mut decoder, &void_index)
                {
                    if !mesh.is_empty() {
                        // Calculate normals if not present
                        if mesh.normals.is_empty() {
                            calculate_normals(&mut mesh);
                        }

                        // Try to get color from style index, otherwise use default
                        let color = style_index
                            .get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        // Create mesh data with express ID, IFC type, and color
                        let ifc_type_name = entity.ifc_type.name().to_string();
                        let mesh_data = MeshDataJs::new(id, ifc_type_name, mesh, color);
                        mesh_collection.add(mesh_data);
                    }
                }
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
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let Ok((mut mesh, transform)) =
                    router.process_element_with_transform(&entity, &mut decoder)
                {
                    if !mesh.is_empty() {
                        // Calculate normals if not present
                        if mesh.normals.is_empty() {
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
                        if let Ok(entity) = decoder.decode_at(start, end) {
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
                                js_sys::Reflect::set(&progress, &"percent".into(), &0u32.into())
                                    .unwrap();
                                js_sys::Reflect::set(
                                    &progress,
                                    &"processed".into(),
                                    &(processed as f64).into(),
                                )
                                .unwrap();
                                js_sys::Reflect::set(&progress, &"phase".into(), &"simple".into())
                                    .unwrap();

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
                        js_sys::Reflect::set(&progress, &"phase".into(), &"simple_complete".into())
                            .unwrap();

                        let _ = callback.call2(&JsValue::NULL, &js_geometries, &progress);
                    }

                    gloo_timers::future::TimeoutFuture::new(0).await;
                }

                // Process deferred complex geometry
                let total_elements = processed + deferred_complex.len();
                for (id, start, end, ifc_type) in deferred_complex {
                    if let Ok(entity) = decoder.decode_at(start, end) {
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
                            js_sys::Reflect::set(&progress, &"percent".into(), &percent.into())
                                .unwrap();
                            js_sys::Reflect::set(
                                &progress,
                                &"processed".into(),
                                &(processed as f64).into(),
                            )
                            .unwrap();
                            js_sys::Reflect::set(
                                &progress,
                                &"total".into(),
                                &(total_elements as f64).into(),
                            )
                            .unwrap();
                            js_sys::Reflect::set(&progress, &"phase".into(), &"complex".into())
                                .unwrap();

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
                        js_sys::Reflect::set(&progress, &"percent".into(), &100u32.into()).unwrap();
                        js_sys::Reflect::set(&progress, &"phase".into(), &"complete".into())
                            .unwrap();

                        let _ = callback.call2(&JsValue::NULL, &js_geometries, &progress);
                    }
                }

                // Call completion callback
                if let Some(ref callback) = on_complete {
                    let stats = js_sys::Object::new();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalGeometries".into(),
                        &(total_geometries as f64).into(),
                    )
                    .unwrap();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalInstances".into(),
                        &(total_instances as f64).into(),
                    )
                    .unwrap();
                    let _ = callback.call1(&JsValue::NULL, &stats);
                }

                resolve.call0(&JsValue::NULL).unwrap();
            });
        });

        promise
    }

    /// Parse IFC file with streaming mesh batches for progressive rendering
    /// Calls the callback with batches of meshes, yielding to browser between batches
    ///
    /// Example:
    /// ```javascript
    /// const api = new IfcAPI();
    /// await api.parseMeshesAsync(ifcData, {
    ///   batchSize: 100,
    ///   onBatch: (meshes, progress) => {
    ///     // Add meshes to scene
    ///     for (const mesh of meshes) {
    ///       scene.add(createThreeMesh(mesh));
    ///     }
    ///     console.log(`Progress: ${progress.percent}%`);
    ///   },
    ///   onComplete: (stats) => {
    ///     console.log(`Done! ${stats.totalMeshes} meshes`);
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

                // LAZY INDEXING: Don't build full index upfront
                // Index will be built on first reference resolution
                let mut decoder = EntityDecoder::new(&content);

                // Create geometry router
                let router = GeometryRouter::with_units(&content, &mut decoder);

                // Process counters
                let mut processed = 0;
                let mut total_meshes = 0;
                let mut total_vertices = 0;
                let mut total_triangles = 0;
                let mut batch_meshes: Vec<MeshDataJs> = Vec::with_capacity(batch_size);

                // SINGLE PASS: Process elements as we find them
                let mut scanner = EntityScanner::new(&content);
                let mut deferred_complex: Vec<(u32, usize, usize, ifc_lite_core::IfcType)> =
                    Vec::new();
                let mut faceted_brep_ids: Vec<u32> = Vec::new(); // Collect for batch preprocessing

                // First pass - process simple geometry immediately, defer complex
                while let Some((id, type_name, start, end)) = scanner.next_entity() {
                    // Track FacetedBrep IDs for batch preprocessing
                    if type_name == "IFCFACETEDBREP" {
                        faceted_brep_ids.push(id);
                    }

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
                        if let Ok(entity) = decoder.decode_at(start, end) {
                            // Check if entity actually has representation
                            let has_representation =
                                entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                            if has_representation {
                                if let Ok(mut mesh) = router.process_element(&entity, &mut decoder)
                                {
                                    if !mesh.is_empty() {
                                        if mesh.normals.is_empty() {
                                            calculate_normals(&mut mesh);
                                        }

                                        let color = get_default_color_for_type(&ifc_type);
                                        total_vertices += mesh.positions.len() / 3;
                                        total_triangles += mesh.indices.len() / 3;

                                        let ifc_type_name = ifc_type.name().to_string();
                                        let mesh_data =
                                            MeshDataJs::new(id, ifc_type_name, mesh, color);
                                        batch_meshes.push(mesh_data);
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
                                js_sys::Reflect::set(&progress, &"percent".into(), &0u32.into())
                                    .unwrap();
                                js_sys::Reflect::set(
                                    &progress,
                                    &"processed".into(),
                                    &(processed as f64).into(),
                                )
                                .unwrap();
                                js_sys::Reflect::set(&progress, &"phase".into(), &"simple".into())
                                    .unwrap();

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
                        js_sys::Reflect::set(&progress, &"phase".into(), &"simple_complete".into())
                            .unwrap();

                        let _ = callback.call2(&JsValue::NULL, &js_meshes, &progress);
                        total_meshes += js_meshes.length() as usize;
                    }

                    gloo_timers::future::TimeoutFuture::new(0).await;
                }

                let total_elements = processed + deferred_complex.len();

                // CRITICAL: Batch preprocess FacetedBreps BEFORE complex phase
                // This triangulates ALL faces in parallel - massive speedup for repeated geometry
                if !faceted_brep_ids.is_empty() {
                    router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
                }

                // Process deferred complex geometry
                // Build style index now (deferred from start)
                let geometry_styles = build_geometry_style_index(&content, &mut decoder);
                let style_index =
                    build_element_style_index(&content, &geometry_styles, &mut decoder);

                for (id, start, end, ifc_type) in deferred_complex {
                    if let Ok(entity) = decoder.decode_at(start, end) {
                        if let Ok(mut mesh) = router.process_element(&entity, &mut decoder) {
                            if !mesh.is_empty() {
                                if mesh.normals.is_empty() {
                                    calculate_normals(&mut mesh);
                                }

                                let color = style_index
                                    .get(&id)
                                    .copied()
                                    .unwrap_or_else(|| get_default_color_for_type(&ifc_type));

                                total_vertices += mesh.positions.len() / 3;
                                total_triangles += mesh.indices.len() / 3;

                                let ifc_type_name = ifc_type.name().to_string();
                                let mesh_data = MeshDataJs::new(id, ifc_type_name, mesh, color);
                                batch_meshes.push(mesh_data);
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
                            js_sys::Reflect::set(&progress, &"percent".into(), &percent.into())
                                .unwrap();
                            js_sys::Reflect::set(
                                &progress,
                                &"processed".into(),
                                &(processed as f64).into(),
                            )
                            .unwrap();
                            js_sys::Reflect::set(
                                &progress,
                                &"total".into(),
                                &(total_elements as f64).into(),
                            )
                            .unwrap();
                            js_sys::Reflect::set(&progress, &"phase".into(), &"complex".into())
                                .unwrap();

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
                        js_sys::Reflect::set(&progress, &"percent".into(), &100u32.into()).unwrap();
                        js_sys::Reflect::set(&progress, &"phase".into(), &"complete".into())
                            .unwrap();

                        let _ = callback.call2(&JsValue::NULL, &js_meshes, &progress);
                        total_meshes += js_meshes.length() as usize;
                    }
                }

                // Call completion callback
                if let Some(ref callback) = on_complete {
                    let stats = js_sys::Object::new();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalMeshes".into(),
                        &(total_meshes as f64).into(),
                    )
                    .unwrap();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalVertices".into(),
                        &(total_vertices as f64).into(),
                    )
                    .unwrap();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalTriangles".into(),
                        &(total_triangles as f64).into(),
                    )
                    .unwrap();
                    let _ = callback.call1(&JsValue::NULL, &stats);
                }

                resolve.call0(&JsValue::NULL).unwrap();
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

            if let Ok(entity) = decoder.decode_at(start, end) {
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
                if let Ok(entity) = decoder.decode_at(start, end) {
                    if let (Some(host_id), Some(opening_id)) =
                        (entity.get_ref(4), entity.get_ref(5))
                    {
                        void_index.entry(host_id).or_default().push(opening_id);
                    }
                }
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

        // Estimate capacity
        let estimated_vertices = content.len() / 50; // Rough estimate
        let estimated_indices = estimated_vertices * 2;
        let mut gpu_geometry = GpuGeometry::with_capacity(estimated_vertices * 6, estimated_indices);

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            if let Ok(entity) = decoder.decode_at(start, end) {
                // Check if entity has representation
                let has_representation = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                if !has_representation {
                    continue;
                }

                if let Ok(mut mesh) =
                    router.process_element_with_voids(&entity, &mut decoder, &void_index)
                {
                    if !mesh.is_empty() {
                        // Calculate normals if not present
                        if mesh.normals.is_empty() {
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
                        if let Ok(entity) = decoder.decode_at(start, end) {
                            if let (Some(host_id), Some(opening_id)) =
                                (entity.get_ref(4), entity.get_ref(5))
                            {
                                void_index.entry(host_id).or_default().push(opening_id);
                            }
                        }
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

                // Processing state
                let mut current_batch = GpuGeometry::with_capacity(batch_size * 1000, batch_size * 3000);
                let mut processed = 0;
                let mut total_meshes = 0;
                let mut total_vertices = 0;
                let mut total_triangles = 0;
                let mut deferred_complex: Vec<(u32, usize, usize, ifc_lite_core::IfcType)> =
                    Vec::new();

                // Helper to flush current batch
                let flush_batch = |batch: &mut GpuGeometry,
                                   on_batch: &Option<Function>,
                                   progress: &JsValue| {
                    if batch.mesh_count() == 0 {
                        return;
                    }

                    if let Some(ref callback) = on_batch {
                        // Swap out the batch
                        let to_send =
                            std::mem::replace(batch, GpuGeometry::with_capacity(1000, 3000));
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
                        if let Ok(entity) = decoder.decode_at(start, end) {
                            let has_representation =
                                entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                            if has_representation {
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
                            js_sys::Reflect::set(&progress, &"percent".into(), &0u32.into())
                                .unwrap();
                            js_sys::Reflect::set(
                                &progress,
                                &"processed".into(),
                                &(processed as f64).into(),
                            )
                            .unwrap();
                            js_sys::Reflect::set(&progress, &"phase".into(), &"simple".into())
                                .unwrap();

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
                    js_sys::Reflect::set(&progress, &"phase".into(), &"simple_complete".into())
                        .unwrap();
                    flush_batch(&mut current_batch, &on_batch, &progress.into());
                    gloo_timers::future::TimeoutFuture::new(0).await;
                }

                // Process deferred complex geometry
                let total_elements = processed + deferred_complex.len();
                for (id, start, end, ifc_type) in deferred_complex {
                    if let Ok(entity) = decoder.decode_at(start, end) {
                        if let Ok(mut mesh) =
                            router.process_element_with_voids(&entity, &mut decoder, &void_index)
                        {
                            if !mesh.is_empty() {
                                if mesh.normals.is_empty() {
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
                        js_sys::Reflect::set(&progress, &"percent".into(), &percent.into()).unwrap();
                        js_sys::Reflect::set(
                            &progress,
                            &"processed".into(),
                            &(processed as f64).into(),
                        )
                        .unwrap();
                        js_sys::Reflect::set(
                            &progress,
                            &"total".into(),
                            &(total_elements as f64).into(),
                        )
                        .unwrap();
                        js_sys::Reflect::set(&progress, &"phase".into(), &"complex".into()).unwrap();

                        flush_batch(&mut current_batch, &on_batch, &progress.into());
                        gloo_timers::future::TimeoutFuture::new(0).await;
                    }
                }

                // Final flush
                if current_batch.mesh_count() > 0 {
                    let progress = js_sys::Object::new();
                    js_sys::Reflect::set(&progress, &"percent".into(), &100u32.into()).unwrap();
                    js_sys::Reflect::set(&progress, &"phase".into(), &"complete".into()).unwrap();
                    flush_batch(&mut current_batch, &on_batch, &progress.into());
                }

                // Call completion callback
                if let Some(ref callback) = on_complete {
                    let stats = js_sys::Object::new();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalMeshes".into(),
                        &(total_meshes as f64).into(),
                    )
                    .unwrap();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalVertices".into(),
                        &(total_vertices as f64).into(),
                    )
                    .unwrap();
                    js_sys::Reflect::set(
                        &stats,
                        &"totalTriangles".into(),
                        &(total_triangles as f64).into(),
                    )
                    .unwrap();
                    let _ = callback.call1(&JsValue::NULL, &stats);
                }

                resolve.call0(&JsValue::NULL).unwrap();
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

            if let Ok(entity) = decoder.decode_at(start, end) {
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
                match decoder.decode_at(start, end) {
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
                    match decoder.decode_at(start, end) {
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
            js_sys::Reflect::set(&obj, &"type".into(), &"started".into()).unwrap();
            js_sys::Reflect::set(&obj, &"fileSize".into(), &(*file_size as f64).into()).unwrap();
            js_sys::Reflect::set(&obj, &"timestamp".into(), &(*timestamp).into()).unwrap();
        }
        ParseEvent::EntityScanned {
            id,
            ifc_type,
            position,
        } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"entityScanned".into()).unwrap();
            js_sys::Reflect::set(&obj, &"id".into(), &(*id as f64).into()).unwrap();
            js_sys::Reflect::set(&obj, &"ifcType".into(), &ifc_type.as_str().into()).unwrap();
            js_sys::Reflect::set(&obj, &"position".into(), &(*position as f64).into()).unwrap();
        }
        ParseEvent::GeometryReady {
            id,
            vertex_count,
            triangle_count,
        } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"geometryReady".into()).unwrap();
            js_sys::Reflect::set(&obj, &"id".into(), &(*id as f64).into()).unwrap();
            js_sys::Reflect::set(&obj, &"vertexCount".into(), &(*vertex_count as f64).into())
                .unwrap();
            js_sys::Reflect::set(
                &obj,
                &"triangleCount".into(),
                &(*triangle_count as f64).into(),
            )
            .unwrap();
        }
        ParseEvent::Progress {
            phase,
            percent,
            entities_processed,
            total_entities,
        } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"progress".into()).unwrap();
            js_sys::Reflect::set(&obj, &"phase".into(), &phase.as_str().into()).unwrap();
            js_sys::Reflect::set(&obj, &"percent".into(), &(*percent as f64).into()).unwrap();
            js_sys::Reflect::set(
                &obj,
                &"entitiesProcessed".into(),
                &(*entities_processed as f64).into(),
            )
            .unwrap();
            js_sys::Reflect::set(
                &obj,
                &"totalEntities".into(),
                &(*total_entities as f64).into(),
            )
            .unwrap();
        }
        ParseEvent::Completed {
            duration_ms,
            entity_count,
            triangle_count,
        } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"completed".into()).unwrap();
            js_sys::Reflect::set(&obj, &"durationMs".into(), &(*duration_ms).into()).unwrap();
            js_sys::Reflect::set(&obj, &"entityCount".into(), &(*entity_count as f64).into())
                .unwrap();
            js_sys::Reflect::set(
                &obj,
                &"triangleCount".into(),
                &(*triangle_count as f64).into(),
            )
            .unwrap();
        }
        ParseEvent::Error { message, position } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"error".into()).unwrap();
            js_sys::Reflect::set(&obj, &"message".into(), &message.as_str().into()).unwrap();
            if let Some(pos) = position {
                js_sys::Reflect::set(&obj, &"position".into(), &(*pos as f64).into()).unwrap();
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
    while let Some((_id, type_name, start, end)) = scanner.next_entity() {
        if type_name != "IFCSTYLEDITEM" {
            continue;
        }

        // Decode the IfcStyledItem
        let styled_item = match decoder.decode_at(start, end) {
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
        let element = match decoder.decode_at(start, end) {
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

                // Check if this geometry has a style
                if let Some(&color) = geometry_styles.get(&geom_id) {
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
            // IfcPresentationStyleAssignment: Styles (list)
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
        _ => {}
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
            // Both have SurfaceColour as attribute 0
            let color_ref = rendering.get_ref(0)?;
            return extract_color_rgb(color_ref, decoder);
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

/// Convert entity counts map to JavaScript object
fn counts_to_js(counts: &rustc_hash::FxHashMap<String, usize>) -> JsValue {
    let obj = js_sys::Object::new();

    for (type_name, count) in counts {
        let key = JsValue::from_str(type_name.as_str());
        let value = JsValue::from_f64(*count as f64);
        js_sys::Reflect::set(&obj, &key, &value).unwrap();
    }

    obj.into()
}
