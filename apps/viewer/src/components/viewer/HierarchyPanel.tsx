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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  const selectedStorey = useViewerStore((s) => s.selectedStorey);
  const setSelectedStorey = useViewerStore((s) => s.setSelectedStorey);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const hideEntities = useViewerStore((s) => s.hideEntities);
  const showEntities = useViewerStore((s) => s.showEntities);
  const toggleEntityVisibility = useViewerStore((s) => s.toggleEntityVisibility);
  const isEntityVisible = useViewerStore((s) => s.isEntityVisible);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());

  // Get storey elements mapping for visibility toggle
  const storeyElementsMap = useMemo(() => {
    if (!ifcDataStore?.spatialHierarchy) return new Map<number, number[]>();
    return ifcDataStore.spatialHierarchy.byStorey;
  }, [ifcDataStore]);

  // Build spatial tree data
  const treeData = useMemo((): TreeNode[] => {
    if (!ifcDataStore?.spatialHierarchy) return [];

    const hierarchy = ifcDataStore.spatialHierarchy;
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
    const storeysArray = Array.from(hierarchy.byStorey.entries()) as [number, number[]][];
    const storeys = storeysArray
      .map(([id, elements]: [number, number[]]) => ({
        id,
        name: ifcDataStore.entities.getName(id) || `Storey #${id}`,
        elevation: hierarchy.storeyElevations.get(id) ?? 0,
        elements,
      }))
      .sort((a, b) => b.elevation - a.elevation);

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
      } else {
        // Show all elements in storey
        showEntities(elements);
      }
    } else {
      // Single element toggle
      toggleEntityVisibility(node.id);
    }
  }, [storeyElementsMap, isEntityVisible, hideEntities, showEntities, toggleEntityVisibility]);

  // Check if storey is fully visible (all elements visible)
  const isStoreyVisible = useCallback((storeyId: number) => {
    const elements = storeyElementsMap.get(storeyId) || [];
    if (elements.length === 0) return true;
    return elements.every(id => isEntityVisible(id));
  }, [storeyElementsMap, isEntityVisible]);

  const handleNodeClick = useCallback((node: TreeNode) => {
    if (node.type === 'IfcBuildingStorey') {
      setSelectedStorey(selectedStorey === node.id ? null : node.id);
    } else {
      setSelectedEntityId(node.id);
    }
  }, [selectedStorey, setSelectedStorey, setSelectedEntityId]);

  if (!ifcDataStore) {
    return (
      <div className="h-full flex flex-col border-r bg-card">
        <div className="p-3 border-b">
          <h2 className="font-semibold text-sm">Model Hierarchy</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Load an IFC file to view hierarchy
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border-r bg-card">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <h2 className="font-semibold text-sm">Model Hierarchy</h2>
        <Input
          placeholder="Search elements..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          className="h-8 text-sm"
        />
      </div>

      {/* Tree */}
      <div ref={parentRef} className="flex-1 overflow-auto scrollbar-thin">
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
              ? selectedStorey === node.id
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
                    'flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-muted/50 border-l-2 border-transparent transition-colors group',
                    isSelected && 'bg-primary/10 border-l-primary',
                    nodeHidden && 'opacity-50'
                  )}
                  style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
                  onClick={(e) => {
                    // Only handle click if not clicking on a button
                    if ((e.target as HTMLElement).closest('button') === null) {
                      handleNodeClick(node);
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
                      className="p-0.5 hover:bg-muted rounded"
                    >
                      <ChevronRight
                        className={cn(
                          'h-3.5 w-3.5 transition-transform',
                          node.isExpanded && 'rotate-90'
                        )}
                      />
                    </button>
                  ) : (
                    <div className="w-4.5" />
                  )}

                  {/* Visibility Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVisibilityToggle(node);
                    }}
                    className={cn(
                      'p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                      nodeHidden && 'opacity-100'
                    )}
                  >
                    {nodeVisible ? (
                      <Eye className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>

                  {/* Type Icon */}
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />

                  {/* Name */}
                  <span className={cn(
                    'flex-1 text-sm truncate',
                    nodeHidden && 'line-through'
                  )}>{node.name}</span>

                  {/* Element Count */}
                  {node.elementCount !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {node.elementCount}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Filter */}
      {selectedStorey && (
        <div className="p-2 border-t bg-primary/5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Filtered to storey
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setSelectedStorey(null)}
            >
              Clear filter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
