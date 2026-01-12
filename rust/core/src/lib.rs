//! IFC-Lite Core Parser
//!
//! High-performance STEP/IFC parser built with nom.
//! Provides zero-copy tokenization and fast entity scanning.

pub mod parser;
pub mod schema;
pub mod error;
pub mod streaming;
pub mod decoder;
pub mod schema_gen;

pub use error::{Error, Result};
pub use parser::{Token, EntityScanner, parse_entity};
pub use schema::{IfcType, has_geometry_by_name};
pub use streaming::{ParseEvent, StreamConfig, parse_stream};
pub use decoder::{EntityDecoder, EntityIndex, build_entity_index};
pub use schema_gen::{AttributeValue, DecodedEntity, IfcSchema, GeometryCategory, ProfileCategory};
