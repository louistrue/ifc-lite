// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Data model extraction service - extracts properties, relationships, and spatial hierarchy.

use ifc_lite_core::{build_entity_index, DecodedEntity, EntityDecoder, EntityScanner};
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Complete data model extracted from IFC file.
#[derive(Debug, Clone)]
pub struct DataModel {
    /// Entity metadata for all entities.
    pub entities: Vec<EntityMetadata>,
    /// Property sets (pset_id -> PropertySet).
    pub property_sets: Vec<PropertySet>,
    /// Quantity sets (qset_id -> QuantitySet).
    pub quantity_sets: Vec<QuantitySet>,
    /// Relationships (type, relating, related[]).
    pub relationships: Vec<Relationship>,
    /// Spatial hierarchy data with nodes and lookup maps.
    pub spatial_hierarchy: SpatialHierarchyData,
}

/// Metadata for a single IFC entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityMetadata {
    /// IFC entity ID.
    pub entity_id: u32,
    /// IFC type name (e.g., "IfcWall").
    pub type_name: String,
    /// GlobalId attribute (if present).
    pub global_id: Option<String>,
    /// Name attribute (if present).
    pub name: Option<String>,
    /// Whether entity has geometry.
    pub has_geometry: bool,
}

/// Property set with its properties.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertySet {
    /// PropertySet entity ID.
    pub pset_id: u32,
    /// PropertySet name.
    pub pset_name: String,
    /// Properties in this set (property_name -> value).
    pub properties: Vec<Property>,
}

/// Single property value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Property {
    /// Property name.
    pub property_name: String,
    /// Property value (JSON-encoded).
    pub property_value: String,
    /// Property value type.
    pub property_type: String,
}

/// Quantity set (IfcElementQuantity).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantitySet {
    /// QuantitySet entity ID.
    pub qset_id: u32,
    /// QuantitySet name.
    pub qset_name: String,
    /// Method of measurement (optional).
    pub method_of_measurement: Option<String>,
    /// Quantities in this set.
    pub quantities: Vec<Quantity>,
}

/// Single quantity value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quantity {
    /// Quantity name.
    pub quantity_name: String,
    /// Quantity numeric value.
    pub quantity_value: f64,
    /// Quantity type (length, area, volume, count, weight, time).
    pub quantity_type: String,
}

/// Relationship between entities.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relationship {
    /// Relationship type (e.g., "IfcRelDefinesByProperties").
    pub rel_type: String,
    /// Relating entity ID.
    pub relating_id: u32,
    /// Related entity ID (one Relationship per related entity).
    pub related_id: u32,
}

/// Spatial hierarchy node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialNode {
    /// Entity ID.
    pub entity_id: u32,
    /// Parent entity ID (0 for root).
    pub parent_id: u32,
    /// Hierarchy depth (0 for root).
    pub level: u16,
    /// Path from root (e.g., "Project/Site/Building").
    pub path: String,
    /// IFC type name (e.g., "IFCPROJECT", "IFCBUILDINGSTOREY").
    pub type_name: String,
    /// Entity name (if present).
    pub name: Option<String>,
    /// Elevation for IFCBUILDINGSTOREY entities.
    pub elevation: Option<f64>,
    /// Direct child spatial nodes (spatial containment).
    pub children_ids: Vec<u32>,
    /// Contained elements (non-spatial entities like walls, doors, etc.).
    pub element_ids: Vec<u32>,
}

/// Spatial hierarchy data with lookup maps.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialHierarchyData {
    /// All spatial nodes.
    pub nodes: Vec<SpatialNode>,
    /// Project entity ID (root).
    pub project_id: u32,
    /// Element to storey mapping (element_id -> storey_id).
    pub element_to_storey: Vec<(u32, u32)>,
    /// Element to building mapping (element_id -> building_id).
    pub element_to_building: Vec<(u32, u32)>,
    /// Element to site mapping (element_id -> site_id).
    pub element_to_site: Vec<(u32, u32)>,
    /// Element to space mapping (element_id -> space_id).
    pub element_to_space: Vec<(u32, u32)>,
}

/// Job for processing an entity during data extraction.
struct EntityJob {
    id: u32,
    type_name: String,
    start: usize,
    end: usize,
}

/// Extract complete data model from IFC content.
pub fn extract_data_model(content: &str) -> DataModel {
    let extract_start = std::time::Instant::now();
    tracing::info!(content_size = content.len(), "Starting data model extraction");

    // Build entity index (shared across all extractors)
    let entity_index = Arc::new(build_entity_index(content));

    // Scan all entities once
    let mut scanner = EntityScanner::new(content);
    let mut all_entities: Vec<EntityJob> = Vec::new();
    let mut total_entities = 0usize;

    let mut last_id = 0u32;
    let mut last_type = String::new();
    let mut max_id = 0u32;
    let mut last_end = 0usize;
    let content_len = content.len();
    
    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        total_entities += 1;
        last_id = id;
        last_type = type_name.to_string();
        last_end = end;
        if id > max_id {
            max_id = id;
        }
        all_entities.push(EntityJob {
            id,
            type_name: type_name.to_string(),
            start,
            end,
        });
    }

    let remaining_bytes = content_len.saturating_sub(last_end);
    tracing::debug!(
        total_entities = total_entities, 
        last_id = last_id, 
        max_id = max_id, 
        last_type = %last_type, 
        last_end = last_end,
        content_len = content_len,
        remaining_bytes = remaining_bytes,
        "Scanned all entities"
    );
    
    // Debug: log sample entity types to diagnose issues
    let sample_types: Vec<&str> = all_entities.iter().take(20).map(|j| j.type_name.as_str()).collect();
    tracing::debug!(?sample_types, "Sample entity types from scan");
    
    // Check if any type contains "PROPERTY" or "REL" (case-insensitive)
    let has_property_like = all_entities.iter().any(|j| j.type_name.to_uppercase().contains("PROPERTY"));
    let has_rel_like = all_entities.iter().any(|j| j.type_name.to_uppercase().starts_with("IFCREL"));
    tracing::debug!(has_property_like = has_property_like, has_rel_like = has_rel_like, "Entity type pattern check");
    
    // Debug: count property sets and relationships in scanned entities
    let pset_count = all_entities.iter().filter(|j| j.type_name.to_uppercase() == "IFCPROPERTYSET").count();
    let rel_count = all_entities.iter().filter(|j| {
        let t = j.type_name.to_uppercase();
        t == "IFCRELDEFINESBYPROPERTIES" || t == "IFCRELAGGREGATES" || t == "IFCRELCONTAINEDINSPATIALSTRUCTURE"
    }).count();
    tracing::debug!(pset_count = pset_count, rel_count = rel_count, "Entity type counts before extraction");

    // Parallel extraction using rayon::join
    let content_arc = Arc::new(content.to_string());
    let (entities, ((property_sets, quantity_sets), relationships)) = rayon::join(
        || extract_entity_metadata(&all_entities, &content_arc, &entity_index),
        || rayon::join(
            || rayon::join(
                || extract_properties(&all_entities, &content_arc, &entity_index),
                || extract_quantities(&all_entities, &content_arc, &entity_index),
            ),
            || extract_relationships(&all_entities, &content_arc, &entity_index),
        ),
    );

    // Build spatial hierarchy (depends on relationships and entities)
    let spatial_hierarchy = build_spatial_hierarchy(&relationships, &entities, content, &entity_index);

    let extract_time = extract_start.elapsed();
    tracing::info!(
        entities = entities.len(),
        property_sets = property_sets.len(),
        quantity_sets = quantity_sets.len(),
        relationships = relationships.len(),
        spatial_nodes = spatial_hierarchy.nodes.len(),
        extract_time_ms = extract_time.as_millis(),
        "Data model extraction complete"
    );

    DataModel {
        entities,
        property_sets,
        quantity_sets,
        relationships,
        spatial_hierarchy,
    }
}

/// Extract entity metadata for all entities.
fn extract_entity_metadata(
    jobs: &[EntityJob],
    content: &Arc<String>,
    entity_index: &Arc<ifc_lite_core::EntityIndex>,
) -> Vec<EntityMetadata> {
    jobs.par_iter()
        .filter_map(|job| {
            let mut local_decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
            let entity = local_decoder.decode_at(job.start, job.end).ok()?;

            let global_id = entity.get_string(0).map(|s| s.to_string());
            let name = entity.get_string(2).map(|s| s.to_string());
            let has_geometry = ifc_lite_core::has_geometry_by_name(&job.type_name);

            Some(EntityMetadata {
                entity_id: job.id,
                type_name: job.type_name.clone(),
                global_id,
                name,
                has_geometry,
            })
        })
        .collect()
}

/// Extract all property sets and their properties.
fn extract_properties(
    jobs: &[EntityJob],
    content: &Arc<String>,
    entity_index: &Arc<ifc_lite_core::EntityIndex>,
) -> Vec<PropertySet> {
    // First, collect all PropertySet entities
    // PERF: Use eq_ignore_ascii_case to avoid string allocation per comparison
    let pset_jobs: Vec<_> = jobs
        .iter()
        .filter(|job| job.type_name.eq_ignore_ascii_case("IFCPROPERTYSET"))
        .collect();

    tracing::debug!(count = pset_jobs.len(), "Extracting property sets");

    pset_jobs
        .par_iter()
        .filter_map(|job| {
            let mut local_decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
            let entity = local_decoder.decode_at(job.start, job.end).ok()?;

            // IfcPropertySet: [0]=GlobalId, [1]=OwnerHistory, [2]=Name, [3]=Description, [4]=HasProperties
            let pset_name = entity.get_string(2)?.to_string();
            let has_properties = entity.get_list(4)?;

            let mut properties = Vec::new();

            // Extract properties from HasProperties list
            for prop_ref in has_properties.iter() {
                if let Some(prop_id) = prop_ref.as_entity_ref() {
                    if let Ok(prop_entity) = local_decoder.decode_by_id(prop_id) {
                        if let Some(prop) = extract_property(&prop_entity, &mut local_decoder) {
                            properties.push(prop);
                        }
                    }
                }
            }

            if properties.is_empty() {
                return None;
            }

            Some(PropertySet {
                pset_id: job.id,
                pset_name,
                properties,
            })
        })
        .collect()
}

/// Extract a single property from IfcProperty entity.
fn extract_property(
    entity: &DecodedEntity,
    _decoder: &mut EntityDecoder,
) -> Option<Property> {
    // PERF: Use eq_ignore_ascii_case to avoid string allocation per comparison
    let ifc_type = entity.ifc_type.as_str();

    // IfcPropertySingleValue: [0]=Name, [1]=Description, [2]=NominalValue, [3]=Unit
    if ifc_type.eq_ignore_ascii_case("IFCPROPERTYSINGLEVALUE") {
        let property_name = entity.get_string(0)?.to_string();
        let nominal_value = entity.get(2)?;

        // Extract value based on type
        let (property_value, property_type) = if let Some(s) = nominal_value.as_string() {
            (format!("\"{}\"", s), "string".to_string())
        } else if let Some(f) = nominal_value.as_float() {
            (f.to_string(), "number".to_string())
        } else if let Some(i) = nominal_value.as_int() {
            (i.to_string(), "integer".to_string())
        } else {
            // Fallback: serialize as string representation
            (format!("{:?}", nominal_value), "unknown".to_string())
        };

        Some(Property {
            property_name,
            property_value,
            property_type,
        })
    } else {
        None
    }
}

/// Extract all quantity sets (IfcElementQuantity) and their quantities.
fn extract_quantities(
    jobs: &[EntityJob],
    content: &Arc<String>,
    entity_index: &Arc<ifc_lite_core::EntityIndex>,
) -> Vec<QuantitySet> {
    // First, collect all IfcElementQuantity entities
    // PERF: Use eq_ignore_ascii_case to avoid string allocation per comparison
    let qset_jobs: Vec<_> = jobs
        .iter()
        .filter(|job| job.type_name.eq_ignore_ascii_case("IFCELEMENTQUANTITY"))
        .collect();

    tracing::debug!(count = qset_jobs.len(), "Extracting quantity sets");

    qset_jobs
        .par_iter()
        .filter_map(|job| {
            let mut local_decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
            let entity = local_decoder.decode_at(job.start, job.end).ok()?;

            // IfcElementQuantity: [0]=GlobalId, [1]=OwnerHistory, [2]=Name, [3]=Description, [4]=MethodOfMeasurement, [5]=Quantities
            let qset_name = entity.get_string(2)?.to_string();
            let method_of_measurement = entity.get_string(4).map(|s| s.to_string());
            let has_quantities = entity.get_list(5)?;

            let mut quantities = Vec::new();

            // Extract quantities from Quantities list
            for quant_ref in has_quantities.iter() {
                if let Some(quant_id) = quant_ref.as_entity_ref() {
                    if let Ok(quant_entity) = local_decoder.decode_by_id(quant_id) {
                        if let Some(quant) = extract_quantity_value(&quant_entity) {
                            quantities.push(quant);
                        }
                    }
                }
            }

            if quantities.is_empty() {
                return None;
            }

            Some(QuantitySet {
                qset_id: job.id,
                qset_name,
                method_of_measurement,
                quantities,
            })
        })
        .collect()
}

/// Extract a single quantity value from IfcPhysicalQuantity entity.
/// Supports: IfcQuantityLength, IfcQuantityArea, IfcQuantityVolume,
///           IfcQuantityCount, IfcQuantityWeight, IfcQuantityTime
fn extract_quantity_value(entity: &DecodedEntity) -> Option<Quantity> {
    // PERF: Use eq_ignore_ascii_case to avoid string allocation per comparison
    let ifc_type = entity.ifc_type.as_str();

    // Map IFC type to quantity type string
    let quantity_type = if ifc_type.eq_ignore_ascii_case("IFCQUANTITYLENGTH") {
        "length"
    } else if ifc_type.eq_ignore_ascii_case("IFCQUANTITYAREA") {
        "area"
    } else if ifc_type.eq_ignore_ascii_case("IFCQUANTITYVOLUME") {
        "volume"
    } else if ifc_type.eq_ignore_ascii_case("IFCQUANTITYCOUNT") {
        "count"
    } else if ifc_type.eq_ignore_ascii_case("IFCQUANTITYWEIGHT") {
        "weight"
    } else if ifc_type.eq_ignore_ascii_case("IFCQUANTITYTIME") {
        "time"
    } else {
        return None; // Not a recognized quantity type
    };

    // All IFC quantity types have:
    // [0]=Name, [1]=Description, [2]=Unit, [3]=*Value, [4]=Formula (optional, IFC4)
    let quantity_name = entity.get_string(0)?.to_string();

    // Value is at index 3 for all quantity types
    let quantity_value = entity.get_float(3)?;

    Some(Quantity {
        quantity_name,
        quantity_value,
        quantity_type: quantity_type.to_string(),
    })
}

/// Extract all relationships.
fn extract_relationships(
    jobs: &[EntityJob],
    content: &Arc<String>,
    entity_index: &Arc<ifc_lite_core::EntityIndex>,
) -> Vec<Relationship> {
    // Filter for relationship entities
    let rel_types = [
        "IFCRELCONTAINEDINSPATIALSTRUCTURE",
        "IFCRELAGGREGATES",
        "IFCRELDEFINESBYPROPERTIES",
        "IFCRELDEFINESBYTYPE",
        "IFCRELASSOCIATESMATERIAL",
        "IFCRELVOIDSELEMENT",
        "IFCRELFILLSELEMENT",
    ];

    let rel_jobs: Vec<_> = jobs
        .iter()
        .filter(|job| {
            let type_upper = job.type_name.to_uppercase();
            rel_types.iter().any(|&rt| type_upper == rt)
        })
        .collect();

    tracing::debug!(count = rel_jobs.len(), "Extracting relationships");

    rel_jobs
        .par_iter()
        .filter_map(|job| {
            let mut local_decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
            let entity = local_decoder.decode_at(job.start, job.end).ok()?;

            extract_relationship(&entity, &job.type_name)
        })
        .flatten()
        .collect()
}

/// Extract relationship from entity (may return multiple if related[] has multiple items).
fn extract_relationship(entity: &DecodedEntity, type_name: &str) -> Option<Vec<Relationship>> {
    let type_upper = type_name.to_uppercase();

    let (relating_idx, related_idx) = match type_upper.as_str() {
        "IFCRELDEFINESBYPROPERTIES" => (5, 4), // RelatingPropertyDefinition at 5, RelatedObjects at 4
        "IFCRELCONTAINEDINSPATIALSTRUCTURE" => (5, 4), // RelatingStructure at 5, RelatedElements at 4
        _ => (4, 5), // Standard: RelatingObject at 4, RelatedObjects at 5
    };

    let relating_id = entity.get_ref(relating_idx)?;
    let related_list = entity.get_list(related_idx)?;

    let related_ids: Vec<u32> = related_list
        .iter()
        .filter_map(|v| v.as_entity_ref())
        .collect();

    if related_ids.is_empty() {
        return None;
    }

    Some(
        related_ids
            .into_iter()
            .map(|related_id| Relationship {
                rel_type: type_name.to_string(),
                relating_id,
                related_id,
            })
            .collect(),
    )
}

/// Build spatial hierarchy from relationships.
fn build_spatial_hierarchy(
    relationships: &[Relationship],
    entities: &[EntityMetadata],
    content: &str,
    entity_index: &Arc<ifc_lite_core::EntityIndex>,
) -> SpatialHierarchyData {
    let mut decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
    
    // Build entity map for quick lookup
    let entity_map: FxHashMap<u32, &EntityMetadata> = entities
        .iter()
        .map(|e| (e.entity_id, e))
        .collect();

    // Separate spatial relationships from element containment
    // IFCRELAGGREGATES: spatial parent -> spatial child (Project -> Site -> Building -> Storey)
    // IFCRELCONTAINEDINSPATIALSTRUCTURE: spatial container -> element (Storey -> Wall, Door, etc.)
    let mut spatial_children_map: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut element_containment_map: FxHashMap<u32, Vec<u32>> = FxHashMap::default();

    for rel in relationships {
        let rel_type_upper = rel.rel_type.to_uppercase();
        if rel_type_upper == "IFCRELAGGREGATES" {
            // Spatial hierarchy: parent -> child spatial nodes
            spatial_children_map
                .entry(rel.relating_id)
                .or_default()
                .push(rel.related_id);
        } else if rel_type_upper == "IFCRELCONTAINEDINSPATIALSTRUCTURE" {
            // Element containment: spatial container -> elements
            element_containment_map
                .entry(rel.relating_id)
                .or_default()
                .push(rel.related_id);
        }
    }

    // Find project (root)
    let project_id = entities
        .iter()
        .find(|e| e.type_name.to_uppercase() == "IFCPROJECT")
        .map(|e| e.entity_id)
        .unwrap_or(0);

    // Build all spatial nodes with full information
    let mut nodes_map: FxHashMap<u32, SpatialNode> = FxHashMap::default();
    
    // Collect all spatial entity IDs (Project, Site, Building, Storey, Space)
    let spatial_types = ["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE"];
    let spatial_entity_ids: Vec<u32> = entities
        .iter()
        .filter(|e| {
            let type_upper = e.type_name.to_uppercase();
            spatial_types.iter().any(|&st| type_upper == st)
        })
        .map(|e| e.entity_id)
        .collect();

    // Build nodes recursively starting from project
    if project_id != 0 {
        build_spatial_nodes_recursive(
            project_id,
            0,
            0,
            "",
            &spatial_children_map,
            &element_containment_map,
            &entity_map,
            &mut decoder,
            &mut nodes_map,
        );
    }

    // Also process any spatial nodes not reachable from project (shouldn't happen, but be safe)
    for &entity_id in &spatial_entity_ids {
        if !nodes_map.contains_key(&entity_id) {
            if let Some(entity) = entity_map.get(&entity_id) {
                let name = entity.name.clone().unwrap_or_else(|| format!("{}#{}", entity.type_name, entity_id));
                
                nodes_map.insert(entity_id, SpatialNode {
                    entity_id,
                    parent_id: 0,
                    level: 0,
                    path: name.clone(),
                    type_name: entity.type_name.clone(),
                    name: entity.name.clone(),
                    elevation: extract_elevation_if_storey(&entity.type_name, entity_id, &mut decoder),
                    children_ids: spatial_children_map.get(&entity_id).cloned().unwrap_or_default(),
                    element_ids: element_containment_map.get(&entity_id).cloned().unwrap_or_default(),
                });
            }
        }
    }

    // Build lookup maps for element containment
    let mut element_to_storey = Vec::new();
    let mut element_to_building = Vec::new();
    let mut element_to_site = Vec::new();
    let mut element_to_space = Vec::new();

    for rel in relationships {
        if rel.rel_type.to_uppercase() == "IFCRELCONTAINEDINSPATIALSTRUCTURE" {
            let spatial_id = rel.relating_id;
            let element_id = rel.related_id;
            
            if let Some(spatial_node) = nodes_map.get(&spatial_id) {
                let type_upper = spatial_node.type_name.to_uppercase();
                if type_upper == "IFCBUILDINGSTOREY" {
                    element_to_storey.push((element_id, spatial_id));
                } else if type_upper == "IFCBUILDING" {
                    element_to_building.push((element_id, spatial_id));
                } else if type_upper == "IFCSITE" {
                    element_to_site.push((element_id, spatial_id));
                } else if type_upper == "IFCSPACE" {
                    element_to_space.push((element_id, spatial_id));
                }
            }
        }
    }

    SpatialHierarchyData {
        nodes: nodes_map.into_values().collect(),
        project_id,
        element_to_storey,
        element_to_building,
        element_to_site,
        element_to_space,
    }
}

/// Recursively build spatial nodes with full information.
fn build_spatial_nodes_recursive(
    entity_id: u32,
    parent_id: u32,
    level: u16,
    parent_path: &str,
    spatial_children_map: &FxHashMap<u32, Vec<u32>>,
    element_containment_map: &FxHashMap<u32, Vec<u32>>,
    entity_map: &FxHashMap<u32, &EntityMetadata>,
    decoder: &mut EntityDecoder,
    nodes_map: &mut FxHashMap<u32, SpatialNode>,
) {
    let entity = match entity_map.get(&entity_id) {
        Some(e) => e,
        None => return,
    };

    let entity_name = entity.name.as_ref()
        .cloned()
        .unwrap_or_else(|| format!("{}#{}", entity.type_name, entity_id));

    let path = if parent_path.is_empty() {
        entity_name.clone()
    } else {
        format!("{}/{}", parent_path, entity_name)
    };

    // Extract elevation for storeys
    let elevation = extract_elevation_if_storey(&entity.type_name, entity_id, decoder);

    // Get children and elements
    let children_ids = spatial_children_map.get(&entity_id).cloned().unwrap_or_default();
    let element_ids = element_containment_map.get(&entity_id).cloned().unwrap_or_default();

    let node = SpatialNode {
        entity_id,
        parent_id,
        level,
        path: path.clone(),
        type_name: entity.type_name.clone(),
        name: entity.name.clone(),
        elevation,
        children_ids: children_ids.clone(),
        element_ids,
    };

    nodes_map.insert(entity_id, node);

    // Recursively process children
    for &child_id in &children_ids {
        build_spatial_nodes_recursive(
            child_id,
            entity_id,
            level + 1,
            &path,
            spatial_children_map,
            element_containment_map,
            entity_map,
            decoder,
            nodes_map,
        );
    }
}

/// Extract elevation from IFCBUILDINGSTOREY entity.
fn extract_elevation_if_storey(
    type_name: &str,
    entity_id: u32,
    decoder: &mut EntityDecoder,
) -> Option<f64> {
    if type_name.to_uppercase() != "IFCBUILDINGSTOREY" {
        return None;
    }

    // Try to decode the entity and get elevation (typically at attribute index 8)
    if let Ok(entity) = decoder.decode_by_id(entity_id) {
        // Elevation is typically at index 8 in IfcBuildingStorey
        // [0]=GlobalId, [1]=OwnerHistory, [2]=Name, [3]=Description, [4]=ObjectType,
        // [5]=Tag, [6]=LongName, [7]=CompositionType, [8]=Elevation
        if let Some(elevation) = entity.get_float(8) {
            return Some(elevation);
        }
        // Fallback: try index 7
        if let Some(elevation) = entity.get_float(7) {
            return Some(elevation);
        }
    }

    None
}
