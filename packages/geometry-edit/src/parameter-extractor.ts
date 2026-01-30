/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Parameter Extractor for IFC Entities
 *
 * Extracts editable geometry parameters from IFC entities.
 * Supports extrusions, profiles, placements, and boolean operations.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import {
  type GeometryParameter,
  type EditableEntity,
  type Point2D,
  type Profile2D,
  type Constraint,
  type AABB,
  ParameterType,
  ConstraintType,
  EditMode,
  EditableIfcType,
  ProfileType,
  getRecommendedEditMode,
} from './types.js';

/**
 * IFC entity reference from parser
 */
interface EntityRef {
  type: string;
  byteOffset: number;
  byteLength: number;
}

/**
 * Parameter extractor for IFC geometry
 */
export class ParameterExtractor {
  private dataStore: IfcDataStore;
  private modelId: string;
  private decoder: TextDecoder;
  private idOffset: number;

  constructor(dataStore: IfcDataStore, modelId: string, idOffset: number = 0) {
    this.dataStore = dataStore;
    this.modelId = modelId;
    this.decoder = new TextDecoder();
    this.idOffset = idOffset;
  }

  /**
   * Extract editable entity from an IFC entity
   * For product entities (IfcWall, IfcSlab, etc.), navigates to the geometry representation
   */
  extractEditableEntity(
    expressId: number,
    meshData: MeshData
  ): EditableEntity | null {
    const entityRef = this.dataStore.entityIndex.byId.get(expressId);
    if (!entityRef) return null;

    const ifcType = entityRef.type.toUpperCase();
    let editMode = getRecommendedEditMode(ifcType);
    let geometryExpressId = expressId;
    let geometryType = ifcType;

    // If this is a product type (not directly editable), try to find its geometry representation
    if (editMode === EditMode.None) {
      const geomRef = this.findGeometryRepresentation(expressId);
      if (geomRef) {
        geometryExpressId = geomRef.expressId;
        geometryType = geomRef.type.toUpperCase();
        editMode = getRecommendedEditMode(geometryType);
        console.log(`[ParameterExtractor] Found geometry for ${ifcType}: ${geometryType} (#${geometryExpressId})`);
      }
    }

    if (editMode === EditMode.None) {
      console.log(`[ParameterExtractor] No editable geometry found for ${ifcType} (#${expressId})`);
      return null;
    }

    const parameters =
      editMode === EditMode.Parametric
        ? this.extractParameters(geometryExpressId, geometryType)
        : [];

    const bounds = this.calculateBounds(meshData);

    return {
      expressId, // Keep original product expressId for selection
      modelId: this.modelId,
      globalId: expressId + this.idOffset,
      ifcType: geometryType, // Use geometry type for editing
      editMode,
      parameters,
      meshData,
      bounds,
      isEditing: false,
    };
  }

  /**
   * Find the geometry representation for a product entity
   * Navigates: IfcProduct → IfcProductDefinitionShape → IfcShapeRepresentation → geometry item
   */
  private findGeometryRepresentation(expressId: number): { expressId: number; type: string } | null {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return null;

    // Look for Representation reference in product entity
    // Products have pattern like: IFCWALL(...,#representationId,...)
    // The Representation is typically the 7th or 8th attribute in IfcProduct subtypes

    // Find all # references in the entity
    const refs = entityText.match(/#(\d+)/g);
    if (!refs) return null;

    for (const ref of refs) {
      const refId = parseInt(ref.substring(1), 10);
      const refType = this.getEntityType(refId);

      if (refType?.toUpperCase() === 'IFCPRODUCTDEFINITIONSHAPE') {
        // Found the product definition shape, now find shape representations
        return this.findGeometryInProductDefinitionShape(refId);
      }
    }

    return null;
  }

  /**
   * Find geometry items in IfcProductDefinitionShape
   */
  private findGeometryInProductDefinitionShape(shapeId: number): { expressId: number; type: string } | null {
    const shapeText = this.getEntityText(shapeId);
    if (!shapeText) return null;

    // IfcProductDefinitionShape has Representations as 3rd attribute (list of IfcShapeRepresentation)
    // Pattern: IFCPRODUCTDEFINITIONSHAPE($,$,(#rep1,#rep2,...))
    const listMatch = shapeText.match(/\(\s*(#[\d,\s#]+)\s*\)\s*\)/);
    if (!listMatch) return null;

    const repRefs = listMatch[1].match(/#(\d+)/g);
    if (!repRefs) return null;

    // Check each shape representation for 'Body' or 'SweptSolid' type geometry
    for (const repRef of repRefs) {
      const repId = parseInt(repRef.substring(1), 10);
      const result = this.findGeometryInShapeRepresentation(repId);
      if (result) return result;
    }

    return null;
  }

  /**
   * Find geometry items in IfcShapeRepresentation
   */
  private findGeometryInShapeRepresentation(repId: number): { expressId: number; type: string } | null {
    const repText = this.getEntityText(repId);
    if (!repText) return null;

    // IfcShapeRepresentation: (Context, RepId, RepType, Items)
    // Look for 'Body' or geometry-defining representations
    const upperText = repText.toUpperCase();
    const isBodyRep = upperText.includes("'BODY'") ||
                      upperText.includes("'SWEPTSOLID'") ||
                      upperText.includes("'BREP'") ||
                      upperText.includes("'CLIPPING'") ||
                      upperText.includes("'TESSELLATION'");

    if (!isBodyRep) return null;

    // Find Items list (last parenthesized group with # refs)
    const itemsMatch = repText.match(/\(\s*(#[\d,\s#]+)\s*\)\s*\)/);
    if (!itemsMatch) return null;

    const itemRefs = itemsMatch[1].match(/#(\d+)/g);
    if (!itemRefs) return null;

    // Check each item for editable geometry types
    for (const itemRef of itemRefs) {
      const itemId = parseInt(itemRef.substring(1), 10);
      const itemType = this.getEntityType(itemId);
      if (!itemType) continue;

      const editMode = getRecommendedEditMode(itemType.toUpperCase());
      if (editMode !== EditMode.None) {
        return { expressId: itemId, type: itemType };
      }

      // If it's a boolean result, check its operands
      if (itemType.toUpperCase() === 'IFCBOOLEANCLIPPINGRESULT' ||
          itemType.toUpperCase() === 'IFCBOOLEANRESULT') {
        const booleanGeom = this.findGeometryInBoolean(itemId);
        if (booleanGeom) return booleanGeom;
      }
    }

    return null;
  }

  /**
   * Find editable geometry in boolean operations (first operand is usually the main shape)
   */
  private findGeometryInBoolean(boolId: number): { expressId: number; type: string } | null {
    const boolText = this.getEntityText(boolId);
    if (!boolText) return null;

    // Boolean operations: (Operator, FirstOperand, SecondOperand)
    const match = boolText.match(/#(\d+)/);
    if (!match) return null;

    // First # ref after operator is typically FirstOperand
    const firstOpId = parseInt(match[1], 10);
    const firstOpType = this.getEntityType(firstOpId);
    if (!firstOpType) return null;

    const editMode = getRecommendedEditMode(firstOpType.toUpperCase());
    if (editMode !== EditMode.None) {
      return { expressId: firstOpId, type: firstOpType };
    }

    // Recurse if first operand is also a boolean
    if (firstOpType.toUpperCase().includes('BOOLEAN')) {
      return this.findGeometryInBoolean(firstOpId);
    }

    return null;
  }

  /**
   * Extract parameters from an IFC entity
   */
  extractParameters(expressId: number, ifcType: string): GeometryParameter[] {
    const normalizedType = ifcType.toUpperCase();

    switch (normalizedType) {
      case EditableIfcType.IfcExtrudedAreaSolid:
        return this.extractExtrusionParameters(expressId);

      case EditableIfcType.IfcRectangleProfileDef:
        return this.extractRectangleProfileParameters(expressId);

      case EditableIfcType.IfcCircleProfileDef:
        return this.extractCircleProfileParameters(expressId);

      case EditableIfcType.IfcEllipseProfileDef:
        return this.extractEllipseProfileParameters(expressId);

      case EditableIfcType.IfcIShapeProfileDef:
        return this.extractIShapeProfileParameters(expressId);

      case EditableIfcType.IfcArbitraryClosedProfileDef:
        return this.extractArbitraryProfileParameters(expressId);

      case EditableIfcType.IfcBooleanClippingResult:
        return this.extractBooleanParameters(expressId);

      default:
        return [];
    }
  }

  /**
   * Extract parameters from IfcExtrudedAreaSolid
   */
  private extractExtrusionParameters(expressId: number): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCEXTRUDEDAREASOLID(SweptArea, Position, ExtrudedDirection, Depth)
    const match = entityText.match(
      /IFCEXTRUDEDAREASOLID\s*\(\s*#(\d+)\s*,\s*#?(\d+|[\$])\s*,\s*#?(\d+|[\$])\s*,\s*([\d.E+-]+)\s*\)/i
    );

    if (match) {
      const sweptAreaId = parseInt(match[1], 10);
      const depth = parseFloat(match[4]);

      // Depth parameter
      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'Depth',
        displayName: 'Extrusion Depth',
        type: ParameterType.Number,
        value: depth,
        originalValue: depth,
        unit: 'm',
        constraints: [
          { type: ConstraintType.Positive, enabled: true },
          { type: ConstraintType.MinValue, value: 0.001, enabled: true },
        ],
        editable: true,
        ifcAttributePath: 'Depth',
      });

      // Extract direction if present
      const directionId = match[3] !== '$' ? parseInt(match[3], 10) : null;
      if (directionId) {
        const direction = this.extractDirection(directionId);
        if (direction) {
          params.push({
            entityId: expressId,
            modelId: this.modelId,
            path: 'ExtrudedDirection',
            displayName: 'Extrusion Direction',
            type: ParameterType.Vec3,
            value: direction,
            originalValue: { ...direction },
            constraints: [],
            editable: true,
            ifcAttributePath: 'ExtrudedDirection',
          });
        }
      }

      // Extract SweptArea (profile) parameters
      const profileParams = this.extractParameters(
        sweptAreaId,
        this.getEntityType(sweptAreaId) || ''
      );
      params.push(
        ...profileParams.map((p) => ({
          ...p,
          path: `SweptArea.${p.path}`,
          ifcAttributePath: `SweptArea.${p.ifcAttributePath}`,
        }))
      );
    }

    return params;
  }

  /**
   * Extract parameters from IfcRectangleProfileDef
   */
  private extractRectangleProfileParameters(
    expressId: number
  ): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCRECTANGLEPROFILEDEF(ProfileType, ProfileName, Position, XDim, YDim)
    const match = entityText.match(
      /IFCRECTANGLEPROFILEDEF\s*\([^,]*,\s*[^,]*,\s*[^,]*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*\)/i
    );

    if (match) {
      const xDim = parseFloat(match[1]);
      const yDim = parseFloat(match[2]);

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'XDim',
        displayName: 'Width',
        type: ParameterType.Number,
        value: xDim,
        originalValue: xDim,
        unit: 'm',
        constraints: [
          { type: ConstraintType.Positive, enabled: true },
          { type: ConstraintType.MinValue, value: 0.001, enabled: true },
        ],
        editable: true,
        ifcAttributePath: 'XDim',
      });

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'YDim',
        displayName: 'Height',
        type: ParameterType.Number,
        value: yDim,
        originalValue: yDim,
        unit: 'm',
        constraints: [
          { type: ConstraintType.Positive, enabled: true },
          { type: ConstraintType.MinValue, value: 0.001, enabled: true },
        ],
        editable: true,
        ifcAttributePath: 'YDim',
      });
    }

    return params;
  }

  /**
   * Extract parameters from IfcCircleProfileDef
   */
  private extractCircleProfileParameters(
    expressId: number
  ): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCCIRCLEPROFILEDEF(ProfileType, ProfileName, Position, Radius)
    const match = entityText.match(
      /IFCCIRCLEPROFILEDEF\s*\([^,]*,\s*[^,]*,\s*[^,]*,\s*([\d.E+-]+)\s*\)/i
    );

    if (match) {
      const radius = parseFloat(match[1]);

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'Radius',
        displayName: 'Radius',
        type: ParameterType.Number,
        value: radius,
        originalValue: radius,
        unit: 'm',
        constraints: [
          { type: ConstraintType.Positive, enabled: true },
          { type: ConstraintType.MinValue, value: 0.001, enabled: true },
        ],
        editable: true,
        ifcAttributePath: 'Radius',
      });
    }

    return params;
  }

  /**
   * Extract parameters from IfcEllipseProfileDef
   */
  private extractEllipseProfileParameters(
    expressId: number
  ): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCELLIPSEPROFILEDEF(ProfileType, ProfileName, Position, SemiAxis1, SemiAxis2)
    const match = entityText.match(
      /IFCELLIPSEPROFILEDEF\s*\([^,]*,\s*[^,]*,\s*[^,]*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*\)/i
    );

    if (match) {
      const semiAxis1 = parseFloat(match[1]);
      const semiAxis2 = parseFloat(match[2]);

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'SemiAxis1',
        displayName: 'Semi-Axis 1',
        type: ParameterType.Number,
        value: semiAxis1,
        originalValue: semiAxis1,
        unit: 'm',
        constraints: [
          { type: ConstraintType.Positive, enabled: true },
          { type: ConstraintType.MinValue, value: 0.001, enabled: true },
        ],
        editable: true,
        ifcAttributePath: 'SemiAxis1',
      });

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'SemiAxis2',
        displayName: 'Semi-Axis 2',
        type: ParameterType.Number,
        value: semiAxis2,
        originalValue: semiAxis2,
        unit: 'm',
        constraints: [
          { type: ConstraintType.Positive, enabled: true },
          { type: ConstraintType.MinValue, value: 0.001, enabled: true },
        ],
        editable: true,
        ifcAttributePath: 'SemiAxis2',
      });
    }

    return params;
  }

  /**
   * Extract parameters from IfcIShapeProfileDef
   */
  private extractIShapeProfileParameters(
    expressId: number
  ): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCISHAPEPROFILEDEF(ProfileType, ProfileName, Position, OverallWidth, OverallDepth, WebThickness, FlangeThickness, FilletRadius, ...)
    const match = entityText.match(
      /IFCISHAPEPROFILEDEF\s*\([^,]*,\s*[^,]*,\s*[^,]*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)/i
    );

    if (match) {
      const overallWidth = parseFloat(match[1]);
      const overallDepth = parseFloat(match[2]);
      const webThickness = parseFloat(match[3]);
      const flangeThickness = parseFloat(match[4]);

      const positiveConstraint: Constraint = {
        type: ConstraintType.Positive,
        enabled: true,
      };
      const minConstraint: Constraint = {
        type: ConstraintType.MinValue,
        value: 0.001,
        enabled: true,
      };

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'OverallWidth',
        displayName: 'Overall Width',
        type: ParameterType.Number,
        value: overallWidth,
        originalValue: overallWidth,
        unit: 'm',
        constraints: [positiveConstraint, minConstraint],
        editable: true,
        ifcAttributePath: 'OverallWidth',
      });

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'OverallDepth',
        displayName: 'Overall Depth',
        type: ParameterType.Number,
        value: overallDepth,
        originalValue: overallDepth,
        unit: 'm',
        constraints: [positiveConstraint, minConstraint],
        editable: true,
        ifcAttributePath: 'OverallDepth',
      });

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'WebThickness',
        displayName: 'Web Thickness',
        type: ParameterType.Number,
        value: webThickness,
        originalValue: webThickness,
        unit: 'm',
        constraints: [positiveConstraint, minConstraint],
        editable: true,
        ifcAttributePath: 'WebThickness',
      });

      params.push({
        entityId: expressId,
        modelId: this.modelId,
        path: 'FlangeThickness',
        displayName: 'Flange Thickness',
        type: ParameterType.Number,
        value: flangeThickness,
        originalValue: flangeThickness,
        unit: 'm',
        constraints: [positiveConstraint, minConstraint],
        editable: true,
        ifcAttributePath: 'FlangeThickness',
      });
    }

    return params;
  }

  /**
   * Extract parameters from IfcArbitraryClosedProfileDef
   */
  private extractArbitraryProfileParameters(
    expressId: number
  ): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCARBITRARYCLOSEDPROFILEDEF(ProfileType, ProfileName, OuterCurve)
    const match = entityText.match(
      /IFCARBITRARYCLOSEDPROFILEDEF\s*\([^,]*,\s*[^,]*,\s*#(\d+)\s*\)/i
    );

    if (match) {
      const outerCurveId = parseInt(match[1], 10);
      const points = this.extractCurvePoints(outerCurveId);

      if (points.length > 0) {
        params.push({
          entityId: expressId,
          modelId: this.modelId,
          path: 'OuterCurve',
          displayName: 'Profile Points',
          type: ParameterType.Profile,
          value: points,
          originalValue: points.map((p) => ({ ...p })),
          constraints: [{ type: ConstraintType.ClosedProfile, enabled: true }],
          editable: true,
          ifcAttributePath: 'OuterCurve',
        });
      }
    }

    return params;
  }

  /**
   * Extract parameters from IfcBooleanClippingResult
   */
  private extractBooleanParameters(expressId: number): GeometryParameter[] {
    // Boolean operations are complex - expose position of second operand
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCBOOLEANCLIPPINGRESULT(Operator, FirstOperand, SecondOperand)
    const match = entityText.match(
      /IFCBOOLEAN(?:CLIPPING)?RESULT\s*\([^,]*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/i
    );

    if (match) {
      const secondOperandId = parseInt(match[2], 10);
      const secondOperandType = this.getEntityType(secondOperandId);

      // If second operand is a half-space, extract plane parameters
      if (
        secondOperandType?.toUpperCase().includes('HALFSPACESOLID') ||
        secondOperandType?.toUpperCase().includes('BOXEDHALFSPACE')
      ) {
        const planeParams = this.extractHalfSpaceParameters(secondOperandId);
        params.push(
          ...planeParams.map((p) => ({
            ...p,
            path: `SecondOperand.${p.path}`,
            ifcAttributePath: `SecondOperand.${p.ifcAttributePath}`,
          }))
        );
      }
    }

    return params;
  }

  /**
   * Extract parameters from IfcHalfSpaceSolid
   */
  private extractHalfSpaceParameters(expressId: number): GeometryParameter[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const params: GeometryParameter[] = [];

    // Parse: IFCHALFSPACESOLID(BaseSurface, AgreementFlag)
    // or IFCPOLYGONALBOUNDEDHALFSPACE(BaseSurface, AgreementFlag, Position, Boundary)
    const match = entityText.match(
      /IFC(?:POLYGONALBOUNDED)?HALFSPACESOLID\s*\(\s*#(\d+)/i
    );

    if (match) {
      const baseSurfaceId = parseInt(match[1], 10);
      const surfaceType = this.getEntityType(baseSurfaceId);

      // If it's a plane, extract plane position/direction
      if (surfaceType?.toUpperCase() === 'IFCPLANE') {
        const planeText = this.getEntityText(baseSurfaceId);
        const planeMatch = planeText?.match(
          /IFCPLANE\s*\(\s*#(\d+)\s*\)/i
        );

        if (planeMatch) {
          const positionId = parseInt(planeMatch[1], 10);
          const position = this.extractAxis2Placement3D(positionId);

          if (position) {
            params.push({
              entityId: expressId,
              modelId: this.modelId,
              path: 'BaseSurface.Position.Location',
              displayName: 'Plane Origin',
              type: ParameterType.Vec3,
              value: position.location,
              originalValue: { ...position.location },
              unit: 'm',
              constraints: [],
              editable: true,
              ifcAttributePath: 'BaseSurface.Position.Location',
            });

            if (position.axis) {
              params.push({
                entityId: expressId,
                modelId: this.modelId,
                path: 'BaseSurface.Position.Axis',
                displayName: 'Plane Normal',
                type: ParameterType.Vec3,
                value: position.axis,
                originalValue: { ...position.axis },
                constraints: [],
                editable: true,
                ifcAttributePath: 'BaseSurface.Position.Axis',
              });
            }
          }
        }
      }
    }

    return params;
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  /**
   * Get entity text from source buffer
   */
  private getEntityText(expressId: number): string | null {
    const entityRef = this.dataStore.entityIndex.byId.get(expressId);
    if (!entityRef || !this.dataStore.source) return null;

    return this.decoder.decode(
      this.dataStore.source.subarray(
        entityRef.byteOffset,
        entityRef.byteOffset + entityRef.byteLength
      )
    );
  }

  /**
   * Get entity type from express ID
   */
  private getEntityType(expressId: number): string | null {
    const entityRef = this.dataStore.entityIndex.byId.get(expressId);
    return entityRef?.type || null;
  }

  /**
   * Extract direction from IfcDirection
   */
  private extractDirection(expressId: number): Vec3 | null {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return null;

    // Parse: IFCDIRECTION((x, y, z))
    const match = entityText.match(
      /IFCDIRECTION\s*\(\s*\(\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*\)\s*\)/i
    );

    if (match) {
      return {
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        z: parseFloat(match[3]),
      };
    }

    // 2D direction
    const match2D = entityText.match(
      /IFCDIRECTION\s*\(\s*\(\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*\)\s*\)/i
    );

    if (match2D) {
      return {
        x: parseFloat(match2D[1]),
        y: parseFloat(match2D[2]),
        z: 0,
      };
    }

    return null;
  }

  /**
   * Extract Axis2Placement3D
   */
  private extractAxis2Placement3D(
    expressId: number
  ): { location: Vec3; axis?: Vec3; refDirection?: Vec3 } | null {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return null;

    // Parse: IFCAXIS2PLACEMENT3D(Location, Axis, RefDirection)
    const match = entityText.match(
      /IFCAXIS2PLACEMENT3D\s*\(\s*#(\d+)\s*(?:,\s*#?(\d+|\$))?(?:,\s*#?(\d+|\$))?\s*\)/i
    );

    if (match) {
      const locationId = parseInt(match[1], 10);
      const location = this.extractCartesianPoint(locationId);
      if (!location) return null;

      let axis: Vec3 | undefined;
      let refDirection: Vec3 | undefined;

      if (match[2] && match[2] !== '$') {
        axis = this.extractDirection(parseInt(match[2], 10)) || undefined;
      }

      if (match[3] && match[3] !== '$') {
        refDirection =
          this.extractDirection(parseInt(match[3], 10)) || undefined;
      }

      return { location, axis, refDirection };
    }

    return null;
  }

  /**
   * Extract CartesianPoint
   */
  private extractCartesianPoint(expressId: number): Vec3 | null {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return null;

    // Parse: IFCCARTESIANPOINT((x, y, z))
    const match3D = entityText.match(
      /IFCCARTESIANPOINT\s*\(\s*\(\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*\)\s*\)/i
    );

    if (match3D) {
      return {
        x: parseFloat(match3D[1]),
        y: parseFloat(match3D[2]),
        z: parseFloat(match3D[3]),
      };
    }

    // 2D point
    const match2D = entityText.match(
      /IFCCARTESIANPOINT\s*\(\s*\(\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*\)\s*\)/i
    );

    if (match2D) {
      return {
        x: parseFloat(match2D[1]),
        y: parseFloat(match2D[2]),
        z: 0,
      };
    }

    return null;
  }

  /**
   * Extract points from a curve entity (polyline, composite curve, etc.)
   */
  private extractCurvePoints(expressId: number): Point2D[] {
    const entityType = this.getEntityType(expressId);
    if (!entityType) return [];

    const normalizedType = entityType.toUpperCase();

    if (normalizedType === 'IFCPOLYLINE') {
      return this.extractPolylinePoints(expressId);
    }

    if (normalizedType === 'IFCINDEXEDPOLYCURVE') {
      return this.extractIndexedPolyCurvePoints(expressId);
    }

    if (normalizedType === 'IFCCOMPOSITECURVE') {
      return this.extractCompositeCurvePoints(expressId);
    }

    return [];
  }

  /**
   * Extract points from IfcPolyline
   */
  private extractPolylinePoints(expressId: number): Point2D[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const points: Point2D[] = [];

    // Parse: IFCPOLYLINE((#pt1, #pt2, ...))
    const match = entityText.match(/IFCPOLYLINE\s*\(\s*\(([^)]+)\)\s*\)/i);

    if (match) {
      const pointRefs = match[1].match(/#(\d+)/g);
      if (pointRefs) {
        for (const ref of pointRefs) {
          const ptId = parseInt(ref.slice(1), 10);
          const pt = this.extractCartesianPoint(ptId);
          if (pt) {
            points.push({ x: pt.x, y: pt.y });
          }
        }
      }
    }

    return points;
  }

  /**
   * Extract points from IfcIndexedPolyCurve
   */
  private extractIndexedPolyCurvePoints(expressId: number): Point2D[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    // Parse: IFCINDEXEDPOLYCURVE(#PointListId, Segments, SelfIntersect)
    const match = entityText.match(
      /IFCINDEXEDPOLYCURVE\s*\(\s*#(\d+)/i
    );

    if (match) {
      const pointListId = parseInt(match[1], 10);
      return this.extractCartesianPointList(pointListId);
    }

    return [];
  }

  /**
   * Extract points from IfcCartesianPointList2D/3D
   */
  private extractCartesianPointList(expressId: number): Point2D[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const points: Point2D[] = [];

    // Parse: IFCCARTESIANPOINTLIST2D(((x1,y1),(x2,y2),...))
    const match = entityText.match(
      /IFCCARTESIANPOINTLIST[23]D\s*\(\s*\((.+)\)\s*(?:,|\))/i
    );

    if (match) {
      // Parse nested tuples: (x,y), (x,y), ...
      const tupleMatches = match[1].matchAll(
        /\(\s*([\d.E+-]+)\s*,\s*([\d.E+-]+)\s*(?:,\s*[\d.E+-]+)?\s*\)/gi
      );

      for (const tuple of tupleMatches) {
        points.push({
          x: parseFloat(tuple[1]),
          y: parseFloat(tuple[2]),
        });
      }
    }

    return points;
  }

  /**
   * Extract points from IfcCompositeCurve (concatenate all segments)
   */
  private extractCompositeCurvePoints(expressId: number): Point2D[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    const allPoints: Point2D[] = [];

    // Parse: IFCCOMPOSITECURVE((#seg1, #seg2, ...), SelfIntersect)
    const match = entityText.match(
      /IFCCOMPOSITECURVE\s*\(\s*\(([^)]+)\)/i
    );

    if (match) {
      const segRefs = match[1].match(/#(\d+)/g);
      if (segRefs) {
        for (const ref of segRefs) {
          const segId = parseInt(ref.slice(1), 10);
          const segPoints = this.extractCompositeCurveSegmentPoints(segId);
          allPoints.push(...segPoints);
        }
      }
    }

    return allPoints;
  }

  /**
   * Extract points from IfcCompositeCurveSegment
   */
  private extractCompositeCurveSegmentPoints(expressId: number): Point2D[] {
    const entityText = this.getEntityText(expressId);
    if (!entityText) return [];

    // Parse: IFCCOMPOSITECURVESEGMENT(Transition, SameSense, #ParentCurve)
    const match = entityText.match(
      /IFCCOMPOSITECURVESEGMENT\s*\([^,]*,\s*[^,]*,\s*#(\d+)\s*\)/i
    );

    if (match) {
      const parentCurveId = parseInt(match[1], 10);
      return this.extractCurvePoints(parentCurveId);
    }

    return [];
  }

  /**
   * Calculate bounding box from mesh data
   */
  private calculateBounds(meshData: MeshData): AABB {
    const positions = meshData.positions;

    if (positions.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      };
    }

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }

  /**
   * Extract full Profile2D from entity
   */
  extractProfile2D(expressId: number): Profile2D | null {
    const entityType = this.getEntityType(expressId);
    if (!entityType) return null;

    const normalizedType = entityType.toUpperCase();

    switch (normalizedType) {
      case 'IFCRECTANGLEPROFILEDEF': {
        const params = this.extractRectangleProfileParameters(expressId);
        const width = params.find((p) => p.path === 'XDim')?.value as number;
        const height = params.find((p) => p.path === 'YDim')?.value as number;
        return { type: ProfileType.Rectangle, width, height };
      }

      case 'IFCCIRCLEPROFILEDEF': {
        const params = this.extractCircleProfileParameters(expressId);
        const radius = params.find((p) => p.path === 'Radius')?.value as number;
        return { type: ProfileType.Circle, radius };
      }

      case 'IFCELLIPSEPROFILEDEF': {
        const params = this.extractEllipseProfileParameters(expressId);
        const semiAxis1 = params.find((p) => p.path === 'SemiAxis1')
          ?.value as number;
        const semiAxis2 = params.find((p) => p.path === 'SemiAxis2')
          ?.value as number;
        return { type: ProfileType.Ellipse, semiAxis1, semiAxis2 };
      }

      case 'IFCARBITRARYCLOSEDPROFILEDEF': {
        const params = this.extractArbitraryProfileParameters(expressId);
        const points = params.find((p) => p.path === 'OuterCurve')
          ?.value as Point2D[];
        return { type: ProfileType.Arbitrary, points };
      }

      default:
        return null;
    }
  }
}

/**
 * Create a parameter extractor for a data store
 */
export function createParameterExtractor(
  dataStore: IfcDataStore,
  modelId: string,
  idOffset: number = 0
): ParameterExtractor {
  return new ParameterExtractor(dataStore, modelId, idOffset);
}
