/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Export Dialog for IFC export with property mutations
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Download,
  FileText,
  FileJson,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { useViewerStore } from '@/store';
import { StepExporter, MergedExporter, type MergeModelInput } from '@ifc-lite/export';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { extractPropertiesOnDemand, type IfcDataStore } from '@ifc-lite/parser';

type ExportFormat = 'ifc' | 'ifcx' | 'json';
type ExportScope = 'single' | 'merged';
type SchemaVersion = 'IFC2X3' | 'IFC4' | 'IFC4X3';

interface ExportDialogProps {
  trigger?: React.ReactNode;
}

export function ExportDialog({ trigger }: ExportDialogProps) {
  const models = useViewerStore((s) => s.models);
  const dirtyModels = useViewerStore((s) => s.dirtyModels);
  const getMutationView = useViewerStore((s) => s.getMutationView);
  const registerMutationView = useViewerStore((s) => s.registerMutationView);
  const getModifiedEntityCount = useViewerStore((s) => s.getModifiedEntityCount);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);
  const hiddenEntitiesByModel = useViewerStore((s) => s.hiddenEntitiesByModel);
  const isolatedEntitiesByModel = useViewerStore((s) => s.isolatedEntitiesByModel);
  // Also get legacy single-model state for backward compatibility
  const legacyIfcDataStore = useViewerStore((s) => s.ifcDataStore);
  const legacyGeometryResult = useViewerStore((s) => s.geometryResult);

  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('ifc');
  const [schema, setSchema] = useState<SchemaVersion>('IFC4');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [exportScope, setExportScope] = useState<ExportScope>('single');
  const [includeGeometry, setIncludeGeometry] = useState(true);
  const [applyMutations, setApplyMutations] = useState(true);
  const [deltaOnly, setDeltaOnly] = useState(false);
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null);

  // Get list of models with data stores - includes both federated models and legacy single-model
  const modelList = useMemo(() => {
    const list = Array.from(models.values()).map((m) => ({
      id: m.id,
      name: m.name,
      isDirty: dirtyModels.has(m.id),
      schemaVersion: m.schemaVersion,
    }));

    // If no models in Map but legacy data exists, add a synthetic entry
    if (list.length === 0 && legacyIfcDataStore) {
      list.push({
        id: '__legacy__',
        name: 'Current Model',
        isDirty: false,
        schemaVersion: legacyIfcDataStore.schemaVersion,
      });
    }

    return list;
  }, [models, dirtyModels, legacyIfcDataStore]);

  // Select first model by default
  useMemo(() => {
    if (modelList.length > 0 && !selectedModelId) {
      setSelectedModelId(modelList[0].id);
    }
  }, [modelList, selectedModelId]);

  // Get selected model's data - supports both federated and legacy mode
  const selectedModel = useMemo(() => {
    if (selectedModelId === '__legacy__' && legacyIfcDataStore && legacyGeometryResult) {
      // Return a synthetic FederatedModel-like object for legacy mode
      return {
        id: '__legacy__',
        name: 'Current Model',
        ifcDataStore: legacyIfcDataStore,
        geometryResult: legacyGeometryResult,
        visible: true,
        collapsed: false,
        schemaVersion: legacyIfcDataStore.schemaVersion,
      };
    }
    return models.get(selectedModelId);
  }, [models, selectedModelId, legacyIfcDataStore, legacyGeometryResult]);

  // Ensure mutation view exists for selected model
  useEffect(() => {
    if (!selectedModel?.ifcDataStore || !selectedModelId) return;

    // Check if mutation view already exists
    let mutationView = getMutationView(selectedModelId);
    if (mutationView) return;

    // Create new mutation view with on-demand property extractor
    const dataStore = selectedModel.ifcDataStore;
    mutationView = new MutablePropertyView(dataStore.properties || null, selectedModelId);

    // Set up on-demand property extraction if the data store supports it
    if (dataStore.onDemandPropertyMap && dataStore.source?.length > 0) {
      mutationView.setOnDemandExtractor((entityId: number) => {
        return extractPropertiesOnDemand(dataStore as IfcDataStore, entityId);
      });
    }

    // Register the mutation view
    registerMutationView(selectedModelId, mutationView);
  }, [selectedModel, selectedModelId, getMutationView, registerMutationView]);

  const modifiedCount = useMemo(() => {
    return getModifiedEntityCount();
  }, [getModifiedEntityCount]);

  /**
   * Convert global visibility state IDs to local expressIds for a given model.
   * The store uses global IDs (localId + idOffset), but the exporter needs local IDs.
   */
  const getLocalHiddenIds = useCallback((modelId: string): Set<number> => {
    // Legacy single-model path: no federation offset, global IDs = local IDs
    if (modelId === '__legacy__') {
      return hiddenEntities;
    }

    const model = models.get(modelId);
    if (!model) return new Set();
    const offset = model.idOffset ?? 0;

    // Prefer per-model visibility state, fall back to legacy global state
    const modelHidden = hiddenEntitiesByModel.get(modelId);
    if (modelHidden && modelHidden.size > 0) {
      return modelHidden; // Already local expressIds
    }

    // Federated model: convert global IDs to local
    const localIds = new Set<number>();
    for (const globalId of hiddenEntities) {
      const localId = globalId - offset;
      if (localId > 0 && localId <= model.maxExpressId) {
        localIds.add(localId);
      }
    }
    return localIds;
  }, [models, hiddenEntities, hiddenEntitiesByModel]);

  const getLocalIsolatedIds = useCallback((modelId: string): Set<number> | null => {
    // Legacy single-model path: no federation offset, global IDs = local IDs
    if (modelId === '__legacy__') {
      return isolatedEntities;
    }

    const model = models.get(modelId);
    if (!model) return null;
    const offset = model.idOffset ?? 0;

    // Prefer per-model isolation state
    const modelIsolated = isolatedEntitiesByModel.get(modelId);
    if (modelIsolated && modelIsolated.size > 0) {
      return modelIsolated; // Already local expressIds
    }

    // Federated model: convert global IDs to local
    if (!isolatedEntities) return null;
    const localIds = new Set<number>();
    for (const globalId of isolatedEntities) {
      const localId = globalId - offset;
      if (localId > 0 && localId <= model.maxExpressId) {
        localIds.add(localId);
      }
    }
    return localIds.size > 0 ? localIds : null;
  }, [models, isolatedEntities, isolatedEntitiesByModel]);

  const handleExport = useCallback(async () => {
    if (exportScope === 'single' && !selectedModel) return;

    setIsExporting(true);
    setExportResult(null);

    try {
      // Handle merged export of all models
      if (format === 'ifc' && exportScope === 'merged') {
        const mergeInputs: MergeModelInput[] = Array.from(models.values()).map((m) => ({
          id: m.id,
          name: m.name,
          dataStore: m.ifcDataStore,
        }));

        const mergedExporter = new MergedExporter(mergeInputs);

        // Build per-model visibility maps if visible-only export
        const hiddenByModel = new Map<string, Set<number>>();
        const isolatedByModel = new Map<string, Set<number> | null>();
        if (visibleOnly) {
          for (const m of models.values()) {
            hiddenByModel.set(m.id, getLocalHiddenIds(m.id));
            isolatedByModel.set(m.id, getLocalIsolatedIds(m.id));
          }
        }

        const result = mergedExporter.export({
          schema,
          projectStrategy: 'keep-first',
          visibleOnly,
          hiddenEntityIdsByModel: hiddenByModel,
          isolatedEntityIdsByModel: isolatedByModel,
          description: `Merged export of ${mergeInputs.length} models from ifc-lite`,
          application: 'ifc-lite',
        });

        const blob = new Blob([result.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'merged_export.ifc';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportResult({
          success: true,
          message: `Merged ${result.stats.modelCount} models, ${result.stats.totalEntityCount} entities`,
        });
        return;
      }

      if (!selectedModel) return;
      const mutationView = getMutationView(selectedModelId);

      if (format === 'ifc') {
        const exporter = new StepExporter(selectedModel.ifcDataStore, mutationView || undefined);

        // Build visibility filter for visible-only export
        const localHidden = visibleOnly ? getLocalHiddenIds(selectedModelId) : undefined;
        const localIsolated = visibleOnly ? getLocalIsolatedIds(selectedModelId) : undefined;

        const result = exporter.export({
          schema,
          includeGeometry,
          applyMutations,
          deltaOnly,
          visibleOnly,
          hiddenEntityIds: localHidden,
          isolatedEntityIds: localIsolated,
          description: `Exported from ifc-lite with ${modifiedCount} modifications`,
          application: 'ifc-lite',
        });

        // Download the file
        const blob = new Blob([result.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const suffix = visibleOnly ? '_visible' : '_modified';
        a.download = `${selectedModel.name.replace(/\.[^.]+$/, '')}${suffix}.ifc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportResult({
          success: true,
          message: `Exported ${result.stats.entityCount} entities (${result.stats.modifiedEntityCount} modified)`,
        });
      } else if (format === 'ifcx') {
        // Export as IFCX JSON
        const data = {
          format: 'ifcx',
          modelId: selectedModelId,
          modelName: selectedModel.name,
          schemaVersion: 'IFC5',
          mutations: mutationView?.getMutations() || [],
          exportedAt: new Date().toISOString(),
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedModel.name.replace(/\.[^.]+$/, '')}_modified.ifcx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportResult({
          success: true,
          message: `Exported IFCX with ${mutationView?.getMutations().length || 0} mutations`,
        });
      } else {
        // Export mutations as JSON
        const mutations = mutationView?.getMutations() || [];
        const data = {
          version: 1,
          modelId: selectedModelId,
          modelName: selectedModel.name,
          mutations,
          exportedAt: new Date().toISOString(),
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedModel.name.replace(/\.[^.]+$/, '')}_changes.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportResult({
          success: true,
          message: `Exported ${mutations.length} changes as JSON`,
        });
      }
    } catch (error) {
      console.error('Export failed:', error);
      setExportResult({
        success: false,
        message: `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsExporting(false);
    }
  }, [selectedModel, selectedModelId, format, schema, exportScope, includeGeometry, applyMutations, deltaOnly, visibleOnly, getMutationView, getLocalHiddenIds, getLocalIsolatedIds, modifiedCount, models]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export IFC
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export IFC File
          </DialogTitle>
          <DialogDescription>
            Export your model with property modifications applied
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Export scope selector (only when multiple models loaded) */}
          {format === 'ifc' && modelList.length > 1 && (
            <div className="flex items-center gap-4">
              <Label className="w-32">Scope</Label>
              <Select value={exportScope} onValueChange={(v) => setExportScope(v as ExportScope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single Model</SelectItem>
                  <SelectItem value="merged">Merged (All Models)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Model selector (only for single-model export) */}
          {exportScope === 'single' && (
          <div className="flex items-center gap-4">
            <Label className="w-32">Model</Label>
            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => {
                  const maxLen = 24;
                  const displayName = m.name.length > maxLen ? m.name.slice(0, maxLen) + '\u2026' : m.name;
                  return (
                  <SelectItem key={m.id} value={m.id} title={m.name}>
                    {displayName}{m.isDirty ? ' *' : ''}
                  </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          )}

          {/* Format selector */}
          <div className="flex items-center gap-4">
            <Label className="w-32">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ifc">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    IFC (STEP)
                  </div>
                </SelectItem>
                <SelectItem value="ifcx">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4" />
                    IFCX (JSON)
                  </div>
                </SelectItem>
                <SelectItem value="json">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4" />
                    Changes Only (JSON)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Schema version (for IFC format) */}
          {format === 'ifc' && (
            <div className="flex items-center gap-4">
              <Label className="w-32">Schema</Label>
              <Select value={schema} onValueChange={(v) => setSchema(v as SchemaVersion)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IFC2X3">IFC2X3</SelectItem>
                  <SelectItem value="IFC4">IFC4</SelectItem>
                  <SelectItem value="IFC4X3">IFC4X3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Options */}
          {format === 'ifc' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Export Visible Only</Label>
                  <p className="text-xs text-muted-foreground">Only include entities currently visible in the 3D view</p>
                </div>
                <Switch checked={visibleOnly} onCheckedChange={setVisibleOnly} />
              </div>
              {exportScope === 'single' && (
              <>
              <div className="flex items-center justify-between">
                <Label>Include Geometry</Label>
                <Switch checked={includeGeometry} onCheckedChange={setIncludeGeometry} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Apply Property Changes</Label>
                <Switch checked={applyMutations} onCheckedChange={setApplyMutations} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Export Changes Only (Delta)</Label>
                <Switch checked={deltaOnly} onCheckedChange={setDeltaOnly} />
              </div>
              </>
              )}
            </>
          )}

          {/* Stats */}
          {modifiedCount > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Pending Changes</AlertTitle>
              <AlertDescription>
                {modifiedCount} entities have been modified
              </AlertDescription>
            </Alert>
          )}

          {/* Export result */}
          {exportResult && (
            <Alert variant={exportResult.success ? 'default' : 'destructive'}>
              {exportResult.success ? (
                <Check className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle>{exportResult.success ? 'Success' : 'Error'}</AlertTitle>
              <AlertDescription>{exportResult.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || !selectedModel}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
