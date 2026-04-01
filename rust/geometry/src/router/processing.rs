// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Core element processing: resolving representations, processing items, and caching.

use super::GeometryRouter;
use crate::{Error, Mesh, Result, SubMeshCollection};
use ifc_lite_core::{has_geometry_by_name, DecodedEntity, EntityDecoder, GeometryCategory, IfcType};
use nalgebra::Matrix4;
use rustc_hash::FxHashSet;
use std::sync::Arc;

/// Maximum nested IfcMappedItem depth we will traverse for a single geometry item.
const MAX_MAPPED_ITEM_DEPTH: usize = 32;

impl GeometryRouter {
    /// Compute median-based RTC offset from sampled translations.
    /// Returns `(0,0,0)` if empty or coordinates are within 10km of origin.
    fn rtc_offset_from_translations(translations: &[(f64, f64, f64)]) -> (f64, f64, f64) {
        if translations.is_empty() {
            return (0.0, 0.0, 0.0);
        }

        let mut x: Vec<f64> = translations.iter().map(|(x, _, _)| *x).collect();
        let mut y: Vec<f64> = translations.iter().map(|(_, y, _)| *y).collect();
        let mut z: Vec<f64> = translations.iter().map(|(_, _, z)| *z).collect();

        x.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        y.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        z.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let mid = x.len() / 2;
        let centroid = (
            *x.get(mid).unwrap_or(&0.0),
            *y.get(mid).unwrap_or(&0.0),
            *z.get(mid).unwrap_or(&0.0),
        );

        const THRESHOLD: f64 = 10000.0;
        if centroid.0.abs() > THRESHOLD
            || centroid.1.abs() > THRESHOLD
            || centroid.2.abs() > THRESHOLD
        {
            return centroid;
        }

        (0.0, 0.0, 0.0)
    }

    /// Sample a building element's world-space translation for RTC offset detection.
    /// Returns `Some((tx, ty, tz))` if the element has a valid placement transform.
    fn sample_element_translation(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Option<(f64, f64, f64)> {
        let has_rep = entity.get(6).map(|a| !a.is_null()).unwrap_or(false);
        if !has_rep {
            return None;
        }
        let mut transform = self
            .get_placement_transform_from_element(entity, decoder)
            .ok()?;
        self.scale_transform(&mut transform);
        let tx = transform[(0, 3)];
        let ty = transform[(1, 3)];
        let tz = transform[(2, 3)];
        if tx.is_finite() && ty.is_finite() && tz.is_finite() {
            Some((tx, ty, tz))
        } else {
            None
        }
    }

    /// Detect RTC offset by scanning the file for building elements.
    /// Used by synchronous parse paths.
    pub fn detect_rtc_offset_from_first_element(
        &self,
        content: &str,
        decoder: &mut EntityDecoder,
    ) -> (f64, f64, f64) {
        use ifc_lite_core::EntityScanner;

        let mut scanner = EntityScanner::new(content);
        let mut translations: Vec<(f64, f64, f64)> = Vec::new();
        const MAX_SAMPLES: usize = 50;

        while let Some((_id, type_name, start, end)) = scanner.next_entity() {
            if translations.len() >= MAX_SAMPLES {
                break;
            }
            // Use the canonical has_geometry_by_name check from the schema
            // instead of a hardcoded list — any entity class with geometry
            // is a valid candidate for RTC offset sampling.
            if !has_geometry_by_name(type_name) {
                continue;
            }
            if let Ok(entity) = decoder.decode_at(start, end) {
                if let Some(t) = self.sample_element_translation(&entity, decoder) {
                    translations.push(t);
                }
            }
        }

        Self::rtc_offset_from_translations(&translations)
    }

    /// Detect RTC offset using pre-collected geometry jobs (avoids re-scanning the file).
    /// Returns `None` when no usable translation samples were found, allowing
    /// callers to distinguish "no shift needed" from "detection had no data".
    pub fn detect_rtc_offset_from_jobs(
        &self,
        jobs: &[(u32, usize, usize, IfcType)],
        decoder: &mut EntityDecoder,
    ) -> Option<(f64, f64, f64)> {
        const MAX_SAMPLES: usize = 50;
        let translations: Vec<(f64, f64, f64)> = jobs
            .iter()
            .take(MAX_SAMPLES)
            .filter_map(|&(id, start, end, _)| {
                let entity = decoder.decode_at_with_id(id, start, end).ok()?;
                self.sample_element_translation(&entity, decoder)
            })
            .collect();

        if translations.is_empty() {
            return None;
        }
        Some(Self::rtc_offset_from_translations(&translations))
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
                            | "SolidModel"
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
                            | "SolidModel"
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
                            | "SolidModel"
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
                            | "SolidModel"
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
        let mut visited = FxHashSet::default();
        self.collect_submeshes_from_item_inner(item, decoder, sub_meshes, 0, &mut visited)
    }

    fn collect_submeshes_from_item_inner(
        &self,
        item: &DecodedEntity,
        decoder: &mut EntityDecoder,
        sub_meshes: &mut SubMeshCollection,
        depth: usize,
        visited: &mut FxHashSet<u32>,
    ) -> Result<()> {
        if depth >= MAX_MAPPED_ITEM_DEPTH {
            return Err(Error::geometry(format!(
                "MappedItem nesting exceeded maximum depth of {} at #{}",
                MAX_MAPPED_ITEM_DEPTH, item.id
            )));
        }

        // For MappedItem, recurse into the mapped representation
        if item.ifc_type == IfcType::IfcMappedItem {
            if !visited.insert(item.id) {
                return Err(Error::geometry(format!(
                    "Detected cyclic IfcMappedItem reference at #{}",
                    item.id
                )));
            }

            // Get MappingSource (RepresentationMap)
            let source_attr = item
                .get(0)
                .ok_or_else(|| Error::geometry("MappedItem missing MappingSource".to_string()))?;

            let source_entity = decoder
                .resolve_ref(source_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve MappingSource".to_string()))?;

            // Get MappedRepresentation from RepresentationMap (attribute 1)
            let mapped_repr_attr = source_entity.get(1).ok_or_else(|| {
                Error::geometry("RepresentationMap missing MappedRepresentation".to_string())
            })?;

            let mapped_repr = decoder.resolve_ref(mapped_repr_attr)?.ok_or_else(|| {
                Error::geometry("Failed to resolve MappedRepresentation".to_string())
            })?;

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
                    // Recursively collect sub-meshes (skip unsupported geometry types)
                    let count_before = sub_meshes.len();
                    if let Err(_e) = self.collect_submeshes_from_item_inner(
                        &nested_item,
                        decoder,
                        sub_meshes,
                        depth + 1,
                        visited,
                    ) {
                        #[cfg(debug_assertions)]
                        eprintln!(
                            "[ifc-lite] Skipping unsupported nested geometry #{} ({:?}): {}",
                            nested_item.id, nested_item.ifc_type, _e
                        );
                        continue;
                    }

                    // Apply MappedItem transform to newly added sub-meshes
                    if let Some(mut transform) = mapping_transform.clone() {
                        self.scale_transform(&mut transform);
                        for sub in &mut sub_meshes.sub_meshes[count_before..] {
                            self.transform_mesh(&mut sub.mesh, &transform);
                        }
                    }
                }
            }

            visited.remove(&item.id);
        } else {
            // Regular geometry item - process and record with its ID
            // Skip unsupported geometry types (e.g. IfcGeometricSet) instead of failing
            match self.process_representation_item(item, decoder) {
                Ok(mesh) => {
                    if !mesh.is_empty() {
                        sub_meshes.add(item.id, mesh);
                    }
                }
                Err(_e) => {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[ifc-lite] Skipping unsupported geometry #{} ({:?}): {}",
                        item.id, item.ifc_type, _e
                    );
                }
            }
        }

        Ok(())
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
                            | "SolidModel"
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
                            | "SolidModel"
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
            // Safety net: strip any out-of-bounds indices before downstream use
            mesh.validate_indices();
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

        // Process all items and merge
        // Skip nested MappedItems AND IfcBooleanClippingResult that reference MappedItems
        // to prevent stack overflow from deeply nested recursive geometry
        let mut mesh = Mesh::new();
        for sub_item in items {
            if sub_item.ifc_type == IfcType::IfcMappedItem {
                continue;
            }
            if let Some(processor) = self.processors.get(&sub_item.ifc_type) {
                if let Ok(mut sub_mesh) = processor.process(&sub_item, decoder, &self.schema) {
                    sub_mesh.validate_indices();
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
}
