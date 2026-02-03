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
