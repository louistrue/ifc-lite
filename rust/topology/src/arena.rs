// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Arena-based storage for non-manifold topology entities.
//!
//! The [`TopologyArena`] is the central owner of all topology data. Every entity
//! (vertex, edge, wire, face, shell, cell, cell complex) lives inside slot maps
//! with stable, generational keys. Bidirectional adjacency indices enable both
//! downward traversal (cell → faces → edges → vertices) and upward traversal
//! (vertex → which edges use it → which faces → which cells).
//!
//! ## Non-Manifold Topology (NMT)
//!
//! In manifold topology, each edge borders at most 2 faces, and each face
//! borders at most 2 cells. NMT removes this restriction: a face can be shared
//! by 3+ cells (e.g., a wall between three rooms at a T-junction), and an edge
//! can be shared by any number of faces. This is essential for building models
//! where architectural elements are shared between spaces.

use rustc_hash::{FxHashMap, FxHashSet};
use slotmap::SlotMap;

use crate::dictionary::Dictionary;
use crate::keys::*;

/// Data stored for a vertex: a point in 3D space.
#[derive(Debug, Clone)]
pub struct VertexData {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Data stored for an edge: a line segment between two vertices.
#[derive(Debug, Clone)]
pub struct EdgeData {
    pub start: VertexKey,
    pub end: VertexKey,
}

/// Data stored for a wire: an ordered chain of connected edges.
#[derive(Debug, Clone)]
pub struct WireData {
    /// Edges in order. Each edge's end vertex must equal the next edge's start
    /// vertex (or the reverse, tracked by `orientations`).
    pub edges: Vec<EdgeKey>,
    /// `true` if edge[i] is traversed forward (start→end), `false` if reversed.
    pub orientations: Vec<bool>,
}

/// Data stored for a face: a planar region bounded by one outer wire and
/// zero or more inner wires (holes).
#[derive(Debug, Clone)]
pub struct FaceData {
    pub outer_wire: WireKey,
    pub inner_wires: Vec<WireKey>,
}

/// Data stored for a shell: a connected surface made of faces.
#[derive(Debug, Clone)]
pub struct ShellData {
    pub faces: Vec<FaceKey>,
}

/// Data stored for a cell: a closed 3D volume bounded by a shell, with
/// optional internal void shells.
#[derive(Debug, Clone)]
pub struct CellData {
    pub outer_shell: ShellKey,
    pub inner_shells: Vec<ShellKey>,
}

/// Data stored for a cell complex: a set of cells that share faces.
#[derive(Debug, Clone)]
pub struct CellComplexData {
    pub cells: Vec<CellKey>,
}

/// The central arena that owns all topology entities and their adjacency indices.
///
/// # Example
///
/// ```
/// use ifc_lite_topology::TopologyArena;
///
/// let mut arena = TopologyArena::new();
/// let v0 = arena.add_vertex(0.0, 0.0, 0.0);
/// let v1 = arena.add_vertex(1.0, 0.0, 0.0);
/// let v2 = arena.add_vertex(1.0, 1.0, 0.0);
///
/// assert_eq!(arena.vertex_count(), 3);
/// ```
#[derive(Debug)]
pub struct TopologyArena {
    // Entity storage
    pub(crate) vertices: SlotMap<VertexKey, VertexData>,
    pub(crate) edges: SlotMap<EdgeKey, EdgeData>,
    pub(crate) wires: SlotMap<WireKey, WireData>,
    pub(crate) faces: SlotMap<FaceKey, FaceData>,
    pub(crate) shells: SlotMap<ShellKey, ShellData>,
    pub(crate) cells: SlotMap<CellKey, CellData>,
    pub(crate) cell_complexes: SlotMap<CellComplexKey, CellComplexData>,

    // Upward adjacency: child → parents
    pub(crate) vertex_to_edges: FxHashMap<VertexKey, FxHashSet<EdgeKey>>,
    pub(crate) edge_to_wires: FxHashMap<EdgeKey, FxHashSet<WireKey>>,
    pub(crate) wire_to_faces: FxHashMap<WireKey, FxHashSet<FaceKey>>,
    pub(crate) face_to_shells: FxHashMap<FaceKey, FxHashSet<ShellKey>>,
    pub(crate) shell_to_cells: FxHashMap<ShellKey, FxHashSet<CellKey>>,
    pub(crate) cell_to_complexes: FxHashMap<CellKey, FxHashSet<CellComplexKey>>,

    // Metadata
    pub(crate) dictionaries: FxHashMap<TopologyKey, Dictionary>,

    // Content / Aperture (IFC spatial relationships)
    pub(crate) contents: FxHashMap<TopologyKey, Vec<(TopologyKey, Option<crate::content::ContextCoordinates>)>>,
    pub(crate) apertures: FxHashMap<FaceKey, Vec<crate::content::Aperture>>,
}

impl TopologyArena {
    /// Creates a new, empty topology arena.
    pub fn new() -> Self {
        Self {
            vertices: SlotMap::with_key(),
            edges: SlotMap::with_key(),
            wires: SlotMap::with_key(),
            faces: SlotMap::with_key(),
            shells: SlotMap::with_key(),
            cells: SlotMap::with_key(),
            cell_complexes: SlotMap::with_key(),

            vertex_to_edges: FxHashMap::default(),
            edge_to_wires: FxHashMap::default(),
            wire_to_faces: FxHashMap::default(),
            face_to_shells: FxHashMap::default(),
            shell_to_cells: FxHashMap::default(),
            cell_to_complexes: FxHashMap::default(),

            dictionaries: FxHashMap::default(),

            contents: FxHashMap::default(),
            apertures: FxHashMap::default(),
        }
    }

    // --- Vertex operations ---

    /// Adds a vertex at the given 3D coordinates.
    pub fn add_vertex(&mut self, x: f64, y: f64, z: f64) -> VertexKey {
        self.vertices.insert(VertexData { x, y, z })
    }

    /// Returns the vertex data for the given key, or `None` if not found.
    pub fn vertex(&self, key: VertexKey) -> Option<&VertexData> {
        self.vertices.get(key)
    }

    /// Returns the number of vertices in the arena.
    pub fn vertex_count(&self) -> usize {
        self.vertices.len()
    }

    /// Returns the coordinates of a vertex as `[x, y, z]`.
    pub fn vertex_coords(&self, key: VertexKey) -> Option<[f64; 3]> {
        self.vertices.get(key).map(|v| [v.x, v.y, v.z])
    }

    // --- Edge operations ---

    /// Returns the edge data for the given key, or `None` if not found.
    pub fn edge(&self, key: EdgeKey) -> Option<&EdgeData> {
        self.edges.get(key)
    }

    /// Returns the number of edges in the arena.
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    // --- Wire operations ---

    /// Returns the wire data for the given key, or `None` if not found.
    pub fn wire(&self, key: WireKey) -> Option<&WireData> {
        self.wires.get(key)
    }

    /// Returns the number of wires in the arena.
    pub fn wire_count(&self) -> usize {
        self.wires.len()
    }

    // --- Face operations ---

    /// Returns the face data for the given key, or `None` if not found.
    pub fn face(&self, key: FaceKey) -> Option<&FaceData> {
        self.faces.get(key)
    }

    /// Returns the number of faces in the arena.
    pub fn face_count(&self) -> usize {
        self.faces.len()
    }

    // --- Shell operations ---

    /// Returns the shell data for the given key, or `None` if not found.
    pub fn shell(&self, key: ShellKey) -> Option<&ShellData> {
        self.shells.get(key)
    }

    /// Returns the number of shells in the arena.
    pub fn shell_count(&self) -> usize {
        self.shells.len()
    }

    // --- Cell operations ---

    /// Returns the cell data for the given key, or `None` if not found.
    pub fn cell(&self, key: CellKey) -> Option<&CellData> {
        self.cells.get(key)
    }

    /// Returns the number of cells in the arena.
    pub fn cell_count(&self) -> usize {
        self.cells.len()
    }

    // --- CellComplex operations ---

    /// Returns the cell complex data for the given key, or `None` if not found.
    pub fn cell_complex(&self, key: CellComplexKey) -> Option<&CellComplexData> {
        self.cell_complexes.get(key)
    }

    /// Returns the number of cell complexes in the arena.
    pub fn cell_complex_count(&self) -> usize {
        self.cell_complexes.len()
    }

    // --- Entity existence checks ---

    /// Returns `true` if the given topology key references a valid entity.
    pub fn contains(&self, key: TopologyKey) -> bool {
        match key {
            TopologyKey::Vertex(k) => self.vertices.contains_key(k),
            TopologyKey::Edge(k) => self.edges.contains_key(k),
            TopologyKey::Wire(k) => self.wires.contains_key(k),
            TopologyKey::Face(k) => self.faces.contains_key(k),
            TopologyKey::Shell(k) => self.shells.contains_key(k),
            TopologyKey::Cell(k) => self.cells.contains_key(k),
            TopologyKey::CellComplex(k) => self.cell_complexes.contains_key(k),
        }
    }

    // --- Adjacency index helpers ---

    /// Register that an edge uses a vertex (upward adjacency).
    pub(crate) fn link_vertex_edge(&mut self, vertex: VertexKey, edge: EdgeKey) {
        self.vertex_to_edges
            .entry(vertex)
            .or_default()
            .insert(edge);
    }

    /// Register that a wire uses an edge (upward adjacency).
    pub(crate) fn link_edge_wire(&mut self, edge: EdgeKey, wire: WireKey) {
        self.edge_to_wires.entry(edge).or_default().insert(wire);
    }

    /// Register that a face uses a wire (upward adjacency).
    pub(crate) fn link_wire_face(&mut self, wire: WireKey, face: FaceKey) {
        self.wire_to_faces.entry(wire).or_default().insert(face);
    }

    /// Register that a shell uses a face (upward adjacency).
    pub(crate) fn link_face_shell(&mut self, face: FaceKey, shell: ShellKey) {
        self.face_to_shells.entry(face).or_default().insert(shell);
    }

    /// Register that a cell uses a shell (upward adjacency).
    pub(crate) fn link_shell_cell(&mut self, shell: ShellKey, cell: CellKey) {
        self.shell_to_cells.entry(shell).or_default().insert(cell);
    }

    /// Register that a cell complex uses a cell (upward adjacency).
    pub(crate) fn link_cell_complex(&mut self, cell: CellKey, complex: CellComplexKey) {
        self.cell_to_complexes
            .entry(cell)
            .or_default()
            .insert(complex);
    }
}

impl Default for TopologyArena {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_arena_is_empty() {
        let arena = TopologyArena::new();
        assert_eq!(arena.vertex_count(), 0);
        assert_eq!(arena.edge_count(), 0);
        assert_eq!(arena.wire_count(), 0);
        assert_eq!(arena.face_count(), 0);
        assert_eq!(arena.shell_count(), 0);
        assert_eq!(arena.cell_count(), 0);
        assert_eq!(arena.cell_complex_count(), 0);
    }

    #[test]
    fn add_and_retrieve_vertex() {
        let mut arena = TopologyArena::new();
        let key = arena.add_vertex(1.0, 2.0, 3.0);

        let v = arena.vertex(key).unwrap();
        assert_eq!(v.x, 1.0);
        assert_eq!(v.y, 2.0);
        assert_eq!(v.z, 3.0);
        assert_eq!(arena.vertex_count(), 1);
    }

    #[test]
    fn vertex_coords_helper() {
        let mut arena = TopologyArena::new();
        let key = arena.add_vertex(-5.0, 0.0, 10.5);

        assert_eq!(arena.vertex_coords(key), Some([-5.0, 0.0, 10.5]));
    }

    #[test]
    fn contains_check() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);
        assert!(arena.contains(TopologyKey::Vertex(vk)));
    }

    #[test]
    fn default_creates_empty() {
        let arena = TopologyArena::default();
        assert_eq!(arena.vertex_count(), 0);
    }
}
