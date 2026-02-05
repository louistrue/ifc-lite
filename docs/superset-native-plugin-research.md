# Superset Native Plugin: IFC Viewer Integration Research

## Executive Summary

Building a `superset-plugin-chart-ifc-viewer` that renders ifc-lite directly inside Apache Superset dashboards is **technically feasible** and architecturally sound. No WebGPU or WASM-based Superset plugin exists today — this would be a first — but the deck.gl plugin (WebGL-based geospatial rendering) proves that GPU-accelerated, canvas-based visualizations are first-class citizens in Superset's plugin system.

The ifc-lite packages (`@ifc-lite/parser`, `@ifc-lite/geometry`, `@ifc-lite/renderer`) already expose a clean, consumer-friendly API that maps directly to Superset's `transformProps → ChartComponent` architecture. The main engineering challenges are WASM bundling, GPU context lifecycle management, and cross-filter integration — all solvable with documented patterns.

---

## Table of Contents

1. [Superset Plugin Architecture](#1-superset-plugin-architecture)
2. [ifc-lite API Surface for Plugin Consumers](#2-ifc-lite-api-surface-for-plugin-consumers)
3. [Plugin File Structure](#3-plugin-file-structure)
4. [Detailed Component Design](#4-detailed-component-design)
5. [Distribution Strategy](#5-distribution-strategy)
6. [WebGPU / WASM Constraints & Solutions](#6-webgpu--wasm-constraints--solutions)
7. [Cross-Filtering Integration](#7-cross-filtering-integration)
8. [Performance Considerations](#8-performance-considerations)
9. [Risks & Mitigations](#9-risks--mitigations)
10. [Implementation Roadmap](#10-implementation-roadmap)

---

## 1. Superset Plugin Architecture

### How Chart Plugins Work

Superset chart plugins are npm packages that register with `@superset-ui/core`'s `ChartPlugin` class. Each plugin provides:

| Component | Purpose |
|---|---|
| `metadata` | Display name, thumbnail, description, tags |
| `controlPanel` | Configuration UI shown in chart edit mode |
| `buildQuery` | Constructs the SQL/API query from user config |
| `transformProps` | Maps query results → component props |
| `Chart` or `loadChart` | The React component that renders the visualization |

The `loadChart: () => import('./MyChart')` pattern enables code splitting — the chart code is only loaded when a user actually views that chart type.

### Plugin Registration

```typescript
// plugin/src/index.ts
import { ChartPlugin } from '@superset-ui/core';
import metadata from './metadata';
import controlPanel from './controlPanel';
import buildQuery from './buildQuery';
import transformProps from './transformProps';

export default class IfcViewerChartPlugin extends ChartPlugin {
  constructor() {
    super({
      metadata,
      controlPanel,
      buildQuery,
      loadChart: () => import('./IFCViewerChart'),
      loadTransformProps: () => import('./transformProps'),
    });
  }
}
```

### SuperChart Wrapper

Superset wraps every plugin in a `<SuperChart>` component that handles:
- Lazy loading and loading states
- Error boundaries
- Responsive sizing (provides `width` and `height` to the plugin)
- Data fetching lifecycle

Plugins receive a container div with known dimensions and have **full DOM control** within it — no shadow DOM, no sandboxing, no iframe.

---

## 2. ifc-lite API Surface for Plugin Consumers

### Minimal Rendering Pipeline

```
IFC File (ArrayBuffer)
    → GeometryProcessor.processAdaptive()  // Parse + generate meshes
    → Renderer.addMeshes()                 // Upload to GPU
    → Renderer.render()                    // Draw frame
```

### Key Classes

#### `GeometryProcessor` (`@ifc-lite/geometry`)

```typescript
const processor = new GeometryProcessor({ quality: GeometryQuality.Balanced });
await processor.init(); // Loads WASM

// Streaming: yields batches for progressive rendering
for await (const event of processor.processAdaptive(buffer, {
  sizeThreshold: 2 * 1024 * 1024, // 2MB: sync below, streaming above
  batchSize: { initialBatchSize: 50, maxBatchSize: 500 },
})) {
  if (event.type === 'batch') {
    renderer.addMeshes(event.meshes, true);
  }
}
```

#### `Renderer` (`@ifc-lite/renderer`)

```typescript
const renderer = new Renderer(canvas);
await renderer.init(); // Initialize WebGPU

renderer.addMeshes(meshes, isStreaming);
renderer.convertToInstanced(allMeshes); // GPU optimization after streaming completes
renderer.fitToView();

renderer.render({
  selectedIds: new Set([42, 99]),
  hiddenIds: new Set([101, 102]),
  clearColor: [0.95, 0.95, 0.95, 1.0],
});

// Picking (for cross-filtering)
const pick = await renderer.pick(mouseX, mouseY);
// → { expressId: 42, modelIndex: 0 }
```

#### `IfcParser` (`@ifc-lite/parser`)

```typescript
const parser = new IfcParser();
const store = await parser.parseColumnar(buffer);
// store contains: entities, properties, spatial hierarchy, types
```

### Data Types

```typescript
interface MeshData {
  expressId: number;
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  color: [number, number, number, number]; // RGBA 0-255
  ifcType?: string;       // "IfcWall", "IfcWindow", etc.
  bounds?: { min: [number, number, number]; max: [number, number, number] };
}
```

### What Needs Packaging for the Plugin

| Package | Role | Size Concern |
|---|---|---|
| `@ifc-lite/renderer` | WebGPU rendering, camera, picking | ~150KB (JS) |
| `@ifc-lite/geometry` | IFC→mesh processing, WASM bridge | ~50KB (JS) + ~2-4MB (WASM) |
| `@ifc-lite/parser` | IFC file parsing, property extraction | ~80KB (JS) |
| WASM binary (`web-ifc.wasm`) | C++ IFC geometry kernel | ~2-4MB |

Total plugin weight: **~3-5MB** (loaded lazily via `loadChart`).

---

## 3. Plugin File Structure

```
superset-plugin-chart-ifc-viewer/
├── package.json
├── tsconfig.json
├── webpack.config.js              # Only needed for .supx extension distribution
├── src/
│   ├── index.ts                   # ChartPlugin registration
│   ├── metadata.ts                # Plugin metadata (name, thumbnail, tags)
│   ├── controlPanel.ts            # User configuration UI
│   ├── buildQuery.ts              # SQL query construction
│   ├── transformProps.ts          # Query results → viewer props
│   ├── IFCViewerChart.tsx         # Main React component (lazy-loaded)
│   ├── types.ts                   # TypeScript interfaces
│   ├── hooks/
│   │   ├── useIFCRenderer.ts      # WebGPU renderer lifecycle
│   │   ├── useIFCLoader.ts        # File fetching + parsing
│   │   └── useEntityColorMap.ts   # Maps Superset metrics → entity colors
│   ├── utils/
│   │   ├── colorScale.ts          # d3 color scales for metric visualization
│   │   └── wasmLoader.ts          # WASM loading with fallback
│   └── images/
│       └── thumbnail.png          # Chart type thumbnail for Superset UI
├── test/
│   ├── transformProps.test.ts
│   ├── buildQuery.test.ts
│   └── IFCViewerChart.test.tsx
└── README.md
```

---

## 4. Detailed Component Design

### `controlPanel.ts` — User Configuration

The control panel defines what users configure when editing the chart in Superset:

```typescript
import { ControlPanelConfig, sections } from '@superset-ui/chart-controls';

const controlPanel: ControlPanelConfig = {
  controlPanelSections: [
    // === Data Source ===
    {
      label: 'IFC Model',
      expanded: true,
      controlSetRows: [
        // Column containing the URL to the IFC file
        [{
          name: 'model_url_column',
          config: {
            type: 'SelectControl',
            label: 'Model URL Column',
            description: 'Column containing IFC model file URLs',
            mapStateToProps: (state) => ({
              choices: state.datasource?.columns?.map(c => [c.column_name, c.column_name]),
            }),
          },
        }],
        // Optional: static model URL (if not from a column)
        [{
          name: 'static_model_url',
          config: {
            type: 'TextControl',
            label: 'Static Model URL',
            description: 'Direct URL to an IFC file (used if no URL column selected)',
            default: '',
          },
        }],
      ],
    },

    // === Entity Mapping ===
    {
      label: 'Entity Mapping',
      expanded: true,
      controlSetRows: [
        // Column containing IFC entity GlobalIds or ExpressIDs
        [{
          name: 'entity_id_column',
          config: {
            type: 'SelectControl',
            label: 'Entity ID Column',
            description: 'Column with IFC entity GlobalId or ExpressID values',
          },
        }],
        // Metric to color entities by
        [{
          name: 'color_metric',
          config: {
            type: 'MetricsControl',
            label: 'Color By Metric',
            description: 'Numeric metric to map to entity colors (e.g., cost, area, status code)',
            multi: false,
          },
        }],
        // Color scheme
        [{
          name: 'color_scheme',
          config: {
            type: 'ColorSchemeControl',
            label: 'Color Scheme',
            default: 'superset_sequential',
          },
        }],
      ],
    },

    // === Viewer Options ===
    {
      label: 'Viewer Options',
      expanded: false,
      controlSetRows: [
        [{
          name: 'background_color',
          config: {
            type: 'ColorPickerControl',
            label: 'Background Color',
            default: { r: 245, g: 245, b: 245, a: 1 },
          },
        }],
        [{
          name: 'enable_picking',
          config: {
            type: 'CheckboxControl',
            label: 'Enable Entity Selection',
            description: 'Allow clicking entities to trigger cross-filters',
            default: true,
          },
        }],
        [{
          name: 'section_plane_enabled',
          config: {
            type: 'CheckboxControl',
            label: 'Enable Section Plane',
            default: false,
          },
        }],
      ],
    },
  ],
};
```

### `buildQuery.ts` — Query Construction

```typescript
import { buildQueryContext, QueryFormData } from '@superset-ui/core';

export default function buildQuery(formData: QueryFormData) {
  return buildQueryContext(formData, (baseQueryObject) => {
    const columns = [];
    const metrics = [];

    // Entity ID column (required for mapping data → 3D entities)
    if (formData.entity_id_column) {
      columns.push(formData.entity_id_column);
    }

    // Model URL column (if dynamic per-row)
    if (formData.model_url_column) {
      columns.push(formData.model_url_column);
    }

    // Color-by metric
    if (formData.color_metric) {
      metrics.push(formData.color_metric);
    }

    return [{
      ...baseQueryObject,
      columns,
      metrics,
      // Group by entity ID so each row = one entity with its metric value
      groupby: formData.entity_id_column ? [formData.entity_id_column] : [],
      orderby: formData.color_metric
        ? [[formData.color_metric, false]] // descending
        : undefined,
    }];
  });
}
```

### `transformProps.ts` — Query Results → Viewer Props

```typescript
import { ChartProps } from '@superset-ui/core';

export interface IFCViewerProps {
  width: number;
  height: number;
  modelUrl: string;
  entityColorMap: Map<string, [number, number, number, number]>;
  entityMetricMap: Map<string, number>;
  colorScheme: string;
  backgroundColor: [number, number, number, number];
  enablePicking: boolean;
  sectionPlaneEnabled: boolean;
  onEntityClick?: (entityId: string, metricValue?: number) => void;
}

export default function transformProps(chartProps: ChartProps): IFCViewerProps {
  const { width, height, formData, queriesData, hooks } = chartProps;
  const data = queriesData[0]?.data ?? [];

  // Resolve model URL: static config or from first data row
  const modelUrl = formData.static_model_url
    || (formData.model_url_column && data[0]?.[formData.model_url_column])
    || '';

  // Build entity → metric value map
  const entityMetricMap = new Map<string, number>();
  const metricKey = formData.color_metric?.label ?? formData.color_metric;

  if (formData.entity_id_column && metricKey) {
    for (const row of data) {
      const entityId = String(row[formData.entity_id_column]);
      const value = Number(row[metricKey]);
      if (!isNaN(value)) {
        entityMetricMap.set(entityId, value);
      }
    }
  }

  // Build color map from metric values using color scheme
  const entityColorMap = buildColorMap(entityMetricMap, formData.color_scheme);

  const bg = formData.background_color ?? { r: 245, g: 245, b: 245, a: 1 };

  return {
    width,
    height,
    modelUrl,
    entityColorMap,
    entityMetricMap,
    colorScheme: formData.color_scheme ?? 'superset_sequential',
    backgroundColor: [bg.r / 255, bg.g / 255, bg.b / 255, bg.a],
    enablePicking: formData.enable_picking ?? true,
    sectionPlaneEnabled: formData.section_plane_enabled ?? false,
    onEntityClick: hooks?.setDataMask ? (entityId, value) => {
      // Cross-filter: clicking an entity filters other charts
      hooks.setDataMask({
        extraFormData: {
          filters: [{
            col: formData.entity_id_column,
            op: '==',
            val: entityId,
          }],
        },
      });
    } : undefined,
  };
}

function buildColorMap(
  metricMap: Map<string, number>,
  scheme: string,
): Map<string, [number, number, number, number]> {
  const colorMap = new Map<string, [number, number, number, number]>();
  if (metricMap.size === 0) return colorMap;

  const values = Array.from(metricMap.values());
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Use d3 sequential color scale
  for (const [entityId, value] of metricMap) {
    const t = (value - min) / range; // normalize to 0-1
    // Map to RGBA using a sequential palette (simplified here)
    const r = Math.round(255 * (1 - t) * 0.3 + 255 * t * 0.9);
    const g = Math.round(255 * (1 - t) * 0.6 + 255 * t * 0.1);
    const b = Math.round(255 * (1 - t) * 0.9 + 255 * t * 0.1);
    colorMap.set(entityId, [r, g, b, 255]);
  }

  return colorMap;
}
```

### `IFCViewerChart.tsx` — Main React Component

```typescript
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Renderer } from '@ifc-lite/renderer';
import { GeometryProcessor, GeometryQuality } from '@ifc-lite/geometry';
import type { IFCViewerProps } from './transformProps';

const IFCViewerChart: React.FC<IFCViewerProps> = ({
  width,
  height,
  modelUrl,
  entityColorMap,
  backgroundColor,
  enablePicking,
  onEntityClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const processorRef = useRef<GeometryProcessor | null>(null);
  const rafRef = useRef<number | null>(null);
  const loadedUrlRef = useRef<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let destroyed = false;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    const processor = new GeometryProcessor({ quality: GeometryQuality.Balanced });
    processorRef.current = processor;

    Promise.all([renderer.init(), processor.init()])
      .then(() => { if (!destroyed) setError(null); })
      .catch((err) => {
        if (!destroyed) setError(`GPU init failed: ${err.message}`);
      });

    // Critical: clean up GPU resources on unmount (follows deck.gl pattern)
    return () => {
      destroyed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const device = renderer.getGPUDevice();
      if (device) device.destroy();
    };
  }, []);

  // Load model when URL changes
  useEffect(() => {
    const renderer = rendererRef.current;
    const processor = processorRef.current;
    if (!renderer?.isReady() || !processor || !modelUrl || modelUrl === loadedUrlRef.current) return;

    let cancelled = false;
    setLoading(true);
    setProgress(0);

    (async () => {
      const response = await fetch(modelUrl);
      if (cancelled) return;
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (cancelled) return;

      let totalMeshes = 0;
      for await (const event of processor.processAdaptive(buffer, {
        sizeThreshold: 2 * 1024 * 1024,
      })) {
        if (cancelled) return;
        switch (event.type) {
          case 'batch':
            renderer.addMeshes(event.meshes, true);
            totalMeshes = event.totalSoFar;
            setProgress(totalMeshes);
            break;
          case 'complete':
            renderer.fitToView();
            break;
        }
      }

      loadedUrlRef.current = modelUrl;
      setLoading(false);
    })().catch((err) => {
      if (!cancelled) setError(`Load failed: ${err.message}`);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [modelUrl]);

  // Render loop: re-render when colors/visibility change
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer?.isReady()) return;

    // Apply entity color overrides from Superset data
    // TODO: renderer.setEntityColors(entityColorMap) — requires extending Renderer API

    renderer.render({ clearColor: backgroundColor });
  }, [entityColorMap, backgroundColor]);

  // Handle resize
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer?.isReady()) {
      renderer.resize(width, height);
      renderer.render({ clearColor: backgroundColor });
    }
  }, [width, height, backgroundColor]);

  // Handle click → cross-filter
  const handleClick = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!enablePicking || !onEntityClick) return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const result = await renderer.pick(x, y);
    if (result) {
      onEntityClick(String(result.expressId));
    }
  }, [enablePicking, onEntityClick]);

  return (
    <div style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {loading && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          padding: '4px 12px', borderRadius: 4, fontSize: 12,
        }}>
          Loading... ({progress} meshes)
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.9)', color: '#c00', fontSize: 14,
        }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default IFCViewerChart;
```

---

## 5. Distribution Strategy

There are **three distribution paths**, from simplest to most decoupled:

### Option A: Built-in Plugin (Fork/PR to Superset)

**How:** Add the plugin to `superset-frontend/plugins/` and register it in the preset.

```
superset-frontend/plugins/plugin-chart-ifc-viewer/
```

- Builds with Superset's own Webpack config
- Zero deployment friction for anyone running that Superset version
- Requires Superset maintainer buy-in or a maintained fork

**Best for:** Organizations running their own Superset fork.

### Option B: npm Package (Standard Plugin Distribution)

**How:** Publish `@ifc-lite/superset-plugin-chart-ifc-viewer` to npm. Consumers install it and register it in their Superset build.

```bash
npm install @ifc-lite/superset-plugin-chart-ifc-viewer
```

```typescript
// superset-frontend/src/visualizations/presets/MainPreset.ts
import IfcViewerChartPlugin from '@ifc-lite/superset-plugin-chart-ifc-viewer';

export default class MainPreset extends Preset {
  constructor() {
    super({
      plugins: [
        new IfcViewerChartPlugin().configure({ key: 'ifc_viewer' }),
        // ... other plugins
      ],
    });
  }
}
```

- Requires rebuilding `superset-frontend` with the plugin included
- Well-documented pattern (dozens of community plugins use this)
- Consumer controls the Superset version compatibility

**Best for:** Open-source distribution to the Superset community.

### Option C: `.supx` Extension (Webpack Module Federation — No Rebuild)

**How:** Build the plugin as a standalone Webpack Module Federation remote. Deploy the built assets to a static host. Configure Superset to load it at runtime.

```javascript
// Plugin's webpack.config.js
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  entry: './src/bootstrap.ts',  // async boundary for WASM
  experiments: { asyncWebAssembly: true },
  plugins: [
    new ModuleFederationPlugin({
      name: 'ifcViewerPlugin',
      filename: 'remoteEntry.js',
      exposes: {
        './IfcViewerChartPlugin': './src/index.ts',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18' },
        'react-dom': { singleton: true, requiredVersion: '^18' },
        '@superset-ui/core': { singleton: true },
        '@superset-ui/chart-controls': { singleton: true },
      },
    }),
  ],
};
```

Superset config:

```python
# superset_config.py
DYNAMIC_PLUGINS = {
    "ifc_viewer": {
        "url": "https://cdn.example.com/ifc-viewer-plugin/remoteEntry.js",
        "scope": "ifcViewerPlugin",
        "module": "./IfcViewerChartPlugin",
    }
}
```

- **Zero Superset rebuild required** — deploy plugin assets to any CDN
- Independent release cycle from Superset
- Can configure WASM support independently (own `webpack.config.js`)
- The `.supx` system is newer and has less community documentation

**Best for:** SaaS / managed Superset deployments where you can't rebuild the frontend.

### Recommendation

Start with **Option B** (npm package) for maximum reach and well-tested patterns. Add **Option C** (`.supx`) as a second distribution channel once the plugin is stable. Option A only makes sense if contributing upstream to Apache Superset or maintaining a dedicated fork.

---

## 6. WebGPU / WASM Constraints & Solutions

### WebGPU

| Concern | Status | Action |
|---|---|---|
| Browser support | Chrome 113+, Firefox 141+, Safari 18+ | Detect and show fallback message |
| Superset restrictions | None — plugins have full DOM/API access | No changes needed |
| GPU context limits | Browsers limit concurrent contexts (~8-16) | Call `device.destroy()` on unmount |
| Canvas creation | Plugins control their own DOM subtree | Create `<canvas>` via React ref |

**Fallback strategy:** Detect `navigator.gpu` availability. If absent, render a static message: "WebGPU required. Please use Chrome 113+ or Safari 18+."

### WASM

| Concern | Status | Action |
|---|---|---|
| Webpack `asyncWebAssembly` | Not in Superset's default config | Use Module Federation (own config) or manual loading |
| CSP: `wasm-unsafe-eval` | Not in Superset's default CSP | Operators must add to `TALISMAN_CONFIG` |
| Bundle size | WASM binary is ~2-4MB | Lazy-load via `loadChart` pattern |
| Web Workers | CSP already allows `blob:` workers | Use `new Worker(new URL(...))` syntax |

**CSP configuration required by operators:**

```python
# superset_config.py — add wasm-unsafe-eval
TALISMAN_CONFIG = {
    "content_security_policy": {
        "script-src": ["'self'", "'strict-dynamic'", "'wasm-unsafe-eval'"],
        "worker-src": ["'self'", "blob:"],
        # ... other directives unchanged
    },
    "content_security_policy_nonce_in": ["script-src"],
}
```

### WASM Loading Strategy

Three options in order of preference:

1. **Module Federation (Option C distribution):** Plugin has its own `webpack.config.js` with `experiments: { asyncWebAssembly: true }`. WASM is bundled and loaded automatically through the federation boundary.

2. **Manual loading (works with any distribution):** Serve the WASM binary as a static asset and load it at runtime:
   ```typescript
   const wasmUrl = new URL('web-ifc.wasm', import.meta.url);
   const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
   ```

3. **Base64-inlined (last resort):** Inline the WASM as a base64 data URL. Avoids all fetch/CSP issues but doubles the binary size.

---

## 7. Cross-Filtering Integration

Cross-filtering is Superset's system for charts to filter each other. The deck.gl plugin already implements this pattern.

### How It Works

1. User clicks an IFC entity in the 3D viewer
2. Plugin calls `hooks.setDataMask()` with a filter
3. Superset applies that filter to all other charts on the dashboard
4. Other charts re-query with the filter applied

### Implementation

```typescript
// In transformProps.ts — receive the setDataMask hook
const { setDataMask } = chartProps.hooks;

// In IFCViewerChart.tsx — on entity click
const handleEntityClick = (entityId: string) => {
  setDataMask({
    extraFormData: {
      filters: [{
        col: entityIdColumn,  // e.g., "global_id"
        op: '==',
        val: entityId,
      }],
    },
    filterState: {
      value: entityId,
      label: `IFC Entity: ${entityId}`,
    },
  });
};

// Clear filter on empty click
const handleBackgroundClick = () => {
  setDataMask({
    extraFormData: { filters: [] },
    filterState: { value: null },
  });
};
```

### Bidirectional Filtering

When *other* charts filter down to specific entities, the IFC viewer should respond:

```typescript
// In transformProps.ts — check for incoming filters
const filteredEntityIds = chartProps.filterState?.value
  ? new Set([chartProps.filterState.value])
  : null;

// In IFCViewerChart.tsx — use isolatedIds to show only filtered entities
renderer.render({
  isolatedIds: filteredEntityIds, // Only show these entities (null = show all)
});
```

### Use Case Example

A dashboard with:
- **IFC Viewer** showing a building model
- **Bar chart** showing cost per element type (IfcWall, IfcSlab, etc.)
- **Table** listing element properties

Click a wall in the 3D viewer → bar chart highlights wall costs → table filters to wall properties. Click "IfcSlab" in the bar chart → 3D viewer isolates slabs.

---

## 8. Performance Considerations

### Model Loading

IFC files can be 200MB+ with millions of triangles. In a Superset dashboard context:

1. **Cache aggressively:** Once a model is loaded, cache the geometry in memory. Only reload when the model URL changes (use `useRef` to track loaded URL).

2. **Stream progressively:** Use `GeometryProcessor.processAdaptive()` which yields mesh batches. Render each batch immediately so users see geometry appear progressively.

3. **Avoid re-parsing on filter changes:** Superset re-renders charts when filters change. The model geometry should be stable across re-renders — only colors/visibility should update.

4. **Web Worker parsing:** For very large files, move parsing to a Web Worker to avoid blocking the Superset UI:
   ```typescript
   const worker = new Worker(new URL('./parser.worker.ts', import.meta.url));
   worker.postMessage({ buffer }, [buffer]); // Transfer, don't copy
   ```

### Render Performance

1. **Instanced rendering:** After streaming completes, call `renderer.convertToInstanced()` to deduplicate geometry and use GPU instancing.

2. **Frustum culling:** Enable `enableFrustumCulling: true` in render options.

3. **Throttle re-renders:** Don't render on every React update. Use `requestAnimationFrame` and dirty-flagging.

4. **Entity color updates:** When Superset data changes (new metric values), only update the color buffer — don't reload geometry.

### Memory Management

1. **Single model limit in dashboard:** Recommend loading one model per chart widget to avoid GPU memory exhaustion.

2. **Cleanup on unmount:** The `useEffect` cleanup must destroy the `GPUDevice`, terminate workers, and cancel animation frames. This is critical because Superset tabs lazy-mount/unmount charts.

3. **WASM memory:** The `web-ifc` WASM module allocates its own linear memory. Ensure `GeometryProcessor` releases references after processing.

---

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| No WebGPU support in user's browser | Plugin non-functional | Medium (declining) | Feature-detect `navigator.gpu`; show clear error message with browser requirements |
| CSP blocks WASM | WASM won't compile | High (if operator doesn't configure) | Document CSP changes prominently; detect and surface as error |
| Large bundle slows initial Superset load | Bad UX for all Superset users | Low | `loadChart` lazy-loading ensures bundle is only loaded on demand |
| GPU context exhaustion (many charts) | Rendering breaks | Medium | `device.destroy()` on unmount; limit to 2-3 viewer widgets per dashboard |
| WASM binary not found / wrong path | Parser fails | Medium | Use `import.meta.url` for reliable path resolution; add integrity check |
| Memory pressure from large IFC files | Browser tab crashes | Medium | Set file size limits; show warnings for >100MB files; stream geometry |
| Module Federation version conflicts | React crashes | Low | Pin `react`, `react-dom`, `@superset-ui/core` as shared singletons |
| Superset upgrades break plugin API | Plugin stops working | Medium | Pin to `@superset-ui/core` version ranges; test against Superset releases |
| Cross-filter data mismatch | Filters don't work | Medium | Validate entity ID column types match between IFC and dataset |

---

## 10. Implementation Roadmap

### Phase 1: Minimal Viable Plugin

**Goal:** Render an IFC model inside a Superset dashboard from a static URL.

- Scaffold the plugin package with `@superset-ui/core` dependencies
- Implement `controlPanel.ts` with static model URL input
- Implement `IFCViewerChart.tsx` with renderer lifecycle (init, load, render, cleanup)
- Implement `loadChart` lazy loading
- Handle WebGPU detection and error states
- Handle WASM loading (manual `fetch` approach for portability)
- Test in a local Superset dev environment

**Deliverable:** A chart type that renders a 3D IFC model from a configured URL.

### Phase 2: Data-Driven Coloring

**Goal:** Color IFC entities based on Superset query results.

- Implement `buildQuery.ts` to query entity IDs and metric values
- Implement `transformProps.ts` to build entity→color maps
- Extend Renderer API to accept per-entity color overrides
- Implement `controlPanel.ts` entity ID column and metric selectors
- Add color scheme selection using `@superset-ui/core` color scales

**Deliverable:** Entities colored by a database metric (e.g., cost, energy rating, status).

### Phase 3: Cross-Filtering

**Goal:** Bidirectional cross-filtering between IFC viewer and other dashboard charts.

- Implement click-to-filter via `setDataMask` hook
- Implement incoming filter handling (isolate filtered entities)
- Handle clear-filter on background click
- Test with bar charts, tables, and filters

**Deliverable:** Click a wall → other charts filter to that wall's properties; click a bar chart category → 3D isolates those entities.

### Phase 4: Production Hardening

**Goal:** Production-ready plugin for large models and diverse deployments.

- Add Web Worker parsing for large files
- Implement model caching (don't re-parse on Superset re-renders)
- Add loading progress indicators
- Add `.supx` Module Federation distribution
- Write comprehensive docs (CSP config, browser requirements, dataset setup)
- Performance profiling with 100MB+ models
- Publish to npm as `@ifc-lite/superset-plugin-chart-ifc-viewer`

**Deliverable:** Published npm package and `.supx` bundle ready for production Superset deployments.

---

## Appendix A: Precedent — deck.gl Plugin Architecture

The `legacy-preset-chart-deckgl` plugin is the closest architectural precedent. Key patterns to follow:

1. **GPU context lifecycle:** Capture WebGL context ref; release via `loseContext()` on unmount. For WebGPU, use `device.destroy()`.

2. **Canvas management:** deck.gl creates its own canvas internally. Our plugin should create a canvas via React ref and pass it to `Renderer`.

3. **Rate-limited updates:** deck.gl throttles viewport updates to 250ms intervals. Our plugin should similarly throttle re-renders when Superset props change rapidly.

4. **Error boundaries:** Wrap the chart in an error boundary to prevent GPU errors from crashing the entire dashboard.

## Appendix B: Dataset Schema Example

For a Superset dataset powering the IFC viewer:

```sql
-- Example table structure
CREATE TABLE building_elements (
    global_id VARCHAR(22) PRIMARY KEY,  -- IFC GlobalId (matches entities in the model)
    element_type VARCHAR(50),           -- IfcWall, IfcSlab, etc.
    model_url TEXT,                     -- URL to the IFC file
    cost DECIMAL(10,2),                 -- Metric: construction cost
    energy_rating VARCHAR(1),           -- Metric: energy class (A, B, C...)
    floor_name VARCHAR(50),             -- Spatial: which floor
    zone VARCHAR(50),                   -- Spatial: which zone
    status VARCHAR(20)                  -- Lifecycle: planned, built, demolished
);
```

Dashboard query examples:
- **Color by cost:** `SELECT global_id, SUM(cost) FROM building_elements GROUP BY global_id`
- **Color by status:** `SELECT global_id, status FROM building_elements GROUP BY global_id`
- **Filter by floor:** `SELECT global_id, cost FROM building_elements WHERE floor_name = '2nd Floor'`

## Appendix C: ifc-lite Package Dependency Graph

```
superset-plugin-chart-ifc-viewer
├── @ifc-lite/renderer    (WebGPU rendering, camera, picking)
│   └── @ifc-lite/geometry (not a direct dep — data flows via MeshData)
├── @ifc-lite/geometry    (IFC → mesh processing, WASM bridge)
│   └── web-ifc (WASM)   (C++ IFC geometry kernel)
├── @ifc-lite/parser      (IFC file parsing, properties)
├── @superset-ui/core     (shared singleton)
└── @superset-ui/chart-controls (shared singleton)
```
