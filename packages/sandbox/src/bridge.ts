/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bridge — exposes the `bim` API object inside the QuickJS sandbox.
 *
 * Architecture (Figma-inspired):
 * - No data lives inside the sandbox
 * - Every `bim.*` call crosses the WASM boundary to the host
 * - EntityProxy objects in the sandbox are lightweight refs { modelId, expressId }
 * - Property/quantity access triggers on-demand extraction on the host
 *
 * This module builds the `bim` global object inside QuickJS by creating
 * host functions for each SDK method and wiring them into a namespace tree.
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { BimContext } from '@ifc-lite/sdk';
import type { SandboxPermissions, LogEntry } from './types.js';
import { DEFAULT_PERMISSIONS } from './types.js';

/**
 * Build the `bim` API object inside the QuickJS VM.
 * Returns captured log entries from console.* calls.
 */
export function buildBridge(
  vm: QuickJSContext,
  sdk: BimContext,
  permissions: SandboxPermissions = {},
): { logs: LogEntry[] } {
  const perms = { ...DEFAULT_PERMISSIONS, ...permissions };
  const logs: LogEntry[] = [];

  // ── console.log / warn / error / info ──────────────────────
  buildConsole(vm, logs);

  // ── bim global ─────────────────────────────────────────────
  const bimHandle = vm.newObject();

  if (perms.model) {
    buildModelNamespace(vm, bimHandle, sdk);
  }

  if (perms.query) {
    buildQueryNamespace(vm, bimHandle, sdk);
  }

  if (perms.viewer) {
    buildViewerNamespace(vm, bimHandle, sdk);
  }

  if (perms.mutate) {
    buildMutateNamespace(vm, bimHandle, sdk);
  }

  if (perms.lens) {
    buildLensNamespace(vm, bimHandle, sdk);
  }

  vm.setProp(vm.global, 'bim', bimHandle);
  bimHandle.dispose();

  return { logs };
}

// ── Console ──────────────────────────────────────────────────

function buildConsole(vm: QuickJSContext, logs: LogEntry[]): void {
  const consoleHandle = vm.newObject();

  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    const fn = vm.newFunction(level, (...args: QuickJSHandle[]) => {
      const nativeArgs = args.map(a => vm.dump(a));
      logs.push({ level, args: nativeArgs, timestamp: Date.now() });
    });
    vm.setProp(consoleHandle, level, fn);
    fn.dispose();
  }

  vm.setProp(vm.global, 'console', consoleHandle);
  consoleHandle.dispose();
}

// ── bim.model ────────────────────────────────────────────────

function buildModelNamespace(vm: QuickJSContext, bimHandle: QuickJSHandle, sdk: BimContext): void {
  const ns = vm.newObject();

  const listFn = vm.newFunction('list', () => {
    const models = sdk.model.list();
    return marshalValue(vm, models);
  });
  vm.setProp(ns, 'list', listFn);
  listFn.dispose();

  const activeFn = vm.newFunction('active', () => {
    const model = sdk.model.active();
    return marshalValue(vm, model);
  });
  vm.setProp(ns, 'active', activeFn);
  activeFn.dispose();

  const activeIdFn = vm.newFunction('activeId', () => {
    const id = sdk.model.activeId();
    return id ? vm.newString(id) : vm.null;
  });
  vm.setProp(ns, 'activeId', activeIdFn);
  activeIdFn.dispose();

  vm.setProp(bimHandle, 'model', ns);
  ns.dispose();
}

// ── bim.query ────────────────────────────────────────────────

function buildQueryNamespace(vm: QuickJSContext, bimHandle: QuickJSHandle, sdk: BimContext): void {
  const ns = vm.newObject();

  // bim.query.byType(type) → EntityData[]
  const byTypeFn = vm.newFunction('byType', (...args: QuickJSHandle[]) => {
    const types = args.map(a => vm.getString(a));
    const builder = sdk.query();
    if (types.length > 0) {
      builder.byType(...types);
    }
    const entities = builder.toArray();
    // Return serializable entity data (refs + basic fields)
    const data = entities.map(e => ({
      ref: e.ref,
      globalId: e.globalId,
      name: e.name,
      type: e.type,
    }));
    return marshalValue(vm, data);
  });
  vm.setProp(ns, 'byType', byTypeFn);
  byTypeFn.dispose();

  // bim.query.all() → EntityData[]
  const allFn = vm.newFunction('all', () => {
    const entities = sdk.query().toArray();
    const data = entities.map(e => ({
      ref: e.ref,
      globalId: e.globalId,
      name: e.name,
      type: e.type,
    }));
    return marshalValue(vm, data);
  });
  vm.setProp(ns, 'all', allFn);
  allFn.dispose();

  // bim.query.entity(modelId, expressId) → EntityData with property access
  const entityFn = vm.newFunction('entity', (modelIdHandle: QuickJSHandle, expressIdHandle: QuickJSHandle) => {
    const modelId = vm.getString(modelIdHandle);
    const expressId = vm.getNumber(expressIdHandle);
    const entity = sdk.entity({ modelId, expressId });
    if (!entity) return vm.null;

    // Build an entity object with lazy methods
    const entityObj = vm.newObject();

    // Static data
    setPropStr(vm, entityObj, 'modelId', entity.modelId);
    setPropNum(vm, entityObj, 'expressId', entity.expressId);
    setPropStr(vm, entityObj, 'globalId', entity.globalId);
    setPropStr(vm, entityObj, 'name', entity.name);
    setPropStr(vm, entityObj, 'type', entity.type);

    // properties() method
    const propsFn = vm.newFunction('properties', () => {
      return marshalValue(vm, entity.properties());
    });
    vm.setProp(entityObj, 'properties', propsFn);
    propsFn.dispose();

    // property(psetName, propName) method
    const propFn = vm.newFunction('property', (psetHandle: QuickJSHandle, propHandle: QuickJSHandle) => {
      const pset = vm.getString(psetHandle);
      const prop = vm.getString(propHandle);
      const value = entity.property(pset, prop);
      return marshalValue(vm, value);
    });
    vm.setProp(entityObj, 'property', propFn);
    propFn.dispose();

    // quantities() method
    const qtsFn = vm.newFunction('quantities', () => {
      return marshalValue(vm, entity.quantities());
    });
    vm.setProp(entityObj, 'quantities', qtsFn);
    qtsFn.dispose();

    // quantity(qsetName, qName) method
    const qtyFn = vm.newFunction('quantity', (qsetHandle: QuickJSHandle, qNameHandle: QuickJSHandle) => {
      const qset = vm.getString(qsetHandle);
      const qName = vm.getString(qNameHandle);
      const value = entity.quantity(qset, qName);
      return marshalValue(vm, value);
    });
    vm.setProp(entityObj, 'quantity', qtyFn);
    qtyFn.dispose();

    return entityObj;
  });
  vm.setProp(ns, 'entity', entityFn);
  entityFn.dispose();

  vm.setProp(bimHandle, 'query', ns);
  ns.dispose();
}

// ── bim.viewer ───────────────────────────────────────────────

function buildViewerNamespace(vm: QuickJSContext, bimHandle: QuickJSHandle, sdk: BimContext): void {
  const ns = vm.newObject();

  const colorizeFn = vm.newFunction('colorize', (refsHandle: QuickJSHandle, colorHandle: QuickJSHandle) => {
    const refs = vm.dump(refsHandle) as Array<{ ref: { modelId: string; expressId: number } }>;
    const color = vm.getString(colorHandle);
    const entityRefs = refs.map(r => r.ref ?? r);
    sdk.viewer.colorize(entityRefs, color);
  });
  vm.setProp(ns, 'colorize', colorizeFn);
  colorizeFn.dispose();

  const hideFn = vm.newFunction('hide', (refsHandle: QuickJSHandle) => {
    const refs = vm.dump(refsHandle) as Array<{ ref: { modelId: string; expressId: number } }>;
    sdk.viewer.hide(refs.map(r => r.ref ?? r));
  });
  vm.setProp(ns, 'hide', hideFn);
  hideFn.dispose();

  const isolateFn = vm.newFunction('isolate', (refsHandle: QuickJSHandle) => {
    const refs = vm.dump(refsHandle) as Array<{ ref: { modelId: string; expressId: number } }>;
    sdk.viewer.isolate(refs.map(r => r.ref ?? r));
  });
  vm.setProp(ns, 'isolate', isolateFn);
  isolateFn.dispose();

  const selectFn = vm.newFunction('select', (refsHandle: QuickJSHandle) => {
    const refs = vm.dump(refsHandle) as Array<{ ref: { modelId: string; expressId: number } }>;
    sdk.viewer.select(refs.map(r => r.ref ?? r));
  });
  vm.setProp(ns, 'select', selectFn);
  selectFn.dispose();

  const resetColorsFn = vm.newFunction('resetColors', () => {
    sdk.viewer.resetColors();
  });
  vm.setProp(ns, 'resetColors', resetColorsFn);
  resetColorsFn.dispose();

  const resetVisibilityFn = vm.newFunction('resetVisibility', () => {
    sdk.viewer.resetVisibility();
  });
  vm.setProp(ns, 'resetVisibility', resetVisibilityFn);
  resetVisibilityFn.dispose();

  vm.setProp(bimHandle, 'viewer', ns);
  ns.dispose();
}

// ── bim.mutate ───────────────────────────────────────────────

function buildMutateNamespace(vm: QuickJSContext, bimHandle: QuickJSHandle, sdk: BimContext): void {
  const ns = vm.newObject();

  const setPropFn = vm.newFunction('setProperty', (
    refHandle: QuickJSHandle,
    psetHandle: QuickJSHandle,
    propHandle: QuickJSHandle,
    valueHandle: QuickJSHandle,
  ) => {
    const ref = vm.dump(refHandle) as { modelId: string; expressId: number };
    const pset = vm.getString(psetHandle);
    const prop = vm.getString(propHandle);
    const value = vm.dump(valueHandle) as string | number | boolean;
    sdk.mutate.setProperty(ref, pset, prop, value);
  });
  vm.setProp(ns, 'setProperty', setPropFn);
  setPropFn.dispose();

  const deletePropFn = vm.newFunction('deleteProperty', (
    refHandle: QuickJSHandle,
    psetHandle: QuickJSHandle,
    propHandle: QuickJSHandle,
  ) => {
    const ref = vm.dump(refHandle) as { modelId: string; expressId: number };
    const pset = vm.getString(psetHandle);
    const prop = vm.getString(propHandle);
    sdk.mutate.deleteProperty(ref, pset, prop);
  });
  vm.setProp(ns, 'deleteProperty', deletePropFn);
  deletePropFn.dispose();

  vm.setProp(bimHandle, 'mutate', ns);
  ns.dispose();
}

// ── bim.lens ─────────────────────────────────────────────────

function buildLensNamespace(vm: QuickJSContext, bimHandle: QuickJSHandle, sdk: BimContext): void {
  const ns = vm.newObject();

  const presetsFn = vm.newFunction('presets', () => {
    return marshalValue(vm, sdk.lens.presets());
  });
  vm.setProp(ns, 'presets', presetsFn);
  presetsFn.dispose();

  vm.setProp(bimHandle, 'lens', ns);
  ns.dispose();
}

// ── Marshal helpers ──────────────────────────────────────────

/** Convert a JS value to a QuickJS handle */
function marshalValue(vm: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) return vm.null;
  if (typeof value === 'string') return vm.newString(value);
  if (typeof value === 'number') return vm.newNumber(value);
  if (typeof value === 'boolean') return value ? vm.true : vm.false;

  if (Array.isArray(value)) {
    const arr = vm.newArray();
    for (let i = 0; i < value.length; i++) {
      const item = marshalValue(vm, value[i]);
      vm.setProp(arr, i, item);
      item.dispose();
    }
    return arr;
  }

  if (typeof value === 'object') {
    const obj = vm.newObject();
    for (const [k, v] of Object.entries(value)) {
      const handle = marshalValue(vm, v);
      vm.setProp(obj, k, handle);
      handle.dispose();
    }
    return obj;
  }

  return vm.null;
}

function setPropStr(vm: QuickJSContext, obj: QuickJSHandle, key: string, value: string): void {
  const handle = vm.newString(value);
  vm.setProp(obj, key, handle);
  handle.dispose();
}

function setPropNum(vm: QuickJSContext, obj: QuickJSHandle, key: string, value: number): void {
  const handle = vm.newNumber(value);
  vm.setProp(obj, key, handle);
  handle.dispose();
}
