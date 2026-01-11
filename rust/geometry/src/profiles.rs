//! Profile Processors - Handle all IFC profile types
//!
//! Dynamic profile processing for parametric, arbitrary, and composite profiles.

use crate::{Error, Point2, Result};
use crate::profile::Profile2D;
use ifc_lite_core::{DecodedEntity, EntityDecoder, IfcSchema, IfcType, ProfileCategory};
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
    fn process_parametric(
        &self,
        profile: &DecodedEntity,
        _decoder: &mut EntityDecoder,
    ) -> Result<Profile2D> {
        match profile.ifc_type {
            IfcType::IfcRectangleProfileDef => self.process_rectangle(profile),
            IfcType::IfcCircleProfileDef => self.process_circle(profile),
            IfcType::IfcIShapeProfileDef => self.process_i_shape(profile),
            _ => Err(Error::geometry(format!(
                "Unsupported parametric profile: {}",
                profile.ifc_type
            ))),
        }
    }

    /// Process rectangle profile
    /// IfcRectangleProfileDef: ProfileType, ProfileName, Position, XDim, YDim
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
    fn process_circle(&self, profile: &DecodedEntity) -> Result<Profile2D> {
        // Get radius (attribute 3)
        let radius = profile
            .get_float(3)
            .ok_or_else(|| Error::geometry("Circle missing Radius".to_string()))?;

        // Generate circle with 64 segments
        let segments = 64;
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

    /// Process arbitrary closed profile (polyline-based)
    /// IfcArbitraryClosedProfileDef: ProfileType, ProfileName, OuterCurve
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

        // Process polyline
        if curve.ifc_type == IfcType::IfcPolyline {
            let points = self.process_polyline(&curve, decoder)?;
            Ok(Profile2D::new(points))
        } else {
            Err(Error::geometry(format!(
                "Unsupported curve type in arbitrary profile: {}",
                curve.ifc_type
            )))
        }
    }

    /// Process polyline into 2D points
    /// IfcPolyline: Points (list of IfcCartesianPoint)
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

            let x = coords.get(0).and_then(|v| v.as_float()).unwrap_or(0.0);
            let y = coords.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);

            points.push(Point2::new(x, y));
        }

        Ok(points)
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
            return Err(Error::geometry("Composite profile has no sub-profiles".to_string()));
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

        assert_eq!(profile.outer.len(), 64); // Circle with 64 segments
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
