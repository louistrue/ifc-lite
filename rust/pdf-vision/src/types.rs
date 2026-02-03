// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Core types for floor plan recognition and 3D reconstruction

use nalgebra::Point2;
use serde::{Deserialize, Serialize};

/// A 2D point (simplified for serialization)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point2D {
    pub x: f64,
    pub y: f64,
}

impl Point2D {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn to_nalgebra(&self) -> Point2<f64> {
        Point2::new(self.x, self.y)
    }

    pub fn from_nalgebra(p: &Point2<f64>) -> Self {
        Self { x: p.x, y: p.y }
    }

    pub fn distance_to(&self, other: &Point2D) -> f64 {
        let dx = other.x - self.x;
        let dy = other.y - self.y;
        (dx * dx + dy * dy).sqrt()
    }
}

/// Detected line segment from image processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedLine {
    pub start: Point2D,
    pub end: Point2D,
    /// Estimated line thickness in pixels
    pub thickness: f64,
    /// Detection confidence (0.0 - 1.0)
    pub confidence: f32,
}

impl DetectedLine {
    pub fn new(start: Point2D, end: Point2D) -> Self {
        Self {
            start,
            end,
            thickness: 1.0,
            confidence: 1.0,
        }
    }

    pub fn length(&self) -> f64 {
        self.start.distance_to(&self.end)
    }

    pub fn angle(&self) -> f64 {
        (self.end.y - self.start.y).atan2(self.end.x - self.start.x)
    }

    pub fn midpoint(&self) -> Point2D {
        Point2D::new(
            (self.start.x + self.end.x) / 2.0,
            (self.start.y + self.end.y) / 2.0,
        )
    }
}

/// Wall type classification
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum WallType {
    Exterior,
    Interior,
    Unknown,
}

/// Detected wall (merged from line segments)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedWall {
    /// Wall centerline points (typically 2 for straight walls)
    pub centerline: Vec<Point2D>,
    /// Estimated wall thickness in pixels
    pub thickness: f64,
    /// Wall classification
    pub wall_type: WallType,
    /// Detection confidence
    pub confidence: f32,
}

impl DetectedWall {
    pub fn from_line(line: &DetectedLine, thickness: f64, wall_type: WallType) -> Self {
        Self {
            centerline: vec![line.start, line.end],
            thickness,
            wall_type,
            confidence: line.confidence,
        }
    }

    pub fn length(&self) -> f64 {
        if self.centerline.len() < 2 {
            return 0.0;
        }
        let mut total = 0.0;
        for i in 0..self.centerline.len() - 1 {
            total += self.centerline[i].distance_to(&self.centerline[i + 1]);
        }
        total
    }
}

/// Opening type classification
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum OpeningType {
    Door,
    Window,
    Unknown,
}

/// Detected opening (door/window)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedOpening {
    pub position: Point2D,
    pub width: f64,
    pub opening_type: OpeningType,
    /// Index into walls array
    pub host_wall_index: usize,
}

/// Detected room (closed contour)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedRoom {
    /// Room boundary polygon (counter-clockwise)
    pub boundary: Vec<Point2D>,
    /// Calculated area in square pixels
    pub area: f64,
    /// Optional room label (from OCR, if implemented)
    pub label: Option<String>,
}

impl DetectedRoom {
    /// Calculate polygon area using shoelace formula
    pub fn calculate_area(points: &[Point2D]) -> f64 {
        let n = points.len();
        if n < 3 {
            return 0.0;
        }

        let mut area = 0.0;
        for i in 0..n {
            let j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }

        (area / 2.0).abs()
    }
}

/// Complete floor plan detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedFloorPlan {
    /// Page/image index (0-based)
    pub page_index: usize,
    /// Detected walls
    pub walls: Vec<DetectedWall>,
    /// Detected openings
    pub openings: Vec<DetectedOpening>,
    /// Detected rooms
    pub rooms: Vec<DetectedRoom>,
    /// Scale factor: meters per pixel
    pub scale: f64,
    /// Source image width
    pub image_width: u32,
    /// Source image height
    pub image_height: u32,
}

impl DetectedFloorPlan {
    pub fn new(image_width: u32, image_height: u32, page_index: usize) -> Self {
        Self {
            page_index,
            walls: Vec::new(),
            openings: Vec::new(),
            rooms: Vec::new(),
            scale: 0.01, // Default: 1 pixel = 1 cm
            image_width,
            image_height,
        }
    }
}

/// Configuration for wall detection pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionConfig {
    /// Gaussian blur kernel size (must be odd)
    pub blur_kernel_size: u32,
    /// Adaptive threshold block size
    pub threshold_block_size: i32,
    /// Threshold constant subtracted from mean
    pub threshold_c: f64,
    /// Canny edge detection low threshold
    pub canny_low: f32,
    /// Canny edge detection high threshold
    pub canny_high: f32,
    /// Hough line detection vote threshold
    pub hough_threshold: u32,
    /// Minimum line length in pixels
    pub min_line_length: f64,
    /// Maximum gap between line segments to connect
    pub max_line_gap: f64,
    /// Angle tolerance for merging collinear lines (radians)
    pub collinear_angle_tolerance: f64,
    /// Distance tolerance for merging collinear lines (pixels)
    pub collinear_distance_tolerance: f64,
    /// Minimum wall length to keep (pixels)
    pub min_wall_length: f64,
    /// Default wall thickness estimate (pixels)
    pub default_wall_thickness: f64,
    /// Minimum room area (square pixels)
    pub min_room_area: f64,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            blur_kernel_size: 3,
            threshold_block_size: 11,
            threshold_c: 2.0,
            canny_low: 50.0,
            canny_high: 150.0,
            hough_threshold: 50,
            min_line_length: 30.0,
            max_line_gap: 10.0,
            collinear_angle_tolerance: 0.087, // ~5 degrees
            collinear_distance_tolerance: 8.0,
            min_wall_length: 50.0,
            default_wall_thickness: 15.0,
            min_room_area: 10000.0, // ~100x100 pixels
        }
    }
}

/// Storey configuration for 3D building generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreyConfig {
    /// Unique identifier
    pub id: String,
    /// Display label (e.g., "Ground Floor", "Level 1")
    pub label: String,
    /// Floor-to-ceiling height in meters
    pub height: f64,
    /// Base elevation in meters
    pub elevation: f64,
    /// Stacking order (0 = bottom)
    pub order: u32,
    /// Reference to floor plan (page index)
    pub floor_plan_index: usize,
}

impl StoreyConfig {
    pub fn new(id: String, label: String, floor_plan_index: usize) -> Self {
        Self {
            id,
            label,
            height: 3.0, // Default 3m floor height
            elevation: 0.0,
            order: 0,
            floor_plan_index,
        }
    }
}

/// Generated 3D building result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedBuilding {
    /// Total building height
    pub total_height: f64,
    /// Building footprint bounds
    pub bounds: BuildingBounds,
    /// Per-storey mesh data
    pub storeys: Vec<GeneratedStorey>,
}

/// Bounds of the building footprint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildingBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// Generated storey with mesh data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedStorey {
    pub config: StoreyConfig,
    /// Number of wall meshes
    pub wall_count: usize,
    /// Combined vertex positions (flat array: x, y, z, x, y, z, ...)
    pub positions: Vec<f32>,
    /// Combined vertex normals
    pub normals: Vec<f32>,
    /// Combined triangle indices
    pub indices: Vec<u32>,
}
