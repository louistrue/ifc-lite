// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! # IFC-Lite Geometry Processing
//!
//! Efficient geometry processing for IFC models using [earcutr](https://docs.rs/earcutr)
//! triangulation and [nalgebra](https://docs.rs/nalgebra) for transformations.
//!
//! ## Overview
//!
//! This crate transforms IFC geometry representations into GPU-ready triangle meshes:
//!
//! - **Profile Handling**: Extract and process 2D profiles (rectangle, circle, arbitrary)
//! - **Extrusion**: Generate 3D meshes from extruded profiles
//! - **Triangulation**: Polygon triangulation with hole support via earcutr
//! - **CSG Operations**: Boolean clipping for wall openings
//! - **Mesh Processing**: Normal calculation and coordinate transformations
//!
//! ## Supported Geometry Types
//!
//! | Type | Status | Description |
//! |------|--------|-------------|
//! | `IfcExtrudedAreaSolid` | Full | Most common - extruded profiles |
//! | `IfcFacetedBrep` | Full | Boundary representation meshes |
//! | `IfcTriangulatedFaceSet` | Full | Pre-triangulated (IFC4) |
//! | `IfcBooleanClippingResult` | Partial | CSG difference operations |
//! | `IfcMappedItem` | Full | Instanced geometry |
//! | `IfcSweptDiskSolid` | Full | Pipe/tube geometry |
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use ifc_lite_geometry::{
//!     Profile2D, extrude_profile, triangulate_polygon,
//!     Point2, Point3, Vector3
//! };
//!
//! // Create a rectangular profile
//! let profile = Profile2D::rectangle(2.0, 1.0);
//!
//! // Extrude to 3D
//! let direction = Vector3::new(0.0, 0.0, 1.0);
//! let mesh = extrude_profile(&profile, direction, 3.0)?;
//!
//! println!("Generated {} triangles", mesh.triangle_count());
//! ```
//!
//! ## Geometry Router
//!
//! Use the [`GeometryRouter`] to automatically dispatch entities to appropriate processors:
//!
//! ```rust,ignore
//! use ifc_lite_geometry::{GeometryRouter, GeometryProcessor};
//!
//! let router = GeometryRouter::new();
//!
//! // Process entity
//! if let Some(mesh) = router.process(&decoder, &entity)? {
//!     renderer.add_mesh(mesh);
//! }
//! ```
//!
//! ## Performance
//!
//! - **Simple extrusions**: ~2000 entities/sec
//! - **Complex Breps**: ~200 entities/sec
//! - **Boolean operations**: ~20 entities/sec

pub mod profile;
pub mod extrusion;
pub mod mesh;
pub mod csg;
pub mod error;
pub mod triangulation;
pub mod router;
pub mod profiles;
pub mod processors;

// Re-export nalgebra types for convenience
pub use nalgebra::{Point2, Point3, Vector2, Vector3};

pub use error::{Error, Result};
pub use mesh::Mesh;
pub use profile::{Profile2D, ProfileType};
pub use extrusion::extrude_profile;
pub use csg::{Plane, Triangle, ClippingProcessor, calculate_normals};
pub use triangulation::triangulate_polygon;
pub use router::{GeometryRouter, GeometryProcessor};
pub use profiles::ProfileProcessor;
pub use processors::{ExtrudedAreaSolidProcessor, TriangulatedFaceSetProcessor, MappedItemProcessor, FacetedBrepProcessor, BooleanClippingProcessor, SweptDiskSolidProcessor};
