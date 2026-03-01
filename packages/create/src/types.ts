/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Types for IFC creation from scratch.
 *
 * All coordinate values are in metres. All angles are in radians.
 * Uses IFC PascalCase names per AGENTS.md.
 */

// ============================================================================
// Geometry primitives
// ============================================================================

/** 3D point [x, y, z] in metres */
export type Point3D = [number, number, number];

/** 2D point [x, y] in metres */
export type Point2D = [number, number];

/** Axis-aligned placement: origin + optional Z direction + optional X direction */
export interface Placement3D {
  Location: Point3D;
  Axis?: Point3D;        // Z direction, default [0,0,1]
  RefDirection?: Point3D; // X direction, default [1,0,0]
}

/** 2D rectangle profile (width along X, depth along Y, centered at origin) */
export interface RectangleProfile {
  ProfileType: 'AREA';
  XDim: number;
  YDim: number;
}

/** Arbitrary closed profile defined by a polyline */
export interface ArbitraryProfile {
  ProfileType: 'AREA';
  OuterCurve: Point2D[];
}

export type ProfileDef = RectangleProfile | ArbitraryProfile;

/** Rectangular opening cut (width, height, position relative to host element) */
export interface RectangularOpening {
  Name?: string;
  Width: number;
  Height: number;
  /** Position of opening centre relative to host element origin */
  Position: Point3D;
}

// ============================================================================
// Building element parameters
// ============================================================================

/** Common attributes shared by all building elements */
export interface ElementAttributes {
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
}

/** Wall: extruded rectangle profile */
export interface WallParams extends ElementAttributes {
  /** Start point of wall axis [x, y, z] */
  Start: Point3D;
  /** End point of wall axis [x, y, z] */
  End: Point3D;
  /** Wall thickness (perpendicular to axis) */
  Thickness: number;
  /** Wall height */
  Height: number;
  /** Rectangular openings in the wall */
  Openings?: RectangularOpening[];
}

/** Slab: extruded rectangle or arbitrary profile */
export interface SlabParams extends ElementAttributes {
  /** Placement origin */
  Position: Point3D;
  /** Slab thickness (extrusion height, along Z) */
  Thickness: number;
  /** Width (X dimension) — used when Profile is omitted */
  Width?: number;
  /** Depth (Y dimension) — used when Profile is omitted */
  Depth?: number;
  /** Custom profile outline (overrides Width/Depth) */
  Profile?: Point2D[];
  /** Rectangular openings in the slab */
  Openings?: RectangularOpening[];
}

/** Column: extruded rectangle profile */
export interface ColumnParams extends ElementAttributes {
  /** Base point */
  Position: Point3D;
  /** Column width (X) */
  Width: number;
  /** Column depth (Y) */
  Depth: number;
  /** Column height (Z) */
  Height: number;
}

/** Beam: extruded rectangle profile along an axis */
export interface BeamParams extends ElementAttributes {
  /** Start point */
  Start: Point3D;
  /** End point */
  End: Point3D;
  /** Beam width */
  Width: number;
  /** Beam height (depth of section) */
  Height: number;
}

/** Stair: simplified parametric stair (straight run) */
export interface StairParams extends ElementAttributes {
  /** Base point of first riser */
  Position: Point3D;
  /** Direction angle in XY plane (radians, 0 = +X) */
  Direction?: number;
  /** Number of risers */
  NumberOfRisers: number;
  /** Riser height */
  RiserHeight: number;
  /** Tread length (going) */
  TreadLength: number;
  /** Stair width */
  Width: number;
}

/** Roof: extruded slab with optional slope */
export interface RoofParams extends ElementAttributes {
  /** Placement origin */
  Position: Point3D;
  /** Roof thickness */
  Thickness: number;
  /** Width (X dimension) */
  Width: number;
  /** Depth (Y dimension) */
  Depth: number;
  /** Slope angle in radians (0 = flat). Slope is along X axis. */
  Slope?: number;
}

// ============================================================================
// Property / Quantity helpers
// ============================================================================

/** IFC property value types */
export type PropertyType = 'IfcLabel' | 'IfcText' | 'IfcIdentifier' | 'IfcReal' | 'IfcInteger' | 'IfcBoolean' | 'IfcLogical';

/** Single property definition */
export interface PropertyDef {
  Name: string;
  NominalValue: string | number | boolean;
  /** Defaults to IfcLabel for strings, IfcReal for numbers, IfcBoolean for booleans */
  Type?: PropertyType;
}

/** Property set to attach to an element */
export interface PropertySetDef {
  Name: string;
  Properties: PropertyDef[];
}

/** Quantity types */
export type QuantityKind = 'IfcQuantityLength' | 'IfcQuantityArea' | 'IfcQuantityVolume' | 'IfcQuantityCount' | 'IfcQuantityWeight';

/** Single quantity definition */
export interface QuantityDef {
  Name: string;
  Value: number;
  Kind: QuantityKind;
}

/** Element quantity set to attach to an element */
export interface QuantitySetDef {
  Name: string;
  Quantities: QuantityDef[];
}

// ============================================================================
// Material definitions
// ============================================================================

/** A single layer within a material layer set */
export interface MaterialLayerDef {
  /** Material name for this layer */
  Name: string;
  /** Layer thickness in metres */
  Thickness: number;
  /** Category (e.g. 'Structural', 'Insulation', 'Finish') */
  Category?: string;
  /** Whether the layer allows airflow */
  IsVentilated?: boolean;
}

/** Material definition — simple or layered */
export interface MaterialDef {
  /** Material or layer-set name */
  Name: string;
  /** Category (used for simple materials without layers) */
  Category?: string;
  /** If provided, creates IfcMaterialLayerSet; otherwise simple IfcMaterial */
  Layers?: MaterialLayerDef[];
}

// ============================================================================
// Spatial structure
// ============================================================================

/** Project-level options */
export interface ProjectParams {
  Name?: string;
  Description?: string;
  Schema?: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  /** Length unit: 'METRE' (default), 'MILLIMETRE', 'FOOT' */
  LengthUnit?: string;
  Author?: string;
  Organization?: string;
}

/** Site-level options */
export interface SiteParams {
  Name?: string;
  Description?: string;
}

/** Building-level options */
export interface BuildingParams {
  Name?: string;
  Description?: string;
}

/** Building storey (floor) options */
export interface StoreyParams {
  Name?: string;
  Description?: string;
  Elevation: number;
}

// ============================================================================
// Creation result
// ============================================================================

/** Reference to a created entity (expressId within the created file) */
export interface CreatedEntity {
  expressId: number;
  type: string;
  Name?: string;
}

/** Result of toIfc() */
export interface CreateResult {
  /** Complete IFC STEP file content */
  content: string;
  /** All created entities */
  entities: CreatedEntity[];
  /** Statistics */
  stats: {
    entityCount: number;
    fileSize: number;
  };
}
