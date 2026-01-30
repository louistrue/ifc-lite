/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in Graphic Override Presets
 *
 * Pre-configured override rule sets for common use cases.
 */

import type { GraphicOverridePreset, GraphicOverrideRule } from './types';
import { ifcTypeCriterion, propertyCriterion, andCriteria } from './rule-engine';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

let ruleIdCounter = 0;
function generateRuleId(): string {
  return `builtin-rule-${++ruleIdCounter}`;
}

function createRule(
  name: string,
  criteria: GraphicOverrideRule['criteria'],
  style: GraphicOverrideRule['style'],
  priority: number = 100,
  description?: string
): GraphicOverrideRule {
  return {
    id: generateRuleId(),
    name,
    description,
    enabled: true,
    priority,
    criteria,
    style,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURAL STANDARDS PRESET
// ═══════════════════════════════════════════════════════════════════════════

const ARCHITECTURAL_RULES: GraphicOverrideRule[] = [
  // Structural elements - heavy lines, concrete hatch
  createRule(
    'Walls - Heavy cut lines',
    ifcTypeCriterion(['IfcWall']),
    {
      lineWeight: 'heavy',
      strokeColor: '#000000',
      hatchPattern: 'diagonal',
      hatchSpacing: 3,
      hatchAngle: 45,
    },
    100,
    'Standard wall representation'
  ),
  createRule(
    'Columns - Heavy cut lines',
    ifcTypeCriterion(['IfcColumn']),
    {
      lineWeight: 'heavy',
      strokeColor: '#000000',
      hatchPattern: 'cross-hatch',
      hatchSpacing: 2,
    },
    100
  ),
  createRule(
    'Slabs - Medium lines',
    ifcTypeCriterion(['IfcSlab']),
    {
      lineWeight: 'medium',
      fillColor: '#E0E0E0',
      hatchPattern: 'concrete',
    },
    90
  ),
  // Openings - lighter representation
  createRule(
    'Windows - Light blue tint',
    ifcTypeCriterion(['IfcWindow']),
    {
      lineWeight: 'light',
      fillColor: '#E3F2FD',
      strokeColor: '#1976D2',
      hatchPattern: 'none',
    },
    80
  ),
  createRule(
    'Doors - No fill',
    ifcTypeCriterion(['IfcDoor']),
    {
      lineWeight: 'medium',
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      hatchPattern: 'none',
    },
    80
  ),
  // Furniture - lightest
  createRule(
    'Furniture - Hairline',
    ifcTypeCriterion(['IfcFurnishingElement', 'IfcFurniture']),
    {
      lineWeight: 'hairline',
      strokeColor: '#666666',
      fillColor: '#F5F5F5',
      hatchPattern: 'none',
    },
    60
  ),
];

export const ARCHITECTURAL_PRESET: GraphicOverridePreset = {
  id: 'preset-architectural',
  name: 'Architectural Standards',
  description: 'ISO 128 compliant architectural drawing standards',
  icon: '📐',
  rules: ARCHITECTURAL_RULES,
  builtIn: true,
  category: 'Standards',
};

// ═══════════════════════════════════════════════════════════════════════════
// FIRE SAFETY PRESET
// ═══════════════════════════════════════════════════════════════════════════

const FIRE_SAFETY_RULES: GraphicOverrideRule[] = [
  // Fire-rated walls (based on property)
  createRule(
    'Fire Rated 2hr+ - Red',
    andCriteria(
      ifcTypeCriterion(['IfcWall']),
      propertyCriterion('FireRating', 'greaterOrEqual', 120)
    ),
    {
      fillColor: '#FFCDD2',
      strokeColor: '#C62828',
      lineWeight: 'heavy',
      hatchPattern: 'diagonal',
      hatchColor: '#C62828',
    },
    200,
    '2-hour or higher fire rating'
  ),
  createRule(
    'Fire Rated 1hr - Orange',
    andCriteria(
      ifcTypeCriterion(['IfcWall']),
      propertyCriterion('FireRating', 'greaterOrEqual', 60)
    ),
    {
      fillColor: '#FFE0B2',
      strokeColor: '#E65100',
      lineWeight: 'heavy',
      hatchPattern: 'diagonal',
      hatchColor: '#E65100',
    },
    190
  ),
  createRule(
    'Fire Rated 30min - Yellow',
    andCriteria(
      ifcTypeCriterion(['IfcWall']),
      propertyCriterion('FireRating', 'greaterOrEqual', 30)
    ),
    {
      fillColor: '#FFF9C4',
      strokeColor: '#F9A825',
      lineWeight: 'medium',
      hatchPattern: 'diagonal',
      hatchColor: '#F9A825',
    },
    180
  ),
  // Fire doors
  createRule(
    'Fire Doors - Red outline',
    andCriteria(
      ifcTypeCriterion(['IfcDoor']),
      propertyCriterion('FireRating', 'exists')
    ),
    {
      strokeColor: '#C62828',
      lineWeight: 'heavy',
    },
    200
  ),
  // Escape routes (spaces marked as circulation)
  createRule(
    'Escape Routes - Green',
    andCriteria(
      ifcTypeCriterion(['IfcSpace']),
      propertyCriterion('OccupancyType', 'contains', 'CIRCULATION')
    ),
    {
      fillColor: '#C8E6C9',
      strokeColor: '#2E7D32',
      lineWeight: 'light',
    },
    150
  ),
];

export const FIRE_SAFETY_PRESET: GraphicOverridePreset = {
  id: 'preset-fire-safety',
  name: 'Fire Safety',
  description: 'Highlight fire-rated elements and escape routes',
  icon: '🔥',
  rules: FIRE_SAFETY_RULES,
  builtIn: true,
  category: 'Safety',
};

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL PRESET
// ═══════════════════════════════════════════════════════════════════════════

const STRUCTURAL_RULES: GraphicOverrideRule[] = [
  // Highlight all structural elements
  createRule(
    'Load-bearing Walls - Blue',
    andCriteria(
      ifcTypeCriterion(['IfcWall']),
      propertyCriterion('LoadBearing', 'equals', true)
    ),
    {
      fillColor: '#BBDEFB',
      strokeColor: '#1565C0',
      lineWeight: 'heavy',
      hatchPattern: 'diagonal',
      hatchColor: '#1565C0',
    },
    200
  ),
  createRule(
    'Columns - Blue heavy',
    ifcTypeCriterion(['IfcColumn']),
    {
      fillColor: '#90CAF9',
      strokeColor: '#0D47A1',
      lineWeight: 'heavy',
      hatchPattern: 'cross-hatch',
      hatchColor: '#0D47A1',
    },
    190
  ),
  createRule(
    'Beams - Blue medium',
    ifcTypeCriterion(['IfcBeam']),
    {
      fillColor: '#64B5F6',
      strokeColor: '#1976D2',
      lineWeight: 'medium',
      hatchPattern: 'diagonal',
    },
    180
  ),
  createRule(
    'Slabs - Light blue',
    ifcTypeCriterion(['IfcSlab']),
    {
      fillColor: '#E3F2FD',
      strokeColor: '#42A5F5',
      lineWeight: 'medium',
    },
    170
  ),
  createRule(
    'Footings - Dark blue',
    ifcTypeCriterion(['IfcFooting', 'IfcPile']),
    {
      fillColor: '#1976D2',
      strokeColor: '#0D47A1',
      lineWeight: 'heavy',
      hatchPattern: 'concrete',
    },
    200
  ),
  // Fade non-structural
  createRule(
    'Non-structural - Faded',
    ifcTypeCriterion(['IfcFurnishingElement', 'IfcFurniture', 'IfcCovering']),
    {
      opacity: 0.3,
      lineWeight: 'hairline',
    },
    50
  ),
];

export const STRUCTURAL_PRESET: GraphicOverridePreset = {
  id: 'preset-structural',
  name: 'Structural Highlight',
  description: 'Emphasize structural elements, fade non-structural',
  icon: '🏗️',
  rules: STRUCTURAL_RULES,
  builtIn: true,
  category: 'Discipline',
};

// ═══════════════════════════════════════════════════════════════════════════
// MEP (MECHANICAL, ELECTRICAL, PLUMBING) PRESET
// ═══════════════════════════════════════════════════════════════════════════

const MEP_RULES: GraphicOverrideRule[] = [
  // HVAC - Blue
  createRule(
    'HVAC Ducts - Blue',
    ifcTypeCriterion(['IfcDuctSegment', 'IfcDuctFitting']),
    {
      fillColor: '#E3F2FD',
      strokeColor: '#1976D2',
      lineWeight: 'medium',
    },
    150
  ),
  createRule(
    'Air Terminals - Blue',
    ifcTypeCriterion(['IfcAirTerminal', 'IfcAirTerminalBox']),
    {
      fillColor: '#BBDEFB',
      strokeColor: '#1565C0',
      lineWeight: 'light',
    },
    140
  ),
  // Plumbing - Green
  createRule(
    'Pipes - Green',
    ifcTypeCriterion(['IfcPipeSegment', 'IfcPipeFitting']),
    {
      fillColor: '#E8F5E9',
      strokeColor: '#388E3C',
      lineWeight: 'medium',
    },
    150
  ),
  createRule(
    'Plumbing Fixtures - Green',
    ifcTypeCriterion(['IfcSanitaryTerminal', 'IfcWasteTerminal']),
    {
      fillColor: '#C8E6C9',
      strokeColor: '#2E7D32',
      lineWeight: 'light',
    },
    140
  ),
  // Electrical - Yellow/Orange
  createRule(
    'Cable Trays - Orange',
    ifcTypeCriterion(['IfcCableCarrierSegment', 'IfcCableCarrierFitting']),
    {
      fillColor: '#FFF3E0',
      strokeColor: '#E65100',
      lineWeight: 'light',
    },
    150
  ),
  createRule(
    'Electrical Equipment - Yellow',
    ifcTypeCriterion(['IfcElectricDistributionBoard', 'IfcSwitchingDevice', 'IfcOutlet']),
    {
      fillColor: '#FFFDE7',
      strokeColor: '#F9A825',
      lineWeight: 'light',
    },
    140
  ),
  // Fade architectural
  createRule(
    'Architectural - Faded',
    ifcTypeCriterion(['IfcWall', 'IfcSlab', 'IfcDoor', 'IfcWindow']),
    {
      opacity: 0.4,
      strokeColor: '#9E9E9E',
    },
    50
  ),
];

export const MEP_PRESET: GraphicOverridePreset = {
  id: 'preset-mep',
  name: 'MEP Highlight',
  description: 'Color-code mechanical, electrical, and plumbing systems',
  icon: '🔧',
  rules: MEP_RULES,
  builtIn: true,
  category: 'Discipline',
};

// ═══════════════════════════════════════════════════════════════════════════
// 3D VIEW COLORS PRESET (matches renderer default materials)
// ═══════════════════════════════════════════════════════════════════════════

// Convert RGBA array [0-1, 0-1, 0-1, 0-1] to hex color
function rgbaToHex(rgba: [number, number, number, number]): string {
  const r = Math.round(rgba[0] * 255);
  const g = Math.round(rgba[1] * 255);
  const b = Math.round(rgba[2] * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const VIEW_3D_RULES: GraphicOverrideRule[] = [
  // Walls - Warm white (matte plaster)
  createRule(
    'Walls - Warm white',
    ifcTypeCriterion(['IfcWall']),
    {
      fillColor: rgbaToHex([0.95, 0.93, 0.88, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'medium',
    },
    100
  ),
  // Slabs - Cool gray (concrete)
  createRule(
    'Slabs - Cool gray',
    ifcTypeCriterion(['IfcSlab']),
    {
      fillColor: rgbaToHex([0.75, 0.75, 0.78, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'medium',
    },
    100
  ),
  // Columns - Light gray
  createRule(
    'Columns - Light gray',
    ifcTypeCriterion(['IfcColumn']),
    {
      fillColor: rgbaToHex([0.7, 0.7, 0.7, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'heavy',
    },
    100
  ),
  // Beams - Steel blue
  createRule(
    'Beams - Steel blue',
    ifcTypeCriterion(['IfcBeam']),
    {
      fillColor: rgbaToHex([0.55, 0.55, 0.6, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'medium',
    },
    100
  ),
  // Windows - Sky blue (glass)
  createRule(
    'Windows - Sky blue',
    ifcTypeCriterion(['IfcWindow']),
    {
      fillColor: rgbaToHex([0.6, 0.8, 0.95, 0.3]),
      strokeColor: '#4080C0',
      lineWeight: 'light',
      opacity: 0.5,
    },
    100
  ),
  // Doors - Warm wood
  createRule(
    'Doors - Warm wood',
    ifcTypeCriterion(['IfcDoor']),
    {
      fillColor: rgbaToHex([0.6, 0.45, 0.3, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'medium',
    },
    100
  ),
  // Roof - Terra cotta
  createRule(
    'Roof - Terra cotta',
    ifcTypeCriterion(['IfcRoof']),
    {
      fillColor: rgbaToHex([0.7, 0.5, 0.4, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'medium',
    },
    100
  ),
  // Stairs - Sandstone
  createRule(
    'Stairs - Sandstone',
    ifcTypeCriterion(['IfcStair', 'IfcStairFlight']),
    {
      fillColor: rgbaToHex([0.8, 0.75, 0.65, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'light',
    },
    100
  ),
  // Railings - Dark metal
  createRule(
    'Railings - Dark metal',
    ifcTypeCriterion(['IfcRailing']),
    {
      fillColor: rgbaToHex([0.3, 0.3, 0.35, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'light',
    },
    100
  ),
  // Furniture - Natural wood
  createRule(
    'Furniture - Natural wood',
    ifcTypeCriterion(['IfcFurnishingElement', 'IfcFurniture']),
    {
      fillColor: rgbaToHex([0.7, 0.6, 0.5, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'hairline',
    },
    90
  ),
  // Pipes - Blue-gray
  createRule(
    'Pipes - Blue-gray',
    ifcTypeCriterion(['IfcPipeSegment', 'IfcPipeFitting']),
    {
      fillColor: rgbaToHex([0.4, 0.5, 0.6, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'light',
    },
    100
  ),
  // Ducts - Light gray
  createRule(
    'Ducts - Light gray',
    ifcTypeCriterion(['IfcDuctSegment', 'IfcDuctFitting']),
    {
      fillColor: rgbaToHex([0.6, 0.6, 0.65, 1.0]),
      strokeColor: '#000000',
      lineWeight: 'light',
    },
    100
  ),
];

export const VIEW_3D_PRESET: GraphicOverridePreset = {
  id: 'preset-3d-colors',
  name: 'IFC Materials',
  description: 'Use actual material colors from the IFC file',
  icon: '🎨',
  rules: [], // No rules needed - colors come from mesh data directly
  builtIn: true,
  category: 'Standards',
};

// ═══════════════════════════════════════════════════════════════════════════
// MATERIAL BASED PRESET
// ═══════════════════════════════════════════════════════════════════════════

const MATERIAL_RULES: GraphicOverrideRule[] = [
  createRule(
    'Concrete - Gray hatch',
    { type: 'material', materialNames: ['concrete', 'beton'] },
    {
      fillColor: '#E0E0E0',
      hatchPattern: 'concrete',
      hatchColor: '#757575',
    },
    100
  ),
  createRule(
    'Steel - Dark diagonal',
    { type: 'material', materialNames: ['steel', 'metal', 'stahl'] },
    {
      fillColor: '#CFD8DC',
      hatchPattern: 'diagonal',
      hatchSpacing: 1.5,
      hatchColor: '#455A64',
    },
    100
  ),
  createRule(
    'Wood - Brown hatch',
    { type: 'material', materialNames: ['wood', 'timber', 'holz'] },
    {
      fillColor: '#EFEBE9',
      hatchPattern: 'horizontal',
      hatchSpacing: 2,
      hatchColor: '#6D4C41',
    },
    100
  ),
  createRule(
    'Glass - Light blue',
    { type: 'material', materialNames: ['glass', 'glas', 'glazing'] },
    {
      fillColor: '#E1F5FE',
      strokeColor: '#0288D1',
      hatchPattern: 'none',
      opacity: 0.7,
    },
    100
  ),
  createRule(
    'Brick/Masonry - Red-brown',
    { type: 'material', materialNames: ['brick', 'masonry', 'ziegel'] },
    {
      fillColor: '#FFCCBC',
      hatchPattern: 'brick',
      hatchColor: '#BF360C',
    },
    100
  ),
  createRule(
    'Insulation - Yellow dots',
    { type: 'material', materialNames: ['insulation', 'dämmung', 'isolation'] },
    {
      fillColor: '#FFF9C4',
      hatchPattern: 'insulation',
      hatchColor: '#FBC02D',
    },
    100
  ),
];

export const MATERIAL_PRESET: GraphicOverridePreset = {
  id: 'preset-material',
  name: 'Material Based',
  description: 'Style elements based on their material',
  icon: '🧱',
  rules: MATERIAL_RULES,
  builtIn: true,
  category: 'Standards',
};

// ═══════════════════════════════════════════════════════════════════════════
// MONOCHROME PRESET
// ═══════════════════════════════════════════════════════════════════════════

const MONOCHROME_RULES: GraphicOverrideRule[] = [
  createRule(
    'All elements - Black and white',
    { type: 'all' },
    {
      strokeColor: '#000000',
      fillColor: '#FFFFFF',
      hatchColor: '#000000',
    },
    1
  ),
  createRule(
    'Cut elements - Gray fill',
    ifcTypeCriterion(['IfcWall', 'IfcColumn', 'IfcSlab', 'IfcBeam']),
    {
      fillColor: '#E0E0E0',
    },
    10
  ),
];

export const MONOCHROME_PRESET: GraphicOverridePreset = {
  id: 'preset-monochrome',
  name: 'Monochrome',
  description: 'Black and white print-ready output',
  icon: '🖨️',
  rules: MONOCHROME_RULES,
  builtIn: true,
  category: 'Output',
};

// ═══════════════════════════════════════════════════════════════════════════
// ALL BUILT-IN PRESETS
// ═══════════════════════════════════════════════════════════════════════════

export const BUILT_IN_PRESETS: GraphicOverridePreset[] = [
  VIEW_3D_PRESET,
  ARCHITECTURAL_PRESET,
  FIRE_SAFETY_PRESET,
  STRUCTURAL_PRESET,
  MEP_PRESET,
  MATERIAL_PRESET,
  MONOCHROME_PRESET,
];

/**
 * Get a built-in preset by ID
 */
export function getBuiltInPreset(id: string): GraphicOverridePreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.id === id);
}

/**
 * Get all built-in presets for a category
 */
export function getPresetsByCategory(category: string): GraphicOverridePreset[] {
  return BUILT_IN_PRESETS.filter((p) => p.category === category);
}
