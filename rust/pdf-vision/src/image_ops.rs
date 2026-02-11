// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Image processing operations for floor plan recognition

use image::{GrayImage, Luma};

/// Apply Gaussian blur for noise reduction
pub fn gaussian_blur(image: &GrayImage, sigma: f32) -> GrayImage {
    imageproc::filter::gaussian_blur_f32(image, sigma)
}

/// Apply adaptive thresholding using local mean
///
/// For each pixel, threshold is calculated based on the local neighborhood.
/// The block_radius parameter determines the neighborhood size.
pub fn adaptive_threshold(image: &GrayImage, block_radius: u32, _c: f64) -> GrayImage {
    // imageproc's adaptive_threshold only takes 2 args (image and block_radius)
    // The 'c' parameter is not used in this version
    imageproc::contrast::adaptive_threshold(image, block_radius)
}

/// Apply Canny edge detection
pub fn canny_edges(image: &GrayImage, low_threshold: f32, high_threshold: f32) -> GrayImage {
    imageproc::edges::canny(image, low_threshold, high_threshold)
}

/// Morphological dilation - expands white regions
pub fn dilate(image: &GrayImage, radius: u8) -> GrayImage {
    imageproc::morphology::dilate(image, imageproc::distance_transform::Norm::L1, radius)
}

/// Morphological erosion - shrinks white regions
pub fn erode(image: &GrayImage, radius: u8) -> GrayImage {
    imageproc::morphology::erode(image, imageproc::distance_transform::Norm::L1, radius)
}

/// Morphological closing (dilate then erode) - fills small gaps
pub fn morphological_close(image: &GrayImage, radius: u8) -> GrayImage {
    let dilated = dilate(image, radius);
    erode(&dilated, radius)
}

/// Morphological opening (erode then dilate) - removes small noise
pub fn morphological_open(image: &GrayImage, radius: u8) -> GrayImage {
    let eroded = erode(image, radius);
    dilate(&eroded, radius)
}

/// Invert a binary image
pub fn invert(image: &GrayImage) -> GrayImage {
    let mut result = image.clone();
    for pixel in result.pixels_mut() {
        pixel.0[0] = 255 - pixel.0[0];
    }
    result
}

/// Convert RGBA bytes to grayscale image
pub fn rgba_to_grayscale(rgba: &[u8], width: u32, height: u32) -> GrayImage {
    let mut gray = GrayImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            if i + 2 < rgba.len() {
                let r = rgba[i] as f32;
                let g = rgba[i + 1] as f32;
                let b = rgba[i + 2] as f32;
                // Standard luminance formula (ITU-R BT.601)
                let luma = (0.299 * r + 0.587 * g + 0.114 * b) as u8;
                gray.put_pixel(x, y, Luma([luma]));
            }
        }
    }

    gray
}

/// Simple threshold - pixels above threshold become white, below become black
pub fn threshold(image: &GrayImage, threshold_value: u8) -> GrayImage {
    let mut result = GrayImage::new(image.width(), image.height());

    for (x, y, pixel) in image.enumerate_pixels() {
        let value = if pixel.0[0] >= threshold_value { 255 } else { 0 };
        result.put_pixel(x, y, Luma([value]));
    }

    result
}

/// Apply Otsu's thresholding to find optimal threshold value
pub fn otsu_threshold(image: &GrayImage) -> GrayImage {
    let threshold_value = otsu_level(image);
    threshold(image, threshold_value)
}

/// Calculate Otsu's optimal threshold level
fn otsu_level(image: &GrayImage) -> u8 {
    // Build histogram
    let mut histogram = [0u32; 256];
    for pixel in image.pixels() {
        histogram[pixel.0[0] as usize] += 1;
    }

    let total_pixels = (image.width() * image.height()) as f64;
    if total_pixels == 0.0 {
        return 128;
    }

    // Calculate cumulative sums
    let mut sum_total = 0.0;
    for (i, &count) in histogram.iter().enumerate() {
        sum_total += i as f64 * count as f64;
    }

    let mut sum_background = 0.0;
    let mut weight_background = 0.0;
    let mut max_variance = 0.0;
    let mut best_threshold = 0u8;

    for (t, &count) in histogram.iter().enumerate() {
        weight_background += count as f64;
        if weight_background == 0.0 {
            continue;
        }

        let weight_foreground = total_pixels - weight_background;
        if weight_foreground == 0.0 {
            break;
        }

        sum_background += t as f64 * count as f64;

        let mean_background = sum_background / weight_background;
        let mean_foreground = (sum_total - sum_background) / weight_foreground;

        let variance =
            weight_background * weight_foreground * (mean_background - mean_foreground).powi(2);

        if variance > max_variance {
            max_variance = variance;
            best_threshold = t as u8;
        }
    }

    best_threshold
}

/// Detected building region within the image.
/// Identifies where the actual building footprint is, excluding dimension lines,
/// title blocks, compass roses, and other annotations in the margins.
#[derive(Debug, Clone)]
pub struct BuildingRegion {
    /// Left edge of building (x pixel)
    pub min_x: u32,
    /// Right edge of building (x pixel)
    pub max_x: u32,
    /// Top edge of building (y pixel)
    pub min_y: u32,
    /// Bottom edge of building (y pixel)
    pub max_y: u32,
    /// For each edge, whether a solid wall was detected (vs open area like balcony)
    pub has_wall_top: bool,
    pub has_wall_bottom: bool,
    pub has_wall_left: bool,
    pub has_wall_right: bool,
}

/// Detect the building region within a floor plan image.
///
/// Scans from each image edge inward to find the first thick band of dark pixels
/// (the exterior walls). Everything outside these bands is margin (dimension lines,
/// title blocks, annotations).
///
/// This is a general-purpose approach that works for:
/// - Floor plans with dimension lines on any side
/// - Non-rectangular buildings (balconies, loggias, L-shapes)
/// - Floor plans with or without margins
///
/// # Arguments
/// * `image` - Grayscale floor plan image
/// * `dark_threshold` - Pixel value below which a pixel is "dark" (wall). Default: 80
/// * `min_wall_thickness` - Minimum consecutive dark pixels to count as a wall. Default: 4
pub fn detect_building_region(
    image: &GrayImage,
    dark_threshold: u8,
    min_wall_thickness: u32,
) -> BuildingRegion {
    let w = image.width();
    let h = image.height();

    // Scan from each edge inward to find the first thick wall band.
    // We scan multiple "rays" (rows/columns) and take the median result
    // to be robust against dimension line arrows or text.

    let min_x = scan_edge_inward_x(image, w, h, dark_threshold, min_wall_thickness, true);
    let max_x = scan_edge_inward_x(image, w, h, dark_threshold, min_wall_thickness, false);
    let min_y = scan_edge_inward_y(image, w, h, dark_threshold, min_wall_thickness, true);
    let max_y = scan_edge_inward_y(image, w, h, dark_threshold, min_wall_thickness, false);

    // Check each edge for wall presence (thick dark band vs open/thin)
    let has_wall_top = check_edge_has_wall(image, w, h, dark_threshold, min_wall_thickness, Edge::Top, min_y);
    let has_wall_bottom = check_edge_has_wall(image, w, h, dark_threshold, min_wall_thickness, Edge::Bottom, max_y);
    let has_wall_left = check_edge_has_wall(image, w, h, dark_threshold, min_wall_thickness, Edge::Left, min_x);
    let has_wall_right = check_edge_has_wall(image, w, h, dark_threshold, min_wall_thickness, Edge::Right, max_x);

    BuildingRegion {
        min_x,
        max_x,
        min_y,
        max_y,
        has_wall_top,
        has_wall_bottom,
        has_wall_left,
        has_wall_right,
    }
}

#[derive(Debug, Clone, Copy)]
enum Edge {
    Top,
    Bottom,
    Left,
    Right,
}

/// Scan from left or right edge inward to find the OUTERMOST thick dark band.
/// Uses the most-outward position across multiple sample rays, because
/// some rays hit door openings and find interior walls instead of exterior.
fn scan_edge_inward_x(
    image: &GrayImage,
    w: u32,
    h: u32,
    dark_thresh: u8,
    min_thick: u32,
    from_left: bool,
) -> u32 {
    // Sample many rows (~3% spacing) for robust coverage even with openings
    let num_samples = 33u32;
    let sample_rows: Vec<u32> = (1..num_samples).map(|i| h * i / num_samples).collect();
    let mut wall_positions: Vec<u32> = Vec::new();

    for &row in &sample_rows {
        if let Some(pos) = find_first_thick_band_h(image, row, w, dark_thresh, min_thick, from_left) {
            wall_positions.push(pos);
        }
    }

    if wall_positions.is_empty() {
        return if from_left { 0 } else { w.saturating_sub(1) };
    }

    // Return the MOST OUTWARD position (closest to image edge).
    // - From left: the smallest X value found (outermost left wall)
    // - From right: the largest X value found (outermost right wall)
    // This ensures door openings don't cause us to miss the building edge.
    let best = if from_left {
        *wall_positions.iter().min().unwrap()
    } else {
        *wall_positions.iter().max().unwrap()
    };

    // Secondary outward check: look up to 50px further out from the initial
    // detection to see if there's an even more outward wall that most rays missed.
    secondary_outward_check_x(image, w, h, dark_thresh, min_thick, from_left, best)
}

/// After finding an initial edge position, scan further outward (up to 50px) to
/// see if there's a wall even closer to the image edge that most rays missed.
fn secondary_outward_check_x(
    image: &GrayImage,
    w: u32,
    h: u32,
    dark_thresh: u8,
    min_thick: u32,
    from_left: bool,
    initial: u32,
) -> u32 {
    let search_margin = 50u32;
    let num_samples = 33u32;
    let sample_rows: Vec<u32> = (1..num_samples).map(|i| h * i / num_samples).collect();

    // Define the search range beyond the initial detection
    let (search_start, search_end) = if from_left {
        (initial.saturating_sub(search_margin), initial)
    } else {
        (initial + 1, (initial + search_margin).min(w))
    };
    if search_start >= search_end {
        return initial;
    }

    let mut outer_positions: Vec<u32> = Vec::new();
    for &row in &sample_rows {
        // Scan just the margin zone for thick bands
        for x in search_start..search_end {
            let mut consecutive = 0u32;
            let mut band_x = x;
            let mut cx = x;
            while cx < w {
                if image.get_pixel(cx, row).0[0] < dark_thresh {
                    if consecutive == 0 { band_x = cx; }
                    consecutive += 1;
                    if consecutive >= min_thick {
                        outer_positions.push(band_x);
                        break;
                    }
                } else {
                    break;
                }
                cx += 1;
            }
            if consecutive >= min_thick {
                break; // found one in this row, move on
            }
        }
    }

    if outer_positions.is_empty() {
        return initial;
    }

    let outer_best = if from_left {
        *outer_positions.iter().min().unwrap()
    } else {
        *outer_positions.iter().max().unwrap()
    };

    // Only accept the outer position if it's actually more outward
    if from_left {
        outer_best.min(initial)
    } else {
        outer_best.max(initial)
    }
}

/// Scan from top or bottom edge inward to find the OUTERMOST thick dark band.
fn scan_edge_inward_y(
    image: &GrayImage,
    w: u32,
    h: u32,
    dark_thresh: u8,
    min_thick: u32,
    from_top: bool,
) -> u32 {
    let num_samples = 33u32;
    let sample_cols: Vec<u32> = (1..num_samples).map(|i| w * i / num_samples).collect();
    let mut wall_positions: Vec<u32> = Vec::new();

    for &col in &sample_cols {
        if let Some(pos) = find_first_thick_band_v(image, col, h, dark_thresh, min_thick, from_top) {
            wall_positions.push(pos);
        }
    }

    if wall_positions.is_empty() {
        return if from_top { 0 } else { h.saturating_sub(1) };
    }

    // Most outward position:
    // - From top: smallest Y (outermost top wall)
    // - From bottom: largest Y (outermost bottom wall)
    let best = if from_top {
        *wall_positions.iter().min().unwrap()
    } else {
        *wall_positions.iter().max().unwrap()
    };

    // Secondary outward check for Y axis
    secondary_outward_check_y(image, w, h, dark_thresh, min_thick, from_top, best)
}

/// After finding an initial Y edge position, scan further outward (up to 50px)
/// to see if there's a wall even closer to the image edge.
fn secondary_outward_check_y(
    image: &GrayImage,
    w: u32,
    h: u32,
    dark_thresh: u8,
    min_thick: u32,
    from_top: bool,
    initial: u32,
) -> u32 {
    let search_margin = 50u32;
    let num_samples = 33u32;
    let sample_cols: Vec<u32> = (1..num_samples).map(|i| w * i / num_samples).collect();

    let (search_start, search_end) = if from_top {
        (initial.saturating_sub(search_margin), initial)
    } else {
        (initial + 1, (initial + search_margin).min(h))
    };
    if search_start >= search_end {
        return initial;
    }

    let mut outer_positions: Vec<u32> = Vec::new();
    for &col in &sample_cols {
        for y in search_start..search_end {
            let mut consecutive = 0u32;
            let mut band_y = y;
            let mut cy = y;
            while cy < h {
                if image.get_pixel(col, cy).0[0] < dark_thresh {
                    if consecutive == 0 { band_y = cy; }
                    consecutive += 1;
                    if consecutive >= min_thick {
                        outer_positions.push(band_y);
                        break;
                    }
                } else {
                    break;
                }
                cy += 1;
            }
            if consecutive >= min_thick {
                break;
            }
        }
    }

    if outer_positions.is_empty() {
        return initial;
    }

    let outer_best = if from_top {
        *outer_positions.iter().min().unwrap()
    } else {
        *outer_positions.iter().max().unwrap()
    };

    if from_top {
        outer_best.min(initial)
    } else {
        outer_best.max(initial)
    }
}

/// Scan horizontally along a row to find the first thick band of dark pixels.
/// Returns the position of the wall's inner edge (the side facing the building interior).
fn find_first_thick_band_h(
    image: &GrayImage,
    row: u32,
    w: u32,
    dark_thresh: u8,
    min_thick: u32,
    from_left: bool,
) -> Option<u32> {
    let range: Box<dyn Iterator<Item = u32>> = if from_left {
        Box::new(0..w)
    } else {
        Box::new((0..w).rev())
    };

    let mut consecutive_dark = 0u32;
    let mut band_start = 0u32;

    for x in range {
        let pixel = image.get_pixel(x, row).0[0];
        if pixel < dark_thresh {
            if consecutive_dark == 0 {
                band_start = x;
            }
            consecutive_dark += 1;
        } else {
            if consecutive_dark >= min_thick {
                // Found a thick dark band — return its inner edge
                return if from_left {
                    Some(band_start) // Left edge of the wall
                } else {
                    Some(band_start) // Right edge of the wall (band_start is the innermost dark pixel when scanning from right)
                };
            }
            consecutive_dark = 0;
        }
    }

    // Check if we ended inside a band
    if consecutive_dark >= min_thick {
        return Some(band_start);
    }

    None
}

/// Scan vertically along a column to find the first thick band of dark pixels.
fn find_first_thick_band_v(
    image: &GrayImage,
    col: u32,
    h: u32,
    dark_thresh: u8,
    min_thick: u32,
    from_top: bool,
) -> Option<u32> {
    let range: Box<dyn Iterator<Item = u32>> = if from_top {
        Box::new(0..h)
    } else {
        Box::new((0..h).rev())
    };

    let mut consecutive_dark = 0u32;
    let mut band_start = 0u32;

    for y in range {
        let pixel = image.get_pixel(col, y).0[0];
        if pixel < dark_thresh {
            if consecutive_dark == 0 {
                band_start = y;
            }
            consecutive_dark += 1;
        } else {
            if consecutive_dark >= min_thick {
                return Some(band_start);
            }
            consecutive_dark = 0;
        }
    }

    if consecutive_dark >= min_thick {
        return Some(band_start);
    }

    None
}

/// Check if a building edge has a solid wall (thick dark band spanning most of the edge).
/// Used to distinguish true exterior walls from open areas (balconies, loggias).
fn check_edge_has_wall(
    image: &GrayImage,
    w: u32,
    h: u32,
    dark_thresh: u8,
    min_thick: u32,
    edge: Edge,
    edge_pos: u32,
) -> bool {
    // Sample along the edge and check what fraction has thick dark pixels
    let coverage = match edge {
        Edge::Top | Edge::Bottom => {
            let y = edge_pos;
            if y >= h { return false; }
            let mut dark_count = 0u32;
            let sample_count = w / 4; // sample every 4 pixels
            for i in 0..sample_count {
                let x = i * 4;
                if x >= w { break; }
                // Check if there's a thick vertical band at this position
                let mut thick = 0u32;
                for dy in 0..min_thick.min(12) {
                    let cy = match edge {
                        Edge::Top => y.saturating_add(dy),
                        _ => y.saturating_sub(dy),
                    };
                    if cy < h && image.get_pixel(x, cy).0[0] < dark_thresh {
                        thick += 1;
                    }
                }
                if thick >= min_thick.min(4) {
                    dark_count += 1;
                }
            }
            dark_count as f64 / sample_count.max(1) as f64
        }
        Edge::Left | Edge::Right => {
            let x = edge_pos;
            if x >= w { return false; }
            let mut dark_count = 0u32;
            let sample_count = h / 4;
            for i in 0..sample_count {
                let y = i * 4;
                if y >= h { break; }
                let mut thick = 0u32;
                for dx in 0..min_thick.min(12) {
                    let cx = match edge {
                        Edge::Left => x.saturating_add(dx),
                        _ => x.saturating_sub(dx),
                    };
                    if cx < w && image.get_pixel(cx, y).0[0] < dark_thresh {
                        thick += 1;
                    }
                }
                if thick >= min_thick.min(4) {
                    dark_count += 1;
                }
            }
            dark_count as f64 / sample_count.max(1) as f64
        }
    };

    // Need at least 40% coverage to count as "has wall"
    // (balconies/loggias will have low coverage due to openings)
    coverage > 0.40
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_threshold() {
        let mut img = GrayImage::new(10, 10);
        for x in 0..10 {
            for y in 0..10 {
                let value = if x < 5 { 100 } else { 200 };
                img.put_pixel(x, y, Luma([value]));
            }
        }

        let result = threshold(&img, 150);

        assert_eq!(result.get_pixel(0, 0).0[0], 0);
        assert_eq!(result.get_pixel(9, 0).0[0], 255);
    }

    #[test]
    fn test_invert() {
        let mut img = GrayImage::new(2, 2);
        img.put_pixel(0, 0, Luma([0]));
        img.put_pixel(1, 1, Luma([255]));

        let inverted = invert(&img);

        assert_eq!(inverted.get_pixel(0, 0).0[0], 255);
        assert_eq!(inverted.get_pixel(1, 1).0[0], 0);
    }

    #[test]
    fn test_rgba_to_grayscale() {
        // White pixel (255, 255, 255, 255)
        let rgba = vec![255, 255, 255, 255, 0, 0, 0, 255];
        let gray = rgba_to_grayscale(&rgba, 2, 1);

        assert_eq!(gray.get_pixel(0, 0).0[0], 255);
        assert_eq!(gray.get_pixel(1, 0).0[0], 0);
    }
}
