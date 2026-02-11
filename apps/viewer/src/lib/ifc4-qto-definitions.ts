/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC4 Quantity Set Definitions (Qto_)
 *
 * Maps IFC entity types to their standard base quantities
 * according to the IFC4 standard (ISO 16739-1:2018).
 *
 * Used by the quantity editor to validate and suggest additions.
 */

import { QuantityType } from '@ifc-lite/data';

export interface QtoQuantityDef {
  name: string;
  type: QuantityType;
  description: string;
  unit: string;
}

export interface QtoDefinition {
  name: string;
  description: string;
  applicableTypes: string[];
  quantities: QtoQuantityDef[];
}

// ============================================================================
// IFC4 Standard Quantity Set Definitions
// ============================================================================

const QTO_DEFINITIONS: QtoDefinition[] = [
  // ---------------------------------------------------------------------------
  // Wall Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_WallBaseQuantities',
    description: 'Base quantities for walls',
    applicableTypes: ['IfcWall', 'IfcWallStandardCase', 'IfcCurtainWall'],
    quantities: [
      { name: 'Length', type: QuantityType.Length, description: 'Length along the wall path', unit: 'm' },
      { name: 'Width', type: QuantityType.Length, description: 'Wall thickness', unit: 'm' },
      { name: 'Height', type: QuantityType.Length, description: 'Wall height', unit: 'm' },
      { name: 'GrossFootprintArea', type: QuantityType.Area, description: 'Gross footprint area including openings', unit: 'm²' },
      { name: 'NetFootprintArea', type: QuantityType.Area, description: 'Net footprint area excluding openings', unit: 'm²' },
      { name: 'GrossSideArea', type: QuantityType.Area, description: 'Gross side area including openings', unit: 'm²' },
      { name: 'NetSideArea', type: QuantityType.Area, description: 'Net side area excluding openings', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume including openings', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume excluding openings', unit: 'm³' },
      { name: 'GrossWeight', type: QuantityType.Weight, description: 'Gross weight', unit: 'kg' },
      { name: 'NetWeight', type: QuantityType.Weight, description: 'Net weight', unit: 'kg' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Slab Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_SlabBaseQuantities',
    description: 'Base quantities for slabs',
    applicableTypes: ['IfcSlab'],
    quantities: [
      { name: 'Width', type: QuantityType.Length, description: 'Slab thickness', unit: 'm' },
      { name: 'Perimeter', type: QuantityType.Length, description: 'Slab perimeter', unit: 'm' },
      { name: 'GrossArea', type: QuantityType.Area, description: 'Gross area including openings', unit: 'm²' },
      { name: 'NetArea', type: QuantityType.Area, description: 'Net area excluding openings', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume including openings', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume excluding openings', unit: 'm³' },
      { name: 'GrossWeight', type: QuantityType.Weight, description: 'Gross weight', unit: 'kg' },
      { name: 'NetWeight', type: QuantityType.Weight, description: 'Net weight', unit: 'kg' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Door Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_DoorBaseQuantities',
    description: 'Base quantities for doors',
    applicableTypes: ['IfcDoor'],
    quantities: [
      { name: 'Width', type: QuantityType.Length, description: 'Overall width', unit: 'm' },
      { name: 'Height', type: QuantityType.Length, description: 'Overall height', unit: 'm' },
      { name: 'Perimeter', type: QuantityType.Length, description: 'Perimeter of door opening', unit: 'm' },
      { name: 'Area', type: QuantityType.Area, description: 'Total area of door opening', unit: 'm²' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Window Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_WindowBaseQuantities',
    description: 'Base quantities for windows',
    applicableTypes: ['IfcWindow'],
    quantities: [
      { name: 'Width', type: QuantityType.Length, description: 'Overall width', unit: 'm' },
      { name: 'Height', type: QuantityType.Length, description: 'Overall height', unit: 'm' },
      { name: 'Perimeter', type: QuantityType.Length, description: 'Perimeter of window opening', unit: 'm' },
      { name: 'Area', type: QuantityType.Area, description: 'Total area of window opening', unit: 'm²' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Column Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_ColumnBaseQuantities',
    description: 'Base quantities for columns',
    applicableTypes: ['IfcColumn'],
    quantities: [
      { name: 'Length', type: QuantityType.Length, description: 'Column length (typically height)', unit: 'm' },
      { name: 'CrossSectionArea', type: QuantityType.Area, description: 'Cross section area', unit: 'm²' },
      { name: 'OuterSurfaceArea', type: QuantityType.Area, description: 'Outer surface area', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume', unit: 'm³' },
      { name: 'GrossWeight', type: QuantityType.Weight, description: 'Gross weight', unit: 'kg' },
      { name: 'NetWeight', type: QuantityType.Weight, description: 'Net weight', unit: 'kg' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Beam Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_BeamBaseQuantities',
    description: 'Base quantities for beams',
    applicableTypes: ['IfcBeam'],
    quantities: [
      { name: 'Length', type: QuantityType.Length, description: 'Beam length', unit: 'm' },
      { name: 'CrossSectionArea', type: QuantityType.Area, description: 'Cross section area', unit: 'm²' },
      { name: 'OuterSurfaceArea', type: QuantityType.Area, description: 'Outer surface area', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume', unit: 'm³' },
      { name: 'GrossWeight', type: QuantityType.Weight, description: 'Gross weight', unit: 'kg' },
      { name: 'NetWeight', type: QuantityType.Weight, description: 'Net weight', unit: 'kg' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Stair Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_StairFlightBaseQuantities',
    description: 'Base quantities for stair flights',
    applicableTypes: ['IfcStair'],
    quantities: [
      { name: 'Length', type: QuantityType.Length, description: 'Stair flight length', unit: 'm' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume', unit: 'm³' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Ramp Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_RampFlightBaseQuantities',
    description: 'Base quantities for ramp flights',
    applicableTypes: ['IfcRamp'],
    quantities: [
      { name: 'Length', type: QuantityType.Length, description: 'Ramp flight length', unit: 'm' },
      { name: 'Width', type: QuantityType.Length, description: 'Ramp width', unit: 'm' },
      { name: 'GrossArea', type: QuantityType.Area, description: 'Gross area', unit: 'm²' },
      { name: 'NetArea', type: QuantityType.Area, description: 'Net area', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume', unit: 'm³' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Roof Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_RoofBaseQuantities',
    description: 'Base quantities for roofs',
    applicableTypes: ['IfcRoof'],
    quantities: [
      { name: 'GrossArea', type: QuantityType.Area, description: 'Total gross area of the roof', unit: 'm²' },
      { name: 'NetArea', type: QuantityType.Area, description: 'Net area excluding openings', unit: 'm²' },
      { name: 'ProjectedArea', type: QuantityType.Area, description: 'Projected horizontal area', unit: 'm²' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Covering Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_CoveringBaseQuantities',
    description: 'Base quantities for coverings',
    applicableTypes: ['IfcCovering'],
    quantities: [
      { name: 'Width', type: QuantityType.Length, description: 'Covering thickness', unit: 'm' },
      { name: 'GrossArea', type: QuantityType.Area, description: 'Gross area', unit: 'm²' },
      { name: 'NetArea', type: QuantityType.Area, description: 'Net area', unit: 'm²' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Space Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_SpaceBaseQuantities',
    description: 'Base quantities for spaces',
    applicableTypes: ['IfcSpace'],
    quantities: [
      { name: 'Height', type: QuantityType.Length, description: 'Net height of the space', unit: 'm' },
      { name: 'FinishCeilingHeight', type: QuantityType.Length, description: 'Height from floor to ceiling finish', unit: 'm' },
      { name: 'FinishFloorHeight', type: QuantityType.Length, description: 'Floor finish height', unit: 'm' },
      { name: 'GrossPerimeter', type: QuantityType.Length, description: 'Gross floor perimeter', unit: 'm' },
      { name: 'NetPerimeter', type: QuantityType.Length, description: 'Net floor perimeter', unit: 'm' },
      { name: 'GrossFloorArea', type: QuantityType.Area, description: 'Gross floor area', unit: 'm²' },
      { name: 'NetFloorArea', type: QuantityType.Area, description: 'Net floor area', unit: 'm²' },
      { name: 'GrossWallArea', type: QuantityType.Area, description: 'Gross wall area', unit: 'm²' },
      { name: 'NetWallArea', type: QuantityType.Area, description: 'Net wall area', unit: 'm²' },
      { name: 'GrossCeilingArea', type: QuantityType.Area, description: 'Gross ceiling area', unit: 'm²' },
      { name: 'NetCeilingArea', type: QuantityType.Area, description: 'Net ceiling area', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume', unit: 'm³' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Building Storey Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_BuildingStoreyBaseQuantities',
    description: 'Base quantities for building storeys',
    applicableTypes: ['IfcBuildingStorey'],
    quantities: [
      { name: 'GrossHeight', type: QuantityType.Length, description: 'Gross height (floor-to-floor)', unit: 'm' },
      { name: 'NetHeight', type: QuantityType.Length, description: 'Net height (floor-to-ceiling)', unit: 'm' },
      { name: 'GrossFloorArea', type: QuantityType.Area, description: 'Gross floor area', unit: 'm²' },
      { name: 'NetFloorArea', type: QuantityType.Area, description: 'Net floor area', unit: 'm²' },
      { name: 'GrossVolume', type: QuantityType.Volume, description: 'Gross volume', unit: 'm³' },
      { name: 'NetVolume', type: QuantityType.Volume, description: 'Net volume', unit: 'm³' },
    ],
  },

  // ---------------------------------------------------------------------------
  // Railing Base Quantities
  // ---------------------------------------------------------------------------
  {
    name: 'Qto_RailingBaseQuantities',
    description: 'Base quantities for railings',
    applicableTypes: ['IfcRailing'],
    quantities: [
      { name: 'Length', type: QuantityType.Length, description: 'Railing length', unit: 'm' },
    ],
  },
];

// ============================================================================
// Lookup Functions
// ============================================================================

// Pre-computed uppercase -> PascalCase lookup map for all known types
const KNOWN_TYPE_MAP = new Map<string, string>();
for (const qto of QTO_DEFINITIONS) {
  for (const t of qto.applicableTypes) {
    KNOWN_TYPE_MAP.set(t.toUpperCase(), t);
  }
}

function normalizeTypeName(type: string): string {
  if (type.startsWith('Ifc')) return type;
  const upper = type.toUpperCase();
  if (!upper.startsWith('IFC')) return type;
  const known = KNOWN_TYPE_MAP.get(upper);
  if (known) return known;
  const rest = type.slice(3).toLowerCase();
  return 'Ifc' + rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * Get all valid quantity set definitions for a given IFC entity type.
 */
export function getQtoDefinitionsForType(entityType: string): QtoDefinition[] {
  const normalized = normalizeTypeName(entityType);
  return QTO_DEFINITIONS.filter(qto =>
    qto.applicableTypes.some(t => t === normalized)
  );
}

/**
 * Get a specific quantity set definition by name.
 */
export function getQtoDefinition(qtoName: string): QtoDefinition | undefined {
  return QTO_DEFINITIONS.find(q => q.name === qtoName);
}

/**
 * Get the quantity definitions for a specific quantity set.
 */
export function getQuantitiesForQto(qtoName: string): QtoQuantityDef[] {
  const qto = QTO_DEFINITIONS.find(q => q.name === qtoName);
  return qto ? qto.quantities : [];
}

/**
 * Get the display unit suffix for a quantity type.
 */
export function getQuantityUnit(type: QuantityType): string {
  switch (type) {
    case QuantityType.Length: return 'm';
    case QuantityType.Area: return 'm²';
    case QuantityType.Volume: return 'm³';
    case QuantityType.Weight: return 'kg';
    case QuantityType.Count: return '';
    case QuantityType.Time: return 's';
    default: return '';
  }
}
