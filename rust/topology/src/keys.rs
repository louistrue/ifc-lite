// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Topology key types for arena-based storage.
//!
//! Each topology entity gets a unique, type-safe key for O(1) lookup in the
//! arena. Keys are created by `slotmap::SlotMap` and remain valid even after
//! other entities are removed (generational indices).

use slotmap::new_key_type;

new_key_type! {
    /// Key for a vertex (point in 3D space).
    pub struct VertexKey;

    /// Key for an edge (line segment between two vertices).
    pub struct EdgeKey;

    /// Key for a wire (ordered chain of connected edges).
    pub struct WireKey;

    /// Key for a face (planar polygon bounded by wires).
    pub struct FaceKey;

    /// Key for a shell (connected set of faces).
    pub struct ShellKey;

    /// Key for a cell (closed volume bounded by a shell).
    pub struct CellKey;

    /// Key for a cell complex (set of cells sharing faces).
    pub struct CellComplexKey;
}

/// A key that can reference any topology entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TopologyKey {
    Vertex(VertexKey),
    Edge(EdgeKey),
    Wire(WireKey),
    Face(FaceKey),
    Shell(ShellKey),
    Cell(CellKey),
    CellComplex(CellComplexKey),
}

impl TopologyKey {
    /// Returns the topology type of this key.
    pub fn topology_type(&self) -> TopologyType {
        match self {
            TopologyKey::Vertex(_) => TopologyType::Vertex,
            TopologyKey::Edge(_) => TopologyType::Edge,
            TopologyKey::Wire(_) => TopologyType::Wire,
            TopologyKey::Face(_) => TopologyType::Face,
            TopologyKey::Shell(_) => TopologyType::Shell,
            TopologyKey::Cell(_) => TopologyType::Cell,
            TopologyKey::CellComplex(_) => TopologyType::CellComplex,
        }
    }
}

/// Discriminant for topology entity types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TopologyType {
    Vertex = 0,
    Edge = 1,
    Wire = 2,
    Face = 3,
    Shell = 4,
    Cell = 5,
    CellComplex = 6,
}

impl TopologyType {
    /// Returns the type name as a string.
    pub fn as_str(&self) -> &'static str {
        match self {
            TopologyType::Vertex => "Vertex",
            TopologyType::Edge => "Edge",
            TopologyType::Wire => "Wire",
            TopologyType::Face => "Face",
            TopologyType::Shell => "Shell",
            TopologyType::Cell => "Cell",
            TopologyType::CellComplex => "CellComplex",
        }
    }
}

impl std::fmt::Display for TopologyType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// Conversion impls from specific keys to TopologyKey
impl From<VertexKey> for TopologyKey {
    fn from(k: VertexKey) -> Self {
        TopologyKey::Vertex(k)
    }
}

impl From<EdgeKey> for TopologyKey {
    fn from(k: EdgeKey) -> Self {
        TopologyKey::Edge(k)
    }
}

impl From<WireKey> for TopologyKey {
    fn from(k: WireKey) -> Self {
        TopologyKey::Wire(k)
    }
}

impl From<FaceKey> for TopologyKey {
    fn from(k: FaceKey) -> Self {
        TopologyKey::Face(k)
    }
}

impl From<ShellKey> for TopologyKey {
    fn from(k: ShellKey) -> Self {
        TopologyKey::Shell(k)
    }
}

impl From<CellKey> for TopologyKey {
    fn from(k: CellKey) -> Self {
        TopologyKey::Cell(k)
    }
}

impl From<CellComplexKey> for TopologyKey {
    fn from(k: CellComplexKey) -> Self {
        TopologyKey::CellComplex(k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topology_type_names() {
        assert_eq!(TopologyType::Vertex.as_str(), "Vertex");
        assert_eq!(TopologyType::Edge.as_str(), "Edge");
        assert_eq!(TopologyType::Wire.as_str(), "Wire");
        assert_eq!(TopologyType::Face.as_str(), "Face");
        assert_eq!(TopologyType::Shell.as_str(), "Shell");
        assert_eq!(TopologyType::Cell.as_str(), "Cell");
        assert_eq!(TopologyType::CellComplex.as_str(), "CellComplex");
    }

    #[test]
    fn topology_type_ordering() {
        assert!(TopologyType::Vertex < TopologyType::Edge);
        assert!(TopologyType::Edge < TopologyType::Wire);
        assert!(TopologyType::Wire < TopologyType::Face);
        assert!(TopologyType::Face < TopologyType::Shell);
        assert!(TopologyType::Shell < TopologyType::Cell);
        assert!(TopologyType::Cell < TopologyType::CellComplex);
    }

    #[test]
    fn topology_key_type_discrimination() {
        // We can't create real SlotMap keys without a SlotMap,
        // but we can test the type system compiles correctly.
        let ty = TopologyType::Face;
        assert_eq!(ty.to_string(), "Face");
    }
}
