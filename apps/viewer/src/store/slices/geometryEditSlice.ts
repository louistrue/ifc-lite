/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Edit Slice
 *
 * Zustand slice for geometry editing state management.
 * Provides live preview, undo/redo, and parameter/mesh editing.
 */

import { type StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';
import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import type {
  EditableEntity,
  EditSession,
  GeometryMutation,
  GeometryParameter,
  ParameterValue,
  MeshSelection,
  EditMode,
  GeometryEditContext,
} from '@ifc-lite/geometry-edit';

/**
 * Geometry edit mode for UI
 */
export type GeometryEditUIMode = 'none' | 'parameter' | 'mesh' | 'transform';

/**
 * Transform gizmo mode
 */
export type TransformMode = 'translate' | 'rotate' | 'scale';

/**
 * Geometry Edit Slice State & Actions
 */
export interface GeometryEditSlice {
  // =========================================================================
  // State
  // =========================================================================

  /** Current UI edit mode */
  geometryEditMode: GeometryEditUIMode;

  /** Transform gizmo mode (when in transform mode) */
  transformMode: TransformMode;

  /** Entity currently being edited (null if not editing) */
  activeEditEntity: EditableEntity | null;

  /** Active edit session */
  activeSession: EditSession | null;

  /** Edit contexts per model */
  editContexts: Map<string, GeometryEditContext>;

  /** Preview meshes (globalId -> previewMesh) for rendering */
  previewMeshes: Map<number, MeshData>;

  /** Undo stack sizes per model (for UI display) */
  undoStackSizes: Map<string, number>;

  /** Redo stack sizes per model */
  redoStackSizes: Map<string, number>;

  /** Currently selected mesh element (vertex/edge/face) */
  meshSelection: MeshSelection | null;

  /** Whether geometry has unsaved changes */
  hasGeometryChanges: boolean;

  /** Version counter to trigger re-renders */
  geometryEditVersion: number;

  /** Active constraint axis for constrained editing */
  constraintAxis: 'x' | 'y' | 'z' | null;

  /** Snap to grid size (0 = disabled) */
  gridSnapSize: number;

  /** Global geometry edit mode - when enabled, clicking any entity starts editing */
  globalGeometryEditEnabled: boolean;

  // =========================================================================
  // Actions - Mode Management
  // =========================================================================

  /** Set geometry edit mode */
  setGeometryEditMode: (mode: GeometryEditUIMode) => void;

  /** Enable/disable global geometry edit mode */
  setGlobalGeometryEditEnabled: (enabled: boolean) => void;

  /** Set transform gizmo mode */
  setTransformMode: (mode: TransformMode) => void;

  /** Toggle constraint axis */
  setConstraintAxis: (axis: 'x' | 'y' | 'z' | null) => void;

  /** Set grid snap size */
  setGridSnapSize: (size: number) => void;

  // =========================================================================
  // Actions - Edit Context Management
  // =========================================================================

  /** Register edit context for a model */
  registerEditContext: (modelId: string, context: GeometryEditContext) => void;

  /** Get edit context for a model */
  getEditContext: (modelId: string) => GeometryEditContext | null;

  /** Clear edit context for a model */
  clearEditContext: (modelId: string) => void;

  // =========================================================================
  // Actions - Entity Editing
  // =========================================================================

  /** Start editing an entity */
  startEntityEdit: (
    modelId: string,
    expressId: number,
    meshData: MeshData
  ) => EditSession | null;

  /** Stop editing current entity */
  stopEntityEdit: (commit?: boolean) => void;

  /** Update active entity's parameter */
  updateParameter: (
    parameter: GeometryParameter,
    value: ParameterValue
  ) => MeshData | null;

  /** Update preview mesh (for live dragging) */
  updatePreviewMesh: (globalId: number, mesh: MeshData) => void;

  /** Get preview mesh for an entity */
  getPreviewMesh: (globalId: number) => MeshData | null;

  // =========================================================================
  // Actions - Mesh Editing
  // =========================================================================

  /** Set mesh selection */
  setMeshSelection: (selection: MeshSelection | null) => void;

  /** Move mesh selection */
  moveMeshSelection: (delta: Vec3) => MeshData | null;

  /** Scale mesh selection */
  scaleMeshSelection: (factor: number) => MeshData | null;

  /** Extrude face */
  extrudeFace: (delta: Vec3) => MeshData | null;

  // =========================================================================
  // Actions - Undo/Redo
  // =========================================================================

  /** Undo last geometry change */
  undoGeometry: (modelId: string) => MeshData | null;

  /** Redo last undone geometry change */
  redoGeometry: (modelId: string) => MeshData | null;

  /** Check if undo is available */
  canUndoGeometry: (modelId: string) => boolean;

  /** Check if redo is available */
  canRedoGeometry: (modelId: string) => boolean;

  // =========================================================================
  // Actions - Reset
  // =========================================================================

  /** Reset entity to original geometry */
  resetEntityGeometry: () => MeshData | null;

  /** Clear all geometry edits for a model */
  clearGeometryEdits: (modelId: string) => void;

  /** Clear all geometry edits */
  clearAllGeometryEdits: () => void;
}

/**
 * Create the geometry edit slice
 */
export const createGeometryEditSlice: StateCreator<
  ViewerState,
  [],
  [],
  GeometryEditSlice
> = (set, get) => ({
  // =========================================================================
  // Initial State
  // =========================================================================

  geometryEditMode: 'none',
  transformMode: 'translate',
  activeEditEntity: null,
  activeSession: null,
  editContexts: new Map(),
  previewMeshes: new Map(),
  undoStackSizes: new Map(),
  redoStackSizes: new Map(),
  meshSelection: null,
  hasGeometryChanges: false,
  geometryEditVersion: 0,
  constraintAxis: null,
  gridSnapSize: 0,
  globalGeometryEditEnabled: false,

  // =========================================================================
  // Mode Management
  // =========================================================================

  setGeometryEditMode: (mode) => {
    set({ geometryEditMode: mode });
  },

  setGlobalGeometryEditEnabled: (enabled) => {
    set({ globalGeometryEditEnabled: enabled });
  },

  setTransformMode: (mode) => {
    set({ transformMode: mode });
  },

  setConstraintAxis: (axis) => {
    set({ constraintAxis: axis });
  },

  setGridSnapSize: (size) => {
    set({ gridSnapSize: Math.max(0, size) });
  },

  // =========================================================================
  // Edit Context Management
  // =========================================================================

  registerEditContext: (modelId, context) => {
    set((state) => {
      const newContexts = new Map(state.editContexts);
      newContexts.set(modelId, context);
      return { editContexts: newContexts };
    });
  },

  getEditContext: (modelId) => {
    return get().editContexts.get(modelId) || null;
  },

  clearEditContext: (modelId) => {
    set((state) => {
      const newContexts = new Map(state.editContexts);
      newContexts.delete(modelId);
      return { editContexts: newContexts };
    });
  },

  // =========================================================================
  // Entity Editing
  // =========================================================================

  startEntityEdit: (modelId, expressId, meshData) => {
    console.log('[GeomEditSlice] startEntityEdit called:', { modelId, expressId, ifcType: meshData.ifcType });
    const context = get().editContexts.get(modelId);
    if (!context) {
      console.warn(`[GeomEditSlice] No edit context for model ${modelId}`);
      console.log('[GeomEditSlice] Available contexts:', Array.from(get().editContexts.keys()));
      return null;
    }
    console.log('[GeomEditSlice] Found context for model:', modelId);

    const session = context.startEditing(expressId, meshData);
    if (!session) {
      console.warn('[GeomEditSlice] context.startEditing returned null - entity may not be editable');
      return null;
    }
    console.log('[GeomEditSlice] Session created successfully, mode:', session.mode);

    const newMode = session.mode === 'parametric' ? 'parameter' : 'mesh';
    console.log('[GeomEditSlice] Setting geometryEditMode to:', newMode);

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(session.entity.globalId, meshData);

      console.log('[GeomEditSlice] Updating state with:', {
        activeEditEntity: session.entity.expressId,
        geometryEditMode: newMode,
        parameters: session.entity.parameters?.length || 0,
      });

      return {
        activeEditEntity: session.entity,
        activeSession: session,
        geometryEditMode: newMode,
        previewMeshes: newPreviewMeshes,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    console.log('[GeomEditSlice] After set, geometryEditMode is:', get().geometryEditMode);
    return session;
  },

  stopEntityEdit: (commit = true) => {
    console.log('[GeomEditSlice] stopEntityEdit called with commit:', commit, new Error().stack);
    const { activeSession, editContexts } = get();
    if (!activeSession) {
      console.log('[GeomEditSlice] No active session, returning early');
      return;
    }

    const context = editContexts.get(activeSession.entity.modelId);
    if (context) {
      context.stopEditing(activeSession.entity.globalId, commit);
    }

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      if (!commit) {
        // If discarding changes, remove preview
        newPreviewMeshes.delete(activeSession.entity.globalId);
      }

      return {
        activeEditEntity: null,
        activeSession: null,
        geometryEditMode: 'none',
        meshSelection: null,
        previewMeshes: newPreviewMeshes,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });
  },

  updateParameter: (parameter, value) => {
    console.log('[GeomEditSlice] updateParameter called:', { path: parameter.path, value });
    const { activeSession, editContexts } = get();
    if (!activeSession) {
      console.warn('[GeomEditSlice] No active session for updateParameter');
      return null;
    }

    const context = editContexts.get(parameter.modelId);
    if (!context) {
      console.warn('[GeomEditSlice] No context for model:', parameter.modelId);
      return null;
    }

    console.log('[GeomEditSlice] Calling context.updateParameter...');
    const newMesh = context.updateParameter(activeSession, parameter, value);
    if (!newMesh) {
      console.warn('[GeomEditSlice] context.updateParameter returned null');
      return null;
    }
    console.log('[GeomEditSlice] Got new mesh with', newMesh.vertices?.length || 0, 'vertices');

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(activeSession.entity.globalId, newMesh);

      const newUndoSizes = new Map(state.undoStackSizes);
      newUndoSizes.set(
        parameter.modelId,
        context.mutations.getUndoStackSize(parameter.modelId)
      );

      const newRedoSizes = new Map(state.redoStackSizes);
      newRedoSizes.set(parameter.modelId, 0); // Clear redo on new action

      return {
        previewMeshes: newPreviewMeshes,
        undoStackSizes: newUndoSizes,
        redoStackSizes: newRedoSizes,
        hasGeometryChanges: true,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return newMesh;
  },

  updatePreviewMesh: (globalId, mesh) => {
    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(globalId, mesh);
      return {
        previewMeshes: newPreviewMeshes,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });
  },

  getPreviewMesh: (globalId) => {
    return get().previewMeshes.get(globalId) || null;
  },

  // =========================================================================
  // Mesh Editing
  // =========================================================================

  setMeshSelection: (selection) => {
    set({ meshSelection: selection });
  },

  moveMeshSelection: (delta) => {
    const { activeSession, meshSelection, editContexts, constraintAxis } =
      get();
    if (!activeSession || !meshSelection) return null;

    const context = editContexts.get(activeSession.entity.modelId);
    if (!context) return null;

    // Apply constraint axis
    let constrainedDelta = delta;
    if (constraintAxis) {
      constrainedDelta = {
        x: constraintAxis === 'x' ? delta.x : 0,
        y: constraintAxis === 'y' ? delta.y : 0,
        z: constraintAxis === 'z' ? delta.z : 0,
      };
    }

    const result = context.meshEditor.applyOperation(
      activeSession.previewMesh,
      {
        type: 'move',
        selection: meshSelection,
        value: constrainedDelta,
        constrainToAxis: constraintAxis || undefined,
      }
    );

    if (!result.success || !result.meshData) return null;

    // Record mutation
    context.mutations.applyMeshEdit(
      activeSession,
      'VERTEX_MOVE' as any,
      result.affectedVertices,
      undefined,
      constrainedDelta,
      result.meshData
    );

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(activeSession.entity.globalId, result.meshData!);

      return {
        previewMeshes: newPreviewMeshes,
        hasGeometryChanges: true,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return result.meshData;
  },

  scaleMeshSelection: (factor) => {
    const { activeSession, meshSelection, editContexts } = get();
    if (!activeSession || !meshSelection) return null;

    const context = editContexts.get(activeSession.entity.modelId);
    if (!context) return null;

    const result = context.meshEditor.applyOperation(
      activeSession.previewMesh,
      {
        type: 'scale',
        selection: meshSelection,
        value: factor,
      }
    );

    if (!result.success || !result.meshData) return null;

    context.mutations.applyMeshEdit(
      activeSession,
      'SCALE' as any,
      result.affectedVertices,
      undefined,
      { x: factor, y: factor, z: factor },
      result.meshData
    );

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(activeSession.entity.globalId, result.meshData!);

      return {
        previewMeshes: newPreviewMeshes,
        hasGeometryChanges: true,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return result.meshData;
  },

  extrudeFace: (delta) => {
    const { activeSession, meshSelection, editContexts } = get();
    if (!activeSession || !meshSelection) return null;
    if (meshSelection.type !== 'face') return null;

    const context = editContexts.get(activeSession.entity.modelId);
    if (!context) return null;

    const result = context.meshEditor.applyOperation(
      activeSession.previewMesh,
      {
        type: 'extrude',
        selection: meshSelection,
        value: delta,
      }
    );

    if (!result.success || !result.meshData) return null;

    context.mutations.applyMeshEdit(
      activeSession,
      'FACE_EXTRUDE' as any,
      result.affectedVertices,
      meshSelection.faceIndex !== undefined ? [meshSelection.faceIndex] : undefined,
      delta,
      result.meshData
    );

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(activeSession.entity.globalId, result.meshData!);

      return {
        previewMeshes: newPreviewMeshes,
        hasGeometryChanges: true,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return result.meshData;
  },

  // =========================================================================
  // Undo/Redo
  // =========================================================================

  undoGeometry: (modelId) => {
    const context = get().editContexts.get(modelId);
    if (!context) return null;

    const mesh = context.undo(modelId);
    if (!mesh) return null;

    set((state) => {
      const newUndoSizes = new Map(state.undoStackSizes);
      newUndoSizes.set(modelId, context.mutations.getUndoStackSize(modelId));

      const newRedoSizes = new Map(state.redoStackSizes);
      newRedoSizes.set(modelId, context.mutations.getRedoStackSize(modelId));

      // Update preview mesh if active session matches
      const newPreviewMeshes = new Map(state.previewMeshes);
      if (state.activeSession?.entity.modelId === modelId) {
        newPreviewMeshes.set(state.activeSession.entity.globalId, mesh);
      }

      return {
        previewMeshes: newPreviewMeshes,
        undoStackSizes: newUndoSizes,
        redoStackSizes: newRedoSizes,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return mesh;
  },

  redoGeometry: (modelId) => {
    const context = get().editContexts.get(modelId);
    if (!context) return null;

    const mesh = context.redo(modelId);
    if (!mesh) return null;

    set((state) => {
      const newUndoSizes = new Map(state.undoStackSizes);
      newUndoSizes.set(modelId, context.mutations.getUndoStackSize(modelId));

      const newRedoSizes = new Map(state.redoStackSizes);
      newRedoSizes.set(modelId, context.mutations.getRedoStackSize(modelId));

      // Update preview mesh if active session matches
      const newPreviewMeshes = new Map(state.previewMeshes);
      if (state.activeSession?.entity.modelId === modelId) {
        newPreviewMeshes.set(state.activeSession.entity.globalId, mesh);
      }

      return {
        previewMeshes: newPreviewMeshes,
        undoStackSizes: newUndoSizes,
        redoStackSizes: newRedoSizes,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return mesh;
  },

  canUndoGeometry: (modelId) => {
    const context = get().editContexts.get(modelId);
    return context?.mutations.canUndo(modelId) || false;
  },

  canRedoGeometry: (modelId) => {
    const context = get().editContexts.get(modelId);
    return context?.mutations.canRedo(modelId) || false;
  },

  // =========================================================================
  // Reset
  // =========================================================================

  resetEntityGeometry: () => {
    const { activeSession, editContexts } = get();
    if (!activeSession) return null;

    const context = editContexts.get(activeSession.entity.modelId);
    if (!context) return null;

    const originalMesh = context.mutations.resetEntity(
      activeSession.entity.globalId
    );
    if (!originalMesh) return null;

    set((state) => {
      const newPreviewMeshes = new Map(state.previewMeshes);
      newPreviewMeshes.set(activeSession.entity.globalId, originalMesh);

      return {
        previewMeshes: newPreviewMeshes,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });

    return originalMesh;
  },

  clearGeometryEdits: (modelId) => {
    const context = get().editContexts.get(modelId);
    if (context) {
      context.mutations.clearMutations(modelId);
    }

    set((state) => {
      const newUndoSizes = new Map(state.undoStackSizes);
      newUndoSizes.delete(modelId);

      const newRedoSizes = new Map(state.redoStackSizes);
      newRedoSizes.delete(modelId);

      // Clear preview meshes for this model
      const newPreviewMeshes = new Map(state.previewMeshes);
      // Note: Would need model -> globalId mapping to fully clear

      return {
        undoStackSizes: newUndoSizes,
        redoStackSizes: newRedoSizes,
        hasGeometryChanges: false,
        geometryEditVersion: state.geometryEditVersion + 1,
      };
    });
  },

  clearAllGeometryEdits: () => {
    for (const context of get().editContexts.values()) {
      context.mutations.clearAllMutations();
    }

    set({
      activeEditEntity: null,
      activeSession: null,
      geometryEditMode: 'none',
      previewMeshes: new Map(),
      undoStackSizes: new Map(),
      redoStackSizes: new Map(),
      meshSelection: null,
      hasGeometryChanges: false,
      geometryEditVersion: 0,
      globalGeometryEditEnabled: false,
    });
  },
});
