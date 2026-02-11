/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useCallback, useEffect } from 'react';
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
  PenLine,
  Crosshair,
} from 'lucide-react';
import { EditToolbar } from './PropertyEditor';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { IfcQuery } from '@ifc-lite/query';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { extractPropertiesOnDemand, extractClassificationsOnDemand, extractMaterialsOnDemand, extractTypePropertiesOnDemand, extractDocumentsOnDemand, extractRelationshipsOnDemand, type IfcDataStore } from '@ifc-lite/parser';
import type { EntityRef, FederatedModel } from '@/store/types';

import { CoordVal, CoordRow } from './properties/CoordinateDisplay';
import { PropertySetCard } from './properties/PropertySetCard';
import { QuantitySetCard } from './properties/QuantitySetCard';
import { ModelMetadataPanel } from './properties/ModelMetadataPanel';
import { ClassificationCard } from './properties/ClassificationCard';
import { MaterialCard } from './properties/MaterialCard';
import { DocumentCard } from './properties/DocumentCard';
import { RelationshipsCard } from './properties/RelationshipsCard';
import type { PropertySet, QuantitySet } from './properties/encodingUtils';

export function PropertiesPanel() {
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  const selectedEntities = useViewerStore((s) => s.selectedEntities);
  const selectedModelId = useViewerStore((s) => s.selectedModelId);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const toggleEntityVisibility = useViewerStore((s) => s.toggleEntityVisibility);
  const isEntityVisible = useViewerStore((s) => s.isEntityVisible);
  const { query, ifcDataStore, geometryResult, models, getQueryForModel } = useIfc();

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

  // Subscribe to mutation views and version to trigger re-render when mutations change
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const getMutationView = useViewerStore((s) => s.getMutationView);
  const registerMutationView = useViewerStore((s) => s.registerMutationView);

  // Ensure mutation view exists for editing - creates it on-demand if needed
  useEffect(() => {
    if (!model || !selectedEntity || selectedEntity.modelId === 'legacy') return;

    const modelId = selectedEntity.modelId;
    let mutationView = getMutationView(modelId);
    if (mutationView) return; // Already exists

    // Create new mutation view
    const dataStore = model.ifcDataStore;
    mutationView = new MutablePropertyView(dataStore.properties || null, modelId);

    // Set up on-demand property extractor if available
    if (dataStore.onDemandPropertyMap && dataStore.source?.length > 0) {
      mutationView.setOnDemandExtractor((entityId: number) => {
        return extractPropertiesOnDemand(dataStore as IfcDataStore, entityId);
      });
    }

    registerMutationView(modelId, mutationView);
  }, [model, selectedEntity, getMutationView, registerMutationView]);

  // Copy feedback state - must be before any early returns (Rules of Hooks)
  const [copied, setCopied] = useState(false);
  const [coordCopied, setCoordCopied] = useState<string | null>(null);
  const [coordOpen, setCoordOpen] = useState(false);

  // Edit mode toggle - allows inline property editing
  const [editMode, setEditMode] = useState(false);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const copyCoords = useCallback((label: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCoordCopied(label);
    setTimeout(() => setCoordCopied(null), 1500);
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

  // Compute entity bounding box and coordinates (local scene + world)
  //
  // The full coordinate pipeline is:
  //   1. WASM extracts IFC positions (Z-up) and applies RTC offset (wasmRtcOffset, in Z-up)
  //   2. Mesh collector converts Z-up -> Y-up: newY = oldZ, newZ = -oldY
  //   3. CoordinateHandler may apply additional originShift (in Y-up) for large coordinates
  //   4. Multi-model alignment adjusts positions so all models share the first model's RTC frame
  //
  // To reverse back to world coordinates (Y-up):
  //   world_yup = scene_local + originShift + wasmRtcOffset_converted_to_yup
  //
  // For multi-model: all models are aligned to the first model's RTC frame,
  // so we always use the first model's wasmRtcOffset for reconstruction.
  const entityCoordinates = useMemo(() => {
    if (!selectedEntity) return null;

    // Get geometry source: prefer multi-model, fallback to legacy
    const geoResult = model?.geometryResult ?? geometryResult;
    if (!geoResult?.meshes?.length) return null;

    // In multi-model mode, meshes use globalIds (originalExpressId + idOffset)
    const targetExpressId = selectedEntity.expressId + (model?.idOffset ?? 0);

    // Compute bounding box from matching mesh positions
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let found = false;

    for (const mesh of geoResult.meshes) {
      if (mesh.expressId !== targetExpressId) continue;
      found = true;
      const pos = mesh.positions;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    }

    if (!found) return null;

    const coordInfo = geoResult.coordinateInfo;
    const shift = coordInfo?.originShift ?? { x: 0, y: 0, z: 0 };

    // Get the reference WASM RTC offset for world coordinate reconstruction.
    // For multi-model: all models are aligned to the first model's RTC frame,
    // so we must use the first model's wasmRtcOffset (not the current model's).
    // For single/legacy: use the geometry result's own offset.
    let wasmRtcIfc = coordInfo?.wasmRtcOffset;
    if (models.size > 1) {
      let earliest = Infinity;
      for (const [, m] of models) {
        if (m.loadedAt < earliest) {
          earliest = m.loadedAt;
          wasmRtcIfc = m.geometryResult?.coordinateInfo?.wasmRtcOffset;
        }
      }
    }

    // Convert WASM RTC offset from IFC Z-up to viewer Y-up:
    //   viewer X = IFC X, viewer Y = IFC Z, viewer Z = -IFC Y
    const wasmRtcYup = wasmRtcIfc
      ? { x: wasmRtcIfc.x, y: wasmRtcIfc.z, z: -wasmRtcIfc.y }
      : { x: 0, y: 0, z: 0 };

    // Local (scene) center - what the renderer uses (Y-up, shifted)
    const localCenter = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    };

    // World center (Y-up) = scene_local + originShift + wasmRtcOffset_yup
    const worldCenterYup = {
      x: localCenter.x + shift.x + wasmRtcYup.x,
      y: localCenter.y + shift.y + wasmRtcYup.y,
      z: localCenter.z + shift.z + wasmRtcYup.z,
    };

    // Convert world Y-up to IFC Z-up for display:
    //   IFC X = viewer X, IFC Y = -viewer Z, IFC Z = viewer Y
    const worldCenterZup = {
      x: worldCenterYup.x,
      y: -worldCenterYup.z,
      z: worldCenterYup.y,
    };

    return {
      local: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ }, center: localCenter },
      worldYup: { center: worldCenterYup },
      worldZup: { center: worldCenterZup },
      hasLargeCoordinates: (coordInfo?.hasLargeCoordinates ?? false) || !!wasmRtcIfc,
    };
  }, [selectedEntity, model, geometryResult, models]);

  // Get entity node - must be computed before early return to maintain hook order
  // IMPORTANT: Use selectedEntity.expressId (original ID) for IfcDataStore lookups
  const entityNode = useMemo(() => {
    const originalExpressId = selectedEntity?.expressId;
    if (!originalExpressId || !modelQuery) return null;
    return modelQuery.entity(originalExpressId);
  }, [selectedEntity, modelQuery]);

  // Unified property/quantity access - EntityNode handles on-demand extraction automatically
  // These hooks must be called before any early return to maintain hook order
  // Use MutablePropertyView as primary source when available (it handles base + mutations)
  const properties: PropertySet[] = useMemo(() => {
    let modelId = selectedEntity?.modelId;
    const expressId = selectedEntity?.expressId;

    // Normalize legacy model ID (selection uses 'legacy', mutation views use '__legacy__')
    if (modelId === 'legacy') {
      modelId = '__legacy__';
    }

    // Try to get properties from mutation view first (handles both base and mutations)
    const mutationView = modelId ? mutationViews.get(modelId) : null;

    if (mutationView && expressId) {
      // Get merged properties from mutation view (base + mutations applied)
      const mergedProps = mutationView.getForEntity(expressId);

      // Get list of actual mutations to track which properties changed
      const mutations = mutationView.getMutationsForEntity(expressId);

      // Build a set of mutated property keys for quick lookup
      const mutatedKeys = new Set<string>();
      const newPsetNames = new Set<string>();
      for (const m of mutations) {
        if (m.psetName && m.propName) {
          mutatedKeys.add(`${m.psetName}:${m.propName}`);
        }
        // Track property sets that were created (not in original model)
        if (m.type === 'CREATE_PROPERTY_SET' && m.psetName) {
          newPsetNames.add(m.psetName);
        }
        // Also mark as new pset if this is a CREATE_PROPERTY for a pset that doesn't exist in base
        if (m.type === 'CREATE_PROPERTY' && m.psetName) {
          // Check if we have base properties to compare
          const baseProps = entityNode?.properties() ?? [];
          const existsInBase = baseProps.some(p => p.name === m.psetName);
          if (!existsInBase) {
            newPsetNames.add(m.psetName);
          }
        }
      }

      // If mutation view returned properties, use them
      if (mergedProps.length > 0) {
        return mergedProps.map(pset => ({
          name: pset.name,
          properties: pset.properties.map(p => ({
            name: p.name,
            value: p.value,
            isMutated: mutatedKeys.has(`${pset.name}:${p.name}`),
          })),
          isNewPset: newPsetNames.has(pset.name),
        }));
      }
    }

    // Fallback to entity node properties (no mutations or mutation view not available)
    if (!entityNode) return [];

    const rawProps = entityNode.properties();
    return rawProps.map(pset => ({
      name: pset.name,
      properties: pset.properties.map(p => ({ name: p.name, value: p.value, isMutated: false })),
      isNewPset: false,
    }));
  }, [entityNode, selectedEntity, mutationViews, mutationVersion]);

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

  // Extract classifications for the selected entity from the IFC data store
  const classifications = useMemo(() => {
    if (!selectedEntity) return [];
    const dataStore = model?.ifcDataStore ?? ifcDataStore;
    if (!dataStore) return [];
    return extractClassificationsOnDemand(dataStore as IfcDataStore, selectedEntity.expressId);
  }, [selectedEntity, model, ifcDataStore]);

  // Extract materials for the selected entity from the IFC data store
  const materialInfo = useMemo(() => {
    if (!selectedEntity) return null;
    const dataStore = model?.ifcDataStore ?? ifcDataStore;
    if (!dataStore) return null;
    return extractMaterialsOnDemand(dataStore as IfcDataStore, selectedEntity.expressId);
  }, [selectedEntity, model, ifcDataStore]);

  // Extract documents for the selected entity from the IFC data store
  const documents = useMemo(() => {
    if (!selectedEntity) return [];
    const dataStore = model?.ifcDataStore ?? ifcDataStore;
    if (!dataStore) return [];
    return extractDocumentsOnDemand(dataStore as IfcDataStore, selectedEntity.expressId);
  }, [selectedEntity, model, ifcDataStore]);

  // Extract structural relationships (openings, fills, groups, connections)
  const entityRelationships = useMemo(() => {
    if (!selectedEntity) return null;
    const dataStore = model?.ifcDataStore ?? ifcDataStore;
    if (!dataStore) return null;
    const rels = extractRelationshipsOnDemand(dataStore as IfcDataStore, selectedEntity.expressId);
    const totalCount = rels.voids.length + rels.fills.length + rels.groups.length + rels.connections.length;
    return totalCount > 0 ? rels : null;
  }, [selectedEntity, model, ifcDataStore]);

  // Extract type-level properties (e.g., from IfcWallType's HasPropertySets)
  const typeProperties = useMemo(() => {
    if (!selectedEntity) return null;
    const dataStore = model?.ifcDataStore ?? ifcDataStore;
    if (!dataStore) return null;
    const result = extractTypePropertiesOnDemand(dataStore as IfcDataStore, selectedEntity.expressId);
    if (!result) return null;
    // Convert to PropertySet format for PropertySetCard
    return {
      typeName: result.typeName,
      typeId: result.typeId,
      psets: result.properties.map(pset => ({
        name: pset.name,
        properties: pset.properties.map(p => ({ name: p.name, value: p.value, isMutated: false })),
        isNewPset: false,
      })),
    };
  }, [selectedEntity, model, ifcDataStore]);

  // Merge instance-level and type-level property sets into a single unified list.
  // - Same-named psets: instance properties take precedence, type-level props are appended (deduped by name)
  // - Type-only psets: added to the main list (no separate "Type" section)
  // This matches how reference IFC viewers display properties.
  const mergedProperties: PropertySet[] = useMemo(() => {
    if (!typeProperties || typeProperties.psets.length === 0) return properties;
    if (properties.length === 0) return typeProperties.psets;

    const instanceByName = new Map<string, PropertySet>();
    for (const pset of properties) {
      instanceByName.set(pset.name, pset);
    }

    // Start with instance psets, merging type-level props into matching ones
    const result: PropertySet[] = [];
    const merged = new Set<string>();

    for (const pset of properties) {
      const typePset = typeProperties.psets.find(tp => tp.name === pset.name);
      if (typePset) {
        // Merge: add type-level properties not already present in instance pset
        const existingNames = new Set(pset.properties.map(p => p.name));
        const extraProps = typePset.properties.filter(p => !existingNames.has(p.name));
        result.push({
          ...pset,
          properties: [...pset.properties, ...extraProps],
        });
        merged.add(pset.name);
      } else {
        result.push(pset);
      }
    }

    // Add type-only psets that don't exist at instance level
    for (const typePset of typeProperties.psets) {
      if (!merged.has(typePset.name) && !instanceByName.has(typePset.name)) {
        result.push(typePset);
      }
    }

    return result;
  }, [properties, typeProperties]);

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
            {/* Edit mode toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={editMode ? 'default' : 'ghost'}
                  size="icon-xs"
                  className={`rounded-none ${editMode ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
                  onClick={() => setEditMode(!editMode)}
                >
                  <PenLine className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{editMode ? 'Exit Edit Mode' : 'Edit Properties'}</TooltipContent>
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

        {/* Entity Position - teal tint to distinguish from emerald storey bar */}
        {entityCoordinates && (
          <Collapsible open={coordOpen} onOpenChange={setCoordOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs border border-teal-500/30 px-2 py-1.5 text-teal-800 dark:text-teal-400 min-w-0 text-left group/coord">
              <Crosshair className="h-3.5 w-3.5 shrink-0" />
              <span className="font-bold uppercase tracking-wide shrink-0">World</span>
              {!coordOpen && (
                <>
                  <span className="font-mono text-[10px] text-teal-600/70 dark:text-teal-500/70 truncate min-w-0 flex-1 tabular-nums">
                    <CoordVal axis="E" value={entityCoordinates.worldZup.center.x} />{' '}
                    <CoordVal axis="N" value={entityCoordinates.worldZup.center.y} />{' '}
                    <CoordVal axis="Z" value={entityCoordinates.worldZup.center.z} />
                  </span>
                  <span className="text-[9px] text-teal-500/0 group-hover/coord:text-teal-500/40 transition-colors shrink-0">details</span>
                </>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-2 py-1.5 space-y-0.5">
                <CoordRow
                  label=""
                  values={[
                    { axis: 'E', value: entityCoordinates.worldZup.center.x },
                    { axis: 'N', value: entityCoordinates.worldZup.center.y },
                    { axis: 'Z', value: entityCoordinates.worldZup.center.z },
                  ]}
                  primary
                  copyLabel="world"
                  coordCopied={coordCopied}
                  onCopy={copyCoords}
                />
                <CoordRow
                  label="Local"
                  values={[
                    { axis: 'X', value: entityCoordinates.local.center.x },
                    { axis: 'Y', value: entityCoordinates.local.center.y },
                    { axis: 'Z', value: entityCoordinates.local.center.z },
                  ]}
                  copyLabel="local"
                  coordCopied={coordCopied}
                  onCopy={copyCoords}
                />
                <div className="flex items-start gap-1.5">
                  <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider w-[34px] shrink-0 pt-px">Size</span>
                  <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">
                    {(entityCoordinates.local.max.x - entityCoordinates.local.min.x).toFixed(2)} x {(entityCoordinates.local.max.y - entityCoordinates.local.min.y).toFixed(2)} x {(entityCoordinates.local.max.z - entityCoordinates.local.min.z).toFixed(2)}
                  </span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
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
          <TabsContent value="properties" className="m-0 p-3 overflow-hidden">
            {/* Edit toolbar - only shown when edit mode is active */}
            {editMode && selectedEntity && (
              <EditToolbar
                modelId={selectedEntity.modelId}
                entityId={selectedEntity.expressId}
                entityType={entityType}
                existingPsets={mergedProperties.map(p => p.name)}
                existingQtos={quantities.map(q => q.name)}
                schemaVersion={activeDataStore?.schemaVersion}
              />
            )}
            {mergedProperties.length === 0 && classifications.length === 0 && !materialInfo && documents.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500 text-center py-8 font-mono">No property sets</p>
            ) : (
              <div className="space-y-3 w-full overflow-hidden">
                {/* Type badge - show which type this element inherits from */}
                {typeProperties && typeProperties.psets.length > 0 && (
                  <div className="flex items-center gap-2 px-1 pb-0.5 text-[11px] text-indigo-600/70 dark:text-indigo-400/60">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="font-medium truncate">Type: {typeProperties.typeName}</span>
                  </div>
                )}
                {mergedProperties.map((pset: PropertySet) => (
                  <PropertySetCard
                    key={pset.name}
                    pset={pset}
                    modelId={selectedEntity?.modelId}
                    entityId={selectedEntity?.expressId}
                    enableEditing={editMode}
                  />
                ))}

                {/* Classifications */}
                {classifications.length > 0 && (
                  <>
                    {mergedProperties.length > 0 && (
                      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2 mt-2" />
                    )}
                    {classifications.map((classification, i) => (
                      <ClassificationCard key={`class-${i}`} classification={classification} />
                    ))}
                  </>
                )}

                {/* Materials */}
                {materialInfo && (
                  <>
                    {(mergedProperties.length > 0 || classifications.length > 0) && (
                      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2 mt-2" />
                    )}
                    <MaterialCard material={materialInfo} />
                  </>
                )}

                {/* Documents */}
                {documents.length > 0 && (
                  <>
                    {(mergedProperties.length > 0 || classifications.length > 0 || materialInfo) && (
                      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2 mt-2" />
                    )}
                    {documents.map((doc, i) => (
                      <DocumentCard key={`doc-${i}`} document={doc} />
                    ))}
                  </>
                )}

                {/* Relationships */}
                {entityRelationships && (
                  <>
                    <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2 mt-2" />
                    <RelationshipsCard relationships={entityRelationships} />
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="quantities" className="m-0 p-3 overflow-hidden">
            {quantities.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-500 text-center py-8 font-mono">No quantities</p>
            ) : (
              <div className="space-y-3 w-full overflow-hidden">
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
