// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Tauri commands for IFC-Lite Desktop
//!
//! These commands provide the bridge between the TypeScript frontend
//! and the native Rust IFC processing libraries.

pub mod cache;
pub mod file_dialog;
pub mod ifc;
mod types;

pub use types::*;
