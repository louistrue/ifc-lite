// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! CSG void subtraction tests using inline IFC content.
//! These tests verify that opening subtraction works correctly.

use ifc_lite_core::EntityDecoder;
use ifc_lite_geometry::{csg::ClippingProcessor, GeometryRouter, Mesh};

/// Create a simple slab with a rectangular opening for testing
fn create_slab_with_opening_ifc() -> String {
    r#"ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('test.ifc','2024-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('1234567890123456789012',#2,'Test',$,$,$,$,(#10),#7);
#2=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
#3=IFCPERSONANDORGANIZATION(#5,#6,$);
#4=IFCAPPLICATION(#6,'1.0','Test','Test');
#5=IFCPERSON($,'Test',$,$,$,$,$,$);
#6=IFCORGANIZATION($,'Test',$,$,$);
#7=IFCUNITASSIGNMENT((#8,#9));
#8=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#9=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#11,$);
#11=IFCAXIS2PLACEMENT3D(#12,$,$);
#12=IFCCARTESIANPOINT((0.,0.,0.));
#13=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#10,$,.MODEL_VIEW.,$);
#20=IFCLOCALPLACEMENT($,#21);
#21=IFCAXIS2PLACEMENT3D(#22,#23,#24);
#22=IFCCARTESIANPOINT((0.,0.,0.));
#23=IFCDIRECTION((0.,0.,1.));
#24=IFCDIRECTION((1.,0.,0.));
#30=IFCRECTANGLEPROFILEDEF(.AREA.,'SlabProfile',#31,4.0,3.0);
#31=IFCAXIS2PLACEMENT2D(#32,#33);
#32=IFCCARTESIANPOINT((0.,0.));
#33=IFCDIRECTION((1.,0.));
#40=IFCEXTRUDEDAREASOLID(#30,#41,#42,0.3);
#41=IFCAXIS2PLACEMENT3D(#43,$,$);
#42=IFCDIRECTION((0.,0.,1.));
#43=IFCCARTESIANPOINT((0.,0.,0.));
#50=IFCSHAPEREPRESENTATION(#13,'Body','SweptSolid',(#40));
#51=IFCPRODUCTDEFINITIONSHAPE($,$,(#50));
#100=IFCSLAB('0001234567890123456789',#2,'TestSlab',$,$,#20,#51,'Test',.FLOOR.);
#110=IFCLOCALPLACEMENT(#20,#111);
#111=IFCAXIS2PLACEMENT3D(#112,#113,#114);
#112=IFCCARTESIANPOINT((0.5,0.5,0.));
#113=IFCDIRECTION((0.,0.,1.));
#114=IFCDIRECTION((1.,0.,0.));
#120=IFCRECTANGLEPROFILEDEF(.AREA.,'OpeningProfile',#121,1.0,1.0);
#121=IFCAXIS2PLACEMENT2D(#122,#123);
#122=IFCCARTESIANPOINT((0.,0.));
#123=IFCDIRECTION((1.,0.));
#130=IFCEXTRUDEDAREASOLID(#120,#131,#132,0.5);
#131=IFCAXIS2PLACEMENT3D(#133,$,$);
#132=IFCDIRECTION((0.,0.,1.));
#133=IFCCARTESIANPOINT((0.,0.,-0.1));
#140=IFCSHAPEREPRESENTATION(#13,'Body','SweptSolid',(#130));
#141=IFCPRODUCTDEFINITIONSHAPE($,$,(#140));
#200=IFCOPENINGELEMENT('0001234567890123456790',#2,'TestOpening',$,$,#110,#141,$,.OPENING.);
#300=IFCRELVOIDSELEMENT('0001234567890123456791',#2,$,$,#100,#200);
ENDSEC;
END-ISO-10303-21;
"#.to_string()
}

/// Test that CSG subtraction produces valid geometry
#[test]
fn test_csg_void_subtraction_basic() {
    let content = create_slab_with_opening_ifc();
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Get the slab entity (#100)
    let slab = decoder.decode_by_id(100).expect("Failed to decode slab");
    let slab_mesh = router
        .process_element(&slab, &mut decoder)
        .expect("Failed to process slab");

    // Get the opening entity (#200)
    let opening = decoder
        .decode_by_id(200)
        .expect("Failed to decode opening");
    let opening_mesh = router
        .process_element(&opening, &mut decoder)
        .expect("Failed to process opening");

    // Both meshes should have geometry
    assert!(
        !slab_mesh.is_empty(),
        "Slab mesh should not be empty"
    );
    assert!(
        !opening_mesh.is_empty(),
        "Opening mesh should not be empty"
    );

    // Perform CSG subtraction
    let clipper = ClippingProcessor::new();
    let result = clipper.subtract_mesh(&slab_mesh, &opening_mesh);

    match result {
        Ok(result_mesh) => {
            // Result should have valid geometry
            assert!(
                !result_mesh.is_empty(),
                "CSG result should not be empty"
            );

            // Positions and normals must be non-empty
            assert!(
                !result_mesh.positions.is_empty(),
                "Result mesh positions should not be empty"
            );
            assert!(
                !result_mesh.normals.is_empty(),
                "Result mesh normals should not be empty"
            );

            // Normals and positions should have matching lengths (per-vertex normals)
            assert_eq!(
                result_mesh.normals.len(),
                result_mesh.positions.len(),
                "Normals and positions should have matching lengths"
            );

            // All positions should be finite
            assert!(
                result_mesh.positions.iter().all(|v| v.is_finite()),
                "All positions should be finite"
            );

            // All normals should be finite
            assert!(
                result_mesh.normals.iter().all(|v| v.is_finite()),
                "All normals should be finite"
            );

            // Bounds should be reasonable (within original slab bounds)
            let (slab_min, slab_max) = slab_mesh.bounds();
            let (result_min, result_max) = result_mesh.bounds();

            assert!(
                result_min.x >= slab_min.x - 0.01 && result_max.x <= slab_max.x + 0.01,
                "Result X bounds should be within slab bounds"
            );
            assert!(
                result_min.y >= slab_min.y - 0.01 && result_max.y <= slab_max.y + 0.01,
                "Result Y bounds should be within slab bounds"
            );
        }
        Err(e) => {
            // CSG can fail for some edge cases, but we should at least get the original mesh back
            panic!("CSG subtraction failed: {}", e);
        }
    }
}

/// Test that meshes can be merged correctly
#[test]
fn test_mesh_merge() {
    let content = create_slab_with_opening_ifc();
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Get slab mesh
    let slab = decoder.decode_by_id(100).expect("Failed to decode slab");
    let slab_mesh = router
        .process_element(&slab, &mut decoder)
        .expect("Failed to process slab");

    // Get opening mesh
    let opening = decoder
        .decode_by_id(200)
        .expect("Failed to decode opening");
    let opening_mesh = router
        .process_element(&opening, &mut decoder)
        .expect("Failed to process opening");

    // Merge meshes
    let mut combined = Mesh::new();
    combined.merge(&slab_mesh);
    combined.merge(&opening_mesh);

    // Combined should have both meshes' triangles
    assert_eq!(
        combined.triangle_count(),
        slab_mesh.triangle_count() + opening_mesh.triangle_count(),
        "Combined mesh should have sum of triangles"
    );
}

/// Test mesh bounds calculation
#[test]
fn test_mesh_bounds() {
    let content = create_slab_with_opening_ifc();
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Get slab mesh (4m x 3m x 0.3m slab)
    let slab = decoder.decode_by_id(100).expect("Failed to decode slab");
    let slab_mesh = router
        .process_element(&slab, &mut decoder)
        .expect("Failed to process slab");

    let (min, max) = slab_mesh.bounds();

    // Slab should be approximately 4m x 3m x 0.3m
    let width = max.x - min.x;
    let depth = max.y - min.y;
    let height = max.z - min.z;

    assert!(
        (width - 4.0).abs() < 0.1,
        "Slab width should be ~4m, got {:.2}",
        width
    );
    assert!(
        (depth - 3.0).abs() < 0.1,
        "Slab depth should be ~3m, got {:.2}",
        depth
    );
    assert!(
        (height - 0.3).abs() < 0.1,
        "Slab height should be ~0.3m, got {:.2}",
        height
    );
}
