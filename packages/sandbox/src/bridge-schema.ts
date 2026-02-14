/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bridge Schema — declarative definitions for sandbox bridge methods.
 *
 * Instead of hand-writing QuickJS handle marshaling for each SDK method,
 * we define a schema (method name, arg types, SDK call, return type).
 * A generic builder creates the QuickJS functions from the schema.
 *
 * Benefits:
 * - Adding a new SDK method = adding one schema entry (no boilerplate)
 * - Impossible to forget handle disposal (generic builder handles it)
 * - Consistent arg validation and error handling
 *
 * The query namespace is excluded (needs custom entity proxy marshaling).
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { BimContext, EntityRef } from '@ifc-lite/sdk';
import type { SandboxPermissions } from './types.js';

// ============================================================================
// Schema Types
// ============================================================================

/** How to unmarshal a single argument from QuickJS */
type ArgType =
  | 'string'     // vm.getString(handle)
  | 'number'     // vm.getNumber(handle)
  | 'dump'       // vm.dump(handle) — generic JSON-like value
  | 'entityRefs' // vm.dump(handle) — array of entities, map to .ref

/** How to marshal the return value back to QuickJS */
type ReturnType =
  | 'void'       // No return value
  | 'string'     // Return as vm.newString()
  | 'value'      // Return as marshalValue() (generic)

interface MethodSchema {
  /** Method name exposed in QuickJS (e.g., 'colorize') */
  name: string;
  /** Argument types, in order */
  args: ArgType[];
  /** Execute the SDK call and return a native JS value */
  call: (sdk: BimContext, args: unknown[]) => unknown;
  /** How to marshal the return value */
  returns: ReturnType;
}

interface NamespaceSchema {
  /** Namespace name on the `bim` object (e.g., 'viewer') */
  name: string;
  /** Permission key — if false, this namespace is skipped */
  permission: keyof SandboxPermissions;
  /** Methods in this namespace */
  methods: MethodSchema[];
}

// ============================================================================
// Schema Definitions
// ============================================================================

export const NAMESPACE_SCHEMAS: NamespaceSchema[] = [
  // ── bim.model ──────────────────────────────────────────────
  {
    name: 'model',
    permission: 'model',
    methods: [
      {
        name: 'list',
        args: [],
        call: (sdk) => sdk.model.list(),
        returns: 'value',
      },
      {
        name: 'active',
        args: [],
        call: (sdk) => sdk.model.active(),
        returns: 'value',
      },
      {
        name: 'activeId',
        args: [],
        call: (sdk) => sdk.model.activeId(),
        returns: 'value',
      },
    ],
  },

  // ── bim.viewer ─────────────────────────────────────────────
  {
    name: 'viewer',
    permission: 'viewer',
    methods: [
      {
        name: 'colorize',
        args: ['entityRefs', 'string'],
        call: (sdk, args) => {
          sdk.viewer.colorize(args[0] as EntityRef[], args[1] as string);
        },
        returns: 'void',
      },
      {
        name: 'hide',
        args: ['entityRefs'],
        call: (sdk, args) => {
          sdk.viewer.hide(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'show',
        args: ['entityRefs'],
        call: (sdk, args) => {
          sdk.viewer.show(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'isolate',
        args: ['entityRefs'],
        call: (sdk, args) => {
          sdk.viewer.isolate(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'select',
        args: ['entityRefs'],
        call: (sdk, args) => {
          sdk.viewer.select(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'flyTo',
        args: ['entityRefs'],
        call: (sdk, args) => {
          sdk.viewer.flyTo(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'resetColors',
        args: [],
        call: (sdk) => {
          sdk.viewer.resetColors();
        },
        returns: 'void',
      },
      {
        name: 'resetVisibility',
        args: [],
        call: (sdk) => {
          sdk.viewer.resetVisibility();
        },
        returns: 'void',
      },
    ],
  },

  // ── bim.mutate ─────────────────────────────────────────────
  {
    name: 'mutate',
    permission: 'mutate',
    methods: [
      {
        name: 'setProperty',
        args: ['dump', 'string', 'string', 'dump'],
        call: (sdk, args) => {
          sdk.mutate.setProperty(
            args[0] as EntityRef,
            args[1] as string,
            args[2] as string,
            args[3] as string | number | boolean,
          );
        },
        returns: 'void',
      },
      {
        name: 'deleteProperty',
        args: ['dump', 'string', 'string'],
        call: (sdk, args) => {
          sdk.mutate.deleteProperty(
            args[0] as EntityRef,
            args[1] as string,
            args[2] as string,
          );
        },
        returns: 'void',
      },
      {
        name: 'batch',
        args: ['string', 'dump'],
        call: (sdk, args) => {
          // Note: batch takes a callback in the SDK but in the sandbox
          // we can't pass QuickJS functions through. Scripts use
          // individual setProperty calls instead.
          sdk.mutate.batch(args[0] as string, args[1] as () => void);
        },
        returns: 'void',
      },
      {
        name: 'undo',
        args: ['string'],
        call: (sdk, args) => {
          sdk.mutate.undo(args[0] as string);
        },
        returns: 'void',
      },
      {
        name: 'redo',
        args: ['string'],
        call: (sdk, args) => {
          sdk.mutate.redo(args[0] as string);
        },
        returns: 'void',
      },
    ],
  },

  // ── bim.lens ───────────────────────────────────────────────
  {
    name: 'lens',
    permission: 'lens',
    methods: [
      {
        name: 'presets',
        args: [],
        call: (sdk) => sdk.lens.presets(),
        returns: 'value',
      },
    ],
  },

  // ── bim.export ─────────────────────────────────────────────
  {
    name: 'export',
    permission: 'export',
    methods: [
      {
        name: 'csv',
        args: ['dump', 'dump'],
        call: (sdk, args) => {
          return sdk.export.csv(
            args[0] as EntityRef[],
            args[1] as { columns: string[]; separator?: string },
          );
        },
        returns: 'string',
      },
      {
        name: 'json',
        args: ['dump', 'dump'],
        call: (sdk, args) => {
          return sdk.export.json(
            args[0] as EntityRef[],
            args[1] as string[],
          );
        },
        returns: 'value',
      },
    ],
  },
];

// ============================================================================
// Generic Builder
// ============================================================================

/**
 * Build all schema-defined namespaces on the `bim` handle.
 * Skips namespaces whose permission is disabled.
 */
export function buildSchemaNamespaces(
  vm: QuickJSContext,
  bimHandle: QuickJSHandle,
  sdk: BimContext,
  permissions: Required<SandboxPermissions>,
): void {
  for (const schema of NAMESPACE_SCHEMAS) {
    if (!permissions[schema.permission]) continue;
    buildNamespace(vm, bimHandle, sdk, schema);
  }
}

function buildNamespace(
  vm: QuickJSContext,
  bimHandle: QuickJSHandle,
  sdk: BimContext,
  schema: NamespaceSchema,
): void {
  const nsHandle = vm.newObject();

  for (const method of schema.methods) {
    const fn = vm.newFunction(method.name, (...handles: QuickJSHandle[]) => {
      // Unmarshal arguments
      const nativeArgs = unmarshalArgs(vm, handles, method.args);

      // Call the SDK
      const result = method.call(sdk, nativeArgs);

      // Marshal return value
      return marshalReturn(vm, result, method.returns);
    });
    vm.setProp(nsHandle, method.name, fn);
    fn.dispose();
  }

  vm.setProp(bimHandle, schema.name, nsHandle);
  nsHandle.dispose();
}

/** Unmarshal QuickJS handles to native JS values based on arg schema */
function unmarshalArgs(vm: QuickJSContext, handles: QuickJSHandle[], argTypes: ArgType[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < argTypes.length; i++) {
    const handle = handles[i];
    if (!handle) {
      result.push(undefined);
      continue;
    }
    switch (argTypes[i]) {
      case 'string':
        result.push(vm.getString(handle));
        break;
      case 'number':
        result.push(vm.getNumber(handle));
        break;
      case 'dump':
        result.push(vm.dump(handle));
        break;
      case 'entityRefs': {
        const raw = vm.dump(handle) as Array<{ ref?: EntityRef } & EntityRef>;
        result.push(raw.map(r => r.ref ?? r));
        break;
      }
    }
  }
  return result;
}

/** Marshal a native JS value back to a QuickJS handle */
function marshalReturn(vm: QuickJSContext, value: unknown, type: ReturnType): QuickJSHandle | undefined {
  switch (type) {
    case 'void':
      return undefined;
    case 'string':
      return typeof value === 'string' ? vm.newString(value) : vm.null;
    case 'value':
      return marshalValue(vm, value);
  }
}

/** Recursively convert a native JS value to a QuickJS handle */
export function marshalValue(vm: QuickJSContext, value: unknown): QuickJSHandle {
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
