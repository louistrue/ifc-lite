// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometry Router - Dynamic dispatch to geometry processors
//!
//! Routes IFC representation entities to appropriate processors based on type.

use crate::bool2d::subtract_multiple_2d;
use crate::csg::ClippingProcessor;
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
use crate::{Error, Mesh, Point3, Result, Vector3};
use ifc_lite_core::{DecodedEntity, EntityDecoder, GeometryCategory, IfcSchema, IfcType};
use nalgebra::{Matrix4, Point2};
use rustc_hash::FxHashMap;
use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

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

    /// Create router with pre-calculated unit scale
    pub fn with_scale(unit_scale: f64) -> Self {
        let mut router = Self::new();
        router.unit_scale = unit_scale;
        router
    }

    /// Get the current unit scale factor
    pub fn unit_scale(&self) -> f64 {
        self.unit_scale
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

    /// Process element with void subtraction (openings)
    /// Uses fast box subtraction with bitflag classification for O(n) performance
    #[inline]
    pub fn process_element_with_voids(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &rustc_hash::FxHashMap<u32, Vec<u32>>,
    ) -> Result<Mesh> {
        // Get base geometry
        let mut mesh = self.process_element(element, decoder)?;

        if mesh.is_empty() {
            return Ok(mesh);
        }

        // Check if this element has any openings
        let opening_ids = match void_index.get(&element.id) {
            Some(ids) => ids,
            None => return Ok(mesh), // No openings, return base mesh
        };

        if opening_ids.is_empty() {
            return Ok(mesh);
        }

        // Get opening geometries and subtract using CSG
        use crate::csg::ClippingProcessor;
        let clipper = ClippingProcessor::new();

        // Get host bounding box for edge detection
        let (host_min, host_max) = mesh.bounds();

        // Find host's "thickness" direction (smallest dimension)
        let host_size_x = host_max.x - host_min.x;
        let host_size_y = host_max.y - host_min.y;
        let host_size_z = host_max.z - host_min.z;

        let thickness_axis = if host_size_x <= host_size_y && host_size_x <= host_size_z {
            0 // X is thickness (wall in YZ plane)
        } else if host_size_y <= host_size_x && host_size_y <= host_size_z {
            1 // Y is thickness (wall in XZ plane)
        } else {
            2 // Z is thickness (slab in XY plane)
        };

        let padding = 0.01; // 1cm tolerance

        // STEP 1: Collect all valid openings into a combined mesh
        // This avoids CSG issues with adjacent openings creating new edges
        let mut combined_openings = Mesh::new();

        for &opening_id in opening_ids {
            let opening_entity = match decoder.decode_by_id(opening_id) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let opening_mesh = match self.process_element(&opening_entity, decoder) {
                Ok(m) => m,
                Err(_) => continue,
            };

            if opening_mesh.is_empty() {
                continue;
            }

            // Extend opening slightly in thickness direction to avoid coplanar faces
            // This ensures CSG works reliably even when opening bounds match host bounds
            let extend = 0.01; // 1cm extension on each side

            let mut extended_mesh = opening_mesh;
            let (open_min, open_max) = extended_mesh.bounds();

            // Check if opening needs extension in thickness direction
            let needs_extension = match thickness_axis {
                0 => {
                    (open_min.x - host_min.x).abs() < padding
                        || (open_max.x - host_max.x).abs() < padding
                }
                1 => {
                    (open_min.y - host_min.y).abs() < padding
                        || (open_max.y - host_max.y).abs() < padding
                }
                _ => {
                    (open_min.z - host_min.z).abs() < padding
                        || (open_max.z - host_max.z).abs() < padding
                }
            };

            if needs_extension {
                // Scale mesh slightly in thickness direction from its center
                let center = [
                    (open_min.x + open_max.x) / 2.0,
                    (open_min.y + open_max.y) / 2.0,
                    (open_min.z + open_max.z) / 2.0,
                ];
                let size = [
                    open_max.x - open_min.x,
                    open_max.y - open_min.y,
                    open_max.z - open_min.z,
                ];

                // Calculate scale factor to add 'extend' on each side
                let scale = match thickness_axis {
                    0 => [(size[0] + 2.0 * extend) / size[0].max(0.001), 1.0, 1.0],
                    1 => [1.0, (size[1] + 2.0 * extend) / size[1].max(0.001), 1.0],
                    _ => [1.0, 1.0, (size[2] + 2.0 * extend) / size[2].max(0.001)],
                };

                // Apply scaling from center
                for i in 0..(extended_mesh.positions.len() / 3) {
                    let px = extended_mesh.positions[i * 3];
                    let py = extended_mesh.positions[i * 3 + 1];
                    let pz = extended_mesh.positions[i * 3 + 2];

                    extended_mesh.positions[i * 3] = center[0] + (px - center[0]) * scale[0];
                    extended_mesh.positions[i * 3 + 1] = center[1] + (py - center[1]) * scale[1];
                    extended_mesh.positions[i * 3 + 2] = center[2] + (pz - center[2]) * scale[2];
                }
            }

            // Add to combined openings mesh
            combined_openings.merge(&extended_mesh);
        }

        // STEP 2: Do a single CSG subtraction with all openings combined
        // This handles adjacent openings correctly
        if !combined_openings.is_empty() {
            if let Ok(subtracted) = clipper.subtract_mesh(&mesh, &combined_openings) {
                // Basic sanity check: result must have triangles and valid geometry
                let has_valid_positions = subtracted.positions.iter().all(|&v| v.is_finite());
                let has_triangles = subtracted.triangle_count() > 0;

                if has_triangles && has_valid_positions {
                    mesh = subtracted;
                }
            }
            // Keep original mesh if CSG fails
        }

        Ok(mesh)
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

        let extrusion_direction = self.parse_direction(&direction_entity)?;

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

        // Apply extrusion position transform
        if position_transform != Matrix4::identity() {
            crate::extrusion::apply_transform(&mut mesh, &position_transform);
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

                for point_entity in point_entities {
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
            _ => return Ok(()), // No placement
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
    fn get_placement_transform(
        &self,
        placement: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Matrix4<f64>> {
        if placement.ifc_type != IfcType::IfcLocalPlacement {
            return Ok(Matrix4::identity());
        }

        // Get parent transform first (attribute 0: PlacementRelTo)
        let parent_transform = if let Some(parent_attr) = placement.get(0) {
            if !parent_attr.is_null() {
                if let Some(parent) = decoder.resolve_ref(parent_attr)? {
                    self.get_placement_transform(&parent, decoder)?
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
    #[inline]
    fn transform_mesh(&self, mesh: &mut Mesh, transform: &Matrix4<f64>) {
        // Use chunks for better cache locality and less indexing overhead
        mesh.positions.chunks_exact_mut(3).for_each(|chunk| {
            let point = Point3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
            let transformed = transform.transform_point(&point);
            chunk[0] = transformed.x as f32;
            chunk[1] = transformed.y as f32;
            chunk[2] = transformed.z as f32;
        });

        // Transform normals (without translation) - optimized chunk iteration
        let rotation = transform.fixed_view::<3, 3>(0, 0);
        mesh.normals.chunks_exact_mut(3).for_each(|chunk| {
            let normal = Vector3::new(chunk[0] as f64, chunk[1] as f64, chunk[2] as f64);
            let transformed = (rotation * normal).normalize();
            chunk[0] = transformed.x as f32;
            chunk[1] = transformed.y as f32;
            chunk[2] = transformed.z as f32;
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
