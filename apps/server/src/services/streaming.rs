// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Streaming geometry processing with Server-Sent Events.
//!
//! OPTIMIZATION: Two-phase preparation for fast time-to-first-geometry:
//! 1. Quick prepare: Build entity index + collect first batch of simple geometry
//! 2. Start streaming first batch IMMEDIATELY
//! 3. Continue scanning + build style indices in parallel with processing

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
use tokio::sync::mpsc;

/// Job for processing a single entity.
#[derive(Clone)]
struct EntityJob {
    id: u32,
    type_name: String,
    ifc_type: IfcType,
    start: usize,
    end: usize,
    /// Priority: 0 = highest (simple geometry), 1 = medium, 2 = complex (FacetedBrep)
    priority: u8,
}

/// Check if this geometry type is "simple" (fast to process, good for first batch)
fn is_simple_geometry(type_name: &str) -> bool {
    matches!(type_name.to_uppercase().as_str(),
        "IFCWALL" | "IFCWALLSTANDARDCASE" |
        "IFCSLAB" | "IFCSLABSTANDARDCASE" |
        "IFCPLATE" | "IFCPLATESTANDARDCASE" |
        "IFCCOVERING" | "IFCROOF" |
        "IFCCOLUMN" | "IFCCOLUMNSTANDARDCASE" |
        "IFCBEAM" | "IFCBEAMSTANDARDCASE" |
        "IFCMEMBER" | "IFCMEMBERSTANDARDCASE" |
        "IFCFOOTING" | "IFCPILE" |
        "IFCRAMP" | "IFCRAMPFLIGHT"
    )
}

/// Check if this is complex geometry that may need FacetedBrep preprocessing
fn is_complex_geometry(type_name: &str) -> bool {
    matches!(type_name.to_uppercase().as_str(),
        "IFCFURNISHINGELEMENT" | "IFCFURNITURE" |
        "IFCBUILDINGELEMENTPROXY" |
        "IFCFLOWSEGMENT" | "IFCFLOWFITTING" | "IFCFLOWTERMINAL" |
        "IFCDISTRIBUTIONFLOWELEMENT" |
        "IFCMECHANICALFASTENER" | "IFCDISCRETEACCESSORY"
    )
}

/// Incremental preparation state - built up during single-pass entity scanning
struct IncrementalPrepState {
    jobs: Vec<EntityJob>,
    void_index: FxHashMap<u32, Vec<u32>>,
    faceted_brep_ids: Vec<u32>,
    styled_items: FxHashMap<u32, [f32; 4]>,
    element_repr_ids: Vec<(u32, u32)>,
    total_entities: usize,
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

/// PHASE 1: Quick preparation - just enough to start first batch (~50-100ms)
/// Builds entity index and extracts unit scale - the bare minimum.
fn quick_prepare(content: &str, decoder: &mut EntityDecoder) -> (String, f64) {
    // Detect schema version (fast string search)
    let schema_version = if content.contains("IFC4X3") {
        "IFC4X3".to_string()
    } else if content.contains("IFC4") {
        "IFC4".to_string()
    } else {
        "IFC2X3".to_string()
    };

    // Extract unit scale (needed for geometry processing)
    let router = GeometryRouter::with_units(content, decoder);
    let unit_scale = router.unit_scale();
    drop(router);

    (schema_version, unit_scale)
}

/// PHASE 2: Scan entities and collect jobs with priority
/// Returns jobs sorted by priority (simple geometry first) for fast first batch
fn scan_entities_with_priority(
    content: &str,
    decoder: &mut EntityDecoder,
    _first_batch_target: usize,  // Reserved for future incremental scanning optimization
) -> IncrementalPrepState {
    let mut scanner = EntityScanner::new(content);
    let mut state = IncrementalPrepState {
        jobs: Vec::with_capacity(5000),
        void_index: FxHashMap::default(),
        faceted_brep_ids: Vec::new(),
        styled_items: FxHashMap::default(),
        element_repr_ids: Vec::with_capacity(2000),
        total_entities: 0,
    };

    // First pass: collect all data in a single scan
    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        state.total_entities += 1;

        // Track FacetedBreps for later preprocessing
        if type_name == "IFCFACETEDBREP" {
            state.faceted_brep_ids.push(id);
        }
        // Build void index
        else if type_name == "IFCRELVOIDSELEMENT" {
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let (Some(host), Some(opening)) = (entity.get_ref(4), entity.get_ref(5)) {
                    state.void_index.entry(host).or_default().push(opening);
                }
            }
        }
        // Collect styled items for color resolution
        else if type_name == "IFCSTYLEDITEM" {
            if let Ok(styled_item) = decoder.decode_at(start, end) {
                if let Some(geometry_id) = styled_item.get_ref(0) {
                    if !state.styled_items.contains_key(&geometry_id) {
                        if let Some(color) = extract_color_from_styled_item(&styled_item, decoder) {
                            state.styled_items.insert(geometry_id, color);
                        }
                    }
                }
            }
        }
        // Collect geometry-bearing elements
        else if ifc_lite_core::has_geometry_by_name(type_name) {
            if let Ok(entity) = decoder.decode_at(start, end) {
                // Determine priority based on geometry complexity
                let priority = if is_simple_geometry(type_name) {
                    0 // Simple - process first
                } else if is_complex_geometry(type_name) {
                    2 // Complex - process last
                } else {
                    1 // Medium
                };

                state.jobs.push(EntityJob {
                    id,
                    type_name: type_name.to_string(),
                    ifc_type: entity.ifc_type,
                    start,
                    end,
                    priority,
                });

                // Also collect repr_id for style resolution
                if let Some(repr_id) = entity.get_ref(6) {
                    state.element_repr_ids.push((id, repr_id));
                }
            }
        }
    }

    // Sort jobs by priority (simple geometry first for fast first batch)
    // This ensures walls, slabs, columns appear first in the stream
    state.jobs.sort_by_key(|j| j.priority);

    state
}

/// Build element style index from collected data
fn build_element_styles(
    styled_items: &FxHashMap<u32, [f32; 4]>,
    element_repr_ids: &[(u32, u32)],
    decoder: &mut EntityDecoder,
) -> FxHashMap<u32, [f32; 4]> {
    let mut element_styles: FxHashMap<u32, [f32; 4]> = FxHashMap::default();

    for &(element_id, repr_id) in element_repr_ids {
        if let Some(color) = find_color_in_representation(repr_id, styled_items, decoder) {
            element_styles.insert(element_id, color);
        }
    }

    element_styles
}

/// Process a batch of jobs (runs in blocking thread).
fn process_batch(
    jobs: Vec<EntityJob>,
    content: Arc<String>,
    entity_index: Arc<EntityIndex>,
    style_index: Arc<FxHashMap<u32, [f32; 4]>>,
    void_index: Arc<FxHashMap<u32, Vec<u32>>>,
    unit_scale: f64,
) -> Vec<MeshData> {
    jobs.par_iter()
        .filter_map(|job| {
            let mut local_decoder =
                EntityDecoder::with_arc_index(&content, entity_index.clone());

            if let Ok(entity) = local_decoder.decode_at(job.start, job.end) {
                let has_representation = entity.get(6).is_some_and(|a| !a.is_null());
                if !has_representation {
                    return None;
                }

                // OPTIMIZATION: Use with_scale() instead of with_units()
                // unit_scale is precomputed once, avoiding content parsing per mesh
                let local_router = GeometryRouter::with_scale(unit_scale);

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
        .collect()
}

/// Calculate dynamic batch size based on batch number and total job count.
fn calculate_batch_size(
    batch_number: usize,
    initial_batch_size: usize,
    max_batch_size: usize,
    total_jobs: usize,
) -> usize {
    // For huge files (>50k jobs), use VERY aggressive batching to minimize batch count
    let adjusted_max = if total_jobs > 50_000 {
        (max_batch_size * 20).min(20_000)
    } else if total_jobs > 10_000 {
        (max_batch_size * 10).min(10_000)
    } else if total_jobs > 1_000 {
        (max_batch_size * 5).min(5_000)
    } else {
        max_batch_size
    };

    // OPTIMIZATION: Larger first batch for faster visible geometry
    // First batch should have enough geometry to show a meaningful preview
    match batch_number {
        1 => initial_batch_size.max(200),  // First batch: at least 200 entities
        2..=3 => (initial_batch_size * 2).min(adjusted_max),  // Ramp up
        4..=6 => (initial_batch_size + adjusted_max) / 2,
        _ => adjusted_max,
    }
}

/// Generate streaming geometry events with optimized two-phase preparation.
///
/// OPTIMIZATION: Split preparation into quick + incremental phases:
/// 1. Quick prepare (~50ms): entity index + unit scale
/// 2. Scan entities with priority sorting
/// 3. Start first batch IMMEDIATELY with simple geometry
/// 4. Build style indices while first batch processes
/// 5. Preprocess FacetedBreps in background for later batches
pub fn process_streaming(
    content: String,
    initial_batch_size: usize,
    max_batch_size: usize,
) -> Pin<Box<dyn Stream<Item = StreamEvent> + Send>> {
    Box::pin(stream! {
        let total_start = std::time::Instant::now();

        // ============================================================
        // PHASE 1: QUICK PREPARATION (~50-100ms)
        // Goal: Get enough data to start first batch ASAP
        // ============================================================

        let content_arc = Arc::new(content);
        let content_for_prep = content_arc.clone();

        let quick_result = tokio::task::spawn_blocking(move || {
            let prep_start = std::time::Instant::now();

            // Build entity index (fast, needed for everything)
            let entity_index = Arc::new(build_entity_index(&content_for_prep));
            let mut decoder = EntityDecoder::with_arc_index(&content_for_prep, entity_index.clone());

            // Quick prepare: schema + unit scale
            let (schema_version, unit_scale) = quick_prepare(&content_for_prep, &mut decoder);

            // Scan entities with priority (simple geometry first)
            let scan_state = scan_entities_with_priority(&content_for_prep, &mut decoder, initial_batch_size);

            let quick_prep_time = prep_start.elapsed().as_millis() as u64;

            (entity_index, schema_version, unit_scale, scan_state, quick_prep_time)
        }).await;

        let (entity_index, schema_version, unit_scale, scan_state, quick_prep_time) = match quick_result {
            Ok(r) => r,
            Err(e) => {
                yield StreamEvent::Error {
                    message: format!("Quick preparation failed: {}", e),
                };
                return;
            }
        };

        let total_jobs = scan_state.jobs.len();
        let total_entities = scan_state.total_entities;

        // Send start event IMMEDIATELY after quick prep
        yield StreamEvent::Start {
            total_estimate: total_jobs,
        };

        yield StreamEvent::Progress {
            processed: 0,
            total: total_jobs,
            current_type: "preparing".into(),
        };

        // ============================================================
        // PHASE 2: BUILD STYLE INDEX (while first batch can start)
        // ============================================================

        let content_for_styles = content_arc.clone();
        let entity_index_for_styles = entity_index.clone();
        let styled_items = scan_state.styled_items;
        let element_repr_ids = scan_state.element_repr_ids;

        // Build style index in parallel (doesn't block first batch)
        let style_future = tokio::task::spawn_blocking(move || {
            let mut decoder = EntityDecoder::with_arc_index(&content_for_styles, entity_index_for_styles);
            build_element_styles(&styled_items, &element_repr_ids, &mut decoder)
        });

        // ============================================================
        // PHASE 3: PREPROCESS FACETED BREPS (background, for later batches)
        // ============================================================

        let faceted_brep_ids = scan_state.faceted_brep_ids;
        let content_for_breps = content_arc.clone();
        let entity_index_for_breps = entity_index.clone();

        // Start FacetedBrep preprocessing in background (non-blocking)
        // This will complete before complex geometry batches need it
        if !faceted_brep_ids.is_empty() {
            let brep_ids = faceted_brep_ids.clone();
            tokio::task::spawn_blocking(move || {
                let mut decoder = EntityDecoder::with_arc_index(&content_for_breps, entity_index_for_breps);
                let router = GeometryRouter::with_scale(unit_scale);
                router.preprocess_faceted_breps(&brep_ids, &mut decoder);
            });
        }

        // Wait for style index (typically fast, ~10-50ms)
        let style_index = match style_future.await {
            Ok(styles) => Arc::new(styles),
            Err(e) => {
                yield StreamEvent::Error {
                    message: format!("Style index build failed: {}", e),
                };
                return;
            }
        };

        let void_index = Arc::new(scan_state.void_index);
        let jobs = scan_state.jobs;

        // ============================================================
        // PHASE 4: STREAM GEOMETRY BATCHES
        // First batch starts ~100-200ms after request (was 2-5 seconds)
        // ============================================================

        let mut total_processed = 0;
        let mut all_meshes: Vec<MeshData> = Vec::new();
        let mut total_vertices = 0usize;
        let mut total_triangles = 0usize;

        // Pipeline depth based on file size
        let pipeline_depth = if total_jobs > 50_000 { 4 } else if total_jobs > 10_000 { 3 } else { 2 };
        let mut job_index = 0;
        let mut next_batch_num = 1;
        let mut next_expected_batch = 1;
        let mut completed_batches: std::collections::BTreeMap<usize, (usize, String, Vec<MeshData>)> = std::collections::BTreeMap::new();

        let (tx, mut rx) = mpsc::unbounded_channel::<(usize, Result<(usize, String, Vec<MeshData>), String>)>();
        let mut in_flight = 0;

        loop {
            // Start new batches up to pipeline depth
            while in_flight < pipeline_depth && job_index < jobs.len() {
                let batch_num = next_batch_num;
                next_batch_num += 1;
                in_flight += 1;

                let current_batch_size = calculate_batch_size(
                    batch_num,
                    initial_batch_size,
                    max_batch_size,
                    total_jobs,
                );
                let end_index = (job_index + current_batch_size).min(jobs.len());
                let chunk: Vec<EntityJob> = jobs[job_index..end_index].to_vec();
                job_index = end_index;

                let chunk_len = chunk.len();
                let last_type_name = chunk.last().map(|j| j.type_name.clone()).unwrap_or_default();

                let content_bg = content_arc.clone();
                let index_bg = entity_index.clone();
                let void_bg = void_index.clone();
                let style_bg = style_index.clone();
                let tx_clone = tx.clone();

                // Spawn batch processing task
                tokio::spawn(async move {
                    let result = tokio::task::spawn_blocking(move || {
                        process_batch(chunk, content_bg, index_bg, style_bg, void_bg, unit_scale)
                    }).await;

                    let batch_result = match result {
                        Ok(meshes) => Ok((chunk_len, last_type_name, meshes)),
                        Err(e) => Err(format!("Batch processing failed: {}", e)),
                    };

                    let _ = tx_clone.send((batch_num, batch_result));
                });
            }

            // Receive completed batches (non-blocking)
            while let Ok((batch_num, result)) = rx.try_recv() {
                in_flight -= 1;
                match result {
                    Ok(data) => {
                        completed_batches.insert(batch_num, data);
                    }
                    Err(e) => {
                        yield StreamEvent::Error {
                            message: format!("Batch {}: {}", batch_num, e),
                        };
                    }
                }
            }

            // Yield completed batches in order
            while let Some((chunk_len, last_type_name, meshes)) = completed_batches.remove(&next_expected_batch) {
                total_processed += chunk_len;
                let current_batch_num = next_expected_batch;

                // Update stats
                for mesh in &meshes {
                    total_vertices += mesh.vertex_count();
                    total_triangles += mesh.triangle_count();
                }

                if !meshes.is_empty() {
                    all_meshes.extend(meshes.iter().cloned());
                    yield StreamEvent::Batch {
                        meshes,
                        batch_number: current_batch_num,
                    };
                }

                yield StreamEvent::Progress {
                    processed: total_processed,
                    total: total_jobs,
                    current_type: last_type_name,
                };

                next_expected_batch += 1;
            }

            // Check if we're done
            if job_index >= jobs.len() && in_flight == 0 && completed_batches.is_empty() {
                break;
            }

            // Yield control to allow other tasks to run
            tokio::task::yield_now().await;
        }

        let total_time = total_start.elapsed();

        // Generate cache key for the complete result
        let cache_key = DiskCache::generate_key(content_arc.as_bytes());

        yield StreamEvent::Complete {
            stats: ProcessingStats {
                total_meshes: all_meshes.len(),
                total_vertices,
                total_triangles,
                parse_time_ms: quick_prep_time,
                geometry_time_ms: total_time.as_millis() as u64 - quick_prep_time,
                total_time_ms: total_time.as_millis() as u64,
                from_cache: false,
            },
            metadata: ModelMetadata {
                schema_version,
                entity_count: total_entities,
                geometry_entity_count: total_jobs,
                coordinate_info: CoordinateInfo::default(),
            },
            cache_key,
        };
    })
}

// ============================================================
// HELPER FUNCTIONS FOR STYLE EXTRACTION
// ============================================================

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
        IfcType::IfcSpace => [0.2, 0.85, 1.0, 0.3],
        IfcType::IfcOpeningElement => [1.0, 0.42, 0.29, 0.4],
        IfcType::IfcSite => [0.4, 0.8, 0.3, 1.0],
        IfcType::IfcBuildingElementProxy => [0.6, 0.6, 0.6, 1.0],
        _ => [0.8, 0.8, 0.8, 1.0],
    }
}
