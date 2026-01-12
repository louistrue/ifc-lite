// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! # IFC-Lite Core Parser
//!
//! High-performance STEP/IFC parser built with [nom](https://docs.rs/nom).
//! Provides zero-copy tokenization and fast entity scanning for IFC files.
//!
//! ## Overview
//!
//! This crate provides the core parsing functionality for IFC-Lite:
//!
//! - **STEP Tokenization**: Zero-copy parsing of STEP file format
//! - **Entity Scanning**: SIMD-accelerated entity discovery using [memchr](https://docs.rs/memchr)
//! - **Lazy Decoding**: On-demand attribute parsing for memory efficiency
//! - **Streaming Parser**: Event-based parsing for large files
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use ifc_lite_core::{EntityScanner, parse_entity, IfcType};
//!
//! // Scan for entities
//! let content = r#"#1=IFCPROJECT('guid',$,$,$,$,$,$,$,$);"#;
//! let mut scanner = EntityScanner::new(content);
//!
//! while let Some((id, type_name, start, end)) = scanner.next_entity() {
//!     println!("Found entity #{}: {}", id, type_name);
//! }
//!
//! // Parse individual entity
//! let input = "#123=IFCWALL('guid',$,$,$,$,$,$,$);";
//! let (id, ifc_type, attrs) = parse_entity(input).unwrap();
//! assert_eq!(ifc_type, IfcType::IfcWall);
//! ```
//!
//! ## Streaming Parser
//!
//! For large files, use the streaming parser to process entities in batches:
//!
//! ```rust,ignore
//! use ifc_lite_core::{parse_stream, StreamConfig, ParseEvent};
//!
//! let config = StreamConfig::default();
//! for event in parse_stream(content, config) {
//!     match event {
//!         ParseEvent::Entity { id, type_name, .. } => {
//!             println!("Entity #{}: {}", id, type_name);
//!         }
//!         ParseEvent::Progress { percent, .. } => {
//!             println!("Progress: {:.1}%", percent);
//!         }
//!         _ => {}
//!     }
//! }
//! ```
//!
//! ## Performance
//!
//! - **Tokenization**: ~1,259 MB/s throughput
//! - **Entity scanning**: ~650 MB/s with SIMD acceleration
//! - **Number parsing**: 10x faster than std using [lexical-core](https://docs.rs/lexical-core)
//!
//! ## Feature Flags
//!
//! - `serde`: Enable serialization support for parsed data

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
