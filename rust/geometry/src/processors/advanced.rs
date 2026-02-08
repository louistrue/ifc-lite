// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! AdvancedBrep processor - NURBS/B-spline surfaces.
//!
//! Handles IfcAdvancedBrep and IfcAdvancedBrepWithVoids with support for
//! planar faces, B-spline surface tessellation, and cylindrical surfaces.

use crate::{Error, Mesh, Point3, Result};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcSchema, IfcType};
use nalgebra::Matrix4;

use crate::router::GeometryProcessor;
use super::helpers::get_axis2_placement_transform_by_id;

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
                get_axis2_placement_transform_by_id(pos_id, decoder)?
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
