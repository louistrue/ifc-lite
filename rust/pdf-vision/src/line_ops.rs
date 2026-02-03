// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Line detection and processing operations

use crate::types::{DetectedLine, Point2D};
use image::GrayImage;
use std::f64::consts::PI;

/// Detect lines using probabilistic Hough transform
///
/// This is a simplified implementation that works well for floor plans.
/// It detects line segments from edge images.
pub fn detect_lines(
    edges: &GrayImage,
    threshold: u32,
    min_line_length: f64,
    max_line_gap: f64,
) -> Vec<DetectedLine> {
    let width = edges.width() as i32;
    let height = edges.height() as i32;

    // Parameters for Hough space
    let rho_resolution = 1.0; // 1 pixel
    let theta_resolution = PI / 180.0; // 1 degree
    let num_thetas = (PI / theta_resolution) as usize;

    // Precompute sin/cos tables
    let mut cos_table = Vec::with_capacity(num_thetas);
    let mut sin_table = Vec::with_capacity(num_thetas);
    for i in 0..num_thetas {
        let theta = i as f64 * theta_resolution;
        cos_table.push(theta.cos());
        sin_table.push(theta.sin());
    }

    // Maximum rho value
    let max_rho = ((width * width + height * height) as f64).sqrt();
    let num_rhos = (2.0 * max_rho / rho_resolution) as usize + 1;
    let rho_offset = max_rho;

    // Accumulator array
    let mut accumulator = vec![0u32; num_thetas * num_rhos];

    // Collect edge points
    let mut edge_points: Vec<(i32, i32)> = Vec::new();
    for y in 0..height {
        for x in 0..width {
            if edges.get_pixel(x as u32, y as u32).0[0] > 128 {
                edge_points.push((x, y));
            }
        }
    }

    // Vote in Hough space
    for &(x, y) in &edge_points {
        for theta_idx in 0..num_thetas {
            let rho = x as f64 * cos_table[theta_idx] + y as f64 * sin_table[theta_idx];
            let rho_idx = ((rho + rho_offset) / rho_resolution) as usize;
            if rho_idx < num_rhos {
                accumulator[theta_idx * num_rhos + rho_idx] += 1;
            }
        }
    }

    // Find peaks and extract lines
    let mut lines = Vec::new();
    let mut used_points = vec![false; edge_points.len()];

    // Find local maxima in accumulator
    let mut peaks: Vec<(usize, usize, u32)> = Vec::new();
    for theta_idx in 0..num_thetas {
        for rho_idx in 0..num_rhos {
            let votes = accumulator[theta_idx * num_rhos + rho_idx];
            if votes >= threshold {
                peaks.push((theta_idx, rho_idx, votes));
            }
        }
    }

    // Sort by votes (descending)
    peaks.sort_by(|a, b| b.2.cmp(&a.2));

    // Extract line segments from each peak
    for (theta_idx, rho_idx, _votes) in peaks.iter().take(500) {
        let _theta = *theta_idx as f64 * theta_resolution;
        let rho = *rho_idx as f64 * rho_resolution - rho_offset;

        // Find edge points that belong to this line
        let mut line_points: Vec<(i32, i32, usize)> = Vec::new();

        for (i, &(x, y)) in edge_points.iter().enumerate() {
            if used_points[i] {
                continue;
            }

            let point_rho = x as f64 * cos_table[*theta_idx] + y as f64 * sin_table[*theta_idx];
            if (point_rho - rho).abs() < 2.0 {
                line_points.push((x, y, i));
            }
        }

        if line_points.is_empty() {
            continue;
        }

        // Sort points along the line direction
        let cos_t = cos_table[*theta_idx];
        let sin_t = sin_table[*theta_idx];

        line_points.sort_by(|a, b| {
            let proj_a = a.0 as f64 * (-sin_t) + a.1 as f64 * cos_t;
            let proj_b = b.0 as f64 * (-sin_t) + b.1 as f64 * cos_t;
            proj_a.partial_cmp(&proj_b).unwrap()
        });

        // Extract line segments with gap handling
        let mut segment_start = 0;
        for i in 1..line_points.len() {
            let dx = (line_points[i].0 - line_points[i - 1].0) as f64;
            let dy = (line_points[i].1 - line_points[i - 1].1) as f64;
            let gap = (dx * dx + dy * dy).sqrt();

            if gap > max_line_gap {
                // End current segment
                if i - segment_start >= 2 {
                    let start_pt = &line_points[segment_start];
                    let end_pt = &line_points[i - 1];
                    let length = {
                        let dx = (end_pt.0 - start_pt.0) as f64;
                        let dy = (end_pt.1 - start_pt.1) as f64;
                        (dx * dx + dy * dy).sqrt()
                    };

                    if length >= min_line_length {
                        lines.push(DetectedLine::new(
                            Point2D::new(start_pt.0 as f64, start_pt.1 as f64),
                            Point2D::new(end_pt.0 as f64, end_pt.1 as f64),
                        ));

                        // Mark points as used
                        for j in segment_start..i {
                            used_points[line_points[j].2] = true;
                        }
                    }
                }
                segment_start = i;
            }
        }

        // Handle last segment
        if line_points.len() - segment_start >= 2 {
            let start_pt = &line_points[segment_start];
            let end_pt = &line_points[line_points.len() - 1];
            let length = {
                let dx = (end_pt.0 - start_pt.0) as f64;
                let dy = (end_pt.1 - start_pt.1) as f64;
                (dx * dx + dy * dy).sqrt()
            };

            if length >= min_line_length {
                lines.push(DetectedLine::new(
                    Point2D::new(start_pt.0 as f64, start_pt.1 as f64),
                    Point2D::new(end_pt.0 as f64, end_pt.1 as f64),
                ));

                for j in segment_start..line_points.len() {
                    used_points[line_points[j].2] = true;
                }
            }
        }
    }

    lines
}

/// Merge collinear line segments
pub fn merge_collinear_lines(
    lines: &[DetectedLine],
    angle_tolerance: f64,
    distance_tolerance: f64,
) -> Vec<DetectedLine> {
    if lines.is_empty() {
        return Vec::new();
    }

    let mut merged: Vec<DetectedLine> = Vec::new();
    let mut used = vec![false; lines.len()];

    for (i, line) in lines.iter().enumerate() {
        if used[i] {
            continue;
        }

        let mut group = vec![line.clone()];
        used[i] = true;

        // Find all collinear lines
        for (j, other) in lines.iter().enumerate() {
            if used[j] {
                continue;
            }

            if are_collinear(line, other, angle_tolerance, distance_tolerance) {
                group.push(other.clone());
                used[j] = true;
            }
        }

        // Merge the group into a single line
        merged.push(merge_line_group(&group));
    }

    merged
}

/// Check if two lines are collinear (same direction and close together)
fn are_collinear(
    l1: &DetectedLine,
    l2: &DetectedLine,
    angle_tolerance: f64,
    distance_tolerance: f64,
) -> bool {
    // Check angle similarity
    let angle1 = l1.angle();
    let angle2 = l2.angle();

    let mut angle_diff = (angle1 - angle2).abs();
    // Normalize to [0, PI/2] since lines can point in opposite directions
    if angle_diff > PI / 2.0 {
        angle_diff = PI - angle_diff;
    }

    if angle_diff > angle_tolerance {
        return false;
    }

    // Check perpendicular distance from l2's midpoint to l1
    let l2_mid = l2.midpoint();
    let distance = point_to_line_distance(&l2_mid, &l1.start, &l1.end);

    distance <= distance_tolerance
}

/// Calculate perpendicular distance from a point to a line segment
pub fn point_to_line_distance(point: &Point2D, line_start: &Point2D, line_end: &Point2D) -> f64 {
    let dx = line_end.x - line_start.x;
    let dy = line_end.y - line_start.y;
    let length_sq = dx * dx + dy * dy;

    if length_sq < 1e-10 {
        return point.distance_to(line_start);
    }

    // Project point onto line and calculate perpendicular distance
    let t = ((point.x - line_start.x) * dx + (point.y - line_start.y) * dy) / length_sq;
    let t = t.clamp(0.0, 1.0);

    let proj_x = line_start.x + t * dx;
    let proj_y = line_start.y + t * dy;

    let px = point.x - proj_x;
    let py = point.y - proj_y;
    (px * px + py * py).sqrt()
}

/// Merge a group of collinear lines into one
fn merge_line_group(group: &[DetectedLine]) -> DetectedLine {
    if group.len() == 1 {
        return group[0].clone();
    }

    // Collect all endpoints
    let mut all_points: Vec<Point2D> = Vec::new();
    for line in group {
        all_points.push(line.start);
        all_points.push(line.end);
    }

    // Find the average direction
    let avg_angle: f64 = group.iter().map(|l| l.angle()).sum::<f64>() / group.len() as f64;
    let cos_a = avg_angle.cos();
    let sin_a = avg_angle.sin();

    // Project all points onto the average direction and find extremes
    let mut min_proj = f64::MAX;
    let mut max_proj = f64::MIN;
    let mut min_point = all_points[0];
    let mut max_point = all_points[0];

    for point in &all_points {
        let proj = point.x * cos_a + point.y * sin_a;
        if proj < min_proj {
            min_proj = proj;
            min_point = *point;
        }
        if proj > max_proj {
            max_proj = proj;
            max_point = *point;
        }
    }

    // Average thickness and confidence
    let avg_thickness = group.iter().map(|l| l.thickness).sum::<f64>() / group.len() as f64;
    let avg_confidence = group.iter().map(|l| l.confidence).sum::<f32>() / group.len() as f32;

    DetectedLine {
        start: min_point,
        end: max_point,
        thickness: avg_thickness,
        confidence: avg_confidence,
    }
}

/// Filter lines by minimum length
pub fn filter_short_lines(lines: &[DetectedLine], min_length: f64) -> Vec<DetectedLine> {
    lines
        .iter()
        .filter(|l| l.length() >= min_length)
        .cloned()
        .collect()
}

/// Snap lines to horizontal/vertical if close to axis-aligned
pub fn snap_to_axes(lines: &[DetectedLine], angle_threshold: f64) -> Vec<DetectedLine> {
    lines
        .iter()
        .map(|line| {
            let angle = line.angle();
            let abs_angle = angle.abs();

            // Near horizontal
            if abs_angle < angle_threshold || abs_angle > PI - angle_threshold {
                let avg_y = (line.start.y + line.end.y) / 2.0;
                DetectedLine {
                    start: Point2D::new(line.start.x, avg_y),
                    end: Point2D::new(line.end.x, avg_y),
                    thickness: line.thickness,
                    confidence: line.confidence,
                }
            }
            // Near vertical
            else if (abs_angle - PI / 2.0).abs() < angle_threshold {
                let avg_x = (line.start.x + line.end.x) / 2.0;
                DetectedLine {
                    start: Point2D::new(avg_x, line.start.y),
                    end: Point2D::new(avg_x, line.end.y),
                    thickness: line.thickness,
                    confidence: line.confidence,
                }
            } else {
                line.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_point_to_line_distance() {
        let start = Point2D::new(0.0, 0.0);
        let end = Point2D::new(10.0, 0.0);
        let point = Point2D::new(5.0, 5.0);

        let dist = point_to_line_distance(&point, &start, &end);
        assert!((dist - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_are_collinear() {
        // Two horizontal lines that overlap in x-range
        let l1 = DetectedLine::new(Point2D::new(0.0, 0.0), Point2D::new(20.0, 0.0));
        // l2 overlaps l1's x-range and is 0.5 pixels apart in y
        let l2 = DetectedLine::new(Point2D::new(5.0, 0.5), Point2D::new(15.0, 0.5));

        // l2's midpoint is at (10, 0.5), perpendicular distance to l1 = 0.5
        assert!(are_collinear(&l1, &l2, 0.1, 1.0));

        // l3 is 10 pixels away - definitely not collinear
        let l3 = DetectedLine::new(Point2D::new(0.0, 10.0), Point2D::new(20.0, 10.0));
        assert!(!are_collinear(&l1, &l3, 0.1, 5.0));
    }

    #[test]
    fn test_merge_line_group() {
        let lines = vec![
            DetectedLine::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 0.0)),
            DetectedLine::new(Point2D::new(15.0, 0.0), Point2D::new(25.0, 0.0)),
        ];

        let merged = merge_line_group(&lines);

        assert!((merged.start.x - 0.0).abs() < 0.001);
        assert!((merged.end.x - 25.0).abs() < 0.001);
    }

    #[test]
    fn test_snap_to_axes() {
        let lines = vec![DetectedLine::new(
            Point2D::new(0.0, 0.1),
            Point2D::new(10.0, -0.1),
        )];

        let snapped = snap_to_axes(&lines, 0.1);

        assert!((snapped[0].start.y - snapped[0].end.y).abs() < 0.001);
    }
}
