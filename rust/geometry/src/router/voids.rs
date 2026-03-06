// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Void (opening) subtraction: 3D CSG, AABB clipping, and triangle-box intersection.

use super::GeometryRouter;
use crate::csg::{ClipResult, ClippingProcessor, Plane, Triangle, TriangleVec};
use crate::{Error, Mesh, Point3, Result, Vector3};
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcType};
use nalgebra::Matrix4;
use rustc_hash::FxHashMap;

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

impl GeometryRouter {
    /// Get individual bounding boxes for each representation item in an opening element.
    /// This handles disconnected geometry (e.g., two separate window openings in one IfcOpeningElement)
    /// by returning separate bounds for each item instead of one combined bounding box.

    /// Extract extrusion direction and position transform from IfcExtrudedAreaSolid
    /// Returns (local_direction, position_transform)
    fn extract_extrusion_direction_from_solid(
        &self,
        solid: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Option<(Vector3<f64>, Option<Matrix4<f64>>)> {
        // Get ExtrudedDirection (attribute 2: IfcDirection)
        let direction_attr = solid.get(2)?;
        let direction_entity = decoder.resolve_ref(direction_attr).ok()??;
        let local_dir = self.parse_direction(&direction_entity).ok()?;

        // Get Position transform (attribute 1: IfcAxis2Placement3D)
        let position_transform = if let Some(pos_attr) = solid.get(1) {
            if !pos_attr.is_null() {
                if let Ok(Some(pos_entity)) = decoder.resolve_ref(pos_attr) {
                    if pos_entity.ifc_type == IfcType::IfcAxis2Placement3D {
                        self.parse_axis2_placement_3d(&pos_entity, decoder).ok()
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

        Some((local_dir, position_transform))
    }

    /// Recursively extract extrusion direction and position transform from representation item
    /// Handles IfcExtrudedAreaSolid, IfcBooleanClippingResult, and IfcMappedItem
    /// Returns (local_direction, position_transform) where direction is in local space
    fn extract_extrusion_direction_recursive(
        &self,
        item: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Option<(Vector3<f64>, Option<Matrix4<f64>>)> {
        match item.ifc_type {
            IfcType::IfcExtrudedAreaSolid => {
                // Direct extraction from ExtrudedDirection (attribute 2) and Position (attribute 1)
                self.extract_extrusion_direction_from_solid(item, decoder)
            }
            IfcType::IfcBooleanClippingResult | IfcType::IfcBooleanResult => {
                // FirstOperand (attribute 1) contains base geometry
                let first_attr = item.get(1)?;
                let first_operand = decoder.resolve_ref(first_attr).ok()??;
                self.extract_extrusion_direction_recursive(&first_operand, decoder)
            }
            IfcType::IfcMappedItem => {
                // MappingSource (attribute 0) -> MappedRepresentation -> Items
                let source_attr = item.get(0)?;
                let source = decoder.resolve_ref(source_attr).ok()??;
                // RepresentationMap.MappedRepresentation is attribute 1
                let rep_attr = source.get(1)?;
                let rep = decoder.resolve_ref(rep_attr).ok()??;

                // MappingTarget (attribute 1) -> instance transform
                let mapping_transform = if let Some(target_attr) = item.get(1) {
                    if !target_attr.is_null() {
                        if let Ok(Some(target)) = decoder.resolve_ref(target_attr) {
                            self.parse_cartesian_transformation_operator(&target, decoder).ok()
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Get first item from representation
                let items_attr = rep.get(3)?;
                let items = decoder.resolve_ref_list(items_attr).ok()?;
                items.first().and_then(|first| {
                    self.extract_extrusion_direction_recursive(first, decoder).map(|(dir, pos)| {
                        // Combine MappingTarget transform with position transform
                        let combined = match (mapping_transform.as_ref(), pos) {
                            (Some(map), Some(pos)) => Some(map * pos),
                            (Some(map), None) => Some(map.clone()),
                            (None, Some(pos)) => Some(pos),
                            (None, None) => None,
                        };
                        (dir, combined)
                    })
                })
            }
            _ => None,
        }
    }

    /// Get opening item bounds with extrusion direction for each representation item
    /// Returns Vec of (min, max, extrusion_direction) tuples
    /// Extrusion direction is in world coordinates, normalized
    /// Returns None for extrusion direction if it cannot be extracted (fallback to bounds-only)
    fn get_opening_item_bounds_with_direction(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<(Point3<f64>, Point3<f64>, Option<Vector3<f64>>)>> {
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
                // Try to extract extrusion direction recursively (handles wrappers)
                let extrusion_direction = if let Some((local_dir, position_transform)) =
                    self.extract_extrusion_direction_recursive(&item, decoder)
                {
                    // Transform extrusion direction from local to world coordinates
                    if let Some(pos_transform) = position_transform {
                        // Extract rotation matrix (3x3 upper-left of 4x4 transform)
                        let rot_x = Vector3::new(
                            pos_transform[(0, 0)],
                            pos_transform[(1, 0)],
                            pos_transform[(2, 0)],
                        );
                        let rot_y = Vector3::new(
                            pos_transform[(0, 1)],
                            pos_transform[(1, 1)],
                            pos_transform[(2, 1)],
                        );
                        let rot_z = Vector3::new(
                            pos_transform[(0, 2)],
                            pos_transform[(1, 2)],
                            pos_transform[(2, 2)],
                        );

                        // Transform local direction to world space
                        // Use try_normalize to guard against zero-length vectors
                        let world_dir = (rot_x * local_dir.x
                            + rot_y * local_dir.y
                            + rot_z * local_dir.z)
                            .try_normalize(1e-12)
                            .ok_or_else(|| Error::geometry("Zero-length direction vector".to_string()))?;

                        // Apply element placement transform
                        let element_rot_x = Vector3::new(
                            placement_transform[(0, 0)],
                            placement_transform[(1, 0)],
                            placement_transform[(2, 0)],
                        );
                        let element_rot_y = Vector3::new(
                            placement_transform[(0, 1)],
                            placement_transform[(1, 1)],
                            placement_transform[(2, 1)],
                        );
                        let element_rot_z = Vector3::new(
                            placement_transform[(0, 2)],
                            placement_transform[(1, 2)],
                            placement_transform[(2, 2)],
                        );

                        let final_dir = (element_rot_x * world_dir.x
                            + element_rot_y * world_dir.y
                            + element_rot_z * world_dir.z)
                            .try_normalize(1e-12)
                            .ok_or_else(|| Error::geometry("Zero-length direction vector".to_string()))?;

                        Some(final_dir)
                    } else {
                        // No position transform, use local direction directly
                        // Still need to apply element placement
                        let element_rot_x = Vector3::new(
                            placement_transform[(0, 0)],
                            placement_transform[(1, 0)],
                            placement_transform[(2, 0)],
                        );
                        let element_rot_y = Vector3::new(
                            placement_transform[(0, 1)],
                            placement_transform[(1, 1)],
                            placement_transform[(2, 1)],
                        );
                        let element_rot_z = Vector3::new(
                            placement_transform[(0, 2)],
                            placement_transform[(1, 2)],
                            placement_transform[(2, 2)],
                        );

                        let final_dir = (element_rot_x * local_dir.x
                            + element_rot_y * local_dir.y
                            + element_rot_z * local_dir.z)
                            .try_normalize(1e-12)
                            .ok_or_else(|| Error::geometry("Zero-length direction vector".to_string()))?;

                        Some(final_dir)
                    }
                } else {
                    None
                };

                // Get mesh bounds (same as original function)
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

                // Apply RTC offset to opening bounds so they match wall mesh coordinate system
                // Wall mesh positions have RTC subtracted during transform_mesh, so opening bounds must match
                let rtc = self.rtc_offset;
                let rtc_min = Point3::new(
                    world_min.x - rtc.0,
                    world_min.y - rtc.1,
                    world_min.z - rtc.2,
                );
                let rtc_max = Point3::new(
                    world_max.x - rtc.0,
                    world_max.y - rtc.1,
                    world_max.z - rtc.2,
                );

                bounds_list.push((rtc_min, rtc_max, extrusion_direction));
            }
        }

        Ok(bounds_list)
    }

    /// Process element with void subtraction (openings)
    /// Process element with voids using optimized plane clipping
    ///
    /// This approach is more efficient than full 3D CSG for rectangular openings:
    /// 1. Get chamfered wall mesh (preserves chamfered corners)
    /// 2. For each opening, use optimized box cutting with internal face generation
    /// 3. Apply any clipping operations (roof clips) from original representation
    #[inline]
    /// Process an element with void subtraction (openings).
    ///
    /// This function handles three distinct cases for cutting openings:
    ///
    /// 1. **Floor/Slab openings** (vertical Z-extrusion): Uses CSG with actual mesh geometry
    ///    because the XY footprint may be rotated relative to the slab orientation.
    ///
    /// 2. **Wall openings** (horizontal X/Y-extrusion, axis-aligned): Uses AABB clipping
    ///    for fast, accurate cutting of rectangular openings.
    ///
    /// 3. **Diagonal wall openings**: Uses AABB clipping without internal face generation
    ///    to avoid rotation artifacts.
    ///
    /// **Note**: Reveal (jamb/sill/head) faces are generated for axis-aligned rectangular
    /// openings.  Diagonal openings skip reveal face generation to avoid rotation artifacts.
    pub fn process_element_with_voids(
        &self,
        element: &DecodedEntity,
        decoder: &mut EntityDecoder,
        void_index: &FxHashMap<u32, Vec<u32>>,
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

        // STEP 5: Collect opening meshes (one per opening element).
        // All openings go through CSG (boolean difference) which correctly produces
        // all interior faces (jambs, sill, head) without manual reveal-quad generation.
        // AABB clipping is kept only as a fallback when CSG fails or produces degenerate
        // results, and for simple axis-aligned openings when CSG exceeds the safety limit.
        let mut opening_meshes: Vec<Mesh> = Vec::new();
        for &opening_id in opening_ids.iter() {
            let opening_entity = match decoder.decode_by_id(opening_id) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let opening_mesh = match self.process_element(&opening_entity, decoder) {
                Ok(m) if !m.is_empty() => m,
                _ => continue,
            };

            opening_meshes.push(opening_mesh);
        }

        if opening_meshes.is_empty() {
            return self.process_element(element, decoder);
        }

        // STEP 6: Cut openings using CSG boolean difference.
        use crate::csg::ClippingProcessor;
        let clipper = ClippingProcessor::new();
        let mut result = wall_mesh;

        // Get wall bounds (needed for AABB fallback path).
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

        // Validate wall mesh ONCE before CSG operations.
        let wall_valid = !result.is_empty()
            && result.positions.iter().all(|&v| v.is_finite())
            && result.triangle_count() >= 4;

        if !wall_valid {
            return Ok(result);
        }

        // Safety limit: cap total CSG operations to prevent runaway processing on large models.
        let mut csg_operation_count = 0;
        const MAX_CSG_OPERATIONS: usize = 15;

        for (i, opening_mesh) in opening_meshes.iter().enumerate() {
            // Validate opening mesh.
            let opening_valid = !opening_mesh.is_empty()
                && opening_mesh.positions.iter().all(|&v| v.is_finite())
                && opening_mesh.positions.len() >= 9;

            if !opening_valid {
                continue;
            }

            if csg_operation_count >= MAX_CSG_OPERATIONS {
                // Over limit: attempt cheap AABB fallback for any remaining openings.
                let (open_min_f32, open_max_f32) = opening_mesh.bounds();
                let open_min = Point3::new(open_min_f32.x as f64, open_min_f32.y as f64, open_min_f32.z as f64);
                let open_max = Point3::new(open_max_f32.x as f64, open_max_f32.y as f64, open_max_f32.z as f64);
                result = self.cut_rectangular_opening_no_faces(&result, open_min, open_max);
                continue;
            }

            // Primary path: CSG boolean difference.
            // CSG produces all faces (including jambs, sill, head) correctly.
            let csg_ok = match clipper.subtract_mesh(&result, opening_mesh) {
                Ok(csg_result) if !csg_result.is_empty() && csg_result.triangle_count() >= 4 => {
                    result = csg_result;
                    true
                }
                _ => false,
            };
            csg_operation_count += 1;

            if !csg_ok {
                // CSG failed or produced degenerate geometry — fall back to AABB clipping.
                // Try to get the extrusion direction for better reveal face generation.
                let opening_id = opening_ids.get(i).copied();
                let extrusion_dir = opening_id
                    .and_then(|id| decoder.decode_by_id(id).ok())
                    .and_then(|ent| {
                        self.get_opening_item_bounds_with_direction(&ent, decoder)
                            .ok()
                            .and_then(|v| v.into_iter().next())
                            .and_then(|(_, _, dir)| dir)
                    });

                let (open_min_f32, open_max_f32) = opening_mesh.bounds();
                let open_min = Point3::new(open_min_f32.x as f64, open_min_f32.y as f64, open_min_f32.z as f64);
                let open_max = Point3::new(open_max_f32.x as f64, open_max_f32.y as f64, open_max_f32.z as f64);

                let (final_min, final_max) = if let Some(dir) = extrusion_dir {
                    self.extend_opening_along_direction(open_min, open_max, wall_min, wall_max, dir)
                } else {
                    (open_min, open_max)
                };

                result = self.cut_rectangular_opening(&result, final_min, final_max, wall_min, wall_max, extrusion_dir);
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
    /// Extend opening bounds along extrusion direction to match wall extent
    ///
    /// Projects wall corners onto the extrusion axis and extends the opening
    /// min/max to cover the wall's full extent along that direction.
    /// This ensures openings penetrate multi-layer walls correctly without
    /// causing artifacts for angled walls.
    fn extend_opening_along_direction(
        &self,
        open_min: Point3<f64>,
        open_max: Point3<f64>,
        wall_min: Point3<f64>,
        wall_max: Point3<f64>,
        extrusion_direction: Vector3<f64>,  // World-space, normalized
    ) -> (Point3<f64>, Point3<f64>) {
        // Use opening center as reference point for projection
        let open_center = Point3::new(
            (open_min.x + open_max.x) * 0.5,
            (open_min.y + open_max.y) * 0.5,
            (open_min.z + open_max.z) * 0.5,
        );

        // Project all 8 corners of the wall box onto the extrusion axis
        let wall_corners = [
            Point3::new(wall_min.x, wall_min.y, wall_min.z),
            Point3::new(wall_max.x, wall_min.y, wall_min.z),
            Point3::new(wall_min.x, wall_max.y, wall_min.z),
            Point3::new(wall_max.x, wall_max.y, wall_min.z),
            Point3::new(wall_min.x, wall_min.y, wall_max.z),
            Point3::new(wall_max.x, wall_min.y, wall_max.z),
            Point3::new(wall_min.x, wall_max.y, wall_max.z),
            Point3::new(wall_max.x, wall_max.y, wall_max.z),
        ];

        // Find min/max projections of wall corners onto extrusion axis
        let mut wall_min_proj = f64::INFINITY;
        let mut wall_max_proj = f64::NEG_INFINITY;

        for corner in &wall_corners {
            // Project corner onto extrusion axis relative to opening center
            let proj = (corner - open_center).dot(&extrusion_direction);
            wall_min_proj = wall_min_proj.min(proj);
            wall_max_proj = wall_max_proj.max(proj);
        }

        // Project opening corners onto extrusion axis
        let open_corners = [
            Point3::new(open_min.x, open_min.y, open_min.z),
            Point3::new(open_max.x, open_min.y, open_min.z),
            Point3::new(open_min.x, open_max.y, open_min.z),
            Point3::new(open_max.x, open_max.y, open_min.z),
            Point3::new(open_min.x, open_min.y, open_max.z),
            Point3::new(open_max.x, open_min.y, open_max.z),
            Point3::new(open_min.x, open_max.y, open_max.z),
            Point3::new(open_max.x, open_max.y, open_max.z),
        ];

        let mut open_min_proj = f64::INFINITY;
        let mut open_max_proj = f64::NEG_INFINITY;

        for corner in &open_corners {
            let proj = (corner - open_center).dot(&extrusion_direction);
            open_min_proj = open_min_proj.min(proj);
            open_max_proj = open_max_proj.max(proj);
        }

        // Calculate how much to extend in each direction along the extrusion axis
        // If wall extends beyond opening, we need to extend the opening
        let extend_backward = (open_min_proj - wall_min_proj).max(0.0);  // How much wall extends before opening
        let extend_forward = (wall_max_proj - open_max_proj).max(0.0);   // How much wall extends after opening

        // Extend opening bounds along the extrusion direction
        let extended_min = open_min - extrusion_direction * extend_backward;
        let extended_max = open_max + extrusion_direction * extend_forward;

        // Create new AABB that encompasses both original opening and extended points
        // This ensures we don't shrink the opening in other dimensions
        let all_points = [
            open_min, open_max,
            extended_min, extended_max,
        ];

        let new_min = Point3::new(
            all_points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            all_points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            all_points.iter().map(|p| p.z).fold(f64::INFINITY, f64::min),
        );
        let new_max = Point3::new(
            all_points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            all_points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
            all_points.iter().map(|p| p.z).fold(f64::NEG_INFINITY, f64::max),
        );

        (new_min, new_max)
    }

    /// Cut a rectangular opening from a mesh using AABB clipping, then add reveal faces
    /// (internal cap faces on the wall thickness around the opening — jambs, sill, head).
    ///
    /// `wall_min`/`wall_max` are the original wall mesh bounds BEFORE any cutting and
    /// are used to determine the wall thickness direction and to clamp the reveal faces.
    /// `extrusion_dir` is the world-space direction the opening extrudes through the wall;
    /// when provided it is used to determine the thickness axis robustly instead of
    /// relying on the AABB spanning heuristic.
    pub(super) fn cut_rectangular_opening(
        &self,
        mesh: &Mesh,
        open_min: Point3<f64>,
        open_max: Point3<f64>,
        wall_min: Point3<f64>,
        wall_max: Point3<f64>,
        extrusion_dir: Option<Vector3<f64>>,
    ) -> Mesh {
        let mut result = self.cut_rectangular_opening_no_faces(mesh, open_min, open_max);
        self.generate_opening_reveal_faces(&mut result, open_min, open_max, wall_min, wall_max, extrusion_dir);
        result
    }

    /// Generate the four reveal (jamb/sill/head) faces around a rectangular opening.
    ///
    /// Determines which axis is the "through" axis (wall thickness direction) either
    /// directly from `extrusion_dir` (most reliable) or by finding the axis along which
    /// the opening fully spans the wall.  Then emits two quads on each of the other two
    /// axes at `open_min[axis]` and `open_max[axis]`, clamped to the actual wall bounds
    /// so faces never extend outside the wall geometry.
    fn generate_opening_reveal_faces(
        &self,
        result: &mut Mesh,
        open_min: Point3<f64>,
        open_max: Point3<f64>,
        wall_min: Point3<f64>,
        wall_max: Point3<f64>,
        extrusion_dir: Option<Vector3<f64>>,
    ) {
        const EPSILON: f64 = 1e-4;

        let open_lo = [open_min.x, open_min.y, open_min.z];
        let open_hi = [open_max.x, open_max.y, open_max.z];
        let wall_lo = [wall_min.x, wall_min.y, wall_min.z];
        let wall_hi = [wall_max.x, wall_max.y, wall_max.z];

        // Find the axis along which the opening passes through the wall (thickness direction).
        // Prefer the extrusion direction (authoritative from IFC) over the AABB heuristic,
        // which can fail when the opening is not extended far enough along the thickness axis.
        let through_axis = if let Some(dir) = extrusion_dir {
            // Use the dominant world axis of the extrusion direction.
            let abs = [dir.x.abs(), dir.y.abs(), dir.z.abs()];
            if abs[0] >= abs[1] && abs[0] >= abs[2] {
                0
            } else if abs[1] >= abs[0] && abs[1] >= abs[2] {
                1
            } else {
                2
            }
        } else {
            // Fallback: find the axis along which the opening fully spans the wall bounds.
            match (0..3usize).find(|&a| {
                open_lo[a] <= wall_lo[a] + EPSILON && open_hi[a] >= wall_hi[a] - EPSILON
            }) {
                Some(a) => a,
                None => return, // Cannot determine thickness direction; skip reveal faces.
            }
        };

        // Wall thickness bounds along the through axis.
        let wall_through_min = wall_lo[through_axis];
        let wall_through_max = wall_hi[through_axis];
        if wall_through_max - wall_through_min < EPSILON {
            return;
        }

        // The two cut axes are the non-through axes.
        let cut_axes: [usize; 2] = if through_axis == 0 {
            [1, 2]
        } else if through_axis == 1 {
            [0, 2]
        } else {
            [0, 1]
        };

        for (idx, &cut_axis) in cut_axes.iter().enumerate() {
            let other_cut_axis = cut_axes[1 - idx];

            // Third-axis extent = intersection of opening and wall in that axis.
            let third_min = open_lo[other_cut_axis].max(wall_lo[other_cut_axis]);
            let third_max = open_hi[other_cut_axis].min(wall_hi[other_cut_axis]);
            if third_max - third_min < EPSILON {
                continue;
            }

            // Min face (at open_lo[cut_axis]): only emit when inside wall bounds.
            if open_lo[cut_axis] > wall_lo[cut_axis] + EPSILON
                && open_lo[cut_axis] < wall_hi[cut_axis] - EPSILON
            {
                self.add_reveal_quad(
                    result,
                    cut_axis,
                    open_lo[cut_axis],
                    through_axis,
                    wall_through_min,
                    wall_through_max,
                    other_cut_axis,
                    third_min,
                    third_max,
                    1.0,
                );
            }

            // Max face (at open_hi[cut_axis]): only emit when inside wall bounds.
            if open_hi[cut_axis] > wall_lo[cut_axis] + EPSILON
                && open_hi[cut_axis] < wall_hi[cut_axis] - EPSILON
            {
                self.add_reveal_quad(
                    result,
                    cut_axis,
                    open_hi[cut_axis],
                    through_axis,
                    wall_through_min,
                    wall_through_max,
                    other_cut_axis,
                    third_min,
                    third_max,
                    -1.0,
                );
            }
        }
    }

    /// Emit a single reveal quad (two triangles) into `result`.
    ///
    /// The quad lies in the plane `position[cut_axis] = face_coord` and spans:
    ///  - through_axis: `[through_min, through_max]`
    ///  - third_axis:   `[third_min,   third_max]`
    ///
    /// `normal_sign = +1.0` produces a normal pointing in the +`cut_axis` direction;
    /// `-1.0` points in the −`cut_axis` direction.
    fn add_reveal_quad(
        &self,
        result: &mut Mesh,
        cut_axis: usize,
        face_coord: f64,
        through_axis: usize,
        through_min: f64,
        through_max: f64,
        third_axis: usize,
        third_min: f64,
        third_max: f64,
        normal_sign: f64,
    ) {
        use nalgebra::Vector3;

        // Build a Point3 from axis-indexed values.
        let make_pt = |through_val: f64, third_val: f64| -> Point3<f64> {
            let mut p = [0.0f64; 3];
            p[cut_axis] = face_coord;
            p[through_axis] = through_val;
            p[third_axis] = third_val;
            Point3::new(p[0], p[1], p[2])
        };

        let v0 = make_pt(through_min, third_min);
        let v1 = make_pt(through_max, third_min);
        let v2 = make_pt(through_min, third_max);
        let v3 = make_pt(through_max, third_max);

        let mut n_arr = [0.0f64; 3];
        n_arr[cut_axis] = normal_sign;
        let normal = Vector3::new(n_arr[0], n_arr[1], n_arr[2]);

        // Winding order: the cross product (v1-v0)×(v3-v0) equals +cut_axis when
        // (through_axis, third_axis, cut_axis) is a right-handed permutation of (0,1,2).
        // We flip the winding when `normal_sign` is negative **or** the permutation is
        // left-handed, but not both (XOR).
        let is_right_handed = matches!(
            (through_axis, third_axis, cut_axis),
            (0, 1, 2) | (1, 2, 0) | (2, 0, 1)
        );
        let use_default_winding = (normal_sign > 0.0) == is_right_handed;

        let base = result.vertex_count() as u32;
        result.add_vertex(v0, normal);
        result.add_vertex(v1, normal);
        result.add_vertex(v2, normal);
        result.add_vertex(v3, normal);

        if use_default_winding {
            result.add_triangle(base, base + 1, base + 3);
            result.add_triangle(base, base + 3, base + 2);
        } else {
            result.add_triangle(base, base + 3, base + 1);
            result.add_triangle(base, base + 2, base + 3);
        }
    }

    /// Cut a rectangular opening using AABB clipping WITHOUT generating internal faces.
    /// Used for diagonal openings where internal face generation causes rotation artifacts.
    fn cut_rectangular_opening_no_faces(
        &self,
        mesh: &Mesh,
        open_min: Point3<f64>,
        open_max: Point3<f64>,
    ) -> Mesh {
        use nalgebra::Vector3;

        const EPSILON: f64 = 1e-6;

        let mut result = Mesh::with_capacity(
            mesh.positions.len() / 3,
            mesh.indices.len() / 3,
        );

        let mut clip_buffers = ClipBuffers::new();

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

            let n0 = if mesh.normals.len() >= mesh.positions.len() {
                Vector3::new(
                    mesh.normals[i0 * 3] as f64,
                    mesh.normals[i0 * 3 + 1] as f64,
                    mesh.normals[i0 * 3 + 2] as f64,
                )
            } else {
                let edge1 = v1 - v0;
                let edge2 = v2 - v0;
                edge1.cross(&edge2).try_normalize(1e-10).unwrap_or(Vector3::new(0.0, 0.0, 1.0))
            };

            let tri_min_x = v0.x.min(v1.x).min(v2.x);
            let tri_max_x = v0.x.max(v1.x).max(v2.x);
            let tri_min_y = v0.y.min(v1.y).min(v2.y);
            let tri_max_y = v0.y.max(v1.y).max(v2.y);
            let tri_min_z = v0.z.min(v1.z).min(v2.z);
            let tri_max_z = v0.z.max(v1.z).max(v2.z);

            // If triangle is completely outside opening, keep it as-is
            if tri_max_x <= open_min.x - EPSILON || tri_min_x >= open_max.x + EPSILON ||
               tri_max_y <= open_min.y - EPSILON || tri_min_y >= open_max.y + EPSILON ||
               tri_max_z <= open_min.z - EPSILON || tri_min_z >= open_max.z + EPSILON {
                let base = result.vertex_count() as u32;
                result.add_vertex(v0, n0);
                result.add_vertex(v1, n0);
                result.add_vertex(v2, n0);
                result.add_triangle(base, base + 1, base + 2);
                continue;
            }

            // Check if triangle is completely inside opening (remove it)
            if tri_min_x >= open_min.x + EPSILON && tri_max_x <= open_max.x - EPSILON &&
               tri_min_y >= open_min.y + EPSILON && tri_max_y <= open_max.y - EPSILON &&
               tri_min_z >= open_min.z + EPSILON && tri_max_z <= open_max.z - EPSILON {
                continue;
            }

            // Triangle may intersect opening - clip it
            if self.triangle_intersects_box(&v0, &v1, &v2, &open_min, &open_max) {
                self.clip_triangle_against_box(&mut result, &mut clip_buffers, &v0, &v1, &v2, &n0, &open_min, &open_max);
            } else {
                let base = result.vertex_count() as u32;
                result.add_vertex(v0, n0);
                result.add_vertex(v1, n0);
                result.add_vertex(v2, n0);
                result.add_triangle(base, base + 1, base + 2);
            }
        }

        // No internal face generation for diagonal openings
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

}
