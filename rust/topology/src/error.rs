// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Error types for topology operations.

use crate::keys::TopologyKey;

/// Result type alias for topology operations.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors that can occur during topology operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A referenced topology entity was not found in the arena.
    #[error("topology entity not found: {0:?}")]
    NotFound(TopologyKey),

    /// Edges in a wire are not connected end-to-end.
    #[error("wire edges are not connected: edge {0} endpoint does not match edge {1} startpoint")]
    DisconnectedWire(usize, usize),

    /// A wire must have at least one edge.
    #[error("wire must have at least one edge")]
    EmptyWire,

    /// A face must have an outer boundary wire.
    #[error("face outer wire has fewer than 3 edges")]
    DegenerateFace,

    /// A shell must have at least one face.
    #[error("shell must have at least one face")]
    EmptyShell,

    /// The shell is not closed (has boundary edges).
    #[error("shell is not closed: {0} boundary edges remain")]
    OpenShell(usize),

    /// A cell complex must have at least one cell.
    #[error("cell complex must have at least one cell")]
    EmptyCellComplex,

    /// Vertex key not found in the arena.
    #[error("vertex not found: {0:?}")]
    VertexNotFound(crate::keys::VertexKey),

    /// Edge key not found in the arena.
    #[error("edge not found: {0:?}")]
    EdgeNotFound(crate::keys::EdgeKey),

    /// Wire key not found in the arena.
    #[error("wire not found: {0:?}")]
    WireNotFound(crate::keys::WireKey),

    /// Face key not found in the arena.
    #[error("face not found: {0:?}")]
    FaceNotFound(crate::keys::FaceKey),

    /// Shell key not found in the arena.
    #[error("shell not found: {0:?}")]
    ShellNotFound(crate::keys::ShellKey),

    /// Cell key not found in the arena.
    #[error("cell not found: {0:?}")]
    CellNotFound(crate::keys::CellKey),

    /// Serialization/deserialization error.
    #[error("serialization error: {0}")]
    Serialization(String),
}
