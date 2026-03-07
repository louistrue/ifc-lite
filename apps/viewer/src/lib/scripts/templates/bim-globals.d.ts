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
  Name?: string;
  globalId?: string;
  GlobalId?: string;
  properties: Array<{ name: string; value: string | number | boolean | null }>;
  Properties?: Array<{ name: string; value: string | number | boolean | null }>;
}

interface BimQuantitySet {
  name: string;
  quantities: Array<{ name: string; value: number | null }>;
  Name?: string;
  Quantities?: Array<{ name: string; value: number | null }>;
}

interface BimAttribute {
  name: string;
  value: string;
}

interface BimClassification {
  system?: string;
  identification?: string;
  name?: string;
  location?: string;
  description?: string;
  path?: string[];
}

interface BimMaterialLayer {
  materialName?: string;
  thickness?: number;
  isVentilated?: boolean;
  name?: string;
  category?: string;
}

interface BimMaterialProfile {
  materialName?: string;
  name?: string;
  category?: string;
}

interface BimMaterialConstituent {
  materialName?: string;
  name?: string;
  fraction?: number;
  category?: string;
}

interface BimMaterial {
  type: 'Material' | 'MaterialLayerSet' | 'MaterialProfileSet' | 'MaterialConstituentSet' | 'MaterialList';
  name?: string;
  description?: string;
  layers?: BimMaterialLayer[];
  profiles?: BimMaterialProfile[];
  constituents?: BimMaterialConstituent[];
  materials?: string[];
}

interface BimTypeProperties {
  typeName: string;
  typeId: number;
  properties: BimPropertySet[];
}

interface BimDocument {
  name?: string;
  description?: string;
  location?: string;
  identification?: string;
  purpose?: string;
  intendedUse?: string;
  revision?: string;
  confidentiality?: string;
}

interface BimRelationships {
  voids: Array<{ id: number; name?: string; type: string }>;
  fills: Array<{ id: number; name?: string; type: string }>;
  groups: Array<{ id: number; name?: string }>;
  connections: Array<{ id: number; name?: string; type: string }>;
}

interface BimModelInfo {
  id: string;
  name: string;
  schemaVersion: string;
  entityCount: number;
  fileSize: number;
}

interface BimFileAttachment {
  name: string;
  type: string;
  size: number;
  rowCount?: number;
  columns?: string[];
  hasTextContent: boolean;
}

type BimPoint3D = [number, number, number];
type BimPoint2D = [number, number];

interface BimPlacement3D {
  Location: BimPoint3D;
  Axis?: BimPoint3D;
  RefDirection?: BimPoint3D;
}

type BimProfileDef =
  | { ProfileType: 'AREA'; XDim: number; YDim: number }
  | { ProfileType: 'AREA'; Radius: number; WallThickness?: number }
  | { ProfileType: 'AREA'; OuterCurve: BimPoint2D[] }
  | { ProfileType: 'AREA'; Shape: 'IfcTShapeProfileDef'; FlangeWidth: number; Depth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number }
  | { ProfileType: 'AREA'; Shape: 'IfcUShapeProfileDef'; Depth: number; FlangeWidth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number }
  | { ProfileType: 'AREA'; OverallWidth: number; OverallDepth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number }
  | { ProfileType: 'AREA'; Depth: number; Width: number; Thickness: number; FilletRadius?: number }
  | { ProfileType: 'AREA'; Depth: number; Width: number; WallThickness: number; Girth: number }
  | { ProfileType: 'AREA'; XDim: number; YDim: number; WallThickness: number; InnerFilletRadius?: number; OuterFilletRadius?: number };

type BimElementAttrs = {
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
};

type BimWallHostedOpening = BimElementAttrs & {
  Position: BimPoint3D;
  Width: number;
  Height: number;
  Thickness?: number;
};

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
    /** Get all named string/enum attributes for an entity */
    attributes(entity: BimEntity): BimAttribute[];
    /** Get all IfcPropertySet data for an entity */
    properties(entity: BimEntity): BimPropertySet[];
    /** Get all IfcElementQuantity data for an entity */
    quantities(entity: BimEntity): BimQuantitySet[];
    /** Get a single property value from an entity */
    property(entity: BimEntity, psetName: string, propName: string): string | number | boolean | null;
    /** Get classification references for an entity */
    classifications(entity: BimEntity): BimClassification[];
    /** Get material assignment for an entity */
    materials(entity: BimEntity): BimMaterial | null;
    /** Get type-level property sets for an entity */
    typeProperties(entity: BimEntity): BimTypeProperties | null;
    /** Get linked document references for an entity */
    documents(entity: BimEntity): BimDocument[];
    /** Get structural relationship summary for an entity */
    relationships(entity: BimEntity): BimRelationships;
    /** Get a single quantity value from an entity */
    quantity(entity: BimEntity, qsetName: string, quantityName: string): number | null;
    /** Get related entities by IFC relationship type */
    related(entity: BimEntity, relType: string, direction: 'forward' | 'inverse'): BimEntity[];
    /** Get the spatial container of an entity */
    containedIn(entity: BimEntity): BimEntity | null;
    /** Get entities contained in a spatial container */
    contains(entity: BimEntity): BimEntity[];
    /** Get the parent aggregate of an entity */
    decomposedBy(entity: BimEntity): BimEntity | null;
    /** Get aggregated children of an entity */
    decomposes(entity: BimEntity): BimEntity[];
    /** Get the containing building storey of an entity */
    storey(entity: BimEntity): BimEntity | null;
    /** Get the spatial/aggregation path from project to entity */
    path(entity: BimEntity): BimEntity[];
    /** List all building storeys */
    storeys(): BimEntity[];
    /** Get the current viewer selection as entities */
    selection(): BimEntity[];
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
    /** Set an IfcPropertySet or quantity value */
    setProperty(entity: unknown, psetName: string, propName: string, value: unknown): void;
    /** Set a root IFC attribute such as Name, Description, ObjectType, or Tag */
    setAttribute(entity: unknown, attrName: string, value: string): void;
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
    addIfcBuildingStorey(handle: number, params: { Name?: string; Description?: string; Elevation: number }): number;
    /** Add a wall to a storey. Returns wall expressId. */
    addIfcWall(handle: number, storeyId: number, params: BimElementAttrs & { Start: [number,number,number]; End: [number,number,number]; Thickness: number; Height: number; Openings?: Array<{ Width: number; Height: number; Position: [number,number,number]; Name?: string }> }): number;
    /** Add a slab to a storey. Returns slab expressId. */
    addIfcSlab(handle: number, storeyId: number, params: BimElementAttrs & { Position: [number,number,number]; Thickness: number; Width?: number; Depth?: number; Profile?: [number,number][]; Openings?: Array<{ Width: number; Height: number; Position: [number,number,number]; Name?: string }> }): number;
    /** Add a column to a storey. Returns column expressId. */
    addIfcColumn(handle: number, storeyId: number, params: BimElementAttrs & { Position: [number,number,number]; Width: number; Depth: number; Height: number }): number;
    /** Add a beam to a storey. Returns beam expressId. */
    addIfcBeam(handle: number, storeyId: number, params: BimElementAttrs & { Start: [number,number,number]; End: [number,number,number]; Width: number; Height: number }): number;
    /** Add a stair to a storey. Returns stair expressId. */
    addIfcStair(handle: number, storeyId: number, params: BimElementAttrs & { Position: [number,number,number]; NumberOfRisers: number; RiserHeight: number; TreadLength: number; Width: number; Direction?: number }): number;
    /** Add a roof to a storey. Returns roof expressId. */
    addIfcRoof(handle: number, storeyId: number, params: BimElementAttrs & { Position: [number,number,number]; Width: number; Depth: number; Thickness: number; Slope?: number }): number;
    /** Add a dual-pitch gable roof. `Slope` is in radians. Returns roof expressId. */
    addIfcGableRoof(handle: number, storeyId: number, params: BimElementAttrs & { Position: [number,number,number]; Width: number; Depth: number; Thickness: number; Slope: number; Overhang?: number }): number;
    /** Add a door hosted in a wall opening. Position is wall-local [alongWall, 0, baseHeight]. Returns door expressId. */
    addIfcWallDoor(handle: number, wallId: number, params: BimWallHostedOpening & { PredefinedType?: string; OperationType?: string }): number;
    /** Add a window hosted in a wall opening. Position is wall-local [alongWall, 0, sillHeight]. Returns window expressId. */
    addIfcWallWindow(handle: number, wallId: number, params: BimWallHostedOpening & { PartitioningType?: string }): number;
    /** Add a door to a storey. Returns door expressId. */
    addIfcDoor(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Height: number; Thickness?: number; PredefinedType?: string; OperationType?: string }): number;
    /** Add a window to a storey. Returns window expressId. */
    addIfcWindow(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Height: number; Thickness?: number; PartitioningType?: string }): number;
    /** Add a ramp to a storey. Returns ramp expressId. */
    addIfcRamp(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Length: number; Thickness: number; Rise?: number }): number;
    /** Add a railing to a storey. Returns railing expressId. */
    addIfcRailing(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; Height: number; Width?: number }): number;
    /** Add a plate to a storey. Returns plate expressId. */
    addIfcPlate(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Depth: number; Thickness: number; Profile?: BimPoint2D[] }): number;
    /** Add a member to a storey. Returns member expressId. */
    addIfcMember(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; Width: number; Height: number }): number;
    /** Add a footing to a storey. Returns footing expressId. */
    addIfcFooting(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Depth: number; Height: number; PredefinedType?: string }): number;
    /** Add a pile to a storey. Returns pile expressId. */
    addIfcPile(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Length: number; Diameter: number; IsRectangular?: boolean; RectangularDepth?: number }): number;
    /** Add a space to a storey. Returns space expressId. */
    addIfcSpace(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Depth: number; Height: number; LongName?: string; Profile?: BimPoint2D[] }): number;
    /** Add a curtain wall to a storey. Returns curtain wall expressId. */
    addIfcCurtainWall(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; Height: number; Thickness?: number }): number;
    /** Add a furnishing element to a storey. Returns expressId. */
    addIfcFurnishingElement(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Depth: number; Height: number; Direction?: number }): number;
    /** Add a generic building element proxy to a storey. Returns expressId. */
    addIfcBuildingElementProxy(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Width: number; Depth: number; Height: number; Profile?: BimPoint2D[]; ProxyType?: string }): number;
    /** Add a circular column to a storey. Returns expressId. */
    addIfcCircularColumn(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Radius: number; Height: number }): number;
    /** Add an I-shape beam to a storey. Returns expressId. */
    addIfcIShapeBeam(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; OverallWidth: number; OverallDepth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number }): number;
    /** Add an L-shape member to a storey. Returns expressId. */
    addIfcLShapeMember(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; Width: number; Depth: number; Thickness: number; FilletRadius?: number }): number;
    /** Add a T-shape member to a storey. Returns expressId. */
    addIfcTShapeMember(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; FlangeWidth: number; Depth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number }): number;
    /** Add a U-shape member to a storey. Returns expressId. */
    addIfcUShapeMember(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; Depth: number; FlangeWidth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number }): number;
    /** Add a hollow circular column to a storey. Returns expressId. */
    addIfcHollowCircularColumn(handle: number, storeyId: number, params: BimElementAttrs & { Position: BimPoint3D; Radius: number; WallThickness: number; Height: number }): number;
    /** Add a rectangular hollow beam to a storey. Returns expressId. */
    addIfcRectangleHollowBeam(handle: number, storeyId: number, params: BimElementAttrs & { Start: BimPoint3D; End: BimPoint3D; XDim: number; YDim: number; WallThickness: number; InnerFilletRadius?: number; OuterFilletRadius?: number }): number;
    /** Create any IFC type with a profile at a placement. Returns expressId. */
    addElement(handle: number, storeyId: number, params: { IfcType: string; Placement: BimPlacement3D; Profile: BimProfileDef; Depth: number; ExtrusionDirection?: BimPoint3D; PredefinedType?: string; Name?: string; Description?: string; ObjectType?: string; Tag?: string }): number;
    /** Create any IFC type extruded along a Start→End axis. Returns expressId. */
    addAxisElement(handle: number, storeyId: number, params: { IfcType: string; Start: BimPoint3D; End: BimPoint3D; Profile: BimProfileDef; PredefinedType?: string; Name?: string; Description?: string; ObjectType?: string; Tag?: string }): number;
    /** Create a profile from a ProfileDef union. Returns profile ID. */
    createProfile(handle: number, profile: BimProfileDef): number;
    /** Get the world placement ID for use with addLocalPlacement. */
    getWorldPlacementId(handle: number): number;
    /** Assign a named colour to an element. Call before toIfc(). */
    setColor(handle: number, elementId: number, name: string, rgb: [number, number, number]): void;
    /** Assign an IFC material (simple or layered) to an element. */
    addIfcMaterial(handle: number, elementId: number, material: { Name: string; Category?: string; Layers?: Array<{ Name: string; Thickness: number; Category?: string; IsVentilated?: boolean }> }): void;
    /** Attach a property set to an element. Returns pset expressId. */
    addIfcPropertySet(handle: number, elementId: number, pset: { Name: string; Properties: Array<{ Name: string; NominalValue: string | number | boolean; Type?: string }> }): number;
    /** Attach element quantities to an element. Returns qset expressId. */
    addIfcElementQuantity(handle: number, elementId: number, qset: { Name: string; Quantities: Array<{ Name: string; Value: number; Kind: 'IfcQuantityLength' | 'IfcQuantityArea' | 'IfcQuantityVolume' | 'IfcQuantityCount' | 'IfcQuantityWeight' }> }): number;
    /** Generate the IFC STEP file content. Returns { content, entities, stats }. */
    toIfc(handle: number): { content: string; entities: Array<{ expressId: number; type: string; Name?: string }>; stats: { entityCount: number; fileSize: number } };
  };
  /** Uploaded file attachments */
  files: {
    /** List uploaded file attachments available to scripts */
    list(): BimFileAttachment[];
    /** Get raw text content for an uploaded attachment by file name */
    text(name: string): string | null;
    /** Get parsed CSV/TSV rows for an uploaded attachment by file name */
    csv(name: string): Record<string, string>[] | null;
    /** Get parsed CSV column names for an uploaded attachment by file name */
    csvColumns(name: string): string[];
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
