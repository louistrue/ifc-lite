/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Main BI Dashboard panel component
 *
 * Uses react-grid-layout for drag-drop chart arrangement,
 * integrates with Zustand store for state management,
 * and provides bidirectional sync with 3D viewer.
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import GridLayout, { type Layout, type LayoutItem } from 'react-grid-layout';
import {
  X, Settings, Download, Plus, Filter, FilterX, Link, Unlink, LayoutTemplate,
  Maximize2, Minimize2, PanelRight, PanelRightClose, EyeOff, Eye,
} from 'lucide-react';
import {
  BIDataAggregator,
  computeHighlightedKeys,
  type ChartInteractionEvent,
  type BIModelData,
  type AggregatedDataPoint,
  type EntityRef as BIEntityRef,
} from '@ifc-lite/bi';
import { extractQuantitiesOnDemand, EntityExtractor } from '@ifc-lite/parser';
import { useViewerStore, type EntityRef, type DashboardMode } from '../../store/index.js';
import { ChartCard } from './ChartCard.js';
import { ChartEditDialog } from './ChartEditDialog.js';
import { TemplateSelector } from './TemplateSelector.js';
import { Button } from '../ui/button.js';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Custom styles for resize handles
const gridLayoutStyles = `
  .react-grid-item > .react-resizable-handle {
    position: absolute;
    width: 20px;
    height: 20px;
    bottom: 0;
    right: 0;
    cursor: se-resize;
    z-index: 10;
  }
  .react-grid-item > .react-resizable-handle::after {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 8px;
    border-right: 2px solid rgba(0, 0, 0, 0.3);
    border-bottom: 2px solid rgba(0, 0, 0, 0.3);
  }
  .react-grid-item:hover > .react-resizable-handle::after {
    border-color: rgba(0, 0, 0, 0.6);
  }
`;

export function BIDashboard() {
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0); // Start at 0, measure before rendering grid
  const [editingChartId, setEditingChartId] = useState<string | null>(null);

  // Refs for stabilizing data and tracking initial load
  const prevBiModelsRef = useRef<BIModelData[]>([]);
  const hasLoadedDataRef = useRef(false);

  // Store state
  const isDashboardOpen = useViewerStore((state) => state.isDashboardOpen);
  const dashboardMode = useViewerStore((state) => state.dashboardMode);
  const activeDashboard = useViewerStore((state) => state.activeDashboard);
  const isEditMode = useViewerStore((state) => state.isEditMode);
  const chartFilters = useViewerStore((state) => state.chartFilters);
  const crossFilterEnabled = useViewerStore((state) => state.crossFilterEnabled);
  const hideNoneValues = useViewerStore((state) => state.hideNoneValues);
  const models = useViewerStore((state) => state.models);

  // Legacy single-model state (for backward compatibility)
  const legacyIfcDataStore = useViewerStore((state) => state.ifcDataStore);
  const legacyGeometryResult = useViewerStore((state) => state.geometryResult);

  // Selection state for bidirectional sync
  const selectedEntity = useViewerStore((state) => state.selectedEntity);
  const selectedEntities = useViewerStore((state) => state.selectedEntities);

  // Store actions
  const closeDashboard = useViewerStore((state) => state.closeDashboard);
  const toggleEditMode = useViewerStore((state) => state.toggleEditMode);
  const updateChartLayout = useViewerStore((state) => state.updateChartLayout);
  const setActiveDashboard = useViewerStore((state) => state.setActiveDashboard);
  const setDashboardMode = useViewerStore((state) => state.setDashboardMode);
  const setChartFilter = useViewerStore((state) => state.setChartFilter);
  const clearChartFilter = useViewerStore((state) => state.clearChartFilter);
  const clearAllFilters = useViewerStore((state) => state.clearAllFilters);
  const toggleCrossFilter = useViewerStore((state) => state.toggleCrossFilter);
  const toggleHideNoneValues = useViewerStore((state) => state.toggleHideNoneValues);
  const removeChart = useViewerStore((state) => state.removeChart);
  const updateChart = useViewerStore((state) => state.updateChart);
  const cacheChartData = useViewerStore((state) => state.cacheChartData);

  // Selection actions for bidirectional sync
  const setSelectedEntities = useViewerStore((state) => state.setSelectedEntities);
  const setSelectedEntityId = useViewerStore((state) => state.setSelectedEntityId);
  const clearEntitySelection = useViewerStore((state) => state.clearEntitySelection);

  // Visibility actions
  const isolateEntities = useViewerStore((state) => state.isolateEntities);
  const toGlobalId = useViewerStore((state) => state.toGlobalId);

  // Get chartDataCache for cross-filtering
  const chartDataCache = useViewerStore((state) => state.chartDataCache);

  // Measure container width for responsive layout
  useEffect(() => {
    if (!containerRef) return;

    // Measure width using clientWidth minus padding (p-4 = 16px each side)
    const measureWidth = () => {
      if (containerRef) {
        const width = containerRef.clientWidth - 32;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    };

    // Measure immediately when container is set
    measureWidth();

    // Use ResizeObserver for updates
    const resizeObserver = new ResizeObserver(() => {
      measureWidth();
    });

    resizeObserver.observe(containerRef);
    return () => resizeObserver.disconnect();
  }, [containerRef]);

  // Convert models to BIModelData format for aggregator
  const biModels = useMemo((): BIModelData[] => {
    const result: BIModelData[] = [];

    console.log('[BIDashboard] Converting models to BIModelData, models count:', models.size,
      'hasLegacy:', !!legacyIfcDataStore);

    // Helper to process a model (federated or legacy)
    const processModel = (
      modelId: string,
      dataStore: typeof legacyIfcDataStore,
      geometryResult: typeof legacyGeometryResult,
      idOffset: number
    ) => {
      if (!dataStore || !geometryResult) return;

      console.log('[BIDashboard] Processing model:', modelId, {
        hasDataStore: !!dataStore,
        hasEntities: !!dataStore?.entities,
        hasGeometry: !!geometryResult,
        meshCount: geometryResult?.meshes?.length ?? 0,
        idOffset,
      });

      // Get geometry express IDs
      // Note: mesh.expressId contains global ID (original + idOffset) if idOffset > 0
      // We need to convert back to original expressId for dataStore lookups
      const geometryExpressIds: number[] = [];
      if (geometryResult?.meshes) {
        const seenIds = new Set<number>();
        for (const mesh of geometryResult.meshes) {
          // Convert global ID back to original expressId
          const originalExpressId = mesh.expressId - idOffset;
          if (originalExpressId > 0 && !seenIds.has(originalExpressId)) {
            seenIds.add(originalExpressId);
            geometryExpressIds.push(originalExpressId);
          }
        }
      }

      // Debug: check if entity lookup works
      if (geometryExpressIds.length > 0) {
        const sampleId = geometryExpressIds[0];
        console.log('[BIDashboard] Sample entity lookup:', {
          expressId: sampleId,
          type: dataStore.entities?.getTypeName?.(sampleId),
          name: dataStore.entities?.getName?.(sampleId),
        });

        // Debug: check quantities and materials using on-demand extraction
        const sampleQuants = dataStore.onDemandQuantityMap
          ? extractQuantitiesOnDemand(dataStore, sampleId)
          : dataStore.quantities?.getForEntity?.(sampleId);
        const sampleMaterials = dataStore.relationships?.getRelated?.(
          sampleId,
          20, // AssociatesMaterial
          'inverse'
        );
        console.log('[BIDashboard] Sample quantities for', sampleId, ':', {
          hasQuantitiesTable: !!dataStore.quantities,
          hasOnDemandMap: !!dataStore.onDemandQuantityMap,
          onDemandMapSize: dataStore.onDemandQuantityMap?.size ?? 0,
          quantityCount: dataStore.quantities?.count ?? 0,
          sampleQuants,
          sampleMaterials,
        });
      }

      console.log('[BIDashboard] geometryExpressIds count:', geometryExpressIds.length,
        'sample ids:', geometryExpressIds.slice(0, 5));

      result.push({
        modelId,
        entities: {
          getType: (expressId: number) => dataStore.entities?.getTypeName?.(expressId),
          getName: (expressId: number) => dataStore.entities?.getName?.(expressId),
        },
        spatialHierarchy: dataStore.spatialHierarchy,
        properties: dataStore.properties
          ? {
              getForEntity: (expressId: number) => {
                const props = dataStore.properties?.getForEntity?.(expressId);
                return props as
                  | Array<{
                      name: string;
                      properties: Array<{ name: string; value: unknown }>;
                    }>
                  | undefined;
              },
            }
          : undefined,
        quantities: (dataStore.quantities || dataStore.onDemandQuantityMap)
          ? {
              getForEntity: (expressId: number) => {
                // Use on-demand extraction if available (WASM client-side parsing)
                // This is how PropertiesPanel gets quantities
                if (dataStore.onDemandQuantityMap) {
                  const quants = extractQuantitiesOnDemand(dataStore, expressId);
                  return quants.length > 0 ? quants : undefined;
                }
                // Fallback to pre-computed quantity table (server-parsed data)
                const quants = dataStore.quantities?.getForEntity?.(expressId);
                return quants as
                  | Array<{
                      name: string;
                      quantities: Array<{ name: string; type: number; value: number }>;
                    }>
                  | undefined;
              },
            }
          : undefined,
        relationships: dataStore.relationships
          ? {
              getMaterials: (expressId: number) => {
                // Get materials via relationship graph (inverse direction - entity is the target)
                const rels = dataStore.relationships?.getRelated?.(
                  expressId,
                  20, // AssociatesMaterial
                  'inverse'
                );
                if (!rels || rels.length === 0) return undefined;

                // Helper to extract material name on-demand from source buffer
                const getMaterialName = (materialId: number): string => {
                  // First try entity table (might have name for some types)
                  const tableName = dataStore.entities?.getName?.(materialId);
                  if (tableName) return tableName;

                  // Extract on-demand from source buffer
                  const ref = dataStore.entityIndex?.byId?.get(materialId);
                  if (!ref || !dataStore.source) return 'Unknown';

                  const extractor = new EntityExtractor(dataStore.source);
                  const entity = extractor.extractEntity(ref);
                  if (!entity) return 'Unknown';

                  const attrs = entity.attributes || [];
                  const typeUpper = entity.type.toUpperCase();

                  // Different material types have name at different positions
                  // IfcMaterial: Name[0]
                  // IfcMaterialLayerSet: MaterialLayers[0], LayerSetName[1]
                  // IfcMaterialLayerSetUsage: ForLayerSet[0] (reference)
                  // IfcMaterialList: Materials[0] (list of refs)
                  if (typeUpper === 'IFCMATERIAL') {
                    return typeof attrs[0] === 'string' ? attrs[0] : 'Unnamed Material';
                  } else if (typeUpper === 'IFCMATERIALLAYERSET') {
                    return typeof attrs[1] === 'string' ? attrs[1] : 'Layer Set';
                  } else if (typeUpper === 'IFCMATERIALLAYERSETUSAGE') {
                    // This references a LayerSet - recurse
                    const layerSetRef = typeof attrs[0] === 'number' ? attrs[0] : null;
                    if (layerSetRef) return getMaterialName(layerSetRef);
                    return 'Layer Set Usage';
                  } else if (typeUpper === 'IFCMATERIALCONSTITUENTSET') {
                    return typeof attrs[0] === 'string' ? attrs[0] : 'Constituent Set';
                  } else if (typeUpper === 'IFCMATERIALPROFILESET') {
                    return typeof attrs[0] === 'string' ? attrs[0] : 'Profile Set';
                  } else if (typeUpper === 'IFCMATERIALLIST') {
                    // IfcMaterialList has Materials[0] as array of material refs
                    // Get names of all materials and join them
                    const materialsAttr = attrs[0];
                    if (Array.isArray(materialsAttr) && materialsAttr.length > 0) {
                      const materialNames = materialsAttr
                        .filter((ref): ref is number => typeof ref === 'number')
                        .slice(0, 3) // Limit to first 3 to avoid very long names
                        .map(ref => getMaterialName(ref));
                      if (materialNames.length > 0) {
                        const suffix = materialsAttr.length > 3 ? ` +${materialsAttr.length - 3}` : '';
                        return materialNames.join(', ') + suffix;
                      }
                    }
                    return 'Material List';
                  }
                  return entity.type;
                };

                return rels.map((r: number) => ({
                  name: getMaterialName(r),
                  expressId: r,
                }));
              },
              getClassifications: (expressId: number) => {
                // Get classifications via relationship graph (inverse direction)
                const rels = dataStore.relationships?.getRelated?.(
                  expressId,
                  30, // AssociatesClassification
                  'inverse'
                );
                if (!rels || rels.length === 0) return undefined;
                return rels.map((r: number) => ({
                  name: dataStore.entities?.getName?.(r) ?? 'Unknown',
                  expressId: r,
                }));
              },
            }
          : undefined,
        geometryExpressIds,
      });
    };

    // Process federated models from the Map
    for (const [modelId, model] of models) {
      processModel(modelId, model.ifcDataStore, model.geometryResult, model.idOffset ?? 0);
    }

    // Fallback to legacy single-model state if no federated models
    if (result.length === 0 && legacyIfcDataStore && legacyGeometryResult) {
      console.log('[BIDashboard] Using legacy single-model fallback');
      processModel('__legacy__', legacyIfcDataStore, legacyGeometryResult, 0);
    }

    // Stabilize: return previous ref if model data hasn't actually changed
    // This prevents cascading recomputations when store references change
    const prev = prevBiModelsRef.current;
    if (result.length === prev.length && result.length > 0) {
      const isSame = result.every((m, i) =>
        m.modelId === prev[i]?.modelId &&
        m.geometryExpressIds.length === prev[i]?.geometryExpressIds.length
      );
      if (isSame) {
        console.log('[BIDashboard] biModels unchanged, returning stable ref');
        return prev;
      }
    }

    // Track that we've loaded data for animation control
    if (result.length > 0) {
      hasLoadedDataRef.current = true;
    }

    prevBiModelsRef.current = result;
    return result;
  }, [models, legacyIfcDataStore, legacyGeometryResult]);

  // Create aggregator
  const aggregator = useMemo(() => {
    return new BIDataAggregator(biModels);
  }, [biModels]);

  // Collect cross-filter entity refs from all active chart filters
  const crossFilterEntityRefs = useMemo(() => {
    if (!crossFilterEnabled || chartFilters.size === 0) return null;

    const allRefs = new Set<string>();
    for (const [chartId, keys] of chartFilters) {
      if (keys.size === 0) continue;

      // Get cached data for this chart to find entity refs
      const cachedData = chartDataCache.get(chartId);
      if (!cachedData) continue;

      for (const key of keys) {
        const refs = cachedData.get(key);
        if (refs) {
          for (const ref of refs) {
            allRefs.add(`${ref.modelId}:${ref.expressId}`);
          }
        }
      }
    }

    return allRefs.size > 0 ? allRefs : null;
  }, [crossFilterEnabled, chartFilters, chartDataCache]);

  // Helper to check if a data point represents a "none" value
  const isNoneValue = useCallback((key: string, label: string): boolean => {
    const lowerKey = key.toLowerCase();
    const lowerLabel = label.toLowerCase();
    // Match patterns like "No Material", "No Storey", "Unknown", "Unassigned", "N/A", etc.
    return (
      lowerKey.startsWith('no ') ||
      lowerLabel.startsWith('no ') ||
      lowerKey === 'unknown' ||
      lowerLabel === 'unknown' ||
      lowerKey === 'unassigned' ||
      lowerLabel === 'unassigned' ||
      lowerKey === 'n/a' ||
      lowerLabel === 'n/a' ||
      lowerKey === 'none' ||
      lowerLabel === 'none'
    );
  }, []);

  // Compute data for all charts (with cross-filtering applied via aggregator)
  const chartData = useMemo(() => {
    if (!activeDashboard) return new Map<string, AggregatedDataPoint[]>();
    // Skip computation if no model data available - prevents double-load visual flicker
    if (biModels.length === 0) return new Map<string, AggregatedDataPoint[]>();

    console.log('[BIDashboard] Computing chart data for', activeDashboard.charts.length, 'charts');
    console.log('[BIDashboard] biModels available:', biModels.length);
    console.log('[BIDashboard] crossFilterEntityRefs:', crossFilterEntityRefs?.size ?? 0);

    const data = new Map<string, AggregatedDataPoint[]>();
    for (const chart of activeDashboard.charts) {
      try {
        // Determine if this chart is the source of the filter
        const chartHasFilter = chartFilters.has(chart.id) && (chartFilters.get(chart.id)?.size ?? 0) > 0;

        // Build aggregation config with entity filter for cross-filtering
        // Source chart gets full data, other charts get filtered data
        const aggregationConfig = {
          ...chart.aggregation,
          entityFilter: (crossFilterEntityRefs && !chartHasFilter) ? crossFilterEntityRefs : undefined,
        };

        const result = aggregator.aggregate(aggregationConfig);

        // Filter out "none" values if hideNoneValues is enabled
        const filteredData = hideNoneValues
          ? result.data.filter((point) => !isNoneValue(point.key, point.label))
          : result.data;

        console.log('[BIDashboard] Chart', chart.title, 'aggregation result:', {
          dataPoints: result.data.length,
          filteredDataPoints: filteredData.length,
          totalEntities: result.totalEntities,
          totalValue: result.totalValue,
          filtered: !!aggregationConfig.entityFilter,
          computeTimeMs: result.computeTimeMs,
        });

        data.set(chart.id, filteredData);
      } catch (err) {
        // If aggregation fails, provide empty data
        console.error('[BIDashboard] Aggregation failed for chart', chart.title, err);
        data.set(chart.id, []);
      }
    }
    return data;
  }, [activeDashboard, aggregator, biModels.length, crossFilterEntityRefs, chartFilters, hideNoneValues, isNoneValue]);

  // Cache chart data for cross-filtering (separate effect to avoid infinite loop)
  // We only cache when there's NO active cross-filter (i.e., full unfiltered data)
  useEffect(() => {
    if (!activeDashboard || crossFilterEntityRefs) return;

    for (const [chartId, data] of chartData) {
      cacheChartData(chartId, data);
    }
  }, [activeDashboard, chartData, crossFilterEntityRefs, cacheChartData]);

  // Compute highlighted keys from 3D selection
  const highlightedKeysByChart = useMemo(() => {
    const result = new Map<string, Set<string>>();
    if (!activeDashboard) return result;

    // Get all selected entities
    const allSelected: EntityRef[] = [];
    if (selectedEntity) {
      allSelected.push(selectedEntity);
    }
    if (selectedEntities.length > 0) {
      allSelected.push(...selectedEntities);
    }

    if (allSelected.length === 0) return result;

    // For each chart, compute which keys should be highlighted
    for (const chart of activeDashboard.charts) {
      const data = chartData.get(chart.id);
      if (data) {
        const highlighted = computeHighlightedKeys(data, allSelected);
        result.set(chart.id, highlighted);
      }
    }

    return result;
  }, [activeDashboard, selectedEntity, selectedEntities, chartData]);

  // Calculate grid columns based on mode - must be before layout useMemo that uses it
  const gridCols = dashboardMode === 'sidebar' ? 6 : 12;

  // Grid layout from chart configs - scale for sidebar mode
  // Templates are designed for 12 columns, scale to 6 for sidebar
  const layout = useMemo(() => {
    if (!activeDashboard) return [];

    const baseCols = 12;
    const scale = gridCols / baseCols;

    return activeDashboard.charts.map((chart) => {
      const originalLayout = chart.layout;

      if (scale === 1) {
        // Full-size mode - use original layout
        return {
          i: chart.id,
          x: originalLayout.x,
          y: originalLayout.y,
          w: originalLayout.w,
          h: originalLayout.h,
          minW: originalLayout.minW ?? 2,
          minH: originalLayout.minH ?? 2,
        };
      }

      // Sidebar mode - scale and reflow layouts
      // Scale width, ensure at least 3 columns and max of gridCols
      const scaledW = Math.max(3, Math.min(gridCols, Math.round(originalLayout.w * scale)));
      // In sidebar, stack charts vertically (x=0) since width is limited
      // Each chart takes full width or half if it fits
      const scaledX = scaledW >= gridCols ? 0 : (originalLayout.x >= baseCols / 2 ? gridCols - scaledW : 0);

      return {
        i: chart.id,
        x: scaledX,
        y: originalLayout.y, // Keep y position, react-grid-layout will reflow
        w: scaledW,
        h: originalLayout.h,
        minW: Math.min(originalLayout.minW ?? 2, gridCols),
        minH: originalLayout.minH ?? 2,
      };
    });
  }, [activeDashboard, gridCols]);

  // Handle layout change from drag/resize
  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      for (const item of newLayout) {
        updateChartLayout(item.i, {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        });
      }
    },
    [updateChartLayout]
  );

  // Handle chart interaction (selection, hover)
  const handleChartInteraction = useCallback(
    (event: ChartInteractionEvent) => {
      const { type, chartId, dataPoint, modifiers } = event;

      if (type === 'hover') {
        // Hover is handled by highlighting in charts
        // Could add 3D hover highlighting here if desired
        return;
      }

      if (type === 'select' && dataPoint) {
        // Get entity refs from data point
        const entityRefs = dataPoint.entityRefs;

        if (entityRefs.length === 0) return;

        if (modifiers.alt) {
          // Alt+click: Isolate these entities
          // Convert to global IDs for the legacy isolate function
          const globalIds: number[] = [];
          for (const ref of entityRefs) {
            if (toGlobalId) {
              const gid = toGlobalId(ref.modelId, ref.expressId);
              if (gid !== null) {
                globalIds.push(gid);
              }
            }
          }
          if (globalIds.length > 0) {
            isolateEntities(globalIds);
          }
        } else if (modifiers.shift) {
          // Shift+click: Add to selection (for now, just replace)
          setSelectedEntities(entityRefs);
          if (entityRefs.length > 0 && toGlobalId) {
            const firstRef = entityRefs[0];
            const globalId = toGlobalId(firstRef.modelId, firstRef.expressId);
            if (globalId !== null) {
              setSelectedEntityId(globalId);
            }
          }
        } else {
          // Normal click: Select these entities
          setSelectedEntities(entityRefs);
          if (entityRefs.length > 0 && toGlobalId) {
            const firstRef = entityRefs[0];
            const globalId = toGlobalId(firstRef.modelId, firstRef.expressId);
            if (globalId !== null) {
              setSelectedEntityId(globalId);
            }
          }
        }

        // Also set chart filter for cross-filtering
        if (crossFilterEnabled) {
          setChartFilter(chartId, new Set([dataPoint.key]));
        }
      }
    },
    [
      crossFilterEnabled,
      setChartFilter,
      setSelectedEntities,
      setSelectedEntityId,
      toGlobalId,
      isolateEntities,
    ]
  );

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const keys of chartFilters.values()) {
      if (keys.size > 0) count++;
    }
    return count;
  }, [chartFilters]);

  // Calculate container classes based on mode
  // IMPORTANT: This must be before early returns to follow React's rules of hooks
  const containerClasses = useMemo(() => {
    switch (dashboardMode) {
      case 'sidebar':
        return 'absolute right-0 top-12 bottom-0 w-[450px] bg-background z-40 flex flex-col border-l shadow-lg';
      case 'minimized':
        return 'absolute right-4 bottom-4 w-80 h-12 bg-background z-40 flex items-center rounded-lg border shadow-lg';
      case 'fullscreen':
      default:
        return 'absolute inset-x-0 top-12 bottom-0 bg-background z-40 flex flex-col';
    }
  }, [dashboardMode]);

  if (!isDashboardOpen) return null;

  // No dashboard loaded - show template selector
  if (!activeDashboard) {
    return (
      <div className="absolute inset-x-0 top-12 bottom-0 bg-background/95 z-40 flex items-center justify-center backdrop-blur-sm">
        <div className="max-w-3xl w-full p-6 bg-background border rounded-xl shadow-lg">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">BI Dashboard</h2>
            <Button variant="ghost" size="icon" onClick={closeDashboard}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <TemplateSelector />
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Inject custom resize handle styles */}
      <style>{gridLayoutStyles}</style>

      {/* Minimized mode - just show a bar to expand */}
      {dashboardMode === 'minimized' && (
        <div className="flex items-center justify-between w-full px-4">
          <span className="text-sm font-medium">{activeDashboard.name}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDashboardMode('sidebar')}
              title="Open as sidebar"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDashboardMode('fullscreen')}
              title="Open fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeDashboard}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Full/Sidebar mode */}
      {dashboardMode !== 'minimized' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50 shrink-0">
            <div className="flex items-center gap-4">
              <h2 className={dashboardMode === 'sidebar' ? 'text-sm font-semibold' : 'text-lg font-semibold'}>
                {activeDashboard.name}
              </h2>
              {activeFilterCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs">
                <Filter className="h-3 w-3" />
                {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-7 text-xs"
              >
                <FilterX className="h-3 w-3 mr-1" />
                Clear all
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveDashboard(null)}
            title="Switch to a different dashboard template"
          >
            <LayoutTemplate className="h-4 w-4 mr-1" />
            Switch Template
          </Button>
          <Button
            variant={crossFilterEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={toggleCrossFilter}
            title={crossFilterEnabled ? 'Cross-filtering enabled' : 'Cross-filtering disabled'}
          >
            {crossFilterEnabled ? (
              <Link className="h-4 w-4 mr-1" />
            ) : (
              <Unlink className="h-4 w-4 mr-1" />
            )}
            Cross-filter
          </Button>
          <Button
            variant={hideNoneValues ? 'default' : 'outline'}
            size="sm"
            onClick={toggleHideNoneValues}
            title={hideNoneValues ? 'Currently hiding "No Material", "Unknown", etc. Click to show all.' : 'Click to hide entries without values (No Material, Unknown, etc.)'}
          >
            {hideNoneValues ? (
              <EyeOff className="h-4 w-4 mr-1" />
            ) : (
              <Eye className="h-4 w-4 mr-1" />
            )}
            Hide Empty
          </Button>
          <Button
            variant={isEditMode ? 'default' : 'outline'}
            size="sm"
            onClick={toggleEditMode}
          >
            <Settings className="h-4 w-4 mr-1" />
            {isEditMode ? 'Done' : 'Edit'}
          </Button>

          {/* Mode switching buttons */}
          <div className="flex items-center border-l pl-2 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDashboardMode('minimized')}
              title="Minimize dashboard"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
            <Button
              variant={dashboardMode === 'sidebar' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setDashboardMode(dashboardMode === 'sidebar' ? 'fullscreen' : 'sidebar')}
              title={dashboardMode === 'sidebar' ? 'Expand to fullscreen' : 'Dock to sidebar'}
            >
              {dashboardMode === 'sidebar' ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRight className="h-4 w-4" />
              )}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeDashboard}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Chart Grid */}
      <div ref={setContainerRef} className="flex-1 overflow-auto p-4">
        {/* Only render grid once we have measured the container width */}
        {containerWidth > 0 && (
          <GridLayout
            className="layout"
            layout={layout}
            width={containerWidth}
            gridConfig={{
              cols: gridCols,
              rowHeight: dashboardMode === 'sidebar' ? 80 : 100,
              margin: dashboardMode === 'sidebar' ? [8, 8] as const : [16, 16] as const,
              maxRows: Infinity,
              containerPadding: null,
            }}
            dragConfig={{
              enabled: isEditMode,
              handle: '.cursor-move',
              bounded: false,
              threshold: 3,
            }}
            resizeConfig={{
              enabled: isEditMode,
              handles: ['se'],
            }}
            onLayoutChange={handleLayoutChange}
          >
            {activeDashboard.charts.map((chart) => (
              <div key={chart.id}>
                <ChartCard
                  config={chart}
                  data={chartData.get(chart.id) ?? []}
                  selectedKeys={chartFilters.get(chart.id) ?? new Set()}
                  highlightedKeys={highlightedKeysByChart.get(chart.id) ?? new Set()}
                  onInteraction={handleChartInteraction}
                  onRemove={removeChart}
                  onEdit={setEditingChartId}
                  onClearFilter={clearChartFilter}
                  isEditMode={isEditMode}
                  hasFilter={(chartFilters.get(chart.id)?.size ?? 0) > 0}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

          {/* Chart Edit Dialog */}
          {editingChartId && activeDashboard && (
            <ChartEditDialog
              config={activeDashboard.charts.find((c) => c.id === editingChartId)!}
              onSave={(updates) => updateChart(editingChartId, updates)}
              onClose={() => setEditingChartId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

export default BIDashboard;
