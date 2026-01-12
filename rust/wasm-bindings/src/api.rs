// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! JavaScript API for IFC-Lite
//!
//! Modern async/await API for parsing IFC files.

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;
use js_sys::{Function, Promise};
use ifc_lite_core::{EntityScanner, ParseEvent, StreamConfig};
use crate::zero_copy::{ZeroCopyMesh, MeshDataJs, MeshCollection};

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
        // Parse IFC file and generate geometry with optimized processing
        use ifc_lite_core::{EntityScanner, EntityDecoder, build_entity_index};
        use ifc_lite_geometry::{GeometryRouter, Mesh, calculate_normals};

        // Build entity index once upfront for O(1) lookups
        let entity_index = build_entity_index(&content);

        // Create scanner and decoder with pre-built index
        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index);

        // Create geometry router (reuses processor instances)
        let router = GeometryRouter::new();

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
        use ifc_lite_core::{EntityScanner, EntityDecoder, build_entity_index};
        use ifc_lite_geometry::{GeometryRouter, calculate_normals};

        // Build entity index once upfront for O(1) lookups
        let entity_index = build_entity_index(&content);

        // Create scanner and decoder with pre-built index
        let mut scanner = EntityScanner::new(&content);
        let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

        // Build style index: first map geometry IDs to colors, then map element IDs to colors
        let geometry_styles = build_geometry_style_index(&content, &mut decoder);
        let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

        // Reset scanner for second pass
        scanner = EntityScanner::new(&content);

        // Create geometry router (reuses processor instances)
        let router = GeometryRouter::new();

        // Collect individual meshes with express IDs
        let mut mesh_collection = MeshCollection::new();

        // Process all building elements
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            // Check if this is a building element type
            if !ifc_lite_core::has_geometry_by_name(type_name) {
                continue;
            }

            // Decode and process the entity
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let Ok(mut mesh) = router.process_element(&entity, &mut decoder) {
                    if !mesh.is_empty() {
                        // Calculate normals if not present
                        if mesh.normals.is_empty() {
                            calculate_normals(&mut mesh);
                        }

                        // Try to get color from style index, otherwise use default
                        let color = style_index.get(&id)
                            .copied()
                            .unwrap_or_else(|| get_default_color_for_type(&entity.ifc_type));

                        // Create mesh data with express ID and color
                        let mesh_data = MeshDataJs::new(id, mesh, color);
                        mesh_collection.add(mesh_data);
                    }
                }
            }
        }

        mesh_collection
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
    use ifc_lite_core::IfcType;

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
        IfcType::IfcPresentationStyleAssignment => {
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
