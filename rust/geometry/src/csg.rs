// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! CSG (Constructive Solid Geometry) Operations
//!
//! Fast triangle clipping and boolean operations.

use crate::error::Result;
use crate::mesh::Mesh;
use crate::triangulation::{calculate_polygon_normal, project_to_2d, triangulate_polygon};
use nalgebra::{Point3, Vector3};
use rustc_hash::FxHashMap;

/// Plane definition for clipping
#[derive(Debug, Clone, Copy)]
pub struct Plane {
    /// Point on the plane
    pub point: Point3<f64>,
    /// Normal vector (must be normalized)
    pub normal: Vector3<f64>,
}

impl Plane {
    /// Create a new plane
    pub fn new(point: Point3<f64>, normal: Vector3<f64>) -> Self {
        Self {
            point,
            normal: normal.normalize(),
        }
    }

    /// Calculate signed distance from point to plane
    /// Positive = in front, Negative = behind
    pub fn signed_distance(&self, point: &Point3<f64>) -> f64 {
        (point - self.point).dot(&self.normal)
    }

    /// Check if point is in front of plane
    pub fn is_front(&self, point: &Point3<f64>) -> bool {
        self.signed_distance(point) >= 0.0
    }
}

/// Triangle clipping result
#[derive(Debug, Clone)]
pub enum ClipResult {
    /// Triangle is completely in front (keep it)
    AllFront(Triangle),
    /// Triangle is completely behind (discard it)
    AllBehind,
    /// Triangle intersects plane - returns new triangles
    Split(Vec<Triangle>),
}

/// Triangle definition
#[derive(Debug, Clone)]
pub struct Triangle {
    pub v0: Point3<f64>,
    pub v1: Point3<f64>,
    pub v2: Point3<f64>,
}

impl Triangle {
    /// Create a new triangle
    pub fn new(v0: Point3<f64>, v1: Point3<f64>, v2: Point3<f64>) -> Self {
        Self { v0, v1, v2 }
    }

    /// Calculate triangle normal
    pub fn normal(&self) -> Vector3<f64> {
        let edge1 = self.v1 - self.v0;
        let edge2 = self.v2 - self.v0;
        edge1.cross(&edge2).normalize()
    }

    /// Calculate triangle area
    pub fn area(&self) -> f64 {
        let edge1 = self.v1 - self.v0;
        let edge2 = self.v2 - self.v0;
        edge1.cross(&edge2).norm() * 0.5
    }
}

/// CSG Clipping Processor
pub struct ClippingProcessor {
    /// Epsilon for floating point comparisons
    pub epsilon: f64,
}

/// Create a box mesh from AABB min/max bounds
/// Returns a mesh with 12 triangles (2 per face, 6 faces)
fn aabb_to_mesh(min: Point3<f64>, max: Point3<f64>) -> Mesh {
    let mut mesh = Mesh::with_capacity(8, 36);

    // Define the 8 vertices of the box
    let v0 = Point3::new(min.x, min.y, min.z); // 0: front-bottom-left
    let v1 = Point3::new(max.x, min.y, min.z); // 1: front-bottom-right
    let v2 = Point3::new(max.x, max.y, min.z); // 2: front-top-right
    let v3 = Point3::new(min.x, max.y, min.z); // 3: front-top-left
    let v4 = Point3::new(min.x, min.y, max.z); // 4: back-bottom-left
    let v5 = Point3::new(max.x, min.y, max.z); // 5: back-bottom-right
    let v6 = Point3::new(max.x, max.y, max.z); // 6: back-top-right
    let v7 = Point3::new(min.x, max.y, max.z); // 7: back-top-left

    // Add triangles for each face (counter-clockwise winding when viewed from outside)
    // Front face (z = min.z) - normal points toward -Z
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v0, v2, v1));
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v0, v3, v2));

    // Back face (z = max.z) - normal points toward +Z
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v4, v5, v6));
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v4, v6, v7));

    // Left face (x = min.x) - normal points toward -X
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v0, v4, v7));
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v0, v7, v3));

    // Right face (x = max.x) - normal points toward +X
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v1, v2, v6));
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v1, v6, v5));

    // Bottom face (y = min.y) - normal points toward -Y
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v0, v1, v5));
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v0, v5, v4));

    // Top face (y = max.y) - normal points toward +Y
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v3, v7, v6));
    add_triangle_to_mesh(&mut mesh, &Triangle::new(v3, v6, v2));

    mesh
}

impl ClippingProcessor {
    /// Create a new clipping processor
    pub fn new() -> Self {
        Self { epsilon: 1e-6 }
    }

    /// Clip a triangle against a plane
    /// Returns triangles that are in front of the plane
    pub fn clip_triangle(&self, triangle: &Triangle, plane: &Plane) -> ClipResult {
        // Calculate signed distances for all vertices
        let d0 = plane.signed_distance(&triangle.v0);
        let d1 = plane.signed_distance(&triangle.v1);
        let d2 = plane.signed_distance(&triangle.v2);

        // Count vertices in front of plane
        let mut front_count = 0;
        if d0 >= -self.epsilon {
            front_count += 1;
        }
        if d1 >= -self.epsilon {
            front_count += 1;
        }
        if d2 >= -self.epsilon {
            front_count += 1;
        }

        match front_count {
            // All vertices behind - discard triangle
            0 => ClipResult::AllBehind,

            // All vertices in front - keep triangle
            3 => ClipResult::AllFront(triangle.clone()),

            // One vertex in front - create 1 smaller triangle
            1 => {
                let (front, back1, back2) = if d0 >= -self.epsilon {
                    (triangle.v0, triangle.v1, triangle.v2)
                } else if d1 >= -self.epsilon {
                    (triangle.v1, triangle.v2, triangle.v0)
                } else {
                    (triangle.v2, triangle.v0, triangle.v1)
                };

                // Interpolate to find intersection points
                let d_front = if d0 >= -self.epsilon {
                    d0
                } else if d1 >= -self.epsilon {
                    d1
                } else {
                    d2
                };
                let d_back1 = if d0 >= -self.epsilon {
                    d1
                } else if d1 >= -self.epsilon {
                    d2
                } else {
                    d0
                };
                let d_back2 = if d0 >= -self.epsilon {
                    d2
                } else if d1 >= -self.epsilon {
                    d0
                } else {
                    d1
                };

                let t1 = d_front / (d_front - d_back1);
                let t2 = d_front / (d_front - d_back2);

                let p1 = front + (back1 - front) * t1;
                let p2 = front + (back2 - front) * t2;

                ClipResult::Split(vec![Triangle::new(front, p1, p2)])
            }

            // Two vertices in front - create 2 triangles
            2 => {
                let (front1, front2, back) = if d0 < -self.epsilon {
                    (triangle.v1, triangle.v2, triangle.v0)
                } else if d1 < -self.epsilon {
                    (triangle.v2, triangle.v0, triangle.v1)
                } else {
                    (triangle.v0, triangle.v1, triangle.v2)
                };

                // Interpolate to find intersection points
                let d_back = if d0 < -self.epsilon {
                    d0
                } else if d1 < -self.epsilon {
                    d1
                } else {
                    d2
                };
                let d_front1 = if d0 < -self.epsilon {
                    d1
                } else if d1 < -self.epsilon {
                    d2
                } else {
                    d0
                };
                let d_front2 = if d0 < -self.epsilon {
                    d2
                } else if d1 < -self.epsilon {
                    d0
                } else {
                    d1
                };

                let t1 = d_front1 / (d_front1 - d_back);
                let t2 = d_front2 / (d_front2 - d_back);

                let p1 = front1 + (back - front1) * t1;
                let p2 = front2 + (back - front2) * t2;

                ClipResult::Split(vec![
                    Triangle::new(front1, front2, p1),
                    Triangle::new(front2, p2, p1),
                ])
            }

            _ => unreachable!(),
        }
    }

    /// Box subtraction - removes everything inside the box from the mesh
    /// Uses proper CSG difference operation via subtract_mesh
    pub fn subtract_box(&self, mesh: &Mesh, min: Point3<f64>, max: Point3<f64>) -> Result<Mesh> {
        // Fast path: if mesh is empty, return empty mesh
        if mesh.is_empty() {
            return Ok(Mesh::new());
        }

        // Create a box mesh from the AABB bounds
        let box_mesh = aabb_to_mesh(min, max);

        // Use the CSG difference operation (mesh - box)
        self.subtract_mesh(mesh, &box_mesh)
    }

    /// Extract opening profile from mesh (find largest face)
    /// Returns profile points as an ordered contour and the face normal
    /// Uses boundary extraction via edge counting to produce stable results
    #[allow(dead_code)]
    fn extract_opening_profile(
        &self,
        opening_mesh: &Mesh,
    ) -> Option<(Vec<Point3<f64>>, Vector3<f64>)> {
        if opening_mesh.is_empty() {
            return None;
        }

        // Group triangles by normal to find faces
        let mut face_groups: FxHashMap<u64, Vec<(Point3<f64>, Point3<f64>, Point3<f64>)>> =
            FxHashMap::default();
        let normal_epsilon = 0.01; // Tolerance for normal comparison

        for i in (0..opening_mesh.indices.len()).step_by(3) {
            let i0 = opening_mesh.indices[i] as usize;
            let i1 = opening_mesh.indices[i + 1] as usize;
            let i2 = opening_mesh.indices[i + 2] as usize;

            let v0 = Point3::new(
                opening_mesh.positions[i0 * 3] as f64,
                opening_mesh.positions[i0 * 3 + 1] as f64,
                opening_mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                opening_mesh.positions[i1 * 3] as f64,
                opening_mesh.positions[i1 * 3 + 1] as f64,
                opening_mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                opening_mesh.positions[i2 * 3] as f64,
                opening_mesh.positions[i2 * 3 + 1] as f64,
                opening_mesh.positions[i2 * 3 + 2] as f64,
            );

            let edge1 = v1 - v0;
            let edge2 = v2 - v0;
            // Use try_normalize to handle degenerate triangles
            let normal = match edge1.cross(&edge2).try_normalize(1e-10) {
                Some(n) => n,
                None => continue, // Skip degenerate triangles
            };

            // Quantize normal for grouping (round to nearest 0.01)
            let nx = (normal.x / normal_epsilon).round() as i32;
            let ny = (normal.y / normal_epsilon).round() as i32;
            let nz = (normal.z / normal_epsilon).round() as i32;
            let key = ((nx as u64) << 32) | ((ny as u32 as u64) << 16) | (nz as u32 as u64);

            face_groups.entry(key).or_default().push((v0, v1, v2));
        }

        // Find largest face group (most triangles = largest face)
        let largest_face = face_groups
            .iter()
            .max_by_key(|(_, triangles)| triangles.len())?;

        let triangles = largest_face.1;
        if triangles.is_empty() {
            return None;
        }

        // Build edge count map to find boundary edges
        // An edge is a boundary if it appears exactly once (not shared between triangles)
        // Use quantized vertex positions as keys
        let quantize = |p: &Point3<f64>| -> (i64, i64, i64) {
            let scale = 1e6; // Quantize to micrometer precision
            (
                (p.x * scale).round() as i64,
                (p.y * scale).round() as i64,
                (p.z * scale).round() as i64,
            )
        };

        // Edge key: ordered pair of quantized vertices (smaller first for consistency)
        let make_edge_key =
            |a: (i64, i64, i64), b: (i64, i64, i64)| -> ((i64, i64, i64), (i64, i64, i64)) {
                if a < b {
                    (a, b)
                } else {
                    (b, a)
                }
            };

        // Count edges and store original vertices
        let mut edge_count: FxHashMap<
            ((i64, i64, i64), (i64, i64, i64)),
            (usize, Point3<f64>, Point3<f64>),
        > = FxHashMap::default();

        for (v0, v1, v2) in triangles {
            let q0 = quantize(v0);
            let q1 = quantize(v1);
            let q2 = quantize(v2);

            // Three edges per triangle
            for (qa, qb, pa, pb) in [
                (q0, q1, *v0, *v1),
                (q1, q2, *v1, *v2),
                (q2, q0, *v2, *v0),
            ] {
                let key = make_edge_key(qa, qb);
                edge_count
                    .entry(key)
                    .and_modify(|(count, _, _)| *count += 1)
                    .or_insert((1, pa, pb));
            }
        }

        // Collect boundary edges (count == 1)
        let mut boundary_edges: Vec<(Point3<f64>, Point3<f64>)> = Vec::new();
        for (_, (count, pa, pb)) in &edge_count {
            if *count == 1 {
                boundary_edges.push((*pa, *pb));
            }
        }

        if boundary_edges.is_empty() {
            // No boundary found (closed surface with no edges) - fall back to using centroid
            return None;
        }

        // Build vertex adjacency map for boundary traversal
        let mut adjacency: FxHashMap<(i64, i64, i64), Vec<(i64, i64, i64, Point3<f64>)>> =
            FxHashMap::default();
        for (pa, pb) in &boundary_edges {
            let qa = quantize(pa);
            let qb = quantize(pb);
            adjacency.entry(qa).or_default().push((qb.0, qb.1, qb.2, *pb));
            adjacency.entry(qb).or_default().push((qa.0, qa.1, qa.2, *pa));
        }

        // Build ordered contour by walking the boundary
        let mut contour: Vec<Point3<f64>> = Vec::new();
        let mut visited: FxHashMap<(i64, i64, i64), bool> = FxHashMap::default();

        // Start from first boundary edge
        if let Some((start_p, _)) = boundary_edges.first() {
            let start_q = quantize(start_p);
            contour.push(*start_p);
            visited.insert(start_q, true);

            let mut current_q = start_q;

            // Walk around the boundary
            loop {
                let neighbors = match adjacency.get(&current_q) {
                    Some(n) => n,
                    None => break,
                };

                // Find unvisited neighbor
                let mut found_next = false;
                for (nqx, nqy, nqz, np) in neighbors {
                    let nq = (*nqx, *nqy, *nqz);
                    if !visited.get(&nq).unwrap_or(&false) {
                        contour.push(*np);
                        visited.insert(nq, true);
                        current_q = nq;
                        found_next = true;
                        break;
                    }
                }

                if !found_next {
                    break; // Closed loop or no more unvisited neighbors
                }
            }
        }

        if contour.len() < 3 {
            // Not enough points for a valid polygon
            return None;
        }

        // Calculate normal from the ordered contour
        let normal = calculate_polygon_normal(&contour);

        // Normalize the result
        let normalized_normal = match normal.try_normalize(1e-10) {
            Some(n) => n,
            None => return None, // Degenerate polygon
        };

        Some((contour, normalized_normal))
    }

    /// Convert our Mesh format to csgrs Mesh format
    fn mesh_to_csgrs(mesh: &Mesh) -> Result<csgrs::mesh::Mesh<()>> {
        use csgrs::mesh::{polygon::Polygon, vertex::Vertex, Mesh as CSGMesh};
        use std::sync::OnceLock;

        if mesh.is_empty() {
            return Ok(CSGMesh {
                polygons: Vec::new(),
                bounding_box: OnceLock::new(),
                metadata: None,
            });
        }

        let mut polygons = Vec::new();

        // Process each triangle
        for i in (0..mesh.indices.len()).step_by(3) {
            let i0 = mesh.indices[i] as usize;
            let i1 = mesh.indices[i + 1] as usize;
            let i2 = mesh.indices[i + 2] as usize;

            // Get triangle vertices
            let v0 = Point3::new(
                mesh.positions[i0 * 3] as f64,
                mesh.positions[i0 * 3 + 1] as f64,
                mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                mesh.positions[i1 * 3] as f64,
                mesh.positions[i1 * 3 + 1] as f64,
                mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                mesh.positions[i2 * 3] as f64,
                mesh.positions[i2 * 3 + 1] as f64,
                mesh.positions[i2 * 3 + 2] as f64,
            );

            // Calculate face normal from triangle edges
            // Use try_normalize to handle degenerate (zero-area/collinear) triangles
            let edge1 = v1 - v0;
            let edge2 = v2 - v0;
            let face_normal = match edge1.cross(&edge2).try_normalize(1e-10) {
                Some(n) => n,
                None => continue, // Skip degenerate triangles to avoid NaN propagation
            };

            // Create csgrs vertices (use face normal for all vertices)
            let vertices = vec![
                Vertex::new(v0, face_normal),
                Vertex::new(v1, face_normal),
                Vertex::new(v2, face_normal),
            ];

            polygons.push(Polygon::new(vertices, None));
        }

        Ok(CSGMesh::from_polygons(&polygons, None))
    }

    /// Convert csgrs Mesh format back to our Mesh format
    fn csgrs_to_mesh(csg_mesh: &csgrs::mesh::Mesh<()>) -> Result<Mesh> {
        let mut mesh = Mesh::new();

        for polygon in &csg_mesh.polygons {
            let vertices = &polygon.vertices;
            if vertices.len() < 3 {
                continue;
            }

            // Extract 3D positions
            let points_3d: Vec<Point3<f64>> = vertices
                .iter()
                .map(|v| Point3::new(v.pos[0], v.pos[1], v.pos[2]))
                .collect();

            // Get the CSG polygon's intended normal (from first vertex)
            // Validate and normalize to avoid NaN propagation in project_to_2d
            let raw_normal = Vector3::new(
                vertices[0].normal[0],
                vertices[0].normal[1],
                vertices[0].normal[2],
            );

            // Try to normalize the CSG normal; if it fails (zero or NaN), compute from points
            let csg_normal = match raw_normal.try_normalize(1e-10) {
                Some(n) if n.x.is_finite() && n.y.is_finite() && n.z.is_finite() => n,
                _ => {
                    // Fall back to computing normal from polygon points
                    let computed = calculate_polygon_normal(&points_3d);
                    match computed.try_normalize(1e-10) {
                        Some(n) => n,
                        None => continue, // Skip degenerate polygon
                    }
                }
            };

            // FAST PATH: Triangle - no triangulation needed
            if points_3d.len() == 3 {
                let base_idx = mesh.vertex_count();
                for v in vertices {
                    mesh.add_vertex(v.pos, v.normal);
                }
                mesh.add_triangle(
                    base_idx as u32,
                    (base_idx + 1) as u32,
                    (base_idx + 2) as u32,
                );
                continue;
            }

            // Project 3D polygon to 2D using CSG normal (preserves winding intent)
            let (points_2d, _, _, _) = project_to_2d(&points_3d, &csg_normal);

            // Triangulate (handles convex AND concave polygons)
            let indices = match triangulate_polygon(&points_2d) {
                Ok(idx) => idx,
                Err(_) => continue, // Skip degenerate polygons
            };

            // Add vertices and create triangles (winding is correct from projection)
            let base_idx = mesh.vertex_count();
            for v in vertices {
                mesh.add_vertex(v.pos, v.normal);
            }

            for tri in indices.chunks(3) {
                if tri.len() == 3 {
                    mesh.add_triangle(
                        (base_idx + tri[0]) as u32,
                        (base_idx + tri[1]) as u32,
                        (base_idx + tri[2]) as u32,
                    );
                }
            }
        }

        Ok(mesh)
    }

    /// Subtract opening mesh from host mesh using csgrs CSG boolean operations
    pub fn subtract_mesh(&self, host_mesh: &Mesh, opening_mesh: &Mesh) -> Result<Mesh> {
        use csgrs::traits::CSG;

        // Fast path: if opening is empty, return host unchanged
        if opening_mesh.is_empty() {
            return Ok(host_mesh.clone());
        }

        // Convert meshes to csgrs format
        let host_csg = Self::mesh_to_csgrs(host_mesh)?;
        let opening_csg = Self::mesh_to_csgrs(opening_mesh)?;

        // Perform CSG difference (host - opening)
        let result_csg = host_csg.difference(&opening_csg);

        // Convert back to our Mesh format
        Self::csgrs_to_mesh(&result_csg)
    }

    /// Clip mesh using bounding box (6 planes) - DEPRECATED: use subtract_box() instead
    /// Subtracts everything inside the box from the mesh
    #[deprecated(note = "Use subtract_box() for better performance")]
    pub fn clip_mesh_with_box(
        &self,
        mesh: &Mesh,
        min: Point3<f64>,
        max: Point3<f64>,
    ) -> Result<Mesh> {
        self.subtract_box(mesh, min, max)
    }

    /// Clip an entire mesh against a plane
    pub fn clip_mesh(&self, mesh: &Mesh, plane: &Plane) -> Result<Mesh> {
        let mut result = Mesh::new();

        // Process each triangle
        for i in (0..mesh.indices.len()).step_by(3) {
            let i0 = mesh.indices[i] as usize;
            let i1 = mesh.indices[i + 1] as usize;
            let i2 = mesh.indices[i + 2] as usize;

            // Get triangle vertices
            let v0 = Point3::new(
                mesh.positions[i0 * 3] as f64,
                mesh.positions[i0 * 3 + 1] as f64,
                mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                mesh.positions[i1 * 3] as f64,
                mesh.positions[i1 * 3 + 1] as f64,
                mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                mesh.positions[i2 * 3] as f64,
                mesh.positions[i2 * 3 + 1] as f64,
                mesh.positions[i2 * 3 + 2] as f64,
            );

            let triangle = Triangle::new(v0, v1, v2);

            // Clip triangle
            match self.clip_triangle(&triangle, plane) {
                ClipResult::AllFront(tri) => {
                    // Keep original triangle
                    add_triangle_to_mesh(&mut result, &tri);
                }
                ClipResult::AllBehind => {
                    // Discard triangle
                }
                ClipResult::Split(triangles) => {
                    // Add clipped triangles
                    for tri in triangles {
                        add_triangle_to_mesh(&mut result, &tri);
                    }
                }
            }
        }

        Ok(result)
    }
}

impl Default for ClippingProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// Add a triangle to a mesh
fn add_triangle_to_mesh(mesh: &mut Mesh, triangle: &Triangle) {
    let base_idx = mesh.vertex_count() as u32;

    // Calculate normal
    let normal = triangle.normal();

    // Add vertices
    mesh.add_vertex(triangle.v0, normal);
    mesh.add_vertex(triangle.v1, normal);
    mesh.add_vertex(triangle.v2, normal);

    // Add triangle
    mesh.add_triangle(base_idx, base_idx + 1, base_idx + 2);
}

/// Calculate smooth normals for a mesh
#[inline]
pub fn calculate_normals(mesh: &mut Mesh) {
    let vertex_count = mesh.vertex_count();
    if vertex_count == 0 {
        return;
    }

    // Initialize normals to zero
    let mut normals = vec![Vector3::zeros(); vertex_count];

    // Accumulate face normals
    for i in (0..mesh.indices.len()).step_by(3) {
        let i0 = mesh.indices[i] as usize;
        let i1 = mesh.indices[i + 1] as usize;
        let i2 = mesh.indices[i + 2] as usize;

        // Get triangle vertices
        let v0 = Point3::new(
            mesh.positions[i0 * 3] as f64,
            mesh.positions[i0 * 3 + 1] as f64,
            mesh.positions[i0 * 3 + 2] as f64,
        );
        let v1 = Point3::new(
            mesh.positions[i1 * 3] as f64,
            mesh.positions[i1 * 3 + 1] as f64,
            mesh.positions[i1 * 3 + 2] as f64,
        );
        let v2 = Point3::new(
            mesh.positions[i2 * 3] as f64,
            mesh.positions[i2 * 3 + 1] as f64,
            mesh.positions[i2 * 3 + 2] as f64,
        );

        // Calculate face normal
        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let normal = edge1.cross(&edge2);

        // Accumulate normal for each vertex
        normals[i0] += normal;
        normals[i1] += normal;
        normals[i2] += normal;
    }

    // Normalize and write back
    mesh.normals.clear();
    mesh.normals.reserve(vertex_count * 3);

    for normal in normals {
        let normalized = normal.normalize();
        mesh.normals.push(normalized.x as f32);
        mesh.normals.push(normalized.y as f32);
        mesh.normals.push(normalized.z as f32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plane_signed_distance() {
        let plane = Plane::new(Point3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 1.0));

        assert_eq!(plane.signed_distance(&Point3::new(0.0, 0.0, 5.0)), 5.0);
        assert_eq!(plane.signed_distance(&Point3::new(0.0, 0.0, -5.0)), -5.0);
        assert_eq!(plane.signed_distance(&Point3::new(5.0, 5.0, 0.0)), 0.0);
    }

    #[test]
    fn test_clip_triangle_all_front() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 1.0),
            Point3::new(1.0, 0.0, 1.0),
            Point3::new(0.5, 1.0, 1.0),
        );
        let plane = Plane::new(Point3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 1.0));

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::AllFront(_) => {}
            _ => panic!("Expected AllFront"),
        }
    }

    #[test]
    fn test_clip_triangle_all_behind() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, -1.0),
            Point3::new(1.0, 0.0, -1.0),
            Point3::new(0.5, 1.0, -1.0),
        );
        let plane = Plane::new(Point3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 1.0));

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::AllBehind => {}
            _ => panic!("Expected AllBehind"),
        }
    }

    #[test]
    fn test_clip_triangle_split_one_front() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 1.0),  // Front
            Point3::new(1.0, 0.0, -1.0), // Behind
            Point3::new(0.5, 1.0, -1.0), // Behind
        );
        let plane = Plane::new(Point3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 1.0));

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::Split(triangles) => {
                assert_eq!(triangles.len(), 1);
            }
            _ => panic!("Expected Split"),
        }
    }

    #[test]
    fn test_clip_triangle_split_two_front() {
        let processor = ClippingProcessor::new();
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 1.0),  // Front
            Point3::new(1.0, 0.0, 1.0),  // Front
            Point3::new(0.5, 1.0, -1.0), // Behind
        );
        let plane = Plane::new(Point3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 1.0));

        match processor.clip_triangle(&triangle, &plane) {
            ClipResult::Split(triangles) => {
                assert_eq!(triangles.len(), 2);
            }
            _ => panic!("Expected Split with 2 triangles"),
        }
    }

    #[test]
    fn test_triangle_normal() {
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
        );

        let normal = triangle.normal();
        assert!((normal.z - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_triangle_area() {
        let triangle = Triangle::new(
            Point3::new(0.0, 0.0, 0.0),
            Point3::new(1.0, 0.0, 0.0),
            Point3::new(0.0, 1.0, 0.0),
        );

        let area = triangle.area();
        assert!((area - 0.5).abs() < 1e-6);
    }
}
