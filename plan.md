# Plan: Universal Data Coloring — Lens + Lists Integration

## Current State

**Lens** supports 3 criteria types: `ifcType`, `property`, `material`. The `Lens` type already has an unused `autoColorProperty` field. The engine evaluates rules in a first-match-wins loop. `LensDataProvider` exposes: `getEntityType()`, `getPropertyValue()`, `getPropertySets()`.

**Lists** has column discovery (attributes, properties, quantities via sampling), an execution engine, and a virtualized results table. `ListDataProvider` exposes attributes, property sets, and quantity sets.

**Parser** provides on-demand extraction for: attributes, properties, quantities, classifications, materials — all lazy-cached.

---

## Phase 1: Extend LensDataProvider with all IFC data sources

**Goal**: Give the lens engine access to every data type the parser can extract.

### 1A. Extend `LensDataProvider` interface (`packages/lens/src/types.ts`)

```typescript
export interface LensDataProvider {
  // existing
  getEntityCount(): number;
  forEachEntity(callback: (globalId: number, modelId: string) => void): void;
  getEntityType(globalId: number): string | undefined;
  getPropertyValue(globalId: number, psetName: string, propName: string): unknown;
  getPropertySets(globalId: number): PropertySetInfo[];

  // NEW — optional for backward compat, engine checks before calling
  getEntityAttribute?(globalId: number, attrName: string): string | undefined;
  getQuantityValue?(globalId: number, qsetName: string, quantName: string): number | string | undefined;
  getClassifications?(globalId: number): ClassificationInfo[];
  getMaterialName?(globalId: number): string | undefined;
}
```

Add `ClassificationInfo` type:
```typescript
export interface ClassificationInfo {
  system?: string;
  identification?: string;
  name?: string;
}
```

### 1B. Implement in viewer adapter (`apps/viewer/src/lib/lens/adapter.ts`)

- `getEntityAttribute`: resolve globalId -> model, call `entities.getName()` / `entities.getDescription()` / etc., fall back to `extractEntityAttributesOnDemand()`
- `getQuantityValue`: resolve globalId -> model, call `extractQuantitiesOnDemand()`, search for qset+quantity name
- `getClassifications`: resolve globalId -> model, call `extractClassificationsOnDemand()`
- `getMaterialName`: resolve globalId -> model, call `extractMaterialsOnDemand()`, return top-level name or first layer/constituent name

### Files changed
- `packages/lens/src/types.ts` — extend interface + add ClassificationInfo
- `apps/viewer/src/lib/lens/adapter.ts` — implement new methods

---

## Phase 2: Add new criteria types to manual lens rules

**Goal**: Allow lens rules to match by attribute, quantity, and classification — not just ifcType/property/material.

### 2A. Extend `LensCriteria` (`packages/lens/src/types.ts`)

```typescript
export interface LensCriteria {
  type: 'ifcType' | 'property' | 'material' | 'attribute' | 'quantity' | 'classification';

  // existing fields (ifcType, propertySet, propertyName, operator, propertyValue, materialName)

  // NEW for attribute matching
  attributeName?: string;     // e.g. "Name", "Description", "ObjectType", "Tag"
  attributeValue?: string;

  // NEW for quantity matching
  quantitySet?: string;       // e.g. "Qto_WallBaseQuantities"
  quantityName?: string;      // e.g. "Length"
  quantityValue?: string;     // comparison value (stringified)

  // NEW for classification matching
  classificationSystem?: string;   // e.g. "Uniclass"
  classificationCode?: string;     // e.g. "Pr_60_10_32"
}
```

### 2B. Extend matching engine (`packages/lens/src/matching.ts`)

Add `matchesAttribute()`, `matchesQuantity()`, `matchesClassification()` functions. Wire into `matchesCriteria()` switch.

- **Attribute**: `provider.getEntityAttribute(globalId, attrName)` -> compare with operator
- **Quantity**: `provider.getQuantityValue(globalId, qsetName, quantName)` -> compare (supports numeric gt/lt/gte/lte)
- **Classification**: `provider.getClassifications(globalId)` -> match system name and/or code (contains/equals)

### 2C. Extend rule editor UI (`LensPanel.tsx`)

Currently the editor only shows an IFC class dropdown. Change to:
1. First dropdown: **criteria type** selector (`IFC Type | Attribute | Property | Quantity | Classification | Material`)
2. Then show type-specific fields:
   - **IFC Type**: class dropdown (existing)
   - **Attribute**: attribute name dropdown + operator + value input
   - **Property**: pset name + prop name + operator + value input
   - **Quantity**: qset name + quantity name + operator + value input
   - **Classification**: system input + code input + operator
   - **Material**: material name input (existing)

### Files changed
- `packages/lens/src/types.ts` — extend LensCriteria
- `packages/lens/src/matching.ts` — add 3 new matchers
- `packages/lens/src/matching.test.ts` — tests for new matchers
- `apps/viewer/src/components/viewer/LensPanel.tsx` — extend RuleEditor

---

## Phase 3: Auto-Color Mode (the core of "color by any data")

**Goal**: Given a data column (attribute, property, quantity, classification, material, or type), automatically discover distinct values across all entities and assign a unique color to each. No manual rule authoring needed.

### 3A. Generalize `autoColorProperty` on `Lens` type

Replace the narrow `autoColorProperty` with:

```typescript
export interface AutoColorSpec {
  source: 'ifcType' | 'attribute' | 'property' | 'quantity' | 'classification' | 'material';
  psetName?: string;       // for property/quantity
  propertyName?: string;   // for property/quantity/attribute
}

export interface Lens {
  id: string;
  name: string;
  rules: LensRule[];
  builtin?: boolean;
  autoColor?: AutoColorSpec;  // replaces autoColorProperty
}
```

### 3B. Implement `evaluateAutoColorLens()` in engine (`packages/lens/src/engine.ts`)

```
evaluateAutoColorLens(autoColor: AutoColorSpec, provider: LensDataProvider): LensEvaluationResult
```

Algorithm:
1. **Value extraction pass** (O(n)): iterate all entities, extract the target value, build `Map<string, number[]>` (value -> entity IDs)
2. **Color assignment**: sort distinct values (alpha or by frequency), assign colors from `LENS_PALETTE` (cycle if >12 distinct values). Null/empty -> ghost color.
3. **Build result**: construct `colorMap`, `ruleCounts`, `ruleEntityIds` using synthetic rule IDs per value. No `hiddenIds` in auto-color mode.
4. Return `LensEvaluationResult` with synthetic rules named after the values, entity counts per value, and full color map.

Value extraction per source type:
- `ifcType`: `provider.getEntityType(globalId)`
- `attribute`: `provider.getEntityAttribute(globalId, attrName)`
- `property`: `provider.getPropertyValue(globalId, psetName, propName)`
- `quantity`: `provider.getQuantityValue(globalId, qsetName, quantName)` -> bucket numeric values into ranges
- `classification`: `provider.getClassifications(globalId)` -> use `system:code` as the key
- `material`: `provider.getMaterialName(globalId)`

### 3C. Wire auto-color into `useLens` hook

In `useLens.ts`, check `activeLens.autoColor`:
- If present: call `evaluateAutoColorLens(activeLens.autoColor, provider)`
- If absent: call `evaluateLens(activeLens, provider)` (existing path)

Also store the synthetic rules in lensSlice so the UI legend can display them:
- Add `lensAutoColorLegend: Array<{ id: string; name: string; color: string; count: number }>` to the slice
- LensPanel reads this to render the legend when in auto-color mode

### 3D. Auto-color UI in LensPanel

When a lens has `autoColor` set (not manual rules):
- Show a **data source picker** instead of rule editor
- Show the color legend with discovered values + counts
- Click a value row -> isolate entities with that value
- Same export/import as regular lenses

### Files changed
- `packages/lens/src/types.ts` — AutoColorSpec, update Lens
- `packages/lens/src/engine.ts` — evaluateAutoColorLens()
- `packages/lens/src/engine.test.ts` — tests
- `apps/viewer/src/hooks/useLens.ts` — dispatch to auto-color path
- `apps/viewer/src/store/slices/lensSlice.ts` — add autoColorLegend state
- `apps/viewer/src/components/viewer/LensPanel.tsx` — auto-color legend display + data source picker

---

## Phase 4: Lists -> Lens Integration ("Color by Column")

**Goal**: From any list results table, click a column header button to "Color by this column" — instantly creating and activating an auto-color lens.

### 4A. Column header context action in `ListResultsTable.tsx`

Add a small palette icon on column headers (appears on hover, next to sort arrows):
- **"Color by {column}"** — creates a lens and activates it

### 4B. Map `ColumnDefinition` -> `AutoColorSpec`

```typescript
function columnToAutoColor(col: ColumnDefinition): AutoColorSpec {
  switch (col.source) {
    case 'attribute':
      if (col.propertyName === 'Type') return { source: 'ifcType' };
      return { source: 'attribute', propertyName: col.propertyName };
    case 'property':
      return { source: 'property', psetName: col.psetName, propertyName: col.propertyName };
    case 'quantity':
      return { source: 'quantity', psetName: col.psetName, propertyName: col.propertyName };
  }
}
```

### 4C. Action flow

When user clicks "Color by {column}":
1. Convert ColumnDefinition -> AutoColorSpec
2. Create a transient lens: `{ id: 'auto-color-from-list', name: 'Color by {label}', rules: [], autoColor: spec }`
3. Add to savedLenses (or use a special "ephemeral" lens slot)
4. Activate it -> `useLens` evaluates -> 3D model colored

### 4D. Visual feedback in list table

Once an auto-color lens is active from a list column:
- The colored column header gets a colored indicator
- Each cell in the colored column shows a small color swatch matching the entity's assigned color
- This creates a visual link between the table and the 3D view

### Files changed
- `apps/viewer/src/components/viewer/lists/ListResultsTable.tsx` — column header action + cell swatches
- `apps/viewer/src/lib/lists/columnToAutoColor.ts` — new mapping utility
- `apps/viewer/src/store/slices/lensSlice.ts` — add `activateAutoColorFromColumn` action

---

## Phase 5: Bidirectional Lists <-> Lens Sync

**Goal**: Lens and Lists stay in sync — activating a lens filters the list, and list interactions update the 3D view.

### 5A. Lens-aware list filtering

When a lens is active and a rule is isolated:
- The list results table auto-filters to show only entities matching the isolated rule
- Toggling isolation in the lens panel updates the list filter
- Implementation: `useViewerStore(s => s.lensRuleEntityIds)` -> filter list rows by entity ID membership

### 5B. List row hover -> 3D highlight

Already partially exists (row click selects entity). Extend:
- Row **hover** highlights entity in 3D (uses existing hover system)
- Selected row(s) in list = selected entities in 3D = highlighted in lens

### 5C. Multi-select in list -> batch operations

- Checkbox column in list results
- Select multiple rows -> "Color selected" / "Hide selected" / "Isolate selected" toolbar actions
- These actions create ad-hoc lens rules or use visibility/isolation directly

### Files changed
- `apps/viewer/src/components/viewer/lists/ListResultsTable.tsx` — lens-aware filtering, hover, multi-select
- `apps/viewer/src/components/viewer/lists/ListPanel.tsx` — toolbar actions

---

## Phase 6: Smart Presets & Discovery

**Goal**: Auto-generate useful lenses from model content.

### 6A. "Discover Lenses" feature

Scan the loaded model(s) and suggest lenses based on available data:
- "Color by Fire Rating" (if Pset_WallCommon.FireRating exists with >1 distinct value)
- "Color by Classification" (if IfcClassificationReference entities exist)
- "Color by Material" (if material associations exist)
- "Color by Storey" (spatial containment)

### 6B. Implementation

Reuse list column discovery (`discoverColumns()` from `@ifc-lite/lists`) to find available data columns. For each discovered column with good cardinality (2-20 distinct values), generate a suggested auto-color lens.

Display in LensPanel as a "Suggested" section below builtins.

### 6C. Built-in auto-color presets

Add to `presets.ts`:
```typescript
{ id: 'auto-by-type', name: 'By IFC Type (auto)', autoColor: { source: 'ifcType' }, rules: [] }
{ id: 'auto-by-material', name: 'By Material', autoColor: { source: 'material' }, rules: [] }
```

### Files changed
- `packages/lens/src/presets.ts` — new auto-color presets
- `apps/viewer/src/lib/lens/discovery.ts` — new file for lens suggestion logic
- `apps/viewer/src/components/viewer/LensPanel.tsx` — suggested lenses section

---

## Architecture Summary

```
+----------------------------------------------------------+
|                    User Interactions                       |
|                                                           |
|  LensPanel (manual rules)    ListResultsTable (color by)  |
|      |                              |                     |
|      |  create/edit lens            |  column header ->   |
|      |  with criteria               |  AutoColorSpec      |
|      v                              v                     |
|  +---------------------------------------------+         |
|  |           Lens Store (Zustand)               |         |
|  |  savedLenses[]  activeLensId  autoColorLegend|         |
|  +--------------------+------------------------+         |
|                       |                                   |
|                       v                                   |
|  +---------------------------------------------+         |
|  |           useLens() Hook                     |         |
|  |  activeLens.autoColor?                       |         |
|  |    -> evaluateAutoColorLens()                |         |
|  |  activeLens.rules?                           |         |
|  |    -> evaluateLens()                         |         |
|  +--------------------+------------------------+         |
|                       |                                   |
|                       v                                   |
|  +---------------------------------------------+         |
|  |       @ifc-lite/lens Engine                  |         |
|  |                                              |         |
|  |  evaluateLens()        -- rule-based         |         |
|  |  evaluateAutoColorLens() -- data-driven      |         |
|  |                                              |         |
|  |  Matching:                                   |         |
|  |    ifcType | attribute | property |          |         |
|  |    quantity | classification | material      |         |
|  +--------------------+------------------------+         |
|                       |                                   |
|                       v                                   |
|  +---------------------------------------------+         |
|  |      LensDataProvider (adapter)              |         |
|  |                                              |         |
|  |  getEntityType()        getEntityAttribute() |         |
|  |  getPropertyValue()     getQuantityValue()   |         |
|  |  getPropertySets()      getClassifications() |         |
|  |                         getMaterialName()    |         |
|  +--------------------+------------------------+         |
|                       |                                   |
|                       v                                   |
|  +---------------------------------------------+         |
|  |          @ifc-lite/parser                    |         |
|  |  On-demand extraction:                       |         |
|  |  attributes, properties, quantities,         |         |
|  |  classifications, materials                  |         |
|  +---------------------------------------------+         |
|                                                           |
|                       v                                   |
|  +---------------------------------------------+         |
|  |  setPendingColorUpdates() -> WebGPU Renderer |         |
|  |  Batch color updates -> GPU draw calls       |         |
|  +---------------------------------------------+         |
+----------------------------------------------------------+
```

---

## Implementation Order

| Step | Phase | Description | Complexity |
|------|-------|-------------|------------|
| 1 | 1A | Extend LensDataProvider interface | Small |
| 2 | 1B | Implement new methods in adapter | Medium |
| 3 | 3A | Define AutoColorSpec type | Small |
| 4 | 3B | Implement evaluateAutoColorLens() | Medium |
| 5 | 3C | Wire auto-color into useLens | Small |
| 6 | 3D | Auto-color legend in LensPanel | Medium |
| 7 | 4B | columnToAutoColor mapping | Small |
| 8 | 4A+4C | "Color by column" in ListResultsTable | Medium |
| 9 | 4D | Cell color swatches in list | Small |
| 10 | 2A | New criteria types | Small |
| 11 | 2B | New matching functions | Medium |
| 12 | 2C | Extended rule editor UI | Medium |
| 13 | 6C | Auto-color presets | Small |
| 14 | 6A+6B | Discover lenses from model | Medium |
| 15 | 5A | Lens <-> list filtering sync | Medium |
| 16 | 5B+5C | Hover sync + multi-select | Medium |

**Steps 1-9 are the critical path** — they deliver auto-color from Lists.
Steps 10-12 extend manual lens authoring to all data types.
Steps 13-16 are polish and deep integration.

---

## Performance Considerations

- **Auto-color value extraction** is O(n) — one pass through all entities. For property/quantity extraction, this hits on-demand parsing. With 100K entities and cached extraction, should be <500ms. Show a progress indicator for large models.
- **Distinct value bucketing** for quantities: numeric values should be bucketed into ranges (e.g., 5-10 bins) rather than treating each float as a distinct value. Use equal-interval binning.
- **Color palette cycling**: with >12 distinct values, cycle the palette. Consider generating additional colors via hue rotation for high-cardinality fields. Warn the user if >30 distinct values (suggest filtering first).
- **Caching**: the adapter already caches on-demand extraction per entity. For auto-color re-evaluation (e.g., switching columns), cached values persist.
- **No double iteration**: evaluateAutoColorLens() does a single pass — extract value + assign to group in one loop.
