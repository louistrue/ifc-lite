// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Debug methods for IFC-Lite API

use super::IfcAPI;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl IfcAPI {
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
}
