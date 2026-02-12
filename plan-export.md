# Plan: Improved IFC Export (Visible-Only + Merged Multi-Model)

Two user requests:
1. **Export only currently visible geometry** — the exported IFC should omit hidden/isolated-out entities
2. **Merged multi-model export** — combine all loaded models into a single IFC file (like IfcOpenShell's `MergeProjects`)

---

## Feature 1: Export Visible Entities Only

### Problem

The current `StepExporter` iterates over **every** entity in `dataStore.entityIndex.byId` and writes it to the output. There is no filtering by visibility state. Users hide entities in the 3D viewer (via hierarchy panel, isolation, type toggles) but the export ignores this entirely.

### Core Challenge: Referential Integrity

IFC STEP files are a web of `#ID` references. An `IfcWall` doesn't just exist alone — it references:
- `IfcLocalPlacement` → `IfcAxis2Placement3D` → `IfcCartesianPoint`, `IfcDirection`
- `IfcProductDefinitionShape` → `IfcShapeRepresentation` → geometry primitives
- `IfcRelContainedInSpatialStructure` (linking it to a storey)
- `IfcRelDefinesByProperties` → `IfcPropertySet` → `IfcPropertySingleValue`
- `IfcRelAssociatesMaterial` → material entities
- `IfcRelDefinesByType` → `IfcWallType`
- `IfcOwnerHistory`, `IfcApplication`, `IfcPerson`, `IfcOrganization` (shared)

Simply skipping the `#42=IFCWALL(...)` line would leave dangling references from relationships, and would also leave orphaned geometry entities that nothing references.

### Approach: Forward Reference Closure from Visible Entities

Rather than trying to determine what to **remove** (hard — shared references make this error-prone), compute what to **keep**:

1. **Seed set**: All entity IDs that are currently visible (product entities with geometry) + spatial structure ancestors + infrastructure entities
2. **Reference walk**: For each entity in the seed set, parse its STEP text and extract all `#ID` references. Recursively include those referenced entities.
3. **Result**: A complete closure of all entities reachable from visible products — geometry, placements, properties, materials, types, styles, units, contexts, etc. are automatically included if referenced.

This guarantees referential integrity by construction.

### Implementation Steps

#### Step 1: Add `collectReferencedEntityIds` utility to `@ifc-lite/export`

**New file**: `packages/export/src/reference-collector.ts`

```typescript
/**
 * Given a set of "root" entity IDs and the source buffer + entity index,
 * walk all #ID references transitively to build the complete closure.
 */
export function collectReferencedEntityIds(
  rootIds: Set<number>,
  source: Uint8Array,
  entityIndex: Map<number, EntityRef>
): Set<number>
```

Algorithm:
- Maintain a `visited: Set<number>` and a `queue: number[]`
- Seed the queue with all rootIds
- For each entity ID, look up its `EntityRef` (byteOffset, byteLength)
- Decode the STEP text from the source buffer
- Extract all `#(\d+)` references via regex
- For each referenced ID not yet visited, add to queue
- Return the visited set

Performance: Each entity is visited at most once. Regex on short strings is fast. For a 200MB file with 500k entities, this should complete in <1s.

#### Step 2: Add `getVisibleEntityIds` helper

**Addition to**: `packages/export/src/reference-collector.ts`

```typescript
/**
 * Determine which entities should be seed roots for visible-only export.
 * Returns local expressIds that are visible products + infrastructure.
 */
export function getVisibleEntityIds(
  dataStore: IfcDataStore,
  hiddenIds: Set<number>,
  isolatedIds: Set<number> | null,
): Set<number>
```

Logic:
- Iterate `dataStore.entityIndex.byId`
- For entities that are products with geometry: check visibility (not in `hiddenIds`, and if `isolatedIds` is set, must be in `isolatedIds`)
- Always include spatial structure entities (IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey) — the container hierarchy must be present for a valid file
- Always include infrastructure entity types that are shared and necessary: IfcOwnerHistory, IfcApplication, IfcPerson, IfcOrganization, IfcUnitAssignment, IfcGeometricRepresentationContext/SubContext, etc.
- Return the combined set as seed roots

#### Step 3: Add `visibleOnly` option to `StepExportOptions`

In `packages/export/src/step-exporter.ts`:

```typescript
export interface StepExportOptions {
  // ... existing options ...

  /** Only export entities visible in the current view */
  visibleOnly?: boolean;
  /** Hidden entity IDs (local expressIds) — required when visibleOnly=true */
  hiddenEntityIds?: Set<number>;
  /** Isolated entity IDs (local expressIds, null = no isolation) */
  isolatedEntityIds?: Set<number> | null;
}
```

#### Step 4: Update `StepExporter.export()` to support visible-only filtering

In the main export loop (`step-exporter.ts` lines 191-217), when `visibleOnly` is true:

1. Call `getVisibleEntityIds()` to get visible product + infrastructure set
2. Call `collectReferencedEntityIds()` with those as roots to get the full closure
3. In the entity iteration loop, skip any entity NOT in the closure set

This is a minimal, surgical change — the mutation logic, header generation, and assembly all remain unchanged.

#### Step 5: Update `ExportDialog.tsx` UI

- Add a new toggle: **"Export Visible Only"** — `Switch` component, default off
- When enabled, pass current `hiddenEntities` and `isolatedEntities` from the Zustand store to the exporter
- Show an informational count: "X of Y entities will be exported"
- Need to convert from global IDs (used by the store's visibility state) to local expressIds (used by the exporter) using the model's `idOffset`

#### Step 6: Update `ExportChangesButton.tsx`

Offer the same visible-only option in the quick-export flow.

### Edge Cases

| Edge Case | Handling |
|-----------|----------|
| **Type visibility** (Spaces, Openings, Site) | Caller converts type-hidden IDs to the `hiddenEntityIds` set before passing to exporter |
| **Model-level visibility** | Already handled — you select which model to export |
| **Shared references** (IfcOwnerHistory, contexts) | Automatically included by the reference closure when any visible entity references them |
| **Relationship entities** (IfcRelContainedInSpatialStructure with mix of visible/hidden elements) | v1: Include if at least one referenced entity is visible. The hidden refs become dangling but IFC viewers tolerate this. v2: Rewrite relationship entity text to remove hidden refs. |
| **All entities hidden** | Export just the header + empty DATA section (same as current `deltaOnly` with no mutations) |

---

## Feature 2: Merged Multi-Model Export

### Problem

Users load multiple IFC files for federation (e.g., architectural + structural + MEP). They want to export a single combined IFC file, similar to [IfcOpenShell's MergeProjects](https://docs.ifcopenshell.org/autoapi/ifcpatch/recipes/MergeProjects/index.html).

### Core Challenge: EXPRESS ID Remapping

Each IFC file has its own EXPRESS ID space starting from `#1`. When merging, IDs would collide. Every `#ID` reference in every entity's STEP text must be remapped to unique IDs.

### Approach

1. **Assign each model a fresh ID offset** for deterministic output (don't reuse FederationRegistry offsets — those are for runtime)
2. **For each model**, remap all entity IDs and their `#ID` references by adding the model's offset
3. **Merge spatial structure**: Use the first model's `IfcProject` as the root, attach other models' buildings/sites under it
4. **Deduplicate shared infrastructure**: Units, representation contexts, owner history — keep the first model's, remap references from other models

### Implementation Steps

#### Step 1: Add `MergedExporter` class

**New file**: `packages/export/src/merged-exporter.ts`

```typescript
export interface MergeExportOptions {
  schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  description?: string;
  author?: string;
  organization?: string;
  application?: string;
  filename?: string;

  /** Strategy for handling the project structure */
  projectStrategy: 'keep-first' | 'create-new';

  /** Apply visibility filtering to each model before merging */
  visibleOnly?: boolean;
  hiddenEntityIdsByModel?: Map<string, Set<number>>;
  isolatedEntityIdsByModel?: Map<string, Set<number> | null>;
}

export interface MergeExportResult {
  content: string;
  stats: {
    modelCount: number;
    totalEntityCount: number;
    fileSize: number;
  };
}
```

#### Step 2: Implement ID remapping

```typescript
/**
 * Remap all #ID references in a STEP entity line.
 * Handles both the entity's own ID and all referenced IDs.
 */
function remapEntityText(
  entityText: string,
  idOffset: number,
  sharedEntityRemap?: Map<number, number>  // For deduplication
): string
```

- Use regex `#(\d+)` to find all `#ID` references
- Replace each `#N` with `#(N + offset)`, or `#(remapped)` if in the sharedEntityRemap table
- The offset for model N is: sum of all previous models' max IDs + gap

#### Step 3: Implement project structure merging

**Strategy: `keep-first`** (recommended for v1):
- Keep the first model's IfcProject, IfcSite, IfcBuilding hierarchy as-is
- For each additional model:
  - Skip its IfcProject, IfcSite (don't duplicate)
  - Keep its IfcBuilding entities, but remap the IfcRelAggregates that linked them to the skipped IfcSite — instead link them to the first model's IfcSite
  - Keep all other entities with remapped IDs
- Result: one Project → one Site → multiple Buildings (one per model's building)

**Strategy: `create-new`**:
- Generate a fresh IfcProject with new GlobalId
- Create a wrapper IfcSite
- Attach all models' IfcBuilding entities under the new site
- More complex but produces a cleaner hierarchy

#### Step 4: Deduplicate shared entities

For each model after the first, identify shared entity types to deduplicate:
- `IfcUnitAssignment` + referenced unit entities → remap to first model's
- `IfcGeometricRepresentationContext` / `SubContext` → remap to first model's
- `IfcOwnerHistory` → remap all references to first model's instance

Build a `sharedEntityRemap: Map<number, number>` per model that maps local IDs of shared entities to the first model's equivalent IDs. Pass this to `remapEntityText()`.

#### Step 5: Assembly

1. Generate unified STEP header with combined description
2. Write `DATA;` section:
   - First model's entities (unmodified, except any that get replaced)
   - Each additional model's entities (remapped IDs, minus skipped/deduplicated)
   - New IfcRelAggregates linking models' buildings to unified site
3. Write `ENDSEC; END-ISO-10303-21;`

#### Step 6: Update `ExportDialog.tsx` for merged export

When multiple models are loaded, add:
- A new export scope selector: **"Single model"** vs **"Merged (all models)"**
- When merged mode is selected:
  - Show checkboxes for which models to include
  - Show project merge strategy option
  - The visible-only filter applies per-model before merging
- Handle the case where models have different schema versions (warn or use highest)

### Coordinate Alignment Note

When models are loaded, `useIfcFederation` applies RTC coordinate alignment for rendering. For merged export:
- v1: Export each model's entities with their **original coordinates** (as stored in the source buffer). IFC viewers handle model placement via IfcSite/IfcLocalPlacement. This is what IfcOpenShell's MergeProjects does.
- v2: If users need models in unified coordinates, transform placement entities (IfcLocalPlacement root) — significantly more complex.

---

## Shared Infrastructure

Both features share the **reference collector** utility (`collectReferencedEntityIds`). The merged exporter can use the `visibleOnly` filtering per-model before merging, composing the two features cleanly.

## File Changes Summary

### New files

| File | Purpose |
|------|---------|
| `packages/export/src/reference-collector.ts` | Forward reference closure walker + visible entity ID computation |
| `packages/export/src/merged-exporter.ts` | Multi-model merge export |
| `packages/export/src/reference-collector.test.ts` | Tests for reference collector |
| `packages/export/src/merged-exporter.test.ts` | Tests for merged exporter |

### Modified files

| File | Change |
|------|--------|
| `packages/export/src/step-exporter.ts` | Add `visibleOnly`, `hiddenEntityIds`, `isolatedEntityIds` options; filter entity loop using reference closure |
| `packages/export/src/index.ts` | Export new classes and functions |
| `apps/viewer/src/components/viewer/ExportDialog.tsx` | Add "visible only" toggle, add "merge all models" mode, pass visibility state, global→local ID conversion |
| `apps/viewer/src/components/viewer/ExportChangesButton.tsx` | Add visible-only option |

### Unchanged

- Parser, renderer, store slices — no modifications needed. Visibility state is read from the store at export time but the store itself is not changed.
- The reference collector works purely on the source buffer + entity index — no new parser features required.

## Implementation Order

1. **`reference-collector.ts`** + tests — foundational utility used by both features
2. **`StepExporter` visible-only changes** — integrate reference collector into existing exporter
3. **`ExportDialog.tsx` visible-only UI** — wire up the toggle with store state
4. **`merged-exporter.ts`** + tests — builds on reference collector + step exporter patterns
5. **`ExportDialog.tsx` merge UI** — wire up merge mode with multi-model selection
6. **Build + test** full pipeline (`npm run build && npm test`)

## Performance Considerations

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Reference closure walk | O(E) where E = total entity bytes | Each entity visited once, regex on short strings |
| Visible entity ID computation | O(N) where N = entity count | Single pass over entity index |
| ID remapping (merge) | O(E) per model | Regex replace on each entity line |
| Full merge of 5 models, 100k entities each | O(5E) | Linear in total content size |

For a 200MB file with 500k entities, the reference walk should complete in <1s. Merged export of 5 × 200MB models produces ~1GB output — string concatenation should use array join, not += .

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Reference closure misses entities → invalid IFC | Always include infrastructure types (units, contexts, owner history) as mandatory roots; test with real IFC files |
| Merged IDs exceed safe integer range | Check total entity count before merge; warn user if approaching limits |
| STEP text regex doesn't handle all edge cases (e.g., `#` inside string literals) | The STEP spec says strings use `''` quoting with no `#` escaping; regex `#(\d+)` is safe for well-formed files |
| Relationship entities reference hidden entities (dangling refs) | v1: tolerate dangling refs (viewers handle this); v2: rewrite relationship text |
| Different schema versions across models | Warn user; only allow merge of same-schema models in v1 |
| Coordinate misalignment in merged export | Document: merged file uses original coordinates; IfcSite handles georef |
