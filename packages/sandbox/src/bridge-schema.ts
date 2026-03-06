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
import { IfcCreator } from '@ifc-lite/sdk';
import type { SandboxPermissions } from './types.js';

// ============================================================================
// Creator Registry (stateful IfcCreator instances for sandbox sessions)
// ============================================================================

/** Simple registry for IfcCreator instances managed by the sandbox */
const creatorRegistry = (() => {
  let nextHandle = 1;
  const creators = new Map<number, IfcCreator>();
  return {
    register(creator: IfcCreator): number {
      const handle = nextHandle++;
      creators.set(handle, creator);
      return handle;
    },
    get(handle: number): IfcCreator {
      const creator = creators.get(handle);
      if (!creator) throw new Error(`Invalid creator handle: ${handle}`);
      return creator;
    },
    remove(handle: number): void {
      creators.delete(handle);
    },
  };
})();

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
// Auto-discovery for bim.create (IfcCreator methods)
// ============================================================================

/**
 * Classify IfcCreator methods by their signature pattern so we can
 * auto-generate the correct bridge wiring.
 *
 * Patterns (all prepend a `handle` arg for the creator registry):
 *   'storey-params'  — (storeyId: number, params: object) → number
 *   'element-params' — (elementId: number, params: object) → number | void
 *   'no-args'        — () → value  (e.g. getWorldPlacementId)
 *   'special'        — handled individually (project, toIfc, setColor)
 */
type MethodPattern = 'storey-params' | 'element-params' | 'no-args' | 'special';

/** Methods with non-standard signatures that need hand-written wiring */
const SPECIAL_METHODS = new Set([
  'constructor', 'toIfc', 'setColor',
]);

/**
 * Explicit allow-list of IfcCreator methods exposed in the sandbox.
 * Only methods in this set (or in SPECIAL_METHODS/ELEMENT_METHODS/ZERO_ARG_METHODS)
 * are wired. This prevents accidental exposure of private/internal helpers.
 */
const ALLOWED_METHODS = new Set([
  // Spatial structure
  'addIfcBuildingStorey',
  // Building elements
  'addIfcWall', 'addIfcSlab', 'addIfcColumn', 'addIfcBeam',
  'addIfcStair', 'addIfcRoof', 'addIfcGableRoof', 'addIfcWallDoor', 'addIfcWallWindow', 'addIfcDoor', 'addIfcWindow',
  'addIfcRamp', 'addIfcRailing', 'addIfcPlate', 'addIfcMember',
  'addIfcFooting', 'addIfcPile', 'addIfcSpace', 'addIfcCurtainWall',
  'addIfcFurnishingElement', 'addIfcBuildingElementProxy',
  // Specialized profiles
  'addIfcCircularColumn', 'addIfcIShapeBeam',
  'addIfcLShapeMember', 'addIfcTShapeMember', 'addIfcUShapeMember',
  'addIfcHollowCircularColumn', 'addIfcRectangleHollowBeam',
  // Generic element creation
  'addElement', 'addAxisElement', 'createProfile',
  // Properties and materials
  'addIfcPropertySet', 'addIfcElementQuantity', 'addIfcMaterial',
  // Low-level geometry
  'getWorldPlacementId',
]);

/** Methods that take (elementId, def) instead of (storeyId, params) */
const ELEMENT_METHODS = new Set([
  'addIfcPropertySet', 'addIfcElementQuantity', 'addIfcMaterial',
]);

/** Methods with zero args (just need the handle) */
const ZERO_ARG_METHODS = new Set([
  'getWorldPlacementId',
]);

function classifyMethod(name: string, _fn: Function): MethodPattern {
  if (SPECIAL_METHODS.has(name)) return 'special';
  if (ZERO_ARG_METHODS.has(name)) return 'no-args';
  if (ELEMENT_METHODS.has(name)) return 'element-params';
  return 'storey-params';
}

/** Humanize a method name for the doc string */
function methodDoc(name: string): string {
  // addIfcWall → 'Add an IfcWall'
  // addElement → 'Add a generic element'
  // createProfile → 'Create a profile from a ProfileDef'
  if (name === 'addIfcBuildingStorey') return 'Add a building storey. Returns storey expressId.';
  if (name === 'addIfcGableRoof') return 'Add a dual-pitch gable roof. `Slope` is in radians. Returns roof expressId.';
  if (name === 'addIfcWallDoor') return 'Add a door hosted in a wall opening. Position is wall-local [alongWall, 0, baseHeight]. Returns door expressId.';
  if (name === 'addIfcWallWindow') return 'Add a window hosted in a wall opening. Position is wall-local [alongWall, 0, sillHeight]. Returns window expressId.';
  if (name === 'addElement') return 'Create ANY IFC type with a profile at a placement. Returns expressId.';
  if (name === 'addAxisElement') return 'Create ANY IFC type extruded along a Start→End axis. Returns expressId.';
  if (name === 'createProfile') return 'Create a profile from a ProfileDef union. Returns profile ID.';
  if (name === 'getWorldPlacementId') return 'Get the world placement ID for use with addLocalPlacement.';
  if (name.startsWith('addIfc')) {
    const entity = name.slice(3); // remove 'add', keep 'IfcWall' etc.
    return `Add ${entity}. Returns expressId.`;
  }
  if (name.startsWith('add')) {
    const what = name.slice(3);
    return `Add ${what}. Returns ID.`;
  }
  return `Call ${name} on the creator.`;
}

/**
 * Build all bim.create method schemas by discovering public methods
 * on IfcCreator.prototype. New methods are automatically exposed.
 */
function buildCreateMethods(): MethodSchema[] {
  const methods: MethodSchema[] = [];

  // ── Special: project (creates IfcCreator, returns handle) ──
  methods.push({
    name: 'project',
    doc: 'Create a new IFC project. Returns a creator handle (number).',
    args: ['dump'],
    paramNames: ['params'],
    tsParamTypes: ['{ Name?: string; Description?: string; Schema?: string; LengthUnit?: string; Author?: string; Organization?: string }'],
    tsReturn: 'number',
    call: (_sdk, args) => {
      const params = (args[0] ?? {}) as Record<string, unknown>;
      const creator = new IfcCreator(params as any);
      return creatorRegistry.register(creator);
    },
    returns: 'value',
  });

  // ── Special: toIfc (finalizes + cleans up handle) ──
  methods.push({
    name: 'toIfc',
    doc: 'Generate the IFC STEP file content. Returns { content, entities, stats }.',
    args: ['number'],
    paramNames: ['handle'],
    tsReturn: '{ content: string; entities: Array<{ expressId: number; type: string; Name?: string }>; stats: { entityCount: number; fileSize: number } }',
    call: (_sdk, args) => {
      const handle = args[0] as number;
      try {
        const creator = creatorRegistry.get(handle);
        return creator.toIfc();
      } finally {
        creatorRegistry.remove(handle);
      }
    },
    returns: 'value',
  });

  // ── Special: setColor (unique signature: handle, elementId, name, rgb) ──
  methods.push({
    name: 'setColor',
    doc: 'Assign a named colour to an element. Call before toIfc().',
    args: ['number', 'number', 'string', 'dump'],
    paramNames: ['handle', 'elementId', 'name', 'rgb'],
    tsReturn: 'void',
    call: (_sdk, args) => {
      const creator = creatorRegistry.get(args[0] as number);
      creator.setColor(args[1] as number, args[2] as string, args[3] as [number, number, number]);
    },
    returns: 'void',
  });

  // ── Auto-discover all other public methods from IfcCreator.prototype ──
  const proto = IfcCreator.prototype as unknown as Record<string, unknown>;
  const methodNames = Object.getOwnPropertyNames(proto)
    .filter(name => typeof proto[name] === 'function' && ALLOWED_METHODS.has(name))
    .sort();

  for (const name of methodNames) {
    const pattern = classifyMethod(name, proto[name] as Function);
    if (pattern === 'special') continue; // already handled above

    switch (pattern) {
      case 'storey-params':
        // addIfcBuildingStorey takes (params) — 1 arg after handle
        if (name === 'addIfcBuildingStorey') {
          methods.push({
            name,
            doc: methodDoc(name),
            args: ['number', 'dump'],
            paramNames: ['handle', 'params'],
            tsReturn: 'number',
            call: (_sdk, args) => {
              const creator = creatorRegistry.get(args[0] as number);
              return (creator as any)[name](args[1]);
            },
            returns: 'value',
          });
        } else {
          // Standard: (storeyId, params) — 2 args after handle
          methods.push({
            name,
            doc: methodDoc(name),
            args: ['number', 'number', 'dump'],
            paramNames: ['handle', 'storeyId', 'params'],
            tsReturn: 'number',
            call: (_sdk, args) => {
              const creator = creatorRegistry.get(args[0] as number);
              return (creator as any)[name](args[1], args[2]);
            },
            returns: 'value',
          });
        }
        break;

      case 'element-params':
        // (elementId, def) — 2 args after handle, may return number or void
        methods.push({
          name,
          doc: methodDoc(name),
          args: ['number', 'number', 'dump'],
          paramNames: ['handle', name === 'addIfcWallDoor' || name === 'addIfcWallWindow' ? 'wallId' : 'elementId', 'params'],
          tsReturn: name === 'addIfcMaterial' ? 'void' : 'number',
          call: (_sdk, args) => {
            const creator = creatorRegistry.get(args[0] as number);
            return (creator as any)[name](args[1], args[2]);
          },
          returns: name === 'addIfcMaterial' ? 'void' : 'value',
        });
        break;

      case 'no-args':
        methods.push({
          name,
          doc: methodDoc(name),
          args: ['number'],
          paramNames: ['handle'],
          tsReturn: 'number',
          call: (_sdk, args) => {
            const creator = creatorRegistry.get(args[0] as number);
            return (creator as any)[name]();
          },
          returns: 'value',
        });
        break;
    }
  }

  return methods;
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
      {
        name: 'loadIfc',
        doc: 'Load IFC content into the 3D viewer for preview',
        args: ['string', 'string'],
        paramNames: ['content', 'filename'],
        call: (sdk, args) => { sdk.model.loadIfc(args[0] as string, args[1] as string); },
        returns: 'void',
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
        name: 'attributes',
        doc: 'Get all named string/enum attributes for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimAttribute[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.attributes(ref);
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
          return sdk.properties(ref).map(pset => ({
            name: pset.name, Name: pset.name,
            globalId: pset.globalId, GlobalId: pset.globalId,
            properties: pset.properties.map(p => ({
              name: p.name, Name: p.name,
              value: p.value, Value: p.value,
              NominalValue: p.value,
              type: p.type, Type: p.type,
            })),
            Properties: pset.properties.map(p => ({
              name: p.name, Name: p.name,
              value: p.value, Value: p.value,
              NominalValue: p.value,
              type: p.type, Type: p.type,
            })),
          }));
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
          return sdk.quantities(ref).map(qset => ({
            name: qset.name, Name: qset.name,
            quantities: qset.quantities.map(q => ({
              name: q.name, Name: q.name,
              value: q.value, Value: q.value,
              type: q.type, Type: q.type,
            })),
            Quantities: qset.quantities.map(q => ({
              name: q.name, Name: q.name,
              value: q.value, Value: q.value,
              type: q.type, Type: q.type,
            })),
          }));
        },
        returns: 'value',
      },
      {
        name: 'property',
        doc: 'Get a single property value from an entity',
        args: ['dump', 'string', 'string'],
        paramNames: ['entity', 'psetName', 'propName'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'string | number | boolean | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          return sdk.property(ref, args[1] as string, args[2] as string);
        },
        returns: 'value',
      },
      {
        name: 'classifications',
        doc: 'Get classification references for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimClassification[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.classifications(ref);
        },
        returns: 'value',
      },
      {
        name: 'materials',
        doc: 'Get material assignment for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimMaterial | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          return sdk.materials(ref);
        },
        returns: 'value',
      },
      {
        name: 'typeProperties',
        doc: 'Get type-level property sets for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimTypeProperties | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          return sdk.typeProperties(ref);
        },
        returns: 'value',
      },
      {
        name: 'documents',
        doc: 'Get linked document references for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimDocument[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.documents(ref);
        },
        returns: 'value',
      },
      {
        name: 'relationships',
        doc: 'Get structural relationship summary for an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimRelationships',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return { voids: [], fills: [], groups: [], connections: [] };
          return sdk.relationships(ref);
        },
        returns: 'value',
      },
      {
        name: 'quantity',
        doc: 'Get a single quantity value from an entity',
        args: ['dump', 'string', 'string'],
        paramNames: ['entity', 'qsetName', 'quantityName'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'number | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          return sdk.quantity(ref, args[1] as string, args[2] as string);
        },
        returns: 'value',
      },
      {
        name: 'related',
        doc: 'Get related entities by IFC relationship type',
        args: ['dump', 'string', 'string'],
        paramNames: ['entity', 'relType', 'direction'],
        tsParamTypes: ['BimEntity', undefined, "'forward' | 'inverse'"],
        tsReturn: 'BimEntity[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.related(ref, args[1] as string, args[2] as 'forward' | 'inverse').map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'containedIn',
        doc: 'Get the spatial container of an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimEntity | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          const entity = sdk.containedIn(ref);
          return entity ? withAliases(entity) : null;
        },
        returns: 'value',
      },
      {
        name: 'contains',
        doc: 'Get entities contained in a spatial container',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimEntity[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.contains(ref).map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'decomposedBy',
        doc: 'Get the parent aggregate of an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimEntity | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          const entity = sdk.decomposedBy(ref);
          return entity ? withAliases(entity) : null;
        },
        returns: 'value',
      },
      {
        name: 'decomposes',
        doc: 'Get aggregated children of an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimEntity[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.decomposes(ref).map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'storey',
        doc: 'Get the containing building storey of an entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimEntity | null',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return null;
          const entity = sdk.storey(ref);
          return entity ? withAliases(entity) : null;
        },
        returns: 'value',
      },
      {
        name: 'path',
        doc: 'Get the spatial/aggregation path from project to entity',
        args: ['dump'],
        paramNames: ['entity'],
        tsParamTypes: ['BimEntity'],
        tsReturn: 'BimEntity[]',
        call: (sdk, args) => {
          const ref = toRef(args[0]);
          if (!ref) return [];
          return sdk.path(ref).map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'storeys',
        doc: 'List all building storeys',
        args: [],
        tsReturn: 'BimEntity[]',
        call: (sdk) => {
          return sdk.storeys().map(withAliases);
        },
        returns: 'value',
      },
      {
        name: 'selection',
        doc: 'Get the current viewer selection as entities',
        args: [],
        tsReturn: 'BimEntity[]',
        call: (sdk) => {
          return sdk.viewer.getSelection()
            .map((ref) => sdk.entity(ref))
            .filter((entity): entity is EntityData => Boolean(entity))
            .map(withAliases);
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

  // ── bim.create ─────────────────────────────────────────────
  //
  // Auto-discovered from IfcCreator.prototype at module load.
  // Adding a new public method to IfcCreator automatically exposes it
  // in the sandbox — no manual bridge wiring needed.
  //
  {
    name: 'create',
    doc: 'IFC creation from scratch',
    permission: 'export',  // reuses export permission — creation produces files
    methods: buildCreateMethods(),
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
      {
        name: 'download',
        doc: 'Trigger a browser file download with the given content',
        args: ['string', 'string', 'string'],
        paramNames: ['content', 'filename', 'mimeType'],
        call: (sdk, args) => {
          sdk.export.download(
            args[0] as string,
            args[1] as string,
            (args[2] as string) || 'text/plain',
          );
        },
        returns: 'void',
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
