//! IFC-Lite Geometry Processing
//!
//! Efficient geometry processing for IFC models using earcutr triangulation
//! and nalgebra for transformations.

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
pub use processors::{ExtrudedAreaSolidProcessor, TriangulatedFaceSetProcessor, MappedItemProcessor, FacetedBrepProcessor};
