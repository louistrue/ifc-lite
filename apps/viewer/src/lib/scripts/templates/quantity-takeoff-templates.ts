/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC4 Quantity Takeoff Templates
 *
 * Maps IFC entity types → standard Qto sets → expected quantities.
 * Modeled after IfcOpenShell's IFC4QtoBaseQuantities.json ruleset
 * but adapted for ifc-lite's property-extraction approach (we read
 * quantities already embedded in the IFC file rather than computing
 * from geometry).
 *
 * Reference: buildingSMART IFC4 ADD2 TC1 quantity set definitions
 * https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/
 */

export type QuantityKind = 'length' | 'area' | 'volume' | 'weight' | 'count' | 'time';

export interface QuantityDef {
  /** IFC quantity name exactly as it appears in the schema */
  name: string;
  /** Physical dimension category */
  kind: QuantityKind;
  /** Default unit label for display */
  unit: string;
}

export interface QtoSetDef {
  /** Standard Qto set name e.g. "Qto_WallBaseQuantities" */
  name: string;
  /** Expected quantities in this set */
  quantities: QuantityDef[];
}

export interface QtoRule {
  /** IFC entity type(s) this rule applies to */
  types: string[];
  /** Expected Qto set(s) */
  qtoSets: QtoSetDef[];
}

/**
 * Complete IFC4 quantity takeoff ruleset.
 *
 * Each entry maps one or more IFC entity types to the standard
 * buildingSMART Qto set with all expected quantities.
 */
export const QTO_RULES: QtoRule[] = [
  // ── Walls ──────────────────────────────────────────────────
  {
    types: ['IfcWall', 'IfcWallStandardCase'],
    qtoSets: [{
      name: 'Qto_WallBaseQuantities',
      quantities: [
        { name: 'Length',             kind: 'length', unit: 'm'  },
        { name: 'Width',              kind: 'length', unit: 'm'  },
        { name: 'Height',             kind: 'length', unit: 'm'  },
        { name: 'GrossFootprintArea', kind: 'area',   unit: 'm²' },
        { name: 'NetFootprintArea',   kind: 'area',   unit: 'm²' },
        { name: 'GrossSideArea',      kind: 'area',   unit: 'm²' },
        { name: 'NetSideArea',        kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',        kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',          kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',        kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',          kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Slabs ──────────────────────────────────────────────────
  {
    types: ['IfcSlab'],
    qtoSets: [{
      name: 'Qto_SlabBaseQuantities',
      quantities: [
        { name: 'Width',      kind: 'length', unit: 'm'  },
        { name: 'Length',     kind: 'length', unit: 'm'  },
        { name: 'Depth',     kind: 'length', unit: 'm'  },
        { name: 'Perimeter',  kind: 'length', unit: 'm'  },
        { name: 'GrossArea',  kind: 'area',   unit: 'm²' },
        { name: 'NetArea',    kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',  kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',  kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Columns ────────────────────────────────────────────────
  {
    types: ['IfcColumn'],
    qtoSets: [{
      name: 'Qto_ColumnBaseQuantities',
      quantities: [
        { name: 'Length',            kind: 'length', unit: 'm'  },
        { name: 'CrossSectionArea',  kind: 'area',   unit: 'm²' },
        { name: 'OuterSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'NetSurfaceArea',    kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',       kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',         kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',       kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',         kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Beams ──────────────────────────────────────────────────
  {
    types: ['IfcBeam'],
    qtoSets: [{
      name: 'Qto_BeamBaseQuantities',
      quantities: [
        { name: 'Length',            kind: 'length', unit: 'm'  },
        { name: 'CrossSectionArea',  kind: 'area',   unit: 'm²' },
        { name: 'OuterSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'NetSurfaceArea',    kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',       kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',         kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',       kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',         kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Members ────────────────────────────────────────────────
  {
    types: ['IfcMember'],
    qtoSets: [{
      name: 'Qto_MemberBaseQuantities',
      quantities: [
        { name: 'Length',            kind: 'length', unit: 'm'  },
        { name: 'CrossSectionArea',  kind: 'area',   unit: 'm²' },
        { name: 'OuterSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'NetSurfaceArea',    kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',       kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',         kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',       kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',         kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Plates ─────────────────────────────────────────────────
  {
    types: ['IfcPlate'],
    qtoSets: [{
      name: 'Qto_PlateBaseQuantities',
      quantities: [
        { name: 'Width',       kind: 'length', unit: 'm'  },
        { name: 'Perimeter',   kind: 'length', unit: 'm'  },
        { name: 'GrossArea',   kind: 'area',   unit: 'm²' },
        { name: 'NetArea',     kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',   kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',   kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Doors ──────────────────────────────────────────────────
  {
    types: ['IfcDoor', 'IfcDoorStandardCase'],
    qtoSets: [{
      name: 'Qto_DoorBaseQuantities',
      quantities: [
        { name: 'Width',     kind: 'length', unit: 'm'  },
        { name: 'Height',    kind: 'length', unit: 'm'  },
        { name: 'Perimeter', kind: 'length', unit: 'm'  },
        { name: 'Area',      kind: 'area',   unit: 'm²' },
      ],
    }],
  },

  // ── Windows ────────────────────────────────────────────────
  {
    types: ['IfcWindow'],
    qtoSets: [{
      name: 'Qto_WindowBaseQuantities',
      quantities: [
        { name: 'Width',     kind: 'length', unit: 'm'  },
        { name: 'Height',    kind: 'length', unit: 'm'  },
        { name: 'Perimeter', kind: 'length', unit: 'm'  },
        { name: 'Area',      kind: 'area',   unit: 'm²' },
      ],
    }],
  },

  // ── Coverings ──────────────────────────────────────────────
  {
    types: ['IfcCovering'],
    qtoSets: [{
      name: 'Qto_CoveringBaseQuantities',
      quantities: [
        { name: 'Width',     kind: 'length', unit: 'm'  },
        { name: 'GrossArea', kind: 'area',   unit: 'm²' },
        { name: 'NetArea',   kind: 'area',   unit: 'm²' },
      ],
    }],
  },

  // ── Curtain Walls ──────────────────────────────────────────
  {
    types: ['IfcCurtainWall'],
    qtoSets: [{
      name: 'Qto_CurtainWallQuantities',
      quantities: [
        { name: 'Length',       kind: 'length', unit: 'm'  },
        { name: 'Width',        kind: 'length', unit: 'm'  },
        { name: 'Height',       kind: 'length', unit: 'm'  },
        { name: 'GrossSideArea',kind: 'area',   unit: 'm²' },
        { name: 'NetSideArea',  kind: 'area',   unit: 'm²' },
      ],
    }],
  },

  // ── Roofs ──────────────────────────────────────────────────
  {
    types: ['IfcRoof'],
    qtoSets: [{
      name: 'Qto_RoofBaseQuantities',
      quantities: [
        { name: 'GrossArea',     kind: 'area', unit: 'm²' },
        { name: 'NetArea',       kind: 'area', unit: 'm²' },
        { name: 'ProjectedArea', kind: 'area', unit: 'm²' },
      ],
    }],
  },

  // ── Stairs ─────────────────────────────────────────────────
  {
    types: ['IfcStair', 'IfcStairFlight'],
    qtoSets: [{
      name: 'Qto_StairFlightBaseQuantities',
      quantities: [
        { name: 'Length',      kind: 'length', unit: 'm'  },
        { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',   kind: 'volume', unit: 'm³' },
      ],
    }],
  },

  // ── Ramps ──────────────────────────────────────────────────
  {
    types: ['IfcRamp', 'IfcRampFlight'],
    qtoSets: [{
      name: 'Qto_RampFlightBaseQuantities',
      quantities: [
        { name: 'Length',      kind: 'length', unit: 'm'  },
        { name: 'Width',       kind: 'length', unit: 'm'  },
        { name: 'GrossArea',   kind: 'area',   unit: 'm²' },
        { name: 'NetArea',     kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',   kind: 'volume', unit: 'm³' },
      ],
    }],
  },

  // ── Railings ───────────────────────────────────────────────
  {
    types: ['IfcRailing'],
    qtoSets: [{
      name: 'Qto_RailingBaseQuantities',
      quantities: [
        { name: 'Length', kind: 'length', unit: 'm' },
      ],
    }],
  },

  // ── Footings ───────────────────────────────────────────────
  {
    types: ['IfcFooting'],
    qtoSets: [{
      name: 'Qto_FootingBaseQuantities',
      quantities: [
        { name: 'Length',            kind: 'length', unit: 'm'  },
        { name: 'Width',             kind: 'length', unit: 'm'  },
        { name: 'Height',            kind: 'length', unit: 'm'  },
        { name: 'CrossSectionArea',  kind: 'area',   unit: 'm²' },
        { name: 'OuterSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',       kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',         kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',       kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',         kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Piles ──────────────────────────────────────────────────
  {
    types: ['IfcPile'],
    qtoSets: [{
      name: 'Qto_PileBaseQuantities',
      quantities: [
        { name: 'Length',            kind: 'length', unit: 'm'  },
        { name: 'CrossSectionArea',  kind: 'area',   unit: 'm²' },
        { name: 'OuterSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossSurfaceArea',  kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',       kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',         kind: 'volume', unit: 'm³' },
        { name: 'GrossWeight',       kind: 'weight', unit: 'kg' },
        { name: 'NetWeight',         kind: 'weight', unit: 'kg' },
      ],
    }],
  },

  // ── Openings ───────────────────────────────────────────────
  {
    types: ['IfcOpeningElement'],
    qtoSets: [{
      name: 'Qto_OpeningElementBaseQuantities',
      quantities: [
        { name: 'Width',  kind: 'length', unit: 'm'  },
        { name: 'Height', kind: 'length', unit: 'm'  },
        { name: 'Depth',  kind: 'length', unit: 'm'  },
        { name: 'Area',   kind: 'area',   unit: 'm²' },
        { name: 'Volume', kind: 'volume', unit: 'm³' },
      ],
    }],
  },

  // ── Spaces ─────────────────────────────────────────────────
  {
    types: ['IfcSpace'],
    qtoSets: [{
      name: 'Qto_SpaceBaseQuantities',
      quantities: [
        { name: 'Height',             kind: 'length', unit: 'm'  },
        { name: 'FinishCeilingHeight', kind: 'length', unit: 'm'  },
        { name: 'FinishFloorHeight',   kind: 'length', unit: 'm'  },
        { name: 'GrossPerimeter',      kind: 'length', unit: 'm'  },
        { name: 'NetPerimeter',        kind: 'length', unit: 'm'  },
        { name: 'GrossFloorArea',      kind: 'area',   unit: 'm²' },
        { name: 'NetFloorArea',        kind: 'area',   unit: 'm²' },
        { name: 'GrossCeilingArea',    kind: 'area',   unit: 'm²' },
        { name: 'NetCeilingArea',      kind: 'area',   unit: 'm²' },
        { name: 'GrossWallArea',       kind: 'area',   unit: 'm²' },
        { name: 'NetWallArea',         kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',         kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',           kind: 'volume', unit: 'm³' },
      ],
    }],
  },

  // ── Building Storeys ───────────────────────────────────────
  {
    types: ['IfcBuildingStorey'],
    qtoSets: [{
      name: 'Qto_BuildingStoreyBaseQuantities',
      quantities: [
        { name: 'GrossHeight',    kind: 'length', unit: 'm'  },
        { name: 'NetHeight',      kind: 'length', unit: 'm'  },
        { name: 'GrossPerimeter', kind: 'length', unit: 'm'  },
        { name: 'GrossFloorArea', kind: 'area',   unit: 'm²' },
        { name: 'NetFloorArea',   kind: 'area',   unit: 'm²' },
        { name: 'GrossVolume',    kind: 'volume', unit: 'm³' },
        { name: 'NetVolume',      kind: 'volume', unit: 'm³' },
      ],
    }],
  },
];

/**
 * Build a lookup map: IFC type name → QtoRule for fast access.
 */
export function buildRuleLookup(rules: QtoRule[]): Map<string, QtoRule> {
  const map = new Map<string, QtoRule>();
  for (const rule of rules) {
    for (const t of rule.types) {
      map.set(t, rule);
    }
  }
  return map;
}
