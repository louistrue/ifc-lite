// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Shared advanced face processing logic.
//!
//! Handles IfcAdvancedFace with B-spline, planar, and cylindrical surface types.
//! Used by both AdvancedBrepProcessor and ShellBasedSurfaceModelProcessor/FaceBasedSurfaceModelProcessor
//! when shells contain IfcAdvancedFace entities (common in CATIA exports).

use crate::triangulation::{calculate_polygon_normal, project_to_2d, triangulate_polygon};
use crate::{Error, Point3, Result};
use ifc_lite_core::{DecodedEntity, EntityDecoder};
use nalgebra::Matrix4;

use super::helpers::get_axis2_placement_transform_by_id;

/// Process a single IfcAdvancedFace entity, dispatching to the appropriate
/// surface handler based on FaceSurface type.
///
/// Returns (positions, indices) for the tessellated face.
pub(super) fn process_advanced_face(
    face: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Result<(Vec<f32>, Vec<u32>)> {
    // IfcAdvancedFace has:
    // 0: Bounds (list of FaceBound)
    // 1: FaceSurface (IfcSurface - Plane, BSplineSurface, CylindricalSurface, etc.)
    // 2: SameSense (boolean)

    let surface_attr = face
        .get(1)
        .ok_or_else(|| Error::geometry("AdvancedFace missing FaceSurface".to_string()))?;

    let surface = decoder
        .resolve_ref(surface_attr)?
        .ok_or_else(|| Error::geometry("Failed to resolve FaceSurface".to_string()))?;

    let surface_type = surface.ifc_type.as_str().to_uppercase();

    // Read SameSense (attribute 2) - when false, triangle winding must be flipped
    let same_sense = face
        .get(2)
        .and_then(|a| a.as_enum())
        .map(|e| e == "T" || e == "TRUE")
        .unwrap_or(true);

    let result = if surface_type == "IFCPLANE" {
        process_planar_face(face, decoder)
    } else if surface_type == "IFCBSPLINESURFACEWITHKNOTS" {
        process_bspline_face(&surface, decoder, None)
    } else if surface_type == "IFCRATIONALBSPLINESURFACEWITHKNOTS" {
        let weights = parse_rational_weights(&surface);
        process_bspline_face(&surface, decoder, weights.as_deref())
    } else if surface_type == "IFCCYLINDRICALSURFACE" {
        process_cylindrical_face(face, &surface, decoder)
    } else if surface_type == "IFCSURFACEOFLINEAREXTRUSION"
        || surface_type == "IFCSURFACEOFREVOLUTION"
        || surface_type == "IFCCONICALSURFACE"
        || surface_type == "IFCSPHERICALSURFACE"
        || surface_type == "IFCTOROIDALSURFACE"
    {
        // For these surface types, the edge loop boundary vertices already lie
        // on the surface. Extracting and triangulating them gives a reasonable
        // polygonal approximation. This covers IfcSurfaceOfLinearExtrusion
        // (common in CATIA exports) and other analytic surface types.
        process_planar_face(face, decoder)
    } else {
        // Unsupported surface type - return empty geometry
        Ok((Vec::new(), Vec::new()))
    };

    // When SameSense is false, flip triangle winding to correct face orientation
    if !same_sense {
        result.map(|(positions, mut indices)| {
            for tri in indices.chunks_exact_mut(3) {
                tri.swap(0, 2);
            }
            (positions, indices)
        })
    } else {
        result
    }
}

// ---------- B-spline helpers ----------

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
                (u - knots[i]) / denom * bspline_basis(i, p - 1, u, knots)
            }
        };
        let right = {
            let denom = knots[i + p + 1] - knots[i + 1];
            if denom.abs() < 1e-10 {
                0.0
            } else {
                (knots[i + p + 1] - u) / denom * bspline_basis(i + 1, p - 1, u, knots)
            }
        };
        left + right
    }
}

/// Evaluate a B-spline surface at parameter (u, v).
/// When `weights` is `None` this is a standard (non-rational) evaluation.
/// When `weights` is `Some`, rational (NURBS) normalization is applied.
fn evaluate_bspline_surface(
    u: f64,
    v: f64,
    u_degree: usize,
    v_degree: usize,
    control_points: &[Vec<Point3<f64>>],
    u_knots: &[f64],
    v_knots: &[f64],
    weights: Option<&[Vec<f64>]>,
) -> Point3<f64> {
    let mut result = Point3::new(0.0, 0.0, 0.0);
    let mut weight_sum = 0.0;

    for (i, row) in control_points.iter().enumerate() {
        let n_i = bspline_basis(i, u_degree, u, u_knots);
        for (j, cp) in row.iter().enumerate() {
            let n_j = bspline_basis(j, v_degree, v, v_knots);
            let basis = n_i * n_j;
            if basis.abs() > 1e-10 {
                let w = weights
                    .and_then(|ws| ws.get(i))
                    .and_then(|row_w| row_w.get(j))
                    .copied()
                    .unwrap_or(1.0);
                let weighted_basis = basis * w;
                result.x += weighted_basis * cp.x;
                result.y += weighted_basis * cp.y;
                result.z += weighted_basis * cp.z;
                weight_sum += weighted_basis;
            }
        }
    }

    // Rational normalization: divide by sum of weighted basis functions
    if weights.is_some() && weight_sum.abs() > 1e-10 {
        result.x /= weight_sum;
        result.y /= weight_sum;
        result.z /= weight_sum;
    }

    result
}

/// Tessellate a B-spline surface into triangles.
/// Returns `None` if the knot data is inconsistent (prevents index panics).
fn tessellate_bspline_surface(
    u_degree: usize,
    v_degree: usize,
    control_points: &[Vec<Point3<f64>>],
    u_knots: &[f64],
    v_knots: &[f64],
    weights: Option<&[Vec<f64>]>,
    u_segments: usize,
    v_segments: usize,
) -> Option<(Vec<f32>, Vec<u32>)> {
    let mut positions = Vec::new();
    let mut indices = Vec::new();

    // Validate knot vector lengths: expanded knot vector must have at least
    // (num_control_points + degree + 1) entries. At minimum we need to be
    // able to index [degree] and [len - degree - 1] safely.
    let n_u = control_points.len();
    let n_v = control_points.first().map_or(0, |r| r.len());
    let min_u_knots = n_u + u_degree + 1;
    let min_v_knots = n_v + v_degree + 1;

    if u_knots.len() < min_u_knots || v_knots.len() < min_v_knots {
        return None;
    }
    if u_degree >= u_knots.len() || v_degree >= v_knots.len() {
        return None;
    }
    if u_knots.len() - u_degree - 1 >= u_knots.len()
        || v_knots.len() - v_degree - 1 >= v_knots.len()
    {
        return None;
    }

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

            let point = evaluate_bspline_surface(
                u,
                v,
                u_degree,
                v_degree,
                control_points,
                u_knots,
                v_knots,
                weights,
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

    Some((positions, indices))
}

/// Parse rational weights from IfcRationalBSplineSurfaceWithKnots.
/// Attribute 12: WeightsData (LIST of LIST of REAL).
fn parse_rational_weights(bspline: &DecodedEntity) -> Option<Vec<Vec<f64>>> {
    let weights_attr = bspline.get(12)?;
    let rows = weights_attr.as_list()?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let cols = row.as_list()?;
        let row_weights: Vec<f64> = cols.iter().filter_map(|v| v.as_float()).collect();
        if row_weights.is_empty() {
            return None;
        }
        result.push(row_weights);
    }
    Some(result)
}

/// Parse control points from B-spline surface entity
fn parse_control_points(
    bspline: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Result<Vec<Vec<Point3<f64>>>> {
    // Attribute 2: ControlPointsList (LIST of LIST of IfcCartesianPoint)
    let cp_list_attr = bspline
        .get(2)
        .ok_or_else(|| Error::geometry("BSplineSurface missing ControlPointsList".to_string()))?;

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
fn parse_knot_vectors(bspline: &DecodedEntity) -> Result<(Vec<f64>, Vec<f64>)> {
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
    let u_knots = expand_knots(&u_knot_values, &u_mults);
    let v_knots = expand_knots(&v_knot_values, &v_mults);

    Ok((u_knots, v_knots))
}

// ---------- Surface-type-specific processors ----------

/// Extract a CartesianPoint's coordinates from a VertexPoint entity.
fn extract_vertex_coords(vertex: &DecodedEntity, decoder: &mut EntityDecoder) -> Option<Point3<f64>> {
    let point_attr = vertex.get(0)?;
    let point = decoder.resolve_ref(point_attr).ok().flatten()?;
    let coords = point.get(0).and_then(|v| v.as_list())?;
    let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
    let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
    let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);
    Some(Point3::new(x, y, z))
}

/// Evaluate a B-spline CURVE at parameter t (1D, not surface).
fn evaluate_bspline_curve(
    t: f64,
    degree: usize,
    control_points: &[Point3<f64>],
    knots: &[f64],
) -> Point3<f64> {
    let mut result = Point3::new(0.0, 0.0, 0.0);
    for (i, cp) in control_points.iter().enumerate() {
        let basis = bspline_basis(i, degree, t, knots);
        if basis.abs() > 1e-10 {
            result.x += basis * cp.x;
            result.y += basis * cp.y;
            result.z += basis * cp.z;
        }
    }
    result
}

/// Sample points along a B-spline curve edge.
/// Returns the start vertex plus intermediate sample points.
/// The end vertex is omitted (provided by the next edge's start in the loop).
fn sample_bspline_edge_curve(
    curve: &DecodedEntity,
    start: &Point3<f64>,
    curve_forward: bool,
    decoder: &mut EntityDecoder,
) -> Vec<Point3<f64>> {
    // Parse B-spline curve: degree(0), control_points(1), ..., knot_mults(6), knots(7)
    let degree = curve.get_float(0).unwrap_or(3.0) as usize;

    // Parse control points (attribute 1: LIST of IfcCartesianPoint)
    let cp_list = match curve.get(1).and_then(|a| a.as_list()) {
        Some(list) => list,
        None => return vec![*start],
    };
    let control_points: Vec<Point3<f64>> = cp_list
        .iter()
        .filter_map(|ref_val| {
            let id = ref_val.as_entity_ref()?;
            let pt = decoder.decode_by_id(id).ok()?;
            let coords = pt.get(0)?.as_list()?;
            let x = coords.first()?.as_float().unwrap_or(0.0);
            let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);
            Some(Point3::new(x, y, z))
        })
        .collect();

    if control_points.len() <= degree {
        return vec![*start];
    }

    // Parse knot multiplicities (attribute 6) and knot values (attribute 7)
    let mults: Vec<i64> = curve
        .get(6)
        .and_then(|a| a.as_list())
        .map(|l| l.iter().filter_map(|v| v.as_int()).collect())
        .unwrap_or_default();
    let knot_values: Vec<f64> = curve
        .get(7)
        .and_then(|a| a.as_list())
        .map(|l| l.iter().filter_map(|v| v.as_float()).collect())
        .unwrap_or_default();

    if mults.is_empty() || knot_values.is_empty() {
        return vec![*start];
    }

    let knots = expand_knots(&knot_values, &mults);
    let t_min = knots[degree];
    let t_max = knots[knots.len() - degree - 1];

    // Adaptive segment count based on control point density
    let n_segments = (control_points.len() * 2).clamp(4, 16);

    let mut points = Vec::with_capacity(n_segments + 1);
    // Add the start vertex first
    points.push(*start);

    // Sample intermediate points (skip last = next edge's start vertex)
    for i in 1..n_segments {
        let frac = i as f64 / n_segments as f64;
        let t = if curve_forward {
            t_min + (t_max - t_min) * frac
        } else {
            t_max - (t_max - t_min) * frac
        };
        let t_clamped = t.min(t_max - 1e-6).max(t_min);
        let pt = evaluate_bspline_curve(t_clamped, degree, &control_points, &knots);
        // Skip degenerate points (too close to previous)
        if let Some(prev) = points.last() {
            let dist_sq = (pt.x - prev.x).powi(2) + (pt.y - prev.y).powi(2) + (pt.z - prev.z).powi(2);
            if dist_sq < 1e-12 {
                continue;
            }
        }
        points.push(pt);
    }

    points
}

/// Extract polygon points from an edge loop, sampling B-spline curve edges
/// for intermediate points to preserve curvature.
fn extract_edge_loop_points(
    loop_entity: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Vec<Point3<f64>> {
    let edges = match loop_entity.get(0).and_then(|a| a.as_list()) {
        Some(e) => e,
        None => return Vec::new(),
    };

    let mut polygon_points = Vec::new();

    for edge_ref in edges {
        let edge_id = match edge_ref.as_entity_ref() {
            Some(id) => id,
            None => continue,
        };
        let oriented_edge = match decoder.decode_by_id(edge_id) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // IfcOrientedEdge: EdgeStart(0), EdgeEnd(1), EdgeElement(2), Orientation(3)
        let orientation = oriented_edge
            .get(3)
            .and_then(|a| a.as_enum())
            .map(|e| e == "T" || e == "TRUE")
            .unwrap_or(true);

        // Get the EdgeElement (IfcEdgeCurve)
        let edge_curve = match oriented_edge
            .get(2)
            .and_then(|attr| decoder.resolve_ref(attr).ok().flatten())
        {
            Some(ec) => ec,
            None => {
                // Fallback: extract start vertex only
                let vertex = oriented_edge
                    .get(0)
                    .and_then(|attr| decoder.resolve_ref(attr).ok().flatten());
                if let Some(v) = vertex {
                    if let Some(pt) = extract_vertex_coords(&v, decoder) {
                        polygon_points.push(pt);
                    }
                }
                continue;
            }
        };

        // IfcEdgeCurve: EdgeStart(0), EdgeEnd(1), EdgeGeometry(2), SameSense(3)
        let edge_same_sense = edge_curve.get(3).and_then(|a| a.as_enum())
            .map(|e| e == "T" || e == "TRUE").unwrap_or(true);

        // Orientation determines which direction we walk the edge in the loop:
        //   TRUE  → EdgeStart to EdgeEnd
        //   FALSE → EdgeEnd to EdgeStart
        // SameSense determines curve parameterization relative to edge direction:
        //   TRUE  → curve t_min→t_max goes EdgeStart→EdgeEnd
        //   FALSE → curve t_max→t_min goes EdgeStart→EdgeEnd
        // Combined: traverse curve forward when orientation==edge_same_sense
        let curve_forward = orientation == edge_same_sense;

        // Get start and end vertices from EdgeCurve
        let start_vertex = edge_curve
            .get(0)
            .and_then(|attr| decoder.resolve_ref(attr).ok().flatten());
        let end_vertex = edge_curve
            .get(1)
            .and_then(|attr| decoder.resolve_ref(attr).ok().flatten());

        let edge_start_pt = start_vertex.as_ref().and_then(|v| extract_vertex_coords(v, decoder));
        let edge_end_pt = end_vertex.as_ref().and_then(|v| extract_vertex_coords(v, decoder));

        // Walk direction is based on Orientation only (not SameSense):
        //   Orientation TRUE  → we encounter EdgeStart first
        //   Orientation FALSE → we encounter EdgeEnd first
        let (walk_start, _walk_end) = if orientation {
            (edge_start_pt, edge_end_pt)
        } else {
            (edge_end_pt, edge_start_pt)
        };

        // Get the edge geometry to check if it's a curve
        let edge_geometry = edge_curve
            .get(2)
            .and_then(|attr| decoder.resolve_ref(attr).ok().flatten());

        if let Some(geom) = edge_geometry {
            let geom_type = geom.ifc_type.as_str().to_uppercase();
            if geom_type == "IFCBSPLINECURVEWITHKNOTS" {
                // Sample B-spline curve for intermediate points
                let s = walk_start.unwrap_or(Point3::new(0.0, 0.0, 0.0));
                let sampled = sample_bspline_edge_curve(&geom, &s, curve_forward, decoder);
                polygon_points.extend(sampled);
                continue;
            }
            // For IfcLine, IfcCircle, etc.: just use start vertex
        }

        // Default: add start vertex only
        if let Some(pt) = walk_start {
            polygon_points.push(pt);
        }
    }

    polygon_points
}

/// Process a planar or boundary-represented face.
/// Extracts edge loop boundary points (with B-spline curve sampling)
/// and triangulates with robust ear-cutting.
fn process_planar_face(
    face: &DecodedEntity,
    decoder: &mut EntityDecoder,
) -> Result<(Vec<f32>, Vec<u32>)> {
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

            let loop_attr = bound_entity
                .get(0)
                .ok_or_else(|| Error::geometry("FaceBound missing Bound".to_string()))?;

            let loop_entity = decoder
                .resolve_ref(loop_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve loop".to_string()))?;

            if !loop_entity.ifc_type.as_str().eq_ignore_ascii_case("IFCEDGELOOP") {
                continue;
            }

            // Extract polygon points with B-spline curve sampling
            let polygon_points = extract_edge_loop_points(&loop_entity, decoder);

            if polygon_points.len() >= 3 {
                let base_idx = (positions.len() / 3) as u32;

                for point in &polygon_points {
                    positions.push(point.x as f32);
                    positions.push(point.y as f32);
                    positions.push(point.z as f32);
                }

                // Project 3D polygon to 2D for robust ear-cutting triangulation
                let normal = calculate_polygon_normal(&polygon_points);
                let (points_2d, _, _, _) = project_to_2d(&polygon_points, &normal);

                match triangulate_polygon(&points_2d) {
                    Ok(tri_indices) => {
                        for idx in tri_indices {
                            indices.push(base_idx + idx as u32);
                        }
                    }
                    Err(_) => {
                        // Fallback to fan triangulation
                        for i in 1..polygon_points.len() - 1 {
                            indices.push(base_idx);
                            indices.push(base_idx + i as u32);
                            indices.push(base_idx + i as u32 + 1);
                        }
                    }
                }
            }
        }
    }

    Ok((positions, indices))
}

/// Process a B-spline surface face.
/// When `weights` is `Some`, rational (NURBS) evaluation is used.
fn process_bspline_face(
    bspline: &DecodedEntity,
    decoder: &mut EntityDecoder,
    weights: Option<&[Vec<f64>]>,
) -> Result<(Vec<f32>, Vec<u32>)> {
    // Get degrees
    let u_degree = bspline.get_float(0).unwrap_or(3.0) as usize;
    let v_degree = bspline.get_float(1).unwrap_or(1.0) as usize;

    // Parse control points
    let control_points = parse_control_points(bspline, decoder)?;

    // Parse knot vectors
    let (u_knots, v_knots) = parse_knot_vectors(bspline)?;

    // Determine tessellation resolution based on surface complexity
    let u_segments = (control_points.len() * 3).clamp(8, 24);
    let v_segments = if !control_points.is_empty() {
        (control_points[0].len() * 3).clamp(4, 24)
    } else {
        4
    };

    // Tessellate the surface (returns None if knot data is inconsistent)
    match tessellate_bspline_surface(
        u_degree,
        v_degree,
        &control_points,
        &u_knots,
        &v_knots,
        weights,
        u_segments,
        v_segments,
    ) {
        Some((positions, indices)) => Ok((positions, indices)),
        None => Ok((Vec::new(), Vec::new())),
    }
}

/// Process a cylindrical surface face
fn process_cylindrical_face(
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
            let loop_attr = bound_entity
                .get(0)
                .ok_or_else(|| Error::geometry("FaceBound missing Bound".to_string()))?;

            if let Some(loop_entity) = decoder.resolve_ref(loop_attr)? {
                if loop_entity
                    .ifc_type
                    .as_str()
                    .eq_ignore_ascii_case("IFCEDGELOOP")
                {
                    if let Some(edges_attr) = loop_entity.get(0) {
                        if let Some(edges) = edges_attr.as_list() {
                            for edge_ref in edges {
                                if let Some(edge_id) = edge_ref.as_entity_ref() {
                                    if let Ok(oriented_edge) = decoder.decode_by_id(edge_id) {
                                        // IfcOrientedEdge: 0=EdgeStart, 1=EdgeEnd, 2=EdgeElement, 3=Orientation
                                        // EdgeStart/EdgeEnd can be * (null), get from EdgeElement if needed

                                        // Try to get start vertex from OrientedEdge first
                                        let start_vertex = oriented_edge
                                            .get(0)
                                            .and_then(|attr| {
                                                decoder.resolve_ref(attr).ok().flatten()
                                            });

                                        // If null, get from EdgeElement (attribute 2)
                                        let vertex = if start_vertex.is_some() {
                                            start_vertex
                                        } else if let Some(edge_elem_attr) =
                                            oriented_edge.get(2)
                                        {
                                            // Get EdgeElement (IfcEdgeCurve)
                                            if let Some(edge_curve) = decoder
                                                .resolve_ref(edge_elem_attr)
                                                .ok()
                                                .flatten()
                                            {
                                                // IfcEdgeCurve: 0=EdgeStart, 1=EdgeEnd, 2=EdgeGeometry
                                                edge_curve.get(0).and_then(|attr| {
                                                    decoder.resolve_ref(attr).ok().flatten()
                                                })
                                            } else {
                                                None
                                            }
                                        } else {
                                            None
                                        };

                                        if let Some(vertex) = vertex {
                                            // IfcVertexPoint: 0=VertexGeometry (IfcCartesianPoint)
                                            if let Some(point_attr) = vertex.get(0) {
                                                if let Some(point) = decoder
                                                    .resolve_ref(point_attr)
                                                    .ok()
                                                    .flatten()
                                                {
                                                    if let Some(coords) =
                                                        point.get(0).and_then(|v| v.as_list())
                                                    {
                                                        let x = coords
                                                            .first()
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
                                                        boundary_points
                                                            .push(Point3::new(x, y, z));
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
    let inv_transform = axis_transform
        .try_inverse()
        .unwrap_or(Matrix4::identity());
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

    // Handle angle wrapping (if angles span across -pi/pi boundary)
    if max_angle - min_angle > std::f64::consts::PI * 1.5 {
        // Likely wraps around, recalculate with positive angles
        let positive_angles: Vec<f64> = local_points
            .iter()
            .map(|p| {
                let a = p.y.atan2(p.x);
                if a < 0.0 {
                    a + 2.0 * std::f64::consts::PI
                } else {
                    a
                }
            })
            .collect();
        min_angle = positive_angles.iter().cloned().fold(f64::MAX, f64::min);
        max_angle = positive_angles.iter().cloned().fold(f64::MIN, f64::max);
    }

    // Tessellation parameters
    let angle_span = max_angle - min_angle;
    let height = max_z - min_z;

    // Balance between accuracy and matching web-ifc's output
    // Use ~15 degrees per segment (pi/12) for good curvature approximation
    let angle_segments =
        ((angle_span / (std::f64::consts::PI / 12.0)).ceil() as usize).clamp(3, 16);
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
