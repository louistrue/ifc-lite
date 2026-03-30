/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useClash — Full lifecycle hook for IFC clash detection.
 *
 * Manages: type-based group selection, clash execution with geometry,
 * federation-aware selection, color application, isolation, and cleanup.
 */

import { useCallback, useRef } from 'react';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { detectClashes, CLASH_COLORS } from '@ifc-lite/clash';
import type { ClashSet, ClashSettings, ClashResult } from '@ifc-lite/clash';
import type { MeshData } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';

export function useClash() {
  const clashResult = useViewerStore((s) => s.clashResult);
  const clashLoading = useViewerStore((s) => s.clashLoading);
  const clashError = useViewerStore((s) => s.clashError);
  const clashPanelVisible = useViewerStore((s) => s.clashPanelVisible);
  const clashMode = useViewerStore((s) => s.clashMode);
  const clashTolerance = useViewerStore((s) => s.clashTolerance);
  const clashClearance = useViewerStore((s) => s.clashClearance);
  const clashFileToModelId = useViewerStore((s) => s.clashFileToModelId);

  const setClashResult = useViewerStore((s) => s.setClashResult);
  const setClashLoading = useViewerStore((s) => s.setClashLoading);
  const setClashError = useViewerStore((s) => s.setClashError);
  const setClashPanelVisible = useViewerStore((s) => s.setClashPanelVisible);
  const setClashFileToModelId = useViewerStore((s) => s.setClashFileToModelId);
  const clearClash = useViewerStore((s) => s.clearClash);

  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const geometryResult = useViewerStore((s) => s.geometryResult);
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
   * Run self-clash detection on the active model with type filters.
   */
  const runSelfClash = useCallback(async (
    typesA?: string[],
    typesB?: string[],
  ) => {
    // Build stores map from loaded models
    const stores = buildStoresMap();
    if (!stores || stores.size === 0) {
      setClashError('No IFC model with geometry loaded');
      return;
    }

    const fileToModelId = new Map<string, string>();
    const clashSets: ClashSet[] = [];

    if (models.size > 0) {
      // Federation mode: each model is a separate "file"
      const modelEntries = Array.from(models.entries());
      if (typesB && typesB.length > 0) {
        // Cross-type within same model(s)
        for (const [modelId, model] of modelEntries) {
          fileToModelId.set(modelId, modelId);
          clashSets.push({
            name: `${model.name}: ${(typesA ?? ['All']).join(',')} vs ${typesB.join(',')}`,
            a: { file: modelId, types: typesA?.length ? typesA : undefined },
            b: { file: modelId, types: typesB },
          });
        }
      } else {
        // Self-clash within model(s)
        for (const [modelId, model] of modelEntries) {
          fileToModelId.set(modelId, modelId);
          clashSets.push({
            name: model.name,
            a: { file: modelId, types: typesA?.length ? typesA : undefined },
          });
        }
      }
    } else {
      // Legacy single-model
      const filePath = 'model';
      fileToModelId.set(filePath, 'legacy');
      if (typesB && typesB.length > 0) {
        clashSets.push({
          name: `${(typesA ?? ['All']).join(',')} vs ${typesB.join(',')}`,
          a: { file: filePath, types: typesA?.length ? typesA : undefined },
          b: { file: filePath, types: typesB },
        });
      } else {
        clashSets.push({
          name: 'Self-clash',
          a: { file: filePath, types: typesA?.length ? typesA : undefined },
        });
      }
    }

    await executeClash(clashSets, stores, fileToModelId);
  }, [models, ifcDataStore, geometryResult, clashMode, clashTolerance, clashClearance]);

  /**
   * Run cross-model clash detection between two federated models.
   */
  const runCrossModelClash = useCallback(async (
    modelIdA: string,
    modelIdB: string,
    typesA?: string[],
    typesB?: string[],
  ) => {
    const modelA = models.get(modelIdA);
    const modelB = models.get(modelIdB);
    if (!modelA || !modelB) {
      setClashError('Both models must be loaded');
      return;
    }

    const stores = new Map<string, { store: IfcDataStore; meshes: MeshData[] }>();
    stores.set(modelIdA, { store: modelA.ifcDataStore, meshes: modelA.geometryResult.meshes });
    stores.set(modelIdB, { store: modelB.ifcDataStore, meshes: modelB.geometryResult.meshes });

    const fileToModelId = new Map<string, string>();
    fileToModelId.set(modelIdA, modelIdA);
    fileToModelId.set(modelIdB, modelIdB);

    const clashSets: ClashSet[] = [{
      name: `${modelA.name} vs ${modelB.name}`,
      a: { file: modelIdA, types: typesA?.length ? typesA : undefined },
      b: { file: modelIdB, types: typesB?.length ? typesB : undefined },
    }];

    await executeClash(clashSets, stores, fileToModelId);
  }, [models, clashMode, clashTolerance, clashClearance]);

  /**
   * Core clash execution.
   */
  const executeClash = useCallback(async (
    clashSets: ClashSet[],
    stores: Map<string, { store: IfcDataStore; meshes: MeshData[] }>,
    fileToModelId: Map<string, string>,
  ) => {
    try {
      setClashLoading(true);
      setClashError(null);
      setClashPanelVisible(true);
      setRightPanelCollapsed(false);

      const settings: ClashSettings = {
        mode: clashMode,
        tolerance: clashTolerance,
        clearance: clashClearance,
      };

      // Run in next frame to let UI update to loading state
      await new Promise(resolve => requestAnimationFrame(resolve));

      const result = detectClashes(clashSets, stores, settings);

      setClashResult(result);
      setClashFileToModelId(fileToModelId);

      // Auto-apply colors
      applyClashColors(result, fileToModelId);
    } catch (err: any) {
      setClashError(err.message ?? 'Clash detection failed');
    } finally {
      setClashLoading(false);
    }
  }, [clashMode, clashTolerance, clashClearance, setClashLoading, setClashError, setClashPanelVisible, setClashResult, setClashFileToModelId, setRightPanelCollapsed]);

  /**
   * Build stores map from loaded models or legacy store.
   */
  const buildStoresMap = useCallback((): Map<string, { store: IfcDataStore; meshes: MeshData[] }> | null => {
    const stores = new Map<string, { store: IfcDataStore; meshes: MeshData[] }>();

    if (models.size > 0) {
      for (const [modelId, model] of models) {
        if (model.geometryResult?.meshes) {
          stores.set(modelId, { store: model.ifcDataStore, meshes: model.geometryResult.meshes });
        }
      }
    } else if (ifcDataStore && geometryResult?.meshes) {
      stores.set('model', { store: ifcDataStore, meshes: geometryResult.meshes });
    }

    return stores.size > 0 ? stores : null;
  }, [models, ifcDataStore, geometryResult]);

  /**
   * Apply clash colors to the 3D view.
   */
  const applyClashColors = useCallback((
    result?: ClashResult | null,
    ftm?: Map<string, string> | null,
  ) => {
    const r = result ?? clashResult;
    const mapping = ftm ?? clashFileToModelId;
    if (!r) return;

    const m = modelsRef.current;
    const colorMap = new Map<number, [number, number, number, number]>();
    for (const clash of r.clashes) {
      const modelIdA = mapping.get(clash.a.file) ?? 'legacy';
      const modelIdB = mapping.get(clash.b.file) ?? 'legacy';
      colorMap.set(
        toGlobalIdFromModels(m, modelIdA, clash.a.expressId),
        CLASH_COLORS.clashA as [number, number, number, number],
      );
      colorMap.set(
        toGlobalIdFromModels(m, modelIdB, clash.b.expressId),
        CLASH_COLORS.clashB as [number, number, number, number],
      );
    }
    setPendingColorUpdates(colorMap);
  }, [clashResult, clashFileToModelId, setPendingColorUpdates]);

  /**
   * Select and frame a clash element.
   */
  const selectClashElement = useCallback((file: string, expressId: number) => {
    const modelId = clashFileToModelId.get(file) ?? 'legacy';
    const m = modelsRef.current;
    const isLegacy = modelId === 'legacy' || m.size === 0;

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
  }, [clashFileToModelId, setSelectedEntityId, setSelectedEntity, cameraCallbacks]);

  /**
   * Isolate only clashing entities.
   */
  const isolateClashing = useCallback(() => {
    if (!clashResult) return;
    const m = modelsRef.current;
    const ids = new Set<number>();
    for (const clash of clashResult.clashes) {
      const modelIdA = clashFileToModelId.get(clash.a.file) ?? 'legacy';
      const modelIdB = clashFileToModelId.get(clash.b.file) ?? 'legacy';
      ids.add(toGlobalIdFromModels(m, modelIdA, clash.a.expressId));
      ids.add(toGlobalIdFromModels(m, modelIdB, clash.b.expressId));
    }
    if (ids.size > 0) setIsolatedEntities(ids);
  }, [clashResult, clashFileToModelId, setIsolatedEntities]);

  const clearIsolation = useCallback(() => {
    clearIsolationStore();
  }, [clearIsolationStore]);

  const clearColors = useCallback(() => {
    setPendingColorUpdates(new Map());
  }, [setPendingColorUpdates]);

  /**
   * Get available IFC types from all loaded models (for type picker UI).
   */
  const getAvailableTypes = useCallback((): string[] => {
    const types = new Set<string>();
    if (models.size > 0) {
      for (const [, model] of models) {
        for (const [typeName] of model.ifcDataStore.entityIndex.byType) {
          types.add(typeName);
        }
      }
    } else if (ifcDataStore) {
      for (const [typeName] of ifcDataStore.entityIndex.byType) {
        types.add(typeName);
      }
    }
    return Array.from(types).sort();
  }, [models, ifcDataStore]);

  return {
    // State
    clashResult,
    clashLoading,
    clashError,
    clashPanelVisible,
    clashMode,
    clashTolerance,
    clashClearance,

    // Actions
    runSelfClash,
    runCrossModelClash,
    applyClashColors,
    selectClashElement,
    isolateClashing,
    clearIsolation,
    clearColors,
    clearClash,
    setClashPanelVisible,
    getAvailableTypes,
  };
}
