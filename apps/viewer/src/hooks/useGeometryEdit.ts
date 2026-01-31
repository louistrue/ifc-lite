/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useGeometryEdit Hook
 *
 * Provides geometry editing capabilities with live preview.
 * Manages editing context lifecycle and parameter updates.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useViewerStore } from '../store/index.js';
import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import {
  createGeometryEditContext,
  type EditSession,
  type GeometryParameter,
  type ParameterValue,
  type MeshSelection,
  type GeometryEditContext,
} from '@ifc-lite/geometry-edit';

/**
 * Hook return type
 */
export interface UseGeometryEditResult {
  // State
  /** Current edit mode */
  editMode: 'none' | 'parameter' | 'mesh' | 'transform';
  /** Active edit session */
  session: EditSession | null;
  /** Whether currently editing */
  isEditing: boolean;
  /** Whether there are unsaved changes */
  hasChanges: boolean;
  /** Current mesh selection (for mesh editing) */
  meshSelection: MeshSelection | null;
  /** Active constraint axis */
  constraintAxis: 'x' | 'y' | 'z' | null;
  /** Can undo */
  canUndo: boolean;
  /** Can redo */
  canRedo: boolean;

  // Actions - Setup
  /** Initialize editing context for a model */
  initializeContext: (
    dataStore: IfcDataStore,
    modelId: string,
    idOffset?: number
  ) => GeometryEditContext;

  // Actions - Editing
  /** Start editing an entity */
  startEditing: (
    modelId: string,
    expressId: number,
    meshData: MeshData
  ) => EditSession | null;
  /** Stop editing */
  stopEditing: (commit?: boolean) => void;
  /** Update a parameter value (live preview) */
  updateParameter: (
    parameter: GeometryParameter,
    value: ParameterValue
  ) => MeshData | null;
  /** Get preview mesh for rendering */
  getPreviewMesh: (globalId: number) => MeshData | null;

  // Actions - Mesh Editing
  /** Set mesh selection */
  setMeshSelection: (selection: MeshSelection | null) => void;
  /** Move selection */
  moveSelection: (delta: Vec3) => MeshData | null;
  /** Scale selection */
  scaleSelection: (factor: number) => MeshData | null;
  /** Extrude selected face */
  extrudeFace: (delta: Vec3) => MeshData | null;

  // Actions - Transform
  /** Set transform mode */
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  /** Set constraint axis */
  setConstraintAxis: (axis: 'x' | 'y' | 'z' | null) => void;

  // Actions - Undo/Redo
  /** Undo last change */
  undo: () => MeshData | null;
  /** Redo last undone change */
  redo: () => MeshData | null;

  // Actions - Reset
  /** Reset entity to original geometry */
  resetGeometry: () => MeshData | null;
  /** Discard all changes and exit editing */
  discardChanges: () => void;
}

/**
 * Hook for geometry editing
 */
export function useGeometryEdit(): UseGeometryEditResult {
  // Store selectors - memoized to prevent unnecessary re-renders
  const editMode = useViewerStore((s) => s.geometryEditMode);
  const session = useViewerStore((s) => s.activeSession);
  const meshSelection = useViewerStore((s) => s.meshSelection);
  const constraintAxis = useViewerStore((s) => s.constraintAxis);
  const hasChanges = useViewerStore((s) => s.hasGeometryChanges);

  // Store actions
  const registerEditContext = useViewerStore((s) => s.registerEditContext);
  const startEntityEdit = useViewerStore((s) => s.startEntityEdit);
  const stopEntityEdit = useViewerStore((s) => s.stopEntityEdit);
  const storeUpdateParameter = useViewerStore((s) => s.updateParameter);
  const getPreviewMesh = useViewerStore((s) => s.getPreviewMesh);
  const setMeshSelectionStore = useViewerStore((s) => s.setMeshSelection);
  const moveMeshSelection = useViewerStore((s) => s.moveMeshSelection);
  const scaleMeshSelection = useViewerStore((s) => s.scaleMeshSelection);
  const extrudeFaceStore = useViewerStore((s) => s.extrudeFace);
  const setTransformModeStore = useViewerStore((s) => s.setTransformMode);
  const setConstraintAxisStore = useViewerStore((s) => s.setConstraintAxis);
  const undoGeometry = useViewerStore((s) => s.undoGeometry);
  const redoGeometry = useViewerStore((s) => s.redoGeometry);
  const canUndoGeometry = useViewerStore((s) => s.canUndoGeometry);
  const canRedoGeometry = useViewerStore((s) => s.canRedoGeometry);
  const resetEntityGeometry = useViewerStore((s) => s.resetEntityGeometry);

  // Derived state
  const isEditing = editMode !== 'none' && session !== null;

  // Current model ID for undo/redo
  const currentModelId = session?.entity.modelId;

  // Undo/redo availability
  const canUndo = currentModelId ? canUndoGeometry(currentModelId) : false;
  const canRedo = currentModelId ? canRedoGeometry(currentModelId) : false;

  // =========================================================================
  // Actions
  // =========================================================================

  const initializeContext = useCallback(
    (
      dataStore: IfcDataStore,
      modelId: string,
      idOffset: number = 0
    ): GeometryEditContext => {
      const context = createGeometryEditContext(dataStore, modelId, idOffset);
      registerEditContext(modelId, context);
      return context;
    },
    [registerEditContext]
  );

  const startEditing = useCallback(
    (
      modelId: string,
      expressId: number,
      meshData: MeshData
    ): EditSession | null => {
      return startEntityEdit(modelId, expressId, meshData);
    },
    [startEntityEdit]
  );

  const stopEditing = useCallback(
    (commit: boolean = true): void => {
      stopEntityEdit(commit);
    },
    [stopEntityEdit]
  );

  const updateParameter = useCallback(
    (parameter: GeometryParameter, value: ParameterValue): MeshData | null => {
      return storeUpdateParameter(parameter, value);
    },
    [storeUpdateParameter]
  );

  const setMeshSelection = useCallback(
    (selection: MeshSelection | null): void => {
      setMeshSelectionStore(selection);
    },
    [setMeshSelectionStore]
  );

  const moveSelection = useCallback(
    (delta: Vec3): MeshData | null => {
      return moveMeshSelection(delta);
    },
    [moveMeshSelection]
  );

  const scaleSelection = useCallback(
    (factor: number): MeshData | null => {
      return scaleMeshSelection(factor);
    },
    [scaleMeshSelection]
  );

  const extrudeFace = useCallback(
    (delta: Vec3): MeshData | null => {
      return extrudeFaceStore(delta);
    },
    [extrudeFaceStore]
  );

  const setTransformMode = useCallback(
    (mode: 'translate' | 'rotate' | 'scale'): void => {
      setTransformModeStore(mode);
    },
    [setTransformModeStore]
  );

  const setConstraintAxis = useCallback(
    (axis: 'x' | 'y' | 'z' | null): void => {
      setConstraintAxisStore(axis);
    },
    [setConstraintAxisStore]
  );

  const undo = useCallback((): MeshData | null => {
    if (!currentModelId) return null;
    return undoGeometry(currentModelId);
  }, [currentModelId, undoGeometry]);

  const redo = useCallback((): MeshData | null => {
    if (!currentModelId) return null;
    return redoGeometry(currentModelId);
  }, [currentModelId, redoGeometry]);

  const resetGeometry = useCallback((): MeshData | null => {
    return resetEntityGeometry();
  }, [resetEntityGeometry]);

  const discardChanges = useCallback((): void => {
    stopEntityEdit(false);
  }, [stopEntityEdit]);

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================

  useEffect(() => {
    if (!isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Undo: Ctrl/Cmd + Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y
      if (
        (e.ctrlKey || e.metaKey) &&
        ((e.key === 'z' && e.shiftKey) || e.key === 'y')
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Constraint axes
      if (e.key === 'x' || e.key === 'X') {
        setConstraintAxis(constraintAxis === 'x' ? null : 'x');
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        setConstraintAxis(constraintAxis === 'y' ? null : 'y');
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        setConstraintAxis(constraintAxis === 'z' ? null : 'z');
        return;
      }

      // Transform modes (when in transform mode)
      if (editMode === 'transform') {
        if (e.key === 'g' || e.key === 'G') {
          setTransformMode('translate');
          return;
        }
        if (e.key === 'r' || e.key === 'R') {
          setTransformMode('rotate');
          return;
        }
        if (e.key === 's' || e.key === 'S') {
          setTransformMode('scale');
          return;
        }
      }

      // Escape: Exit editing
      if (e.key === 'Escape') {
        stopEditing(true);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isEditing,
    editMode,
    constraintAxis,
    undo,
    redo,
    setConstraintAxis,
    setTransformMode,
    stopEditing,
  ]);

  // =========================================================================
  // Return
  // =========================================================================

  return useMemo(
    () => ({
      // State
      editMode,
      session,
      isEditing,
      hasChanges,
      meshSelection,
      constraintAxis,
      canUndo,
      canRedo,

      // Actions
      initializeContext,
      startEditing,
      stopEditing,
      updateParameter,
      getPreviewMesh,
      setMeshSelection,
      moveSelection,
      scaleSelection,
      extrudeFace,
      setTransformMode,
      setConstraintAxis,
      undo,
      redo,
      resetGeometry,
      discardChanges,
    }),
    [
      editMode,
      session,
      isEditing,
      hasChanges,
      meshSelection,
      constraintAxis,
      canUndo,
      canRedo,
      initializeContext,
      startEditing,
      stopEditing,
      updateParameter,
      getPreviewMesh,
      setMeshSelection,
      moveSelection,
      scaleSelection,
      extrudeFace,
      setTransformMode,
      setConstraintAxis,
      undo,
      redo,
      resetGeometry,
      discardChanges,
    ]
  );
}

/**
 * Hook for accessing editable parameters of the current entity
 */
export function useEditableParameters(): GeometryParameter[] {
  const session = useViewerStore((s) => s.activeSession);
  return session?.entity.parameters || [];
}

/**
 * Hook for preview mesh access (for renderer integration)
 */
export function usePreviewMeshes(): Map<number, MeshData> {
  return useViewerStore((s) => s.previewMeshes);
}

/**
 * Hook for geometry edit version (for triggering re-renders)
 */
export function useGeometryEditVersion(): number {
  return useViewerStore((s) => s.geometryEditVersion);
}

/**
 * Hook for pending commit expressId (for renderer commit flow)
 */
export function usePendingCommitExpressId(): number | null {
  return useViewerStore((s) => s.pendingCommitExpressId);
}

/**
 * Hook for clearPendingCommit action
 */
export function useClearPendingCommit(): () => void {
  return useViewerStore((s) => s.clearPendingCommit);
}
