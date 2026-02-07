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

import { useCallback, useMemo, useEffect, useRef, useState } from 'react';
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
import { createBCFFromIDSReport, writeBCF } from '@ifc-lite/bcf';
import type { EntityBoundsInput, IDSBCFExportOptions } from '@ifc-lite/bcf';
import type { IDSBCFExportSettings, IDSExportProgress } from '@/components/viewer/IDSExportDialog';
import { getEntityBounds } from '@/utils/viewportUtils';

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
  /** Export validation report to BCF with configurable options */
  exportReportBCF: (settings: IDSBCFExportSettings) => Promise<void>;
  /** BCF export progress state */
  bcfExportProgress: IDSExportProgress | null;
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
    const esc = (str: string | undefined | null): string => {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const totalChecks = report.summary.totalEntitiesChecked;
    const totalPassed = report.specificationResults.reduce((s, sp) => s + sp.passedCount, 0);
    const totalFailed = report.specificationResults.reduce((s, sp) => s + sp.failedCount, 0);
    const overallPassRate = totalChecks > 0 ? Math.round((totalPassed / totalChecks) * 100) : 0;

    // Build entity rows for each specification
    const buildEntityRows = (spec: typeof report.specificationResults[0]) => {
      return spec.entityResults.map(entity => {
        const failedReqs = entity.requirementResults.filter(r => r.status === 'fail');
        const passedReqs = entity.requirementResults.filter(r => r.status === 'pass');
        const allReqs = entity.requirementResults.filter(r => r.status !== 'not_applicable');

        // Build requirement details HTML
        const reqDetails = failedReqs.length > 0
          ? failedReqs.map(req => `<div class="req-detail">
              <span class="req-facet">${esc(req.facetType)}</span>
              <span class="req-desc">${esc(req.checkedDescription)}</span>
              ${req.failureReason ? `<div class="req-failure">${esc(req.failureReason)}</div>` : ''}
              ${req.expectedValue || req.actualValue ? `<div class="req-values">${req.expectedValue ? `<span>Expected: <code>${esc(req.expectedValue)}</code></span>` : ''}${req.actualValue ? `<span>Actual: <code>${esc(req.actualValue)}</code></span>` : ''}</div>` : ''}
            </div>`).join('')
          : '<span class="all-pass">All requirements passed</span>';

        return `<tr class="entity-row" data-status="${entity.passed ? 'pass' : 'fail'}" data-type="${esc(entity.entityType)}" data-name="${esc(entity.entityName ?? '')}">
          <td class="col-status"><span class="badge ${entity.passed ? 'badge-pass' : 'badge-fail'}">${entity.passed ? 'PASS' : 'FAIL'}</span></td>
          <td class="col-type">${esc(entity.entityType)}</td>
          <td class="col-name">${esc(entity.entityName) || '<em>unnamed</em>'}</td>
          <td class="col-globalid"><code class="globalid" title="Click to copy">${esc(entity.globalId) || '—'}</code></td>
          <td class="col-expressid">${entity.expressId}</td>
          <td class="col-reqs"><span class="pass-count">${passedReqs.length}</span>/<span class="total-count">${allReqs.length}</span></td>
          <td class="col-details"><details><summary>${failedReqs.length > 0 ? `${failedReqs.length} failure${failedReqs.length > 1 ? 's' : ''}` : 'Details'}</summary><div class="req-list">${reqDetails}</div></details></td>
        </tr>`;
      }).join('');
    };

    const html = `<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IDS Validation Report - ${esc(report.document.info.title)}</title>
  <style>
    :root {
      --pass: #22c55e; --pass-bg: #dcfce7; --pass-border: #86efac;
      --fail: #ef4444; --fail-bg: #fef2f2; --fail-border: #fca5a5;
      --warn: #eab308; --muted: #6b7280; --border: #e5e7eb;
      --bg: #f8fafc; --card: #fff; --hover: #f1f5f9;
    }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1400px; margin: 0 auto; padding: 20px; background: var(--bg); color: #1e293b; line-height: 1.5; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    h2 { font-size: 1.25rem; margin-bottom: 8px; }
    h3 { font-size: 1rem; }
    .card { background: var(--card); border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); }
    .meta { color: var(--muted); font-size: 0.875rem; margin-top: 4px; }
    .meta span { margin-right: 16px; }

    /* Summary grid */
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; }
    .stat { text-align: center; padding: 12px; background: var(--bg); border-radius: 8px; border: 1px solid var(--border); }
    .stat .value { font-size: 1.75rem; font-weight: 700; }
    .stat .label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat.pass .value { color: var(--pass); }
    .stat.fail .value { color: var(--fail); }

    /* Progress bar */
    .progress { height: 8px; background: var(--fail-bg); border-radius: 4px; overflow: hidden; margin: 8px 0; }
    .progress-fill { height: 100%; background: var(--pass); border-radius: 4px; transition: width 0.3s; }

    /* Filter toolbar */
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .toolbar input[type="text"] { padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.875rem; min-width: 200px; }
    .toolbar input[type="text"]:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
    .filter-btn { padding: 5px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); cursor: pointer; font-size: 0.8rem; font-weight: 500; }
    .filter-btn:hover { background: var(--hover); }
    .filter-btn.active { background: #1e293b; color: white; border-color: #1e293b; }
    .result-count { color: var(--muted); font-size: 0.8rem; margin-left: auto; }

    /* Specification sections */
    .spec { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
    .spec-header { padding: 16px; cursor: pointer; display: flex; align-items: flex-start; gap: 12px; }
    .spec-header:hover { background: var(--hover); }
    .spec-indicator { font-size: 1.25rem; margin-top: 2px; transition: transform 0.2s; }
    .spec.open .spec-indicator { transform: rotate(90deg); }
    .spec-info { flex: 1; }
    .spec-info h3 { display: flex; align-items: center; gap: 8px; }
    .spec-desc { color: var(--muted); font-size: 0.875rem; margin-top: 4px; }
    .spec-stats { display: flex; gap: 16px; font-size: 0.8rem; color: var(--muted); margin-top: 8px; }
    .spec-body { display: none; border-top: 1px solid var(--border); }
    .spec.open .spec-body { display: block; }

    /* Entity table */
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { padding: 8px 12px; text-align: left; background: var(--bg); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); cursor: pointer; user-select: none; white-space: nowrap; border-bottom: 2px solid var(--border); }
    th:hover { background: #e2e8f0; }
    th .sort-icon { margin-left: 4px; opacity: 0.3; }
    th.sorted .sort-icon { opacity: 1; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr.entity-row:hover { background: var(--hover); }
    tr.entity-row[data-status="fail"] { background: #fefce8; }
    tr.entity-row[data-status="fail"]:hover { background: #fef9c3; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em; }
    .badge-pass { background: var(--pass-bg); color: #166534; border: 1px solid var(--pass-border); }
    .badge-fail { background: var(--fail-bg); color: #991b1b; border: 1px solid var(--fail-border); }
    .badge-spec { font-size: 0.7rem; padding: 2px 6px; }

    /* Columns */
    .col-status { width: 60px; }
    .col-type { width: 140px; font-family: monospace; font-size: 0.8rem; }
    .col-name { min-width: 120px; }
    .col-globalid { width: 200px; }
    .col-expressid { width: 70px; text-align: right; font-family: monospace; }
    .col-reqs { width: 60px; text-align: center; }
    .col-details { min-width: 200px; }

    /* GlobalId */
    code.globalid { font-size: 0.75rem; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; cursor: pointer; word-break: break-all; }
    code.globalid:hover { background: #e2e8f0; }
    code.globalid.copied { background: var(--pass-bg); }

    /* Requirement details */
    details summary { cursor: pointer; color: var(--fail); font-size: 0.8rem; }
    details summary:hover { text-decoration: underline; }
    .req-list { padding: 8px 0; }
    .req-detail { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
    .req-detail:last-child { border-bottom: none; }
    .req-facet { display: inline-block; background: #f1f5f9; padding: 1px 6px; border-radius: 3px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; color: var(--muted); margin-right: 6px; }
    .req-desc { font-size: 0.8rem; }
    .req-failure { color: var(--fail); font-size: 0.8rem; margin-top: 2px; }
    .req-values { display: flex; gap: 16px; font-size: 0.75rem; color: var(--muted); margin-top: 2px; }
    .req-values code { background: #fef3c7; padding: 1px 4px; border-radius: 2px; color: #92400e; }
    .all-pass { color: var(--pass); font-size: 0.8rem; }
    .pass-count { color: var(--pass); font-weight: 600; }
    .total-count { color: var(--muted); }

    /* Responsive */
    @media (max-width: 768px) {
      .col-globalid, .col-expressid { display: none; }
      .toolbar { flex-direction: column; }
      .toolbar input[type="text"] { width: 100%; min-width: unset; }
    }

    /* Print */
    @media print {
      body { background: white; max-width: none; }
      .card { box-shadow: none; border: 1px solid #ddd; }
      .toolbar { display: none; }
      .spec.open .spec-body { display: block; }
      details { open; }
      details[open] summary { display: none; }
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="card">
    <h1>${esc(report.document.info.title)}</h1>
    ${report.document.info.description ? `<p style="color: var(--muted); margin-top: 4px;">${esc(report.document.info.description)}</p>` : ''}
    <div class="meta">
      ${report.document.info.author ? `<span>Author: ${esc(report.document.info.author)}</span>` : ''}
      <span>Generated: ${esc(report.timestamp.toLocaleString())}</span>
      <span>Schema: ${esc(report.modelInfo.schemaVersion)}</span>
    </div>
  </div>

  <!-- Summary -->
  <div class="card">
    <h2>Summary</h2>
    <div class="progress">
      <div class="progress-fill" style="width: ${overallPassRate}%;"></div>
    </div>
    <div style="text-align: center; font-size: 0.875rem; color: var(--muted);">${overallPassRate}% of entity checks passed</div>
    <div class="summary">
      <div class="stat">
        <div class="value">${report.summary.totalSpecifications}</div>
        <div class="label">Specifications</div>
      </div>
      <div class="stat pass">
        <div class="value">${report.summary.passedSpecifications}</div>
        <div class="label">Specs Passed</div>
      </div>
      <div class="stat fail">
        <div class="value">${report.summary.failedSpecifications}</div>
        <div class="label">Specs Failed</div>
      </div>
      <div class="stat">
        <div class="value">${totalChecks}</div>
        <div class="label">Entities Checked</div>
      </div>
      <div class="stat pass">
        <div class="value">${totalPassed}</div>
        <div class="label">Passed</div>
      </div>
      <div class="stat fail">
        <div class="value">${totalFailed}</div>
        <div class="label">Failed</div>
      </div>
    </div>
  </div>

  <!-- Filter toolbar -->
  <div class="card">
    <div class="toolbar">
      <input type="text" id="search" placeholder="Search by name, type, or GlobalId..." oninput="filterAll()">
      <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">All</button>
      <button class="filter-btn" data-filter="fail" onclick="setFilter('fail')">Failed Only</button>
      <button class="filter-btn" data-filter="pass" onclick="setFilter('pass')">Passed Only</button>
      <span class="result-count" id="result-count"></span>
    </div>

    <h2>Specifications</h2>

    ${report.specificationResults.map((spec, i) => `
    <div class="spec ${spec.status === 'fail' ? 'open' : ''}" id="spec-${i}">
      <div class="spec-header" onclick="toggleSpec(${i})">
        <span class="spec-indicator">&#9654;</span>
        <div class="spec-info">
          <h3>
            <span class="badge badge-spec ${spec.status === 'pass' ? 'badge-pass' : spec.status === 'fail' ? 'badge-fail' : ''}">${spec.status.toUpperCase()}</span>
            ${esc(spec.specification.name)}
          </h3>
          ${spec.specification.description ? `<div class="spec-desc">${esc(spec.specification.description)}</div>` : ''}
          <div class="spec-stats">
            <span>${spec.applicableCount} applicable</span>
            <span style="color: var(--pass);">${spec.passedCount} passed</span>
            <span style="color: var(--fail);">${spec.failedCount} failed</span>
            <span>${spec.passRate}% pass rate</span>
          </div>
          <div class="progress" style="margin-top: 6px;">
            <div class="progress-fill" style="width: ${spec.passRate}%;"></div>
          </div>
        </div>
      </div>
      <div class="spec-body">
        <table>
          <thead>
            <tr>
              <th class="col-status" onclick="sortTable(${i}, 0)">Status <span class="sort-icon">&#x25B4;&#x25BE;</span></th>
              <th class="col-type" onclick="sortTable(${i}, 1)">IFC Type <span class="sort-icon">&#x25B4;&#x25BE;</span></th>
              <th class="col-name" onclick="sortTable(${i}, 2)">Name <span class="sort-icon">&#x25B4;&#x25BE;</span></th>
              <th class="col-globalid" onclick="sortTable(${i}, 3)">GlobalId <span class="sort-icon">&#x25B4;&#x25BE;</span></th>
              <th class="col-expressid" onclick="sortTable(${i}, 4)">ID <span class="sort-icon">&#x25B4;&#x25BE;</span></th>
              <th class="col-reqs">Reqs</th>
              <th class="col-details">Details</th>
            </tr>
          </thead>
          <tbody id="tbody-${i}">
            ${buildEntityRows(spec)}
          </tbody>
        </table>
      </div>
    </div>
    `).join('')}
  </div>

  <footer style="text-align: center; color: var(--muted); padding: 20px; font-size: 0.8rem;">
    Generated by <strong>IFC-Lite</strong> IDS Validator &middot; ${esc(new Date().toISOString().split('T')[0])}
  </footer>

  <script>
    // Current filter state
    let currentFilter = 'all';

    // Toggle specification collapse
    function toggleSpec(i) {
      document.getElementById('spec-' + i).classList.toggle('open');
    }

    // Status filter
    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      filterAll();
    }

    // Apply search + status filter to all entity rows
    function filterAll() {
      const search = document.getElementById('search').value.toLowerCase();
      let visible = 0, total = 0;

      document.querySelectorAll('.entity-row').forEach(row => {
        total++;
        const status = row.dataset.status;
        const text = row.textContent.toLowerCase();
        const matchesFilter = currentFilter === 'all' || status === currentFilter;
        const matchesSearch = !search || text.includes(search);
        const show = matchesFilter && matchesSearch;
        row.classList.toggle('hidden', !show);
        if (show) visible++;
      });

      document.getElementById('result-count').textContent =
        search || currentFilter !== 'all'
          ? visible + ' of ' + total + ' entities shown'
          : total + ' entities';
    }

    // Sort table by column
    function sortTable(specIndex, colIndex) {
      const tbody = document.getElementById('tbody-' + specIndex);
      const rows = Array.from(tbody.querySelectorAll('tr.entity-row'));

      // Determine sort direction by toggling
      const th = tbody.parentElement.querySelectorAll('th')[colIndex];
      const asc = !th.classList.contains('sorted-asc');

      // Clear all sorted states in this table
      tbody.parentElement.querySelectorAll('th').forEach(h => {
        h.classList.remove('sorted', 'sorted-asc', 'sorted-desc');
      });
      th.classList.add('sorted', asc ? 'sorted-asc' : 'sorted-desc');

      rows.sort((a, b) => {
        let aVal = a.cells[colIndex].textContent.trim();
        let bVal = b.cells[colIndex].textContent.trim();

        // Numeric sort for Express ID column
        if (colIndex === 4) {
          return asc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        }

        return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });

      rows.forEach(row => tbody.appendChild(row));
    }

    // Copy GlobalId on click
    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('globalid') && e.target.textContent !== '\\u2014') {
        navigator.clipboard.writeText(e.target.textContent).then(() => {
          e.target.classList.add('copied');
          setTimeout(() => e.target.classList.remove('copied'), 1000);
        });
      }
    });

    // Initialize count
    filterAll();
  </script>
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

  // BCF export progress state
  const [bcfExportProgress, setBcfExportProgress] = useState<IDSExportProgress | null>(null);

  // BCF store actions for 'load into panel'
  const setBcfProject = useViewerStore((s) => s.setBcfProject);
  const setBcfPanelVisible = useViewerStore((s) => s.setBcfPanelVisible);
  const bcfAuthor = useViewerStore((s) => s.bcfAuthor);

  const exportReportBCF = useCallback(async (settings: IDSBCFExportSettings) => {
    if (!report) {
      console.warn('[IDS] No report to export');
      return;
    }

    const {
      topicGrouping,
      includePassingEntities,
      includeCamera,
      includeSnapshots,
      loadIntoBcfPanel,
    } = settings;

    // Phase 1: Collect entity bounds if camera is requested
    let entityBounds: Map<string, EntityBoundsInput> | undefined;

    if (includeCamera) {
      setBcfExportProgress({ phase: 'building', current: 0, total: 1, message: 'Computing entity bounds...' });

      entityBounds = new Map();
      const geomResult = geometryResultRef.current;

      // Collect geometry from all models
      const allMeshData: Array<{ meshes: unknown[]; idOffset: number; modelId: string }> = [];
      for (const [modelId, model] of models.entries()) {
        if (model.geometryResult?.meshes) {
          allMeshData.push({
            meshes: model.geometryResult.meshes,
            idOffset: model.idOffset ?? 0,
            modelId,
          });
        }
      }

      // Also include legacy single-model geometry
      if (geomResult?.meshes && allMeshData.length === 0) {
        allMeshData.push({
          meshes: geomResult.meshes,
          idOffset: 0,
          modelId: 'default',
        });
      }

      // Compute bounds for each entity that appears in the report
      for (const specResult of report.specificationResults) {
        for (const entity of specResult.entityResults) {
          if (entity.passed && !includePassingEntities) continue;
          const boundsKey = `${entity.modelId}:${entity.expressId}`;
          if (entityBounds.has(boundsKey)) continue;

          // Find matching model geometry
          for (const modelData of allMeshData) {
            if (modelData.modelId === entity.modelId || allMeshData.length === 1) {
              const globalExpressId = entity.expressId + modelData.idOffset;
              const bounds = getEntityBounds(
                modelData.meshes as Parameters<typeof getEntityBounds>[0],
                globalExpressId,
              );
              if (bounds) {
                entityBounds.set(boundsKey, bounds);
              }
              break;
            }
          }
        }
      }
    }

    // Phase 2: Batch snapshots if requested
    let entitySnapshots: Map<string, string> | undefined;

    if (includeSnapshots) {
      entitySnapshots = new Map();

      // Collect all entities that need snapshots
      const entitiesToSnapshot: Array<{ modelId: string; expressId: number; boundsKey: string }> = [];
      for (const specResult of report.specificationResults) {
        for (const entity of specResult.entityResults) {
          if (entity.passed && !includePassingEntities) continue;
          const boundsKey = `${entity.modelId}:${entity.expressId}`;
          if (!entitiesToSnapshot.some(e => e.boundsKey === boundsKey)) {
            entitiesToSnapshot.push({
              modelId: entity.modelId,
              expressId: entity.expressId,
              boundsKey,
            });
          }
        }
      }

      const total = entitiesToSnapshot.length;

      for (let i = 0; i < total; i++) {
        const entity = entitiesToSnapshot[i];
        setBcfExportProgress({
          phase: 'snapshots',
          current: i + 1,
          total,
          message: `Capturing snapshot ${i + 1}/${total}...`,
        });

        // Get the entity's bounds for framing
        const bounds = entityBounds?.get(entity.boundsKey);
        if (!bounds) continue;

        // Find the global expressId for isolation/selection
        let globalExpressId = entity.expressId;
        for (const [, model] of models.entries()) {
          if (model.id === entity.modelId) {
            globalExpressId = entity.expressId + (model.idOffset ?? 0);
            break;
          }
        }

        // Isolate entity + frame it + capture
        setIsolatedEntities(new Set([globalExpressId]));
        setSelectedEntityId(globalExpressId);

        // Frame the entity bounds and wait for animation
        if (cameraCallbacks?.frameSelection) {
          cameraCallbacks.frameSelection();
        }

        // Wait for render to settle (animation + GPU)
        await new Promise(resolve => setTimeout(resolve, 400));

        // Capture the canvas
        const canvas = globalThis.document.querySelector('canvas');
        if (canvas) {
          try {
            const dataUrl = canvas.toDataURL('image/png');
            entitySnapshots.set(entity.boundsKey, dataUrl);
          } catch {
            // Canvas capture failed (e.g., tainted canvas)
          }
        }
      }

      // Restore isolation/selection state
      setIsolatedEntities(null);
      setSelectedEntityId(null);
    }

    // Phase 3: Build BCF project
    setBcfExportProgress({ phase: 'writing', current: 0, total: 1, message: 'Building BCF project...' });

    const exportOptions: IDSBCFExportOptions = {
      author: bcfAuthor || report.document.info.author || 'ids-validator@ifc-lite',
      projectName: `IDS Report - ${report.document.info.title}`,
      topicGrouping,
      includePassingEntities,
      entityBounds,
      entitySnapshots,
    };

    const bcfProject = createBCFFromIDSReport(
      {
        title: report.document.info.title,
        description: report.document.info.description,
        specificationResults: report.specificationResults,
      },
      exportOptions,
    );

    // Phase 4: Write BCF and download
    setBcfExportProgress({ phase: 'writing', current: 1, total: 2, message: 'Writing BCF file...' });

    const blob = await writeBCF(bcfProject);
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = `ids-report-${new Date().toISOString().split('T')[0]}.bcf`;
    a.click();
    URL.revokeObjectURL(url);

    // Phase 5: Load into BCF panel if requested
    if (loadIntoBcfPanel) {
      setBcfProject(bcfProject);
      setBcfPanelVisible(true);
    }

    setBcfExportProgress({ phase: 'done', current: 1, total: 1, message: 'Export complete!' });

    // Clear progress after a delay
    setTimeout(() => setBcfExportProgress(null), 2000);
  }, [
    report,
    models,
    bcfAuthor,
    cameraCallbacks,
    setIsolatedEntities,
    setSelectedEntityId,
    setBcfProject,
    setBcfPanelVisible,
  ]);

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
    exportReportBCF,
    bcfExportProgress,
  };
}
