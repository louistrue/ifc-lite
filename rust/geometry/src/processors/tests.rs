// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Tests for geometry processors.

use super::*;
use crate::router::GeometryProcessor;
use ifc_lite_core::{EntityDecoder, IfcSchema, IfcType};

#[test]
fn test_advanced_brep_file() {
    use crate::router::GeometryRouter;

    // Read the actual advanced_brep.ifc file
    let content =
        std::fs::read_to_string("../../tests/models/ifcopenshell/advanced_brep.ifc")
            .expect("Failed to read test file");

    let entity_index = ifc_lite_core::build_entity_index(&content);
    let mut decoder = EntityDecoder::with_index(&content, entity_index);
    let router = GeometryRouter::new();

    // Process IFCBUILDINGELEMENTPROXY #181 which contains the AdvancedBrep geometry
    let element = decoder.decode_by_id(181).expect("Failed to decode element");
    assert_eq!(element.ifc_type, IfcType::IfcBuildingElementProxy);

    let mesh = router
        .process_element(&element, &mut decoder)
        .expect("Failed to process advanced brep");

    // Should produce geometry (B-spline surfaces tessellated)
    assert!(!mesh.is_empty(), "AdvancedBrep should produce geometry");
    assert!(
        mesh.positions.len() >= 3 * 100,
        "Should have significant geometry"
    );
    assert!(mesh.indices.len() >= 3 * 100, "Should have many triangles");
}

#[test]
fn test_extruded_area_solid() {
    let content = r#"
#1=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,100.0,200.0);
#2=IFCDIRECTION((0.0,0.0,1.0));
#3=IFCEXTRUDEDAREASOLID(#1,$,#2,300.0);
"#;

    let mut decoder = EntityDecoder::new(content);
    let schema = IfcSchema::new();
    let processor = ExtrudedAreaSolidProcessor::new(schema.clone());

    let entity = decoder.decode_by_id(3).unwrap();
    let mesh = processor.process(&entity, &mut decoder, &schema).unwrap();

    assert!(!mesh.is_empty());
    assert!(!mesh.positions.is_empty());
    assert!(!mesh.indices.is_empty());
}

#[test]
fn test_triangulated_face_set() {
    let content = r#"
#1=IFCCARTESIANPOINTLIST3D(((0.0,0.0,0.0),(100.0,0.0,0.0),(50.0,100.0,0.0)));
#2=IFCTRIANGULATEDFACESET(#1,$,$,((1,2,3)),$);
"#;

    let mut decoder = EntityDecoder::new(content);
    let schema = IfcSchema::new();
    let processor = TriangulatedFaceSetProcessor::new();

    let entity = decoder.decode_by_id(2).unwrap();
    let mesh = processor.process(&entity, &mut decoder, &schema).unwrap();

    assert_eq!(mesh.positions.len(), 9); // 3 vertices * 3 coordinates
    assert_eq!(mesh.indices.len(), 3); // 1 triangle
}

#[test]
fn test_boolean_result_with_half_space() {
    // Simplified version of the 764--column.ifc structure
    let content = r#"
#1=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,100.0,200.0);
#2=IFCDIRECTION((0.0,0.0,1.0));
#3=IFCEXTRUDEDAREASOLID(#1,$,#2,300.0);
#4=IFCCARTESIANPOINT((0.0,0.0,150.0));
#5=IFCDIRECTION((0.0,0.0,1.0));
#6=IFCAXIS2PLACEMENT3D(#4,#5,$);
#7=IFCPLANE(#6);
#8=IFCHALFSPACESOLID(#7,.T.);
#9=IFCBOOLEANRESULT(.DIFFERENCE.,#3,#8);
"#;

    let mut decoder = EntityDecoder::new(content);
    let schema = IfcSchema::new();
    let processor = BooleanClippingProcessor::new();

    // First verify the entity types are parsed correctly
    let bool_result = decoder.decode_by_id(9).unwrap();
    println!("BooleanResult type: {:?}", bool_result.ifc_type);
    assert_eq!(bool_result.ifc_type, IfcType::IfcBooleanResult);

    let half_space = decoder.decode_by_id(8).unwrap();
    println!("HalfSpaceSolid type: {:?}", half_space.ifc_type);
    assert_eq!(half_space.ifc_type, IfcType::IfcHalfSpaceSolid);

    // Now process the boolean result
    let mesh = processor
        .process(&bool_result, &mut decoder, &schema)
        .unwrap();
    println!("Mesh vertices: {}", mesh.positions.len() / 3);
    println!("Mesh triangles: {}", mesh.indices.len() / 3);

    // The mesh should have geometry (base extrusion clipped)
    assert!(!mesh.is_empty(), "BooleanResult should produce geometry");
    assert!(!mesh.positions.is_empty());
}

#[test]
fn test_polygonal_bounded_half_space_respects_boundary() {
    let content = r#"
#1=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,10.0,4.0);
#2=IFCDIRECTION((0.0,0.0,1.0));
#3=IFCEXTRUDEDAREASOLID(#1,$,#2,5.0);
#4=IFCCARTESIANPOINT((-5.0,0.0));
#5=IFCCARTESIANPOINT((5.0,0.0));
#6=IFCCARTESIANPOINT((5.0,3.0));
#7=IFCCARTESIANPOINT((-5.0,3.0));
#8=IFCPOLYLINE((#4,#5,#6,#7,#4));
#9=IFCCARTESIANPOINT((0.0,0.0,5.0));
#10=IFCDIRECTION((0.0,1.0,0.0));
#11=IFCDIRECTION((1.0,0.0,0.0));
#12=IFCAXIS2PLACEMENT3D(#9,#10,#11);
#13=IFCPLANE(#12);
#14=IFCAXIS2PLACEMENT3D(#9,#10,#11);
#15=IFCPOLYGONALBOUNDEDHALFSPACE(#13,.F.,#14,#8);
#16=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#3,#15);
"#;

    let mut decoder = EntityDecoder::new(content);
    let schema = IfcSchema::new();
    let processor = BooleanClippingProcessor::new();

    let entity = decoder.decode_by_id(16).unwrap();
    let mesh = processor.process(&entity, &mut decoder, &schema).unwrap();

    assert!(!mesh.is_empty(), "Bounded half-space should still produce geometry");

    let mut has_outer_base = false;
    let mut has_outer_top = false;
    let mut has_clipped_top = false;

    for position in mesh.positions.chunks_exact(3) {
        let y = position[1] as f64;
        let z = position[2] as f64;

        if y > 1.9 && z < 0.1 {
            has_outer_base = true;
        }
        if y > 1.9 && z > 4.9 {
            has_outer_top = true;
        }
        if y.abs() < 0.1 && z > 4.9 {
            has_clipped_top = true;
        }
    }

    assert!(
        has_outer_base,
        "The polygon boundary should only clip the upper strip, not the whole wall side"
    );
    assert!(
        !has_outer_top,
        "The clipped strip should be removed at the top of the bounded region"
    );
    assert!(
        has_clipped_top,
        "The bounded clip should create a new top edge at the cut boundary"
    );
}

#[test]
fn test_764_column_file() {
    use crate::router::GeometryRouter;

    // Read the actual 764 column file
    let content = std::fs::read_to_string(
        "../../tests/models/ifcopenshell/764--column--no-materials-or-surface-styles-found--augmented.ifc"
    ).expect("Failed to read test file");

    let entity_index = ifc_lite_core::build_entity_index(&content);
    let mut decoder = EntityDecoder::with_index(&content, entity_index);
    let router = GeometryRouter::new();

    // Decode IFCCOLUMN #8930
    let column = decoder.decode_by_id(8930).expect("Failed to decode column");
    println!("Column type: {:?}", column.ifc_type);
    assert_eq!(column.ifc_type, IfcType::IfcColumn);

    // Check representation attribute
    let rep_attr = column
        .get(6)
        .expect("Column missing representation attribute");
    println!("Representation attr: {:?}", rep_attr);

    // Try process_element
    match router.process_element(&column, &mut decoder) {
        Ok(mesh) => {
            println!("Mesh vertices: {}", mesh.positions.len() / 3);
            println!("Mesh triangles: {}", mesh.indices.len() / 3);
            assert!(!mesh.is_empty(), "Column should produce geometry");
        }
        Err(e) => {
            panic!("Failed to process column: {:?}", e);
        }
    }
}

#[test]
fn test_gable_wall_pentagon_with_outward_normals() {
    // Gable wall: 10m wide extrusion clipped by two angled roof planes.
    // Plane points at the ridge (0,0,5.4), normals point OUTWARD from each slope.
    // AgreementFlag=.T.
    //
    // With the corrected clip direction (-plane_normal for agreement=.T.),
    // the code keeps the NEGATIVE side of each outward normal = below each
    // roof slope. Result: pentagonal gable shape.
    //
    // Math check for left slope plane:
    //   point=(0,0,5.4), normal=(-0.4756,0,0.8797)
    //   Plane equation: -0.4756x + 0.8797(z-5.4) = 0 → z = 5.4 + 0.5406x
    //   At x=-5: z=2.697 (eaves), At x=0: z=5.4 (ridge) ✓
    //   Wall base at z=0, x=-5: signed_dist = -0.4756*(-5) + 0.8797*(0-5.4) = -2.375 < 0 → NEGATIVE side
    //   With -plane_normal, negative side becomes positive → KEPT ✓
    let content = r#"
#1=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,10.0,0.3);
#2=IFCDIRECTION((0.0,0.0,1.0));
#3=IFCEXTRUDEDAREASOLID(#1,$,#2,5.4);
#10=IFCCARTESIANPOINT((0.0,0.0,5.4));
#11=IFCDIRECTION((-0.4756,0.0,0.8797));
#12=IFCAXIS2PLACEMENT3D(#10,#11,$);
#13=IFCPLANE(#12);
#14=IFCHALFSPACESOLID(#13,.T.);
#15=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#3,#14);
#20=IFCCARTESIANPOINT((0.0,0.0,5.4));
#21=IFCDIRECTION((0.4756,0.0,0.8797));
#22=IFCAXIS2PLACEMENT3D(#20,#21,$);
#23=IFCPLANE(#22);
#24=IFCHALFSPACESOLID(#23,.T.);
#25=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#15,#24);
"#;

    let mut decoder = EntityDecoder::new(content);
    let schema = IfcSchema::new();
    let processor = BooleanClippingProcessor::new();

    let entity = decoder.decode_by_id(25).unwrap();
    let mesh = processor.process(&entity, &mut decoder, &schema).unwrap();

    assert!(!mesh.is_empty(), "Gable wall should have geometry");
    let (min, max) = mesh.bounds();

    // Pentagon: base at z=0 spanning full 10m, narrowing to ridge at z=5.4
    assert!((min.z as f64) < 0.1,
        "Gable base should be at z≈0 (got {:.2})", min.z);
    assert!((max.z as f64) > 5.0,
        "Gable ridge should be at z≈5.4 (got {:.2})", max.z);
    let base_width = max.x - min.x;
    assert!(base_width > 8.0,
        "Gable base should span ~10m (got {:.2}m)", base_width);
}

#[test]
fn test_wall_with_opening_file() {
    use crate::router::GeometryRouter;

    // Read the wall-with-opening file
    let content = std::fs::read_to_string(
        "../../tests/models/buildingsmart/wall-with-opening-and-window.ifc",
    )
    .expect("Failed to read test file");

    let entity_index = ifc_lite_core::build_entity_index(&content);
    let mut decoder = EntityDecoder::with_index(&content, entity_index);
    let router = GeometryRouter::new();

    // Decode IFCWALL #45
    let wall = match decoder.decode_by_id(45) {
        Ok(w) => w,
        Err(e) => panic!("Failed to decode wall: {:?}", e),
    };
    println!("Wall type: {:?}", wall.ifc_type);
    assert_eq!(wall.ifc_type, IfcType::IfcWall);

    // Check representation attribute (should be at index 6)
    let rep_attr = wall.get(6).expect("Wall missing representation attribute");
    println!("Representation attr: {:?}", rep_attr);

    // Try process_element
    match router.process_element(&wall, &mut decoder) {
        Ok(mesh) => {
            println!("Wall mesh vertices: {}", mesh.positions.len() / 3);
            println!("Wall mesh triangles: {}", mesh.indices.len() / 3);
            assert!(!mesh.is_empty(), "Wall should produce geometry");
        }
        Err(e) => {
            panic!("Failed to process wall: {:?}", e);
        }
    }

    // Also test window
    let window = decoder.decode_by_id(102).expect("Failed to decode window");
    println!("Window type: {:?}", window.ifc_type);
    assert_eq!(window.ifc_type, IfcType::IfcWindow);

    match router.process_element(&window, &mut decoder) {
        Ok(mesh) => {
            println!("Window mesh vertices: {}", mesh.positions.len() / 3);
            println!("Window mesh triangles: {}", mesh.indices.len() / 3);
        }
        Err(e) => {
            println!("Window error (might be expected): {:?}", e);
        }
    }
}
