// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Profile Processors - Handle all IFC profile types
//!
//! Dynamic profile processing for parametric, arbitrary, and composite profiles.

use crate::profile::Profile2D;
use crate::{Error, Point2, Point3, Result, Vector3};
use ifc_lite_core::{AttributeValue, DecodedEntity, EntityDecoder, IfcSchema, IfcType, ProfileCategory};
use std::f64::consts::PI;

/// Profile processor - processes IFC profiles into 2D contours
pub struct ProfileProcessor {
    schema: IfcSchema,
}

impl ProfileProcessor {
    /// Create new profile processor
    pub fn new(schema: IfcSchema) -> Self {
        Self { schema }
    }

    /// Process any IFC profile definition
    #[inline]
    pub fn process(
        &self,
        profile: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Profile2D> {
        match self.schema.profile_category(&profile.ifc_type) {
            Some(ProfileCategory::Parametric) => self.process_parametric(profile, decoder),
            Some(ProfileCategory::Arbitrary) => self.process_arbitrary(profile, decoder),
            Some(ProfileCategory::Composite) => self.process_composite(profile, decoder),
            _ => Err(Error::geometry(format!(
                "Unsupported profile type: {}",
                profile.ifc_type
            ))),
        }
    }

    /// Process parametric profiles (rectangle, circle, I-shape, etc.)
    #[inline]
    fn process_parametric(
        &self,
        profile: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Profile2D> {
        // First create the base profile shape
        let mut base_profile = match profile.ifc_type {
            IfcType::IfcRectangleProfileDef => self.process_rectangle(profile),
            IfcType::IfcCircleProfileDef => self.process_circle(profile),
            IfcType::IfcCircleHollowProfileDef => self.process_circle_hollow(profile),
            IfcType::IfcRectangleHollowProfileDef => self.process_rectangle_hollow(profile),
            IfcType::IfcIShapeProfileDef => self.process_i_shape(profile),
            IfcType::IfcLShapeProfileDef => self.process_l_shape(profile),
            IfcType::IfcUShapeProfileDef => self.process_u_shape(profile),
            IfcType::IfcTShapeProfileDef => self.process_t_shape(profile),
            IfcType::IfcCShapeProfileDef => self.process_c_shape(profile),
            IfcType::IfcZShapeProfileDef => self.process_z_shape(profile),
            _ => Err(Error::geometry(format!(
                "Unsupported parametric profile: {}",
                profile.ifc_type
            ))),
        }?;

        // Apply Profile Position transform (attribute 2: IfcAxis2Placement2D)
        if let Some(pos_attr) = profile.get(2) {
            if !pos_attr.is_null() {
                if let Some(pos_entity) = decoder.resolve_ref(pos_attr)? {
                    if pos_entity.ifc_type == IfcType::IfcAxis2Placement2D {
                        self.apply_profile_position(&mut base_profile, &pos_entity, decoder)?;
                    }
                }
            }
        }

        Ok(base_profile)
    }

    /// Apply IfcAxis2Placement2D transform to profile points
    /// IfcAxis2Placement2D: Location, RefDirection
    fn apply_profile_position(
        &self,
        profile: &mut Profile2D,
        placement: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<()> {
        // Get Location (attribute 0) - IfcCartesianPoint
        let (loc_x, loc_y) = if let Some(loc_attr) = placement.get(0) {
            if !loc_attr.is_null() {
                if let Some(loc_entity) = decoder.resolve_ref(loc_attr)? {
                    let coords = loc_entity
                        .get(0)
                        .and_then(|v| v.as_list())
                        .ok_or_else(|| Error::geometry("Missing point coordinates".to_string()))?;
                    let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                    let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                    (x, y)
                } else {
                    (0.0, 0.0)
                }
            } else {
                (0.0, 0.0)
            }
        } else {
            (0.0, 0.0)
        };

        // Get RefDirection (attribute 1) - IfcDirection (optional, default is (1,0))
        let (dir_x, dir_y) = if let Some(dir_attr) = placement.get(1) {
            if !dir_attr.is_null() {
                if let Some(dir_entity) = decoder.resolve_ref(dir_attr)? {
                    let ratios = dir_entity
                        .get(0)
                        .and_then(|v| v.as_list())
                        .ok_or_else(|| Error::geometry("Missing direction ratios".to_string()))?;
                    let x = ratios.first().and_then(|v| v.as_float()).unwrap_or(1.0);
                    let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                    // Normalize
                    let len = (x * x + y * y).sqrt();
                    if len > 1e-10 {
                        (x / len, y / len)
                    } else {
                        (1.0, 0.0)
                    }
                } else {
                    (1.0, 0.0)
                }
            } else {
                (1.0, 0.0)
            }
        } else {
            (1.0, 0.0)
        };

        // Skip transform if it's identity (location at origin, direction is (1,0))
        if loc_x.abs() < 1e-10
            && loc_y.abs() < 1e-10
            && (dir_x - 1.0).abs() < 1e-10
            && dir_y.abs() < 1e-10
        {
            return Ok(());
        }

        // RefDirection is the local X axis direction
        // Local Y axis is perpendicular: (-dir_y, dir_x)
        let x_axis = (dir_x, dir_y);
        let y_axis = (-dir_y, dir_x);

        // Transform all outer points
        for point in &mut profile.outer {
            let old_x = point.x;
            let old_y = point.y;
            // Rotation then translation: p' = R * p + t
            point.x = old_x * x_axis.0 + old_y * y_axis.0 + loc_x;
            point.y = old_x * x_axis.1 + old_y * y_axis.1 + loc_y;
        }

        // Transform all hole points
        for hole in &mut profile.holes {
            for point in hole {
                let old_x = point.x;
                let old_y = point.y;
                point.x = old_x * x_axis.0 + old_y * y_axis.0 + loc_x;
                point.y = old_x * x_axis.1 + old_y * y_axis.1 + loc_y;
            }
        }

        Ok(())
    }

    /// Process rectangle profile
    /// IfcRectangleProfileDef: ProfileType, ProfileName, Position, XDim, YDim
    #[inline]
    fn process_rectangle(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        // Get dimensions (attributes 3 and 4)
        let x_dim = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("Rectangle missing XDim".to_string()))?;
        let y_dim = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("Rectangle missing YDim".to_string()))?;

        // Create rectangle centered at origin
        let half_x = x_dim / 2.0;
        let half_y = y_dim / 2.0;

        let points = vec![
            Point2::new(-half_x, -half_y),
            Point2::new(half_x, -half_y),
            Point2::new(half_x, half_y),
            Point2::new(-half_x, half_y),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process circle profile
    /// IfcCircleProfileDef: ProfileType, ProfileName, Position, Radius
    #[inline]
    fn process_circle(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        // Get radius (attribute 3)
        let radius = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("Circle missing Radius".to_string()))?;

        // Generate circle with 24 segments (matches web-ifc typical quality)
        let segments = 24;
        let mut points = Vec::with_capacity(segments);

        for i in 0..segments {
            let angle = (i as f64) * 2.0 * PI / (segments as f64);
            let x = radius * angle.cos();
            let y = radius * angle.sin();
            points.push(Point2::new(x, y));
        }

        Ok(Profile2D::new(points))
    }

    /// Process I-shape profile (simplified - basic I-beam)
    /// IfcIShapeProfileDef: ProfileType, ProfileName, Position, OverallWidth, OverallDepth, WebThickness, FlangeThickness, ...
    fn process_i_shape(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        // Get dimensions
        let overall_width = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("I-Shape missing OverallWidth".to_string()))?;
        let overall_depth = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("I-Shape missing OverallDepth".to_string()))?;
        let web_thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("I-Shape missing WebThickness".to_string()))?;
        let flange_thickness = profile
            .get_float(6)
            .ok_or_else(|| Error::geometry("I-Shape missing FlangeThickness".to_string()))?;

        let half_width = overall_width / 2.0;
        let half_depth = overall_depth / 2.0;
        let half_web = web_thickness / 2.0;

        // Create I-shape profile (counter-clockwise from bottom-left)
        let points = vec![
            // Bottom flange
            Point2::new(-half_width, -half_depth),
            Point2::new(half_width, -half_depth),
            Point2::new(half_width, -half_depth + flange_thickness),
            // Right side of web
            Point2::new(half_web, -half_depth + flange_thickness),
            Point2::new(half_web, half_depth - flange_thickness),
            // Top flange
            Point2::new(half_width, half_depth - flange_thickness),
            Point2::new(half_width, half_depth),
            Point2::new(-half_width, half_depth),
            Point2::new(-half_width, half_depth - flange_thickness),
            // Left side of web
            Point2::new(-half_web, half_depth - flange_thickness),
            Point2::new(-half_web, -half_depth + flange_thickness),
            Point2::new(-half_width, -half_depth + flange_thickness),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process circle hollow profile (tube/pipe)
    /// IfcCircleHollowProfileDef: ProfileType, ProfileName, Position, Radius, WallThickness
    fn process_circle_hollow(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let radius = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("CircleHollow missing Radius".to_string()))?;
        let wall_thickness = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("CircleHollow missing WallThickness".to_string()))?;

        let inner_radius = radius - wall_thickness;
        let segments = 24;

        // Outer circle
        let mut outer_points = Vec::with_capacity(segments);
        for i in 0..segments {
            let angle = (i as f64) * 2.0 * PI / (segments as f64);
            outer_points.push(Point2::new(radius * angle.cos(), radius * angle.sin()));
        }

        // Inner circle (reversed for hole)
        let mut inner_points = Vec::with_capacity(segments);
        for i in (0..segments).rev() {
            let angle = (i as f64) * 2.0 * PI / (segments as f64);
            inner_points.push(Point2::new(
                inner_radius * angle.cos(),
                inner_radius * angle.sin(),
            ));
        }

        let mut result = Profile2D::new(outer_points);
        result.add_hole(inner_points);
        Ok(result)
    }

    /// Process rectangle hollow profile (rectangular tube)
    /// IfcRectangleHollowProfileDef: ProfileType, ProfileName, Position, XDim, YDim, WallThickness, InnerFilletRadius, OuterFilletRadius
    fn process_rectangle_hollow(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let x_dim = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("RectangleHollow missing XDim".to_string()))?;
        let y_dim = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("RectangleHollow missing YDim".to_string()))?;
        let wall_thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("RectangleHollow missing WallThickness".to_string()))?;

        let half_x = x_dim / 2.0;
        let half_y = y_dim / 2.0;

        // Validate wall thickness
        if wall_thickness >= half_x || wall_thickness >= half_y {
            return Err(Error::geometry(format!(
                "RectangleHollow WallThickness {} exceeds half dimensions ({}, {})",
                wall_thickness, half_x, half_y
            )));
        }

        let inner_half_x = half_x - wall_thickness;
        let inner_half_y = half_y - wall_thickness;

        // Outer rectangle (counter-clockwise)
        let outer_points = vec![
            Point2::new(-half_x, -half_y),
            Point2::new(half_x, -half_y),
            Point2::new(half_x, half_y),
            Point2::new(-half_x, half_y),
        ];

        // Inner rectangle (clockwise for hole - reversed order)
        let inner_points = vec![
            Point2::new(-inner_half_x, -inner_half_y),
            Point2::new(-inner_half_x, inner_half_y),
            Point2::new(inner_half_x, inner_half_y),
            Point2::new(inner_half_x, -inner_half_y),
        ];

        let mut result = Profile2D::new(outer_points);
        result.add_hole(inner_points);
        Ok(result)
    }

    /// Process L-shape profile (angle)
    /// IfcLShapeProfileDef: ProfileType, ProfileName, Position, Depth, Width, Thickness, ...
    fn process_l_shape(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let depth = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("L-Shape missing Depth".to_string()))?;
        let width = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("L-Shape missing Width".to_string()))?;
        let thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("L-Shape missing Thickness".to_string()))?;

        // L-shape profile (counter-clockwise from origin)
        let points = vec![
            Point2::new(0.0, 0.0),
            Point2::new(width, 0.0),
            Point2::new(width, thickness),
            Point2::new(thickness, thickness),
            Point2::new(thickness, depth),
            Point2::new(0.0, depth),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process U-shape profile (channel)
    /// IfcUShapeProfileDef: ProfileType, ProfileName, Position, Depth, FlangeWidth, WebThickness, FlangeThickness, ...
    fn process_u_shape(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let depth = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("U-Shape missing Depth".to_string()))?;
        let flange_width = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("U-Shape missing FlangeWidth".to_string()))?;
        let web_thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("U-Shape missing WebThickness".to_string()))?;
        let flange_thickness = profile
            .get_float(6)
            .ok_or_else(|| Error::geometry("U-Shape missing FlangeThickness".to_string()))?;

        let half_depth = depth / 2.0;

        // U-shape profile (counter-clockwise)
        let points = vec![
            Point2::new(0.0, -half_depth),
            Point2::new(flange_width, -half_depth),
            Point2::new(flange_width, -half_depth + flange_thickness),
            Point2::new(web_thickness, -half_depth + flange_thickness),
            Point2::new(web_thickness, half_depth - flange_thickness),
            Point2::new(flange_width, half_depth - flange_thickness),
            Point2::new(flange_width, half_depth),
            Point2::new(0.0, half_depth),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process T-shape profile
    /// IfcTShapeProfileDef: ProfileType, ProfileName, Position, Depth, FlangeWidth, WebThickness, FlangeThickness, ...
    fn process_t_shape(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let depth = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("T-Shape missing Depth".to_string()))?;
        let flange_width = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("T-Shape missing FlangeWidth".to_string()))?;
        let web_thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("T-Shape missing WebThickness".to_string()))?;
        let flange_thickness = profile
            .get_float(6)
            .ok_or_else(|| Error::geometry("T-Shape missing FlangeThickness".to_string()))?;

        let half_flange = flange_width / 2.0;
        let half_web = web_thickness / 2.0;

        // T-shape profile (counter-clockwise)
        let points = vec![
            Point2::new(-half_web, 0.0),
            Point2::new(-half_web, depth - flange_thickness),
            Point2::new(-half_flange, depth - flange_thickness),
            Point2::new(-half_flange, depth),
            Point2::new(half_flange, depth),
            Point2::new(half_flange, depth - flange_thickness),
            Point2::new(half_web, depth - flange_thickness),
            Point2::new(half_web, 0.0),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process C-shape profile (channel with lips)
    /// IfcCShapeProfileDef: ProfileType, ProfileName, Position, Depth, Width, WallThickness, Girth, ...
    fn process_c_shape(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let depth = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("C-Shape missing Depth".to_string()))?;
        let _width = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("C-Shape missing Width".to_string()))?;
        let wall_thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("C-Shape missing WallThickness".to_string()))?;
        let girth = profile.get_float(6).unwrap_or(wall_thickness * 2.0); // Lip length

        let half_depth = depth / 2.0;

        // C-shape profile (counter-clockwise)
        let points = vec![
            Point2::new(girth, -half_depth),
            Point2::new(0.0, -half_depth),
            Point2::new(0.0, half_depth),
            Point2::new(girth, half_depth),
            Point2::new(girth, half_depth - wall_thickness),
            Point2::new(wall_thickness, half_depth - wall_thickness),
            Point2::new(wall_thickness, -half_depth + wall_thickness),
            Point2::new(girth, -half_depth + wall_thickness),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process Z-shape profile
    /// IfcZShapeProfileDef: ProfileType, ProfileName, Position, Depth, FlangeWidth, WebThickness, FlangeThickness, ...
    fn process_z_shape(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        let depth = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("Z-Shape missing Depth".to_string()))?;
        let flange_width = profile
            .get_float(4)
            .ok_or_else(|| Error::geometry("Z-Shape missing FlangeWidth".to_string()))?;
        let web_thickness = profile
            .get_float(5)
            .ok_or_else(|| Error::geometry("Z-Shape missing WebThickness".to_string()))?;
        let flange_thickness = profile
            .get_float(6)
            .ok_or_else(|| Error::geometry("Z-Shape missing FlangeThickness".to_string()))?;

        let half_depth = depth / 2.0;
        let half_web = web_thickness / 2.0;

        // Z-shape profile (counter-clockwise)
        let points = vec![
            Point2::new(-half_web, -half_depth),
            Point2::new(-half_web - flange_width, -half_depth),
            Point2::new(-half_web - flange_width, -half_depth + flange_thickness),
            Point2::new(-half_web, -half_depth + flange_thickness),
            Point2::new(-half_web, half_depth - flange_thickness),
            Point2::new(half_web, half_depth - flange_thickness),
            Point2::new(half_web, half_depth),
            Point2::new(half_web + flange_width, half_depth),
            Point2::new(half_web + flange_width, half_depth - flange_thickness),
            Point2::new(half_web, half_depth - flange_thickness),
            Point2::new(half_web, -half_depth + flange_thickness),
            Point2::new(-half_web, -half_depth + flange_thickness),
        ];

        Ok(Profile2D::new(points))
    }

    /// Process arbitrary closed profile (polyline-based)
    /// IfcArbitraryClosedProfileDef: ProfileType, ProfileName, OuterCurve
    /// IfcArbitraryProfileDefWithVoids: ProfileType, ProfileName, OuterCurve, InnerCurves
    fn process_arbitrary(
        &self,
        profile: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Profile2D> {
        // Get outer curve (attribute 2)
        let curve_attr = profile
            .get(2)
            .ok_or_else(|| Error::geometry("Arbitrary profile missing OuterCurve".to_string()))?;

        let curve = decoder
            .resolve_ref(curve_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve OuterCurve".to_string()))?;

        // Process outer curve
        let outer_points = self.process_curve(&curve, decoder)?;
        let mut result = Profile2D::new(outer_points);

        // Check if this is IfcArbitraryProfileDefWithVoids (has inner curves)
        if profile.ifc_type == IfcType::IfcArbitraryProfileDefWithVoids {
            // Get inner curves list (attribute 3)
            if let Some(inner_curves_attr) = profile.get(3) {
                let inner_curves = decoder.resolve_ref_list(inner_curves_attr)?;
                for inner_curve in inner_curves {
                    let hole_points = self.process_curve(&inner_curve, decoder)?;
                    result.add_hole(hole_points);
                }
            }
        }

        Ok(result)
    }

    /// Process any supported curve type into 2D points
    #[inline]
    fn process_curve(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        match curve.ifc_type {
            IfcType::IfcPolyline => self.process_polyline(curve, decoder),
            IfcType::IfcIndexedPolyCurve => self.process_indexed_polycurve(curve, decoder),
            IfcType::IfcCompositeCurve => self.process_composite_curve(curve, decoder),
            IfcType::IfcTrimmedCurve => self.process_trimmed_curve(curve, decoder),
            IfcType::IfcCircle => self.process_circle_curve(curve, decoder),
            IfcType::IfcEllipse => self.process_ellipse_curve(curve, decoder),
            _ => Err(Error::geometry(format!(
                "Unsupported curve type: {}",
                curve.ifc_type
            ))),
        }
    }

    /// Get 3D points from a curve (for swept disk solid, etc.)
    #[inline]
    pub fn get_curve_points(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point3<f64>>> {
        match curve.ifc_type {
            IfcType::IfcPolyline => self.process_polyline_3d(curve, decoder),
            IfcType::IfcCompositeCurve => self.process_composite_curve_3d(curve, decoder),
            IfcType::IfcCircle => self.process_circle_3d(curve, decoder),
            IfcType::IfcTrimmedCurve => {
                // For trimmed curve, get 2D points and convert to 3D
                let points_2d = self.process_trimmed_curve(curve, decoder)?;
                Ok(points_2d
                    .into_iter()
                    .map(|p| Point3::new(p.x, p.y, 0.0))
                    .collect())
            }
            _ => {
                // Fallback: try 2D curve and convert to 3D
                let points_2d = self.process_curve(curve, decoder)?;
                Ok(points_2d
                    .into_iter()
                    .map(|p| Point3::new(p.x, p.y, 0.0))
                    .collect())
            }
        }
    }

    /// Process circle curve in 3D space (for swept disk solid, etc.)
    fn process_circle_3d(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point3<f64>>> {
        // IfcCircle: Position (IfcAxis2Placement2D or 3D), Radius
        let position_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("Circle missing Position".to_string()))?;

        let radius = curve
            .get_float(1)
            .ok_or_else(|| Error::geometry("Circle missing Radius".to_string()))?;

        let position = decoder
            .resolve_ref(position_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve circle position".to_string()))?;

        // Get center and orientation from Axis2Placement3D
        let (center, x_axis, y_axis) = if position.ifc_type == IfcType::IfcAxis2Placement3D {
            // IfcAxis2Placement3D: Location, Axis (Z), RefDirection (X)
            let loc_attr = position
                .get(0)
                .ok_or_else(|| Error::geometry("Axis2Placement3D missing Location".to_string()))?;
            let loc = decoder
                .resolve_ref(loc_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve location".to_string()))?;
            let coords = loc
                .get(0)
                .and_then(|v| v.as_list())
                .ok_or_else(|| Error::geometry("Location missing coordinates".to_string()))?;
            let center = Point3::new(
                coords.first().and_then(|v| v.as_float()).unwrap_or(0.0),
                coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0),
                coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0),
            );

            // Get Z axis (Axis attribute)
            let z_axis = if let Some(axis_attr) = position.get(1) {
                if !axis_attr.is_null() {
                    let axis = decoder.resolve_ref(axis_attr)?;
                    if let Some(axis) = axis {
                        let coords = axis.get(0).and_then(|v| v.as_list());
                        if let Some(coords) = coords {
                            Vector3::new(
                                coords.first().and_then(|v| v.as_float()).unwrap_or(0.0),
                                coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0),
                                coords.get(2).and_then(|v| v.as_float()).unwrap_or(1.0),
                            )
                            .normalize()
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

            // Get X axis (RefDirection attribute)
            let x_axis = if let Some(ref_attr) = position.get(2) {
                if !ref_attr.is_null() {
                    let ref_dir = decoder.resolve_ref(ref_attr)?;
                    if let Some(ref_dir) = ref_dir {
                        let coords = ref_dir.get(0).and_then(|v| v.as_list());
                        if let Some(coords) = coords {
                            Vector3::new(
                                coords.first().and_then(|v| v.as_float()).unwrap_or(1.0),
                                coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0),
                                coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0),
                            )
                            .normalize()
                        } else {
                            Vector3::new(1.0, 0.0, 0.0)
                        }
                    } else {
                        Vector3::new(1.0, 0.0, 0.0)
                    }
                } else {
                    Vector3::new(1.0, 0.0, 0.0)
                }
            } else {
                Vector3::new(1.0, 0.0, 0.0)
            };

            // Y axis = Z cross X
            let y_axis = z_axis.cross(&x_axis).normalize();

            (center, x_axis, y_axis)
        } else {
            // 2D placement - use XY plane
            let loc_attr = position.get(0);
            let (cx, cy) = if let Some(attr) = loc_attr {
                let loc = decoder.resolve_ref(attr)?;
                if let Some(loc) = loc {
                    let coords = loc.get(0).and_then(|v| v.as_list());
                    if let Some(coords) = coords {
                        (
                            coords.first().and_then(|v| v.as_float()).unwrap_or(0.0),
                            coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0),
                        )
                    } else {
                        (0.0, 0.0)
                    }
                } else {
                    (0.0, 0.0)
                }
            } else {
                (0.0, 0.0)
            };
            (
                Point3::new(cx, cy, 0.0),
                Vector3::new(1.0, 0.0, 0.0),
                Vector3::new(0.0, 1.0, 0.0),
            )
        };

        // Generate circle points in 3D (16 segments for full circle)
        let segments = 16usize;
        let mut points = Vec::with_capacity(segments + 1);

        for i in 0..=segments {
            let angle = 2.0 * std::f64::consts::PI * i as f64 / segments as f64;
            let p = center + x_axis * (radius * angle.cos()) + y_axis * (radius * angle.sin());
            points.push(p);
        }

        Ok(points)
    }

    /// Process polyline into 3D points
    fn process_polyline_3d(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point3<f64>>> {
        // IfcPolyline: Points
        let points_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("Polyline missing Points".to_string()))?;

        let points = decoder.resolve_ref_list(points_attr)?;
        let mut result = Vec::with_capacity(points.len());

        for point in points {
            // IfcCartesianPoint: Coordinates
            let coords_attr = point
                .get(0)
                .ok_or_else(|| Error::geometry("CartesianPoint missing Coordinates".to_string()))?;

            let coords = coords_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Coordinates is not a list".to_string()))?;

            let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            let z = coords.get(2).and_then(|v| v.as_float()).unwrap_or(0.0);

            result.push(Point3::new(x, y, z));
        }

        Ok(result)
    }

    /// Process composite curve into 3D points
    fn process_composite_curve_3d(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point3<f64>>> {
        // IfcCompositeCurve: Segments, SelfIntersect
        let segments_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("CompositeCurve missing Segments".to_string()))?;

        let segments = decoder.resolve_ref_list(segments_attr)?;
        let mut result = Vec::new();

        for segment in segments {
            // IfcCompositeCurveSegment: Transition, SameSense, ParentCurve
            let parent_curve_attr = segment.get(2).ok_or_else(|| {
                Error::geometry("CompositeCurveSegment missing ParentCurve".to_string())
            })?;

            let parent_curve = decoder
                .resolve_ref(parent_curve_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve ParentCurve".to_string()))?;

            // Get same_sense for direction
            let same_sense = segment
                .get(1)
                .and_then(|v| match v {
                    ifc_lite_core::AttributeValue::Enum(e) => Some(e.as_str()),
                    _ => None,
                })
                .map(|e| e == "T" || e == "TRUE")
                .unwrap_or(true);

            let mut segment_points = self.get_curve_points(&parent_curve, decoder)?;

            if !same_sense {
                segment_points.reverse();
            }

            // Skip first point if we already have points (avoid duplicates)
            if !result.is_empty() && !segment_points.is_empty() {
                result.extend(segment_points.into_iter().skip(1));
            } else {
                result.extend(segment_points);
            }
        }

        Ok(result)
    }

    /// Process trimmed curve
    /// IfcTrimmedCurve: BasisCurve, Trim1, Trim2, SenseAgreement, MasterRepresentation
    fn process_trimmed_curve(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        // Get basis curve (attribute 0)
        let basis_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("TrimmedCurve missing BasisCurve".to_string()))?;

        let basis_curve = decoder
            .resolve_ref(basis_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve BasisCurve".to_string()))?;

        // Get trim parameters
        let trim1 = curve.get(1).and_then(|v| self.extract_trim_param(v));
        let trim2 = curve.get(2).and_then(|v| self.extract_trim_param(v));

        // Get sense agreement (attribute 3) - default true
        let sense = curve
            .get(3)
            .and_then(|v| match v {
                ifc_lite_core::AttributeValue::Enum(s) => Some(s == "T"),
                _ => None,
            })
            .unwrap_or(true);

        // Process basis curve based on type
        match basis_curve.ifc_type {
            IfcType::IfcCircle | IfcType::IfcEllipse => {
                self.process_trimmed_conic(&basis_curve, trim1, trim2, sense, decoder)
            }
            _ => {
                // Fallback: try to process as a regular curve
                self.process_curve(&basis_curve, decoder)
            }
        }
    }

    /// Extract trim parameter (can be IFCPARAMETERVALUE or IFCCARTESIANPOINT)
    fn extract_trim_param(&self, attr: &ifc_lite_core::AttributeValue) -> Option<f64> {
        if let Some(list) = attr.as_list() {
            for item in list {
                // Check for IFCPARAMETERVALUE (stored as ["IFCPARAMETERVALUE", value])
                if let Some(inner_list) = item.as_list() {
                    if inner_list.len() >= 2 {
                        if let Some(type_name) = inner_list.first().and_then(|v| v.as_string()) {
                            if type_name == "IFCPARAMETERVALUE" {
                                return inner_list.get(1).and_then(|v| v.as_float());
                            }
                        }
                    }
                }
                if let Some(f) = item.as_float() {
                    return Some(f);
                }
            }
        }
        None
    }

    /// Process trimmed conic (circle or ellipse arc)
    fn process_trimmed_conic(
        &self,
        basis: &DecodedEntity,
        trim1: Option<f64>,
        trim2: Option<f64>,
        sense: bool,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        let radius = basis.get_float(1).unwrap_or(1.0);
        let radius2 = if basis.ifc_type == IfcType::IfcEllipse {
            basis.get_float(2).unwrap_or(radius)
        } else {
            radius
        };

        let (center, rotation) = self.get_placement_2d(basis, decoder)?;

        // Convert trim parameters to angles (in degrees usually)
        let start_angle = trim1.unwrap_or(0.0).to_radians();
        let end_angle = trim2.unwrap_or(360.0).to_radians();

        // Calculate arc angle and adaptive segment count
        // Use ~8 segments per 90° (quarter circle), minimum 2
        let arc_angle = (end_angle - start_angle).abs();
        let num_segments = ((arc_angle / std::f64::consts::FRAC_PI_2 * 8.0).ceil() as usize).max(2);
        let mut points = Vec::with_capacity(num_segments + 1);

        let angle_range = if sense {
            end_angle - start_angle
        } else {
            start_angle - end_angle
        };

        for i in 0..=num_segments {
            let t = i as f64 / num_segments as f64;
            let angle = if sense {
                start_angle + t * angle_range
            } else {
                start_angle - t * angle_range.abs()
            };

            let x = radius * angle.cos();
            let y = radius2 * angle.sin();

            let rx = x * rotation.cos() - y * rotation.sin() + center.x;
            let ry = x * rotation.sin() + y * rotation.cos() + center.y;

            points.push(Point2::new(rx, ry));
        }

        Ok(points)
    }

    /// Get 2D placement from entity
    fn get_placement_2d(
        &self,
        entity: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<(Point2<f64>, f64)> {
        let placement_attr = match entity.get(0) {
            Some(attr) if !attr.is_null() => attr,
            _ => return Ok((Point2::new(0.0, 0.0), 0.0)),
        };

        let placement = match decoder.resolve_ref(placement_attr)? {
            Some(p) => p,
            None => return Ok((Point2::new(0.0, 0.0), 0.0)),
        };

        let location_attr = placement.get(0);
        let center = if let Some(loc_attr) = location_attr {
            if let Some(loc) = decoder.resolve_ref(loc_attr)? {
                let coords = loc.get(0).and_then(|v| v.as_list());
                if let Some(coords) = coords {
                    let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
                    let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                    Point2::new(x, y)
                } else {
                    Point2::new(0.0, 0.0)
                }
            } else {
                Point2::new(0.0, 0.0)
            }
        } else {
            Point2::new(0.0, 0.0)
        };

        let rotation = if let Some(dir_attr) = placement.get(1) {
            if let Some(dir) = decoder.resolve_ref(dir_attr)? {
                let ratios = dir.get(0).and_then(|v| v.as_list());
                if let Some(ratios) = ratios {
                    let x = ratios.first().and_then(|v| v.as_float()).unwrap_or(1.0);
                    let y = ratios.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
                    y.atan2(x)
                } else {
                    0.0
                }
            } else {
                0.0
            }
        } else {
            0.0
        };

        Ok((center, rotation))
    }

    /// Process circle curve (full circle)
    fn process_circle_curve(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        let radius = curve.get_float(1).unwrap_or(1.0);
        let (center, rotation) = self.get_placement_2d(curve, decoder)?;

        let segments = 24;
        let mut points = Vec::with_capacity(segments);

        for i in 0..segments {
            let angle = (i as f64) * 2.0 * PI / (segments as f64);
            let x = radius * angle.cos();
            let y = radius * angle.sin();

            let rx = x * rotation.cos() - y * rotation.sin() + center.x;
            let ry = x * rotation.sin() + y * rotation.cos() + center.y;

            points.push(Point2::new(rx, ry));
        }

        Ok(points)
    }

    /// Process ellipse curve (full ellipse)
    fn process_ellipse_curve(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        let semi_axis1 = curve.get_float(1).unwrap_or(1.0);
        let semi_axis2 = curve.get_float(2).unwrap_or(1.0);
        let (center, rotation) = self.get_placement_2d(curve, decoder)?;

        let segments = 24;
        let mut points = Vec::with_capacity(segments);

        for i in 0..segments {
            let angle = (i as f64) * 2.0 * PI / (segments as f64);
            let x = semi_axis1 * angle.cos();
            let y = semi_axis2 * angle.sin();

            let rx = x * rotation.cos() - y * rotation.sin() + center.x;
            let ry = x * rotation.sin() + y * rotation.cos() + center.y;

            points.push(Point2::new(rx, ry));
        }

        Ok(points)
    }

    /// Process polyline into 2D points
    /// IfcPolyline: Points (list of IfcCartesianPoint)
    #[inline]
    fn process_polyline(
        &self,
        polyline: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        // Get points list (attribute 0)
        let points_attr = polyline
            .get(0)
            .ok_or_else(|| Error::geometry("Polyline missing Points".to_string()))?;

        let point_entities = decoder.resolve_ref_list(points_attr)?;

        let mut points = Vec::with_capacity(point_entities.len());
        for point_entity in point_entities {
            if point_entity.ifc_type != IfcType::IfcCartesianPoint {
                continue;
            }

            // Get coordinates (attribute 0)
            let coords_attr = point_entity
                .get(0)
                .ok_or_else(|| Error::geometry("CartesianPoint missing coordinates".to_string()))?;

            let coords = coords_attr
                .as_list()
                .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;

            let x = coords.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);

            points.push(Point2::new(x, y));
        }

        Ok(points)
    }

    /// Process indexed polycurve into 2D points
    /// IfcIndexedPolyCurve: Points (IfcCartesianPointList2D), Segments (optional), SelfIntersect
    fn process_indexed_polycurve(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        // Get points list (attribute 0) - references IfcCartesianPointList2D
        let points_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("IndexedPolyCurve missing Points".to_string()))?;

        let points_list = decoder
            .resolve_ref(points_attr)?
            .ok_or_else(|| Error::geometry("Failed to resolve Points list".to_string()))?;

        // IfcCartesianPointList2D: CoordList (list of 2D coordinates)
        let coord_list_attr = points_list
            .get(0)
            .ok_or_else(|| Error::geometry("CartesianPointList2D missing CoordList".to_string()))?;

        let coord_list = coord_list_attr
            .as_list()
            .ok_or_else(|| Error::geometry("Expected coordinate list".to_string()))?;

        // Parse all 2D points from the coordinate list
        let all_points: Vec<Point2<f64>> = coord_list
            .iter()
            .filter_map(|coord| {
                coord.as_list().and_then(|coords| {
                    let x = coords.first()?.as_float()?;
                    let y = coords.get(1)?.as_float()?;
                    Some(Point2::new(x, y))
                })
            })
            .collect();

        // Get segments (attribute 1) - optional, if not present use all points in order
        let segments_attr = curve.get(1);

        if segments_attr.is_none() || segments_attr.map(|a| a.is_null()).unwrap_or(true) {
            // No segments specified - use all points in order
            return Ok(all_points);
        }

        // Process segments (IfcLineIndex or IfcArcIndex)
        let segments = segments_attr
            .unwrap()
            .as_list()
            .ok_or_else(|| Error::geometry("Expected segments list".to_string()))?;

        let mut result_points = Vec::new();

        for segment in segments {
            // Each segment is either IFCLINEINDEX((i1,i2,...)) or IFCARCINDEX((i1,i2,i3))
            // Typed values are stored as List([String("IFCLINEINDEX"), List([indices...])])
            // So we need to extract the inner list (skip the type name)
            let indices = if let Some(segment_list) = segment.as_list() {
                // Check if this is a typed value: List([String(type_name), List([indices...])])
                // Typed values like IFCLINEINDEX((1,2)) are stored as:
                // List([String("IFCLINEINDEX"), List([Integer(1), Integer(2)])])
                if segment_list.len() >= 2 {
                    // First element is type name (String), second is the actual indices list
                    if let Some(AttributeValue::List(indices_list)) = segment_list.get(1) {
                        Some(indices_list.as_slice())
                    } else {
                        // Fallback: maybe it's a direct list of indices (not typed)
                        Some(segment_list)
                    }
                } else {
                    // Single element or empty - treat as direct list
                    Some(segment_list)
                }
            } else {
                None
            };

            if let Some(indices) = indices {
                let idx_values: Vec<usize> = indices
                    .iter()
                    .filter_map(|v| v.as_float().map(|f| f as usize - 1)) // 1-indexed to 0-indexed
                    .collect();

                if idx_values.len() == 3 {
                    // Arc segment - 3 points define an arc
                    let p1 = all_points.get(idx_values[0]).copied();
                    let p2 = all_points.get(idx_values[1]).copied(); // Mid-point
                    let p3 = all_points.get(idx_values[2]).copied();

                    if let (Some(start), Some(mid), Some(end)) = (p1, p2, p3) {
                        // Approximate arc with adaptive segment count based on arc size
                        // Calculate approximate arc angle from chord length vs radius
                        let chord_len =
                            ((end.x - start.x).powi(2) + (end.y - start.y).powi(2)).sqrt();
                        let mid_chord = ((mid.x - (start.x + end.x) / 2.0).powi(2)
                            + (mid.y - (start.y + end.y) / 2.0).powi(2))
                        .sqrt();
                        // Estimate arc angle: larger mid deviation = larger arc
                        let arc_estimate = if chord_len > 1e-10 {
                            (mid_chord / chord_len).abs().min(1.0).acos() * 2.0
                        } else {
                            0.5
                        };
                        let num_segments = ((arc_estimate / std::f64::consts::FRAC_PI_2 * 8.0)
                            .ceil() as usize)
                            .clamp(4, 16);
                        let arc_points = self.approximate_arc_3pt(start, mid, end, num_segments);
                        for pt in arc_points {
                            if result_points.last() != Some(&pt) {
                                result_points.push(pt);
                            }
                        }
                    }
                } else {
                    // Line segment - add all points
                    for &idx in &idx_values {
                        if let Some(&pt) = all_points.get(idx) {
                            if result_points.last() != Some(&pt) {
                                result_points.push(pt);
                            }
                        }
                    }
                }
            }
            // else: segment is not a list, skip it
        }

        Ok(result_points)
    }

    /// Approximate a 3-point arc with line segments
    fn approximate_arc_3pt(
        &self,
        p1: Point2<f64>,
        p2: Point2<f64>,
        p3: Point2<f64>,
        num_segments: usize,
    ) -> Vec<Point2<f64>> {
        // Find circle center from 3 points
        let ax = p1.x;
        let ay = p1.y;
        let bx = p2.x;
        let by = p2.y;
        let cx = p3.x;
        let cy = p3.y;

        let d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

        if d.abs() < 1e-10 {
            // Points are collinear - return as line
            return vec![p1, p2, p3];
        }

        let ux = ((ax * ax + ay * ay) * (by - cy)
            + (bx * bx + by * by) * (cy - ay)
            + (cx * cx + cy * cy) * (ay - by))
            / d;
        let uy = ((ax * ax + ay * ay) * (cx - bx)
            + (bx * bx + by * by) * (ax - cx)
            + (cx * cx + cy * cy) * (bx - ax))
            / d;

        let center = Point2::new(ux, uy);
        let radius = ((p1.x - center.x).powi(2) + (p1.y - center.y).powi(2)).sqrt();

        // Calculate angles
        let angle1 = (p1.y - center.y).atan2(p1.x - center.x);
        let angle3 = (p3.y - center.y).atan2(p3.x - center.x);
        let angle2 = (p2.y - center.y).atan2(p2.x - center.x);

        // Determine arc direction
        let start_angle = angle1;
        let mut end_angle = angle3;

        // Check if we need to go the long way around
        let mid_check = angle1 + (angle3 - angle1) / 2.0;
        let diff = (angle2 - mid_check).abs();
        if diff > PI {
            // Go the other way
            if end_angle > start_angle {
                end_angle -= 2.0 * PI;
            } else {
                end_angle += 2.0 * PI;
            }
        }

        // Generate arc points
        let mut points = Vec::with_capacity(num_segments + 1);
        for i in 0..=num_segments {
            let t = i as f64 / num_segments as f64;
            let angle = start_angle + t * (end_angle - start_angle);
            points.push(Point2::new(
                center.x + radius * angle.cos(),
                center.y + radius * angle.sin(),
            ));
        }

        points
    }

    /// Process composite curve into 2D points
    /// IfcCompositeCurve: Segments (list of IfcCompositeCurveSegment), SelfIntersect
    fn process_composite_curve(
        &self,
        curve: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Vec<Point2<f64>>> {
        // Get segments list (attribute 0)
        let segments_attr = curve
            .get(0)
            .ok_or_else(|| Error::geometry("CompositeCurve missing Segments".to_string()))?;

        let segments = decoder.resolve_ref_list(segments_attr)?;

        let mut all_points = Vec::new();

        for segment in segments {
            // IfcCompositeCurveSegment: Transition, SameSense, ParentCurve
            if segment.ifc_type != IfcType::IfcCompositeCurveSegment {
                continue;
            }

            // Get ParentCurve (attribute 2)
            let parent_curve_attr = segment.get(2).ok_or_else(|| {
                Error::geometry("CompositeCurveSegment missing ParentCurve".to_string())
            })?;

            let parent_curve = decoder
                .resolve_ref(parent_curve_attr)?
                .ok_or_else(|| Error::geometry("Failed to resolve ParentCurve".to_string()))?;

            // Get SameSense (attribute 1) - whether to reverse the curve
            // Note: IFC enum values like ".T." are parsed/stored as "T" without dots
            let same_sense = segment
                .get(1)
                .and_then(|v| match v {
                    ifc_lite_core::AttributeValue::Enum(s) => Some(s == "T" || s == "TRUE"),
                    _ => None,
                })
                .unwrap_or(true);

            // Process the parent curve
            let mut segment_points = self.process_curve(&parent_curve, decoder)?;

            if !same_sense {
                segment_points.reverse();
            }

            // Append to result, avoiding duplicates at connection points
            for pt in segment_points {
                if all_points.last() != Some(&pt) {
                    all_points.push(pt);
                }
            }
        }

        Ok(all_points)
    }

    /// Process composite profile (combination of profiles)
    /// IfcCompositeProfileDef: ProfileType, ProfileName, Profiles, Label
    fn process_composite(
        &self,
        profile: &DecodedEntity,
        decoder: &mut EntityDecoder,
    ) -> Result<Profile2D> {
        // Get profiles list (attribute 2)
        let profiles_attr = profile
            .get(2)
            .ok_or_else(|| Error::geometry("Composite profile missing Profiles".to_string()))?;

        let sub_profiles = decoder.resolve_ref_list(profiles_attr)?;

        if sub_profiles.is_empty() {
            return Err(Error::geometry(
                "Composite profile has no sub-profiles".to_string(),
            ));
        }

        // Process first profile as base
        let mut result = self.process(&sub_profiles[0], decoder)?;

        // Add remaining profiles as holes (simplified - assumes they're holes)
        for sub_profile in &sub_profiles[1..] {
            let hole = self.process(sub_profile, decoder)?;
            result.add_hole(hole.outer);
        }

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rectangle_profile() {
        let content = r#"
#1=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,100.0,200.0);
"#;

        let mut decoder = EntityDecoder::new(content);
        let schema = IfcSchema::new();
        let processor = ProfileProcessor::new(schema);

        let profile_entity = decoder.decode_by_id(1).unwrap();
        let profile = processor.process(&profile_entity, &mut decoder).unwrap();

        assert_eq!(profile.outer.len(), 4);
        assert!(!profile.outer.is_empty());
    }

    #[test]
    fn test_circle_profile() {
        let content = r#"
#1=IFCCIRCLEPROFILEDEF(.AREA.,$,$,50.0);
"#;

        let mut decoder = EntityDecoder::new(content);
        let schema = IfcSchema::new();
        let processor = ProfileProcessor::new(schema);

        let profile_entity = decoder.decode_by_id(1).unwrap();
        let profile = processor.process(&profile_entity, &mut decoder).unwrap();

        assert_eq!(profile.outer.len(), 24); // Circle with 24 segments
        assert!(!profile.outer.is_empty());
    }

    #[test]
    fn test_i_shape_profile() {
        let content = r#"
#1=IFCISHAPEPROFILEDEF(.AREA.,$,$,200.0,300.0,10.0,15.0,$,$,$,$);
"#;

        let mut decoder = EntityDecoder::new(content);
        let schema = IfcSchema::new();
        let processor = ProfileProcessor::new(schema);

        let profile_entity = decoder.decode_by_id(1).unwrap();
        let profile = processor.process(&profile_entity, &mut decoder).unwrap();

        assert_eq!(profile.outer.len(), 12); // I-shape has 12 vertices
        assert!(!profile.outer.is_empty());
    }

    #[test]
    fn test_arbitrary_profile() {
        let content = r#"
#1=IFCCARTESIANPOINT((0.0,0.0));
#2=IFCCARTESIANPOINT((100.0,0.0));
#3=IFCCARTESIANPOINT((100.0,100.0));
#4=IFCCARTESIANPOINT((0.0,100.0));
#5=IFCPOLYLINE((#1,#2,#3,#4,#1));
#6=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#5);
"#;

        let mut decoder = EntityDecoder::new(content);
        let schema = IfcSchema::new();
        let processor = ProfileProcessor::new(schema);

        let profile_entity = decoder.decode_by_id(6).unwrap();
        let profile = processor.process(&profile_entity, &mut decoder).unwrap();

        assert_eq!(profile.outer.len(), 5); // 4 corners + closing point
        assert!(!profile.outer.is_empty());
    }
}
