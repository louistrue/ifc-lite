// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! CLI tool: Convert a 2D floor plan image into a 3D building (OBJ output)
//!
//! Includes robust filtering to extract only structural walls, removing
//! door arcs, furniture outlines, dimension text, and fixture symbols.
//!
//! Usage:
//!   floorplan-to-3d <image_path> [options]

use ifc_lite_pdf_vision::{
    apply_door_openings, detect_building_region, detect_walls, detect_walls_simple, filter_walls,
    generate_building, DetectedFloorPlan, DetectedWall, DetectionConfig, StoreyConfig,
    WallFilterConfig,
};
use image::GrayImage;
use image::ImageReader;
use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 || args[1] == "--help" || args[1] == "-h" {
        print_usage();
        return;
    }

    let image_path = &args[1];

    // Parse options
    let mut num_storeys: usize = 3;
    let mut storey_height: f64 = 3.0;
    let mut scale: Option<f64> = None;
    let mut output_path = String::from("building.obj");
    let mut min_wall_length: f64 = 30.0;
    let mut use_simple = false;
    let mut debug_mode = false;
    let mut no_filter = false;

    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--storeys" => {
                i += 1;
                num_storeys = args[i].parse().expect("Invalid storeys value");
            }
            "--storey-height" => {
                i += 1;
                storey_height = args[i].parse().expect("Invalid storey height value");
            }
            "--scale" => {
                i += 1;
                scale = Some(args[i].parse().expect("Invalid scale value"));
            }
            "--output" => {
                i += 1;
                output_path = args[i].clone();
            }
            "--min-wall-length" => {
                i += 1;
                min_wall_length = args[i].parse().expect("Invalid min wall length value");
            }
            "--simple" => {
                use_simple = true;
            }
            "--debug" => {
                debug_mode = true;
            }
            "--no-filter" => {
                no_filter = true;
            }
            other => {
                eprintln!("Unknown option: {}", other);
                print_usage();
                std::process::exit(1);
            }
        }
        i += 1;
    }

    println!("=== Floor Plan to 3D Building Generator ===");
    println!();

    // Step 1: Load image
    println!("[1/6] Loading image: {}", image_path);
    let img = ImageReader::open(image_path)
        .unwrap_or_else(|e| {
            eprintln!("Error: Cannot open image '{}': {}", image_path, e);
            std::process::exit(1);
        })
        .decode()
        .unwrap_or_else(|e| {
            eprintln!("Error: Cannot decode image '{}': {}", image_path, e);
            std::process::exit(1);
        });

    let grayscale: GrayImage = img.to_luma8();
    let width = grayscale.width();
    let height = grayscale.height();
    println!("  Image size: {}x{} pixels", width, height);

    // Step 2: Configure detection
    println!("[2/6] Configuring detection...");
    let config = DetectionConfig {
        blur_kernel_size: 3,
        threshold_block_size: 15,
        threshold_c: 5.0,
        canny_low: 30.0,
        canny_high: 100.0,
        hough_threshold: 40,
        min_line_length: min_wall_length,
        max_line_gap: 15.0,
        collinear_angle_tolerance: 0.087,
        collinear_distance_tolerance: 10.0,
        min_wall_length,
        default_wall_thickness: 12.0,
        min_room_area: 5000.0,
    };

    // Auto-estimate scale
    let estimated_scale = scale.unwrap_or_else(|| {
        let longer_axis = width.max(height) as f64;
        let estimated_building_size = 15.0;
        let s = estimated_building_size / longer_axis;
        println!(
            "  Auto-estimated scale: {:.5} m/px ({:.1}m across {} px)",
            s, estimated_building_size, longer_axis
        );
        s
    });

    if scale.is_some() {
        println!("  Using provided scale: {:.5} m/px", estimated_scale);
    }

    // Step 3: Detect raw lines/walls
    println!("[3/6] Detecting lines (raw Hough transform)...");
    let raw_walls = if use_simple {
        println!("  Mode: simplified detection");
        detect_walls_simple(&grayscale, &config)
    } else {
        println!("  Mode: full detection pipeline");
        detect_walls(&grayscale, &config)
    };
    println!("  Raw detections: {} segments", raw_walls.len());

    if raw_walls.is_empty() {
        eprintln!("Error: No lines detected at all. Try --min-wall-length with a lower value.");
        std::process::exit(1);
    }

    // Save raw debug image before filtering
    if debug_mode {
        save_debug_image(&grayscale, &raw_walls, &[], image_path, "raw");
    }

    // Step 4: Filter to structural walls only
    let final_walls;
    let mut door_openings = Vec::new();

    if no_filter {
        println!("[4/6] Filtering: SKIPPED (--no-filter)");
        final_walls = raw_walls;
    } else {
        println!("[4/6] Filtering non-wall elements...");

        // Detect building region from image to exclude dimension lines
        let building_region = detect_building_region(&grayscale, 80, 3);
        println!("  Building region: ({},{}) to ({},{})",
            building_region.min_x, building_region.min_y,
            building_region.max_x, building_region.max_y);
        println!("  Walls detected: top={} bottom={} left={} right={}",
            building_region.has_wall_top, building_region.has_wall_bottom,
            building_region.has_wall_left, building_region.has_wall_right);

        let filter_config = WallFilterConfig {
            axis_angle_tolerance: 0.14,      // ~8 degrees
            connection_tolerance: 50.0,      // thick exterior walls have inner/outer edges ~35px apart
            min_connections: 1,
            min_filtered_length: 50.0,
            overlap_merge_distance: 20.0,    // merge inner/outer edge detections of thick walls
            arc_detection_radius_min: 20.0,
            arc_detection_radius_max: 120.0,
            arc_min_segments: 3,
            scale: estimated_scale,
            max_wall_thickness_m: 0.35,
            interior_wall_thickness_m: 0.15,
            exterior_wall_thickness_m: 0.25,
            collinear_merge_gap: 120.0,      // bridge larger gaps (bedroom labels, door clusters)
            image_width: width as f64,
            image_height: height as f64,
            building_region: Some(building_region),
        };

        let result = filter_walls(raw_walls, &filter_config);

        println!("  Filter statistics:");
        println!("    Input:               {} segments", result.stats.input_count);
        println!(
            "    Removed (diagonal):  {} (furniture, arcs, dim lines)",
            result.stats.removed_diagonal
        );
        println!(
            "    Removed (arc/short): {} (door arcs, symbols)",
            result.stats.removed_arcs + result.stats.removed_short
        );
        println!(
            "    Removed (isolated):  {} (disconnected furniture)",
            result.stats.removed_disconnected
        );
        println!(
            "    Removed (overlap):   {} (duplicate detections merged)",
            result.stats.removed_overlap
        );
        println!("    Structural walls:    {}", result.stats.final_count);
        println!("    Doors detected:      {}", result.stats.doors_detected);

        door_openings = result.door_openings;

        // Apply door openings to split walls
        if !door_openings.is_empty() {
            let walls_with_doors =
                apply_door_openings(result.walls, &door_openings, 30.0);
            println!(
                "  After door cutouts: {} wall segments",
                walls_with_doors.len()
            );
            final_walls = walls_with_doors;
        } else {
            final_walls = result.walls;
        }
    }

    if final_walls.is_empty() {
        eprintln!("Error: No structural walls found after filtering.");
        eprintln!("  Try: --no-filter to skip filtering");
        eprintln!("  Try: --min-wall-length with a lower value");
        std::process::exit(1);
    }

    // Print final walls
    println!();
    println!("  Final walls ({}):", final_walls.len());
    for (i, wall) in final_walls.iter().enumerate() {
        let start = &wall.centerline[0];
        let end = wall.centerline.last().unwrap();
        let length_m = wall.length() * estimated_scale;
        let orientation = wall_orientation(wall);
        println!(
            "    {:2}: ({:6.1},{:6.1})->({:6.1},{:6.1}) | {:.2}m {:5} thick={:.0}px {:?}",
            i, start.x, start.y, end.x, end.y, length_m, orientation, wall.thickness, wall.wall_type
        );
    }

    // Save filtered debug image
    if debug_mode {
        save_debug_image(&grayscale, &final_walls, &door_openings, image_path, "filtered");
        save_svg_debug(&final_walls, width, height, estimated_scale, image_path);
        save_coordinate_dump(&final_walls, width, height, estimated_scale, image_path);
    }

    // Step 5: Build floor plan and storey configs
    println!();
    println!("[5/6] Generating 3D building with {} storeys...", num_storeys);

    let floor_plan = DetectedFloorPlan {
        page_index: 0,
        walls: final_walls,
        openings: door_openings,
        rooms: vec![],
        scale: estimated_scale,
        image_width: width,
        image_height: height,
    };

    let storey_configs: Vec<StoreyConfig> = (0..num_storeys)
        .map(|i| {
            let label = match i {
                0 => "Ground Floor".to_string(),
                1 => "First Floor".to_string(),
                2 => "Second Floor".to_string(),
                n => format!("Level {}", n),
            };
            StoreyConfig {
                id: format!("storey_{}", i),
                label: label.clone(),
                height: storey_height,
                elevation: i as f64 * storey_height,
                order: i as u32,
                floor_plan_index: 0,
            }
        })
        .collect();

    for config in &storey_configs {
        println!(
            "  {} (elevation: {:.1}m, height: {:.1}m)",
            config.label, config.elevation, config.height
        );
    }

    // Step 6: Generate building
    let building = match generate_building(&[floor_plan], &storey_configs) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Error generating building: {}", e);
            std::process::exit(1);
        }
    };

    println!("[6/6] Writing OBJ file: {}", output_path);
    write_obj(&output_path, &building);

    // Print summary
    println!();
    println!("=== Building Summary ===");
    println!("  Total height: {:.1}m", building.total_height);
    let footprint_w = building.bounds.max_x - building.bounds.min_x;
    let footprint_h = building.bounds.max_y - building.bounds.min_y;
    println!("  Footprint: {:.1}m x {:.1}m", footprint_w, footprint_h);
    println!("  Storeys: {}", building.storeys.len());

    let mut total_verts = 0;
    let mut total_tris = 0;
    for (i, storey) in building.storeys.iter().enumerate() {
        let verts = storey.positions.len() / 3;
        let tris = storey.indices.len() / 3;
        total_verts += verts;
        total_tris += tris;
        println!(
            "  Storey {}: {} walls, {} verts, {} tris",
            i, storey.wall_count, verts, tris
        );
    }
    println!("  Total: {} vertices, {} triangles", total_verts, total_tris);
    println!();
    println!("Done! Open {} in a 3D viewer.", output_path);
}

/// Classify wall orientation for display
fn wall_orientation(wall: &DetectedWall) -> &'static str {
    if wall.centerline.len() < 2 {
        return "???";
    }
    let s = &wall.centerline[0];
    let e = wall.centerline.last().unwrap();
    let angle = (e.y - s.y).atan2(e.x - s.x).abs();
    if angle < 0.15 || angle > std::f64::consts::PI - 0.15 {
        "horiz"
    } else if (angle - std::f64::consts::PI / 2.0).abs() < 0.15 {
        "vert"
    } else {
        "diag"
    }
}

/// Write the generated building to an OBJ file
fn write_obj(path: &str, building: &ifc_lite_pdf_vision::GeneratedBuilding) {
    let mut file = fs::File::create(path).unwrap_or_else(|e| {
        eprintln!("Error: Cannot create output file '{}': {}", path, e);
        std::process::exit(1);
    });

    writeln!(file, "# Generated by floorplan-to-3d (ifc-lite)").unwrap();
    writeln!(
        file,
        "# Building: {:.1}m tall, {} storeys",
        building.total_height,
        building.storeys.len()
    )
    .unwrap();
    writeln!(file, "# Coordinate system: Y-up (OBJ convention)").unwrap();
    writeln!(file).unwrap();

    let mut vertex_offset: u32 = 0;

    for (storey_idx, storey) in building.storeys.iter().enumerate() {
        writeln!(file, "# Storey: {}", storey.config.label).unwrap();
        writeln!(file, "o storey_{}", storey_idx).unwrap();

        // Convert from Z-up (extrusion output) to Y-up (OBJ convention):
        //   OBJ X =  source X  (left-right)
        //   OBJ Y =  source Z  (height → up)
        //   OBJ Z = -source Y  (depth, negated so floor plan isn't mirrored)
        let num_verts = storey.positions.len() / 3;
        for v in 0..num_verts {
            let x = storey.positions[v * 3];
            let y = storey.positions[v * 3 + 1];
            let z = storey.positions[v * 3 + 2];
            writeln!(file, "v {:.6} {:.6} {:.6}", x, z, -y).unwrap();
        }

        let num_normals = storey.normals.len() / 3;
        for n in 0..num_normals {
            let nx = storey.normals[n * 3];
            let ny = storey.normals[n * 3 + 1];
            let nz = storey.normals[n * 3 + 2];
            writeln!(file, "vn {:.6} {:.6} {:.6}", nx, nz, -ny).unwrap();
        }

        let num_tris = storey.indices.len() / 3;
        for t in 0..num_tris {
            let i0 = storey.indices[t * 3] + vertex_offset + 1;
            let i1 = storey.indices[t * 3 + 1] + vertex_offset + 1;
            let i2 = storey.indices[t * 3 + 2] + vertex_offset + 1;
            // Reverse winding order to compensate for the axis flip (negated Z)
            writeln!(file, "f {}//{} {}//{} {}//{}", i0, i0, i2, i2, i1, i1).unwrap();
        }

        vertex_offset += num_verts as u32;
        writeln!(file).unwrap();
    }
}

/// Save a debug image with detected walls and door openings overlaid
fn save_debug_image(
    grayscale: &GrayImage,
    walls: &[DetectedWall],
    openings: &[ifc_lite_pdf_vision::DetectedOpening],
    input_path: &str,
    suffix: &str,
) {
    use image::{Rgb, RgbImage};

    let width = grayscale.width();
    let height = grayscale.height();

    let mut debug_img = RgbImage::new(width, height);
    for (x, y, pixel) in grayscale.enumerate_pixels() {
        let v = pixel.0[0];
        debug_img.put_pixel(x, y, Rgb([v, v, v]));
    }

    // Draw walls: green for horizontal, blue for vertical, red for other
    for wall in walls {
        if wall.centerline.len() >= 2 {
            let start = &wall.centerline[0];
            let end = wall.centerline.last().unwrap();
            let color = match wall_orientation(wall) {
                "horiz" => Rgb([0, 200, 0]),   // Green
                "vert" => Rgb([0, 100, 255]),  // Blue
                _ => Rgb([255, 0, 0]),         // Red (shouldn't happen after filter)
            };
            draw_line_rgb(
                &mut debug_img,
                start.x as i32,
                start.y as i32,
                end.x as i32,
                end.y as i32,
                color,
                2,
            );
        }
    }

    // Draw door openings as magenta circles
    for opening in openings {
        let cx = opening.position.x as i32;
        let cy = opening.position.y as i32;
        let r = (opening.width / 2.0) as i32;
        draw_circle(&mut debug_img, cx, cy, r, Rgb([255, 0, 255]));
    }

    let debug_path = Path::new(input_path)
        .with_extension(format!("{}.png", suffix))
        .to_string_lossy()
        .to_string();
    debug_img.save(&debug_path).unwrap_or_else(|e| {
        eprintln!("Warning: Could not save debug image: {}", e);
    });
    println!("  Debug image saved: {}", debug_path);
}

fn draw_circle(img: &mut image::RgbImage, cx: i32, cy: i32, r: i32, color: image::Rgb<u8>) {
    for angle in 0..360 {
        let rad = (angle as f64) * std::f64::consts::PI / 180.0;
        let x = cx + (r as f64 * rad.cos()) as i32;
        let y = cy + (r as f64 * rad.sin()) as i32;
        if x >= 0 && x < img.width() as i32 && y >= 0 && y < img.height() as i32 {
            img.put_pixel(x as u32, y as u32, color);
        }
    }
}

fn draw_line_rgb(
    img: &mut image::RgbImage,
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
    color: image::Rgb<u8>,
    thickness: i32,
) {
    let dx = (x1 - x0).abs();
    let dy = (y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx - dy;
    let mut x = x0;
    let mut y = y0;

    loop {
        for dy_off in -thickness..=thickness {
            for dx_off in -thickness..=thickness {
                let px = x + dx_off;
                let py = y + dy_off;
                if px >= 0 && px < img.width() as i32 && py >= 0 && py < img.height() as i32 {
                    img.put_pixel(px as u32, py as u32, color);
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

/// Save an SVG debug overlay with wall IDs, coordinates, thickness rects, and grid
fn save_svg_debug(
    walls: &[DetectedWall],
    img_w: u32,
    img_h: u32,
    scale: f64,
    input_path: &str,
) {
    let svg_path = Path::new(input_path)
        .with_extension("debug.svg")
        .to_string_lossy()
        .to_string();

    let mut svg = String::new();
    let w = img_w as f64;
    let h = img_h as f64;

    // SVG header with embedded floor plan as background
    svg.push_str(&format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs>
  <style>
    .wall-line {{ stroke-linecap: round; }}
    .wall-h {{ stroke: #00cc00; stroke-opacity: 0.7; }}
    .wall-v {{ stroke: #0066ff; stroke-opacity: 0.7; }}
    .wall-thick {{ fill-opacity: 0.15; }}
    .wall-thick-h {{ fill: #00cc00; }}
    .wall-thick-v {{ fill: #0066ff; }}
    .endpoint {{ fill: red; }}
    .label {{ font-family: monospace; font-size: 9px; fill: #cc0000; font-weight: bold; }}
    .coord {{ font-family: monospace; font-size: 7px; fill: #666; }}
    .grid {{ stroke: #ccc; stroke-width: 0.5; stroke-dasharray: 4,4; }}
    .grid-label {{ font-family: monospace; font-size: 8px; fill: #999; }}
    .meter-label {{ font-family: monospace; font-size: 10px; fill: #0066ff; font-weight: bold; }}
  </style>
</defs>
<!-- Background: floor plan image -->
<image href="{input_path}" width="{w}" height="{h}" opacity="0.5"/>

<!-- Grid every 100px -->
"#
    ));

    // Grid lines every 100px with pixel labels
    let mut x = 0.0;
    while x <= w {
        svg.push_str(&format!(
            r#"<line x1="{x}" y1="0" x2="{x}" y2="{h}" class="grid"/>
<text x="{}" y="12" class="grid-label">{}</text>
"#,
            x + 2.0,
            x as i32
        ));
        x += 100.0;
    }
    let mut y = 0.0;
    while y <= h {
        svg.push_str(&format!(
            r#"<line x1="0" y1="{y}" x2="{w}" y2="{y}" class="grid"/>
<text x="2" y="{}" class="grid-label">{}</text>
"#,
            y - 2.0,
            y as i32
        ));
        y += 100.0;
    }

    // Draw each wall with thickness rect, centerline, endpoints, ID label
    for (i, wall) in walls.iter().enumerate() {
        if wall.centerline.len() < 2 {
            continue;
        }
        let s = &wall.centerline[0];
        let e = wall.centerline.last().unwrap();
        let is_h = wall_orientation(wall) == "horiz";
        let class = if is_h { "wall-h" } else { "wall-v" };
        let thick_class = if is_h { "wall-thick wall-thick-h" } else { "wall-thick wall-thick-v" };

        // Draw thickness rectangle
        let half_t = wall.thickness / 2.0;
        if is_h {
            // Horizontal wall: thickness in Y direction
            let rx = s.x.min(e.x);
            let ry = s.y - half_t;
            let rw = (e.x - s.x).abs();
            let rh = wall.thickness;
            svg.push_str(&format!(
                r#"<rect x="{rx:.1}" y="{ry:.1}" width="{rw:.1}" height="{rh:.1}" class="{thick_class}"/>
"#
            ));
        } else {
            // Vertical wall: thickness in X direction
            let rx = s.x - half_t;
            let ry = s.y.min(e.y);
            let rw = wall.thickness;
            let rh = (e.y - s.y).abs();
            svg.push_str(&format!(
                r#"<rect x="{rx:.1}" y="{ry:.1}" width="{rw:.1}" height="{rh:.1}" class="{thick_class}"/>
"#
            ));
        }

        // Centerline
        svg.push_str(&format!(
            r#"<line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" class="wall-line {class}" stroke-width="2"/>
"#,
            s.x, s.y, e.x, e.y
        ));

        // Endpoints
        svg.push_str(&format!(
            r#"<circle cx="{:.1}" cy="{:.1}" r="3" class="endpoint"/>
<circle cx="{:.1}" cy="{:.1}" r="3" class="endpoint"/>
"#,
            s.x, s.y, e.x, e.y
        ));

        // Wall ID label at midpoint
        let mx = (s.x + e.x) / 2.0;
        let my = (s.y + e.y) / 2.0;
        let length_m = wall.length() * scale;
        svg.push_str(&format!(
            r#"<text x="{:.1}" y="{:.1}" class="label">W{i}</text>
<text x="{:.1}" y="{:.1}" class="coord">{:.2}m t={:.0}px</text>
"#,
            mx - 8.0,
            my - 5.0,
            mx - 8.0,
            my + 8.0,
            length_m,
            wall.thickness
        ));

        // Start/end coordinate labels
        svg.push_str(&format!(
            r#"<text x="{:.1}" y="{:.1}" class="coord">({:.0},{:.0})</text>
<text x="{:.1}" y="{:.1}" class="coord">({:.0},{:.0})</text>
"#,
            s.x + 4.0,
            s.y - 3.0,
            s.x,
            s.y,
            e.x + 4.0,
            e.y + 12.0,
            e.x,
            e.y,
        ));
    }

    // Meter scale bar at bottom
    let scale_bar_px = 1.0 / scale; // 1 meter in pixels
    svg.push_str(&format!(
        r#"<line x1="20" y1="{}" x2="{:.0}" y2="{}" stroke="blue" stroke-width="3"/>
<text x="20" y="{}" class="meter-label">1m = {:.0}px (scale={:.5} m/px)</text>
"#,
        h - 20.0,
        20.0 + scale_bar_px,
        h - 20.0,
        h - 8.0,
        scale_bar_px,
        scale,
    ));

    svg.push_str("</svg>\n");

    fs::write(&svg_path, &svg).unwrap_or_else(|e| {
        eprintln!("Warning: Could not save SVG debug: {}", e);
    });
    println!("  SVG debug saved: {}", svg_path);
}

/// Dump precise coordinate data to a text file for analysis
fn save_coordinate_dump(
    walls: &[DetectedWall],
    img_w: u32,
    img_h: u32,
    scale: f64,
    input_path: &str,
) {
    let dump_path = Path::new(input_path)
        .with_extension("walls.txt")
        .to_string_lossy()
        .to_string();

    let mut out = String::new();
    out.push_str("=== WALL COORDINATE DUMP ===\n\n");
    out.push_str(&format!("Image: {}x{} pixels\n", img_w, img_h));
    out.push_str(&format!("Scale: {:.6} m/px  (1m = {:.1}px)\n", scale, 1.0 / scale));
    out.push_str(&format!("Building size in meters: {:.2}m x {:.2}m\n\n",
        img_w as f64 * scale, img_h as f64 * scale));

    // Expected walls based on the floor plan dimensions:
    out.push_str("=== EXPECTED WALLS (from floor plan dimensions) ===\n");
    out.push_str("  Building width:  15'1\" + 17'1\" + 17'1\" = 49'3\" ≈ 15.0m\n");
    out.push_str("  Building height: 11'1\" + 14'0\" + 9'9\" ≈ 10.6m\n");
    out.push_str("  Exterior walls should form a rectangle.\n");
    out.push_str("  Top wall: ~y=43 (px)\n");
    out.push_str("  Bottom wall: ~y=567 (px)\n");
    out.push_str("  Left wall: ~x=36-47 (px)\n");
    out.push_str("  Right wall: ~x=741 (px)\n\n");

    // Pixel-space walls
    out.push_str("=== DETECTED WALLS (pixel coordinates) ===\n");
    out.push_str(&format!("{:<4} {:<8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>6}\n",
        "ID", "Orient", "x1(px)", "y1(px)", "x2(px)", "y2(px)", "len(px)", "thick", "type"));
    out.push_str(&"-".repeat(80));
    out.push_str("\n");

    for (i, wall) in walls.iter().enumerate() {
        let s = &wall.centerline[0];
        let e = wall.centerline.last().unwrap();
        let ori = wall_orientation(wall);
        out.push_str(&format!("{:<4} {:<8} {:>8.1} {:>8.1} {:>8.1} {:>8.1} {:>8.1} {:>8.1} {:>6?}\n",
            format!("W{}", i), ori, s.x, s.y, e.x, e.y, wall.length(), wall.thickness, wall.wall_type));
    }

    // Meter-space walls (what gets extruded into 3D)
    out.push_str("\n=== WALLS IN METERS (what the 3D generator sees) ===\n");
    out.push_str("NOTE: 3D coords = pixel coords * scale\n");
    out.push_str("NOTE: Y in image = Y in 3D (but typically Y-up in 3D viewers)\n");
    out.push_str("NOTE: Extrusion is along Z axis (floor elevation to ceiling)\n\n");
    out.push_str(&format!("{:<4} {:<8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}\n",
        "ID", "Orient", "x1(m)", "y1(m)", "x2(m)", "y2(m)", "len(m)", "thick(m)"));
    out.push_str(&"-".repeat(80));
    out.push_str("\n");

    for (i, wall) in walls.iter().enumerate() {
        let s = &wall.centerline[0];
        let e = wall.centerline.last().unwrap();
        let ori = wall_orientation(wall);
        out.push_str(&format!("{:<4} {:<8} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3} {:>8.3}\n",
            format!("W{}", i), ori,
            s.x * scale, s.y * scale, e.x * scale, e.y * scale,
            wall.length() * scale, wall.thickness * scale));
    }

    // Check: what's missing?
    out.push_str("\n=== COVERAGE ANALYSIS ===\n");

    // Find bounding box of detected walls
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;

    for wall in walls {
        for pt in &wall.centerline {
            min_x = min_x.min(pt.x);
            max_x = max_x.max(pt.x);
            min_y = min_y.min(pt.y);
            max_y = max_y.max(pt.y);
        }
    }

    out.push_str(&format!("  Detected bbox (px): ({:.0}, {:.0}) to ({:.0}, {:.0})\n",
        min_x, min_y, max_x, max_y));
    out.push_str(&format!("  Detected bbox (m):  ({:.2}, {:.2}) to ({:.2}, {:.2})\n",
        min_x * scale, min_y * scale, max_x * scale, max_y * scale));
    out.push_str(&format!("  Detected size (m):  {:.2}m x {:.2}m\n",
        (max_x - min_x) * scale, (max_y - min_y) * scale));

    // Check for missing exterior walls
    let expected_top = 43.0;
    let expected_bottom = 567.0;
    let expected_left = 42.0;
    let expected_right = 741.0;

    let has_top = walls.iter().any(|w| {
        let s = &w.centerline[0]; let e = w.centerline.last().unwrap();
        wall_orientation(w) == "horiz" && (s.y - expected_top).abs() < 20.0 && (e.x - s.x).abs() > 100.0
    });
    let has_bottom = walls.iter().any(|w| {
        let s = &w.centerline[0]; let e = w.centerline.last().unwrap();
        wall_orientation(w) == "horiz" && (s.y - expected_bottom).abs() < 20.0 && (e.x - s.x).abs() > 100.0
    });
    let has_left = walls.iter().any(|w| {
        let s = &w.centerline[0]; let e = w.centerline.last().unwrap();
        wall_orientation(w) == "vert" && (s.x - expected_left).abs() < 20.0 && (e.y - s.y).abs() > 100.0
    });
    let has_right = walls.iter().any(|w| {
        let s = &w.centerline[0]; let e = w.centerline.last().unwrap();
        wall_orientation(w) == "vert" && (s.x - expected_right).abs() < 20.0 && (e.y - s.y).abs() > 100.0
    });

    out.push_str(&format!("\n  Exterior wall check:\n"));
    out.push_str(&format!("    Top    (~y={:.0}): {}\n", expected_top, if has_top { "FOUND" } else { "MISSING!" }));
    out.push_str(&format!("    Bottom (~y={:.0}): {}\n", expected_bottom, if has_bottom { "FOUND" } else { "MISSING!" }));
    out.push_str(&format!("    Left   (~x={:.0}): {}\n", expected_left, if has_left { "FOUND" } else { "MISSING!" }));
    out.push_str(&format!("    Right  (~x={:.0}): {}\n", expected_right, if has_right { "FOUND" } else { "MISSING!" }));

    // Count horizontal vs vertical
    let h_count = walls.iter().filter(|w| wall_orientation(w) == "horiz").count();
    let v_count = walls.iter().filter(|w| wall_orientation(w) == "vert").count();
    out.push_str(&format!("\n  Wall orientation breakdown: {} horizontal, {} vertical\n", h_count, v_count));

    // OBJ coordinate mapping
    out.push_str("\n=== OBJ 3D COORDINATE MAPPING (Y-up) ===\n");
    out.push_str("  OBJ X =  pixel_x * scale  (left-right)\n");
    out.push_str("  OBJ Y =  elevation         (height, 0 = ground)\n");
    out.push_str("  OBJ Z = -pixel_y * scale  (depth, negated so plan isn't mirrored)\n");
    out.push_str("  Wall profile = rectangle in XY plane, extruded along Z (internal).\n");
    out.push_str("  write_obj() swaps Y↔Z and negates new-Z for Y-up OBJ convention.\n");

    fs::write(&dump_path, &out).unwrap_or_else(|e| {
        eprintln!("Warning: Could not save coordinate dump: {}", e);
    });
    println!("  Coordinate dump saved: {}", dump_path);
}

fn print_usage() {
    println!(
        r#"Floor Plan to 3D Building Generator
====================================

Converts a 2D floor plan image into a 3D building mesh (OBJ format).
Includes robust filtering to extract only structural walls.

USAGE:
  floorplan-to-3d <image_path> [OPTIONS]

ARGUMENTS:
  <image_path>              Path to floor plan image (PNG, JPEG)

OPTIONS:
  --storeys <n>             Number of storeys (default: 3)
  --storey-height <meters>  Height per storey (default: 3.0)
  --scale <m/px>            Meters per pixel (default: auto-estimate)
  --output <path>           Output OBJ file path (default: building.obj)
  --min-wall-length <px>    Minimum raw line length in pixels (default: 30)
  --simple                  Use simplified detection for clean drawings
  --no-filter               Skip wall filtering (raw detection output)
  --debug                   Save debug images (raw + filtered)
  -h, --help                Show this help message

FILTER PIPELINE:
  1. Axis-alignment: keeps only H/V walls; removes diagonal furniture/arcs
  2. Arc detection:  identifies door swing arcs; records door positions
  3. Length filter:   removes short segments (fixture symbols)
  4. Connectivity:   keeps walls in connected network; removes isolated lines
  5. Overlap merge:  merges duplicate parallel detections

EXAMPLES:
  # Basic 3-storey building (recommended)
  floorplan-to-3d floorplan.png --debug

  # Compare raw vs filtered
  floorplan-to-3d floorplan.png --no-filter --output raw.obj --debug
  floorplan-to-3d floorplan.png --output filtered.obj --debug

  # Custom building
  floorplan-to-3d floorplan.png --storeys 5 --storey-height 2.8 --output tower.obj
"#
    );
}
