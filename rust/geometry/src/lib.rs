//! IFC-Lite Geometry Processing
//!
//! Efficient geometry processing for IFC models using earcutr triangulation
//! and nalgebra for transformations.

pub mod profile;
pub mod extrusion;
pub mod mesh;
pub mod error;

pub use error::{Error, Result};
pub use mesh::Mesh;
pub use profile::{Profile2D, ProfileType};
pub use extrusion::extrude_profile;
