/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Context menu for entity interactions
 */

import { useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Focus,
  EyeOff,
  Eye,
  Layers,
  Copy,
  Maximize2,
  Building2,
} from 'lucide-react';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';

export function EntityContextMenu() {
  const contextMenu = useViewerStore((s) => s.contextMenu);
  const closeContextMenu = useViewerStore((s) => s.closeContextMenu);
  const isolateEntity = useViewerStore((s) => s.isolateEntity);
  const hideEntity = useViewerStore((s) => s.hideEntity);
  const showAll = useViewerStore((s) => s.showAll);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setSelectedEntityIds = useViewerStore((s) => s.setSelectedEntityIds);
  const cameraCallbacks = useViewerStore((s) => s.cameraCallbacks);
  const resolveGlobalIdFromModels = useViewerStore((s) => s.resolveGlobalIdFromModels);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ifcDataStore, models } = useIfc();

  // Resolve contextMenu.entityId (globalId) to original expressId and model
  // This is needed because IfcDataStore uses original expressIds, not globalIds
  const { resolvedExpressId, activeDataStore } = useMemo(() => {
    if (!contextMenu.entityId) {
      return { resolvedExpressId: null, activeDataStore: ifcDataStore };
    }

    // Use store-based resolver (more reliable than singleton)
    const resolved = resolveGlobalIdFromModels(contextMenu.entityId);
    if (resolved) {
      const model = models.get(resolved.modelId);
      return {
        resolvedExpressId: resolved.expressId,
        activeDataStore: model?.ifcDataStore ?? ifcDataStore,
      };
    }

    // Fallback for single-model mode (offset = 0)
    return { resolvedExpressId: contextMenu.entityId, activeDataStore: ifcDataStore };
  }, [contextMenu.entityId, models, ifcDataStore, resolveGlobalIdFromModels]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    if (contextMenu.isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu.isOpen, closeContextMenu]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    };

    if (contextMenu.isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [contextMenu.isOpen, closeContextMenu]);

  const handleZoomTo = useCallback(() => {
    if (contextMenu.entityId) {
      setSelectedEntityId(contextMenu.entityId);
      cameraCallbacks.fitAll?.();
    }
    closeContextMenu();
  }, [contextMenu.entityId, setSelectedEntityId, cameraCallbacks, closeContextMenu]);

  const handleIsolate = useCallback(() => {
    if (contextMenu.entityId) {
      isolateEntity(contextMenu.entityId);
    }
    closeContextMenu();
  }, [contextMenu.entityId, isolateEntity, closeContextMenu]);

  const handleHide = useCallback(() => {
    if (contextMenu.entityId) {
      hideEntity(contextMenu.entityId);
    }
    closeContextMenu();
  }, [contextMenu.entityId, hideEntity, closeContextMenu]);

  const handleShowAll = useCallback(() => {
    showAll();
    closeContextMenu();
  }, [showAll, closeContextMenu]);

  const handleSelectSimilar = useCallback(() => {
    // Use resolvedExpressId (original ID) for IfcDataStore lookups
    if (!resolvedExpressId || !activeDataStore) {
      closeContextMenu();
      return;
    }

    // Get the type of the selected entity
    const entity = activeDataStore.entities;
    let entityType: string | null = null;

    for (let i = 0; i < entity.count; i++) {
      if (entity.expressId[i] === resolvedExpressId) {
        entityType = entity.getTypeName(resolvedExpressId);
        break;
      }
    }

    if (entityType) {
      // Select all entities of the same type
      // NOTE: These are original expressIds - for multi-model, should transform to globalIds
      const sameTypeIds: number[] = [];
      for (let i = 0; i < entity.count; i++) {
        if (entity.getTypeName(entity.expressId[i]) === entityType) {
          sameTypeIds.push(entity.expressId[i]);
        }
      }
      setSelectedEntityIds(sameTypeIds);
    }

    closeContextMenu();
  }, [resolvedExpressId, activeDataStore, setSelectedEntityIds, closeContextMenu]);

  const handleSelectSameStorey = useCallback(() => {
    // Use resolvedExpressId (original ID) for IfcDataStore lookups
    if (!resolvedExpressId || !activeDataStore?.spatialHierarchy) {
      closeContextMenu();
      return;
    }

    const storeyId = activeDataStore.spatialHierarchy.elementToStorey.get(resolvedExpressId);
    if (storeyId) {
      const storeyElements = activeDataStore.spatialHierarchy.byStorey.get(storeyId);
      if (storeyElements) {
        // NOTE: These are original expressIds - for multi-model, should transform to globalIds
        setSelectedEntityIds(Array.from(storeyElements));
      }
    }

    closeContextMenu();
  }, [resolvedExpressId, activeDataStore, setSelectedEntityIds, closeContextMenu]);

  const handleCopyId = useCallback(() => {
    // Use resolvedExpressId (original ID) for IfcDataStore lookups
    if (resolvedExpressId && activeDataStore) {
      const globalId = activeDataStore.entities.getGlobalId(resolvedExpressId);
      if (globalId) {
        navigator.clipboard.writeText(globalId);
      }
    }
    closeContextMenu();
  }, [resolvedExpressId, activeDataStore, closeContextMenu]);

  if (!contextMenu.isOpen) {
    return null;
  }

  // Get entity info for display
  // Use resolvedExpressId (original ID) for IfcDataStore lookups
  let entityName = '';
  let entityType = '';
  if (resolvedExpressId && activeDataStore) {
    entityName = activeDataStore.entities.getName(resolvedExpressId) || '';
    entityType = activeDataStore.entities.getTypeName(resolvedExpressId) || '';
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-popover border rounded-lg shadow-lg py-1 min-w-48"
      style={{
        left: contextMenu.screenX,
        top: contextMenu.screenY,
      }}
    >
      {contextMenu.entityId && (
        <>
          {/* Entity Header */}
          <div className="px-3 py-2 border-b">
            <div className="font-medium text-sm truncate">
              {entityName || `${entityType} #${contextMenu.entityId}`}
            </div>
            <div className="text-xs text-muted-foreground">{entityType}</div>
          </div>

          <MenuItem icon={Maximize2} label="Zoom to" onClick={handleZoomTo} />
          <MenuItem icon={Focus} label="Isolate" onClick={handleIsolate} />
          <MenuItem icon={EyeOff} label="Hide" onClick={handleHide} />

          <div className="h-px bg-border my-1" />

          <MenuItem icon={Layers} label={`Select all ${entityType}`} onClick={handleSelectSimilar} />
          <MenuItem icon={Building2} label="Select same storey" onClick={handleSelectSameStorey} />

          <div className="h-px bg-border my-1" />

          <MenuItem icon={Copy} label="Copy GlobalId" onClick={handleCopyId} />
        </>
      )}

      {!contextMenu.entityId && (
        <>
          <MenuItem icon={Eye} label="Show all" onClick={handleShowAll} />
        </>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function MenuItem({ icon: Icon, label, onClick, disabled }: MenuItemProps) {
  return (
    <button
      className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </button>
  );
}
