// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Traversal methods for navigating the topology hierarchy.
//!
//! Supports both downward traversal (cell → faces → edges → vertices) and
//! upward traversal (vertex → edges → faces → cells) via the adjacency index.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::arena::TopologyArena;
use crate::keys::*;

// =============================================================================
// Downward traversal: extract sub-topologies
// =============================================================================

impl TopologyArena {
    /// Returns the start and end vertex keys of an edge.
    pub fn edge_vertices(&self, key: EdgeKey) -> Option<(VertexKey, VertexKey)> {
        self.edges.get(key).map(|e| (e.start, e.end))
    }

    /// Returns all unique vertex keys in a wire, in traversal order.
    pub fn wire_vertices_ordered(&self, key: WireKey) -> Option<Vec<VertexKey>> {
        let wire = self.wires.get(key)?;
        let mut vertices = Vec::with_capacity(wire.edges.len());

        for (i, &ek) in wire.edges.iter().enumerate() {
            let edge = self.edges.get(ek)?;
            let start = if wire.orientations[i] {
                edge.start
            } else {
                edge.end
            };
            vertices.push(start);
        }

        Some(vertices)
    }

    /// Returns all unique vertex keys referenced by a wire.
    pub fn wire_vertices(&self, key: WireKey) -> Option<FxHashSet<VertexKey>> {
        let wire = self.wires.get(key)?;
        let mut set = FxHashSet::default();
        for &ek in &wire.edges {
            let edge = self.edges.get(ek)?;
            set.insert(edge.start);
            set.insert(edge.end);
        }
        Some(set)
    }

    /// Returns the edge keys of a wire.
    pub fn wire_edges(&self, key: WireKey) -> Option<&[EdgeKey]> {
        self.wires.get(key).map(|w| w.edges.as_slice())
    }

    /// Returns all unique vertex keys in a face.
    pub fn face_vertices(&self, key: FaceKey) -> Option<FxHashSet<VertexKey>> {
        let face = self.faces.get(key)?;
        let mut set = self.wire_vertices(face.outer_wire)?;
        for &iw in &face.inner_wires {
            if let Some(verts) = self.wire_vertices(iw) {
                set.extend(verts);
            }
        }
        Some(set)
    }

    /// Returns all unique edge keys in a face.
    pub fn face_edges(&self, key: FaceKey) -> Option<FxHashSet<EdgeKey>> {
        let face = self.faces.get(key)?;
        let mut set = FxHashSet::default();
        if let Some(wire) = self.wires.get(face.outer_wire) {
            set.extend(&wire.edges);
        }
        for &iw in &face.inner_wires {
            if let Some(wire) = self.wires.get(iw) {
                set.extend(&wire.edges);
            }
        }
        Some(set)
    }

    /// Returns the outer wire of a face.
    pub fn face_outer_wire(&self, key: FaceKey) -> Option<WireKey> {
        self.faces.get(key).map(|f| f.outer_wire)
    }

    /// Returns the inner (hole) wires of a face.
    pub fn face_inner_wires(&self, key: FaceKey) -> Option<&[WireKey]> {
        self.faces.get(key).map(|f| f.inner_wires.as_slice())
    }

    /// Returns the face keys of a shell.
    pub fn shell_faces(&self, key: ShellKey) -> Option<&[FaceKey]> {
        self.shells.get(key).map(|s| s.faces.as_slice())
    }

    /// Returns all unique edge keys in a shell.
    pub fn shell_edges(&self, key: ShellKey) -> Option<FxHashSet<EdgeKey>> {
        let shell = self.shells.get(key)?;
        let mut set = FxHashSet::default();
        for &fk in &shell.faces {
            if let Some(edges) = self.face_edges(fk) {
                set.extend(edges);
            }
        }
        Some(set)
    }

    /// Returns all unique vertex keys in a shell.
    pub fn shell_vertices(&self, key: ShellKey) -> Option<FxHashSet<VertexKey>> {
        let shell = self.shells.get(key)?;
        let mut set = FxHashSet::default();
        for &fk in &shell.faces {
            if let Some(verts) = self.face_vertices(fk) {
                set.extend(verts);
            }
        }
        Some(set)
    }

    /// Returns the outer shell of a cell.
    pub fn cell_outer_shell(&self, key: CellKey) -> Option<ShellKey> {
        self.cells.get(key).map(|c| c.outer_shell)
    }

    /// Returns the inner (void) shells of a cell.
    pub fn cell_inner_shells(&self, key: CellKey) -> Option<&[ShellKey]> {
        self.cells.get(key).map(|c| c.inner_shells.as_slice())
    }

    /// Returns all face keys in a cell (outer + inner shells).
    pub fn cell_faces(&self, key: CellKey) -> Option<FxHashSet<FaceKey>> {
        let cell = self.cells.get(key)?;
        let mut set = FxHashSet::default();
        if let Some(faces) = self.shell_faces(cell.outer_shell) {
            set.extend(faces);
        }
        for &is in &cell.inner_shells {
            if let Some(faces) = self.shell_faces(is) {
                set.extend(faces);
            }
        }
        Some(set)
    }

    /// Returns all unique edge keys in a cell.
    pub fn cell_edges(&self, key: CellKey) -> Option<FxHashSet<EdgeKey>> {
        let cell = self.cells.get(key)?;
        let mut set = FxHashSet::default();
        if let Some(edges) = self.shell_edges(cell.outer_shell) {
            set.extend(edges);
        }
        for &is in &cell.inner_shells {
            if let Some(edges) = self.shell_edges(is) {
                set.extend(edges);
            }
        }
        Some(set)
    }

    /// Returns all unique vertex keys in a cell.
    pub fn cell_vertices(&self, key: CellKey) -> Option<FxHashSet<VertexKey>> {
        let cell = self.cells.get(key)?;
        let mut set = FxHashSet::default();
        if let Some(verts) = self.shell_vertices(cell.outer_shell) {
            set.extend(verts);
        }
        for &is in &cell.inner_shells {
            if let Some(verts) = self.shell_vertices(is) {
                set.extend(verts);
            }
        }
        Some(set)
    }

    /// Returns the cell keys in a cell complex.
    pub fn complex_cells(&self, key: CellComplexKey) -> Option<&[CellKey]> {
        self.cell_complexes.get(key).map(|cc| cc.cells.as_slice())
    }

    /// Returns all unique face keys in a cell complex.
    pub fn complex_faces(&self, key: CellComplexKey) -> Option<FxHashSet<FaceKey>> {
        let cc = self.cell_complexes.get(key)?;
        let mut set = FxHashSet::default();
        for &ck in &cc.cells {
            if let Some(faces) = self.cell_faces(ck) {
                set.extend(faces);
            }
        }
        Some(set)
    }

    /// Returns all unique edge keys in a cell complex.
    pub fn complex_edges(&self, key: CellComplexKey) -> Option<FxHashSet<EdgeKey>> {
        let cc = self.cell_complexes.get(key)?;
        let mut set = FxHashSet::default();
        for &ck in &cc.cells {
            if let Some(edges) = self.cell_edges(ck) {
                set.extend(edges);
            }
        }
        Some(set)
    }

    /// Returns all unique vertex keys in a cell complex.
    pub fn complex_vertices(&self, key: CellComplexKey) -> Option<FxHashSet<VertexKey>> {
        let cc = self.cell_complexes.get(key)?;
        let mut set = FxHashSet::default();
        for &ck in &cc.cells {
            if let Some(verts) = self.cell_vertices(ck) {
                set.extend(verts);
            }
        }
        Some(set)
    }

    // =========================================================================
    // Upward traversal: find parents via adjacency index
    // =========================================================================

    /// Returns edges that use a given vertex.
    pub fn vertex_edges(&self, key: VertexKey) -> Vec<EdgeKey> {
        self.vertex_to_edges
            .get(&key)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Returns wires that contain a given edge.
    pub fn edge_wires(&self, key: EdgeKey) -> Vec<WireKey> {
        self.edge_to_wires
            .get(&key)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Returns faces that use a given wire.
    pub fn wire_faces(&self, key: WireKey) -> Vec<FaceKey> {
        self.wire_to_faces
            .get(&key)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Returns shells that contain a given face.
    pub fn face_shells(&self, key: FaceKey) -> Vec<ShellKey> {
        self.face_to_shells
            .get(&key)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Returns cells that use a given shell.
    pub fn shell_cells(&self, key: ShellKey) -> Vec<CellKey> {
        self.shell_to_cells
            .get(&key)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Returns cell complexes that contain a given cell.
    pub fn cell_complexes_of(&self, key: CellKey) -> Vec<CellComplexKey> {
        self.cell_to_complexes
            .get(&key)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    // =========================================================================
    // Adjacency queries: find siblings via shared sub-topology
    // =========================================================================

    /// Returns faces adjacent to a given face (sharing an edge) within a shell.
    pub fn adjacent_faces_in_shell(&self, face: FaceKey, shell: ShellKey) -> Vec<FaceKey> {
        let face_edge_set = match self.face_edges(face) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let shell_data = match self.shells.get(shell) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let mut adjacent = Vec::new();
        for &other_face in &shell_data.faces {
            if other_face == face {
                continue;
            }
            if let Some(other_edges) = self.face_edges(other_face) {
                if face_edge_set.intersection(&other_edges).next().is_some() {
                    adjacent.push(other_face);
                }
            }
        }
        adjacent
    }

    /// Returns cells adjacent to a given cell (sharing a face) within a cell complex.
    pub fn adjacent_cells_in_complex(
        &self,
        cell: CellKey,
        complex: CellComplexKey,
    ) -> Vec<CellKey> {
        let cell_face_set = match self.cell_faces(cell) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let cc = match self.cell_complexes.get(complex) {
            Some(cc) => cc,
            None => return Vec::new(),
        };

        let mut adjacent = Vec::new();
        for &other_cell in &cc.cells {
            if other_cell == cell {
                continue;
            }
            if let Some(other_faces) = self.cell_faces(other_cell) {
                if cell_face_set.intersection(&other_faces).next().is_some() {
                    adjacent.push(other_cell);
                }
            }
        }
        adjacent
    }

    /// Returns faces shared between two cells (the "walls" between "rooms").
    pub fn shared_faces(&self, cell_a: CellKey, cell_b: CellKey) -> Vec<FaceKey> {
        let faces_a = match self.cell_faces(cell_a) {
            Some(s) => s,
            None => return Vec::new(),
        };
        let faces_b = match self.cell_faces(cell_b) {
            Some(s) => s,
            None => return Vec::new(),
        };
        faces_a.intersection(&faces_b).copied().collect()
    }

    /// Checks if a wire is closed (last edge connects back to first edge).
    pub fn wire_is_closed(&self, key: WireKey) -> bool {
        let wire = match self.wires.get(key) {
            Some(w) => w,
            None => return false,
        };

        if wire.edges.is_empty() {
            return false;
        }

        let first_edge = match self.edges.get(wire.edges[0]) {
            Some(e) => e,
            None => return false,
        };
        let last_edge = match self.edges.get(*wire.edges.last().unwrap()) {
            Some(e) => e,
            None => return false,
        };

        let first_start = if wire.orientations[0] {
            first_edge.start
        } else {
            first_edge.end
        };

        let last_end = if *wire.orientations.last().unwrap() {
            last_edge.end
        } else {
            last_edge.start
        };

        first_start == last_end
    }

    /// Checks if a shell is closed (every edge is shared by exactly 2 faces).
    pub fn shell_is_closed(&self, key: ShellKey) -> bool {
        let shell = match self.shells.get(key) {
            Some(s) => s,
            None => return false,
        };

        // Count how many times each edge appears across all faces in this shell
        let mut edge_count: FxHashMap<EdgeKey, usize> = FxHashMap::default();
        for &fk in &shell.faces {
            if let Some(edges) = self.face_edges(fk) {
                for ek in edges {
                    *edge_count.entry(ek).or_insert(0) += 1;
                }
            }
        }

        // In a closed shell, every edge should be shared by exactly 2 faces
        !edge_count.is_empty() && edge_count.values().all(|&c| c == 2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::make_rectangle;

    fn make_triangle(arena: &mut TopologyArena) -> (FaceKey, WireKey, [VertexKey; 3]) {
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v1, v2).unwrap();
        let e2 = arena.add_edge(v2, v0).unwrap();

        let wire = arena.add_wire(&[e0, e1, e2]).unwrap();
        let face = arena.add_face(wire).unwrap();

        (face, wire, [v0, v1, v2])
    }

    // --- Downward traversal ---

    #[test]
    fn edge_vertices_returns_endpoints() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let edge = arena.add_edge(v0, v1).unwrap();

        let (start, end) = arena.edge_vertices(edge).unwrap();
        assert_eq!(start, v0);
        assert_eq!(end, v1);
    }

    #[test]
    fn wire_vertices_ordered_triangle() {
        let mut arena = TopologyArena::new();
        let (_, wire, [v0, v1, v2]) = make_triangle(&mut arena);

        let verts = arena.wire_vertices_ordered(wire).unwrap();
        assert_eq!(verts, vec![v0, v1, v2]);
    }

    #[test]
    fn face_vertices_returns_all() {
        let mut arena = TopologyArena::new();
        let (face, _, [v0, v1, v2]) = make_triangle(&mut arena);

        let verts = arena.face_vertices(face).unwrap();
        assert_eq!(verts.len(), 3);
        assert!(verts.contains(&v0));
        assert!(verts.contains(&v1));
        assert!(verts.contains(&v2));
    }

    #[test]
    fn face_edges_returns_all() {
        let mut arena = TopologyArena::new();
        let (face, _, _) = make_triangle(&mut arena);

        let edges = arena.face_edges(face).unwrap();
        assert_eq!(edges.len(), 3);
    }

    // --- Upward traversal ---

    #[test]
    fn vertex_edges_returns_incident() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v0, v2).unwrap();

        let edges = arena.vertex_edges(v0);
        assert_eq!(edges.len(), 2);
        assert!(edges.contains(&e0));
        assert!(edges.contains(&e1));
    }

    #[test]
    fn face_shells_upward() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        let shell = arena.add_shell(&[face]).unwrap();

        let shells = arena.face_shells(face);
        assert_eq!(shells.len(), 1);
        assert_eq!(shells[0], shell);
    }

    // --- Wire closed check ---

    #[test]
    fn closed_wire_triangle() {
        let mut arena = TopologyArena::new();
        let (_, wire, _) = make_triangle(&mut arena);
        assert!(arena.wire_is_closed(wire));
    }

    #[test]
    fn open_wire_two_edges() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v1, v2).unwrap();

        // This wire is open: v0 → v1 → v2, not back to v0
        // We need a wire with at least 1 edge; add_wire allows open wires
        let wire = arena.add_wire(&[e0, e1]).unwrap();
        assert!(!arena.wire_is_closed(wire));
    }

    // --- Shared faces (NMT adjacency) ---

    #[test]
    fn shared_faces_between_cells() {
        let mut arena = TopologyArena::new();

        // Two cells sharing one face
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

        // Build 6 faces for a box
        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[1], v[2], v[3]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[3], v[7], v[4]).unwrap();
        let (shared, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell1 = arena.add_shell(&[f0, f1, f2, f3, f4, shared]).unwrap();
        let cell1 = arena.add_cell(shell1).unwrap();

        // Second cell uses the same `shared` face
        let v2_extra = [
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 1.0, 0.0),
            arena.add_vertex(2.0, 0.0, 1.0),
            arena.add_vertex(2.0, 1.0, 1.0),
        ];

        let (g0, _, _) =
            make_rectangle(&mut arena, v[1], v2_extra[0], v2_extra[1], v[2]).unwrap();
        let (g1, _, _) =
            make_rectangle(&mut arena, v[5], v2_extra[2], v2_extra[3], v[6]).unwrap();
        let (g2, _, _) =
            make_rectangle(&mut arena, v[1], v2_extra[0], v2_extra[2], v[5]).unwrap();
        let (g3, _, _) =
            make_rectangle(&mut arena, v[2], v2_extra[1], v2_extra[3], v[6]).unwrap();
        let (g4, _, _) =
            make_rectangle(&mut arena, v2_extra[0], v2_extra[1], v2_extra[3], v2_extra[2])
                .unwrap();

        let shell2 = arena.add_shell(&[g0, g1, g2, g3, g4, shared]).unwrap();
        let cell2 = arena.add_cell(shell2).unwrap();

        let sf = arena.shared_faces(cell1, cell2);
        assert_eq!(sf.len(), 1);
        assert!(sf.contains(&shared));
    }

    // --- Adjacent cells in complex ---

    #[test]
    fn adjacent_cells_via_complex() {
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

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[1], v[2], v[3]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[3], v[7], v[4]).unwrap();
        let (shared, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell1 = arena.add_shell(&[f0, f1, f2, f3, f4, shared]).unwrap();
        let cell1 = arena.add_cell(shell1).unwrap();

        let v2e = [
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 1.0, 0.0),
            arena.add_vertex(2.0, 0.0, 1.0),
            arena.add_vertex(2.0, 1.0, 1.0),
        ];

        let (g0, _, _) = make_rectangle(&mut arena, v[1], v2e[0], v2e[1], v[2]).unwrap();
        let (g1, _, _) = make_rectangle(&mut arena, v[5], v2e[2], v2e[3], v[6]).unwrap();
        let (g2, _, _) = make_rectangle(&mut arena, v[1], v2e[0], v2e[2], v[5]).unwrap();
        let (g3, _, _) = make_rectangle(&mut arena, v[2], v2e[1], v2e[3], v[6]).unwrap();
        let (g4, _, _) =
            make_rectangle(&mut arena, v2e[0], v2e[1], v2e[3], v2e[2]).unwrap();

        let shell2 = arena.add_shell(&[g0, g1, g2, g3, g4, shared]).unwrap();
        let cell2 = arena.add_cell(shell2).unwrap();

        let complex = arena.add_cell_complex(&[cell1, cell2]).unwrap();

        let adj = arena.adjacent_cells_in_complex(cell1, complex);
        assert_eq!(adj.len(), 1);
        assert!(adj.contains(&cell2));

        let adj2 = arena.adjacent_cells_in_complex(cell2, complex);
        assert_eq!(adj2.len(), 1);
        assert!(adj2.contains(&cell1));
    }
}
