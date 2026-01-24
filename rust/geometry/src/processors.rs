// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometry Processors - P0 implementations
//!
//! High-priority processors for common IFC geometry types.

use crate::{
    extrusion::{apply_transform, extrude_profile},
    profiles::ProfileProcessor,
    Error, Mesh, Point2, Point3, Result, Vector3,
};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcSchema, IfcType};
use nalgebra::Matrix4;

use super::router::GeometryProcessor;

/// Extract CoordIndex bytes from IfcTriangulatedFaceSet raw entity
///
/// Finds the 4th attribute (CoordIndex, 0-indexed as 3) in:
/// `#77=IFCTRIANGULATEDFACESET(#78,$,$,((1,2,3),(2,1,4),...),$);`
///
/// Returns the byte slice containing just the index list data.
/// Performs structural validation to reject malformed input.
#[inline]
fn extract_coord_index_bytes(bytes: &[u8]) -> Option<&[u8]> {
    // Find opening paren after = sign
    let eq_pos = bytes.iter().position(|&b| b == b'=')?;
    let open_paren = bytes[eq_pos..].iter().position(|&b| b == b'(')?;
    let args_start = eq_pos + open_paren + 1;

    // Navigate through attributes counting at depth 1
    let mut depth = 1;
    let mut attr_count = 0;
    let mut attr_start = args_start;
    let mut i = args_start;
    let mut in_string = false;

    while i < bytes.len() && depth > 0 {
        let b = bytes[i];

        // Handle string literals - skip content inside quotes
        if b == b'\'' {
            in_string = !in_string;
            i += 1;
            continue;
        }
        if in_string {
            i += 1;
            continue;
        }

        // Skip comments (/* ... */)
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            continue;
        }

        match b {
            b'(' => {
                if depth == 1 && attr_count == 3 {
                    // Found start of 4th attribute (CoordIndex)
                    attr_start = i;
                }
                depth += 1;
            }
            b')' => {
                depth -= 1;
                if depth == 1 && attr_count == 3 {
                    // Found end of CoordIndex - validate before returning
                    let candidate = &bytes[attr_start..i + 1];
                    if validate_coord_index_structure(candidate) {
                        return Some(candidate);
                    }
                    // Invalid structure, continue searching or return None
                    return None;
                }
            }
            b',' if depth == 1 => {
                attr_count += 1;
            }
            b'$' if depth == 1 && attr_count == 3 => {
                // CoordIndex is $ (null), skip it
                return None;
            }
            _ => {}
        }
        i += 1;
    }

    None
}

/// Validate that a byte slice has valid CoordIndex structure:
/// - Must start with '(' and end with ')'
/// - Must contain comma-separated parenthesized integer lists
/// - Allowed tokens: digits, commas, parentheses, whitespace
/// - Rejected: '$', unbalanced parens, quotes, comment markers
#[inline]
fn validate_coord_index_structure(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }

    // Must start with '(' and end with ')'
    let first = bytes.first().copied();
    let last = bytes.last().copied();
    if first != Some(b'(') || last != Some(b')') {
        return false;
    }

    // Check structure: only allow digits, commas, parens, whitespace
    let mut depth = 0;
    for &b in bytes {
        match b {
            b'(' => depth += 1,
            b')' => {
                if depth == 0 {
                    return false; // Unbalanced
                }
                depth -= 1;
            }
            b'0'..=b'9' | b',' | b' ' | b'\t' | b'\n' | b'\r' | b'-' => {}
            b'$' | b'\'' | b'"' | b'/' | b'*' | b'#' => {
                // Invalid characters for CoordIndex
                return false;
            }
            _ => {
                // Allow other whitespace-like chars, reject letters
                if b.is_ascii_alphabetic() {
                    return false;
                }
            }
        }
    }

    // Must have balanced parens
    depth == 0
}

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

        let profile = self.profile_processor.process(&profile_entity, decoder)?;

        if profile.outer.is_empty() {
            return Ok(Mesh::new());
        }

        // Get extrusion direction
        let direction_attr = entity.get(2).ok_or_else(|| {
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
        let dir_x = ratios
            .first()
            .and_then(|v: &AttributeValue| v.as_float())
            .unwrap_or(0.0);
        let dir_y = ratios
            .get(1)
            .and_then(|v: &AttributeValue| v.as_float())
            .unwrap_or(0.0);
        let dir_z = ratios
            .get(2)
            .and_then(|v: &AttributeValue| v.as_float())
            .unwrap_or(1.0);

        let local_direction = Vector3::new(dir_x, dir_y, dir_z).normalize();

        // Get depth
        let depth = entity
            .get_float(3)
            .ok_or_else(|| Error::geometry("ExtrudedAreaSolid missing Depth".to_string()))?;

        // Parse Position transform first (attribute 1: IfcAxis2Placement3D)
        // We need Position's rotation to transform ExtrudedDirection to world coordinates
        let pos_transform = if let Some(pos_attr) = entity.get(1) {
            if !pos_attr.is_null() {
                if let Some(pos_entity) = decoder.resolve_ref(pos_attr)? {
                    if pos_entity.ifc_type == IfcType::IfcAxis2Placement3D {
                        Some(self.parse_axis2_placement_3d(&pos_entity, decoder)?)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // ExtrudedDirection is in the LOCAL coordinate system (before Position transform).
        // We need to determine when to add an extrusion rotation vs. letting Position handle it.
        //
        // Two key cases:
        // 1. Opening: local_direction=(0,0,-1), Position rotates local Z to world Y
        //    -> local_direction IS along Z, so no rotation needed; Position handles orientation
        // 2. Roof slab: local_direction=(0,-0.5,0.866), Position tilts the profile
        //    -> world_direction = Position.rotation * local_direction = (0,0,1) (along world Z!)
        //    -> No extra rotation needed; Position handles the tilt
        //
        // Check if local direction is along Z axis
        // Note: We only check local direction because extrusion happens in LOCAL coordinates
        // before the Position transform is applied. What the direction becomes in world
        // space is irrelevant to the extrusion operation.
        let is_local_z_aligned = local_direction.x.abs() < 0.001 && local_direction.y.abs() < 0.001;

        let transform = if is_local_z_aligned {
            // Local direction is along Z - no extra rotation needed.
            // Position transform will handle the correct orientation.
            // Only need translation if extruding in negative direction.
            if local_direction.z < 0.0 {
                // Downward extrusion: shift the extrusion down by depth
                Some(Matrix4::new_translation(&Vector3::new(0.0, 0.0, -depth)))
            } else {
                None
            }
        } else {
            // Local direction is NOT along Z - use SHEAR matrix (not rotation!)
            // A shear preserves the profile plane orientation while redirecting extrusion.
            //
            // For ExtrudedDirection (dx, dy, dz), the shear matrix is:
            // | 1    0    dx |
            // | 0    1    dy |
            // | 0    0    dz |
            //
            // This transforms (x, y, depth) to (x + dx*depth, y + dy*depth, dz*depth)
            // while keeping (x, y, 0) unchanged.
            let mut shear_mat = Matrix4::identity();
            shear_mat[(0, 2)] = local_direction.x;  // X shear from Z
            shear_mat[(1, 2)] = local_direction.y;  // Y shear from Z
            shear_mat[(2, 2)] = local_direction.z;  // Z scale
            
            Some(shear_mat)
        };

        // Extrude the profile
        let mut mesh = extrude_profile(&profile, depth, transform)?;

        // Apply Position transform
        if let Some(pos) = pos_transform {
            apply_transform(&mut mesh, &pos);
        }

        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcExtrudedAreaSolid]
    }
}

impl ExtrudedAreaSolidProcessor {
    /// Parse IfcAxis2Placement3D into transformation matrix
    #[inline]
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
    #[inline]
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

        let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
        let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

        Ok(Point3::new(x, y, z))
    }

    /// Parse IfcDirection
    #[inline]
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

        let x = ratios.first().and_then(|v| v.as_float()).unwrap_or(0.0);
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
            if let Some(coord_index_bytes) = extract_coord_index_bytes(raw_entity_bytes) {
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

    /// Triangulate a polygon using fan triangulation
    /// Works for convex polygons and most well-formed concave polygons
    /// IFC indices are 1-based, so we subtract 1 to get 0-based indices
    #[inline]
    fn triangulate_polygon(indices: &[u32], output: &mut Vec<u32>) {
        if indices.len() < 3 {
            return;
        }
        // Fan triangulation: first vertex connects to all other edges
        let first = indices[0] - 1; // Convert 1-based to 0-based
        for i in 1..indices.len() - 1 {
            output.push(first);
            output.push(indices[i] - 1);
            output.push(indices[i + 1] - 1);
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

            // Triangulate the polygon
            Self::triangulate_polygon(&face_indices, &mut indices);
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

/// Face data extracted from IFC for parallel triangulation
struct FaceData {
    outer_points: Vec<Point3<f64>>,
    hole_points: Vec<Vec<Point3<f64>>>,
}

/// Triangulated face result
struct FaceResult {
    positions: Vec<f32>,
    indices: Vec<u32>,
}

/// FacetedBrep processor
/// Handles IfcFacetedBrep - explicit mesh with faces
/// Supports faces with inner bounds (holes)
/// Uses parallel triangulation for large BREPs
pub struct FacetedBrepProcessor;

impl FacetedBrepProcessor {
    pub fn new() -> Self {
        Self
    }

    /// Extract polygon points from a loop entity
    /// Uses fast path for CartesianPoint extraction to avoid decode overhead
    #[allow(dead_code)]
    #[inline]
    fn extract_loop_points(
        &self,
        loop_entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Option<Vec<Point3<f64>>> {
        // Try to get Polygon attribute (attribute 0) - IfcPolyLoop has this
        let polygon_attr = loop_entity.get(0)?;

        // Get the list of point references directly
        let point_refs = polygon_attr.as_list()?;

        // Pre-allocate with known size
        let mut polygon_points = Vec::with_capacity(point_refs.len());

        for point_ref in point_refs {
            let point_id = point_ref.as_entity_ref()?;

            // Try fast path first
            if let Some((x, y, z)) = decoder.get_cartesian_point_fast(point_id) {
                polygon_points.push(Point3::new(x, y, z));
            } else {
                // Fallback to standard path if fast extraction fails
                let point = decoder.decode_by_id(point_id).ok()?;
                let coords_attr = point.get(0)?;
                let coords = coords_attr.as_list()?;
                use ifc_lite_core::AttributeValue;
                let x = coords.first().and_then(|v: &AttributeValue| v.as_float())?;
                let y = coords.get(1).and_then(|v: &AttributeValue| v.as_float())?;
                let z = coords.get(2).and_then(|v: &AttributeValue| v.as_float())?;
                polygon_points.push(Point3::new(x, y, z));
            }
        }

        if polygon_points.len() >= 3 {
            Some(polygon_points)
        } else {
            None
        }
    }

    /// Extract polygon points using ultra-fast path from loop entity ID
    /// Uses cached coordinate extraction - points are cached across faces
    /// This is the fastest path for files with shared cartesian points
    #[inline]
    fn extract_loop_points_fast(
        &self,
        loop_entity_id: u32,
        decoder: &mut EntityDecoder,
    ) -> Option<Vec<Point3<f64>>> {
        // ULTRA-FAST PATH with CACHING: Get coordinates with point cache
        // Many faces share the same cartesian points, so caching avoids
        // re-parsing the same point data multiple times
        let coords = decoder.get_polyloop_coords_cached(loop_entity_id)?;

        // Convert to Point3 - pre-allocated in get_polyloop_coords_cached
        let polygon_points: Vec<Point3<f64>> = coords
            .into_iter()
            .map(|(x, y, z)| Point3::new(x, y, z))
            .collect();

        if polygon_points.len() >= 3 {
            Some(polygon_points)
        } else {
            None
        }
    }

    /// Triangulate a single face (can be called in parallel)
    /// Optimized with fast paths for simple faces
    #[inline]
    fn triangulate_face(face: &FaceData) -> FaceResult {
        let n = face.outer_points.len();

        // FAST PATH: Triangle without holes - no triangulation needed
        if n == 3 && face.hole_points.is_empty() {
            let mut positions = Vec::with_capacity(9);
            for point in &face.outer_points {
                positions.push(point.x as f32);
                positions.push(point.y as f32);
                positions.push(point.z as f32);
            }
            return FaceResult {
                positions,
                indices: vec![0, 1, 2],
            };
        }

        // FAST PATH: Quad without holes - simple fan
        if n == 4 && face.hole_points.is_empty() {
            let mut positions = Vec::with_capacity(12);
            for point in &face.outer_points {
                positions.push(point.x as f32);
                positions.push(point.y as f32);
                positions.push(point.z as f32);
            }
            return FaceResult {
                positions,
                indices: vec![0, 1, 2, 0, 2, 3],
            };
        }

        // FAST PATH: Simple convex polygon without holes
        if face.hole_points.is_empty() && n <= 8 {
            // Check if convex by testing cross products in 3D
            let mut is_convex = true;
            if n > 4 {
                use crate::triangulation::calculate_polygon_normal;
                let normal = calculate_polygon_normal(&face.outer_points);
                let mut sign = 0i8;

                for i in 0..n {
                    let p0 = &face.outer_points[i];
                    let p1 = &face.outer_points[(i + 1) % n];
                    let p2 = &face.outer_points[(i + 2) % n];

                    let v1 = p1 - p0;
                    let v2 = p2 - p1;
                    let cross = v1.cross(&v2);
                    let dot = cross.dot(&normal);

                    if dot.abs() > 1e-10 {
                        let current_sign = if dot > 0.0 { 1i8 } else { -1i8 };
                        if sign == 0 {
                            sign = current_sign;
                        } else if sign != current_sign {
                            is_convex = false;
                            break;
                        }
                    }
                }
            }

            if is_convex {
                let mut positions = Vec::with_capacity(n * 3);
                for point in &face.outer_points {
                    positions.push(point.x as f32);
                    positions.push(point.y as f32);
                    positions.push(point.z as f32);
                }
                let mut indices = Vec::with_capacity((n - 2) * 3);
                for i in 1..n - 1 {
                    indices.push(0);
                    indices.push(i as u32);
                    indices.push(i as u32 + 1);
                }
                return FaceResult { positions, indices };
            }
        }

        // SLOW PATH: Complex polygon or polygon with holes
        use crate::triangulation::{
            calculate_polygon_normal, project_to_2d, project_to_2d_with_basis,
            triangulate_polygon_with_holes,
        };

        let mut positions = Vec::new();
        let mut indices = Vec::new();

        // Calculate face normal from outer boundary
        let normal = calculate_polygon_normal(&face.outer_points);

        // Project outer boundary to 2D and get the coordinate system
        let (outer_2d, u_axis, v_axis, origin) = project_to_2d(&face.outer_points, &normal);

        // Project holes to 2D using the SAME coordinate system as the outer boundary
        let holes_2d: Vec<Vec<nalgebra::Point2<f64>>> = face
            .hole_points
            .iter()
            .map(|hole| project_to_2d_with_basis(hole, &u_axis, &v_axis, &origin))
            .collect();

        // Triangulate with holes
        let tri_indices = match triangulate_polygon_with_holes(&outer_2d, &holes_2d) {
            Ok(idx) => idx,
            Err(_) => {
                // Fallback to simple fan triangulation without holes
                for point in &face.outer_points {
                    positions.push(point.x as f32);
                    positions.push(point.y as f32);
                    positions.push(point.z as f32);
                }
                for i in 1..face.outer_points.len() - 1 {
                    indices.push(0);
                    indices.push(i as u32);
                    indices.push(i as u32 + 1);
                }
                return FaceResult { positions, indices };
            }
        };

        // Combine all 3D points (outer + holes) in the same order as 2D
        let mut all_points_3d: Vec<&Point3<f64>> = face.outer_points.iter().collect();
        for hole in &face.hole_points {
            all_points_3d.extend(hole.iter());
        }

        // Add vertices
        for point in &all_points_3d {
            positions.push(point.x as f32);
            positions.push(point.y as f32);
            positions.push(point.z as f32);
        }

        // Add triangle indices
        for i in (0..tri_indices.len()).step_by(3) {
            indices.push(tri_indices[i] as u32);
            indices.push(tri_indices[i + 1] as u32);
            indices.push(tri_indices[i + 2] as u32);
        }

        FaceResult { positions, indices }
    }

    /// Batch process multiple FacetedBrep entities for maximum parallelism
    /// Extracts all face data sequentially, then triangulates ALL faces in one parallel batch
    /// Returns Vec of (brep_index, Mesh) pairs
    pub fn process_batch(
        &self,
        brep_ids: &[u32],
        decoder: &mut EntityDecoder,
    ) -> Vec<(usize, Mesh)> {
        #[cfg(not(target_arch = "wasm32"))]
        use rayon::prelude::*;

        // PHASE 1: Sequential - Extract all face data from all BREPs
        // Each entry: (brep_index, face_data)
        let mut all_faces: Vec<(usize, FaceData)> = Vec::with_capacity(brep_ids.len() * 10);

        for (brep_idx, &brep_id) in brep_ids.iter().enumerate() {
            // FAST PATH: Get shell ID directly from raw bytes (avoids full entity decode)
            let shell_id = match decoder.get_first_entity_ref_fast(brep_id) {
                Some(id) => id,
                None => continue,
            };

            // FAST PATH: Get face IDs from shell using raw bytes
            let face_ids = match decoder.get_entity_ref_list_fast(shell_id) {
                Some(ids) => ids,
                None => continue,
            };

            // Extract face data for each face
            for face_id in face_ids {
                let bound_ids = match decoder.get_entity_ref_list_fast(face_id) {
                    Some(ids) => ids,
                    None => continue,
                };

                let mut outer_bound_points: Option<Vec<Point3<f64>>> = None;
                let mut hole_points: Vec<Vec<Point3<f64>>> = Vec::new();

                for bound_id in bound_ids {
                    // FAST PATH: Extract loop_id, orientation, is_outer from raw bytes
                    // get_face_bound_fast returns (loop_id, orientation, is_outer)
                    let (loop_id, orientation, is_outer) =
                        match decoder.get_face_bound_fast(bound_id) {
                            Some(data) => data,
                            None => continue,
                        };

                    // FAST PATH: Get loop points directly from entity ID
                    let mut points = match self.extract_loop_points_fast(loop_id, decoder) {
                        Some(p) => p,
                        None => continue,
                    };

                    if !orientation {
                        points.reverse();
                    }

                    if is_outer || outer_bound_points.is_none() {
                        if outer_bound_points.is_some() && is_outer {
                            if let Some(prev_outer) = outer_bound_points.take() {
                                hole_points.push(prev_outer);
                            }
                        }
                        outer_bound_points = Some(points);
                    } else {
                        hole_points.push(points);
                    }
                }

                if let Some(outer_points) = outer_bound_points {
                    all_faces.push((
                        brep_idx,
                        FaceData {
                            outer_points,
                            hole_points,
                        },
                    ));
                }
            }
        }

        // PHASE 2: Triangulate ALL faces from ALL BREPs in one batch
        // On native: use parallel iteration for multi-core speedup
        // On WASM: use sequential iteration (no threads available, par_iter adds overhead)
        #[cfg(not(target_arch = "wasm32"))]
        let face_results: Vec<(usize, FaceResult)> = all_faces
            .par_iter()
            .map(|(brep_idx, face)| (*brep_idx, Self::triangulate_face(face)))
            .collect();

        #[cfg(target_arch = "wasm32")]
        let face_results: Vec<(usize, FaceResult)> = all_faces
            .iter()
            .map(|(brep_idx, face)| (*brep_idx, Self::triangulate_face(face)))
            .collect();

        // PHASE 3: Group results back by BREP index
        // First, count faces per BREP to pre-allocate
        let mut face_counts = vec![0usize; brep_ids.len()];
        for (brep_idx, _) in &face_results {
            face_counts[*brep_idx] += 1;
        }

        // Initialize mesh builders for each BREP
        let mut mesh_builders: Vec<(Vec<f32>, Vec<u32>)> = face_counts
            .iter()
            .map(|&count| {
                (
                    Vec::with_capacity(count * 100),
                    Vec::with_capacity(count * 50),
                )
            })
            .collect();

        // Merge face results into their respective meshes
        for (brep_idx, result) in face_results {
            let (positions, indices) = &mut mesh_builders[brep_idx];
            let base_idx = (positions.len() / 3) as u32;
            positions.extend(result.positions);
            for idx in result.indices {
                indices.push(base_idx + idx);
            }
        }

        // Convert to final meshes
        mesh_builders
            .into_iter()
            .enumerate()
            .filter(|(_, (positions, _))| !positions.is_empty())
            .map(|(brep_idx, (positions, indices))| {
                (
                    brep_idx,
                    Mesh {
                        positions,
                        normals: Vec::new(),
                        indices,
                    },
                )
            })
            .collect()
    }
}

impl GeometryProcessor for FacetedBrepProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        #[cfg(not(target_arch = "wasm32"))]
        use rayon::prelude::*;

        // IfcFacetedBrep attributes:
        // 0: Outer (IfcClosedShell)

        // Get closed shell ID
        let shell_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("FacetedBrep missing Outer shell".to_string()))?;

        let shell_id = shell_attr
            .as_entity_ref()
            .ok_or_else(|| Error::geometry("Expected entity ref for Outer shell".to_string()))?;

        // FAST PATH: Get face IDs directly from ClosedShell raw bytes
        let face_ids = decoder
            .get_entity_ref_list_fast(shell_id)
            .ok_or_else(|| Error::geometry("Failed to get faces from ClosedShell".to_string()))?;

        // PHASE 1: Sequential - Extract all face data from IFC entities
        let mut face_data_list: Vec<FaceData> = Vec::with_capacity(face_ids.len());

        for face_id in face_ids {
            // FAST PATH: Get bound IDs directly from Face raw bytes
            let bound_ids = match decoder.get_entity_ref_list_fast(face_id) {
                Some(ids) => ids,
                None => continue,
            };

            // Separate outer bound from inner bounds (holes)
            let mut outer_bound_points: Option<Vec<Point3<f64>>> = None;
            let mut hole_points: Vec<Vec<Point3<f64>>> = Vec::new();

            for bound_id in bound_ids {
                // FAST PATH: Extract loop_id, orientation, is_outer from raw bytes
                // get_face_bound_fast returns (loop_id, orientation, is_outer)
                let (loop_id, orientation, is_outer) =
                    match decoder.get_face_bound_fast(bound_id) {
                        Some(data) => data,
                        None => continue,
                    };

                // FAST PATH: Get loop points directly from entity ID
                let mut points = match self.extract_loop_points_fast(loop_id, decoder) {
                    Some(p) => p,
                    None => continue,
                };

                if !orientation {
                    points.reverse();
                }

                if is_outer || outer_bound_points.is_none() {
                    if outer_bound_points.is_some() && is_outer {
                        if let Some(prev_outer) = outer_bound_points.take() {
                            hole_points.push(prev_outer);
                        }
                    }
                    outer_bound_points = Some(points);
                } else {
                    hole_points.push(points);
                }
            }

            if let Some(outer_points) = outer_bound_points {
                face_data_list.push(FaceData {
                    outer_points,
                    hole_points,
                });
            }
        }

        // PHASE 2: Triangulate all faces
        // On native: use parallel iteration for multi-core speedup
        // On WASM: use sequential iteration (no threads available)
        #[cfg(not(target_arch = "wasm32"))]
        let face_results: Vec<FaceResult> = face_data_list
            .par_iter()
            .map(Self::triangulate_face)
            .collect();

        #[cfg(target_arch = "wasm32")]
        let face_results: Vec<FaceResult> = face_data_list
            .iter()
            .map(Self::triangulate_face)
            .collect();

        // PHASE 3: Sequential - Merge all face results into final mesh
        // Pre-calculate total sizes for efficient allocation
        let total_positions: usize = face_results.iter().map(|r| r.positions.len()).sum();
        let total_indices: usize = face_results.iter().map(|r| r.indices.len()).sum();

        let mut positions = Vec::with_capacity(total_positions);
        let mut indices = Vec::with_capacity(total_indices);

        for result in face_results {
            let base_idx = (positions.len() / 3) as u32;
            positions.extend(result.positions);

            // Offset indices by base
            for idx in result.indices {
                indices.push(base_idx + idx);
            }
        }

        Ok(Mesh {
            positions,
            normals: Vec::new(),
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcFacetedBrep]
    }
}

impl Default for FacetedBrepProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// FaceBasedSurfaceModel processor
/// Handles IfcFaceBasedSurfaceModel - surface model made of connected face sets
/// Structure: FaceBasedSurfaceModel -> ConnectedFaceSet[] -> Face[] -> FaceBound -> PolyLoop
pub struct FaceBasedSurfaceModelProcessor;

impl FaceBasedSurfaceModelProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for FaceBasedSurfaceModelProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcFaceBasedSurfaceModel attributes:
        // 0: FbsmFaces (SET of IfcConnectedFaceSet)

        let faces_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("FaceBasedSurfaceModel missing FbsmFaces".to_string()))?;

        let face_set_refs = faces_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected face set list".to_string()))?;

        let mut all_positions = Vec::new();
        let mut all_indices = Vec::new();

        // Process each connected face set
        for face_set_ref in face_set_refs {
            let face_set_id = face_set_ref.as_entity_ref().ok_or_else(|| {
                Error::geometry("Expected entity reference for face set".to_string())
            })?;

            // Get face IDs from ConnectedFaceSet
            let face_ids = match decoder.get_entity_ref_list_fast(face_set_id) {
                Some(ids) => ids,
                None => continue,
            };

            // Process each face in the set
            for face_id in face_ids {
                // Get bound IDs from Face
                let bound_ids = match decoder.get_entity_ref_list_fast(face_id) {
                    Some(ids) => ids,
                    None => continue,
                };

                let mut outer_points: Option<Vec<Point3<f64>>> = None;
                let mut hole_points: Vec<Vec<Point3<f64>>> = Vec::new();

                for bound_id in bound_ids {
                    // FAST PATH: Extract loop_id, orientation, is_outer from raw bytes
                    // get_face_bound_fast returns (loop_id, orientation, is_outer)
                    let (loop_id, orientation, is_outer) =
                        match decoder.get_face_bound_fast(bound_id) {
                            Some(data) => data,
                            None => continue,
                        };

                    // Get loop points
                    let mut points = match Self::extract_loop_points(loop_id, decoder) {
                        Some(p) => p,
                        None => continue,
                    };

                    if !orientation {
                        points.reverse();
                    }

                    if is_outer || outer_points.is_none() {
                        outer_points = Some(points);
                    } else {
                        hole_points.push(points);
                    }
                }

                // Triangulate the face
                if let Some(outer) = outer_points {
                    if outer.len() >= 3 {
                        let base_idx = (all_positions.len() / 3) as u32;

                        // Add positions
                        for p in &outer {
                            all_positions.push(p.x as f32);
                            all_positions.push(p.y as f32);
                            all_positions.push(p.z as f32);
                        }

                        // Simple fan triangulation (works for convex faces)
                        for i in 1..outer.len() - 1 {
                            all_indices.push(base_idx);
                            all_indices.push(base_idx + i as u32);
                            all_indices.push(base_idx + i as u32 + 1);
                        }
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
        vec![IfcType::IfcFaceBasedSurfaceModel]
    }
}

impl FaceBasedSurfaceModelProcessor {
    /// Extract points from a PolyLoop entity
    fn extract_loop_points(loop_id: u32, decoder: &mut EntityDecoder) -> Option<Vec<Point3<f64>>> {
        let point_ids = decoder.get_polyloop_point_ids_fast(loop_id)?;

        let mut points = Vec::with_capacity(point_ids.len());
        for point_id in point_ids {
            let (x, y, z) = decoder.get_cartesian_point_fast(point_id)?;
            points.push(Point3::new(x, y, z));
        }

        if points.len() >= 3 {
            Some(points)
        } else {
            None
        }
    }
}

impl Default for FaceBasedSurfaceModelProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// ShellBasedSurfaceModel processor
/// Handles IfcShellBasedSurfaceModel - surface model made of shells
/// Structure: ShellBasedSurfaceModel -> Shell[] -> Face[] -> FaceBound -> PolyLoop
pub struct ShellBasedSurfaceModelProcessor;

impl ShellBasedSurfaceModelProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for ShellBasedSurfaceModelProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcShellBasedSurfaceModel attributes:
        // 0: SbsmBoundary (SET of IfcShell - either IfcOpenShell or IfcClosedShell)

        let shells_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("ShellBasedSurfaceModel missing SbsmBoundary".to_string()))?;

        let shell_refs = shells_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected shell list".to_string()))?;

        let mut all_positions = Vec::new();
        let mut all_indices = Vec::new();

        // Process each shell
        for shell_ref in shell_refs {
            let shell_id = shell_ref.as_entity_ref().ok_or_else(|| {
                Error::geometry("Expected entity reference for shell".to_string())
            })?;

            // Get face IDs from Shell (IfcOpenShell or IfcClosedShell)
            // Both have CfsFaces as attribute 0
            let face_ids = match decoder.get_entity_ref_list_fast(shell_id) {
                Some(ids) => ids,
                None => continue,
            };

            // Process each face in the shell
            for face_id in face_ids {
                // Get bound IDs from Face
                let bound_ids = match decoder.get_entity_ref_list_fast(face_id) {
                    Some(ids) => ids,
                    None => continue,
                };

                let mut outer_points: Option<Vec<Point3<f64>>> = None;
                let mut hole_points: Vec<Vec<Point3<f64>>> = Vec::new();

                for bound_id in bound_ids {
                    // FAST PATH: Extract loop_id, orientation, is_outer from raw bytes
                    let (loop_id, orientation, is_outer) =
                        match decoder.get_face_bound_fast(bound_id) {
                            Some(data) => data,
                            None => continue,
                        };

                    // Get loop points
                    let mut points = match Self::extract_loop_points(loop_id, decoder) {
                        Some(p) => p,
                        None => continue,
                    };

                    if !orientation {
                        points.reverse();
                    }

                    if is_outer || outer_points.is_none() {
                        outer_points = Some(points);
                    } else {
                        hole_points.push(points);
                    }
                }

                // Triangulate the face
                if let Some(outer) = outer_points {
                    if outer.len() >= 3 {
                        let base_idx = (all_positions.len() / 3) as u32;

                        // Add positions
                        for p in &outer {
                            all_positions.push(p.x as f32);
                            all_positions.push(p.y as f32);
                            all_positions.push(p.z as f32);
                        }

                        // Simple fan triangulation (works for convex faces)
                        for i in 1..outer.len() - 1 {
                            all_indices.push(base_idx);
                            all_indices.push(base_idx + i as u32);
                            all_indices.push(base_idx + i as u32 + 1);
                        }
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
        vec![IfcType::IfcShellBasedSurfaceModel]
    }
}

impl ShellBasedSurfaceModelProcessor {
    /// Extract points from a PolyLoop entity
    fn extract_loop_points(loop_id: u32, decoder: &mut EntityDecoder) -> Option<Vec<Point3<f64>>> {
        let point_ids = decoder.get_polyloop_point_ids_fast(loop_id)?;

        let mut points = Vec::with_capacity(point_ids.len());
        for point_id in point_ids {
            let (x, y, z) = decoder.get_cartesian_point_fast(point_id)?;
            points.push(Point3::new(x, y, z));
        }

        if points.len() >= 3 {
            Some(points)
        } else {
            None
        }
    }
}

impl Default for ShellBasedSurfaceModelProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// SurfaceOfLinearExtrusion processor
/// Handles IfcSurfaceOfLinearExtrusion - surface created by sweeping a curve along a direction
pub struct SurfaceOfLinearExtrusionProcessor;

impl SurfaceOfLinearExtrusionProcessor {
    pub fn new() -> Self {
        Self
    }
}

impl GeometryProcessor for SurfaceOfLinearExtrusionProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcSurfaceOfLinearExtrusion attributes:
        // 0: SweptCurve (IfcProfileDef - usually IfcArbitraryOpenProfileDef)
        // 1: Position (IfcAxis2Placement3D)
        // 2: ExtrudedDirection (IfcDirection)
        // 3: Depth (length)

        // Get the swept curve (profile)
        let curve_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("SurfaceOfLinearExtrusion missing SweptCurve".to_string()))?;

        let curve_id = curve_attr
            .as_entity_ref()
            .ok_or_else(|| Error::geometry("Expected entity reference for SweptCurve".to_string()))?;

        // Get position
        let position_attr = entity.get(1);
        let position_transform = if let Some(attr) = position_attr {
            if let Some(pos_id) = attr.as_entity_ref() {
                Self::get_axis2_placement_transform(pos_id, decoder)?
            } else {
                Matrix4::identity()
            }
        } else {
            Matrix4::identity()
        };

        // Get extrusion direction
        let direction_attr = entity
            .get(2)
            .ok_or_else(|| Error::geometry("SurfaceOfLinearExtrusion missing ExtrudedDirection".to_string()))?;

        let direction = if let Some(dir_id) = direction_attr.as_entity_ref() {
            Self::get_direction(dir_id, decoder)?
        } else {
            Vector3::new(0.0, 0.0, 1.0) // Default to Z-up
        };

        // Get depth
        let depth = entity
            .get(3)
            .and_then(|v| v.as_float())
            .ok_or_else(|| Error::geometry("SurfaceOfLinearExtrusion missing Depth".to_string()))?;

        // Get curve points from the profile
        let curve_points = Self::get_profile_curve_points(curve_id, decoder)?;

        if curve_points.len() < 2 {
            return Ok(Mesh::new());
        }

        // Extrude the curve to create a surface (quad strip)
        let extrusion = direction.normalize() * depth;

        let mut positions = Vec::with_capacity(curve_points.len() * 2 * 3);
        let mut indices = Vec::with_capacity((curve_points.len() - 1) * 6);

        // Create vertices: bottom row, then top row
        for point in &curve_points {
            // Transform 2D point to 3D using position
            let p3d = position_transform.transform_point(&Point3::new(point.x, point.y, 0.0));
            positions.push(p3d.x as f32);
            positions.push(p3d.y as f32);
            positions.push(p3d.z as f32);
        }

        for point in &curve_points {
            // Extruded point
            let p3d = position_transform.transform_point(&Point3::new(point.x, point.y, 0.0));
            let p_extruded = p3d + extrusion;
            positions.push(p_extruded.x as f32);
            positions.push(p_extruded.y as f32);
            positions.push(p_extruded.z as f32);
        }

        // Create quad strip triangles
        let n = curve_points.len() as u32;
        for i in 0..n - 1 {
            // Two triangles per quad
            // Triangle 1: bottom-left, bottom-right, top-left
            indices.push(i);
            indices.push(i + 1);
            indices.push(i + n);

            // Triangle 2: bottom-right, top-right, top-left
            indices.push(i + 1);
            indices.push(i + n + 1);
            indices.push(i + n);
        }

        Ok(Mesh {
            positions,
            normals: Vec::new(),
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcSurfaceOfLinearExtrusion]
    }
}

impl SurfaceOfLinearExtrusionProcessor {
    /// Get transform from IfcAxis2Placement3D
    fn get_axis2_placement_transform(
        placement_id: u32,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        let placement = decoder.decode_by_id(placement_id)?;

        // Get location
        let location = placement
            .get(0)
            .and_then(|a| a.as_entity_ref())
            .and_then(|id| decoder.get_cartesian_point_fast(id))
            .unwrap_or((0.0, 0.0, 0.0));

        // Get axis (Z direction)
        let z_axis = placement
            .get(1)
            .and_then(|a| a.as_entity_ref())
            .and_then(|id| Self::get_direction_impl(id, decoder))
            .unwrap_or(Vector3::new(0.0, 0.0, 1.0));

        // Get ref direction (X direction)
        let x_axis = placement
            .get(2)
            .and_then(|a| a.as_entity_ref())
            .and_then(|id| Self::get_direction_impl(id, decoder))
            .unwrap_or(Vector3::new(1.0, 0.0, 0.0));

        // Compute Y axis as Z cross X
        let y_axis = z_axis.cross(&x_axis).normalize();
        let x_axis = y_axis.cross(&z_axis).normalize();

        Ok(Matrix4::new(
            x_axis.x, y_axis.x, z_axis.x, location.0,
            x_axis.y, y_axis.y, z_axis.y, location.1,
            x_axis.z, y_axis.z, z_axis.z, location.2,
            0.0, 0.0, 0.0, 1.0,
        ))
    }

    fn get_direction(dir_id: u32, decoder: &mut EntityDecoder) -> Result<Vector3<f64>> {
        Self::get_direction_impl(dir_id, decoder)
            .ok_or_else(|| Error::geometry("Failed to get direction".to_string()))
    }

    fn get_direction_impl(dir_id: u32, decoder: &mut EntityDecoder) -> Option<Vector3<f64>> {
        let dir = decoder.decode_by_id(dir_id).ok()?;
        // IfcDirection has a single attribute: DirectionRatios (list of floats)
        let ratios = dir.get(0)?.as_list()?;
        let x = ratios.first()?.as_float().unwrap_or(0.0);
        let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);
        Some(Vector3::new(x, y, z))
    }

    /// Extract curve points from a profile definition
    fn get_profile_curve_points(
        profile_id: u32,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        let profile = decoder.decode_by_id(profile_id)?;

        // IfcArbitraryOpenProfileDef: 0=ProfileType, 1=ProfileName, 2=Curve
        // IfcArbitraryClosedProfileDef: 0=ProfileType, 1=ProfileName, 2=OuterCurve
        let curve_attr = profile
            .get(2)
            .ok_or_else(|| Error::geometry("Profile missing curve".to_string()))?;

        let curve_id = curve_attr
            .as_entity_ref()
            .ok_or_else(|| Error::geometry("Expected entity reference for curve".to_string()))?;

        // Get curve entity to determine type
        let curve = decoder.decode_by_id(curve_id)?;

        match curve.ifc_type {
            IfcType::IfcPolyline => {
                // IfcPolyline: attribute 0 is Points (list of IfcCartesianPoint)
                let point_ids = decoder
                    .get_polyloop_point_ids_fast(curve_id)
                    .ok_or_else(|| Error::geometry("Failed to get polyline points".to_string()))?;

                let mut points = Vec::with_capacity(point_ids.len());
                for point_id in point_ids {
                    if let Some((x, y, _z)) = decoder.get_cartesian_point_fast(point_id) {
                        points.push(Point2::new(x, y));
                    }
                }
                Ok(points)
            }
            IfcType::IfcCompositeCurve => {
                // Handle composite curves by extracting segments
                Self::extract_composite_curve_points(curve_id, decoder)
            }
            _ => {
                // Fallback: try to get points directly
                if let Some(point_ids) = decoder.get_polyloop_point_ids_fast(curve_id) {
                    let mut points = Vec::with_capacity(point_ids.len());
                    for point_id in point_ids {
                        if let Some((x, y, _z)) = decoder.get_cartesian_point_fast(point_id) {
                            points.push(Point2::new(x, y));
                        }
                    }
                    Ok(points)
                } else {
                    Ok(Vec::new())
                }
            }
        }
    }

    /// Extract points from a composite curve
    fn extract_composite_curve_points(
        curve_id: u32,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        let curve = decoder.decode_by_id(curve_id)?;

        // IfcCompositeCurve: attribute 0 is Segments (list of IfcCompositeCurveSegment)
        let segments_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("CompositeCurve missing Segments".to_string()))?;

        let segment_refs = segments_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected segment list".to_string()))?;

        let mut all_points = Vec::new();

        for seg_ref in segment_refs {
            let seg_id = seg_ref.as_entity_ref().ok_or_else(|| {
                Error::geometry("Expected entity reference for segment".to_string())
            })?;

            let segment = decoder.decode_by_id(seg_id)?;

            // IfcCompositeCurveSegment: 0=Transition, 1=SameSense, 2=ParentCurve
            let parent_curve_attr = segment
                .get(2)
                .ok_or_else(|| Error::geometry("Segment missing ParentCurve".to_string()))?;

            let parent_curve_id = parent_curve_attr
                .as_entity_ref()
                .ok_or_else(|| Error::geometry("Expected entity reference for parent curve".to_string()))?;

            // Recursively get points from the parent curve
            if let Ok(segment_points) = Self::get_profile_curve_points(parent_curve_id, decoder) {
                // Skip first point if we already have points (to avoid duplicates at joints)
                let start_idx = if all_points.is_empty() { 0 } else { 1 };
                all_points.extend(segment_points.into_iter().skip(start_idx));
            }
        }

        Ok(all_points)
    }
}

impl Default for SurfaceOfLinearExtrusionProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// BooleanResult processor
/// Handles IfcBooleanResult and IfcBooleanClippingResult - CSG operations
///
/// Supports all IFC boolean operations:
/// - DIFFERENCE: Subtracts second operand from first (wall clipped by roof, openings, etc.)
///   - Uses efficient plane clipping for IfcHalfSpaceSolid operands
///   - Uses full 3D CSG for solid-solid operations (e.g., roof/slab clipping)
/// - UNION: Combines two solids into one
/// - INTERSECTION: Returns the overlapping volume of two solids
///
/// Performance notes:
/// - HalfSpaceSolid clipping is very fast (simple plane-based triangle clipping)
/// - Solid-solid CSG only invoked when actually needed (no overhead for simple geometry)
/// - Graceful fallback to first operand if CSG fails on degenerate meshes
pub struct BooleanClippingProcessor {
    schema: IfcSchema,
}

impl BooleanClippingProcessor {
    pub fn new() -> Self {
        Self {
            schema: IfcSchema::new(),
        }
    }

    /// Process a solid operand recursively
    fn process_operand(
        &self,
        operand: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Mesh> {
        match operand.ifc_type {
            IfcType::IfcExtrudedAreaSolid => {
                let processor = ExtrudedAreaSolidProcessor::new(self.schema.clone());
                processor.process(operand, decoder, &self.schema)
            }
            IfcType::IfcFacetedBrep => {
                let processor = FacetedBrepProcessor::new();
                processor.process(operand, decoder, &self.schema)
            }
            IfcType::IfcTriangulatedFaceSet => {
                let processor = TriangulatedFaceSetProcessor::new();
                processor.process(operand, decoder, &self.schema)
            }
            IfcType::IfcSweptDiskSolid => {
                let processor = SweptDiskSolidProcessor::new(self.schema.clone());
                processor.process(operand, decoder, &self.schema)
            }
            IfcType::IfcRevolvedAreaSolid => {
                let processor = RevolvedAreaSolidProcessor::new(self.schema.clone());
                processor.process(operand, decoder, &self.schema)
            }
            IfcType::IfcBooleanResult | IfcType::IfcBooleanClippingResult => {
                // Recursive case
                self.process(operand, decoder, &self.schema)
            }
            _ => Ok(Mesh::new()),
        }
    }

    /// Parse IfcHalfSpaceSolid to get clipping plane
    /// Returns (plane_point, plane_normal, agreement_flag)
    fn parse_half_space_solid(
        &self,
        half_space: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Point3<f64>, Vector3<f64>, bool)> {
        // IfcHalfSpaceSolid attributes:
        // 0: BaseSurface (IfcSurface - usually IfcPlane)
        // 1: AgreementFlag (boolean - true means material is on positive side)

        let surface_attr = half_space
            .get(0)
            .ok_or_else(|| Error::geometry("HalfSpaceSolid missing BaseSurface".to_string()))?;

        let surface = decoder
            .resolve_ref(surface_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve BaseSurface".to_string()))?;

        // Get agreement flag - defaults to true
        let agreement = half_space
            .get(1)
            .map(|v| match v {
                // Parser strips dots, so enum value is "T" or "F", not ".T." or ".F."
                ifc_lite_core::AttributeValue::Enum(e) => e != "F" && e != ".F.",
                _ => true,
            })
            .unwrap_or(true);

        // Parse IfcPlane
        if surface.ifc_type != IfcType::IfcPlane {
            return Err(Error::geometry(format!(
                "Expected IfcPlane for HalfSpaceSolid, got {}",
                surface.ifc_type
            )));
        }

        // IfcPlane has one attribute: Position (IfcAxis2Placement3D)
        let position_attr = surface
            .get(0)
            .ok_or_else(|| Error::geometry("IfcPlane missing Position".to_string()))?;

        let position = decoder
            .resolve_ref(position_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Plane position".to_string()))?;

        // Parse IfcAxis2Placement3D to get transformation matrix
        // The Position defines the plane's coordinate system:
        // - Location = plane point (in world coordinates)
        // - Z-axis (Axis) = plane normal (in local coordinates, needs transformation)
        let position_transform = self.parse_axis2_placement_3d(&position, decoder)?;

        // Plane point is the Position's Location (translation part of transform)
        let location = Point3::new(
            position_transform[(0, 3)],
            position_transform[(1, 3)],
            position_transform[(2, 3)],
        );

        // Plane normal is the Position's Z-axis transformed to world coordinates
        // Extract Z-axis from transform matrix (third column)
        let normal = Vector3::new(
            position_transform[(0, 2)],
            position_transform[(1, 2)],
            position_transform[(2, 2)],
        ).normalize();

        Ok((location, normal, agreement))
    }

    /// Apply half-space clipping to mesh
    fn clip_mesh_with_half_space(
        &self,
        mesh: &Mesh,
        plane_point: Point3<f64>,
        plane_normal: Vector3<f64>,
        agreement: bool,
    ) -> Result<Mesh> {
        use crate::csg::{ClippingProcessor, Plane};

        // For DIFFERENCE operation with HalfSpaceSolid:
        // - AgreementFlag=.T. means material is on positive side of plane normal
        // - AgreementFlag=.F. means material is on negative side of plane normal
        // Since we're SUBTRACTING the half-space, we keep the opposite side:
        // - If material is on positive side (agreement=true), remove positive side → keep negative side → clip_normal = plane_normal
        // - If material is on negative side (agreement=false), remove negative side → keep positive side → clip_normal = -plane_normal
        let clip_normal = if agreement {
            plane_normal // Material on positive side, remove it, keep negative side
        } else {
            -plane_normal // Material on negative side, remove it, keep positive side
        };

        let plane = Plane::new(plane_point, clip_normal);
        let processor = ClippingProcessor::new();
        processor.clip_mesh(mesh, &plane)
    }

    /// Parse IfcAxis2Placement3D into transformation matrix
    #[inline]
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
    #[inline]
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

        let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
        let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

        Ok(Point3::new(x, y, z))
    }

    /// Parse IfcDirection
    #[inline]
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

        let x = ratios.first().and_then(|v| v.as_float()).unwrap_or(0.0);
        let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

        Ok(Vector3::new(x, y, z))
    }
}

impl GeometryProcessor for BooleanClippingProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcBooleanResult attributes:
        // 0: Operator (.DIFFERENCE., .UNION., .INTERSECTION.)
        // 1: FirstOperand (base geometry)
        // 2: SecondOperand (clipping geometry)

        // Get operator
        let operator = entity
            .get(0)
            .and_then(|v| match v {
                ifc_lite_core::AttributeValue::Enum(e) => Some(e.as_str()),
                _ => None,
            })
            .unwrap_or(".DIFFERENCE.");

        // Get first operand (base geometry)
        let first_operand_attr = entity
            .get(1)
            .ok_or_else(|| Error::geometry("BooleanResult missing FirstOperand".to_string()))?;

        let first_operand = decoder
            .resolve_ref(first_operand_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve FirstOperand".to_string()))?;

        // Process first operand to get base mesh
        let mesh = self.process_operand(&first_operand, decoder)?;

        if mesh.is_empty() {
            return Ok(mesh);
        }

        // Get second operand
        let second_operand_attr = entity
            .get(2)
            .ok_or_else(|| Error::geometry("BooleanResult missing SecondOperand".to_string()))?;

        let second_operand = decoder
            .resolve_ref(second_operand_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve SecondOperand".to_string()))?;

        // Handle DIFFERENCE operation
        // Note: Parser may strip dots from enum values, so check both forms
        if operator == ".DIFFERENCE." || operator == "DIFFERENCE" {
            // Check if second operand is a half-space solid (simple or polygonally bounded)
            if second_operand.ifc_type == IfcType::IfcHalfSpaceSolid {
                // Simple half-space: use plane clipping
                let (plane_point, plane_normal, agreement) =
                    self.parse_half_space_solid(&second_operand, decoder)?;
                return self.clip_mesh_with_half_space(&mesh, plane_point, plane_normal, agreement);
            }

            // For PolygonalBoundedHalfSpace, use simple plane clipping (same as IfcHalfSpaceSolid)
            // The polygon boundary defines the region but for wall-roof clipping, the plane is sufficient
            if second_operand.ifc_type == IfcType::IfcPolygonalBoundedHalfSpace {
                let (plane_point, plane_normal, agreement) =
                    self.parse_half_space_solid(&second_operand, decoder)?;
                return self.clip_mesh_with_half_space(&mesh, plane_point, plane_normal, agreement);
            }

            // Solid-solid difference: use full CSG (e.g., wall clipped by roof/slab)
            // Only process the second operand when we actually need it for CSG
            let second_mesh = self.process_operand(&second_operand, decoder)?;

            if !second_mesh.is_empty() {
                // Lazy initialization of CSG processor - only invoked when needed
                use crate::csg::ClippingProcessor;
                let csg = ClippingProcessor::new();
                match csg.subtract_mesh(&mesh, &second_mesh) {
                    Ok(result) => {
                        return Ok(result);
                    }
                    Err(_) => {
                        // CSG can fail on degenerate meshes - fall back to first operand
                        return Ok(mesh);
                    }
                }
            }
            return Ok(mesh);
        }

        // Handle UNION operation
        if operator == ".UNION." || operator == "UNION" {
            let second_mesh = self.process_operand(&second_operand, decoder)?;
            if !second_mesh.is_empty() {
                use crate::csg::ClippingProcessor;
                let csg = ClippingProcessor::new();
                match csg.union_mesh(&mesh, &second_mesh) {
                    Ok(result) => return Ok(result),
                    Err(_e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[WARN] CSG union failed, returning first operand: {}", _e);
                        return Ok(mesh);
                    }
                }
            }
            return Ok(mesh);
        }

        // Handle INTERSECTION operation
        if operator == ".INTERSECTION." || operator == "INTERSECTION" {
            let second_mesh = self.process_operand(&second_operand, decoder)?;
            if !second_mesh.is_empty() {
                use crate::csg::ClippingProcessor;
                let csg = ClippingProcessor::new();
                match csg.intersection_mesh(&mesh, &second_mesh) {
                    Ok(result) => return Ok(result),
                    Err(_e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[WARN] CSG intersection failed, returning first operand: {}", _e);
                        return Ok(mesh);
                    }
                }
            }
            // Intersection with empty = empty
            return Ok(Mesh::new());
        }

        // Unknown operator - return first operand
        #[cfg(debug_assertions)]
        eprintln!("[WARN] Unknown CSG operator {}, returning first operand", operator);
        Ok(mesh)
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcBooleanResult, IfcType::IfcBooleanClippingResult]
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

        let mapped_rep_attr = source_entity.get(1).ok_or_else(|| {
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
                IfcType::IfcBooleanClippingResult | IfcType::IfcBooleanResult => {
                    let processor = BooleanClippingProcessor::new();
                    processor.process(&item, decoder, schema)?
                }
                IfcType::IfcRevolvedAreaSolid => {
                    let processor = RevolvedAreaSolidProcessor::new(schema.clone());
                    processor.process(&item, decoder, schema)?
                }
                _ => continue, // Skip unsupported types
            };
            mesh.merge(&item_mesh);
        }

        // Note: MappingTarget transformation is applied by the router's process_mapped_item_cached
        // when MappedItem is encountered through process_representation_item. This processor
        // is a fallback that doesn't have access to the router's transformation logic.

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
        let _inner_radius = entity.get_float(2);

        // Resolve the directrix curve
        let directrix = decoder
            .resolve_ref(directrix_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Directrix".to_string()))?;

        // Get points along the curve
        let curve_points = self
            .profile_processor
            .get_curve_points(&directrix, decoder)?;

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

/// RevolvedAreaSolid processor
/// Handles IfcRevolvedAreaSolid - rotates a 2D profile around an axis
pub struct RevolvedAreaSolidProcessor {
    profile_processor: ProfileProcessor,
}

impl RevolvedAreaSolidProcessor {
    pub fn new(schema: IfcSchema) -> Self {
        Self {
            profile_processor: ProfileProcessor::new(schema),
        }
    }
}

impl GeometryProcessor for RevolvedAreaSolidProcessor {
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        _schema: &IfcSchema,
    ) -> Result<Mesh> {
        // IfcRevolvedAreaSolid attributes:
        // 0: SweptArea (IfcProfileDef) - the 2D profile to revolve
        // 1: Position (IfcAxis2Placement3D) - placement of the solid
        // 2: Axis (IfcAxis1Placement) - the axis of revolution
        // 3: Angle (IfcPlaneAngleMeasure) - revolution angle in radians

        let profile_attr = entity
            .get(0)
            .ok_or_else(|| Error::geometry("RevolvedAreaSolid missing SweptArea".to_string()))?;

        let profile = decoder
            .resolve_ref(profile_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve SweptArea".to_string()))?;

        // Get axis placement (attribute 2)
        let axis_attr = entity
            .get(2)
            .ok_or_else(|| Error::geometry("RevolvedAreaSolid missing Axis".to_string()))?;

        let axis_placement = decoder
            .resolve_ref(axis_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Axis".to_string()))?;

        // Get angle (attribute 3)
        let angle = entity
            .get_float(3)
            .ok_or_else(|| Error::geometry("RevolvedAreaSolid missing Angle".to_string()))?;

        // Get the 2D profile points
        let profile_2d = self.profile_processor.process(&profile, decoder)?;
        if profile_2d.outer.is_empty() {
            return Ok(Mesh::new());
        }

        // Parse axis placement to get axis point and direction
        // IfcAxis1Placement: Location, Axis (optional)
        let axis_location = {
            let loc_attr = axis_placement
                .get(0)
                .ok_or_else(|| Error::geometry("Axis1Placement missing Location".to_string()))?;
            let loc = decoder
                .resolve_ref(loc_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve axis location".to_string()))?;
            let coords = loc
                .get(0)
                .and_then(|v| v.as_list())
                .ok_or_else(|| Error::geometry("Axis location missing coordinates".to_string()))?;
            Point3::new(
                coords.first().and_then(|v| v.as_float()).unwrap_or(0.0),
                coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0),
                coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0),
            )
        };

        let axis_direction = {
            if let Some(dir_attr) = axis_placement.get(1) {
                if !dir_attr.is_null() {
                    let dir = decoder.resolve_ref(dir_attr)?.ok_or_else(|| {
                        Error::geometry("Failed to resolve axis direction".to_string())
                    })?;
                    let coords = dir.get(0).and_then(|v| v.as_list()).ok_or_else(|| {
                        Error::geometry("Axis direction missing coordinates".to_string())
                    })?;
                    Vector3::new(
                        coords.first().and_then(|v| v.as_float()).unwrap_or(0.0),
                        coords.get(1).and_then(|v| v.as_float()).unwrap_or(1.0),
                        coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0),
                    )
                    .normalize()
                } else {
                    Vector3::new(0.0, 1.0, 0.0) // Default Y axis
                }
            } else {
                Vector3::new(0.0, 1.0, 0.0) // Default Y axis
            }
        };

        // Generate revolved mesh
        // Number of segments depends on angle
        let full_circle = angle.abs() >= std::f64::consts::PI * 1.99;
        let segments = if full_circle {
            24 // Full revolution
        } else {
            ((angle.abs() / std::f64::consts::PI * 12.0).ceil() as usize).max(4)
        };

        let profile_points = &profile_2d.outer;
        let num_profile_points = profile_points.len();

        let mut positions = Vec::new();
        let mut indices = Vec::new();

        // For each segment around the revolution
        for i in 0..=segments {
            let t = if full_circle && i == segments {
                0.0 // Close the loop exactly
            } else {
                angle * i as f64 / segments as f64
            };

            // Rotation matrix around axis
            let cos_t = t.cos();
            let sin_t = t.sin();
            let (ax, ay, az) = (axis_direction.x, axis_direction.y, axis_direction.z);

            // Rodrigues' rotation formula components
            let k_matrix = |v: Vector3<f64>| -> Vector3<f64> {
                Vector3::new(
                    ay * v.z - az * v.y,
                    az * v.x - ax * v.z,
                    ax * v.y - ay * v.x,
                )
            };

            // For each point in the profile
            for (j, p2d) in profile_points.iter().enumerate() {
                // Profile point in 3D (assume profile is in XY plane, rotated around Y axis)
                // The 2D profile X becomes distance from axis, Y becomes height along axis
                let radius = p2d.x;
                let height = p2d.y;

                // Initial position before rotation (in the plane containing the axis)
                let v = Vector3::new(radius, 0.0, 0.0);

                // Rodrigues' rotation: v_rot = v*cos(t) + (k x v)*sin(t) + k*(k.v)*(1-cos(t))
                let k_cross_v = k_matrix(v);
                let k_dot_v = ax * v.x + ay * v.y + az * v.z;

                let v_rot =
                    v * cos_t + k_cross_v * sin_t + axis_direction * k_dot_v * (1.0 - cos_t);

                // Final position = axis_location + height along axis + rotated radius
                let pos = axis_location + axis_direction * height + v_rot;

                positions.push(pos.x as f32);
                positions.push(pos.y as f32);
                positions.push(pos.z as f32);

                // Create triangles (except for the last segment if it connects back)
                if i < segments && j < num_profile_points - 1 {
                    let current = (i * num_profile_points + j) as u32;
                    let next_seg = ((i + 1) * num_profile_points + j) as u32;
                    let current_next = current + 1;
                    let next_seg_next = next_seg + 1;

                    // Two triangles per quad
                    indices.push(current);
                    indices.push(next_seg);
                    indices.push(next_seg_next);

                    indices.push(current);
                    indices.push(next_seg_next);
                    indices.push(current_next);
                }
            }
        }

        // Add end caps if not a full revolution
        if !full_circle {
            // Start cap
            let start_center_idx = (positions.len() / 3) as u32;
            let start_center = axis_location
                + axis_direction
                    * (profile_points.iter().map(|p| p.y).sum::<f64>()
                        / profile_points.len() as f64);
            positions.push(start_center.x as f32);
            positions.push(start_center.y as f32);
            positions.push(start_center.z as f32);

            for j in 0..num_profile_points - 1 {
                indices.push(start_center_idx);
                indices.push(j as u32 + 1);
                indices.push(j as u32);
            }

            // End cap
            let end_center_idx = (positions.len() / 3) as u32;
            let end_base = (segments * num_profile_points) as u32;
            positions.push(start_center.x as f32);
            positions.push(start_center.y as f32);
            positions.push(start_center.z as f32);

            for j in 0..num_profile_points - 1 {
                indices.push(end_center_idx);
                indices.push(end_base + j as u32);
                indices.push(end_base + j as u32 + 1);
            }
        }

        Ok(Mesh {
            positions,
            normals: Vec::new(),
            indices,
        })
    }

    fn supported_types(&self) -> Vec<IfcType> {
        vec![IfcType::IfcRevolvedAreaSolid]
    }
}

impl Default for RevolvedAreaSolidProcessor {
    fn default() -> Self {
        Self::new(IfcSchema::new())
    }
}

/// AdvancedBrep processor
/// Handles IfcAdvancedBrep and IfcAdvancedBrepWithVoids - NURBS/B-spline surfaces
/// Supports planar faces and B-spline surface tessellation
pub struct AdvancedBrepProcessor;

impl AdvancedBrepProcessor {
    pub fn new() -> Self {
        Self
    }

    /// Evaluate a B-spline basis function (Cox-de Boor recursion)
    #[inline]
    fn bspline_basis(i: usize, p: usize, u: f64, knots: &[f64]) -> f64 {
        if p == 0 {
            if knots[i] <= u && u < knots[i + 1] {
                1.0
            } else {
                0.0
            }
        } else {
            let left = {
                let denom = knots[i + p] - knots[i];
                if denom.abs() < 1e-10 {
                    0.0
                } else {
                    (u - knots[i]) / denom * Self::bspline_basis(i, p - 1, u, knots)
                }
            };
            let right = {
                let denom = knots[i + p + 1] - knots[i + 1];
                if denom.abs() < 1e-10 {
                    0.0
                } else {
                    (knots[i + p + 1] - u) / denom * Self::bspline_basis(i + 1, p - 1, u, knots)
                }
            };
            left + right
        }
    }

    /// Evaluate a B-spline surface at parameter (u, v)
    fn evaluate_bspline_surface(
        u: f64,
        v: f64,
        u_degree: usize,
        v_degree: usize,
        control_points: &[Vec<Point3<f64>>],
        u_knots: &[f64],
        v_knots: &[f64],
    ) -> Point3<f64> {
        let _n_u = control_points.len();

        let mut result = Point3::new(0.0, 0.0, 0.0);

        for (i, row) in control_points.iter().enumerate() {
            let n_i = Self::bspline_basis(i, u_degree, u, u_knots);
            for (j, cp) in row.iter().enumerate() {
                let n_j = Self::bspline_basis(j, v_degree, v, v_knots);
                let weight = n_i * n_j;
                if weight.abs() > 1e-10 {
                    result.x += weight * cp.x;
                    result.y += weight * cp.y;
                    result.z += weight * cp.z;
                }
            }
        }

        result
    }

    /// Tessellate a B-spline surface into triangles
    fn tessellate_bspline_surface(
        u_degree: usize,
        v_degree: usize,
        control_points: &[Vec<Point3<f64>>],
        u_knots: &[f64],
        v_knots: &[f64],
        u_segments: usize,
        v_segments: usize,
    ) -> (Vec<f32>, Vec<u32>) {
        let mut positions = Vec::new();
        let mut indices = Vec::new();

        // Get parameter domain
        let u_min = u_knots[u_degree];
        let u_max = u_knots[u_knots.len() - u_degree - 1];
        let v_min = v_knots[v_degree];
        let v_max = v_knots[v_knots.len() - v_degree - 1];

        // Evaluate surface on a grid
        for i in 0..=u_segments {
            let u = u_min + (u_max - u_min) * (i as f64 / u_segments as f64);
            // Clamp u to slightly inside the domain to avoid edge issues
            let u = u.min(u_max - 1e-6).max(u_min);

            for j in 0..=v_segments {
                let v = v_min + (v_max - v_min) * (j as f64 / v_segments as f64);
                let v = v.min(v_max - 1e-6).max(v_min);

                let point = Self::evaluate_bspline_surface(
                    u,
                    v,
                    u_degree,
                    v_degree,
                    control_points,
                    u_knots,
                    v_knots,
                );

                positions.push(point.x as f32);
                positions.push(point.y as f32);
                positions.push(point.z as f32);

                // Create triangles
                if i < u_segments && j < v_segments {
                    let base = (i * (v_segments + 1) + j) as u32;
                    let next_u = base + (v_segments + 1) as u32;

                    // Two triangles per quad
                    indices.push(base);
                    indices.push(base + 1);
                    indices.push(next_u + 1);

                    indices.push(base);
                    indices.push(next_u + 1);
                    indices.push(next_u);
                }
            }
        }

        (positions, indices)
    }

    /// Parse control points from B-spline surface entity
    fn parse_control_points(
        &self,
        bspline: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Vec<Point3<f64>>>> {
        // Attribute 2: ControlPointsList (LIST of LIST of IfcCartesianPoint)
        let cp_list_attr = bspline.get(2).ok_or_else(|| {
            Error::geometry("BSplineSurface missing ControlPointsList".to_string())
        })?;

        let rows = cp_list_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected control point list".to_string()))?;

        let mut result = Vec::with_capacity(rows.len());

        for row in rows {
            let cols = row
                .as_list()
                .ok_or_else(|| Error::geometry("Expected control point row".to_string()))?;

            let mut row_points = Vec::with_capacity(cols.len());
            for col in cols {
                if let Some(point_id) = col.as_entity_ref() {
                    let point = decoder.decode_by_id(point_id)?;
                    let coords = point.get(0).and_then(|v| v.as_list()).ok_or_else(|| {
                        Error::geometry("CartesianPoint missing coordinates".to_string())
                    })?;

                    let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                    let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                    let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

                    row_points.push(Point3::new(x, y, z));
                }
            }
            result.push(row_points);
        }

        Ok(result)
    }

    /// Expand knot vector based on multiplicities
    fn expand_knots(knot_values: &[f64], multiplicities: &[i64]) -> Vec<f64> {
        let mut expanded = Vec::new();
        for (knot, &mult) in knot_values.iter().zip(multiplicities.iter()) {
            for _ in 0..mult {
                expanded.push(*knot);
            }
        }
        expanded
    }

    /// Parse knot vectors from B-spline surface entity
    fn parse_knot_vectors(&self, bspline: &DecodedEntity) -> Result<(Vec<f64>, Vec<f64>)> {
        // IFCBSPLINESURFACEWITHKNOTS attributes:
        // 0: UDegree
        // 1: VDegree
        // 2: ControlPointsList (already parsed)
        // 3: SurfaceForm
        // 4: UClosed
        // 5: VClosed
        // 6: SelfIntersect
        // 7: UMultiplicities (LIST of INTEGER)
        // 8: VMultiplicities (LIST of INTEGER)
        // 9: UKnots (LIST of REAL)
        // 10: VKnots (LIST of REAL)
        // 11: KnotSpec

        // Get U multiplicities
        let u_mult_attr = bspline
            .get(7)
            .ok_or_else(|| Error::geometry("BSplineSurface missing UMultiplicities".to_string()))?;
        let u_mults: Vec<i64> = u_mult_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected U multiplicities list".to_string()))?
            .iter()
            .filter_map(|v| v.as_int())
            .collect();

        // Get V multiplicities
        let v_mult_attr = bspline
            .get(8)
            .ok_or_else(|| Error::geometry("BSplineSurface missing VMultiplicities".to_string()))?;
        let v_mults: Vec<i64> = v_mult_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected V multiplicities list".to_string()))?
            .iter()
            .filter_map(|v| v.as_int())
            .collect();

        // Get U knots
        let u_knots_attr = bspline
            .get(9)
            .ok_or_else(|| Error::geometry("BSplineSurface missing UKnots".to_string()))?;
        let u_knot_values: Vec<f64> = u_knots_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected U knots list".to_string()))?
            .iter()
            .filter_map(|v| v.as_float())
            .collect();

        // Get V knots
        let v_knots_attr = bspline
            .get(10)
            .ok_or_else(|| Error::geometry("BSplineSurface missing VKnots".to_string()))?;
        let v_knot_values: Vec<f64> = v_knots_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected V knots list".to_string()))?
            .iter()
            .filter_map(|v| v.as_float())
            .collect();

        // Expand knot vectors with multiplicities
        let u_knots = Self::expand_knots(&u_knot_values, &u_mults);
        let v_knots = Self::expand_knots(&v_knot_values, &v_mults);

        Ok((u_knots, v_knots))
    }

    /// Process a planar face (IfcPlane surface)
    fn process_planar_face(
        &self,
        face: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Vec<f32>, Vec<u32>)> {
        // Get bounds from face (attribute 0)
        let bounds_attr = face
            .get(0)
            .ok_or_else(|| Error::geometry("AdvancedFace missing Bounds".to_string()))?;

        let bounds = bounds_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected bounds list".to_string()))?;

        let mut positions = Vec::new();
        let mut indices = Vec::new();

        for bound in bounds {
            if let Some(bound_id) = bound.as_entity_ref() {
                let bound_entity = decoder.decode_by_id(bound_id)?;

                // Get the loop (attribute 0: Bound)
                let loop_attr = bound_entity
                    .get(0)
                    .ok_or_else(|| Error::geometry("FaceBound missing Bound".to_string()))?;

                let loop_entity = decoder
                    .resolve_ref(loop_attr)?
                    .ok_or_else(|| Error::geometry("Failed to resolve loop".to_string()))?;

                // Get oriented edges from edge loop
                if loop_entity
                    .ifc_type
                    .as_str()
                    .eq_ignore_ascii_case("IFCEDGELOOP")
                {
                    let edges_attr = loop_entity
                        .get(0)
                        .ok_or_else(|| Error::geometry("EdgeLoop missing EdgeList".to_string()))?;

                    let edges = edges_attr
                        .as_list()
                        .ok_or_else(|| Error::geometry("Expected edge list".to_string()))?;

                    let mut polygon_points = Vec::new();

                    for edge_ref in edges {
                        if let Some(edge_id) = edge_ref.as_entity_ref() {
                            let oriented_edge = decoder.decode_by_id(edge_id)?;

                            // IfcOrientedEdge: EdgeStart(0), EdgeEnd(1), EdgeElement(2), Orientation(3)
                            // EdgeStart/EdgeEnd can be * (derived), get from EdgeElement if needed

                            // Try to get start vertex from OrientedEdge first
                            let vertex = oriented_edge.get(0)
                                .and_then(|attr| decoder.resolve_ref(attr).ok().flatten())
                                .or_else(|| {
                                    // If EdgeStart is *, get from EdgeElement (IfcEdgeCurve)
                                    oriented_edge.get(2)
                                        .and_then(|attr| decoder.resolve_ref(attr).ok().flatten())
                                        .and_then(|edge_curve| {
                                            // IfcEdgeCurve: EdgeStart(0), EdgeEnd(1), EdgeGeometry(2)
                                            edge_curve.get(0)
                                                .and_then(|attr| decoder.resolve_ref(attr).ok().flatten())
                                        })
                                });

                            if let Some(vertex) = vertex {
                                // IfcVertexPoint has VertexGeometry (IfcCartesianPoint)
                                if let Some(point_attr) = vertex.get(0) {
                                    if let Some(point) = decoder.resolve_ref(point_attr).ok().flatten() {
                                        if let Some(coords) = point.get(0).and_then(|v| v.as_list()) {
                                            let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                                            let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                                            let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

                                            polygon_points.push(Point3::new(x, y, z));
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Triangulate the polygon
                    if polygon_points.len() >= 3 {
                        let base_idx = (positions.len() / 3) as u32;

                        for point in &polygon_points {
                            positions.push(point.x as f32);
                            positions.push(point.y as f32);
                            positions.push(point.z as f32);
                        }

                        // TODO: Fan triangulation assumes convex polygons. For non-convex faces,
                        // consider using triangulate_polygon_with_holes from FacetedBrepProcessor.
                        // Fan triangulation for simple convex polygons
                        for i in 1..polygon_points.len() - 1 {
                            indices.push(base_idx);
                            indices.push(base_idx + i as u32);
                            indices.push(base_idx + i as u32 + 1);
                        }
                    }
                }
            }
        }

        Ok((positions, indices))
    }

    /// Process a B-spline surface face
    fn process_bspline_face(
        &self,
        bspline: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Vec<f32>, Vec<u32>)> {
        // Get degrees
        let u_degree = bspline.get_float(0).unwrap_or(3.0) as usize;
        let v_degree = bspline.get_float(1).unwrap_or(1.0) as usize;

        // Parse control points
        let control_points = self.parse_control_points(bspline, decoder)?;

        // Parse knot vectors
        let (u_knots, v_knots) = self.parse_knot_vectors(bspline)?;

        // Determine tessellation resolution based on surface complexity
        let u_segments = (control_points.len() * 3).clamp(8, 24);
        let v_segments = if !control_points.is_empty() {
            (control_points[0].len() * 3).clamp(4, 24)
        } else {
            4
        };

        // Tessellate the surface
        let (positions, indices) = Self::tessellate_bspline_surface(
            u_degree,
            v_degree,
            &control_points,
            &u_knots,
            &v_knots,
            u_segments,
            v_segments,
        );

        Ok((positions, indices))
    }

    /// Process a cylindrical surface face
    fn process_cylindrical_face(
        &self,
        face: &DecodedEntity,
        surface: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Vec<f32>, Vec<u32>)> {
        // Get the radius from IfcCylindricalSurface (attribute 1)
        let radius = surface
            .get(1)
            .and_then(|v| v.as_float())
            .ok_or_else(|| Error::geometry("CylindricalSurface missing Radius".to_string()))?;

        // Get position/axis from IfcCylindricalSurface (attribute 0)
        let position_attr = surface.get(0);
        let axis_transform = if let Some(attr) = position_attr {
            if let Some(pos_id) = attr.as_entity_ref() {
                self.get_axis2_placement_transform(pos_id, decoder)?
            } else {
                Matrix4::identity()
            }
        } else {
            Matrix4::identity()
        };

        // Extract boundary edges to determine angular and height extent
        let bounds_attr = face
            .get(0)
            .ok_or_else(|| Error::geometry("AdvancedFace missing Bounds".to_string()))?;

        let bounds = bounds_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected bounds list".to_string()))?;

        // Collect all boundary points to determine the extent
        let mut boundary_points: Vec<Point3<f64>> = Vec::new();

        for bound in bounds {
            if let Some(bound_id) = bound.as_entity_ref() {
                let bound_entity = decoder.decode_by_id(bound_id)?;
                let loop_attr = bound_entity.get(0).ok_or_else(|| {
                    Error::geometry("FaceBound missing Bound".to_string())
                })?;

                if let Some(loop_entity) = decoder.resolve_ref(loop_attr)? {
                    if loop_entity.ifc_type.as_str().eq_ignore_ascii_case("IFCEDGELOOP") {
                        if let Some(edges_attr) = loop_entity.get(0) {
                            if let Some(edges) = edges_attr.as_list() {
                                for edge_ref in edges {
                                    if let Some(edge_id) = edge_ref.as_entity_ref() {
                                        if let Ok(oriented_edge) = decoder.decode_by_id(edge_id) {
                                            // IfcOrientedEdge: 0=EdgeStart, 1=EdgeEnd, 2=EdgeElement, 3=Orientation
                                            // EdgeStart/EdgeEnd can be * (null), get from EdgeElement if needed

                                            // Try to get start vertex from OrientedEdge first
                                            let start_vertex = oriented_edge.get(0)
                                                .and_then(|attr| decoder.resolve_ref(attr).ok().flatten());

                                            // If null, get from EdgeElement (attribute 2)
                                            let vertex = if start_vertex.is_some() {
                                                start_vertex
                                            } else if let Some(edge_elem_attr) = oriented_edge.get(2) {
                                                // Get EdgeElement (IfcEdgeCurve)
                                                if let Some(edge_curve) = decoder.resolve_ref(edge_elem_attr).ok().flatten() {
                                                    // IfcEdgeCurve: 0=EdgeStart, 1=EdgeEnd, 2=EdgeGeometry
                                                    edge_curve.get(0)
                                                        .and_then(|attr| decoder.resolve_ref(attr).ok().flatten())
                                                } else {
                                                    None
                                                }
                                            } else {
                                                None
                                            };

                                            if let Some(vertex) = vertex {
                                                // IfcVertexPoint: 0=VertexGeometry (IfcCartesianPoint)
                                                if let Some(point_attr) = vertex.get(0) {
                                                    if let Some(point) = decoder.resolve_ref(point_attr).ok().flatten() {
                                                        if let Some(coords) = point.get(0).and_then(|v| v.as_list()) {
                                                            let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                                                            let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                                                            let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);
                                                            boundary_points.push(Point3::new(x, y, z));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if boundary_points.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }

        // Transform boundary points to local cylinder coordinates
        let inv_transform = axis_transform.try_inverse().unwrap_or(Matrix4::identity());
        let local_points: Vec<Point3<f64>> = boundary_points
            .iter()
            .map(|p| inv_transform.transform_point(p))
            .collect();

        // Determine angular extent (from local x,y) and height extent (from local z)
        let mut min_angle = f64::MAX;
        let mut max_angle = f64::MIN;
        let mut min_z = f64::MAX;
        let mut max_z = f64::MIN;

        for p in &local_points {
            let angle = p.y.atan2(p.x);
            min_angle = min_angle.min(angle);
            max_angle = max_angle.max(angle);
            min_z = min_z.min(p.z);
            max_z = max_z.max(p.z);
        }

        // Handle angle wrapping (if angles span across -π/π boundary)
        if max_angle - min_angle > std::f64::consts::PI * 1.5 {
            // Likely wraps around, recalculate with positive angles
            let positive_angles: Vec<f64> = local_points.iter()
                .map(|p| {
                    let a = p.y.atan2(p.x);
                    if a < 0.0 { a + 2.0 * std::f64::consts::PI } else { a }
                })
                .collect();
            min_angle = positive_angles.iter().cloned().fold(f64::MAX, f64::min);
            max_angle = positive_angles.iter().cloned().fold(f64::MIN, f64::max);
        }

        // Tessellation parameters
        let angle_span = max_angle - min_angle;
        let height = max_z - min_z;

        // Balance between accuracy and matching web-ifc's output
        // Use ~15 degrees per segment (π/12) for good curvature approximation
        let angle_segments = ((angle_span / (std::f64::consts::PI / 12.0)).ceil() as usize).clamp(3, 16);
        // Height segments based on aspect ratio - at least 1, more for tall cylinders
        let height_segments = ((height / (radius * 2.0)).ceil() as usize).clamp(1, 4);

        let mut positions = Vec::new();
        let mut indices = Vec::new();

        // Generate cylinder patch vertices
        for h in 0..=height_segments {
            let z = min_z + (height * h as f64 / height_segments as f64);
            for a in 0..=angle_segments {
                let angle = min_angle + (angle_span * a as f64 / angle_segments as f64);
                let x = radius * angle.cos();
                let y = radius * angle.sin();

                // Transform back to world coordinates
                let local_point = Point3::new(x, y, z);
                let world_point = axis_transform.transform_point(&local_point);

                positions.push(world_point.x as f32);
                positions.push(world_point.y as f32);
                positions.push(world_point.z as f32);
            }
        }

        // Generate indices for quad strip
        let cols = angle_segments + 1;
        for h in 0..height_segments {
            for a in 0..angle_segments {
                let base = (h * cols + a) as u32;
                let next_row = base + cols as u32;

                // Two triangles per quad
                indices.push(base);
                indices.push(base + 1);
                indices.push(next_row + 1);

                indices.push(base);
                indices.push(next_row + 1);
                indices.push(next_row);
            }
        }

        Ok((positions, indices))
    }

    /// Get transform from IfcAxis2Placement3D
    fn get_axis2_placement_transform(
        &self,
        placement_id: u32,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        let placement = decoder.decode_by_id(placement_id)?;

        // Get location
        let location = placement
            .get(0)
            .and_then(|a| a.as_entity_ref())
            .and_then(|id| decoder.get_cartesian_point_fast(id))
            .unwrap_or((0.0, 0.0, 0.0));

        // Get axis (Z direction) - attribute 1
        let z_axis = placement
            .get(1)
            .and_then(|a| a.as_entity_ref())
            .and_then(|id| Self::get_direction_impl(id, decoder))
            .unwrap_or(Vector3::new(0.0, 0.0, 1.0));

        // Get ref direction (X direction) - attribute 2
        let x_axis = placement
            .get(2)
            .and_then(|a| a.as_entity_ref())
            .and_then(|id| Self::get_direction_impl(id, decoder))
            .unwrap_or(Vector3::new(1.0, 0.0, 0.0));

        // Compute Y axis as Z cross X
        let y_axis = z_axis.cross(&x_axis).normalize();
        let x_axis = y_axis.cross(&z_axis).normalize();

        Ok(Matrix4::new(
            x_axis.x, y_axis.x, z_axis.x, location.0,
            x_axis.y, y_axis.y, z_axis.y, location.1,
            x_axis.z, y_axis.z, z_axis.z, location.2,
            0.0, 0.0, 0.0, 1.0,
        ))
    }

    fn get_direction_impl(dir_id: u32, decoder: &mut EntityDecoder) -> Option<Vector3<f64>> {
        let dir = decoder.decode_by_id(dir_id).ok()?;
        // IfcDirection has a single attribute: DirectionRatios (list of floats)
        let ratios = dir.get(0)?.as_list()?;
        let x = ratios.first()?.as_float().unwrap_or(0.0);
        let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);
        Some(Vector3::new(x, y, z).normalize())
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

                // IfcAdvancedFace has:
                // 0: Bounds (list of FaceBound)
                // 1: FaceSurface (IfcSurface - Plane, BSplineSurface, etc.)
                // 2: SameSense (boolean)

                let surface_attr = face.get(1).ok_or_else(|| {
                    Error::geometry("AdvancedFace missing FaceSurface".to_string())
                })?;

                let surface = decoder
                    .resolve_ref(surface_attr)?
                    .ok_or_else(|| Error::geometry("Failed to resolve FaceSurface".to_string()))?;

                let surface_type = surface.ifc_type.as_str().to_uppercase();
                let (positions, indices) = if surface_type == "IFCPLANE" {
                    // Planar face - extract boundary vertices
                    self.process_planar_face(&face, decoder)?
                } else if surface_type == "IFCBSPLINESURFACEWITHKNOTS"
                    || surface_type == "IFCRATIONALBSPLINESURFACEWITHKNOTS"
                {
                    // B-spline surface - tessellate
                    self.process_bspline_face(&surface, decoder)?
                } else if surface_type == "IFCCYLINDRICALSURFACE" {
                    // Cylindrical surface - tessellate
                    self.process_cylindrical_face(&face, &surface, decoder)?
                } else {
                    // Unsupported surface type - skip
                    continue;
                };

                // Merge into combined mesh
                let base_idx = (all_positions.len() / 3) as u32;
                all_positions.extend(positions);
                for idx in indices {
                    all_indices.push(base_idx + idx);
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
