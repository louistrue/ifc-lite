//! IFC Schema Types
//!
//! Fast type checking using an enum instead of string comparison.

use std::fmt;

/// IFC Entity Types
/// Common IFC4 types for fast pattern matching
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IfcType {
    // Structural Elements
    IfcWall,
    IfcWallStandardCase,
    IfcSlab,
    IfcBeam,
    IfcColumn,
    IfcRoof,
    IfcStair,
    IfcRailing,
    IfcCurtainWall,
    IfcPlate,
    IfcMember,

    // Openings
    IfcDoor,
    IfcWindow,
    IfcOpeningElement,

    // Spaces
    IfcSpace,
    IfcBuildingStorey,
    IfcBuilding,
    IfcSite,
    IfcProject,

    // Relationships
    IfcRelAggregates,
    IfcRelContainedInSpatialStructure,
    IfcRelDefinesByProperties,
    IfcRelAssociatesMaterial,
    IfcRelVoidsElement,
    IfcRelFillsElement,

    // Properties
    IfcPropertySet,
    IfcPropertySingleValue,
    IfcPropertyEnumeratedValue,
    IfcElementQuantity,

    // Materials
    IfcMaterial,
    IfcMaterialLayer,
    IfcMaterialLayerSet,
    IfcMaterialLayerSetUsage,

    // Geometry
    IfcShapeRepresentation,
    IfcProductDefinitionShape,
    IfcExtrudedAreaSolid,
    IfcAxis2Placement3D,
    IfcAxis2Placement2D,
    IfcLocalPlacement,
    IfcCartesianPoint,
    IfcDirection,
    IfcPolyline,
    IfcArbitraryClosedProfileDef,
    IfcArbitraryProfileDefWithVoids,
    IfcRectangleProfileDef,
    IfcCircleProfileDef,
    IfcIShapeProfileDef,
    IfcLShapeProfileDef,
    IfcUShapeProfileDef,
    IfcTShapeProfileDef,
    IfcCShapeProfileDef,
    IfcZShapeProfileDef,
    IfcCircleHollowProfileDef,

    // Curve types
    IfcIndexedPolyCurve,
    IfcCompositeCurve,
    IfcCompositeCurveSegment,
    IfcTrimmedCurve,
    IfcCircle,
    IfcEllipse,
    IfcLine,

    // Points
    IfcCartesianPointList2D,
    IfcCartesianPointList3D,

    // MEP
    IfcPipeSegment,
    IfcDuctSegment,
    IfcCableSegment,

    // Furniture
    IfcFurnishingElement,
    IfcFurniture,

    // Annotations
    IfcAnnotation,
    IfcGrid,

    // Other common types
    IfcOwnerHistory,
    IfcPerson,
    IfcOrganization,
    IfcApplication,

    // Fallback for unknown types
    Unknown(u16), // Store hash for unknown types
}

impl IfcType {
    /// Parse IFC type from string
    pub fn from_str(s: &str) -> Option<Self> {
        // Fast path: check common types first
        let t = match s {
            "IFCWALL" => Self::IfcWall,
            "IFCWALLSTANDARDCASE" => Self::IfcWallStandardCase,
            "IFCSLAB" => Self::IfcSlab,
            "IFCBEAM" => Self::IfcBeam,
            "IFCCOLUMN" => Self::IfcColumn,
            "IFCROOF" => Self::IfcRoof,
            "IFCSTAIR" => Self::IfcStair,
            "IFCRAILING" => Self::IfcRailing,
            "IFCCURTAINWALL" => Self::IfcCurtainWall,
            "IFCPLATE" => Self::IfcPlate,
            "IFCMEMBER" => Self::IfcMember,

            "IFCDOOR" => Self::IfcDoor,
            "IFCWINDOW" => Self::IfcWindow,
            "IFCOPENINGELEMENT" => Self::IfcOpeningElement,

            "IFCSPACE" => Self::IfcSpace,
            "IFCBUILDINGSTOREY" => Self::IfcBuildingStorey,
            "IFCBUILDING" => Self::IfcBuilding,
            "IFCSITE" => Self::IfcSite,
            "IFCPROJECT" => Self::IfcProject,

            "IFCRELAGGREGATES" => Self::IfcRelAggregates,
            "IFCRELCONTAINEDINSPATIALSTRUCTURE" => Self::IfcRelContainedInSpatialStructure,
            "IFCRELDEFINESBYPROPERTIES" => Self::IfcRelDefinesByProperties,
            "IFCRELASSOCIATESMATERIAL" => Self::IfcRelAssociatesMaterial,
            "IFCRELVOIDSELEMENT" => Self::IfcRelVoidsElement,
            "IFCRELFILLSELEMENT" => Self::IfcRelFillsElement,

            "IFCPROPERTYSET" => Self::IfcPropertySet,
            "IFCPROPERTYSINGLEVALUE" => Self::IfcPropertySingleValue,
            "IFCPROPERTYENUMERATEDVALUE" => Self::IfcPropertyEnumeratedValue,
            "IFCELEMENTQUANTITY" => Self::IfcElementQuantity,

            "IFCMATERIAL" => Self::IfcMaterial,
            "IFCMATERIALLAYER" => Self::IfcMaterialLayer,
            "IFCMATERIALLAYERSET" => Self::IfcMaterialLayerSet,
            "IFCMATERIALLAYERSETUSAGE" => Self::IfcMaterialLayerSetUsage,

            "IFCSHAPEREPRESENTATION" => Self::IfcShapeRepresentation,
            "IFCPRODUCTDEFINITIONSHAPE" => Self::IfcProductDefinitionShape,
            "IFCEXTRUDEDAREASOLID" => Self::IfcExtrudedAreaSolid,
            "IFCAXIS2PLACEMENT3D" => Self::IfcAxis2Placement3D,
            "IFCAXIS2PLACEMENT2D" => Self::IfcAxis2Placement2D,
            "IFCLOCALPLACEMENT" => Self::IfcLocalPlacement,
            "IFCCARTESIANPOINT" => Self::IfcCartesianPoint,
            "IFCDIRECTION" => Self::IfcDirection,
            "IFCPOLYLINE" => Self::IfcPolyline,
            "IFCARBITRARYCLOSEDPROFILEDEF" => Self::IfcArbitraryClosedProfileDef,
            "IFCARBITRARYPROFILEDEFWITHVOIDS" => Self::IfcArbitraryProfileDefWithVoids,
            "IFCRECTANGLEPROFILEDEF" => Self::IfcRectangleProfileDef,
            "IFCCIRCLEPROFILEDEF" => Self::IfcCircleProfileDef,
            "IFCISHAPEPROFILEDEF" => Self::IfcIShapeProfileDef,
            "IFCLSHAPEPROFILEDEF" => Self::IfcLShapeProfileDef,
            "IFCUSHAPEPROFILEDEF" => Self::IfcUShapeProfileDef,
            "IFCTSHAPEPROFILEDEF" => Self::IfcTShapeProfileDef,
            "IFCCSHAPEPROFILEDEF" => Self::IfcCShapeProfileDef,
            "IFCZSHAPEPROFILEDEF" => Self::IfcZShapeProfileDef,
            "IFCCIRCLEHOLLOWPROFILEDEF" => Self::IfcCircleHollowProfileDef,

            // Curve types
            "IFCINDEXEDPOLYCURVE" => Self::IfcIndexedPolyCurve,
            "IFCCOMPOSITECURVE" => Self::IfcCompositeCurve,
            "IFCCOMPOSITECURVESEGMENT" => Self::IfcCompositeCurveSegment,
            "IFCTRIMMEDCURVE" => Self::IfcTrimmedCurve,
            "IFCCIRCLE" => Self::IfcCircle,
            "IFCELLIPSE" => Self::IfcEllipse,
            "IFCLINE" => Self::IfcLine,

            // Points
            "IFCCARTESIANPOINTLIST2D" => Self::IfcCartesianPointList2D,
            "IFCCARTESIANPOINTLIST3D" => Self::IfcCartesianPointList3D,

            "IFCPIPESEGMENT" => Self::IfcPipeSegment,
            "IFCDUCTSEGMENT" => Self::IfcDuctSegment,
            "IFCCABLESEGMENT" => Self::IfcCableSegment,

            "IFCFURNISHINGELEMENT" => Self::IfcFurnishingElement,
            "IFCFURNITURE" => Self::IfcFurniture,

            "IFCANNOTATION" => Self::IfcAnnotation,
            "IFCGRID" => Self::IfcGrid,

            "IFCOWNERHISTORY" => Self::IfcOwnerHistory,
            "IFCPERSON" => Self::IfcPerson,
            "IFCORGANIZATION" => Self::IfcOrganization,
            "IFCAPPLICATION" => Self::IfcApplication,

            _ => {
                // Unknown type - store a hash
                let hash = simple_hash(s);
                Self::Unknown(hash)
            }
        };
        Some(t)
    }

    /// Get string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::IfcWall => "IFCWALL",
            Self::IfcWallStandardCase => "IFCWALLSTANDARDCASE",
            Self::IfcSlab => "IFCSLAB",
            Self::IfcBeam => "IFCBEAM",
            Self::IfcColumn => "IFCCOLUMN",
            Self::IfcRoof => "IFCROOF",
            Self::IfcStair => "IFCSTAIR",
            Self::IfcRailing => "IFCRAILING",
            Self::IfcCurtainWall => "IFCCURTAINWALL",
            Self::IfcPlate => "IFCPLATE",
            Self::IfcMember => "IFCMEMBER",

            Self::IfcDoor => "IFCDOOR",
            Self::IfcWindow => "IFCWINDOW",
            Self::IfcOpeningElement => "IFCOPENINGELEMENT",

            Self::IfcSpace => "IFCSPACE",
            Self::IfcBuildingStorey => "IFCBUILDINGSTOREY",
            Self::IfcBuilding => "IFCBUILDING",
            Self::IfcSite => "IFCSITE",
            Self::IfcProject => "IFCPROJECT",

            Self::IfcRelAggregates => "IFCRELAGGREGATES",
            Self::IfcRelContainedInSpatialStructure => "IFCRELCONTAINEDINSPATIALSTRUCTURE",
            Self::IfcRelDefinesByProperties => "IFCRELDEFINESBYPROPERTIES",
            Self::IfcRelAssociatesMaterial => "IFCRELASSOCIATESMATERIAL",
            Self::IfcRelVoidsElement => "IFCRELVOIDSELEMENT",
            Self::IfcRelFillsElement => "IFCRELFILLSELEMENT",

            Self::IfcPropertySet => "IFCPROPERTYSET",
            Self::IfcPropertySingleValue => "IFCPROPERTYSINGLEVALUE",
            Self::IfcPropertyEnumeratedValue => "IFCPROPERTYENUMERATEDVALUE",
            Self::IfcElementQuantity => "IFCELEMENTQUANTITY",

            Self::IfcMaterial => "IFCMATERIAL",
            Self::IfcMaterialLayer => "IFCMATERIALLAYER",
            Self::IfcMaterialLayerSet => "IFCMATERIALLAYERSET",
            Self::IfcMaterialLayerSetUsage => "IFCMATERIALLAYERSETUSAGE",

            Self::IfcShapeRepresentation => "IFCSHAPEREPRESENTATION",
            Self::IfcProductDefinitionShape => "IFCPRODUCTDEFINITIONSHAPE",
            Self::IfcExtrudedAreaSolid => "IFCEXTRUDEDAREASOLID",
            Self::IfcAxis2Placement3D => "IFCAXIS2PLACEMENT3D",
            Self::IfcAxis2Placement2D => "IFCAXIS2PLACEMENT2D",
            Self::IfcLocalPlacement => "IFCLOCALPLACEMENT",
            Self::IfcCartesianPoint => "IFCCARTESIANPOINT",
            Self::IfcDirection => "IFCDIRECTION",
            Self::IfcPolyline => "IFCPOLYLINE",
            Self::IfcArbitraryClosedProfileDef => "IFCARBITRARYCLOSEDPROFILEDEF",
            Self::IfcArbitraryProfileDefWithVoids => "IFCARBITRARYPROFILEDEFWITHVOIDS",
            Self::IfcRectangleProfileDef => "IFCRECTANGLEPROFILEDEF",
            Self::IfcCircleProfileDef => "IFCCIRCLEPROFILEDEF",
            Self::IfcIShapeProfileDef => "IFCISHAPEPROFILEDEF",
            Self::IfcLShapeProfileDef => "IFCLSHAPEPROFILEDEF",
            Self::IfcUShapeProfileDef => "IFCUSHAPEPROFILEDEF",
            Self::IfcTShapeProfileDef => "IFCTSHAPEPROFILEDEF",
            Self::IfcCShapeProfileDef => "IFCCSHAPEPROFILEDEF",
            Self::IfcZShapeProfileDef => "IFCZSHAPEPROFILEDEF",
            Self::IfcCircleHollowProfileDef => "IFCCIRCLEHOLLOWPROFILEDEF",

            // Curve types
            Self::IfcIndexedPolyCurve => "IFCINDEXEDPOLYCURVE",
            Self::IfcCompositeCurve => "IFCCOMPOSITECURVE",
            Self::IfcCompositeCurveSegment => "IFCCOMPOSITECURVESEGMENT",
            Self::IfcTrimmedCurve => "IFCTRIMMEDCURVE",
            Self::IfcCircle => "IFCCIRCLE",
            Self::IfcEllipse => "IFCELLIPSE",
            Self::IfcLine => "IFCLINE",

            // Points
            Self::IfcCartesianPointList2D => "IFCCARTESIANPOINTLIST2D",
            Self::IfcCartesianPointList3D => "IFCCARTESIANPOINTLIST3D",

            Self::IfcPipeSegment => "IFCPIPESEGMENT",
            Self::IfcDuctSegment => "IFCDUCTSEGMENT",
            Self::IfcCableSegment => "IFCCABLESEGMENT",

            Self::IfcFurnishingElement => "IFCFURNISHINGELEMENT",
            Self::IfcFurniture => "IFCFURNITURE",

            Self::IfcAnnotation => "IFCANNOTATION",
            Self::IfcGrid => "IFCGRID",

            Self::IfcOwnerHistory => "IFCOWNERHISTORY",
            Self::IfcPerson => "IFCPERSON",
            Self::IfcOrganization => "IFCORGANIZATION",
            Self::IfcApplication => "IFCAPPLICATION",

            Self::Unknown(_) => "UNKNOWN",
        }
    }

    /// Check if this is a spatial structure element
    pub fn is_spatial(&self) -> bool {
        matches!(
            self,
            Self::IfcProject
                | Self::IfcSite
                | Self::IfcBuilding
                | Self::IfcBuildingStorey
                | Self::IfcSpace
        )
    }

    /// Check if this is a building element
    pub fn is_building_element(&self) -> bool {
        matches!(
            self,
            Self::IfcWall
                | Self::IfcWallStandardCase
                | Self::IfcSlab
                | Self::IfcBeam
                | Self::IfcColumn
                | Self::IfcRoof
                | Self::IfcStair
                | Self::IfcRailing
                | Self::IfcCurtainWall
                | Self::IfcPlate
                | Self::IfcMember
        )
    }

    /// Check if this is a relationship
    pub fn is_relationship(&self) -> bool {
        matches!(
            self,
            Self::IfcRelAggregates
                | Self::IfcRelContainedInSpatialStructure
                | Self::IfcRelDefinesByProperties
                | Self::IfcRelAssociatesMaterial
                | Self::IfcRelVoidsElement
                | Self::IfcRelFillsElement
        )
    }
}

impl fmt::Display for IfcType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Simple hash function for unknown IFC types
fn simple_hash(s: &str) -> u16 {
    let mut hash: u32 = 5381;
    for byte in s.bytes() {
        hash = ((hash << 5).wrapping_add(hash)).wrapping_add(byte as u32);
    }
    (hash & 0xFFFF) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_from_str() {
        assert_eq!(IfcType::from_str("IFCWALL"), Some(IfcType::IfcWall));
        assert_eq!(IfcType::from_str("IFCDOOR"), Some(IfcType::IfcDoor));
        assert_eq!(IfcType::from_str("IFCPROJECT"), Some(IfcType::IfcProject));
    }

    #[test]
    fn test_as_str() {
        assert_eq!(IfcType::IfcWall.as_str(), "IFCWALL");
        assert_eq!(IfcType::IfcDoor.as_str(), "IFCDOOR");
    }

    #[test]
    fn test_is_spatial() {
        assert!(IfcType::IfcProject.is_spatial());
        assert!(IfcType::IfcBuilding.is_spatial());
        assert!(!IfcType::IfcWall.is_spatial());
    }

    #[test]
    fn test_is_building_element() {
        assert!(IfcType::IfcWall.is_building_element());
        assert!(IfcType::IfcBeam.is_building_element());
        assert!(!IfcType::IfcProject.is_building_element());
    }

    #[test]
    fn test_unknown_type() {
        let unknown = IfcType::from_str("IFCCUSTOMTYPE").unwrap();
        assert!(matches!(unknown, IfcType::Unknown(_)));
    }
}
