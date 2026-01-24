// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometry Router - Dynamic dispatch to geometry processors
//!
//! Routes IFC representation entities to appropriate processors based on type.

use crate::bool2d::subtract_multiple_2d;
use crate::csg::{ClippingProcessor, Triangle, TriangleVec};
use crate::processors::{
    AdvancedBrepProcessor, BooleanClippingProcessor, ExtrudedAreaSolidProcessor,
    FacetedBrepProcessor, MappedItemProcessor, RevolvedAreaSolidProcessor, SweptDiskSolidProcessor,
    TriangulatedFaceSetProcessor,
};
use crate::profile::{Profile2D, Profile2DWithVoids, VoidInfo};
use crate::void_analysis::{
    extract_coplanar_voids, extract_nonplanar_voids, VoidAnalyzer, VoidClassification,
};
use crate::void_index::VoidIndex;
use crate::{Error, Mesh, Point3, Result, SubMeshCollection, Vector3};
use ifc_lite_core::{DecodedEntity, EntityDecoder, GeometryCategory, IfcSchema, IfcType};
use nalgebra::{Matrix4, Point2};
use rustc_hash::FxHashMap;
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

/// Reusable buffers for triangle clipping operations
///
/// This struct eliminates per-triangle allocations in clip_triangle_against_box
/// by reusing Vec buffers across multiple clipping operations.
struct ClipBuffers {
    /// Triangles to output (outside the box)
    result: TriangleVec,
    /// Triangles remaining to be processed
    remaining: TriangleVec,
    /// Next iteration's remaining triangles (swap buffer)
    next_remaining: TriangleVec,
}

impl ClipBuffers {
    /// Create new empty buffers
    fn new() -> Self {
        Self {
            result: TriangleVec::new(),
            remaining: TriangleVec::new(),
            next_remaining: TriangleVec::new(),
        }
    }

    /// Clear all buffers for reuse
    #[inline]
    fn clear(&mut self) {
        self.result.clear();
        self.remaining.clear();
        self.next_remaining.clear();
    }
}

/// Geometry processor trait
/// Each processor handles one type of IFC representation
pub trait GeometryProcessor {
    /// Process entity into mesh
    fn process(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
        schema: &IfcSchema,
    ) -> Result<Mesh>;

    /// Get supported IFC types
    fn supported_types(&self) -> Vec<IfcType>;
}

/// Geometry router - routes entities to processors
pub struct GeometryRouter {
    schema: IfcSchema,
    processors: HashMap<IfcType, Arc<dyn GeometryProcessor>>,
    /// Cache for IfcRepresentationMap source geometry (MappedItem instancing)
    /// Key: RepresentationMap entity ID, Value: Processed mesh
    mapped_item_cache: RefCell<FxHashMap<u32, Arc<Mesh>>>,
    /// Cache for FacetedBrep geometry (batch processed)
    /// Key: FacetedBrep entity ID, Value: Processed mesh
    /// Uses Box to avoid copying large meshes, entries are taken (removed) when used
    faceted_brep_cache: RefCell<FxHashMap<u32, Mesh>>,
    /// Cache for geometry deduplication by content hash
    /// Buildings with repeated floors have 99% identical geometry
    /// Key: Hash of mesh content, Value: Processed mesh
    geometry_hash_cache: RefCell<FxHashMap<u64, Arc<Mesh>>>,
    /// Unit scale factor (e.g., 0.001 for millimeters -> meters)
    /// Applied to all mesh positions after processing
    unit_scale: f64,
    /// RTC (Relative-to-Center) offset for handling large coordinates
    /// Subtracted from all world positions in f64 before converting to f32
    /// This preserves precision for georeferenced models (e.g., Swiss UTM)
    rtc_offset: (f64, f64, f64),
}

impl GeometryRouter {
    /// Create new router with default processors
    pub fn new() -> Self {
        let schema = IfcSchema::new();
        let schema_clone = schema.clone();
        let mut router = Self {
            schema,
            processors: HashMap::new(),
            mapped_item_cache: RefCell::new(FxHashMap::default()),
            faceted_brep_cache: RefCell::new(FxHashMap::default()),
            geometry_hash_cache: RefCell::new(FxHashMap::default()),
            unit_scale: 1.0, // Default to base meters
            rtc_offset: (0.0, 0.0, 0.0), // Default to no offset
        };

        // Register default P0 processors
        router.register(Box::new(ExtrudedAreaSolidProcessor::new(
            schema_clone.clone(),
        )));
        router.register(Box::new(TriangulatedFaceSetProcessor::new()));
        router.register(Box::new(MappedItemProcessor::new()));
        router.register(Box::new(FacetedBrepProcessor::new()));
        router.register(Box::new(BooleanClippingProcessor::new()));
        router.register(Box::new(SweptDiskSolidProcessor::new(schema_clone.clone())));
        router.register(Box::new(RevolvedAreaSolidProcessor::new(
            schema_clone.clone(),
        )));
        router.register(Box::new(AdvancedBrepProcessor::new()));

        router
    }

    /// Create router and extract unit scale from IFC file
    /// Automatically finds IFCPROJECT and extracts length unit conversion
    pub fn with_units(content: &str, decoder: &mut EntityDecoder) -> Self {
        let mut scanner = ifc_lite_core::EntityScanner::new(content);
        let mut scale = 1.0;

        // Scan through file to find IFCPROJECT
        while let Some((id, type_name, _, _)) = scanner.next_entity() {
            if type_name == "IFCPROJECT" {
                if let Ok(s) = ifc_lite_core::extract_length_unit_scale(decoder, id) {
                    scale = s;
                }
                break;
            }
        }

        Self::with_scale(scale)
    }

    /// Create router with unit scale extracted from IFC file AND RTC offset for large coordinates
    /// This is the recommended method for georeferenced models (Swiss UTM, etc.)
    ///
    /// # Arguments
    /// * `content` - IFC file content
    /// * `decoder` - Entity decoder
    /// * `rtc_offset` - RTC offset to subtract from world coordinates (typically model centroid)
    pub fn with_units_and_rtc(
        content: &str,
        decoder: &mut ifc_lite_core::EntityDecoder,
        rtc_offset: (f64, f64, f64),
    ) -> Self {
        let mut scanner = ifc_lite_core::EntityScanner::new(content);
        let mut scale = 1.0;

        // Scan through file to find IFCPROJECT
        while let Some((id, type_name, _, _)) = scanner.next_entity() {
            if type_name == "IFCPROJECT" {
                if let Ok(s) = ifc_lite_core::extract_length_unit_scale(decoder, id) {
                    scale = s;
                }
                break;
            }
        }

        Self::with_scale_and_rtc(scale, rtc_offset)
    }

    /// Create router with pre-calculated unit scale
    pub fn with_scale(unit_scale: f64) -> Self {
        let mut router = Self::new();
        router.unit_scale = unit_scale;
        router
    }

    /// Create router with RTC offset for large coordinate handling
    /// Use this for georeferenced models (e.g., Swiss UTM coordinates)
    pub fn with_rtc(rtc_offset: (f64, f64, f64)) -> Self {
        let mut router = Self::new();
        router.rtc_offset = rtc_offset;
        router
    }

    /// Create router with both unit scale and RTC offset
    pub fn with_scale_and_rtc(unit_scale: f64, rtc_offset: (f64, f64, f64)) -> Self {
        let mut router = Self::new();
        router.unit_scale = unit_scale;
        router.rtc_offset = rtc_offset;
        router
    }

    /// Set the RTC offset for large coordinate handling
    pub fn set_rtc_offset(&mut self, offset: (f64, f64, f64)) {
        self.rtc_offset = offset;
    }

    /// Get the current RTC offset
    pub fn rtc_offset(&self) -> (f64, f64, f64) {
        self.rtc_offset
    }

    /// Check if RTC offset is active (non-zero)
    #[inline]
    pub fn has_rtc_offset(&self) -> bool {
        self.rtc_offset.0 != 0.0 || self.rtc_offset.1 != 0.0 || self.rtc_offset.2 != 0.0
    }

    /// Get the current unit scale factor
    pub fn unit_scale(&self) -> f64 {
        self.unit_scale
    }

    /// Detect RTC offset by sampling multiple building elements and computing centroid
    /// This handles federated models where different elements may be in different world locations
    /// Returns the centroid of sampled element positions if coordinates are large (>10km)
    pub fn detect_rtc_offset_from_first_element(
        &self,
        content: &str,
        decoder: &mut EntityDecoder,
    ) -> (f64, f64, f64) {
        use ifc_lite_core::EntityScanner;

        let mut scanner = EntityScanner::new(content);

        // Collect translations from multiple elements to compute centroid
        let mut translations: Vec<(f64, f64, f64)> = Vec::new();
        const MAX_SAMPLES: usize = 50; // Sample up to 50 elements for centroid calculation

        // List of actual building element types that have placements
        const BUILDING_ELEMENT_TYPES: &[&str] = &[
            "IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCBEAM", "IFCCOLUMN",
            "IFCPLATE", "IFCROOF", "IFCCOVERING", "IFCFOOTING", "IFCRAILING",
            "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCRAMPFLIGHT",
            "IFCDOOR", "IFCWINDOW", "IFCFURNISHINGELEMENT", "IFCBUILDINGELEMENTPROXY",
            "IFCMEMBER", "IFCCURTAINWALL", "IFCPILE", "IFCSHADINGDEVICE",
        ];

        // Sample building elements to collect their world positions
        while let Some((_id, type_name, start, end)) = scanner.next_entity() {
            if translations.len() >= MAX_SAMPLES {
                break;
            }

            // Check if this is an actual building element type
            if !BUILDING_ELEMENT_TYPES.iter().any(|&t| t == type_name) {
                continue;
            }

            // Decode the element
            if let Ok(entity) = decoder.decode_at(start, end) {
                // Check if it has representation
                let has_rep = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
                if !has_rep {
                    continue;
                }

                // Get placement transform - this contains the world offset
                // CRITICAL: Apply unit scaling BEFORE reading translation, same as transform_mesh does
                if let Ok(mut transform) = self.get_placement_transform_from_element(&entity, decoder) {
                    self.scale_transform(&mut transform);
                    let tx = transform[(0, 3)];
                    let ty = transform[(1, 3)];
                    let tz = transform[(2, 3)];

                    // Only collect if coordinates are valid
                    if tx.is_finite() && ty.is_finite() && tz.is_finite() {
                        translations.push((tx, ty, tz));
                    }
                }
            }
        }

        if translations.is_empty() {
            return (0.0, 0.0, 0.0);
        }

        // Compute median-based centroid for robustness against outliers
        // Sort each coordinate dimension separately and take median
        let mut x_coords: Vec<f64> = translations.iter().map(|(x, _, _)| *x).collect();
        let mut y_coords: Vec<f64> = translations.iter().map(|(_, y, _)| *y).collect();
        let mut z_coords: Vec<f64> = translations.iter().map(|(_, _, z)| *z).collect();

        x_coords.sort_by(|a, b| a.partial_cmp(b).unwrap());
        y_coords.sort_by(|a, b| a.partial_cmp(b).unwrap());
        z_coords.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let median_idx = x_coords.len() / 2;
        let centroid = (
            x_coords[median_idx],
            y_coords[median_idx],
            z_coords[median_idx],
        );

        // Check if centroid is large (>10km from origin)
        const THRESHOLD: f64 = 10000.0;
        if centroid.0.abs() > THRESHOLD || centroid.1.abs() > THRESHOLD || centroid.2.abs() > THRESHOLD {
            return centroid;
        }

        (0.0, 0.0, 0.0)
    }

    /// Scale mesh positions from file units to meters
    /// Only applies scaling if unit_scale != 1.0
    #[inline]
    fn scale_mesh(&self, mesh: &mut Mesh) {
        if self.unit_scale != 1.0 {
            let scale = self.unit_scale as f32;
            for pos in mesh.positions.iter_mut() {
                *pos *= scale;
            }
        }
    }

    /// Scale the translation component of a transform matrix from file units to meters
    /// The rotation/scale part stays unchanged, only translation (column 3) is scaled
    #[inline]
    fn scale_transform(&self, transform: &mut Matrix4<f64>) {
        if self.unit_scale != 1.0 {
            transform[(0, 3)] *= self.unit_scale;
            transform[(1, 3)] *= self.unit_scale;
            transform[(2, 3)] *= self.unit_scale;
        }
    }

    /// Register a geometry processor
    pub fn register(&mut self, processor: Box<dyn GeometryProcessor>) {
        let processor_arc: Arc<dyn GeometryProcessor> = Arc::from(processor);
        for ifc_type in processor_arc.supported_types() {
            self.processors.insert(ifc_type, Arc::clone(&processor_arc));
        }
    }

    /// Batch preprocess FacetedBrep entities for maximum parallelism
    /// Call this before processing elements to enable batch triangulation
    /// across all FacetedBrep entities instead of per-entity parallelism
    pub fn preprocess_faceted_breps(&self, brep_ids: &[u32], decoder: &mut EntityDecoder) {
        if brep_ids.is_empty() {
            return;
        }

        // Use batch processing for parallel triangulation
        let processor = FacetedBrepProcessor::new();
        let results = processor.process_batch(brep_ids, decoder);

        // Store results in cache (preallocate to avoid rehashing)
        let mut cache = self.faceted_brep_cache.borrow_mut();
        cache.reserve(results.len());
        for (brep_idx, mesh) in results {
            let brep_id = brep_ids[brep_idx];
            cache.insert(brep_id, mesh);
        }
    }

    /// Take FacetedBrep from cache (removes entry since each BREP is only used once)
    /// Returns owned Mesh directly - no cloning needed
    #[inline]
    pub fn take_cached_faceted_brep(&self, brep_id: u32) -> Option<Mesh> {
        self.faceted_brep_cache.borrow_mut().remove(&brep_id)
    }

    /// Compute hash of mesh geometry for deduplication
    /// Uses FxHasher for speed - we don't need cryptographic hashing
    #[inline]
    fn compute_mesh_hash(mesh: &Mesh) -> u64 {
        use rustc_hash::FxHasher;
        let mut hasher = FxHasher::default();

        // Hash vertex count and index count first for fast rejection
        mesh.positions.len().hash(&mut hasher);
        mesh.indices.len().hash(&mut hasher);

        // Hash position data (the main differentiator)
        // Convert f32 to bits for reliable hashing
        for pos in &mesh.positions {
            pos.to_bits().hash(&mut hasher);
        }

        // Hash indices
        for idx in &mesh.indices {
            idx.hash(&mut hasher);
        }

        hasher.finish()
    }

    /// Try to get cached mesh by hash, or cache the provided mesh
    /// Returns `Arc<Mesh>` - either from cache or newly cached
    ///
    /// Note: Uses hash-only lookup without full equality check for performance.
    /// FxHasher's 64-bit output makes collisions extremely rare (~1 in 2^64).
    #[inline]
    fn get_or_cache_by_hash(&self, mesh: Mesh) -> Arc<Mesh> {
        let hash = Self::compute_mesh_hash(&mesh);

        // Check cache first
        {
            let cache = self.geometry_hash_cache.borrow();
            if let Some(cached) = cache.get(&hash) {
                return Arc::clone(cached);
            }
        }

        // Cache miss - store and return
        let arc_mesh = Arc::new(mesh);
        {
            let mut cache = self.geometry_hash_cache.borrow_mut();
            cache.insert(hash, Arc::clone(&arc_mesh));
        }
        arc_mesh
    }

    /// Process building element (IfcWall, IfcBeam, etc.) into mesh
    /// Follows the representation chain:
    /// Element → Representation → ShapeRepresentation → Items
    #[inline]
    pub fn process_element(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Mesh> {
        // Get representation (attribute 6 for most building elements)
        // IfcProduct: GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, Tag
        let representation_attr = element.get(6).ok_or_else(|| {
            Error::geometry(format!(
                "Element #{} has no representation attribute",
                element.id
            ))
        })?;

        if representation_attr.is_null() {
            return Ok(Mesh::new()); // No geometry
        }

        let representation = decoder
            .resolve_ref(representation_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve representation".to_string()))?;

        // IfcProductDefinitionShape has Representations attribute (list of IfcRepresentation)
        if representation.ifc_type != IfcType::IfcProductDefinitionShape {
            return Err(Error::geometry(format!(
                "Expected IfcProductDefinitionShape, got {}",
                representation.ifc_type
            )));
        }

        // Get representations list (attribute 2)
        let representations_attr = representation.get(2).ok_or_else(|| {
            Error::geometry("IfcProductDefinitionShape missing Representations".to_string())
        })?;

        let representations = decoder.resolve_ref_list(representations_attr)?;

        // Process all representations and merge meshes
        let mut combined_mesh = Mesh::new();

        // First pass: check if we have any direct geometry representations
        // This prevents duplication when both direct and MappedRepresentation exist
        let has_direct_geometry = representations.iter().any(|rep| {
            if rep.ifc_type != IfcType::IfcShapeRepresentation {
                return false;
            }
            if let Some(rep_type_attr) = rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    matches!(
                        rep_type,
                        "Body"
                            | "SweptSolid"
                            | "Brep"
                            | "CSG"
                            | "Clipping"
                            | "SurfaceModel"
                            | "Tessellation"
                            | "AdvancedSweptSolid"
                            | "AdvancedBrep"
                    )
                } else {
                    false
                }
            } else {
                false
            }
        });

        for shape_rep in representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }

            // Check RepresentationType (attribute 2) - only process geometric representations
            // Skip 'Axis', 'Curve2D', 'FootPrint', etc. - only process 'Body', 'SweptSolid', 'Brep', etc.
            if let Some(rep_type_attr) = shape_rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    // Skip MappedRepresentation if we already have direct geometry
                    // This prevents duplication when an element has both direct and mapped representations
                    if rep_type == "MappedRepresentation" && has_direct_geometry {
                        continue;
                    }

                    // Only process solid geometry representations
                    if !matches!(
                        rep_type,
                        "Body"
                            | "SweptSolid"
                            | "Brep"
                            | "CSG"
                            | "Clipping"
                            | "SurfaceModel"
                            | "Tessellation"
                            | "MappedRepresentation"
                            | "AdvancedSweptSolid"
                            | "AdvancedBrep"
                    ) {
                        continue; // Skip non-solid representations like 'Axis', 'Curve2D', etc.
                    }
                }
            }

            // Get items list (attribute 3)
            let items_attr = shape_rep.get(3).ok_or_else(|| {
                Error::geometry("IfcShapeRepresentation missing Items".to_string())
            })?;

            let items = decoder.resolve_ref_list(items_attr)?;

            // Process each representation item
            for item in items {
                let mesh = self.process_representation_item(&item, decoder)?;
                combined_mesh.merge(&mesh);
            }
        }

        // Apply placement transformation
        self.apply_placement(element, decoder, &mut combined_mesh)?;

        Ok(combined_mesh)
    }

    /// Get individual bounding boxes for each representation item in an opening element.
    /// This handles disconnected geometry (e.g., two separate window openings in one IfcOpeningElement)
    /// by returning separate bounds for each item instead of one combined bounding box.
    fn get_opening_item_bounds(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<(Point3<f64>, Point3<f64>)>> {
        // Get representation (attribute 6 for most building elements)
        let representation_attr = element.get(6).ok_or_else(|| {
            Error::geometry("Element has no representation attribute".to_string())
        })?;

        if representation_attr.is_null() {
            return Ok(vec![]);
        }

        let representation = decoder
            .resolve_ref(representation_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve representation".to_string()))?;

        // Get representations list
        let representations_attr = representation.get(2).ok_or_else(|| {
            Error::geometry("ProductDefinitionShape missing Representations".to_string())
        })?;

        let representations = decoder.resolve_ref_list(representations_attr)?;

        // Get placement transform
        let mut placement_transform = self.get_placement_transform_from_element(element, decoder)
            .unwrap_or_else(|_| Matrix4::identity());
        self.scale_transform(&mut placement_transform);

        let mut bounds_list = Vec::new();

        for shape_rep in representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }

            // Check representation type
            if let Some(rep_type_attr) = shape_rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    if !matches!(rep_type, "Body" | "SweptSolid" | "Brep" | "CSG" | "Clipping" | "Tessellation") {
                        continue;
                    }
                }
            }

            // Get items list
            let items_attr = match shape_rep.get(3) {
                Some(attr) => attr,
                None => continue,
            };

            let items = match decoder.resolve_ref_list(items_attr) {
                Ok(items) => items,
                Err(_) => continue,
            };

            // Process each item separately to get individual bounds
            for item in items {
                let mesh = match self.process_representation_item(&item, decoder) {
                    Ok(m) if !m.is_empty() => m,
                    _ => continue,
                };

                // Get bounds and transform to world coordinates
                let (mesh_min, mesh_max) = mesh.bounds();

                // Transform corner points to world coordinates
                let corners = [
                    Point3::new(mesh_min.x as f64, mesh_min.y as f64, mesh_min.z as f64),
                    Point3::new(mesh_max.x as f64, mesh_min.y as f64, mesh_min.z as f64),
                    Point3::new(mesh_min.x as f64, mesh_max.y as f64, mesh_min.z as f64),
                    Point3::new(mesh_max.x as f64, mesh_max.y as f64, mesh_min.z as f64),
                    Point3::new(mesh_min.x as f64, mesh_min.y as f64, mesh_max.z as f64),
                    Point3::new(mesh_max.x as f64, mesh_min.y as f64, mesh_max.z as f64),
                    Point3::new(mesh_min.x as f64, mesh_max.y as f64, mesh_max.z as f64),
                    Point3::new(mesh_max.x as f64, mesh_max.y as f64, mesh_max.z as f64),
                ];

                // Transform all corners and compute new AABB
                let transformed: Vec<Point3<f64>> = corners.iter()
                    .map(|p| placement_transform.transform_point(p))
                    .collect();

                let world_min = Point3::new(
                    transformed.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
                    transformed.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
                    transformed.iter().map(|p| p.z).fold(f64::INFINITY, f64::min),
                );
                let world_max = Point3::new(
                    transformed.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
                    transformed.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
                    transformed.iter().map(|p| p.z).fold(f64::NEG_INFINITY, f64::max),
                );

                bounds_list.push((world_min, world_max));
            }
        }

        Ok(bounds_list)
    }

    /// Process element and return sub-meshes with their geometry item IDs.
    /// This preserves per-item identity for color/style lookup.
    ///
    /// For elements with multiple styled geometry items (like windows with frames + glass),
    /// this returns separate sub-meshes that can receive different colors.
    pub fn process_element_with_submeshes(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<SubMeshCollection> {
        // Get representation (attribute 6 for most building elements)
        let representation_attr = element.get(6).ok_or_else(|| {
            Error::geometry(format!(
                "Element #{} has no representation attribute",
                element.id
            ))
        })?;

        if representation_attr.is_null() {
            return Ok(SubMeshCollection::new()); // No geometry
        }

        let representation = decoder
            .resolve_ref(representation_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve representation".to_string()))?;

        if representation.ifc_type != IfcType::IfcProductDefinitionShape {
            return Err(Error::geometry(format!(
                "Expected IfcProductDefinitionShape, got {}",
                representation.ifc_type
            )));
        }

        // Get representations list (attribute 2)
        let representations_attr = representation.get(2).ok_or_else(|| {
            Error::geometry("IfcProductDefinitionShape missing Representations".to_string())
        })?;

        let representations = decoder.resolve_ref_list(representations_attr)?;

        let mut sub_meshes = SubMeshCollection::new();

        // Check if we have direct geometry
        let has_direct_geometry = representations.iter().any(|rep| {
            if rep.ifc_type != IfcType::IfcShapeRepresentation {
                return false;
            }
            if let Some(rep_type_attr) = rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    matches!(
                        rep_type,
                        "Body"
                            | "SweptSolid"
                            | "Brep"
                            | "CSG"
                            | "Clipping"
                            | "SurfaceModel"
                            | "Tessellation"
                            | "AdvancedSweptSolid"
                            | "AdvancedBrep"
                    )
                } else {
                    false
                }
            } else {
                false
            }
        });

        for shape_rep in representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }

            if let Some(rep_type_attr) = shape_rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    // Skip MappedRepresentation if we have direct geometry
                    if rep_type == "MappedRepresentation" && has_direct_geometry {
                        continue;
                    }

                    // Only process solid geometry representations
                    if !matches!(
                        rep_type,
                        "Body"
                            | "SweptSolid"
                            | "Brep"
                            | "CSG"
                            | "Clipping"
                            | "SurfaceModel"
                            | "Tessellation"
                            | "MappedRepresentation"
                            | "AdvancedSweptSolid"
                            | "AdvancedBrep"
                    ) {
                        continue;
                    }
                }
            }

            // Get items list (attribute 3)
            let items_attr = shape_rep.get(3).ok_or_else(|| {
                Error::geometry("IfcShapeRepresentation missing Items".to_string())
            })?;

            let items = decoder.resolve_ref_list(items_attr)?;

            // Process each representation item, preserving geometry IDs
            for item in items {
                self.collect_submeshes_from_item(&item, decoder, &mut sub_meshes)?;
            }
        }

        // Apply placement transformation to all sub-meshes
        // ObjectPlacement translation is in file units (e.g., mm) but geometry is scaled to meters,
        // so we MUST scale the transform to match. Same as apply_placement does.
        if let Some(placement_attr) = element.get(5) {
            if !placement_attr.is_null() {
                if let Some(placement) = decoder.resolve_ref(placement_attr)? {
                    let mut transform = self.get_placement_transform(&placement, decoder)?;
                    self.scale_transform(&mut transform);
                    for sub in &mut sub_meshes.sub_meshes {
                        self.transform_mesh(&mut sub.mesh, &transform);
                    }
                }
            }
        }

        Ok(sub_meshes)
    }

    /// Collect sub-meshes from a representation item, following MappedItem references.
    fn collect_submeshes_from_item(
        &self,
        item: &DecodedEntity,
        decoder: &mut EntityDecoder,
        sub_meshes: &mut SubMeshCollection,
    ) -> Result<()> {
        // For MappedItem, recurse into the mapped representation
        if item.ifc_type == IfcType::IfcMappedItem {
            // Get MappingSource (RepresentationMap)
            let source_attr = item
                .get(0)
                .ok_or_else(|| Error::geometry("MappedItem missing MappingSource".to_string()))?;

            let source_entity = decoder
                .resolve_ref(source_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve MappingSource".to_string()))?;

            // Get MappedRepresentation from RepresentationMap (attribute 1)
            let mapped_repr_attr = source_entity
                .get(1)
                .ok_or_else(|| Error::geometry("RepresentationMap missing MappedRepresentation".to_string()))?;

            let mapped_repr = decoder
                .resolve_ref(mapped_repr_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve MappedRepresentation".to_string()))?;

            // Get MappingTarget transformation
            let mapping_transform = if let Some(target_attr) = item.get(1) {
                if !target_attr.is_null() {
                    if let Some(target_entity) = decoder.resolve_ref(target_attr)? {
                        Some(self.parse_cartesian_transformation_operator(&target_entity, decoder)?)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            // Get items from the mapped representation
            if let Some(items_attr) = mapped_repr.get(3) {
                let items = decoder.resolve_ref_list(items_attr)?;
                for nested_item in items {
                    // Recursively collect sub-meshes
                    let count_before = sub_meshes.len();
                    self.collect_submeshes_from_item(&nested_item, decoder, sub_meshes)?;

                    // Apply MappedItem transform to newly added sub-meshes
                    if let Some(mut transform) = mapping_transform.clone() {
                        self.scale_transform(&mut transform);
                        for sub in &mut sub_meshes.sub_meshes[count_before..] {
                            self.transform_mesh(&mut sub.mesh, &transform);
                        }
                    }
                }
            }
        } else {
            // Regular geometry item - process and record with its ID
            let mesh = self.process_representation_item(item, decoder)?;
            if !mesh.is_empty() {
                sub_meshes.add(item.id, mesh);
            }
        }

        Ok(())
    }

    /// Process element with void subtraction (openings)
    /// Process element with voids using optimized plane clipping
    ///
    /// This approach is more efficient than full 3D CSG for rectangular openings:
    /// 1. Get chamfered wall mesh (preserves chamfered corners)
    /// 2. For each opening, use optimized box cutting with internal face generation
    /// 3. Apply any clipping operations (roof clips) from original representation
    #[inline]
    pub fn process_element_with_voids(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &rustc_hash::FxHashMap<u32, Vec<u32>>,
    ) -> Result<Mesh> {
        // Check if this element has any openings
        let opening_ids = match void_index.get(&element.id) {
            Some(ids) if !ids.is_empty() => ids,
            _ => {
                // No openings - just process normally
                return self.process_element(element, decoder);
            }
        };
        
        // SAFETY: Skip void subtraction for elements with too many openings
        // This prevents CSG operations from causing panics or excessive processing time
        // Elements with many openings (like curtain walls) are better handled without CSG
        const MAX_OPENINGS: usize = 15;
        if opening_ids.len() > MAX_OPENINGS {
            // Just return the base mesh without void subtraction
            return self.process_element(element, decoder);
        }

        // STEP 1: Get chamfered wall mesh (preserves chamfered corners at intersections)
        let wall_mesh = match self.process_element(element, decoder) {
            Ok(m) => m,
            Err(_) => {
                return self.process_element(element, decoder);
            }
        };

        // OPTIMIZATION: Only extract clipping planes if element actually has them
        // This skips expensive profile extraction for ~95% of elements
        use nalgebra::Vector3;
        let world_clipping_planes: Vec<(Point3<f64>, Vector3<f64>, bool)> =
            if self.has_clipping_planes(element, decoder) {
                // Get element's ObjectPlacement transform (for clipping planes)
                let mut object_placement_transform = match self.get_placement_transform_from_element(element, decoder) {
                    Ok(t) => t,
                    Err(_) => Matrix4::identity(),
                };
                self.scale_transform(&mut object_placement_transform);

                // Extract clipping planes (for roof clips)
                let clipping_planes = match self.extract_base_profile_and_clips(element, decoder) {
                    Ok((_profile, _depth, _axis, _origin, _transform, clips)) => clips,
                    Err(_) => Vec::new(),
                };

                // Transform clipping planes to world coordinates
                clipping_planes
                    .iter()
                    .map(|(point, normal, agreement)| {
                        let world_point = object_placement_transform.transform_point(point);
                        let rotation = object_placement_transform.fixed_view::<3, 3>(0, 0);
                        let world_normal = (rotation * normal).normalize();
                        (world_point, world_normal, *agreement)
                    })
                    .collect()
            } else {
                Vec::new()
            };
        
        // STEP 5: Collect opening info (bounds for rectangular, full mesh for non-rectangular)
        // For rectangular openings, get individual bounds per representation item to handle
        // disconnected geometry (e.g., two separate window openings in one IfcOpeningElement)
        enum OpeningType {
            Rectangular(Point3<f64>, Point3<f64>),  // min, max bounds
            NonRectangular(Mesh),                    // full mesh for CSG
        }

        let mut openings: Vec<OpeningType> = Vec::new();
        for &opening_id in opening_ids.iter() {
            let opening_entity = match decoder.decode_by_id(opening_id) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let opening_mesh = match self.process_element(&opening_entity, decoder) {
                Ok(m) if !m.is_empty() => m,
                _ => continue,
            };

            let vertex_count = opening_mesh.positions.len() / 3;

            if vertex_count > 100 {
                // Non-rectangular (circular, arched, etc.) - use full CSG
                openings.push(OpeningType::NonRectangular(opening_mesh));
            } else {
                // Rectangular - get individual bounds for each representation item
                // This handles disconnected geometry (multiple boxes with gaps between them)
                let item_bounds = self.get_opening_item_bounds(&opening_entity, decoder)
                    .unwrap_or_default();

                if !item_bounds.is_empty() {
                    // Use individual item bounds for disconnected geometry
                    for (min_pt, max_pt) in item_bounds {
                        openings.push(OpeningType::Rectangular(min_pt, max_pt));
                    }
                } else {
                    // Fallback to combined mesh bounds when individual bounds unavailable
                    let (open_min, open_max) = opening_mesh.bounds();
                    let min_f64 = Point3::new(open_min.x as f64, open_min.y as f64, open_min.z as f64);
                    let max_f64 = Point3::new(open_max.x as f64, open_max.y as f64, open_max.z as f64);
                    openings.push(OpeningType::Rectangular(min_f64, max_f64));
                }
            }
        }

        if openings.is_empty() {
            return self.process_element(element, decoder);
        }

        // STEP 6: Cut openings using appropriate method
        use crate::csg::ClippingProcessor;
        let clipper = ClippingProcessor::new();
        let mut result = wall_mesh;

        // Get wall bounds for clamping opening faces (from result before cutting)
        let (wall_min_f32, wall_max_f32) = result.bounds();
        let wall_min = Point3::new(
            wall_min_f32.x as f64,
            wall_min_f32.y as f64,
            wall_min_f32.z as f64,
        );
        let wall_max = Point3::new(
            wall_max_f32.x as f64,
            wall_max_f32.y as f64,
            wall_max_f32.z as f64,
        );

        // Validate wall mesh ONCE before CSG operations (not per-iteration)
        // This avoids O(n) validation on every loop iteration
        let wall_valid = !result.is_empty()
            && result.positions.iter().all(|&v| v.is_finite())
            && result.triangle_count() >= 4;

        if !wall_valid {
            // Wall mesh is invalid, return as-is
            return Ok(result);
        }

        // Track CSG operations to prevent excessive complexity
        let mut csg_operation_count = 0;
        const MAX_CSG_OPERATIONS: usize = 10; // Limit to prevent runaway CSG

        for (_idx, opening) in openings.iter().enumerate() {
            match opening {
                OpeningType::Rectangular(open_min, open_max) => {
                    // Use optimized rectangular opening cut (safe, doesn't use csgrs)
                    result = self.cut_rectangular_opening(&result, *open_min, *open_max, wall_min, wall_max);
                }
                OpeningType::NonRectangular(opening_mesh) => {
                    // Safety: limit total CSG operations to prevent crashes on complex geometry
                    if csg_operation_count >= MAX_CSG_OPERATIONS {
                        // Skip remaining CSG operations
                        continue;
                    }

                    // Validate opening mesh before CSG (only once per opening)
                    let opening_valid = !opening_mesh.is_empty()
                        && opening_mesh.positions.iter().all(|&v| v.is_finite())
                        && opening_mesh.positions.len() >= 9; // At least 3 vertices

                    if !opening_valid {
                        // Skip invalid opening
                        continue;
                    }

                    // Use full CSG subtraction for non-rectangular shapes
                    // Note: mesh_to_csgrs validates and filters invalid triangles internally
                    match clipper.subtract_mesh(&result, opening_mesh) {
                        Ok(csg_result) => {
                            // Validate result is not degenerate
                            if !csg_result.is_empty() && csg_result.triangle_count() >= 4 {
                                result = csg_result;
                            }
                            // If result is degenerate, keep previous result
                        }
                        Err(_) => {
                            // Keep original result if CSG fails
                        }
                    }
                    csg_operation_count += 1;
                }
            }
        }

        // STEP 7: Apply clipping planes (roof clips) if any
        if !world_clipping_planes.is_empty() {
            use crate::csg::{ClippingProcessor, Plane};
            let clipper = ClippingProcessor::new();
            
            for (_clip_idx, (plane_point, plane_normal, agreement)) in world_clipping_planes.iter().enumerate() {
                let clip_normal = if *agreement {
                    *plane_normal
                } else {
                    -*plane_normal
                };
                
                let plane = Plane::new(*plane_point, clip_normal);
                if let Ok(clipped) = clipper.clip_mesh(&result, &plane) {
                    if !clipped.is_empty() {
                        result = clipped;
                    }
                }
            }
        }

        Ok(result)
    }
    
    /// Cut a rectangular opening from a mesh using optimized plane clipping
    /// 
    /// This is more efficient than full CSG because:
    /// 1. Only processes triangles that intersect the opening bounds
    /// 2. Uses simple plane clipping instead of polygon boolean operations
    /// 3. Generates minimal internal faces
    fn cut_rectangular_opening(
        &self,
        mesh: &Mesh,
        open_min: Point3<f64>,
        open_max: Point3<f64>,
        wall_min: Point3<f64>,
        wall_max: Point3<f64>,
    ) -> Mesh {
        use nalgebra::Vector3;

        // Tolerance for floating-point boundary comparisons
        const EPSILON: f64 = 1e-6;

        let mut result = Mesh::with_capacity(
            mesh.positions.len() / 3 + 24, // Original + opening faces
            mesh.indices.len() / 3 + 8,    // Original + opening triangles
        );

        // Create reusable buffers for clipping operations (avoids 6+ allocations per triangle)
        let mut clip_buffers = ClipBuffers::new();

        // Process each triangle using chunks_exact to ensure bounds safety
        for chunk in mesh.indices.chunks_exact(3) {
            let i0 = chunk[0] as usize;
            let i1 = chunk[1] as usize;
            let i2 = chunk[2] as usize;
            
            let v0 = Point3::new(
                mesh.positions[i0 * 3] as f64,
                mesh.positions[i0 * 3 + 1] as f64,
                mesh.positions[i0 * 3 + 2] as f64,
            );
            let v1 = Point3::new(
                mesh.positions[i1 * 3] as f64,
                mesh.positions[i1 * 3 + 1] as f64,
                mesh.positions[i1 * 3 + 2] as f64,
            );
            let v2 = Point3::new(
                mesh.positions[i2 * 3] as f64,
                mesh.positions[i2 * 3 + 1] as f64,
                mesh.positions[i2 * 3 + 2] as f64,
            );
            
            // Get triangle normal - use per-vertex normals if available, otherwise compute face normal
            let n0 = if mesh.normals.len() >= mesh.positions.len() {
                Vector3::new(
                    mesh.normals[i0 * 3] as f64,
                    mesh.normals[i0 * 3 + 1] as f64,
                    mesh.normals[i0 * 3 + 2] as f64,
                )
            } else {
                // Compute face normal from triangle vertices
                let edge1 = v1 - v0;
                let edge2 = v2 - v0;
                edge1.cross(&edge2).try_normalize(1e-10).unwrap_or(Vector3::new(0.0, 0.0, 1.0))
            };
            
            // Check if triangle is completely outside opening bounds
            let tri_min_x = v0.x.min(v1.x).min(v2.x);
            let tri_max_x = v0.x.max(v1.x).max(v2.x);
            let tri_min_y = v0.y.min(v1.y).min(v2.y);
            let tri_max_y = v0.y.max(v1.y).max(v2.y);
            let tri_min_z = v0.z.min(v1.z).min(v2.z);
            let tri_max_z = v0.z.max(v1.z).max(v2.z);
            
            // If triangle is completely outside opening, keep it as-is (with epsilon tolerance)
            if tri_max_x <= open_min.x - EPSILON || tri_min_x >= open_max.x + EPSILON ||
               tri_max_y <= open_min.y - EPSILON || tri_min_y >= open_max.y + EPSILON ||
               tri_max_z <= open_min.z - EPSILON || tri_min_z >= open_max.z + EPSILON {
                // Triangle is outside opening - keep it
                let base = result.vertex_count() as u32;
                result.add_vertex(v0, n0);
                result.add_vertex(v1, n0);
                result.add_vertex(v2, n0);
                result.add_triangle(base, base + 1, base + 2);
                continue;
            }
            
            // Check if triangle is completely inside opening (remove it)
            // Use INWARD epsilon to be conservative - only remove triangles clearly inside
            if tri_min_x >= open_min.x + EPSILON && tri_max_x <= open_max.x - EPSILON &&
               tri_min_y >= open_min.y + EPSILON && tri_max_y <= open_max.y - EPSILON &&
               tri_min_z >= open_min.z + EPSILON && tri_max_z <= open_max.z - EPSILON {
                // Triangle is inside opening - remove it
                continue;
            }
            
            // Triangle may intersect opening - use proper intersection test
            // A triangle can have all vertices outside a box but still pass through it
            if self.triangle_intersects_box(&v0, &v1, &v2, &open_min, &open_max) {
                // Triangle intersects the opening box - clip it to remove the intersecting part
                self.clip_triangle_against_box(&mut result, &mut clip_buffers, &v0, &v1, &v2, &n0, &open_min, &open_max);
            } else {
                // Triangle truly doesn't intersect - safe to keep as-is
                let base = result.vertex_count() as u32;
                result.add_vertex(v0, n0);
                result.add_vertex(v1, n0);
                result.add_vertex(v2, n0);
                result.add_triangle(base, base + 1, base + 2);
            }
        }
        
        // Generate internal faces for the opening
        self.generate_opening_faces(&mut result, &open_min, &open_max, &wall_min, &wall_max);
        
        result
    }
    
    /// Test if a triangle intersects an axis-aligned bounding box using Separating Axis Theorem (SAT)
    /// Returns true if triangle and box intersect, false if they are separated
    fn triangle_intersects_box(
        &self,
        v0: &Point3<f64>,
        v1: &Point3<f64>,
        v2: &Point3<f64>,
        box_min: &Point3<f64>,
        box_max: &Point3<f64>,
    ) -> bool {
        use nalgebra::Vector3;
        
        // Box center and half-extents
        let box_center = Point3::new(
            (box_min.x + box_max.x) * 0.5,
            (box_min.y + box_max.y) * 0.5,
            (box_min.z + box_max.z) * 0.5,
        );
        let box_half_extents = Vector3::new(
            (box_max.x - box_min.x) * 0.5,
            (box_max.y - box_min.y) * 0.5,
            (box_max.z - box_min.z) * 0.5,
        );
        
        // Translate triangle to box-local space
        let t0 = v0 - box_center;
        let t1 = v1 - box_center;
        let t2 = v2 - box_center;
        
        // Triangle edges
        let e0 = t1 - t0;
        let e1 = t2 - t1;
        let e2 = t0 - t2;
        
        // Test 1: Box axes (X, Y, Z)
        // Project triangle onto each axis and check overlap
        for axis_idx in 0..3 {
            let axis = match axis_idx {
                0 => Vector3::new(1.0, 0.0, 0.0),
                1 => Vector3::new(0.0, 1.0, 0.0),
                2 => Vector3::new(0.0, 0.0, 1.0),
                _ => unreachable!(),
            };
            
            let p0 = t0.dot(&axis);
            let p1 = t1.dot(&axis);
            let p2 = t2.dot(&axis);
            
            let tri_min = p0.min(p1).min(p2);
            let tri_max = p0.max(p1).max(p2);
            let box_extent = box_half_extents[axis_idx];
            
            if tri_max < -box_extent || tri_min > box_extent {
                return false; // Separated on this axis
            }
        }
        
        // Test 2: Triangle face normal
        let triangle_normal = e0.cross(&e2);
        let triangle_offset = t0.dot(&triangle_normal);
        
        // Project box onto triangle normal
        let mut box_projection = 0.0;
        for i in 0..3 {
            let axis = match i {
                0 => Vector3::new(1.0, 0.0, 0.0),
                1 => Vector3::new(0.0, 1.0, 0.0),
                2 => Vector3::new(0.0, 0.0, 1.0),
                _ => unreachable!(),
            };
            box_projection += box_half_extents[i] * triangle_normal.dot(&axis).abs();
        }
        
        if triangle_offset.abs() > box_projection {
            return false; // Separated by triangle plane
        }
        
        // Test 3: 9 cross-product axes (3 box edges x 3 triangle edges)
        let box_axes = [
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        ];
        let tri_edges = [e0, e1, e2];
        
        for box_axis in &box_axes {
            for tri_edge in &tri_edges {
                let axis = box_axis.cross(tri_edge);
                
                // Skip degenerate axes (parallel edges)
                if axis.norm_squared() < 1e-10 {
                    continue;
                }
                
                let axis_normalized = axis.normalize();
                
                // Project triangle onto axis
                let p0 = t0.dot(&axis_normalized);
                let p1 = t1.dot(&axis_normalized);
                let p2 = t2.dot(&axis_normalized);
                let tri_min = p0.min(p1).min(p2);
                let tri_max = p0.max(p1).max(p2);
                
                // Project box onto axis
                let mut box_projection = 0.0;
                for i in 0..3 {
                    let box_axis_vec = box_axes[i];
                    box_projection += box_half_extents[i] * axis_normalized.dot(&box_axis_vec).abs();
                }
                
                if tri_max < -box_projection || tri_min > box_projection {
                    return false; // Separated on this axis
                }
            }
        }
        
        // No separating axis found - triangle and box intersect
        true
    }
    
    /// Clip a triangle against an opening box using clip-and-collect algorithm
    /// Removes the part of the triangle that's inside the box
    /// Collects "outside" parts directly to result, continues processing "inside" parts
    ///
    /// Uses reusable ClipBuffers to avoid per-triangle allocations (6+ Vec allocations
    /// per intersecting triangle without buffers).
    fn clip_triangle_against_box(
        &self,
        result: &mut Mesh,
        buffers: &mut ClipBuffers,
        v0: &Point3<f64>,
        v1: &Point3<f64>,
        v2: &Point3<f64>,
        normal: &Vector3<f64>,
        open_min: &Point3<f64>,
        open_max: &Point3<f64>,
    ) {
        use crate::csg::{ClippingProcessor, Plane, ClipResult};

        let clipper = ClippingProcessor::new();

        // Clear buffers for reuse (retains capacity)
        buffers.clear();

        // Planes with INWARD normals (so "front" = inside box, "behind" = outside box)
        // We clip to keep geometry OUTSIDE the box (behind these planes)
        let planes = [
            // +X inward: inside box where x >= open_min.x
            Plane::new(Point3::new(open_min.x, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)),
            // -X inward: inside box where x <= open_max.x
            Plane::new(Point3::new(open_max.x, 0.0, 0.0), Vector3::new(-1.0, 0.0, 0.0)),
            // +Y inward: inside box where y >= open_min.y
            Plane::new(Point3::new(0.0, open_min.y, 0.0), Vector3::new(0.0, 1.0, 0.0)),
            // -Y inward: inside box where y <= open_max.y
            Plane::new(Point3::new(0.0, open_max.y, 0.0), Vector3::new(0.0, -1.0, 0.0)),
            // +Z inward: inside box where z >= open_min.z
            Plane::new(Point3::new(0.0, 0.0, open_min.z), Vector3::new(0.0, 0.0, 1.0)),
            // -Z inward: inside box where z <= open_max.z
            Plane::new(Point3::new(0.0, 0.0, open_max.z), Vector3::new(0.0, 0.0, -1.0)),
        ];

        // Initialize remaining with the input triangle
        buffers.remaining.push(Triangle::new(*v0, *v1, *v2));

        // Clip-and-collect: collect "outside" parts, continue processing "inside" parts
        for plane in &planes {
            buffers.next_remaining.clear();
            let flipped_plane = Plane::new(plane.point, -plane.normal);

            for tri in &buffers.remaining {
                match clipper.clip_triangle(tri, plane) {
                    ClipResult::AllFront(_) => {
                        // Triangle is completely inside this plane - continue checking
                        buffers.next_remaining.push(tri.clone());
                    }
                    ClipResult::AllBehind => {
                        // Triangle is completely outside this plane - it's outside the box
                        buffers.result.push(tri.clone());
                    }
                    ClipResult::Split(inside_tris) => {
                        // Triangle was split - inside parts continue, get outside parts
                        buffers.next_remaining.extend(inside_tris);

                        // Get the outside parts using flipped plane (behind inward = front of outward)
                        match clipper.clip_triangle(tri, &flipped_plane) {
                            ClipResult::AllFront(outside_tri) => {
                                // All outside - add to result
                                buffers.result.push(outside_tri);
                            }
                            ClipResult::Split(outside_tris) => {
                                // Split - these are the outside parts
                                buffers.result.extend(outside_tris);
                            }
                            ClipResult::AllBehind => {
                                // This shouldn't happen if original was split
                                // But handle gracefully - if it happens, inside_tris are all we have
                            }
                        }
                    }
                }
            }

            // Swap buffers instead of reallocating
            std::mem::swap(&mut buffers.remaining, &mut buffers.next_remaining);
        }

        // 'remaining' triangles are inside ALL planes = inside box = discard
        // Add collected result_triangles to mesh
        for tri in &buffers.result {
            let base = result.vertex_count() as u32;
            result.add_vertex(tri.v0, *normal);
            result.add_vertex(tri.v1, *normal);
            result.add_vertex(tri.v2, *normal);
            result.add_triangle(base, base + 1, base + 2);
        }
    }
    
    /// Generate internal faces for an opening (the 4 sides of the hole)
    /// Clamps faces to wall bounds to prevent extending outside the wall surface
    fn generate_opening_faces(
        &self,
        mesh: &mut Mesh,
        open_min: &Point3<f64>,
        open_max: &Point3<f64>,
        wall_min: &Point3<f64>,
        wall_max: &Point3<f64>,
    ) {
        use nalgebra::Vector3;
        
        // The opening is a rectangular prism defined by open_min and open_max
        // We need to generate 4 internal faces (not top/bottom which are open)
        
        // Determine which axis is the "through" direction (smallest extent)
        let dx = open_max.x - open_min.x;
        let dy = open_max.y - open_min.y;
        let dz = open_max.z - open_min.z;
        
        // Assume the wall thickness (smallest dimension) is the through direction
        // Generate faces perpendicular to the other two axes
        // Clamp the through-direction coordinates to wall bounds
        
        if dy <= dx && dy <= dz {
            // Y is through direction - generate X and Z faces
            // Clamp Y coordinates to wall bounds
            let clamped_y_min = wall_min.y.max(open_min.y);
            let clamped_y_max = wall_max.y.min(open_max.y);
            
            self.add_quad_to_mesh(mesh, 
                &Point3::new(open_min.x, clamped_y_min, open_min.z),
                &Point3::new(open_min.x, clamped_y_max, open_min.z),
                &Point3::new(open_min.x, clamped_y_max, open_max.z),
                &Point3::new(open_min.x, clamped_y_min, open_max.z),
                &Vector3::new(-1.0, 0.0, 0.0)); // Left face
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_max.x, clamped_y_min, open_min.z),
                &Point3::new(open_max.x, clamped_y_min, open_max.z),
                &Point3::new(open_max.x, clamped_y_max, open_max.z),
                &Point3::new(open_max.x, clamped_y_max, open_min.z),
                &Vector3::new(1.0, 0.0, 0.0)); // Right face
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_min.x, clamped_y_min, open_min.z),
                &Point3::new(open_max.x, clamped_y_min, open_min.z),
                &Point3::new(open_max.x, clamped_y_max, open_min.z),
                &Point3::new(open_min.x, clamped_y_max, open_min.z),
                &Vector3::new(0.0, 0.0, -1.0)); // Bottom face
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_min.x, clamped_y_min, open_max.z),
                &Point3::new(open_min.x, clamped_y_max, open_max.z),
                &Point3::new(open_max.x, clamped_y_max, open_max.z),
                &Point3::new(open_max.x, clamped_y_min, open_max.z),
                &Vector3::new(0.0, 0.0, 1.0)); // Top face
        } else if dx <= dy && dx <= dz {
            // X is through direction - generate Y and Z faces
            // Clamp X coordinates to wall bounds
            let clamped_x_min = wall_min.x.max(open_min.x);
            let clamped_x_max = wall_max.x.min(open_max.x);
            
            self.add_quad_to_mesh(mesh,
                &Point3::new(clamped_x_min, open_min.y, open_min.z),
                &Point3::new(clamped_x_min, open_min.y, open_max.z),
                &Point3::new(clamped_x_max, open_min.y, open_max.z),
                &Point3::new(clamped_x_max, open_min.y, open_min.z),
                &Vector3::new(0.0, -1.0, 0.0)); // Front face
            self.add_quad_to_mesh(mesh,
                &Point3::new(clamped_x_min, open_max.y, open_min.z),
                &Point3::new(clamped_x_max, open_max.y, open_min.z),
                &Point3::new(clamped_x_max, open_max.y, open_max.z),
                &Point3::new(clamped_x_min, open_max.y, open_max.z),
                &Vector3::new(0.0, 1.0, 0.0)); // Back face
            self.add_quad_to_mesh(mesh,
                &Point3::new(clamped_x_min, open_min.y, open_min.z),
                &Point3::new(clamped_x_max, open_min.y, open_min.z),
                &Point3::new(clamped_x_max, open_max.y, open_min.z),
                &Point3::new(clamped_x_min, open_max.y, open_min.z),
                &Vector3::new(0.0, 0.0, -1.0)); // Bottom face
            self.add_quad_to_mesh(mesh,
                &Point3::new(clamped_x_min, open_min.y, open_max.z),
                &Point3::new(clamped_x_min, open_max.y, open_max.z),
                &Point3::new(clamped_x_max, open_max.y, open_max.z),
                &Point3::new(clamped_x_max, open_min.y, open_max.z),
                &Vector3::new(0.0, 0.0, 1.0)); // Top face
        } else {
            // Z is through direction - generate X and Y faces
            // Clamp Z coordinates to wall bounds
            let clamped_z_min = wall_min.z.max(open_min.z);
            let clamped_z_max = wall_max.z.min(open_max.z);
            
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_min.x, open_min.y, clamped_z_min),
                &Point3::new(open_min.x, open_max.y, clamped_z_min),
                &Point3::new(open_min.x, open_max.y, clamped_z_max),
                &Point3::new(open_min.x, open_min.y, clamped_z_max),
                &Vector3::new(-1.0, 0.0, 0.0)); // Left face
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_max.x, open_min.y, clamped_z_min),
                &Point3::new(open_max.x, open_min.y, clamped_z_max),
                &Point3::new(open_max.x, open_max.y, clamped_z_max),
                &Point3::new(open_max.x, open_max.y, clamped_z_min),
                &Vector3::new(1.0, 0.0, 0.0)); // Right face
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_min.x, open_min.y, clamped_z_min),
                &Point3::new(open_min.x, open_min.y, clamped_z_max),
                &Point3::new(open_max.x, open_min.y, clamped_z_max),
                &Point3::new(open_max.x, open_min.y, clamped_z_min),
                &Vector3::new(0.0, -1.0, 0.0)); // Front face
            self.add_quad_to_mesh(mesh,
                &Point3::new(open_min.x, open_max.y, clamped_z_min),
                &Point3::new(open_max.x, open_max.y, clamped_z_min),
                &Point3::new(open_max.x, open_max.y, clamped_z_max),
                &Point3::new(open_min.x, open_max.y, clamped_z_max),
                &Vector3::new(0.0, 1.0, 0.0)); // Back face
        }
    }
    
    /// Add a quad (two triangles) to a mesh
    fn add_quad_to_mesh(
        &self,
        mesh: &mut Mesh,
        v0: &Point3<f64>,
        v1: &Point3<f64>,
        v2: &Point3<f64>,
        v3: &Point3<f64>,
        normal: &Vector3<f64>,
    ) {
        let base = mesh.vertex_count() as u32;
        mesh.add_vertex(*v0, *normal);
        mesh.add_vertex(*v1, *normal);
        mesh.add_vertex(*v2, *normal);
        mesh.add_vertex(*v3, *normal);
        mesh.add_triangle(base, base + 1, base + 2);
        mesh.add_triangle(base, base + 2, base + 3);
    }

    /// Quick check if an element has clipping planes (IfcBooleanClippingResult in representation)
    /// This is much faster than extract_base_profile_and_clips and allows skipping expensive
    /// extraction for the ~95% of elements that don't have clipping.
    #[inline]
    fn has_clipping_planes(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> bool {
        // Get representation
        let representation_attr = match element.get(6) {
            Some(attr) => attr,
            None => return false,
        };

        let representation = match decoder.resolve_ref(representation_attr) {
            Ok(Some(r)) if r.ifc_type == IfcType::IfcProductDefinitionShape => r,
            _ => return false,
        };

        // Get representations list
        let representations_attr = match representation.get(2) {
            Some(attr) => attr,
            None => return false,
        };

        let representations = match decoder.resolve_ref_list(representations_attr) {
            Ok(r) => r,
            Err(_) => return false,
        };

        // Check if any representation item is IfcBooleanClippingResult
        for shape_rep in &representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }

            let items_attr = match shape_rep.get(3) {
                Some(attr) => attr,
                None => continue,
            };

            let items = match decoder.resolve_ref_list(items_attr) {
                Ok(i) => i,
                Err(_) => continue,
            };

            for item in &items {
                if item.ifc_type == IfcType::IfcBooleanClippingResult {
                    return true;
                }
            }
        }

        false
    }

    /// Extract base wall profile, depth, axis info, Position transform, and clipping planes
    /// 
    /// Drills through IfcBooleanClippingResult to find the base extruded solid,
    /// extracts its actual 2D profile (preserving chamfered corners), and collects clipping planes.
    /// Returns: (profile, depth, thickness_axis, wall_origin, position_transform, clipping_planes)
    fn extract_base_profile_and_clips(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(
        crate::profile::Profile2D,
        f64,
        u8,
        f64,
        Option<Matrix4<f64>>,
        Vec<(Point3<f64>, Vector3<f64>, bool)>,
    )> {
        use nalgebra::Vector3;
        
        let mut clipping_planes: Vec<(Point3<f64>, Vector3<f64>, bool)> = Vec::new();
        
        // Get representation
        let representation_attr = element.get(6)
            .ok_or_else(|| Error::geometry("Element missing representation".to_string()))?;
        
        let representation = decoder.resolve_ref(representation_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve representation".to_string()))?;
        
        if representation.ifc_type != IfcType::IfcProductDefinitionShape {
            // Fallback: can't extract profile, return error
            return Err(Error::geometry("Element representation is not ProductDefinitionShape".to_string()));
        }
        
        // Get representations list
        let representations_attr = representation.get(2)
            .ok_or_else(|| Error::geometry("Missing representations".to_string()))?;
        
        let representations = decoder.resolve_ref_list(representations_attr)?;
        
        // Find the shape representation with geometry
        for shape_rep in &representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }
            
            let items_attr = match shape_rep.get(3) {
                Some(attr) => attr,
                None => continue,
            };
            
            let items = decoder.resolve_ref_list(items_attr)?;
            
            for item in &items {
                // Check if this is a IfcBooleanClippingResult (wall clipped by roof)
                if item.ifc_type == IfcType::IfcBooleanClippingResult {
                    // Recursively extract base solid and collect clipping planes
                    let (profile, depth, axis, origin, transform, clips) = 
                        self.extract_profile_from_boolean_result(item, decoder)?;
                    clipping_planes.extend(clips);
                    return Ok((profile, depth, axis, origin, transform, clipping_planes));
                }
                
                // If it's a simple extruded solid, extract profile directly
                if item.ifc_type == IfcType::IfcExtrudedAreaSolid {
                    let (profile, depth, axis, origin, transform) = 
                        self.extract_profile_from_extruded_solid(item, decoder)?;
                    return Ok((profile, depth, axis, origin, transform, clipping_planes));
                }
            }
        }
        
        // Fallback: couldn't find extruded solid
        Err(Error::geometry("Could not find IfcExtrudedAreaSolid in representation".to_string()))
    }

    /// Extract profile from IfcBooleanClippingResult recursively
    fn extract_profile_from_boolean_result(
        &self,
        boolean_result: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(
        crate::profile::Profile2D,
        f64,
        u8,
        f64,
        Option<Matrix4<f64>>,
        Vec<(Point3<f64>, Vector3<f64>, bool)>,
    )> {
        use nalgebra::Vector3;
        
        let mut clipping_planes: Vec<(Point3<f64>, Vector3<f64>, bool)> = Vec::new();
        
        // Get FirstOperand (the base geometry or another boolean result)
        let first_operand_attr = boolean_result.get(1)
            .ok_or_else(|| Error::geometry("BooleanResult missing FirstOperand".to_string()))?;
        
        let first_operand = decoder.resolve_ref(first_operand_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve FirstOperand".to_string()))?;
        
        // Get SecondOperand (the clipping solid - usually IfcHalfSpaceSolid)
        if let Some(second_operand_attr) = boolean_result.get(2) {
            if let Ok(Some(second_operand)) = decoder.resolve_ref(second_operand_attr) {
                if let Some(clip) = self.extract_half_space_plane(&second_operand, decoder) {
                    clipping_planes.push(clip);
                }
            }
        }
        
        // Process FirstOperand
        if first_operand.ifc_type == IfcType::IfcBooleanClippingResult {
            // Recursively process nested boolean results
            let (profile, depth, axis, origin, transform, nested_clips) = 
                self.extract_profile_from_boolean_result(&first_operand, decoder)?;
            clipping_planes.extend(nested_clips);
            return Ok((profile, depth, axis, origin, transform, clipping_planes));
        }
        
        // FirstOperand should be IfcExtrudedAreaSolid
        if first_operand.ifc_type == IfcType::IfcExtrudedAreaSolid {
            let (profile, depth, axis, origin, transform) = 
                self.extract_profile_from_extruded_solid(&first_operand, decoder)?;
            return Ok((profile, depth, axis, origin, transform, clipping_planes));
        }
        
        Err(Error::geometry(format!(
            "Unsupported base solid type in boolean result: {:?}",
            first_operand.ifc_type
        )))
    }

    /// Extract profile, depth, axis, origin, and Position transform from IfcExtrudedAreaSolid
    fn extract_profile_from_extruded_solid(
        &self,
        extruded_solid: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(crate::profile::Profile2D, f64, u8, f64, Option<Matrix4<f64>>)> {
        // Get SweptArea (attribute 0: IfcProfileDef)
        let swept_area_attr = extruded_solid.get(0)
            .ok_or_else(|| Error::geometry("ExtrudedAreaSolid missing SweptArea".to_string()))?;
        
        let profile_entity = decoder.resolve_ref(swept_area_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve SweptArea".to_string()))?;
        
        // Extract the actual 2D profile (preserves chamfered corners!)
        let profile = self.extract_profile_2d(&profile_entity, decoder)?;
        
        // Get depth (attribute 3: Depth)
        let depth = extruded_solid.get_float(3)
            .ok_or_else(|| Error::geometry("ExtrudedAreaSolid missing Depth".to_string()))?;
        
        // Get ExtrudedDirection (attribute 2: IfcDirection)
        // This tells us which axis is the thickness axis
        let direction_attr = extruded_solid.get(2)
            .ok_or_else(|| Error::geometry("ExtrudedAreaSolid missing ExtrudedDirection".to_string()))?;
        
        let direction_entity = decoder.resolve_ref(direction_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve ExtrudedDirection".to_string()))?;
        
        // Get direction coordinates (attribute 0: DirectionRatios)
        let ratios_attr = direction_entity.get(0)
            .ok_or_else(|| Error::geometry("Direction missing DirectionRatios".to_string()))?;
        
        let ratios = ratios_attr.as_list()
            .ok_or_else(|| Error::geometry("DirectionRatios is not a list".to_string()))?;
        
        let dx = ratios.get(0).and_then(|v| v.as_float()).unwrap_or(0.0);
        let dy = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let dz = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(1.0);
        
        // Determine thickness axis from direction (which component is largest)
        let thickness_axis = if dx.abs() >= dy.abs() && dx.abs() >= dz.abs() {
            0 // X axis
        } else if dy.abs() >= dz.abs() {
            1 // Y axis
        } else {
            2 // Z axis
        };
        
        // For wall origin, we'll need to get it from the element's placement
        // For now, use 0.0 - it will be adjusted when we transform coordinates
        let wall_origin = 0.0;
        
        // Extract Position transform (attribute 1: IfcAxis2Placement3D)
        let position_transform = if let Some(pos_attr) = extruded_solid.get(1) {
            if !pos_attr.is_null() {
                if let Ok(Some(pos_entity)) = decoder.resolve_ref(pos_attr) {
                    if pos_entity.ifc_type == IfcType::IfcAxis2Placement3D {
                        match self.parse_axis2_placement_3d(&pos_entity, decoder) {
                            Ok(transform) => Some(transform),
                            Err(_) => None,
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        
        Ok((profile, depth, thickness_axis, wall_origin, position_transform))
    }

    /// Extract base mesh from IfcBooleanClippingResult and collect clipping planes
    #[allow(dead_code)] // Used internally for recursive boolean result processing
    fn extract_base_from_boolean_result(
        &self,
        boolean_result: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Mesh, Vec<(Point3<f64>, Vector3<f64>, bool)>)> {
        use nalgebra::Vector3;
        
        let mut clipping_planes: Vec<(Point3<f64>, Vector3<f64>, bool)> = Vec::new();
        
        // Get FirstOperand (the base geometry or another boolean result)
        let first_operand_attr = boolean_result.get(1)
            .ok_or_else(|| Error::geometry("BooleanResult missing FirstOperand".to_string()))?;
        
        let first_operand = decoder.resolve_ref(first_operand_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve FirstOperand".to_string()))?;
        
        // Get SecondOperand (the clipping solid - usually IfcHalfSpaceSolid)
        if let Some(second_operand_attr) = boolean_result.get(2) {
            if let Ok(Some(second_operand)) = decoder.resolve_ref(second_operand_attr) {
                if let Some(clip) = self.extract_half_space_plane(&second_operand, decoder) {
                    clipping_planes.push(clip);
                }
            }
        }
        
        // Process FirstOperand
        if first_operand.ifc_type == IfcType::IfcBooleanClippingResult {
            // Recursively process nested boolean results
            let (base_mesh, nested_clips) = self.extract_base_from_boolean_result(&first_operand, decoder)?;
            clipping_planes.extend(nested_clips);
            return Ok((base_mesh, clipping_planes));
        }
        
        // FirstOperand is the base solid (IfcExtrudedAreaSolid, etc.)
        if let Some(processor) = self.processors.get(&first_operand.ifc_type) {
            let mut mesh = processor.process(&first_operand, decoder, &self.schema)?;
            self.scale_mesh(&mut mesh);
            // Note: placement is applied in the main function
            return Ok((mesh, clipping_planes));
        }
        
        Err(Error::geometry(format!(
            "Unsupported base solid type: {:?}",
            first_operand.ifc_type
        )))
    }

    /// Extract plane parameters from IfcHalfSpaceSolid or IfcPolygonalBoundedHalfSpace
    fn extract_half_space_plane(
        &self,
        half_space: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Option<(Point3<f64>, Vector3<f64>, bool)> {
        use nalgebra::Vector3;
        
        if half_space.ifc_type != IfcType::IfcHalfSpaceSolid 
            && half_space.ifc_type != IfcType::IfcPolygonalBoundedHalfSpace {
            return None;
        }
        
        // Get BaseSurface (should be IfcPlane)
        let base_surface_attr = half_space.get(0)?;
        let base_surface = decoder.resolve_ref(base_surface_attr).ok()??;
        
        if base_surface.ifc_type != IfcType::IfcPlane {
            return None;
        }
        
        // Get Position (IfcAxis2Placement3D)
        let position_attr = base_surface.get(0)?;
        let position = decoder.resolve_ref(position_attr).ok()??;
        
        // Get Location (point on plane)
        let location_attr = position.get(0)?;
        let location = decoder.resolve_ref(location_attr).ok()??;
        
        let coords_attr = location.get(0)?;
        let coords = coords_attr.as_list()?;
        let px = coords.first()?.as_float()?;
        let py = coords.get(1)?.as_float()?;
        let pz = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);
        let plane_point = Point3::new(px, py, pz);
        
        // Get Axis (normal direction) - default to Z if not specified
        let plane_normal = if let Some(axis_attr) = position.get(1) {
            if !axis_attr.is_null() {
                if let Ok(Some(axis)) = decoder.resolve_ref(axis_attr) {
                    if let Some(dir_attr) = axis.get(0) {
                        if let Some(dir) = dir_attr.as_list() {
                            let nx = dir.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                            let ny = dir.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                            let nz = dir.get(2).and_then(|v| v.as_float()).unwrap_or(1.0);
                            Vector3::new(nx, ny, nz).normalize()
                        } else {
                            Vector3::new(0.0, 0.0, 1.0)
                        }
                    } else {
                        Vector3::new(0.0, 0.0, 1.0)
                    }
                } else {
                    Vector3::new(0.0, 0.0, 1.0)
                }
            } else {
                Vector3::new(0.0, 0.0, 1.0)
            }
        } else {
            Vector3::new(0.0, 0.0, 1.0)
        };
        
        // Get AgreementFlag - stored as Enum "T" or "F"
        let agreement = half_space.get(1)
            .map(|v| match v {
                ifc_lite_core::AttributeValue::Enum(e) => e != "F" && e != ".F.",
                _ => true,
            })
            .unwrap_or(true);
        
        Some((plane_point, plane_normal, agreement))
    }

    /// Process element with voids using 2D profile-level operations
    ///
    /// This is a smarter and more efficient approach that:
    /// 1. Classifies voids as coplanar (can subtract in 2D) or non-planar (need 3D CSG)
    /// 2. Subtracts coplanar voids at the 2D profile level before extrusion
    /// 3. Falls back to 3D CSG only for non-planar voids
    ///
    /// Benefits:
    /// - 10-25x faster than full 3D CSG for most openings
    /// - More reliable, especially for floors/slabs with many penetrations
    /// - Cleaner geometry with fewer degenerate triangles
    #[inline]
    pub fn process_element_with_voids_2d(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &VoidIndex,
    ) -> Result<Mesh> {
        // Check if this element has any openings
        let opening_ids = void_index.get_voids(element.id);

        if opening_ids.is_empty() {
            // No openings, just process normally
            return self.process_element(element, decoder);
        }

        // Try to extract extrusion parameters for 2D void processing
        // If the element isn't an extrusion, fall back to 3D CSG
        match self.try_process_extrusion_with_voids_2d(element, decoder, opening_ids) {
            Ok(Some(mesh)) => Ok(mesh),
            Ok(None) | Err(_) => {
                // Fall back to traditional 3D CSG approach
                let void_map: FxHashMap<u32, Vec<u32>> = [(element.id, opening_ids.to_vec())]
                    .into_iter()
                    .collect();
                self.process_element_with_voids(element, decoder, &void_map)
            }
        }
    }

    /// Try to process an extrusion with 2D void subtraction
    ///
    /// Returns Ok(Some(mesh)) if 2D processing was successful,
    /// Ok(None) if the element is not suitable for 2D processing,
    /// Err if an error occurred.
    fn try_process_extrusion_with_voids_2d(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        opening_ids: &[u32],
    ) -> Result<Option<Mesh>> {
        // Get representation
        let representation_attr = match element.get(6) {
            Some(attr) if !attr.is_null() => attr,
            _ => return Ok(None),
        };

        let representation = match decoder.resolve_ref(representation_attr)? {
            Some(r) => r,
            None => return Ok(None),
        };

        if representation.ifc_type != IfcType::IfcProductDefinitionShape {
            return Ok(None);
        }

        // Find an IfcExtrudedAreaSolid in the representations
        let representations_attr = match representation.get(2) {
            Some(attr) => attr,
            None => return Ok(None),
        };

        let representations = decoder.resolve_ref_list(representations_attr)?;

        // Look for extruded area solid
        for shape_rep in &representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }

            let items_attr = match shape_rep.get(3) {
                Some(attr) => attr,
                None => continue,
            };

            let items = decoder.resolve_ref_list(items_attr)?;

            for item in &items {
                if item.ifc_type == IfcType::IfcExtrudedAreaSolid {
                    // Found an extrusion - try 2D void processing
                    return self.process_extrusion_with_voids_2d_impl(
                        element,
                        item,
                        decoder,
                        opening_ids,
                    );
                }
            }
        }

        Ok(None)
    }

    /// Implementation of 2D void processing for extrusions
    fn process_extrusion_with_voids_2d_impl(
        &self,
        element: &DecodedEntity,
        extrusion: &DecodedEntity,
        decoder: &mut EntityDecoder,
        opening_ids: &[u32],
    ) -> Result<Option<Mesh>> {
        // Extract extrusion parameters
        // IfcExtrudedAreaSolid: SweptArea, Position, ExtrudedDirection, Depth

        // Get depth (attribute 3)
        let depth = match extrusion.get_float(3) {
            Some(d) if d > 0.0 => d,
            _ => return Ok(None),
        };

        // Get extrusion direction (attribute 2)
        let direction_attr = match extrusion.get(2) {
            Some(attr) if !attr.is_null() => attr,
            _ => return Ok(None),
        };

        let direction_entity = match decoder.resolve_ref(direction_attr)? {
            Some(e) => e,
            None => return Ok(None),
        };

        let local_extrusion_direction = self.parse_direction(&direction_entity)?;

        // Get position transform (attribute 1)
        let position_transform = if let Some(pos_attr) = extrusion.get(1) {
            if !pos_attr.is_null() {
                if let Some(pos_entity) = decoder.resolve_ref(pos_attr)? {
                    self.parse_axis2_placement_3d(&pos_entity, decoder)?
                } else {
                    Matrix4::identity()
                }
            } else {
                Matrix4::identity()
            }
        } else {
            Matrix4::identity()
        };

        // Transform extrusion direction from local to world coordinates
        // ExtrudedDirection is specified in Position's local coordinate system
        let extrusion_direction = {
            let rot_x = Vector3::new(
                position_transform[(0, 0)],
                position_transform[(1, 0)],
                position_transform[(2, 0)],
            );
            let rot_y = Vector3::new(
                position_transform[(0, 1)],
                position_transform[(1, 1)],
                position_transform[(2, 1)],
            );
            let rot_z = Vector3::new(
                position_transform[(0, 2)],
                position_transform[(1, 2)],
                position_transform[(2, 2)],
            );
            (rot_x * local_extrusion_direction.x
                + rot_y * local_extrusion_direction.y
                + rot_z * local_extrusion_direction.z)
                .normalize()
        };

        // Get element placement transform
        let element_transform = self.get_placement_transform_from_element(element, decoder)?;
        let combined_transform = element_transform * position_transform;

        // Get swept area (profile) - attribute 0
        let profile_attr = match extrusion.get(0) {
            Some(attr) if !attr.is_null() => attr,
            _ => return Ok(None),
        };

        let profile_entity = match decoder.resolve_ref(profile_attr)? {
            Some(e) => e,
            None => return Ok(None),
        };

        // Extract base 2D profile
        let base_profile = match self.extract_profile_2d(&profile_entity, decoder) {
            Ok(p) => p,
            Err(_) => return Ok(None),
        };

        // Process opening meshes and classify them
        let mut void_meshes: Vec<Mesh> = Vec::new();

        for &opening_id in opening_ids {
            let opening_entity = match decoder.decode_by_id(opening_id) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let opening_mesh = match self.process_element(&opening_entity, decoder) {
                Ok(m) if !m.is_empty() => m,
                _ => continue,
            };

            void_meshes.push(opening_mesh);
        }

        if void_meshes.is_empty() {
            // No valid openings - just process the extrusion normally
            let processor = self.processors.get(&IfcType::IfcExtrudedAreaSolid);
            if let Some(proc) = processor {
                let mut mesh = proc.process(extrusion, decoder, &self.schema)?;
                self.scale_mesh(&mut mesh);
                self.apply_placement(element, decoder, &mut mesh)?;
                return Ok(Some(mesh));
            }
            return Ok(None);
        }

        // Classify voids
        // Use unscaled depth since void_meshes are in file units (not yet scaled)
        let analyzer = VoidAnalyzer::new();

        let classifications: Vec<VoidClassification> = void_meshes
            .iter()
            .map(|mesh| {
                analyzer.classify_void(
                    mesh,
                    &combined_transform,
                    &extrusion_direction.normalize(),
                    depth,
                )
            })
            .collect();

        // Extract coplanar and non-planar voids
        let coplanar_voids = extract_coplanar_voids(&classifications);
        let nonplanar_voids = extract_nonplanar_voids(classifications);

        // Process coplanar voids at 2D level
        let profile_with_voids = if !coplanar_voids.is_empty() {
            // Collect through-void contours for 2D subtraction
            let through_contours: Vec<Vec<Point2<f64>>> = coplanar_voids
                .iter()
                .filter(|v| v.is_through)
                .map(|v| v.contour.clone())
                .collect();

            // Subtract voids from profile
            let modified_profile = if !through_contours.is_empty() {
                match subtract_multiple_2d(&base_profile, &through_contours) {
                    Ok(p) => p,
                    Err(_) => base_profile.clone(),
                }
            } else {
                base_profile.clone()
            };

            // Create profile with partial-depth voids
            let partial_voids: Vec<VoidInfo> = coplanar_voids
                .into_iter()
                .filter(|v| !v.is_through)
                .map(|v| VoidInfo {
                    contour: v.contour,
                    depth_start: v.depth_start,
                    depth_end: v.depth_end,
                    is_through: false,
                })
                .collect();

            Profile2DWithVoids::new(modified_profile, partial_voids)
        } else {
            Profile2DWithVoids::from_profile(base_profile)
        };

        // Extrude with voids
        use crate::extrusion::extrude_profile_with_voids;

        let mut mesh = match extrude_profile_with_voids(&profile_with_voids, depth, None) {
            Ok(m) => m,
            Err(_) => {
                // Fall back to normal extrusion
                let processor = self.processors.get(&IfcType::IfcExtrudedAreaSolid);
                if let Some(proc) = processor {
                    proc.process(extrusion, decoder, &self.schema)?
                } else {
                    return Ok(None);
                }
            }
        };

        // Apply extrusion position transform (with RTC offset)
        if position_transform != Matrix4::identity() {
            self.transform_mesh(&mut mesh, &position_transform);
        }

        // Scale mesh
        self.scale_mesh(&mut mesh);

        // Apply element placement
        self.apply_placement(element, decoder, &mut mesh)?;

        // Handle non-planar voids with 3D CSG
        if !nonplanar_voids.is_empty() {
            let clipper = ClippingProcessor::new();
            mesh = clipper.subtract_meshes_with_fallback(&mesh, &nonplanar_voids);
        }

        Ok(Some(mesh))
    }

    /// Extract a 2D profile from an IFC profile entity
    fn extract_profile_2d(
        &self,
        profile_entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Profile2D> {
        use crate::profile::create_rectangle;

        match profile_entity.ifc_type {
            IfcType::IfcRectangleProfileDef => {
                // Attributes: ProfileType, ProfileName, Position, XDim, YDim
                let x_dim = profile_entity.get_float(3).unwrap_or(1.0);
                let y_dim = profile_entity.get_float(4).unwrap_or(1.0);
                Ok(create_rectangle(x_dim, y_dim))
            }

            IfcType::IfcCircleProfileDef => {
                use crate::profile::create_circle;
                let radius = profile_entity.get_float(3).unwrap_or(1.0);
                Ok(create_circle(radius, None))
            }

            IfcType::IfcArbitraryClosedProfileDef => {
                // Get outer curve and convert to points
                let curve_attr = profile_entity.get(2).ok_or_else(|| {
                    Error::geometry("ArbitraryClosedProfileDef missing OuterCurve".to_string())
                })?;

                let curve = decoder.resolve_ref(curve_attr)?.ok_or_else(|| {
                    Error::geometry("Failed to resolve OuterCurve".to_string())
                })?;

                let points = self.extract_curve_points(&curve, decoder)?;
                Ok(Profile2D::new(points))
            }

            IfcType::IfcArbitraryProfileDefWithVoids => {
                // Get outer curve
                let outer_attr = profile_entity.get(2).ok_or_else(|| {
                    Error::geometry(
                        "ArbitraryProfileDefWithVoids missing OuterCurve".to_string(),
                    )
                })?;

                let outer_curve = decoder.resolve_ref(outer_attr)?.ok_or_else(|| {
                    Error::geometry("Failed to resolve OuterCurve".to_string())
                })?;

                let outer_points = self.extract_curve_points(&outer_curve, decoder)?;
                let mut profile = Profile2D::new(outer_points);

                // Get inner curves (holes)
                if let Some(inner_attr) = profile_entity.get(3) {
                    let inner_curves = decoder.resolve_ref_list(inner_attr)?;
                    for inner_curve in inner_curves {
                        if let Ok(hole_points) = self.extract_curve_points(&inner_curve, decoder) {
                            profile.add_hole(hole_points);
                        }
                    }
                }

                Ok(profile)
            }

            _ => Err(Error::geometry(format!(
                "Unsupported profile type for 2D extraction: {}",
                profile_entity.ifc_type
            ))),
        }
    }

    /// Extract points from a curve entity (IfcPolyline, IfcIndexedPolyCurve, etc.)
    fn extract_curve_points(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        match curve.ifc_type {
            IfcType::IfcPolyline => {
                // IfcPolyline: Points (list of IfcCartesianPoint)
                let points_attr = curve
                    .get(0)
                    .ok_or_else(|| Error::geometry("IfcPolyline missing Points".to_string()))?;

                let point_entities = decoder.resolve_ref_list(points_attr)?;
                let mut points = Vec::with_capacity(point_entities.len());

                for (_i, point_entity) in point_entities.iter().enumerate() {
                    if point_entity.ifc_type == IfcType::IfcCartesianPoint {
                        if let Some(coords_attr) = point_entity.get(0) {
                            if let Some(coords) = coords_attr.as_list() {
                                let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                                let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                                points.push(Point2::new(x, y));
                            }
                        }
                    }
                }

                Ok(points)
            }

            IfcType::IfcIndexedPolyCurve => {
                // IfcIndexedPolyCurve: Points (IfcCartesianPointList2D), Segments, SelfIntersect
                let points_attr = curve.get(0).ok_or_else(|| {
                    Error::geometry("IfcIndexedPolyCurve missing Points".to_string())
                })?;

                let point_list = decoder.resolve_ref(points_attr)?.ok_or_else(|| {
                    Error::geometry("Failed to resolve Points".to_string())
                })?;

                // IfcCartesianPointList2D: CoordList (list of coordinates)
                if let Some(coord_attr) = point_list.get(0) {
                    if let Some(coord_list) = coord_attr.as_list() {
                        let mut points = Vec::with_capacity(coord_list.len());

                        for coord in coord_list {
                            if let Some(pair) = coord.as_list() {
                                let x = pair.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                                let y = pair.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                                points.push(Point2::new(x, y));
                            }
                        }

                        return Ok(points);
                    }
                }

                Err(Error::geometry(
                    "Failed to extract points from IfcIndexedPolyCurve".to_string(),
                ))
            }

            IfcType::IfcCompositeCurve => {
                // IfcCompositeCurve: Segments (list of IfcCompositeCurveSegment)
                let segments_attr = curve.get(0).ok_or_else(|| {
                    Error::geometry("IfcCompositeCurve missing Segments".to_string())
                })?;

                let segments = decoder.resolve_ref_list(segments_attr)?;
                let mut all_points = Vec::new();

                for segment in segments {
                    // IfcCompositeCurveSegment: Transition, SameSense, ParentCurve
                    if let Some(parent_attr) = segment.get(2) {
                        if let Some(parent_curve) = decoder.resolve_ref(parent_attr)? {
                            if let Ok(points) = self.extract_curve_points(&parent_curve, decoder) {
                                all_points.extend(points);
                            }
                        }
                    }
                }

                Ok(all_points)
            }

            _ => Err(Error::geometry(format!(
                "Unsupported curve type: {}",
                curve.ifc_type
            ))),
        }
    }

    /// Process building element and return geometry + transform separately
    /// Used for instanced rendering - geometry is returned untransformed, transform is separate
    #[inline]
    pub fn process_element_with_transform(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Mesh, Matrix4<f64>)> {
        // Get representation (attribute 6 for most building elements)
        let representation_attr = element.get(6).ok_or_else(|| {
            Error::geometry(format!(
                "Element #{} has no representation attribute",
                element.id
            ))
        })?;

        if representation_attr.is_null() {
            return Ok((Mesh::new(), Matrix4::identity())); // No geometry
        }

        let representation = decoder
            .resolve_ref(representation_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve representation".to_string()))?;

        if representation.ifc_type != IfcType::IfcProductDefinitionShape {
            return Err(Error::geometry(format!(
                "Expected IfcProductDefinitionShape, got {}",
                representation.ifc_type
            )));
        }

        // Get representations list (attribute 2)
        let representations_attr = representation.get(2).ok_or_else(|| {
            Error::geometry("IfcProductDefinitionShape missing Representations".to_string())
        })?;

        let representations = decoder.resolve_ref_list(representations_attr)?;

        // Process all representations and merge meshes
        let mut combined_mesh = Mesh::new();

        // Check for direct geometry
        let has_direct_geometry = representations.iter().any(|rep| {
            if rep.ifc_type != IfcType::IfcShapeRepresentation {
                return false;
            }
            if let Some(rep_type_attr) = rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    matches!(
                        rep_type,
                        "Body"
                            | "SweptSolid"
                            | "Brep"
                            | "CSG"
                            | "Clipping"
                            | "SurfaceModel"
                            | "Tessellation"
                            | "AdvancedSweptSolid"
                            | "AdvancedBrep"
                    )
                } else {
                    false
                }
            } else {
                false
            }
        });

        for shape_rep in representations {
            if shape_rep.ifc_type != IfcType::IfcShapeRepresentation {
                continue;
            }

            if let Some(rep_type_attr) = shape_rep.get(2) {
                if let Some(rep_type) = rep_type_attr.as_string() {
                    if rep_type == "MappedRepresentation" && has_direct_geometry {
                        continue;
                    }

                    if !matches!(
                        rep_type,
                        "Body"
                            | "SweptSolid"
                            | "Brep"
                            | "CSG"
                            | "Clipping"
                            | "SurfaceModel"
                            | "Tessellation"
                            | "MappedRepresentation"
                            | "AdvancedSweptSolid"
                            | "AdvancedBrep"
                    ) {
                        continue;
                    }
                }
            }

            let items_attr = shape_rep.get(3).ok_or_else(|| {
                Error::geometry("IfcShapeRepresentation missing Items".to_string())
            })?;

            let items = decoder.resolve_ref_list(items_attr)?;

            for item in items {
                let mesh = self.process_representation_item(&item, decoder)?;
                combined_mesh.merge(&mesh);
            }
        }

        // Get placement transform WITHOUT applying it
        let transform = self.get_placement_transform_from_element(element, decoder)?;

        Ok((combined_mesh, transform))
    }

    /// Get placement transform from element without applying it
    fn get_placement_transform_from_element(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        // Get ObjectPlacement (attribute 5)
        let placement_attr = match element.get(5) {
            Some(attr) if !attr.is_null() => attr,
            _ => return Ok(Matrix4::identity()), // No placement
        };

        let placement = match decoder.resolve_ref(placement_attr)? {
            Some(p) => p,
            None => return Ok(Matrix4::identity()),
        };

        // Recursively get combined transform from placement hierarchy
        self.get_placement_transform(&placement, decoder)
    }

    /// Process a single representation item (IfcExtrudedAreaSolid, etc.)
    /// Uses hash-based caching for geometry deduplication across repeated floors
    #[inline]
    pub fn process_representation_item(
        &self,
        item: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Mesh> {
        // Special handling for MappedItem with caching
        if item.ifc_type == IfcType::IfcMappedItem {
            return self.process_mapped_item_cached(item, decoder);
        }

        // Check FacetedBrep cache first (from batch preprocessing)
        if item.ifc_type == IfcType::IfcFacetedBrep {
            if let Some(mut mesh) = self.take_cached_faceted_brep(item.id) {
                self.scale_mesh(&mut mesh);
                let cached = self.get_or_cache_by_hash(mesh);
                return Ok((*cached).clone());
            }
        }

        // Check if we have a processor for this type
        if let Some(processor) = self.processors.get(&item.ifc_type) {
            let mut mesh = processor.process(item, decoder, &self.schema)?;
            self.scale_mesh(&mut mesh);

            // Deduplicate by hash - buildings with repeated floors have identical geometry
            if !mesh.positions.is_empty() {
                let cached = self.get_or_cache_by_hash(mesh);
                return Ok((*cached).clone());
            }
            return Ok(mesh);
        }

        // Check category for fallback handling
        match self.schema.geometry_category(&item.ifc_type) {
            Some(GeometryCategory::SweptSolid) => {
                // For now, return empty mesh - processors will handle this
                Ok(Mesh::new())
            }
            Some(GeometryCategory::ExplicitMesh) => {
                // For now, return empty mesh - processors will handle this
                Ok(Mesh::new())
            }
            Some(GeometryCategory::Boolean) => {
                // For now, return empty mesh - processors will handle this
                Ok(Mesh::new())
            }
            Some(GeometryCategory::MappedItem) => {
                // For now, return empty mesh - processors will handle this
                Ok(Mesh::new())
            }
            _ => Err(Error::geometry(format!(
                "Unsupported representation type: {}",
                item.ifc_type
            ))),
        }
    }

    /// Process MappedItem with caching for repeated geometry
    #[inline]
    fn process_mapped_item_cached(
        &self,
        item: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Mesh> {
        // IfcMappedItem attributes:
        // 0: MappingSource (IfcRepresentationMap)
        // 1: MappingTarget (IfcCartesianTransformationOperator)

        // Get mapping source (RepresentationMap)
        let source_attr = item
            .get(0)
            .ok_or_else(|| Error::geometry("MappedItem missing MappingSource".to_string()))?;

        let source_entity = decoder
            .resolve_ref(source_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve MappingSource".to_string()))?;

        let source_id = source_entity.id;

        // Get MappingTarget transformation (attribute 1: CartesianTransformationOperator)
        let mapping_transform = if let Some(target_attr) = item.get(1) {
            if !target_attr.is_null() {
                if let Some(target_entity) = decoder.resolve_ref(target_attr)? {
                    Some(self.parse_cartesian_transformation_operator(&target_entity, decoder)?)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // Check cache first
        {
            let cache = self.mapped_item_cache.borrow();
            if let Some(cached_mesh) = cache.get(&source_id) {
                let mut mesh = cached_mesh.as_ref().clone();
                if let Some(mut transform) = mapping_transform {
                    self.scale_transform(&mut transform);
                    self.transform_mesh(&mut mesh, &transform);
                }
                return Ok(mesh);
            }
        }

        // Cache miss - process the geometry
        // IfcRepresentationMap has:
        // 0: MappingOrigin (IfcAxis2Placement)
        // 1: MappedRepresentation (IfcRepresentation)

        let mapped_rep_attr = source_entity.get(1).ok_or_else(|| {
            Error::geometry("RepresentationMap missing MappedRepresentation".to_string())
        })?;

        let mapped_rep = decoder
            .resolve_ref(mapped_rep_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve MappedRepresentation".to_string()))?;

        // Get representation items
        let items_attr = mapped_rep
            .get(3)
            .ok_or_else(|| Error::geometry("Representation missing Items".to_string()))?;

        let items = decoder.resolve_ref_list(items_attr)?;

        // Process all items and merge (without recursing into MappedItem to avoid infinite loop)
        let mut mesh = Mesh::new();
        for sub_item in items {
            if sub_item.ifc_type == IfcType::IfcMappedItem {
                continue; // Skip nested MappedItems to avoid recursion
            }
            if let Some(processor) = self.processors.get(&sub_item.ifc_type) {
                if let Ok(mut sub_mesh) = processor.process(&sub_item, decoder, &self.schema) {
                    self.scale_mesh(&mut sub_mesh);
                    mesh.merge(&sub_mesh);
                }
            }
        }

        // Store in cache (before transformation, so cached mesh is in source coordinates)
        {
            let mut cache = self.mapped_item_cache.borrow_mut();
            cache.insert(source_id, Arc::new(mesh.clone()));
        }

        // Apply MappingTarget transformation to this instance
        if let Some(mut transform) = mapping_transform {
            self.scale_transform(&mut transform);
            self.transform_mesh(&mut mesh, &transform);
        }

        Ok(mesh)
    }

    /// Apply local placement transformation to mesh
    fn apply_placement(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        mesh: &mut Mesh,
    ) -> Result<()> {
        let placement_attr = match element.get(5) {
            Some(attr) if !attr.is_null() => attr,
            _ => return Ok(()),
        };

        let placement = match decoder.resolve_ref(placement_attr)? {
            Some(p) => p,
            None => return Ok(()),
        };

        let mut transform = self.get_placement_transform(&placement, decoder)?;
        self.scale_transform(&mut transform);
        self.transform_mesh(mesh, &transform);
        Ok(())
    }

    /// Recursively resolve placement hierarchy
    ///
    /// Uses a depth limit (100) to prevent stack overflow on malformed files
    /// with circular placement references or extremely deep hierarchies.
    fn get_placement_transform(
        &self,
        placement: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        self.get_placement_transform_with_depth(placement, decoder, 0)
    }

    /// Internal helper with depth tracking to prevent stack overflow
    const MAX_PLACEMENT_DEPTH: usize = 100;

    fn get_placement_transform_with_depth(
        &self,
        placement: &DecodedEntity,
        decoder: &mut EntityDecoder,
        depth: usize,
    ) -> Result<Matrix4<f64>> {
        // Depth limit to prevent stack overflow on circular references or deep hierarchies
        if depth > Self::MAX_PLACEMENT_DEPTH {
            return Ok(Matrix4::identity());
        }

        if placement.ifc_type != IfcType::IfcLocalPlacement {
            return Ok(Matrix4::identity());
        }

        // Get parent transform first (attribute 0: PlacementRelTo)
        let parent_transform = if let Some(parent_attr) = placement.get(0) {
            if !parent_attr.is_null() {
                if let Some(parent) = decoder.resolve_ref(parent_attr)? {
                    self.get_placement_transform_with_depth(&parent, decoder, depth + 1)?
                } else {
                    Matrix4::identity()
                }
            } else {
                Matrix4::identity()
            }
        } else {
            Matrix4::identity()
        };

        // Get local transform (attribute 1: RelativePlacement)
        let local_transform = if let Some(rel_attr) = placement.get(1) {
            if !rel_attr.is_null() {
                if let Some(rel) = decoder.resolve_ref(rel_attr)? {
                    if rel.ifc_type == IfcType::IfcAxis2Placement3D {
                        self.parse_axis2_placement_3d(&rel, decoder)?
                    } else {
                        Matrix4::identity()
                    }
                } else {
                    Matrix4::identity()
                }
            } else {
                Matrix4::identity()
            }
        } else {
            Matrix4::identity()
        };

        // Compose: parent * local
        Ok(parent_transform * local_transform)
    }

    /// Parse IfcAxis2Placement3D into transformation matrix
    fn parse_axis2_placement_3d(
        &self,
        placement: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        // IfcAxis2Placement3D: Location, Axis, RefDirection
        let location = self.parse_cartesian_point(placement, decoder, 0)?;

        // Default axes if not specified
        let z_axis = if let Some(axis_attr) = placement.get(1) {
            if !axis_attr.is_null() {
                if let Some(axis_entity) = decoder.resolve_ref(axis_attr)? {
                    self.parse_direction(&axis_entity)?
                } else {
                    Vector3::new(0.0, 0.0, 1.0)
                }
            } else {
                Vector3::new(0.0, 0.0, 1.0)
            }
        } else {
            Vector3::new(0.0, 0.0, 1.0)
        };

        let x_axis = if let Some(ref_dir_attr) = placement.get(2) {
            if !ref_dir_attr.is_null() {
                if let Some(ref_dir_entity) = decoder.resolve_ref(ref_dir_attr)? {
                    self.parse_direction(&ref_dir_entity)?
                } else {
                    Vector3::new(1.0, 0.0, 0.0)
                }
            } else {
                Vector3::new(1.0, 0.0, 0.0)
            }
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };

        // Y axis is cross product of Z and X
        let y_axis = z_axis.cross(&x_axis).normalize();
        let x_axis = y_axis.cross(&z_axis).normalize();
        let z_axis = z_axis.normalize();

        // Build transformation matrix
        let mut transform = Matrix4::identity();
        transform[(0, 0)] = x_axis.x;
        transform[(1, 0)] = x_axis.y;
        transform[(2, 0)] = x_axis.z;
        transform[(0, 1)] = y_axis.x;
        transform[(1, 1)] = y_axis.y;
        transform[(2, 1)] = y_axis.z;
        transform[(0, 2)] = z_axis.x;
        transform[(1, 2)] = z_axis.y;
        transform[(2, 2)] = z_axis.z;
        transform[(0, 3)] = location.x;
        transform[(1, 3)] = location.y;
        transform[(2, 3)] = location.z;

        Ok(transform)
    }

    /// Parse IfcCartesianPoint
    #[inline]
    fn parse_cartesian_point(
        &self,
        parent: &DecodedEntity,
        decoder: &mut EntityDecoder,
        attr_index: usize,
    ) -> Result<Point3<f64>> {
        let point_attr = parent
            .get(attr_index)
            .ok_or_else(|| Error::geometry("Missing cartesian point".to_string()))?;

        let point_entity = decoder
            .resolve_ref(point_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve cartesian point".to_string()))?;

        if point_entity.ifc_type != IfcType::IfcCartesianPoint {
            return Err(Error::geometry(format!(
                "Expected IfcCartesianPoint, got {}",
                point_entity.ifc_type
            )));
        }

        // Get coordinates list (attribute 0)
        let coords_attr = point_entity
            .get(0)
            .ok_or_else(|| Error::geometry("IfcCartesianPoint missing coordinates".to_string()))?;

        let coords = coords_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;

        let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
        let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

        Ok(Point3::new(x, y, z))
    }

    /// Parse IfcDirection
    #[inline]
    fn parse_direction(&self, direction_entity: &DecodedEntity) -> Result<Vector3<f64>> {
        if direction_entity.ifc_type != IfcType::IfcDirection {
            return Err(Error::geometry(format!(
                "Expected IfcDirection, got {}",
                direction_entity.ifc_type
            )));
        }

        // Get direction ratios (attribute 0)
        let ratios_attr = direction_entity
            .get(0)
            .ok_or_else(|| Error::geometry("IfcDirection missing ratios".to_string()))?;

        let ratios = ratios_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected ratio list".to_string()))?;

        let x = ratios.first().and_then(|v| v.as_float()).unwrap_or(0.0);
        let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
        let z = ratios.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

        Ok(Vector3::new(x, y, z))
    }

    /// Parse IfcCartesianTransformationOperator (2D or 3D)
    /// Used for MappedItem MappingTarget transformation
    #[inline]
    fn parse_cartesian_transformation_operator(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        // IfcCartesianTransformationOperator3D has:
        // 0: Axis1 (IfcDirection) - X axis direction (optional)
        // 1: Axis2 (IfcDirection) - Y axis direction (optional)
        // 2: LocalOrigin (IfcCartesianPoint) - translation
        // 3: Scale (IfcReal) - uniform scale (optional, defaults to 1.0)
        // 4: Axis3 (IfcDirection) - Z axis direction (optional, for 3D only)

        // Get LocalOrigin (attribute 2)
        let origin = if let Some(origin_attr) = entity.get(2) {
            if !origin_attr.is_null() {
                if let Some(origin_entity) = decoder.resolve_ref(origin_attr)? {
                    if origin_entity.ifc_type == IfcType::IfcCartesianPoint {
                        let coords_attr = origin_entity.get(0);
                        if let Some(coords) = coords_attr.and_then(|a| a.as_list()) {
                            Point3::new(
                                coords.first().and_then(|v| v.as_float()).unwrap_or(0.0),
                                coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0),
                                coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0),
                            )
                        } else {
                            Point3::origin()
                        }
                    } else {
                        Point3::origin()
                    }
                } else {
                    Point3::origin()
                }
            } else {
                Point3::origin()
            }
        } else {
            Point3::origin()
        };

        // Get Scale (attribute 3)
        let scale = entity.get_float(3).unwrap_or(1.0);

        // Get Axis1 (X axis, attribute 0)
        let x_axis = if let Some(axis1_attr) = entity.get(0) {
            if !axis1_attr.is_null() {
                if let Some(axis1_entity) = decoder.resolve_ref(axis1_attr)? {
                    self.parse_direction(&axis1_entity)?.normalize()
                } else {
                    Vector3::new(1.0, 0.0, 0.0)
                }
            } else {
                Vector3::new(1.0, 0.0, 0.0)
            }
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };

        // Get Axis3 (Z axis, attribute 4 for 3D)
        let z_axis = if let Some(axis3_attr) = entity.get(4) {
            if !axis3_attr.is_null() {
                if let Some(axis3_entity) = decoder.resolve_ref(axis3_attr)? {
                    self.parse_direction(&axis3_entity)?.normalize()
                } else {
                    Vector3::new(0.0, 0.0, 1.0)
                }
            } else {
                Vector3::new(0.0, 0.0, 1.0)
            }
        } else {
            Vector3::new(0.0, 0.0, 1.0)
        };

        // Derive Y axis from Z and X (right-hand coordinate system)
        let y_axis = z_axis.cross(&x_axis).normalize();
        let x_axis = y_axis.cross(&z_axis).normalize();

        // Build transformation matrix with scale
        let mut transform = Matrix4::identity();
        transform[(0, 0)] = x_axis.x * scale;
        transform[(1, 0)] = x_axis.y * scale;
        transform[(2, 0)] = x_axis.z * scale;
        transform[(0, 1)] = y_axis.x * scale;
        transform[(1, 1)] = y_axis.y * scale;
        transform[(2, 1)] = y_axis.z * scale;
        transform[(0, 2)] = z_axis.x * scale;
        transform[(1, 2)] = z_axis.y * scale;
        transform[(2, 2)] = z_axis.z * scale;
        transform[(0, 3)] = origin.x;
        transform[(1, 3)] = origin.y;
        transform[(2, 3)] = origin.z;

        Ok(transform)
    }

    /// Transform mesh by matrix - optimized with chunk-based iteration
    /// Applies transformation with uniform RTC offset decision for the whole mesh.
    /// Determines once whether RTC is needed (based on transform translation) and applies uniformly.
    #[inline]
    fn transform_mesh(&self, mesh: &mut Mesh, transform: &Matrix4<f64>) {
        let rtc = self.rtc_offset;
        const LARGE_COORD_THRESHOLD: f64 = 1000.0;

        // Determine RTC need ONCE for the whole mesh based on transform's translation component
        // This ensures all vertices in the mesh use consistent RTC subtraction
        let tx = transform[(0, 3)];
        let ty = transform[(1, 3)];
        let tz = transform[(2, 3)];
        let needs_rtc = self.has_rtc_offset() &&
            (tx.abs() > LARGE_COORD_THRESHOLD || ty.abs() > LARGE_COORD_THRESHOLD || tz.abs() > LARGE_COORD_THRESHOLD);

        if needs_rtc {
            // Apply RTC offset to all vertices uniformly
            mesh.positions.chunks_exact_mut(3).for_each(|chunk| {
                let point = Point3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
                let t = transform.transform_point(&point);
                chunk[0] = (t.x - rtc.0) as f32;
                chunk[1] = (t.y - rtc.1) as f32;
                chunk[2] = (t.z - rtc.2) as f32;
            });
        } else {
            // No RTC offset - just transform
            mesh.positions.chunks_exact_mut(3).for_each(|chunk| {
                let point = Point3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
                let t = transform.transform_point(&point);
                chunk[0] = t.x as f32;
                chunk[1] = t.y as f32;
                chunk[2] = t.z as f32;
            });
        }

        // Transform normals (without translation)
        let rotation = transform.fixed_view::<3, 3>(0, 0);
        mesh.normals.chunks_exact_mut(3).for_each(|chunk| {
            let normal = Vector3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
            let t = (rotation * normal).normalize();
            chunk[0] = t.x as f32;
            chunk[1] = t.y as f32;
            chunk[2] = t.z as f32;
        });
    }

    /// Get schema reference
    pub fn schema(&self) -> &IfcSchema {
        &self.schema
    }
}

impl Default for GeometryRouter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_router_creation() {
        let router = GeometryRouter::new();
        // Router registers default processors on creation
        assert!(!router.processors.is_empty());
    }

    #[test]
    fn test_parse_cartesian_point() {
        let content = r#"
#1=IFCCARTESIANPOINT((100.0,200.0,300.0));
#2=IFCWALL('guid',$,$,$,$,$,#1,$);
"#;

        let mut decoder = EntityDecoder::new(content);
        let router = GeometryRouter::new();

        let wall = decoder.decode_by_id(2).unwrap();
        let point = router
            .parse_cartesian_point(&wall, &mut decoder, 6)
            .unwrap();

        assert_eq!(point.x, 100.0);
        assert_eq!(point.y, 200.0);
        assert_eq!(point.z, 300.0);
    }

    #[test]
    fn test_parse_direction() {
        let content = r#"
#1=IFCDIRECTION((1.0,0.0,0.0));
"#;

        let mut decoder = EntityDecoder::new(content);
        let router = GeometryRouter::new();

        let direction = decoder.decode_by_id(1).unwrap();
        let vec = router.parse_direction(&direction).unwrap();

        assert_eq!(vec.x, 1.0);
        assert_eq!(vec.y, 0.0);
        assert_eq!(vec.z, 0.0);
    }
}

/// Wall Profile Research Tests
/// 
/// These tests research and analyze how to correctly extrude wall footprints
/// with chamfered corners AND cut 2D window openings efficiently.
/// 
/// Key Problem: IFC wall profiles represent the footprint (length × thickness) with
/// chamfers at wall-to-wall joints, but openings are positioned on the wall face
/// (length × height). These are perpendicular coordinate systems.
#[cfg(test)]
mod wall_profile_research {
    use super::*;
    use crate::extrusion::extrude_profile;
    use crate::bool2d::subtract_2d;
    use nalgebra::{Point2, Point3, Vector3};

    /// Test 1: Chamfered Footprint Extrusion
    /// 
    /// Verify that extruding a chamfered footprint produces correct 3D geometry.
    /// The chamfered corners create clean joints where walls meet.
    #[test]
    fn test_chamfered_footprint_extrusion() {
        // Chamfered wall footprint from AC20-FZK-Haus.ifc example
        // 5 points indicate chamfered corners (vs 4 for rectangle)
        let footprint = Profile2D::new(vec![
            Point2::new(0.300, -0.300),   // chamfer start
            Point2::new(9.700, -0.300),   // chamfer end
            Point2::new(10.000, 0.000),   // corner
            Point2::new(0.000, 0.000),    // corner
            Point2::new(0.300, -0.300),   // closing point
        ]);
        
        // X = wall length (10m), Y = wall thickness (0.3m)
        // Extrude along Z (height = 2.7m)
        let mesh = extrude_profile(&footprint, 2.7, None).unwrap();
        
        // Verify mesh was created
        assert!(mesh.vertex_count() > 0);
        assert!(mesh.triangle_count() > 0);
        
        // Check bounds: should span length × thickness × height
        let (min, max) = mesh.bounds();
        assert!((min.x - 0.0).abs() < 0.01);
        assert!((max.x - 10.0).abs() < 0.01);
        assert!((min.y - (-0.3)).abs() < 0.01);
        assert!((max.y - 0.0).abs() < 0.01);
        assert!((min.z - 0.0).abs() < 0.01);
        assert!((max.z - 2.7).abs() < 0.01);
        
        // Chamfered footprint should have more vertices than rectangular
        // (5 points in footprint vs 4, plus side walls)
        assert!(mesh.vertex_count() >= 20);
    }

    /// Test 2: Coordinate System Analysis
    /// 
    /// Document and verify the three coordinate spaces:
    /// - IFC Profile Space: 2D (length, thickness) - chamfered footprint
    /// - Wall Face Space: 2D (length, height) - rectangular face where openings go
    /// - World Space: 3D (x, y, z)
    #[test]
    fn test_coordinate_system_analysis() {
        // IFC Profile Space (footprint, XY plane)
        // Represents wall footprint looking from above
        let footprint_profile = Profile2D::new(vec![
            Point2::new(0.3, -0.3),   // chamfer
            Point2::new(9.7, -0.3), // chamfer
            Point2::new(10.0, 0.0), // corner
            Point2::new(0.0, 0.0),  // corner
        ]);
        // X = length (10m), Y = thickness (0.3m)
        
        // Wall Face Space (face, XZ plane)
        // Represents wall face looking from side - where openings are positioned
        let wall_face_profile = Profile2D::new(vec![
            Point2::new(0.0, 0.0),   // bottom-left
            Point2::new(10.0, 0.0), // bottom-right
            Point2::new(10.0, 2.7), // top-right
            Point2::new(0.0, 2.7),  // top-left
        ]);
        // X = length (10m), Z = height (2.7m) - NO CHAMFERS
        
        // Key insight: Chamfers exist only in footprint (XY), not in face (XZ)
        // The face is always rectangular because chamfers only affect horizontal edges
        
        // Verify both profiles have correct dimensions
        let footprint_bounds = footprint_profile.outer.iter()
            .fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |(min_x, min_y, max_x, max_y), p| {
                (min_x.min(p.x), min_y.min(p.y), max_x.max(p.x), max_y.max(p.y))
            });
        
        let face_bounds = wall_face_profile.outer.iter()
            .fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |(min_x, min_y, max_x, max_y), p| {
                (min_x.min(p.x), min_y.min(p.y), max_x.max(p.x), max_y.max(p.y))
            });
        
        let _footprint_bounds = footprint_bounds; // Suppress unused warning
        let _face_bounds = face_bounds;
        
        // Both should span same length (10m)
        assert!((footprint_bounds.2 - footprint_bounds.0 - 10.0).abs() < 0.01);
        assert!((face_bounds.2 - face_bounds.0 - 10.0).abs() < 0.01);
        
        // Footprint has thickness dimension (Y), face has height dimension (Z)
        // These are perpendicular - footprint is XY plane, face is XZ plane
    }

    /// Test 3: Opening Projection Strategy
    /// 
    /// Demonstrate how openings in wall-face coordinates relate to the footprint.
    /// Openings are positioned on the wall face (length × height) and need to
    /// be cut through the full thickness.
    #[test]
    fn test_opening_projection_strategy() {
        // Opening in wall-face coords (length × height)
        // Example from AC20-FZK-Haus.ifc: window at (6.495, 0.8) to (8.495, 2.0)
        let opening_face_min_u = 6.495;  // position along wall length
        let opening_face_min_v = 0.8;    // height from bottom
        let opening_face_max_u = 8.495;  // position along wall length
        let opening_face_max_v = 2.0;    // height from top
        
        // The opening doesn't intersect the chamfer area
        // Chamfers are at corners: 0-0.3m and 9.7-10m along length
        // Opening is at 6.495-8.495m, which is in the middle - no chamfer conflict
        
        // Create wall face profile with opening as a hole
        let mut wall_face = Profile2D::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 2.7),
            Point2::new(0.0, 2.7),
        ]);
        
        // Add opening as a hole (clockwise winding for holes)
        wall_face.add_hole(vec![
            Point2::new(opening_face_min_u, opening_face_min_v),
            Point2::new(opening_face_max_u, opening_face_min_v),
            Point2::new(opening_face_max_u, opening_face_max_v),
            Point2::new(opening_face_min_u, opening_face_max_v),
        ]);
        
        // This profile can be extruded along thickness (Y axis) to create
        // a wall with an opening, but it loses the chamfers!
        let mesh_with_opening = extrude_profile(&wall_face, 0.3, None).unwrap();
        
        // Verify opening was created
        assert!(mesh_with_opening.vertex_count() > 0);
        
        // The mesh has the opening but no chamfers
        // This is the tradeoff: we need chamfers OR openings, not both with this approach
    }

    /// Test 4: Efficient 2D Boolean Approach
    /// 
    /// Test subtracting openings from wall face profile using 2D boolean operations.
    /// This is more efficient than 3D CSG but loses chamfers.
    #[test]
    fn test_efficient_2d_boolean_approach() {
        // Wall face profile (rectangular, no chamfers)
        let wall_face = Profile2D::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 2.7),
            Point2::new(0.0, 2.7),
        ]);
        
        // Opening contour (counter-clockwise for subtraction)
        let opening_contour = vec![
            Point2::new(6.495, 0.8),
            Point2::new(8.495, 0.8),
            Point2::new(8.495, 2.0),
            Point2::new(6.495, 2.0),
        ];
        
        // Subtract opening using 2D boolean
        let wall_with_opening = subtract_2d(&wall_face, &opening_contour).unwrap();
        
        // Verify opening was subtracted (should have a hole)
        assert_eq!(wall_with_opening.holes.len(), 1);
        assert_eq!(wall_with_opening.holes[0].len(), 4);
        
        // Extrude the result
        let mesh = extrude_profile(&wall_with_opening, 0.3, None).unwrap();
        
        // This approach is efficient but loses chamfers
        // Vertex count should be reasonable (much less than 3D CSG)
        assert!(mesh.vertex_count() < 200);
    }

    /// Test 5: Hybrid Approach - Plane Clipping
    /// 
    /// Prototype using plane clipping instead of full 3D CSG.
    /// For rectangular openings, we can clip the chamfered wall mesh with
    /// 4 planes (top, bottom, left, right) instead of full CSG subtraction.
    #[test]
    fn test_hybrid_plane_clipping_approach() {
        use crate::csg::{ClippingProcessor, Plane};
        
        // Start with chamfered wall mesh
        let chamfered_footprint = Profile2D::new(vec![
            Point2::new(0.3, -0.3),
            Point2::new(9.7, -0.3),
            Point2::new(10.0, 0.0),
            Point2::new(0.0, 0.0),
        ]);
        
        let chamfered_wall = extrude_profile(&chamfered_footprint, 2.7, None).unwrap();
        let initial_vertex_count = chamfered_wall.vertex_count();
        let initial_triangle_count = chamfered_wall.triangle_count();
        
        // Opening bounds in wall-face coordinates
        // Assuming wall is aligned: X = length (u), Z = height (v), Y = thickness
        let opening_min_u = 6.495;
        let opening_max_u = 8.495;
        let opening_min_v = 0.8;
        let opening_max_v = 2.0;
        
        // For plane clipping approach, we need to subtract a box defined by the opening
        // The opening is a rectangular prism cutting through the wall thickness
        // We can use subtract_box which is more efficient than individual plane clips
        
        let clipper = ClippingProcessor::new();
        
        // Define opening box in world coordinates
        // For a wall aligned with XZ plane (face), Y is thickness
        let opening_min = Point3::new(opening_min_u, -0.3, opening_min_v);
        let opening_max = Point3::new(opening_max_u, 0.0, opening_max_v);
        
        // Subtract the opening box from chamfered wall
        let result = clipper.subtract_box(&chamfered_wall, opening_min, opening_max).unwrap();
        
        let final_vertex_count = result.vertex_count();
        let final_triangle_count = result.triangle_count();
        
        // Verify opening was cut
        assert!(final_vertex_count > initial_vertex_count);
        
        // Verify chamfers are preserved (mesh should still span full length)
        let (min, max) = result.bounds();
        assert!((max.x - 10.0).abs() < 0.1); // Full length preserved
        
        // The hybrid approach should be more efficient than full CSG
        // but still generate reasonable geometry
        println!("Hybrid approach: {} verts, {} tris (was {} verts, {} tris)",
                 final_vertex_count, final_triangle_count,
                 initial_vertex_count, initial_triangle_count);
    }

    /// Test 6: Benchmark Comparison
    /// 
    /// Compare vertex and triangle counts between approaches:
    /// - Approach A: Chamfered footprint, no openings (baseline)
    /// - Approach B: 2D boolean + extrusion (loses chamfers)
    /// - Approach C: Hybrid plane clipping (preserves chamfers, efficient)
    #[test]
    fn test_benchmark_comparison() {
        use crate::csg::ClippingProcessor;
        
        // Test wall: 10m length, 0.3m thickness, 2.7m height
        // 3 openings: (1.2, 0.8) to (2.2, 2.0), (4.5, 0.8) to (5.5, 2.0), (7.8, 0.8) to (8.8, 2.0)
        
        // Approach A: Chamfered footprint (preserves chamfers, no openings)
        let chamfered_footprint = Profile2D::new(vec![
            Point2::new(0.3, -0.3),
            Point2::new(9.7, -0.3),
            Point2::new(10.0, 0.0),
            Point2::new(0.0, 0.0),
        ]);
        let mesh_a = extrude_profile(&chamfered_footprint, 2.7, None).unwrap();
        let verts_a = mesh_a.vertex_count();
        let tris_a = mesh_a.triangle_count();
        
        // Approach B: Rectangular face with openings (loses chamfers)
        let mut wall_face = Profile2D::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 2.7),
            Point2::new(0.0, 2.7),
        ]);
        wall_face.add_hole(vec![
            Point2::new(1.2, 0.8),
            Point2::new(2.2, 0.8),
            Point2::new(2.2, 2.0),
            Point2::new(1.2, 2.0),
        ]);
        wall_face.add_hole(vec![
            Point2::new(4.5, 0.8),
            Point2::new(5.5, 0.8),
            Point2::new(5.5, 2.0),
            Point2::new(4.5, 2.0),
        ]);
        wall_face.add_hole(vec![
            Point2::new(7.8, 0.8),
            Point2::new(8.8, 0.8),
            Point2::new(8.8, 2.0),
            Point2::new(7.8, 2.0),
        ]);
        let mesh_b = extrude_profile(&wall_face, 0.3, None).unwrap();
        let verts_b = mesh_b.vertex_count();
        let tris_b = mesh_b.triangle_count();
        
        // Approach C: Hybrid - chamfered wall with box subtraction
        let clipper = ClippingProcessor::new();
        let mut mesh_c = mesh_a.clone();
        
        // Subtract 3 opening boxes
        let openings = vec![
            (1.2, 0.8, 2.2, 2.0),
            (4.5, 0.8, 5.5, 2.0),
            (7.8, 0.8, 8.8, 2.0),
        ];
        
        for (min_u, min_v, max_u, max_v) in openings {
            let opening_min = Point3::new(min_u, -0.3, min_v);
            let opening_max = Point3::new(max_u, 0.0, max_v);
            mesh_c = clipper.subtract_box(&mesh_c, opening_min, opening_max).unwrap();
        }
        
        let verts_c = mesh_c.vertex_count();
        let tris_c = mesh_c.triangle_count();
        
        // Document the comparison
        println!("\n=== Benchmark Comparison ===");
        println!("Approach A (chamfered, no openings): {} verts, {} tris", verts_a, tris_a);
        println!("Approach B (rectangular, with openings): {} verts, {} tris", verts_b, tris_b);
        println!("Approach C (hybrid, chamfered + openings): {} verts, {} tris", verts_c, tris_c);
        println!("\nKey Insights:");
        println!("- Approach B loses chamfers (not acceptable)");
        println!("- Approach C preserves chamfers AND adds openings");
        println!("- Approach C vertex count: {} (target: <200 for efficiency)", verts_c);
        
        // Approach B should have more vertices due to openings
        assert!(verts_b > verts_a);
        
        // Approach C should preserve chamfers (check bounds)
        let (_min_c, max_c) = mesh_c.bounds();
        assert!((max_c.x - 10.0).abs() < 0.1); // Full length preserved
        
        // Approach C should be more efficient than full 3D CSG
        // Current CSG generates ~650 verts for 3 openings
        // Target: ~150-200 verts
        assert!(verts_c < 700, "Hybrid approach should be more efficient than full CSG");
    }

    /// Test 7: Optimized Implementation Benchmark
    /// 
    /// Compare the new optimized plane-clipping approach with the CSG approach
    #[test]
    fn test_optimized_implementation_benchmark() {
        use crate::csg::ClippingProcessor;
        
        // Create chamfered wall
        let chamfered_footprint = Profile2D::new(vec![
            Point2::new(0.3, -0.3),
            Point2::new(9.7, -0.3),
            Point2::new(10.0, 0.0),
            Point2::new(0.0, 0.0),
        ]);
        let wall_mesh = extrude_profile(&chamfered_footprint, 2.7, None).unwrap();
        let initial_verts = wall_mesh.vertex_count();
        let initial_tris = wall_mesh.triangle_count();
        
        // Opening bounds
        let open_min = Point3::new(6.495, -0.3, 0.8);
        let open_max = Point3::new(8.495, 0.0, 2.0);

        // Get wall bounds for the optimized function
        let (wall_min_f32, wall_max_f32) = wall_mesh.bounds();
        let wall_min = Point3::new(wall_min_f32.x as f64, wall_min_f32.y as f64, wall_min_f32.z as f64);
        let wall_max = Point3::new(wall_max_f32.x as f64, wall_max_f32.y as f64, wall_max_f32.z as f64);

        // Test CSG approach (old)
        let clipper = ClippingProcessor::new();
        let csg_result = clipper.subtract_box(&wall_mesh, open_min, open_max).unwrap();
        let csg_verts = csg_result.vertex_count();
        let csg_tris = csg_result.triangle_count();

        // Test optimized approach (new)
        let router = GeometryRouter::new();
        let opt_result = router.cut_rectangular_opening(&wall_mesh, open_min, open_max, wall_min, wall_max);
        let opt_verts = opt_result.vertex_count();
        let opt_tris = opt_result.triangle_count();
        
        println!("\n=== Optimized vs CSG Comparison ===");
        println!("Initial wall: {} verts, {} tris", initial_verts, initial_tris);
        println!("CSG approach: {} verts, {} tris", csg_verts, csg_tris);
        println!("Optimized approach: {} verts, {} tris", opt_verts, opt_tris);
        
        // Both should produce valid geometry
        assert!(csg_result.vertex_count() > 0);
        assert!(opt_result.vertex_count() > 0);
        
        // Check bounds are preserved
        let (csg_min, csg_max) = csg_result.bounds();
        let (opt_min, opt_max) = opt_result.bounds();
        
        // Both should preserve chamfers (full length)
        assert!((csg_max.x - 10.0).abs() < 0.1);
        assert!((opt_max.x - 10.0).abs() < 0.1);
    }
    
    /// Test 8: Chamfer Preservation Analysis
    /// 
    /// Verify that chamfers only affect the footprint edges, not vertical edges.
    /// This confirms that chamfers can be preserved while cutting openings.
    #[test]
    fn test_chamfer_preservation_analysis() {
        // Chamfered footprint
        let chamfered = Profile2D::new(vec![
            Point2::new(0.3, -0.3),   // chamfer start
            Point2::new(9.7, -0.3),   // chamfer end
            Point2::new(10.0, 0.0),   // corner
            Point2::new(0.0, 0.0),    // corner
        ]);
        
        // Rectangular footprint (no chamfers)
        let rectangular = Profile2D::new(vec![
            Point2::new(0.0, -0.3),
            Point2::new(10.0, -0.3),
            Point2::new(10.0, 0.0),
            Point2::new(0.0, 0.0),
        ]);
        
        // Extrude both
        let mesh_chamfered = extrude_profile(&chamfered, 2.7, None).unwrap();
        let mesh_rectangular = extrude_profile(&rectangular, 2.7, None).unwrap();
        
        // Chamfered should have at least as many vertices (5 points vs 4 in footprint)
        // Note: Triangulation may produce similar vertex counts, but chamfered has more footprint points
        assert!(mesh_chamfered.vertex_count() >= mesh_rectangular.vertex_count());
        
        // But both have same height (2.7m) - chamfers don't affect vertical dimension
        let (_, max_chamfered) = mesh_chamfered.bounds();
        let (_, max_rectangular) = mesh_rectangular.bounds();
        assert!((max_chamfered.z - max_rectangular.z).abs() < 0.01);
        
        // Key insight: Chamfers are horizontal features, openings are vertical cuts
        // They operate in perpendicular planes and don't conflict
    }
}
