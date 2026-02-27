// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Affine transformations on topology entities.
//!
//! Transforms modify vertex coordinates in-place. Since all higher-level
//! entities (edges, faces, etc.) reference vertices through keys, moving
//! vertices automatically moves everything that references them.

use nalgebra::{Matrix4, Point3, Rotation3, Unit, Vector3};

use crate::arena::TopologyArena;
use crate::keys::*;

impl TopologyArena {
    /// Translates all vertices referenced by a topology entity.
    pub fn translate(&mut self, key: TopologyKey, dx: f64, dy: f64, dz: f64) {
        let vertex_keys = self.collect_vertices(key);
        for vk in vertex_keys {
            if let Some(v) = self.vertices.get_mut(vk) {
                v.x += dx;
                v.y += dy;
                v.z += dz;
            }
        }
    }

    /// Rotates all vertices referenced by a topology entity around an axis.
    ///
    /// `origin` is the center of rotation, `axis` is the rotation axis
    /// (will be normalized), and `angle` is in radians.
    pub fn rotate(
        &mut self,
        key: TopologyKey,
        origin: &Point3<f64>,
        axis: &Vector3<f64>,
        angle: f64,
    ) {
        let unit_axis = match Unit::try_new(*axis, 1e-15) {
            Some(a) => a,
            None => return, // degenerate axis
        };

        let rotation = Rotation3::from_axis_angle(&unit_axis, angle);
        let vertex_keys = self.collect_vertices(key);

        for vk in vertex_keys {
            if let Some(v) = self.vertices.get_mut(vk) {
                let p = Point3::new(v.x, v.y, v.z) - origin.coords;
                let rotated = rotation * p;
                let result = rotated + origin.coords;
                v.x = result.x;
                v.y = result.y;
                v.z = result.z;
            }
        }
    }

    /// Scales all vertices referenced by a topology entity relative to an origin.
    pub fn scale(
        &mut self,
        key: TopologyKey,
        origin: &Point3<f64>,
        sx: f64,
        sy: f64,
        sz: f64,
    ) {
        let vertex_keys = self.collect_vertices(key);
        for vk in vertex_keys {
            if let Some(v) = self.vertices.get_mut(vk) {
                v.x = origin.x + (v.x - origin.x) * sx;
                v.y = origin.y + (v.y - origin.y) * sy;
                v.z = origin.z + (v.z - origin.z) * sz;
            }
        }
    }

    /// Applies a 4x4 affine transformation matrix to all vertices.
    pub fn transform(&mut self, key: TopologyKey, matrix: &Matrix4<f64>) {
        let vertex_keys = self.collect_vertices(key);
        for vk in vertex_keys {
            if let Some(v) = self.vertices.get_mut(vk) {
                let p = matrix.transform_point(&Point3::new(v.x, v.y, v.z));
                v.x = p.x;
                v.y = p.y;
                v.z = p.z;
            }
        }
    }

    /// Collects all vertex keys referenced by a topology entity.
    fn collect_vertices(&self, key: TopologyKey) -> Vec<VertexKey> {
        match key {
            TopologyKey::Vertex(vk) => vec![vk],
            TopologyKey::Edge(ek) => {
                if let Some(e) = self.edges.get(ek) {
                    vec![e.start, e.end]
                } else {
                    Vec::new()
                }
            }
            TopologyKey::Wire(wk) => self
                .wire_vertices(wk)
                .map(|s| s.into_iter().collect())
                .unwrap_or_default(),
            TopologyKey::Face(fk) => self
                .face_vertices(fk)
                .map(|s| s.into_iter().collect())
                .unwrap_or_default(),
            TopologyKey::Shell(sk) => self
                .shell_vertices(sk)
                .map(|s| s.into_iter().collect())
                .unwrap_or_default(),
            TopologyKey::Cell(ck) => self
                .cell_vertices(ck)
                .map(|s| s.into_iter().collect())
                .unwrap_or_default(),
            TopologyKey::CellComplex(cck) => self
                .complex_vertices(cck)
                .map(|s| s.into_iter().collect())
                .unwrap_or_default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::make_rectangle;
    use approx::assert_relative_eq;
    use std::f64::consts::FRAC_PI_2;

    #[test]
    fn translate_vertex() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(1.0, 2.0, 3.0);

        arena.translate(TopologyKey::Vertex(vk), 10.0, 20.0, 30.0);

        let v = arena.vertex(vk).unwrap();
        assert_relative_eq!(v.x, 11.0);
        assert_relative_eq!(v.y, 22.0);
        assert_relative_eq!(v.z, 33.0);
    }

    #[test]
    fn translate_edge_moves_both_vertices() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let edge = arena.add_edge(v0, v1).unwrap();

        arena.translate(TopologyKey::Edge(edge), 5.0, 5.0, 5.0);

        let p0 = arena.vertex(v0).unwrap();
        let p1 = arena.vertex(v1).unwrap();
        assert_relative_eq!(p0.x, 5.0);
        assert_relative_eq!(p1.x, 6.0);
    }

    #[test]
    fn rotate_vertex_90_degrees_around_z() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(1.0, 0.0, 0.0);

        let origin = Point3::new(0.0, 0.0, 0.0);
        let axis = Vector3::new(0.0, 0.0, 1.0);

        arena.rotate(TopologyKey::Vertex(vk), &origin, &axis, FRAC_PI_2);

        let v = arena.vertex(vk).unwrap();
        assert_relative_eq!(v.x, 0.0, epsilon = 1e-10);
        assert_relative_eq!(v.y, 1.0, epsilon = 1e-10);
        assert_relative_eq!(v.z, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn rotate_around_offset_origin() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(2.0, 0.0, 0.0);

        let origin = Point3::new(1.0, 0.0, 0.0);
        let axis = Vector3::new(0.0, 0.0, 1.0);

        // Rotate 90° around (1,0,0) — the point (2,0,0) is 1 unit away
        arena.rotate(TopologyKey::Vertex(vk), &origin, &axis, FRAC_PI_2);

        let v = arena.vertex(vk).unwrap();
        assert_relative_eq!(v.x, 1.0, epsilon = 1e-10);
        assert_relative_eq!(v.y, 1.0, epsilon = 1e-10);
        assert_relative_eq!(v.z, 0.0, epsilon = 1e-10);
    }

    #[test]
    fn scale_vertex() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(2.0, 3.0, 4.0);

        let origin = Point3::new(0.0, 0.0, 0.0);
        arena.scale(TopologyKey::Vertex(vk), &origin, 2.0, 3.0, 0.5);

        let v = arena.vertex(vk).unwrap();
        assert_relative_eq!(v.x, 4.0);
        assert_relative_eq!(v.y, 9.0);
        assert_relative_eq!(v.z, 2.0);
    }

    #[test]
    fn scale_relative_to_center() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(3.0, 0.0, 0.0);

        let origin = Point3::new(1.0, 0.0, 0.0);
        arena.scale(TopologyKey::Vertex(vk), &origin, 2.0, 1.0, 1.0);

        let v = arena.vertex(vk).unwrap();
        // (3-1)*2 + 1 = 5
        assert_relative_eq!(v.x, 5.0);
    }

    #[test]
    fn transform_face_translates_all_vertices() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();

        arena.translate(TopologyKey::Face(face), 10.0, 0.0, 0.0);

        // All vertices should have moved
        assert_relative_eq!(arena.vertex(v0).unwrap().x, 10.0);
        assert_relative_eq!(arena.vertex(v1).unwrap().x, 11.0);
        assert_relative_eq!(arena.vertex(v2).unwrap().x, 11.0);
        assert_relative_eq!(arena.vertex(v3).unwrap().x, 10.0);
    }

    #[test]
    fn transform_matrix_identity() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(1.0, 2.0, 3.0);

        arena.transform(TopologyKey::Vertex(vk), &Matrix4::identity());

        let v = arena.vertex(vk).unwrap();
        assert_relative_eq!(v.x, 1.0);
        assert_relative_eq!(v.y, 2.0);
        assert_relative_eq!(v.z, 3.0);
    }

    #[test]
    fn transform_matrix_translation() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);

        let matrix = Matrix4::new_translation(&Vector3::new(5.0, 10.0, 15.0));
        arena.transform(TopologyKey::Vertex(vk), &matrix);

        let v = arena.vertex(vk).unwrap();
        assert_relative_eq!(v.x, 5.0);
        assert_relative_eq!(v.y, 10.0);
        assert_relative_eq!(v.z, 15.0);
    }
}
