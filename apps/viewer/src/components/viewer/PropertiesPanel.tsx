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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
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

  // Get quantities
  const quantities = useMemo((): QuantitySet[] => {
    if (!selectedEntityId || !ifcDataStore?.quantities) return [];
    return ifcDataStore.quantities.getForEntity(selectedEntityId);
  }, [selectedEntityId, ifcDataStore]);

  if (!selectedEntityId || !query) {
    return (
      <div className="h-full flex flex-col border-l bg-card">
        <div className="p-3 border-b">
          <h2 className="font-semibold text-sm">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
          Select an object to view properties
        </div>
      </div>
    );
  }

  const entityNode = query.entity(selectedEntityId);
  const properties: PropertySet[] = entityNode.properties();
  const entityType = entityNode.type;
  const entityName = entityNode.name;
  const entityGlobalId = entityNode.globalId;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-full flex flex-col border-l bg-card">
      {/* Entity Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">
              {entityName || `${entityType}`}
            </h3>
            <p className="text-xs text-muted-foreground">{entityType}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
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
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-2 py-1 rounded truncate font-mono">
              {entityGlobalId}
            </code>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => copyToClipboard(entityGlobalId)}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Spatial Location */}
        {spatialInfo && (
          <div className="flex items-center gap-2 text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-1.5 rounded">
            <Layers className="h-3.5 w-3.5" />
            <span className="font-medium">{spatialInfo.storeyName}</span>
            {spatialInfo.elevation !== undefined && (
              <span className="text-emerald-600/70 dark:text-emerald-400/70">
                ({spatialInfo.elevation.toFixed(2)}m)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="properties" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-9 p-0">
          <TabsTrigger
            value="properties"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Properties
          </TabsTrigger>
          <TabsTrigger
            value="quantities"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            <Calculator className="h-3.5 w-3.5 mr-1.5" />
            Quantities
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="properties" className="m-0 p-3">
            {properties.length === 0 ? (
              <p className="text-sm text-muted-foreground">No property sets</p>
            ) : (
              <div className="space-y-2">
                {properties.map((pset: PropertySet) => (
                  <PropertySetCard key={pset.name} pset={pset} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="quantities" className="m-0 p-3">
            {quantities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quantities</p>
            ) : (
              <div className="space-y-2">
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
    <Collapsible defaultOpen className="border rounded-lg">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2.5 hover:bg-muted/50 rounded-t-lg text-left">
        <span className="font-medium text-sm">{pset.name}</span>
        <span className="text-xs text-muted-foreground">{pset.properties.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Separator />
        <div className="divide-y">
          {pset.properties.map((prop: { name: string; value: unknown }) => (
            <div key={prop.name} className="flex justify-between gap-2 px-2.5 py-1.5 text-sm">
              <span className="text-muted-foreground truncate">{prop.name}</span>
              <span className="text-right truncate font-medium">
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
    <Collapsible defaultOpen className="border rounded-lg border-blue-200 dark:border-blue-900">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2.5 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-t-lg text-left">
        <span className="font-medium text-sm text-blue-700 dark:text-blue-400">{qset.name}</span>
        <span className="text-xs text-blue-500/70">{qset.quantities.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Separator className="bg-blue-200 dark:bg-blue-900" />
        <div className="divide-y divide-blue-100 dark:divide-blue-900/50">
          {qset.quantities.map((q: { name: string; value: number; type: number }) => (
            <div key={q.name} className="flex justify-between gap-2 px-2.5 py-1.5 text-sm">
              <span className="text-muted-foreground truncate">{q.name}</span>
              <span className="text-right font-mono text-blue-700 dark:text-blue-400">
                {formatValue(q.value, q.type)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
