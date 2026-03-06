// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! IFC processing service with parallel geometry extraction.

use crate::types::mesh::MeshData;
use crate::types::response::{CoordinateInfo, ModelMetadata, ProcessingStats};
use ifc_lite_core::{
    build_entity_index, scan_placement_bounds, DecodedEntity, EntityDecoder, EntityScanner, IfcType,
};
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
    global_id: Option<String>,
    name: Option<String>,
    presentation_layer: Option<String>,
}

#[derive(Debug, Clone)]
struct GeometryStyleInfo {
    color: [f32; 4],
    material_name: Option<String>,
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

fn normalize_optional_string(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() || value == "$" {
        return None;
    }
    Some(value.to_string())
}

/// Process IFC content with parallel geometry extraction.
pub fn process_geometry(content: &str) -> ProcessingResult {
    let total_start = std::time::Instant::now();
    let parse_start = std::time::Instant::now();

    tracing::info!(
        content_size = content.len(),
        "Starting IFC geometry processing"
    );

    // Build entity index (fast - single pass)
    let entity_index = Arc::new(build_entity_index(content));
    let mut decoder = EntityDecoder::with_arc_index(content, entity_index.clone());
    tracing::debug!("Built entity index");

    // OPTIMIZATION: Build style indices in a single pass (previously two separate scans)
    let geometry_style_index = Arc::new(build_geometry_style_indices(content, &mut decoder));
    let style_index = Arc::new(build_style_indices(
        content,
        &mut decoder,
        geometry_style_index.as_ref(),
    ));
    let presentation_layer_by_assigned_id =
        build_presentation_layer_lookup_by_assigned_representation(content, &mut decoder);
    let mut presentation_layer_cache_by_repr: FxHashMap<u32, Option<String>> = FxHashMap::default();

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
                let global_id = normalize_optional_string(entity.get_string(0));
                let name = normalize_optional_string(entity.get_string(2));
                let presentation_layer =
                    entity.get_ref(6).and_then(|product_definition_shape_id| {
                        resolve_presentation_layer_for_product_definition_shape(
                            product_definition_shape_id,
                            &presentation_layer_by_assigned_id,
                            &mut presentation_layer_cache_by_repr,
                            &mut decoder,
                        )
                    });

                entity_jobs.push(EntityJob {
                    id,
                    type_name: type_name.to_string(),
                    ifc_type: entity.ifc_type,
                    start,
                    end,
                    global_id,
                    name,
                    presentation_layer,
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
    let mut router = GeometryRouter::with_units(content, &mut decoder);
    let rtc_jobs: Vec<(u32, usize, usize, IfcType)> = entity_jobs
        .iter()
        .map(|j| (j.id, j.start, j.end, j.ifc_type))
        .collect();
    let mut rtc_offset = router.detect_rtc_offset_from_jobs(&rtc_jobs, &mut decoder);
    if rtc_offset.0 == 0.0 && rtc_offset.1 == 0.0 && rtc_offset.2 == 0.0 {
        // Fallback for files where large real-world coordinates are encoded in points
        // rather than in placement transforms.
        rtc_offset = scan_placement_bounds(content).rtc_offset();
    }
    router.set_rtc_offset(rtc_offset);
    if !faceted_brep_ids.is_empty() {
        tracing::debug!(count = faceted_brep_ids.len(), "Preprocessing FacetedBreps");
        router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
    }

    let parse_time = parse_start.elapsed();
    tracing::info!(
        parse_time_ms = parse_time.as_millis(),
        "Parse phase complete, starting geometry extraction"
    );

    // PARALLEL GEOMETRY PROCESSING
    let geometry_start = std::time::Instant::now();
    let content_arc = Arc::new(content.to_string());
    let entity_index_arc = entity_index; // Already Arc from above
    let unit_scale = router.unit_scale();
    let rtc_offset = router.rtc_offset();
    let void_index_arc = Arc::new(void_index);

    let meshes: Vec<MeshData> = entity_jobs
        .into_par_iter()
        .flat_map_iter(|job| {
            let mut local_decoder =
                EntityDecoder::with_arc_index(&content_arc, entity_index_arc.clone());

            let entity = match local_decoder.decode_at(job.start, job.end) {
                Ok(entity) => entity,
                Err(_) => return Vec::new(),
            };

            let has_representation = entity.get(6).is_some_and(|a| !a.is_null());
            if !has_representation {
                return Vec::new();
            }

            let local_router = GeometryRouter::with_scale_and_rtc(unit_scale, rtc_offset);
            let global_id = job.global_id.clone();
            let name = job.name.clone();
            let presentation_layer = job.presentation_layer.clone();

            // Preserve subparts for openings so frame/glass can be emitted as distinct meshes.
            if is_opening_with_subparts(&job.ifc_type) {
                if let Ok(sub_meshes) =
                    local_router.process_element_with_submeshes(&entity, &mut local_decoder)
                {
                    if !sub_meshes.is_empty() {
                        let mut out: Vec<MeshData> = Vec::with_capacity(sub_meshes.len());
                        let element_color = style_index
                            .get(&job.id)
                            .copied()
                            .unwrap_or_else(|| get_default_color(&job.ifc_type));

                        for sub in sub_meshes.sub_meshes {
                            let mut sub_mesh = sub.mesh;
                            if sub_mesh.is_empty() {
                                continue;
                            }

                            if sub_mesh.normals.is_empty() {
                                calculate_normals(&mut sub_mesh);
                            }

                            let style = geometry_style_index.get(&sub.geometry_id);
                            let color = style.map(|s| s.color).unwrap_or(element_color);
                            let material_name = style
                                .and_then(|s| s.material_name.as_ref())
                                .map(ToString::to_string);
                            let material_name = material_name.or_else(|| {
                                infer_opening_subpart_material_name(
                                    &job.ifc_type,
                                    color,
                                    sub.geometry_id,
                                )
                            });

                            out.push(
                                MeshData::new(
                                    job.id,
                                    job.ifc_type.name().to_string(),
                                    sub_mesh.positions,
                                    sub_mesh.normals,
                                    sub_mesh.indices,
                                    color,
                                )
                                .with_element_metadata(
                                    global_id.clone(),
                                    name.clone(),
                                    presentation_layer.clone(),
                                )
                                .with_style_metadata(material_name, Some(sub.geometry_id)),
                            );
                        }

                        if !out.is_empty() {
                            return out;
                        }
                    }
                }
            }

            let mut mesh_candidate = local_router
                .process_element_with_voids(&entity, &mut local_decoder, void_index_arc.as_ref())
                .ok();
            let needs_fallback = match mesh_candidate.as_ref() {
                Some(mesh) => mesh.is_empty(),
                None => true,
            };
            if needs_fallback {
                mesh_candidate = local_router
                    .process_element(&entity, &mut local_decoder)
                    .ok();
            }

            if let Some(mut mesh) = mesh_candidate {
                if !mesh.is_empty() {
                    if mesh.normals.is_empty() {
                        calculate_normals(&mut mesh);
                    }

                    let color = style_index
                        .get(&job.id)
                        .copied()
                        .unwrap_or_else(|| get_default_color(&job.ifc_type));

                    return vec![MeshData::new(
                        job.id,
                        job.ifc_type.name().to_string(),
                        mesh.positions,
                        mesh.normals,
                        mesh.indices,
                        color,
                    )
                    .with_element_metadata(global_id, name, presentation_layer)];
                }
            }

            Vec::new()
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
            coordinate_info: CoordinateInfo {
                origin_shift: [rtc_offset.0, rtc_offset.1, rtc_offset.2],
                is_geo_referenced: rtc_offset.0 != 0.0
                    || rtc_offset.1 != 0.0
                    || rtc_offset.2 != 0.0,
            },
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
    geometry_style_index: &FxHashMap<u32, GeometryStyleInfo>,
) -> FxHashMap<u32, [f32; 4]> {
    // Collect geometry-bearing element representation IDs
    let mut element_repr_ids: Vec<(u32, u32)> = Vec::with_capacity(2000); // (element_id, repr_id)
    let mut scanner = EntityScanner::new(content);

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        if ifc_lite_core::has_geometry_by_name(type_name) {
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
        if let Some(color) = find_color_in_representation(repr_id, geometry_style_index, decoder) {
            element_styles.insert(element_id, color);
        }
    }

    element_styles
}

/// Build per-geometry-item style info (color + material/style name).
fn build_geometry_style_indices(
    content: &str,
    decoder: &mut EntityDecoder,
) -> FxHashMap<u32, GeometryStyleInfo> {
    let mut geometry_styles: FxHashMap<u32, GeometryStyleInfo> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);

    while let Some((_, type_name, start, end)) = scanner.next_entity() {
        if type_name != "IFCSTYLEDITEM" {
            continue;
        }

        if let Ok(styled_item) = decoder.decode_at(start, end) {
            if let Some(geometry_id) = styled_item.get_ref(0) {
                if geometry_styles.contains_key(&geometry_id) {
                    continue;
                }

                if let Some(style_info) = extract_style_info_from_styled_item(&styled_item, decoder)
                {
                    geometry_styles.insert(geometry_id, style_info);
                }
            }
        }
    }

    geometry_styles
}

/// Build a lookup from assigned representation/item id -> presentation layer name.
fn build_presentation_layer_lookup_by_assigned_representation(
    content: &str,
    decoder: &mut EntityDecoder,
) -> FxHashMap<u32, String> {
    let mut layer_by_assigned_representation: FxHashMap<u32, String> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);

    while let Some((_, type_name, start, end)) = scanner.next_entity() {
        if type_name != "IFCPRESENTATIONLAYERASSIGNMENT" {
            continue;
        }

        let Ok(layer_assignment) = decoder.decode_at(start, end) else {
            continue;
        };

        let Some(layer_name) = normalize_optional_string(layer_assignment.get_string(0)) else {
            continue;
        };

        let Some(assigned_items) = get_refs_from_list(&layer_assignment, 2) else {
            continue;
        };

        for assigned in assigned_items {
            layer_by_assigned_representation
                .entry(assigned)
                .or_insert_with(|| layer_name.clone());
        }
    }

    layer_by_assigned_representation
}

fn resolve_presentation_layer_for_product_definition_shape(
    product_definition_shape_id: u32,
    layer_by_assigned_representation: &FxHashMap<u32, String>,
    cache_by_representation: &mut FxHashMap<u32, Option<String>>,
    decoder: &mut EntityDecoder,
) -> Option<String> {
    if let Some(layer_name) = layer_by_assigned_representation.get(&product_definition_shape_id) {
        return Some(layer_name.clone());
    }

    let product_definition_shape = decoder.decode_by_id(product_definition_shape_id).ok()?;
    let representation_ids = get_refs_from_list(&product_definition_shape, 2)?;

    for representation_id in representation_ids {
        if let Some(layer_name) = resolve_presentation_layer_name(
            representation_id,
            layer_by_assigned_representation,
            cache_by_representation,
            decoder,
            &mut Vec::new(),
        ) {
            return Some(layer_name);
        }
    }

    None
}

fn resolve_presentation_layer_name(
    representation_id: u32,
    layer_by_assigned_representation: &FxHashMap<u32, String>,
    cache_by_representation: &mut FxHashMap<u32, Option<String>>,
    decoder: &mut EntityDecoder,
    traversal_stack: &mut Vec<u32>,
) -> Option<String> {
    if let Some(cached) = cache_by_representation.get(&representation_id) {
        return cached.clone();
    }

    if traversal_stack.contains(&representation_id) {
        return None;
    }
    traversal_stack.push(representation_id);

    if let Some(layer_name) = layer_by_assigned_representation.get(&representation_id) {
        let result = Some(layer_name.clone());
        cache_by_representation.insert(representation_id, result.clone());
        traversal_stack.pop();
        return result;
    }

    let mut resolved: Option<String> = None;

    if let Ok(representation) = decoder.decode_by_id(representation_id) {
        if let Some(items) = get_refs_from_list(&representation, 3) {
            for item_id in items {
                if let Some(layer_name) = layer_by_assigned_representation.get(&item_id) {
                    resolved = Some(layer_name.clone());
                    break;
                }

                if let Ok(item) = decoder.decode_by_id(item_id) {
                    if item.ifc_type == IfcType::IfcMappedItem {
                        if let Some(mapping_source_id) = item.get_ref(0) {
                            if let Ok(mapping_source) = decoder.decode_by_id(mapping_source_id) {
                                if let Some(mapped_representation_id) = mapping_source.get_ref(1) {
                                    if let Some(layer_name) = resolve_presentation_layer_name(
                                        mapped_representation_id,
                                        layer_by_assigned_representation,
                                        cache_by_representation,
                                        decoder,
                                        traversal_stack,
                                    ) {
                                        resolved = Some(layer_name);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    traversal_stack.pop();
    cache_by_representation.insert(representation_id, resolved.clone());
    resolved
}

/// Find a color in a representation by traversing its items.
fn find_color_in_representation(
    repr_id: u32,
    geometry_styles: &FxHashMap<u32, GeometryStyleInfo>,
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
                    if let Some(style) = geometry_styles.get(&item_id) {
                        return Some(style.color);
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
    geometry_styles: &FxHashMap<u32, GeometryStyleInfo>,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    let repr = decoder.decode_by_id(repr_id).ok()?;
    let items = get_refs_from_list(&repr, 3)?;

    for item_id in items {
        if let Some(style) = geometry_styles.get(&item_id) {
            return Some(style.color);
        }
    }

    None
}

/// Extract color from an IfcStyledItem by traversing style references.
fn extract_style_info_from_styled_item(
    styled_item: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Option<GeometryStyleInfo> {
    let style_refs = get_refs_from_list(styled_item, 1)?;

    for style_id in style_refs {
        if let Ok(style) = decoder.decode_by_id(style_id) {
            // IfcPresentationStyleAssignment has nested style refs at attr 0.
            if let Some(inner_refs) = get_refs_from_list(&style, 0) {
                for inner_id in inner_refs {
                    if let Some(info) = extract_surface_style_info(inner_id, decoder) {
                        return Some(info);
                    }
                }
            }

            // Or the style ref points directly to IfcSurfaceStyle.
            if let Some(info) = extract_surface_style_info(style_id, decoder) {
                return Some(info);
            }
        }
    }

    None
}

/// Extract color + style name from an IfcSurfaceStyle.
fn extract_surface_style_info(
    style_id: u32,
    decoder: &mut EntityDecoder,
) -> Option<GeometryStyleInfo> {
    let style = decoder.decode_by_id(style_id).ok()?;
    let material_name = normalize_style_name(style.get_string(0));

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

                    // Transparency: 0.0 = opaque, 1.0 = transparent
                    let alpha: f32 = 1.0 - rendering.get_float(1).unwrap_or(0.0) as f32;

                    return Some(GeometryStyleInfo {
                        color: [r, g, b, alpha.max(0.0).min(1.0)],
                        material_name: material_name.clone(),
                    });
                }
            }
        }
    }

    None
}

fn normalize_style_name(raw: Option<&str>) -> Option<String> {
    let name = raw?.trim();
    if name.is_empty() || name == "$" {
        return None;
    }

    if name.eq_ignore_ascii_case("<unnamed>") || name.eq_ignore_ascii_case("unnamed") {
        return None;
    }

    Some(name.to_string())
}

/// Extract color from an IfcStyledItem by traversing style references.
fn extract_color_from_styled_item(
    styled_item: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    extract_style_info_from_styled_item(styled_item, decoder).map(|s| s.color)
}

/// Extract color from an IfcSurfaceStyle.
fn extract_surface_style_color(style_id: u32, decoder: &mut EntityDecoder) -> Option<[f32; 4]> {
    extract_surface_style_info(style_id, decoder).map(|s| s.color)
}

fn is_opening_with_subparts(ifc_type: &IfcType) -> bool {
    matches!(ifc_type, IfcType::IfcWindow | IfcType::IfcDoor)
}

fn infer_opening_subpart_material_name(
    ifc_type: &IfcType,
    color: [f32; 4],
    geometry_id: u32,
) -> Option<String> {
    if !is_opening_with_subparts(ifc_type) {
        return None;
    }

    let prefix = match ifc_type {
        IfcType::IfcDoor => "Door",
        _ => "Window",
    };

    // Transparency is a practical proxy for glazing in many BIM exports.
    if color[3] <= 0.65 {
        return Some(format!("{}_Glass", prefix));
    }

    Some(format!("{}_Frame_{}", prefix, geometry_id))
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
