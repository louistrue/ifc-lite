// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! IFC processing service with parallel geometry extraction.

use crate::types::{CoordinateInfo, MeshData, ModelMetadata, ProcessingStats};
use ifc_lite_core::{build_entity_index, DecodedEntity, EntityDecoder, EntityScanner, IfcType};
use ifc_lite_geometry::{calculate_normals, GeometryRouter};
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use std::sync::Arc;

/// Result of processing an IFC file.
pub struct ProcessingResult {
    pub meshes: Vec<MeshData>,
    pub metadata: ModelMetadata,
    pub stats: ProcessingStats,
}

/// Job for processing a single entity.
struct EntityJob {
    id: u32,
    type_name: String,
    ifc_type: IfcType,
    start: usize,
    end: usize,
}

/// Extract entity references from a list attribute.
fn get_refs_from_list(entity: &DecodedEntity, index: usize) -> Option<Vec<u32>> {
    let list = entity.get_list(index)?;
    let refs: Vec<u32> = list.iter().filter_map(|v| v.as_entity_ref()).collect();
    if refs.is_empty() {
        None
    } else {
        Some(refs)
    }
}

/// Process IFC content with parallel geometry extraction.
pub fn process_geometry(content: &str) -> ProcessingResult {
    let total_start = std::time::Instant::now();
    let parse_start = std::time::Instant::now();

    tracing::info!(content_size = content.len(), "Starting IFC geometry processing");

    // Build entity index (fast - single pass)
    let entity_index = Arc::new(build_entity_index(content));
    let mut decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
    tracing::debug!("Built entity index");

    // OPTIMIZATION: Build style indices in a single pass (previously two separate scans)
    let style_index = Arc::new(build_style_indices(content, &mut decoder));

    // Collect geometry entities and build void index
    let mut scanner = EntityScanner::new(content);
    let mut faceted_brep_ids: Vec<u32> = Vec::new();
    let mut void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut entity_jobs: Vec<EntityJob> = Vec::with_capacity(2000);
    let mut schema_version = "IFC2X3".to_string();
    let mut total_entities = 0usize;

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        total_entities += 1;

        if type_name == "IFCFACETEDBREP" {
            faceted_brep_ids.push(id);
        } else if type_name == "IFCRELVOIDSELEMENT" {
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let (Some(host), Some(opening)) = (entity.get_ref(4), entity.get_ref(5)) {
                    void_index.entry(host).or_default().push(opening);
                }
            }
        }

        if ifc_lite_core::has_geometry_by_name(type_name) {
            if let Ok(entity) = decoder.decode_at(start, end) {
                entity_jobs.push(EntityJob {
                    id,
                    type_name: type_name.to_string(),
                    ifc_type: entity.ifc_type,
                    start,
                    end,
                });
            }
        }
    }

    // Detect schema version
    if content.contains("IFC4X3") {
        schema_version = "IFC4X3".into();
    } else if content.contains("IFC4") {
        schema_version = "IFC4".into();
    }

    let geometry_entity_count = entity_jobs.len();
    tracing::info!(
        total_entities = total_entities,
        geometry_entities = geometry_entity_count,
        faceted_breps = faceted_brep_ids.len(),
        voids = void_index.len(),
        schema_version = %schema_version,
        "Entity scanning complete"
    );

    // Preprocess complex geometry
    let router = GeometryRouter::with_units(content, &mut decoder);
    if !faceted_brep_ids.is_empty() {
        tracing::debug!(count = faceted_brep_ids.len(), "Preprocessing FacetedBreps");
        router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
    }

    let parse_time = parse_start.elapsed();
    tracing::info!(parse_time_ms = parse_time.as_millis(), "Parse phase complete, starting geometry extraction");

    // PARALLEL GEOMETRY PROCESSING
    let geometry_start = std::time::Instant::now();
    let content_arc = Arc::new(content.to_string());
    let entity_index_arc = entity_index; // Already Arc from above
    let unit_scale = router.unit_scale();
    let void_index_arc = Arc::new(void_index);

    let meshes: Vec<MeshData> = entity_jobs
        .into_par_iter()
        .filter_map(|job| {
            let mut local_decoder =
                EntityDecoder::with_arc_index(&content_arc, entity_index_arc.clone());

            if let Ok(entity) = local_decoder.decode_at(job.start, job.end) {
                // Check if entity has representation
                let has_representation = entity.get(6).is_some_and(|a| !a.is_null());
                if !has_representation {
                    return None;
                }

                let local_router = GeometryRouter::with_scale(unit_scale);

                if let Ok(mut mesh) = local_router.process_element_with_voids(
                    &entity,
                    &mut local_decoder,
                    void_index_arc.as_ref(),
                ) {
                    if !mesh.is_empty() {
                        if mesh.normals.is_empty() {
                            calculate_normals(&mut mesh);
                        }

                        let color = style_index
                            .get(&job.id)
                            .copied()
                            .unwrap_or_else(|| get_default_color(&job.ifc_type));

                        return Some(MeshData::new(
                            job.id,
                            job.ifc_type.name().to_string(),
                            mesh.positions,
                            mesh.normals,
                            mesh.indices,
                            color,
                        ));
                    }
                }
            }
            None
        })
        .collect();

    let geometry_time = geometry_start.elapsed();
    let total_time = total_start.elapsed();

    // Calculate stats
    let total_vertices: usize = meshes.iter().map(|m| m.vertex_count()).sum();
    let total_triangles: usize = meshes.iter().map(|m| m.triangle_count()).sum();

    tracing::info!(
        meshes = meshes.len(),
        vertices = total_vertices,
        triangles = total_triangles,
        geometry_time_ms = geometry_time.as_millis(),
        total_time_ms = total_time.as_millis(),
        "Geometry processing complete"
    );

    ProcessingResult {
        meshes: meshes.clone(),
        metadata: ModelMetadata {
            schema_version,
            entity_count: total_entities,
            geometry_entity_count,
            coordinate_info: CoordinateInfo::default(),
        },
        stats: ProcessingStats {
            total_meshes: meshes.len(),
            total_vertices,
            total_triangles,
            parse_time_ms: parse_time.as_millis() as u64,
            geometry_time_ms: geometry_time.as_millis() as u64,
            total_time_ms: total_time.as_millis() as u64,
            from_cache: false,
        },
    }
}

/// OPTIMIZATION: Build both style indices in a single pass through entities.
/// Previously, build_geometry_style_index and build_element_style_index each scanned all entities.
/// This combined function scans once and builds both maps together, reducing I/O overhead.
fn build_style_indices(
    content: &str,
    decoder: &mut EntityDecoder,
) -> FxHashMap<u32, [f32; 4]> {
    // Phase 1: Single scan to collect styled items and geometry-bearing elements
    let mut geometry_styles: FxHashMap<u32, [f32; 4]> = FxHashMap::default();
    let mut element_repr_ids: Vec<(u32, u32)> = Vec::with_capacity(2000); // (element_id, repr_id)
    let mut scanner = EntityScanner::new(content);

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        // Collect IfcStyledItem data
        if type_name == "IFCSTYLEDITEM" {
            if let Ok(styled_item) = decoder.decode_at(start, end) {
                if let Some(geometry_id) = styled_item.get_ref(0) {
                    if !geometry_styles.contains_key(&geometry_id) {
                        if let Some(color) = extract_color_from_styled_item(&styled_item, decoder) {
                            geometry_styles.insert(geometry_id, color);
                        }
                    }
                }
            }
        }
        // Collect geometry-bearing element representation IDs
        else if ifc_lite_core::has_geometry_by_name(type_name) {
            if let Ok(element) = decoder.decode_at(start, end) {
                if let Some(repr_id) = element.get_ref(6) {
                    element_repr_ids.push((id, repr_id));
                }
            }
        }
    }

    // Phase 2: Build element style index using collected data (no re-scan needed)
    let mut element_styles: FxHashMap<u32, [f32; 4]> = FxHashMap::default();
    for (element_id, repr_id) in element_repr_ids {
        if let Some(color) = find_color_in_representation(repr_id, &geometry_styles, decoder) {
            element_styles.insert(element_id, color);
        }
    }

    element_styles
}

/// Find a color in a representation by traversing its items.
fn find_color_in_representation(
    repr_id: u32,
    geometry_styles: &FxHashMap<u32, [f32; 4]>,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    // Decode the IfcProductDefinitionShape
    let repr = decoder.decode_by_id(repr_id).ok()?;

    // Attribute 2: Representations (list of IfcRepresentation)
    let repr_list = get_refs_from_list(&repr, 2)?;

    for shape_repr_id in repr_list {
        if let Ok(shape_repr) = decoder.decode_by_id(shape_repr_id) {
            // Attribute 3: Items (list of IfcRepresentationItem)
            if let Some(items) = get_refs_from_list(&shape_repr, 3) {
                for item_id in items {
                    // Check direct style
                    if let Some(color) = geometry_styles.get(&item_id) {
                        return Some(*color);
                    }

                    // Check mapped items
                    if let Ok(item) = decoder.decode_by_id(item_id) {
                        if item.ifc_type == IfcType::IfcMappedItem {
                            if let Some(source_id) = item.get_ref(0) {
                                if let Ok(source) = decoder.decode_by_id(source_id) {
                                    if let Some(mapped_repr_id) = source.get_ref(1) {
                                        if let Some(color) = find_color_in_shape_representation(
                                            mapped_repr_id,
                                            geometry_styles,
                                            decoder,
                                        ) {
                                            return Some(color);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Find color in a shape representation.
fn find_color_in_shape_representation(
    repr_id: u32,
    geometry_styles: &FxHashMap<u32, [f32; 4]>,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    let repr = decoder.decode_by_id(repr_id).ok()?;
    let items = get_refs_from_list(&repr, 3)?;

    for item_id in items {
        if let Some(color) = geometry_styles.get(&item_id) {
            return Some(*color);
        }
    }

    None
}

/// Extract color from an IfcStyledItem by traversing style references.
fn extract_color_from_styled_item(
    styled_item: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    // Attribute 1: Styles (list of style refs)
    let style_refs = get_refs_from_list(styled_item, 1)?;

    for style_id in style_refs {
        if let Ok(style) = decoder.decode_by_id(style_id) {
            // IfcPresentationStyleAssignment has Styles at attr 0
            if let Some(inner_refs) = get_refs_from_list(&style, 0) {
                for inner_id in inner_refs {
                    if let Some(color) = extract_surface_style_color(inner_id, decoder) {
                        return Some(color);
                    }
                }
            }
            // Or it might be IfcSurfaceStyle directly
            if let Some(color) = extract_surface_style_color(style_id, decoder) {
                return Some(color);
            }
        }
    }

    None
}

/// Extract color from an IfcSurfaceStyle.
fn extract_surface_style_color(style_id: u32, decoder: &mut EntityDecoder) -> Option<[f32; 4]> {
    let style = decoder.decode_by_id(style_id).ok()?;

    // IfcSurfaceStyle: Attr 2 = Styles (list of rendering styles)
    let rendering_refs = get_refs_from_list(&style, 2)?;

    for rendering_id in rendering_refs {
        if let Ok(rendering) = decoder.decode_by_id(rendering_id) {
            // IfcSurfaceStyleRendering: Attr 0 = SurfaceColour
            if let Some(color_id) = rendering.get_ref(0) {
                if let Ok(color) = decoder.decode_by_id(color_id) {
                    // IfcColourRgb: Attr 1 = Red, Attr 2 = Green, Attr 3 = Blue
                    let r = color.get_float(1).unwrap_or(0.8) as f32;
                    let g = color.get_float(2).unwrap_or(0.8) as f32;
                    let b = color.get_float(3).unwrap_or(0.8) as f32;

                    // Check for transparency (Attr 8 in IfcSurfaceStyleRendering)
                    let alpha: f32 = 1.0 - rendering.get_float(8).unwrap_or(0.0) as f32;

                    return Some([r, g, b, alpha.max(0.0).min(1.0)]);
                }
            }
        }
    }

    None
}

/// Get default color based on IFC type.
fn get_default_color(ifc_type: &IfcType) -> [f32; 4] {
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
        IfcType::IfcStair | IfcType::IfcStairFlight => [0.75, 0.75, 0.75, 1.0],

        // Railings
        IfcType::IfcRailing => [0.4, 0.4, 0.45, 1.0],

        // Plates/Coverings
        IfcType::IfcPlate | IfcType::IfcCovering => [0.8, 0.8, 0.8, 1.0],

        // Furniture
        IfcType::IfcFurnishingElement => [0.5, 0.35, 0.2, 1.0],

        // Space - cyan transparent (matches MainToolbar)
        IfcType::IfcSpace => [0.2, 0.85, 1.0, 0.3],

        // Opening elements - red-orange transparent
        IfcType::IfcOpeningElement => [1.0, 0.42, 0.29, 0.4],

        // Site - green
        IfcType::IfcSite => [0.4, 0.8, 0.3, 1.0],

        // Building element proxy - generic gray
        IfcType::IfcBuildingElementProxy => [0.6, 0.6, 0.6, 1.0],

        // Default - neutral gray
        _ => [0.8, 0.8, 0.8, 1.0],
    }
}
