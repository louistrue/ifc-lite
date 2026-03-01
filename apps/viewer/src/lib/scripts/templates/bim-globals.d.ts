/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * AUTO-GENERATED — do not edit by hand.
 * Run: npx tsx scripts/generate-bim-globals.ts
 *
 * Type declarations for the sandbox `bim` global.
 * Generated from NAMESPACE_SCHEMAS in bridge-schema.ts.
 */

// ── Entity types ────────────────────────────────────────────────────────

interface BimEntity {
  ref: { modelId: string; expressId: number };
  name: string; Name: string;
  type: string; Type: string;
  globalId: string; GlobalId: string;
  description: string; Description: string;
  objectType: string; ObjectType: string;
}

interface BimPropertySet {
  name: string;
  properties: Array<{ name: string; value: string | number | boolean | null }>;
}

interface BimQuantitySet {
  name: string;
  quantities: Array<{ name: string; value: number | null }>;
}

interface BimModelInfo {
  id: string;
  name: string;
  schemaVersion: string;
  entityCount: number;
  fileSize: number;
}

// ── Namespace declarations ──────────────────────────────────────────────

declare const bim: {
  /** Model operations */
  model: {
    /** List loaded models */
    list(): BimModelInfo[];
    /** Get active model */
    active(): BimModelInfo | null;
    /** Get active model ID */
    activeId(): string | null;
    /** Load IFC content into the 3D viewer for preview */
    loadIfc(content: string, filename?: string): void;
  };
  /** Query entities */
  query: {
    /** Get all entities */
    all(): BimEntity[];
    /** Filter by IFC type e.g. 'IfcWall' */
    byType(...types: string[]): BimEntity[];
    /** Get entity by model ID and express ID */
    entity(modelId: string, expressId: number): BimEntity | null;
    /** Get all IfcPropertySet data for an entity */
    properties(entity: BimEntity): BimPropertySet[];
    /** Get all IfcElementQuantity data for an entity */
    quantities(entity: BimEntity): BimQuantitySet[];
  };
  /** Viewer control */
  viewer: {
    /** Colorize entities e.g. '#ff0000' */
    colorize(entities: BimEntity[], color: string): void;
    /** Batch colorize with [{entities, color}] */
    colorizeAll(batches: Array<{ entities: BimEntity[]; color: string }>): void;
    /** Hide entities */
    hide(entities: BimEntity[]): void;
    /** Show entities */
    show(entities: BimEntity[]): void;
    /** Isolate entities */
    isolate(entities: BimEntity[]): void;
    /** Select entities */
    select(entities: BimEntity[]): void;
    /** Fly camera to entities */
    flyTo(entities: BimEntity[]): void;
    /** Reset all colors */
    resetColors(): void;
    /** Reset all visibility */
    resetVisibility(): void;
  };
  /** Property editing */
  mutate: {
    /** Set a property value */
    setProperty(entity: unknown, psetName: string, propName: string, value: unknown): void;
    /** Delete a property */
    deleteProperty(entity: unknown, psetName: string, propName: string): void;
    /** Undo last mutation */
    undo(modelId: string): void;
    /** Redo undone mutation */
    redo(modelId: string): void;
  };
  /** Lens visualization */
  lens: {
    /** Get built-in lens presets */
    presets(): unknown[];
  };
  /** IFC creation from scratch */
  create: {
    /** Create a new IFC project. Returns a creator handle (number). */
    project(params?: { Name?: string; Description?: string; Schema?: string; LengthUnit?: string; Author?: string; Organization?: string }): number;
    /** Add a building storey. Returns storey expressId. */
    addStorey(handle: number, params: { Name?: string; Description?: string; Elevation: number }): number;
    /** Add a wall to a storey. Returns wall expressId. */
    addWall(handle: number, storeyId: number, params: { Start: [number,number,number]; End: [number,number,number]; Thickness: number; Height: number; Name?: string; Openings?: Array<{ Width: number; Height: number; Position: [number,number,number]; Name?: string }> }): number;
    /** Add a slab to a storey. Returns slab expressId. */
    addSlab(handle: number, storeyId: number, params: { Position: [number,number,number]; Thickness: number; Width?: number; Depth?: number; Profile?: [number,number][]; Name?: string; Openings?: Array<{ Width: number; Height: number; Position: [number,number,number]; Name?: string }> }): number;
    /** Add a column to a storey. Returns column expressId. */
    addColumn(handle: number, storeyId: number, params: { Position: [number,number,number]; Width: number; Depth: number; Height: number; Name?: string }): number;
    /** Add a beam to a storey. Returns beam expressId. */
    addBeam(handle: number, storeyId: number, params: { Start: [number,number,number]; End: [number,number,number]; Width: number; Height: number; Name?: string }): number;
    /** Add a stair to a storey. Returns stair expressId. */
    addStair(handle: number, storeyId: number, params: { Position: [number,number,number]; NumberOfRisers: number; RiserHeight: number; TreadLength: number; Width: number; Direction?: number; Name?: string }): number;
    /** Add a roof to a storey. Returns roof expressId. */
    addRoof(handle: number, storeyId: number, params: { Position: [number,number,number]; Width: number; Depth: number; Thickness: number; Slope?: number; Name?: string }): number;
    /** Assign a named colour to an element. Call before toIfc(). */
    setColor(handle: number, elementId: number, name: string, rgb: [number, number, number]): void;
    /** Attach a property set to an element. Returns pset expressId. */
    addPropertySet(handle: number, elementId: number, pset: { Name: string; Properties: Array<{ Name: string; NominalValue: string | number | boolean; Type?: string }> }): number;
    /** Attach element quantities to an element. Returns qset expressId. */
    addQuantitySet(handle: number, elementId: number, qset: { Name: string; Quantities: Array<{ Name: string; Value: number; Kind: string }> }): number;
    /** Generate the IFC STEP file content. Returns { content, entities, stats }. */
    toIfc(handle: number): { content: string; entities: Array<{ expressId: number; type: string; Name?: string }>; stats: { entityCount: number; fileSize: number } };
  };
  /** Data export */
  export: {
    /** Export entities to CSV string */
    csv(entities: BimEntity[], options: { columns: string[]; filename?: string; separator?: string }): string;
    /** Export entities to JSON array */
    json(entities: BimEntity[], columns: string[]): Record<string, unknown>[];
    /** Trigger a browser file download with raw content */
    download(content: string, filename: string, mimeType?: string): void;
  };
};
