/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/geometry-edit
 *
 * Geometry editing infrastructure for IFC-Lite.
 * Supports parametric editing (IFC parameters) and direct mesh manipulation.
 *
 * Features:
 * - Parameter extraction from IFC entities (extrusions, profiles, etc.)
 * - Live preview with immediate visual feedback
 * - Per-parameter undo/redo
 * - Simple constraint solving (parallel, perpendicular, distance)
 * - Direct mesh editing (vertex, edge, face operations)
 * - IFC4 TriangulatedFaceSet export
 */

// Core types
export {
  // Enums
  ParameterType,
  ConstraintType,
  EditableIfcType,
  EditMode,
  GeometryMutationType,
  ProfileType,
  MeshSelectionType,

  // Interfaces
  type Point2D,
  type Matrix4,
  type AABB,
  type Constraint,
  type GeometryParameter,
  type ParameterValue,
  type EditableEntity,
  type GeometryMutation,
  type MutationResult,
  type ConstraintViolation,
  type Profile2D,
  type ExtrusionDef,
  type MeshSelection,
  type MeshEditOperation,
  type EditSession,

  // Utility functions
  generateMutationId,
  generateSessionId,
  parameterKey,
  isParametricType,
  getRecommendedEditMode,
  cloneVec3,
  clonePoint2D,
  addVec3,
  subtractVec3,
  scaleVec3,
  lengthVec3,
  normalizeVec3,
  dotVec3,
  crossVec3,
  identityMatrix4,
  translationMatrix4,
  scaleMatrix4,
} from './types.js';

// Parameter extractor
export {
  ParameterExtractor,
  createParameterExtractor,
} from './parameter-extractor.js';

// Parameter applicator
export {
  ParameterApplicator,
  createParameterApplicator,
  type ApplicatorConfig,
} from './parameter-applicator.js';

// Geometry mutation manager
export {
  GeometryMutationManager,
  createGeometryMutationManager,
  type MutationEventType,
  type MutationEvent,
  type MutationEventListener,
} from './geometry-mutation.js';

// Mesh editor
export {
  MeshEditor,
  createMeshEditor,
  type MeshEditResult,
  type MeshEditorOptions,
} from './mesh-editor.js';

// Constraint solver
export {
  ConstraintSolver,
  createConstraintSolver,
  snapValue,
  snapVec3ToGrid,
  snapAngle,
  type ConstraintSolveResult,
  type ConstraintReference,
} from './constraint-solver.js';

// IFC4 exporter
export {
  Ifc4GeometryExporter,
  createIfc4Exporter,
  generateGlobalId,
  meshToIfc4,
  type Ifc4ExportOptions,
  type ExportedEntity,
  type Ifc4ExportResult,
} from './ifc-exporter.js';

// ============================================================================
// Convenience Factory
// ============================================================================

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData } from '@ifc-lite/geometry';
import { ParameterExtractor } from './parameter-extractor.js';
import { ParameterApplicator } from './parameter-applicator.js';
import { GeometryMutationManager } from './geometry-mutation.js';
import { MeshEditor } from './mesh-editor.js';
import { ConstraintSolver } from './constraint-solver.js';
import { Ifc4GeometryExporter } from './ifc-exporter.js';
import type { EditableEntity, GeometryParameter, ParameterValue, EditSession } from './types.js';

/**
 * Complete geometry editing context
 */
export interface GeometryEditContext {
  /** Parameter extractor */
  extractor: ParameterExtractor;
  /** Parameter applicator */
  applicator: ParameterApplicator;
  /** Mutation manager */
  mutations: GeometryMutationManager;
  /** Mesh editor */
  meshEditor: MeshEditor;
  /** Constraint solver */
  constraints: ConstraintSolver;
  /** IFC exporter */
  exporter: Ifc4GeometryExporter;

  /** Start editing an entity */
  startEditing: (expressId: number, meshData: MeshData) => EditSession | null;
  /** Stop editing and optionally commit changes */
  stopEditing: (globalId: number, commit?: boolean) => void;
  /** Update a parameter value */
  updateParameter: (
    session: EditSession,
    parameter: GeometryParameter,
    value: ParameterValue
  ) => MeshData | null;
  /** Undo last change */
  undo: (modelId: string) => MeshData | null;
  /** Redo last undone change */
  redo: (modelId: string) => MeshData | null;
}

/**
 * Create a complete geometry editing context
 */
export function createGeometryEditContext(
  dataStore: IfcDataStore,
  modelId: string,
  idOffset: number = 0
): GeometryEditContext {
  const extractor = new ParameterExtractor(dataStore, modelId, idOffset);
  const applicator = new ParameterApplicator();
  const mutations = new GeometryMutationManager();
  const meshEditor = new MeshEditor();
  const constraints = new ConstraintSolver();
  const exporter = new Ifc4GeometryExporter();

  return {
    extractor,
    applicator,
    mutations,
    meshEditor,
    constraints,
    exporter,

    startEditing(expressId: number, meshData: MeshData): EditSession | null {
      const entity = extractor.extractEditableEntity(expressId, meshData);
      if (!entity) return null;
      return mutations.startSession(entity);
    },

    stopEditing(globalId: number, commit: boolean = true): void {
      mutations.endSession(globalId, commit);
    },

    updateParameter(
      session: EditSession,
      parameter: GeometryParameter,
      value: ParameterValue
    ): MeshData | null {
      console.log('[GeomEditContext] updateParameter:', { path: parameter.path, value, type: parameter.type });

      // Solve constraints
      const { value: solvedValue } = constraints.solveAllConstraints(
        parameter,
        value
      );
      console.log('[GeomEditContext] Solved value:', solvedValue);

      // Apply parameter change
      const result = applicator.applyParameterChange(
        parameter,
        solvedValue,
        session.previewMesh
      );
      console.log('[GeomEditContext] Apply result:', { success: result.success, hasData: !!result.meshData });

      if (!result.success || !result.meshData) {
        console.warn('[GeomEditContext] applyParameterChange failed:', result);
        return null;
      }

      // Update the parameter value in the session so subsequent edits use the current value
      const paramIndex = session.entity.parameters.findIndex(p => p.path === parameter.path);
      if (paramIndex !== -1) {
        session.entity.parameters[paramIndex] = {
          ...session.entity.parameters[paramIndex],
          value: solvedValue,
        };
        console.log('[GeomEditContext] Updated parameter value in session:', { path: parameter.path, newValue: solvedValue });
      }

      // Record mutation
      mutations.applyParameterChange(
        session,
        parameter,
        solvedValue,
        result.meshData
      );

      console.log('[GeomEditContext] Parameter applied successfully');
      return result.meshData;
    },

    undo(modelId: string): MeshData | null {
      const mutation = mutations.undo(modelId);
      return mutation?.oldMeshData || null;
    },

    redo(modelId: string): MeshData | null {
      const mutation = mutations.redo(modelId);
      return mutation?.newMeshData || null;
    },
  };
}
