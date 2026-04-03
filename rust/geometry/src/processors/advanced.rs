// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! AdvancedBrep processor - NURBS/B-spline surfaces.
//!
//! Handles IfcAdvancedBrep and IfcAdvancedBrepWithVoids.
//! Delegates per-face processing to shared advanced_face module.

use crate::{Error, Mesh, Result};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcSchema, IfcType};

use crate::router::GeometryProcessor;
use super::advanced_face::process_advanced_face;

/// AdvancedBrep processor
/// Handles IfcAdvancedBrep and IfcAdvancedBrepWithVoids - NURBS/B-spline surfaces
/// Supports planar faces and B-spline surface tessellation
pub struct AdvancedBrepProcessor;

impl AdvancedBrepProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for AdvancedBrepProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcAdvancedBrep attributes:
        // 0: Outer (IfcClosedShell)

        // Get the outer shell
        let shell_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("AdvancedBrep missing Outer shell".to_string()))?;

        let shell = decoder
            .resolve_ref(shell_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Outer shell".to_string()))?;

        // Get faces from the shell (IfcClosedShell.CfsFaces)
        let faces_attr = shell
            .get(0)
            .ok_or_else(|| Error::geometry("ClosedShell missing CfsFaces".to_string()))?;

        let faces = faces_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected face list".to_string()))?;

        let mut all_positions = Vec::new();
        let mut all_indices = Vec::new();

        for face_ref in faces {
            if let Some(face_id) = face_ref.as_entity_ref() {
                let face = decoder.decode_by_id(face_id)?;

                // Delegate to shared advanced face processing
                let (positions, indices) = process_advanced_face(&face, decoder)?;

                if !positions.is_empty() {
                    // Merge into combined mesh
                    let base_idx = (all_positions.len() / 3) as u32;
                    all_positions.extend(positions);
                    for idx in indices {
                        all_indices.push(base_idx + idx);
                    }
                }
            }
        }

        Ok(Mesh {
            positions: all_positions,
            normals: Vec::new(),
            indices: all_indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcAdvancedBrep, IfcType::IfcAdvancedBrepWithVoids]
    }
}

impl Default for AdvancedBrepProcessor {
    fn default() -> Self {
        Self::new()
    }
}
