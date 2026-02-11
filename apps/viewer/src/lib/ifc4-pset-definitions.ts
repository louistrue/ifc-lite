/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC4 Property Set Definitions
 *
 * Maps IFC entity types to their valid property sets and properties
 * according to the official IFC4 standard (ISO 16739-1:2018).
 *
 * Only includes Pset_ definitions (not Qto_ quantities).
 * Used by the property editor to validate and suggest additions.
 */

import { PropertyValueType } from '@ifc-lite/data';

export interface PsetPropertyDef {
  name: string;
  type: PropertyValueType;
  description: string;
}

export interface PsetDefinition {
  name: string;
  description: string;
  applicableTypes: string[];
  properties: PsetPropertyDef[];
  /** Schema versions this pset applies to. If undefined, applies to all. */
  schemas?: Array<'IFC2X3' | 'IFC4' | 'IFC4X3'>;
}

// ============================================================================
// IFC4 Standard Property Set Definitions
// ============================================================================

const PSET_DEFINITIONS: PsetDefinition[] = [
  // ---------------------------------------------------------------------------
  // Wall Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_WallCommon',
    description: 'Properties common to the definition of all occurrences of IfcWall',
    applicableTypes: ['IfcWall', 'IfcWallStandardCase', 'IfcCurtainWall'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID from an external source' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element (New, Existing, Demolish, Temporary)' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating for this element' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'Combustible', type: PropertyValueType.Boolean, description: 'Whether the material is combustible' },
      { name: 'SurfaceSpreadOfFlame', type: PropertyValueType.Label, description: 'Surface spread of flame classification' },
      { name: 'ThermalTransmittance', type: PropertyValueType.Real, description: 'Thermal transmittance (U-value) in W/(m²·K)' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external (part of the outer shell)' },
      { name: 'LoadBearing', type: PropertyValueType.Boolean, description: 'Whether the element is load bearing' },
      { name: 'ExtendToStructure', type: PropertyValueType.Boolean, description: 'Whether the wall extends to the structure above' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Door Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_DoorCommon',
    description: 'Properties common to the definition of all occurrences of IfcDoor',
    applicableTypes: ['IfcDoor'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID from an external source' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating' },
      { name: 'SecurityRating', type: PropertyValueType.Label, description: 'Security rating' },
      { name: 'HandicapAccessible', type: PropertyValueType.Boolean, description: 'Whether accessible for handicapped persons' },
      { name: 'FireExit', type: PropertyValueType.Boolean, description: 'Whether designated as fire exit' },
      { name: 'SelfClosing', type: PropertyValueType.Boolean, description: 'Whether self-closing' },
      { name: 'SmokeStop', type: PropertyValueType.Boolean, description: 'Whether designed to prevent smoke passage' },
      { name: 'GlazingAreaFraction', type: PropertyValueType.Real, description: 'Fraction of glazing area (0-1)' },
      { name: 'HasDrive', type: PropertyValueType.Boolean, description: 'Whether an automatic drive is provided' },
    ],
  },
  {
    name: 'Pset_DoorWindowGlazingType',
    description: 'Properties for door/window glazing',
    applicableTypes: ['IfcDoor', 'IfcWindow'],
    properties: [
      { name: 'GlassLayers', type: PropertyValueType.Integer, description: 'Number of glass layers' },
      { name: 'GlassThickness1', type: PropertyValueType.Real, description: 'Thickness of first glass layer (mm)' },
      { name: 'GlassThickness2', type: PropertyValueType.Real, description: 'Thickness of second glass layer (mm)' },
      { name: 'GlassThickness3', type: PropertyValueType.Real, description: 'Thickness of third glass layer (mm)' },
      { name: 'FillGas', type: PropertyValueType.Label, description: 'Fill gas type (Air, Argon, Krypton)' },
      { name: 'GlassColour', type: PropertyValueType.Label, description: 'Glass colour' },
      { name: 'IsTempered', type: PropertyValueType.Boolean, description: 'Whether glass is tempered' },
      { name: 'IsLaminated', type: PropertyValueType.Boolean, description: 'Whether glass is laminated' },
      { name: 'IsCoated', type: PropertyValueType.Boolean, description: 'Whether glass is coated' },
      { name: 'IsWired', type: PropertyValueType.Boolean, description: 'Whether glass is wired' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Window Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_WindowCommon',
    description: 'Properties common to the definition of all occurrences of IfcWindow',
    applicableTypes: ['IfcWindow'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID from an external source' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating' },
      { name: 'ThermalTransmittance', type: PropertyValueType.Real, description: 'Thermal transmittance (U-value)' },
      { name: 'GlazingAreaFraction', type: PropertyValueType.Real, description: 'Fraction of glazing area (0-1)' },
      { name: 'HasSillExternal', type: PropertyValueType.Boolean, description: 'Whether has external sill' },
      { name: 'HasSillInternal', type: PropertyValueType.Boolean, description: 'Whether has internal sill' },
      { name: 'HasDrive', type: PropertyValueType.Boolean, description: 'Whether has automatic drive' },
      { name: 'SmokeStop', type: PropertyValueType.Boolean, description: 'Whether prevents smoke passage' },
      { name: 'Infiltration', type: PropertyValueType.Real, description: 'Air infiltration rate' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Slab Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_SlabCommon',
    description: 'Properties common to the definition of all occurrences of IfcSlab',
    applicableTypes: ['IfcSlab'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'Combustible', type: PropertyValueType.Boolean, description: 'Whether the material is combustible' },
      { name: 'SurfaceSpreadOfFlame', type: PropertyValueType.Label, description: 'Surface spread of flame' },
      { name: 'ThermalTransmittance', type: PropertyValueType.Real, description: 'Thermal transmittance (U-value)' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'LoadBearing', type: PropertyValueType.Boolean, description: 'Whether the element is load bearing' },
      { name: 'PitchAngle', type: PropertyValueType.Real, description: 'Pitch angle of the slab (degrees)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Column Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_ColumnCommon',
    description: 'Properties common to the definition of all occurrences of IfcColumn',
    applicableTypes: ['IfcColumn'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'Slope', type: PropertyValueType.Real, description: 'Slope angle (degrees)' },
      { name: 'Roll', type: PropertyValueType.Real, description: 'Roll angle (degrees)' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'LoadBearing', type: PropertyValueType.Boolean, description: 'Whether the element is load bearing' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Beam Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_BeamCommon',
    description: 'Properties common to the definition of all occurrences of IfcBeam',
    applicableTypes: ['IfcBeam'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'Span', type: PropertyValueType.Real, description: 'Clear span of the beam (m)' },
      { name: 'Slope', type: PropertyValueType.Real, description: 'Slope angle (degrees)' },
      { name: 'Roll', type: PropertyValueType.Real, description: 'Roll angle (degrees)' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'LoadBearing', type: PropertyValueType.Boolean, description: 'Whether the element is load bearing' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Stair Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_StairCommon',
    description: 'Properties common to the definition of all occurrences of IfcStair',
    applicableTypes: ['IfcStair'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'NumberOfRiser', type: PropertyValueType.Integer, description: 'Number of risers' },
      { name: 'NumberOfTreads', type: PropertyValueType.Integer, description: 'Number of treads' },
      { name: 'RiserHeight', type: PropertyValueType.Real, description: 'Riser height (mm)' },
      { name: 'TreadLength', type: PropertyValueType.Real, description: 'Tread length (mm)' },
      { name: 'HandicapAccessible', type: PropertyValueType.Boolean, description: 'Whether accessible for handicapped persons' },
      { name: 'HasGuardRail', type: PropertyValueType.Boolean, description: 'Whether has guard rail' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'FireExit', type: PropertyValueType.Boolean, description: 'Whether designated as fire exit' },
      { name: 'RequiredHeadroom', type: PropertyValueType.Real, description: 'Required headroom clearance (m)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Ramp Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_RampCommon',
    description: 'Properties common to the definition of all occurrences of IfcRamp',
    applicableTypes: ['IfcRamp'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'HandicapAccessible', type: PropertyValueType.Boolean, description: 'Whether accessible for handicapped persons' },
      { name: 'HasGuardRail', type: PropertyValueType.Boolean, description: 'Whether has guard rail' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'FireExit', type: PropertyValueType.Boolean, description: 'Whether designated as fire exit' },
      { name: 'RequiredSlope', type: PropertyValueType.Real, description: 'Required slope for the ramp' },
      { name: 'RequiredHeadroom', type: PropertyValueType.Real, description: 'Required headroom clearance (m)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Roof Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_RoofCommon',
    description: 'Properties common to the definition of all occurrences of IfcRoof',
    applicableTypes: ['IfcRoof'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'ThermalTransmittance', type: PropertyValueType.Real, description: 'Thermal transmittance (U-value)' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating' },
      { name: 'ProjectedArea', type: PropertyValueType.Real, description: 'Projected area of the roof (m²)' },
      { name: 'TotalArea', type: PropertyValueType.Real, description: 'Total surface area of the roof (m²)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Covering Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_CoveringCommon',
    description: 'Properties common to the definition of all occurrences of IfcCovering',
    applicableTypes: ['IfcCovering'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'FlammabilityRating', type: PropertyValueType.Label, description: 'Flammability rating' },
      { name: 'FragilityRating', type: PropertyValueType.Label, description: 'Fragility rating' },
      { name: 'Combustible', type: PropertyValueType.Boolean, description: 'Whether the material is combustible' },
      { name: 'SurfaceSpreadOfFlame', type: PropertyValueType.Label, description: 'Surface spread of flame' },
      { name: 'Finish', type: PropertyValueType.Label, description: 'Finish material description' },
      { name: 'TotalThickness', type: PropertyValueType.Real, description: 'Total thickness (mm)' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Railing Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_RailingCommon',
    description: 'Properties common to the definition of all occurrences of IfcRailing',
    applicableTypes: ['IfcRailing'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'Height', type: PropertyValueType.Real, description: 'Height of the railing (mm)' },
      { name: 'Diameter', type: PropertyValueType.Real, description: 'Diameter of railing profile (mm)' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Space Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_SpaceCommon',
    description: 'Properties common to the definition of all occurrences of IfcSpace',
    applicableTypes: ['IfcSpace'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the space is external' },
      { name: 'GrossPlannedArea', type: PropertyValueType.Real, description: 'Gross planned area (m²)' },
      { name: 'NetPlannedArea', type: PropertyValueType.Real, description: 'Net planned area (m²)' },
      { name: 'PubliclyAccessible', type: PropertyValueType.Boolean, description: 'Whether publicly accessible' },
      { name: 'HandicapAccessible', type: PropertyValueType.Boolean, description: 'Whether accessible for handicapped' },
      { name: 'Category', type: PropertyValueType.Label, description: 'Category of space (office, circulation, etc.)' },
    ],
  },
  {
    name: 'Pset_SpaceFireSafetyRequirements',
    description: 'Fire safety requirements for spaces',
    applicableTypes: ['IfcSpace'],
    properties: [
      { name: 'FireRiskFactor', type: PropertyValueType.Label, description: 'Fire risk classification' },
      { name: 'FlammableStorage', type: PropertyValueType.Boolean, description: 'Whether flammable materials stored' },
      { name: 'FireExit', type: PropertyValueType.Boolean, description: 'Whether space has fire exit' },
      { name: 'SprinklerProtection', type: PropertyValueType.Boolean, description: 'Whether has sprinkler protection' },
      { name: 'SprinklerProtectionAutomatic', type: PropertyValueType.Boolean, description: 'Whether sprinkler is automatic' },
      { name: 'AirPressurization', type: PropertyValueType.Boolean, description: 'Whether has air pressurization' },
    ],
  },
  {
    name: 'Pset_SpaceOccupancyRequirements',
    description: 'Occupancy requirements for spaces',
    applicableTypes: ['IfcSpace'],
    properties: [
      { name: 'OccupancyType', type: PropertyValueType.Label, description: 'Type of occupancy' },
      { name: 'OccupancyNumber', type: PropertyValueType.Integer, description: 'Number of occupants' },
      { name: 'OccupancyNumberPeak', type: PropertyValueType.Integer, description: 'Peak occupancy number' },
      { name: 'OccupancyTimePerDay', type: PropertyValueType.Real, description: 'Occupancy time per day (hours)' },
      { name: 'AreaPerOccupant', type: PropertyValueType.Real, description: 'Area per occupant (m²)' },
      { name: 'MinimumHeadroom', type: PropertyValueType.Real, description: 'Minimum headroom requirement (m)' },
      { name: 'IsOutlookDesirable', type: PropertyValueType.Boolean, description: 'Whether outlook is desirable' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Building Storey Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_BuildingStoreyCommon',
    description: 'Properties common to the definition of all occurrences of IfcBuildingStorey',
    applicableTypes: ['IfcBuildingStorey'],
    properties: [
      { name: 'EntranceLevel', type: PropertyValueType.Boolean, description: 'Whether this is the entrance level' },
      { name: 'AboveGround', type: PropertyValueType.Boolean, description: 'Whether storey is above ground' },
      { name: 'SprinklerProtection', type: PropertyValueType.Boolean, description: 'Whether has sprinkler protection' },
      { name: 'SprinklerProtectionAutomatic', type: PropertyValueType.Boolean, description: 'Whether sprinkler is automatic' },
      { name: 'LoadBearingCapacity', type: PropertyValueType.Real, description: 'Load bearing capacity (kN/m²)' },
      { name: 'GrossAreaPlanned', type: PropertyValueType.Real, description: 'Gross planned area (m²)' },
      { name: 'NetAreaPlanned', type: PropertyValueType.Real, description: 'Net planned area (m²)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Building Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_BuildingCommon',
    description: 'Properties common to the definition of all occurrences of IfcBuilding',
    applicableTypes: ['IfcBuilding'],
    properties: [
      { name: 'BuildingID', type: PropertyValueType.Identifier, description: 'Identifier of the building' },
      { name: 'IsPermanentID', type: PropertyValueType.Boolean, description: 'Whether BuildingID is permanent' },
      { name: 'ConstructionMethod', type: PropertyValueType.Label, description: 'Construction method' },
      { name: 'OccupancyType', type: PropertyValueType.Label, description: 'Type of occupancy' },
      { name: 'NumberOfStoreys', type: PropertyValueType.Integer, description: 'Total number of storeys' },
      { name: 'YearOfConstruction', type: PropertyValueType.Integer, description: 'Year of construction' },
      { name: 'YearOfLastRefurbishment', type: PropertyValueType.Integer, description: 'Year of last refurbishment' },
      { name: 'IsLandmarked', type: PropertyValueType.Boolean, description: 'Whether building is landmarked' },
      { name: 'SprinklerProtection', type: PropertyValueType.Boolean, description: 'Whether has sprinkler protection' },
      { name: 'SprinklerProtectionAutomatic', type: PropertyValueType.Boolean, description: 'Whether sprinkler is automatic' },
      { name: 'GrossPlannedArea', type: PropertyValueType.Real, description: 'Gross planned area (m²)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Generic Property Sets (applicable to all building elements)
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_ManufacturerTypeInformation',
    description: 'Manufacturer type information applicable to all elements',
    applicableTypes: [
      'IfcWall', 'IfcWallStandardCase', 'IfcDoor', 'IfcWindow',
      'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRamp',
      'IfcRoof', 'IfcCovering', 'IfcCurtainWall', 'IfcRailing',
      'IfcBuildingElementProxy', 'IfcFurnishingElement',
    ],
    properties: [
      { name: 'GlobalTradeItemNumber', type: PropertyValueType.Identifier, description: 'Global Trade Item Number (GTIN)' },
      { name: 'ArticleNumber', type: PropertyValueType.Identifier, description: 'Article number from manufacturer' },
      { name: 'ModelReference', type: PropertyValueType.Label, description: 'Model reference designation' },
      { name: 'ModelLabel', type: PropertyValueType.Label, description: 'Model label' },
      { name: 'Manufacturer', type: PropertyValueType.Label, description: 'Manufacturer name' },
      { name: 'ProductionYear', type: PropertyValueType.Integer, description: 'Year of production' },
    ],
  },
  {
    name: 'Pset_ManufacturerOccurrence',
    description: 'Manufacturer occurrence information applicable to all elements',
    applicableTypes: [
      'IfcWall', 'IfcWallStandardCase', 'IfcDoor', 'IfcWindow',
      'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRamp',
      'IfcRoof', 'IfcCovering', 'IfcCurtainWall', 'IfcRailing',
      'IfcBuildingElementProxy', 'IfcFurnishingElement',
    ],
    properties: [
      { name: 'AcquisitionDate', type: PropertyValueType.Label, description: 'Date of acquisition' },
      { name: 'BarCode', type: PropertyValueType.Identifier, description: 'Bar code identifier' },
      { name: 'SerialNumber', type: PropertyValueType.Identifier, description: 'Serial number' },
      { name: 'BatchReference', type: PropertyValueType.Identifier, description: 'Batch reference' },
      { name: 'AssemblyPlace', type: PropertyValueType.Label, description: 'Where assembled (Factory/Site)' },
    ],
  },
  {
    name: 'Pset_Condition',
    description: 'Condition assessment applicable to all elements',
    applicableTypes: [
      'IfcWall', 'IfcWallStandardCase', 'IfcDoor', 'IfcWindow',
      'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRamp',
      'IfcRoof', 'IfcCovering', 'IfcCurtainWall', 'IfcRailing',
      'IfcBuildingElementProxy', 'IfcFurnishingElement',
    ],
    properties: [
      { name: 'AssessmentDate', type: PropertyValueType.Label, description: 'Date of condition assessment' },
      { name: 'AssessmentCondition', type: PropertyValueType.Label, description: 'Assessed condition rating' },
      { name: 'AssessmentDescription', type: PropertyValueType.Label, description: 'Description of condition' },
    ],
  },
  {
    name: 'Pset_Warranty',
    description: 'Warranty information applicable to all elements',
    applicableTypes: [
      'IfcWall', 'IfcWallStandardCase', 'IfcDoor', 'IfcWindow',
      'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRamp',
      'IfcRoof', 'IfcCovering', 'IfcCurtainWall', 'IfcRailing',
      'IfcBuildingElementProxy', 'IfcFurnishingElement',
    ],
    properties: [
      { name: 'WarrantyIdentifier', type: PropertyValueType.Identifier, description: 'Warranty identifier' },
      { name: 'WarrantyStartDate', type: PropertyValueType.Label, description: 'Warranty start date' },
      { name: 'WarrantyEndDate', type: PropertyValueType.Label, description: 'Warranty end date' },
      { name: 'WarrantyPeriod', type: PropertyValueType.Real, description: 'Warranty duration (years)' },
      { name: 'WarrantyContent', type: PropertyValueType.Label, description: 'Description of warranty coverage' },
      { name: 'PointOfContact', type: PropertyValueType.Label, description: 'Warranty contact point' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Curtain Wall Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_CurtainWallCommon',
    description: 'Properties common to the definition of all occurrences of IfcCurtainWall',
    applicableTypes: ['IfcCurtainWall'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
      { name: 'AcousticRating', type: PropertyValueType.Label, description: 'Acoustic rating' },
      { name: 'ThermalTransmittance', type: PropertyValueType.Real, description: 'Thermal transmittance (U-value)' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Building Element Proxy Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_BuildingElementProxyCommon',
    description: 'Properties common to the definition of IfcBuildingElementProxy',
    applicableTypes: ['IfcBuildingElementProxy'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'IsExternal', type: PropertyValueType.Boolean, description: 'Whether the element is external' },
      { name: 'LoadBearing', type: PropertyValueType.Boolean, description: 'Whether the element is load bearing' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Footing Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_FootingCommon',
    description: 'Properties common to the definition of all occurrences of IfcFooting',
    applicableTypes: ['IfcFooting'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'LoadBearing', type: PropertyValueType.Boolean, description: 'Whether the element is load bearing' },
      { name: 'FireRating', type: PropertyValueType.Label, description: 'Fire resistance rating' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Furnishing Element Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_FurnitureTypeCommon',
    description: 'Properties for furnishing elements',
    applicableTypes: ['IfcFurnishingElement'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
      { name: 'NominalLength', type: PropertyValueType.Real, description: 'Nominal length (mm)' },
      { name: 'NominalWidth', type: PropertyValueType.Real, description: 'Nominal width (mm)' },
      { name: 'NominalHeight', type: PropertyValueType.Real, description: 'Nominal height (mm)' },
      { name: 'MainColour', type: PropertyValueType.Label, description: 'Main colour' },
      { name: 'Style', type: PropertyValueType.Label, description: 'Style designation' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Distribution / MEP Property Sets
  // ---------------------------------------------------------------------------
  {
    name: 'Pset_DistributionElementCommon',
    description: 'Properties common to distribution elements',
    applicableTypes: ['IfcDistributionElement', 'IfcFlowTerminal', 'IfcFlowSegment'],
    properties: [
      { name: 'Reference', type: PropertyValueType.Identifier, description: 'Reference ID' },
      { name: 'Status', type: PropertyValueType.Label, description: 'Status of the element' },
    ],
  },
];

// ============================================================================
// Common Classification Systems
// ============================================================================

export interface ClassificationSystemDef {
  name: string;
  description: string;
  editionDate?: string;
}

export const CLASSIFICATION_SYSTEMS: ClassificationSystemDef[] = [
  { name: 'Uniclass 2015', description: 'UK standard classification system for the construction industry' },
  { name: 'OmniClass', description: 'North American classification system for the construction industry' },
  { name: 'MasterFormat', description: 'CSI/CSC specification numbering system' },
  { name: 'UniFormat', description: 'CSI/CSC uniform classification for building elements' },
  { name: 'ICS', description: 'International Classification for Standards' },
  { name: 'CCS', description: 'Cuneco Classification System (Denmark)' },
  { name: 'SfB', description: 'SfB classification system' },
  { name: 'ETIM', description: 'European Technical Information Model' },
  { name: 'CoClass', description: 'Swedish classification system for the built environment' },
  { name: 'NS 3451', description: 'Norwegian building parts table' },
  { name: 'NL/SfB', description: 'Dutch classification system' },
  { name: 'Custom', description: 'Custom classification system' },
];

// ============================================================================
// Lookup Functions
// ============================================================================

// Pre-computed uppercase -> PascalCase lookup map for all known types
const KNOWN_TYPE_MAP = new Map<string, string>();
for (const pset of PSET_DEFINITIONS) {
  for (const t of pset.applicableTypes) {
    KNOWN_TYPE_MAP.set(t.toUpperCase(), t);
  }
}

/**
 * Normalize entity type name for lookup (handles IFCWALL -> IfcWall, etc.)
 */
function normalizeTypeName(type: string): string {
  if (type.startsWith('Ifc')) return type;
  const upper = type.toUpperCase();
  if (!upper.startsWith('IFC')) return type;

  // O(1) lookup from pre-computed map
  const known = KNOWN_TYPE_MAP.get(upper);
  if (known) return known;

  // Fallback: convert IFCWALLSTANDARDCASE -> IfcWallstandardcase
  // Preserves Ifc prefix with capitalized first letter after it
  const rest = type.slice(3).toLowerCase();
  return 'Ifc' + rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * Get all valid property set definitions for a given IFC entity type.
 * Optionally filters by schema version (IFC2X3, IFC4, IFC4X3).
 * Includes type-specific Psets and generic ones applicable to all building elements.
 */
export function getPsetDefinitionsForType(entityType: string, schemaVersion?: string): PsetDefinition[] {
  const normalized = normalizeTypeName(entityType);

  return PSET_DEFINITIONS.filter(pset => {
    // Check type match
    const typeMatch = pset.applicableTypes.some(t => t === normalized);
    if (!typeMatch) return false;

    // Check schema match (if specified and pset has schema restriction)
    if (schemaVersion && pset.schemas) {
      return pset.schemas.includes(schemaVersion as 'IFC2X3' | 'IFC4' | 'IFC4X3');
    }

    return true;
  });
}

/**
 * Get a specific property set definition by name.
 */
export function getPsetDefinition(psetName: string): PsetDefinition | undefined {
  return PSET_DEFINITIONS.find(p => p.name === psetName);
}

/**
 * Get all known property set definitions.
 */
export function getAllPsetDefinitions(): PsetDefinition[] {
  return PSET_DEFINITIONS;
}

/**
 * Check if a property set name is a known IFC4 standard property set.
 */
export function isStandardPset(psetName: string): boolean {
  return PSET_DEFINITIONS.some(p => p.name === psetName);
}

/**
 * Get the property definitions for a specific property set.
 */
export function getPropertiesForPset(psetName: string): PsetPropertyDef[] {
  const pset = PSET_DEFINITIONS.find(p => p.name === psetName);
  return pset ? pset.properties : [];
}
