// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! # IFC-Lite Topology
//!
//! Non-manifold topology (NMT) data structure for IFC spatial reasoning.
//!
//! This crate provides an arena-based topology data structure where entities
//! (vertices, edges, wires, faces, shells, cells, cell complexes) are stored
//! in slot maps with bidirectional adjacency indices. Faces can belong to
//! multiple cells (shared walls between rooms), which is the key property
//! that distinguishes NMT from manifold topology.
//!
//! ## Clean-Room Implementation
//!
//! This is an original implementation under MPL-2.0. No code is derived from
//! TopologicPy (AGPL v3) or TopologicCore (AGPL v3). The implementation is
//! based on published computational topology algorithms.

pub mod arena;
pub mod construction;
pub mod dictionary;
pub mod error;
pub mod geometry;
pub mod keys;
pub mod serialization;
pub mod transform;
pub mod traversal;

pub use arena::TopologyArena;
pub use dictionary::{DictValue, Dictionary};
pub use error::{Error, Result};
pub use keys::{
    CellComplexKey, CellKey, EdgeKey, FaceKey, ShellKey, TopologyKey, TopologyType, VertexKey,
    WireKey,
};
