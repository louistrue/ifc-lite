/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook to sync selectedEntityId with selectedEntity (model-aware selection)
 *
 * When an entity is selected (via click or other means), this hook:
 * 1. Watches for changes to selectedEntityId
 * 2. Finds which model contains that entity
 * 3. Updates selectedEntity with { modelId, expressId }
 *
 * This enables the PropertiesPanel to look up the correct model's data store.
 */

import { useEffect } from 'react';
import { useViewerStore } from '../store.js';

export function useModelSelection() {
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const findModelForEntity = useViewerStore((s) => s.findModelForEntity);
  // Subscribe to entityToModelMap changes for reactivity
  const entityToModelMap = useViewerStore((s) => s.entityToModelMap);

  useEffect(() => {
    if (selectedEntityId === null) {
      setSelectedEntity(null);
      return;
    }

    const modelId = findModelForEntity(selectedEntityId);
    if (modelId) {
      setSelectedEntity({ modelId, expressId: selectedEntityId });
    } else {
      // Entity not found in any model (legacy single-model or orphaned)
      setSelectedEntity(null);
    }
  }, [selectedEntityId, findModelForEntity, setSelectedEntity, entityToModelMap]);
}
