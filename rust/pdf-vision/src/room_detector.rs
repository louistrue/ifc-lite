// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Room detection via contour finding

use crate::image_ops::{adaptive_threshold, gaussian_blur, morphological_close, morphological_open};
use crate::types::{DetectedRoom, DetectionConfig, Point2D};
use image::{GrayImage, Luma};

/// Detect rooms as closed contours in the floor plan
pub fn detect_rooms(grayscale: &GrayImage, config: &DetectionConfig) -> Vec<DetectedRoom> {
    // Preprocess image
    let sigma = config.blur_kernel_size as f32 / 3.0;
    let blurred = gaussian_blur(grayscale, sigma);
    let binary = adaptive_threshold(&blurred, config.threshold_block_size as u32, config.threshold_c);

    // Clean up with morphological operations
    let cleaned = morphological_close(&binary, 3);
    let cleaned = morphological_open(&cleaned, 2);

    // Find contours
    let contours = find_contours(&cleaned);

    // Convert to rooms, filtering by area
    contours
        .into_iter()
        .filter_map(|contour| {
            let area = DetectedRoom::calculate_area(&contour);
            if area >= config.min_room_area {
                Some(DetectedRoom {
                    boundary: contour,
                    area,
                    label: None,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Find contours in a binary image using border following
fn find_contours(binary: &GrayImage) -> Vec<Vec<Point2D>> {
    let width = binary.width() as i32;
    let height = binary.height() as i32;

    // Track which pixels have been visited
    let mut visited = vec![false; (width * height) as usize];

    let mut contours = Vec::new();

    // Scan for contour starting points
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let idx = (y * width + x) as usize;

            if visited[idx] {
                continue;
            }

            let pixel = binary.get_pixel(x as u32, y as u32).0[0];

            // Look for white pixel next to black pixel (border)
            if pixel > 128 {
                // Check if this is on a border (adjacent to black)
                let is_border = is_border_pixel(binary, x, y);

                if is_border {
                    // Trace the contour
                    if let Some(contour) = trace_contour(binary, x, y, &mut visited, width, height) {
                        if contour.len() >= 4 {
                            contours.push(contour);
                        }
                    }
                }
            }

            visited[idx] = true;
        }
    }

    contours
}

/// Check if a white pixel is on a border (adjacent to black)
fn is_border_pixel(binary: &GrayImage, x: i32, y: i32) -> bool {
    let neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)];

    for (dx, dy) in neighbors {
        let nx = x + dx;
        let ny = y + dy;

        if nx >= 0 && nx < binary.width() as i32 && ny >= 0 && ny < binary.height() as i32 {
            if binary.get_pixel(nx as u32, ny as u32).0[0] < 128 {
                return true;
            }
        }
    }

    false
}

/// Trace a contour starting from a border pixel
fn trace_contour(
    binary: &GrayImage,
    start_x: i32,
    start_y: i32,
    visited: &mut [bool],
    width: i32,
    height: i32,
) -> Option<Vec<Point2D>> {
    // 8-connected neighbor directions (clockwise from right)
    let directions: [(i32, i32); 8] = [
        (1, 0),   // right
        (1, 1),   // down-right
        (0, 1),   // down
        (-1, 1),  // down-left
        (-1, 0),  // left
        (-1, -1), // up-left
        (0, -1),  // up
        (1, -1),  // up-right
    ];

    let mut contour = Vec::new();
    let mut x = start_x;
    let mut y = start_y;
    let mut dir = 0; // Start looking right

    let max_iterations = (width * height) as usize;

    for _ in 0..max_iterations {
        contour.push(Point2D::new(x as f64, y as f64));

        let idx = (y * width + x) as usize;
        visited[idx] = true;

        // Find next border pixel
        let mut found = false;
        let start_dir = (dir + 6) % 8; // Start search from dir-2 (backtrack)

        for i in 0..8 {
            let check_dir = (start_dir + i) % 8;
            let (dx, dy) = directions[check_dir];
            let nx = x + dx;
            let ny = y + dy;

            if nx < 0 || nx >= width || ny < 0 || ny >= height {
                continue;
            }

            let pixel = binary.get_pixel(nx as u32, ny as u32).0[0];
            if pixel > 128 && is_border_pixel(binary, nx, ny) {
                x = nx;
                y = ny;
                dir = check_dir;
                found = true;
                break;
            }
        }

        if !found || (x == start_x && y == start_y && contour.len() > 2) {
            break;
        }
    }

    // Simplify contour using Douglas-Peucker
    let simplified = douglas_peucker(&contour, 2.0);

    if simplified.len() >= 3 {
        Some(simplified)
    } else {
        None
    }
}

/// Douglas-Peucker line simplification algorithm
fn douglas_peucker(points: &[Point2D], epsilon: f64) -> Vec<Point2D> {
    if points.len() < 3 {
        return points.to_vec();
    }

    // Find the point with maximum distance from line between first and last
    let first = &points[0];
    let last = &points[points.len() - 1];

    let mut max_dist = 0.0;
    let mut max_idx = 0;

    for (i, point) in points.iter().enumerate().skip(1).take(points.len() - 2) {
        let dist = perpendicular_distance(point, first, last);
        if dist > max_dist {
            max_dist = dist;
            max_idx = i;
        }
    }

    // If max distance is greater than epsilon, recursively simplify
    if max_dist > epsilon {
        let left = douglas_peucker(&points[..=max_idx], epsilon);
        let right = douglas_peucker(&points[max_idx..], epsilon);

        // Combine results (excluding duplicate point at max_idx)
        let mut result = left;
        result.extend_from_slice(&right[1..]);
        result
    } else {
        // All points between first and last can be removed
        vec![*first, *last]
    }
}

/// Calculate perpendicular distance from point to line
fn perpendicular_distance(point: &Point2D, line_start: &Point2D, line_end: &Point2D) -> f64 {
    let dx = line_end.x - line_start.x;
    let dy = line_end.y - line_start.y;
    let length_sq = dx * dx + dy * dy;

    if length_sq < 1e-10 {
        return point.distance_to(line_start);
    }

    let length = length_sq.sqrt();
    ((point.x - line_start.x) * dy - (point.y - line_start.y) * dx).abs() / length
}

/// Detect rooms from walls by finding enclosed regions
///
/// This is an alternative approach that uses the detected walls
/// to find enclosed spaces rather than direct contour detection.
pub fn detect_rooms_from_walls(
    walls: &[crate::types::DetectedWall],
    image_width: u32,
    image_height: u32,
    min_area: f64,
) -> Vec<DetectedRoom> {
    // Create a binary image from walls
    let mut wall_image = GrayImage::new(image_width, image_height);

    // Fill with white (empty space)
    for pixel in wall_image.pixels_mut() {
        *pixel = Luma([255]);
    }

    // Draw walls as black lines
    for wall in walls {
        if wall.centerline.len() >= 2 {
            let start = &wall.centerline[0];
            let end = wall.centerline.last().unwrap();

            draw_thick_line(
                &mut wall_image,
                start.x as i32,
                start.y as i32,
                end.x as i32,
                end.y as i32,
                (wall.thickness / 2.0).max(1.0) as i32,
            );
        }
    }

    // Find enclosed white regions (rooms)
    find_enclosed_regions(&wall_image, min_area)
}

/// Draw a thick line on a grayscale image
fn draw_thick_line(img: &mut GrayImage, x0: i32, y0: i32, x1: i32, y1: i32, thickness: i32) {
    let dx = (x1 - x0).abs();
    let dy = (y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx - dy;

    let mut x = x0;
    let mut y = y0;

    loop {
        // Draw a filled circle at current point
        for dy in -thickness..=thickness {
            for dx in -thickness..=thickness {
                if dx * dx + dy * dy <= thickness * thickness {
                    let px = x + dx;
                    let py = y + dy;
                    if px >= 0 && px < img.width() as i32 && py >= 0 && py < img.height() as i32 {
                        img.put_pixel(px as u32, py as u32, Luma([0]));
                    }
                }
            }
        }

        if x == x1 && y == y1 {
            break;
        }

        let e2 = 2 * err;
        if e2 > -dy {
            err -= dy;
            x += sx;
        }
        if e2 < dx {
            err += dx;
            y += sy;
        }
    }
}

/// Find enclosed white regions in a binary image with black walls
fn find_enclosed_regions(binary: &GrayImage, min_area: f64) -> Vec<DetectedRoom> {
    let width = binary.width();
    let height = binary.height();

    // Flood fill to find connected white regions
    let mut visited = vec![false; (width * height) as usize];
    let mut rooms = Vec::new();

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) as usize;
            if visited[idx] {
                continue;
            }

            let pixel = binary.get_pixel(x, y).0[0];
            if pixel > 128 {
                // White pixel - flood fill to find region
                let (region_points, boundary) = flood_fill_region(binary, x, y, &mut visited);

                let area = region_points.len() as f64;
                if area >= min_area && !boundary.is_empty() {
                    rooms.push(DetectedRoom {
                        boundary,
                        area,
                        label: None,
                    });
                }
            } else {
                visited[idx] = true;
            }
        }
    }

    rooms
}

/// Flood fill to find a connected white region and its boundary
fn flood_fill_region(
    binary: &GrayImage,
    start_x: u32,
    start_y: u32,
    visited: &mut [bool],
) -> (Vec<Point2D>, Vec<Point2D>) {
    let width = binary.width();
    let height = binary.height();

    let mut region_points = Vec::new();
    let mut boundary_points = Vec::new();
    let mut stack = vec![(start_x, start_y)];

    while let Some((x, y)) = stack.pop() {
        let idx = (y * width + x) as usize;
        if visited[idx] {
            continue;
        }

        let pixel = binary.get_pixel(x, y).0[0];
        if pixel < 128 {
            continue;
        }

        visited[idx] = true;
        region_points.push(Point2D::new(x as f64, y as f64));

        // Check if this is a boundary pixel
        let is_boundary = x == 0
            || y == 0
            || x == width - 1
            || y == height - 1
            || binary.get_pixel(x.saturating_sub(1), y).0[0] < 128
            || binary.get_pixel((x + 1).min(width - 1), y).0[0] < 128
            || binary.get_pixel(x, y.saturating_sub(1)).0[0] < 128
            || binary.get_pixel(x, (y + 1).min(height - 1)).0[0] < 128;

        if is_boundary {
            boundary_points.push(Point2D::new(x as f64, y as f64));
        }

        // Add neighbors to stack
        if x > 0 {
            stack.push((x - 1, y));
        }
        if x < width - 1 {
            stack.push((x + 1, y));
        }
        if y > 0 {
            stack.push((x, y - 1));
        }
        if y < height - 1 {
            stack.push((x, y + 1));
        }
    }

    // Sort boundary points to form a closed polygon (approximate)
    let boundary = if !boundary_points.is_empty() {
        order_boundary_points(&boundary_points)
    } else {
        boundary_points
    };

    (region_points, boundary)
}

/// Order boundary points to form a closed polygon
fn order_boundary_points(points: &[Point2D]) -> Vec<Point2D> {
    if points.len() < 3 {
        return points.to_vec();
    }

    // Find centroid
    let cx: f64 = points.iter().map(|p| p.x).sum::<f64>() / points.len() as f64;
    let cy: f64 = points.iter().map(|p| p.y).sum::<f64>() / points.len() as f64;

    // Sort points by angle from centroid
    let mut sorted: Vec<_> = points.to_vec();
    sorted.sort_by(|a, b| {
        let angle_a = (a.y - cy).atan2(a.x - cx);
        let angle_b = (b.y - cy).atan2(b.x - cx);
        angle_a.partial_cmp(&angle_b).unwrap()
    });

    // Simplify the boundary
    douglas_peucker(&sorted, 3.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_douglas_peucker() {
        let points = vec![
            Point2D::new(0.0, 0.0),
            Point2D::new(1.0, 0.1),
            Point2D::new(2.0, -0.1),
            Point2D::new(3.0, 0.0),
            Point2D::new(4.0, 0.0),
        ];

        let simplified = douglas_peucker(&points, 0.5);

        // Should simplify to just start and end for a nearly straight line
        assert!(simplified.len() <= 3);
    }

    #[test]
    fn test_perpendicular_distance() {
        let point = Point2D::new(5.0, 5.0);
        let start = Point2D::new(0.0, 0.0);
        let end = Point2D::new(10.0, 0.0);

        let dist = perpendicular_distance(&point, &start, &end);
        assert!((dist - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_calculate_room_area() {
        // Square room 10x10
        let boundary = vec![
            Point2D::new(0.0, 0.0),
            Point2D::new(10.0, 0.0),
            Point2D::new(10.0, 10.0),
            Point2D::new(0.0, 10.0),
        ];

        let area = DetectedRoom::calculate_area(&boundary);
        assert!((area - 100.0).abs() < 0.001);
    }
}
