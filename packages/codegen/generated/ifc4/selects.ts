/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC SELECT Types (Unions)
 * Generated from EXPRESS schema: IFC4_ADD2_TC1
 *
 * DO NOT EDIT - This file is auto-generated
 */

/** IfcActorSelect */
export type IfcActorSelect = IfcOrganization | IfcPerson | IfcPersonAndOrganization;

/** IfcAppliedValueSelect */
export type IfcAppliedValueSelect = IfcMeasureWithUnit | IfcReference | IfcValue;

/** IfcAxis2Placement */
export type IfcAxis2Placement = IfcAxis2Placement2D | IfcAxis2Placement3D;

/** IfcBendingParameterSelect */
export type IfcBendingParameterSelect = number | number;

/** IfcBooleanOperand */
export type IfcBooleanOperand = IfcBooleanResult | IfcCsgPrimitive3D | IfcHalfSpaceSolid | IfcSolidModel | IfcTessellatedFaceSet;

/** IfcClassificationReferenceSelect */
export type IfcClassificationReferenceSelect = IfcClassification | IfcClassificationReference;

/** IfcClassificationSelect */
export type IfcClassificationSelect = IfcClassification | IfcClassificationReference;

/** IfcColour */
export type IfcColour = IfcColourSpecification | IfcPreDefinedColour;

/** IfcColourOrFactor */
export type IfcColourOrFactor = IfcColourRgb | number;

/** IfcCoordinateReferenceSystemSelect */
export type IfcCoordinateReferenceSystemSelect = IfcCoordinateReferenceSystem | IfcGeometricRepresentationContext;

/** IfcCsgSelect */
export type IfcCsgSelect = IfcBooleanResult | IfcCsgPrimitive3D;

/** IfcCurveFontOrScaledCurveFontSelect */
export type IfcCurveFontOrScaledCurveFontSelect = IfcCurveStyleFontAndScaling | IfcCurveStyleFontSelect;

/** IfcCurveOnSurface */
export type IfcCurveOnSurface = IfcCompositeCurveOnSurface | IfcPcurve | IfcSurfaceCurve;

/** IfcCurveOrEdgeCurve */
export type IfcCurveOrEdgeCurve = IfcBoundedCurve | IfcEdgeCurve;

/** IfcCurveStyleFontSelect */
export type IfcCurveStyleFontSelect = IfcCurveStyleFont | IfcPreDefinedCurveFont;

/** IfcDefinitionSelect */
export type IfcDefinitionSelect = IfcObjectDefinition | IfcPropertyDefinition;

/** IfcDerivedMeasureValue */
export type IfcDerivedMeasureValue = number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number | number;

/** IfcDocumentSelect */
export type IfcDocumentSelect = IfcDocumentInformation | IfcDocumentReference;

/** IfcFillStyleSelect */
export type IfcFillStyleSelect = IfcColour | IfcExternallyDefinedHatchStyle | IfcFillAreaStyleHatching | IfcFillAreaStyleTiles;

/** IfcGeometricSetSelect */
export type IfcGeometricSetSelect = IfcCurve | IfcPoint | IfcSurface;

/** IfcGridPlacementDirectionSelect */
export type IfcGridPlacementDirectionSelect = IfcDirection | IfcVirtualGridIntersection;

/** IfcHatchLineDistanceSelect */
export type IfcHatchLineDistanceSelect = number | IfcVector;

/** IfcLayeredItem */
export type IfcLayeredItem = IfcRepresentation | IfcRepresentationItem;

/** IfcLibrarySelect */
export type IfcLibrarySelect = IfcLibraryInformation | IfcLibraryReference;

/** IfcLightDistributionDataSourceSelect */
export type IfcLightDistributionDataSourceSelect = IfcExternalReference | IfcLightIntensityDistribution;

/** IfcMaterialSelect */
export type IfcMaterialSelect = IfcMaterialDefinition | IfcMaterialList | IfcMaterialUsageDefinition;

/** IfcMeasureValue */
export type IfcMeasureValue = number | number | IfcComplexNumber | number | number | number | number | number | number | number | number | number | number | IfcParameterValue | number | number | number | number | number | number | number | number | number;

/** IfcMetricValueSelect */
export type IfcMetricValueSelect = IfcAppliedValue | IfcMeasureWithUnit | IfcReference | IfcTable | IfcTimeSeries | IfcValue;

/** IfcModulusOfRotationalSubgradeReactionSelect */
export type IfcModulusOfRotationalSubgradeReactionSelect = IfcBoolean | number;

/** IfcModulusOfSubgradeReactionSelect */
export type IfcModulusOfSubgradeReactionSelect = IfcBoolean | number;

/** IfcModulusOfTranslationalSubgradeReactionSelect */
export type IfcModulusOfTranslationalSubgradeReactionSelect = IfcBoolean | number;

/** IfcObjectReferenceSelect */
export type IfcObjectReferenceSelect = IfcAddress | IfcAppliedValue | IfcExternalReference | IfcMaterialDefinition | IfcOrganization | IfcPerson | IfcPersonAndOrganization | IfcTable | IfcTimeSeries;

/** IfcPointOrVertexPoint */
export type IfcPointOrVertexPoint = IfcPoint | IfcVertexPoint;

/** IfcPresentationStyleSelect */
export type IfcPresentationStyleSelect = IfcCurveStyle | IfcFillAreaStyle | IfcNullStyle | IfcSurfaceStyle | IfcTextStyle;

/** IfcProcessSelect */
export type IfcProcessSelect = IfcProcess | IfcTypeProcess;

/** IfcProductRepresentationSelect */
export type IfcProductRepresentationSelect = IfcProductDefinitionShape | IfcRepresentationMap;

/** IfcProductSelect */
export type IfcProductSelect = IfcProduct | IfcTypeProduct;

/** IfcPropertySetDefinitionSelect */
export type IfcPropertySetDefinitionSelect = IfcPropertySetDefinition | IfcPropertySetDefinitionSet;

/** IfcResourceObjectSelect */
export type IfcResourceObjectSelect = IfcActorRole | IfcAppliedValue | IfcApproval | IfcConstraint | IfcContextDependentUnit | IfcConversionBasedUnit | IfcExternalInformation | IfcExternalReference | IfcMaterialDefinition | IfcOrganization | IfcPerson | IfcPersonAndOrganization | IfcPhysicalQuantity | IfcProfileDef | IfcPropertyAbstraction | IfcTimeSeries;

/** IfcResourceSelect */
export type IfcResourceSelect = IfcResource | IfcTypeResource;

/** IfcRotationalStiffnessSelect */
export type IfcRotationalStiffnessSelect = IfcBoolean | number;

/** IfcSegmentIndexSelect */
export type IfcSegmentIndexSelect = IfcArcIndex | IfcLineIndex;

/** IfcShell */
export type IfcShell = IfcClosedShell | IfcOpenShell;

/** IfcSimpleValue */
export type IfcSimpleValue = IfcBinary | IfcBoolean | IfcDate | IfcDateTime | IfcDuration | IfcIdentifier | IfcInteger | IfcLabel | IfcLogical | IfcPositiveInteger | IfcReal | IfcText | IfcTime | IfcTimeStamp;

/** IfcSizeSelect */
export type IfcSizeSelect = number | number | number | number | number | number;

/** IfcSolidOrShell */
export type IfcSolidOrShell = IfcClosedShell | IfcSolidModel;

/** IfcSpaceBoundarySelect */
export type IfcSpaceBoundarySelect = IfcExternalSpatialElement | IfcSpace;

/** IfcSpecularHighlightSelect */
export type IfcSpecularHighlightSelect = IfcSpecularExponent | IfcSpecularRoughness;

/** IfcStructuralActivityAssignmentSelect */
export type IfcStructuralActivityAssignmentSelect = IfcElement | IfcStructuralItem;

/** IfcStyleAssignmentSelect */
export type IfcStyleAssignmentSelect = IfcPresentationStyle | IfcPresentationStyleAssignment;

/** IfcSurfaceOrFaceSurface */
export type IfcSurfaceOrFaceSurface = IfcFaceBasedSurfaceModel | IfcFaceSurface | IfcSurface;

/** IfcSurfaceStyleElementSelect */
export type IfcSurfaceStyleElementSelect = IfcExternallyDefinedSurfaceStyle | IfcSurfaceStyleLighting | IfcSurfaceStyleRefraction | IfcSurfaceStyleShading | IfcSurfaceStyleWithTextures;

/** IfcTextFontSelect */
export type IfcTextFontSelect = IfcExternallyDefinedTextFont | IfcPreDefinedTextFont;

/** IfcTimeOrRatioSelect */
export type IfcTimeOrRatioSelect = IfcDuration | number;

/** IfcTranslationalStiffnessSelect */
export type IfcTranslationalStiffnessSelect = IfcBoolean | number;

/** IfcTrimmingSelect */
export type IfcTrimmingSelect = IfcCartesianPoint | IfcParameterValue;

/** IfcUnit */
export type IfcUnit = IfcDerivedUnit | IfcMonetaryUnit | IfcNamedUnit;

/** IfcValue */
export type IfcValue = IfcDerivedMeasureValue | IfcMeasureValue | IfcSimpleValue;

/** IfcVectorOrDirection */
export type IfcVectorOrDirection = IfcDirection | IfcVector;

/** IfcWarpingStiffnessSelect */
export type IfcWarpingStiffnessSelect = IfcBoolean | number;

