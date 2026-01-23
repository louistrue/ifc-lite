/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook to sync selectedEntityId with selectedEntity (model-aware selection)
 *
 * When an entity is selected (via click or other means), this hook:
 * 1. Watches for changes to selectedEntityId (which is now a globalId)
 * 2. Uses FederationRegistry to resolve globalId -> (modelId, originalExpressId)
 * 3. Updates selectedEntity with { modelId, expressId } for PropertiesPanel
 *
 * IMPORTANT: selectedEntityId is a globalId (transformed at load time)
 * The EntityRef.expressId is the ORIGINAL expressId for property lookup
 */

import { useEffect } from 'react';
import { useViewerStore } from '../store.js';
import { federationRegistry } from '@ifc-lite/renderer';

export function useModelSelection() {
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  // Subscribe to models for reactivity (when models are added/removed)
  const models = useViewerStore((s) => s.models);

  useEffect(() => {
    if (selectedEntityId === null) {
      setSelectedEntity(null);
      return;
    }

    // selectedEntityId is now a globalId
    // Resolve it back to (modelId, originalExpressId) using the registry
    const resolved = federationRegistry.fromGlobalId(selectedEntityId);
    if (resolved) {
      // Set EntityRef with ORIGINAL expressId (for property lookup in IfcDataStore)
      setSelectedEntity({ modelId: resolved.modelId, expressId: resolved.expressId });
    } else {
      // Fallback for single-model mode (offset = 0, globalId = expressId)
      // In this case, try to find the first model and use the globalId as expressId
      if (models.size > 0) {
        const firstModelId = Array.from(models.keys())[0];
        setSelectedEntity({ modelId: firstModelId, expressId: selectedEntityId });
      } else {
        // No models loaded, can't resolve
        setSelectedEntity(null);
      }
    }
  }, [selectedEntityId, setSelectedEntity, models]);
}
