/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for columnar data structures
 */

export enum IfcTypeEnum {
  // Spatial structure
  IfcProject = 1,
  IfcSite = 2,
  IfcBuilding = 3,
  IfcBuildingStorey = 4,
  IfcSpace = 5,
  
  // Building elements
  IfcWall = 10,
  IfcWallStandardCase = 11,
  IfcDoor = 12,
  IfcWindow = 13,
  IfcSlab = 14,
  IfcColumn = 15,
  IfcBeam = 16,
  IfcStair = 17,
  IfcRamp = 18,
  IfcRoof = 19,
  IfcCovering = 20,
  IfcCurtainWall = 21,
  IfcRailing = 22,
  
  // Openings
  IfcOpeningElement = 30,
  
  // MEP
  IfcDistributionElement = 40,
  IfcFlowTerminal = 41,
  IfcFlowSegment = 42,
  IfcFlowFitting = 43,
  
  // Relationships
  IfcRelContainedInSpatialStructure = 100,
  IfcRelAggregates = 101,
  IfcRelDefinesByProperties = 102,
  IfcRelDefinesByType = 103,
  IfcRelAssociatesMaterial = 104,
  IfcRelAssociatesClassification = 105,
  IfcRelVoidsElement = 106,
  IfcRelFillsElement = 107,
  IfcRelConnectsPathElements = 108,
  IfcRelSpaceBoundary = 109,
  
  // Property definitions
  IfcPropertySet = 200,
  IfcPropertySingleValue = 201,
  IfcPropertyEnumeratedValue = 202,
  IfcPropertyBoundedValue = 203,
  IfcPropertyListValue = 204,
  IfcElementQuantity = 210,
  IfcQuantityLength = 211,
  IfcQuantityArea = 212,
  IfcQuantityVolume = 213,
  IfcQuantityCount = 214,
  IfcQuantityWeight = 215,
  
  // Types
  IfcWallType = 300,
  IfcDoorType = 301,
  IfcWindowType = 302,
  IfcSlabType = 303,
  IfcColumnType = 304,
  IfcBeamType = 305,
  
  Unknown = 9999,
}

export enum PropertyValueType {
  String = 0,
  Real = 1,
  Integer = 2,
  Boolean = 3,
  Logical = 4,
  Label = 5,
  Identifier = 6,
  Text = 7,
  Enum = 8,
  Reference = 9,
  List = 10,
}

export enum QuantityType {
  Length = 0,
  Area = 1,
  Volume = 2,
  Count = 3,
  Weight = 4,
  Time = 5,
}

export enum RelationshipType {
  ContainsElements = 1,
  Aggregates = 2,
  DefinesByProperties = 10,
  DefinesByType = 11,
  AssociatesMaterial = 20,
  AssociatesClassification = 30,
  ConnectsPathElements = 40,
  FillsElement = 41,
  VoidsElement = 42,
  ConnectsElements = 43,
  SpaceBoundary = 50,
  AssignsToGroup = 60,
  AssignsToProduct = 61,
  ReferencedInSpatialStructure = 70,
}

export enum EntityFlags {
  HAS_GEOMETRY = 0b00000001,
  HAS_PROPERTIES = 0b00000010,
  HAS_QUANTITIES = 0b00000100,
  IS_TYPE = 0b00001000,
  IS_EXTERNAL = 0b00010000,
  HAS_OPENINGS = 0b00100000,
  IS_FILLING = 0b01000000,
}

export interface SpatialNode {
  expressId: number;
  type: IfcTypeEnum;
  name: string;
  elevation?: number;
  children: SpatialNode[];
  elements: number[];  // Direct contained elements
}

export interface SpatialHierarchy {
  project: SpatialNode;
  byStorey: Map<number, number[]>;    // storeyId -> element IDs
  byBuilding: Map<number, number[]>;  // buildingId -> element IDs
  bySite: Map<number, number[]>;      // siteId -> element IDs
  bySpace: Map<number, number[]>;     // spaceId -> element IDs
  storeyElevations: Map<number, number>;  // storeyId -> elevation (z)
  storeyHeights: Map<number, number>;     // storeyId -> floor-to-floor height (calculated from elevation differences)
  elementToStorey: Map<number, number>;  // elementId -> storeyId (reverse lookup)
  
  // Helper methods
  getStoreyElements(storeyId: number): number[];
  getStoreyByElevation(z: number): number | null;
  getContainingSpace(elementId: number): number | null;
  getPath(elementId: number): SpatialNode[]; // Project → ... → Element
}

// Type conversion helpers
const TYPE_STRING_TO_ENUM = new Map<string, IfcTypeEnum>([
  ['IFCPROJECT', IfcTypeEnum.IfcProject],
  ['IFCSITE', IfcTypeEnum.IfcSite],
  ['IFCBUILDING', IfcTypeEnum.IfcBuilding],
  ['IFCBUILDINGSTOREY', IfcTypeEnum.IfcBuildingStorey],
  ['IFCSPACE', IfcTypeEnum.IfcSpace],
  ['IFCWALL', IfcTypeEnum.IfcWall],
  ['IFCWALLSTANDARDCASE', IfcTypeEnum.IfcWallStandardCase],
  ['IFCDOOR', IfcTypeEnum.IfcDoor],
  ['IFCWINDOW', IfcTypeEnum.IfcWindow],
  ['IFCSLAB', IfcTypeEnum.IfcSlab],
  ['IFCCOLUMN', IfcTypeEnum.IfcColumn],
  ['IFCBEAM', IfcTypeEnum.IfcBeam],
  ['IFCSTAIR', IfcTypeEnum.IfcStair],
  ['IFCRAMP', IfcTypeEnum.IfcRamp],
  ['IFCROOF', IfcTypeEnum.IfcRoof],
  ['IFCCOVERING', IfcTypeEnum.IfcCovering],
  ['IFCCURTAINWALL', IfcTypeEnum.IfcCurtainWall],
  ['IFCRAILING', IfcTypeEnum.IfcRailing],
  ['IFCOPENINGELEMENT', IfcTypeEnum.IfcOpeningElement],
  ['IFCDISTRIBUTIONELEMENT', IfcTypeEnum.IfcDistributionElement],
  ['IFCFLOWTERMINAL', IfcTypeEnum.IfcFlowTerminal],
  ['IFCFLOWSEGMENT', IfcTypeEnum.IfcFlowSegment],
  ['IFCFLOWFITTING', IfcTypeEnum.IfcFlowFitting],
  ['IFCRELCONTAINEDINSPATIALSTRUCTURE', IfcTypeEnum.IfcRelContainedInSpatialStructure],
  ['IFCRELAGGREGATES', IfcTypeEnum.IfcRelAggregates],
  ['IFCRELDEFINESBYPROPERTIES', IfcTypeEnum.IfcRelDefinesByProperties],
  ['IFCRELDEFINESBYTYPE', IfcTypeEnum.IfcRelDefinesByType],
  ['IFCRELASSOCIATESMATERIAL', IfcTypeEnum.IfcRelAssociatesMaterial],
  ['IFCRELASSOCIATESCLASSIFICATION', IfcTypeEnum.IfcRelAssociatesClassification],
  ['IFCRELVOIDSELEMENT', IfcTypeEnum.IfcRelVoidsElement],
  ['IFCRELFILLSELEMENT', IfcTypeEnum.IfcRelFillsElement],
  ['IFCRELCONNECTSPATHELEMENTS', IfcTypeEnum.IfcRelConnectsPathElements],
  ['IFCRELSPACEBOUNDARY', IfcTypeEnum.IfcRelSpaceBoundary],
  ['IFCPROPERTYSET', IfcTypeEnum.IfcPropertySet],
  ['IFCPROPERTYSINGLEVALUE', IfcTypeEnum.IfcPropertySingleValue],
  ['IFCPROPERTYENUMERATEDVALUE', IfcTypeEnum.IfcPropertyEnumeratedValue],
  ['IFCPROPERTYBOUNDEDVALUE', IfcTypeEnum.IfcPropertyBoundedValue],
  ['IFCPROPERTYLISTVALUE', IfcTypeEnum.IfcPropertyListValue],
  ['IFCELEMENTQUANTITY', IfcTypeEnum.IfcElementQuantity],
  ['IFCQUANTITYLENGTH', IfcTypeEnum.IfcQuantityLength],
  ['IFCQUANTITYAREA', IfcTypeEnum.IfcQuantityArea],
  ['IFCQUANTITYVOLUME', IfcTypeEnum.IfcQuantityVolume],
  ['IFCQUANTITYCOUNT', IfcTypeEnum.IfcQuantityCount],
  ['IFCQUANTITYWEIGHT', IfcTypeEnum.IfcQuantityWeight],
  ['IFCWALLTYPE', IfcTypeEnum.IfcWallType],
  ['IFCDOORTYPE', IfcTypeEnum.IfcDoorType],
  ['IFCWINDOWTYPE', IfcTypeEnum.IfcWindowType],
  ['IFCSLABTYPE', IfcTypeEnum.IfcSlabType],
  ['IFCCOLUMNTYPE', IfcTypeEnum.IfcColumnType],
  ['IFCBEAMTYPE', IfcTypeEnum.IfcBeamType],
]);

const TYPE_ENUM_TO_STRING = new Map<IfcTypeEnum, string>([
  [IfcTypeEnum.IfcProject, 'IfcProject'],
  [IfcTypeEnum.IfcSite, 'IfcSite'],
  [IfcTypeEnum.IfcBuilding, 'IfcBuilding'],
  [IfcTypeEnum.IfcBuildingStorey, 'IfcBuildingStorey'],
  [IfcTypeEnum.IfcSpace, 'IfcSpace'],
  [IfcTypeEnum.IfcWall, 'IfcWall'],
  [IfcTypeEnum.IfcWallStandardCase, 'IfcWallStandardCase'],
  [IfcTypeEnum.IfcDoor, 'IfcDoor'],
  [IfcTypeEnum.IfcWindow, 'IfcWindow'],
  [IfcTypeEnum.IfcSlab, 'IfcSlab'],
  [IfcTypeEnum.IfcColumn, 'IfcColumn'],
  [IfcTypeEnum.IfcBeam, 'IfcBeam'],
  [IfcTypeEnum.IfcStair, 'IfcStair'],
  [IfcTypeEnum.IfcRamp, 'IfcRamp'],
  [IfcTypeEnum.IfcRoof, 'IfcRoof'],
  [IfcTypeEnum.IfcCovering, 'IfcCovering'],
  [IfcTypeEnum.IfcCurtainWall, 'IfcCurtainWall'],
  [IfcTypeEnum.IfcRailing, 'IfcRailing'],
  [IfcTypeEnum.IfcOpeningElement, 'IfcOpeningElement'],
  [IfcTypeEnum.IfcDistributionElement, 'IfcDistributionElement'],
  [IfcTypeEnum.IfcFlowTerminal, 'IfcFlowTerminal'],
  [IfcTypeEnum.IfcFlowSegment, 'IfcFlowSegment'],
  [IfcTypeEnum.IfcFlowFitting, 'IfcFlowFitting'],
  [IfcTypeEnum.IfcRelContainedInSpatialStructure, 'IfcRelContainedInSpatialStructure'],
  [IfcTypeEnum.IfcRelAggregates, 'IfcRelAggregates'],
  [IfcTypeEnum.IfcRelDefinesByProperties, 'IfcRelDefinesByProperties'],
  [IfcTypeEnum.IfcRelDefinesByType, 'IfcRelDefinesByType'],
  [IfcTypeEnum.IfcRelAssociatesMaterial, 'IfcRelAssociatesMaterial'],
  [IfcTypeEnum.IfcRelAssociatesClassification, 'IfcRelAssociatesClassification'],
  [IfcTypeEnum.IfcRelVoidsElement, 'IfcRelVoidsElement'],
  [IfcTypeEnum.IfcRelFillsElement, 'IfcRelFillsElement'],
  [IfcTypeEnum.IfcRelConnectsPathElements, 'IfcRelConnectsPathElements'],
  [IfcTypeEnum.IfcRelSpaceBoundary, 'IfcRelSpaceBoundary'],
  [IfcTypeEnum.IfcPropertySet, 'IfcPropertySet'],
  [IfcTypeEnum.IfcPropertySingleValue, 'IfcPropertySingleValue'],
  [IfcTypeEnum.IfcPropertyEnumeratedValue, 'IfcPropertyEnumeratedValue'],
  [IfcTypeEnum.IfcPropertyBoundedValue, 'IfcPropertyBoundedValue'],
  [IfcTypeEnum.IfcPropertyListValue, 'IfcPropertyListValue'],
  [IfcTypeEnum.IfcElementQuantity, 'IfcElementQuantity'],
  [IfcTypeEnum.IfcQuantityLength, 'IfcQuantityLength'],
  [IfcTypeEnum.IfcQuantityArea, 'IfcQuantityArea'],
  [IfcTypeEnum.IfcQuantityVolume, 'IfcQuantityVolume'],
  [IfcTypeEnum.IfcQuantityCount, 'IfcQuantityCount'],
  [IfcTypeEnum.IfcQuantityWeight, 'IfcQuantityWeight'],
  [IfcTypeEnum.IfcWallType, 'IfcWallType'],
  [IfcTypeEnum.IfcDoorType, 'IfcDoorType'],
  [IfcTypeEnum.IfcWindowType, 'IfcWindowType'],
  [IfcTypeEnum.IfcSlabType, 'IfcSlabType'],
  [IfcTypeEnum.IfcColumnType, 'IfcColumnType'],
  [IfcTypeEnum.IfcBeamType, 'IfcBeamType'],
]);

export function IfcTypeEnumFromString(str: string): IfcTypeEnum {
  return TYPE_STRING_TO_ENUM.get(str.toUpperCase()) ?? IfcTypeEnum.Unknown;
}

export function IfcTypeEnumToString(type: IfcTypeEnum): string {
  return TYPE_ENUM_TO_STRING.get(type) ?? 'Unknown';
}
