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
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { BimContext, EntityRef, EntityData } from '@ifc-lite/sdk';
import type { SandboxPermissions } from './types.js';

// ============================================================================
// Schema Types
// ============================================================================

/** How to unmarshal a single argument from QuickJS */
type ArgType =
  | 'string'       // vm.getString(handle)
  | 'number'       // vm.getNumber(handle)
  | 'dump'         // vm.dump(handle) — generic JSON-like value
  | 'entityRefs'   // vm.dump(handle) — array of entities, map to .ref
  | '...strings'   // rest: collect all remaining args as strings

/** How to marshal the return value back to QuickJS */
type ReturnType =
  | 'void'       // No return value
  | 'string'     // Return as vm.newString()
  | 'value'      // Return as marshalValue() (generic)

export interface MethodSchema {
  /** Method name exposed in QuickJS (e.g., 'colorize') */
  name: string;
  /** Human-readable description for editor completions */
  doc: string;
  /** Argument types, in order */
  args: ArgType[];
  /** Parameter names for generated TypeScript declarations (optional) */
  paramNames?: string[];
  /** Override TypeScript parameter types (indexed by position, undefined = use default) */
  tsParamTypes?: (string | undefined)[];
  /** TypeScript return type for generated declarations (default: inferred from returns) */
  tsReturn?: string;
  /** Execute the SDK call and return a native JS value */
  call: (sdk: BimContext, args: unknown[]) => unknown;
  /** How to marshal the return value */
  returns: ReturnType;
}

export interface NamespaceSchema {
  /** Namespace name on the `bim` object (e.g., 'viewer') */
  name: string;
  /** Human-readable description for editor completions */
  doc: string;
  /** Permission key — if false, this namespace is skipped */
  permission: keyof SandboxPermissions;
  /** Methods in this namespace */
  methods: MethodSchema[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Add PascalCase IFC aliases to entity data for script flexibility.
 * Scripts can use either e.name or e.Name, e.type or e.Type, etc.
 */
function withAliases(entity: EntityData): Record<string, unknown> {
  return {
    ref: entity.ref,
    globalId: entity.globalId, GlobalId: entity.globalId,
    name: entity.name, Name: entity.name,
    type: entity.type, Type: entity.type,
    description: entity.description, Description: entity.description,
    objectType: entity.objectType, ObjectType: entity.objectType,
  };
}

/**
 * Extract an EntityRef from a dumped entity object.
 * Accepts both { ref: { modelId, expressId } } and { modelId, expressId }.
 */
function toRef(raw: unknown): EntityRef | null {
  const obj = raw as Record<string, unknown> | null;
  if (!obj) return null;
  if (obj.ref && typeof obj.ref === 'object') {
    const ref = obj.ref as Record<string, unknown>;
    if (typeof ref.modelId === 'string' && typeof ref.expressId === 'number') {
      return ref as unknown as EntityRef;
    }
  }
  if (typeof obj.modelId === 'string' && typeof obj.expressId === 'number') {
    return obj as unknown as EntityRef;
  }
  return null;
}

// ============================================================================
// Schema Definitions
// ============================================================================

export const NAMESPACE_SCHEMAS: NamespaceSchema[] = [
  // ── bim.model ──────────────────────────────────────────────
  {
    name: 'model',
    doc: 'Model operations',
    permission: 'model',
    methods: [
      {
        name: 'list',
        doc: 'List loaded models',
        args: [],
        tsReturn: 'BimModelInfo[]',
        call: (sdk) => sdk.model.list(),
        returns: 'value',
      },
      {
        name: 'active',
        doc: 'Get active model',
        args: [],
        tsReturn: 'BimModelInfo | null',
        call: (sdk) => sdk.model.active(),
        returns: 'value',
      },
      {
        name: 'activeId',
        doc: 'Get active model ID',
        args: [],
        tsReturn: 'string | null',
        call: (sdk) => sdk.model.activeId(),
        returns: 'value',
      },
    ],
  },

  // ── bim.query ─────────────────────────────────────────────
  {
    name: 'query',
    doc: 'Query entities',
    permission: 'query',
    methods: [
      {
        name: 'all',
        doc: 'Get all entities',
        args: [],
        tsReturn: 'BimEntity[]',
        call: (sdk) => {
          return sdk.query().toArray().map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'byType',
        doc: "Filter by IFC type e.g. 'IfcWall'",
        args: ['...strings'],
        paramNames: ['types'],
        tsReturn: 'BimEntity[]',
        call: (sdk, args) => {
          const types = args[0] as string[];
          const builder = sdk.query();
          if (types.length > 0) builder.byType(...types);
          return builder.toArray().map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'entity',
        doc: 'Get entity by model ID and express ID',
        args: ['string', 'number'],
        paramNames: ['modelId', 'expressId'],
        tsReturn: 'BimEntity | null',
        call: (sdk, args) => {
          const modelId = args[0] as string;
          const expressId = args[1] as number;
          const entity = sdk.entity({ modelId, expressId });
          return entity ? withAliases(entity) : null;
        },
        returns: 'value',
      },
      {
        name: 'properties',
        doc: 'Get all IfcPropertySet data for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimPropertySet[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.properties(ref);
        },
        returns: 'value',
      },
      {
        name: 'quantities',
        doc: 'Get all IfcElementQuantity data for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimQuantitySet[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.quantities(ref);
        },
        returns: 'value',
      },
    ],
  },

  // ── bim.viewer ─────────────────────────────────────────────
  {
    name: 'viewer',
    doc: 'Viewer control',
    permission: 'viewer',
    methods: [
      {
        name: 'colorize',
        doc: "Colorize entities e.g. '#ff0000'",
        args: ['entityRefs', 'string'],
        paramNames: ['entities', 'color'],
        call: (sdk, args) => {
          sdk.viewer.colorize(args[0] as EntityRef[], args[1] as string);
        },
        returns: 'void',
      },
      {
        name: 'colorizeAll',
        doc: 'Batch colorize with [{entities, color}]',
        args: ['dump'],
        paramNames: ['batches'],
        tsParamTypes: ['Array<{ entities: BimEntity[]; color: string }>'],
        tsReturn: 'void',
        call: (sdk, args) => {
          // batches: Array<{ entities: EntityData[], color: string }>
          // Extract .ref from entity data objects and pass to SDK
          const raw = args[0] as Array<{ entities: Array<{ ref?: EntityRef } & EntityRef>; color: string }>;
          const batches = raw.map(b => ({
            refs: b.entities.map(e => e.ref ?? e),
            color: b.color,
          }));
          sdk.viewer.colorizeAll(batches);
        },
        returns: 'void',
      },
      {
        name: 'hide',
        doc: 'Hide entities',
        args: ['entityRefs'],
        paramNames: ['entities'],
        call: (sdk, args) => {
          sdk.viewer.hide(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'show',
        doc: 'Show entities',
        args: ['entityRefs'],
        paramNames: ['entities'],
        call: (sdk, args) => {
          sdk.viewer.show(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'isolate',
        doc: 'Isolate entities',
        args: ['entityRefs'],
        paramNames: ['entities'],
        call: (sdk, args) => {
          sdk.viewer.isolate(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'select',
        doc: 'Select entities',
        args: ['entityRefs'],
        paramNames: ['entities'],
        call: (sdk, args) => {
          sdk.viewer.select(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'flyTo',
        doc: 'Fly camera to entities',
        args: ['entityRefs'],
        paramNames: ['entities'],
        call: (sdk, args) => {
          sdk.viewer.flyTo(args[0] as EntityRef[]);
        },
        returns: 'void',
      },
      {
        name: 'resetColors',
        doc: 'Reset all colors',
        args: [],
        call: (sdk) => {
          sdk.viewer.resetColors();
        },
        returns: 'void',
      },
      {
        name: 'resetVisibility',
        doc: 'Reset all visibility',
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
    doc: 'Property editing',
    permission: 'mutate',
    methods: [
      {
        name: 'setProperty',
        doc: 'Set a property value',
        args: ['dump', 'string', 'string', 'dump'],
        paramNames: ['entity', 'psetName', 'propName', 'value'],
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
        doc: 'Delete a property',
        args: ['dump', 'string', 'string'],
        paramNames: ['entity', 'psetName', 'propName'],
        call: (sdk, args) => {
          sdk.mutate.deleteProperty(
            args[0] as EntityRef,
            args[1] as string,
            args[2] as string,
          );
        },
        returns: 'void',
      },
      // Note: batch is intentionally omitted — it takes a callback in the SDK
      // but QuickJS cannot marshal functions through vm.dump(). Scripts should
      // use individual setProperty calls instead.
      {
        name: 'undo',
        doc: 'Undo last mutation',
        args: ['string'],
        paramNames: ['modelId'],
        call: (sdk, args) => {
          sdk.mutate.undo(args[0] as string);
        },
        returns: 'void',
      },
      {
        name: 'redo',
        doc: 'Redo undone mutation',
        args: ['string'],
        paramNames: ['modelId'],
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
    doc: 'Lens visualization',
    permission: 'lens',
    methods: [
      {
        name: 'presets',
        doc: 'Get built-in lens presets',
        args: [],
        tsReturn: 'unknown[]',
        call: (sdk) => sdk.lens.presets(),
        returns: 'value',
      },
    ],
  },

  // ── bim.export ─────────────────────────────────────────────
  {
    name: 'export',
    doc: 'Data export',
    permission: 'export',
    methods: [
      {
        name: 'csv',
        doc: 'Export entities to CSV string',
        args: ['entityRefs', 'dump'],
        paramNames: ['entities', 'options'],
        tsParamTypes: [undefined, '{ columns: string[]; filename?: string; separator?: string }'],
        tsReturn: 'string',
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
        doc: 'Export entities to JSON array',
        args: ['entityRefs', 'dump'],
        paramNames: ['entities', 'columns'],
        tsParamTypes: [undefined, 'string[]'],
        tsReturn: 'Record<string, unknown>[]',
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
    switch (argTypes[i]) {
      case 'string': {
        const handle = handles[i];
        result.push(handle ? vm.getString(handle) : undefined);
        break;
      }
      case 'number': {
        const handle = handles[i];
        result.push(handle ? vm.getNumber(handle) : undefined);
        break;
      }
      case 'dump': {
        const handle = handles[i];
        result.push(handle ? vm.dump(handle) : undefined);
        break;
      }
      case 'entityRefs': {
        const handle = handles[i];
        if (!handle) { result.push([]); break; }
        const raw = vm.dump(handle) as Array<{ ref?: EntityRef } & EntityRef>;
        result.push(raw.map(r => r.ref ?? r));
        break;
      }
      case '...strings': {
        // Collect all remaining handles as strings
        const rest: string[] = [];
        for (let j = i; j < handles.length; j++) {
          if (handles[j]) rest.push(vm.getString(handles[j]));
        }
        result.push(rest);
        return result; // No more args after rest
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
