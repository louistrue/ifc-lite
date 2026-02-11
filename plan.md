# Implementation Plan: Issue #198 — UI Enhancements

## Overview

Issue #198 requests six UI enhancements inspired by BIMCollab Zoom:

1. **Orthographic Projection** — Toggle between perspective and orthographic camera
2. **Projections Menu** — Unified UI for view directions + projection mode
3. **Automatic Floorplan** — One-click floor plan views per storey
4. **My View (Selection Basket)** — Persistent selection set with add/remove/show operations
5. **Tree View by Type** — Alternative hierarchy grouping elements by IFC type
6. **Smart View** — Rule-based filtering/coloring system for 3D viewport

## Current State Analysis

| Feature | Existing Infrastructure | Gap |
|---------|------------------------|-----|
| Ortho projection | `perspectiveReverseZ()` in math.ts, Camera class with composition pattern | No orthographic matrix, no projection mode state |
| Projections menu | 6 preset views + viewcube, `setPresetView()` in CameraAnimator | No unified dropdown combining presets + projection toggle |
| Auto floorplan | Full 2D drawing generation pipeline, storey data via `query.storeys` | No one-click storey→section shortcut |
| My View | Multi-model selection system (`EntityRef`, `selectedEntitiesSet`) | No persistence, no separate basket concept |
| Tree by type | Spatial hierarchy only in `treeDataBuilder.ts`, 3 hardcoded type toggles | No type-based tree builder, no grouping mode toggle |
| Smart View | `GraphicOverrideEngine` for 2D drawings with full rule system + presets | Rules only apply to 2D; no 3D viewport coloring UI |

---

## Phase 1: Orthographic Projection + Projections Menu

**Rationale:** Foundation for Phase 2 (auto floorplan needs ortho top-down). Smallest surface area with highest user impact.

### Task 1.1 — Orthographic projection matrix

**File:** `packages/renderer/src/math.ts`

Add `orthographicReverseZ()` method to `MathUtils`:

```typescript
static orthographicReverseZ(
  left: number, right: number,
  bottom: number, top: number,
  near: number, far: number
): Mat4
```

Uses reverse-Z convention matching `perspectiveReverseZ()` (near=1.0, far=0.0) so the existing depth buffer compare function (`greater`) works unchanged.

### Task 1.2 — Camera projection mode state

**File:** `packages/renderer/src/camera.ts`

Extend `CameraInternalState` with:
- `projectionMode: 'perspective' | 'orthographic'`
- `orthoSize: number` — half-height of orthographic view volume in world units

Add methods to `Camera` class:
- `setProjectionMode(mode)` — switch mode, recompute projection matrix
- `getProjectionMode()` — getter
- `setOrthoSize(size)` — set orthographic view volume
- `getOrthoSize()` — getter

Modify `updateMatrices()`:
```typescript
private updateMatrices(): void {
  this.state.viewMatrix = MathUtils.lookAt(...);
  if (this.state.projectionMode === 'orthographic') {
    const h = this.state.orthoSize;
    const w = h * this.state.camera.aspect;
    this.state.projMatrix = MathUtils.orthographicReverseZ(-w, w, -h, h, near, far);
  } else {
    this.state.projMatrix = MathUtils.perspectiveReverseZ(...);
  }
  this.state.viewProjMatrix = MathUtils.multiply(...);
}
```

### Task 1.3 — Orthographic zoom behavior

**File:** `packages/renderer/src/camera-controls.ts`

Modify `zoom()` to scale `orthoSize` in orthographic mode instead of translating camera position. The mouse-toward-zoom behavior still works — just apply offset to target/position while scaling orthoSize.

### Task 1.4 — Projection unproject for orthographic

**File:** `packages/renderer/src/camera-projection.ts`

Modify `unprojectToRay()`: In orthographic mode, the ray origin varies with screen position (parallel rays) instead of all originating from the camera position. This is critical for correct picking/measurement in orthographic mode.

Modify `fitToBounds()` and `frameBounds()`: Calculate appropriate `orthoSize` from bounds instead of camera distance.

### Task 1.5 — Store integration

**File:** `apps/viewer/src/store/slices/cameraSlice.ts`

Add to `CameraSlice`:
```typescript
projectionMode: 'perspective' | 'orthographic';
setProjectionMode: (mode: 'perspective' | 'orthographic') => void;
toggleProjectionMode: () => void;
```

Add to `CameraCallbacks`:
```typescript
setProjectionMode?: (mode: 'perspective' | 'orthographic') => void;
```

### Task 1.6 — Projections menu UI

**File:** `apps/viewer/src/components/viewer/MainToolbar.tsx`

Replace the existing "Preset Views" dropdown with a unified "Projections" dropdown that contains:
- **Projection toggle**: Perspective / Orthographic (with current state indicator)
- **Separator**
- **View directions**: Top, Bottom, Front, Back, Left, Right (existing presets)
- **Separator**
- **Home (Isometric)**: Existing home view

Use `Grid3x3` or `Box` icon from lucide-react. Show current projection mode as badge/indicator.

### Task 1.7 — Keyboard shortcut

**File:** `apps/viewer/src/hooks/useKeyboardShortcuts.ts`

Add `5` key to toggle orthographic (CAD convention: Numpad 5 = ortho toggle in Blender/FreeCAD). Update the keyboard shortcuts dialog.

### Task 1.8 — Store reset

**File:** `apps/viewer/src/store/index.ts`

Add `projectionMode: 'perspective'` to `resetViewerState()`.

---

## Phase 2: Automatic Floorplan Views

**Rationale:** Builds on Phase 1's orthographic camera. High user value — one-click floor plan per storey.

### Task 2.1 — Floorplan activation logic

**File:** `apps/viewer/src/hooks/useFloorplanView.ts` (new hook)

Create `useFloorplanView()` hook:
```typescript
function useFloorplanView() {
  const activateFloorplan = useCallback((storeyExpressId: number, modelId: string) => {
    // 1. Get storey elevation from ifcDataStore
    // 2. Set section plane: axis='down', position = elevation + 1.2m offset (eye level), enabled=true
    // 3. Set camera: orthographic, top-down view
    // 4. Fit camera to storey bounding box
    // 5. Optionally isolate storey elements
  }, []);

  return { activateFloorplan, availableStoreys };
}
```

The 1.2m offset is standard architectural practice (section cut at 1.2m above floor level).

### Task 2.2 — Storey data query

Use existing `query.storeys` API from `@ifc-lite/query` to get:
- Storey name, elevation, expressId
- Sort by elevation (highest first, matching BIMCollab convention)
- Support multi-model: collect storeys from all loaded models

### Task 2.3 — Floorplan menu UI

**File:** `apps/viewer/src/components/viewer/MainToolbar.tsx`

Add "Floorplan" dropdown button to toolbar (after section tool). Contents:
- List of storeys sorted by elevation (descending)
- Each item shows: storey name + elevation value
- Clicking activates section + ortho top-down + fit-to-bounds
- Multi-model: group by model name if >1 model
- Empty state: "No storeys available"
- Use `Layers` icon from lucide-react

### Task 2.4 — Floorplan keyboard shortcuts

Add `Ctrl+1` through `Ctrl+9` for quick storey access (1 = ground floor, ascending). Only as stretch goal; main access is via dropdown.

---

## Phase 3: My View (Selection Basket)

**Rationale:** Self-contained feature. Enables power users to build persistent component sets.

### Task 3.1 — My View store slice

**File:** `apps/viewer/src/store/slices/myViewSlice.ts` (new)

```typescript
interface MyViewSlice {
  // State
  myViewEntities: Set<string>;  // Serialized EntityRef ("modelId:expressId")

  // Actions
  addToMyView: (refs: EntityRef[]) => void;
  removeFromMyView: (refs: EntityRef[]) => void;
  setMyView: (refs: EntityRef[]) => void;  // Replace entire set
  clearMyView: () => void;
  showMyView: () => void;  // Isolate My View entities in 3D
  isInMyView: (ref: EntityRef) => boolean;
  getMyViewCount: () => number;
  getMyViewEntities: () => EntityRef[];
}
```

Uses `entityRefToString()` / `stringToEntityRef()` from existing types — same serialization as `selectedEntitiesSet`.

### Task 3.2 — Register slice in combined store

**File:** `apps/viewer/src/store/index.ts`

Import and spread `createMyViewSlice`, add to `ViewerState` type, add reset logic (clear `myViewEntities`).

### Task 3.3 — My View toolbar controls

**File:** `apps/viewer/src/components/viewer/MainToolbar.tsx`

Add My View button group after visibility controls:
- **Show** (Eye icon): Isolate My View entities — uses existing `isolateEntities()` from visibility slice
- **Add** (Plus icon): Add current selection to My View
- **Remove** (Minus icon): Remove current selection from My View
- **Set** (Equal icon): Replace My View with current selection
- **Clear** (Trash2 icon): Clear My View

Display entity count badge on the Show button.

Buttons are enabled/disabled contextually:
- Add: enabled when selection exists and not all selected are already in My View
- Remove: enabled when selection exists and some selected are in My View
- Show: enabled when My View is non-empty
- Clear: enabled when My View is non-empty

### Task 3.4 — Keyboard shortcuts

**File:** `apps/viewer/src/hooks/useKeyboardShortcuts.ts`

- `Shift+A`: Add selection to My View
- `Shift+R`: Remove selection from My View
- `Shift+S`: Show My View (isolate)

### Task 3.5 — Visual indicator in hierarchy

When My View has entities, show a small dot/badge on hierarchy tree nodes that are in My View. This is done lazily (check membership at render time) to avoid tree rebuild.

---

## Phase 4: Tree View by Type

**Rationale:** Requires changes to hierarchy panel internals. Self-contained but affects a complex component.

### Task 4.1 — Grouping mode state

**File:** `apps/viewer/src/components/viewer/HierarchyPanel.tsx`

Add local component state (persisted in `localStorage`):
```typescript
const [groupingMode, setGroupingMode] = useState<'spatial' | 'type'>(
  () => (localStorage.getItem('hierarchy-grouping') as 'spatial' | 'type') || 'spatial'
);
```

Not in Zustand store — this is a UI preference, not application state.

### Task 4.2 — Type-based tree builder

**File:** `apps/viewer/src/components/viewer/hierarchy/treeDataBuilder.ts`

Add `buildTypeTree()` function alongside existing `buildTreeData()`:

```typescript
function buildTypeTree(
  models: Map<string, FederatedModel>,
  expandedNodes: Set<string>,
  isMultiModel: boolean
): TreeNode[]
```

Tree structure:
```
IfcWall (47)
  ├── Basic Wall:Interior-138mm... [Model A]
  ├── Basic Wall:Exterior-300mm... [Model A]
  └── ...
IfcDoor (12)
  ├── Single-Flush:0915x2032mm... [Model B]
  └── ...
IfcWindow (23)
  └── ...
```

- Group by IFC type name (e.g., `IfcWall`, `IfcDoor`)
- Sort types alphabetically
- Show element count per type in parentheses
- Elements within type sorted by name
- Multi-model: show model name suffix `[ModelName]` if >1 model
- Use existing `TreeNode` interface — set `type` to the IFC type string

### Task 4.3 — Toggle UI in hierarchy header

**File:** `apps/viewer/src/components/viewer/HierarchyPanel.tsx`

Add segmented control in the hierarchy panel header (where search is):
- Two options: `Spatial` | `By Type`
- Small, unobtrusive — matches existing header style
- Switches `groupingMode` and persists to localStorage
- Use `Building2` icon for spatial, `Layers` icon for type

### Task 4.4 — Wire tree to grouping mode

In `HierarchyPanel.tsx`, switch tree data source based on `groupingMode`:
```typescript
const treeData = useMemo(() => {
  if (groupingMode === 'type') {
    return buildTypeTree(models, expandedNodes, isMultiModel);
  }
  return buildTreeData(models, expandedNodes, isMultiModel);
}, [groupingMode, models, expandedNodes, isMultiModel]);
```

Selection, visibility, search, and context menu behavior remain the same — they all work with `TreeNode.expressIds` which is present in both tree structures.

### Task 4.5 — Type tree performance

Ensure type tree builds efficiently for 100k+ entities:
- Pre-collect `Map<string, EntityRef[]>` in single pass over all entities
- Sort types once (26-50 types typical)
- Lazy child expansion (only build children when expanded)
- Same virtualization as spatial tree (Tanstack React Virtual)

---

## Phase 5: Smart View (Rule-Based 3D Filtering/Coloring)

**Rationale:** Most complex feature. Builds on existing `GraphicOverrideEngine` for 2D but needs new 3D coloring path. Should be last.

### Task 5.1 — Smart View store slice

**File:** `apps/viewer/src/store/slices/smartViewSlice.ts` (new)

```typescript
interface SmartViewRule {
  id: string;
  name: string;
  enabled: boolean;
  criteria: SmartViewCriteria;  // Reuse/adapt GraphicOverrideCriteria from drawing-2d
  action: 'colorize' | 'hide' | 'isolate' | 'transparent';
  color: string;  // Hex color for 'colorize' action
}

interface SmartView {
  id: string;
  name: string;
  rules: SmartViewRule[];
  autoColorProperty?: {  // "Auto-color by property" mode
    propertySetName: string;
    propertyName: string;
  };
}

interface SmartViewSlice {
  // State
  savedSmartViews: SmartView[];
  activeSmartViewId: string | null;
  smartViewPanelVisible: boolean;
  smartViewResults: Map<string, string>;  // entityKey → color hex

  // Actions
  createSmartView: (view: SmartView) => void;
  updateSmartView: (id: string, view: Partial<SmartView>) => void;
  deleteSmartView: (id: string) => void;
  setActiveSmartView: (id: string | null) => void;
  toggleSmartViewPanel: () => void;
  setSmartViewResults: (results: Map<string, string>) => void;
}
```

### Task 5.2 — Smart View rule engine for 3D

**File:** `apps/viewer/src/hooks/useSmartView.ts` (new hook)

Create rule evaluation engine that:
1. Iterates over all entities across all loaded models
2. For each entity, evaluates rule criteria (IFC type, property values, material)
3. Produces a `Map<globalId, color>` for entities matching colorize rules
4. Produces `Set<globalId>` for entities matching hide/isolate/transparent rules
5. Applies colors via existing `pendingColorUpdates` in `dataSlice` → renderer's `updateMeshColors()`
6. Applies visibility via existing `hideEntities()` / `isolateEntities()` from visibility slice

**Criteria evaluation** reuses the matching logic from `@ifc-lite/drawing-2d`'s `GraphicOverrideEngine` rule types:
- IFC type matching (exact + subtype)
- Property set + property name + operator (equals, contains, greater, less, exists)
- Material name matching
- AND/OR compound criteria

### Task 5.3 — Auto-color by property

When `autoColorProperty` is set on a Smart View:
1. Scan all entities for the specified property
2. Collect distinct values
3. Generate unique colors (HSL distribution for maximum visual separation)
4. Apply via `pendingColorUpdates`
5. Show color legend in panel

### Task 5.4 — Smart View panel UI

**File:** `apps/viewer/src/components/viewer/SmartViewPanel.tsx` (new)

Panel contents:
- **Smart View selector** dropdown (saved views + "New Smart View")
- **Rule list** with toggles, name, criteria summary, color swatch
- **Add rule** button → rule editor dialog
- **Auto-color** section: property set / property name selectors
- **Color legend**: distinct value → color mapping with entity counts
- **Apply / Reset** buttons

Rule editor dialog:
- Criteria type selector (IFC Type, Property, Material)
- Value input with appropriate widget (dropdown for types, text for property values)
- Action selector (Colorize, Hide, Isolate, Transparent)
- Color picker for Colorize action

### Task 5.5 — Toolbar integration

**File:** `apps/viewer/src/components/viewer/MainToolbar.tsx`

Add Smart View toggle button (similar to BCF/IDS/Lists):
- Use `Palette` or `Filter` icon from lucide-react
- Toggle `smartViewPanelVisible`
- Show panel in bottom area alongside BCF/IDS/Lists
- Badge showing active rule count

### Task 5.6 — Register in combined store + reset

**File:** `apps/viewer/src/store/index.ts`

Import and spread `createSmartViewSlice`, add to `ViewerState` type. Reset: clear `activeSmartViewId` and `smartViewResults` but keep `savedSmartViews`.

---

## Implementation Order & Dependencies

```
Phase 1 (Ortho + Projections) ← no dependencies
  ↓
Phase 2 (Auto Floorplan) ← depends on Phase 1 (orthographic camera)

Phase 3 (My View) ← no dependencies (can run parallel to Phase 1-2)

Phase 4 (Tree by Type) ← no dependencies (can run parallel to Phase 1-3)

Phase 5 (Smart View) ← no dependencies (can run parallel, but largest scope — do last)
```

**Suggested implementation sequence:**
1. Phase 1 — Ortho + Projections Menu
2. Phase 3 — My View (quick win while Phase 1 settles)
3. Phase 2 — Auto Floorplan (uses Phase 1)
4. Phase 4 — Tree by Type
5. Phase 5 — Smart View

## Files Modified (Summary)

### New Files
- `apps/viewer/src/store/slices/myViewSlice.ts`
- `apps/viewer/src/store/slices/smartViewSlice.ts`
- `apps/viewer/src/hooks/useFloorplanView.ts`
- `apps/viewer/src/hooks/useSmartView.ts`
- `apps/viewer/src/components/viewer/SmartViewPanel.tsx`

### Modified Files
- `packages/renderer/src/math.ts` — add `orthographicReverseZ()`
- `packages/renderer/src/camera.ts` — add projection mode, ortho size
- `packages/renderer/src/camera-controls.ts` — ortho zoom behavior
- `packages/renderer/src/camera-projection.ts` — ortho unproject, fit-to-bounds
- `apps/viewer/src/store/slices/cameraSlice.ts` — projection mode state
- `apps/viewer/src/store/types.ts` — CameraCallbacks extension
- `apps/viewer/src/store/index.ts` — new slices, reset logic
- `apps/viewer/src/store/constants.ts` — projection mode default
- `apps/viewer/src/components/viewer/MainToolbar.tsx` — projections dropdown, floorplan dropdown, My View buttons, Smart View toggle
- `apps/viewer/src/hooks/useKeyboardShortcuts.ts` — new shortcuts
- `apps/viewer/src/components/viewer/HierarchyPanel.tsx` — grouping mode toggle
- `apps/viewer/src/components/viewer/hierarchy/treeDataBuilder.ts` — `buildTypeTree()`

## Performance Considerations

1. **Orthographic projection**: Zero performance impact — same GPU pipeline, different mat4
2. **Type tree builder**: Single O(n) pass to group entities by type, then sort O(t·log(t)) for ~30 types. Lazy child expansion prevents upfront cost.
3. **Smart View rule evaluation**: O(n·r) where n=entities, r=rules. For 100k entities × 10 rules = 1M checks. Property lookups via existing indexed data store are O(1). Run evaluation in `requestIdleCallback` or debounce to avoid blocking.
4. **My View**: O(1) Set operations for add/remove/check membership.
5. **Auto floorplan**: Reuses existing section plane + camera animation — no new computation.

## Testing Strategy

- Unit tests for `orthographicReverseZ()` matrix correctness
- Unit tests for `buildTypeTree()` with mock data
- Unit tests for Smart View rule evaluation
- Integration: verify ortho picking works (unproject produces correct parallel rays)
- Manual: test with large models (100k+ entities) to verify no performance regression
