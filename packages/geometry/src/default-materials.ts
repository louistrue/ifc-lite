/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Default material colors for IFC entity types
 * Provides beautiful architectural colors when IFC surface styles are not available
 */

export interface MaterialColor {
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
}

/**
 * Default material palette inspired by architectural visualization
 */
export const DEFAULT_MATERIALS: Record<string, MaterialColor> = {
  // Structural elements
  'IfcWall': {
    baseColor: [0.95, 0.93, 0.88, 1.0], // Warm white (matte plaster)
    metallic: 0.0,
    roughness: 0.8,
  },
  'IfcSlab': {
    baseColor: [0.75, 0.75, 0.78, 1.0], // Cool gray (concrete)
    metallic: 0.0,
    roughness: 0.9,
  },
  'IfcColumn': {
    baseColor: [0.7, 0.7, 0.7, 1.0], // Light gray (concrete/steel)
    metallic: 0.0,
    roughness: 0.5,
  },
  'IfcBeam': {
    baseColor: [0.55, 0.55, 0.6, 1.0], // Steel blue
    metallic: 0.8,
    roughness: 0.4,
  },
  
  // Openings
  'IfcWindow': {
    baseColor: [0.6, 0.8, 0.95, 0.3], // Sky blue (glass, transparent)
    metallic: 0.0,
    roughness: 0.1,
  },
  'IfcDoor': {
    baseColor: [0.6, 0.45, 0.3, 1.0], // Warm wood
    metallic: 0.0,
    roughness: 0.6,
  },
  'IfcOpeningElement': {
    baseColor: [0.5, 0.5, 0.5, 0.5], // Gray (generic opening)
    metallic: 0.0,
    roughness: 0.5,
  },
  
  // Roof and stairs
  'IfcRoof': {
    baseColor: [0.7, 0.5, 0.4, 1.0], // Terra cotta (tiles)
    metallic: 0.0,
    roughness: 0.7,
  },
  'IfcStair': {
    baseColor: [0.8, 0.75, 0.65, 1.0], // Sandstone
    metallic: 0.0,
    roughness: 0.6,
  },
  'IfcRailing': {
    baseColor: [0.3, 0.3, 0.35, 1.0], // Dark metal
    metallic: 0.9,
    roughness: 0.3,
  },
  
  // Furniture and fixtures
  'IfcFurniture': {
    baseColor: [0.7, 0.6, 0.5, 1.0], // Natural wood
    metallic: 0.0,
    roughness: 0.5,
  },
  'IfcSanitaryTerminal': {
    baseColor: [0.9, 0.9, 0.95, 1.0], // White porcelain
    metallic: 0.0,
    roughness: 0.3,
  },
  
  // MEP elements
  'IfcPipeSegment': {
    baseColor: [0.4, 0.5, 0.6, 1.0], // Blue-gray (pipe)
    metallic: 0.7,
    roughness: 0.4,
  },
  'IfcDuctSegment': {
    baseColor: [0.6, 0.6, 0.65, 1.0], // Light gray (duct)
    metallic: 0.3,
    roughness: 0.5,
  },
  'IfcCableSegment': {
    baseColor: [0.3, 0.3, 0.3, 1.0], // Dark gray (cable)
    metallic: 0.0,
    roughness: 0.8,
  },
  
  // Default fallback
  'default': {
    baseColor: [0.8, 0.8, 0.8, 1.0], // Neutral gray
    metallic: 0.0,
    roughness: 0.6,
  },
};

/**
 * Get default material color for an IFC entity type
 */
export function getDefaultMaterialColor(entityType: string | null | undefined): MaterialColor {
  if (!entityType) {
    return DEFAULT_MATERIALS['default'];
  }
  
  // Normalize type name (remove 'IFC' prefix, handle case)
  const normalizedType = entityType.replace(/^IFC/, '').replace(/^Ifc/, '');
  const ifcType = `Ifc${normalizedType}`;
  
  return DEFAULT_MATERIALS[ifcType] || DEFAULT_MATERIALS[entityType] || DEFAULT_MATERIALS['default'];
}

/**
 * Get default color array for an IFC entity type (for backward compatibility)
 */
export function getDefaultColor(entityType: string | null | undefined): [number, number, number, number] {
  return getDefaultMaterialColor(entityType).baseColor;
}
