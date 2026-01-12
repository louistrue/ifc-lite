/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC Schema Registry
 * 
 * Defines IFC entity type inheritance hierarchy and attributes.
 * Follows the IFC specification inheritance structure.
 */

/**
 * Type inheritance map: child -> parent
 */
const INHERITANCE_MAP: Map<string, string> = new Map([
    // Root level
    ['IfcRoot', ''],

    // Object definition hierarchy
    ['IfcObjectDefinition', 'IfcRoot'],
    ['IfcObject', 'IfcObjectDefinition'],
    ['IfcProduct', 'IfcObject'],
    ['IfcElement', 'IfcProduct'],
    ['IfcBuildingElement', 'IfcElement'],

    // Spatial structure
    ['IfcSpatialElement', 'IfcProduct'],
    ['IfcSpatialStructureElement', 'IfcSpatialElement'],
    ['IfcProject', 'IfcSpatialStructureElement'],
    ['IfcSite', 'IfcSpatialStructureElement'],
    ['IfcBuilding', 'IfcSpatialStructureElement'],
    ['IfcBuildingStorey', 'IfcSpatialStructureElement'],
    ['IfcSpace', 'IfcSpatialElement'],

    // Building elements
    ['IfcWall', 'IfcBuildingElement'],
    ['IfcWallStandardCase', 'IfcWall'],
    ['IfcSlab', 'IfcBuildingElement'],
    ['IfcBeam', 'IfcBuildingElement'],
    ['IfcColumn', 'IfcBuildingElement'],
    ['IfcRoof', 'IfcBuildingElement'],
    ['IfcStair', 'IfcBuildingElement'],
    ['IfcRamp', 'IfcBuildingElement'],
    ['IfcRailing', 'IfcBuildingElement'],
    ['IfcFooting', 'IfcBuildingElement'],
    ['IfcBuildingElementProxy', 'IfcBuildingElement'],
    ['IfcFurnishingElement', 'IfcElement'],

    // Openings and fillings
    ['IfcOpeningElement', 'IfcElement'],
    ['IfcWindow', 'IfcBuildingElement'],
    ['IfcDoor', 'IfcBuildingElement'],

    // MEP
    ['IfcDistributionElement', 'IfcElement'],
    ['IfcFlowSegment', 'IfcDistributionElement'],
    ['IfcFlowTerminal', 'IfcDistributionElement'],

    // Relationships
    ['IfcRelationship', 'IfcRoot'],
    ['IfcRelDefines', 'IfcRelationship'],
    ['IfcRelDefinesByProperties', 'IfcRelDefines'],
    ['IfcRelDefinesByType', 'IfcRelDefines'],
    ['IfcRelConnects', 'IfcRelationship'],
    ['IfcRelVoidsElement', 'IfcRelConnects'],
    ['IfcRelFillsElement', 'IfcRelConnects'],
    ['IfcRelContainedInSpatialStructure', 'IfcRelConnects'],
    ['IfcRelAggregates', 'IfcRelConnects'],
    ['IfcRelAssociates', 'IfcRelationship'],
    ['IfcRelAssociatesMaterial', 'IfcRelAssociates'],

    // Property sets
    ['IfcPropertyDefinition', 'IfcRoot'],
    ['IfcPropertySet', 'IfcPropertyDefinition'],
    ['IfcProperty', 'IfcRoot'],
    ['IfcPropertySingleValue', 'IfcProperty'],

    // Geometry and placement
    ['IfcPlacement', 'IfcGeometricRepresentationItem'],
    ['IfcLocalPlacement', 'IfcPlacement'],
    ['IfcOwnerHistory', 'IfcRoot'],
]);

/**
 * Attributes defined at each entity type level (only attributes added at this level)
 */
const TYPE_ATTRIBUTES: Map<string, string[]> = new Map([
    // IfcRoot (base)
    ['IfcRoot', ['GlobalId', 'OwnerHistory', 'Name', 'Description']],

    // IfcObjectDefinition (no new attributes, but needed for inheritance walk)
    ['IfcObjectDefinition', []],

    // IfcObject
    ['IfcObject', ['ObjectType']],

    // IfcProduct
    ['IfcProduct', ['ObjectPlacement', 'Representation']],

    // IfcElement
    ['IfcElement', ['Tag']],

    // IfcBuildingElement (no new attributes, but needed for inheritance walk)
    ['IfcBuildingElement', []],

    // Spatial structure
    ['IfcProject', []],
    ['IfcSite', []],
    ['IfcBuilding', []],
    ['IfcBuildingStorey', []],
    ['IfcSpace', []],

    // Building elements
    ['IfcWall', ['PredefinedType']],
    ['IfcWallStandardCase', []],
    ['IfcSlab', ['PredefinedType']],
    ['IfcBeam', ['PredefinedType']],
    ['IfcColumn', ['PredefinedType']],
    ['IfcRoof', ['PredefinedType']],
    ['IfcStair', ['PredefinedType']],
    ['IfcRamp', ['PredefinedType']],
    ['IfcRailing', ['PredefinedType']],
    ['IfcFooting', ['PredefinedType']],
    ['IfcBuildingElementProxy', ['PredefinedType']],
    ['IfcFurnishingElement', ['PredefinedType']],

    // Openings and fillings
    ['IfcOpeningElement', ['PredefinedType']],
    ['IfcWindow', ['OverallHeight', 'OverallWidth', 'PredefinedType', 'PartitioningType', 'UserDefinedPartitioningType']],
    ['IfcDoor', ['OverallHeight', 'OverallWidth', 'PredefinedType', 'OperationType', 'UserDefinedOperationType']],

    // MEP
    ['IfcDistributionElement', ['PredefinedType']],
    ['IfcFlowSegment', []],
    ['IfcFlowTerminal', []],

    // Relationships
    ['IfcRelationship', []],
    ['IfcRelDefines', []],
    ['IfcRelDefinesByProperties', []], // Attributes handled specially in relationship-extractor
    ['IfcRelDefinesByType', []],
    ['IfcRelConnects', []],
    ['IfcRelVoidsElement', []],
    ['IfcRelFillsElement', []],
    ['IfcRelContainedInSpatialStructure', []],
    ['IfcRelAggregates', []],
    ['IfcRelAssociates', []],
    ['IfcRelAssociatesMaterial', []],

    // Property sets
    ['IfcPropertyDefinition', []],
    ['IfcPropertySet', ['HasProperties']],
    ['IfcProperty', ['Name']],
    ['IfcPropertySingleValue', ['NominalValue', 'Unit']],

    // Geometry and placement
    ['IfcPlacement', ['PlacementLocation']],
    ['IfcLocalPlacement', ['PlacementRelTo', 'RelativePlacement']],
    ['IfcOwnerHistory', ['OwningUser', 'OwningApplication', 'State', 'ChangeAction', 'LastModifiedDate', 'LastModifyingUser', 'LastModifyingApplication', 'CreationDate']],
]);

/**
 * Get the parent type for a given IFC entity type
 */
function getParentType(type: string): string | null {
    const normalized = normalizeTypeName(type);
    const parent = INHERITANCE_MAP.get(normalized);
    return parent && parent !== '' ? parent : null;
}

/**
 * Normalize type name (handle case variations)
 * Converts: IFCWINDOW -> IfcWindow, IfcWindow -> IfcWindow, ifcwindow -> IfcWindow
 */
function normalizeTypeName(type: string): string {
    // If already in correct format (starts with "Ifc"), return as-is
    if (type.startsWith('Ifc')) {
        return type;
    }

    // Convert uppercase or mixed case to PascalCase
    const upper = type.toUpperCase();
    if (upper.startsWith('IFC')) {
        // IFCWINDOW -> IfcWindow
        // IFCWALLSTANDARDCASE -> IfcWallStandardCase
        const rest = type.slice(3); // Remove "IFC" or "Ifc"
        // Convert rest to PascalCase (capitalize first letter, lowercase rest)
        const pascalRest = rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
        return 'Ifc' + pascalRest;
    }

    // If doesn't start with IFC, assume it's already normalized or return as-is
    return type;
}

/**
 * Get all attributes for an IFC entity type by walking the inheritance chain
 */
export function getAttributeNames(type: string): string[] {
    const normalized = normalizeTypeName(type);
    const attributes: string[] = [];
    const visited = new Set<string>();

    let currentType: string | null = normalized;

    // Walk up the inheritance chain
    while (currentType && !visited.has(currentType)) {
        visited.add(currentType);

        const typeAttrs = TYPE_ATTRIBUTES.get(currentType);
        if (typeAttrs) {
            // Prepend attributes (parent attributes come first)
            attributes.unshift(...typeAttrs);
        }

        currentType = getParentType(currentType);
    }

    // If no attributes found, return empty array (will fallback to indexed)
    return attributes;
}

/**
 * Check if a type is known in the schema
 */
export function isKnownType(type: string): boolean {
    const normalized = normalizeTypeName(type);
    return INHERITANCE_MAP.has(normalized) || TYPE_ATTRIBUTES.has(normalized);
}

/**
 * Get attribute name at a specific index for a type
 */
export function getAttributeNameAt(type: string, index: number): string | null {
    const attributes = getAttributeNames(type);
    return attributes[index] || null;
}
