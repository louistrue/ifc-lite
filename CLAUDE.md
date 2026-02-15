# Claude Code Guidelines for ifc-lite

This document provides instructions for AI agents working on the ifc-lite codebase.

## Project Overview

ifc-lite is a high-performance IFC (Industry Foundation Classes) platform for BIM (Building Information Modeling). It supports both IFC4 and IFC5/IFCX formats with features including:

- WebGPU-accelerated 3D rendering
- Multi-model federation (loading multiple models with unified selection/visibility)
- Property panels with IFC attributes, properties, and quantities
- Spatial hierarchy navigation
- Section planes and measurements
- BCF collaboration (topics, viewpoints, comments)
- IDS validation (Information Delivery Specification checking)
- Configurable property lists (entity tables with column discovery)
- 2D architectural drawings (section cuts, floor plans, elevations)
- Property editing with undo/redo and change tracking
- Orthographic projection with seamless perspective switching
- Automatic floorplan views per storey (section plane + ortho top-down)
- Pinboard (selection basket) for collecting and isolating entities
- Tree view by IFC type grouping (alongside spatial hierarchy)
- Lens system (rule-based 3D colorization and filtering)

## Critical Standards

### IFC Schema Compliance is MANDATORY

This project works with the IFC (Industry Foundation Classes) standard. **All user-facing APIs, scripting interfaces, and data exports MUST use correct IFC schema nomenclature.** Never invent simplified names or deviate from the IFC EXPRESS specification.

**Entity Attributes — PascalCase per IFC EXPRESS:**
- `GlobalId` (not `globalId`) — `IfcGloballyUniqueId`
- `Name` (not `name`) — `IfcLabel`
- `Description` (not `description`) — `IfcText`
- `ObjectType` (not `objectType`) — `IfcLabel`
- `Type` — the IFC entity type name (e.g. `IfcWall`, `IfcBuildingStorey`)

Entity data in scripts exposes both PascalCase (IFC-compliant) and camelCase aliases. Both are accepted everywhere.

**Relationship Entities — use full IFC names:**
- `IfcRelContainedInSpatialStructure` (not `ContainsElements`)
- `IfcRelAggregates` (not `Aggregates`)
- `IfcRelDefinesByType` (not `DefinesByType`)
- `IfcRelDefinesByProperties` (not `DefinesByProperties`)
- `IfcRelVoidsElement` (not `VoidsElement`)
- `IfcRelFillsElement` (not `FillsElement`)
- `IfcRelAssociatesMaterial`, `IfcRelAssociatesClassification`, etc.

**Entity Type Names — PascalCase with Ifc prefix:**
- `IfcWall`, `IfcWallStandardCase`, `IfcBeam`, `IfcColumn`, `IfcSlab`, etc.
- Internal storage uses UPPERCASE (`IFCWALLSTANDARDCASE`) — always convert for display

**Property/Quantity Sets — use standard Pset_/Qto_ prefixes:**
- `Pset_WallCommon`, `Pset_DoorCommon`, etc.
- `Qto_WallBaseQuantities`, `Qto_SlabBaseQuantities`, etc.

**Architecture: Internal vs. User-Facing naming:**
- `EntityData` interface uses camelCase internally (TypeScript convention, 170+ consumers)
- Script bridge adds PascalCase aliases to EntityData at the boundary
- Export columns accept both `Name` and `name` (PascalCase preferred, camelCase for backward compat)
- Relationship type strings in the SDK wire protocol use full IFC names (e.g. `IfcRelAggregates`)

```typescript
// BAD — non-compliant simplified names
const refs = dispatch('query', 'related', [ref, 'Aggregates', 'forward']);
entity.name  // legacy, acceptable internally
columns: ['name', 'type', 'globalId']  // legacy

// GOOD — IFC schema compliant
const refs = dispatch('query', 'related', [ref, 'IfcRelAggregates', 'forward']);
entity.Name  // IFC PascalCase — preferred
columns: ['Name', 'Type', 'GlobalId']  // IFC PascalCase
```

### Performance is NON-NEGOTIABLE

This is a performance-critical application. Users load models with millions of triangles and thousands of entities. Every millisecond matters.

**ALWAYS:**
- Profile changes that touch rendering, tree building, or data processing
- Use `useMemo` and `useCallback` with minimal dependency arrays
- Avoid recomputing expensive data when only cheap derived state changes
- Prefer lazy computation over eager computation
- Pre-allocate arrays when size is known (avoid `push(...spread)` in loops)

**NEVER:**
- Add O(n) operations where O(1) would suffice
- Include state in memo dependencies that causes unnecessary recomputation
- Create new objects/arrays in render without memoization
- Block the main thread with synchronous heavy operations

### Example: Visibility State Pattern

```typescript
// BAD: Recomputes entire tree when visibility changes
const treeData = useMemo(() => {
  return nodes.map(n => ({
    ...n,
    isVisible: !hiddenEntities.has(n.id) // O(n) check on every visibility change
  }));
}, [nodes, hiddenEntities]); // hiddenEntities causes full recomputation

// GOOD: Compute visibility lazily during render
const treeData = useMemo(() => nodes, [nodes]); // Structure only

const isNodeVisible = useCallback((node) => {
  return !hiddenEntities.has(node.id);
}, [hiddenEntities]); // Cheap function, no tree rebuild
```

### TypeScript Standards

**NO `any` TYPES IN PRODUCTION CODE**

- Use proper interfaces and types
- Create extension types when needed (e.g., `IfcxDataStore extends IfcDataStore`)
- Use type guards for runtime type checking
- Use `unknown` with proper narrowing instead of `any`
- Test files may use `{} as any` for mock initialization (acceptable)

```typescript
// BAD
const data = result as any;

// GOOD
interface ExtendedResult extends BaseResult {
  extraField: string;
}
const data = result as ExtendedResult;

// GOOD: Type guard
function isIfcxDataStore(store: unknown): store is IfcxDataStore {
  return store !== null && typeof store === 'object' &&
         'schemaVersion' in store && store.schemaVersion === 'IFC5';
}
```

### Code Structure

**File Organization:**
- `apps/viewer/` - React frontend application
- `apps/server/` - Rust HTTP server (Axum)
- `apps/desktop/` - Tauri desktop application
- `packages/` - 20 TypeScript packages (parser, renderer, geometry, bcf, ids, mutations, drawing-2d, encoding, lists, etc.)
- `rust/` - 3 Rust crates (core, geometry, wasm-bindings)
- Tests co-located with source files (`*.test.ts`)

**Key Patterns:**
- Zustand for state management (17 slices: selection, visibility, model, bcf, ids, list, mutation, drawing2D, sheet, section, measurement, camera, data, loading, hover, ui, pinboard, lens)
- React hooks for business logic (`useIfc`, `useViewerSelectors`, `useLens`, `useFloorplanView`)
- WebGPU for 3D rendering
- Virtualized lists for large datasets
- FederationRegistry singleton for multi-model ID management
- On-demand extraction: entity attributes, properties, quantities, classifications, and materials are extracted lazily from the source buffer when accessed, not during the initial parse. Use `EntityNode` or the adapter's cached getters to avoid redundant STEP parsing.

### Multi-Model Federation

The codebase supports loading multiple IFC models simultaneously:

- **Global IDs**: `globalId = localExpressId + model.idOffset`
- **FederationRegistry**: Manages ID ranges to prevent collisions
- **Models Map**: `Map<string, FederatedModel>` stores loaded models

When working with IDs:
```typescript
// Convert local to global
const globalId = expressId + model.idOffset;

// Convert global to local
const { modelId, expressId } = resolveGlobalIdFromModels(globalId);
```

## Before Making Changes

1. **Understand the impact**: Does this change affect render performance? Data loading? Memory usage?
2. **Check existing patterns**: Look at similar code in the codebase
3. **Consider multi-model**: Will this work with 1 model? 5 models?
4. **Test with large files**: The app must handle 200MB+ IFC files smoothly

## Testing

```bash
# Run all tests
npm test

# Run specific package tests
npm test --workspace=@ifc-lite/parser

# Type check
npx tsc -p apps/viewer/tsconfig.json --noEmit
```

## Common Pitfalls

1. **Store subscriptions**: Every `useViewerStore((s) => s.x)` causes re-render when `x` changes
2. **Memo dependencies**: Adding state to dependencies can cause cascade recomputation
3. **Array operations**: `push(...spread)` is O(n²) in a loop - preallocate instead
4. **ID confusion**: Always be clear if working with local expressId or global ID
5. **IFC type name casing**: Entity types from STEP are UPPERCASE (e.g., `IFCWALLSTANDARDCASE`). Use `store.entities.getTypeName(id)` for properly-cased names (`IfcWallStandardCase`). The `normalizeTypeName` helper only handles single-word types correctly.
6. **On-demand extraction in loops**: `extractEntityAttributesOnDemand` parses the source buffer per entity. When calling in a loop (e.g., lists with 5000+ rows), always cache results to avoid redundant STEP parsing.

## Commit Guidelines

- Use conventional commits: `fix:`, `feat:`, `perf:`, `refactor:`
- Include context in commit messages
- Keep commits atomic and focused
- Always run build before pushing

## Questions to Ask Before Submitting

1. Does the build pass? (`npm run build`)
2. Do tests pass? (`npm test`)
3. Is there any `any` type in production code?
4. Will this perform well with 100,000+ entities?
5. Does this work for both single-model and multi-model scenarios?
