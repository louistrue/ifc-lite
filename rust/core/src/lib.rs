//! IFC-Lite Core Parser
//!
//! High-performance STEP/IFC parser built with nom.
//! Provides zero-copy tokenization and fast entity scanning.

pub mod parser;
pub mod schema;
pub mod error;

pub use error::{Error, Result};
pub use parser::{Token, EntityScanner, parse_entity};
pub use schema::IfcType;
