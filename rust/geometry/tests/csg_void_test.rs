// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

use ifc_lite_core::{EntityDecoder, EntityScanner};
use ifc_lite_geometry::{GeometryRouter, Mesh};
use rustc_hash::FxHashMap;
use std::fs;
use std::path::PathBuf;

fn get_test_file_path() -> PathBuf {
    // Use CARGO_MANIFEST_DIR for deterministic path resolution
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let test_file = PathBuf::from(manifest_dir)
        .join("tests")
        .join("ifc")
        .join("02_BIMcollab_Example_STR_random_C_ebkp.ifc");

    if !test_file.exists() {
        panic!(
            "Test IFC file not found at: {}. Ensure the test file exists in the geometry/tests/ifc directory.",
            test_file.display()
        );
    }

    test_file
}

fn analyze_mesh(mesh: &Mesh, name: &str) {
    let (min, max) = mesh.bounds();
    let volume = (max.x - min.x) * (max.y - min.y) * (max.z - min.z);

    println!("\n=== {} Mesh Analysis ===", name);
    println!("  Triangles: {}", mesh.triangle_count());
    println!("  Vertices: {}", mesh.vertex_count());
    println!(
        "  Positions: {} (len={})",
        mesh.positions.len() / 3,
        mesh.positions.len()
    );
    println!(
        "  Normals: {} (len={})",
        mesh.normals.len() / 3,
        mesh.normals.len()
    );
    println!("  Indices: {}", mesh.indices.len());
    println!(
        "  Bounds: min=({:.2}, {:.2}, {:.2}), max=({:.2}, {:.2}, {:.2})",
        min.x, min.y, min.z, max.x, max.y, max.z
    );
    println!("  Volume: {:.2}", volume);

    // Check for degenerate triangles
    let mut degenerate_count = 0;
    for i in (0..mesh.indices.len()).step_by(3) {
        if i + 2 >= mesh.indices.len() {
            break;
        }
        let i0 = mesh.indices[i] as usize;
        let i1 = mesh.indices[i + 1] as usize;
        let i2 = mesh.indices[i + 2] as usize;

        if i0 * 3 + 2 >= mesh.positions.len()
            || i1 * 3 + 2 >= mesh.positions.len()
            || i2 * 3 + 2 >= mesh.positions.len()
        {
            degenerate_count += 1;
            continue;
        }

        let v0 = nalgebra::Point3::new(
            mesh.positions[i0 * 3] as f64,
            mesh.positions[i0 * 3 + 1] as f64,
            mesh.positions[i0 * 3 + 2] as f64,
        );
        let v1 = nalgebra::Point3::new(
            mesh.positions[i1 * 3] as f64,
            mesh.positions[i1 * 3 + 1] as f64,
            mesh.positions[i1 * 3 + 2] as f64,
        );
        let v2 = nalgebra::Point3::new(
            mesh.positions[i2 * 3] as f64,
            mesh.positions[i2 * 3 + 1] as f64,
            mesh.positions[i2 * 3 + 2] as f64,
        );

        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let area = edge1.cross(&edge2).norm() / 2.0;
        if area < 1e-6 {
            degenerate_count += 1;
        }
    }
    println!("  Degenerate triangles: {}", degenerate_count);

    // Check for invalid values
    let has_nan = mesh.positions.iter().any(|&v| !v.is_finite())
        || mesh.normals.iter().any(|&v| !v.is_finite());
    println!("  Has NaN/Inf: {}", has_nan);
}

fn process_element_with_diagnostics(
    router: &GeometryRouter,
    decoder: &mut EntityDecoder,
    content: &str,
    void_index: &FxHashMap<u32, Vec<u32>>,
    element_id: u32,
    element_name: &str,
) -> Result<Mesh, Box<dyn std::error::Error>> {
    println!("\n\n{}", "=".repeat(80));
    println!("PROCESSING ELEMENT #{}: {}", element_id, element_name);
    println!("{}", "=".repeat(80));

    // Find element
    let mut scanner = EntityScanner::new(content);
    let mut element_entity = None;
    while let Some((id, type_name, start, end)) = scanner.next_entity() {
        if id == element_id {
            element_entity = Some(decoder.decode_at(start, end)?);
            println!("Found element #{}: type={}", id, type_name);
            break;
        }
    }

    let entity = element_entity.ok_or_else(|| format!("Element #{} not found", element_id))?;

    // Get base mesh
    let base_mesh = router.process_element(&entity, decoder)?;
    analyze_mesh(&base_mesh, "Base Mesh");

    // Check for openings
    let opening_ids = void_index.get(&element_id);
    if opening_ids.is_none() || opening_ids.unwrap().is_empty() {
        println!("\nNo openings found for element #{}", element_id);
        return Ok(base_mesh);
    }

    let opening_ids = opening_ids.unwrap();
    println!(
        "\nFound {} opening(s) for element #{}",
        opening_ids.len(),
        element_id
    );

    // Process each opening
    let mut combined_openings = Mesh::new();
    for (idx, &opening_id) in opening_ids.iter().enumerate() {
        println!(
            "\n--- Processing Opening #{} (ID: {}) ---",
            idx + 1,
            opening_id
        );

        // Find opening entity
        scanner = EntityScanner::new(content);
        let mut opening_entity = None;
        while let Some((id, type_name, start, end)) = scanner.next_entity() {
            if id == opening_id {
                opening_entity = Some(decoder.decode_at(start, end)?);
                println!("Found opening #{}: type={}", id, type_name);
                break;
            }
        }

        if let Some(opening) = opening_entity {
            match router.process_element(&opening, decoder) {
                Ok(opening_mesh) => {
                    analyze_mesh(&opening_mesh, &format!("Opening #{}", idx + 1));

                    // Check bounds relationship
                    let (host_min, host_max) = base_mesh.bounds();
                    let (open_min, open_max) = opening_mesh.bounds();

                    println!("\n  Bounds Comparison:");
                    println!(
                        "    Host: ({:.2},{:.2},{:.2}) to ({:.2},{:.2},{:.2})",
                        host_min.x, host_min.y, host_min.z, host_max.x, host_max.y, host_max.z
                    );
                    println!(
                        "    Opening: ({:.2},{:.2},{:.2}) to ({:.2},{:.2},{:.2})",
                        open_min.x, open_min.y, open_min.z, open_max.x, open_max.y, open_max.z
                    );

                    let overlap_x = open_min.x < host_max.x && open_max.x > host_min.x;
                    let overlap_y = open_min.y < host_max.y && open_max.y > host_min.y;
                    let overlap_z = open_min.z < host_max.z && open_max.z > host_min.z;
                    println!(
                        "    Overlaps: X={}, Y={}, Z={}",
                        overlap_x, overlap_y, overlap_z
                    );

                    combined_openings.merge(&opening_mesh);
                }
                Err(e) => {
                    println!("  ERROR processing opening: {}", e);
                }
            }
        } else {
            println!("  Opening #{} not found!", opening_id);
        }
    }

    if combined_openings.is_empty() {
        println!("\nNo valid opening geometry, returning base mesh");
        return Ok(base_mesh);
    }

    analyze_mesh(&combined_openings, "Combined Openings");

    // Perform CSG subtraction
    println!("\n--- Performing CSG Subtraction ---");
    use ifc_lite_geometry::csg::ClippingProcessor;
    let clipper = ClippingProcessor::new();

    let original_tri_count = base_mesh.triangle_count();
    match clipper.subtract_mesh(&base_mesh, &combined_openings) {
        Ok(result_mesh) => {
            let new_tri_count = result_mesh.triangle_count();
            analyze_mesh(&result_mesh, "CSG Result");

            println!("\n  CSG Comparison:");
            println!(
                "    Triangle count: {} -> {} (delta: {:+})",
                original_tri_count,
                new_tri_count,
                new_tri_count as i32 - original_tri_count as i32
            );

            let (orig_min, orig_max) = base_mesh.bounds();
            let (new_min, new_max) = result_mesh.bounds();
            let orig_vol =
                (orig_max.x - orig_min.x) * (orig_max.y - orig_min.y) * (orig_max.z - orig_min.z);
            let new_vol =
                (new_max.x - new_min.x) * (new_max.y - new_min.y) * (new_max.z - new_min.z);
            let vol_ratio = if orig_vol > 0.0 {
                new_vol / orig_vol
            } else {
                0.0
            };

            println!(
                "    Volume: {:.2} -> {:.2} (ratio: {:.3})",
                orig_vol, new_vol, vol_ratio
            );

            // Validation checks
            let min_expected = original_tri_count / 3;
            let tri_ok = new_tri_count > 0 && new_tri_count >= min_expected;
            let vol_ok = vol_ratio > 0.3 && vol_ratio < 1.1;
            let has_valid_positions = result_mesh.positions.iter().all(|&v| v.is_finite());
            let has_valid_normals = result_mesh.normals.iter().all(|&v| v.is_finite());

            println!("\n  Validation:");
            println!(
                "    Triangle check: {} (min_expected={})",
                tri_ok, min_expected
            );
            println!("    Volume check: {} (ratio={:.3})", vol_ok, vol_ratio);
            println!("    Valid positions: {}", has_valid_positions);
            println!("    Valid normals: {}", has_valid_normals);

            if tri_ok && vol_ok && has_valid_positions && has_valid_normals {
                println!("\n  ✓ CSG result VALID");
                Ok(result_mesh)
            } else {
                println!("\n  ✗ CSG result INVALID - using base mesh");
                Ok(base_mesh)
            }
        }
        Err(e) => {
            println!("\n  ✗ CSG subtraction FAILED: {}", e);
            println!("  Using base mesh");
            Ok(base_mesh)
        }
    }
}

#[test]
fn test_void_subtraction_element_276() {
    let file_path = get_test_file_path();
    let content = fs::read_to_string(&file_path).expect("Failed to read IFC file");

    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Build void index
    let mut void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut scanner = EntityScanner::new(&content);
    while let Some((_id, type_name, start, end)) = scanner.next_entity() {
        if type_name == "IFCRELVOIDSELEMENT" {
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let (Some(host_id), Some(opening_id)) = (entity.get_ref(4), entity.get_ref(5)) {
                    void_index.entry(host_id).or_default().push(opening_id);
                }
            }
        }
    }

    println!("Void index built: {} hosts with voids", void_index.len());
    if let Some(openings) = void_index.get(&276) {
        println!(
            "Element 276 has {} opening(s): {:?}",
            openings.len(),
            openings
        );
    }

    match process_element_with_diagnostics(
        &router,
        &mut decoder,
        &content,
        &void_index,
        276,
        "Problematic Slab",
    ) {
        Ok(mesh) => {
            println!(
                "\n\nFinal mesh: {} triangles, {} vertices",
                mesh.triangle_count(),
                mesh.vertex_count()
            );
            assert!(!mesh.is_empty(), "Mesh should not be empty");
        }
        Err(e) => {
            panic!("Test failed: {}", e);
        }
    }
}

#[test]
fn test_void_subtraction_working_element() {
    let file_path = get_test_file_path();
    let content = fs::read_to_string(&file_path).expect("Failed to read IFC file");

    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Build void index
    let mut void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut scanner = EntityScanner::new(&content);
    while let Some((_id, type_name, start, end)) = scanner.next_entity() {
        if type_name == "IFCRELVOIDSELEMENT" {
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let (Some(host_id), Some(opening_id)) = (entity.get_ref(4), entity.get_ref(5)) {
                    void_index.entry(host_id).or_default().push(opening_id);
                }
            }
        }
    }

    // Find a known-good element with voids (not 276)
    let mut good_element_id = None;
    for (host_id, openings) in &void_index {
        if *host_id != 276 && !openings.is_empty() {
            good_element_id = Some(*host_id);
            break;
        }
    }

    let element_id = good_element_id.expect("No other element with voids found");
    println!("Testing known-good element #{}", element_id);

    // Process with voids
    let mesh_with_voids = process_element_with_diagnostics(
        &router,
        &mut decoder,
        &content,
        &void_index,
        element_id,
        "With Voids",
    )
    .expect("Failed to process element with voids");

    // Process without voids (empty void index)
    let empty_void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut decoder_no_voids = EntityDecoder::new(&content);
    let mesh_without_voids = process_element_with_diagnostics(
        &router,
        &mut decoder_no_voids,
        &content,
        &empty_void_index,
        element_id,
        "Without Voids",
    )
    .expect("Failed to process element without voids");

    println!(
        "\n\n=== Void Subtraction Comparison for Element #{} ===",
        element_id
    );
    println!(
        "  With voids: {} triangles, {} vertices",
        mesh_with_voids.triangle_count(),
        mesh_with_voids.vertex_count()
    );
    println!(
        "  Without voids: {} triangles, {} vertices",
        mesh_without_voids.triangle_count(),
        mesh_without_voids.vertex_count()
    );

    // Basic assertions
    assert!(!mesh_with_voids.is_empty(), "Mesh with voids should not be empty");
    assert!(
        !mesh_without_voids.is_empty(),
        "Mesh without voids should not be empty"
    );

    // Stronger assertion: the mesh with voids should have different geometry
    // than the mesh without voids (either fewer triangles or different bounding volume)
    let (with_min, with_max) = mesh_with_voids.bounds();
    let (without_min, without_max) = mesh_without_voids.bounds();

    let with_volume =
        (with_max.x - with_min.x) * (with_max.y - with_min.y) * (with_max.z - with_min.z);
    let without_volume = (without_max.x - without_min.x)
        * (without_max.y - without_min.y)
        * (without_max.z - without_min.z);

    println!("  With voids volume: {:.4}", with_volume);
    println!("  Without voids volume: {:.4}", without_volume);

    // The mesh with voids should have different triangle count or bounding volume
    // Note: Due to CSG operations, the mesh with voids might actually have MORE triangles
    // (because cuts create new triangles), but it should still be different
    let triangles_differ = mesh_with_voids.triangle_count() != mesh_without_voids.triangle_count();
    let volume_differs = (with_volume - without_volume).abs() > 1e-6;

    assert!(
        triangles_differ || volume_differs,
        "Opening subtraction should change the mesh geometry: triangles {} vs {}, volume {:.4} vs {:.4}",
        mesh_with_voids.triangle_count(),
        mesh_without_voids.triangle_count(),
        with_volume,
        without_volume
    );
}

#[test]
#[ignore] // Diagnostic-only test with heavy IO/processing - no assertions
fn compare_void_geometries() {
    let file_path = get_test_file_path();
    let content = fs::read_to_string(&file_path).expect("Failed to read IFC file");

    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Build void index
    let mut void_index: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut scanner = EntityScanner::new(&content);
    while let Some((_id, type_name, start, end)) = scanner.next_entity() {
        if type_name == "IFCRELVOIDSELEMENT" {
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let (Some(host_id), Some(opening_id)) = (entity.get_ref(4), entity.get_ref(5)) {
                    void_index.entry(host_id).or_default().push(opening_id);
                }
            }
        }
    }

    println!("\n\n{}", "=".repeat(80));
    println!("COMPARISON: Element 276 vs Known-Good Element");
    println!("{}", "=".repeat(80));

    // Process both
    let mut decoder_276 = EntityDecoder::new(&content);
    let mesh_276 = process_element_with_diagnostics(
        &router,
        &mut decoder_276,
        &content,
        &void_index,
        276,
        "Element 276",
    )
    .expect("Failed to process element 276");

    let mut decoder_good = EntityDecoder::new(&content);
    let good_element_id = void_index
        .iter()
        .find(|(id, _)| **id != 276)
        .map(|(id, _)| *id)
        .expect("No other element found");
    let mesh_good = process_element_with_diagnostics(
        &router,
        &mut decoder_good,
        &content,
        &void_index,
        good_element_id,
        "Known-Good",
    )
    .expect("Failed to process good element");

    println!("\n\n{}", "=".repeat(80));
    println!("SIDE-BY-SIDE COMPARISON");
    println!("{}", "=".repeat(80));
    println!(
        "Element 276: {} tris, {} verts",
        mesh_276.triangle_count(),
        mesh_276.vertex_count()
    );
    println!(
        "Element {}: {} tris, {} verts",
        good_element_id,
        mesh_good.triangle_count(),
        mesh_good.vertex_count()
    );
}
