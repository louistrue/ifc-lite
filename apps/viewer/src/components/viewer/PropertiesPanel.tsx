/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useCallback } from 'react';
import {
  Copy,
  Check,
  Focus,
  EyeOff,
  Eye,
  Building2,
  Layers,
  FileText,
  Calculator,
  Tag,
  MousePointer2,
  ArrowUpDown,
  FileBox,
  Clock,
  HardDrive,
  Hash,
  Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { IfcQuery } from '@ifc-lite/query';
import type { EntityRef, FederatedModel } from '@/store/types';
import type { IfcDataStore } from '@ifc-lite/parser';

interface PropertySet {
  name: string;
  properties: Array<{ name: string; value: unknown }>;
}

interface QuantitySet {
  name: string;
  quantities: Array<{ name: string; value: number; type: number }>;
}

export function PropertiesPanel() {
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  const selectedEntities = useViewerStore((s) => s.selectedEntities);
  const selectedModelId = useViewerStore((s) => s.selectedModelId);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const toggleEntityVisibility = useViewerStore((s) => s.toggleEntityVisibility);
  const isEntityVisible = useViewerStore((s) => s.isEntityVisible);
  const { query, ifcDataStore, models, getQueryForModel } = useIfc();

  // Get model-aware query based on selectedEntity
  const { modelQuery, model } = useMemo(() => {
    // If we have a selectedEntity with modelId, use that model's query
    if (selectedEntity && selectedEntity.modelId !== 'legacy') {
      const m = models.get(selectedEntity.modelId);
      if (m) {
        return {
          modelQuery: new IfcQuery(m.ifcDataStore),
          model: m,
        };
      }
    }
    // Fallback to legacy query
    return { modelQuery: query, model: null };
  }, [selectedEntity, models, query]);

  // Use model-aware data store
  const activeDataStore = model?.ifcDataStore ?? ifcDataStore;

  // Copy feedback state - must be before any early returns (Rules of Hooks)
  const [copied, setCopied] = useState(false);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // Get spatial location info
  // IMPORTANT: Use selectedEntity.expressId (original ID) for IfcDataStore lookups
  // selectedEntityId is a globalId which only works with offset=0 (first model)
  const spatialInfo = useMemo(() => {
    const originalExpressId = selectedEntity?.expressId;
    if (!originalExpressId || !activeDataStore?.spatialHierarchy) return null;

    const hierarchy = activeDataStore.spatialHierarchy;
    // Use O(1) lookup instead of O(n) includes() search
    const storeyId = hierarchy.elementToStorey.get(originalExpressId);

    if (!storeyId) return null;

    // Get height: try pre-computed, then properties/quantities, then calculate from elevations
    let height = hierarchy.storeyHeights?.get(storeyId);

    if (height === undefined && activeDataStore.properties) {
      for (const pset of activeDataStore.properties.getForEntity(storeyId)) {
        for (const prop of pset.properties) {
          const propName = prop.name.toLowerCase();
          if (['grossheight', 'netheight', 'height'].includes(propName)) {
            const val = parseFloat(String(prop.value));
            if (!isNaN(val) && val > 0) {
              height = val;
              break;
            }
          }
        }
        if (height !== undefined) break;
      }
    }

    if (height === undefined && activeDataStore.quantities) {
      for (const qto of activeDataStore.quantities.getForEntity(storeyId)) {
        for (const qty of qto.quantities) {
          const qtyName = qty.name.toLowerCase();
          if (['grossheight', 'netheight', 'height'].includes(qtyName) && typeof qty.value === 'number' && qty.value > 0) {
            height = qty.value;
            break;
          }
        }
        if (height !== undefined) break;
      }
    }

    // Fallback: calculate from elevation difference to next storey
    if (height === undefined && hierarchy.storeyElevations.size > 1) {
      const currentElevation = hierarchy.storeyElevations.get(storeyId);
      if (currentElevation !== undefined) {
        // Find next storey with higher elevation (O(n) but only when height missing)
        let nextElevation: number | undefined;
        for (const [, elev] of hierarchy.storeyElevations) {
          if (elev > currentElevation && (nextElevation === undefined || elev < nextElevation)) {
            nextElevation = elev;
          }
        }
        if (nextElevation !== undefined) {
          height = nextElevation - currentElevation;
        }
      }
    }

    return {
      storeyId,
      storeyName: activeDataStore.entities.getName(storeyId) || `Storey #${storeyId}`,
      elevation: hierarchy.storeyElevations.get(storeyId),
      height,
    };
  }, [selectedEntity, activeDataStore]);

  // Get entity node - must be computed before early return to maintain hook order
  // IMPORTANT: Use selectedEntity.expressId (original ID) for IfcDataStore lookups
  const entityNode = useMemo(() => {
    const originalExpressId = selectedEntity?.expressId;
    if (!originalExpressId || !modelQuery) return null;
    return modelQuery.entity(originalExpressId);
  }, [selectedEntity, modelQuery]);

  // Unified property/quantity access - EntityNode handles on-demand extraction automatically
  // These hooks must be called before any early return to maintain hook order
  const properties: PropertySet[] = useMemo(() => {
    if (!entityNode) return [];
    const rawProps = entityNode.properties();
    return rawProps.map(pset => ({
      name: pset.name,
      properties: pset.properties.map(p => ({ name: p.name, value: p.value })),
    }));
  }, [entityNode]);

  const quantities: QuantitySet[] = useMemo(() => {
    if (!entityNode) return [];
    return entityNode.quantities();
  }, [entityNode]);

  // Build attributes array for display - must be before early return to maintain hook order
  // Note: GlobalId is intentionally excluded since it's shown in the dedicated GUID field above
  const attributes = useMemo(() => {
    if (!entityNode) return [];
    const attrs: Array<{ name: string; value: string }> = [];
    if (entityNode.name) attrs.push({ name: 'Name', value: entityNode.name });
    if (entityNode.description) attrs.push({ name: 'Description', value: entityNode.description });
    if (entityNode.objectType) attrs.push({ name: 'ObjectType', value: entityNode.objectType });
    return attrs;
  }, [entityNode]);

  // Model metadata display (when clicking top-level model in hierarchy)
  if (selectedModelId) {
    const selectedModel = models.get(selectedModelId);
    if (selectedModel) {
      return <ModelMetadataPanel model={selectedModel} />;
    }
  }

  // Multi-entity selection (unified storeys) - render combined view
  if (selectedEntities.length > 1) {
    return (
      <MultiEntityPanel
        entities={selectedEntities}
        models={models}
        ifcDataStore={ifcDataStore}
      />
    );
  }

  if (!selectedEntityId || !modelQuery || !entityNode) {
    return (
      <div className="h-full flex flex-col border-l-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">Properties</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-black">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 flex items-center justify-center mb-4 bg-zinc-100 dark:bg-zinc-950">
            <MousePointer2 className="h-8 w-8 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="font-bold uppercase text-zinc-900 dark:text-zinc-100 mb-2">No Selection</p>
          <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 max-w-[150px]">
            Select an element to view details
          </p>
        </div>
      </div>
    );
  }

  // These are safe to access after the early return check (entityNode is confirmed non-null above)
  const entityType = entityNode.type;
  const entityName = entityNode.name;
  const entityGlobalId = entityNode.globalId;
  const entityDescription = entityNode.description;
  const entityObjectType = entityNode.objectType;

  return (
    <div className="h-full flex flex-col border-l-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      {/* Entity Header */}
      <div className="p-4 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.1)]">
            <Building2 className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-bold text-sm truncate uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              {entityName || `${entityType}`}
            </h3>
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">{entityType}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-none hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  onClick={() => {
                    if (selectedEntityId && cameraCallbacks.frameSelection) {
                      cameraCallbacks.frameSelection();
                    }
                  }}
                >
                  <Focus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom to</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-none hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  onClick={() => {
                    if (selectedEntityId) {
                      toggleEntityVisibility(selectedEntityId);
                    }
                  }}
                >
                  {selectedEntityId && isEntityVisible(selectedEntityId) ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {selectedEntityId && isEntityVisible(selectedEntityId) ? 'Hide' : 'Show'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* GlobalId */}
        {entityGlobalId && (
          <div className={`flex items-center gap-0 border transition-colors duration-200 ${
            copied
              ? 'border-emerald-400 dark:border-emerald-600'
              : 'border-zinc-200 dark:border-zinc-800'
          }`}>
            <code className="flex-1 text-[10px] bg-white dark:bg-zinc-950 px-2 py-1 truncate font-mono select-all text-zinc-900 dark:text-zinc-100">
              {entityGlobalId}
            </code>
            <Button
              variant="ghost"
              size="icon-xs"
              className={`h-6 w-6 rounded-none border-l transition-all duration-200 ${
                copied
                  ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                  : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-950'
              }`}
              onClick={() => copyToClipboard(entityGlobalId)}
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3 text-zinc-600 dark:text-zinc-400" />
              )}
            </Button>
          </div>
        )}

        {/* Spatial Location */}
        {spatialInfo && (
          <div className="flex items-center gap-2 text-xs border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-900/10 px-2 py-1.5 text-emerald-800 dark:text-emerald-400 min-w-0">
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span className="font-bold uppercase tracking-wide truncate min-w-0 flex-1">{spatialInfo.storeyName}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {spatialInfo.elevation !== undefined && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-emerald-600/70 dark:text-emerald-500/70 font-mono whitespace-nowrap">
                      {spatialInfo.elevation >= 0 ? '+' : ''}{spatialInfo.elevation.toFixed(2)}m
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Elevation: {spatialInfo.elevation >= 0 ? '+' : ''}{spatialInfo.elevation.toFixed(2)}m from ground</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {spatialInfo.height !== undefined && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-emerald-500/60 dark:text-emerald-400/60 font-mono text-[10px] whitespace-nowrap">
                      <ArrowUpDown className="h-2.5 w-2.5 shrink-0" />
                      <span className="hidden sm:inline">{spatialInfo.height.toFixed(2)}m</span>
                      <span className="sm:hidden">{spatialInfo.height.toFixed(1)}m</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Height: {spatialInfo.height.toFixed(2)}m to next storey</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* Model Source (when multiple models loaded) - below storey, less prominent */}
        {models.size > 1 && model && (
          <div className="flex items-center gap-2 text-[11px] px-2 py-1 text-zinc-400 dark:text-zinc-500 min-w-0">
            <FileBox className="h-3 w-3 shrink-0" />
            <span className="font-mono truncate min-w-0 flex-1">{model.name}</span>
          </div>
        )}
      </div>

      {/* IFC Attributes */}
      {attributes.length > 0 && (
        <Collapsible defaultOpen className="border-b">
          <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 hover:bg-muted/50 text-left">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Attributes</span>
            <span className="text-xs text-muted-foreground ml-auto">{attributes.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y border-t">
              {attributes.map((attr) => (
                <div key={attr.name} className="grid grid-cols-[minmax(80px,1fr)_minmax(0,2fr)] gap-2 px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground truncate" title={attr.name}>{attr.name}</span>
                  <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 min-w-0">
                    <span className="font-medium whitespace-nowrap" title={attr.value}>
                      {attr.value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Tabs */}
      <Tabs defaultValue="properties" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="tabs-list w-full justify-start rounded-none h-10 p-0" style={{ backgroundColor: 'var(--tabs-bg)', borderBottom: '1px solid var(--tabs-border)' }}>
          <TabsTrigger
            value="properties"
            className="tab-trigger flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary uppercase text-xs tracking-wider h-full"
          >
            <FileText className="h-3.5 w-3.5 mr-2" />
            Properties
          </TabsTrigger>
          <TabsTrigger
            value="quantities"
            className="tab-trigger flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary uppercase text-xs tracking-wider h-full"
          >
            <Calculator className="h-3.5 w-3.5 mr-2" />
            Quantities
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 bg-white dark:bg-black">
          <TabsContent value="properties" className="m-0 p-4">
            {properties.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500 text-center py-8 font-mono">No property sets</p>
            ) : (
              <div className="space-y-3">
                {properties.map((pset: PropertySet) => (
                  <PropertySetCard key={pset.name} pset={pset} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="quantities" className="m-0 p-4">
            {quantities.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500 text-center py-8 font-mono">No quantities</p>
            ) : (
              <div className="space-y-3">
                {quantities.map((qset: QuantitySet) => (
                  <QuantitySetCard key={qset.name} qset={qset} />
                ))}
              </div>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

/** Multi-entity panel for unified storeys - shows data from multiple entities stacked */
function MultiEntityPanel({
  entities,
  models,
  ifcDataStore,
}: {
  entities: EntityRef[];
  models: Map<string, FederatedModel>;
  ifcDataStore: IfcDataStore | null;
}) {
  return (
    <div className="h-full flex flex-col border-l-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      {/* Header */}
      <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-emerald-600" />
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Unified Storey
          </h2>
          <span className="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-900 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            {entities.length} models
          </span>
        </div>
      </div>

      {/* Scrollable content with each entity's data */}
      <ScrollArea className="flex-1">
        <div className="divide-y-2 divide-zinc-200 dark:divide-zinc-800">
          {entities.map((entityRef, index) => (
            <EntityDataSection
              key={`${entityRef.modelId}-${entityRef.expressId}`}
              entityRef={entityRef}
              models={models}
              ifcDataStore={ifcDataStore}
              showModelName={true}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Renders data for a single entity (used in multi-entity panel) */
function EntityDataSection({
  entityRef,
  models,
  ifcDataStore,
  showModelName,
}: {
  entityRef: EntityRef;
  models: Map<string, FederatedModel>;
  ifcDataStore: IfcDataStore | null;
  showModelName: boolean;
}) {
  // Get the appropriate data store and query
  const { dataStore, model } = useMemo(() => {
    if (entityRef.modelId !== 'legacy') {
      const m = models.get(entityRef.modelId);
      if (m) {
        return { dataStore: m.ifcDataStore, model: m };
      }
    }
    return { dataStore: ifcDataStore, model: null };
  }, [entityRef.modelId, models, ifcDataStore]);

  const query = useMemo(() => {
    return dataStore ? new IfcQuery(dataStore) : null;
  }, [dataStore]);

  const entityNode = useMemo(() => {
    if (!query) return null;
    return query.entity(entityRef.expressId);
  }, [query, entityRef.expressId]);

  // Get properties and quantities
  const properties: PropertySet[] = useMemo(() => {
    if (!entityNode) return [];
    const rawProps = entityNode.properties();
    return rawProps.map(pset => ({
      name: pset.name,
      properties: pset.properties.map(p => ({ name: p.name, value: p.value })),
    }));
  }, [entityNode]);

  const quantities: QuantitySet[] = useMemo(() => {
    if (!entityNode) return [];
    return entityNode.quantities();
  }, [entityNode]);

  // Get attributes
  // Note: GlobalId is intentionally excluded since it's shown in the dedicated GUID field above
  const attributes = useMemo(() => {
    if (!entityNode) return [];
    const attrs: Array<{ name: string; value: string }> = [];
    if (entityNode.name) attrs.push({ name: 'Name', value: entityNode.name });
    if (entityNode.description) attrs.push({ name: 'Description', value: entityNode.description });
    if (entityNode.objectType) attrs.push({ name: 'ObjectType', value: entityNode.objectType });
    return attrs;
  }, [entityNode]);

  // Get elevation info
  const elevationInfo = useMemo(() => {
    if (!dataStore?.spatialHierarchy) return null;
    const elevation = dataStore.spatialHierarchy.storeyElevations.get(entityRef.expressId);
    return elevation !== undefined ? elevation : null;
  }, [dataStore, entityRef.expressId]);

  if (!entityNode) {
    return (
      <div className="p-4 text-center text-zinc-500 text-sm">
        Unable to load entity data
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-black">
      {/* Entity Header with model name */}
      <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 space-y-2">
        {showModelName && model && (
          <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <FileBox className="h-3 w-3" />
            <span className="font-mono truncate">{model.name}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-emerald-600" />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm truncate text-zinc-900 dark:text-zinc-100">
              {entityNode.name || `${entityNode.type} #${entityRef.expressId}`}
            </h3>
            <p className="text-xs font-mono text-zinc-500">{entityNode.type}</p>
          </div>
          {elevationInfo !== null && (
            <span className="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400">
              {elevationInfo >= 0 ? '+' : ''}{elevationInfo.toFixed(2)}m
            </span>
          )}
        </div>
      </div>

      {/* Attributes */}
      {attributes.length > 0 && (
        <Collapsible defaultOpen className="border-b border-zinc-200 dark:border-zinc-800">
          <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left text-xs">
            <Tag className="h-3 w-3 text-zinc-400" />
            <span className="font-medium">Attributes</span>
            <span className="text-[10px] text-zinc-400 ml-auto">{attributes.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900 border-t border-zinc-100 dark:border-zinc-900">
              {attributes.map((attr) => (
                <div key={attr.name} className="grid grid-cols-[minmax(60px,1fr)_minmax(0,2fr)] gap-2 px-3 py-1.5 text-xs">
                  <span className="text-zinc-500 truncate" title={attr.name}>{attr.name}</span>
                  <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 min-w-0">
                    <span className="font-medium whitespace-nowrap">{attr.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Properties */}
      {properties.length > 0 && (
        <Collapsible defaultOpen className="border-b border-zinc-200 dark:border-zinc-800">
          <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left text-xs">
            <FileText className="h-3 w-3 text-zinc-400" />
            <span className="font-medium">Properties</span>
            <span className="text-[10px] text-zinc-400 ml-auto">{properties.length} sets</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-2">
              {properties.map((pset) => (
                <PropertySetCard key={pset.name} pset={pset} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Quantities */}
      {quantities.length > 0 && (
        <Collapsible defaultOpen className="border-b border-zinc-200 dark:border-zinc-800">
          <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left text-xs">
            <Calculator className="h-3 w-3 text-zinc-400" />
            <span className="font-medium">Quantities</span>
            <span className="text-[10px] text-zinc-400 ml-auto">{quantities.length} sets</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="p-2 pt-0 space-y-2">
              {quantities.map((qset) => (
                <QuantitySetCard key={qset.name} qset={qset} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function PropertySetCard({ pset }: { pset: PropertySet }) {
  return (
    <Collapsible defaultOpen className="border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 group">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors">
        <span className="font-bold text-xs uppercase tracking-wide text-zinc-900 dark:text-zinc-100 truncate min-w-0">{pset.name}</span>
        <span className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0 ml-2">{pset.properties.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t-2 border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
          {pset.properties.map((prop: { name: string; value: unknown }) => (
            <div key={prop.name} className="grid grid-cols-[minmax(80px,1fr)_minmax(0,2fr)] gap-2 px-3 py-2 text-xs hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
              <span className="text-zinc-500 dark:text-zinc-400 font-medium truncate" title={prop.name}>{prop.name}</span>
              <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 min-w-0">
                <span className="font-mono text-zinc-900 dark:text-zinc-100 select-all whitespace-nowrap">
                  {prop.value !== null && prop.value !== undefined ? String(prop.value) : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function QuantitySetCard({ qset }: { qset: QuantitySet }) {
  const formatValue = (value: number, type: number): string => {
    const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 3 });
    switch (type) {
      case 0: return `${formatted} m`;
      case 1: return `${formatted} m²`;
      case 2: return `${formatted} m³`;
      case 3: return formatted;
      case 4: return `${formatted} kg`;
      case 5: return `${formatted} s`;
      default: return formatted;
    }
  };

  return (
    <Collapsible defaultOpen className="border-2 border-blue-200 dark:border-blue-800 bg-blue-50/20 dark:bg-blue-950/20">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-left transition-colors">
        <span className="font-bold text-xs uppercase tracking-wide text-blue-700 dark:text-blue-400 truncate min-w-0">{qset.name}</span>
        <span className="text-[10px] font-mono bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 shrink-0 ml-2">{qset.quantities.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t-2 border-blue-200 dark:border-blue-800 divide-y divide-blue-100 dark:divide-blue-900/30">
          {qset.quantities.map((q: { name: string; value: number; type: number }) => (
            <div key={q.name} className="grid grid-cols-[minmax(80px,1fr)_minmax(0,2fr)] gap-2 px-3 py-2 text-xs hover:bg-blue-50/50 dark:hover:bg-blue-900/20">
              <span className="text-zinc-500 dark:text-zinc-400 font-medium truncate" title={q.name}>{q.name}</span>
              <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-blue-300 dark:scrollbar-thumb-blue-700 min-w-0 text-right">
                <span className="font-mono text-blue-700 dark:text-blue-400 select-all whitespace-nowrap">
                  {formatValue(q.value, q.type)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Model metadata panel - displays file info, schema version, entity counts, etc. */
function ModelMetadataPanel({ model }: { model: FederatedModel }) {
  const dataStore = model.ifcDataStore;

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Format date
  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  // Get IfcProject data if available
  const projectData = useMemo(() => {
    if (!dataStore?.spatialHierarchy?.project) return null;
    const project = dataStore.spatialHierarchy.project;
    const projectId = project.expressId;

    // Get project entity attributes
    const name = dataStore.entities.getName(projectId);
    const globalId = dataStore.entities.getGlobalId(projectId);
    const description = dataStore.entities.getDescription(projectId);

    // Get project properties
    const properties: PropertySet[] = [];
    if (dataStore.properties) {
      for (const pset of dataStore.properties.getForEntity(projectId)) {
        properties.push({
          name: pset.name,
          properties: pset.properties.map(p => ({ name: p.name, value: p.value })),
        });
      }
    }

    return { name, globalId, description, properties };
  }, [dataStore]);

  // Count storeys and elements
  const stats = useMemo(() => {
    if (!dataStore?.spatialHierarchy) {
      return { storeys: 0, elementsWithGeometry: 0 };
    }
    const storeys = dataStore.spatialHierarchy.byStorey.size;
    let elementsWithGeometry = 0;
    for (const elements of dataStore.spatialHierarchy.byStorey.values()) {
      elementsWithGeometry += (elements as number[]).length;
    }
    return { storeys, elementsWithGeometry };
  }, [dataStore]);

  return (
    <div className="h-full flex flex-col border-l-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      {/* Header */}
      <div className="p-4 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 border-2 border-primary/30 bg-primary/10 shrink-0 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.1)]">
            <FileBox className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-bold text-sm truncate uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              {model.name}
            </h3>
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">IFC Model</p>
          </div>
        </div>

        {/* Schema badge */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono bg-primary/10 border border-primary/30 px-2 py-1 text-primary font-bold uppercase">
            {model.schemaVersion}
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* File Information */}
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50">
            <h4 className="font-bold text-xs uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              File Information
            </h4>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
            <div className="flex items-center gap-3 px-3 py-2">
              <HardDrive className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="text-xs text-zinc-500">File Size</span>
              <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                {formatFileSize(model.fileSize)}
              </span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2">
              <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="text-xs text-zinc-500">Loaded At</span>
              <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                {formatDate(model.loadedAt)}
              </span>
            </div>
            {dataStore && (
              <div className="flex items-center gap-3 px-3 py-2">
                <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs text-zinc-500">Parse Time</span>
                <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                  {dataStore.parseTime.toFixed(0)} ms
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Entity Statistics */}
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50">
            <h4 className="font-bold text-xs uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Statistics
            </h4>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
            <div className="flex items-center gap-3 px-3 py-2">
              <Database className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="text-xs text-zinc-500">Total Entities</span>
              <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                {dataStore?.entityCount?.toLocaleString() ?? 'N/A'}
              </span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2">
              <Layers className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="text-xs text-zinc-500">Building Storeys</span>
              <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                {stats.storeys}
              </span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2">
              <Building2 className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="text-xs text-zinc-500">Elements with Geometry</span>
              <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                {stats.elementsWithGeometry.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2">
              <Hash className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="text-xs text-zinc-500">Max Express ID</span>
              <span className="text-xs font-mono text-zinc-900 dark:text-zinc-100 ml-auto">
                {model.maxExpressId.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* IfcProject Data */}
        {projectData && (
          <div className="border-b border-zinc-200 dark:border-zinc-800">
            <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50">
              <h4 className="font-bold text-xs uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                Project Information
              </h4>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {projectData.name && (
                <div className="flex items-center gap-3 px-3 py-2">
                  <Tag className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span className="text-xs text-zinc-500">Name</span>
                  <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 ml-auto truncate max-w-[60%]">
                    {projectData.name}
                  </span>
                </div>
              )}
              {projectData.description && (
                <div className="flex items-start gap-3 px-3 py-2">
                  <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-zinc-500 shrink-0">Description</span>
                  <span className="text-xs text-zinc-900 dark:text-zinc-100 ml-auto text-right max-w-[60%]">
                    {projectData.description}
                  </span>
                </div>
              )}
              {projectData.globalId && (
                <div className="flex items-center gap-3 px-3 py-2">
                  <Hash className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span className="text-xs text-zinc-500">GlobalId</span>
                  <code className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 ml-auto truncate max-w-[60%]">
                    {projectData.globalId}
                  </code>
                </div>
              )}
            </div>

            {/* Project Properties */}
            {projectData.properties.length > 0 && (
              <div className="p-3 pt-0 space-y-2">
                {projectData.properties.map((pset) => (
                  <PropertySetCard key={pset.name} pset={pset} />
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
