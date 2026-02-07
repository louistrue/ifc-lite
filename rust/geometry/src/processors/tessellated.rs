// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Tessellated geometry processors - pre-tessellated/polygon meshes.
//!
//! Handles IfcTriangulatedFaceSet (explicit triangle meshes) and
//! IfcPolygonalFaceSet (polygon meshes requiring triangulation).

use crate::{Error, Mesh, Result};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcSchema, IfcType};

use crate::router::GeometryProcessor;

/// TriangulatedFaceSet processor (P0)
/// Handles IfcTriangulatedFaceSet - explicit triangle meshes
pub struct TriangulatedFaceSetProcessor;

impl TriangulatedFaceSetProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for TriangulatedFaceSetProcessor {
    #[inline]
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcTriangulatedFaceSet attributes:
        // 0: Coordinates (IfcCartesianPointList3D)
        // 1: Normals (optional)
        // 2: Closed (optional)
        // 3: CoordIndex (list of list of IfcPositiveInteger)

        // Get coordinate entity reference
        let coords_attr = entity.get(0).ok_or_else(|| {
            Error::geometry("TriangulatedFaceSet missing Coordinates".to_string())
        })?;

        let coord_entity_id = coords_attr.as_entity_ref().ok_or_else(|| {
            Error::geometry("Expected entity reference for Coordinates".to_string())
        })?;

        // FAST PATH: Try direct parsing of raw bytes (3-5x faster)
        // This bypasses Token/AttributeValue allocations entirely
        use ifc_lite_core::{extract_coordinate_list_from_entity, parse_indices_direct};

        let positions = if let Some(raw_bytes) = decoder.get_raw_bytes(coord_entity_id) {
            // Fast path: parse coordinates directly from raw bytes
            // Use extract_coordinate_list_from_entity to skip entity header (#N=IFCTYPE...)
            extract_coordinate_list_from_entity(raw_bytes).unwrap_or_default()
        } else {
            // Fallback path: use standard decoding
            let coords_entity = decoder.decode_by_id(coord_entity_id)?;

            let coord_list_attr = coords_entity.get(0).ok_or_else(|| {
                Error::geometry("CartesianPointList3D missing CoordList".to_string())
            })?;

            let coord_list = coord_list_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;

            use ifc_lite_core::AttributeValue;
            AttributeValue::parse_coordinate_list_3d(coord_list)
        };

        // Get face indices - try fast path first
        let indices_attr = entity
            .get(3)
            .ok_or_else(|| Error::geometry("TriangulatedFaceSet missing CoordIndex".to_string()))?;

        // For indices, we need to extract from the main entity's raw bytes
        // Fast path: parse directly if we can get the raw CoordIndex section
        let indices = if let Some(raw_entity_bytes) = decoder.get_raw_bytes(entity.id) {
            // Find the CoordIndex attribute (4th attribute, index 3)
            // and parse directly
            if let Some(coord_index_bytes) = super::extract_coord_index_bytes(raw_entity_bytes) {
                parse_indices_direct(coord_index_bytes)
            } else {
                // Fallback to standard parsing
                let face_list = indices_attr
                    .as_list()
                    .ok_or_else(|| Error::geometry("Expected face index list".to_string()))?;
                use ifc_lite_core::AttributeValue;
                AttributeValue::parse_index_list(face_list)
            }
        } else {
            let face_list = indices_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected face index list".to_string()))?;
            use ifc_lite_core::AttributeValue;
            AttributeValue::parse_index_list(face_list)
        };

        // Create mesh (normals will be computed later)
        Ok(Mesh {
            positions,
            normals: Vec::new(),
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcTriangulatedFaceSet]
    }
}

impl Default for TriangulatedFaceSetProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// Handles IfcPolygonalFaceSet - explicit polygon meshes that need triangulation
/// Unlike IfcTriangulatedFaceSet, faces can be arbitrary polygons (not just triangles)
pub struct PolygonalFaceSetProcessor;

impl PolygonalFaceSetProcessor {
    pub fn new() -> Self {
        Self
    }

    /// Triangulate a polygon using ear-clipping algorithm (earcutr)
    /// This works correctly for both convex and concave polygons
    /// IFC indices are 1-based, so we subtract 1 to get 0-based indices
    /// positions is flattened [x0, y0, z0, x1, y1, z1, ...]
    fn triangulate_polygon(
        face_indices: &[u32],
        positions: &[f32],
        output: &mut Vec<u32>,
    ) {
        if face_indices.len() < 3 {
            return;
        }

        // For triangles, no triangulation needed
        if face_indices.len() == 3 {
            output.push(face_indices[0] - 1);
            output.push(face_indices[1] - 1);
            output.push(face_indices[2] - 1);
            return;
        }

        // For quads and simple cases, use fan triangulation (fast path)
        if face_indices.len() == 4 {
            let first = face_indices[0] - 1;
            output.push(first);
            output.push(face_indices[1] - 1);
            output.push(face_indices[2] - 1);
            output.push(first);
            output.push(face_indices[2] - 1);
            output.push(face_indices[3] - 1);
            return;
        }

        // Helper to get 3D position from flattened array
        let get_pos = |idx: u32| -> Option<(f32, f32, f32)> {
            let base = ((idx - 1) * 3) as usize;
            if base + 2 < positions.len() {
                Some((positions[base], positions[base + 1], positions[base + 2]))
            } else {
                None
            }
        };

        // For complex polygons (5+ vertices), use ear-clipping triangulation
        // This handles concave polygons correctly (like opening cutouts)

        // Extract 2D coordinates by projecting to best-fit plane
        // Find dominant normal direction to choose projection plane
        let mut sum_x = 0.0f64;
        let mut sum_y = 0.0f64;
        let mut sum_z = 0.0f64;

        // Calculate centroid-based normal approximation using Newell's method
        for i in 0..face_indices.len() {
            let v0 = match get_pos(face_indices[i]) {
                Some(p) => p,
                None => {
                    // Fallback to fan triangulation if indices are invalid
                    let first = face_indices[0] - 1;
                    for j in 1..face_indices.len() - 1 {
                        output.push(first);
                        output.push(face_indices[j] - 1);
                        output.push(face_indices[j + 1] - 1);
                    }
                    return;
                }
            };
            let v1 = match get_pos(face_indices[(i + 1) % face_indices.len()]) {
                Some(p) => p,
                None => {
                    let first = face_indices[0] - 1;
                    for j in 1..face_indices.len() - 1 {
                        output.push(first);
                        output.push(face_indices[j] - 1);
                        output.push(face_indices[j + 1] - 1);
                    }
                    return;
                }
            };

            sum_x += (v0.1 - v1.1) as f64 * (v0.2 + v1.2) as f64;
            sum_y += (v0.2 - v1.2) as f64 * (v0.0 + v1.0) as f64;
            sum_z += (v0.0 - v1.0) as f64 * (v0.1 + v1.1) as f64;
        }

        // Choose projection plane based on dominant axis
        let abs_x = sum_x.abs();
        let abs_y = sum_y.abs();
        let abs_z = sum_z.abs();

        // Project 3D points to 2D for triangulation
        let mut coords_2d: Vec<f64> = Vec::with_capacity(face_indices.len() * 2);

        for &idx in face_indices {
            let p = match get_pos(idx) {
                Some(pos) => pos,
                None => {
                    // Fallback to fan triangulation
                    let first = face_indices[0] - 1;
                    for j in 1..face_indices.len() - 1 {
                        output.push(first);
                        output.push(face_indices[j] - 1);
                        output.push(face_indices[j + 1] - 1);
                    }
                    return;
                }
            };

            // Project to 2D based on dominant normal axis
            if abs_z >= abs_x && abs_z >= abs_y {
                // XY plane (Z is dominant)
                coords_2d.push(p.0 as f64);
                coords_2d.push(p.1 as f64);
            } else if abs_y >= abs_x {
                // XZ plane (Y is dominant)
                coords_2d.push(p.0 as f64);
                coords_2d.push(p.2 as f64);
            } else {
                // YZ plane (X is dominant)
                coords_2d.push(p.1 as f64);
                coords_2d.push(p.2 as f64);
            }
        }

        // Run ear-clipping triangulation
        let hole_indices: Vec<usize> = vec![]; // No holes for simple faces
        match earcutr::earcut(&coords_2d, &hole_indices, 2) {
            Ok(tri_indices) => {
                // Map local triangle indices back to original face indices
                for tri_idx in tri_indices {
                    if tri_idx < face_indices.len() {
                        output.push(face_indices[tri_idx] - 1);
                    }
                }
            }
            Err(_) => {
                // Fallback to fan triangulation if ear-clipping fails
                let first = face_indices[0] - 1;
                for i in 1..face_indices.len() - 1 {
                    output.push(first);
                    output.push(face_indices[i] - 1);
                    output.push(face_indices[i + 1] - 1);
                }
            }
        }
    }
}

impl GeometryProcessor for PolygonalFaceSetProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcPolygonalFaceSet attributes:
        // 0: Coordinates (IfcCartesianPointList3D)
        // 1: Closed (optional BOOLEAN)
        // 2: Faces (LIST of IfcIndexedPolygonalFace)
        // 3: PnIndex (optional - point index remapping)

        // Get coordinate entity reference
        let coords_attr = entity.get(0).ok_or_else(|| {
            Error::geometry("PolygonalFaceSet missing Coordinates".to_string())
        })?;

        let coord_entity_id = coords_attr.as_entity_ref().ok_or_else(|| {
            Error::geometry("Expected entity reference for Coordinates".to_string())
        })?;

        // Parse coordinates - try fast path first
        use ifc_lite_core::extract_coordinate_list_from_entity;

        let positions = if let Some(raw_bytes) = decoder.get_raw_bytes(coord_entity_id) {
            extract_coordinate_list_from_entity(raw_bytes).unwrap_or_default()
        } else {
            // Fallback path
            let coords_entity = decoder.decode_by_id(coord_entity_id)?;
            let coord_list_attr = coords_entity.get(0).ok_or_else(|| {
                Error::geometry("CartesianPointList3D missing CoordList".to_string())
            })?;
            let coord_list = coord_list_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;
            use ifc_lite_core::AttributeValue;
            AttributeValue::parse_coordinate_list_3d(coord_list)
        };

        if positions.is_empty() {
            return Ok(Mesh::new());
        }

        // Get faces list (attribute 2)
        let faces_attr = entity.get(2).ok_or_else(|| {
            Error::geometry("PolygonalFaceSet missing Faces".to_string())
        })?;

        let face_refs = faces_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected faces list".to_string()))?;

        // Pre-allocate indices - estimate 2 triangles per face average
        let mut indices = Vec::with_capacity(face_refs.len() * 6);

        // Process each face
        for face_ref in face_refs {
            let face_id = face_ref.as_entity_ref().ok_or_else(|| {
                Error::geometry("Expected entity reference for face".to_string())
            })?;

            let face_entity = decoder.decode_by_id(face_id)?;

            // IfcIndexedPolygonalFace has CoordIndex at attribute 0
            // IfcIndexedPolygonalFaceWithVoids has CoordIndex at 0 and InnerCoordIndices at 1
            let coord_index_attr = face_entity.get(0).ok_or_else(|| {
                Error::geometry("IndexedPolygonalFace missing CoordIndex".to_string())
            })?;

            let coord_indices = coord_index_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected coord index list".to_string()))?;

            // Parse face indices (1-based in IFC)
            let face_indices: Vec<u32> = coord_indices
                .iter()
                .filter_map(|v| v.as_int().map(|i| i as u32))
                .collect();

            // Triangulate the polygon (using ear-clipping for complex polygons)
            Self::triangulate_polygon(&face_indices, &positions, &mut indices);
        }

        Ok(Mesh {
            positions,
            normals: Vec::new(), // Will be computed later
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcPolygonalFaceSet]
    }
}

impl Default for PolygonalFaceSetProcessor {
    fn default() -> Self {
        Self::new()
    }
}
