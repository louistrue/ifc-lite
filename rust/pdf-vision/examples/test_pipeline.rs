// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Test example for the 3D-from-2D floor plan pipeline
//!
//! Run with: cargo run -p ifc-lite-pdf-vision --example test_pipeline

use ifc_lite_pdf_vision::{
    detect_floor_plan, generate_building, generate_test_building, DetectedFloorPlan,
    DetectionConfig, StoreyConfig,
};
use image::{GrayImage, Luma};

fn main() {
    println!("=== 3D-from-2D Floor Plan Pipeline Test ===\n");

    // Test 1: Generate test building (no image input needed)
    println!("Test 1: Generate test building...");
    let building = generate_test_building();
    println!("  Total height: {:.2}m", building.total_height);
    println!("  Number of storeys: {}", building.storeys.len());
    for storey in &building.storeys {
        println!(
            "    - {}: {} walls, {} vertices, {} triangles",
            storey.config.label,
            storey.wall_count,
            storey.positions.len() / 3,
            storey.indices.len() / 3
        );
    }
    println!("  Bounds: ({:.2}, {:.2}) to ({:.2}, {:.2})",
        building.bounds.min_x, building.bounds.min_y,
        building.bounds.max_x, building.bounds.max_y);
    println!("  ✓ Test building generated successfully!\n");

    // Test 2: Process a synthetic floor plan image
    println!("Test 2: Detect floor plan from synthetic image...");
    let floor_plan_image = create_synthetic_floor_plan();
    let config = DetectionConfig {
        min_line_length: 30.0,
        min_wall_length: 40.0,
        hough_threshold: 30,
        ..Default::default()
    };

    let floor_plan = detect_floor_plan(&floor_plan_image, &config);
    println!("  Image size: {}x{}", floor_plan.image_width, floor_plan.image_height);
    println!("  Walls detected: {}", floor_plan.walls.len());
    println!("  Rooms detected: {}", floor_plan.rooms.len());
    println!("  Openings detected: {}", floor_plan.openings.len());

    for (i, wall) in floor_plan.walls.iter().enumerate() {
        println!(
            "    Wall {}: length={:.1}px, thickness={:.1}px, type={:?}",
            i, wall.length(), wall.thickness, wall.wall_type
        );
    }
    println!("  ✓ Floor plan detection completed!\n");

    // Test 3: Generate 3D building from detected floor plan
    println!("Test 3: Generate 3D building from detected floor plan...");

    // Create storey configurations
    let storey_configs = vec![
        StoreyConfig {
            id: "ground".to_string(),
            label: "Ground Floor".to_string(),
            height: 3.0,
            elevation: 0.0,
            order: 0,
            floor_plan_index: 0,
        },
        StoreyConfig {
            id: "first".to_string(),
            label: "First Floor".to_string(),
            height: 2.8,
            elevation: 3.0,
            order: 1,
            floor_plan_index: 0, // Same floor plan for both storeys
        },
    ];

    // Adjust floor plan scale (pixels to meters)
    let mut adjusted_floor_plan = floor_plan.clone();
    adjusted_floor_plan.scale = 0.05; // 1 pixel = 5cm

    let building = generate_building(&[adjusted_floor_plan], &storey_configs);

    match building {
        Ok(building) => {
            println!("  Total height: {:.2}m", building.total_height);
            println!("  Number of storeys: {}", building.storeys.len());

            let total_vertices: usize = building.storeys.iter().map(|s| s.positions.len() / 3).sum();
            let total_triangles: usize = building.storeys.iter().map(|s| s.indices.len() / 3).sum();

            println!("  Total vertices: {}", total_vertices);
            println!("  Total triangles: {}", total_triangles);

            for storey in &building.storeys {
                println!(
                    "    - {} (elevation {:.2}m): {} walls, {} triangles",
                    storey.config.label,
                    storey.config.elevation,
                    storey.wall_count,
                    storey.indices.len() / 3
                );
            }
            println!("  ✓ 3D building generated successfully!\n");
        }
        Err(e) => {
            println!("  ✗ Building generation failed: {}\n", e);
        }
    }

    // Summary
    println!("=== Pipeline Test Complete ===");
    println!("\nThe full pipeline works:");
    println!("  1. Floor plan image → Wall detection (Hough transform)");
    println!("  2. Detected walls → Profile2D (rectangular wall profiles)");
    println!("  3. Profiles → 3D meshes (extrusion)");
    println!("  4. Meshes → GPU-ready buffers (positions, normals, indices)");
    println!("\nNext steps for production:");
    println!("  - Integrate pdf.js for PDF rendering (TypeScript side)");
    println!("  - Add UI for storey ordering and height configuration");
    println!("  - Connect to WebGPU renderer for 3D preview");
}

/// Create a synthetic floor plan image for testing
fn create_synthetic_floor_plan() -> GrayImage {
    let width = 400;
    let height = 300;
    let mut img = GrayImage::new(width, height);

    // Fill with white (empty space)
    for pixel in img.pixels_mut() {
        *pixel = Luma([255]);
    }

    // Draw outer walls (thick black lines)
    let wall_thickness = 6;
    let margin = 30;

    // Top wall
    draw_rect(&mut img, margin, margin, width - margin, margin + wall_thickness, 0);
    // Bottom wall
    draw_rect(&mut img, margin, height - margin - wall_thickness, width - margin, height - margin, 0);
    // Left wall
    draw_rect(&mut img, margin, margin, margin + wall_thickness, height - margin, 0);
    // Right wall
    draw_rect(&mut img, width - margin - wall_thickness, margin, width - margin, height - margin, 0);

    // Interior wall (thinner)
    let interior_thickness = 4;
    let mid_x = width / 2;
    draw_rect(&mut img, mid_x - interior_thickness / 2, margin + wall_thickness, mid_x + interior_thickness / 2, height - margin - wall_thickness, 0);

    // Door opening in interior wall
    let door_width = 30;
    let door_y = 100;
    draw_rect(&mut img, mid_x - interior_thickness / 2, door_y, mid_x + interior_thickness / 2, door_y + door_width, 255);

    img
}

fn draw_rect(img: &mut GrayImage, x1: u32, y1: u32, x2: u32, y2: u32, value: u8) {
    for y in y1..y2.min(img.height()) {
        for x in x1..x2.min(img.width()) {
            img.put_pixel(x, y, Luma([value]));
        }
    }
}
