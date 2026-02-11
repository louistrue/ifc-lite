// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Post-processing filters to reliably extract only structural walls
//! from floor plan detection results.
//!
//! The raw Hough-line detection picks up many non-wall elements:
//! - Door swing arcs (quarter-circle indicators)
//! - Furniture outlines (sofas, beds, tables)
//! - Dimension lines and text
//! - Appliance outlines (toilets, sinks, stoves)
//!
//! This module applies a multi-stage filter pipeline:
//! 1. Axis-alignment: walls are nearly H or V; furniture/arcs are diagonal
//! 2. Arc detection: groups of short segments forming curves → door swings
//! 3. Connectivity: real walls form a connected graph; furniture is isolated
//! 4. Duplicate/overlap removal: merge near-duplicate detections

use crate::image_ops::BuildingRegion;
use crate::types::{DetectedOpening, DetectedWall, OpeningType, Point2D, WallType};
use std::f64::consts::PI;

/// Configuration for wall filtering
#[derive(Debug, Clone)]
pub struct WallFilterConfig {
    /// Maximum angle deviation from horizontal/vertical to be considered a wall (radians).
    /// Default: ~8 degrees (0.14 rad). Walls are almost always axis-aligned.
    pub axis_angle_tolerance: f64,

    /// Distance tolerance for considering two wall endpoints as "connected" (pixels).
    /// Default: 20.0
    pub connection_tolerance: f64,

    /// Minimum number of connections a wall must have (at either endpoint) to survive
    /// connectivity filtering. Default: 1
    pub min_connections: usize,

    /// Minimum wall length after filtering (pixels). Shorter segments are discarded.
    /// Default: 60.0
    pub min_filtered_length: f64,

    /// Maximum distance between parallel overlapping walls to merge them (pixels).
    /// Default: 15.0
    pub overlap_merge_distance: f64,

    /// Radius to search for arc patterns (pixels). Door arcs are typically 30-80px radius.
    pub arc_detection_radius_min: f64,
    pub arc_detection_radius_max: f64,

    /// Minimum number of segments to form a detected arc. Default: 3
    pub arc_min_segments: usize,

    /// Scale factor (m/px) — used for thickness normalization.
    pub scale: f64,

    /// Maximum wall thickness in meters. Default: 0.35m (exterior walls)
    pub max_wall_thickness_m: f64,

    /// Interior wall thickness in meters. Default: 0.15m
    pub interior_wall_thickness_m: f64,

    /// Exterior wall thickness in meters. Default: 0.25m
    pub exterior_wall_thickness_m: f64,

    /// Collinear merge gap: max gap (px) between collinear walls to merge. Default: 60.0
    pub collinear_merge_gap: f64,

    /// Image dimensions (px) — used for exterior wall inference
    pub image_width: f64,
    pub image_height: f64,

    /// Building region detected from the image.
    /// Used to filter out dimension lines and guide inference.
    pub building_region: Option<BuildingRegion>,
}

impl Default for WallFilterConfig {
    fn default() -> Self {
        Self {
            axis_angle_tolerance: 0.14, // ~8 degrees
            connection_tolerance: 20.0,
            min_connections: 1,
            min_filtered_length: 60.0,
            overlap_merge_distance: 15.0,
            arc_detection_radius_min: 20.0,
            arc_detection_radius_max: 120.0,
            arc_min_segments: 3,
            scale: 0.01875,
            max_wall_thickness_m: 0.35,
            interior_wall_thickness_m: 0.15,
            exterior_wall_thickness_m: 0.25,
            collinear_merge_gap: 60.0,
            image_width: 800.0,
            image_height: 600.0,
            building_region: None,
        }
    }
}

/// Result of the filtering pipeline
#[derive(Debug, Clone)]
pub struct FilterResult {
    /// Walls that passed all filters (structural walls only)
    pub walls: Vec<DetectedWall>,
    /// Detected door openings from arc patterns
    pub door_openings: Vec<DetectedOpening>,
    /// Statistics about what was filtered
    pub stats: FilterStats,
}

/// Statistics from the filtering pipeline
#[derive(Debug, Clone, Default)]
pub struct FilterStats {
    pub input_count: usize,
    pub removed_diagonal: usize,
    pub removed_arcs: usize,
    pub removed_disconnected: usize,
    pub removed_short: usize,
    pub removed_overlap: usize,
    pub final_count: usize,
    pub doors_detected: usize,
}

/// Main filtering pipeline: takes raw detected walls and returns only structural walls
pub fn filter_walls(walls: Vec<DetectedWall>, config: &WallFilterConfig) -> FilterResult {
    let mut stats = FilterStats {
        input_count: walls.len(),
        ..Default::default()
    };

    // Step 0: Remove walls outside the building region (dimension lines, title blocks)
    let walls = if let Some(ref region) = config.building_region {
        filter_outside_building(&walls, region)
    } else {
        walls
    };

    // Compute RAW bounding box before any filtering — used for exterior wall inference
    let raw_bbox = compute_bbox(&walls);

    // Step 1: Axis-alignment filter — remove diagonal lines (furniture, arcs, dimension arrows)
    let before = walls.len();
    let walls = filter_axis_aligned(&walls, config.axis_angle_tolerance);
    stats.removed_diagonal = before - walls.len();

    // Step 2: Arc detection — find and remove door swing arcs, record door positions
    let before = walls.len();
    let (walls, door_openings) = detect_and_remove_arcs(walls, config);
    stats.removed_arcs = before - walls.len();
    stats.doors_detected = door_openings.len();

    // Step 3: Minimum length filter
    let before = walls.len();
    let walls = filter_by_length(&walls, config.min_filtered_length);
    stats.removed_short = before - walls.len();

    // Step 4: Remove overlapping/duplicate walls (parallel edge pairs → single centerline)
    let before = walls.len();
    let walls = remove_overlapping_walls(walls, config.overlap_merge_distance);
    stats.removed_overlap = before - walls.len();

    // Step 5: Snap to axes and remove any remaining diagonals
    let walls = snap_walls_to_axes(&walls, config.axis_angle_tolerance);
    let walls: Vec<DetectedWall> = walls
        .into_iter()
        .filter(|w| is_axis_aligned(w, config.axis_angle_tolerance))
        .collect();

    // Step 6: Merge collinear fragments BEFORE connectivity
    // (door openings break walls into fragments — merge them first so the
    // full-length wall can participate in the connectivity graph)
    let walls = merge_collinear_fragments(&walls, config.axis_angle_tolerance, config.collinear_merge_gap);

    // Step 7: Connectivity filter — NOW with merged walls forming a larger network
    let before = walls.len();
    let walls = filter_by_connectivity(&walls, config);
    stats.removed_disconnected = before - walls.len();

    // Step 8: Infer missing exterior walls — only where image shows walls
    let walls = if let Some(ref region) = config.building_region {
        infer_exterior_walls_from_image(walls, config, region)
    } else {
        infer_exterior_walls(walls, config, &raw_bbox)
    };

    // Step 9: Compute the building envelope from inferred walls (true boundary)
    // Use only Exterior walls that span significant portions to determine edges.
    let envelope = compute_smart_envelope(&walls);

    // Step 10: Clip walls that extend past the building envelope
    let walls = clip_walls_to_envelope(&walls, &envelope);

    // Step 11: Extend exterior walls to meet the building envelope
    let walls = extend_exterior_to_envelope(&walls, &envelope, config);

    // Step 12: Extend walls to form T-junctions with nearby perpendicular walls
    let walls = extend_to_t_junctions(&walls, config.connection_tolerance);

    // Step 13: Remove degenerate walls (zero-length from T-junction collapse)
    let walls: Vec<DetectedWall> = walls.into_iter().filter(|w| w.length() > 5.0).collect();

    // Step 14: Classify walls near the building envelope as Exterior
    let walls = classify_envelope_walls(walls, &envelope);

    // Step 15: Normalize wall thickness to realistic values
    let walls = normalize_wall_thickness(&walls, config);

    stats.final_count = walls.len();

    FilterResult {
        walls,
        door_openings,
        stats,
    }
}

// ─── Step 1: Axis-Alignment Filter ──────────────────────────────────────────

/// Keep only walls that are approximately horizontal or vertical.
///
/// In typical floor plans, structural walls are axis-aligned. Diagonal segments
/// are usually: door swing arcs, furniture edges, stair lines, dimension arrows.
fn filter_axis_aligned(walls: &[DetectedWall], tolerance: f64) -> Vec<DetectedWall> {
    walls
        .iter()
        .filter(|wall| {
            if wall.centerline.len() < 2 {
                return false;
            }
            let start = &wall.centerline[0];
            let end = wall.centerline.last().unwrap();
            let angle = (end.y - start.y).atan2(end.x - start.x).abs();

            // Check if near horizontal (0 or PI) or near vertical (PI/2)
            let near_horizontal = angle < tolerance || angle > (PI - tolerance);
            let near_vertical = (angle - PI / 2.0).abs() < tolerance;

            near_horizontal || near_vertical
        })
        .cloned()
        .collect()
}

// ─── Step 2: Arc Detection ──────────────────────────────────────────────────

/// Detect groups of short, co-radial segments that form door swing arcs.
///
/// Door arcs in floor plans are quarter-circles drawn near wall endpoints.
/// After axis filtering, most arc segments are already gone, but some short
/// H/V segments that are part of a stepped arc approximation may survive.
///
/// This function also detects door openings by finding wall gaps near arc centers.
fn detect_and_remove_arcs(
    walls: Vec<DetectedWall>,
    config: &WallFilterConfig,
) -> (Vec<DetectedWall>, Vec<DetectedOpening>) {
    // After axis-alignment filtering, most arc segments are already removed.
    // What might remain: short H or V segments that were part of a pixelated arc.
    //
    // Strategy: look for clusters of short segments whose midpoints lie on
    // a circle of radius R (within tolerance).

    let mut door_openings = Vec::new();
    let mut is_arc_segment = vec![false; walls.len()];

    // Only consider short segments as potential arc parts
    let short_threshold = 40.0; // pixels

    let short_indices: Vec<usize> = walls
        .iter()
        .enumerate()
        .filter(|(_, w)| w.length() < short_threshold)
        .map(|(i, _)| i)
        .collect();

    // For each pair of short segments, check if they could share an arc center
    // Use a voting approach: for each short segment, compute candidate centers
    // at various radii and see if others agree.
    let mut arc_groups: Vec<Vec<usize>> = Vec::new();
    let mut assigned = vec![false; walls.len()];

    for &i in &short_indices {
        if assigned[i] {
            continue;
        }

        let mid_i = wall_midpoint(&walls[i]);
        let mut group = vec![i];

        for &j in &short_indices {
            if i == j || assigned[j] {
                continue;
            }

            let mid_j = wall_midpoint(&walls[j]);
            let dist = mid_i.distance_to(&mid_j);

            // If two short segments are close together, they might be part of the same arc
            if dist < config.arc_detection_radius_max * 2.0 {
                // Check if they share a plausible center point
                // For an arc of radius R, both midpoints should be ~R from the center
                // The center would be near a wall endpoint (the door hinge)
                let close_enough = check_shared_arc_center(
                    &walls[i],
                    &walls[j],
                    config.arc_detection_radius_min,
                    config.arc_detection_radius_max,
                );

                if close_enough {
                    group.push(j);
                }
            }
        }

        if group.len() >= config.arc_min_segments {
            // This is likely an arc pattern
            for &idx in &group {
                is_arc_segment[idx] = true;
                assigned[idx] = true;
            }

            // Estimate door position from arc center
            if let Some(opening) = estimate_door_from_arc(&walls, &group) {
                door_openings.push(opening);
            }

            arc_groups.push(group);
        }
    }

    // Also: remove any remaining very-short segments that are isolated
    // (not connected to longer walls). These are usually fixture symbols.
    let long_walls: Vec<&DetectedWall> = walls
        .iter()
        .enumerate()
        .filter(|(i, w)| !is_arc_segment[*i] && w.length() >= short_threshold)
        .map(|(_, w)| w)
        .collect();

    for (i, wall) in walls.iter().enumerate() {
        if is_arc_segment[i] || wall.length() >= short_threshold {
            continue;
        }
        // Short segment: check if it connects to any long wall
        let connected = long_walls.iter().any(|lw| {
            endpoints_close(&wall.centerline[0], lw, 15.0)
                || endpoints_close(wall.centerline.last().unwrap(), lw, 15.0)
        });
        if !connected {
            is_arc_segment[i] = true; // Mark for removal
        }
    }

    let filtered: Vec<DetectedWall> = walls
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !is_arc_segment[*i])
        .map(|(_, w)| w)
        .collect();

    (filtered, door_openings)
}

/// Check if two walls could share a common arc center
fn check_shared_arc_center(
    w1: &DetectedWall,
    w2: &DetectedWall,
    radius_min: f64,
    radius_max: f64,
) -> bool {
    let mid1 = wall_midpoint(w1);
    let mid2 = wall_midpoint(w2);

    // Try endpoints of both walls as candidate centers
    let candidates: Vec<Point2D> = w1
        .centerline
        .iter()
        .chain(w2.centerline.iter())
        .copied()
        .collect();

    for center in &candidates {
        let r1 = center.distance_to(&mid1);
        let r2 = center.distance_to(&mid2);

        // Both should be at similar radius from the center
        if r1 >= radius_min
            && r1 <= radius_max
            && r2 >= radius_min
            && r2 <= radius_max
            && (r1 - r2).abs() < 15.0
        {
            return true;
        }
    }

    // Also check: if the midpoints of both walls are equidistant from some
    // point that's near a wall endpoint in the full model
    false
}

/// Estimate a door opening position from an arc group
fn estimate_door_from_arc(
    walls: &[DetectedWall],
    arc_indices: &[usize],
) -> Option<DetectedOpening> {
    if arc_indices.is_empty() {
        return None;
    }

    // Find the centroid of arc segment midpoints
    let mut cx = 0.0;
    let mut cy = 0.0;
    let mut count = 0.0;
    let mut max_radius = 0.0f64;

    for &i in arc_indices {
        let mid = wall_midpoint(&walls[i]);
        cx += mid.x;
        cy += mid.y;
        count += 1.0;

        // Track the extent
        for pt in &walls[i].centerline {
            let r = pt.distance_to(&mid);
            max_radius = max_radius.max(r);
        }
    }

    cx /= count;
    cy /= count;

    // Door width ≈ arc radius (typically 0.8-1.0m)
    let width = max_radius.max(30.0); // At least 30px

    Some(DetectedOpening {
        position: Point2D::new(cx, cy),
        width,
        opening_type: OpeningType::Door,
        host_wall_index: 0, // Will be matched later
    })
}

// ─── Step 3: Length Filter ──────────────────────────────────────────────────

fn filter_by_length(walls: &[DetectedWall], min_length: f64) -> Vec<DetectedWall> {
    walls
        .iter()
        .filter(|w| w.length() >= min_length)
        .cloned()
        .collect()
}

// ─── Step 4: Connectivity Filter ────────────────────────────────────────────

/// Keep only walls that are part of the connected wall network.
///
/// Uses a two-pass approach:
/// 1. First pass: keep walls with >= 2 connections (strong structural walls)
/// 2. Second pass: keep any remaining wall that connects to a pass-1 wall
///
/// This catches periphery walls that only connect at one end (L-shapes, T-junctions).
fn filter_by_connectivity(walls: &[DetectedWall], config: &WallFilterConfig) -> Vec<DetectedWall> {
    if walls.len() <= 2 {
        return walls.to_vec();
    }

    let tol = config.connection_tolerance;

    // Count connections for each wall
    let connection_counts: Vec<usize> = walls
        .iter()
        .enumerate()
        .map(|(i, wall)| count_connections(i, wall, walls, tol))
        .collect();

    // Pass 1: walls with >= 2 connections are definitely structural
    let pass1_indices: Vec<usize> = (0..walls.len())
        .filter(|&i| connection_counts[i] >= 2)
        .collect();

    // Pass 2: walls with >= 1 connection that connect to a pass-1 wall
    let pass1_walls: Vec<&DetectedWall> = pass1_indices.iter().map(|&i| &walls[i]).collect();
    let mut keep = vec![false; walls.len()];

    for &i in &pass1_indices {
        keep[i] = true;
    }

    for (i, wall) in walls.iter().enumerate() {
        if keep[i] {
            continue;
        }
        if connection_counts[i] >= config.min_connections {
            // Check if it connects to any pass-1 wall
            let connects_to_core = pass1_walls.iter().any(|core_wall| {
                walls_connected(wall, core_wall, tol)
            });
            if connects_to_core {
                keep[i] = true;
            }
        }
    }

    walls
        .iter()
        .enumerate()
        .filter(|(i, _)| keep[*i])
        .map(|(_, w)| w.clone())
        .collect()
}

fn count_connections(
    idx: usize,
    wall: &DetectedWall,
    all_walls: &[DetectedWall],
    tolerance: f64,
) -> usize {
    let start = &wall.centerline[0];
    let end = wall.centerline.last().unwrap();

    let mut connections = 0;
    for (j, other) in all_walls.iter().enumerate() {
        if idx == j {
            continue;
        }
        if walls_connected(wall, other, tolerance) {
            connections += 1;
        }
        // Also check T-junctions (endpoint touches wall body)
        else if point_near_wall_body(start, other, tolerance)
            || point_near_wall_body(end, other, tolerance)
        {
            connections += 1;
        }
    }
    connections
}

fn walls_connected(w1: &DetectedWall, w2: &DetectedWall, tolerance: f64) -> bool {
    let s1 = &w1.centerline[0];
    let e1 = w1.centerline.last().unwrap();
    let s2 = &w2.centerline[0];
    let e2 = w2.centerline.last().unwrap();

    s1.distance_to(s2) < tolerance
        || s1.distance_to(e2) < tolerance
        || e1.distance_to(s2) < tolerance
        || e1.distance_to(e2) < tolerance
        || point_near_wall_body(s1, w2, tolerance)
        || point_near_wall_body(e1, w2, tolerance)
        || point_near_wall_body(s2, w1, tolerance)
        || point_near_wall_body(e2, w1, tolerance)
}

/// Check if a point is near the body (not just endpoints) of a wall segment
fn point_near_wall_body(point: &Point2D, wall: &DetectedWall, tolerance: f64) -> bool {
    if wall.centerline.len() < 2 {
        return false;
    }
    let start = &wall.centerline[0];
    let end = wall.centerline.last().unwrap();

    // Project point onto line segment
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let len_sq = dx * dx + dy * dy;

    if len_sq < 1e-10 {
        return point.distance_to(start) < tolerance;
    }

    let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / len_sq;

    // Must be along the segment (with small extension for tolerance)
    if t < -0.05 || t > 1.05 {
        return false;
    }

    let t = t.clamp(0.0, 1.0);
    let proj = Point2D::new(start.x + t * dx, start.y + t * dy);
    point.distance_to(&proj) < tolerance
}

// ─── Step 5: Overlap Removal ────────────────────────────────────────────────

/// Remove duplicate/overlapping wall detections.
///
/// The Hough detector often finds both edges of a thick wall as separate lines.
/// This merges parallel, nearby, overlapping segments into single walls with
/// correct thickness.
fn remove_overlapping_walls(walls: Vec<DetectedWall>, merge_distance: f64) -> Vec<DetectedWall> {
    if walls.len() <= 1 {
        return walls;
    }

    let mut merged = Vec::new();
    let mut used = vec![false; walls.len()];

    for i in 0..walls.len() {
        if used[i] {
            continue;
        }

        let mut group = vec![&walls[i]];
        used[i] = true;

        for j in (i + 1)..walls.len() {
            if used[j] {
                continue;
            }

            if walls_overlap(&walls[i], &walls[j], merge_distance) {
                group.push(&walls[j]);
                used[j] = true;
            }
        }

        // Merge the group into one wall
        merged.push(merge_wall_group(&group));
    }

    merged
}

/// Check if two walls are parallel, nearby, and overlapping in extent
fn walls_overlap(w1: &DetectedWall, w2: &DetectedWall, distance: f64) -> bool {
    if w1.centerline.len() < 2 || w2.centerline.len() < 2 {
        return false;
    }

    let s1 = &w1.centerline[0];
    let e1 = w1.centerline.last().unwrap();
    let s2 = &w2.centerline[0];
    let e2 = w2.centerline.last().unwrap();

    let angle1 = (e1.y - s1.y).atan2(e1.x - s1.x);
    let angle2 = (e2.y - s2.y).atan2(e2.x - s2.x);

    // Must be parallel
    let mut angle_diff = (angle1 - angle2).abs();
    if angle_diff > PI / 2.0 {
        angle_diff = PI - angle_diff;
    }
    if angle_diff > 0.1 {
        return false;
    }

    // Check perpendicular distance between midpoints and lines
    let mid2 = Point2D::new((s2.x + e2.x) / 2.0, (s2.y + e2.y) / 2.0);
    let perp_dist = crate::line_ops::point_to_line_distance(&mid2, s1, e1);

    if perp_dist > distance {
        return false;
    }

    // Check that they overlap in extent (project onto shared direction)
    let cos_a = angle1.cos();
    let sin_a = angle1.sin();

    let proj = |p: &Point2D| p.x * cos_a + p.y * sin_a;

    let (min1, max1) = {
        let a = proj(s1);
        let b = proj(e1);
        (a.min(b), a.max(b))
    };
    let (min2, max2) = {
        let a = proj(s2);
        let b = proj(e2);
        (a.min(b), a.max(b))
    };

    // Must overlap by at least 30% of the shorter wall
    let overlap_start = min1.max(min2);
    let overlap_end = max1.min(max2);
    let overlap = (overlap_end - overlap_start).max(0.0);
    let shorter = (max1 - min1).min(max2 - min2);

    overlap > shorter * 0.3
}

/// Merge a group of overlapping walls into a single wall
fn merge_wall_group(group: &[&DetectedWall]) -> DetectedWall {
    if group.len() == 1 {
        return group[0].clone();
    }

    // Find the longest wall in the group — use its endpoints as base
    let longest = group.iter().max_by(|a, b| {
        a.length().partial_cmp(&b.length()).unwrap()
    }).unwrap();

    // Average thickness of the group (the distance between parallel lines IS the thickness)
    let avg_thickness = if group.len() == 2 {
        // Distance between the two parallel lines
        let s1 = &group[0].centerline[0];
        let e1 = group[0].centerline.last().unwrap();
        let mid2 = wall_midpoint(group[1]);
        let dist = crate::line_ops::point_to_line_distance(&mid2, s1, e1);
        dist.max(group[0].thickness).max(group[1].thickness)
    } else {
        group.iter().map(|w| w.thickness).sum::<f64>() / group.len() as f64
    };

    // Use the most confident wall type
    let wall_type = group
        .iter()
        .find(|w| w.wall_type != WallType::Unknown)
        .map(|w| w.wall_type)
        .unwrap_or(longest.wall_type);

    // Extend to cover the full span of all walls in the group
    let angle = {
        let s = &longest.centerline[0];
        let e = longest.centerline.last().unwrap();
        (e.y - s.y).atan2(e.x - s.x)
    };
    let cos_a = angle.cos();
    let sin_a = angle.sin();

    let proj = |p: &Point2D| p.x * cos_a + p.y * sin_a;

    let mut min_proj = f64::MAX;
    let mut max_proj = f64::MIN;
    let mut min_pt = longest.centerline[0];
    let mut max_pt = *longest.centerline.last().unwrap();

    for wall in group {
        for pt in &wall.centerline {
            let p = proj(pt);
            if p < min_proj {
                min_proj = p;
                min_pt = *pt;
            }
            if p > max_proj {
                max_proj = p;
                max_pt = *pt;
            }
        }
    }

    // Snap to axis if close
    let start;
    let end;

    if (min_pt.y - max_pt.y).abs() < 3.0 {
        // Horizontal wall — average Y across all walls in group
        let all_y: f64 = group.iter().flat_map(|w| w.centerline.iter()).map(|p| p.y).sum();
        let all_count = group.iter().map(|w| w.centerline.len()).sum::<usize>() as f64;
        let avg_y = all_y / all_count;
        start = Point2D::new(min_pt.x, avg_y);
        end = Point2D::new(max_pt.x, avg_y);
    } else if (min_pt.x - max_pt.x).abs() < 3.0 {
        // Vertical wall — average X
        let all_x: f64 = group.iter().flat_map(|w| w.centerline.iter()).map(|p| p.x).sum();
        let all_count = group.iter().map(|w| w.centerline.len()).sum::<usize>() as f64;
        let avg_x = all_x / all_count;
        start = Point2D::new(avg_x, min_pt.y);
        end = Point2D::new(avg_x, max_pt.y);
    } else {
        start = min_pt;
        end = max_pt;
    }

    DetectedWall {
        centerline: vec![start, end],
        thickness: avg_thickness,
        wall_type,
        confidence: longest.confidence,
    }
}

// ─── Step 6/7: Axis Snapping ────────────────────────────────────────────────

/// Re-snap walls to the nearest axis after merge operations
fn snap_walls_to_axes(walls: &[DetectedWall], tolerance: f64) -> Vec<DetectedWall> {
    walls
        .iter()
        .map(|wall| {
            if wall.centerline.len() < 2 {
                return wall.clone();
            }
            let start = &wall.centerline[0];
            let end = wall.centerline.last().unwrap();
            let angle = (end.y - start.y).atan2(end.x - start.x).abs();

            // Near horizontal: average Y
            let near_horizontal = angle < tolerance || angle > (PI - tolerance);
            // Near vertical: average X
            let near_vertical = (angle - PI / 2.0).abs() < tolerance;

            if near_horizontal {
                let avg_y = (start.y + end.y) / 2.0;
                DetectedWall {
                    centerline: vec![
                        Point2D::new(start.x, avg_y),
                        Point2D::new(end.x, avg_y),
                    ],
                    ..wall.clone()
                }
            } else if near_vertical {
                let avg_x = (start.x + end.x) / 2.0;
                DetectedWall {
                    centerline: vec![
                        Point2D::new(avg_x, start.y),
                        Point2D::new(avg_x, end.y),
                    ],
                    ..wall.clone()
                }
            } else {
                wall.clone()
            }
        })
        .collect()
}

fn is_axis_aligned(wall: &DetectedWall, tolerance: f64) -> bool {
    if wall.centerline.len() < 2 {
        return false;
    }
    let start = &wall.centerline[0];
    let end = wall.centerline.last().unwrap();
    let angle = (end.y - start.y).atan2(end.x - start.x).abs();
    let near_horizontal = angle < tolerance || angle > (PI - tolerance);
    let near_vertical = (angle - PI / 2.0).abs() < tolerance;
    near_horizontal || near_vertical
}

// ─── Step 0: Filter Outside Building Region ─────────────────────────────────

/// Remove wall segments that are outside the detected building region.
/// This eliminates dimension lines, title blocks, compass roses, etc.
fn filter_outside_building(walls: &[DetectedWall], region: &BuildingRegion) -> Vec<DetectedWall> {
    let margin = 30.0; // allow walls slightly outside the region (needs to be generous for outer perimeter walls)
    let min_x = region.min_x as f64 - margin;
    let max_x = region.max_x as f64 + margin;
    let min_y = region.min_y as f64 - margin;
    let max_y = region.max_y as f64 + margin;

    walls
        .iter()
        .filter(|wall| {
            if wall.centerline.len() < 2 {
                return false;
            }
            // A wall is "inside" if BOTH endpoints are within the building region
            // (with margin tolerance)
            wall.centerline.iter().all(|pt| {
                pt.x >= min_x && pt.x <= max_x && pt.y >= min_y && pt.y <= max_y
            })
        })
        .cloned()
        .collect()
}

// ─── Step 8: Infer Missing Exterior Walls (image-based) ─────────────────────

/// Image-evidence-based exterior wall inference.
/// Only add walls where the BuildingRegion says there IS a wall.
/// This respects open areas (balconies, loggias, terraces) where
/// the image shows no thick wall band.
fn infer_exterior_walls_from_image(
    mut walls: Vec<DetectedWall>,
    config: &WallFilterConfig,
    region: &BuildingRegion,
) -> Vec<DetectedWall> {
    if walls.is_empty() {
        return walls;
    }

    let tol = 30.0;
    let min_len = 100.0;
    let ext_thick = config.exterior_wall_thickness_m / config.scale;

    let r_min_x = region.min_x as f64;
    let r_max_x = region.max_x as f64;
    let r_min_y = region.min_y as f64;
    let r_max_y = region.max_y as f64;

    // Check which sides already have detected walls
    let has_top = walls.iter().any(|w| {
        wall_orientation_static(w) == "horiz"
            && w.centerline.iter().any(|p| (p.y - r_min_y).abs() < tol)
            && w.length() > min_len
    });
    let has_bottom = walls.iter().any(|w| {
        wall_orientation_static(w) == "horiz"
            && w.centerline.iter().any(|p| (p.y - r_max_y).abs() < tol)
            && w.length() > min_len
    });
    let has_left = walls.iter().any(|w| {
        wall_orientation_static(w) == "vert"
            && w.centerline.iter().any(|p| (p.x - r_min_x).abs() < tol)
            && w.length() > min_len
    });
    let has_right = walls.iter().any(|w| {
        wall_orientation_static(w) == "vert"
            && w.centerline.iter().any(|p| (p.x - r_max_x).abs() < tol)
            && w.length() > min_len
    });

    // Only infer walls where:
    // 1. No wall is detected on that side AND
    // 2. The image shows a wall (thick dark band) on that side
    if !has_top && region.has_wall_top {
        walls.push(DetectedWall {
            centerline: vec![
                Point2D::new(r_min_x, r_min_y),
                Point2D::new(r_max_x, r_min_y),
            ],
            thickness: ext_thick,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }
    if !has_bottom && region.has_wall_bottom {
        walls.push(DetectedWall {
            centerline: vec![
                Point2D::new(r_min_x, r_max_y),
                Point2D::new(r_max_x, r_max_y),
            ],
            thickness: ext_thick,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }
    if !has_left && region.has_wall_left {
        walls.push(DetectedWall {
            centerline: vec![
                Point2D::new(r_min_x, r_min_y),
                Point2D::new(r_min_x, r_max_y),
            ],
            thickness: ext_thick,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }
    if !has_right && region.has_wall_right {
        walls.push(DetectedWall {
            centerline: vec![
                Point2D::new(r_max_x, r_min_y),
                Point2D::new(r_max_x, r_max_y),
            ],
            thickness: ext_thick,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }

    walls
}

// ─── Step 8 (fallback): Infer Missing Exterior Walls (bbox) ─────────────────

/// Infer missing exterior walls from the bounding box of detected walls.
///
/// If we detect walls forming 3 sides of a rectangle, the 4th side is almost
/// certainly a wall too. This catches the common case where the bottom exterior
/// wall is fragmented by doors and lost during filtering.
/// Bounding box from wall endpoints
#[derive(Debug, Clone)]
struct WallBBox {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

/// Compute a "smart" building envelope from the walls.
/// Uses the median extent of long walls to avoid outliers from dimension lines
/// or walls that overshoot the building boundary.
fn compute_smart_envelope(walls: &[DetectedWall]) -> WallBBox {
    if walls.is_empty() {
        return WallBBox {
            min_x: 0.0,
            max_x: 0.0,
            min_y: 0.0,
            max_y: 0.0,
        };
    }

    // Collect extents from long horizontal walls (for Y bounds)
    let mut h_min_ys: Vec<f64> = Vec::new();
    let mut h_max_ys: Vec<f64> = Vec::new();
    let mut h_min_xs: Vec<f64> = Vec::new();
    let mut h_max_xs: Vec<f64> = Vec::new();
    let mut v_min_xs: Vec<f64> = Vec::new();
    let mut v_max_xs: Vec<f64> = Vec::new();
    let mut v_min_ys: Vec<f64> = Vec::new();
    let mut v_max_ys: Vec<f64> = Vec::new();

    for wall in walls {
        let ori = wall_orientation_static(wall);
        match ori {
            "horiz" => {
                let y = wall.centerline.iter().map(|p| p.y).sum::<f64>()
                    / wall.centerline.len() as f64;
                h_min_ys.push(y);
                h_max_ys.push(y);
                for pt in &wall.centerline {
                    h_min_xs.push(pt.x);
                    h_max_xs.push(pt.x);
                }
            }
            "vert" => {
                let x = wall.centerline.iter().map(|p| p.x).sum::<f64>()
                    / wall.centerline.len() as f64;
                v_min_xs.push(x);
                v_max_xs.push(x);
                for pt in &wall.centerline {
                    v_min_ys.push(pt.y);
                    v_max_ys.push(pt.y);
                }
            }
            _ => {}
        }
    }

    // Use vertical wall extents for top/bottom, horizontal for left/right
    let min_y = v_min_ys.iter().cloned().fold(f64::MAX, f64::min);
    let min_x = h_min_xs
        .iter()
        .cloned()
        .fold(f64::MAX, f64::min)
        .min(v_min_xs.iter().cloned().fold(f64::MAX, f64::min));
    let max_x = h_max_xs
        .iter()
        .cloned()
        .fold(f64::MIN, f64::max)
        .max(v_max_xs.iter().cloned().fold(f64::MIN, f64::max));

    // For max_y: use the SECOND-highest vertical wall endpoint to avoid outliers
    v_max_ys.sort_by(|a, b| b.partial_cmp(a).unwrap());
    let max_y = if v_max_ys.len() >= 3 {
        let top = v_max_ys[0];
        let second = v_max_ys[1];
        // If the top value is an outlier (>40px from the second), use second
        let median_top3 = second;
        if top - median_top3 > 40.0 {
            median_top3
        } else {
            top
        }
    } else {
        v_max_ys.first().cloned().unwrap_or(0.0)
    };

    WallBBox {
        min_x,
        max_x,
        min_y,
        max_y,
    }
}

fn compute_bbox(walls: &[DetectedWall]) -> WallBBox {
    let mut bbox = WallBBox {
        min_x: f64::MAX,
        max_x: f64::MIN,
        min_y: f64::MAX,
        max_y: f64::MIN,
    };
    for wall in walls {
        for pt in &wall.centerline {
            bbox.min_x = bbox.min_x.min(pt.x);
            bbox.max_x = bbox.max_x.max(pt.x);
            bbox.min_y = bbox.min_y.min(pt.y);
            bbox.max_y = bbox.max_y.max(pt.y);
        }
    }
    bbox
}

fn infer_exterior_walls(
    mut walls: Vec<DetectedWall>,
    config: &WallFilterConfig,
    raw_bbox: &WallBBox,
) -> Vec<DetectedWall> {
    if walls.is_empty() {
        return walls;
    }

    // Use the RAW (pre-filter) bounding box as the true building extent.
    // The raw walls include the left exterior wall, bottom wall, etc. that
    // may have been removed by connectivity filtering.
    // However, the raw bbox may include dimension lines outside the building.
    // Use the image margins to clamp: building is typically within 5-10% of image edges.
    let margin = config.image_width.min(config.image_height) * 0.08;

    // Building edges from raw detections, clamped to not go too close to image edges
    // (dimension lines are usually at the very edge of the image)
    let min_x = raw_bbox.min_x.max(margin * 0.3);
    let max_x = raw_bbox.max_x.min(config.image_width - margin * 0.3);

    // For Y: use the smart approach — find where most vertical walls end
    let mut vert_max_ys: Vec<f64> = walls
        .iter()
        .filter(|w| wall_orientation_static(w) == "vert")
        .map(|w| {
            w.centerline
                .iter()
                .map(|p| p.y)
                .fold(f64::MIN, f64::max)
        })
        .collect();
    vert_max_ys.sort_by(|a, b| b.partial_cmp(a).unwrap());

    let max_y = if vert_max_ys.len() >= 3 {
        let median_of_top3 = vert_max_ys[1];
        if vert_max_ys[0] - median_of_top3 > 40.0 {
            median_of_top3
        } else {
            vert_max_ys[0]
        }
    } else {
        raw_bbox.max_y.min(config.image_height - margin * 0.3)
    };

    let min_y = raw_bbox.min_y.max(margin * 0.3);

    let tol = 30.0; // tolerance for "near edge" in pixels
    let min_len = 100.0; // minimum wall length to consider as exterior

    // Check each side: do we have a wall near the bounding box edge?
    let has_top = walls.iter().any(|w| {
        is_axis_aligned(w, config.axis_angle_tolerance)
            && wall_orientation_static(w) == "horiz"
            && w.centerline.iter().any(|p| (p.y - min_y).abs() < tol)
            && w.length() > min_len
    });
    let has_bottom = walls.iter().any(|w| {
        is_axis_aligned(w, config.axis_angle_tolerance)
            && wall_orientation_static(w) == "horiz"
            && w.centerline.iter().any(|p| (p.y - max_y).abs() < tol)
            && w.length() > min_len
    });
    let has_left = walls.iter().any(|w| {
        is_axis_aligned(w, config.axis_angle_tolerance)
            && wall_orientation_static(w) == "vert"
            && w.centerline.iter().any(|p| (p.x - min_x).abs() < tol)
            && w.length() > min_len
    });
    let has_right = walls.iter().any(|w| {
        is_axis_aligned(w, config.axis_angle_tolerance)
            && wall_orientation_static(w) == "vert"
            && w.centerline.iter().any(|p| (p.x - max_x).abs() < tol)
            && w.length() > min_len
    });

    // Infer missing sides
    if !has_bottom {
        // Add bottom wall spanning the full width
        walls.push(DetectedWall {
            centerline: vec![Point2D::new(min_x, max_y), Point2D::new(max_x, max_y)],
            thickness: config.exterior_wall_thickness_m / config.scale,
            wall_type: WallType::Exterior,
            confidence: 0.7, // lower confidence since inferred
        });
    }
    if !has_top && (max_y - min_y) > 200.0 {
        walls.push(DetectedWall {
            centerline: vec![Point2D::new(min_x, min_y), Point2D::new(max_x, min_y)],
            thickness: config.exterior_wall_thickness_m / config.scale,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }
    if !has_left && (max_x - min_x) > 200.0 {
        walls.push(DetectedWall {
            centerline: vec![Point2D::new(min_x, min_y), Point2D::new(min_x, max_y)],
            thickness: config.exterior_wall_thickness_m / config.scale,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }
    if !has_right && (max_x - min_x) > 200.0 {
        walls.push(DetectedWall {
            centerline: vec![Point2D::new(max_x, min_y), Point2D::new(max_x, max_y)],
            thickness: config.exterior_wall_thickness_m / config.scale,
            wall_type: WallType::Exterior,
            confidence: 0.7,
        });
    }

    walls
}

fn wall_orientation_static(wall: &DetectedWall) -> &'static str {
    if wall.centerline.len() < 2 {
        return "???";
    }
    let s = &wall.centerline[0];
    let e = wall.centerline.last().unwrap();
    let angle = (e.y - s.y).atan2(e.x - s.x).abs();
    if angle < 0.15 || angle > PI - 0.15 {
        "horiz"
    } else if (angle - PI / 2.0).abs() < 0.15 {
        "vert"
    } else {
        "diag"
    }
}

// ─── Collinear Fragment Merge ───────────────────────────────────────────────

/// Merge collinear wall fragments that are separated by small gaps (door openings).
///
/// The right exterior wall, for example, often gets split into 4 segments by
/// doors/windows. This merges them back into a single wall.
fn merge_collinear_fragments(
    walls: &[DetectedWall],
    angle_tolerance: f64,
    max_gap: f64,
) -> Vec<DetectedWall> {
    if walls.len() <= 1 {
        return walls.to_vec();
    }

    let mut merged = Vec::new();
    let mut used = vec![false; walls.len()];

    for i in 0..walls.len() {
        if used[i] || walls[i].centerline.len() < 2 {
            continue;
        }

        let mut group = vec![i];
        used[i] = true;

        // Repeatedly scan for walls that are collinear with the group's aggregate extent.
        // This handles chains: A—B—C where A is far from C but B bridges the gap.
        let mut changed = true;
        while changed {
            changed = false;
            for j in 0..walls.len() {
                if used[j] || walls[j].centerline.len() < 2 {
                    continue;
                }

                // Check if wall j is collinear with the group's AGGREGATE extent
                if is_collinear_with_group(&walls, &group, j, angle_tolerance, max_gap) {
                    group.push(j);
                    used[j] = true;
                    changed = true;
                }
            }
        }

        if group.len() == 1 {
            merged.push(walls[i].clone());
        } else {
            let group_walls: Vec<&DetectedWall> = group.iter().map(|&idx| &walls[idx]).collect();
            merged.push(merge_collinear_group(&group_walls));
        }
    }

    merged
}

/// Check if wall j is collinear with the aggregate extent of a group.
/// Instead of requiring j to be within gap of EVERY member (clique),
/// we check that j's range has a gap ≤ max_gap to the group's aggregate range,
/// and j has the same Y (horizontal) or X (vertical) as the group average.
fn is_collinear_with_group(
    walls: &[DetectedWall],
    group: &[usize],
    j: usize,
    angle_tol: f64,
    max_gap: f64,
) -> bool {
    let wj = &walls[j];
    let sj = &wj.centerline[0];
    let ej = wj.centerline.last().unwrap();
    let aj = (ej.y - sj.y).atan2(ej.x - sj.x).abs();

    // Check orientation of first group member
    let w0 = &walls[group[0]];
    let s0 = &w0.centerline[0];
    let e0 = w0.centerline.last().unwrap();
    let a0 = (e0.y - s0.y).atan2(e0.x - s0.x).abs();

    let both_h = (a0 < angle_tol || a0 > PI - angle_tol) && (aj < angle_tol || aj > PI - angle_tol);
    let both_v = (a0 - PI / 2.0).abs() < angle_tol && (aj - PI / 2.0).abs() < angle_tol;

    if !both_h && !both_v {
        return false;
    }

    // Compute group aggregate extent and average perpendicular coordinate
    if both_h {
        let mut group_min_x = f64::MAX;
        let mut group_max_x = f64::MIN;
        let mut sum_y = 0.0;
        let mut count_y = 0;

        for &idx in group {
            let w = &walls[idx];
            for pt in &w.centerline {
                group_min_x = group_min_x.min(pt.x);
                group_max_x = group_max_x.max(pt.x);
                sum_y += pt.y;
                count_y += 1;
            }
        }
        let group_avg_y = sum_y / count_y as f64;
        let wj_avg_y = (sj.y + ej.y) / 2.0;

        // Same Y (within tolerance)?
        if (group_avg_y - wj_avg_y).abs() > 15.0 {
            return false;
        }

        // Gap between j's X range and group's aggregate X range
        let j_min_x = sj.x.min(ej.x);
        let j_max_x = sj.x.max(ej.x);
        let gap = if j_max_x < group_min_x {
            group_min_x - j_max_x
        } else if j_min_x > group_max_x {
            j_min_x - group_max_x
        } else {
            0.0 // overlapping
        };
        gap <= max_gap
    } else {
        let mut group_min_y = f64::MAX;
        let mut group_max_y = f64::MIN;
        let mut sum_x = 0.0;
        let mut count_x = 0;

        for &idx in group {
            let w = &walls[idx];
            for pt in &w.centerline {
                group_min_y = group_min_y.min(pt.y);
                group_max_y = group_max_y.max(pt.y);
                sum_x += pt.x;
                count_x += 1;
            }
        }
        let group_avg_x = sum_x / count_x as f64;
        let wj_avg_x = (sj.x + ej.x) / 2.0;

        if (group_avg_x - wj_avg_x).abs() > 15.0 {
            return false;
        }

        let j_min_y = sj.y.min(ej.y);
        let j_max_y = sj.y.max(ej.y);
        let gap = if j_max_y < group_min_y {
            group_min_y - j_max_y
        } else if j_min_y > group_max_y {
            j_min_y - group_max_y
        } else {
            0.0
        };
        gap <= max_gap
    }
}

/// Merge collinear walls into one spanning their full extent
fn merge_collinear_group(group: &[&DetectedWall]) -> DetectedWall {
    let first = group[0];
    let s0 = &first.centerline[0];
    let e0 = first.centerline.last().unwrap();
    let a = (e0.y - s0.y).atan2(e0.x - s0.x).abs();
    let is_h = a < 0.15 || a > PI - 0.15;

    if is_h {
        // Average Y across all segments
        let all_y: f64 = group.iter()
            .flat_map(|w| w.centerline.iter().map(|p| p.y))
            .sum();
        let count = group.iter().map(|w| w.centerline.len()).sum::<usize>() as f64;
        let avg_y = all_y / count;

        // Find full X extent
        let min_x = group.iter()
            .flat_map(|w| w.centerline.iter().map(|p| p.x))
            .fold(f64::MAX, f64::min);
        let max_x = group.iter()
            .flat_map(|w| w.centerline.iter().map(|p| p.x))
            .fold(f64::MIN, f64::max);

        let avg_thick = group.iter().map(|w| w.thickness).sum::<f64>() / group.len() as f64;

        DetectedWall {
            centerline: vec![Point2D::new(min_x, avg_y), Point2D::new(max_x, avg_y)],
            thickness: avg_thick,
            wall_type: group.iter().find(|w| w.wall_type != WallType::Unknown)
                .map(|w| w.wall_type).unwrap_or(WallType::Exterior),
            confidence: group.iter().map(|w| w.confidence).sum::<f32>() / group.len() as f32,
        }
    } else {
        // Vertical: average X, find full Y extent
        let all_x: f64 = group.iter()
            .flat_map(|w| w.centerline.iter().map(|p| p.x))
            .sum();
        let count = group.iter().map(|w| w.centerline.len()).sum::<usize>() as f64;
        let avg_x = all_x / count;

        let min_y = group.iter()
            .flat_map(|w| w.centerline.iter().map(|p| p.y))
            .fold(f64::MAX, f64::min);
        let max_y = group.iter()
            .flat_map(|w| w.centerline.iter().map(|p| p.y))
            .fold(f64::MIN, f64::max);

        let avg_thick = group.iter().map(|w| w.thickness).sum::<f64>() / group.len() as f64;

        DetectedWall {
            centerline: vec![Point2D::new(avg_x, min_y), Point2D::new(avg_x, max_y)],
            thickness: avg_thick,
            wall_type: group.iter().find(|w| w.wall_type != WallType::Unknown)
                .map(|w| w.wall_type).unwrap_or(WallType::Exterior),
            confidence: group.iter().map(|w| w.confidence).sum::<f32>() / group.len() as f32,
        }
    }
}

// ─── Step 10: Clip Walls to Building Envelope ───────────────────────────────

/// Clip walls that extend past the building boundary.
/// This prevents walls from extending into dimension-line areas.
fn clip_walls_to_envelope(walls: &[DetectedWall], envelope: &WallBBox) -> Vec<DetectedWall> {
    walls
        .iter()
        .map(|wall| {
            if wall.centerline.len() < 2 {
                return wall.clone();
            }
            let s = &wall.centerline[0];
            let e = wall.centerline.last().unwrap();

            let clamp = |p: &Point2D| -> Point2D {
                Point2D::new(
                    p.x.max(envelope.min_x).min(envelope.max_x),
                    p.y.max(envelope.min_y).min(envelope.max_y),
                )
            };

            let new_s = clamp(s);
            let new_e = clamp(e);

            // Only clip if it actually changed something
            if (new_s.x - s.x).abs() < 0.1
                && (new_s.y - s.y).abs() < 0.1
                && (new_e.x - e.x).abs() < 0.1
                && (new_e.y - e.y).abs() < 0.1
            {
                return wall.clone();
            }

            DetectedWall {
                centerline: vec![new_s, new_e],
                thickness: wall.thickness,
                wall_type: wall.wall_type,
                confidence: wall.confidence,
            }
        })
        .filter(|w| w.length() > 10.0) // Remove walls that became degenerate
        .collect()
}

// ─── Step 11: Extend Exterior Walls to Building Envelope ────────────────────

/// If an exterior wall's endpoint is "near" the building edge (within proximity),
/// extend it to touch the edge. This ensures the building outline is closed.
fn extend_exterior_to_envelope(
    walls: &[DetectedWall],
    envelope: &WallBBox,
    config: &WallFilterConfig,
) -> Vec<DetectedWall> {
    let proximity = config.connection_tolerance * 1.5; // ~75px

    walls
        .iter()
        .map(|wall| {
            // Only extend walls that are reasonably long (>20% of building dimension)
            // to avoid extending random short interior walls
            if wall.centerline.len() < 2 {
                return wall.clone();
            }

            let s = &wall.centerline[0];
            let e = wall.centerline.last().unwrap();
            let ori = wall_orientation_static(wall);
            let len = wall.length();

            let mut new_s = s.clone();
            let mut new_e = e.clone();

            if ori == "vert" {
                let building_height = envelope.max_y - envelope.min_y;
                // Only extend walls that span a significant portion of the building
                if len < building_height * 0.15 {
                    return wall.clone();
                }

                // Near left or right edge? (This is an exterior-like wall)
                let near_left = (s.x - envelope.min_x).abs() < proximity;
                let near_right = (s.x - envelope.max_x).abs() < proximity;

                if near_left || near_right {
                    // Extend top endpoint to building top
                    let top = s.y.min(e.y);
                    let bot = s.y.max(e.y);
                    if (top - envelope.min_y).abs() < proximity {
                        if s.y < e.y {
                            new_s.y = envelope.min_y;
                        } else {
                            new_e.y = envelope.min_y;
                        }
                    }
                    // Extend bottom endpoint to building bottom
                    if (bot - envelope.max_y).abs() < proximity {
                        if s.y > e.y {
                            new_s.y = envelope.max_y;
                        } else {
                            new_e.y = envelope.max_y;
                        }
                    }
                }
            } else if ori == "horiz" {
                let building_width = envelope.max_x - envelope.min_x;
                if len < building_width * 0.15 {
                    return wall.clone();
                }

                let near_top = (s.y - envelope.min_y).abs() < proximity;
                let near_bot = (s.y - envelope.max_y).abs() < proximity;

                if near_top || near_bot {
                    let left = s.x.min(e.x);
                    let right = s.x.max(e.x);
                    if (left - envelope.min_x).abs() < proximity {
                        if s.x < e.x {
                            new_s.x = envelope.min_x;
                        } else {
                            new_e.x = envelope.min_x;
                        }
                    }
                    if (right - envelope.max_x).abs() < proximity {
                        if s.x > e.x {
                            new_s.x = envelope.max_x;
                        } else {
                            new_e.x = envelope.max_x;
                        }
                    }
                }
            }

            DetectedWall {
                centerline: vec![new_s, new_e],
                thickness: wall.thickness,
                wall_type: wall.wall_type,
                confidence: wall.confidence,
            }
        })
        .collect()
}

// ─── Step 12: Extend Walls to Form T-Junctions ─────────────────────────────

/// For each wall endpoint, if there's a nearby perpendicular wall whose body
/// it could reach, extend the wall to form a proper T-junction.
///
/// This handles cases like:
/// - A vertical wall at x=148 ending at y=378 when a horizontal wall at y=429
///   runs nearby — extend the vertical to meet it.
/// - A horizontal wall ending at x=459 when a vertical wall at x=498 runs
///   through that Y range — extend to meet.
fn extend_to_t_junctions(walls: &[DetectedWall], tolerance: f64) -> Vec<DetectedWall> {
    let mut result = walls.to_vec();

    // For each wall, check both endpoints
    for i in 0..result.len() {
        if result[i].centerline.len() < 2 {
            continue;
        }

        let ori_i = wall_orientation_static(&result[i]);
        if ori_i == "diag" {
            continue;
        }

        // Check each endpoint for possible T-junction extension
        for endpoint_idx in [0usize, 1] {
            let endpoint = if endpoint_idx == 0 {
                result[i].centerline[0].clone()
            } else {
                result[i].centerline.last().unwrap().clone()
            };

            // Look for perpendicular walls whose body is nearby
            let mut best_extension: Option<(f64, f64)> = None; // (perpendicular coord, distance)

            for j in 0..result.len() {
                if i == j || result[j].centerline.len() < 2 {
                    continue;
                }

                let ori_j = wall_orientation_static(&result[j]);

                // Must be perpendicular
                if ori_i == ori_j {
                    continue;
                }

                let sj = &result[j].centerline[0];
                let ej = result[j].centerline.last().unwrap();

                if ori_i == "vert" && ori_j == "horiz" {
                    // Vertical wall endpoint near a horizontal wall's body
                    // The horizontal wall is at y=sj.y, spanning x=sj.x..ej.x
                    let h_y = (sj.y + ej.y) / 2.0;
                    let h_min_x = sj.x.min(ej.x);
                    let h_max_x = sj.x.max(ej.x);

                    // Is our endpoint's X within the horizontal wall's X range?
                    if endpoint.x >= h_min_x - tolerance && endpoint.x <= h_max_x + tolerance {
                        // How far is our Y from the horizontal wall's Y?
                        let y_dist = (endpoint.y - h_y).abs();
                        if y_dist < tolerance && y_dist > 2.0 {
                            // Extension candidate
                            match &best_extension {
                                None => best_extension = Some((h_y, y_dist)),
                                Some((_, best_dist)) => {
                                    if y_dist < *best_dist {
                                        best_extension = Some((h_y, y_dist));
                                    }
                                }
                            }
                        }
                    }
                } else if ori_i == "horiz" && ori_j == "vert" {
                    // Horizontal wall endpoint near a vertical wall's body
                    let v_x = (sj.x + ej.x) / 2.0;
                    let v_min_y = sj.y.min(ej.y);
                    let v_max_y = sj.y.max(ej.y);

                    if endpoint.y >= v_min_y - tolerance && endpoint.y <= v_max_y + tolerance {
                        let x_dist = (endpoint.x - v_x).abs();
                        if x_dist < tolerance && x_dist > 2.0 {
                            match &best_extension {
                                None => best_extension = Some((v_x, x_dist)),
                                Some((_, best_dist)) => {
                                    if x_dist < *best_dist {
                                        best_extension = Some((v_x, x_dist));
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Apply the extension
            if let Some((target_coord, _)) = best_extension {
                if ori_i == "vert" {
                    // Extend Y coordinate of this endpoint
                    if endpoint_idx == 0 {
                        result[i].centerline[0].y = target_coord;
                    } else {
                        let last = result[i].centerline.len() - 1;
                        result[i].centerline[last].y = target_coord;
                    }
                } else {
                    // Extend X coordinate of this endpoint
                    if endpoint_idx == 0 {
                        result[i].centerline[0].x = target_coord;
                    } else {
                        let last = result[i].centerline.len() - 1;
                        result[i].centerline[last].x = target_coord;
                    }
                }
            }
        }
    }

    result
}

// ─── Step 14: Classify Envelope Walls as Exterior ───────────────────────────

/// Walls that run along the building envelope should be classified as Exterior,
/// even if the raw detection thought they were Interior (inner edge of thick wall).
fn classify_envelope_walls(mut walls: Vec<DetectedWall>, envelope: &WallBBox) -> Vec<DetectedWall> {
    let edge_tol = 20.0; // within 20px of edge

    for wall in &mut walls {
        if wall.centerline.len() < 2 {
            continue;
        }

        let ori = wall_orientation_static(wall);
        let s = &wall.centerline[0];
        let e = wall.centerline.last().unwrap();

        let is_near_edge = match ori {
            "horiz" => {
                let y = (s.y + e.y) / 2.0;
                (y - envelope.min_y).abs() < edge_tol || (y - envelope.max_y).abs() < edge_tol
            }
            "vert" => {
                let x = (s.x + e.x) / 2.0;
                (x - envelope.min_x).abs() < edge_tol || (x - envelope.max_x).abs() < edge_tol
            }
            _ => false,
        };

        // Only upgrade Unknown or Interior walls that span a significant length
        if is_near_edge && wall.length() > 100.0 {
            wall.wall_type = WallType::Exterior;
        }
    }

    walls
}

// ─── Step 15: Thickness Normalization ───────────────────────────────────────

/// Normalize wall thickness to realistic values.
///
/// The Hough detector measures "thickness" as distance between parallel edge
/// detections, which is wildly inaccurate (60-70px → 1.3m). Real walls are:
///   - Exterior: 0.20-0.30m
///   - Interior: 0.10-0.15m
///
/// This function clamps thickness to sensible values based on wall type and
/// the detected thickness relative to other walls.
fn normalize_wall_thickness(walls: &[DetectedWall], config: &WallFilterConfig) -> Vec<DetectedWall> {
    if walls.is_empty() {
        return Vec::new();
    }

    // Only use Unknown walls for the median calculation (pre-typed walls skew it)
    let unknown_thicknesses: Vec<f64> = walls
        .iter()
        .filter(|w| w.wall_type == WallType::Unknown)
        .map(|w| w.thickness)
        .collect();

    let median_thickness = if !unknown_thicknesses.is_empty() {
        let mut sorted = unknown_thicknesses.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        sorted[sorted.len() / 2]
    } else {
        // If no Unknown walls, use all walls
        let mut sorted: Vec<f64> = walls.iter().map(|w| w.thickness).collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        sorted[sorted.len() / 2]
    };

    let exterior_px = config.exterior_wall_thickness_m / config.scale;
    let interior_px = config.interior_wall_thickness_m / config.scale;
    let max_thickness_px = config.max_wall_thickness_m / config.scale;

    walls
        .iter()
        .map(|wall| {
            // If wall type is already set (by inference, detection, or prior classification),
            // respect it — don't override Exterior with Interior just because it's "thin"
            let (wall_type, new_thickness) = match wall.wall_type {
                WallType::Exterior => (WallType::Exterior, exterior_px),
                WallType::Interior => (WallType::Interior, interior_px),
                WallType::Unknown => {
                    let is_thick = wall.thickness > median_thickness * 1.5;
                    if is_thick {
                        (WallType::Exterior, exterior_px)
                    } else {
                        (WallType::Interior, interior_px)
                    }
                }
            };

            DetectedWall {
                centerline: wall.centerline.clone(),
                thickness: new_thickness.min(max_thickness_px),
                wall_type,
                confidence: wall.confidence,
            }
        })
        .collect()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn wall_midpoint(wall: &DetectedWall) -> Point2D {
    if wall.centerline.len() < 2 {
        return wall.centerline.first().copied().unwrap_or(Point2D::new(0.0, 0.0));
    }
    let start = &wall.centerline[0];
    let end = wall.centerline.last().unwrap();
    Point2D::new((start.x + end.x) / 2.0, (start.y + end.y) / 2.0)
}

fn endpoints_close(point: &Point2D, wall: &DetectedWall, tolerance: f64) -> bool {
    wall.centerline
        .iter()
        .any(|p| point.distance_to(p) < tolerance)
}

// ─── Door Opening Application ───────────────────────────────────────────────

/// Apply detected door openings by splitting walls at door positions.
///
/// When a door is detected near a wall, that wall is split into two segments
/// with a gap (the door opening width).
pub fn apply_door_openings(
    walls: Vec<DetectedWall>,
    openings: &[DetectedOpening],
    tolerance: f64,
) -> Vec<DetectedWall> {
    if openings.is_empty() {
        return walls;
    }

    let mut result = Vec::new();

    for wall in &walls {
        // Find openings that apply to this wall
        let applicable: Vec<&DetectedOpening> = openings
            .iter()
            .filter(|o| point_near_wall_body(&o.position, wall, tolerance))
            .collect();

        if applicable.is_empty() {
            result.push(wall.clone());
            continue;
        }

        // Split wall at each opening
        let mut segments = split_wall_at_openings(wall, &applicable);
        result.append(&mut segments);
    }

    result
}

/// Split a wall into segments by removing door opening gaps
fn split_wall_at_openings(
    wall: &DetectedWall,
    openings: &[&DetectedOpening],
) -> Vec<DetectedWall> {
    if wall.centerline.len() < 2 {
        return vec![wall.clone()];
    }

    let start = &wall.centerline[0];
    let end = wall.centerline.last().unwrap();
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let wall_len = (dx * dx + dy * dy).sqrt();

    if wall_len < 1e-6 {
        return vec![wall.clone()];
    }

    // Project openings onto wall axis to get their positions
    let mut cuts: Vec<(f64, f64)> = Vec::new(); // (start_t, end_t) in [0, 1]

    for opening in openings {
        let t = ((opening.position.x - start.x) * dx + (opening.position.y - start.y) * dy)
            / (wall_len * wall_len);
        let half_width = (opening.width / 2.0) / wall_len;

        let cut_start = (t - half_width).max(0.0);
        let cut_end = (t + half_width).min(1.0);

        if cut_end > cut_start {
            cuts.push((cut_start, cut_end));
        }
    }

    // Sort cuts by position
    cuts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    // Merge overlapping cuts
    let merged_cuts = merge_intervals(&cuts);

    // Generate wall segments between cuts
    let mut segments = Vec::new();
    let mut current_t = 0.0;

    for (cut_start, cut_end) in &merged_cuts {
        if *cut_start > current_t + 0.01 {
            // Segment before this cut
            let seg_start = Point2D::new(
                start.x + current_t * dx,
                start.y + current_t * dy,
            );
            let seg_end = Point2D::new(
                start.x + cut_start * dx,
                start.y + cut_start * dy,
            );
            segments.push(DetectedWall {
                centerline: vec![seg_start, seg_end],
                thickness: wall.thickness,
                wall_type: wall.wall_type,
                confidence: wall.confidence,
            });
        }
        current_t = *cut_end;
    }

    // Final segment after last cut
    if current_t < 0.99 {
        let seg_start = Point2D::new(
            start.x + current_t * dx,
            start.y + current_t * dy,
        );
        segments.push(DetectedWall {
            centerline: vec![seg_start, *end],
            thickness: wall.thickness,
            wall_type: wall.wall_type,
            confidence: wall.confidence,
        });
    }

    if segments.is_empty() {
        // Opening spans entire wall — wall is removed
        Vec::new()
    } else {
        segments
    }
}

fn merge_intervals(intervals: &[(f64, f64)]) -> Vec<(f64, f64)> {
    if intervals.is_empty() {
        return Vec::new();
    }

    let mut result = vec![intervals[0]];

    for &(start, end) in &intervals[1..] {
        let last = result.last_mut().unwrap();
        if start <= last.1 {
            last.1 = last.1.max(end);
        } else {
            result.push((start, end));
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_wall(x1: f64, y1: f64, x2: f64, y2: f64) -> DetectedWall {
        DetectedWall {
            centerline: vec![Point2D::new(x1, y1), Point2D::new(x2, y2)],
            thickness: 10.0,
            wall_type: WallType::Unknown,
            confidence: 1.0,
        }
    }

    #[test]
    fn test_axis_alignment_filter() {
        let walls = vec![
            make_wall(0.0, 0.0, 100.0, 0.0),      // Horizontal ✓
            make_wall(50.0, 0.0, 50.0, 100.0),     // Vertical ✓
            make_wall(0.0, 0.0, 100.0, 100.0),     // 45° diagonal ✗
            make_wall(0.0, 0.0, 100.0, 5.0),       // Nearly horizontal ✓
            make_wall(0.0, 0.0, 50.0, 80.0),       // Steep diagonal ✗
        ];

        let filtered = filter_axis_aligned(&walls, 0.14);
        assert_eq!(filtered.len(), 3); // H, V, and nearly-H
    }

    #[test]
    fn test_connectivity_filter() {
        let config = WallFilterConfig::default();

        let walls = vec![
            // Connected rectangle (each wall connects to 2+ others)
            make_wall(0.0, 0.0, 100.0, 0.0),
            make_wall(100.0, 0.0, 100.0, 80.0),
            make_wall(100.0, 80.0, 0.0, 80.0),
            make_wall(0.0, 80.0, 0.0, 0.0),
            // Interior wall (T-junction, connects to top and bottom)
            make_wall(50.0, 0.0, 50.0, 80.0),
            // Isolated furniture line (far away)
            make_wall(300.0, 300.0, 350.0, 300.0),
        ];

        let filtered = filter_by_connectivity(&walls, &config);
        assert_eq!(filtered.len(), 5); // Rectangle + interior, not furniture
    }

    #[test]
    fn test_overlap_detection() {
        let w1 = make_wall(0.0, 0.0, 100.0, 0.0);
        let w2 = make_wall(0.0, 5.0, 100.0, 5.0); // Parallel, 5px away

        assert!(walls_overlap(&w1, &w2, 15.0));
        assert!(!walls_overlap(&w1, &w2, 3.0));
    }

    #[test]
    fn test_overlap_removal() {
        let walls = vec![
            make_wall(0.0, 0.0, 100.0, 0.0),
            make_wall(0.0, 8.0, 100.0, 8.0),  // Parallel duplicate
            make_wall(50.0, 0.0, 50.0, 80.0),  // Perpendicular (keep)
        ];

        let merged = remove_overlapping_walls(walls, 15.0);
        assert_eq!(merged.len(), 2); // Merged H walls + V wall
    }

    #[test]
    fn test_point_near_wall_body() {
        let wall = make_wall(0.0, 0.0, 100.0, 0.0);

        // Point on the wall body
        assert!(point_near_wall_body(&Point2D::new(50.0, 3.0), &wall, 5.0));

        // Point off the wall
        assert!(!point_near_wall_body(&Point2D::new(50.0, 20.0), &wall, 5.0));

        // Point beyond wall end
        assert!(!point_near_wall_body(&Point2D::new(150.0, 0.0), &wall, 5.0));
    }

    #[test]
    fn test_full_filter_pipeline() {
        let config = WallFilterConfig {
            min_filtered_length: 30.0,
            ..Default::default()
        };

        let walls = vec![
            // Structural walls (connected rectangle)
            make_wall(0.0, 0.0, 200.0, 0.0),
            make_wall(200.0, 0.0, 200.0, 150.0),
            make_wall(200.0, 150.0, 0.0, 150.0),
            make_wall(0.0, 150.0, 0.0, 0.0),
            // Interior wall
            make_wall(100.0, 0.0, 100.0, 150.0),
            // Diagonal furniture (should be filtered)
            make_wall(50.0, 50.0, 90.0, 90.0),
            // Short isolated segment (furniture)
            make_wall(60.0, 70.0, 80.0, 70.0),
        ];

        let result = filter_walls(walls, &config);
        assert_eq!(result.stats.input_count, 7);
        assert!(result.walls.len() <= 5, "Expected ≤5 walls, got {}", result.walls.len());
        assert!(result.stats.removed_diagonal >= 1);
    }

    #[test]
    fn test_door_opening_split() {
        let wall = make_wall(0.0, 0.0, 200.0, 0.0);
        let opening = DetectedOpening {
            position: Point2D::new(100.0, 0.0),
            width: 40.0,
            opening_type: OpeningType::Door,
            host_wall_index: 0,
        };

        let segments = split_wall_at_openings(&wall, &[&opening]);
        assert_eq!(segments.len(), 2);
        // Left segment: 0→80, Right segment: 120→200
    }
}
