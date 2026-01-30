/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Data aggregation engine for BI Dashboard
 *
 * Aggregates IFC model data across multiple federated models
 * for visualization in charts.
 */

import type { QuantityType, SpatialHierarchy, SpatialNode } from '@ifc-lite/data';
import type {
  AggregationConfig,
  AggregatedDataPoint,
  AggregationResult,
  GroupByDimension,
  QuantityField,
  DataFilter,
  EntityRef,
} from './types.js';

// ============================================================================
// Model Interface (minimal contract to avoid viewer dependency)
// ============================================================================

export interface BIModelData {
  modelId: string;
  entities: {
    getType(expressId: number): string | undefined;
    getName(expressId: number): string | undefined;
  };
  spatialHierarchy?: SpatialHierarchy;
  properties?: {
    getForEntity(expressId: number): PropertySet[] | undefined;
  };
  quantities?: {
    getForEntity(expressId: number): QuantitySet[] | undefined;
  };
  relationships?: {
    getMaterials(expressId: number): MaterialRef[] | undefined;
    getClassifications(expressId: number): ClassificationRef[] | undefined;
  };
  geometryExpressIds: number[];
}

export interface PropertySet {
  name: string;
  properties: Array<{ name: string; value: unknown }>;
}

export interface QuantitySet {
  name: string;
  quantities: Array<{ name: string; type: QuantityType; value: number }>;
}

export interface MaterialRef {
  name: string;
  expressId: number;
}

export interface ClassificationRef {
  name: string;
  expressId: number;
}

// ============================================================================
// Aggregator Class
// ============================================================================

export class BIDataAggregator {
  private cache = new Map<string, AggregationResult>();
  private cacheVersion = 0;

  constructor(private models: BIModelData[]) {}

  /**
   * Update models and invalidate cache
   */
  updateModels(models: BIModelData[]): void {
    this.models = models;
    this.invalidateCache();
  }

  /**
   * Invalidate cache when models change
   */
  invalidateCache(): void {
    this.cache.clear();
    this.cacheVersion++;
  }

  /**
   * Main aggregation entry point
   */
  aggregate(config: AggregationConfig): AggregationResult {
    const cacheKey = this.buildCacheKey(config);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const startTime = performance.now();

    // Collect all entities across models
    const entities = this.collectEntities(config.preFilter);

    // Group entities by dimension
    const groups = this.groupEntities(entities, config.groupBy, config.propertyPath);

    // Aggregate each group
    const data = this.aggregateGroups(groups, config);

    // Sort results
    const sortedData = this.sortResults(data);

    const result: AggregationResult = {
      data: sortedData,
      totalEntities: entities.length,
      totalValue: sortedData.reduce((sum, d) => sum + d.value, 0),
      cacheKey,
      computeTimeMs: performance.now() - startTime,
    };

    // Cache result
    this.cache.set(cacheKey, result);

    return result;
  }

  /**
   * Build cache key from config
   */
  private buildCacheKey(config: AggregationConfig): string {
    return `${this.cacheVersion}-${JSON.stringify(config)}`;
  }

  /**
   * Collect entities from all models, applying optional filter
   */
  private collectEntities(
    filter?: DataFilter
  ): Array<{
    ref: EntityRef;
    model: BIModelData;
    expressId: number;
  }> {
    const entities: Array<{
      ref: EntityRef;
      model: BIModelData;
      expressId: number;
    }> = [];

    for (const model of this.models) {
      for (const expressId of model.geometryExpressIds) {
        // Apply pre-filter if specified
        if (filter && !this.passesFilter(model, expressId, filter)) {
          continue;
        }

        entities.push({
          ref: { modelId: model.modelId, expressId },
          model,
          expressId,
        });
      }
    }

    return entities;
  }

  /**
   * Check if entity passes filter
   */
  private passesFilter(model: BIModelData, expressId: number, filter: DataFilter): boolean {
    const key = this.getGroupKey(model, expressId, filter.dimension);
    const matches = filter.values.includes(key);
    return filter.exclude ? !matches : matches;
  }

  /**
   * Group entities by the specified dimension
   */
  private groupEntities(
    entities: Array<{ ref: EntityRef; model: BIModelData; expressId: number }>,
    groupBy: GroupByDimension,
    propertyPath?: string
  ): Map<string, Array<{ ref: EntityRef; model: BIModelData; expressId: number }>> {
    const groups = new Map<string, typeof entities>();

    for (const entity of entities) {
      const key = this.getGroupKey(entity.model, entity.expressId, groupBy, propertyPath);

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(entity);
    }

    return groups;
  }

  /**
   * Get the grouping key for an entity
   */
  private getGroupKey(
    model: BIModelData,
    expressId: number,
    groupBy: GroupByDimension,
    propertyPath?: string
  ): string {
    switch (groupBy) {
      case 'ifcType': {
        const type = model.entities.getType(expressId);
        return type ?? 'Unknown';
      }

      case 'storey': {
        const storeyId = model.spatialHierarchy?.elementToStorey.get(expressId);
        if (storeyId !== undefined) {
          const storeyName = model.entities.getName(storeyId);
          return storeyName ?? `Storey ${storeyId}`;
        }
        return 'Unassigned';
      }

      case 'building': {
        const storeyId = model.spatialHierarchy?.elementToStorey.get(expressId);
        if (storeyId !== undefined && model.spatialHierarchy) {
          const path = model.spatialHierarchy.getPath(storeyId);
          const building = path.find((n: SpatialNode) => n.type === 3); // IfcBuilding type enum
          if (building) {
            return building.name || 'Unknown Building';
          }
        }
        return 'Unassigned';
      }

      case 'site': {
        const storeyId = model.spatialHierarchy?.elementToStorey.get(expressId);
        if (storeyId !== undefined && model.spatialHierarchy) {
          const path = model.spatialHierarchy.getPath(storeyId);
          const site = path.find((n: SpatialNode) => n.type === 2); // IfcSite type enum
          if (site) {
            return site.name || 'Unknown Site';
          }
        }
        return 'Unassigned';
      }

      case 'material': {
        const materials = model.relationships?.getMaterials(expressId);
        if (materials && materials.length > 0) {
          return materials[0].name || 'Unnamed Material';
        }
        return 'No Material';
      }

      case 'classification': {
        const classifications = model.relationships?.getClassifications(expressId);
        if (classifications && classifications.length > 0) {
          return classifications[0].name || 'Unclassified';
        }
        return 'Unclassified';
      }

      case 'property': {
        if (!propertyPath) return 'Undefined';
        const value = this.getPropertyValue(model, expressId, propertyPath);
        if (value === null || value === undefined) return 'Undefined';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        return String(value);
      }

      default:
        return 'Unknown';
    }
  }

  /**
   * Get a property value by path (e.g., "Pset_WallCommon.IsExternal")
   */
  private getPropertyValue(model: BIModelData, expressId: number, propertyPath: string): unknown {
    const [psetName, propName] = propertyPath.split('.');
    const propertySets = model.properties?.getForEntity(expressId);

    if (!propertySets) return null;

    for (const pset of propertySets) {
      if (pset.name === psetName) {
        for (const prop of pset.properties) {
          if (prop.name === propName) {
            return prop.value;
          }
        }
      }
    }

    return null;
  }

  /**
   * Aggregate groups into data points
   */
  private aggregateGroups(
    groups: Map<string, Array<{ ref: EntityRef; model: BIModelData; expressId: number }>>,
    config: AggregationConfig
  ): AggregatedDataPoint[] {
    const results: AggregatedDataPoint[] = [];

    for (const [key, entities] of groups) {
      let value: number;

      if (config.metric === 'count') {
        value = entities.length;
      } else {
        // Need to aggregate a quantity
        const values = entities
          .map((e) => this.getQuantityValue(e.model, e.expressId, config.quantityField!))
          .filter((v): v is number => v !== null);

        if (values.length === 0) {
          value = 0;
        } else {
          switch (config.metric) {
            case 'sum':
              value = values.reduce((a, b) => a + b, 0);
              break;
            case 'avg':
              value = values.reduce((a, b) => a + b, 0) / values.length;
              break;
            case 'min':
              value = Math.min(...values);
              break;
            case 'max':
              value = Math.max(...values);
              break;
            default:
              value = 0;
          }
        }
      }

      results.push({
        key,
        label: this.formatLabel(key, config.groupBy),
        value,
        entityRefs: entities.map((e) => e.ref),
      });
    }

    return results;
  }

  /**
   * Get quantity value for an entity
   */
  private getQuantityValue(
    model: BIModelData,
    expressId: number,
    field: QuantityField
  ): number | null {
    const quantitySets = model.quantities?.getForEntity(expressId);
    if (!quantitySets) return null;

    // Map field name to QuantityType enum
    const fieldToType: Record<QuantityField, number> = {
      length: 0, // QuantityType.Length
      area: 1, // QuantityType.Area
      volume: 2, // QuantityType.Volume
      count: 3, // QuantityType.Count
      weight: 4, // QuantityType.Weight
    };

    const targetType = fieldToType[field];

    for (const qset of quantitySets) {
      for (const q of qset.quantities) {
        if (q.type === targetType) {
          return q.value;
        }
        // Also check by name as fallback
        if (q.name.toLowerCase().includes(field)) {
          return q.value;
        }
      }
    }

    return null;
  }

  /**
   * Format label for display
   */
  private formatLabel(key: string, groupBy: GroupByDimension): string {
    // Remove "Ifc" prefix for type names
    if (groupBy === 'ifcType' && key.startsWith('Ifc')) {
      return key.substring(3);
    }
    return key;
  }

  /**
   * Sort results by value descending
   */
  private sortResults(data: AggregatedDataPoint[]): AggregatedDataPoint[] {
    return [...data].sort((a, b) => b.value - a.value);
  }

  // ============================================================================
  // Convenience Methods for Common Aggregations
  // ============================================================================

  /**
   * Get element count grouped by IFC type
   */
  getElementsByType(): AggregationResult {
    return this.aggregate({ groupBy: 'ifcType', metric: 'count' });
  }

  /**
   * Get element count grouped by storey
   */
  getElementsByStorey(): AggregationResult {
    return this.aggregate({ groupBy: 'storey', metric: 'count' });
  }

  /**
   * Get total area grouped by storey
   */
  getAreaByStorey(): AggregationResult {
    return this.aggregate({ groupBy: 'storey', metric: 'sum', quantityField: 'area' });
  }

  /**
   * Get total volume grouped by material
   */
  getVolumeByMaterial(): AggregationResult {
    return this.aggregate({ groupBy: 'material', metric: 'sum', quantityField: 'volume' });
  }

  /**
   * Build hierarchical data for sunburst chart (Project -> Site -> Building -> Storey)
   */
  buildSpatialHierarchy(): AggregatedDataPoint[] {
    // Get first model with spatial hierarchy
    const modelWithHierarchy = this.models.find((m) => m.spatialHierarchy?.project);
    if (!modelWithHierarchy?.spatialHierarchy) {
      return [];
    }

    const hierarchy = modelWithHierarchy.spatialHierarchy;
    return this.buildHierarchyNode(hierarchy.project, modelWithHierarchy.modelId);
  }

  private buildHierarchyNode(node: SpatialNode, modelId: string): AggregatedDataPoint[] {
    const result: AggregatedDataPoint = {
      key: String(node.expressId),
      label: node.name || `Node ${node.expressId}`,
      value: node.elements.length,
      entityRefs: node.elements.map((id) => ({ modelId, expressId: id })),
      children: [],
    };

    for (const child of node.children) {
      const childData = this.buildHierarchyNode(child, modelId);
      if (childData.length > 0) {
        result.children!.push(childData[0]);
      }
    }

    return [result];
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute which chart keys should be highlighted based on 3D selection
 */
export function computeHighlightedKeys(
  data: AggregatedDataPoint[],
  selectedEntities: EntityRef[]
): Set<string> {
  const highlighted = new Set<string>();

  if (selectedEntities.length === 0) return highlighted;

  // Build a set of selected entity strings for O(1) lookup
  const selectedSet = new Set(selectedEntities.map((e) => `${e.modelId}:${e.expressId}`));

  // Find data points containing any selected entity
  for (const point of data) {
    const hasSelected = point.entityRefs.some((ref) =>
      selectedSet.has(`${ref.modelId}:${ref.expressId}`)
    );

    if (hasSelected) {
      highlighted.add(point.key);
    }
  }

  return highlighted;
}

/**
 * Apply cross-filters to an aggregation config
 */
export function applyFiltersToConfig(
  config: AggregationConfig,
  filters: Map<string, Set<string>>,
  excludeChartId: string
): AggregationConfig {
  // Collect all active filters except from the requesting chart
  const activeFilters: DataFilter[] = [];

  for (const [chartId, keys] of filters) {
    if (chartId !== excludeChartId && keys.size > 0) {
      // This is simplified - in production we'd need to know which dimension
      // each chart filters by. For now, assume same dimension as groupBy.
      activeFilters.push({
        dimension: config.groupBy,
        values: Array.from(keys),
      });
    }
  }

  if (activeFilters.length === 0) {
    return config;
  }

  // Combine with existing preFilter
  return {
    ...config,
    preFilter: config.preFilter ?? activeFilters[0],
  };
}
