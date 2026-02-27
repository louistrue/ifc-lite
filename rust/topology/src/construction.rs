// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Construction methods for topology entities.
//!
//! Each topology entity is created through the arena, which ensures referential
//! integrity (all referenced sub-entities must exist) and maintains the
//! bidirectional adjacency index.

use crate::arena::*;
use crate::error::{Error, Result};
use crate::keys::*;

impl TopologyArena {
    /// Creates an edge between two existing vertices.
    ///
    /// Returns an error if either vertex does not exist in the arena.
    pub fn add_edge(&mut self, start: VertexKey, end: VertexKey) -> Result<EdgeKey> {
        if !self.vertices.contains_key(start) {
            return Err(Error::VertexNotFound(start));
        }
        if !self.vertices.contains_key(end) {
            return Err(Error::VertexNotFound(end));
        }

        let key = self.edges.insert(EdgeData { start, end });
        self.link_vertex_edge(start, key);
        self.link_vertex_edge(end, key);
        Ok(key)
    }

    /// Creates a wire from an ordered list of edges.
    ///
    /// The edges must form a connected chain: each edge shares a vertex with
    /// the next edge. The wire tracks the orientation of each edge to maintain
    /// a consistent traversal direction.
    ///
    /// Returns an error if the edge list is empty or edges are not connected.
    pub fn add_wire(&mut self, edge_keys: &[EdgeKey]) -> Result<WireKey> {
        if edge_keys.is_empty() {
            return Err(Error::EmptyWire);
        }

        // Validate all edges exist
        for &ek in edge_keys {
            if !self.edges.contains_key(ek) {
                return Err(Error::EdgeNotFound(ek));
            }
        }

        // Determine orientations by checking connectivity
        let mut orientations = Vec::with_capacity(edge_keys.len());

        if edge_keys.len() == 1 {
            orientations.push(true);
        } else {
            // Determine first edge orientation by looking at the second edge
            let first = &self.edges[edge_keys[0]];
            let second = &self.edges[edge_keys[1]];

            if first.end == second.start || first.end == second.end {
                orientations.push(true); // forward
            } else if first.start == second.start || first.start == second.end {
                orientations.push(false); // reversed
            } else {
                return Err(Error::DisconnectedWire(0, 1));
            }

            for i in 1..edge_keys.len() {
                let prev_edge = &self.edges[edge_keys[i - 1]];
                let curr_edge = &self.edges[edge_keys[i]];

                // End vertex of previous edge (respecting orientation)
                let prev_end = if orientations[i - 1] {
                    prev_edge.end
                } else {
                    prev_edge.start
                };

                if prev_end == curr_edge.start {
                    orientations.push(true); // forward
                } else if prev_end == curr_edge.end {
                    orientations.push(false); // reversed
                } else {
                    return Err(Error::DisconnectedWire(i - 1, i));
                }
            }
        }

        let key = self.wires.insert(WireData {
            edges: edge_keys.to_vec(),
            orientations,
        });

        for &ek in edge_keys {
            self.link_edge_wire(ek, key);
        }

        Ok(key)
    }

    /// Creates a face from an outer boundary wire.
    ///
    /// The wire must have at least 3 edges to form a valid face.
    pub fn add_face(&mut self, outer_wire: WireKey) -> Result<FaceKey> {
        let wire = self
            .wires
            .get(outer_wire)
            .ok_or(Error::WireNotFound(outer_wire))?;

        if wire.edges.len() < 3 {
            return Err(Error::DegenerateFace);
        }

        let key = self.faces.insert(FaceData {
            outer_wire,
            inner_wires: Vec::new(),
        });

        self.link_wire_face(outer_wire, key);
        Ok(key)
    }

    /// Creates a face with an outer boundary and inner boundary wires (holes).
    pub fn add_face_with_holes(
        &mut self,
        outer_wire: WireKey,
        inner_wires: &[WireKey],
    ) -> Result<FaceKey> {
        // Validate outer wire
        let wire = self
            .wires
            .get(outer_wire)
            .ok_or(Error::WireNotFound(outer_wire))?;

        if wire.edges.len() < 3 {
            return Err(Error::DegenerateFace);
        }

        // Validate inner wires
        for &iw in inner_wires {
            if !self.wires.contains_key(iw) {
                return Err(Error::WireNotFound(iw));
            }
        }

        let key = self.faces.insert(FaceData {
            outer_wire,
            inner_wires: inner_wires.to_vec(),
        });

        self.link_wire_face(outer_wire, key);
        for &iw in inner_wires {
            self.link_wire_face(iw, key);
        }

        Ok(key)
    }

    /// Creates a shell from a list of faces.
    ///
    /// The faces should form a connected surface. At minimum, one face is required.
    pub fn add_shell(&mut self, face_keys: &[FaceKey]) -> Result<ShellKey> {
        if face_keys.is_empty() {
            return Err(Error::EmptyShell);
        }

        for &fk in face_keys {
            if !self.faces.contains_key(fk) {
                return Err(Error::FaceNotFound(fk));
            }
        }

        let key = self.shells.insert(ShellData {
            faces: face_keys.to_vec(),
        });

        for &fk in face_keys {
            self.link_face_shell(fk, key);
        }

        Ok(key)
    }

    /// Creates a cell from an outer shell.
    ///
    /// The outer shell should be a closed surface bounding a volume.
    pub fn add_cell(&mut self, outer_shell: ShellKey) -> Result<CellKey> {
        if !self.shells.contains_key(outer_shell) {
            return Err(Error::ShellNotFound(outer_shell));
        }

        let key = self.cells.insert(CellData {
            outer_shell,
            inner_shells: Vec::new(),
        });

        self.link_shell_cell(outer_shell, key);
        Ok(key)
    }

    /// Creates a cell with an outer shell and inner void shells.
    pub fn add_cell_with_voids(
        &mut self,
        outer_shell: ShellKey,
        inner_shells: &[ShellKey],
    ) -> Result<CellKey> {
        if !self.shells.contains_key(outer_shell) {
            return Err(Error::ShellNotFound(outer_shell));
        }

        for &is in inner_shells {
            if !self.shells.contains_key(is) {
                return Err(Error::ShellNotFound(is));
            }
        }

        let key = self.cells.insert(CellData {
            outer_shell,
            inner_shells: inner_shells.to_vec(),
        });

        self.link_shell_cell(outer_shell, key);
        for &is in inner_shells {
            self.link_shell_cell(is, key);
        }

        Ok(key)
    }

    /// Creates a cell complex from a list of cells.
    ///
    /// The cells are expected to share faces (non-manifold topology).
    pub fn add_cell_complex(&mut self, cell_keys: &[CellKey]) -> Result<CellComplexKey> {
        if cell_keys.is_empty() {
            return Err(Error::EmptyCellComplex);
        }

        for &ck in cell_keys {
            if !self.cells.contains_key(ck) {
                return Err(Error::CellNotFound(ck));
            }
        }

        let key = self.cell_complexes.insert(CellComplexData {
            cells: cell_keys.to_vec(),
        });

        for &ck in cell_keys {
            self.link_cell_complex(ck, key);
        }

        Ok(key)
    }
}

/// Helper to build a rectangular face from four corner vertices.
///
/// Creates 4 edges, 1 wire, and 1 face. Returns `(face_key, wire_key, edge_keys)`.
pub fn make_rectangle(
    arena: &mut TopologyArena,
    v0: VertexKey,
    v1: VertexKey,
    v2: VertexKey,
    v3: VertexKey,
) -> Result<(FaceKey, WireKey, [EdgeKey; 4])> {
    let e0 = arena.add_edge(v0, v1)?;
    let e1 = arena.add_edge(v1, v2)?;
    let e2 = arena.add_edge(v2, v3)?;
    let e3 = arena.add_edge(v3, v0)?;
    let wire = arena.add_wire(&[e0, e1, e2, e3])?;
    let face = arena.add_face(wire)?;
    Ok((face, wire, [e0, e1, e2, e3]))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Vertex tests ---

    #[test]
    fn add_vertex_increments_count() {
        let mut arena = TopologyArena::new();
        assert_eq!(arena.vertex_count(), 0);
        arena.add_vertex(0.0, 0.0, 0.0);
        assert_eq!(arena.vertex_count(), 1);
        arena.add_vertex(1.0, 0.0, 0.0);
        assert_eq!(arena.vertex_count(), 2);
    }

    // --- Edge tests ---

    #[test]
    fn add_edge_valid() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let edge = arena.add_edge(v0, v1).unwrap();

        let data = arena.edge(edge).unwrap();
        assert_eq!(data.start, v0);
        assert_eq!(data.end, v1);
        assert_eq!(arena.edge_count(), 1);
    }

    #[test]
    fn add_edge_invalid_vertex() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);

        // Create a stale key by inserting and removing a vertex from the
        // same arena. The generation counter ensures the key is invalid.
        let v_temp = arena.add_vertex(99.0, 99.0, 99.0);
        arena.vertices.remove(v_temp);

        assert!(arena.add_edge(v0, v_temp).is_err());
    }

    #[test]
    fn add_edge_registers_upward_adjacency() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v0, v2).unwrap();

        // v0 should be adjacent to both edges
        let v0_edges = &arena.vertex_to_edges[&v0];
        assert!(v0_edges.contains(&e0));
        assert!(v0_edges.contains(&e1));
        assert_eq!(v0_edges.len(), 2);
    }

    // --- Wire tests ---

    #[test]
    fn add_wire_triangle() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v1, v2).unwrap();
        let e2 = arena.add_edge(v2, v0).unwrap();

        let wire = arena.add_wire(&[e0, e1, e2]).unwrap();
        let data = arena.wire(wire).unwrap();
        assert_eq!(data.edges.len(), 3);
        // All forward orientation for a simple chain
        assert_eq!(data.orientations, vec![true, true, true]);
    }

    #[test]
    fn add_wire_reversed_edge() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap(); // v0 → v1
        let e1 = arena.add_edge(v2, v1).unwrap(); // v2 → v1 (reversed: v1 → v2)
        let e2 = arena.add_edge(v2, v0).unwrap(); // v2 → v0

        let wire = arena.add_wire(&[e0, e1, e2]).unwrap();
        let data = arena.wire(wire).unwrap();
        // e1 should be reversed since its end (v1) matches prev end (v1)
        assert_eq!(data.orientations, vec![true, false, true]);
    }

    #[test]
    fn add_wire_empty_fails() {
        let mut arena = TopologyArena::new();
        assert!(arena.add_wire(&[]).is_err());
    }

    #[test]
    fn add_wire_disconnected_fails() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);
        let v3 = arena.add_vertex(5.0, 5.0, 5.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v2, v3).unwrap(); // disconnected from e0

        assert!(arena.add_wire(&[e0, e1]).is_err());
    }

    // --- Face tests ---

    #[test]
    fn add_face_triangle() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v1, v2).unwrap();
        let e2 = arena.add_edge(v2, v0).unwrap();

        let wire = arena.add_wire(&[e0, e1, e2]).unwrap();
        let face = arena.add_face(wire).unwrap();

        let data = arena.face(face).unwrap();
        assert_eq!(data.outer_wire, wire);
        assert!(data.inner_wires.is_empty());
    }

    #[test]
    fn add_face_with_hole() {
        let mut arena = TopologyArena::new();

        // Outer square
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(10.0, 0.0, 0.0);
        let v2 = arena.add_vertex(10.0, 10.0, 0.0);
        let v3 = arena.add_vertex(0.0, 10.0, 0.0);
        let (_, outer_wire, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();

        // Inner hole (triangle)
        let h0 = arena.add_vertex(3.0, 3.0, 0.0);
        let h1 = arena.add_vertex(7.0, 3.0, 0.0);
        let h2 = arena.add_vertex(5.0, 7.0, 0.0);
        let he0 = arena.add_edge(h0, h1).unwrap();
        let he1 = arena.add_edge(h1, h2).unwrap();
        let he2 = arena.add_edge(h2, h0).unwrap();
        let hole_wire = arena.add_wire(&[he0, he1, he2]).unwrap();

        // Face created directly (not via make_rectangle) to include hole
        let face = arena.add_face_with_holes(outer_wire, &[hole_wire]).unwrap();
        let data = arena.face(face).unwrap();
        assert_eq!(data.inner_wires.len(), 1);
        assert_eq!(data.inner_wires[0], hole_wire);
    }

    // --- Shell tests ---

    #[test]
    fn add_shell_empty_fails() {
        let mut arena = TopologyArena::new();
        assert!(arena.add_shell(&[]).is_err());
    }

    // --- make_rectangle helper ---

    #[test]
    fn make_rectangle_creates_face() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, wire, edges) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();

        assert_eq!(arena.face_count(), 1);
        assert_eq!(arena.wire_count(), 1);
        assert_eq!(arena.edge_count(), 4);
        assert!(arena.face(face).is_some());
        assert!(arena.wire(wire).is_some());
        for e in &edges {
            assert!(arena.edge(*e).is_some());
        }
    }

    // --- Full box construction (integration test) ---

    #[test]
    fn construct_box_cell() {
        let mut arena = TopologyArena::new();

        // 8 vertices of a unit cube
        let v = [
            arena.add_vertex(0.0, 0.0, 0.0), // 0: origin
            arena.add_vertex(1.0, 0.0, 0.0), // 1
            arena.add_vertex(1.0, 1.0, 0.0), // 2
            arena.add_vertex(0.0, 1.0, 0.0), // 3
            arena.add_vertex(0.0, 0.0, 1.0), // 4
            arena.add_vertex(1.0, 0.0, 1.0), // 5
            arena.add_vertex(1.0, 1.0, 1.0), // 6
            arena.add_vertex(0.0, 1.0, 1.0), // 7
        ];

        // 6 faces of the cube
        let (f_bottom, _, _) = make_rectangle(&mut arena, v[0], v[1], v[2], v[3]).unwrap();
        let (f_top, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f_front, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f_back, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f_left, _, _) = make_rectangle(&mut arena, v[0], v[3], v[7], v[4]).unwrap();
        let (f_right, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell = arena
            .add_shell(&[f_bottom, f_top, f_front, f_back, f_left, f_right])
            .unwrap();
        let cell = arena.add_cell(shell).unwrap();

        assert_eq!(arena.vertex_count(), 8);
        assert_eq!(arena.edge_count(), 24); // 4 edges per face * 6 faces (unshared)
        assert_eq!(arena.face_count(), 6);
        assert_eq!(arena.shell_count(), 1);
        assert_eq!(arena.cell_count(), 1);
        assert!(arena.cell(cell).is_some());
    }

    // --- NMT: shared face between two cells ---

    #[test]
    fn two_cells_share_a_face() {
        let mut arena = TopologyArena::new();

        // Two adjacent rooms sharing a wall (face)
        // Room 1: x=[0,1], y=[0,1], z=[0,1]
        // Room 2: x=[1,2], y=[0,1], z=[0,1]
        // Shared face: x=1 plane

        // Room 1 vertices
        let r1 = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(1.0, 0.0, 0.0),
            arena.add_vertex(1.0, 1.0, 0.0),
            arena.add_vertex(0.0, 1.0, 0.0),
            arena.add_vertex(0.0, 0.0, 1.0),
            arena.add_vertex(1.0, 0.0, 1.0),
            arena.add_vertex(1.0, 1.0, 1.0),
            arena.add_vertex(0.0, 1.0, 1.0),
        ];

        // Room 2 extra vertices (shares r1[1], r1[2], r1[5], r1[6])
        let r2_extra = [
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 1.0, 0.0),
            arena.add_vertex(2.0, 0.0, 1.0),
            arena.add_vertex(2.0, 1.0, 1.0),
        ];

        // Shared wall face (x=1 plane)
        let (shared_face, _, _) =
            make_rectangle(&mut arena, r1[1], r1[2], r1[6], r1[5]).unwrap();

        // Room 1 other faces
        let (f1_bottom, _, _) = make_rectangle(&mut arena, r1[0], r1[1], r1[2], r1[3]).unwrap();
        let (f1_top, _, _) = make_rectangle(&mut arena, r1[4], r1[5], r1[6], r1[7]).unwrap();
        let (f1_front, _, _) = make_rectangle(&mut arena, r1[0], r1[1], r1[5], r1[4]).unwrap();
        let (f1_back, _, _) = make_rectangle(&mut arena, r1[2], r1[3], r1[7], r1[6]).unwrap();
        let (f1_left, _, _) = make_rectangle(&mut arena, r1[0], r1[3], r1[7], r1[4]).unwrap();

        // Room 2 other faces
        let (f2_bottom, _, _) =
            make_rectangle(&mut arena, r1[1], r2_extra[0], r2_extra[1], r1[2]).unwrap();
        let (f2_top, _, _) =
            make_rectangle(&mut arena, r1[5], r2_extra[2], r2_extra[3], r1[6]).unwrap();
        let (f2_front, _, _) =
            make_rectangle(&mut arena, r1[1], r2_extra[0], r2_extra[2], r1[5]).unwrap();
        let (f2_back, _, _) =
            make_rectangle(&mut arena, r1[2], r2_extra[1], r2_extra[3], r1[6]).unwrap();
        let (f2_right, _, _) =
            make_rectangle(&mut arena, r2_extra[0], r2_extra[1], r2_extra[3], r2_extra[2])
                .unwrap();

        // Shell 1 uses the shared face
        let shell1 = arena
            .add_shell(&[f1_bottom, f1_top, f1_front, f1_back, f1_left, shared_face])
            .unwrap();
        // Shell 2 also uses the shared face — THIS IS NMT!
        let shell2 = arena
            .add_shell(&[f2_bottom, f2_top, f2_front, f2_back, f2_right, shared_face])
            .unwrap();

        let cell1 = arena.add_cell(shell1).unwrap();
        let cell2 = arena.add_cell(shell2).unwrap();

        // The shared face should be linked to both shells
        let shared_shells = &arena.face_to_shells[&shared_face];
        assert_eq!(shared_shells.len(), 2);
        assert!(shared_shells.contains(&shell1));
        assert!(shared_shells.contains(&shell2));

        // Create a cell complex
        let complex = arena.add_cell_complex(&[cell1, cell2]).unwrap();
        assert!(arena.cell_complex(complex).is_some());
        assert_eq!(arena.cell_complex(complex).unwrap().cells.len(), 2);
    }
}
