# 2D Architectural Drawings

IFClite can generate 2D architectural drawings from 3D IFC models, including section cuts, floor plans, and elevations. The `@ifc-lite/drawing-2d` package produces vector SVG output with proper architectural conventions.

## What It Generates

From any 3D IFC model, you can produce:

- **Floor plans** - Horizontal section cuts at a specified height
- **Section cuts** - Vertical sections through the model
- **Elevations** - Projected views from a direction

Each drawing includes:

| Element | Description |
|---------|-------------|
| **Cut lines** | Bold lines where geometry intersects the section plane |
| **Projection lines** | Visible geometry beyond the cut plane |
| **Hidden lines** | Occluded geometry rendered as dashed lines |
| **Hatching** | Material-based fill patterns (concrete, masonry, insulation, etc.) |
| **Architectural symbols** | Door swings, window frames, stair arrows |
| **Annotations** | Dimensions and labels |

## Quick Start

### Generating a Floor Plan

```typescript
import { generateFloorPlan } from '@ifc-lite/drawing-2d';

// Generate a floor plan at 1.2m above ground
const drawing = await generateFloorPlan(meshData, {
  cutHeight: 1.2,
  showHiddenLines: true,
  showHatching: true,
});

console.log(`${drawing.cutLines.length} cut lines`);
console.log(`${drawing.projectionLines.length} projection lines`);
```

### Generating a Section

```typescript
import { generateSection, createSectionConfig } from '@ifc-lite/drawing-2d';

const config = createSectionConfig({
  axis: 'y',          // Cut along Y axis
  position: 5.0,      // At Y=5.0m
  direction: 'positive',
});

const drawing = await generateSection(meshData, config);
```

### SVG Export

```typescript
import { exportToSVG } from '@ifc-lite/drawing-2d';

const svg = exportToSVG(drawing, {
  width: 800,
  height: 600,
  scale: 100,          // 1:100
  showHatching: true,
  showHiddenLines: true,
});

// svg is a string of SVG markup
document.getElementById('drawing').innerHTML = svg;
```

## Drawing Sheets

For presentation-ready output, drawings can be placed on sheets with frames and title blocks:

```typescript
import {
  createFrame,
  createTitleBlock,
  renderFrame,
  renderTitleBlock,
  renderScaleBar,
  PAPER_SIZE_REGISTRY,
} from '@ifc-lite/drawing-2d';

// Create an A1 landscape sheet
const paper = PAPER_SIZE_REGISTRY.find(p => p.name === 'A1');
const frame = createFrame({ paper, orientation: 'landscape' });
const titleBlock = createTitleBlock({
  projectName: 'Office Building',
  drawingTitle: 'Ground Floor Plan',
  scale: '1:100',
  drawnBy: 'Architect',
  date: '2026-02-07',
});

// Render to SVG
const frameSvg = renderFrame(frame);
const titleBlockSvg = renderTitleBlock(titleBlock);
const scaleBarSvg = renderScaleBar({ scale: 100, units: 'm' });
```

## Graphic Overrides

Control how elements appear in 2D drawings using graphic override presets:

```typescript
import { createOverrideEngine, ARCHITECTURAL_PRESET } from '@ifc-lite/drawing-2d';

const engine = createOverrideEngine();

// Apply a built-in preset
engine.applyPreset(ARCHITECTURAL_PRESET);
// Available: VIEW_3D_PRESET, ARCHITECTURAL_PRESET, FIRE_SAFETY_PRESET,
//           STRUCTURAL_PRESET, MEP_PRESET, MONOCHROME_PRESET

// Or add custom rules
engine.addRule({
  id: 'highlight-walls',
  name: 'Highlight Load-Bearing Walls',
  enabled: true,
  priority: 1,
  criteria: { type: 'ifcType', value: 'IFCWALL' },
  style: { lineWeight: 0.5, color: '#FF0000' },
});
```

## Architectural Symbols

The package generates proper architectural symbols:

| Symbol | Description |
|--------|-------------|
| **Door swings** | Arc showing door opening direction and angle |
| **Sliding doors** | Arrow showing sliding direction |
| **Window frames** | Double-line representation with glass |
| **Stair arrows** | Direction arrows with UP/DOWN labels |

```typescript
import { generateDoorSymbol, generateWindowSymbol } from '@ifc-lite/drawing-2d';

const doorSvg = generateDoorSymbol({ width: 0.9, angle: 90, swing: 'left' });
const windowSvg = generateWindowSymbol({ width: 1.2, type: 'casement' });
```

## GPU Acceleration

For large models, section cutting can be GPU-accelerated:

```typescript
import { GPUSectionCutter, isGPUComputeAvailable } from '@ifc-lite/drawing-2d';

if (await isGPUComputeAvailable()) {
  const cutter = new GPUSectionCutter(gpuDevice);
  const result = await cutter.cut(meshData, sectionConfig);
}
```

## Viewer Integration

In the IFClite viewer:

1. **Activate section plane** - Position a section plane in the 3D view
2. **Open 2D panel** - The 2D drawing panel shows the section cut
3. **Toggle layers** - Show/hide cut lines, projection, hidden lines, hatching
4. **Measure** - Use the 2D measurement tool with snap-to-geometry
5. **Graphic overrides** - Apply presets to change element appearance
6. **Export SVG** - Download the drawing as vector SVG

### Display Options

| Option | Default | Description |
|--------|---------|-------------|
| Hidden lines | On | Show occluded geometry as dashed lines |
| Hatching | On | Material-based fill patterns |
| Annotations | On | Dimensions and labels |
| 3D overlay | On | Show section plane position in 3D view |
| Scale | 1:100 | Drawing scale for dimensions |
| Symbolic representations | Off | Use authored Plan/Annotation representations when available |
