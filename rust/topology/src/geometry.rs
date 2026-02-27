// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometric queries on topology entities.
//!
//! Computes lengths, areas, volumes, normals, centroids, and containment using
//! standard computational geometry algorithms (no external kernel required).

use nalgebra::{Point3, Vector3};

use crate::arena::TopologyArena;
use crate::keys::*;

impl TopologyArena {
    /// Returns the 3D position of a vertex as a nalgebra Point3.
    pub fn vertex_point(&self, key: VertexKey) -> Option<Point3<f64>> {
        self.vertices
            .get(key)
            .map(|v| Point3::new(v.x, v.y, v.z))
    }

    /// Computes the Euclidean length of an edge.
    pub fn edge_length(&self, key: EdgeKey) -> Option<f64> {
        let edge = self.edges.get(key)?;
        let p0 = self.vertex_point(edge.start)?;
        let p1 = self.vertex_point(edge.end)?;
        Some((p1 - p0).norm())
    }

    /// Computes the face normal using Newell's method.
    ///
    /// Works for any planar polygon (convex or concave). The normal direction
    /// follows the right-hand rule relative to the vertex winding order.
    pub fn face_normal(&self, key: FaceKey) -> Option<Vector3<f64>> {
        let face = self.faces.get(key)?;
        let verts = self.wire_vertices_ordered(face.outer_wire)?;

        if verts.len() < 3 {
            return None;
        }

        // Newell's method for polygon normal
        let mut normal = Vector3::new(0.0, 0.0, 0.0);
        let n = verts.len();

        for i in 0..n {
            let curr = self.vertex_point(verts[i])?;
            let next = self.vertex_point(verts[(i + 1) % n])?;

            normal.x += (curr.y - next.y) * (curr.z + next.z);
            normal.y += (curr.z - next.z) * (curr.x + next.x);
            normal.z += (curr.x - next.x) * (curr.y + next.y);
        }

        let len = normal.norm();
        if len < 1e-15 {
            return None; // degenerate face
        }

        Some(normal / len)
    }

    /// Computes the area of a face using the cross-product triangle fan method.
    ///
    /// For faces with holes, the hole areas are subtracted.
    pub fn face_area(&self, key: FaceKey) -> Option<f64> {
        let face = self.faces.get(key)?;

        let outer_area = self.wire_area(face.outer_wire)?;
        let mut total = outer_area;

        for &iw in &face.inner_wires {
            if let Some(hole_area) = self.wire_area(iw) {
                total -= hole_area;
            }
        }

        Some(total.abs())
    }

    /// Computes the area enclosed by a wire (assumes planar polygon).
    fn wire_area(&self, key: WireKey) -> Option<f64> {
        let verts = self.wire_vertices_ordered(key)?;

        if verts.len() < 3 {
            return Some(0.0);
        }

        // Use the cross-product method: sum of cross products of triangles
        // from vertex 0 to each consecutive edge
        let p0 = self.vertex_point(verts[0])?;
        let mut total = Vector3::new(0.0, 0.0, 0.0);

        for i in 1..verts.len() - 1 {
            let p1 = self.vertex_point(verts[i])?;
            let p2 = self.vertex_point(verts[i + 1])?;

            let v1 = p1 - p0;
            let v2 = p2 - p0;
            total += v1.cross(&v2);
        }

        Some(total.norm() / 2.0)
    }

    /// Computes the centroid (center of mass) of a face.
    pub fn face_centroid(&self, key: FaceKey) -> Option<Point3<f64>> {
        let face = self.faces.get(key)?;
        let verts = self.wire_vertices_ordered(face.outer_wire)?;

        if verts.is_empty() {
            return None;
        }

        let mut sum = Vector3::new(0.0, 0.0, 0.0);
        for &vk in &verts {
            let p = self.vertex_point(vk)?;
            sum += p.coords;
        }

        let n = verts.len() as f64;
        Some(Point3::from(sum / n))
    }

    /// Computes the volume of a cell using the signed tetrahedron method.
    ///
    /// Sums the signed volume of tetrahedra formed by each face triangle and
    /// the origin. Works for any closed polyhedral surface.
    pub fn cell_volume(&self, key: CellKey) -> Option<f64> {
        let cell = self.cells.get(key)?;
        let faces = self.shell_faces(cell.outer_shell)?;

        let mut volume = 0.0;

        for &fk in faces {
            let face = self.faces.get(fk)?;
            let verts = self.wire_vertices_ordered(face.outer_wire)?;

            if verts.len() < 3 {
                continue;
            }

            // Triangulate the face as a fan from vertex 0
            let p0 = self.vertex_point(verts[0])?;
            for i in 1..verts.len() - 1 {
                let p1 = self.vertex_point(verts[i])?;
                let p2 = self.vertex_point(verts[i + 1])?;

                // Signed volume of tetrahedron formed with origin
                volume += p0.coords.dot(&p1.coords.cross(&p2.coords));
            }
        }

        Some((volume / 6.0).abs())
    }

    /// Computes the centroid (center of mass) of a cell.
    pub fn cell_centroid(&self, key: CellKey) -> Option<Point3<f64>> {
        let verts = self.cell_vertices(key)?;

        if verts.is_empty() {
            return None;
        }

        let mut sum = Vector3::new(0.0, 0.0, 0.0);
        let mut count = 0;

        for vk in &verts {
            if let Some(p) = self.vertex_point(*vk) {
                sum += p.coords;
                count += 1;
            }
        }

        if count == 0 {
            return None;
        }

        Some(Point3::from(sum / count as f64))
    }

    /// Tests if a point is inside a cell using ray casting.
    ///
    /// Casts a ray from the point in a slightly perturbed direction and counts
    /// face intersections. Odd count = inside, even = outside. The perturbation
    /// avoids degenerate cases where the ray passes through edges or vertices.
    pub fn cell_contains(&self, key: CellKey, point: &Point3<f64>) -> Option<bool> {
        let cell = self.cells.get(key)?;
        let faces = self.shell_faces(cell.outer_shell)?;

        // Use a slightly perturbed direction to avoid edge/vertex degeneracies
        let dir = Vector3::new(1.0, 1e-7, 1e-8);

        let mut crossings = 0;

        for &fk in faces {
            let face = self.faces.get(fk)?;
            let verts = self.wire_vertices_ordered(face.outer_wire)?;

            if verts.len() < 3 {
                continue;
            }

            // Triangulate as fan, test each triangle
            let p0 = self.vertex_point(verts[0])?;
            for i in 1..verts.len() - 1 {
                let p1 = self.vertex_point(verts[i])?;
                let p2 = self.vertex_point(verts[i + 1])?;

                if ray_intersects_triangle(point, &dir, &p0, &p1, &p2) {
                    crossings += 1;
                }
            }
        }

        Some(crossings % 2 == 1)
    }

    /// Triangulates a face into triangles (vertex index triples).
    ///
    /// Returns a list of `(VertexKey, VertexKey, VertexKey)` triangles.
    /// Uses ear-clipping via projection onto the face's dominant plane.
    pub fn triangulate_face(&self, key: FaceKey) -> Option<Vec<(VertexKey, VertexKey, VertexKey)>> {
        let face = self.faces.get(key)?;
        let outer_verts = self.wire_vertices_ordered(face.outer_wire)?;

        if outer_verts.len() < 3 {
            return None;
        }

        // Get face normal for projection
        let normal = self.face_normal(key)?;

        // Determine dominant axis for 2D projection
        let abs_n = Vector3::new(normal.x.abs(), normal.y.abs(), normal.z.abs());
        let (ax_u, ax_v) = if abs_n.z >= abs_n.x && abs_n.z >= abs_n.y {
            (0, 1) // project onto XY
        } else if abs_n.y >= abs_n.x {
            (0, 2) // project onto XZ
        } else {
            (1, 2) // project onto YZ
        };

        // Collect 2D coordinates for outer boundary
        let mut coords_2d: Vec<f64> = Vec::new();
        let mut all_verts: Vec<VertexKey> = Vec::new();

        for &vk in &outer_verts {
            let p = self.vertex_point(vk)?;
            let c = [p.x, p.y, p.z];
            coords_2d.push(c[ax_u]);
            coords_2d.push(c[ax_v]);
            all_verts.push(vk);
        }

        // Hole indices for earcutr
        let mut hole_indices: Vec<usize> = Vec::new();

        for &iw in &face.inner_wires {
            hole_indices.push(all_verts.len());
            let hole_verts = self.wire_vertices_ordered(iw)?;
            for &vk in &hole_verts {
                let p = self.vertex_point(vk)?;
                let c = [p.x, p.y, p.z];
                coords_2d.push(c[ax_u]);
                coords_2d.push(c[ax_v]);
                all_verts.push(vk);
            }
        }

        // Run earcutr
        let indices = earcutr::earcut(&coords_2d, &hole_indices, 2).ok()?;

        let mut triangles = Vec::with_capacity(indices.len() / 3);
        for chunk in indices.chunks(3) {
            if chunk.len() == 3 {
                triangles.push((
                    all_verts[chunk[0]],
                    all_verts[chunk[1]],
                    all_verts[chunk[2]],
                ));
            }
        }

        Some(triangles)
    }
}

/// Möller–Trumbore ray-triangle intersection test.
///
/// Casts a ray from `origin` along `dir` and tests if it hits the
/// triangle (v0, v1, v2).
fn ray_intersects_triangle(
    origin: &Point3<f64>,
    dir: &Vector3<f64>,
    v0: &Point3<f64>,
    v1: &Point3<f64>,
    v2: &Point3<f64>,
) -> bool {
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;

    let h = dir.cross(&edge2);
    let a = edge1.dot(&h);

    if a.abs() < 1e-12 {
        return false; // ray parallel to triangle
    }

    let f = 1.0 / a;
    let s = origin - v0;
    let u = f * s.dot(&h);

    if !(0.0..=1.0).contains(&u) {
        return false;
    }

    let q = s.cross(&edge1);
    let v = f * dir.dot(&q);

    if v < 0.0 || u + v > 1.0 {
        return false;
    }

    let t = f * edge2.dot(&q);
    t > 1e-12 // intersection is in front of origin
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::make_rectangle;
    use approx::assert_relative_eq;

    #[test]
    fn edge_length_unit() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(3.0, 4.0, 0.0);
        let edge = arena.add_edge(v0, v1).unwrap();

        assert_relative_eq!(arena.edge_length(edge).unwrap(), 5.0);
    }

    #[test]
    fn face_normal_xy_plane() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        let normal = arena.face_normal(face).unwrap();

        // Normal should be along Z (could be +Z or -Z depending on winding)
        assert_relative_eq!(normal.x.abs(), 0.0, epsilon = 1e-10);
        assert_relative_eq!(normal.y.abs(), 0.0, epsilon = 1e-10);
        assert_relative_eq!(normal.z.abs(), 1.0, epsilon = 1e-10);
    }

    #[test]
    fn face_normal_xz_plane() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 0.0, 1.0);
        let v3 = arena.add_vertex(0.0, 0.0, 1.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        let normal = arena.face_normal(face).unwrap();

        // Normal should be along Y
        assert_relative_eq!(normal.x.abs(), 0.0, epsilon = 1e-10);
        assert_relative_eq!(normal.y.abs(), 1.0, epsilon = 1e-10);
        assert_relative_eq!(normal.z.abs(), 0.0, epsilon = 1e-10);
    }

    #[test]
    fn face_area_unit_square() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        assert_relative_eq!(arena.face_area(face).unwrap(), 1.0, epsilon = 1e-10);
    }

    #[test]
    fn face_area_triangle() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(4.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 3.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v1, v2).unwrap();
        let e2 = arena.add_edge(v2, v0).unwrap();
        let wire = arena.add_wire(&[e0, e1, e2]).unwrap();
        let face = arena.add_face(wire).unwrap();

        assert_relative_eq!(arena.face_area(face).unwrap(), 6.0, epsilon = 1e-10);
    }

    #[test]
    fn face_area_with_hole() {
        let mut arena = TopologyArena::new();

        // Outer: 10x10 square
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(10.0, 0.0, 0.0);
        let v2 = arena.add_vertex(10.0, 10.0, 0.0);
        let v3 = arena.add_vertex(0.0, 10.0, 0.0);

        let oe0 = arena.add_edge(v0, v1).unwrap();
        let oe1 = arena.add_edge(v1, v2).unwrap();
        let oe2 = arena.add_edge(v2, v3).unwrap();
        let oe3 = arena.add_edge(v3, v0).unwrap();
        let outer_wire = arena.add_wire(&[oe0, oe1, oe2, oe3]).unwrap();

        // Inner hole: 2x2 square
        let h0 = arena.add_vertex(4.0, 4.0, 0.0);
        let h1 = arena.add_vertex(6.0, 4.0, 0.0);
        let h2 = arena.add_vertex(6.0, 6.0, 0.0);
        let h3 = arena.add_vertex(4.0, 6.0, 0.0);

        let he0 = arena.add_edge(h0, h1).unwrap();
        let he1 = arena.add_edge(h1, h2).unwrap();
        let he2 = arena.add_edge(h2, h3).unwrap();
        let he3 = arena.add_edge(h3, h0).unwrap();
        let hole_wire = arena.add_wire(&[he0, he1, he2, he3]).unwrap();

        let face = arena
            .add_face_with_holes(outer_wire, &[hole_wire])
            .unwrap();

        // Area = 100 - 4 = 96
        assert_relative_eq!(arena.face_area(face).unwrap(), 96.0, epsilon = 1e-10);
    }

    #[test]
    fn face_centroid_unit_square() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(2.0, 0.0, 0.0);
        let v2 = arena.add_vertex(2.0, 2.0, 0.0);
        let v3 = arena.add_vertex(0.0, 2.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        let centroid = arena.face_centroid(face).unwrap();

        assert_relative_eq!(centroid.x, 1.0, epsilon = 1e-10);
        assert_relative_eq!(centroid.y, 1.0, epsilon = 1e-10);
        assert_relative_eq!(centroid.z, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn cell_volume_unit_cube() {
        let mut arena = TopologyArena::new();

        let v = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(1.0, 0.0, 0.0),
            arena.add_vertex(1.0, 1.0, 0.0),
            arena.add_vertex(0.0, 1.0, 0.0),
            arena.add_vertex(0.0, 0.0, 1.0),
            arena.add_vertex(1.0, 0.0, 1.0),
            arena.add_vertex(1.0, 1.0, 1.0),
            arena.add_vertex(0.0, 1.0, 1.0),
        ];

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[3], v[2], v[1]).unwrap(); // bottom
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap(); // top
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap(); // front
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap(); // back
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[4], v[7], v[3]).unwrap(); // left
        let (f5, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap(); // right

        let shell = arena.add_shell(&[f0, f1, f2, f3, f4, f5]).unwrap();
        let cell = arena.add_cell(shell).unwrap();

        assert_relative_eq!(arena.cell_volume(cell).unwrap(), 1.0, epsilon = 1e-10);
    }

    #[test]
    fn cell_volume_2x3x4_box() {
        let mut arena = TopologyArena::new();

        let v = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 3.0, 0.0),
            arena.add_vertex(0.0, 3.0, 0.0),
            arena.add_vertex(0.0, 0.0, 4.0),
            arena.add_vertex(2.0, 0.0, 4.0),
            arena.add_vertex(2.0, 3.0, 4.0),
            arena.add_vertex(0.0, 3.0, 4.0),
        ];

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[3], v[2], v[1]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[4], v[7], v[3]).unwrap();
        let (f5, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell = arena.add_shell(&[f0, f1, f2, f3, f4, f5]).unwrap();
        let cell = arena.add_cell(shell).unwrap();

        assert_relative_eq!(arena.cell_volume(cell).unwrap(), 24.0, epsilon = 1e-10);
    }

    #[test]
    fn cell_contains_point_inside() {
        let mut arena = TopologyArena::new();

        let v = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 2.0, 0.0),
            arena.add_vertex(0.0, 2.0, 0.0),
            arena.add_vertex(0.0, 0.0, 2.0),
            arena.add_vertex(2.0, 0.0, 2.0),
            arena.add_vertex(2.0, 2.0, 2.0),
            arena.add_vertex(0.0, 2.0, 2.0),
        ];

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[3], v[2], v[1]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[4], v[7], v[3]).unwrap();
        let (f5, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell = arena.add_shell(&[f0, f1, f2, f3, f4, f5]).unwrap();
        let cell = arena.add_cell(shell).unwrap();

        let inside = Point3::new(1.0, 1.0, 1.0);
        let outside = Point3::new(5.0, 5.0, 5.0);

        assert!(arena.cell_contains(cell, &inside).unwrap());
        assert!(!arena.cell_contains(cell, &outside).unwrap());
    }

    #[test]
    fn triangulate_square_face() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        let triangles = arena.triangulate_face(face).unwrap();

        assert_eq!(triangles.len(), 2); // square → 2 triangles
    }

    #[test]
    fn triangulate_triangle_face() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v1, v2).unwrap();
        let e2 = arena.add_edge(v2, v0).unwrap();
        let wire = arena.add_wire(&[e0, e1, e2]).unwrap();
        let face = arena.add_face(wire).unwrap();

        let triangles = arena.triangulate_face(face).unwrap();
        assert_eq!(triangles.len(), 1); // triangle → 1 triangle
    }

    #[test]
    fn cell_centroid_unit_cube() {
        let mut arena = TopologyArena::new();

        let v = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 2.0, 0.0),
            arena.add_vertex(0.0, 2.0, 0.0),
            arena.add_vertex(0.0, 0.0, 2.0),
            arena.add_vertex(2.0, 0.0, 2.0),
            arena.add_vertex(2.0, 2.0, 2.0),
            arena.add_vertex(0.0, 2.0, 2.0),
        ];

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[3], v[2], v[1]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[4], v[7], v[3]).unwrap();
        let (f5, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell = arena.add_shell(&[f0, f1, f2, f3, f4, f5]).unwrap();
        let cell = arena.add_cell(shell).unwrap();

        let centroid = arena.cell_centroid(cell).unwrap();
        assert_relative_eq!(centroid.x, 1.0, epsilon = 1e-10);
        assert_relative_eq!(centroid.y, 1.0, epsilon = 1e-10);
        assert_relative_eq!(centroid.z, 1.0, epsilon = 1e-10);
    }
}
