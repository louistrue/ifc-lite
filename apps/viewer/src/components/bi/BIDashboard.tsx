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
import { X, Settings, Download, Plus, Filter, FilterX, Link, Unlink, LayoutTemplate } from 'lucide-react';
import {
  BIDataAggregator,
  computeHighlightedKeys,
  type ChartInteractionEvent,
  type BIModelData,
  type AggregatedDataPoint,
} from '@ifc-lite/bi';
import { useViewerStore, type EntityRef } from '../../store/index.js';
import { ChartCard } from './ChartCard.js';
import { TemplateSelector } from './TemplateSelector.js';
import { Button } from '../ui/button.js';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

export function BIDashboard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  // Store state
  const isDashboardOpen = useViewerStore((state) => state.isDashboardOpen);
  const activeDashboard = useViewerStore((state) => state.activeDashboard);
  const isEditMode = useViewerStore((state) => state.isEditMode);
  const chartFilters = useViewerStore((state) => state.chartFilters);
  const crossFilterEnabled = useViewerStore((state) => state.crossFilterEnabled);
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
  const setChartFilter = useViewerStore((state) => state.setChartFilter);
  const clearChartFilter = useViewerStore((state) => state.clearChartFilter);
  const clearAllFilters = useViewerStore((state) => state.clearAllFilters);
  const toggleCrossFilter = useViewerStore((state) => state.toggleCrossFilter);
  const removeChart = useViewerStore((state) => state.removeChart);
  const cacheChartData = useViewerStore((state) => state.cacheChartData);

  // Selection actions for bidirectional sync
  const setSelectedEntities = useViewerStore((state) => state.setSelectedEntities);
  const setSelectedEntityId = useViewerStore((state) => state.setSelectedEntityId);
  const clearEntitySelection = useViewerStore((state) => state.clearEntitySelection);

  // Visibility actions
  const isolateEntities = useViewerStore((state) => state.isolateEntities);
  const toGlobalId = useViewerStore((state) => state.toGlobalId);

  // Measure container width for responsive layout
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

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

        // Debug: check quantities and materials
        const sampleQuants = dataStore.quantities?.getForEntity?.(sampleId);
        const sampleMaterials = dataStore.relationships?.getRelated?.(
          sampleId,
          20, // AssociatesMaterial
          'inverse'
        );
        console.log('[BIDashboard] Sample quantities for', sampleId, ':', {
          hasQuantitiesTable: !!dataStore.quantities,
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
        quantities: dataStore.quantities
          ? {
              getForEntity: (expressId: number) => {
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
                return rels.map((r: number) => ({
                  name: dataStore.entities?.getName?.(r) ?? 'Unknown',
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

    return result;
  }, [models, legacyIfcDataStore, legacyGeometryResult]);

  // Create aggregator
  const aggregator = useMemo(() => {
    return new BIDataAggregator(biModels);
  }, [biModels]);

  // Compute data for all charts
  const chartData = useMemo(() => {
    if (!activeDashboard) return new Map<string, AggregatedDataPoint[]>();

    console.log('[BIDashboard] Computing chart data for', activeDashboard.charts.length, 'charts');
    console.log('[BIDashboard] biModels available:', biModels.length);

    const data = new Map<string, AggregatedDataPoint[]>();
    for (const chart of activeDashboard.charts) {
      try {
        const result = aggregator.aggregate(chart.aggregation);
        console.log('[BIDashboard] Chart', chart.title, 'aggregation result:', {
          dataPoints: result.data.length,
          totalEntities: result.totalEntities,
          totalValue: result.totalValue,
          computeTimeMs: result.computeTimeMs,
        });
        data.set(chart.id, result.data);
        // Cache for bidirectional sync
        cacheChartData(chart.id, result.data);
      } catch (err) {
        // If aggregation fails, provide empty data
        console.error('[BIDashboard] Aggregation failed for chart', chart.title, err);
        data.set(chart.id, []);
      }
    }
    return data;
  }, [activeDashboard, aggregator, biModels.length, cacheChartData]);

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

  // Grid layout from chart configs
  const layout = useMemo(() => {
    if (!activeDashboard) return [];
    return activeDashboard.charts.map((chart) => ({
      i: chart.id,
      x: chart.layout.x,
      y: chart.layout.y,
      w: chart.layout.w,
      h: chart.layout.h,
      minW: chart.layout.minW ?? 2,
      minH: chart.layout.minH ?? 2,
    }));
  }, [activeDashboard]);

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
    <div className="absolute inset-x-0 top-12 bottom-0 bg-background z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">{activeDashboard.name}</h2>
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
            variant={isEditMode ? 'default' : 'outline'}
            size="sm"
            onClick={toggleEditMode}
          >
            <Settings className="h-4 w-4 mr-1" />
            {isEditMode ? 'Done' : 'Edit'}
          </Button>
          <Button variant="ghost" size="icon" onClick={closeDashboard}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Chart Grid */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4">
        <GridLayout
          className="layout"
          layout={layout}
          width={containerWidth - 32}
          gridConfig={{
            cols: 12,
            rowHeight: 100,
            margin: [16, 16] as const,
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
                onClearFilter={clearChartFilter}
                isEditMode={isEditMode}
                hasFilter={(chartFilters.get(chart.id)?.size ?? 0) > 0}
              />
            </div>
          ))}
        </GridLayout>
      </div>
    </div>
  );
}

export default BIDashboard;
