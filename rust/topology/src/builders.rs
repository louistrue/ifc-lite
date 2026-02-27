// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! High-level builder methods for constructing topology with tolerance-based
//! vertex and edge sharing (face sewing).
//!
//! These methods implement the equivalent of TopologicPy's `ByFaces(tolerance)`
//! constructors, where faces that share vertices within tolerance automatically
//! share edges, enabling non-manifold topology construction.

use rustc_hash::FxHashMap;

use crate::arena::TopologyArena;
use crate::error::{Error, Result};
use crate::keys::*;
use crate::spatial::SpatialIndex;

impl TopologyArena {
    /// Creates a wire from an ordered list of vertex positions, reusing
    /// existing vertices within tolerance and sharing edges.
    pub fn add_wire_by_vertices(&mut self, vertices: &[VertexKey]) -> Result<WireKey> {
        if vertices.len() < 2 {
            return Err(Error::EmptyWire);
        }

        let mut edges = Vec::with_capacity(vertices.len());
        for i in 0..vertices.len() {
            let start = vertices[i];
            let end = vertices[(i + 1) % vertices.len()];
            if start == end {
                continue;
            }
            let edge = self.add_edge(start, end)?;
            edges.push(edge);
        }

        if edges.len() < 1 {
            return Err(Error::EmptyWire);
        }

        self.add_wire(&edges)
    }

    /// Creates a face from an ordered list of vertex keys.
    ///
    /// Convenience method that creates edges, a wire, and a face in one call.
    pub fn add_face_by_vertices(&mut self, vertices: &[VertexKey]) -> Result<FaceKey> {
        if vertices.len() < 3 {
            return Err(Error::DegenerateFace);
        }

        let wire = self.add_wire_by_vertices(vertices)?;
        self.add_face(wire)
    }

    /// Creates a face from coordinate triples, creating vertices as needed.
    pub fn add_face_by_coords(&mut self, coords: &[[f64; 3]]) -> Result<FaceKey> {
        if coords.len() < 3 {
            return Err(Error::DegenerateFace);
        }

        let vertices: Vec<VertexKey> = coords
            .iter()
            .map(|c| self.add_vertex(c[0], c[1], c[2]))
            .collect();

        self.add_face_by_vertices(&vertices)
    }

    /// Creates a shell from face coordinate lists, with tolerance-based vertex
    /// and edge sharing (face sewing).
    ///
    /// This is the key NMT construction method. Faces that share vertex
    /// positions within `tolerance` will share the same vertex and edge
    /// entities, enabling non-manifold adjacency queries.
    pub fn sew_faces(
        &mut self,
        face_coords: &[Vec<[f64; 3]>],
        tolerance: f64,
    ) -> Result<(ShellKey, Vec<FaceKey>)> {
        if face_coords.is_empty() {
            return Err(Error::EmptyShell);
        }

        let cell_size = tolerance.max(1e-10);
        let mut index = SpatialIndex::new(cell_size);
        // Track edge sharing: (min_vertex, max_vertex) → EdgeKey
        let mut edge_map: FxHashMap<(VertexKey, VertexKey), EdgeKey> = FxHashMap::default();
        let mut faces = Vec::with_capacity(face_coords.len());

        for coords in face_coords {
            if coords.len() < 3 {
                return Err(Error::DegenerateFace);
            }

            // Create or reuse vertices
            let vertices: Vec<VertexKey> = coords
                .iter()
                .map(|c| self.find_or_add_vertex(&mut index, c[0], c[1], c[2], tolerance))
                .collect();

            // Create or reuse edges
            let mut edges = Vec::with_capacity(vertices.len());
            for i in 0..vertices.len() {
                let start = vertices[i];
                let end = vertices[(i + 1) % vertices.len()];
                if start == end {
                    continue;
                }

                // Canonical edge key (ordered by key for deduplication)
                let canonical = if start < end {
                    (start, end)
                } else {
                    (end, start)
                };

                let edge = if let Some(&existing) = edge_map.get(&canonical) {
                    existing
                } else {
                    let new_edge = self.add_edge(start, end)?;
                    edge_map.insert(canonical, new_edge);
                    new_edge
                };

                edges.push(edge);
            }

            if edges.len() < 3 {
                return Err(Error::DegenerateFace);
            }

            let wire = self.add_wire(&edges)?;
            let face = self.add_face(wire)?;
            faces.push(face);
        }

        let shell = self.add_shell(&faces)?;
        Ok((shell, faces))
    }

    /// Constructs a cell from face coordinate lists with sewing.
    ///
    /// Equivalent to TopologicPy's `Cell.ByFaces(faces, tolerance)`.
    pub fn add_cell_by_faces(
        &mut self,
        face_coords: &[Vec<[f64; 3]>],
        tolerance: f64,
    ) -> Result<CellKey> {
        let (shell, _) = self.sew_faces(face_coords, tolerance)?;
        self.add_cell(shell)
    }

    /// Constructs a cell complex from multiple groups of face coordinates.
    ///
    /// Each group represents a cell. Faces shared between cells (within
    /// tolerance) become the NMT shared boundaries.
    pub fn add_cell_complex_by_cells(
        &mut self,
        cell_face_coords: &[Vec<Vec<[f64; 3]>>],
        tolerance: f64,
    ) -> Result<CellComplexKey> {
        if cell_face_coords.is_empty() {
            return Err(Error::EmptyCellComplex);
        }

        let cell_size = tolerance.max(1e-10);
        let mut index = SpatialIndex::new(cell_size);
        let mut edge_map: FxHashMap<(VertexKey, VertexKey), EdgeKey> = FxHashMap::default();
        // Face deduplication: sorted edge set → FaceKey. When two cells share
        // a wall (same edges in any order), they reuse the same FaceKey so that
        // shared_faces / adjacent_cells queries work correctly.
        let mut face_map: FxHashMap<Vec<EdgeKey>, FaceKey> = FxHashMap::default();
        let mut all_cells = Vec::with_capacity(cell_face_coords.len());

        for cell_coords in cell_face_coords {
            let mut faces = Vec::with_capacity(cell_coords.len());

            for coords in cell_coords {
                if coords.len() < 3 {
                    return Err(Error::DegenerateFace);
                }

                let vertices: Vec<VertexKey> = coords
                    .iter()
                    .map(|c| self.find_or_add_vertex(&mut index, c[0], c[1], c[2], tolerance))
                    .collect();

                let mut edges = Vec::with_capacity(vertices.len());
                for i in 0..vertices.len() {
                    let start = vertices[i];
                    let end = vertices[(i + 1) % vertices.len()];
                    if start == end {
                        continue;
                    }

                    let canonical = if start < end {
                        (start, end)
                    } else {
                        (end, start)
                    };

                    let edge = if let Some(&existing) = edge_map.get(&canonical) {
                        existing
                    } else {
                        let new_edge = self.add_edge(start, end)?;
                        edge_map.insert(canonical, new_edge);
                        new_edge
                    };

                    edges.push(edge);
                }

                if edges.len() < 3 {
                    return Err(Error::DegenerateFace);
                }

                // Canonical face key: sorted edge keys (order-independent)
                let mut face_canonical = edges.clone();
                face_canonical.sort();

                let face = if let Some(&existing) = face_map.get(&face_canonical) {
                    // Reuse existing face — NMT shared boundary
                    existing
                } else {
                    let wire = self.add_wire(&edges)?;
                    let new_face = self.add_face(wire)?;
                    face_map.insert(face_canonical, new_face);
                    new_face
                };

                faces.push(face);
            }

            let shell = self.add_shell(&faces)?;
            let cell = self.add_cell(shell)?;
            all_cells.push(cell);
        }

        self.add_cell_complex(&all_cells)
    }

    /// Creates a box cell from min/max corners.
    pub fn make_box(
        &mut self,
        min: [f64; 3],
        max: [f64; 3],
    ) -> Result<(CellKey, ShellKey, [FaceKey; 6])> {
        let [x0, y0, z0] = min;
        let [x1, y1, z1] = max;

        let faces = vec![
            // bottom (z=z0), outward normal = -Z
            vec![[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
            // top (z=z1), outward normal = +Z
            vec![[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
            // front (y=y0), outward normal = -Y
            vec![[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
            // back (y=y1), outward normal = +Y
            vec![[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
            // left (x=x0), outward normal = -X
            vec![[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
            // right (x=x1), outward normal = +X
            vec![[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
        ];

        let (shell, face_keys) = self.sew_faces(&faces, 1e-10)?;
        let cell = self.add_cell(shell)?;

        Ok((
            cell,
            shell,
            [
                face_keys[0],
                face_keys[1],
                face_keys[2],
                face_keys[3],
                face_keys[4],
                face_keys[5],
            ],
        ))
    }

    /// Creates two adjacent box cells sharing a face, forming a cell complex.
    ///
    /// This is the fundamental NMT test case: two rooms sharing a wall.
    pub fn make_adjacent_boxes(
        &mut self,
        box1_min: [f64; 3],
        box1_max: [f64; 3],
        box2_min: [f64; 3],
        box2_max: [f64; 3],
        tolerance: f64,
    ) -> Result<CellComplexKey> {
        fn box_faces(min: [f64; 3], max: [f64; 3]) -> Vec<Vec<[f64; 3]>> {
            let [x0, y0, z0] = min;
            let [x1, y1, z1] = max;
            vec![
                vec![[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
                vec![[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
                vec![[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
                vec![[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
                vec![[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
                vec![[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
            ]
        }

        self.add_cell_complex_by_cells(
            &[box_faces(box1_min, box1_max), box_faces(box2_min, box2_max)],
            tolerance,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn face_by_vertices() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let face = arena.add_face_by_vertices(&[v0, v1, v2, v3]).unwrap();
        assert!(arena.face(face).is_some());
        assert_eq!(arena.face_count(), 1);
    }

    #[test]
    fn face_by_coords() {
        let mut arena = TopologyArena::new();
        let face = arena
            .add_face_by_coords(&[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0]])
            .unwrap();

        assert!(arena.face(face).is_some());
        assert_eq!(arena.vertex_count(), 3);
    }

    #[test]
    fn sew_faces_shares_vertices_and_edges() {
        let mut arena = TopologyArena::new();

        // Two triangles sharing an edge (v0-v1)
        let faces = vec![
            vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.5, 1.0, 0.0]],
            vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.5, -1.0, 0.0]],
        ];

        let (shell, face_keys) = arena.sew_faces(&faces, 0.001).unwrap();
        assert_eq!(face_keys.len(), 2);

        // Should have 4 unique vertices (not 6)
        assert_eq!(arena.vertex_count(), 4);
        // Should have 5 unique edges (not 6): shared edge + 4 boundary edges
        assert_eq!(arena.edge_count(), 5);

        assert!(arena.shell(shell).is_some());
    }

    #[test]
    fn make_box_creates_valid_cell() {
        let mut arena = TopologyArena::new();
        let (cell, shell, faces) = arena.make_box([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]).unwrap();

        assert_eq!(arena.vertex_count(), 8);
        // With sewing, shared edges between faces should be reused
        // A cube has 12 edges
        assert_eq!(arena.edge_count(), 12);
        assert_eq!(arena.face_count(), 6);
        assert_eq!(arena.shell_count(), 1);
        assert_eq!(arena.cell_count(), 1);

        // Volume should be 1.0
        let vol = arena.cell_volume(cell).unwrap();
        assert!((vol - 1.0).abs() < 0.01, "volume = {vol}, expected 1.0");

        // Shell should be closed (every edge shared by 2 faces)
        assert!(arena.shell_is_closed(shell));

        for f in &faces {
            assert!(arena.face(*f).is_some());
        }
    }

    #[test]
    fn make_box_dimensions() {
        let mut arena = TopologyArena::new();
        let (cell, _, _) = arena.make_box([0.0, 0.0, 0.0], [2.0, 3.0, 4.0]).unwrap();

        let vol = arena.cell_volume(cell).unwrap();
        assert!((vol - 24.0).abs() < 0.01, "volume = {vol}, expected 24.0");
    }

    #[test]
    fn adjacent_boxes_share_face() {
        let mut arena = TopologyArena::new();
        let complex = arena
            .make_adjacent_boxes(
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
                [1.0, 0.0, 0.0],
                [2.0, 1.0, 1.0],
                0.001,
            )
            .unwrap();

        let cc = arena.cell_complex(complex).unwrap();
        assert_eq!(cc.cells.len(), 2);

        // Should share vertices at x=1 plane (4 vertices)
        // Total: 8 + 4 = 12 vertices (not 16)
        assert_eq!(arena.vertex_count(), 12);

        // The two cells should be adjacent (sharing a face)
        let adj = arena.adjacent_cells_in_complex(cc.cells[0], complex);
        assert_eq!(adj.len(), 1);
        assert_eq!(adj[0], cc.cells[1]);

        // Should have shared faces
        let shared = arena.shared_faces(cc.cells[0], cc.cells[1]);
        assert_eq!(shared.len(), 1, "expected 1 shared face (the wall)");
    }

    #[test]
    fn sew_faces_cube_is_closed() {
        let mut arena = TopologyArena::new();
        let (shell, _) = arena
            .sew_faces(
                &[
                    vec![[0., 0., 0.], [1., 0., 0.], [1., 1., 0.], [0., 1., 0.]],
                    vec![[0., 0., 1.], [1., 0., 1.], [1., 1., 1.], [0., 1., 1.]],
                    vec![[0., 0., 0.], [1., 0., 0.], [1., 0., 1.], [0., 0., 1.]],
                    vec![[0., 1., 0.], [1., 1., 0.], [1., 1., 1.], [0., 1., 1.]],
                    vec![[0., 0., 0.], [0., 1., 0.], [0., 1., 1.], [0., 0., 1.]],
                    vec![[1., 0., 0.], [1., 1., 0.], [1., 1., 1.], [1., 0., 1.]],
                ],
                0.001,
            )
            .unwrap();

        assert!(arena.shell_is_closed(shell));
    }
}
