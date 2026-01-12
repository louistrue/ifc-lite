// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use std::fs;

fn main() {
    let content = fs::read_to_string("01_Snowdon_Towers_Sample_Structural(1).ifc")
        .expect("Failed to read IFC file");

    println!("File size: {} bytes", content.len());

    // Test entity scanner
    let mut scanner = ifc_lite_core::EntityScanner::new(&content);
    let mut wall_count = 0;
    let mut total_count = 0;

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        total_count += 1;

        if type_name.contains("WALL") {
            wall_count += 1;
            if wall_count <= 3 {
                println!("\nWall #{}: {}", id, type_name);
                println!("  Entity: {}", &content[start..end.min(start + 200)]);

                // Try to process it
                let ifc_type = ifc_lite_core::IfcType::from_str(type_name);
                if let Some(ifc_type) = ifc_type {
                    let schema = ifc_lite_core::IfcSchema::new();
                    println!("  Has geometry: {}", schema.has_geometry(&ifc_type));
                    println!("  Is building element: {}", ifc_type.is_building_element());

                    // Try to decode and process
                    let mut decoder = ifc_lite_core::EntityDecoder::new(&content);
                    if let Ok(entity) = decoder.decode_at(start, end) {
                        println!("  Successfully decoded entity");
                        println!("  Attributes: {}", entity.attributes.len());

                        let router = ifc_lite_geometry::GeometryRouter::new();
                        match router.process_element(&entity, &mut decoder) {
                            Ok(mesh) => {
                                println!("  Mesh generated!");
                                println!("    Vertices: {}", mesh.vertex_count());
                                println!("    Triangles: {}", mesh.triangle_count());
                            }
                            Err(e) => {
                                println!("  ERROR processing: {}", e);
                            }
                        }
                    }
                }
            }
        }
    }

    println!("\n\nTotal entities: {}", total_count);
    println!("Wall entities: {}", wall_count);
}
