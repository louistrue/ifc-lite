/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IDS (Information Delivery Specification) hook
 *
 * Provides functions to:
 * - Load and parse IDS XML files
 * - Run validation against loaded IFC models
 * - Apply color overrides (red=failed, green=passed)
 * - Sync selection between IDS results and 3D viewer
 * - Isolate failed/passed entities
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useViewerStore } from '@/store';
import type {
  IDSDocument,
  IDSValidationReport,
  IDSModelInfo,
  SupportedLocale,
  ValidationProgress,
} from '@ifc-lite/ids';
import {
  parseIDS,
  validateIDS,
  createTranslationService,
} from '@ifc-lite/ids';

import { createDataAccessor } from './ids/idsDataAccessor';
import {
  DEFAULT_FAILED_COLOR,
  DEFAULT_PASSED_COLOR,
  buildValidationColorUpdates,
  buildRestoreColorUpdates,
} from './ids/idsColorSystem';
import type { ColorTuple } from './ids/idsColorSystem';
import { downloadReportJSON, downloadReportHTML } from './ids/idsExportService';

// ============================================================================
// Types
// ============================================================================

export interface UseIDSOptions {
  /** Automatically apply color overrides after validation */
  autoApplyColors?: boolean;
  /** Color for failed entities [R, G, B, A] (0-1 range) */
  failedColor?: [number, number, number, number];
  /** Color for passed entities [R, G, B, A] (0-1 range) */
  passedColor?: [number, number, number, number];
}

export interface UseIDSResult {
  // State
  /** Loaded IDS document */
  document: IDSDocument | null;
  /** Validation report */
  report: IDSValidationReport | null;
  /** Loading state */
  loading: boolean;
  /** Validation progress */
  progress: ValidationProgress | null;
  /** Error message */
  error: string | null;
  /** Current locale */
  locale: SupportedLocale;
  /** Panel visibility */
  panelVisible: boolean;
  /** Active specification ID */
  activeSpecificationId: string | null;
  /** Active entity in results */
  activeEntityId: { modelId: string; expressId: number } | null;
  /** Filter mode */
  filterMode: 'all' | 'failed' | 'passed';
  /** Display options */
  displayOptions: {
    highlightFailed: boolean;
    highlightPassed: boolean;
    failedColor: [number, number, number, number];
    passedColor: [number, number, number, number];
  };

  // Document actions
  /** Load IDS from XML string */
  loadIDS: (xmlContent: string) => void;
  /** Load IDS from file */
  loadIDSFile: (file: File) => Promise<void>;
  /** Clear loaded IDS document */
  clearIDS: () => void;

  // Validation actions
  /** Run validation against current model(s) */
  runValidation: () => Promise<IDSValidationReport | null>;
  /** Clear validation results */
  clearValidation: () => void;

  // Selection actions
  /** Set active specification for filtering */
  setActiveSpecification: (specId: string | null) => void;
  /** Select an entity from results (syncs to 3D view and zooms) */
  selectEntity: (modelId: string, expressId: number, zoomToEntity?: boolean) => void;
  /** Clear entity selection */
  clearEntitySelection: () => void;

  // UI actions
  /** Show/hide IDS panel */
  setPanelVisible: (visible: boolean) => void;
  /** Toggle IDS panel */
  togglePanel: () => void;
  /** Set display locale */
  setLocale: (locale: SupportedLocale) => void;
  /** Set filter mode */
  setFilterMode: (mode: 'all' | 'failed' | 'passed') => void;
  /** Update display options */
  setDisplayOptions: (options: Partial<UseIDSResult['displayOptions']>) => void;

  // Color actions
  /** Apply validation colors to 3D view */
  applyColors: () => void;
  /** Clear validation colors */
  clearColors: () => void;

  // Isolation actions
  /** Isolate failed entities */
  isolateFailed: () => void;
  /** Isolate passed entities */
  isolatePassed: () => void;
  /** Clear isolation */
  clearIsolation: () => void;

  // Utility getters
  /** Get failed entity IDs for current specification or all */
  getFailedEntityIds: (specId?: string) => Array<{ modelId: string; expressId: number }>;
  /** Get passed entity IDs for current specification or all */
  getPassedEntityIds: (specId?: string) => Array<{ modelId: string; expressId: number }>;
  /** Check if an entity failed validation */
  isEntityFailed: (modelId: string, expressId: number) => boolean;
  /** Check if an entity passed validation */
  isEntityPassed: (modelId: string, expressId: number) => boolean;

  // Export actions
  /** Export validation report to JSON */
  exportReportJSON: () => void;
  /** Export validation report to HTML */
  exportReportHTML: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useIDS(options: UseIDSOptions = {}): UseIDSResult {
  const {
    autoApplyColors = true,
    failedColor: optionsFailedColor,
    passedColor: optionsPassedColor,
  } = options;

  // Use stable defaults if options not provided
  const defaultFailedColor = optionsFailedColor ?? DEFAULT_FAILED_COLOR;
  const defaultPassedColor = optionsPassedColor ?? DEFAULT_PASSED_COLOR;

  // IDS store state
  const document = useViewerStore((s) => s.idsDocument);
  const report = useViewerStore((s) => s.idsValidationReport);
  const loading = useViewerStore((s) => s.idsLoading);
  const progress = useViewerStore((s) => s.idsProgress);
  const error = useViewerStore((s) => s.idsError);
  const locale = useViewerStore((s) => s.idsLocale);
  const panelVisible = useViewerStore((s) => s.idsPanelVisible);
  const activeSpecificationId = useViewerStore((s) => s.idsActiveSpecificationId);
  const activeEntityId = useViewerStore((s) => s.idsActiveEntityId);
  const filterMode = useViewerStore((s) => s.idsFilterMode);
  const displayOptions = useViewerStore((s) => s.idsDisplayOptions);

  // IDS store actions
  const setIdsDocument = useViewerStore((s) => s.setIdsDocument);
  const clearIdsDocument = useViewerStore((s) => s.clearIdsDocument);
  const setIdsValidationReport = useViewerStore((s) => s.setIdsValidationReport);
  const clearIdsValidationReport = useViewerStore((s) => s.clearIdsValidationReport);
  const setIdsProgress = useViewerStore((s) => s.setIdsProgress);
  const setIdsActiveSpecification = useViewerStore((s) => s.setIdsActiveSpecification);
  const setIdsActiveEntity = useViewerStore((s) => s.setIdsActiveEntity);
  const setIdsPanelVisible = useViewerStore((s) => s.setIdsPanelVisible);
  const toggleIdsPanel = useViewerStore((s) => s.toggleIdsPanel);
  const setIdsLoading = useViewerStore((s) => s.setIdsLoading);
  const setIdsError = useViewerStore((s) => s.setIdsError);
  const setIdsLocale = useViewerStore((s) => s.setIdsLocale);
  const setIdsFilterMode = useViewerStore((s) => s.setIdsFilterMode);
  const setIdsDisplayOptions = useViewerStore((s) => s.setIdsDisplayOptions);
  const idsFailedEntityIds = useViewerStore((s) => s.idsFailedEntityIds);
  const idsPassedEntityIds = useViewerStore((s) => s.idsPassedEntityIds);

  // Viewer state
  const models = useViewerStore((s) => s.models);
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const updateMeshColors = useViewerStore((s) => s.updateMeshColors);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const setIsolatedEntities = useViewerStore((s) => s.setIsolatedEntities);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const geometryResult = useViewerStore((s) => s.geometryResult);

  // Ref to store original colors before IDS color overrides
  const originalColorsRef = useRef<Map<number, ColorTuple>>(new Map());

  // Ref to access geometryResult without creating callback dependencies (prevents infinite loops)
  const geometryResultRef = useRef(geometryResult);
  geometryResultRef.current = geometryResult;

  // Get translator for current locale
  const translator = useMemo(() => {
    return createTranslationService(locale);
  }, [locale]);

  // ============================================================================
  // Document Actions
  // ============================================================================

  const loadIDS = useCallback((xmlContent: string) => {
    try {
      setIdsLoading(true);
      setIdsError(null);

      const doc = parseIDS(xmlContent);
      setIdsDocument(doc);

      console.info(`[IDS] Loaded: "${doc.info.title}" (${doc.specifications.length} specifications)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse IDS file';
      setIdsError(message);
      console.error('[IDS] Parse error:', err);
    } finally {
      setIdsLoading(false);
    }
  }, [setIdsDocument, setIdsLoading, setIdsError]);

  const loadIDSFile = useCallback(async (file: File) => {
    try {
      setIdsLoading(true);
      setIdsError(null);

      const content = await file.text();
      loadIDS(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read IDS file';
      setIdsError(message);
    } finally {
      setIdsLoading(false);
    }
  }, [loadIDS, setIdsLoading, setIdsError]);

  const clearIDS = useCallback(() => {
    clearIdsDocument();
  }, [clearIdsDocument]);

  // ============================================================================
  // Validation Actions
  // ============================================================================

  const runValidation = useCallback(async (): Promise<IDSValidationReport | null> => {
    if (!document) {
      setIdsError('No IDS document loaded');
      return null;
    }

    // Get data store to validate against
    const dataStore = ifcDataStore || (models.size > 0 ? Array.from(models.values())[0]?.ifcDataStore : null);
    if (!dataStore) {
      setIdsError('No IFC model loaded');
      return null;
    }

    // Determine model ID - use '__legacy__' for legacy single-model mode
    const modelId = activeModelId || (models.size > 0 ? Array.from(models.keys())[0] : '__legacy__');

    try {
      setIdsLoading(true);
      setIdsError(null);

      // Create data accessor
      const accessor = createDataAccessor(dataStore, modelId);

      // Create model info
      const modelInfo: IDSModelInfo = {
        modelId,
        schemaVersion: dataStore.schemaVersion || 'IFC4',
        entityCount: dataStore.entityCount || accessor.getAllEntityIds().length,
      };

      // Run validation
      const validationReport = await validateIDS(document, accessor, modelInfo, {
        translator,
        onProgress: setIdsProgress,
        includePassingEntities: true,
      });

      setIdsValidationReport(validationReport);

      console.info(
        `[IDS] Validation: ${validationReport.summary.passedSpecifications}/${validationReport.summary.totalSpecifications} specs, ` +
        `${validationReport.summary.totalEntitiesPassed}/${validationReport.summary.totalEntitiesChecked} entities (${validationReport.summary.overallPassRate}%)`
      );

      return validationReport;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      setIdsError(message);
      console.error('[IDS] Validation error:', err);
      return null;
    } finally {
      setIdsLoading(false);
    }
  }, [
    document,
    ifcDataStore,
    models,
    activeModelId,
    translator,
    setIdsLoading,
    setIdsError,
    setIdsProgress,
    setIdsValidationReport,
  ]);

  const clearValidation = useCallback(() => {
    clearIdsValidationReport();
  }, [clearIdsValidationReport]);

  // ============================================================================
  // Selection Actions
  // ============================================================================

  const setActiveSpecification = useCallback((specId: string | null) => {
    setIdsActiveSpecification(specId);
  }, [setIdsActiveSpecification]);

  const selectEntity = useCallback((modelId: string, expressId: number, zoomToEntity = true) => {

    // Update IDS state
    setIdsActiveEntity({ modelId, expressId });

    // Sync to viewer selection
    // Handle legacy mode vs federation mode
    const isLegacyMode = modelId === '__legacy__' || models.size === 0;

    if (isLegacyMode) {
      // Legacy mode: globalId equals expressId, use 'legacy' for selection
      setSelectedEntityId(expressId);
      // Use 'legacy' as the modelId for PropertiesPanel compatibility
      setSelectedEntity({ modelId: 'legacy', expressId });
    } else {
      // Federation mode: convert to globalId using model offset
      const model = models.get(modelId);
      const globalId = model ? expressId + (model.idOffset ?? 0) : expressId;
      setSelectedEntityId(globalId);
      setSelectedEntity({ modelId, expressId });
    }

    // Zoom to entity after a small delay to ensure selection is processed
    if (zoomToEntity && cameraCallbacks.frameSelection) {
      setTimeout(() => {
        cameraCallbacks.frameSelection?.();
      }, 50);
    }
  }, [setIdsActiveEntity, setSelectedEntityId, setSelectedEntity, models, cameraCallbacks]);

  const clearEntitySelection = useCallback(() => {
    setIdsActiveEntity(null);
    setSelectedEntityId(null);
    setSelectedEntity(null);
  }, [setIdsActiveEntity, setSelectedEntityId, setSelectedEntity]);

  // ============================================================================
  // UI Actions
  // ============================================================================

  const setPanelVisible = useCallback((visible: boolean) => {
    setIdsPanelVisible(visible);
  }, [setIdsPanelVisible]);

  const togglePanel = useCallback(() => {
    toggleIdsPanel();
  }, [toggleIdsPanel]);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setIdsLocale(newLocale);
  }, [setIdsLocale]);

  const setFilterModeAction = useCallback((mode: 'all' | 'failed' | 'passed') => {
    setIdsFilterMode(mode);
  }, [setIdsFilterMode]);

  const setDisplayOptionsAction = useCallback((opts: Partial<UseIDSResult['displayOptions']>) => {
    setIdsDisplayOptions(opts);
  }, [setIdsDisplayOptions]);

  // ============================================================================
  // Color Actions
  // ============================================================================

  const applyColors = useCallback(() => {
    if (!report) return;

    const colorUpdates = buildValidationColorUpdates(
      report,
      models,
      displayOptions,
      defaultFailedColor,
      defaultPassedColor,
      geometryResultRef.current,
      originalColorsRef.current
    );

    if (colorUpdates.size > 0) {
      updateMeshColors(colorUpdates);
    }
  }, [report, models, displayOptions, defaultFailedColor, defaultPassedColor, updateMeshColors]);

  const clearColors = useCallback(() => {
    const colorUpdates = buildRestoreColorUpdates(originalColorsRef.current);
    if (colorUpdates && colorUpdates.size > 0) {
      updateMeshColors(colorUpdates);
    }
  }, [updateMeshColors]);

  // Ref to store applyColors for stable useEffect (prevents infinite loops)
  const applyColorsRef = useRef(applyColors);
  applyColorsRef.current = applyColors;

  // Auto-apply colors when validation completes
  // Use ref to avoid dependency on applyColors callback which could cause loops
  useEffect(() => {
    if (autoApplyColors && report) {
      applyColorsRef.current();
    }
  }, [autoApplyColors, report]);

  // ============================================================================
  // Isolation Actions
  // ============================================================================

  const isolateFailed = useCallback(() => {
    const failedIds = new Set<number>();

    for (const key of idsFailedEntityIds) {
      const lastColonIndex = key.lastIndexOf(':');
      const modelId = key.substring(0, lastColonIndex);
      const expressIdStr = key.substring(lastColonIndex + 1);
      const expressId = parseInt(expressIdStr, 10);
      const model = models.get(modelId);
      const globalId = model ? expressId + (model.idOffset ?? 0) : expressId;
      failedIds.add(globalId);
    }

    if (failedIds.size > 0) {
      setIsolatedEntities(failedIds);
    }
  }, [idsFailedEntityIds, models, setIsolatedEntities]);

  const isolatePassed = useCallback(() => {
    const passedIds = new Set<number>();

    for (const key of idsPassedEntityIds) {
      const lastColonIndex = key.lastIndexOf(':');
      const modelId = key.substring(0, lastColonIndex);
      const expressIdStr = key.substring(lastColonIndex + 1);
      const expressId = parseInt(expressIdStr, 10);
      const model = models.get(modelId);
      const globalId = model ? expressId + (model.idOffset ?? 0) : expressId;
      passedIds.add(globalId);
    }

    if (passedIds.size > 0) {
      setIsolatedEntities(passedIds);
    }
  }, [idsPassedEntityIds, models, setIsolatedEntities]);

  const clearIsolation = useCallback(() => {
    setIsolatedEntities(null);
  }, [setIsolatedEntities]);

  // ============================================================================
  // Utility Getters
  // ============================================================================

  const getFailedEntityIds = useCallback((specId?: string): Array<{ modelId: string; expressId: number }> => {
    if (!report) return [];

    const results: Array<{ modelId: string; expressId: number }> = [];

    for (const specResult of report.specificationResults) {
      if (specId && specResult.specification.id !== specId) continue;

      for (const entityResult of specResult.entityResults) {
        if (!entityResult.passed) {
          results.push({
            modelId: entityResult.modelId,
            expressId: entityResult.expressId,
          });
        }
      }
    }

    return results;
  }, [report]);

  const getPassedEntityIds = useCallback((specId?: string): Array<{ modelId: string; expressId: number }> => {
    if (!report) return [];

    const results: Array<{ modelId: string; expressId: number }> = [];

    for (const specResult of report.specificationResults) {
      if (specId && specResult.specification.id !== specId) continue;

      for (const entityResult of specResult.entityResults) {
        if (entityResult.passed) {
          results.push({
            modelId: entityResult.modelId,
            expressId: entityResult.expressId,
          });
        }
      }
    }

    return results;
  }, [report]);

  const isEntityFailed = useCallback((modelId: string, expressId: number): boolean => {
    return idsFailedEntityIds.has(`${modelId}:${expressId}`);
  }, [idsFailedEntityIds]);

  const isEntityPassed = useCallback((modelId: string, expressId: number): boolean => {
    return idsPassedEntityIds.has(`${modelId}:${expressId}`);
  }, [idsPassedEntityIds]);

  // ============================================================================
  // Export Actions
  // ============================================================================

  const exportReportJSON = useCallback(() => {
    if (!report) {
      console.warn('[IDS] No report to export');
      return;
    }
    downloadReportJSON(report);
  }, [report]);

  const exportReportHTML = useCallback(() => {
    if (!report) {
      console.warn('[IDS] No report to export');
      return;
    }
    downloadReportHTML(report, locale);
  }, [report, locale]);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    // State
    document,
    report,
    loading,
    progress,
    error,
    locale,
    panelVisible,
    activeSpecificationId,
    activeEntityId,
    filterMode,
    displayOptions,

    // Document actions
    loadIDS,
    loadIDSFile,
    clearIDS,

    // Validation actions
    runValidation,
    clearValidation,

    // Selection actions
    setActiveSpecification,
    selectEntity,
    clearEntitySelection,

    // UI actions
    setPanelVisible,
    togglePanel,
    setLocale,
    setFilterMode: setFilterModeAction,
    setDisplayOptions: setDisplayOptionsAction,

    // Color actions
    applyColors,
    clearColors,

    // Isolation actions
    isolateFailed,
    isolatePassed,
    clearIsolation,

    // Utility getters
    getFailedEntityIds,
    getPassedEntityIds,
    isEntityFailed,
    isEntityPassed,

    // Export actions
    exportReportJSON,
    exportReportHTML,
  };
}
