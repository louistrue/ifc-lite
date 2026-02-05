# IFC Viewer Superset Plugin - Development Notes

## Summary

Successfully integrated the IFC 3D Viewer as a native Superset chart plugin. The plugin loads IFC models via URL and renders them using WebGPU, with full camera controls (orbit, pan, zoom).

## Issues Encountered & Solutions

### 1. Superset FormData Case Conversion

**Problem:** Control panel field names use `snake_case` (e.g., `static_model_url`), but Superset automatically converts them to `camelCase` in `formData` (e.g., `staticModelUrl`).

**Solution:** Updated `transformProps.ts`, `buildQuery.ts`, and `types.ts` to use camelCase property names:
```typescript
// Control panel defines: name: 'static_model_url'
// formData receives: fd.staticModelUrl
```

### 2. Content Security Policy (CSP) Blocking External URLs

**Problem:** Superset's CSP `connect-src` directive blocked fetching IFC models from external URLs (e.g., `raw.githubusercontent.com`).

**Solution:** Disabled Talisman CSP in development config (`docker/pythonpath_dev/superset_config.py`):
```python
TALISMAN_ENABLED = False  # Disable CSP in development
```

For production, configure specific allowed domains in `TALISMAN_CONFIG`.

### 3. Plugin Registration with @superset-ui/core

**Problem:** The plugin used vendored type stubs for standalone development, but these didn't properly integrate with Superset's plugin system.

**Solution:** Modified the compiled `dist/*.js` files to import from `@superset-ui/core` instead of vendored types:
```javascript
// Before: import { ChartPlugin } from './vendor/superset-types.js';
// After:  import { ChartPlugin } from '@superset-ui/core';
```

Also added required `thumbnail: ''` property to `ChartMetadata`.

### 4. Missing Camera Controls

**Problem:** The 3D model rendered but users couldn't navigate (orbit, pan, zoom).

**Solution:** Created `useCameraControls.ts` hook that wires pointer/wheel events to the renderer's camera:
- Left drag: Orbit
- Right/Middle drag or Shift+Left: Pan
- Mouse wheel: Zoom

### 5. TypeScript Type Mismatches

**Problem:** `ChartProps['formData']` conflicts with plugin's `IFCViewerFormData` interface.

**Solution:** Cast `formData` through `unknown` to the expected type:
```typescript
const fd = formData as unknown as IFCViewerFormData;
```

## Files Modified

| File | Changes |
|------|---------|
| `transformProps.ts` | Use camelCase, fix type casting |
| `buildQuery.ts` | Use camelCase field names |
| `types.ts` | Define `IFCViewerFormData` with camelCase |
| `IFCViewerChart.tsx` | Add camera control event handlers |
| `hooks/useCameraControls.ts` | New - orbit/pan/zoom implementation |
| `superset_config.py` | Disable CSP for development |

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Superset Frontend                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐    │
│  │           IFC Viewer Chart Plugin               │    │
│  ├─────────────────────────────────────────────────┤    │
│  │  controlPanel.ts  →  User configuration UI      │    │
│  │  buildQuery.ts    →  SQL query construction     │    │
│  │  transformProps   →  Data → Props mapping       │    │
│  │  IFCViewerChart   →  React component            │    │
│  ├─────────────────────────────────────────────────┤    │
│  │  Hooks:                                         │    │
│  │  - useIFCRenderer  (WebGPU lifecycle)           │    │
│  │  - useIFCLoader    (IFC fetch & parse)          │    │
│  │  - useCameraControls (orbit/pan/zoom)           │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │              @ifc-lite/renderer                  │    │
│  │  WebGPU 3D rendering, camera, picking           │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │              @ifc-lite/geometry                  │    │
│  │  IFC parsing, mesh generation (WASM)            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

# Future Vision: Reducing Friction for Users

## Goal: One-Click "Take Model to Superset"

Transform IFC file loading from a technical process into a seamless user experience.

## Proposed Architecture

### Phase 1: Hosted Model Storage + Auto-Dataset Creation

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  IFC File    │────▶│  Upload Service  │────▶│  Object Storage │
│  (User)      │     │  (Parse + Store) │     │  (S3/GCS/R2)    │
└──────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  Property        │
                     │  Extraction      │
                     │  (Alphanumeric)  │
                     └──────────────────┘
                              │
                              ▼
                     ┌──────────────────┐     ┌─────────────────┐
                     │  Dataset         │────▶│  Superset       │
                     │  Creation        │     │  Database       │
                     │  (PostgreSQL)    │     │  (Properties)   │
                     └──────────────────┘     └─────────────────┘
```

**User Flow:**
1. User uploads IFC file
2. Backend parses IFC, extracts all properties/quantities
3. Creates PostgreSQL table with entity data
4. Registers dataset in Superset automatically
5. Creates default IFC Viewer chart with model URL pre-configured
6. User lands on dashboard with 3D viewer ready

### Phase 2: Integrated BIM Analytics Dashboard

**Auto-Generated Dashboard Components:**

| Component | Data Source | Purpose |
|-----------|-------------|---------|
| 3D Viewer | Model URL | Visual navigation |
| Property Table | Entity properties | Browse attributes |
| Quantity Takeoff | Quantities | Areas, volumes, counts |
| Element Type Breakdown | IfcType | Pie/bar chart |
| Floor Plan Selector | IfcBuildingStorey | Filter by floor |
| Cross-Filters | All | Click element → filter tables |

### Phase 3: SaaS Multi-Tenant Platform

```
┌─────────────────────────────────────────────────────────────────┐
│                      IFC-Lite Cloud                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │   Tenant A   │   │   Tenant B   │   │      Tenant C        │ │
│  │   ────────   │   │   ────────   │   │      ────────        │ │
│  │  3 Projects  │   │  12 Projects │   │     1 Project        │ │
│  │  15 Models   │   │  48 Models   │   │     2 Models         │ │
│  └──────────────┘   └──────────────┘   └──────────────────────┘ │
│         │                  │                     │               │
│         └──────────────────┼─────────────────────┘               │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Shared Infrastructure                     ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  ││
│  │  │  Superset   │  │   Model     │  │    Property DB      │  ││
│  │  │  (Per-Org)  │  │   Storage   │  │    (Per-Tenant)     │  ││
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Technical Implementation Plan

### 1. Model Upload API
```typescript
POST /api/models/upload
Content-Type: multipart/form-data

Response:
{
  "modelId": "uuid",
  "modelUrl": "https://storage.ifc-lite.com/models/uuid.ifc",
  "datasetId": 42,
  "dashboardUrl": "/superset/dashboard/123"
}
```

### 2. Property Extraction Pipeline
```typescript
interface ExtractedProperties {
  entityId: string;        // GlobalId
  ifcType: string;         // e.g., "IfcWall"
  name: string;            // IfcRoot.Name
  description: string;     // IfcRoot.Description
  storey: string;          // Containing storey
  properties: Record<string, string | number>;  // Psets
  quantities: Record<string, number>;           // Qtos
}
```

### 3. Automatic Dataset Schema
```sql
CREATE TABLE model_{uuid}_entities (
  global_id VARCHAR(36) PRIMARY KEY,
  express_id INTEGER,
  ifc_type VARCHAR(100),
  name VARCHAR(255),
  description TEXT,
  storey VARCHAR(100),
  -- Dynamic property columns from Psets
  pset_common_fire_rating VARCHAR(50),
  pset_common_is_external BOOLEAN,
  -- Dynamic quantity columns from Qtos
  qto_base_quantities_gross_area NUMERIC,
  qto_base_quantities_net_volume NUMERIC,
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4. Dashboard Template
```python
# Auto-generated dashboard configuration
dashboard = {
    "dashboard_title": f"BIM Dashboard: {model_name}",
    "position_json": {
        "CHART-ifc-viewer": {"x": 0, "y": 0, "w": 8, "h": 6},
        "CHART-type-breakdown": {"x": 8, "y": 0, "w": 4, "h": 3},
        "CHART-quantity-summary": {"x": 8, "y": 3, "w": 4, "h": 3},
        "CHART-property-table": {"x": 0, "y": 6, "w": 12, "h": 4},
    }
}
```

## Pricing Model Ideas

| Tier | Models | Storage | Features |
|------|--------|---------|----------|
| Free | 3 | 100MB | Basic viewer, 1 user |
| Pro | 50 | 5GB | Full analytics, 5 users |
| Team | 500 | 50GB | API access, SSO, 25 users |
| Enterprise | Unlimited | Unlimited | Self-hosted, custom |

## Next Steps

1. **Immediate:** Fix remaining navigation/camera controls
2. **Short-term:** Build model upload API with property extraction
3. **Medium-term:** Auto-dashboard generation from uploaded models
4. **Long-term:** Multi-tenant SaaS platform with billing

---

*Document created: 2026-02-05*
*Status: Research & Planning*
