// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Floor plan recognition and 3D building reconstruction
//!
//! This crate provides a complete pipeline for:
//! 1. Processing floor plan images (PDF pages rendered to bitmaps)
//! 2. Detecting walls using classical computer vision (Hough transform)
//! 3. Detecting rooms as enclosed contours
//! 4. Generating 3D building geometry from detected floor plans
//!
//! # Usage
//!
//! ```rust,ignore
//! use ifc_lite_pdf_vision::{
//!     detect_floor_plan,
//!     generate_building,
//!     types::{DetectionConfig, StoreyConfig},
//! };
//!
//! // Process a grayscale floor plan image
//! let floor_plan = detect_floor_plan(&grayscale_image, &DetectionConfig::default());
//!
//! // Configure storeys
//! let storeys = vec![
//!     StoreyConfig::new("ground".into(), "Ground Floor".into(), 0),
//! ];
//!
//! // Generate 3D building
//! let building = generate_building(&[floor_plan], &storeys)?;
//! ```

pub mod building_generator;
pub mod image_ops;
pub mod line_ops;
pub mod room_detector;
pub mod types;
pub mod wall_detector;

// Re-export commonly used types and functions
pub use building_generator::{generate_building, generate_test_building, BuildingError};
pub use image_ops::rgba_to_grayscale;
pub use room_detector::{detect_rooms, detect_rooms_from_walls};
pub use types::{
    DetectedFloorPlan, DetectedOpening, DetectedRoom, DetectedWall, DetectionConfig,
    GeneratedBuilding, GeneratedStorey, OpeningType, Point2D, StoreyConfig, WallType,
};
pub use wall_detector::{detect_openings_in_walls, detect_walls, detect_walls_simple};

use image::GrayImage;

/// High-level function to detect a complete floor plan from a grayscale image
///
/// This runs the full detection pipeline:
/// 1. Wall detection (Hough lines + merging)
/// 2. Opening detection (gaps in walls)
/// 3. Room detection (enclosed contours)
///
/// # Arguments
///
/// * `grayscale` - Grayscale image of the floor plan
/// * `config` - Detection configuration parameters
///
/// # Returns
///
/// A `DetectedFloorPlan` containing all detected elements
pub fn detect_floor_plan(grayscale: &GrayImage, config: &DetectionConfig) -> DetectedFloorPlan {
    let width = grayscale.width();
    let height = grayscale.height();

    // Step 1: Detect walls
    let walls = detect_walls(grayscale, config);

    // Step 2: Detect openings from wall gaps
    let opening_tuples = detect_openings_in_walls(&walls, 50.0, 150.0);
    let openings = opening_tuples
        .into_iter()
        .map(|(wall_idx, pos, width)| DetectedOpening {
            position: pos,
            width,
            opening_type: if width > 90.0 {
                OpeningType::Door
            } else {
                OpeningType::Window
            },
            host_wall_index: wall_idx,
        })
        .collect();

    // Step 3: Detect rooms
    let rooms = detect_rooms_from_walls(&walls, width, height, config.min_room_area);

    DetectedFloorPlan {
        page_index: 0,
        walls,
        openings,
        rooms,
        scale: 0.01, // Default: 1 pixel = 1 cm
        image_width: width,
        image_height: height,
    }
}

/// Process RGBA image data and detect floor plan
///
/// Convenience function that converts RGBA to grayscale and runs detection.
///
/// # Arguments
///
/// * `rgba_data` - RGBA pixel data (4 bytes per pixel)
/// * `width` - Image width
/// * `height` - Image height
/// * `config` - Detection configuration
pub fn detect_floor_plan_from_rgba(
    rgba_data: &[u8],
    width: u32,
    height: u32,
    config: &DetectionConfig,
) -> DetectedFloorPlan {
    let grayscale = rgba_to_grayscale(rgba_data, width, height);
    let mut floor_plan = detect_floor_plan(&grayscale, config);
    floor_plan.image_width = width;
    floor_plan.image_height = height;
    floor_plan
}

/// Full pipeline: detect floor plan and generate 3D building
///
/// This is the main entry point for the complete 2D-to-3D workflow.
///
/// # Arguments
///
/// * `rgba_data` - RGBA pixel data of floor plan image
/// * `width` - Image width
/// * `height` - Image height
/// * `detection_config` - Wall/room detection parameters
/// * `storey_configs` - Building storey configuration
///
/// # Returns
///
/// Generated 3D building with mesh data
pub fn floor_plan_to_building(
    rgba_data: &[u8],
    width: u32,
    height: u32,
    detection_config: &DetectionConfig,
    storey_configs: &[StoreyConfig],
) -> Result<GeneratedBuilding, BuildingError> {
    let floor_plan = detect_floor_plan_from_rgba(rgba_data, width, height, detection_config);
    generate_building(&[floor_plan], storey_configs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    fn create_simple_floor_plan_image() -> GrayImage {
        let mut img = GrayImage::new(200, 200);

        // Fill with white (empty space)
        for pixel in img.pixels_mut() {
            *pixel = Luma([255]);
        }

        // Draw outer walls (black rectangle)
        // Top wall
        for x in 20..180 {
            for y in 20..25 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        // Bottom wall
        for x in 20..180 {
            for y in 175..180 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        // Left wall
        for x in 20..25 {
            for y in 20..180 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        // Right wall
        for x in 175..180 {
            for y in 20..180 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        // Interior wall
        for x in 100..105 {
            for y in 20..180 {
                img.put_pixel(x, y, Luma([0]));
            }
        }

        img
    }

    #[test]
    fn test_full_pipeline() {
        let img = create_simple_floor_plan_image();
        let config = DetectionConfig {
            min_line_length: 20.0,
            min_wall_length: 30.0,
            hough_threshold: 30,
            min_room_area: 1000.0,
            ..Default::default()
        };

        let floor_plan = detect_floor_plan(&img, &config);

        // Should detect some walls
        assert!(!floor_plan.walls.is_empty(), "Should detect walls");
        println!("Detected {} walls", floor_plan.walls.len());
    }

    #[test]
    fn test_building_generation() {
        let building = generate_test_building();

        assert_eq!(building.storeys.len(), 2);
        assert!(building.total_height > 0.0);

        // Verify mesh data is present
        for storey in &building.storeys {
            assert!(!storey.positions.is_empty());
            assert_eq!(storey.positions.len(), storey.normals.len());
            assert!(!storey.indices.is_empty());
        }
    }

    #[test]
    fn test_rgba_to_grayscale() {
        let rgba = vec![
            255, 255, 255, 255, // White
            0, 0, 0, 255,       // Black
            255, 0, 0, 255,     // Red
            0, 255, 0, 255,     // Green
        ];

        let gray = rgba_to_grayscale(&rgba, 2, 2);

        assert_eq!(gray.width(), 2);
        assert_eq!(gray.height(), 2);
        assert_eq!(gray.get_pixel(0, 0).0[0], 255); // White
        assert_eq!(gray.get_pixel(1, 0).0[0], 0);   // Black
    }
}
