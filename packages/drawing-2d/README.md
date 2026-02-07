# @ifc-lite/drawing-2d

2D architectural drawing generation from 3D IFC models. Produces section cuts, floor plans, and elevations as vector SVG with proper architectural conventions.

## Installation

```bash
npm install @ifc-lite/drawing-2d
```

## Quick Start

```typescript
import { generateFloorPlan, exportToSVG } from '@ifc-lite/drawing-2d';

// Generate a floor plan (meshes, elevation, options?)
const drawing = await generateFloorPlan(meshData, 1.2);

// Export as SVG
const svg = exportToSVG(drawing, { showHatching: true });
```

## Features

- Floor plans, sections, and elevations
- Cut lines, projection lines, and hidden lines
- Material-based hatching (concrete, masonry, insulation, etc.)
- Architectural symbols (door swings, window frames, stair arrows)
- Graphic override presets (architectural, fire safety, structural, MEP)
- Drawing sheets with frames, title blocks, and scale bars
- GPU-accelerated section cutting
- SVG vector output

## API

See the [2D Drawings Guide](../../docs/guide/drawing-2d.md) and [API Reference](../../docs/api/typescript.md#ifc-litedrawing-2d).

## License

[MPL-2.0](../../LICENSE)
