/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens data discovery hook
 *
 * Runs lens data discovery when models change, populating the store
 * with available IFC types, property sets, quantity sets, classification
 * systems, and material names from the loaded models.
 *
 * Discovery runs asynchronously (deferred to a microtask) to avoid
 * blocking the main thread during model loading.
 */

import { useEffect, useRef } from 'react';
import { discoverLensData } from '@ifc-lite/lens';
import { useViewerStore } from '@/store';
import { createLensDataProvider } from '@/lib/lens';

/**
 * Run lens data discovery when models change.
 * Stores result in `discoveredLensData` on the lens slice.
 *
 * Uses model count + ifcDataStore identity as trigger — avoids
 * subscribing to the full models Map (which would cause re-renders
 * on every model property change).
 */
export function useLensDiscovery(): void {
  // Subscribe to model count — triggers when models are added/removed
  const modelCount = useViewerStore((s) => s.models.size);
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const setDiscoveredLensData = useViewerStore((s) => s.setDiscoveredLensData);

  // Track last discovery trigger to debounce
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce: wait 300ms after last model change before discovering
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const { models, ifcDataStore: ds } = useViewerStore.getState();
      if (models.size === 0 && !ds) {
        setDiscoveredLensData(null);
        return;
      }

      const provider = createLensDataProvider(models, ds);
      const discovered = discoverLensData(provider);
      setDiscoveredLensData(discovered);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [modelCount, ifcDataStore, setDiscoveredLensData]);
}
