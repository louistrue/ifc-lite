// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Zone reference extraction for 3D Tiles serving.
//!
//! Extracts spatial zones from an already-parsed IFC model and builds
//! a `ZoneReference` — the foundation for zone-based tiling.
//! Zones map to IfcBuildingStorey (or Building/Site for coarser levels).

use crate::services::data_model::{DataModel, SpatialNode};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

/// A spatial zone derived from IFC spatial hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    /// Zone identifier (e.g., "storey_42").
    pub id: String,
    /// Display name (e.g., "Level 1").
    pub name: String,
    /// Zone type.
    pub zone_type: ZoneType,
    /// Hierarchy depth (0=project, 1=site, 2=building, 3=storey).
    pub depth: u32,
    /// Parent zone ID.
    pub parent_id: Option<String>,
    /// Elevation in meters (for storeys).
    pub elevation: Option<f64>,
    /// Bottom of zone in Y-up space (meters).
    pub y_min: f64,
    /// Top of zone in Y-up space (meters).
    pub y_max: f64,
    /// Original IFC express ID.
    pub express_id: u32,
}

/// Zone type classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ZoneType {
    Site,
    Building,
    Storey,
    Exterior,
}

/// Complete zone reference for a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneReference {
    /// Model content hash.
    pub model_hash: String,
    /// All spatial zones.
    pub zones: Vec<Zone>,
    /// Mapping: expressId → zone.id.
    pub element_zone_map: FxHashMap<u32, String>,
    /// IFC class index: "IfcWall" → [expressId, ...].
    pub ifc_class_index: FxHashMap<String, Vec<u32>>,
    /// Per-element bounding boxes (Y-up): expressId → [min_x, min_y, min_z, max_x, max_y, max_z].
    pub element_bounds: FxHashMap<u32, [f32; 6]>,
}

/// Mesh bounding box info extracted from parquet cache.
#[derive(Debug, Clone)]
pub struct MeshBounds {
    pub express_id: u32,
    pub ifc_type: String,
    pub bbox_min: [f32; 3],
    pub bbox_max: [f32; 3],
}

/// Extract zone reference from a data model and mesh bounds.
///
/// This is the core extraction function. It uses the spatial hierarchy
/// from the data model and mesh bounds from the parquet cache.
pub fn extract_zone_reference(
    model_hash: &str,
    data_model: &DataModel,
    mesh_bounds: &[MeshBounds],
) -> ZoneReference {
    let start = std::time::Instant::now();

    // Build IFC class index from mesh bounds
    let mut ifc_class_index: FxHashMap<String, Vec<u32>> = FxHashMap::default();
    let mut element_bounds: FxHashMap<u32, [f32; 6]> = FxHashMap::default();

    for mb in mesh_bounds {
        ifc_class_index
            .entry(mb.ifc_type.clone())
            .or_default()
            .push(mb.express_id);
        // Merge bounds if multiple meshes share an expressId
        let entry = element_bounds
            .entry(mb.express_id)
            .or_insert([f32::INFINITY, f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY]);
        entry[0] = entry[0].min(mb.bbox_min[0]);
        entry[1] = entry[1].min(mb.bbox_min[1]);
        entry[2] = entry[2].min(mb.bbox_min[2]);
        entry[3] = entry[3].max(mb.bbox_max[0]);
        entry[4] = entry[4].max(mb.bbox_max[1]);
        entry[5] = entry[5].max(mb.bbox_max[2]);
    }

    // Build element→storey mapping from spatial hierarchy
    let storey_map: FxHashMap<u32, u32> = data_model
        .spatial_hierarchy
        .element_to_storey
        .iter()
        .map(|&(elem, storey)| (elem, storey))
        .collect();

    // Collect storey nodes sorted by elevation
    let spatial_nodes = &data_model.spatial_hierarchy.nodes;
    let mut storey_nodes: Vec<&SpatialNode> = spatial_nodes
        .iter()
        .filter(|n| n.type_name.eq_ignore_ascii_case("IFCBUILDINGSTOREY"))
        .collect();
    storey_nodes.sort_by(|a, b| {
        let ea = a.elevation.unwrap_or(0.0);
        let eb = b.elevation.unwrap_or(0.0);
        ea.partial_cmp(&eb).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Compute z_min/z_max per storey (using elevation[n+1] - elevation[n])
    let mut zones = Vec::new();
    let mut element_zone_map: FxHashMap<u32, String> = FxHashMap::default();

    for (i, node) in storey_nodes.iter().enumerate() {
        let zone_id = format!("storey_{}", node.entity_id);
        let name = node.name.clone().unwrap_or_else(|| format!("Level {}", i));
        let elevation = node.elevation.unwrap_or(0.0);

        // y_min = this storey's elevation, y_max = next storey's elevation (or computed from elements)
        let y_min = elevation;
        let y_max = if i + 1 < storey_nodes.len() {
            storey_nodes[i + 1].elevation.unwrap_or(elevation + 3.0)
        } else {
            // Last storey: compute from element bounding boxes
            let max_y = node.element_ids.iter()
                .filter_map(|eid| element_bounds.get(eid))
                .map(|b| b[4]) // bbox_max_y
                .fold(f32::NEG_INFINITY, f32::max);
            if max_y.is_finite() {
                max_y as f64
            } else {
                elevation + 3.0 // fallback: 3m floor height
            }
        };

        // Find parent building
        let parent_id = spatial_nodes.iter()
            .find(|n| n.children_ids.contains(&node.entity_id))
            .map(|n| format!("building_{}", n.entity_id));

        zones.push(Zone {
            id: zone_id.clone(),
            name,
            zone_type: ZoneType::Storey,
            depth: 3,
            parent_id,
            elevation: Some(elevation),
            y_min,
            y_max,
            express_id: node.entity_id,
        });

        // Map elements to this zone
        for &elem_id in &node.element_ids {
            element_zone_map.insert(elem_id, zone_id.clone());
        }
    }

    // Map elements from element_to_storey that weren't caught by direct containment
    for (&elem_id, &storey_id) in &storey_map {
        if !element_zone_map.contains_key(&elem_id) {
            let zone_id = format!("storey_{}", storey_id);
            if zones.iter().any(|z| z.id == zone_id) {
                element_zone_map.insert(elem_id, zone_id);
            }
        }
    }

    // Handle unassigned elements: assign by centroid Y coordinate or put in "Exterior"
    let all_geometry_express_ids: Vec<u32> = mesh_bounds.iter().map(|mb| mb.express_id).collect();
    let unassigned: Vec<u32> = all_geometry_express_ids
        .iter()
        .copied()
        .filter(|eid| !element_zone_map.contains_key(eid))
        .collect();

    if !unassigned.is_empty() {
        // Try centroid-based assignment first
        for &eid in &unassigned {
            if let Some(bounds) = element_bounds.get(&eid) {
                let centroid_y = (bounds[1] + bounds[4]) / 2.0;
                // Find zone containing this Y coordinate
                let cy = centroid_y as f64;
                if let Some(zone) = zones.iter().find(|z| {
                    z.zone_type == ZoneType::Storey
                        && cy >= z.y_min
                        && cy < z.y_max
                }) {
                    element_zone_map.insert(eid, zone.id.clone());
                }
            }
        }

        // Remaining unassigned go to "Exterior"
        let still_unassigned: Vec<u32> = unassigned
            .iter()
            .copied()
            .filter(|eid| !element_zone_map.contains_key(eid))
            .collect();

        if !still_unassigned.is_empty() {
            // Compute bounds for exterior elements
            let mut ext_y_min = f64::INFINITY;
            let mut ext_y_max = f64::NEG_INFINITY;
            for &eid in &still_unassigned {
                if let Some(bounds) = element_bounds.get(&eid) {
                    ext_y_min = ext_y_min.min(bounds[1] as f64);
                    ext_y_max = ext_y_max.max(bounds[4] as f64);
                }
            }

            let exterior_zone_id = "exterior".to_string();
            zones.push(Zone {
                id: exterior_zone_id.clone(),
                name: "Exterior".to_string(),
                zone_type: ZoneType::Exterior,
                depth: 3,
                parent_id: None,
                elevation: None,
                y_min: if ext_y_min.is_finite() { ext_y_min } else { 0.0 },
                y_max: if ext_y_max.is_finite() { ext_y_max } else { 100.0 },
                express_id: 0,
            });

            for eid in still_unassigned {
                element_zone_map.insert(eid, exterior_zone_id.clone());
            }
        }
    }

    // If no storeys found at all, create flat by-class zones (one "all" zone)
    if zones.is_empty() {
        let all_zone_id = "all".to_string();
        let mut y_min = f64::INFINITY;
        let mut y_max = f64::NEG_INFINITY;
        for bounds in element_bounds.values() {
            y_min = y_min.min(bounds[1] as f64);
            y_max = y_max.max(bounds[4] as f64);
        }

        zones.push(Zone {
            id: all_zone_id.clone(),
            name: "All Elements".to_string(),
            zone_type: ZoneType::Building,
            depth: 2,
            parent_id: None,
            elevation: None,
            y_min: if y_min.is_finite() { y_min } else { 0.0 },
            y_max: if y_max.is_finite() { y_max } else { 100.0 },
            express_id: 0,
        });

        for &eid in &all_geometry_express_ids {
            element_zone_map.insert(eid, all_zone_id.clone());
        }
    }

    let elapsed = start.elapsed();
    tracing::info!(
        zones = zones.len(),
        mapped_elements = element_zone_map.len(),
        ifc_classes = ifc_class_index.len(),
        elapsed_ms = elapsed.as_millis(),
        "Zone reference extraction complete"
    );

    ZoneReference {
        model_hash: model_hash.to_string(),
        zones,
        element_zone_map,
        ifc_class_index,
        element_bounds,
    }
}

/// Cache key for zone reference.
pub fn zone_cache_key(model_hash: &str) -> String {
    format!("{}-zones-v1", model_hash)
}
