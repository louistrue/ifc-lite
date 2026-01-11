use thiserror::Error;

/// Result type for geometry operations
pub type Result<T> = std::result::Result<T, Error>;

/// Errors that can occur during geometry processing
#[derive(Error, Debug)]
pub enum Error {
    #[error("Triangulation failed: {0}")]
    TriangulationError(String),

    #[error("Invalid profile: {0}")]
    InvalidProfile(String),

    #[error("Invalid extrusion parameters: {0}")]
    InvalidExtrusion(String),

    #[error("Empty mesh: {0}")]
    EmptyMesh(String),

    #[error("Core parser error: {0}")]
    CoreError(#[from] ifc_lite_core::Error),
}
