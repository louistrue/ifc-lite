/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LocalBackend — implements BimBackend via per-namespace adapters.
 *
 * This is the viewer's internal backend: zero serialization overhead.
 * Each namespace is a plain object with named methods — no switch/dispatch.
 * LocalBackend routes via adapter[method](...args).
 */

import type { BimBackend, BimEventType } from '@ifc-lite/sdk';
import type { Adapter, StoreApi } from './adapters/types.js';
import { LEGACY_MODEL_ID } from './adapters/model-compat.js';
import { createModelAdapter } from './adapters/model-adapter.js';
import { createQueryAdapter } from './adapters/query-adapter.js';
import { createSelectionAdapter } from './adapters/selection-adapter.js';
import { createVisibilityAdapter } from './adapters/visibility-adapter.js';
import { createViewerAdapter } from './adapters/viewer-adapter.js';
import { createMutateAdapter } from './adapters/mutate-adapter.js';
import { createSpatialAdapter } from './adapters/spatial-adapter.js';
import { createLensAdapter } from './adapters/lens-adapter.js';
import { createExportAdapter } from './adapters/export-adapter.js';

export class LocalBackend implements BimBackend {
  private adapters: Record<string, Adapter>;
  private store: StoreApi;

  constructor(store: StoreApi) {
    this.store = store;
    this.adapters = {
      model: createModelAdapter(store),
      query: createQueryAdapter(store),
      selection: createSelectionAdapter(store),
      visibility: createVisibilityAdapter(store),
      viewer: createViewerAdapter(store),
      mutate: createMutateAdapter(store),
      spatial: createSpatialAdapter(store),
      lens: createLensAdapter(store),
      export: createExportAdapter(store),
    };
  }

  dispatch(namespace: string, method: string, args: unknown[]): unknown {
    const adapter = this.adapters[namespace];
    if (!adapter) {
      throw new Error(`LocalBackend: Unknown namespace '${namespace}'`);
    }
    const fn = adapter[method];
    if (typeof fn !== 'function') {
      throw new Error(`LocalBackend: Unknown method '${namespace}.${method}'`);
    }
    return fn(...args);
  }

  subscribe(event: BimEventType, handler: (data: unknown) => void): () => void {
    switch (event) {
      case 'selection:changed':
        return this.store.subscribe((state, prev) => {
          if (state.selectedEntities !== prev.selectedEntities) {
            handler({ refs: state.selectedEntities ?? [] });
          }
        });

      case 'model:loaded':
        return this.store.subscribe((state, prev) => {
          if (state.models.size > prev.models.size) {
            for (const [id, model] of state.models) {
              if (!prev.models.has(id)) {
                handler({
                  model: {
                    id: model.id,
                    name: model.name,
                    schemaVersion: model.schemaVersion,
                    entityCount: model.ifcDataStore?.entities?.count ?? 0,
                    fileSize: model.fileSize,
                    loadedAt: model.loadedAt,
                  },
                });
              }
            }
          }
          if (state.ifcDataStore && !prev.ifcDataStore && state.models.size === 0) {
            handler({
              model: {
                id: LEGACY_MODEL_ID,
                name: 'Model',
                schemaVersion: state.ifcDataStore.schemaVersion ?? 'IFC4',
                entityCount: state.ifcDataStore.entities?.count ?? 0,
                fileSize: state.ifcDataStore.source?.byteLength ?? 0,
                loadedAt: 0,
              },
            });
          }
        });

      case 'model:removed':
        return this.store.subscribe((state, prev) => {
          if (state.models.size < prev.models.size) {
            for (const id of prev.models.keys()) {
              if (!state.models.has(id)) {
                handler({ modelId: id });
              }
            }
          }
        });

      case 'visibility:changed':
        return this.store.subscribe((state, prev) => {
          if (
            state.hiddenEntities !== prev.hiddenEntities ||
            state.isolatedEntities !== prev.isolatedEntities ||
            state.hiddenEntitiesByModel !== prev.hiddenEntitiesByModel
          ) {
            handler({});
          }
        });

      case 'mutation:changed':
        return this.store.subscribe((state, prev) => {
          if (state.mutationVersion !== prev.mutationVersion) {
            handler({});
          }
        });

      case 'lens:changed':
        return this.store.subscribe((state, prev) => {
          if (state.activeLensId !== prev.activeLensId) {
            handler({ lensId: state.activeLensId });
          }
        });

      default:
        return () => {};
    }
  }
}
