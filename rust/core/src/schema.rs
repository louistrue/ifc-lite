// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
    IfcFooting,
    IfcPile,
    IfcCovering,
    IfcBuildingElementProxy,
    IfcBuildingElementPart,
    IfcElementAssembly,

    // Reinforcing elements
    IfcReinforcingBar,
    IfcReinforcingMesh,
    IfcTendon,

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
    IfcQuantityLength,
    IfcQuantityArea,
    IfcQuantityVolume,
    IfcQuantityCount,
    IfcQuantityWeight,
    IfcQuantityTime,
    IfcPhysicalSimpleQuantity,

    // Materials
    IfcMaterial,
    IfcMaterialLayer,
    IfcMaterialLayerSet,
    IfcMaterialLayerSetUsage,

    // Geometry
    IfcShapeRepresentation,
    IfcProductDefinitionShape,
    IfcExtrudedAreaSolid,
    IfcSweptDiskSolid,
    IfcRevolvedAreaSolid,
    IfcFacetedBrep,
    IfcTriangulatedFaceSet,
    IfcPolygonalFaceSet,
    IfcBooleanResult,
    IfcBooleanClippingResult,
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
    IfcCompositeProfileDef,

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

    // Mapped geometry
    IfcMappedItem,
    IfcRepresentationMap,

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

    // Style and presentation types
    IfcStyledItem,
    IfcPresentationStyleAssignment,
    IfcSurfaceStyle,
    IfcSurfaceStyleRendering,
    IfcSurfaceStyleShading,
    IfcColourRgb,

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
            "IFCFOOTING" => Self::IfcFooting,
            "IFCPILE" => Self::IfcPile,
            "IFCCOVERING" => Self::IfcCovering,
            "IFCBUILDINGELEMENTPROXY" => Self::IfcBuildingElementProxy,
            "IFCBUILDINGELEMENTPART" => Self::IfcBuildingElementPart,
            "IFCELEMENTASSEMBLY" => Self::IfcElementAssembly,

            "IFCREINFORCINGBAR" => Self::IfcReinforcingBar,
            "IFCREINFORCINGMESH" => Self::IfcReinforcingMesh,
            "IFCTENDON" => Self::IfcTendon,

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
            "IFCQUANTITYLENGTH" => Self::IfcQuantityLength,
            "IFCQUANTITYAREA" => Self::IfcQuantityArea,
            "IFCQUANTITYVOLUME" => Self::IfcQuantityVolume,
            "IFCQUANTITYCOUNT" => Self::IfcQuantityCount,
            "IFCQUANTITYWEIGHT" => Self::IfcQuantityWeight,
            "IFCQUANTITYTIME" => Self::IfcQuantityTime,
            "IFCPHYSICALSIMPLEQUANTITY" => Self::IfcPhysicalSimpleQuantity,

            "IFCMATERIAL" => Self::IfcMaterial,
            "IFCMATERIALLAYER" => Self::IfcMaterialLayer,
            "IFCMATERIALLAYERSET" => Self::IfcMaterialLayerSet,
            "IFCMATERIALLAYERSETUSAGE" => Self::IfcMaterialLayerSetUsage,

            "IFCSHAPEREPRESENTATION" => Self::IfcShapeRepresentation,
            "IFCPRODUCTDEFINITIONSHAPE" => Self::IfcProductDefinitionShape,
            "IFCEXTRUDEDAREASOLID" => Self::IfcExtrudedAreaSolid,
            "IFCSWEPTDISKSOLID" => Self::IfcSweptDiskSolid,
            "IFCREVOLVEDAREASOLID" => Self::IfcRevolvedAreaSolid,
            "IFCFACETEDBREP" => Self::IfcFacetedBrep,
            "IFCTRIANGULATEDFACESET" => Self::IfcTriangulatedFaceSet,
            "IFCPOLYGONALFACESET" => Self::IfcPolygonalFaceSet,
            "IFCBOOLEANRESULT" => Self::IfcBooleanResult,
            "IFCBOOLEANCLIPPINGRESULT" => Self::IfcBooleanClippingResult,
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
            "IFCCOMPOSITEPROFILEDEF" => Self::IfcCompositeProfileDef,

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

            "IFCMAPPEDITEM" => Self::IfcMappedItem,
            "IFCREPRESENTATIONMAP" => Self::IfcRepresentationMap,

            "IFCPIPESEGMENT" => Self::IfcPipeSegment,
            "IFCDUCTSEGMENT" => Self::IfcDuctSegment,
            "IFCCABLESEGMENT" => Self::IfcCableSegment,

            "IFCFURNISHINGELEMENT" => Self::IfcFurnishingElement,
            "IFCFURNITURE" => Self::IfcFurniture,

            "IFCANNOTATION" => Self::IfcAnnotation,
            "IFCGRID" => Self::IfcGrid,

            // Style types
            "IFCSTYLEDITEM" => Self::IfcStyledItem,
            "IFCPRESENTATIONSTYLEASSIGNMENT" => Self::IfcPresentationStyleAssignment,
            "IFCSURFACESTYLE" => Self::IfcSurfaceStyle,
            "IFCSURFACESTYLERENDERING" => Self::IfcSurfaceStyleRendering,
            "IFCSURFACESTYLESHADING" => Self::IfcSurfaceStyleShading,
            "IFCCOLOURRGB" => Self::IfcColourRgb,

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
            Self::IfcFooting => "IFCFOOTING",
            Self::IfcPile => "IFCPILE",
            Self::IfcCovering => "IFCCOVERING",
            Self::IfcBuildingElementProxy => "IFCBUILDINGELEMENTPROXY",
            Self::IfcBuildingElementPart => "IFCBUILDINGELEMENTPART",
            Self::IfcElementAssembly => "IFCELEMENTASSEMBLY",

            Self::IfcReinforcingBar => "IFCREINFORCINGBAR",
            Self::IfcReinforcingMesh => "IFCREINFORCINGMESH",
            Self::IfcTendon => "IFCTENDON",

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
            Self::IfcQuantityLength => "IFCQUANTITYLENGTH",
            Self::IfcQuantityArea => "IFCQUANTITYAREA",
            Self::IfcQuantityVolume => "IFCQUANTITYVOLUME",
            Self::IfcQuantityCount => "IFCQUANTITYCOUNT",
            Self::IfcQuantityWeight => "IFCQUANTITYWEIGHT",
            Self::IfcQuantityTime => "IFCQUANTITYTIME",
            Self::IfcPhysicalSimpleQuantity => "IFCPHYSICALSIMPLEQUANTITY",

            Self::IfcMaterial => "IFCMATERIAL",
            Self::IfcMaterialLayer => "IFCMATERIALLAYER",
            Self::IfcMaterialLayerSet => "IFCMATERIALLAYERSET",
            Self::IfcMaterialLayerSetUsage => "IFCMATERIALLAYERSETUSAGE",

            Self::IfcShapeRepresentation => "IFCSHAPEREPRESENTATION",
            Self::IfcProductDefinitionShape => "IFCPRODUCTDEFINITIONSHAPE",
            Self::IfcExtrudedAreaSolid => "IFCEXTRUDEDAREASOLID",
            Self::IfcSweptDiskSolid => "IFCSWEPTDISKSOLID",
            Self::IfcRevolvedAreaSolid => "IFCREVOLVEDAREASOLID",
            Self::IfcFacetedBrep => "IFCFACETEDBREP",
            Self::IfcTriangulatedFaceSet => "IFCTRIANGULATEDFACESET",
            Self::IfcPolygonalFaceSet => "IFCPOLYGONALFACESET",
            Self::IfcBooleanResult => "IFCBOOLEANRESULT",
            Self::IfcBooleanClippingResult => "IFCBOOLEANCLIPPINGRESULT",
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
            Self::IfcCompositeProfileDef => "IFCCOMPOSITEPROFILEDEF",

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

            Self::IfcMappedItem => "IFCMAPPEDITEM",
            Self::IfcRepresentationMap => "IFCREPRESENTATIONMAP",

            Self::IfcPipeSegment => "IFCPIPESEGMENT",
            Self::IfcDuctSegment => "IFCDUCTSEGMENT",
            Self::IfcCableSegment => "IFCCABLESEGMENT",

            Self::IfcFurnishingElement => "IFCFURNISHINGELEMENT",
            Self::IfcFurniture => "IFCFURNITURE",

            Self::IfcAnnotation => "IFCANNOTATION",
            Self::IfcGrid => "IFCGRID",

            // Style types
            Self::IfcStyledItem => "IFCSTYLEDITEM",
            Self::IfcPresentationStyleAssignment => "IFCPRESENTATIONSTYLEASSIGNMENT",
            Self::IfcSurfaceStyle => "IFCSURFACESTYLE",
            Self::IfcSurfaceStyleRendering => "IFCSURFACESTYLERENDERING",
            Self::IfcSurfaceStyleShading => "IFCSURFACESTYLESHADING",
            Self::IfcColourRgb => "IFCCOLOURRGB",

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
            // Walls
            Self::IfcWall
                | Self::IfcWallStandardCase
                // Slabs & Floors
                | Self::IfcSlab
                | Self::IfcPlate
                // Structural
                | Self::IfcBeam
                | Self::IfcColumn
                | Self::IfcMember
                | Self::IfcFooting
                | Self::IfcPile
                // Roofs & Stairs
                | Self::IfcRoof
                | Self::IfcStair
                | Self::IfcRailing
                // Facades
                | Self::IfcCurtainWall
                // Openings
                | Self::IfcDoor
                | Self::IfcWindow
                | Self::IfcOpeningElement
                // Generic
                | Self::IfcBuildingElementProxy
                | Self::IfcBuildingElementPart
                | Self::IfcElementAssembly
                // Reinforcing
                | Self::IfcReinforcingBar
                | Self::IfcReinforcingMesh
                | Self::IfcTendon
                // Coverings
                | Self::IfcCovering
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

/// Check if a type name (string) represents an element with potential geometry
/// This is the DYNAMIC approach - doesn't require enum variants for every type
pub fn has_geometry_by_name(type_name: &str) -> bool {
    // TYPE entities (IfcWallType, IfcColumnType, etc.) are templates, not actual geometry
    // They define properties/geometry that instances reference via IfcMappedItem
    if type_name.ends_with("TYPE") {
        return false;
    }

    // IFC inheritance: IfcProduct -> IfcElement -> various subtypes
    // All these can have geometry representations

    // Building elements (IfcBuildingElement subtypes)
    let building_elements = [
        "IFCWALL", "IFCWALLSTANDARDCASE",
        "IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE",
        "IFCBEAM", "IFCBEAMSTANDARDCASE",
        "IFCCOLUMN", "IFCCOLUMNSTANDARDCASE",
        "IFCROOF",
        "IFCSTAIR", "IFCSTAIRFLIGHT",
        "IFCRAMP", "IFCRAMPFLIGHT",
        "IFCRAILING",
        "IFCCURTAINWALL",
        "IFCPLATE", "IFCPLATESTANDARDCASE",
        "IFCMEMBER", "IFCMEMBERSTANDARDCASE",
        "IFCFOOTING",
        "IFCPILE",
        "IFCCOVERING",
        "IFCBUILDINGELEMENTPROXY",
        "IFCBUILDINGELEMENTPART",
        "IFCCHIMNEY",
        "IFCSHADINGDEVICE",
    ];

    // Openings and features
    let openings = [
        "IFCDOOR", "IFCDOORSTANDARDCASE",
        "IFCWINDOW", "IFCWINDOWSTANDARDCASE",
        "IFCOPENINGELEMENT", "IFCOPENINGSTANDARDCASE",
        "IFCVOIDINGFEATURE", "IFCSURFACEFEATURE", "IFCPROJECTIONELEMENT",
    ];

    // Element assemblies and components
    let assemblies = [
        "IFCELEMENTASSEMBLY",
        "IFCREINFORCINGBAR",
        "IFCREINFORCINGMESH",
        "IFCREINFORCINGELEMENT",
        "IFCTENDON",
        "IFCTENDONANCHOR",
        "IFCTENDONCONDUIT",
        "IFCFASTENER",
        "IFCMECHANICALFASTENER",
        "IFCVIBRATIONISOLATOR",
        "IFCDISCRETEACCESSORY",
    ];

    // MEP/Distribution elements
    let mep = [
        "IFCPIPESEGMENT", "IFCPIPEFITTING",
        "IFCDUCTSEGMENT", "IFCDUCTFITTING",
        "IFCCABLESEGMENT", "IFCCABLECARRIERSEGMENT",
        "IFCFLOWSEGMENT", "IFCFLOWFITTING", "IFCFLOWTERMINAL", "IFCFLOWCONTROLLER",
        "IFCFLOWMOVINGDEVICE", "IFCFLOWSTORAGEDEVICE", "IFCFLOWTREATMENTDEVICE",
        "IFCENERGYCONVERSIONDEVICE", "IFCUNITARYEQUIPMENT",
        "IFCAIRTERMINAL", "IFCAIRTERMINALBOX", "IFCAIRTOAIRHEATRECOVERY",
        "IFCBOILER", "IFCBURNER", "IFCCHILLER", "IFCCOIL", "IFCCOMPRESSOR",
        "IFCCONDENSER", "IFCCOOLEDBEAM", "IFCCOOLINGTOWER",
        "IFCDAMPER", "IFCDUCTSILENCER", "IFCFAN", "IFCFILTER",
        "IFCFIRESUPPRESSIONTERMINAL", "IFCFLOWMETER", "IFCHEATEXCHANGER",
        "IFCHUMIDIFIER", "IFCINTERCEPTOR", "IFCJUNCTIONBOX",
        "IFCLAMP", "IFCLIGHTFIXTURE", "IFCMEDICALDEVICE",
        "IFCMOTORCONNECTION", "IFCOUTLET", "IFCPUMP",
        "IFCSANITARYTERMINAL", "IFCSENSOR", "IFCSPACEHEATER",
        "IFCSTACKTERMINAL", "IFCSWITCHINGDEVICE", "IFCTANK",
        "IFCTRANSFORMER", "IFCTUBEBUNDLE", "IFCUNITARYCONTROLELEMENTS",
        "IFCVALVE", "IFCWASTETERMINAL",
        "IFCDISTRIBUTIONELEMENT", "IFCDISTRIBUTIONCONTROLELEMENT",
        "IFCDISTRIBUTIONFLOWELEMENT", "IFCDISTRIBUTIONCHAMBERLEMENT",
    ];

    // Furniture and equipment
    let furniture = [
        "IFCFURNISHINGELEMENT",
        "IFCFURNITURE",
        "IFCSYSTEMFURNITUREELEMENT",
    ];

    // Geographic/Civil elements
    let civil = [
        "IFCGEOGRAPHICELEMENT",
        "IFCTRANSPORTELEMENT",
        "IFCVIRTUALELEMENT",
    ];

    // Check all categories
    building_elements.contains(&type_name) ||
    openings.contains(&type_name) ||
    assemblies.contains(&type_name) ||
    mep.contains(&type_name) ||
    furniture.contains(&type_name) ||
    civil.contains(&type_name)
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
