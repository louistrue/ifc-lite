// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use std::fs;
use ifc_lite_core::{EntityScanner, EntityDecoder, IfcType};
use ifc_lite_geometry::GeometryRouter;

fn main() {
    let content = fs::read_to_string("../01_Snowdon_Towers_Sample_Structural(1).ifc")
        .expect("Failed to read IFC file");

    println!("File size: {} bytes", content.len());

    // Create geometry router
    let router = GeometryRouter::new();
    let mut scanner = EntityScanner::new(&content);
    let mut decoder = EntityDecoder::new(&content);

    let mut wall_count = 0;
    let mut processed_count = 0;
    let mut error_count = 0;
    let mut total_vertices = 0;
    let mut total_triangles = 0;

    // Process first few walls
    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        if type_name.contains("WALL") {
            wall_count += 1;

            if wall_count <= 5 {
                println!("\n--- Wall #{}: {} ---", id, type_name);

                // Check if this type has geometry
                let ifc_type = IfcType::from_str(type_name);
                if let Some(ifc_type) = ifc_type {
                    println!("Has geometry: {}", router.schema().has_geometry(&ifc_type));

                    // Try to decode and process
                    if let Ok(entity) = decoder.decode_at(start, end) {
                        match router.process_element(&entity, &mut decoder) {
                            Ok(mesh) => {
                                let vertices = mesh.vertex_count();
                                let triangles = mesh.triangle_count();
                                println!("✅ SUCCESS!");
                                println!("   Vertices: {}", vertices);
                                println!("   Triangles: {}", triangles);

                                if vertices > 0 {
                                    processed_count += 1;
                                    total_vertices += vertices;
                                    total_triangles += triangles;
                                }
                            }
                            Err(e) => {
                                println!("❌ ERROR: {}", e);
                                error_count += 1;
                            }
                        }
                    } else {
                        println!("❌ Failed to decode entity");
                    }
                }
            }
        }
    }

    println!("\n========== SUMMARY ==========");
    println!("Total wall entities: {}", wall_count);
    println!("Processed successfully: {}", processed_count);
    println!("Errors: {}", error_count);
    println!("Total vertices: {}", total_vertices);
    println!("Total triangles: {}", total_triangles);
}
