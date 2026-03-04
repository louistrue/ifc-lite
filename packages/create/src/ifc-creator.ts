/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IfcCreator — build valid IFC4 STEP files from scratch.
 *
 * Coordinate convention (construction-standard):
 * - Walls: Start/End define the wall centerline axis in plan.
 *   The wall solid goes exactly from Start to End, centered on thickness.
 * - Slabs/Roofs: Position is the minimum corner (bottom-left in plan).
 *   Width extends along +X, Depth along +Y, Thickness along +Z.
 * - Columns: Position is the base center. Width(X) × Depth(Y) × Height(Z).
 * - Beams: Start/End define the beam axis. Cross-section centered on axis.
 * - Stairs: Position is the nose of the first tread, treads go along +X.
 * - Openings: Position is relative to host element. [along_axis, 0, sill_height].
 *
 * All values in metres unless LengthUnit is overridden.
 */

import type {
  Point3D, Point2D, Placement3D, RectangularOpening,
  ElementAttributes, ProfileDef,
  GenericElementParams, AxisElementParams,
  WallParams, SlabParams, ColumnParams, BeamParams, StairParams, RoofParams,
  DoorParams, WindowParams, RampParams, RailingParams,
  PlateParams, MemberParams, FootingParams, PileParams,
  SpaceParams, CurtainWallParams, FurnishingParams, ProxyParams,
  ProjectParams, SiteParams, BuildingParams, StoreyParams,
  PropertySetDef, PropertyDef, QuantitySetDef, QuantityDef,
  MaterialDef, MaterialLayerDef,
  CreatedEntity, CreateResult,
} from './types.js';

// ============================================================================
// Internal helpers
// ============================================================================

/** Generate a 22-character IFC GlobalId (base64-ish) */
function newGlobalId(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let result = '';
  for (let i = 0; i < 22; i++) {
    result += chars[Math.floor(Math.random() * 64)];
  }
  return result;
}

/** Escape a string for STEP format */
function esc(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/** Format a STEP line: #ID=TYPE(args); */
function stepLine(id: number, type: string, args: string): string {
  return `#${id}=${type}(${args});`;
}

/** Serialize a number in STEP format (always with decimal point, no exponent notation) */
function num(v: number): string {
  // Exponent notation (e.g. 1e-7) is not valid STEP — use fixed decimal
  const s = v.toString();
  if (s.includes('e') || s.includes('E')) return v.toFixed(10).replace(/0+$/, '0');
  return s.includes('.') ? s : s + '.';
}

/** Vector length */
function vecLen(v: Point3D): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Normalize vector — throws on zero-length (indicates geometry bug like Start === End) */
function vecNorm(v: Point3D): Point3D {
  const len = vecLen(v);
  if (len === 0) throw new Error('Cannot normalize zero-length vector (check that Start and End are not identical)');
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Cross product */
function vecCross(a: Point3D, b: Point3D): Point3D {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// ============================================================================
// IfcCreator
// ============================================================================

export class IfcCreator {
  private nextId = 1;
  private lines: string[] = [];
  private entities: CreatedEntity[] = [];
  private schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';

  // Shared entity IDs (created in constructor)
  private projectId = 0;
  private siteId = 0;
  private buildingId = 0;
  private ownerHistoryId = 0;
  private contextId = 0;
  private subContextBody = 0;
  private subContextAxis = 0;
  private originId = 0;
  private dirZ = 0;
  private dirX = 0;
  private worldPlacementId = 0;
  private unitAssignmentId = 0;

  // Guard against repeated toIfc() calls (relationships are not idempotent)
  private finalized = false;

  // Default surface style (applied to elements without custom color)
  private defaultStyleId = 0;

  // Per-element style tracking (deferred to finalization)
  private elementSolids: Map<number, number[]> = new Map();
  private elementColors: Map<number, { name: string; rgb: [number, number, number] }> = new Map();

  // Material tracking (deferred IfcRelAssociatesMaterial at finalization)
  private materialCache: Map<string, number> = new Map();       // name → IfcMaterial id
  private elementMaterials: Map<number, number> = new Map();     // elementId → materialRefId

  // Tracking for spatial aggregation
  private storeyIds: number[] = [];
  private storeyElements: Map<number, number[]> = new Map();

  private projectParams: ProjectParams;

  constructor(params: ProjectParams = {}) {
    this.projectParams = params;
    this.schema = params.Schema ?? 'IFC4';
    this.buildPreamble(params);
  }

  // ============================================================================
  // Public API — Spatial Structure
  // ============================================================================

  /** Add a building storey. Returns the storey expressId for use with element creation. */
  addIfcBuildingStorey(params: StoreyParams): number {
    const id = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Storey';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const elevation = num(params.Elevation);

    this.line(id, 'IFCBUILDINGSTOREY',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},$,$,#${this.worldPlacementId},$,.ELEMENT.,${elevation}`);

    this.storeyIds.push(id);
    this.storeyElements.set(id, []);
    this.entities.push({ expressId: id, type: 'IfcBuildingStorey', Name: name });
    return id;
  }

  // ============================================================================
  // Public API — Building Elements
  // ============================================================================

  /**
   * Create a wall from Start to End with given Thickness and Height.
   *
   * Geometry: placement at Start. Profile offset so the solid extends
   * exactly from Start to End, centered on the thickness axis. Extruded
   * upward by Height.
   */
  addIfcWall(storeyId: number, params: WallParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const wallLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    // Placement at Start. Local X = wall direction, Z = up (default).
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      RefDirection: dir,
    });

    // Rectangle profile centered at (wallLen/2, 0) so it spans 0..wallLen along local X
    // and -thickness/2..+thickness/2 along local Y.
    const profileId = this.addRectangleProfile(wallLen, params.Thickness, [wallLen / 2, 0]);

    // Extrude along Z (up) by Height
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);

    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const wallId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Wall';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(wallId, 'IFCWALL',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.STANDARD.`);

    this.elementSolids.set(wallId, [solidId]);
    this.trackElement(storeyId, wallId);
    this.entities.push({ expressId: wallId, type: 'IfcWall', Name: name });

    // Add openings
    if (params.Openings) {
      for (const opening of params.Openings) {
        this.addWallOpening(wallId, placementId, opening, params.Thickness);
      }
    }

    return wallId;
  }

  /**
   * Create a slab. Position is the minimum corner.
   * Width along +X, Depth along +Y, Thickness extruded along +Z.
   */
  addIfcSlab(storeyId: number, params: SlabParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    let profileId: number;
    if (params.Profile && params.Profile.length >= 3) {
      profileId = this.addArbitraryProfile(params.Profile);
    } else {
      const w = params.Width ?? 5;
      const d = params.Depth ?? 5;
      // Profile centered at (w/2, d/2) so slab starts at Position corner
      profileId = this.addRectangleProfile(w, d, [w / 2, d / 2]);
    }

    const solidId = this.addExtrudedAreaSolid(profileId, params.Thickness);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const slabId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Slab';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(slabId, 'IFCSLAB',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.FLOOR.`);

    this.elementSolids.set(slabId, [solidId]);
    this.trackElement(storeyId, slabId);
    this.entities.push({ expressId: slabId, type: 'IfcSlab', Name: name });

    if (params.Openings) {
      for (const opening of params.Openings) {
        this.addSlabOpening(slabId, placementId, opening, params.Thickness);
      }
    }

    return slabId;
  }

  /**
   * Create a column. Position is the base center.
   * Cross-section centered, extruded upward by Height.
   */
  addIfcColumn(storeyId: number, params: ColumnParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    // Centered profile — column base center = Position
    const profileId = this.addRectangleProfile(params.Width, params.Depth);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const colId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Column';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(colId, 'IFCCOLUMN',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.COLUMN.`);

    this.elementSolids.set(colId, [solidId]);
    this.trackElement(storeyId, colId);
    this.entities.push({ expressId: colId, type: 'IfcColumn', Name: name });
    return colId;
  }

  /**
   * Create a beam from Start to End.
   * Cross-section (Width × Height) centered on the beam axis.
   */
  addIfcBeam(storeyId: number, params: BeamParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const beamLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    // Local Z = beam direction, so extrusion along Z = along beam.
    // Local X, Y define the cross-section plane.
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    // Centered cross-section
    const profileId = this.addRectangleProfile(params.Width, params.Height);
    const solidId = this.addExtrudedAreaSolid(profileId, beamLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const beamId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Beam';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(beamId, 'IFCBEAM',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.BEAM.`);

    this.elementSolids.set(beamId, [solidId]);
    this.trackElement(storeyId, beamId);
    this.entities.push({ expressId: beamId, type: 'IfcBeam', Name: name });
    return beamId;
  }

  /**
   * Create a straight-run stair.
   * Position is the nose of the first tread. Treads advance along local +X
   * (rotated into world space by Direction). Width extends along local +Y.
   */
  addIfcStair(storeyId: number, params: StairParams): number {
    if (params.NumberOfRisers <= 0) throw new Error('addStair: NumberOfRisers must be > 0');
    if (params.RiserHeight <= 0) throw new Error('addStair: RiserHeight must be > 0');
    if (params.TreadLength <= 0) throw new Error('addStair: TreadLength must be > 0');
    if (params.Width <= 0) throw new Error('addStair: Width must be > 0');

    const direction = params.Direction ?? 0;
    // Use LocalPlacement rotation so both step positions AND profiles rotate together
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
      RefDirection: direction !== 0 ? [Math.cos(direction), Math.sin(direction), 0] : undefined,
    });

    const stepSolids: number[] = [];

    for (let i = 0; i < params.NumberOfRisers; i++) {
      // Steps in stair-local coordinates: +X = run direction, +Z = up
      const stepOriginId = this.addCartesianPoint([
        i * params.TreadLength,
        0,
        i * params.RiserHeight,
      ]);
      const stepAxis2Id = this.addAxis2Placement3D(stepOriginId);

      // Profile: TreadLength along local X, Width along local Y, offset from origin corner
      const profileId = this.addRectangleProfile(
        params.TreadLength, params.Width,
        [params.TreadLength / 2, params.Width / 2],
      );
      const solidId = this.id();
      this.line(solidId, 'IFCEXTRUDEDAREASOLID',
        `#${profileId},#${stepAxis2Id},#${this.dirZ},${num(params.RiserHeight)}`);
      stepSolids.push(solidId);
    }

    const shapeId = this.addShapeRepresentation('Body', stepSolids);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const stairId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Stair';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(stairId, 'IFCSTAIR',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.STRAIGHT_RUN_STAIR.`);

    this.elementSolids.set(stairId, [...stepSolids]);
    this.trackElement(storeyId, stairId);
    this.entities.push({ expressId: stairId, type: 'IfcStair', Name: name });
    return stairId;
  }

  /**
   * Create a roof. Position is the minimum corner.
   * Width along +X, Depth along +Y, Thickness extruded upward.
   * Optional Slope rotates the extrusion around the Y axis.
   */
  addIfcRoof(storeyId: number, params: RoofParams): number {
    const slope = params.Slope ?? 0;

    let axis: Point3D = [0, 0, 1];
    let refDir: Point3D = [1, 0, 0];
    if (slope > 0) {
      axis = [Math.sin(slope), 0, Math.cos(slope)];
      refDir = [Math.cos(slope), 0, -Math.sin(slope)];
    }

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
      Axis: axis,
      RefDirection: refDir,
    });

    // Profile from corner, like slab
    const profileId = this.addRectangleProfile(
      params.Width, params.Depth,
      [params.Width / 2, params.Depth / 2],
    );
    const solidId = this.addExtrudedAreaSolid(profileId, params.Thickness);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const roofId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Roof';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(roofId, 'IFCROOF',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.FLAT_ROOF.`);

    this.elementSolids.set(roofId, [solidId]);
    this.trackElement(storeyId, roofId);
    this.entities.push({ expressId: roofId, type: 'IfcRoof', Name: name });
    return roofId;
  }

  /**
   * Create a door element. Width × Height × Thickness panel.
   */
  addIfcDoor(storeyId: number, params: DoorParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    const thickness = params.Thickness ?? 0.05;
    const profileId = this.addRectangleProfile(params.Width, thickness);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const doorId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Door';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';
    const opType = params.OperationType ?? 'SINGLE_SWING_LEFT';

    this.line(doorId, 'IFCDOOR',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},${num(params.Height)},${num(params.Width)},.${opType}.,$`);

    this.elementSolids.set(doorId, [solidId]);
    this.trackElement(storeyId, doorId);
    this.entities.push({ expressId: doorId, type: 'IfcDoor', Name: name });
    return doorId;
  }

  /**
   * Create a window element. Width × Height × Thickness frame.
   */
  addIfcWindow(storeyId: number, params: WindowParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    const thickness = params.Thickness ?? 0.05;
    const profileId = this.addRectangleProfile(params.Width, thickness);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const windowId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Window';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';
    const partType = params.PartitioningType ?? 'SINGLE_PANEL';

    this.line(windowId, 'IFCWINDOW',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},${num(params.Height)},${num(params.Width)},.NOTDEFINED.,.${partType}.,$`);

    this.elementSolids.set(windowId, [solidId]);
    this.trackElement(storeyId, windowId);
    this.entities.push({ expressId: windowId, type: 'IfcWindow', Name: name });
    return windowId;
  }

  /**
   * Create a ramp. Position is the low end.
   * Width along +Y, Length along +X, Rise optionally inclines the ramp.
   */
  addIfcRamp(storeyId: number, params: RampParams): number {
    const rise = params.Rise ?? 0;
    let axis: Point3D = [0, 0, 1];
    let refDir: Point3D = [1, 0, 0];
    if (rise > 0) {
      const slopeAngle = Math.atan2(rise, params.Length);
      axis = [Math.sin(slopeAngle), 0, Math.cos(slopeAngle)];
      refDir = [Math.cos(slopeAngle), 0, -Math.sin(slopeAngle)];
    }

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
      Axis: axis,
      RefDirection: refDir,
    });

    const profileId = this.addRectangleProfile(
      params.Length, params.Width,
      [params.Length / 2, params.Width / 2],
    );
    const solidId = this.addExtrudedAreaSolid(profileId, params.Thickness);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const rampId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Ramp';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(rampId, 'IFCRAMP',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.STRAIGHT_RUN_RAMP.`);

    this.elementSolids.set(rampId, [solidId]);
    this.trackElement(storeyId, rampId);
    this.entities.push({ expressId: rampId, type: 'IfcRamp', Name: name });
    return rampId;
  }

  /**
   * Create a railing from Start to End with given Height.
   */
  addIfcRailing(storeyId: number, params: RailingParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const railLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const railWidth = params.Width ?? 0.05;
    const profileId = this.addRectangleProfile(railWidth, railWidth);
    const solidId = this.addExtrudedAreaSolid(profileId, railLen);

    // Add vertical posts at start and end
    const postSolids: number[] = [solidId];
    const postProfile = this.addRectangleProfile(railWidth, railWidth);

    // Start post
    const startPostOriginId = this.addCartesianPoint([0, 0, 0]);
    const startPostAxisId = this.addDirection([0, 0, 1]);
    const startPostRefId = this.addDirection([1, 0, 0]);
    const startPostAxis2Id = this.addAxis2Placement3D(startPostOriginId, startPostAxisId, startPostRefId);
    const startPostId = this.id();
    this.line(startPostId, 'IFCEXTRUDEDAREASOLID',
      `#${postProfile},#${startPostAxis2Id},#${this.dirZ},${num(params.Height)}`);
    postSolids.push(startPostId);

    const shapeId = this.addShapeRepresentation('Body', postSolids);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const railingId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Railing';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(railingId, 'IFCRAILING',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.HANDRAIL.`);

    this.elementSolids.set(railingId, postSolids);
    this.trackElement(storeyId, railingId);
    this.entities.push({ expressId: railingId, type: 'IfcRailing', Name: name });
    return railingId;
  }

  /**
   * Create a plate (thin flat element, e.g. steel plate).
   */
  addIfcPlate(storeyId: number, params: PlateParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    let profileId: number;
    if (params.Profile && params.Profile.length >= 3) {
      profileId = this.addArbitraryProfile(params.Profile);
    } else {
      profileId = this.addRectangleProfile(params.Width, params.Depth, [params.Width / 2, params.Depth / 2]);
    }

    const solidId = this.addExtrudedAreaSolid(profileId, params.Thickness);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const plateId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Plate';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(plateId, 'IFCPLATE',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(plateId, [solidId]);
    this.trackElement(storeyId, plateId);
    this.entities.push({ expressId: plateId, type: 'IfcPlate', Name: name });
    return plateId;
  }

  /**
   * Create a structural member (brace, strut, etc.) from Start to End.
   */
  addIfcMember(storeyId: number, params: MemberParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const memberLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const profileId = this.addRectangleProfile(params.Width, params.Height);
    const solidId = this.addExtrudedAreaSolid(profileId, memberLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const memberId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Member';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(memberId, 'IFCMEMBER',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(memberId, [solidId]);
    this.trackElement(storeyId, memberId);
    this.entities.push({ expressId: memberId, type: 'IfcMember', Name: name });
    return memberId;
  }

  /**
   * Create a footing (foundation). Position is top centre, Height extends downward.
   */
  addIfcFooting(storeyId: number, params: FootingParams): number {
    // Offset placement downward so extrusion starts at bottom
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: [params.Position[0], params.Position[1], params.Position[2] - params.Height],
    });

    const profileId = this.addRectangleProfile(params.Width, params.Depth);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const footingId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Footing';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';
    const predefined = params.PredefinedType ?? 'PAD_FOOTING';

    this.line(footingId, 'IFCFOOTING',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.${predefined}.`);

    this.elementSolids.set(footingId, [solidId]);
    this.trackElement(storeyId, footingId);
    this.entities.push({ expressId: footingId, type: 'IfcFooting', Name: name });
    return footingId;
  }

  /**
   * Create a pile (deep foundation). Position is top, Length extends downward.
   * Uses circular cross-section by default, rectangular if IsRectangular is set.
   */
  addIfcPile(storeyId: number, params: PileParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: [params.Position[0], params.Position[1], params.Position[2] - params.Length],
    });

    let profileId: number;
    if (params.IsRectangular) {
      const depth = params.RectangularDepth ?? params.Diameter;
      profileId = this.addRectangleProfile(params.Diameter, depth);
    } else {
      profileId = this.addCircleProfile(params.Diameter / 2);
    }

    const solidId = this.addExtrudedAreaSolid(profileId, params.Length);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const pileId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Pile';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(pileId, 'IFCPILE',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.DRIVEN.,$`);

    this.elementSolids.set(pileId, [solidId]);
    this.trackElement(storeyId, pileId);
    this.entities.push({ expressId: pileId, type: 'IfcPile', Name: name });
    return pileId;
  }

  /**
   * Create a space (room volume).
   */
  addIfcSpace(storeyId: number, params: SpaceParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    let profileId: number;
    if (params.Profile && params.Profile.length >= 3) {
      profileId = this.addArbitraryProfile(params.Profile);
    } else {
      profileId = this.addRectangleProfile(params.Width, params.Depth, [params.Width / 2, params.Depth / 2]);
    }

    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const spaceId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Space';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';
    const longName = params.LongName ? `'${esc(params.LongName)}'` : '$';

    this.line(spaceId, 'IFCSPACE',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${longName},.ELEMENT.,.INTERNAL.,$`);

    this.elementSolids.set(spaceId, [solidId]);
    this.trackElement(storeyId, spaceId);
    this.entities.push({ expressId: spaceId, type: 'IfcSpace', Name: name });
    return spaceId;
  }

  /**
   * Create a curtain wall. Thin panel from Start to End, extruded by Height.
   */
  addIfcCurtainWall(storeyId: number, params: CurtainWallParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const wallLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);
    const thickness = params.Thickness ?? 0.05;

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      RefDirection: dir,
    });

    const profileId = this.addRectangleProfile(wallLen, thickness, [wallLen / 2, 0]);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const cwId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Curtain Wall';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(cwId, 'IFCCURTAINWALL',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(cwId, [solidId]);
    this.trackElement(storeyId, cwId);
    this.entities.push({ expressId: cwId, type: 'IfcCurtainWall', Name: name });
    return cwId;
  }

  /**
   * Create a furnishing element (furniture/equipment bounding box).
   */
  addIfcFurnishingElement(storeyId: number, params: FurnishingParams): number {
    const direction = params.Direction ?? 0;
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
      RefDirection: direction !== 0 ? [Math.cos(direction), Math.sin(direction), 0] : undefined,
    });

    const profileId = this.addRectangleProfile(params.Width, params.Depth, [params.Width / 2, params.Depth / 2]);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const furnId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Furnishing';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(furnId, 'IFCFURNISHINGELEMENT',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag}`);

    this.elementSolids.set(furnId, [solidId]);
    this.trackElement(storeyId, furnId);
    this.entities.push({ expressId: furnId, type: 'IfcFurnishingElement', Name: name });
    return furnId;
  }

  /**
   * Create a proxy element (generic element for custom/unclassified objects).
   */
  addIfcBuildingElementProxy(storeyId: number, params: ProxyParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    let profileId: number;
    if (params.Profile && params.Profile.length >= 3) {
      profileId = this.addArbitraryProfile(params.Profile);
    } else {
      profileId = this.addRectangleProfile(params.Width, params.Depth, [params.Width / 2, params.Depth / 2]);
    }

    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const proxyId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Proxy';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ?? params.ProxyType ?? '';
    const objTypeStr = objType ? `'${esc(objType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(proxyId, 'IFCBUILDINGELEMENTPROXY',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objTypeStr},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(proxyId, [solidId]);
    this.trackElement(storeyId, proxyId);
    this.entities.push({ expressId: proxyId, type: 'IfcBuildingElementProxy', Name: name });
    return proxyId;
  }

  // ============================================================================
  // Public API — Advanced Geometry (Circle, I-Shape, L-Shape, T-Shape, U-Shape, C-Shape profiles)
  // ============================================================================

  /**
   * Create a column with circular cross-section.
   */
  addIfcCircularColumn(storeyId: number, params: {
    Position: Point3D;
    Radius: number;
    Height: number;
  } & ElementAttributes): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    const profileId = this.addCircleProfile(params.Radius);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const colId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Column';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(colId, 'IFCCOLUMN',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.COLUMN.`);

    this.elementSolids.set(colId, [solidId]);
    this.trackElement(storeyId, colId);
    this.entities.push({ expressId: colId, type: 'IfcColumn', Name: name });
    return colId;
  }

  /**
   * Create a beam with I-shape (wide-flange/H-shape) cross-section.
   */
  addIfcIShapeBeam(storeyId: number, params: {
    Start: Point3D;
    End: Point3D;
    OverallWidth: number;
    OverallDepth: number;
    WebThickness: number;
    FlangeThickness: number;
    FilletRadius?: number;
  } & ElementAttributes): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const beamLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const profileId = this.addIShapeProfile(
      params.OverallWidth, params.OverallDepth,
      params.WebThickness, params.FlangeThickness,
      params.FilletRadius,
    );
    const solidId = this.addExtrudedAreaSolid(profileId, beamLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const beamId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Beam';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(beamId, 'IFCBEAM',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.BEAM.`);

    this.elementSolids.set(beamId, [solidId]);
    this.trackElement(storeyId, beamId);
    this.entities.push({ expressId: beamId, type: 'IfcBeam', Name: name });
    return beamId;
  }

  /**
   * Create a member with L-shape (angle) cross-section.
   */
  addIfcLShapeMember(storeyId: number, params: {
    Start: Point3D;
    End: Point3D;
    Depth: number;
    Width: number;
    Thickness: number;
    FilletRadius?: number;
  } & ElementAttributes): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const memberLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const profileId = this.addLShapeProfile(params.Depth, params.Width, params.Thickness, params.FilletRadius);
    const solidId = this.addExtrudedAreaSolid(profileId, memberLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const memberId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Member';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(memberId, 'IFCMEMBER',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(memberId, [solidId]);
    this.trackElement(storeyId, memberId);
    this.entities.push({ expressId: memberId, type: 'IfcMember', Name: name });
    return memberId;
  }

  /**
   * Create a member with T-shape cross-section.
   */
  addIfcTShapeMember(storeyId: number, params: {
    Start: Point3D;
    End: Point3D;
    FlangeWidth: number;
    Depth: number;
    WebThickness: number;
    FlangeThickness: number;
    FilletRadius?: number;
  } & ElementAttributes): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const memberLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const profileId = this.addTShapeProfile(
      params.FlangeWidth, params.Depth,
      params.WebThickness, params.FlangeThickness,
      params.FilletRadius,
    );
    const solidId = this.addExtrudedAreaSolid(profileId, memberLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const memberId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Member';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(memberId, 'IFCMEMBER',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(memberId, [solidId]);
    this.trackElement(storeyId, memberId);
    this.entities.push({ expressId: memberId, type: 'IfcMember', Name: name });
    return memberId;
  }

  /**
   * Create a member with U-shape (channel) cross-section.
   */
  addIfcUShapeMember(storeyId: number, params: {
    Start: Point3D;
    End: Point3D;
    Depth: number;
    FlangeWidth: number;
    WebThickness: number;
    FlangeThickness: number;
    FilletRadius?: number;
  } & ElementAttributes): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const memberLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const profileId = this.addUShapeProfile(
      params.Depth, params.FlangeWidth,
      params.WebThickness, params.FlangeThickness,
      params.FilletRadius,
    );
    const solidId = this.addExtrudedAreaSolid(profileId, memberLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const memberId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Member';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(memberId, 'IFCMEMBER',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.NOTDEFINED.`);

    this.elementSolids.set(memberId, [solidId]);
    this.trackElement(storeyId, memberId);
    this.entities.push({ expressId: memberId, type: 'IfcMember', Name: name });
    return memberId;
  }

  /**
   * Create a column or pile with hollow circular cross-section.
   */
  addIfcHollowCircularColumn(storeyId: number, params: {
    Position: Point3D;
    Radius: number;
    WallThickness: number;
    Height: number;
  } & ElementAttributes): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    const profileId = this.addCircleHollowProfile(params.Radius, params.WallThickness);
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const colId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Column';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(colId, 'IFCCOLUMN',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.COLUMN.`);

    this.elementSolids.set(colId, [solidId]);
    this.trackElement(storeyId, colId);
    this.entities.push({ expressId: colId, type: 'IfcColumn', Name: name });
    return colId;
  }

  /**
   * Create a beam/column with hollow rectangular (tube) cross-section.
   */
  addIfcRectangleHollowBeam(storeyId: number, params: {
    Start: Point3D;
    End: Point3D;
    XDim: number;
    YDim: number;
    WallThickness: number;
    InnerFilletRadius?: number;
    OuterFilletRadius?: number;
  } & ElementAttributes): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const beamLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

    const profileId = this.addRectangleHollowProfile(
      params.XDim, params.YDim, params.WallThickness,
      params.InnerFilletRadius, params.OuterFilletRadius,
    );
    const solidId = this.addExtrudedAreaSolid(profileId, beamLen);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const beamId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Beam';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(beamId, 'IFCBEAM',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.BEAM.`);

    this.elementSolids.set(beamId, [solidId]);
    this.trackElement(storeyId, beamId);
    this.entities.push({ expressId: beamId, type: 'IfcBeam', Name: name });
    return beamId;
  }

  // ============================================================================
  // Public API — Properties & Quantities
  // ============================================================================

  /** Attach a property set to an element */
  addIfcPropertySet(elementId: number, pset: PropertySetDef): number {
    const propIds: number[] = [];

    for (const prop of pset.Properties) {
      const propId = this.id();
      const valueStr = this.serializePropertyValue(prop);
      this.line(propId, 'IFCPROPERTYSINGLEVALUE',
        `'${esc(prop.Name)}',$,${valueStr},$`);
      propIds.push(propId);
    }

    const psetId = this.id();
    const globalId = newGlobalId();
    const refs = propIds.map(id => `#${id}`).join(',');
    this.line(psetId, 'IFCPROPERTYSET',
      `'${globalId}',#${this.ownerHistoryId},'${esc(pset.Name)}',$,(${refs})`);

    const relId = this.id();
    const relGlobalId = newGlobalId();
    this.line(relId, 'IFCRELDEFINESBYPROPERTIES',
      `'${relGlobalId}',#${this.ownerHistoryId},$,$,(#${elementId}),#${psetId}`);

    return psetId;
  }

  /** Attach element quantities to an element */
  addIfcElementQuantity(elementId: number, qset: QuantitySetDef): number {
    const qtyIds: number[] = [];

    for (const qty of qset.Quantities) {
      const qtyId = this.id();
      const valueField = this.quantityValueField(qty);
      this.line(qtyId, qty.Kind.toUpperCase(),
        `'${esc(qty.Name)}',$,${valueField}`);
      qtyIds.push(qtyId);
    }

    const qsetId = this.id();
    const globalId = newGlobalId();
    const refs = qtyIds.map(id => `#${id}`).join(',');
    this.line(qsetId, 'IFCELEMENTQUANTITY',
      `'${globalId}',#${this.ownerHistoryId},'${esc(qset.Name)}',$,$,(${refs})`);

    const relId = this.id();
    const relGlobalId = newGlobalId();
    this.line(relId, 'IFCRELDEFINESBYPROPERTIES',
      `'${relGlobalId}',#${this.ownerHistoryId},$,$,(#${elementId}),#${qsetId}`);

    return qsetId;
  }

  // ============================================================================
  // Public API — Styling
  // ============================================================================

  /**
   * Assign a named colour to an element. Call before toIfc().
   * Elements without a custom colour get the default grey.
   *
   * @param elementId The expressId returned by addWall/addSlab/…
   * @param name      Material name shown in IFC viewers (e.g. 'Concrete')
   * @param rgb       [r, g, b] each 0‒1
   */
  setColor(elementId: number, name: string, rgb: [number, number, number]): void {
    this.elementColors.set(elementId, { name, rgb });
  }

  // ============================================================================
  // Public API — Materials
  // ============================================================================

  /**
   * Assign an IFC material to an element. Creates proper IfcMaterial entities
   * and links them via IfcRelAssociatesMaterial during finalization.
   *
   * Simple material:   `{ Name: 'Concrete', Category: 'Structural' }`
   * Layered material:  `{ Name: 'Wall Assembly', Layers: [{ Name: 'Concrete', Thickness: 0.2 }, …] }`
   */
  addIfcMaterial(elementId: number, def: MaterialDef): void {
    let materialRefId: number;

    if (def.Layers && def.Layers.length > 0) {
      // IfcMaterialLayerSet path
      const layerIds: number[] = [];
      for (const layer of def.Layers) {
        const matId = this.getOrCreateMaterial(layer.Name, layer.Category);
        const layerId = this.id();
        const ventilated = layer.IsVentilated ? '.T.' : '.F.';
        const layerName = `'${esc(layer.Name)}'`;
        const layerCategory = layer.Category ? `'${esc(layer.Category)}'` : '$';
        // IFC4: Material, LayerThickness, IsVentilated, Name, Description, Category, Priority
        this.line(layerId, 'IFCMATERIALLAYER',
          `#${matId},${num(layer.Thickness)},${ventilated},${layerName},$,${layerCategory},$`);
        layerIds.push(layerId);
      }
      const layerRefs = layerIds.map(id => `#${id}`).join(',');
      materialRefId = this.id();
      // IFC4: MaterialLayers, LayerSetName, Description
      this.line(materialRefId, 'IFCMATERIALLAYERSET',
        `(${layerRefs}),'${esc(def.Name)}',$`);
    } else {
      // Simple IfcMaterial
      materialRefId = this.getOrCreateMaterial(def.Name, def.Category);
    }

    this.elementMaterials.set(elementId, materialRefId);
  }

  // ============================================================================
  // Public API — Export
  // ============================================================================

  /** Generate the complete IFC STEP file. May only be called once. */
  toIfc(): CreateResult {
    if (this.finalized) throw new Error('toIfc() has already been called — creator is not reusable');
    this.finalized = true;

    this.finalizeStyles();
    this.finalizeMaterials();
    this.finalizeRelationships();

    const header = this.buildHeader();
    const data = this.lines.join('\n');
    const content = `${header}DATA;\n${data}\nENDSEC;\nEND-ISO-10303-21;\n`;

    return {
      content,
      entities: [...this.entities],
      stats: {
        entityCount: this.lines.length,
        fileSize: new TextEncoder().encode(content).length,
      },
    };
  }

  private buildHeader(): string {
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const desc = 'Created by ifc-lite';
    const author = this.projectParams.Author ?? '';
    const org = this.projectParams.Organization ?? '';
    const app = 'ifc-lite';
    const filename = 'created.ifc';

    return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('${esc(desc)}'),'2;1');
FILE_NAME('${filename}','${now}',('${esc(author)}'),('${esc(org)}'),'${app}','${app}','');
FILE_SCHEMA(('${this.schema}'));
ENDSEC;
`;
  }

  // ============================================================================
  // Internal — Preamble (project, site, building, contexts, units, style)
  // ============================================================================

  private buildPreamble(params: ProjectParams): void {
    const personId = this.id();
    this.line(personId, 'IFCPERSON', "$,$,'',$,$,$,$,$");

    const orgId = this.id();
    this.line(orgId, 'IFCORGANIZATION', `$,'${esc(params.Organization ?? 'ifc-lite')}',$,$,$`);

    const personOrgId = this.id();
    this.line(personOrgId, 'IFCPERSONANDORGANIZATION', `#${personId},#${orgId},$`);

    const appId = this.id();
    this.line(appId, 'IFCAPPLICATION', `#${orgId},'1.0','ifc-lite','ifc-lite'`);

    this.ownerHistoryId = this.id();
    const timestamp = Math.floor(Date.now() / 1000);
    this.line(this.ownerHistoryId, 'IFCOWNERHISTORY',
      `#${personOrgId},#${appId},$,.NOCHANGE.,$,$,$,${timestamp}`);

    // Shared geometry primitives
    this.originId = this.addCartesianPoint([0, 0, 0]);
    this.dirZ = this.addDirection([0, 0, 1]);
    this.dirX = this.addDirection([1, 0, 0]);

    // World coordinate placement
    const worldAxisId = this.id();
    this.line(worldAxisId, 'IFCAXIS2PLACEMENT3D', `#${this.originId},#${this.dirZ},#${this.dirX}`);

    this.worldPlacementId = this.id();
    this.line(this.worldPlacementId, 'IFCLOCALPLACEMENT', `$,#${worldAxisId}`);

    // Geometric representation context
    this.contextId = this.id();
    this.line(this.contextId, 'IFCGEOMETRICREPRESENTATIONCONTEXT',
      `$,'Model',3,1.0E-5,#${worldAxisId},$`);

    this.subContextBody = this.id();
    this.line(this.subContextBody, 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
      `$,'Body',*,*,*,*,#${this.contextId},$,.MODEL_VIEW.,$`);

    this.subContextAxis = this.id();
    this.line(this.subContextAxis, 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
      `$,'Axis',*,*,*,*,#${this.contextId},$,.GRAPH_VIEW.,$`);

    // Units
    this.unitAssignmentId = this.buildUnits(params.LengthUnit ?? 'METRE');

    // Default surface style — light grey with some specularity
    this.defaultStyleId = this.buildDefaultStyle();

    // IfcProject
    this.projectId = this.id();
    const projectGlobalId = newGlobalId();
    const projectName = params.Name ?? 'Project';
    const projectDesc = params.Description ? `'${esc(params.Description)}'` : '$';
    this.line(this.projectId, 'IFCPROJECT',
      `'${projectGlobalId}',#${this.ownerHistoryId},'${esc(projectName)}',${projectDesc},$,$,$,(#${this.contextId}),#${this.unitAssignmentId}`);
    this.entities.push({ expressId: this.projectId, type: 'IfcProject', Name: projectName });

    // IfcSite
    this.siteId = this.id();
    const siteGlobalId = newGlobalId();
    this.line(this.siteId, 'IFCSITE',
      `'${siteGlobalId}',#${this.ownerHistoryId},'Site',$,$,#${this.worldPlacementId},$,$,.ELEMENT.,$,$,$,$,$`);
    this.entities.push({ expressId: this.siteId, type: 'IfcSite', Name: 'Site' });

    // IfcBuilding
    this.buildingId = this.id();
    const buildingGlobalId = newGlobalId();
    this.line(this.buildingId, 'IFCBUILDING',
      `'${buildingGlobalId}',#${this.ownerHistoryId},'Building',$,$,#${this.worldPlacementId},$,$,.ELEMENT.,$,$,$`);
    this.entities.push({ expressId: this.buildingId, type: 'IfcBuilding', Name: 'Building' });
  }

  private buildUnits(lengthUnit: string): number {
    const dimExpId = this.id();
    this.line(dimExpId, 'IFCDIMENSIONALEXPONENTS', '0,0,0,0,0,0,0');

    const siLengthId = this.id();
    this.line(siLengthId, 'IFCSIUNIT', `*,.LENGTHUNIT.,$,.METRE.`);

    let lengthUnitId = siLengthId;
    if (lengthUnit === 'MILLIMETRE') {
      const prefixId = this.id();
      this.line(prefixId, 'IFCSIUNIT', `*,.LENGTHUNIT.,.MILLI.,.METRE.`);
      lengthUnitId = prefixId;
    }

    const siAreaId = this.id();
    this.line(siAreaId, 'IFCSIUNIT', `*,.AREAUNIT.,$,.SQUARE_METRE.`);

    const siVolumeId = this.id();
    this.line(siVolumeId, 'IFCSIUNIT', `*,.VOLUMEUNIT.,$,.CUBIC_METRE.`);

    const siAngleId = this.id();
    this.line(siAngleId, 'IFCSIUNIT', `*,.PLANEANGLEUNIT.,$,.RADIAN.`);

    const assignmentId = this.id();
    this.line(assignmentId, 'IFCUNITASSIGNMENT',
      `(#${lengthUnitId},#${siAreaId},#${siVolumeId},#${siAngleId})`);

    return assignmentId;
  }

  /** Create a default IfcSurfaceStyle with a neutral colour (RGB 0.75, 0.73, 0.68) */
  private buildDefaultStyle(): number {
    // IfcColourRgb — warm concrete grey
    const colourId = this.id();
    this.line(colourId, 'IFCCOLOURRGB', `$,0.75,0.73,0.68`);

    // IfcSurfaceStyleRendering — surface + specular
    const renderingId = this.id();
    this.line(renderingId, 'IFCSURFACESTYLERENDERING',
      `#${colourId},0.,$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(64.),.NOTDEFINED.`);

    // IfcSurfaceStyle
    const styleId = this.id();
    this.line(styleId, 'IFCSURFACESTYLE', `'Default',.BOTH.,(#${renderingId})`);

    return styleId;
  }

  /** Create all IfcStyledItem entities — custom colour or default per element */
  private finalizeStyles(): void {
    // Cache: colour key → styleId so identical colours share one style entity
    const styleCache = new Map<string, number>();
    for (const [elementId, solidIds] of this.elementSolids) {
      const color = this.elementColors.get(elementId);
      let styleId: number;
      if (color) {
        const key = `${color.name}|${color.rgb.join(',')}`;
        const cached = styleCache.get(key);
        if (cached !== undefined) {
          styleId = cached;
        } else {
          styleId = this.buildColorStyle(color.name, color.rgb);
          styleCache.set(key, styleId);
        }
      } else {
        styleId = this.defaultStyleId;
      }
      for (const solidId of solidIds) {
        const styledItemId = this.id();
        this.line(styledItemId, 'IFCSTYLEDITEM', `#${solidId},(#${styleId}),$`);
      }
    }
  }

  /** Create a named IfcSurfaceStyle with the given RGB colour */
  private buildColorStyle(name: string, rgb: [number, number, number]): number {
    const colourId = this.id();
    this.line(colourId, 'IFCCOLOURRGB', `$,${num(rgb[0])},${num(rgb[1])},${num(rgb[2])}`);

    const renderingId = this.id();
    this.line(renderingId, 'IFCSURFACESTYLERENDERING',
      `#${colourId},0.,$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(64.),.NOTDEFINED.`);

    const styleId = this.id();
    this.line(styleId, 'IFCSURFACESTYLE', `'${esc(name)}',.BOTH.,(#${renderingId})`);
    return styleId;
  }

  // ============================================================================
  // Internal — Material helpers
  // ============================================================================

  /** Get or create a shared IfcMaterial entity (IFC4: Name, Description, Category) */
  private getOrCreateMaterial(name: string, category?: string): number {
    const cached = this.materialCache.get(name);
    if (cached !== undefined) return cached;

    const matId = this.id();
    const cat = category ? `'${esc(category)}'` : '$';
    this.line(matId, 'IFCMATERIAL', `'${esc(name)}',$,${cat}`);
    this.materialCache.set(name, matId);
    return matId;
  }

  /** Create IfcRelAssociatesMaterial entities — one per unique material ref (batched) */
  private finalizeMaterials(): void {
    // Group elements by materialRefId so elements sharing a material get one rel
    const groups = new Map<number, number[]>();
    for (const [elementId, materialRefId] of this.elementMaterials) {
      const group = groups.get(materialRefId);
      if (group) group.push(elementId);
      else groups.set(materialRefId, [elementId]);
    }

    for (const [materialRefId, elementIds] of groups) {
      const relId = this.id();
      const globalId = newGlobalId();
      const refs = elementIds.map(id => `#${id}`).join(',');
      this.line(relId, 'IFCRELASSOCIATESMATERIAL',
        `'${globalId}',#${this.ownerHistoryId},$,$,(${refs}),#${materialRefId}`);
    }
  }

  // ============================================================================
  // Internal — Geometry helpers
  // ============================================================================

  private addCartesianPoint(p: Point3D): number {
    const id = this.id();
    this.line(id, 'IFCCARTESIANPOINT', `(${num(p[0])},${num(p[1])},${num(p[2])})`);
    return id;
  }

  private addCartesianPoint2D(p: Point2D): number {
    const id = this.id();
    this.line(id, 'IFCCARTESIANPOINT', `(${num(p[0])},${num(p[1])})`);
    return id;
  }

  private addDirection(d: Point3D): number {
    const id = this.id();
    this.line(id, 'IFCDIRECTION', `(${num(d[0])},${num(d[1])},${num(d[2])})`);
    return id;
  }

  private addAxis2Placement3D(originId: number, axisId?: number, refDirId?: number): number {
    const id = this.id();
    const axis = axisId ? `#${axisId}` : '$';
    const refDir = refDirId ? `#${refDirId}` : '$';
    this.line(id, 'IFCAXIS2PLACEMENT3D', `#${originId},${axis},${refDir}`);
    return id;
  }

  /**
   * Create a local placement relative to the world coordinate system.
   * @param relativeTo - Parent placement ID (use getWorldPlacementId() for world origin)
   * @param placement - Location and optional axis/ref directions
   */
  addLocalPlacement(relativeTo: number, placement: Placement3D): number {
    const originId = this.addCartesianPoint(placement.Location);
    let axisId: number | undefined;
    let refDirId: number | undefined;

    if (placement.Axis) {
      axisId = this.addDirection(placement.Axis);
    }
    if (placement.RefDirection) {
      refDirId = this.addDirection(placement.RefDirection);
    }

    const axis2Id = this.addAxis2Placement3D(originId, axisId, refDirId);

    const id = this.id();
    this.line(id, 'IFCLOCALPLACEMENT', `#${relativeTo},#${axis2Id}`);
    return id;
  }

  /**
   * Create a rectangle profile.
   * @param xDim Width of rectangle
   * @param yDim Height of rectangle
   * @param center Optional 2D offset for the profile centre. Default [0,0] = centred at origin.
   */
  addRectangleProfile(xDim: number, yDim: number, center?: Point2D): number {
    const cx = center?.[0] ?? 0;
    const cy = center?.[1] ?? 0;
    const profileOriginId = this.addCartesianPoint2D([cx, cy]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    this.line(id, 'IFCRECTANGLEPROFILEDEF', `.AREA.,$,#${profileAxis2dId},${num(xDim)},${num(yDim)}`);
    return id;
  }

  /** Create a circle profile. */
  addCircleProfile(radius: number): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    this.line(id, 'IFCCIRCLEPROFILEDEF', `.AREA.,$,#${profileAxis2dId},${num(radius)}`);
    return id;
  }

  /** Create a hollow circle profile (pipe section). */
  addCircleHollowProfile(radius: number, wallThickness: number): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    this.line(id, 'IFCCIRCLEHOLLOWPROFILEDEF', `.AREA.,$,#${profileAxis2dId},${num(radius)},${num(wallThickness)}`);
    return id;
  }

  /** Create an I-shape (wide-flange / H-beam) profile. */
  addIShapeProfile(
    overallWidth: number, overallDepth: number,
    webThickness: number, flangeThickness: number,
    filletRadius?: number,
  ): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    const fillet = filletRadius !== undefined ? num(filletRadius) : '$';
    this.line(id, 'IFCISHAPEPROFILEDEF',
      `.AREA.,$,#${profileAxis2dId},${num(overallWidth)},${num(overallDepth)},${num(webThickness)},${num(flangeThickness)},${fillet},$,$`);
    return id;
  }

  /** Create an L-shape (angle section) profile. */
  addLShapeProfile(
    depth: number, width: number, thickness: number,
    filletRadius?: number,
  ): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    const fillet = filletRadius !== undefined ? num(filletRadius) : '$';
    this.line(id, 'IFCLSHAPEPROFILEDEF',
      `.AREA.,$,#${profileAxis2dId},${num(depth)},${num(width)},${num(thickness)},${fillet},$,$`);
    return id;
  }

  /** Create a T-shape (tee section) profile. */
  addTShapeProfile(
    flangeWidth: number, depth: number,
    webThickness: number, flangeThickness: number,
    filletRadius?: number,
  ): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    const fillet = filletRadius !== undefined ? num(filletRadius) : '$';
    this.line(id, 'IFCTSHAPEPROFILEDEF',
      `.AREA.,$,#${profileAxis2dId},${num(depth)},${num(flangeWidth)},${num(webThickness)},${num(flangeThickness)},${fillet},$,$,$,$`);
    return id;
  }

  /** Create a U-shape (channel section) profile. */
  addUShapeProfile(
    depth: number, flangeWidth: number,
    webThickness: number, flangeThickness: number,
    filletRadius?: number,
  ): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    const fillet = filletRadius !== undefined ? num(filletRadius) : '$';
    this.line(id, 'IFCUSHAPEPROFILEDEF',
      `.AREA.,$,#${profileAxis2dId},${num(depth)},${num(flangeWidth)},${num(webThickness)},${num(flangeThickness)},${fillet},$`);
    return id;
  }

  /** Create a C-shape (cold-formed channel) profile. */
  addCShapeProfile(
    depth: number, width: number,
    wallThickness: number, girth: number,
  ): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    this.line(id, 'IFCCSHAPEPROFILEDEF',
      `.AREA.,$,#${profileAxis2dId},${num(depth)},${num(width)},${num(wallThickness)},${num(girth)},$`);
    return id;
  }

  /** Create a hollow rectangle (tube section) profile. */
  addRectangleHollowProfile(
    xDim: number, yDim: number, wallThickness: number,
    innerFilletRadius?: number, outerFilletRadius?: number,
  ): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    const inner = innerFilletRadius !== undefined ? num(innerFilletRadius) : '$';
    const outer = outerFilletRadius !== undefined ? num(outerFilletRadius) : '$';
    this.line(id, 'IFCRECTANGLEHOLLOWPROFILEDEF',
      `.AREA.,$,#${profileAxis2dId},${num(xDim)},${num(yDim)},${num(wallThickness)},${inner},${outer}`);
    return id;
  }

  /** Create an arbitrary closed profile from a polyline. Points are auto-closed. */
  addArbitraryProfile(points: Point2D[]): number {
    const pointIds = points.map(p => this.addCartesianPoint2D(p));
    if (points.length > 0) {
      pointIds.push(pointIds[0]); // close the polyline
    }
    const refs = pointIds.map(id => `#${id}`).join(',');
    const polylineId = this.id();
    this.line(polylineId, 'IFCPOLYLINE', `(${refs})`);

    const id = this.id();
    this.line(id, 'IFCARBITRARYCLOSEDPROFILEDEF', `.AREA.,$,#${polylineId}`);
    return id;
  }

  /**
   * Create an extruded area solid from a profile.
   * @param profileId - ID returned by any addXxxProfile() method
   * @param depth - Extrusion depth
   * @param extrusionDir - Optional direction ID (default: Z-up)
   */
  addExtrudedAreaSolid(profileId: number, depth: number, extrusionDir?: number): number {
    const originId = this.addCartesianPoint([0, 0, 0]);
    const axis2Id = this.addAxis2Placement3D(originId);

    const dirRef = extrusionDir ?? this.dirZ;
    const id = this.id();
    this.line(id, 'IFCEXTRUDEDAREASOLID',
      `#${profileId},#${axis2Id},#${dirRef},${num(depth)}`);
    return id;
  }

  /**
   * Create a shape representation from solid IDs.
   * @param repType - 'Body' or 'Axis'
   * @param itemIds - Array of solid IDs (from addExtrudedAreaSolid, etc.)
   */
  addShapeRepresentation(repType: string, itemIds: number[]): number {
    const contextRef = repType === 'Axis' ? this.subContextAxis : this.subContextBody;
    const refs = itemIds.map(id => `#${id}`).join(',');
    const repId = this.id();
    const repIdentifier = repType === 'Axis' ? 'Axis' : 'Body';
    const repTypeName = itemIds.length > 1 ? 'SolidModel' : 'SweptSolid';
    this.line(repId, 'IFCSHAPEREPRESENTATION',
      `#${contextRef},'${repIdentifier}','${repTypeName}',(${refs})`);
    return repId;
  }

  /** Wrap shape representations into a product definition shape. */
  addProductDefinitionShape(repIds: number[]): number {
    const refs = repIds.map(id => `#${id}`).join(',');
    const id = this.id();
    this.line(id, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(${refs})`);
    return id;
  }

  // ============================================================================
  // Public API — Low-level helpers
  // ============================================================================

  /** Get the world placement ID (use as relativeTo for addLocalPlacement). */
  getWorldPlacementId(): number {
    return this.worldPlacementId;
  }

  /** Create a direction entity. Returns the direction ID. */
  addDirection3D(d: Point3D): number {
    return this.addDirection(d);
  }

  /**
   * Create a profile from a ProfileDef union type.
   * This is the high-level entry point for profile creation — it dispatches
   * to the appropriate addXxxProfile() method based on the shape.
   *
   * ```ts
   * const profileId = creator.createProfile({
   *   ProfileType: 'AREA',
   *   Radius: 0.15,
   * }); // Creates a circle profile
   * ```
   */
  createProfile(profile: ProfileDef): number {
    if ('OuterCurve' in profile) {
      return this.addArbitraryProfile(profile.OuterCurve);
    }
    if ('Radius' in profile && 'WallThickness' in profile) {
      return this.addCircleHollowProfile(profile.Radius, profile.WallThickness);
    }
    if ('Radius' in profile) {
      return this.addCircleProfile(profile.Radius);
    }
    if ('OverallWidth' in profile && 'WebThickness' in profile) {
      // IShapeProfile
      return this.addIShapeProfile(
        profile.OverallWidth, profile.OverallDepth,
        profile.WebThickness, profile.FlangeThickness,
        profile.FilletRadius,
      );
    }
    if ('FlangeWidth' in profile && 'WebThickness' in profile && 'Depth' in profile && !('FlangeWidth' in profile && 'Depth' in profile && !('WebThickness' in profile))) {
      // Could be T or U — disambiguate
      if ('FlangeWidth' in profile && !('Width' in profile)) {
        // Check if it's UShapeProfile (has FlangeWidth but no FlangeWidth as main width)
        // TShape: FlangeWidth, Depth, WebThickness, FlangeThickness
        // UShape: Depth, FlangeWidth, WebThickness, FlangeThickness
        // They're structurally identical — use Girth to detect CShape, else check field ordering
        return this.addTShapeProfile(
          (profile as { FlangeWidth: number }).FlangeWidth,
          (profile as { Depth: number }).Depth,
          (profile as { WebThickness: number }).WebThickness,
          (profile as { FlangeThickness: number }).FlangeThickness,
          (profile as { FilletRadius?: number }).FilletRadius,
        );
      }
    }
    if ('Girth' in profile) {
      // CShapeProfile
      const p = profile as { Depth: number; Width: number; WallThickness: number; Girth: number };
      return this.addCShapeProfile(p.Depth, p.Width, p.WallThickness, p.Girth);
    }
    if ('XDim' in profile && 'YDim' in profile && 'WallThickness' in profile) {
      // RectangleHollowProfile
      const p = profile as { XDim: number; YDim: number; WallThickness: number; InnerFilletRadius?: number; OuterFilletRadius?: number };
      return this.addRectangleHollowProfile(p.XDim, p.YDim, p.WallThickness, p.InnerFilletRadius, p.OuterFilletRadius);
    }
    if ('XDim' in profile && 'YDim' in profile) {
      // RectangleProfile
      return this.addRectangleProfile(profile.XDim, profile.YDim);
    }
    if ('Depth' in profile && 'Width' in profile && 'Thickness' in profile) {
      // LShapeProfile
      const p = profile as { Depth: number; Width: number; Thickness: number; FilletRadius?: number };
      return this.addLShapeProfile(p.Depth, p.Width, p.Thickness, p.FilletRadius);
    }
    if ('Depth' in profile && 'FlangeWidth' in profile) {
      // UShapeProfile
      const p = profile as { Depth: number; FlangeWidth: number; WebThickness: number; FlangeThickness: number; FilletRadius?: number };
      return this.addUShapeProfile(p.Depth, p.FlangeWidth, p.WebThickness, p.FlangeThickness, p.FilletRadius);
    }
    throw new Error('Unrecognized profile shape — ensure ProfileType is "AREA" and required fields are set');
  }

  // ============================================================================
  // Public API — Generic element creation
  // ============================================================================

  /**
   * Create ANY IFC element type with an extruded profile at a placement.
   *
   * This is the low-level foundation that all high-level methods (addIfcWall,
   * addIfcBeam, etc.) are built on. Use it when you need an IFC type that
   * doesn't have a dedicated method, or when you need full control.
   *
   * ```ts
   * // Pipe segment with circular profile
   * creator.addElement(storeyId, {
   *   IfcType: 'IFCFLOWSEGMENT',
   *   Placement: { Location: [0, 0, 3] },
   *   Profile: { ProfileType: 'AREA', Radius: 0.05 },
   *   Depth: 5,
   *   PredefinedType: '.RIGIDSEGMENT.',
   *   Name: 'Pipe-001',
   * });
   *
   * // Distribution element with L-profile
   * creator.addElement(storeyId, {
   *   IfcType: 'IFCDISTRIBUTIONELEMENT',
   *   Placement: { Location: [2, 0, 0], Axis: [0, 0, 1], RefDirection: [1, 0, 0] },
   *   Profile: { ProfileType: 'AREA', Depth: 0.1, Width: 0.1, Thickness: 0.01 },
   *   Depth: 3,
   * });
   * ```
   */
  addElement(storeyId: number, params: GenericElementParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, params.Placement);
    const profileId = this.createProfile(params.Profile);

    // Handle custom extrusion direction
    let extrusionDirId: number | undefined;
    if (params.ExtrusionDirection) {
      extrusionDirId = this.addDirection(params.ExtrusionDirection);
    }

    const solidId = this.addExtrudedAreaSolid(profileId, params.Depth, extrusionDirId);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const elementId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? params.IfcType;
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';
    const predefinedType = params.PredefinedType ?? '.NOTDEFINED.';

    this.line(elementId, params.IfcType,
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},${predefinedType}`);

    this.elementSolids.set(elementId, [solidId]);
    this.trackElement(storeyId, elementId);
    this.entities.push({ expressId: elementId, type: params.IfcType, Name: name });

    return elementId;
  }

  /**
   * Create ANY IFC element type extruded along an axis (Start → End).
   *
   * The profile is placed at Start and extruded along the direction to End.
   * The extrusion length equals the distance between Start and End.
   *
   * ```ts
   * // Pipe segment along an axis
   * creator.addAxisElement(storeyId, {
   *   IfcType: 'IFCPIPESEGMENT',
   *   Start: [0, 0, 3],
   *   End: [5, 0, 3],
   *   Profile: { ProfileType: 'AREA', Radius: 0.05 },
   *   Name: 'Pipe-001',
   * });
   *
   * // Cable tray with rectangle profile
   * creator.addAxisElement(storeyId, {
   *   IfcType: 'IFCCABLETRAYSEGMENT',
   *   Start: [0, 0, 2.5],
   *   End: [10, 0, 2.5],
   *   Profile: { ProfileType: 'AREA', XDim: 0.3, YDim: 0.1 },
   * });
   * ```
   */
  addAxisElement(storeyId: number, params: AxisElementParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    // Compute a perpendicular vector for the profile plane
    const up: Point3D = [0, 0, 1];
    let perp: Point3D = vecCross(dir, up);
    if (vecLen(perp) < 1e-6) {
      // dir is parallel to Z, use X as reference
      perp = vecCross(dir, [1, 0, 0]);
    }
    perp = vecNorm(perp);

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,           // local Z = along axis (extrusion direction)
      RefDirection: perp,  // local X = perpendicular to axis
    });

    const profileId = this.createProfile(params.Profile);
    const solidId = this.addExtrudedAreaSolid(profileId, length);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const elementId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? params.IfcType;
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';
    const predefinedType = params.PredefinedType ?? '.NOTDEFINED.';

    this.line(elementId, params.IfcType,
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},${predefinedType}`);

    this.elementSolids.set(elementId, [solidId]);
    this.trackElement(storeyId, elementId);
    this.entities.push({ expressId: elementId, type: params.IfcType, Name: name });

    return elementId;
  }

  // ============================================================================
  // Internal — Openings
  // ============================================================================

  /**
   * Add an opening in a wall.
   * Opening Position: [distance_along_wall, 0, sill_height]
   * The opening extrudes through the wall perpendicular to its face (local Y).
   */
  private addWallOpening(hostId: number, hostPlacementId: number, opening: RectangularOpening, wallThickness: number): number {
    // In wall local CS: X = along wall, Y = thickness, Z = up.
    // Opening needs to cut through the wall in the Y direction.
    // So we orient the opening's local Z = wall's local Y = [0,1,0],
    // and opening's local X = wall's local X = [1,0,0].
    // Opening local Y then = cross(Z,X) = cross([0,1,0],[1,0,0]) = [0,0,-1].
    // To get Y pointing up, flip: Axis = [0,-1,0].
    // Then: local X = [1,0,0], local Y = cross([0,-1,0],[1,0,0]) = [0,0,1], local Z = [0,-1,0].
    // Profile XY: X = along wall (Width), Y = up (Height). Extrusion Z = through wall.

    // Offset Y so extrusion starts just outside the +Y face and cuts clean through
    const openingOriginId = this.addCartesianPoint([
      opening.Position[0],
      wallThickness / 2 + 0.05,
      opening.Position[2],
    ]);
    const openingAxisId = this.addDirection([0, -1, 0]);
    const openingRefDirId = this.addDirection([1, 0, 0]);
    const openingAxis2Id = this.addAxis2Placement3D(openingOriginId, openingAxisId, openingRefDirId);

    const openingPlacementId = this.id();
    this.line(openingPlacementId, 'IFCLOCALPLACEMENT', `#${hostPlacementId},#${openingAxis2Id}`);

    // Profile: Width along wall (X), Height upward (Y), centered on position.
    // Extrude through wall thickness + margin.
    const profileId = this.addRectangleProfile(opening.Width, opening.Height, [0, opening.Height / 2]);
    const extrusionDepth = wallThickness + 0.1; // enough to cut clean through
    const solidId = this.addExtrudedAreaSolid(profileId, extrusionDepth);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const openingId = this.id();
    const globalId = newGlobalId();
    const name = opening.Name ?? 'Opening';
    this.line(openingId, 'IFCOPENINGELEMENT',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',$,$,#${openingPlacementId},#${prodShapeId},$,.OPENING.`);

    const relId = this.id();
    const relGlobalId = newGlobalId();
    this.line(relId, 'IFCRELVOIDSELEMENT',
      `'${relGlobalId}',#${this.ownerHistoryId},$,$,#${hostId},#${openingId}`);

    this.entities.push({ expressId: openingId, type: 'IfcOpeningElement', Name: name });
    return openingId;
  }

  /**
   * Add an opening in a slab.
   * Opening Position: [x_offset, y_offset, 0] relative to slab placement.
   * The opening extrudes through the slab along Z.
   */
  private addSlabOpening(hostId: number, hostPlacementId: number, opening: RectangularOpening, slabThickness: number): number {
    const placementId = this.addLocalPlacement(hostPlacementId, {
      Location: opening.Position,
    });

    const profileId = this.addRectangleProfile(opening.Width, opening.Height);
    const extrusionDepth = slabThickness + 0.1; // enough to cut clean through
    const solidId = this.addExtrudedAreaSolid(profileId, extrusionDepth);
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const openingId = this.id();
    const globalId = newGlobalId();
    const name = opening.Name ?? 'Opening';
    this.line(openingId, 'IFCOPENINGELEMENT',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',$,$,#${placementId},#${prodShapeId},$,.OPENING.`);

    const relId = this.id();
    const relGlobalId = newGlobalId();
    this.line(relId, 'IFCRELVOIDSELEMENT',
      `'${relGlobalId}',#${this.ownerHistoryId},$,$,#${hostId},#${openingId}`);

    this.entities.push({ expressId: openingId, type: 'IfcOpeningElement', Name: name });
    return openingId;
  }

  // ============================================================================
  // Internal — Property/quantity serialization
  // ============================================================================

  private serializePropertyValue(prop: PropertyDef): string {
    const val = prop.NominalValue;
    if (typeof val === 'string') {
      const typeName = prop.Type ?? 'IfcLabel';
      return `${typeName.toUpperCase()}('${esc(val)}')`;
    }
    if (typeof val === 'number') {
      const typeName = prop.Type ?? (Number.isInteger(val) ? 'IfcInteger' : 'IfcReal');
      if (typeName === 'IfcInteger') {
        return `IFCINTEGER(${Math.round(val)})`;
      }
      return `IFCREAL(${num(val)})`;
    }
    if (typeof val === 'boolean') {
      return `IFCBOOLEAN(${val ? '.T.' : '.F.'})`;
    }
    return '$';
  }

  private quantityValueField(qty: QuantityDef): string {
    switch (qty.Kind) {
      case 'IfcQuantityLength':
      case 'IfcQuantityArea':
      case 'IfcQuantityVolume':
      case 'IfcQuantityWeight':
        return `$,${num(qty.Value)}`;
      case 'IfcQuantityCount':
        return `$,${Math.round(qty.Value)}`;
      default:
        return `$,${num(qty.Value)}`;
    }
  }

  // ============================================================================
  // Internal — Relationship finalization
  // ============================================================================

  private finalizeRelationships(): void {
    this.addIfcRelAggregates(this.projectId, [this.siteId]);
    this.addIfcRelAggregates(this.siteId, [this.buildingId]);

    if (this.storeyIds.length > 0) {
      this.addIfcRelAggregates(this.buildingId, this.storeyIds);
    }

    for (const [storeyId, elementIds] of this.storeyElements) {
      if (elementIds.length > 0) {
        this.addIfcRelContainedInSpatialStructure(storeyId, elementIds);
      }
    }
  }

  private addIfcRelAggregates(relatingId: number, relatedIds: number[]): void {
    const relId = this.id();
    const globalId = newGlobalId();
    const refs = relatedIds.map(id => `#${id}`).join(',');
    this.line(relId, 'IFCRELAGGREGATES',
      `'${globalId}',#${this.ownerHistoryId},$,$,#${relatingId},(${refs})`);
  }

  private addIfcRelContainedInSpatialStructure(storeyId: number, elementIds: number[]): void {
    const relId = this.id();
    const globalId = newGlobalId();
    const refs = elementIds.map(id => `#${id}`).join(',');
    this.line(relId, 'IFCRELCONTAINEDINSPATIALSTRUCTURE',
      `'${globalId}',#${this.ownerHistoryId},$,$,(${refs}),#${storeyId}`);
  }

  // ============================================================================
  // Internal — Utilities
  // ============================================================================

  private id(): number {
    return this.nextId++;
  }

  private line(id: number, type: string, args: string): void {
    this.lines.push(stepLine(id, type, args));
  }

  private trackElement(storeyId: number, elementId: number): void {
    const elements = this.storeyElements.get(storeyId);
    if (!elements) {
      throw new Error(`Unknown storeyId #${storeyId} — call addIfcBuildingStorey() first`);
    }
    elements.push(elementId);
  }

  /** Compute a stable RefDirection perpendicular to a given Axis */
  private computeRefDirection(axis: Point3D): Point3D {
    const up: Point3D = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = vecCross(up, axis);
    return vecNorm(cross);
  }
}
