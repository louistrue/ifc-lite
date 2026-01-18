/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  ChevronRight,
  Building2,
  Layers,
  MapPin,
  FolderKanban,
  Square,
  Box,
  DoorOpen,
  Eye,
  EyeOff,
  LayoutTemplate
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';

interface TreeNode {
  id: number;
  name: string;
  type: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isVisible: boolean;
  elementCount?: number;
  storeyElevation?: number;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  IfcProject: FolderKanban,
  IfcSite: MapPin,
  IfcBuilding: Building2,
  IfcBuildingStorey: Layers,
  IfcSpace: Box,
  IfcWall: Square,
  IfcWallStandardCase: Square,
  IfcDoor: DoorOpen,
  default: Box,
};

export function HierarchyPanel() {
  const { ifcDataStore } = useIfc();
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const selectedStoreys = useViewerStore((s) => s.selectedStoreys);
  const toggleStoreySelection = useViewerStore((s) => s.toggleStoreySelection);
  const setStoreySelection = useViewerStore((s) => s.setStoreySelection);
  const setStoreysSelection = useViewerStore((s) => s.setStoreysSelection);
  const clearStoreySelection = useViewerStore((s) => s.clearStoreySelection);
  
  // Track anchor for shift-click range selection
  const lastClickedStoreyRef = useRef<number | null>(null);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const hideEntities = useViewerStore((s) => s.hideEntities);
  const showEntities = useViewerStore((s) => s.showEntities);
  const toggleEntityVisibility = useViewerStore((s) => s.toggleEntityVisibility);
  const isEntityVisible = useViewerStore((s) => s.isEntityVisible);

  const clearSelection = useViewerStore((s) => s.clearSelection);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());

  // Get storey elements mapping for visibility toggle
  const storeyElementsMap = useMemo(() => {
    if (!ifcDataStore?.spatialHierarchy) return new Map<number, number[]>();
    return ifcDataStore.spatialHierarchy.byStorey;
  }, [ifcDataStore]);

  // Ordered list of storey IDs (for shift-click range selection)
  const orderedStoreyIds = useMemo(() => {
    if (!ifcDataStore?.spatialHierarchy) return [];
    const hierarchy = ifcDataStore.spatialHierarchy;
    const storeysArray = Array.from(hierarchy.byStorey.entries()) as [number, number[]][];
    return storeysArray
      .map(([id]) => ({
        id,
        elevation: hierarchy.storeyElevations.get(id) ?? 0,
      }))
      .sort((a, b) => b.elevation - a.elevation)
      .map(s => s.id);
  }, [ifcDataStore]);

  // Build spatial tree data
  const treeData = useMemo((): TreeNode[] => {
    if (!ifcDataStore?.spatialHierarchy) return [];

    const hierarchy = ifcDataStore.spatialHierarchy;
    const { byStorey, storeyElevations, storeyHeights } = hierarchy;
    const nodes: TreeNode[] = [];

    // Add project
    nodes.push({
      id: hierarchy.project.expressId,
      name: hierarchy.project.name || 'Project',
      type: 'IfcProject',
      depth: 0,
      hasChildren: hierarchy.byStorey.size > 0,
      isExpanded: true,
      isVisible: true,
    });

    // Add storeys sorted by elevation
    const storeysArray = Array.from(byStorey.entries()) as [number, number[]][];

    // Collect storeys with elevations - skip expensive property extraction if heights already computed
    const storeysWithData = storeysArray
      .map(([id, elements]: [number, number[]]) => {
        // Use pre-computed height if available (fast path)
        const height = storeyHeights?.get(id);
        const elevation = storeyElevations.get(id);
        
        return {
          id,
          name: ifcDataStore.entities.getName(id) || `Storey #${id}`,
          elevation: elevation !== undefined ? elevation : 0,
          height,
          elements,
        };
      })
      .sort((a, b) => a.elevation - b.elevation);

    // Calculate heights from elevation differences for storeys without height
    const heightsFromElevation = new Map<number, number>();
    for (let i = 0; i < storeysWithData.length - 1; i++) {
      const current = storeysWithData[i];
      const next = storeysWithData[i + 1];
      if (current.height === undefined) {
        const calculatedHeight = next.elevation - current.elevation;
        if (calculatedHeight > 0) {
          heightsFromElevation.set(current.id, calculatedHeight);
        }
      }
    }

    // Apply calculated heights and sort descending for display
    const storeys = storeysWithData
      .map(s => ({
        ...s,
        height: s.height ?? heightsFromElevation.get(s.id),
      }))
      .sort((a, b) => b.elevation - a.elevation); // Sort descending for display

    for (const storey of storeys) {
      const isStoreyExpanded = expandedNodes.has(storey.id);

      nodes.push({
        id: storey.id,
        name: storey.name,
        type: 'IfcBuildingStorey',
        depth: 1,
        hasChildren: storey.elements.length > 0,
        isExpanded: isStoreyExpanded,
        isVisible: true,
        elementCount: storey.elements.length,
        storeyElevation: storey.elevation,
      });

      // Add storey elements if expanded
      if (isStoreyExpanded && storey.elements.length > 0) {
        for (const elementId of storey.elements) {
          const entityType = ifcDataStore.entities.getTypeName(elementId) || 'Unknown';
          const entityName = ifcDataStore.entities.getName(elementId) || `${entityType} #${elementId}`;

          nodes.push({
            id: elementId,
            name: entityName,
            type: entityType,
            depth: 2,
            hasChildren: false,
            isExpanded: false,
            isVisible: isEntityVisible(elementId),
          });
        }
      }
    }

    return nodes;
  }, [ifcDataStore, expandedNodes, isEntityVisible, hiddenEntities]);

  // Filter nodes based on search
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return treeData;
    const query = searchQuery.toLowerCase();
    return treeData.filter(node =>
      node.name.toLowerCase().includes(query) ||
      node.type.toLowerCase().includes(query)
    );
  }, [treeData, searchQuery]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filteredNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const toggleExpand = useCallback((id: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Toggle visibility for a node - if storey, toggle all elements
  const handleVisibilityToggle = useCallback((node: TreeNode) => {
    if (node.type === 'IfcBuildingStorey') {
      const elements = storeyElementsMap.get(node.id) || [];
      if (elements.length === 0) return;

      // Check if all elements are visible
      const allVisible = elements.every(id => isEntityVisible(id));

      if (allVisible) {
        // Hide all elements in storey
        hideEntities(elements);
        // Clear selection if selected element is being hidden
        if (selectedEntityId !== null && elements.includes(selectedEntityId)) {
          clearSelection();
        }
      } else {
        // Show all elements in storey
        showEntities(elements);
      }
    } else {
      // Single element toggle
      const wasVisible = isEntityVisible(node.id);
      toggleEntityVisibility(node.id);
      // Clear selection if we just hid the selected element
      if (wasVisible && selectedEntityId === node.id) {
        clearSelection();
      }
    }
  }, [storeyElementsMap, isEntityVisible, hideEntities, showEntities, toggleEntityVisibility, selectedEntityId, clearSelection]);

  // Check if storey has any visible elements (show as hidden only when ALL are hidden)
  const isStoreyVisible = useCallback((storeyId: number) => {
    const elements = storeyElementsMap.get(storeyId) || [];
    if (elements.length === 0) return true;
    return elements.some(id => isEntityVisible(id));
  }, [storeyElementsMap, isEntityVisible]);

  const handleNodeClick = useCallback((node: TreeNode, e: React.MouseEvent) => {
    if (node.type === 'IfcBuildingStorey') {
      if (e.shiftKey && lastClickedStoreyRef.current !== null) {
        // Shift+click: select range from anchor to clicked item
        const anchorIdx = orderedStoreyIds.indexOf(lastClickedStoreyRef.current);
        const clickedIdx = orderedStoreyIds.indexOf(node.id);
        
        if (anchorIdx !== -1 && clickedIdx !== -1) {
          const startIdx = Math.min(anchorIdx, clickedIdx);
          const endIdx = Math.max(anchorIdx, clickedIdx);
          const rangeIds = orderedStoreyIds.slice(startIdx, endIdx + 1);
          setStoreysSelection(rangeIds);
        } else {
          // Fallback if indices not found
          setStoreySelection(node.id);
          lastClickedStoreyRef.current = node.id;
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+click: toggle individual item in selection
        toggleStoreySelection(node.id);
        lastClickedStoreyRef.current = node.id;
      } else {
        // Normal click: single select (or deselect if already only selected)
        setStoreySelection(node.id);
        lastClickedStoreyRef.current = node.id;
      }
    } else {
      setSelectedEntityId(node.id);
    }
  }, [toggleStoreySelection, setStoreySelection, setStoreysSelection, setSelectedEntityId, orderedStoreyIds]);

  if (!ifcDataStore) {
    return (
      <div className="h-full flex flex-col border-r-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">Hierarchy</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-white dark:bg-black">
          <div className="w-16 h-16 border-2 border-dashed border-zinc-300 dark:border-zinc-800 flex items-center justify-center mb-4 bg-zinc-100 dark:bg-zinc-950">
            <LayoutTemplate className="h-8 w-8 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="font-bold uppercase text-zinc-900 dark:text-zinc-100 mb-2">No Model</p>
          <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 max-w-[150px]">
            Structure will appear here when loaded
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border-r-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
      {/* Header */}
      <div className="p-3 border-b-2 border-zinc-200 dark:border-zinc-800 space-y-3 bg-zinc-50 dark:bg-black">
        <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">Hierarchy</h2>
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          className="h-9 text-sm rounded-none border-2 border-zinc-200 dark:border-zinc-800 focus:border-primary focus:ring-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
        />
      </div>

      {/* Tree */}
      <div ref={parentRef} className="flex-1 overflow-auto scrollbar-thin bg-white dark:bg-black">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = filteredNodes[virtualRow.index];
            const Icon = TYPE_ICONS[node.type] || TYPE_ICONS.default;
            const isSelected = node.type === 'IfcBuildingStorey'
              ? selectedStoreys.has(node.id)
              : selectedEntityId === node.id;
            // For storeys, check if all elements are visible
            const nodeVisible = node.type === 'IfcBuildingStorey'
              ? isStoreyVisible(node.id)
              : isEntityVisible(node.id);
            const nodeHidden = !nodeVisible;

            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-1.5 cursor-pointer border-l-4 transition-all group hierarchy-item',
                    isSelected ? 'border-l-primary font-medium selected' : 'border-transparent',
                    nodeHidden && 'opacity-50 grayscale'
                  )}
                  style={{ 
                    paddingLeft: `${node.depth * 16 + 8}px`,
                    backgroundColor: isSelected ? 'var(--hierarchy-selected-bg)' : undefined,
                    color: isSelected ? 'var(--hierarchy-selected-text)' : 'var(--hierarchy-text)'
                  }}
                  onClick={(e) => {
                    // Only handle click if not clicking on a button
                    if ((e.target as HTMLElement).closest('button') === null) {
                      handleNodeClick(node, e);
                    }
                  }}
                  onMouseDown={(e) => {
                    // Prevent text selection when clicking
                    if ((e.target as HTMLElement).closest('button') === null) {
                      e.preventDefault();
                    }
                  }}
                >
                  {/* Expand/Collapse */}
                  {node.hasChildren ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(node.id);
                      }}
                      className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-none mr-1"
                    >
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 transition-transform duration-200',
                          node.isExpanded && 'rotate-90'
                        )}
                      />
                    </button>
                  ) : (
                    <div className="w-5" />
                  )}

                  {/* Visibility Toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleVisibilityToggle(node);
                        }}
                        className={cn(
                          'p-0.5 opacity-0 group-hover:opacity-100 transition-opacity mr-1',
                          nodeHidden && 'opacity-100'
                        )}
                      >
                        {nodeVisible ? (
                          <Eye className="h-3 w-3 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                        ) : (
                          <EyeOff className="h-3 w-3 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{nodeVisible ? 'Hide' : 'Show'}</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Type Icon */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Icon className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{node.type}</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Name */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={cn(
                        'flex-1 text-sm truncate ml-1.5 text-zinc-900 dark:text-zinc-200',
                        nodeHidden && 'line-through decoration-zinc-400 dark:decoration-zinc-600'
                      )}>{node.name}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{node.name}</p>
                    </TooltipContent>
                  </Tooltip>

                  {/* Storey Elevation */}
                  {node.storeyElevation !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 rounded-none">
                          {node.storeyElevation >= 0 ? '+' : ''}{node.storeyElevation.toFixed(2)}m
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Elevation: {node.storeyElevation >= 0 ? '+' : ''}{node.storeyElevation.toFixed(2)}m from ground</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {/* Element Count */}
                  {node.elementCount !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-950 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 rounded-none">
                          {node.elementCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{node.elementCount} {node.elementCount === 1 ? 'element' : 'elements'}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Filter */}
      {selectedStoreys.size > 0 ? (
        <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 bg-primary text-white dark:bg-primary">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="uppercase tracking-wide">
              {selectedStoreys.size} {selectedStoreys.size === 1 ? 'STOREY' : 'STOREYS'} FILTERED
            </span>
            <div className="flex items-center gap-2">
              <span className="opacity-70 text-[10px] font-mono">ESC</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] uppercase border border-white/20 hover:bg-white/20 hover:text-white rounded-none px-2"
                onClick={clearStoreySelection}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : ifcDataStore?.spatialHierarchy?.byStorey && ifcDataStore.spatialHierarchy.byStorey.size > 1 && (
        <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500 text-center bg-zinc-50 dark:bg-black font-mono">
          Click to filter · Shift range · Ctrl toggle
        </div>
      )}
    </div>
  );
}
