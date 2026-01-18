/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import {
  Copy,
  Focus,
  EyeOff,
  Eye,
  Building2,
  Layers,
  FileText,
  Calculator,
  Tag,
  MousePointer2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';

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
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const toggleEntityVisibility = useViewerStore((s) => s.toggleEntityVisibility);
  const isEntityVisible = useViewerStore((s) => s.isEntityVisible);
  const { query, ifcDataStore } = useIfc();

  // Get spatial location info
  const spatialInfo = useMemo(() => {
    if (!selectedEntityId || !ifcDataStore?.spatialHierarchy) return null;

    const hierarchy = ifcDataStore.spatialHierarchy;
    let storeyId: number | null = null;

    for (const [sid, elementIds] of hierarchy.byStorey) {
      if ((elementIds as number[]).includes(selectedEntityId)) {
        storeyId = sid as number;
        break;
      }
    }

    if (!storeyId) return null;

    return {
      storeyId,
      storeyName: ifcDataStore.entities.getName(storeyId) || `Storey #${storeyId}`,
      elevation: hierarchy.storeyElevations.get(storeyId),
    };
  }, [selectedEntityId, ifcDataStore]);

  // Get entity node - must be computed before early return to maintain hook order
  const entityNode = useMemo(() => {
    if (!selectedEntityId || !query) return null;
    return query.entity(selectedEntityId);
  }, [selectedEntityId, query]);

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
  const attributes = useMemo(() => {
    if (!entityNode) return [];
    const attrs: Array<{ name: string; value: string }> = [];
    if (entityNode.globalId) attrs.push({ name: 'GlobalId', value: entityNode.globalId });
    if (entityNode.name) attrs.push({ name: 'Name', value: entityNode.name });
    if (entityNode.description) attrs.push({ name: 'Description', value: entityNode.description });
    if (entityNode.objectType) attrs.push({ name: 'ObjectType', value: entityNode.objectType });
    return attrs;
  }, [entityNode]);

  if (!selectedEntityId || !query) {
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

  // These are safe to access after the early return check
  const entityType = entityNode!.type;
  const entityName = entityNode!.name;
  const entityGlobalId = entityNode!.globalId;
  const entityDescription = entityNode!.description;
  const entityObjectType = entityNode!.objectType;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

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
          <div className="flex items-center gap-0 border border-zinc-200 dark:border-zinc-800">
            <code className="flex-1 text-[10px] bg-white dark:bg-zinc-950 px-2 py-1 truncate font-mono select-all text-zinc-900 dark:text-zinc-100">
              {entityGlobalId}
            </code>
            <Button
              variant="ghost"
              size="icon-xs"
              className="h-6 w-6 rounded-none border-l border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-950"
              onClick={() => copyToClipboard(entityGlobalId)}
            >
              <Copy className="h-3 w-3 text-zinc-600 dark:text-zinc-400" />
            </Button>
          </div>
        )}

        {/* Spatial Location */}
        {spatialInfo && (
          <div className="flex items-center gap-2 text-xs border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-900/10 px-2 py-1.5 text-emerald-800 dark:text-emerald-400">
            <Layers className="h-3.5 w-3.5" />
            <span className="font-bold uppercase tracking-wide">{spatialInfo.storeyName}</span>
            {spatialInfo.elevation !== undefined && (
              <span className="text-emerald-600/70 dark:text-emerald-500/70 font-mono ml-auto">
                {spatialInfo.elevation.toFixed(2)}m
              </span>
            )}
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
                <div key={attr.name} className="flex justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground">{attr.name}</span>
                  <span className="text-right truncate font-medium max-w-[60%]" title={attr.value}>
                    {attr.value}
                  </span>
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

function PropertySetCard({ pset }: { pset: PropertySet }) {
  return (
    <Collapsible defaultOpen className="border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 group">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors">
        <span className="font-bold text-xs uppercase tracking-wide text-zinc-900 dark:text-zinc-100">{pset.name}</span>
        <span className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{pset.properties.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t-2 border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
          {pset.properties.map((prop: { name: string; value: unknown }) => (
            <div key={prop.name} className="flex justify-between gap-4 px-3 py-2 text-xs hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
              <span className="text-zinc-500 dark:text-zinc-400 font-medium truncate">{prop.name}</span>
              <span className="text-right truncate font-mono text-zinc-900 dark:text-zinc-100 select-all">
                {prop.value !== null && prop.value !== undefined ? String(prop.value) : '—'}
              </span>
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
        <span className="font-bold text-xs uppercase tracking-wide text-blue-700 dark:text-blue-400">{qset.name}</span>
        <span className="text-[10px] font-mono bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">{qset.quantities.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t-2 border-blue-200 dark:border-blue-800 divide-y divide-blue-100 dark:divide-blue-900/30">
          {qset.quantities.map((q: { name: string; value: number; type: number }) => (
            <div key={q.name} className="flex justify-between gap-4 px-3 py-2 text-xs hover:bg-blue-50/50 dark:hover:bg-blue-900/20">
              <span className="text-zinc-500 dark:text-zinc-400 font-medium truncate">{q.name}</span>
              <span className="text-right font-mono text-blue-700 dark:text-blue-400 select-all">
                {formatValue(q.value, q.type)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
