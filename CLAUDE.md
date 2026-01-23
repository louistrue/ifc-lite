# Claude Code Guidelines for ifc-lite

This document provides instructions for AI agents working on the ifc-lite codebase.

## Project Overview

ifc-lite is a high-performance IFC (Industry Foundation Classes) viewer for BIM (Building Information Modeling) files. It supports both IFC4 and IFC5/IFCX formats with features including:

- WebGPU-accelerated 3D rendering
- Multi-model federation (loading multiple models with unified selection/visibility)
- Property panels with IFC attributes, properties, and quantities
- Spatial hierarchy navigation
- Section planes and measurements

## Critical Standards

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
- `packages/` - Shared libraries (parser, renderer, geometry, etc.)
- Tests co-located with source files (`*.test.ts`)

**Key Patterns:**
- Zustand for state management (slices pattern)
- React hooks for business logic (`useIfc`, `useViewerSelectors`)
- WebGPU for 3D rendering
- Virtualized lists for large datasets

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
