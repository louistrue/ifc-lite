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

import { useCallback, useMemo, useEffect } from 'react';
import { useViewerStore } from '@/store';
import type {
  IDSDocument,
  IDSValidationReport,
  IDSModelInfo,
  IFCDataAccessor,
  PropertyValueResult,
  PropertySetInfo,
  ClassificationInfo,
  MaterialInfo,
  ParentInfo,
  PartOfRelation,
  SupportedLocale,
  ValidationProgress,
} from '@ifc-lite/ids';
import {
  parseIDS,
  validateIDS,
  createTranslationService,
} from '@ifc-lite/ids';
import type { IfcDataStore } from '@ifc-lite/parser';

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
  /** Select an entity from results (syncs to 3D view) */
  selectEntity: (modelId: string, expressId: number) => void;
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
}

// ============================================================================
// IFC Data Accessor Factory
// ============================================================================

/**
 * Create an IFCDataAccessor from an IfcDataStore
 * This bridges the viewer's data store to the IDS validator's interface
 */
function createDataAccessor(
  dataStore: IfcDataStore,
  modelId: string
): IFCDataAccessor {
  // Helper to get entity info
  const getEntityInfo = (expressId: number) => {
    return dataStore.entities?.getName ? {
      name: dataStore.entities.getName(expressId),
      type: dataStore.entities.getType?.(expressId),
      globalId: dataStore.entities.getGlobalId?.(expressId),
    } : undefined;
  };

  return {
    getEntityType(expressId: number): string | undefined {
      // Try entities table first
      const entityType = dataStore.entities?.getType?.(expressId);
      if (entityType) return entityType;

      // Fallback to entityIndex
      const byId = dataStore.entityIndex?.byId;
      if (byId) {
        const entry = byId.get(expressId);
        if (entry) {
          return typeof entry === 'object' && 'type' in entry ? String(entry.type) : undefined;
        }
      }
      return undefined;
    },

    getEntityName(expressId: number): string | undefined {
      return dataStore.entities?.getName?.(expressId);
    },

    getGlobalId(expressId: number): string | undefined {
      return dataStore.entities?.getGlobalId?.(expressId);
    },

    getDescription(expressId: number): string | undefined {
      return dataStore.entities?.getDescription?.(expressId);
    },

    getObjectType(expressId: number): string | undefined {
      return dataStore.entities?.getObjectType?.(expressId);
    },

    getEntitiesByType(typeName: string): number[] {
      const byType = dataStore.entityIndex?.byType;
      if (byType) {
        const ids = byType.get(typeName.toUpperCase());
        if (ids) return Array.from(ids);
      }
      return [];
    },

    getAllEntityIds(): number[] {
      const byId = dataStore.entityIndex?.byId;
      if (byId) {
        return Array.from(byId.keys());
      }
      return [];
    },

    getPropertyValue(
      expressId: number,
      propertySetName: string,
      propertyName: string
    ): PropertyValueResult | undefined {
      const propertiesStore = dataStore.properties;
      if (!propertiesStore) return undefined;

      // Get property sets for this entity
      const psets = propertiesStore.getPropertySets?.(expressId);
      if (!psets) return undefined;

      for (const pset of psets) {
        if (pset.name.toLowerCase() === propertySetName.toLowerCase()) {
          const props = pset.properties || [];
          for (const prop of props) {
            if (prop.name.toLowerCase() === propertyName.toLowerCase()) {
              return {
                value: prop.value,
                dataType: prop.type || 'IFCLABEL',
                propertySetName: pset.name,
                propertyName: prop.name,
              };
            }
          }
        }
      }
      return undefined;
    },

    getPropertySets(expressId: number): PropertySetInfo[] {
      const propertiesStore = dataStore.properties;
      if (!propertiesStore) return [];

      const psets = propertiesStore.getPropertySets?.(expressId);
      if (!psets) return [];

      return psets.map(pset => ({
        name: pset.name,
        properties: (pset.properties || []).map(prop => ({
          name: prop.name,
          value: prop.value,
          dataType: prop.type || 'IFCLABEL',
        })),
      }));
    },

    getClassifications(expressId: number): ClassificationInfo[] {
      // Classifications might be stored separately or in properties
      // This is a placeholder - implement based on actual data structure
      const classifications: ClassificationInfo[] = [];

      // Check if there's a classifications accessor
      const classStore = (dataStore as { classifications?: { getForEntity?: (id: number) => ClassificationInfo[] } }).classifications;
      if (classStore?.getForEntity) {
        return classStore.getForEntity(expressId);
      }

      return classifications;
    },

    getMaterials(expressId: number): MaterialInfo[] {
      // Materials might be stored separately or in relationships
      const materials: MaterialInfo[] = [];

      // Check if there's a materials accessor
      const matStore = (dataStore as { materials?: { getForEntity?: (id: number) => MaterialInfo[] } }).materials;
      if (matStore?.getForEntity) {
        return matStore.getForEntity(expressId);
      }

      return materials;
    },

    getParent(
      expressId: number,
      relationType: PartOfRelation
    ): ParentInfo | undefined {
      const relationships = dataStore.relationships;
      if (!relationships) return undefined;

      // Map IDS relation type to internal relation type
      const relationMap: Record<PartOfRelation, string> = {
        'IfcRelAggregates': 'Aggregates',
        'IfcRelContainedInSpatialStructure': 'ContainedInSpatialStructure',
        'IfcRelNests': 'Nests',
        'IfcRelVoidsElement': 'VoidsElement',
        'IfcRelFillsElement': 'FillsElement',
      };

      const relType = relationMap[relationType];
      if (!relType) return undefined;

      // Get related entities (parent direction)
      const getRelated = relationships.getRelated;
      if (getRelated) {
        const parents = getRelated(expressId, relType as never, 'inverse');
        if (parents && parents.length > 0) {
          const parentId = parents[0];
          return {
            expressId: parentId,
            entityType: this.getEntityType(parentId) || 'Unknown',
            predefinedType: this.getObjectType(parentId),
          };
        }
      }

      return undefined;
    },

    getAttribute(expressId: number, attributeName: string): string | undefined {
      const lowerName = attributeName.toLowerCase();

      // Map common attribute names to accessor methods
      switch (lowerName) {
        case 'name':
          return this.getEntityName(expressId);
        case 'description':
          return this.getDescription(expressId);
        case 'globalid':
          return this.getGlobalId(expressId);
        case 'objecttype':
        case 'predefinedtype':
          return this.getObjectType(expressId);
        default: {
          // Try to get from entities table if available
          const entities = dataStore.entities as {
            getAttribute?: (id: number, attr: string) => string | undefined;
          };
          if (entities?.getAttribute) {
            return entities.getAttribute(expressId, attributeName);
          }
          return undefined;
        }
      }
    },
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useIDS(options: UseIDSOptions = {}): UseIDSResult {
  const {
    autoApplyColors = true,
    failedColor: defaultFailedColor = [0.9, 0.2, 0.2, 1.0],
    passedColor: defaultPassedColor = [0.2, 0.8, 0.2, 1.0],
  } = options;

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

      console.log(`[useIDS] Loaded IDS: "${doc.info.title}" with ${doc.specifications.length} specifications`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse IDS file';
      setIdsError(message);
      console.error('[useIDS] Parse error:', err);
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
    const isLegacyMode = ifcDataStore && models.size === 0;
    const modelId = activeModelId || (models.size > 0 ? Array.from(models.keys())[0] : '__legacy__');
    console.log(`[useIDS] runValidation: modelId="${modelId}", isLegacyMode=${isLegacyMode}, models.size=${models.size}`);

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

      console.log(
        `[useIDS] Validation complete: ${validationReport.summary.passedSpecifications}/${validationReport.summary.totalSpecifications} specs passed, ` +
        `${validationReport.summary.totalEntitiesPassed}/${validationReport.summary.totalEntitiesChecked} entities passed (${validationReport.summary.overallPassRate}%)`
      );

      return validationReport;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      setIdsError(message);
      console.error('[useIDS] Validation error:', err);
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

  const selectEntity = useCallback((modelId: string, expressId: number) => {
    console.log(`[useIDS] selectEntity: modelId="${modelId}", expressId=${expressId}, models.size=${models.size}`);

    // Update IDS state
    setIdsActiveEntity({ modelId, expressId });

    // Sync to viewer selection
    // Handle legacy mode vs federation mode
    const isLegacyMode = modelId === '__legacy__' || models.size === 0;

    if (isLegacyMode) {
      // Legacy mode: globalId equals expressId, use 'legacy' for selection
      console.log(`[useIDS] Legacy mode - setting expressId directly: ${expressId}`);
      setSelectedEntityId(expressId);
      // Use 'legacy' as the modelId for PropertiesPanel compatibility
      setSelectedEntity({ modelId: 'legacy', expressId });
    } else {
      // Federation mode: convert to globalId using model offset
      const model = models.get(modelId);
      const globalId = model ? expressId + (model.idOffset ?? 0) : expressId;
      console.log(`[useIDS] Federation mode - model found: ${!!model}, globalId: ${globalId}`);
      setSelectedEntityId(globalId);
      setSelectedEntity({ modelId, expressId });
    }
  }, [setIdsActiveEntity, setSelectedEntityId, setSelectedEntity, models]);

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

    const colorUpdates = new Map<number, [number, number, number, number]>();

    // Get color options
    const failedClr = displayOptions.failedColor ?? defaultFailedColor;
    const passedClr = displayOptions.passedColor ?? defaultPassedColor;

    // Process all entity results
    for (const specResult of report.specificationResults) {
      for (const entityResult of specResult.entityResults) {
        const model = models.get(entityResult.modelId);
        const globalId = model
          ? entityResult.expressId + (model.idOffset ?? 0)
          : entityResult.expressId;

        if (entityResult.passed && displayOptions.highlightPassed) {
          colorUpdates.set(globalId, passedClr);
        } else if (!entityResult.passed && displayOptions.highlightFailed) {
          colorUpdates.set(globalId, failedClr);
        }
      }
    }

    if (colorUpdates.size > 0) {
      updateMeshColors(colorUpdates);
      console.log(`[useIDS] Applied colors to ${colorUpdates.size} entities`);
    }
  }, [report, models, displayOptions, defaultFailedColor, defaultPassedColor, updateMeshColors]);

  const clearColors = useCallback(() => {
    if (!report) {
      console.log('[useIDS] No validation report to clear colors from');
      return;
    }

    // Build a map of all IDS-colored entities to clear their overrides
    // Setting color to null/undefined signals the renderer to use default colors
    const colorUpdates = new Map<number, [number, number, number, number]>();
    const defaultColor: [number, number, number, number] = [1, 1, 1, 1]; // Reset to white

    for (const specResult of report.specificationResults) {
      for (const entityResult of specResult.entityResults) {
        const model = models.get(entityResult.modelId);
        const globalId = model
          ? entityResult.expressId + (model.idOffset ?? 0)
          : entityResult.expressId;
        colorUpdates.set(globalId, defaultColor);
      }
    }

    if (colorUpdates.size > 0) {
      updateMeshColors(colorUpdates);
      console.log(`[useIDS] Cleared colors from ${colorUpdates.size} entities`);
    }
  }, [report, models, updateMeshColors]);

  // Auto-apply colors when validation completes
  useEffect(() => {
    if (autoApplyColors && report) {
      applyColors();
    }
  }, [autoApplyColors, report, applyColors]);

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
      console.log(`[useIDS] Isolated ${failedIds.size} failed entities`);
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
      console.log(`[useIDS] Isolated ${passedIds.size} passed entities`);
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
  };
}
