// Debug test for specific IfcCovering elements with void cutting issues
// GUIDs to test: 12_xLsc_f3OgK3Ufdk0gub, 0xXUNtVmH3rBbVtVjWkLl5

use ifc_lite_core::{EntityDecoder, EntityScanner};
use ifc_lite_geometry::{calculate_normals, GeometryRouter, Mesh};
use rustc_hash::FxHashMap;
use std::fs;

const AR_FILE_PATH: &str = "../../tests/models/local/AR.ifc";

// Target GUIDs for debugging
const TARGET_GUIDS: &[&str] = &[
    "0bI$4rsfj9sPsgvuoSE4Cs", // Wall/covering overlap issue
    "0bI$4rsfj9sPsgvuoSE7Jv", // Wall/covering overlap issue
];

fn load_ar_file() -> Option<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(AR_FILE_PATH);
    println!("Loading from: {:?}", path);
    fs::read_to_string(&path).ok()
}

fn find_entities_by_guids(content: &str, guids: &[&str]) -> FxHashMap<String, u32> {
    let mut result = FxHashMap::default();
    let mut scanner = EntityScanner::new(content);
    let mut decoder = EntityDecoder::new(content);

    while let Some((id, _type_name, start, end)) = scanner.next_entity() {
        if let Ok(entity) = decoder.decode_at_with_id(id, start, end) {
            if let Some(attr) = entity.get(0) {
                if let Some(guid) = attr.as_string() {
                    if guids.contains(&guid) {
                        result.insert(guid.to_string(), id);
                    }
                }
            }
        }
    }
    result
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

    if mesh.is_empty() {
        println!("  ⚠️  EMPTY MESH!");
        return;
    }

    let (min, max) = mesh.bounds();
    println!("  Bounds: ({:.3}, {:.3}, {:.3}) -> ({:.3}, {:.3}, {:.3})",
        min.x, min.y, min.z, max.x, max.y, max.z);

    let size_x = max.x - min.x;
    let size_y = max.y - min.y;
    let size_z = max.z - min.z;
    println!("  Size: ({:.3}, {:.3}, {:.3})", size_x, size_y, size_z);

    // Check for NaN/Inf
    let nan_positions = mesh.positions.iter().filter(|v| !v.is_finite()).count();
    let nan_normals = mesh.normals.iter().filter(|v| !v.is_finite()).count();

    if nan_positions > 0 {
        println!("  ⚠️  {} NaN/Inf position values!", nan_positions);
    }
    if nan_normals > 0 {
        println!("  ⚠️  {} NaN/Inf normal values!", nan_normals);
    }

    // Check for degenerate triangles
    let mut degenerate_count = 0;
    for chunk in mesh.indices.chunks_exact(3) {
        let i0 = chunk[0] as usize;
        let i1 = chunk[1] as usize;
        let i2 = chunk[2] as usize;

        if i0 == i1 || i1 == i2 || i0 == i2 {
            degenerate_count += 1;
        }
    }
    if degenerate_count > 0 {
        println!("  ⚠️  {} degenerate triangles (duplicate indices)!", degenerate_count);
    }

    // Check for thin geometry (potential CSG issues)
    let min_dim = size_x.min(size_y).min(size_z);
    let max_dim = size_x.max(size_y).max(size_z);
    let aspect_ratio = if min_dim > 0.001 { max_dim / min_dim } else { f32::INFINITY };

    if aspect_ratio > 100.0 {
        println!("  ⚠️  Very thin geometry! Aspect ratio: {:.1}", aspect_ratio);
    }

    // Print unique Z values to understand the layers
    let mut z_values: Vec<f32> = Vec::new();
    for i in (0..mesh.positions.len()).step_by(3) {
        let z = mesh.positions[i + 2];
        if !z_values.iter().any(|&v| (v - z).abs() < 0.01) {
            z_values.push(z);
        }
    }
    z_values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("  Unique Z levels: {:?}", z_values);

    // Check normal consistency
    let mut normals_up = 0;
    let mut normals_down = 0;
    let mut normals_side = 0;
    for i in (0..mesh.normals.len()).step_by(3) {
        let nz = mesh.normals[i + 2];
        if nz > 0.9 { normals_up += 1; }
        else if nz < -0.9 { normals_down += 1; }
        else { normals_side += 1; }
    }
    println!("  Normal directions: up={} down={} side={}", normals_up, normals_down, normals_side);

    // Print triangles for debugging
    if mesh.triangle_count() <= 40 {
        println!("  Triangle details:");
        for (i, chunk) in mesh.indices.chunks_exact(3).enumerate() {
            let i0 = chunk[0] as usize * 3;
            let i1 = chunk[1] as usize * 3;
            let i2 = chunk[2] as usize * 3;

            if i0 + 2 < mesh.positions.len() && i1 + 2 < mesh.positions.len() && i2 + 2 < mesh.positions.len() {
                let v0 = (mesh.positions[i0], mesh.positions[i0+1], mesh.positions[i0+2]);
                let v1 = (mesh.positions[i1], mesh.positions[i1+1], mesh.positions[i1+2]);
                let v2 = (mesh.positions[i2], mesh.positions[i2+1], mesh.positions[i2+2]);

                // Check if triangle is coplanar (Z values same)
                let z_range = v0.2.max(v1.2).max(v2.2) - v0.2.min(v1.2).min(v2.2);
                let y_range = v0.1.max(v1.1).max(v2.1) - v0.1.min(v1.1).min(v2.1);
                let x_range = v0.0.max(v1.0).max(v2.0) - v0.0.min(v1.0).min(v2.0);

                let is_xy_plane = z_range < 0.001;
                let is_xz_plane = y_range < 0.001;
                let is_yz_plane = x_range < 0.001;

                let plane = if is_xy_plane { "XY" } else if is_xz_plane { "XZ" } else if is_yz_plane { "YZ" } else { "3D" };

                println!("    Tri[{}]: plane={} z=({:.2},{:.2},{:.2})", i, plane, v0.2, v1.2, v2.2);
            }
        }
    }
}

#[test]
fn debug_covering_voids() {
    let content = match load_ar_file() {
        Some(c) => c,
        None => {
            println!("AR file not found at expected path, skipping test");
            return;
        }
    };

    println!("Loaded AR file ({} bytes)", content.len());

    // Find target entities
    let entity_map = find_entities_by_guids(&content, TARGET_GUIDS);
    println!("\nFound {} of {} target entities:", entity_map.len(), TARGET_GUIDS.len());
    for (guid, id) in &entity_map {
        println!("  {} -> #{}", guid, id);
    }

    if entity_map.is_empty() {
        println!("No target entities found!");
        return;
    }

    // Build void index
    let void_index = build_void_index(&content);
    println!("\nVoid index: {} elements with voids", void_index.len());

    // Create router and decoder
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Process each target entity
    for (guid, &entity_id) in &entity_map {
        println!("\n{}", "=".repeat(60));
        println!("Processing: {} (ID #{})", guid, entity_id);
        println!("{}", "=".repeat(60));

        let entity = match decoder.decode_by_id(entity_id) {
            Ok(e) => e,
            Err(e) => {
                println!("Failed to decode entity: {:?}", e);
                continue;
            }
        };

        println!("Entity type: {}", entity.ifc_type);

        // Check for voids
        let voids = void_index.get(&entity_id).cloned().unwrap_or_default();
        println!("Voids: {} openings - {:?}", voids.len(), voids);

        // Process WITHOUT voids first
        println!("\n--- Processing WITHOUT void subtraction ---");
        match router.process_element(&entity, &mut decoder) {
            Ok(mesh) => analyze_mesh(&mesh, "Original mesh"),
            Err(e) => println!("Error processing element: {:?}", e),
        }

        // Process each opening separately
        if !voids.is_empty() {
            println!("\n--- Analyzing individual openings ---");
            for &opening_id in &voids {
                match decoder.decode_by_id(opening_id) {
                    Ok(opening) => {
                        println!("\nOpening #{} (type: {})", opening_id, opening.ifc_type);
                        match router.process_element(&opening, &mut decoder) {
                            Ok(opening_mesh) => {
                                analyze_mesh(&opening_mesh, &format!("Opening #{}", opening_id));

                                // Check overlap with host element
                                if let Ok(host_mesh) = router.process_element(&entity, &mut decoder) {
                                    let (host_min, host_max) = host_mesh.bounds();
                                    let (open_min, open_max) = opening_mesh.bounds();

                                    let overlaps_x = host_min.x <= open_max.x && host_max.x >= open_min.x;
                                    let overlaps_y = host_min.y <= open_max.y && host_max.y >= open_min.y;
                                    let overlaps_z = host_min.z <= open_max.z && host_max.z >= open_min.z;

                                    if overlaps_x && overlaps_y && overlaps_z {
                                        println!("  ✓ Opening bounds OVERLAP with host");
                                    } else {
                                        println!("  ⚠️  Opening bounds DO NOT OVERLAP with host!");
                                        println!("      Host: ({:.2},{:.2},{:.2}) -> ({:.2},{:.2},{:.2})",
                                            host_min.x, host_min.y, host_min.z,
                                            host_max.x, host_max.y, host_max.z);
                                        println!("      Open: ({:.2},{:.2},{:.2}) -> ({:.2},{:.2},{:.2})",
                                            open_min.x, open_min.y, open_min.z,
                                            open_max.x, open_max.y, open_max.z);
                                    }
                                }
                            }
                            Err(e) => println!("  Error processing opening: {:?}", e),
                        }
                    }
                    Err(e) => println!("  Error decoding opening #{}: {:?}", opening_id, e),
                }
            }
        }

        // Process WITH voids
        println!("\n--- Processing WITH void subtraction ---");
        match router.process_element_with_voids(&entity, &mut decoder, &void_index) {
            Ok(mesh) => {
                analyze_mesh(&mesh, "After void subtraction");

                // Calculate normals if needed
                let mut mesh_copy = mesh.clone();
                if mesh_copy.normals.len() != mesh_copy.positions.len() {
                    println!("\nRecalculating normals...");
                    calculate_normals(&mut mesh_copy);
                    analyze_mesh(&mesh_copy, "After recalculating normals");
                }
            }
            Err(e) => println!("Error processing with voids: {:?}", e),
        }
    }
}

#[test]
fn debug_single_covering() {
    let content = match load_ar_file() {
        Some(c) => c,
        None => {
            println!("AR file not found, skipping test");
            return;
        }
    };

    // Just test one specific GUID - wall/covering overlap issue
    let target_guid = "0bI$4rsfj9sPsgvuoSE4Cs"; // Covering

    let entity_map = find_entities_by_guids(&content, &[target_guid]);
    let entity_id = match entity_map.get(target_guid) {
        Some(&id) => id,
        None => {
            println!("Entity {} not found", target_guid);
            return;
        }
    };

    println!("Testing: {} (ID #{})", target_guid, entity_id);

    let void_index = build_void_index(&content);
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    let entity = decoder.decode_by_id(entity_id).expect("Failed to decode");
    println!("Type: {}", entity.ifc_type);

    let voids = void_index.get(&entity_id).cloned().unwrap_or_default();
    println!("Has {} voids: {:?}", voids.len(), voids);

    // Original mesh
    let original = router.process_element(&entity, &mut decoder).expect("Failed to process");
    println!("\nOriginal: {} verts, {} tris", original.vertex_count(), original.triangle_count());
    analyze_mesh(&original, "Original covering");

    // Get opening mesh
    if let Some(&opening_id) = voids.first() {
        let opening = decoder.decode_by_id(opening_id).expect("Failed to decode opening");
        let opening_mesh = router.process_element(&opening, &mut decoder).expect("Failed to process opening");
        analyze_mesh(&opening_mesh, "Opening");

        // Manually do CSG subtraction
        use ifc_lite_geometry::csg::ClippingProcessor;
        let clipper = ClippingProcessor::new();

        println!("\n--- Manual CSG Step ---");
        match clipper.subtract_mesh(&original, &opening_mesh) {
            Ok(result) => {
                analyze_mesh(&result, "CSG result (raw)");
                let has_nan = result.positions.iter().any(|v| !v.is_finite());
                println!("  CSG result valid: empty={} tris={} nan={}", result.is_empty(), result.triangle_count(), has_nan);

                // Test Z-level snapping
                let reference_z_levels = original.unique_z_levels(0.01);
                println!("\n  Reference Z levels from original: {:?}", reference_z_levels);

                let mut snapped = result.clone();
                snapped.snap_z_to_levels(&reference_z_levels, 0.05);
                analyze_mesh(&snapped, "CSG result (snapped)");
            }
            Err(e) => {
                println!("  CSG error: {:?}", e);
            }
        }
    }

    // With voids
    let with_voids = router.process_element_with_voids(&entity, &mut decoder, &void_index)
        .expect("Failed to process with voids");
    println!("\nWith voids: {} verts, {} tris", with_voids.vertex_count(), with_voids.triangle_count());
    analyze_mesh(&with_voids, "After process_element_with_voids");

    // Compare
    if with_voids.vertex_count() != original.vertex_count() {
        println!("\n⚠️  Vertex count changed: {} -> {}", original.vertex_count(), with_voids.vertex_count());
    }

    // Check for issues
    let nan_count = with_voids.positions.iter().filter(|v| !v.is_finite()).count();
    if nan_count > 0 {
        println!("⚠️  {} NaN values in result!", nan_count);
    }
}
