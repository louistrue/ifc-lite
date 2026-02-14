# ifc-lite Scripting Platform — Implementation Plan

> **Status**: Phase 0-2 implemented in ifc-lite — February 2026
> **Scope**: Three repositories — `ifc-lite`, `ifc-flow`, `ifc-scripts`
> **Architecture**: SDK-first platform with QuickJS-in-WASM sandboxing and visual/code duality
>
> ## Implementation Status
>
> ### Done (ifc-lite repo)
> - [x] `@ifc-lite/sdk` — BimContext with all 10 namespaces: model, query, viewer, mutate, lens, export, ids, bcf, drawing, list, events
> - [x] SDK transport layer: BroadcastTransport, MessagePortTransport, RemoteBackend
> - [x] SDK host: BimHost with namespace dispatch, event forwarding, close()
> - [x] SDK types: EntityRef, EntityData, PropertySetData, QuantitySetData, QueryDescriptor, BimBackend interface, Transport protocol
> - [x] `@ifc-lite/sandbox` — QuickJS-in-WASM runtime, bim.* bridge (model, query, viewer, mutate, lens, export), permission system, TS transpilation (esbuild + naive fallback), memory/CPU limits
> - [x] `@ifc-lite/node-registry` — NodeDefinition schema, NodeRegistry class, 21 built-in nodes (query ×3, viewer ×5, export ×3, mutation ×4, validation ×2, lens ×2, script ×1), graph-to-script compiler (Kahn's algorithm)
> - [x] Viewer: LocalBackend (Zustand store adapter), useBimHost hook, BroadcastChannel listener, wired into App.tsx
> - [x] Root tsconfig path aliases for all 3 new packages + viewer path aliases for SDK + lens
> - [x] All 3 packages build clean with `tsc`
> - [x] Unit tests: SDK (19 tests), node-registry (17 tests), sandbox transpile (8 tests)
>
> ### TODO (ifc-lite repo — next steps)
> - [ ] Viewer slice refactor: migrate LensSlice, IDSSlice, BCFSlice, etc. to use SDK internally
> - [ ] Script → Graph decompiler (AST analysis)
> - [ ] WebSocket transport for Tauri / server-side
> - [ ] `bim.spatial` namespace (wraps @ifc-lite/spatial for BVH spatial queries)
>
> ### TODO (ifc-scripts repo — new)
> - [ ] Scaffold repo with pnpm workspaces
> - [ ] Monaco editor with bim.* IntelliSense (load @ifc-lite/sdk .d.ts)
> - [ ] Script runner (transpile → sandbox → execute)
> - [ ] Viewer connection panel (BroadcastChannel bridge)
> - [ ] Output panel (console, tables, errors)
> - [ ] Script library (save/load, templates, import/export)
> - [ ] CLI runner (`npx ifc-scripts run script.ts --model file.ifc`)
>
> ### TODO (ifc-flow repo — clean break rebuild)
> - [ ] Strip web-ifc, IfcOpenShell, Pyodide, ifc-utils.ts, Three.js viewer
> - [ ] Connect to @ifc-lite/sdk (BroadcastTransport or local)
> - [ ] Auto-generate node palette from @ifc-lite/node-registry
> - [ ] Generic NodeRenderer component from NodeDefinition
> - [ ] Script node with Monaco editor
> - [ ] Code view toggle (graph ↔ compiled script)
> - [ ] Workflow executor via SDK
> - [ ] Viewer connection mode (control real WebGPU viewer)

---

## Vision

ifc-lite becomes a **platform**, not just a viewer. The viewer and ifc-flow become frontends — peers consuming a shared SDK. Scripts and visual node graphs are two views of the same thing. Third parties can build their own tools on the same foundation.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FRONTENDS                                       │
│                                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Viewer   │  │  ifc-scripts │  │   ifc-flow   │  │ 3rd-party /    │  │
│  │  (React)  │  │  (Script IDE)│  │  (Visual IDE)│  │ CLI / CI / npm │  │
│  └─────┬─────┘  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  │
│        │               │                 │                   │           │
│        └───────┬───────┴────────┬────────┴───────────┬───────┘           │
│                │                │                    │                    │
│                ▼                ▼                    ▼                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                       @ifc-lite/sdk                               │   │
│  │                                                                    │   │
│  │  bim.model · bim.query · bim.viewer · bim.mutate · bim.export    │   │
│  │  bim.lens  · bim.ids   · bim.bcf    · bim.spatial · bim.drawing  │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                   @ifc-lite/sandbox                                │   │
│  │                                                                    │   │
│  │  QuickJS-in-WASM · bim API bridge · memory/CPU limits             │   │
│  │  TS transpilation · plugin lifecycle · permission system           │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
│                               │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     EXISTING PACKAGES (20)                        │   │
│  │                                                                    │   │
│  │  parser · renderer · geometry · query · spatial · data · wasm     │   │
│  │  lens · ids · bcf · lists · mutations · export · drawing-2d       │   │
│  │  encoding · cache · ifcx · server-client · server-bin · codegen   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Design Principles

1. **SDK-first**: The SDK is not a wrapper around the viewer — the viewer wraps the SDK. Every viewer feature is a thin React shell around an SDK call.
2. **Accessor, not data**: Never marshal large datasets into the sandbox. Expose functions (`getType(id)`, `getProperty(id, pset, prop)`) that lazily pull from the STEP buffer — preserving the existing on-demand extraction pattern.
3. **Visual = Code**: Every registered SDK function auto-generates a visual node. Every node graph compiles to a script. Users switch views freely.
4. **Sandbox by default**: All user scripts run in QuickJS-in-WASM. No DOM, no fetch, no network. Only the curated `bim.*` API crosses the boundary.
5. **Zero viewer bloat**: The script IDE and visual editor live in separate repos/apps. The viewer exposes a connection endpoint, nothing more.

---

## Repository Map

### `ifc-lite/` (this repo)

New packages:
- `packages/sdk/` — `@ifc-lite/sdk` — The `bim.*` facade
- `packages/sandbox/` — `@ifc-lite/sandbox` — QuickJS-in-WASM runtime + `bim` API bridge
- `packages/node-registry/` — `@ifc-lite/node-registry` — Function-to-visual-node metadata system

Changed:
- `apps/viewer/` — Refactored to consume `@ifc-lite/sdk` internally; exposes host connection endpoint

### `ifc-scripts/` (new repo)

- Monaco-based script IDE (standalone web app)
- Connects to viewer via `BroadcastChannel` / `MessagePort` / WebSocket
- Can also run headless (no viewer — SDK in embedded mode)
- Script library, templates, examples
- CLI runner (`npx ifc-scripts run script.ts --model building.ifc`)

### `ifc-flow/` (existing repo — clean break)

- Keeps React Flow visual editor UX
- Replaces web-ifc / IfcOpenShell / Pyodide / ifc-utils.ts with `@ifc-lite/sdk`
- Replaces Three.js viewer nodes with `bim.viewer.*` controlling shared WebGPU renderer
- Node types auto-generated from `@ifc-lite/node-registry`
- Script node embeds Monaco with `bim.*` API

---

## Phase 0: Foundation — `@ifc-lite/sdk`

**Goal**: A single import that wraps all 20 packages into a clean, chainable, `bpy`-like API.

### Package: `packages/sdk/`

```
packages/sdk/
├── package.json          # @ifc-lite/sdk
├── src/
│   ├── index.ts          # createBimContext(), BimContext type
│   ├── context.ts        # BimContext class — the `bim` object
│   │
│   ├── namespaces/
│   │   ├── model.ts      # bim.model — load, unload, list, active, federation
│   │   ├── query.ts      # bim.query — chainable entity queries
│   │   ├── entity.ts     # bim.entity — EntityNode wrapper (props, quantities, rels)
│   │   ├── viewer.ts     # bim.viewer — colorize, isolate, flyTo, section, camera
│   │   ├── selection.ts  # bim.selection — select, deselect, getSelection, onChanged
│   │   ├── visibility.ts # bim.visibility — hide, show, isolate, reset
│   │   ├── mutate.ts     # bim.mutate — setProperty, batch, undo, redo, changes
│   │   ├── export.ts     # bim.export — csv, gltf, parquet, ifc, jsonld
│   │   ├── lens.ts       # bim.lens — apply, clear, presets, discover
│   │   ├── ids.ts        # bim.ids — validate, report
│   │   ├── bcf.ts        # bim.bcf — topics, comments, viewpoints
│   │   ├── drawing.ts    # bim.drawing — sectionCut, floorPlan, elevation, exportSvg
│   │   ├── spatial.ts    # bim.spatial — within, intersects, nearest
│   │   ├── list.ts       # bim.list — execute, discover columns, presets
│   │   └── events.ts     # bim.on / bim.off — selection, visibility, model, mutation events
│   │
│   ├── transport/
│   │   ├── types.ts      # Transport interface — request/response protocol
│   │   ├── local.ts      # LocalTransport — direct function calls (same context)
│   │   ├── broadcast.ts  # BroadcastTransport — BroadcastChannel (cross-tab)
│   │   ├── message-port.ts # MessagePortTransport — MessagePort (iframe / worker)
│   │   └── websocket.ts  # WebSocketTransport — WebSocket (cross-process, Tauri, server)
│   │
│   └── host.ts           # BimHost — the viewer-side connection acceptor
```

### API Design

```typescript
// ─── Creating a context ────────────────────────────────────────
import { createBimContext } from '@ifc-lite/sdk'

// Mode 1: Embedded (viewer internal use)
const bim = createBimContext({ transport: 'local', store, renderer })

// Mode 2: Connected to a running viewer
const bim = await createBimContext({
  transport: 'broadcast',
  channel: 'ifc-lite'  // matches viewer's host channel name
})

// Mode 3: Headless (no viewer — CLI, CI, server)
const bim = await createBimContext({ transport: 'local', headless: true })

// ─── bim.model ─────────────────────────────────────────────────
const model   = await bim.model.load(file)        // File | ArrayBuffer | URL
const model   = await bim.model.load(url, { name: 'Arch' })
const models  = bim.model.list()                   // FederatedModel[]
const active  = bim.model.active()                 // current active model
bim.model.remove(model.id)
bim.model.clear()

// ─── bim.query — chainable, lazy ───────────────────────────────
const walls = bim.query()
  .model(model.id)                                 // scope to model (optional)
  .byType('IfcWall')                               // filter by IFC class
  .where('Pset_WallCommon', 'IsExternal', true)    // property filter
  .where('Qto_WallBaseQuantities', 'Height', '>', 3)
  .toArray()                                       // execute → EntityNode[]

// Or query across all models
const allDoors = bim.query().byType('IfcDoor').toArray()

// ─── EntityNode (returned by queries) ──────────────────────────
wall.id              // { modelId, expressId } — EntityRef
wall.globalId        // IFC GlobalId string
wall.name            // string
wall.type            // 'IfcWallStandardCase'
wall.property('Pset_WallCommon', 'FireRating')     // lazy, cached
wall.quantity('Qto_WallBaseQuantities', 'NetSideArea')
wall.properties()    // all PropertySet[]
wall.quantities()    // all QuantitySet[]
wall.classifications()
wall.materials()

// Relationships
wall.containedIn()   // → EntityNode (storey)
wall.contains()      // → EntityNode[]
wall.decomposes()    // → EntityNode[]
wall.voids()         // → EntityNode[] (openings)

// ─── bim.viewer — only works when connected ────────────────────
bim.viewer.colorize(entities, '#ff0000')
bim.viewer.colorize(entities, entity => {
  const rating = entity.property('Pset_WallCommon', 'FireRating')
  if (rating === 'REI 120') return '#00ff00'
  if (!rating) return '#ff0000'
  return '#ffaa00'
})
bim.viewer.resetColors(entities)

bim.viewer.hide(entities)
bim.viewer.show(entities)
bim.viewer.isolate(entities)
bim.viewer.resetVisibility()

bim.viewer.select(entities)
bim.viewer.deselect()

bim.viewer.flyTo(entity)
bim.viewer.flyTo(entities)  // fit all

bim.viewer.section({ axis: 'y', position: 3.5 })
bim.viewer.section(null)    // remove

bim.viewer.camera({ mode: 'orthographic' })
bim.viewer.camera({ mode: 'perspective' })
bim.viewer.screenshot()     // → Blob

// ─── bim.mutate — property editing with undo ───────────────────
bim.mutate.setProperty(entity, 'Pset_Custom', 'Status', 'Reviewed')
bim.mutate.deleteProperty(entity, 'Pset_Custom', 'Status')

bim.mutate.batch('Mark external walls', () => {
  for (const wall of externalWalls) {
    bim.mutate.setProperty(wall, 'Pset_Review', 'Checked', true)
  }
})  // single undo step

bim.mutate.undo()
bim.mutate.redo()
bim.mutate.changes()       // → ChangeSet[]

// ─── bim.export ────────────────────────────────────────────────
await bim.export.csv(entities, {
  columns: ['name', 'type', 'Pset_WallCommon.FireRating'],
  filename: 'walls.csv'
})
await bim.export.gltf(entities, { filename: 'model.glb' })
await bim.export.ifc(model, { filename: 'modified.ifc' })  // includes mutations
await bim.export.parquet(entities, { columns: [...] })

// ─── bim.lens — rule-based visualization ────────────────────────
const lens = bim.lens.create({
  name: 'Fire Rating Check',
  rules: [
    {
      match: { type: 'IfcWall', property: ['Pset_WallCommon', 'FireRating', 'REI 120'] },
      action: { color: '#00ff00' }
    },
    {
      match: { type: 'IfcWall', property: ['Pset_WallCommon', 'FireRating', undefined] },
      action: { color: '#ff0000', label: 'MISSING FIRE RATING' }
    }
  ]
})
bim.lens.apply(lens)
bim.lens.clear()

// ─── bim.ids — validation ──────────────────────────────────────
const report = await bim.ids.validate(model, idsSpec)
// report.specifications[].requirements[].results[]

// ─── bim.drawing — 2D architectural drawings ───────────────────
const svg = await bim.drawing.sectionCut({ axis: 'y', position: 3.5 })
const svg = await bim.drawing.floorPlan(storey)
const svg = await bim.drawing.elevation({ direction: 'north' })

// ─── bim.on — event system ─────────────────────────────────────
bim.on('selection:changed', (entities) => { ... })
bim.on('model:loaded', (model) => { ... })
bim.on('model:removed', (modelId) => { ... })
bim.on('mutation:changed', (changeSet) => { ... })
bim.on('visibility:changed', () => { ... })
```

### Transport Protocol

All SDK calls serialize to a simple request/response protocol:

```typescript
interface SdkRequest {
  id: string                    // unique request ID
  namespace: string             // 'model' | 'query' | 'viewer' | ...
  method: string                // 'load' | 'colorize' | 'byType' | ...
  args: SerializableValue[]     // JSON-serializable arguments
}

interface SdkResponse {
  id: string                    // matching request ID
  result?: SerializableValue    // success value
  error?: { message: string, stack?: string }
}

interface SdkEvent {
  type: string                  // 'selection:changed' | 'model:loaded' | ...
  data: SerializableValue
}
```

For `LocalTransport`: direct function calls, no serialization overhead.
For `BroadcastTransport` / `MessagePortTransport` / `WebSocketTransport`: JSON serialization with structured clone for binary data.

### Entity Reference Serialization

Entities cross the transport boundary as `EntityRef` objects (`{ modelId, expressId }`), not live `EntityNode` instances. The receiving side reconstructs `EntityNode` objects from refs. This keeps the protocol simple and prevents stale state.

```typescript
// SDK side (script context)
const walls = bim.query().byType('IfcWall').toArray()
// walls are EntityNode objects wrapping lazy accessors

bim.viewer.colorize(walls, '#ff0000')
// SDK serializes: { refs: [{modelId: 'arch', expressId: 42}, ...], color: '#ff0000' }
// Viewer host receives refs, maps to global IDs, calls renderer.setColorOverrides()
```

### Viewer Refactor Strategy

The viewer currently imports packages directly and wires them through Zustand slices + hooks. The refactor replaces the wiring layer with SDK calls:

```typescript
// BEFORE (apps/viewer/src/hooks/useLens.ts)
import { evaluateLens } from '@ifc-lite/lens'
import { useViewerStore } from '../store'

function useLens() {
  const activeLensId = useViewerStore(s => s.activeLensId)
  const savedLenses = useViewerStore(s => s.savedLenses)
  const models = useViewerStore(s => s.models)
  // ... 80 lines of wiring evaluateLens() to store ...
}

// AFTER (apps/viewer/src/hooks/useLens.ts)
import { useBim } from '../context/bim'

function useLens() {
  const bim = useBim()  // SDK context provided via React context
  // bim.lens.apply() handles evaluation + color overlay internally
  // The hook becomes a thin UI binding
}
```

The Zustand store remains, but the SDK's `LocalTransport` reads/writes it. The store becomes an implementation detail of the SDK, not the viewer's primary API.

**Incremental approach**: Refactor one slice at a time. Each slice gets an SDK namespace. The viewer can use a mix of direct store access (old) and SDK calls (new) during transition.

**Refactor order** (by dependency — least entangled first):
1. `LensSlice` → `bim.lens` (isolated, no cross-slice deps)
2. `IDSSlice` → `bim.ids` (isolated)
3. `BCFSlice` → `bim.bcf` (isolated)
4. `ListSlice` → `bim.list` (isolated)
5. `MutationSlice` → `bim.mutate` (used by export)
6. `Drawing2DSlice` + `SheetSlice` → `bim.drawing` (isolated)
7. `SelectionSlice` → `bim.selection` (used by many)
8. `VisibilitySlice` → `bim.visibility` (used by many)
9. `SectionSlice` + `MeasurementSlice` → `bim.viewer.section`, `bim.viewer.measure`
10. `CameraSlice` → `bim.viewer.camera`
11. `ModelSlice` + `DataSlice` + `LoadingSlice` → `bim.model` (most entangled — last)
12. `HoverSlice` + `UISlice` + `PinboardSlice` → remain viewer-only (UI concerns, not SDK)

---

## Phase 1: Sandbox — `@ifc-lite/sandbox`

**Goal**: Untrusted user scripts run in QuickJS-in-WASM with only the `bim.*` API available.

### Package: `packages/sandbox/`

```
packages/sandbox/
├── package.json              # @ifc-lite/sandbox
├── src/
│   ├── index.ts              # createSandbox(), Sandbox type
│   ├── sandbox.ts            # Sandbox class — lifecycle, eval, dispose
│   ├── bridge.ts             # Builds the `bim` object inside QuickJS from SDK
│   ├── limits.ts             # Memory, CPU, timeout configuration
│   ├── permissions.ts        # Permission system — which APIs a script can use
│   ├── transpile.ts          # TS → JS type stripping (esbuild.transform)
│   └── types.ts              # Public types
```

### Technology Choice: `quickjs-emscripten` (RELEASE_SYNC variant)

- ~500KB WASM bundle (smallest production option)
- Full ES2023 support inside sandbox
- Async via QuickJS-native promises (not asyncify — avoids 2x size + 40% speed penalty)
- Memory limits via `runtime.setMemoryLimit()`
- CPU limits via `runtime.setInterruptHandler()` (instruction counting)
- One WASM module loaded at app startup, shared across all sandbox contexts

### Bridge Architecture (Figma-inspired)

The sandbox `bim` object is a **proxy tree of host functions**. No data lives in the sandbox — every property access and method call crosses the boundary to the host SDK:

```typescript
// bridge.ts — builds the bim API inside QuickJS

function buildBridge(vm: QuickJSContext, sdk: BimContext) {
  // bim.query().byType('IfcWall').where(...).toArray()
  //
  // Inside the sandbox, this is a chain of function calls.
  // Each call sends a message to the host, which executes against the real SDK.
  //
  // The key insight: EntityNode objects inside the sandbox are LIGHTWEIGHT REFS.
  // They hold { modelId, expressId } and every method call (.name, .property(), etc.)
  // crosses the boundary to the host where the real EntityNode does lazy extraction.

  exposeNamespace(vm, sdk, 'model', {
    'load':   { async: true,  args: ['string'],          returns: 'object' },
    'list':   { async: false, args: [],                  returns: 'array'  },
    'active': { async: false, args: [],                  returns: 'object' },
    'remove': { async: false, args: ['string'],          returns: 'void'   },
    'clear':  { async: false, args: [],                  returns: 'void'   },
  })

  exposeNamespace(vm, sdk, 'query', {
    // Returns a QueryBuilder proxy that collects chain calls
    // and executes on .toArray() / .count() / .first()
  })

  exposeNamespace(vm, sdk, 'viewer', {
    'colorize':        { async: false, args: ['refs', 'string|function'], returns: 'void' },
    'hide':            { async: false, args: ['refs'],                    returns: 'void' },
    'show':            { async: false, args: ['refs'],                    returns: 'void' },
    'isolate':         { async: false, args: ['refs'],                    returns: 'void' },
    'resetVisibility': { async: false, args: [],                          returns: 'void' },
    'select':          { async: false, args: ['refs'],                    returns: 'void' },
    'flyTo':           { async: false, args: ['ref|refs'],                returns: 'void' },
    'section':         { async: false, args: ['object|null'],             returns: 'void' },
    'screenshot':      { async: true,  args: [],                          returns: 'blob' },
  })

  // ... all namespaces ...
}
```

### EntityNode Proxy Pattern

Inside the sandbox, entities are lightweight objects with getter traps:

```typescript
// What the script author sees:
const wall = bim.query().byType('IfcWall').first()
console.log(wall.name)                                    // → crosses boundary
console.log(wall.property('Pset_WallCommon', 'FireRating')) // → crosses boundary
const storey = wall.containedIn()                          // → crosses boundary, returns another proxy

// What actually happens:
// 1. wall = { __entityRef: { modelId: 'arch', expressId: 42 } }
// 2. wall.name → host function call → EntityNode(store, 42).name → returns string
// 3. wall.containedIn() → host function → EntityNode.containedIn() → returns new proxy ref
```

This preserves ifc-lite's on-demand extraction pattern. No STEP parsing happens until a script actually reads a property. For a script that filters 100K entities by type but only reads properties of 50 results, only 50 entities get parsed.

### Permission System

Scripts declare what APIs they need. The host grants or denies:

```typescript
const sandbox = await createSandbox(sdk, {
  permissions: {
    'model.load': false,     // cannot load new models
    'mutate.*': false,        // read-only
    'viewer.*': true,         // can control viewer
    'export.*': true,         // can export data
    'query.*': true,          // can query data
  },
  limits: {
    memoryBytes: 64 * 1024 * 1024,   // 64MB heap
    timeoutMs: 30_000,                 // 30s max execution
    maxEntitiesPerQuery: 100_000,      // prevent accidental full-model dumps
  }
})
```

### TypeScript Support

Scripts are authored in TypeScript. Before execution:

1. **Type stripping** via `esbuild.transform(code, { loader: 'ts' })` — sub-millisecond, removes types without checking them
2. The resulting JS is passed to QuickJS for execution
3. Script authors get full autocomplete in Monaco via the `@ifc-lite/sdk` type declarations (`.d.ts`)

This means the `@ifc-lite/sdk` package ships two things:
- Runtime code (for embedded/connected mode)
- Type declarations (for script authoring in Monaco)

---

## Phase 2: Node Registry — `@ifc-lite/node-registry`

**Goal**: The bridge between code and visual nodes. Every SDK function is also a visual node. Every node graph compiles to a script.

### Package: `packages/node-registry/`

```
packages/node-registry/
├── package.json              # @ifc-lite/node-registry
├── src/
│   ├── index.ts
│   ├── registry.ts           # NodeRegistry class — register, lookup, list
│   ├── types.ts              # NodeDefinition, PortDefinition, DataType
│   ├── decorators.ts         # @node() decorator for SDK functions
│   ├── compiler.ts           # Graph → Script compiler
│   ├── decompiler.ts         # Script → Graph decompiler (AST analysis)
│   ├── built-in/             # Built-in node definitions from SDK functions
│   │   ├── query-nodes.ts
│   │   ├── viewer-nodes.ts
│   │   ├── mutation-nodes.ts
│   │   ├── export-nodes.ts
│   │   ├── lens-nodes.ts
│   │   ├── ids-nodes.ts
│   │   └── drawing-nodes.ts
│   └── custom/
│       └── script-node.ts    # The "Script" node — Monaco editor inside a node
```

### Node Definition Schema

```typescript
interface NodeDefinition {
  id: string                          // 'query.filterByType'
  name: string                        // 'Filter by Type'
  category: NodeCategory              // 'Query' | 'Viewer' | 'Export' | ...
  description: string
  icon?: string                       // lucide icon name

  inputs: PortDefinition[]            // typed input ports
  outputs: PortDefinition[]           // typed output ports
  params: ParamDefinition[]           // inline-editable parameters (dropdowns, text, color)

  execute: (inputs, params, sdk) => Promise<outputs>  // the actual implementation
  toCode: (params) => string                            // generates script equivalent
}

interface PortDefinition {
  id: string                          // 'entities'
  name: string                        // 'Entities'
  type: DataType                      // 'EntityNode[]' | 'string' | 'number' | ...
  required: boolean
}

type DataType =
  | 'EntityNode'    | 'EntityNode[]'
  | 'string'        | 'string[]'
  | 'number'        | 'boolean'
  | 'PropertySet[]' | 'QuantitySet[]'
  | 'LensDefinition'| 'IDSReport'
  | 'SVG'           | 'Blob'
  | 'any'
```

### Registration via Decorators (explicit registration as fallback)

```typescript
// Using decorator
@node({
  id: 'query.filterByType',
  name: 'Filter by Type',
  category: 'Query',
  inputs:  [{ id: 'entities', name: 'Entities', type: 'EntityNode[]', required: true }],
  outputs: [{ id: 'result',   name: 'Result',   type: 'EntityNode[]', required: true }],
  params:  [{ id: 'type', name: 'IFC Type', type: 'string', widget: 'ifc-type-picker' }],
})
function filterByType(
  inputs: { entities: EntityNode[] },
  params: { type: string }
): { result: EntityNode[] } {
  return { result: inputs.entities.filter(e => e.type === params.type) }
}

// Using explicit registration (no decorator dependency)
registry.register({
  id: 'query.filterByType',
  name: 'Filter by Type',
  category: 'Query',
  inputs:  [{ id: 'entities', name: 'Entities', type: 'EntityNode[]', required: true }],
  outputs: [{ id: 'result',   name: 'Result',   type: 'EntityNode[]', required: true }],
  params:  [{ id: 'type', name: 'IFC Type', type: 'string', widget: 'ifc-type-picker' }],
  execute: filterByType,
  toCode:  (p) => `.byType('${p.type}')`,
})
```

### Graph → Script Compiler

A node graph is a DAG. The compiler performs topological sort and emits a script:

```typescript
// Node graph:
//
// [All Entities] → [Filter: IfcWall] → [Filter: IsExternal=true] → [Colorize: #ff0000]
//                                    ↘ [Quantity: NetSideArea]    → [Export CSV]

// Compiled script:
const _n1 = bim.query().all().toArray()
const _n2 = _n1.filter(e => e.type === 'IfcWall')
const _n3 = _n2.filter(e => e.property('Pset_WallCommon', 'IsExternal') === true)
bim.viewer.colorize(_n3, '#ff0000')

const _n4 = _n3.map(e => ({
  entity: e,
  value: e.quantity('Qto_WallBaseQuantities', 'NetSideArea')
}))
await bim.export.csv(_n4, { columns: ['entity.name', 'value'], filename: 'areas.csv' })
```

### Script → Graph Decompiler (stretch goal)

Parse a script's AST to detect patterns that match registered nodes, and reconstruct a visual graph. This enables: "paste a script, see it as nodes." Not required for v1 but architecturally enabled by the registry's `toCode` pattern (reversible mapping).

### The Script Node (escape hatch — like Grasshopper)

When built-in nodes aren't enough, users drop a "Script" node onto the canvas:

```
┌─────────────────────────────────────────┐
│ 📝 Script Node                           │
│                                          │
│ inputs:  walls (EntityNode[])            │
│ outputs: heavy (EntityNode[])            │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ // Monaco editor                     │ │
│ │ export default function(             │ │
│ │   input: { walls: EntityNode[] }     │ │
│ │ ): { heavy: EntityNode[] } {         │ │
│ │   return {                           │ │
│ │     heavy: input.walls.filter(w => { │ │
│ │       const v = w.quantity(           │ │
│ │         'Qto_WallBaseQuantities',    │ │
│ │         'GrossVolume') ?? 0          │ │
│ │       return v * 2400 > 10000        │ │
│ │     })                               │ │
│ │   }                                  │ │
│ │ }                                    │ │
│ └──────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- Inputs/outputs are declared via the function signature (parsed from TS types)
- Runs in the QuickJS sandbox with `bim.*` available
- Wire-compatible with all other nodes (typed ports)
- Can be saved as a custom node definition and published to the ecosystem

---

## Phase 3: `ifc-scripts` — The Script IDE

**Goal**: A standalone web app where users write, run, and debug scripts against ifc-lite models.

### New Repository: `ifc-scripts/`

```
ifc-scripts/
├── package.json              # Workspace root
├── packages/
│   └── app/                  # @ifc-scripts/app
│       ├── src/
│       │   ├── App.tsx
│       │   ├── editor/
│       │   │   ├── MonacoEditor.tsx       # Monaco with bim.* autocomplete
│       │   │   ├── type-definitions.ts    # Load @ifc-lite/sdk .d.ts for IntelliSense
│       │   │   └── diagnostics.ts         # Live error markers from sandbox eval
│       │   ├── runner/
│       │   │   ├── ScriptRunner.tsx        # Run button, output panel, progress
│       │   │   ├── useScriptExecution.ts   # Hook: transpile → sandbox → run
│       │   │   └── OutputPanel.tsx         # console.log output, tables, errors
│       │   ├── connection/
│       │   │   ├── ViewerConnection.tsx    # Connect to / disconnect from viewer
│       │   │   ├── useViewerBridge.ts      # BroadcastChannel / WebSocket bridge
│       │   │   └── ConnectionStatus.tsx    # Connected / disconnected indicator
│       │   ├── library/
│       │   │   ├── ScriptLibrary.tsx       # Saved scripts, templates
│       │   │   ├── TemplateGallery.tsx     # Starter templates by use case
│       │   │   └── ScriptStorage.ts        # localStorage + file import/export
│       │   └── preview/
│       │       ├── DataPreview.tsx         # Table view of query results
│       │       ├── ChartPreview.tsx        # Simple charts from aggregated data
│       │       └── EntityInspector.tsx     # Inspect entity properties from results
│       └── public/
│           └── templates/
│               ├── fire-rating-check.ts
│               ├── quantity-takeoff.ts
│               ├── property-audit.ts
│               ├── spatial-analysis.ts
│               └── batch-property-set.ts
├── packages/
│   └── cli/                  # @ifc-scripts/cli
│       ├── src/
│       │   ├── index.ts              # CLI entry point
│       │   ├── commands/
│       │   │   ├── run.ts            # npx ifc-scripts run script.ts --model file.ifc
│       │   │   ├── validate.ts       # npx ifc-scripts validate script.ts (type-check)
│       │   │   └── init.ts           # npx ifc-scripts init (scaffold a script project)
│       │   └── headless-runtime.ts   # SDK in headless mode for CLI execution
```

### Script IDE Features

1. **Monaco editor** with full `bim.*` IntelliSense
   - Type definitions loaded from `@ifc-lite/sdk/types`
   - Autocomplete for IFC types, property set names, quantity names (discovered from loaded model)
   - Live error markers from TypeScript type-stripping + QuickJS eval errors

2. **Connection panel**: Connect to a running viewer via BroadcastChannel
   - If connected: `bim.viewer.*` commands control the real viewer
   - If disconnected: `bim.viewer.*` calls are no-ops; query/export still work in headless mode with a loaded file

3. **Output panel**:
   - `console.log()` output from sandbox
   - Tables for `bim.query()` results (virtualized for large datasets)
   - CSV/Parquet download buttons
   - Error stack traces mapped back to TypeScript source

4. **Script library**:
   - Save/load to localStorage
   - Import/export as `.ts` files
   - Starter templates: fire rating check, quantity takeoff, property audit, batch edit, spatial analysis
   - Community scripts (Phase 5)

5. **CLI runner** for headless execution:
   ```bash
   npx ifc-scripts run fire-rating-check.ts --model building.ifc --output report.csv
   npx ifc-scripts run batch-edit.ts --model building.ifc --output modified.ifc
   ```

---

## Phase 4: `ifc-flow` Rebuild — Visual IDE on SDK

**Goal**: ifc-flow keeps its React Flow UX but replaces its entire engine with `@ifc-lite/sdk`.

### Clean Break Strategy

ifc-flow currently depends on:
- `web-ifc` (WASM IFC parser) → **replaced by** `@ifc-lite/sdk` (`bim.model.load`)
- `IfcOpenShell` via Pyodide → **removed** (SDK covers all operations natively)
- `sql.js` + `ifc2sql` → **removed** (SDK query API is more powerful)
- Custom Three.js viewer → **replaced by** `bim.viewer.*` controlling shared WebGPU renderer
- `ifc-utils.ts` (81KB monolith) → **replaced by** SDK namespace calls
- Custom filter/property/quantity logic → **replaced by** SDK queries + EntityNode accessors
- OpenRouter AI chat → **keep** (orthogonal to engine swap — can use SDK queries as tool calls)

### New Architecture

```
ifc-flow/ (rebuilt)
├── package.json
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   │
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── FlowCanvas.tsx          # React Flow canvas
│   │   │   ├── NodePalette.tsx         # Auto-generated from node registry
│   │   │   └── ConnectionValidator.ts  # Type-based connection validation
│   │   │
│   │   ├── nodes/                      # AUTO-GENERATED from @ifc-lite/node-registry
│   │   │   ├── NodeRenderer.tsx        # Generic node renderer from NodeDefinition
│   │   │   ├── ScriptNode.tsx          # Monaco-based script node
│   │   │   ├── ViewerNode.tsx          # Embedded viewer (bim.viewer.* connection)
│   │   │   └── WatchNode.tsx           # Data inspector (pass-through)
│   │   │
│   │   ├── panels/
│   │   │   ├── CodeView.tsx            # Shows compiled script from current graph
│   │   │   ├── PropertyPanel.tsx       # Node parameter editor
│   │   │   └── OutputPanel.tsx         # Execution results, logs
│   │   │
│   │   └── toolbar/
│   │       ├── RunButton.tsx
│   │       ├── ViewToggle.tsx          # Switch between visual / code view
│   │       └── ConnectionButton.tsx    # Connect to external viewer
│   │
│   ├── engine/
│   │   ├── executor.ts                 # Topological sort + execute nodes via SDK
│   │   ├── graph-to-script.ts          # Uses @ifc-lite/node-registry compiler
│   │   └── sandbox-executor.ts         # Execute compiled script in sandbox
│   │
│   ├── registry/
│   │   ├── load-registry.ts            # Load built-in + custom node definitions
│   │   └── custom-nodes.ts             # User-defined nodes (persisted)
│   │
│   └── hooks/
│       ├── useSdkConnection.ts         # Connect to viewer or headless SDK
│       ├── useWorkflow.ts              # Workflow state, save/load, undo/redo
│       └── useExecution.ts             # Run workflow, track progress
```

### Auto-Generated Nodes from Registry

The node palette is **not hand-coded** — it's generated from `@ifc-lite/node-registry`:

```typescript
// load-registry.ts
import { getBuiltinNodes } from '@ifc-lite/node-registry'

const builtinNodes = getBuiltinNodes()
// Returns: NodeDefinition[] with ~30-40 built-in nodes covering all SDK namespaces

// Each NodeDefinition has enough metadata to render a React Flow node:
// - Typed input/output ports → React Flow handles
// - Params → inline UI widgets (dropdowns, text, color pickers)
// - execute() → called during workflow execution
// - toCode() → used by graph-to-script compiler
```

When a new SDK feature is added (e.g., `bim.clash.detect()`), adding a `NodeDefinition` to the registry automatically makes it appear in ifc-flow's palette. No ifc-flow code changes needed.

### Viewer Integration

Two modes:

**Standalone mode**: ifc-flow loads models directly via `bim.model.load()` in headless SDK mode. No 3D viewer. Data flows through nodes and outputs to tables/CSV/files.

**Connected mode**: ifc-flow connects to a running ifc-lite viewer via BroadcastChannel. The Viewer Node in the flow canvas shows a "Connected to ifc-lite viewer" badge. `bim.viewer.*` calls control the real WebGPU renderer. Changes are instantly visible in the viewer tab.

### Code View Toggle

At any time, users can toggle between visual and code view:

- **Visual view** (default): React Flow canvas with nodes and edges
- **Code view**: Monaco editor showing the compiled TypeScript script
- Edits in code view update the visual graph (via decompiler, best-effort)
- Edits in visual view update the code (via compiler, always accurate)

---

## Phase 5: Ecosystem

**Goal**: Third parties publish and share nodes, scripts, and workflows.

### npm-Based Node Distribution

Custom nodes are npm packages with a standard entry point:

```typescript
// @example/ifc-clash-nodes/src/index.ts
import { NodeDefinition } from '@ifc-lite/node-registry'

export const nodes: NodeDefinition[] = [
  {
    id: 'clash.detect',
    name: 'Clash Detection',
    category: 'Analysis',
    inputs: [
      { id: 'setA', name: 'Set A', type: 'EntityNode[]', required: true },
      { id: 'setB', name: 'Set B', type: 'EntityNode[]', required: true },
    ],
    outputs: [
      { id: 'clashes', name: 'Clashes', type: 'ClashResult[]', required: true },
    ],
    params: [
      { id: 'tolerance', name: 'Tolerance (mm)', type: 'number', default: 10 },
    ],
    execute: async (inputs, params, sdk) => {
      // Custom implementation using bim.spatial.*
      const clashes = await detectClashes(inputs.setA, inputs.setB, params.tolerance, sdk)
      return { clashes }
    },
    toCode: (p) => `detectClashes(setA, setB, ${p.tolerance})`,
  }
]
```

### Script Sharing

Scripts are `.ts` files with a frontmatter header:

```typescript
/// @name Fire Rating Audit
/// @description Check all walls for fire rating compliance
/// @author @louistrue
/// @tags fire-safety, walls, compliance
/// @requires bim.query, bim.viewer, bim.export

const walls = bim.query().byType('IfcWall').toArray()
// ...
```

Shareable via:
- GitHub gist / repository
- npm (for node packages)
- Direct URL import in ifc-scripts
- Community registry (future — curated list of scripts/nodes)

### Workflow Sharing

ifc-flow workflows serialize as JSON:

```json
{
  "name": "External Wall Fire Rating Check",
  "version": "1.0.0",
  "author": "@louistrue",
  "nodes": [...],
  "edges": [...],
  "customNodePackages": ["@example/ifc-fire-nodes"]
}
```

Import/export via file or URL.

---

## Implementation Timeline

### Phase 0: `@ifc-lite/sdk` (Weeks 1-6)

| Week | Deliverable |
|------|-------------|
| 1-2 | SDK package scaffold, `BimContext`, `LocalTransport`, `bim.model` namespace (wraps ModelSlice + parser + geometry) |
| 2-3 | `bim.query` namespace (wraps IfcQuery + EntityNode), chainable API |
| 3-4 | `bim.viewer` namespace (wraps renderer + selection + visibility + camera + section), `bim.mutate` (wraps MutationSlice) |
| 4-5 | `bim.export`, `bim.lens`, `bim.ids`, `bim.bcf`, `bim.drawing`, `bim.list`, `bim.spatial`, `bim.on` events |
| 5-6 | `BroadcastTransport`, `MessagePortTransport`, `WebSocketTransport` — cross-context communication |
| 6 | `BimHost` — viewer exposes connection endpoint. Integration tests across all namespaces |

### Phase 1: `@ifc-lite/sandbox` (Weeks 7-10)

| Week | Deliverable |
|------|-------------|
| 7 | QuickJS-in-WASM integration, basic eval, `console.log` bridge |
| 8 | `bim.*` API bridge — expose all SDK namespaces inside sandbox via handle API |
| 8-9 | EntityNode proxy pattern — lazy property access across boundary |
| 9 | Permission system, memory/CPU limits, timeout enforcement |
| 10 | TypeScript transpilation via esbuild, integration tests with real IFC models |

### Phase 2: `@ifc-lite/node-registry` (Weeks 10-13)

| Week | Deliverable |
|------|-------------|
| 10-11 | Registry data structures, `NodeDefinition` schema, explicit registration API |
| 11-12 | Built-in nodes for all SDK namespaces (~30-40 nodes), Script node definition |
| 12-13 | Graph → Script compiler (topological sort, code generation) |

### Phase 2.5: Viewer Refactor (Weeks 11-16, overlaps)

| Week | Deliverable |
|------|-------------|
| 11-12 | `useBim()` React context providing SDK. Refactor LensSlice, IDSSlice, BCFSlice, ListSlice → SDK calls |
| 13-14 | Refactor MutationSlice, Drawing2DSlice → SDK. Add BimHost connection endpoint to viewer |
| 15-16 | Refactor SelectionSlice, VisibilitySlice, CameraSlice, SectionSlice → SDK. Performance validation |

### Phase 3: `ifc-scripts` (Weeks 14-18)

| Week | Deliverable |
|------|-------------|
| 14-15 | Repo scaffold, Monaco editor with `bim.*` types, basic script execution via sandbox |
| 16 | Viewer connection (BroadcastChannel), output panel (console, tables, errors) |
| 17 | Script library, templates, import/export |
| 18 | CLI runner (headless execution), polish, documentation |

### Phase 4: `ifc-flow` Rebuild (Weeks 16-22)

| Week | Deliverable |
|------|-------------|
| 16-17 | Strip old engine (web-ifc, IfcOpenShell, Pyodide, ifc-utils). Replace with SDK connection |
| 18-19 | Auto-generate node palette from registry. Generic `NodeRenderer` component |
| 20 | Script node with Monaco editor. Workflow executor via SDK |
| 21 | Code view toggle (graph ↔ script). Viewer connection mode |
| 22 | Polish, workflow save/load, documentation |

### Phase 5: Ecosystem (Weeks 22+)

| Deliverable |
|-------------|
| Custom node npm package format specification |
| Script/workflow sharing format |
| Community registry (curated list) |
| Documentation site |

---

## Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **SDK abstraction leaks performance** — wrapping everything in a facade could add overhead | High — app handles 200MB+ models | `LocalTransport` uses direct function calls (zero overhead). Only cross-context transports serialize. Benchmark every namespace. |
| **QuickJS sandbox is too slow for large queries** — iterating 100K entities through the bridge | High — scripts must be practical | Batch operations: `bim.query().byType().toArray()` executes entirely on the host, only results cross the boundary. Never iterate individual entities through the bridge. |
| **Viewer refactor breaks existing features** — 17 slices is a lot of surface area | Medium — regression risk | Refactor incrementally (one slice at a time). Keep Zustand store as implementation detail. Each refactored slice gets integration tests. |
| **Node registry becomes too rigid** — can't express all useful operations as nodes | Medium — limits visual scripting | Script node escape hatch. Keep node definitions flexible (any function shape). |
| **Transport protocol doesn't handle all data types** — binary geometry, SVG, blobs | Medium — export/drawing features | Structured clone for `MessagePort`/`BroadcastChannel` handles `ArrayBuffer`, `Blob` natively. WebSocket falls back to base64. |
| **TypeScript type stripping removes useful type info** — no runtime type checking in sandbox | Low — scripts may hit type errors at runtime | Provide clear error messages. Monaco shows type errors before execution. Consider runtime type guards for EntityNode methods. |

---

## Success Metrics

1. **The viewer gets no heavier.** Bundle size of `apps/viewer` does not increase (SDK is a reorganization, not new code).
2. **All existing features still work.** Every Zustand slice that gets refactored to SDK passes its existing tests.
3. **A script can do everything the viewer can.** Any viewer feature accessible via SDK + sandbox.
4. **Visual and code are interchangeable.** A workflow created in ifc-flow compiles to a valid script. A script written in ifc-scripts produces the expected visual graph.
5. **Performance parity.** Scripted operations (via SDK) are no slower than the same operations invoked directly by the viewer.
6. **Large model resilience.** Scripts handle 100K+ entities without blocking the main thread or exceeding sandbox memory limits.
