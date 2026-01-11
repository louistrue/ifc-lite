//! JavaScript API for IFC-Lite
//!
//! Modern async/await API for parsing IFC files.

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;
use js_sys::{Function, Promise};
use ifc_lite_core::{EntityScanner, ParseEvent, StreamConfig};
use crate::zero_copy::ZeroCopyMesh;

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

        Self {
            initialized: true,
        }
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
        // Make synchronous for now - async spawn_local doesn't work reliably in Node.js

        // DEBUG: Log entry
        web_sys::console::log_1(&format!(
            "[IFC-Lite] parseZeroCopy called with {} bytes",
            content.len()
        ).into());

        // Parse IFC file and generate geometry
        use ifc_lite_core::{EntityScanner, EntityDecoder};
        use ifc_lite_geometry::{GeometryRouter, Mesh, calculate_normals};

        let mut combined_mesh = Mesh::new();

        // Create scanner and decoder
        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::new(&content);

        // Create geometry router
        let router = GeometryRouter::new();

        // Process all building elements
        let mut processed_count = 0;
        let mut error_count = 0;
        let mut building_elements_found = 0;
        let mut error_types: rustc_hash::FxHashMap<String, usize> = rustc_hash::FxHashMap::default();

        while let Some((_id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            let ifc_type = ifc_lite_core::IfcType::from_str(type_name);
            if let Some(ifc_type) = ifc_type {
                if router.schema().has_geometry(&ifc_type) {
                    building_elements_found += 1;

                    // Log first few elements for debugging
                    if building_elements_found <= 3 {
                        web_sys::console::log_1(&format!(
                            "[IFC-Lite] Processing element #{}: {}",
                            building_elements_found, type_name
                        ).into());
                    }
                    // Decode the entity
                    match decoder.decode_at(start, end) {
                        Ok(entity) => {
                            // Process element into mesh
                            match router.process_element(&entity, &mut decoder) {
                                Ok(mesh) => {
                                    if !mesh.is_empty() {
                                        combined_mesh.merge(&mesh);
                                        processed_count += 1;
                                    }
                                }
                                Err(e) => {
                                    error_count += 1;
                                    // Track error by representation type
                                    let error_msg = e.to_string();
                                    if let Some(rep_type) = error_msg.split("representation type: ").nth(1) {
                                        let rep_type = rep_type.split(',').next().unwrap_or("UNKNOWN").to_string();
                                        *error_types.entry(rep_type).or_insert(0) += 1;
                                    }
                                    // Log errors for debugging (only first 10)
                                    if error_count <= 10 {
                                        web_sys::console::log_1(&format!(
                                            "[IFC-Lite] Error #{} processing {} (entity #{}): {}",
                                            error_count, type_name, entity.id, e
                                        ).into());
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            // Failed to decode entity
                            web_sys::console::log_1(&format!(
                                "[IFC-Lite] Failed to decode {}: {}",
                                type_name, e
                            ).into());
                        }
                    }
                }
            }
        }

        // Log processing stats to console
        web_sys::console::log_1(&format!(
            "[IFC-Lite] Stats: found={} processed={} errors={} vertices={} triangles={}",
            building_elements_found, processed_count, error_count, combined_mesh.vertex_count(), combined_mesh.triangle_count()
        ).into());

        // Log error types summary
        if !error_types.is_empty() {
            web_sys::console::log_1(&"[IFC-Lite] Error types:".into());
            let mut sorted_errors: Vec<_> = error_types.iter().collect();
            sorted_errors.sort_by(|a, b| b.1.cmp(a.1));
            for (rep_type, count) in sorted_errors.iter().take(10) {
                web_sys::console::log_1(&format!("  {} - {} occurrences", rep_type, count).into());
            }
        }

        // Also log to make sure this runs
        if building_elements_found == 0 {
            web_sys::console::log_1(&"[IFC-Lite] WARNING: No building elements found!".into());
        }

        if error_count > 0 && processed_count == 0 {
            web_sys::console::log_1(&format!(
                "[IFC-Lite] WARNING: All {} building elements failed to process!",
                error_count
            ).into());
        }

        // Calculate normals if not present
        if combined_mesh.normals.is_empty() && !combined_mesh.positions.is_empty() {
            calculate_normals(&mut combined_mesh);
        }

        ZeroCopyMesh::from(combined_mesh)
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

    /// Debug: Test processing entity #953 (FacetedBrep wall)
    #[wasm_bindgen(js_name = debugProcessEntity953)]
    pub fn debug_process_entity_953(&self, content: String) -> String {
        use ifc_lite_core::{EntityScanner, EntityDecoder};
        use ifc_lite_geometry::GeometryRouter;

        let router = GeometryRouter::new();
        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::new(&content);

        // Find entity 953
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if id == 953 {
                match decoder.decode_at(start, end) {
                    Ok(entity) => {
                        match router.process_element(&entity, &mut decoder) {
                            Ok(mesh) => {
                                return format!(
                                    "SUCCESS! Entity #953: {} vertices, {} triangles, empty={}",
                                    mesh.vertex_count(), mesh.triangle_count(), mesh.is_empty()
                                );
                            }
                            Err(e) => {
                                return format!("ERROR processing entity #953: {}", e);
                            }
                        }
                    }
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
        use ifc_lite_core::{EntityScanner, EntityDecoder};
        use ifc_lite_geometry::GeometryRouter;

        let router = GeometryRouter::new();
        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::new(&content);

        // Find first wall
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if type_name.contains("WALL") {
                let ifc_type = ifc_lite_core::IfcType::from_str(type_name);
                if let Some(ifc_type) = ifc_type {
                    if router.schema().has_geometry(&ifc_type) {
                        // Try to decode and process
                        match decoder.decode_at(start, end) {
                            Ok(entity) => {
                                match router.process_element(&entity, &mut decoder) {
                                    Ok(mesh) => {
                                        return format!(
                                            "SUCCESS! Wall #{}: {} vertices, {} triangles",
                                            id, mesh.vertex_count(), mesh.triangle_count()
                                        );
                                    }
                                    Err(e) => {
                                        return format!(
                                            "ERROR processing wall #{} ({}): {}",
                                            id, type_name, e
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                return format!("ERROR decoding wall #{}: {}", id, e);
                            }
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
            js_sys::Reflect::set(&obj, &"triangleCount".into(), &(*triangle_count as f64).into())
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
            js_sys::Reflect::set(&obj, &"triangleCount".into(), &(*triangle_count as f64).into())
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
