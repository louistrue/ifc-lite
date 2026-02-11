/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/lens — Rule-based 3D filtering and colorization
 *
 * A lens is a collection of rules that match entities by IFC class, property
 * value, or material name, then apply a visual action (colorize, hide, or
 * make transparent). Unmatched entities are ghosted for context.
 *
 * Multi-model support: evaluation works across federated models using
 * global IDs. The {@link LensDataProvider} abstracts data access so
 * consumers can bridge any data source.
 */

// ============================================================================
// Data Provider Interface
// ============================================================================

/**
 * Abstract interface for accessing IFC entity data during lens evaluation.
 *
 * Consumers implement this to bridge their data source (IfcDataStore,
 * server API, IndexedDB, etc.) to the lens engine.
 */
export interface LensDataProvider {
  /** Total entity count (used for pre-allocation hints) */
  getEntityCount(): number;

  /**
   * Iterate all entities. The callback receives the global ID and the
   * model identifier for each entity.
   */
  forEachEntity(callback: (globalId: number, modelId: string) => void): void;

  /** Get the IFC class name for an entity (e.g. "IfcWall") */
  getEntityType(globalId: number): string | undefined;

  /**
   * Get a single property value by property-set name and property name.
   * Returns `undefined` when the property does not exist.
   */
  getPropertyValue(
    globalId: number,
    propertySetName: string,
    propertyName: string,
  ): unknown;

  /**
   * Get all property sets for an entity.
   * Used for material matching (scans psets whose name contains "material").
   */
  getPropertySets(globalId: number): PropertySetInfo[];
}

/** Property set returned by {@link LensDataProvider.getPropertySets} */
export interface PropertySetInfo {
  name: string;
  properties: ReadonlyArray<{
    name: string;
    value: unknown;
  }>;
}

// ============================================================================
// Lens Configuration Types
// ============================================================================

/** Criteria for matching entities */
export interface LensCriteria {
  type: 'ifcType' | 'property' | 'material';
  /** IFC class name (e.g. "IfcWall") — used when type === "ifcType" */
  ifcType?: string;
  /** Property set name (e.g. "Pset_WallCommon") — used when type === "property" */
  propertySet?: string;
  /** Property name (e.g. "IsExternal") — used when type === "property" */
  propertyName?: string;
  /** Comparison operator for property value */
  operator?: 'equals' | 'contains' | 'exists';
  /** Property value to compare against */
  propertyValue?: string;
  /** Material name pattern — used when type === "material" */
  materialName?: string;
}

/** A single rule within a Lens */
export interface LensRule {
  id: string;
  name: string;
  enabled: boolean;
  criteria: LensCriteria;
  action: 'colorize' | 'hide' | 'transparent';
  /** Hex color for colorize/transparent actions (e.g. "#E53935") */
  color: string;
}

/** A saved Lens configuration */
export interface Lens {
  id: string;
  name: string;
  rules: LensRule[];
  /** Built-in presets cannot be deleted */
  builtin?: boolean;
  /** Auto-color mode: color entities by distinct property values */
  autoColorProperty?: {
    propertySetName: string;
    propertyName: string;
  };
}

// ============================================================================
// Evaluation Result Types
// ============================================================================

/** RGBA color tuple with values in the 0–1 range */
export type RGBAColor = [number, number, number, number];

/** Result of lens evaluation */
export interface LensEvaluationResult {
  /** Global ID → RGBA color (includes ghost colors for unmatched entities) */
  colorMap: Map<number, RGBAColor>;
  /** Global IDs hidden by "hide" rules */
  hiddenIds: Set<number>;
  /** Rule ID → matched entity count */
  ruleCounts: Map<string, number>;
  /** Rule ID → matched entity global IDs (for isolation) */
  ruleEntityIds: Map<string, number[]>;
  /** Wall-clock evaluation time in milliseconds */
  executionTime: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Common IFC classes for lens rule editor UI */
export const COMMON_IFC_CLASSES = [
  'IfcWall', 'IfcWallStandardCase',
  'IfcSlab', 'IfcSlabStandardCase',
  'IfcColumn', 'IfcColumnStandardCase',
  'IfcBeam', 'IfcBeamStandardCase',
  'IfcDoor', 'IfcWindow',
  'IfcStairFlight', 'IfcStair',
  'IfcRoof', 'IfcRamp', 'IfcRampFlight',
  'IfcRailing', 'IfcCovering',
  'IfcCurtainWall', 'IfcPlate',
  'IfcFooting', 'IfcPile',
  'IfcMember', 'IfcBuildingElementProxy',
  'IfcFurnishingElement', 'IfcSpace',
  'IfcFlowSegment', 'IfcFlowTerminal', 'IfcFlowFitting',
  'IfcDistributionElement',
  'IfcOpeningElement',
] as const;

/** Preset colors for new lens rules — high contrast, perceptually distinct */
export const LENS_PALETTE = [
  '#E53935', '#1E88E5', '#FDD835', '#43A047',
  '#8E24AA', '#00ACC1', '#FF8F00', '#6D4C41',
  '#EC407A', '#5C6BC0', '#26A69A', '#78909C',
] as const;

/** IFC subclass → base class mapping for hierarchy-aware matching */
export const IFC_SUBTYPE_TO_BASE: Readonly<Record<string, string>> = {
  IfcWallStandardCase: 'IfcWall',
  IfcSlabStandardCase: 'IfcSlab',
  IfcColumnStandardCase: 'IfcColumn',
  IfcBeamStandardCase: 'IfcBeam',
  IfcStairFlight: 'IfcStair',
  IfcRampFlight: 'IfcRamp',
};
