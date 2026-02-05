# @ifc-lite/superset-plugin-chart-ifc-viewer

Apache Superset chart plugin that renders ifc-lite's WebGPU-accelerated 3D IFC viewer directly inside dashboards. Color building elements by data metrics and cross-filter with other charts by clicking entities.

## Features

- **WebGPU-accelerated rendering** — Renders millions of triangles smoothly
- **Cross-filtering** — Click an entity to filter other dashboard charts
- **Data-driven coloring** — Color entities by database metrics (cost, status, energy rating, etc.)
- **Streaming** — Progressive rendering for large IFC files
- **GPU lifecycle management** — Properly destroys GPU contexts on unmount (no context exhaustion)

## Quick Start

### Option 1: Local Superset Development (Recommended)

This is the most reliable way to test the plugin integration.

#### Step 1: Clone Superset

```bash
# Clone Apache Superset
git clone https://github.com/apache/superset.git
cd superset
```

#### Step 2: Link the Plugin

```bash
# From the superset-frontend directory
cd superset-frontend

# Link the ifc-lite plugin (adjust path to your ifc-lite repo)
npm install /path/to/ifc-lite/packages/superset-plugin

# Or with pnpm/yarn:
# pnpm add /path/to/ifc-lite/packages/superset-plugin
```

#### Step 3: Register in MainPreset.ts

Edit `superset-frontend/src/visualizations/presets/MainPreset.ts`:

```typescript
import IfcViewerChartPlugin from '@ifc-lite/superset-plugin-chart-ifc-viewer';

// Inside the constructor plugins array:
export default class MainPreset extends Preset {
  constructor() {
    super({
      plugins: [
        // ... existing plugins ...
        new IfcViewerChartPlugin().configure({ key: 'ifc_viewer' }),
      ],
    });
  }
}
```

#### Step 4: Start Superset Dev Server

```bash
# From superset-frontend
npm run dev-server
```

Navigate to Superset and create a new chart — **"IFC 3D Viewer"** should appear in the chart type picker under the "BIM / AEC" category.

### Option 2: Docker (Quick Smoke Test)

```bash
# Clone and start Superset with Docker
git clone https://github.com/apache/superset.git
cd superset
docker compose -f docker-compose-non-dev.yml up -d
```

Then mount your plugin into the frontend build (requires customizing the Dockerfile or using volumes).

## Configuration

### Chart Control Panel

| Control | Description |
|---------|-------------|
| **Static Model URL** | Direct URL to an IFC file (e.g., `https://example.com/model.ifc`) |
| **Model URL Column** | Column containing per-row IFC file URLs |
| **Entity ID Column** | Column with IFC GlobalId or ExpressID values for data mapping |
| **Color Metric** | Numeric metric to map to entity colors |
| **Background Color** | Viewer background color |
| **Enable Picking** | Allow clicking entities to trigger cross-filters |

### Example Dataset Schema

```sql
CREATE TABLE building_elements (
    global_id VARCHAR(22) PRIMARY KEY,  -- Matches IFC entity GlobalId
    element_type VARCHAR(50),           -- IfcWall, IfcSlab, etc.
    model_url TEXT,                     -- URL to the IFC file
    cost DECIMAL(10,2),                 -- Metric for coloring
    status VARCHAR(20)                  -- planned, built, demolished
);
```

## CSP Configuration (Required for Production)

If running Superset with Content Security Policy, add `'wasm-unsafe-eval'` to allow WASM compilation:

```python
# superset_config.py
TALISMAN_CONFIG = {
    "content_security_policy": {
        "script-src": ["'self'", "'strict-dynamic'", "'wasm-unsafe-eval'"],
        "worker-src": ["'self'", "blob:"],
    },
    "content_security_policy_nonce_in": ["script-src"],
}
```

## Testing Checklist

### Static URL Mode
Set a direct URL to an `.ifc` file hosted somewhere (public S3 bucket, local file server, etc.).

### Cross-Filtering
1. Place the IFC viewer and a table chart on the same dashboard
2. Both should use the same dataset with an `entity_id` column
3. Click an entity in 3D — the table should filter to that entity

### Large Model Performance
Load a 50MB+ IFC file to verify:
- Streaming works (progressive rendering)
- Dashboard stays responsive
- Memory is managed properly

### Tab Switching
1. Put the viewer in a dashboard tab
2. Switch away and back
3. Verify GPU context is properly destroyed and recreated (no "too many WebGL contexts" warnings in console)

## Browser Requirements

- **Chrome 113+** / **Edge 113+** — Full WebGPU support
- **Safari 18+** — WebGPU support
- **Firefox 141+** — WebGPU support (behind flag in earlier versions)

The plugin detects WebGPU availability and shows a clear error message if unavailable.

## Development

```bash
# Build the plugin
cd packages/superset-plugin
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test
```

## Architecture

```
IFC File URL
    → fetch() ArrayBuffer
    → @ifc-lite/geometry GeometryProcessor (WASM)
    → MeshData[]
    → @ifc-lite/renderer WebGPU Renderer
    → Canvas

Superset Query Results
    → transformProps() → entityColorMap
    → Renderer.render({ colors, isolatedIds })

User Click
    → Renderer.pick(x, y)
    → setDataMask() cross-filter
```

## License

MPL-2.0 — see [LICENSE](../../LICENSE)
