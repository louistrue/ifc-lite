// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Test for multilayer wall window cutouts in TUN32-BT2-ARK - forenklet.ifc
//!
//! These walls are IfcBuildingElementPart entities (individual layers of a multilayer wall).
//! The openings are linked to the parent IfcWall via IfcRelVoidsElement, but the parts
//! also need void subtraction. The fix propagates voids from parent to child via
//! IfcRelAggregates scanning.

use ifc_lite_core::{EntityDecoder, EntityScanner};
use ifc_lite_geometry::{propagate_voids_to_parts, GeometryRouter};
use rustc_hash::FxHashMap;
use std::fs;

const FILE_PATH: &str = "../../tests/models/local/TUN32-BT2-ARK - forenklet.ifc";

const PROBLEM_GUIDS: &[&str] = &[
    "3JhGnsdUm4$u6k6N2VZuZL",
    "1gPONxZGmKKFlD6tF1kkth",
    "0sDh3c3IZKoh_I6YAT8GkI",
    "1zYEOXx7hUOCn6_AF9buvt",
    "0btXmfUNYIDmMEzSvCjk1V",
    "1RKTsPDQMvTZoUtlL08qWP",
];

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

#[test]
fn multilayer_wall_parts_get_void_subtraction() {
    let content = match load_file() {
        Some(c) => c,
        None => {
            println!("Skipping: TUN32-BT2-ARK - forenklet.ifc not found");
            return;
        }
    };

    // Build void index WITHOUT propagation first
    let mut void_index = build_void_index(&content);
    let mut decoder = EntityDecoder::new(&content);
    let router = GeometryRouter::with_units(&content, &mut decoder);

    // Verify that the parts have NO voids before propagation
    for guid in PROBLEM_GUIDS {
        let entity_id = find_entity_by_guid(&content, guid).expect("GUID not found");
        assert!(
            !void_index.contains_key(&entity_id),
            "Part {} should have no voids before propagation",
            guid
        );
    }

    // Now propagate voids from parent wall to children
    propagate_voids_to_parts(&mut void_index, &content, &mut decoder);

    // Verify that parts NOW have voids after propagation
    for guid in PROBLEM_GUIDS {
        let entity_id = find_entity_by_guid(&content, guid).expect("GUID not found");
        let num_voids = void_index.get(&entity_id).map(|v| v.len()).unwrap_or(0);
        println!("Part {}: {} voids after propagation", guid, num_voids);
        assert!(
            num_voids > 0,
            "Part {} should have voids after propagation, got 0",
            guid
        );
    }

    // Verify that void subtraction actually changes the geometry
    for guid in PROBLEM_GUIDS {
        let entity_id = find_entity_by_guid(&content, guid).unwrap();
        let mut decoder = EntityDecoder::new(&content);
        let entity = decoder.decode_by_id(entity_id).unwrap();

        let wall_no_voids = router.process_element(&entity, &mut decoder).unwrap();
        let wall_with_voids = router
            .process_element_with_voids(&entity, &mut decoder, &void_index)
            .unwrap();

        let tri_before = wall_no_voids.triangle_count();
        let tri_after = wall_with_voids.triangle_count();

        println!(
            "Part {}: triangles {} -> {} (diff: {})",
            guid,
            tri_before,
            tri_after,
            tri_before as i64 - tri_after as i64
        );

        assert_ne!(
            tri_before, tri_after,
            "Part {} should have different triangle count after void subtraction",
            guid
        );
    }
}
