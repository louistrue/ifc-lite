// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Shared IFC processing pipeline and types.
//!
//! This crate extracts the core processing logic so it can be used by both
//! the HTTP server and the native FFI library.

mod processor;
mod types;

pub use processor::{
    process_geometry, process_geometry_filtered, OpeningFilterMode, ProcessingResult,
};
pub use types::mesh::MeshData;
pub use types::response::{CoordinateInfo, ModelMetadata, ParseResponse, ProcessingStats};
