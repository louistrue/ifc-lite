// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometry Processors - P0 implementations
//!
//! High-priority processors for common IFC geometry types.

use crate::{
    extrusion::{apply_transform, extrude_profile}, profiles::ProfileProcessor, triangulation::triangulate_polygon,
    Error, Mesh, Point3, Result, Vector3,
};
use ifc_lite_core::{DecodedEntity, EntityDecoder, GeometryCategory, IfcSchema, IfcType};
use nalgebra::Matrix4;

use super::router::GeometryProcessor;

/// ExtrudedAreaSolid processor (P0)
/// Handles IfcExtrudedAreaSolid - extrusion of 2D profiles
pub struct ExtrudedAreaSolidProcessor {
    profile_processor: ProfileProcessor,
}

impl ExtrudedAreaSolidProcessor {
    /// Create new processor
    pub fn new(schema: IfcSchema) -> Self {
        Self {
            profile_processor: ProfileProcessor::new(schema),
        }
    }
}

impl GeometryProcessor for ExtrudedAreaSolidProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcExtrudedAreaSolid attributes:
        // 0: SweptArea (IfcProfileDef)
        // 1: Position (IfcAxis2Placement3D)
        // 2: ExtrudedDirection (IfcDirection)
        // 3: Depth (IfcPositiveLengthMeasure)

        // Get profile
        let profile_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("ExtrudedAreaSolid missing SweptArea".to_string()))?;

        let profile_entity = decoder
            .resolve_ref(profile_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve SweptArea".to_string()))?;

        let profile = self
            .profile_processor
            .process(&profile_entity, decoder)?;

        if profile.outer.is_empty() {
            return Ok(Mesh::new());
        }

        // Get extrusion direction
        let direction_attr = entity
            .get(2)
            .ok_or_else(|| {
                Error::geometry("ExtrudedAreaSolid missing ExtrudedDirection".to_string())
            })?;

        let direction_entity = decoder
            .resolve_ref(direction_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve ExtrudedDirection".to_string()))?;

        if direction_entity.ifc_type != IfcType::IfcDirection {
            return Err(Error::geometry(format!(
                "Expected IfcDirection, got {}",
                direction_entity.ifc_type
            )));
        }

        // Parse direction
        let ratios_attr = direction_entity
            .get(0)
            .ok_or_else(|| Error::geometry("IfcDirection missing ratios".to_string()))?;

        let ratios = ratios_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected ratio list".to_string()))?;

        use ifc_lite_core::AttributeValue;
        let dir_x = ratios.get(0).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0);
        let dir_y = ratios.get(1).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0);
        let dir_z = ratios.get(2).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(1.0);

        let direction = Vector3::new(dir_x, dir_y, dir_z).normalize();

        // Get depth
        let depth = entity
            .get_float(3)
            .ok_or_else(|| Error::geometry("ExtrudedAreaSolid missing Depth".to_string()))?;

        // ExtrudedDirection is in the local coordinate system defined by Position.
        // Most IFC files use (0,0,1) or (0,0,-1) for vertical extrusions.
        // We should NOT apply a separate rotation for the extrusion direction when it's
        // aligned with Z, as Position will handle the full orientation.
        // Only apply additional rotation when ExtrudedDirection has X or Y components
        // (i.e., non-vertical extrusion in local space).
        let transform = if direction.x.abs() < 0.001 && direction.y.abs() < 0.001 {
            // ExtrudedDirection is along local Z axis - no additional rotation needed
            // Position transform will handle the orientation
            //
            // However, if ExtrudedDirection is (0,0,-1), we need to offset the extrusion
            // so it goes from Z=-depth to Z=0 instead of Z=0 to Z=+depth.
            // This is because extrude_profile always extrudes in +Z, but IFC expects
            // the solid to extend in the ExtrudedDirection from the profile plane.
            if direction.z < 0.0 {
                // Shift the extrusion down by depth so it extends in -Z from the profile plane
                Some(Matrix4::new_translation(&Vector3::new(0.0, 0.0, -depth)))
            } else {
                None
            }
        } else {
            // Non-Z-aligned extrusion: construct rotation to align with extrusion direction
            let new_z = direction.normalize();

            // Choose up vector (world Z, unless direction is nearly vertical)
            let up = if new_z.z.abs() > 0.9 {
                Vector3::new(0.0, 1.0, 0.0)  // Use Y when nearly vertical
            } else {
                Vector3::new(0.0, 0.0, 1.0)  // Use Z otherwise
            };

            let new_x = up.cross(&new_z).normalize();
            let new_y = new_z.cross(&new_x).normalize();

            let mut transform_mat = Matrix4::identity();
            transform_mat[(0, 0)] = new_x.x;
            transform_mat[(1, 0)] = new_x.y;
            transform_mat[(2, 0)] = new_x.z;
            transform_mat[(0, 1)] = new_y.x;
            transform_mat[(1, 1)] = new_y.y;
            transform_mat[(2, 1)] = new_y.z;
            transform_mat[(0, 2)] = new_z.x;
            transform_mat[(1, 2)] = new_z.y;
            transform_mat[(2, 2)] = new_z.z;

            Some(transform_mat)
        };

        // Extrude the profile
        let mut mesh = extrude_profile(&profile, depth, transform)?;

        // Apply Position transform (attribute 1: IfcAxis2Placement3D)
        if let Some(pos_attr) = entity.get(1) {
            if !pos_attr.is_null() {
                if let Some(pos_entity) = decoder.resolve_ref(pos_attr)? {
                    if pos_entity.ifc_type == IfcType::IfcAxis2Placement3D {
                        let pos_transform = self.parse_axis2_placement_3d(&pos_entity, decoder)?;
                        apply_transform(&mut mesh, &pos_transform);
                    }
                }
            }
        }

        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcExtrudedAreaSolid]
    }
}

impl ExtrudedAreaSolidProcessor {
    /// Parse IfcAxis2Placement3D into transformation matrix
    fn parse_axis2_placement_3d(
        &self,
        placement: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        // IfcAxis2Placement3D: Location, Axis, RefDirection
        let location = self.parse_cartesian_point(placement, decoder, 0)?;

        // Default axes if not specified
        let z_axis = if let Some(axis_attr) = placement.get(1) {
            if !axis_attr.is_null() {
                if let Some(axis_entity) = decoder.resolve_ref(axis_attr)? {
                    self.parse_direction(&axis_entity)?
                } else {
                    Vector3::new(0.0, 0.0, 1.0)
                }
            } else {
                Vector3::new(0.0, 0.0, 1.0)
            }
        } else {
            Vector3::new(0.0, 0.0, 1.0)
        };

        let x_axis = if let Some(ref_dir_attr) = placement.get(2) {
            if !ref_dir_attr.is_null() {
                if let Some(ref_dir_entity) = decoder.resolve_ref(ref_dir_attr)? {
                    self.parse_direction(&ref_dir_entity)?
                } else {
                    Vector3::new(1.0, 0.0, 0.0)
                }
            } else {
                Vector3::new(1.0, 0.0, 0.0)
            }
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };

        // Normalize axes
        let z_axis_final = z_axis.normalize();
        let x_axis_normalized = x_axis.normalize();
        
        // Ensure X is orthogonal to Z (project X onto plane perpendicular to Z)
        let dot_product = x_axis_normalized.dot(&z_axis_final);
        let x_axis_orthogonal = x_axis_normalized - z_axis_final * dot_product;
        let x_axis_final = if x_axis_orthogonal.norm() > 1e-6 {
            x_axis_orthogonal.normalize()
        } else {
            // X and Z are parallel or nearly parallel - use a default perpendicular direction
            if z_axis_final.z.abs() < 0.9 {
                Vector3::new(0.0, 0.0, 1.0).cross(&z_axis_final).normalize()
            } else {
                Vector3::new(1.0, 0.0, 0.0).cross(&z_axis_final).normalize()
            }
        };
        
        // Y axis is cross product of Z and X (right-hand rule: Y = Z × X)
        let y_axis = z_axis_final.cross(&x_axis_final).normalize();

        // Build transformation matrix
        // Columns represent world-space directions of local axes
        let mut transform = Matrix4::identity();
        transform[(0, 0)] = x_axis_final.x;
        transform[(1, 0)] = x_axis_final.y;
        transform[(2, 0)] = x_axis_final.z;
        transform[(0, 1)] = y_axis.x;
        transform[(1, 1)] = y_axis.y;
        transform[(2, 1)] = y_axis.z;
        transform[(0, 2)] = z_axis_final.x;
        transform[(1, 2)] = z_axis_final.y;
        transform[(2, 2)] = z_axis_final.z;
        transform[(0, 3)] = location.x;
        transform[(1, 3)] = location.y;
        transform[(2, 3)] = location.z;

        Ok(transform)
    }

    /// Parse IfcCartesianPoint
    fn parse_cartesian_point(
        &self,
        parent: &DecodedEntity,
        decoder: &mut EntityDecoder,
        attr_index: usize,
    ) -> Result<Point3<f64>> {
        let point_attr = parent
            .get(attr_index)
            .ok_or_else(|| Error::geometry("Missing cartesian point".to_string()))?;

        let point_entity = decoder
            .resolve_ref(point_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve cartesian point".to_string()))?;

        if point_entity.ifc_type != IfcType::IfcCartesianPoint {
            return Err(Error::geometry(format!(
                "Expected IfcCartesianPoint, got {}",
                point_entity.ifc_type
            )));
        }

        // Get coordinates list (attribute 0)
        let coords_attr = point_entity
            .get(0)
            .ok_or_else(|| Error::geometry("IfcCartesianPoint missing coordinates".to_string()))?;

        let coords = coords_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;

        let x = coords
            .get(0)
            .and_then(|v| v.as_float())
            .unwrap_or(0.0);
        let y = coords
            .get(1)
            .and_then(|v| v.as_float())
            .unwrap_or(0.0);
        let z = coords
            .get(2)
            .and_then(|v| v.as_float())
            .unwrap_or(0.0);

        Ok(Point3::new(x, y, z))
    }

    /// Parse IfcDirection
    fn parse_direction(&self, direction_entity: &DecodedEntity) -> Result<Vector3<f64>> {
        if direction_entity.ifc_type != IfcType::IfcDirection {
            return Err(Error::geometry(format!(
                "Expected IfcDirection, got {}",
                direction_entity.ifc_type
            )));
        }

        // Get direction ratios (attribute 0)
        let ratios_attr = direction_entity
            .get(0)
            .ok_or_else(|| Error::geometry("IfcDirection missing ratios".to_string()))?;

        let ratios = ratios_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected ratio list".to_string()))?;

        let x = ratios.get(0).and_then(|v| v.as_float()).unwrap_or(0.0);
        let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

        Ok(Vector3::new(x, y, z))
    }
}

/// TriangulatedFaceSet processor (P0)
/// Handles IfcTriangulatedFaceSet - explicit triangle meshes
pub struct TriangulatedFaceSetProcessor;

impl TriangulatedFaceSetProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for TriangulatedFaceSetProcessor {
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

        // Get coordinates
        let coords_attr = entity
            .get(0)
            .ok_or_else(|| {
                Error::geometry("TriangulatedFaceSet missing Coordinates".to_string())
            })?;

        let coords_entity = decoder
            .resolve_ref(coords_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Coordinates".to_string()))?;

        // IfcCartesianPointList3D has CoordList attribute
        let coord_list_attr = coords_entity
            .get(0)
            .ok_or_else(|| Error::geometry("CartesianPointList3D missing CoordList".to_string()))?;

        let coord_list = coord_list_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;

        // Parse vertices
        let mut positions = Vec::with_capacity(coord_list.len() * 3);
        for coord_attr in coord_list {
            let coord = coord_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected coordinate triple".to_string()))?;

            use ifc_lite_core::AttributeValue;
            let x = coord.get(0).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0) as f32;
            let y = coord.get(1).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0) as f32;
            let z = coord.get(2).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0) as f32;

            positions.push(x);
            positions.push(y);
            positions.push(z);
        }

        // Get face indices
        let indices_attr = entity
            .get(3)
            .ok_or_else(|| Error::geometry("TriangulatedFaceSet missing CoordIndex".to_string()))?;

        let face_list = indices_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected face index list".to_string()))?;

        let mut indices = Vec::with_capacity(face_list.len() * 3);
        for face_attr in face_list {
            let face = face_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected face triple".to_string()))?;

            // IFC indices are 1-based, convert to 0-based
            use ifc_lite_core::AttributeValue;
            let i0 = face.get(0).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(1.0) as u32 - 1;
            let i1 = face.get(1).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(1.0) as u32 - 1;
            let i2 = face.get(2).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(1.0) as u32 - 1;

            indices.push(i0);
            indices.push(i1);
            indices.push(i2);
        }

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

/// FacetedBrep processor
/// Handles IfcFacetedBrep - explicit mesh with faces
/// Supports faces with inner bounds (holes)
pub struct FacetedBrepProcessor;

impl FacetedBrepProcessor {
    pub fn new() -> Self {
        Self
    }

    /// Extract polygon points from a loop entity
    fn extract_loop_points(
        &self,
        loop_entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Option<Vec<Point3<f64>>> {
        // Try to get Polygon attribute (attribute 0) - IfcPolyLoop has this
        let polygon_attr = loop_entity.get(0)?;
        let points = decoder.resolve_ref_list(polygon_attr).ok()?;

        let mut polygon_points = Vec::new();
        for point in points {
            let coords_attr = point.get(0)?;
            let coords = coords_attr.as_list()?;

            use ifc_lite_core::AttributeValue;
            let x = coords.get(0).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0);
            let y = coords.get(1).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0);
            let z = coords.get(2).and_then(|v: &AttributeValue| v.as_float()).unwrap_or(0.0);

            polygon_points.push(Point3::new(x, y, z));
        }

        if polygon_points.len() >= 3 {
            Some(polygon_points)
        } else {
            None
        }
    }
}

impl GeometryProcessor for FacetedBrepProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        use crate::triangulation::{triangulate_polygon_with_holes, calculate_polygon_normal, project_to_2d};

        // IfcFacetedBrep attributes:
        // 0: Outer (IfcClosedShell)

        // Get closed shell
        let shell_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("FacetedBrep missing Outer shell".to_string()))?;

        let shell_entity = decoder
            .resolve_ref(shell_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Outer shell".to_string()))?;

        // IfcClosedShell has CfsFaces attribute - list of faces
        let faces_attr = shell_entity
            .get(0)
            .ok_or_else(|| Error::geometry("ClosedShell missing CfsFaces".to_string()))?;

        let face_refs = decoder.resolve_ref_list(faces_attr)?;

        let mut positions = Vec::new();
        let mut indices = Vec::new();

        // Process each face
        for face in face_refs {
            // Try to get Bounds attribute (attribute 0)
            // IfcFace has Bounds attribute (list of IfcFaceBound)
            let bounds_attr = match face.get(0) {
                Some(attr) => attr,
                None => continue,
            };

            let bounds = match decoder.resolve_ref_list(bounds_attr) {
                Ok(b) => b,
                Err(_) => continue,
            };

            // Separate outer bound from inner bounds (holes)
            // IfcFaceOuterBound is type id for outer, IfcFaceBound for inner
            let mut outer_bound_points: Option<Vec<Point3<f64>>> = None;
            let mut hole_points: Vec<Vec<Point3<f64>>> = Vec::new();

            for bound in &bounds {
                // Get the loop from the bound
                let loop_attr = match bound.get(0) {
                    Some(attr) => attr,
                    None => continue,
                };

                let loop_entity = match decoder.resolve_ref(loop_attr) {
                    Ok(Some(e)) => e,
                    _ => continue,
                };

                // Get orientation (attribute 1) - .T. = same sense, .F. = reverse
                // Booleans in IFC are stored as Enum values like ".T." or ".F."
                let orientation = bound.get(1)
                    .and_then(|v| match v {
                        ifc_lite_core::AttributeValue::Enum(e) => Some(e != ".F."),
                        _ => Some(true), // Default to true
                    })
                    .unwrap_or(true);

                let mut points = match self.extract_loop_points(&loop_entity, decoder) {
                    Some(p) => p,
                    None => continue,
                };

                // Reverse points if orientation is false
                if !orientation {
                    points.reverse();
                }

                // Check if this is outer bound by IFC type
                // IfcFaceOuterBound type name contains "OUTER"
                let type_str = bound.ifc_type.as_str();
                let is_outer = type_str.contains("OUTER") || type_str.contains("outer");

                if is_outer || outer_bound_points.is_none() {
                    // First bound or explicit outer bound
                    if outer_bound_points.is_some() && is_outer {
                        // Move existing outer to holes if we found the real outer
                        if let Some(prev_outer) = outer_bound_points.take() {
                            hole_points.push(prev_outer);
                        }
                    }
                    outer_bound_points = Some(points);
                } else {
                    // Inner bound (hole)
                    hole_points.push(points);
                }
            }

            // Skip if no outer bound
            let outer_points = match outer_bound_points {
                Some(p) => p,
                None => continue,
            };

            // Calculate face normal from outer boundary
            let normal = calculate_polygon_normal(&outer_points);

            // Project outer boundary to 2D and get the coordinate system
            let (outer_2d, u_axis, v_axis, origin) = project_to_2d(&outer_points, &normal);

            // Project holes to 2D using the SAME coordinate system as the outer boundary
            use crate::triangulation::project_to_2d_with_basis;
            let holes_2d: Vec<Vec<nalgebra::Point2<f64>>> = hole_points
                .iter()
                .map(|hole| project_to_2d_with_basis(hole, &u_axis, &v_axis, &origin))
                .collect();

            // Triangulate with holes
            let tri_indices = match triangulate_polygon_with_holes(&outer_2d, &holes_2d) {
                Ok(idx) => idx,
                Err(_) => {
                    // Fallback to simple triangulation without holes if it fails
                    let base_idx = (positions.len() / 3) as u32;
                    for point in &outer_points {
                        positions.push(point.x as f32);
                        positions.push(point.y as f32);
                        positions.push(point.z as f32);
                    }
                    for i in 1..outer_points.len() - 1 {
                        indices.push(base_idx);
                        indices.push(base_idx + i as u32);
                        indices.push(base_idx + i as u32 + 1);
                    }
                    continue;
                }
            };

            // Combine all 3D points (outer + holes) in the same order as 2D
            let mut all_points_3d: Vec<Point3<f64>> = outer_points;
            for hole in hole_points {
                all_points_3d.extend(hole);
            }

            // Add vertices and triangles
            let base_idx = (positions.len() / 3) as u32;

            for point in &all_points_3d {
                positions.push(point.x as f32);
                positions.push(point.y as f32);
                positions.push(point.z as f32);
            }

            for i in (0..tri_indices.len()).step_by(3) {
                indices.push(base_idx + tri_indices[i] as u32);
                indices.push(base_idx + tri_indices[i + 1] as u32);
                indices.push(base_idx + tri_indices[i + 2] as u32);
            }
        }

        Ok(Mesh {
            positions,
            normals: Vec::new(),
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        // IfcFacetedBrep is an Unknown type, create it from string to get correct hash
        vec![IfcType::from_str("IFCFACETEDBREP").unwrap()]
    }
}

impl Default for FacetedBrepProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// BooleanClippingResult processor
/// Handles IfcBooleanClippingResult - CSG operations
/// For now, just processes the base geometry (FirstOperand)
pub struct BooleanClippingProcessor;

impl BooleanClippingProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for BooleanClippingProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcBooleanClippingResult attributes:
        // 0: Operator (DIFFERENCE, UNION, INTERSECTION)
        // 1: FirstOperand (base geometry)
        // 2: SecondOperand (clipping geometry)

        // For now, just process the base geometry (FirstOperand)
        // TODO: Implement actual CSG clipping
        let first_operand_attr = entity
            .get(1)
            .ok_or_else(|| Error::geometry("BooleanClippingResult missing FirstOperand".to_string()))?;

        let first_operand = decoder
            .resolve_ref(first_operand_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve FirstOperand".to_string()))?;

        // Process first operand based on its type - avoid creating new router
        match first_operand.ifc_type {
            IfcType::IfcExtrudedAreaSolid => {
                let processor = ExtrudedAreaSolidProcessor::new(schema.clone());
                processor.process(&first_operand, decoder, schema)
            }
            IfcType::IfcFacetedBrep => {
                let processor = FacetedBrepProcessor::new();
                processor.process(&first_operand, decoder, schema)
            }
            IfcType::IfcTriangulatedFaceSet => {
                let processor = TriangulatedFaceSetProcessor::new();
                processor.process(&first_operand, decoder, schema)
            }
            IfcType::IfcSweptDiskSolid => {
                let processor = SweptDiskSolidProcessor::new(schema.clone());
                processor.process(&first_operand, decoder, schema)
            }
            IfcType::IfcBooleanClippingResult => {
                // Recursive case - reuse self
                self.process(&first_operand, decoder, schema)
            }
            _ => Ok(Mesh::new()), // Skip unsupported types
        }
    }

    fn supported_types(&self) -> Vec<IfcType> {
        // IFCBOOLEANCLIPPINGRESULT is an Unknown type
        vec![IfcType::from_str("IFCBOOLEANCLIPPINGRESULT").unwrap()]
    }
}

impl Default for BooleanClippingProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// MappedItem processor (P0)
/// Handles IfcMappedItem - geometry instancing
pub struct MappedItemProcessor;

impl MappedItemProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for MappedItemProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcMappedItem attributes:
        // 0: MappingSource (IfcRepresentationMap)
        // 1: MappingTarget (IfcCartesianTransformationOperator)

        // Get mapping source
        let source_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("MappedItem missing MappingSource".to_string()))?;

        let source_entity = decoder
            .resolve_ref(source_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve MappingSource".to_string()))?;

        // IfcRepresentationMap has:
        // 0: MappingOrigin (IfcAxis2Placement)
        // 1: MappedRepresentation (IfcRepresentation)

        let mapped_rep_attr = source_entity
            .get(1)
            .ok_or_else(|| {
                Error::geometry("RepresentationMap missing MappedRepresentation".to_string())
            })?;

        let mapped_rep = decoder
            .resolve_ref(mapped_rep_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve MappedRepresentation".to_string()))?;

        // Get representation items
        let items_attr = mapped_rep
            .get(3)
            .ok_or_else(|| Error::geometry("Representation missing Items".to_string()))?;

        let items = decoder.resolve_ref_list(items_attr)?;

        // Process all items and merge
        let mut mesh = Mesh::new();
        for item in items {
            let item_mesh = match item.ifc_type {
                IfcType::IfcExtrudedAreaSolid => {
                    let processor = ExtrudedAreaSolidProcessor::new(schema.clone());
                    processor.process(&item, decoder, schema)?
                }
                IfcType::IfcTriangulatedFaceSet => {
                    let processor = TriangulatedFaceSetProcessor::new();
                    processor.process(&item, decoder, schema)?
                }
                IfcType::IfcFacetedBrep => {
                    let processor = FacetedBrepProcessor::new();
                    processor.process(&item, decoder, schema)?
                }
                IfcType::IfcSweptDiskSolid => {
                    let processor = SweptDiskSolidProcessor::new(schema.clone());
                    processor.process(&item, decoder, schema)?
                }
                IfcType::IfcBooleanClippingResult => {
                    let processor = BooleanClippingProcessor::new();
                    processor.process(&item, decoder, schema)?
                }
                _ => continue, // Skip unsupported types
            };
            mesh.merge(&item_mesh);
        }

        // TODO: Apply mapping transformation from MappingTarget

        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcMappedItem]
    }
}

impl Default for MappedItemProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// SweptDiskSolid processor
/// Handles IfcSweptDiskSolid - sweeps a circular profile along a curve
pub struct SweptDiskSolidProcessor {
    profile_processor: ProfileProcessor,
}

impl SweptDiskSolidProcessor {
    pub fn new(schema: IfcSchema) -> Self {
        Self {
            profile_processor: ProfileProcessor::new(schema),
        }
    }
}

impl GeometryProcessor for SweptDiskSolidProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcSweptDiskSolid attributes:
        // 0: Directrix (IfcCurve) - the path to sweep along
        // 1: Radius (IfcPositiveLengthMeasure) - outer radius
        // 2: InnerRadius (optional) - inner radius for hollow tubes
        // 3: StartParam (optional)
        // 4: EndParam (optional)

        let directrix_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("SweptDiskSolid missing Directrix".to_string()))?;

        let radius = entity
            .get_float(1)
            .ok_or_else(|| Error::geometry("SweptDiskSolid missing Radius".to_string()))?;

        // Get inner radius if hollow
        let inner_radius = entity.get_float(2);

        // Resolve the directrix curve
        let directrix = decoder
            .resolve_ref(directrix_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Directrix".to_string()))?;

        // Get points along the curve
        let curve_points = self.profile_processor.get_curve_points(&directrix, decoder)?;

        if curve_points.len() < 2 {
            return Ok(Mesh::new()); // Not enough points
        }

        // Generate tube mesh by sweeping circle along curve
        let segments = 12; // Number of segments around the circle
        let mut positions = Vec::new();
        let mut indices = Vec::new();

        // For each point on the curve, create a ring of vertices
        for i in 0..curve_points.len() {
            let p = curve_points[i];

            // Calculate tangent direction
            let tangent = if i == 0 {
                (curve_points[1] - curve_points[0]).normalize()
            } else if i == curve_points.len() - 1 {
                (curve_points[i] - curve_points[i - 1]).normalize()
            } else {
                ((curve_points[i + 1] - curve_points[i - 1]) / 2.0).normalize()
            };

            // Create perpendicular vectors using cross product
            // First, find a vector not parallel to tangent
            let up = if tangent.x.abs() < 0.9 {
                Vector3::new(1.0, 0.0, 0.0)
            } else {
                Vector3::new(0.0, 1.0, 0.0)
            };

            let perp1 = tangent.cross(&up).normalize();
            let perp2 = tangent.cross(&perp1).normalize();

            // Create ring of vertices
            for j in 0..segments {
                let angle = 2.0 * std::f64::consts::PI * j as f64 / segments as f64;
                let offset = perp1 * (radius * angle.cos()) + perp2 * (radius * angle.sin());
                let vertex = p + offset;

                positions.push(vertex.x as f32);
                positions.push(vertex.y as f32);
                positions.push(vertex.z as f32);
            }

            // Create triangles connecting this ring to the next
            if i < curve_points.len() - 1 {
                let base = (i * segments) as u32;
                let next_base = ((i + 1) * segments) as u32;

                for j in 0..segments {
                    let j_next = (j + 1) % segments;

                    // Two triangles per quad
                    indices.push(base + j as u32);
                    indices.push(next_base + j as u32);
                    indices.push(next_base + j_next as u32);

                    indices.push(base + j as u32);
                    indices.push(next_base + j_next as u32);
                    indices.push(base + j_next as u32);
                }
            }
        }

        // Add end caps
        // Start cap
        let center_idx = (positions.len() / 3) as u32;
        let start = curve_points[0];
        positions.push(start.x as f32);
        positions.push(start.y as f32);
        positions.push(start.z as f32);

        for j in 0..segments {
            let j_next = (j + 1) % segments;
            indices.push(center_idx);
            indices.push(j_next as u32);
            indices.push(j as u32);
        }

        // End cap
        let end_center_idx = (positions.len() / 3) as u32;
        let end_base = ((curve_points.len() - 1) * segments) as u32;
        let end = curve_points[curve_points.len() - 1];
        positions.push(end.x as f32);
        positions.push(end.y as f32);
        positions.push(end.z as f32);

        for j in 0..segments {
            let j_next = (j + 1) % segments;
            indices.push(end_center_idx);
            indices.push(end_base + j as u32);
            indices.push(end_base + j_next as u32);
        }

        Ok(Mesh {
            positions,
            normals: Vec::new(),
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcSweptDiskSolid]
    }
}

impl Default for SweptDiskSolidProcessor {
    fn default() -> Self {
        Self::new(IfcSchema::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(mesh.positions.len() > 0);
        assert!(mesh.indices.len() > 0);
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
}
