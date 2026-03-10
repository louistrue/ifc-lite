// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Dynamic 3D Tiles 1.1 tileset.json generation from zone references.
//!
//! Generates a zone×class tile hierarchy where each zone (storey) contains
//! child tiles per IFC class. The tileset follows the ADD refinement strategy.

use crate::services::zone_reference::ZoneReference;
use serde_json::{json, Value};

/// Compute a 3D Tiles box bounding volume from min/max.
fn aabb_to_box(min: [f64; 3], max: [f64; 3]) -> [f64; 12] {
    let cx = (min[0] + max[0]) / 2.0;
    let cy = (min[1] + max[1]) / 2.0;
    let cz = (min[2] + max[2]) / 2.0;
    let hx = (max[0] - min[0]) / 2.0;
    let hy = (max[1] - min[1]) / 2.0;
    let hz = (max[2] - min[2]) / 2.0;
    [cx, cy, cz, hx, 0.0, 0.0, 0.0, hy, 0.0, 0.0, 0.0, hz]
}

/// Compute geometric error from bounding box diagonal.
fn geometric_error_from_aabb(min: [f64; 3], max: [f64; 3]) -> f64 {
    let dx = max[0] - min[0];
    let dy = max[1] - min[1];
    let dz = max[2] - min[2];
    (dx * dx + dy * dy + dz * dz).sqrt() / 2.0
}

/// Generate tileset.json from a zone reference.
///
/// Structure:
/// ```text
/// root (ADD, geometric error from global bounds)
/// ├── zone_0 (ADD, geometric error from zone bounds)
/// │   ├── zone_0/IfcWall.glb
/// │   ├── zone_0/IfcSlab.glb
/// │   └── ...
/// ├── zone_1
/// │   └── ...
/// └── exterior
///     └── ...
/// ```
pub fn build_tileset(zone_ref: &ZoneReference, model_key: &str) -> Value {
    let base_path = format!("/api/v1/tiles/{}", model_key);

    // Compute global bounds from all element bounds
    let mut global_min = [f64::INFINITY; 3];
    let mut global_max = [f64::NEG_INFINITY; 3];

    for bounds in zone_ref.element_bounds.values() {
        global_min[0] = global_min[0].min(bounds[0] as f64);
        global_min[1] = global_min[1].min(bounds[1] as f64);
        global_min[2] = global_min[2].min(bounds[2] as f64);
        global_max[0] = global_max[0].max(bounds[3] as f64);
        global_max[1] = global_max[1].max(bounds[4] as f64);
        global_max[2] = global_max[2].max(bounds[5] as f64);
    }

    // Fallback if no bounds
    if !global_min[0].is_finite() {
        global_min = [0.0; 3];
        global_max = [100.0, 100.0, 100.0];
    }

    let root_error = geometric_error_from_aabb(global_min, global_max);

    // Build zone children
    let mut zone_children = Vec::new();

    for zone in &zone_ref.zones {
        // Find all IFC classes that have elements in this zone
        let zone_elements: Vec<u32> = zone_ref
            .element_zone_map
            .iter()
            .filter(|(_, zid)| **zid == zone.id)
            .map(|(&eid, _)| eid)
            .collect();

        if zone_elements.is_empty() {
            continue;
        }

        // Compute zone bounds from its elements
        let mut zone_min = [f64::INFINITY; 3];
        let mut zone_max = [f64::NEG_INFINITY; 3];
        for &eid in &zone_elements {
            if let Some(bounds) = zone_ref.element_bounds.get(&eid) {
                zone_min[0] = zone_min[0].min(bounds[0] as f64);
                zone_min[1] = zone_min[1].min(bounds[1] as f64);
                zone_min[2] = zone_min[2].min(bounds[2] as f64);
                zone_max[0] = zone_max[0].max(bounds[3] as f64);
                zone_max[1] = zone_max[1].max(bounds[4] as f64);
                zone_max[2] = zone_max[2].max(bounds[5] as f64);
            }
        }

        if !zone_min[0].is_finite() {
            continue;
        }

        let zone_error = geometric_error_from_aabb(zone_min, zone_max);

        // Build class children for this zone
        let mut class_children = Vec::new();
        let zone_element_set: std::collections::HashSet<u32> = zone_elements.iter().copied().collect();

        for (ifc_class, class_elements) in &zone_ref.ifc_class_index {
            // Filter to elements in this zone
            let elements_in_zone: Vec<u32> = class_elements
                .iter()
                .copied()
                .filter(|eid| zone_element_set.contains(eid))
                .collect();

            if elements_in_zone.is_empty() {
                continue;
            }

            // Compute tight bounds for this (zone, class) pair
            let mut class_min = [f64::INFINITY; 3];
            let mut class_max = [f64::NEG_INFINITY; 3];
            for &eid in &elements_in_zone {
                if let Some(bounds) = zone_ref.element_bounds.get(&eid) {
                    class_min[0] = class_min[0].min(bounds[0] as f64);
                    class_min[1] = class_min[1].min(bounds[1] as f64);
                    class_min[2] = class_min[2].min(bounds[2] as f64);
                    class_max[0] = class_max[0].max(bounds[3] as f64);
                    class_max[1] = class_max[1].max(bounds[4] as f64);
                    class_max[2] = class_max[2].max(bounds[5] as f64);
                }
            }

            if !class_min[0].is_finite() {
                continue;
            }

            let class_error = geometric_error_from_aabb(class_min, class_max) * 0.1;

            let class_tile = json!({
                "boundingVolume": {
                    "box": aabb_to_box(class_min, class_max)
                },
                "geometricError": class_error,
                "content": {
                    "uri": format!("{}/{}/{}.glb", base_path, zone.id, ifc_class)
                },
                "metadata": {
                    "class": "IfcClassGroup",
                    "properties": {
                        "ifcType": ifc_class,
                        "elementCount": elements_in_zone.len()
                    }
                }
            });

            // Remove metadata if empty or simple
            class_children.push(class_tile);
        }

        if class_children.is_empty() {
            continue;
        }

        // Sort class children by element count (largest first for better loading order)
        class_children.sort_by(|a, b| {
            let count_a = a["metadata"]["properties"]["elementCount"].as_u64().unwrap_or(0);
            let count_b = b["metadata"]["properties"]["elementCount"].as_u64().unwrap_or(0);
            count_b.cmp(&count_a)
        });

        let zone_tile = json!({
            "boundingVolume": {
                "box": aabb_to_box(zone_min, zone_max)
            },
            "geometricError": zone_error,
            "refine": "ADD",
            "children": class_children,
            "metadata": {
                "class": "Zone",
                "properties": {
                    "name": zone.name,
                    "zoneType": format!("{:?}", zone.zone_type),
                    "depth": zone.depth,
                    "elevation": zone.elevation
                }
            }
        });

        zone_children.push(zone_tile);
    }

    // Sort zones by elevation (lowest first)
    zone_children.sort_by(|a, b| {
        let elev_a = a["metadata"]["properties"]["elevation"].as_f64().unwrap_or(0.0);
        let elev_b = b["metadata"]["properties"]["elevation"].as_f64().unwrap_or(0.0);
        elev_a.partial_cmp(&elev_b).unwrap_or(std::cmp::Ordering::Equal)
    });

    json!({
        "asset": {
            "version": "1.1",
            "tilesetVersion": "1.0.0",
            "generator": "ifc-lite-server"
        },
        "geometricError": root_error,
        "root": {
            "boundingVolume": {
                "box": aabb_to_box(global_min, global_max)
            },
            "geometricError": root_error,
            "refine": "ADD",
            "children": zone_children
        },
        "schema": {
            "id": "ifc-lite-zones",
            "classes": {
                "Zone": {
                    "properties": {
                        "name": { "type": "STRING" },
                        "zoneType": { "type": "STRING" },
                        "depth": { "type": "SCALAR", "componentType": "UINT32" },
                        "elevation": { "type": "SCALAR", "componentType": "FLOAT64" }
                    }
                },
                "IfcClassGroup": {
                    "properties": {
                        "ifcType": { "type": "STRING" },
                        "elementCount": { "type": "SCALAR", "componentType": "UINT32" }
                    }
                }
            }
        }
    })
}

/// Build a federated root tileset referencing multiple model tilesets.
pub fn build_federated_tileset(
    models: &[(String, [f64; 6])], // (model_key, [min_x, min_y, min_z, max_x, max_y, max_z])
) -> Value {
    // Compute union bounds
    let mut global_min = [f64::INFINITY; 3];
    let mut global_max = [f64::NEG_INFINITY; 3];

    for (_, bounds) in models {
        global_min[0] = global_min[0].min(bounds[0]);
        global_min[1] = global_min[1].min(bounds[1]);
        global_min[2] = global_min[2].min(bounds[2]);
        global_max[0] = global_max[0].max(bounds[3]);
        global_max[1] = global_max[1].max(bounds[4]);
        global_max[2] = global_max[2].max(bounds[5]);
    }

    if !global_min[0].is_finite() {
        global_min = [0.0; 3];
        global_max = [100.0, 100.0, 100.0];
    }

    let root_error = geometric_error_from_aabb(global_min, global_max);

    let children: Vec<Value> = models
        .iter()
        .map(|(model_key, bounds)| {
            let min = [bounds[0], bounds[1], bounds[2]];
            let max = [bounds[3], bounds[4], bounds[5]];
            let model_error = geometric_error_from_aabb(min, max);

            json!({
                "boundingVolume": {
                    "box": aabb_to_box(min, max)
                },
                "geometricError": model_error,
                "content": {
                    "uri": format!("/api/v1/tiles/{}/tileset.json", model_key)
                }
            })
        })
        .collect();

    json!({
        "asset": {
            "version": "1.1",
            "tilesetVersion": "1.0.0",
            "generator": "ifc-lite-server"
        },
        "geometricError": root_error,
        "root": {
            "boundingVolume": {
                "box": aabb_to_box(global_min, global_max)
            },
            "geometricError": root_error,
            "refine": "ADD",
            "children": children
        }
    })
}

/// Cache key for tileset.json.
pub fn tileset_cache_key(model_hash: &str) -> String {
    format!("{}-tileset-v1", model_hash)
}
