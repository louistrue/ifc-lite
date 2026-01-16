// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Streaming geometry processing with Server-Sent Events.

use crate::services::cache::DiskCache;
use crate::types::{CoordinateInfo, MeshData, ModelMetadata, ProcessingStats, StreamEvent};
use async_stream::stream;
use futures::Stream;
use ifc_lite_core::{build_entity_index, DecodedEntity, EntityDecoder, EntityIndex, EntityScanner, IfcType};
use ifc_lite_geometry::{calculate_normals, GeometryRouter};
use rayon::prelude::*;
use rustc_hash::FxHashMap;
use std::pin::Pin;
use std::sync::Arc;

/// Job for processing a single entity.
#[derive(Clone)]
struct EntityJob {
    id: u32,
    type_name: String,
    ifc_type: IfcType,
    start: usize,
    end: usize,
}

/// Pre-computed data for streaming (all Send-safe).
struct PreparedData {
    content: Arc<String>,
    entity_index: Arc<EntityIndex>,
    style_index: Arc<FxHashMap<u32, [f32; 4]>>,
    void_index: Arc<FxHashMap<u32, Vec<u32>>>,
    jobs: Vec<EntityJob>,
    schema_version: String,
    total_entities: usize,
    parse_time_ms: u64,
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

/// Prepare all data needed for streaming (runs synchronously).
fn prepare_streaming_data(content: String) -> PreparedData {
    let parse_start = std::time::Instant::now();

    // Build entity index
    let entity_index = build_entity_index(&content);
    let mut decoder = EntityDecoder::with_index(&content, entity_index.clone());

    // Build style indices
    let geometry_styles = build_geometry_style_index(&content, &mut decoder);
    let style_index = build_element_style_index(&content, &geometry_styles, &mut decoder);

    // Collect jobs and build void index
    let mut scanner = EntityScanner::new(&content);
    let mut faceted_brep_ids: Vec<u32> = Vec::new();
    let mut void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut jobs: Vec<EntityJob> = Vec::with_capacity(2000);
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
                jobs.push(EntityJob {
                    id,
                    type_name: type_name.to_string(),
                    ifc_type: entity.ifc_type,
                    start,
                    end,
                });
            }
        }
    }

    // Detect schema
    if content.contains("IFC4X3") {
        schema_version = "IFC4X3".into();
    } else if content.contains("IFC4") {
        schema_version = "IFC4".into();
    }

    // Preprocess FacetedBreps
    let router = GeometryRouter::with_units(&content, &mut decoder);
    if !faceted_brep_ids.is_empty() {
        router.preprocess_faceted_breps(&faceted_brep_ids, &mut decoder);
    }
    drop(router); // Explicitly drop non-Send router

    let parse_time_ms = parse_start.elapsed().as_millis() as u64;

    PreparedData {
        content: Arc::new(content),
        entity_index: Arc::new(entity_index),
        style_index: Arc::new(style_index),
        void_index: Arc::new(void_index),
        jobs,
        schema_version,
        total_entities,
        parse_time_ms,
    }
}

/// Process a batch of jobs (runs in blocking thread).
fn process_batch(
    jobs: Vec<EntityJob>,
    content: Arc<String>,
    entity_index: Arc<EntityIndex>,
    style_index: Arc<FxHashMap<u32, [f32; 4]>>,
    void_index: Arc<FxHashMap<u32, Vec<u32>>>,
) -> Vec<MeshData> {
    jobs.par_iter()
        .filter_map(|job| {
            let mut local_decoder =
                EntityDecoder::with_index(&content, (*entity_index).clone());

            if let Ok(entity) = local_decoder.decode_at(job.start, job.end) {
                let has_representation = entity.get(6).is_some_and(|a| !a.is_null());
                if !has_representation {
                    return None;
                }

                let local_router = GeometryRouter::with_units(&content, &mut local_decoder);

                if let Ok(mut mesh) = local_router.process_element_with_voids(
                    &entity,
                    &mut local_decoder,
                    void_index.as_ref(),
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
                            job.type_name.clone(),
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
        .collect()
}

/// Generate streaming geometry events.
pub fn process_streaming(
    content: String,
    batch_size: usize,
) -> Pin<Box<dyn Stream<Item = StreamEvent> + Send>> {
    Box::pin(stream! {
        let total_start = std::time::Instant::now();

        // Prepare data in blocking task (all CPU-intensive work)
        let prepared = tokio::task::spawn_blocking(move || {
            prepare_streaming_data(content)
        }).await;

        let prepared = match prepared {
            Ok(p) => p,
            Err(e) => {
                yield StreamEvent::Error {
                    message: format!("Failed to prepare data: {}", e),
                };
                return;
            }
        };

        let total_jobs = prepared.jobs.len();
        let geometry_entity_count = total_jobs;

        yield StreamEvent::Start {
            total_estimate: total_jobs,
        };

        yield StreamEvent::Progress {
            processed: 0,
            total: total_jobs,
            current_type: "indexing".into(),
        };

        let mut batch_number = 0;
        let mut total_processed = 0;
        let mut all_meshes: Vec<MeshData> = Vec::new();
        let mut total_vertices = 0usize;
        let mut total_triangles = 0usize;

        // Process in batches
        for chunk in prepared.jobs.chunks(batch_size) {
            let chunk_vec: Vec<EntityJob> = chunk.to_vec();
            let content_clone = prepared.content.clone();
            let index_clone = prepared.entity_index.clone();
            let void_clone = prepared.void_index.clone();
            let style_clone = prepared.style_index.clone();

            // Process batch in blocking task
            let chunk_meshes = tokio::task::spawn_blocking(move || {
                process_batch(chunk_vec, content_clone, index_clone, style_clone, void_clone)
            }).await;

            let chunk_meshes = match chunk_meshes {
                Ok(meshes) => meshes,
                Err(e) => {
                    yield StreamEvent::Error {
                        message: format!("Batch processing failed: {}", e),
                    };
                    continue;
                }
            };

            total_processed += chunk.len();
            batch_number += 1;

            // Update stats
            for mesh in &chunk_meshes {
                total_vertices += mesh.vertex_count();
                total_triangles += mesh.triangle_count();
            }

            if !chunk_meshes.is_empty() {
                all_meshes.extend(chunk_meshes.clone());
                yield StreamEvent::Batch {
                    meshes: chunk_meshes,
                    batch_number,
                };
            }

            yield StreamEvent::Progress {
                processed: total_processed,
                total: total_jobs,
                current_type: chunk.last().map(|j| j.type_name.clone()).unwrap_or_default(),
            };
        }

        let total_time = total_start.elapsed();

        // Generate cache key for the complete result
        let cache_key = DiskCache::generate_key(prepared.content.as_bytes());

        yield StreamEvent::Complete {
            stats: ProcessingStats {
                total_meshes: all_meshes.len(),
                total_vertices,
                total_triangles,
                parse_time_ms: prepared.parse_time_ms,
                geometry_time_ms: total_time.as_millis() as u64 - prepared.parse_time_ms,
                total_time_ms: total_time.as_millis() as u64,
                from_cache: false,
            },
            metadata: ModelMetadata {
                schema_version: prepared.schema_version,
                entity_count: prepared.total_entities,
                geometry_entity_count,
                coordinate_info: CoordinateInfo::default(),
            },
            cache_key,
        };
    })
}

// Helper functions for style extraction

fn build_geometry_style_index(
    content: &str,
    decoder: &mut EntityDecoder,
) -> FxHashMap<u32, [f32; 4]> {
    let mut style_index: FxHashMap<u32, [f32; 4]> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);

    while let Some((_id, type_name, start, end)) = scanner.next_entity() {
        if type_name != "IFCSTYLEDITEM" {
            continue;
        }

        let styled_item = match decoder.decode_at(start, end) {
            Ok(entity) => entity,
            Err(_) => continue,
        };

        let geometry_id = match styled_item.get_ref(0) {
            Some(id) => id,
            None => continue,
        };

        if style_index.contains_key(&geometry_id) {
            continue;
        }

        if let Some(color) = extract_color_from_styled_item(&styled_item, decoder) {
            style_index.insert(geometry_id, color);
        }
    }

    style_index
}

fn build_element_style_index(
    content: &str,
    geometry_styles: &FxHashMap<u32, [f32; 4]>,
    decoder: &mut EntityDecoder,
) -> FxHashMap<u32, [f32; 4]> {
    let mut element_styles: FxHashMap<u32, [f32; 4]> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);

    while let Some((element_id, type_name, start, end)) = scanner.next_entity() {
        if !ifc_lite_core::has_geometry_by_name(type_name) {
            continue;
        }

        let element = match decoder.decode_at(start, end) {
            Ok(entity) => entity,
            Err(_) => continue,
        };

        let repr_id = match element.get_ref(6) {
            Some(id) => id,
            None => continue,
        };

        if let Some(color) = find_color_in_representation(repr_id, geometry_styles, decoder) {
            element_styles.insert(element_id, color);
        }
    }

    element_styles
}

fn find_color_in_representation(
    repr_id: u32,
    geometry_styles: &FxHashMap<u32, [f32; 4]>,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    let repr = decoder.decode_by_id(repr_id).ok()?;
    let repr_list = get_refs_from_list(&repr, 2)?;

    for shape_repr_id in repr_list {
        if let Ok(shape_repr) = decoder.decode_by_id(shape_repr_id) {
            if let Some(items) = get_refs_from_list(&shape_repr, 3) {
                for item_id in items {
                    if let Some(color) = geometry_styles.get(&item_id) {
                        return Some(*color);
                    }

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

fn extract_color_from_styled_item(
    styled_item: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Option<[f32; 4]> {
    let style_refs = get_refs_from_list(styled_item, 1)?;

    for style_id in style_refs {
        if let Ok(style) = decoder.decode_by_id(style_id) {
            if let Some(inner_refs) = get_refs_from_list(&style, 0) {
                for inner_id in inner_refs {
                    if let Some(color) = extract_surface_style_color(inner_id, decoder) {
                        return Some(color);
                    }
                }
            }
            if let Some(color) = extract_surface_style_color(style_id, decoder) {
                return Some(color);
            }
        }
    }

    None
}

fn extract_surface_style_color(style_id: u32, decoder: &mut EntityDecoder) -> Option<[f32; 4]> {
    let style = decoder.decode_by_id(style_id).ok()?;
    let rendering_refs = get_refs_from_list(&style, 2)?;

    for rendering_id in rendering_refs {
        if let Ok(rendering) = decoder.decode_by_id(rendering_id) {
            if let Some(color_id) = rendering.get_ref(0) {
                if let Ok(color) = decoder.decode_by_id(color_id) {
                    let r = color.get_float(1).unwrap_or(0.8) as f32;
                    let g = color.get_float(2).unwrap_or(0.8) as f32;
                    let b = color.get_float(3).unwrap_or(0.8) as f32;
                    let alpha: f32 = 1.0 - rendering.get_float(8).unwrap_or(0.0) as f32;

                    return Some([r, g, b, alpha.max(0.0).min(1.0)]);
                }
            }
        }
    }

    None
}

fn get_default_color(ifc_type: &IfcType) -> [f32; 4] {
    match ifc_type {
        IfcType::IfcWall | IfcType::IfcWallStandardCase => [0.85, 0.85, 0.85, 1.0],
        IfcType::IfcSlab => [0.7, 0.7, 0.7, 1.0],
        IfcType::IfcRoof => [0.6, 0.5, 0.4, 1.0],
        IfcType::IfcColumn | IfcType::IfcBeam | IfcType::IfcMember => [0.6, 0.65, 0.7, 1.0],
        IfcType::IfcWindow => [0.6, 0.8, 1.0, 0.4],
        IfcType::IfcDoor => [0.6, 0.45, 0.3, 1.0],
        IfcType::IfcStair | IfcType::IfcStairFlight => [0.75, 0.75, 0.75, 1.0],
        IfcType::IfcRailing => [0.4, 0.4, 0.45, 1.0],
        IfcType::IfcPlate | IfcType::IfcCovering => [0.8, 0.8, 0.8, 1.0],
        IfcType::IfcFurnishingElement => [0.5, 0.35, 0.2, 1.0],
        IfcType::IfcSpace => [0.7, 0.8, 0.95, 0.15],
        IfcType::IfcBuildingElementProxy => [0.6, 0.6, 0.6, 1.0],
        _ => [0.8, 0.8, 0.8, 1.0],
    }
}
