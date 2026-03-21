// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Targeted tests for TUN32-BT2-ARK - forenklet.ifc issues:
//!
//! 1. Walls with >15 openings skip void subtraction entirely (MAX_OPENINGS limit)
//!    - 0ycIJ0$svFNhcUxd15TBw6 (24 openings)
//!    - 3Mxle6JBD0e9DsWGVQeWA0 (24 openings)
//!    - 3DQhs$XHvC7OZaFW8oR2td (18 openings)
//!
//! 2. IfcBuildingElementPart "Stål" elements producing rotated box artifacts
//!    - 30lL2q3qNy33GqoFOAIrdp (child of IfcRailing)
//!    - 3D7cyLEWBizmqgr0qPe8ew (child of IfcRailing)

use ifc_lite_core::{EntityDecoder, EntityScanner};
use ifc_lite_geometry::{calculate_normals, GeometryRouter, Mesh};
use rustc_hash::FxHashMap;
use std::fs;

const FILE_PATH: &str = "../../tests/models/local/TUN32-BT2-ARK - forenklet.ifc";

// Walls with windows not cut out
const WALL_GUID_1: &str = "0ycIJ0$svFNhcUxd15TBw6"; // 24 openings
const WALL_GUID_2: &str = "3Mxle6JBD0e9DsWGVQeWA0"; // 24 openings
const WALL_GUID_3: &str = "3DQhs$XHvC7OZaFW8oR2td"; // 18 openings

// Artifact elements (IfcBuildingElementPart from IfcRailing)
const ARTIFACT_GUID_1: &str = "30lL2q3qNy33GqoFOAIrdp";
const ARTIFACT_GUID_2: &str = "3D7cyLEWBizmqgr0qPe8ew";

fn load_file() -> Option<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FILE_PATH);
    fs::read_to_string(&path).ok()
}

fn find_entity_by_guid(content: &str, guid: &str) -> Option<u32> {
    let mut scanner = EntityScanner::new(content);
    let mut decoder = EntityDecoder::new(content);

    while let Some((id, _type_name, start, end)) = scanner.next_entity() {
        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
            if let Some(attr) = entity.get(0) {
                if let Some(entity_guid) = attr.as_string() {
                    if entity_guid == guid {
                        return Some(id);
                    }
                }
            }
        }
    }
    None
}

fn build_void_index(content: &str) -> FxHashMap<u32, Vec<u32>> {
    let mut void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);
    let mut decoder = EntityDecoder::new(content);

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        if type_name == "IFCRELVOIDSELEMENT" {
            if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
                if let (Some(host_id), Some(opening_id)) = (entity.get_ref(4), entity.get_ref(5)) {
                    void_index.entry(host_id).or_default().push(opening_id);
                }
            }
        }
    }
    void_index
}

fn analyze_mesh(mesh: &Mesh, name: &str) {
    println!("\n=== {} ===", name);
    println!("  Vertices: {}", mesh.vertex_count());
    println!("  Triangles: {}", mesh.triangle_count());

    if !mesh.is_empty() {
        let (min, max) = mesh.bounds();
        let size_x = max.x - min.x;
        let size_y = max.y - min.y;
        let size_z = max.z - min.z;
        println!(
            "  Bounds: min({:.2}, {:.2}, {:.2}) max({:.2}, {:.2}, {:.2})",
            min.x, min.y, min.z, max.x, max.y, max.z
        );
        println!("  Size: ({:.2}, {:.2}, {:.2})", size_x, size_y, size_z);

        // Check for NaN/Inf
        let non_finite = mesh.positions.iter().filter(|v| !v.is_finite()).count();
        if non_finite > 0 {
            println!("  WARNING: {} non-finite position values!", non_finite);
        }
    }
}

// ============================================================================
// Issue 1: Walls with many openings skip void subtraction
// ============================================================================

#[test]
fn test_wall_opening_count_exceeds_max() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("TUN32-BT2-ARK file not found at {}, skipping test", FILE_PATH);
            return;
        }
    };

    let void_index = build_void_index(&content);

    // Check all three walls exceed the current MAX_OPENINGS=15 limit
    for (guid, expected_min) in [
        (WALL_GUID_1, 18),
        (WALL_GUID_2, 18),
        (WALL_GUID_3, 16),
    ] {
        let wall_id = find_entity_by_guid(&content, guid)
            .unwrap_or_else(|| panic!("Wall {} not found", guid));

        let opening_count = void_index
            .get(&wall_id)
            .map(|v| v.len())
            .unwrap_or(0);

        println!("Wall {} (#{}) has {} openings", guid, wall_id, opening_count);
        assert!(
            opening_count >= expected_min,
            "Wall {} should have >= {} openings, got {}",
            guid, expected_min, opening_count
        );

        // This is the bug: MAX_OPENINGS=15 causes these walls to skip void subtraction
        assert!(
            opening_count > 15,
            "Wall {} has {} openings, exceeding MAX_OPENINGS=15 limit",
            guid, opening_count
        );
    }
}

#[test]
fn test_wall_void_subtraction_with_many_openings() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("TUN32-BT2-ARK file not found, skipping test");
            return;
        }
    };

    let void_index = build_void_index(&content);
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    let wall_id = match find_entity_by_guid(&content, WALL_GUID_1) {
        Some(id) => id,
        None => {
            println!("Wall not found, skipping");
            return;
        }
    };

    let opening_ids = void_index.get(&wall_id).cloned().unwrap_or_default();
    println!("Wall #{} has {} openings", wall_id, opening_ids.len());

    let wall = decoder.decode_by_id(wall_id).expect("Failed to decode wall");

    // Process wall WITHOUT voids
    let wall_mesh_no_voids = router
        .process_element(&wall, &mut decoder)
        .expect("Failed to process wall");
    analyze_mesh(&wall_mesh_no_voids, "Wall (no voids)");

    // Process wall WITH voids
    let wall_mesh_with_voids = router
        .process_element_with_voids(&wall, &mut decoder, &void_index)
        .expect("Failed to process wall with voids");
    analyze_mesh(&wall_mesh_with_voids, "Wall (with voids)");

    // The key test: void subtraction should actually reduce geometry
    // (i.e., openings should be cut out, resulting in fewer triangles)
    let no_void_tris = wall_mesh_no_voids.triangle_count();
    let with_void_tris = wall_mesh_with_voids.triangle_count();

    println!(
        "\nTriangles without voids: {}, with voids: {}",
        no_void_tris, with_void_tris
    );

    // If void subtraction was skipped (due to MAX_OPENINGS), the meshes will be identical.
    // This assertion catches that bug.
    assert_ne!(
        no_void_tris, with_void_tris,
        "Wall mesh should differ after void subtraction - voids were NOT cut out! \
         This wall has {} openings which exceeds MAX_OPENINGS=15, causing void subtraction to be skipped entirely.",
        opening_ids.len()
    );
}

#[test]
fn test_all_three_walls_get_voids_cut() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("TUN32-BT2-ARK file not found, skipping test");
            return;
        }
    };

    let void_index = build_void_index(&content);
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    for guid in [WALL_GUID_1, WALL_GUID_2, WALL_GUID_3] {
        let wall_id = match find_entity_by_guid(&content, guid) {
            Some(id) => id,
            None => {
                println!("Wall {} not found, skipping", guid);
                continue;
            }
        };

        let wall = decoder.decode_by_id(wall_id).expect("Failed to decode wall");
        let opening_count = void_index.get(&wall_id).map(|v| v.len()).unwrap_or(0);

        // Process without and with voids
        let mesh_no_voids = router.process_element(&wall, &mut decoder)
            .expect("Failed to process wall");
        let mesh_with_voids = router.process_element_with_voids(&wall, &mut decoder, &void_index)
            .expect("Failed to process wall with voids");

        let no_void_tris = mesh_no_voids.triangle_count();
        let with_void_tris = mesh_with_voids.triangle_count();

        println!(
            "Wall {} (#{}, {} openings): tris {} → {}",
            guid, wall_id, opening_count, no_void_tris, with_void_tris
        );

        assert_ne!(
            no_void_tris, with_void_tris,
            "Wall {} ({} openings): void subtraction was skipped!",
            guid, opening_count
        );
    }
}

#[test]
fn test_classify_openings_for_wall_with_many_openings() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("TUN32-BT2-ARK file not found, skipping test");
            return;
        }
    };

    let void_index = build_void_index(&content);
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    let wall_id = match find_entity_by_guid(&content, WALL_GUID_1) {
        Some(id) => id,
        None => {
            println!("Wall not found, skipping");
            return;
        }
    };

    let opening_ids = void_index.get(&wall_id).cloned().unwrap_or_default();
    println!("Classifying {} openings for wall #{}", opening_ids.len(), wall_id);

    // Process each opening individually to understand their types
    for &opening_id in opening_ids.iter() {
        let opening = match decoder.decode_by_id(opening_id) {
            Ok(e) => e,
            Err(_) => continue,
        };

        match router.process_element(&opening, &mut decoder) {
            Ok(mesh) if !mesh.is_empty() => {
                let (min, max) = mesh.bounds();
                let vertex_count = mesh.positions.len() / 3;
                println!(
                    "  Opening #{}: {} vertices, bounds ({:.2},{:.2},{:.2})-({:.2},{:.2},{:.2})",
                    opening_id, vertex_count, min.x, min.y, min.z, max.x, max.y, max.z
                );
            }
            Ok(_) => println!("  Opening #{}: empty mesh", opening_id),
            Err(e) => println!("  Opening #{}: failed - {}", opening_id, e),
        }
    }
}

// ============================================================================
// Issue 2: IfcBuildingElementPart "Stål" rotated box artifacts
// ============================================================================

#[test]
fn test_artifact_element_geometry() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("TUN32-BT2-ARK file not found, skipping test");
            return;
        }
    };

    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Detect RTC offset like the WASM layer does
    let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
    println!("RTC offset: ({:.2}, {:.2}, {:.2})", rtc_offset.0, rtc_offset.1, rtc_offset.2);

    for guid in [ARTIFACT_GUID_1, ARTIFACT_GUID_2] {
        let elem_id = match find_entity_by_guid(&content, guid) {
            Some(id) => id,
            None => {
                println!("Element {} not found, skipping", guid);
                continue;
            }
        };

        let entity = decoder.decode_by_id(elem_id).expect("Failed to decode element");
        println!("\nElement {} (#{}):", guid, elem_id);
        println!("  Type: {}", entity.ifc_type.name());

        match router.process_element(&entity, &mut decoder) {
            Ok(mut mesh) => {
                if mesh.normals.len() != mesh.positions.len() {
                    calculate_normals(&mut mesh);
                }
                analyze_mesh(&mesh, &format!("{} mesh", guid));

                // Check for reasonable dimensions
                if !mesh.is_empty() {
                    let (min, max) = mesh.bounds();
                    let size_x = max.x - min.x;
                    let size_y = max.y - min.y;
                    let size_z = max.z - min.z;

                    // A railing part should have reasonable dimensions
                    // Check for very small dimensions that might indicate collapsed geometry
                    let min_dim = size_x.min(size_y).min(size_z);
                    let max_dim = size_x.max(size_y).max(size_z);

                    println!("  Min dim: {:.4}m, Max dim: {:.4}m, ratio: {:.1}", min_dim, max_dim, max_dim / min_dim.max(0.001));

                    // Check if the mesh center is reasonable (near origin after RTC)
                    let center_x = (min.x + max.x) / 2.0;
                    let center_y = (min.y + max.y) / 2.0;
                    let center_z = (min.z + max.z) / 2.0;
                    println!("  Center: ({:.2}, {:.2}, {:.2})", center_x, center_y, center_z);

                    // Check if mesh coordinates are unreasonable (suggesting transform issue)
                    let max_coord = mesh.positions.iter()
                        .map(|v| v.abs())
                        .fold(0.0f32, f32::max);
                    println!("  Max absolute coordinate: {:.2}m", max_coord);

                    // In a well-processed model with RTC offset, coordinates should be < ~500m from origin
                    if max_coord > 5000.0 {
                        println!("  WARNING: Coordinates very far from origin - possible transform issue");
                    }
                }
            }
            Err(e) => {
                println!("  Failed to process: {}", e);
            }
        }
    }
}

#[test]
fn test_artifact_placement_via_mesh_comparison() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("TUN32-BT2-ARK file not found, skipping test");
            return;
        }
    };

    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Also test with RTC offset applied (like WASM layer does)
    let rtc_offset = router.detect_rtc_offset_from_first_element(&content, &mut decoder);
    println!("RTC offset: ({:.2}, {:.2}, {:.2})", rtc_offset.0, rtc_offset.1, rtc_offset.2);

    let needs_shift = rtc_offset.0.abs() > 10000.0
        || rtc_offset.1.abs() > 10000.0
        || rtc_offset.2.abs() > 10000.0;

    // Create a second router with RTC offset for comparison
    let mut router_rtc = GeometryRouter::with_units(&content, &mut decoder);
    if needs_shift {
        router_rtc.set_rtc_offset(rtc_offset);
    }

    for guid in [ARTIFACT_GUID_1, ARTIFACT_GUID_2] {
        let elem_id = match find_entity_by_guid(&content, guid) {
            Some(id) => id,
            None => {
                println!("Element {} not found, skipping", guid);
                continue;
            }
        };

        let entity = decoder.decode_by_id(elem_id).expect("Failed to decode element");

        // Process without RTC
        let mesh_no_rtc = router.process_element(&entity, &mut decoder)
            .expect("Failed to process without RTC");
        analyze_mesh(&mesh_no_rtc, &format!("{} (no RTC)", guid));

        // Process with RTC
        let mesh_with_rtc = router_rtc.process_element(&entity, &mut decoder)
            .expect("Failed to process with RTC");
        analyze_mesh(&mesh_with_rtc, &format!("{} (with RTC)", guid));
    }
}
