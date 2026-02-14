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
 * Most namespaces (model, viewer, mutate, lens, export) are built from
 * declarative schemas in bridge-schema.ts. The query namespace needs
 * custom handling because of the entity proxy object pattern.
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { BimContext } from '@ifc-lite/sdk';
import type { SandboxPermissions, LogEntry } from './types.js';
import { DEFAULT_PERMISSIONS } from './types.js';
import { buildSchemaNamespaces, marshalValue } from './bridge-schema.js';

/**
 * Build the `bim` API object inside the QuickJS VM.
 * Returns captured log entries from console.* calls.
 */
export function buildBridge(
  vm: QuickJSContext,
  sdk: BimContext,
  permissions: SandboxPermissions = {},
): { logs: LogEntry[] } {
  const perms = { ...DEFAULT_PERMISSIONS, ...permissions } as Required<SandboxPermissions>;
  const logs: LogEntry[] = [];

  // ── console.log / warn / error / info ──────────────────────
  buildConsole(vm, logs);

  // ── bim global ─────────────────────────────────────────────
  const bimHandle = vm.newObject();

  // Schema-driven namespaces (model, viewer, mutate, lens, export)
  buildSchemaNamespaces(vm, bimHandle, sdk, perms);

  // Custom namespace: query (needs entity proxy marshaling)
  if (perms.query) {
    buildQueryNamespace(vm, bimHandle, sdk);
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

// ── bim.query (custom — entity proxy marshaling) ─────────────

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
    const fields: [string, string | number][] = [
      ['modelId', entity.modelId],
      ['expressId', entity.expressId],
      ['globalId', entity.globalId],
      ['name', entity.name],
      ['type', entity.type],
    ];
    for (const [key, value] of fields) {
      const handle = typeof value === 'number' ? vm.newNumber(value) : vm.newString(value);
      vm.setProp(entityObj, key, handle);
      handle.dispose();
    }

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
      return marshalValue(vm, entity.property(pset, prop));
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
      return marshalValue(vm, entity.quantity(qset, qName));
    });
    vm.setProp(entityObj, 'quantity', qtyFn);
    qtyFn.dispose();

    return entityObj;
  });
  vm.setProp(ns, 'entity', entityFn);
  entityFn.dispose();

  // bim.query.properties(entity) → PropertySetData[]
  // Convenience method: accepts entity from all()/byType() without needing bim.query.entity()
  const propsFn = vm.newFunction('properties', (entityHandle: QuickJSHandle) => {
    const raw = vm.dump(entityHandle) as { ref?: { modelId: string; expressId: number }; modelId?: string; expressId?: number };
    const modelId = raw.ref?.modelId ?? raw.modelId;
    const expressId = raw.ref?.expressId ?? raw.expressId;
    if (!modelId || expressId === undefined) return marshalValue(vm, []);
    const entity = sdk.entity({ modelId, expressId });
    if (!entity) return marshalValue(vm, []);
    return marshalValue(vm, entity.properties());
  });
  vm.setProp(ns, 'properties', propsFn);
  propsFn.dispose();

  // bim.query.quantities(entity) → QuantitySetData[]
  const qtsFn = vm.newFunction('quantities', (entityHandle: QuickJSHandle) => {
    const raw = vm.dump(entityHandle) as { ref?: { modelId: string; expressId: number }; modelId?: string; expressId?: number };
    const modelId = raw.ref?.modelId ?? raw.modelId;
    const expressId = raw.ref?.expressId ?? raw.expressId;
    if (!modelId || expressId === undefined) return marshalValue(vm, []);
    const entity = sdk.entity({ modelId, expressId });
    if (!entity) return marshalValue(vm, []);
    return marshalValue(vm, entity.quantities());
  });
  vm.setProp(ns, 'quantities', qtsFn);
  qtsFn.dispose();

  vm.setProp(bimHandle, 'query', ns);
  ns.dispose();
}
