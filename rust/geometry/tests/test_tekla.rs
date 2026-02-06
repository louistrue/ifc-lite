// Test processing TeklaHouse model - verifies stack overflow fix
use std::fs;

#[test]
fn test_tekla_single_entity_1991() {
    let content = match fs::read_to_string("tests/TeklaHouse.ifc") {
        Ok(c) => c,
        Err(_) => {
            println!("TeklaHouse.ifc not found in tests dir, skipping");
            return;
        }
    };

    let entity_index = ifc_lite_core::build_entity_index(&content);
    let mut decoder = ifc_lite_core::EntityDecoder::with_index(&content, entity_index);
    let router = ifc_lite_geometry::GeometryRouter::with_units(&content, &mut decoder);

    // Process just entity #1991 (IFCWALL that previously caused stack overflow)
    let mut scanner = ifc_lite_core::EntityScanner::new(&content);
    while let Some((id, _type_name, start, end)) = scanner.next_entity() {
        if id == 1991 {
            let entity = decoder.decode_at_with_id(id, start, end).expect("decode failed");
            match router.process_element(&entity, &mut decoder) {
                Ok(mesh) => {
                    eprintln!("SUCCESS: {} vertices, {} triangles", mesh.vertex_count(), mesh.triangle_count());
                    // Should produce geometry (even if CSG is skipped, the base extruded solid is returned)
                    assert!(mesh.vertex_count() > 0, "Entity #1991 should produce geometry");
                }
                Err(e) => {
                    // Processing errors are acceptable (e.g., depth limit)
                    // as long as we don't crash with stack overflow
                    eprintln!("Error (not a crash): {}", e);
                }
            }
            return;
        }
    }
}

#[test]
fn test_tekla_full_model_no_crash() {
    let content = match fs::read_to_string("tests/TeklaHouse.ifc") {
        Ok(c) => c,
        Err(_) => {
            println!("TeklaHouse.ifc not found in tests dir, skipping");
            return;
        }
    };

    let entity_index = ifc_lite_core::build_entity_index(&content);
    let mut decoder = ifc_lite_core::EntityDecoder::with_index(&content, entity_index);
    let router = ifc_lite_geometry::GeometryRouter::with_units(&content, &mut decoder);

    let mut scanner = ifc_lite_core::EntityScanner::new(&content);
    let empty_voids: rustc_hash::FxHashMap<u32, Vec<u32>> = rustc_hash::FxHashMap::default();
    let mut total = 0;
    let mut success = 0;
    let mut failed = 0;

    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        if !ifc_lite_core::has_geometry_by_name(type_name) {
            continue;
        }
        total += 1;

        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
            let has_rep = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
            if !has_rep {
                continue;
            }

            match router.process_element_with_voids(&entity, &mut decoder, &empty_voids) {
                Ok(mesh) => {
                    if !mesh.is_empty() { success += 1; }
                }
                Err(_) => { failed += 1; }
            }
        }
    }

    eprintln!("\nTotal: {}, Success: {}, Failed: {}", total, success, failed);
    // Should process most entities successfully
    assert!(success > 0, "Should have processed some entities successfully");
    // The key assertion: we didn't crash with stack overflow
}
