# Implementation Plan: Polygon Area Measurement, Text Box, and Cloud Annotations

**Issue #208 - Adding polygon annotations to 2D Section**

## Overview

Add three new annotation tools to the 2D Section panel:
1. **Polygon Area Measurement** - Draw a closed polygon, compute and display its area
2. **Text Box Annotation** - Place and edit text annotations on the 2D drawing
3. **Cloud Annotation** - Revision cloud markup (scalloped border around a rectangular region)

All three tools follow the existing pattern established by the linear measure tool (`measure2DMode`, `useMeasure2D`, canvas rendering in `Drawing2DCanvas`, SVG export in `useDrawingExport`).

---

## Architecture Decisions

### Unified Annotation State
Rather than adding separate state for each tool, introduce a single **annotation system** in the drawing2D slice. This keeps the store clean and makes it easy to add more annotation types later.

### Tool Mode Approach
Extend the existing `measure2DMode` pattern to a `annotation2DActiveTool` discriminated union: `'none' | 'measure' | 'polygon-area' | 'text' | 'cloud'`. This ensures only one tool is active at a time and reuses the existing mouse-handling infrastructure.

### Coordinate System
All annotations are stored in **drawing coordinates** (meters, same as `Measure2DResult`). This ensures they scale correctly with pan/zoom and export properly to SVG.

---

## Step-by-Step Implementation

### Step 1: Define Annotation Types

**File: `apps/viewer/src/store/slices/drawing2DSlice.ts`**

Add new interfaces alongside the existing `Measure2DResult`:

```typescript
/** Active 2D annotation tool */
export type Annotation2DTool = 'none' | 'measure' | 'polygon-area' | 'text' | 'cloud';

/** Polygon area measurement result */
export interface PolygonArea2DResult {
  id: string;
  points: Point2D[];       // Closed polygon vertices (drawing coords)
  area: number;            // Computed area in m²
  perimeter: number;       // Computed perimeter in m
}

/** Text box annotation */
export interface TextAnnotation2D {
  id: string;
  position: Point2D;       // Top-left corner (drawing coords)
  text: string;            // User-entered text
  fontSize: number;        // Font size in screen px (default 14)
  color: string;           // Text color (default '#000000')
  backgroundColor: string; // Background fill (default 'rgba(255,255,255,0.9)')
  borderColor: string;     // Border color (default '#333333')
}

/** Cloud (revision cloud) annotation */
export interface CloudAnnotation2D {
  id: string;
  points: Point2D[];       // Rectangle/polygon corners (drawing coords)
  color: string;           // Cloud stroke color (default '#E53935')
  label: string;           // Optional label text inside cloud
}
```

### Step 2: Extend the Drawing2D Store Slice

**File: `apps/viewer/src/store/slices/drawing2DSlice.ts`**

Add to `Drawing2DState`:
```typescript
// Annotation tool mode (replaces measure2DMode for tool selection)
annotation2DActiveTool: Annotation2DTool;

// Polygon area measurement
polygonArea2DPoints: Point2D[];            // Points being placed (in-progress)
polygonArea2DResults: PolygonArea2DResult[];// Completed polygon measurements

// Text annotations
textAnnotations2D: TextAnnotation2D[];
textAnnotation2DEditing: string | null;    // ID of text being edited

// Cloud annotations
cloudAnnotation2DPoints: Point2D[];        // Rectangle corners being placed
cloudAnnotations2D: CloudAnnotation2D[];
```

Add actions to `Drawing2DSlice`:
```typescript
// Tool selection
setAnnotation2DActiveTool: (tool: Annotation2DTool) => void;

// Polygon area
addPolygonArea2DPoint: (point: Point2D) => void;
completePolygonArea2D: () => void;
cancelPolygonArea2D: () => void;
removePolygonArea2DResult: (id: string) => void;
clearPolygonArea2DResults: () => void;

// Text annotations
addTextAnnotation2D: (annotation: TextAnnotation2D) => void;
updateTextAnnotation2D: (id: string, updates: Partial<TextAnnotation2D>) => void;
removeTextAnnotation2D: (id: string) => void;
setTextAnnotation2DEditing: (id: string | null) => void;
clearTextAnnotations2D: () => void;

// Cloud annotations
addCloudAnnotation2DPoint: (point: Point2D) => void;
completeCloudAnnotation2D: (label?: string) => void;
cancelCloudAnnotation2D: () => void;
removeCloudAnnotation2D: (id: string) => void;
clearCloudAnnotations2D: () => void;

// Clear all annotations
clearAllAnnotations2D: () => void;
```

**Key implementation detail**: `setAnnotation2DActiveTool` should also set `measure2DMode` for backward compatibility (when tool is 'measure', set `measure2DMode = true`; otherwise `false`). Cancel any in-progress annotation when switching tools.

### Step 3: Create the Annotation Hook

**File: `apps/viewer/src/hooks/useAnnotation2D.ts`**

Create a new hook that extends the pattern from `useMeasure2D.ts`. This hook handles mouse events for the polygon-area, text, and cloud tools. The existing `useMeasure2D` continues to handle the linear measure tool.

```typescript
export interface UseAnnotation2DParams {
  drawing: Drawing2D | null;
  viewTransform: { x: number; y: number; scale: number };
  sectionAxis: 'down' | 'front' | 'side';
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeTool: Annotation2DTool;
  // Polygon area state
  polygonArea2DPoints: Point2D[];
  addPolygonArea2DPoint: (pt: Point2D) => void;
  completePolygonArea2D: () => void;
  cancelPolygonArea2D: () => void;
  // Text state
  addTextAnnotation2D: (annotation: TextAnnotation2D) => void;
  setTextAnnotation2DEditing: (id: string | null) => void;
  // Cloud state
  cloudAnnotation2DPoints: Point2D[];
  addCloudAnnotation2DPoint: (pt: Point2D) => void;
  completeCloudAnnotation2D: (label?: string) => void;
  cancelCloudAnnotation2D: () => void;
  // Snap
  setMeasure2DSnapPoint: (pt: Point2D | null) => void;
}

export interface UseAnnotation2DResult {
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  cursorPosition: Point2D | null;  // For preview lines
}
```

**Behavior by tool:**

- **`polygon-area`**: Click to place vertices. Double-click (or click near first point) to close polygon and compute area. Escape to cancel. Snap to geometry reuses `findSnapPoint` logic from `useMeasure2D`. Area computation uses the shoelace formula.
- **`text`**: Click to place text box position. Immediately opens an inline text editing state (sets `textAnnotation2DEditing`). Enter to confirm, Escape to cancel.
- **`cloud`**: Click first corner, move mouse, click second corner to define the rectangle. Escape to cancel. Two-click placement (like a rectangle selection).

**Coordinate conversion** reuses the same `screenToDrawing` logic from `useMeasure2D`.

### Step 4: Implement Area Computation Utility

**File: `apps/viewer/src/components/viewer/tools/computePolygonArea.ts`**

```typescript
/** Compute area of a simple polygon using the shoelace formula */
export function computePolygonArea(points: Point2D[]): number;

/** Compute perimeter of a polygon */
export function computePolygonPerimeter(points: Point2D[]): number;

/** Format area for display */
export function formatArea(squareMeters: number): string;
```

### Step 5: Implement Cloud Path Generator

**File: `apps/viewer/src/components/viewer/tools/cloudPathGenerator.ts`**

Generate the scalloped "revision cloud" path from a rectangle. This creates arc segments along the edges:

```typescript
/** Generate cloud arc data from rectangle corners */
export function generateCloudArcs(
  corners: Point2D[],     // 4 rectangle corners
  arcRadius: number       // in drawing coords, controls scallop size
): Array<{ cx: number; cy: number; r: number; startAngle: number; endAngle: number }>;
```

For each edge of the rectangle, divide into segments of length ~2*arcRadius and generate semicircular arcs bulging outward. This is purely a geometry utility - no React dependencies.

### Step 6: Render Annotations in Drawing2DCanvas

**File: `apps/viewer/src/components/viewer/Drawing2DCanvas.tsx`**

Add new props:
```typescript
// Polygon area props
polygonAreaPoints?: Point2D[];
polygonAreaResults?: PolygonArea2DResult[];
polygonAreaCursorPos?: Point2D | null;
// Text annotation props
textAnnotations?: TextAnnotation2D[];
textAnnotationEditing?: string | null;
// Cloud annotation props
cloudAnnotationPoints?: Point2D[];
cloudAnnotations?: CloudAnnotation2D[];
// Active tool (for cursor/preview rendering)
annotation2DActiveTool?: Annotation2DTool;
```

Add rendering sections after the existing measurement rendering (section 4):

**5. RENDER POLYGON AREA MEASUREMENTS:**
- Draw completed polygon fills with semi-transparent blue
- Draw polygon outlines with dashed strokes
- Draw vertex dots at each corner
- Draw area + perimeter label at polygon centroid
- Draw in-progress polygon: existing vertices connected, plus preview line from last vertex to cursor

**6. RENDER TEXT ANNOTATIONS:**
- Draw background rectangle with padding
- Draw border
- Draw text (respecting fontSize, color)
- If editing, highlight border in blue

**7. RENDER CLOUD ANNOTATIONS:**
- Draw the scalloped cloud path using arcs from `generateCloudArcs`
- Fill with semi-transparent color
- Draw cloud label at center
- Draw in-progress cloud: rectangle outline from first corner to cursor

All rendering follows the existing pattern: convert drawing coords to screen coords using the axis-specific transform.

### Step 7: Add UI Controls to Section2DPanel

**File: `apps/viewer/src/components/viewer/Section2DPanel.tsx`**

Replace the single measure button with a tool group or dropdown:

```tsx
{/* Annotation Tools Dropdown */}
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      variant={annotation2DActiveTool !== 'none' ? 'default' : 'ghost'}
      size="icon-sm"
      title="Annotation tools"
    >
      <PenTool className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => setAnnotation2DActiveTool('measure')}>
      <Ruler className="h-4 w-4 mr-2" /> Distance Measure
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setAnnotation2DActiveTool('polygon-area')}>
      <Hexagon className="h-4 w-4 mr-2" /> Area Measure
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setAnnotation2DActiveTool('text')}>
      <Type className="h-4 w-4 mr-2" /> Text Box
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setAnnotation2DActiveTool('cloud')}>
      <Cloud className="h-4 w-4 mr-2" /> Revision Cloud
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Also add a "Clear All Annotations" button (trash icon) that appears when any annotations exist.

The narrow-mode overflow menu gets matching entries.

### Step 8: Wire Mouse Events

**File: `apps/viewer/src/components/viewer/Section2DPanel.tsx`**

Integrate `useAnnotation2D` alongside the existing `useMeasure2D`:

- The container div's event handlers dispatch to either `useMeasure2D` or `useAnnotation2D` based on the active tool.
- The existing `useMeasure2D` mouse handlers remain for `measure` tool.
- The new hook handles the polygon-area, text, and cloud tools.
- Add `onDoubleClick` handler on the container div (needed for polygon area completion).

**Cursor styling** update the container's className:
- `measure` / `polygon-area`: `cursor-crosshair`
- `text`: `cursor-text`
- `cloud`: `cursor-crosshair`
- `none`: `cursor-grab`

### Step 9: Inline Text Editor Component

**File: `apps/viewer/src/components/viewer/TextAnnotationEditor.tsx`**

A small overlay component positioned at the text annotation's screen location:

```tsx
interface TextAnnotationEditorProps {
  annotation: TextAnnotation2D;
  screenPosition: { x: number; y: number };
  onConfirm: (text: string) => void;
  onCancel: () => void;
}
```

This is a positioned `<textarea>` overlay on the canvas, auto-focused. Enter (without Shift) confirms, Escape cancels. Renders as an absolute-positioned element within the container div in Section2DPanel.

### Step 10: Export Annotations to SVG

**File: `apps/viewer/src/hooks/useDrawingExport.ts`**

Extend both `generateExportSVG` and `generateSheetSVG` to include the new annotation types. Add after the existing measurements section:

**Polygon area measurements:**
```svg
<g id="polygon-area-measurements">
  <polygon points="..." fill="rgba(33,150,243,0.1)" stroke="#2196F3"
           stroke-width="..." stroke-dasharray="..."/>
  <text ...>12.5 m²</text>
</g>
```

**Text annotations:**
```svg
<g id="text-annotations">
  <rect .../> <!-- background -->
  <text ...>User text here</text>
</g>
```

**Cloud annotations:**
```svg
<g id="cloud-annotations">
  <path d="..." fill="rgba(229,57,53,0.05)" stroke="#E53935" stroke-width="..."/>
  <text ...>Cloud label</text>
</g>
```

### Step 11: Update Store Reset

**File: `apps/viewer/src/store/index.ts`**

Add the new state fields to the `resetViewerState` function:
```typescript
annotation2DActiveTool: 'none',
polygonArea2DPoints: [],
polygonArea2DResults: [],
textAnnotations2D: [],
textAnnotation2DEditing: null,
cloudAnnotation2DPoints: [],
cloudAnnotations2D: [],
```

### Step 12: Update `useMeasure2D` Integration

**File: `apps/viewer/src/hooks/useMeasure2D.ts`**

Minimal changes - this hook continues to work as-is for the linear measure tool. The `setAnnotation2DActiveTool` action sets `measure2DMode` accordingly for backward compatibility so the existing measure logic is unaffected.

---

## File Change Summary

| File | Change Type | Description |
|------|------------|-------------|
| `apps/viewer/src/store/slices/drawing2DSlice.ts` | **Modify** | Add annotation types, state, actions |
| `apps/viewer/src/store/index.ts` | **Modify** | Add new fields to resetViewerState |
| `apps/viewer/src/hooks/useAnnotation2D.ts` | **Create** | New hook for polygon/text/cloud mouse handling |
| `apps/viewer/src/components/viewer/tools/computePolygonArea.ts` | **Create** | Shoelace formula for area, perimeter, formatting |
| `apps/viewer/src/components/viewer/tools/cloudPathGenerator.ts` | **Create** | Revision cloud scalloped path geometry |
| `apps/viewer/src/components/viewer/Drawing2DCanvas.tsx` | **Modify** | Render new annotation types on canvas |
| `apps/viewer/src/components/viewer/Section2DPanel.tsx` | **Modify** | Add toolbar dropdown, wire new hooks |
| `apps/viewer/src/components/viewer/TextAnnotationEditor.tsx` | **Create** | Inline text editor overlay |
| `apps/viewer/src/hooks/useDrawingExport.ts` | **Modify** | Export annotations to SVG |

**4 new files, 5 modified files.**

---

## Performance Considerations

1. **Annotation rendering** is O(n) where n is the number of annotations - typically < 50, so negligible compared to the thousands of drawing lines already rendered.
2. **Cloud path generation** runs once per cloud annotation (on creation), not on every frame. The generated arcs are cached in the annotation object.
3. **No new store subscriptions** that would cause cascade re-renders: annotations are read in `Drawing2DCanvas` which already re-renders on every transform change.
4. **Snap point search** for polygon-area reuses the existing `findSnapPoint` logic from `useMeasure2D` — no duplication.

---

## Interaction Details

### Polygon Area Tool
- **Click** → Place vertex (snaps to geometry)
- **Double-click** or **click near first vertex** → Close polygon, compute area, add to results
- **Escape** → Cancel current polygon
- **Minimum 3 vertices** to form a valid area
- Preview: dashed line from last vertex to cursor, semi-transparent fill preview when ≥3 points

### Text Box Tool
- **Click** → Place text box at position, open inline editor
- **Enter** → Confirm text, add annotation
- **Escape** → Cancel text placement
- **Click existing text** → Re-open editor to modify

### Cloud Tool
- **Click** → Place first corner of rectangle
- **Move + Click** → Place second corner, create cloud
- **Escape** → Cancel cloud placement
- Cloud auto-generates scalloped arcs along rectangle edges
- Optional: prompt for label text after placement (via small inline input)

---

## Testing Strategy

- Unit test `computePolygonArea` and `computePolygonPerimeter` with known shapes (triangle, square, irregular polygon)
- Unit test `generateCloudArcs` produces correct number of arcs for given edge lengths
- Unit test `formatArea` with various magnitudes
- Integration: verify annotation state in store (add/remove/clear)
- Manual: verify canvas rendering, SVG export, and interactions on actual IFC models
