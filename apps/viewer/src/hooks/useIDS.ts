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
      type: dataStore.entities.getTypeName?.(expressId),
      globalId: dataStore.entities.getGlobalId?.(expressId),
    } : undefined;
  };

  return {
    getEntityType(expressId: number): string | undefined {
      // Try entities table first
      const entityType = dataStore.entities?.getTypeName?.(expressId);
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

      // Get property sets for this entity using getForEntity (returns PropertySet[])
      const psets = propertiesStore.getForEntity?.(expressId);
      if (!psets) return undefined;

      for (const pset of psets) {
        if (pset.name.toLowerCase() === propertySetName.toLowerCase()) {
          const props = pset.properties || [];
          for (const prop of props) {
            if (prop.name.toLowerCase() === propertyName.toLowerCase()) {
              // Convert value: ensure it's a primitive type (not array)
              let value: string | number | boolean | null = null;
              if (Array.isArray(prop.value)) {
                // For arrays, convert to string representation
                value = JSON.stringify(prop.value);
              } else {
                value = prop.value as string | number | boolean | null;
              }
              return {
                value,
                dataType: String(prop.type || 'IFCLABEL'),
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

      // Use getForEntity (returns PropertySet[])
      const psets = propertiesStore.getForEntity?.(expressId);
      if (!psets) return [];

      return psets.map((pset) => ({
        name: pset.name,
        properties: (pset.properties || []).map((prop) => {
          // Convert value: ensure it's a primitive type (not array)
          let value: string | number | boolean | null = null;
          if (Array.isArray(prop.value)) {
            value = JSON.stringify(prop.value);
          } else {
            value = prop.value as string | number | boolean | null;
          }
          return {
            name: prop.name,
            value,
            dataType: String(prop.type || 'IFCLABEL'),
          };
        }),
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

// Stable default color constants (moved outside hook to prevent recreations)
const DEFAULT_FAILED_COLOR: [number, number, number, number] = [0.9, 0.2, 0.2, 1.0];
const DEFAULT_PASSED_COLOR: [number, number, number, number] = [0.2, 0.8, 0.2, 1.0];

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
  const originalColorsRef = useRef<Map<number, [number, number, number, number]>>(new Map());

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
    const isLegacyMode = ifcDataStore && models.size === 0;
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

    const colorUpdates = new Map<number, [number, number, number, number]>();

    // Get color options
    const failedClr = displayOptions.failedColor ?? defaultFailedColor;
    const passedClr = displayOptions.passedColor ?? defaultPassedColor;

    // Build a set of globalIds we'll be updating
    const globalIdsToUpdate = new Set<number>();
    for (const specResult of report.specificationResults) {
      for (const entityResult of specResult.entityResults) {
        const model = models.get(entityResult.modelId);
        const globalId = model
          ? entityResult.expressId + (model.idOffset ?? 0)
          : entityResult.expressId;
        globalIdsToUpdate.add(globalId);
      }
    }

    // Capture original colors before applying overrides (only if not already captured)
    // Use ref to avoid dependency on geometryResult which would cause infinite loops
    const currentGeometry = geometryResultRef.current;
    if (currentGeometry?.meshes && originalColorsRef.current.size === 0) {
      for (const mesh of currentGeometry.meshes) {
        if (globalIdsToUpdate.has(mesh.expressId)) {
          originalColorsRef.current.set(mesh.expressId, [...mesh.color] as [number, number, number, number]);
        }
      }
    }

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
    }
  }, [report, models, displayOptions, defaultFailedColor, defaultPassedColor, updateMeshColors]);

  const clearColors = useCallback(() => {
    // Restore original colors from the ref
    if (originalColorsRef.current.size === 0) {
      return;
    }

    // Create a new map with the original colors to restore
    const colorUpdates = new Map<number, [number, number, number, number]>(originalColorsRef.current);

    if (colorUpdates.size > 0) {
      updateMeshColors(colorUpdates);
      // Clear the stored original colors after restoring
      originalColorsRef.current.clear();
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

    const exportData = {
      document: report.document,
      modelInfo: report.modelInfo,
      timestamp: report.timestamp.toISOString(),
      summary: report.summary,
      specificationResults: report.specificationResults.map(spec => ({
        specification: spec.specification,
        status: spec.status,
        applicableCount: spec.applicableCount,
        passedCount: spec.passedCount,
        failedCount: spec.failedCount,
        passRate: spec.passRate,
        entityResults: spec.entityResults.map(entity => ({
          expressId: entity.expressId,
          modelId: entity.modelId,
          entityType: entity.entityType,
          entityName: entity.entityName,
          globalId: entity.globalId,
          passed: entity.passed,
          requirementResults: entity.requirementResults.map(req => ({
            requirement: req.requirement,
            status: req.status,
            facetType: req.facetType,
            checkedDescription: req.checkedDescription,
            failureReason: req.failureReason,
            actualValue: req.actualValue,
            expectedValue: req.expectedValue,
          })),
        })),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = `ids-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const exportReportHTML = useCallback(() => {
    if (!report) {
      console.warn('[IDS] No report to export');
      return;
    }

    // HTML escape helper to prevent XSS
    const escapeHtml = (str: string | undefined | null): string => {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const statusClass = (status: string) => {
      if (status === 'pass') return 'color: #22c55e;';
      if (status === 'fail') return 'color: #ef4444;';
      return 'color: #eab308;';
    };

    const html = `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IDS Validation Report - ${escapeHtml(report.document.info.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1, h2, h3 { margin-top: 0; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
    .summary-item { text-align: center; padding: 16px; background: #f9fafb; border-radius: 8px; }
    .summary-item .value { font-size: 24px; font-weight: bold; }
    .summary-item .label { color: #6b7280; font-size: 14px; }
    .pass { color: #22c55e; }
    .fail { color: #ef4444; }
    .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; transition: width 0.3s; }
    .spec-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; }
    .spec-header { padding: 16px; cursor: pointer; }
    .spec-header:hover { background: #f9fafb; }
    .entity-list { border-top: 1px solid #e5e7eb; max-height: 400px; overflow-y: auto; }
    .entity-row { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
    .entity-row:last-child { border-bottom: none; }
    .requirement { font-size: 13px; padding: 4px 0; color: #6b7280; }
    .failure-reason { color: #ef4444; font-size: 12px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(report.document.info.title)}</h1>
    ${report.document.info.description ? `<p>${escapeHtml(report.document.info.description)}</p>` : ''}
    <p><strong>Model:</strong> ${escapeHtml(report.modelInfo.modelId)} | <strong>Schema:</strong> ${escapeHtml(report.modelInfo.schemaVersion)} | <strong>Date:</strong> ${escapeHtml(report.timestamp.toLocaleString())}</p>
  </div>

  <div class="card">
    <h2>Summary</h2>
    <div class="summary">
      <div class="summary-item">
        <div class="value">${report.summary.totalSpecifications}</div>
        <div class="label">Specifications</div>
      </div>
      <div class="summary-item">
        <div class="value pass">${report.summary.passedSpecifications}</div>
        <div class="label">Passed</div>
      </div>
      <div class="summary-item">
        <div class="value fail">${report.summary.failedSpecifications}</div>
        <div class="label">Failed</div>
      </div>
      <div class="summary-item">
        <div class="value">${report.summary.totalEntitiesChecked}</div>
        <div class="label">Entities Checked</div>
      </div>
      <div class="summary-item">
        <div class="value">${report.summary.overallPassRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Specifications</h2>
    ${report.specificationResults.map(spec => `
      <div class="spec-card">
        <div class="spec-header">
          <h3 style="${statusClass(spec.status)}">${spec.status === 'pass' ? '✓' : '✗'} ${escapeHtml(spec.specification.name)}</h3>
          ${spec.specification.description ? `<p style="margin: 8px 0; color: #6b7280;">${escapeHtml(spec.specification.description)}</p>` : ''}
          <div style="display: flex; gap: 16px; font-size: 14px; color: #6b7280;">
            <span>${spec.applicableCount} entities</span>
            <span class="pass">${spec.passedCount} passed</span>
            <span class="fail">${spec.failedCount} failed</span>
          </div>
          <div class="progress-bar" style="margin-top: 8px;">
            <div class="progress-fill" style="width: ${spec.passRate}%; background: ${spec.passRate >= 80 ? '#22c55e' : spec.passRate >= 50 ? '#eab308' : '#ef4444'};"></div>
          </div>
        </div>
        ${spec.entityResults.length > 0 ? `
        <div class="entity-list">
          ${spec.entityResults.slice(0, 50).map(entity => `
            <div class="entity-row">
              <div style="${statusClass(entity.passed ? 'pass' : 'fail')}">
                ${entity.passed ? '✓' : '✗'} <strong>${escapeHtml(entity.entityName) || '#' + entity.expressId}</strong>
                <span style="color: #6b7280; font-size: 13px;"> - ${escapeHtml(entity.entityType)}${entity.globalId ? ' · ' + escapeHtml(entity.globalId) : ''}</span>
              </div>
              ${entity.requirementResults.filter(r => r.status === 'fail').map(req => `
                <div class="requirement">
                  ${escapeHtml(req.checkedDescription)}
                  ${req.failureReason ? `<div class="failure-reason">${escapeHtml(req.failureReason)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
          ${spec.entityResults.length > 50 ? `<div class="entity-row" style="text-align: center; color: #6b7280;">... and ${spec.entityResults.length - 50} more entities</div>` : ''}
        </div>
        ` : ''}
      </div>
    `).join('')}
  </div>

  <footer style="text-align: center; color: #6b7280; padding: 20px;">
    Generated by IFC-Lite IDS Validator
  </footer>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = `ids-report-${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
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
