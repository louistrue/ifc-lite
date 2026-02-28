/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IfcCreator — build valid IFC4 STEP files from scratch.
 *
 * Produces a complete IFC file with spatial structure, building elements
 * (walls, slabs, columns, beams, stairs, roofs), openings, and
 * attached property sets / element quantities.
 *
 * Usage:
 * ```ts
 * const creator = new IfcCreator({ Name: 'My Project' });
 * const storey = creator.addStorey({ Name: 'Ground Floor', Elevation: 0 });
 * creator.addWall(storey, { Start: [0,0,0], End: [5,0,0], Thickness: 0.2, Height: 3 });
 * const ifc = creator.toIfc();
 * ```
 */

import type {
  Point3D, Point2D, Placement3D, RectangularOpening,
  WallParams, SlabParams, ColumnParams, BeamParams, StairParams, RoofParams,
  ProjectParams, SiteParams, BuildingParams, StoreyParams,
  PropertySetDef, PropertyDef, QuantitySetDef, QuantityDef,
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

/** Serialize a number in STEP format (always with decimal point) */
function num(v: number): string {
  const s = v.toString();
  return s.includes('.') ? s : s + '.';
}

/** Vector length */
function vecLen(v: Point3D): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Normalize vector */
function vecNorm(v: Point3D): Point3D {
  const len = vecLen(v);
  if (len === 0) return [1, 0, 0];
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
  addStorey(params: StoreyParams): number {
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

  /** Create a wall from start/end axis, thickness, and height. */
  addWall(storeyId: number, params: WallParams): number {
    // Compute wall direction and perpendicular
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const wallLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    // Wall origin is at Start, offset by half-thickness perpendicular
    const perp: Point3D = vecNorm(vecCross(dir, [0, 0, 1]));

    // Placement at start point
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      RefDirection: dir,
    });

    // Rectangle profile (thickness x wallLen in local XY, extruded along Z)
    const profileId = this.addRectangleProfile(wallLen, params.Thickness);

    // Extruded solid along Z by Height
    const solidId = this.addExtrudedAreaSolid(profileId, params.Height);

    // Shape representation
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    // Wall entity
    const wallId = this.id();
    const globalId = newGlobalId();
    const name = params.Name ?? 'Wall';
    const desc = params.Description ? `'${esc(params.Description)}'` : '$';
    const objType = params.ObjectType ? `'${esc(params.ObjectType)}'` : '$';
    const tag = params.Tag ? `'${esc(params.Tag)}'` : '$';

    this.line(wallId, 'IFCWALL',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',${desc},${objType},#${placementId},#${prodShapeId},${tag},.STANDARD.`);

    this.trackElement(storeyId, wallId);
    this.entities.push({ expressId: wallId, type: 'IfcWall', Name: name });

    // Add openings
    if (params.Openings) {
      for (const opening of params.Openings) {
        this.addOpening(wallId, placementId, opening);
      }
    }

    return wallId;
  }

  /** Create a slab (floor/ceiling). */
  addSlab(storeyId: number, params: SlabParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    let profileId: number;
    if (params.Profile && params.Profile.length >= 3) {
      profileId = this.addArbitraryProfile(params.Profile);
    } else {
      const w = params.Width ?? 5;
      const d = params.Depth ?? 5;
      profileId = this.addRectangleProfile(w, d);
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

    this.trackElement(storeyId, slabId);
    this.entities.push({ expressId: slabId, type: 'IfcSlab', Name: name });

    if (params.Openings) {
      for (const opening of params.Openings) {
        this.addOpening(slabId, placementId, opening);
      }
    }

    return slabId;
  }

  /** Create a column. */
  addColumn(storeyId: number, params: ColumnParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

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

    this.trackElement(storeyId, colId);
    this.entities.push({ expressId: colId, type: 'IfcColumn', Name: name });
    return colId;
  }

  /** Create a beam between two points. */
  addBeam(storeyId: number, params: BeamParams): number {
    const dx = params.End[0] - params.Start[0];
    const dy = params.End[1] - params.Start[1];
    const dz = params.End[2] - params.Start[2];
    const beamLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir: Point3D = vecNorm([dx, dy, dz]);

    // Beam is extruded along its length (local X), cross-section in YZ
    // We orient the local Z to point along the beam axis
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Start,
      Axis: dir,
      RefDirection: this.computeRefDirection(dir),
    });

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

    this.trackElement(storeyId, beamId);
    this.entities.push({ expressId: beamId, type: 'IfcBeam', Name: name });
    return beamId;
  }

  /** Create a simplified straight-run stair. */
  addStair(storeyId: number, params: StairParams): number {
    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
    });

    // Build stair geometry as a series of step extrusions combined via IfcShapeRepresentation
    const stepSolids: number[] = [];
    const direction = params.Direction ?? 0;
    const cosD = Math.cos(direction);
    const sinD = Math.sin(direction);

    for (let i = 0; i < params.NumberOfRisers; i++) {
      // Each step: a rectangle at the right height, extruded up by RiserHeight
      const stepX = i * params.TreadLength;
      const stepZ = i * params.RiserHeight;

      const stepOriginId = this.addCartesianPoint([
        stepX * cosD,
        stepX * sinD,
        stepZ,
      ]);
      const stepAxis2Id = this.addAxis2Placement3D(stepOriginId);

      const profileId = this.addRectangleProfile(params.TreadLength, params.Width);
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

    this.trackElement(storeyId, stairId);
    this.entities.push({ expressId: stairId, type: 'IfcStair', Name: name });
    return stairId;
  }

  /** Create a roof slab with optional slope. */
  addRoof(storeyId: number, params: RoofParams): number {
    const slope = params.Slope ?? 0;

    // If slope > 0, tilt the local Z axis
    let axis: Point3D = [0, 0, 1];
    let refDir: Point3D = [1, 0, 0];
    if (slope > 0) {
      // Rotate around Y axis by slope angle
      axis = [Math.sin(slope), 0, Math.cos(slope)];
      refDir = [Math.cos(slope), 0, -Math.sin(slope)];
    }

    const placementId = this.addLocalPlacement(this.worldPlacementId, {
      Location: params.Position,
      Axis: axis,
      RefDirection: refDir,
    });

    const profileId = this.addRectangleProfile(params.Width, params.Depth);
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

    this.trackElement(storeyId, roofId);
    this.entities.push({ expressId: roofId, type: 'IfcRoof', Name: name });
    return roofId;
  }

  // ============================================================================
  // Public API — Properties & Quantities
  // ============================================================================

  /** Attach a property set to an element */
  addPropertySet(elementId: number, pset: PropertySetDef): number {
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

    // IfcRelDefinesByProperties
    const relId = this.id();
    const relGlobalId = newGlobalId();
    this.line(relId, 'IFCRELDEFINESBYPROPERTIES',
      `'${relGlobalId}',#${this.ownerHistoryId},$,$,(#${elementId}),#${psetId}`);

    return psetId;
  }

  /** Attach element quantities to an element */
  addQuantitySet(elementId: number, qset: QuantitySetDef): number {
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

    // IfcRelDefinesByProperties to link quantity set
    const relId = this.id();
    const relGlobalId = newGlobalId();
    this.line(relId, 'IFCRELDEFINESBYPROPERTIES',
      `'${relGlobalId}',#${this.ownerHistoryId},$,$,(#${elementId}),#${qsetId}`);

    return qsetId;
  }

  // ============================================================================
  // Public API — Export
  // ============================================================================

  /** Generate the complete IFC STEP file */
  toIfc(): CreateResult {
    // Finalize spatial structure relationships
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
FILE_DESCRIPTION('${desc}','2;1');
FILE_NAME('${filename}','${now}',('${esc(author)}'),('${esc(org)}'),'${app}','${app}','');
FILE_SCHEMA(('${this.schema}'));
ENDSEC;
`;
  }

  // ============================================================================
  // Internal — Preamble (project, site, building, contexts, units)
  // ============================================================================

  private buildPreamble(params: ProjectParams): void {
    // IfcPerson, IfcOrganization, IfcPersonAndOrganization, IfcApplication, IfcOwnerHistory
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
    // SI units
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

  private addLocalPlacement(relativeTo: number, placement: Placement3D): number {
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

  private addRectangleProfile(xDim: number, yDim: number): number {
    const profileOriginId = this.addCartesianPoint2D([0, 0]);
    const profileAxis2dId = this.id();
    this.line(profileAxis2dId, 'IFCAXIS2PLACEMENT2D', `#${profileOriginId},$`);

    const id = this.id();
    this.line(id, 'IFCRECTANGLEPROFILEDEF', `.AREA.,$,#${profileAxis2dId},${num(xDim)},${num(yDim)}`);
    return id;
  }

  private addArbitraryProfile(points: Point2D[]): number {
    const pointIds = points.map(p => this.addCartesianPoint2D(p));
    // Close the polyline
    if (points.length > 0) {
      pointIds.push(pointIds[0]);
    }
    const refs = pointIds.map(id => `#${id}`).join(',');
    const polylineId = this.id();
    this.line(polylineId, 'IFCPOLYLINE', `(${refs})`);

    const id = this.id();
    this.line(id, 'IFCARBITRARYCLOSEDPROFILEDEF', `.AREA.,$,#${polylineId}`);
    return id;
  }

  private addExtrudedAreaSolid(profileId: number, depth: number): number {
    const originId = this.addCartesianPoint([0, 0, 0]);
    const axis2Id = this.addAxis2Placement3D(originId);

    const id = this.id();
    this.line(id, 'IFCEXTRUDEDAREASOLID',
      `#${profileId},#${axis2Id},#${this.dirZ},${num(depth)}`);
    return id;
  }

  private addShapeRepresentation(repType: string, itemIds: number[]): number {
    const contextRef = repType === 'Axis' ? this.subContextAxis : this.subContextBody;
    const refs = itemIds.map(id => `#${id}`).join(',');
    const repId = this.id();
    const repIdentifier = repType === 'Axis' ? 'Axis' : 'Body';
    const repTypeName = itemIds.length > 1 ? 'SolidModel' : 'SweptSolid';
    this.line(repId, 'IFCSHAPEREPRESENTATION',
      `#${contextRef},'${repIdentifier}','${repTypeName}',(${refs})`);
    return repId;
  }

  private addProductDefinitionShape(repIds: number[]): number {
    const refs = repIds.map(id => `#${id}`).join(',');
    const id = this.id();
    this.line(id, 'IFCPRODUCTDEFINITIONSHAPE', `$,$,(${refs})`);
    return id;
  }

  private addOpening(hostId: number, hostPlacementId: number, opening: RectangularOpening): number {
    // Opening placement relative to host
    const placementId = this.addLocalPlacement(hostPlacementId, {
      Location: opening.Position,
    });

    const profileId = this.addRectangleProfile(opening.Width, opening.Height);
    const solidId = this.addExtrudedAreaSolid(profileId, 10); // Extrude through the element
    const shapeId = this.addShapeRepresentation('Body', [solidId]);
    const prodShapeId = this.addProductDefinitionShape([shapeId]);

    const openingId = this.id();
    const globalId = newGlobalId();
    const name = opening.Name ?? 'Opening';
    this.line(openingId, 'IFCOPENINGELEMENT',
      `'${globalId}',#${this.ownerHistoryId},'${esc(name)}',$,$,#${placementId},#${prodShapeId},$,.OPENING.`);

    // IfcRelVoidsElement
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
    // IfcQuantityLength(Name, Description, Unit, LengthValue)
    // IfcQuantityArea(Name, Description, Unit, AreaValue)
    // etc — we already have Name in the caller, so just the value fields:
    // Actually the full entity is: Kind(Name, Description, Unit, <Value>)
    // But our line() already includes the Name. Let's return the remaining args.
    switch (qty.Kind) {
      case 'IfcQuantityLength':
        return `$,${num(qty.Value)}`;
      case 'IfcQuantityArea':
        return `$,${num(qty.Value)}`;
      case 'IfcQuantityVolume':
        return `$,${num(qty.Value)}`;
      case 'IfcQuantityCount':
        return `$,${Math.round(qty.Value)}.`;
      case 'IfcQuantityWeight':
        return `$,${num(qty.Value)}`;
      default:
        return `$,${num(qty.Value)}`;
    }
  }

  // ============================================================================
  // Internal — Relationship finalization
  // ============================================================================

  private finalizeRelationships(): void {
    // IfcRelAggregates: Project → Site
    this.addRelAggregates(this.projectId, [this.siteId]);

    // IfcRelAggregates: Site → Building
    this.addRelAggregates(this.siteId, [this.buildingId]);

    // IfcRelAggregates: Building → Storeys
    if (this.storeyIds.length > 0) {
      this.addRelAggregates(this.buildingId, this.storeyIds);
    }

    // IfcRelContainedInSpatialStructure: Storey → Elements
    for (const [storeyId, elementIds] of this.storeyElements) {
      if (elementIds.length > 0) {
        this.addRelContainedInSpatialStructure(storeyId, elementIds);
      }
    }
  }

  private addRelAggregates(relatingId: number, relatedIds: number[]): void {
    const relId = this.id();
    const globalId = newGlobalId();
    const refs = relatedIds.map(id => `#${id}`).join(',');
    this.line(relId, 'IFCRELAGGREGATES',
      `'${globalId}',#${this.ownerHistoryId},$,$,#${relatingId},(${refs})`);
  }

  private addRelContainedInSpatialStructure(storeyId: number, elementIds: number[]): void {
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
    if (elements) {
      elements.push(elementId);
    }
  }

  /** Compute a stable RefDirection perpendicular to a given Axis */
  private computeRefDirection(axis: Point3D): Point3D {
    // Pick a reference vector not parallel to axis
    const up: Point3D = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = vecCross(up, axis);
    return vecNorm(cross);
  }
}
