/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useDiff — Full lifecycle hook for IFC model diffing.
 *
 * Manages: file loading, diff execution, federation-aware selection,
 * color application, isolation, and cleanup.
 */

import { useCallback, useRef } from 'react';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { computeDiff, DIFF_COLORS } from '@ifc-lite/diff';
import type { DiffResult, DiffSettings } from '@ifc-lite/diff';

export function useDiff() {
  const diffResult = useViewerStore((s) => s.diffResult);
  const diffLoading = useViewerStore((s) => s.diffLoading);
  const diffError = useViewerStore((s) => s.diffError);
  const diffPanelVisible = useViewerStore((s) => s.diffPanelVisible);
  const diffOldModelId = useViewerStore((s) => s.diffOldModelId);
  const diffNewModelId = useViewerStore((s) => s.diffNewModelId);
  const diffFile1Name = useViewerStore((s) => s.diffFile1Name);
  const diffFile2Name = useViewerStore((s) => s.diffFile2Name);

  const setDiffResult = useViewerStore((s) => s.setDiffResult);
  const setDiffLoading = useViewerStore((s) => s.setDiffLoading);
  const setDiffError = useViewerStore((s) => s.setDiffError);
  const setDiffPanelVisible = useViewerStore((s) => s.setDiffPanelVisible);
  const setDiffFileNames = useViewerStore((s) => s.setDiffFileNames);
  const setDiffModelIds = useViewerStore((s) => s.setDiffModelIds);
  const clearDiff = useViewerStore((s) => s.clearDiff);

  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const models = useViewerStore((s) => s.models);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const setPendingColorUpdates = useViewerStore((s) => s.setPendingColorUpdates);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const setIsolatedEntities = useViewerStore((s) => s.setIsolatedEntities);
  const clearIsolationStore = useViewerStore((s) => s.clearIsolation);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const setRightPanelCollapsed = useViewerStore((s) => s.setRightPanelCollapsed);

  const modelsRef = useRef(models);
  modelsRef.current = models;

  /**
   * Get the current model's IfcDataStore (federation-aware).
   */
  const getActiveStore = useCallback((): { store: IfcDataStore; modelId: string } | null => {
    // Try active model first
    if (activeModelId && models.has(activeModelId)) {
      const model = models.get(activeModelId)!;
      return { store: model.ifcDataStore, modelId: activeModelId };
    }
    // Try first loaded model
    if (models.size > 0) {
      const [modelId, model] = Array.from(models.entries())[0];
      return { store: model.ifcDataStore, modelId };
    }
    // Legacy single-model
    if (ifcDataStore) {
      return { store: ifcDataStore, modelId: 'legacy' };
    }
    return null;
  }, [ifcDataStore, models, activeModelId]);

  /**
   * Load a comparison IFC file and run diff against the active model.
   */
  const loadAndDiff = useCallback(async (file: File, settings?: DiffSettings) => {
    const active = getActiveStore();
    if (!active) {
      setDiffError('No IFC model loaded to compare against');
      return;
    }

    try {
      setDiffLoading(true);
      setDiffError(null);
      setDiffPanelVisible(true);
      setRightPanelCollapsed(false);

      // Parse the comparison file
      const buffer = await file.arrayBuffer();
      const parser = new IfcParser();
      const comparisonStore = await parser.parseColumnar(buffer);

      // Run diff: active model is "old", comparison file is "new"
      const result = computeDiff(active.store, comparisonStore, settings);

      setDiffResult(result);
      setDiffFileNames('Current Model', file.name);
      setDiffModelIds(active.modelId, active.modelId); // Both reference same model context

      // Auto-apply colors
      applyDiffColors(result, active.modelId, active.modelId);
    } catch (err: any) {
      setDiffError(err.message ?? 'Failed to load or diff file');
    } finally {
      setDiffLoading(false);
    }
  }, [getActiveStore, setDiffLoading, setDiffError, setDiffPanelVisible, setDiffResult, setDiffFileNames, setDiffModelIds, setRightPanelCollapsed]);

  /**
   * Run diff between two already-loaded federated models.
   */
  const diffModels = useCallback((oldModelId: string, newModelId: string, settings?: DiffSettings) => {
    const oldModel = models.get(oldModelId);
    const newModel = models.get(newModelId);
    if (!oldModel || !newModel) {
      setDiffError('Both models must be loaded');
      return;
    }

    try {
      setDiffLoading(true);
      setDiffError(null);
      setDiffPanelVisible(true);
      setRightPanelCollapsed(false);

      const result = computeDiff(oldModel.ifcDataStore, newModel.ifcDataStore, settings);

      setDiffResult(result);
      setDiffFileNames(oldModel.name, newModel.name);
      setDiffModelIds(oldModelId, newModelId);

      // Auto-apply colors
      applyDiffColors(result, oldModelId, newModelId);
    } catch (err: any) {
      setDiffError(err.message ?? 'Diff failed');
    } finally {
      setDiffLoading(false);
    }
  }, [models, setDiffLoading, setDiffError, setDiffPanelVisible, setDiffResult, setDiffFileNames, setDiffModelIds, setRightPanelCollapsed]);

  /**
   * Apply diff colors to the 3D view.
   */
  const applyDiffColors = useCallback((
    result?: DiffResult | null,
    oldMid?: string | null,
    newMid?: string | null,
  ) => {
    const r = result ?? diffResult;
    const oldM = oldMid ?? diffOldModelId ?? 'legacy';
    const newM = newMid ?? diffNewModelId ?? 'legacy';
    if (!r) return;

    const m = modelsRef.current;
    const colorMap = new Map<number, [number, number, number, number]>();
    for (const e of r.added) {
      colorMap.set(toGlobalIdFromModels(m, newM, e.expressId), DIFF_COLORS.added as [number, number, number, number]);
    }
    for (const e of r.deleted) {
      colorMap.set(toGlobalIdFromModels(m, oldM, e.expressId), DIFF_COLORS.deleted as [number, number, number, number]);
    }
    for (const e of r.changed) {
      colorMap.set(toGlobalIdFromModels(m, newM, e.expressId2), DIFF_COLORS.changed as [number, number, number, number]);
    }
    setPendingColorUpdates(colorMap);
  }, [diffResult, diffOldModelId, diffNewModelId, setPendingColorUpdates]);

  /**
   * Select and frame a diff entity.
   */
  const selectEntity = useCallback((modelId: string, expressId: number) => {
    const m = modelsRef.current;
    const isLegacy = modelId === 'legacy' || modelId === '__legacy__' || m.size === 0;

    if (isLegacy) {
      setSelectedEntityId(expressId);
      setSelectedEntity({ modelId: 'legacy', expressId });
    } else {
      const globalId = toGlobalIdFromModels(m, modelId, expressId);
      setSelectedEntityId(globalId);
      setSelectedEntity({ modelId, expressId });
    }

    requestAnimationFrame(() => {
      cameraCallbacks.frameSelection?.();
    });
  }, [setSelectedEntityId, setSelectedEntity, cameraCallbacks]);

  /**
   * Isolate only the changed entities (added + changed in new model).
   */
  const isolateChanged = useCallback(() => {
    if (!diffResult) return;
    const m = modelsRef.current;
    const newM = diffNewModelId ?? 'legacy';
    const ids = new Set<number>();
    for (const e of diffResult.added) {
      ids.add(toGlobalIdFromModels(m, newM, e.expressId));
    }
    for (const e of diffResult.changed) {
      ids.add(toGlobalIdFromModels(m, newM, e.expressId2));
    }
    if (ids.size > 0) setIsolatedEntities(ids);
  }, [diffResult, diffNewModelId, setIsolatedEntities]);

  const clearIsolation = useCallback(() => {
    clearIsolationStore();
  }, [clearIsolationStore]);

  const clearColors = useCallback(() => {
    setPendingColorUpdates(new Map());
  }, [setPendingColorUpdates]);

  return {
    // State
    diffResult,
    diffLoading,
    diffError,
    diffPanelVisible,
    diffFile1Name,
    diffFile2Name,
    diffOldModelId,
    diffNewModelId,

    // Actions
    loadAndDiff,
    diffModels,
    applyDiffColors,
    selectEntity,
    isolateChanged,
    clearIsolation,
    clearColors,
    clearDiff,
    setDiffPanelVisible,
  };
}
