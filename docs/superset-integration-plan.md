# Superset BIM Analytics Integration — Full Implementation Plan

## Executive Summary

This document outlines the complete plan to transform ifc-lite from a client-side IFC viewer into
a full BIM analytics platform by integrating Apache Superset. The architecture leverages the
**existing Rust server** (deployed on Railway) as the bridge between the client-side viewer and
Superset, requiring minimal new infrastructure.

**Key Insight:** The Rust server already extracts a complete `DataModel` (entities, properties,
quantities, relationships, spatial hierarchy) from every IFC file it processes. We only need to
add one new capability: writing that data to PostgreSQL so Superset can query it.

### What Exists Today

| Component | Status | Location |
|---|---|---|
| IFC parser (Rust core + WASM) | Production | `rust/core`, `packages/geometry` |
| WebGPU renderer | Production | `packages/renderer` |
| Client-side viewer (Vercel) | Production | `apps/viewer` |
| Rust server (Railway-ready) | Built, not deployed | `apps/server` |
| Server client library | Production | `packages/server-client` |
| Superset chart plugin | Working prototype | `packages/superset-plugin` |
| Data model extraction | Production | `apps/server/src/services/data_model.rs` |
| DuckDB in-browser SQL | Production | `packages/query` |
| Export formats (CSV, Parquet, GLTF, STEP, JSON-LD) | Production | `packages/export` |
| PostgreSQL integration | **Not started** | — |
| Superset deployment | **Not started** | — |
| Auto-dashboard generation | **Not started** | — |
| Embedded SDK integration | **Not started** | — |

### Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Client-Side Viewer (Vercel)                     │
│                                                                    │
│  ┌─────────────────┐   ┌──────────────────────────────────────┐   │
│  │  Mode A: WASM   │   │  Mode B: Server-Connected            │   │
│  │  (no server)    │   │  ┌──────────────────────────────┐    │   │
│  │  • Drop IFC     │   │  │  "Send to Analytics" button  │    │   │
│  │  • Parse local  │   │  │  → triggers publish endpoint │    │   │
│  │  • Full viewer  │   │  └──────────────────────────────┘    │   │
│  └─────────────────┘   │  ┌──────────────────────────────┐    │   │
│                         │  │  Embedded Dashboard Panel    │    │   │
│                         │  │  (Superset Embedded SDK)     │    │   │
│                         │  └──────────────────────────────┘    │   │
│                         └──────────────────────────────────────┘   │
└──────────────────────────┬────────────────────────────────────────┘
                           │  IfcServerClient
                           │  (packages/server-client)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Rust Server (Railway)                          │
│                                                                    │
│  EXISTING ENDPOINTS:                                               │
│  POST /api/v1/parse/parquet-stream  → geometry + data model       │
│  POST /api/v1/parse/parquet         → geometry + data model       │
│  GET  /api/v1/parse/data-model/:key → cached DataModel            │
│  GET  /api/v1/cache/check/:hash     → cache check                 │
│                                                                    │
│  NEW ENDPOINTS:                                                    │
│  POST /api/v1/analytics/publish/:cache_key                        │
│       → writes DataModel to PostgreSQL                             │
│       → registers Superset dataset                                 │
│       → creates default dashboard                                  │
│       → returns { dashboardUrl, datasetId }                        │
│                                                                    │
│  GET  /api/v1/analytics/status/:cache_key                         │
│       → check publish status                                       │
│                                                                    │
│  GET  /api/v1/analytics/dashboard/:cache_key                      │
│       → get dashboard URL for published model                      │
│                                                                    │
└──────────────────────────┬────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────────┐  ┌──────────────────────────────────────┐
│  PostgreSQL          │  │  Apache Superset (Railway)            │
│  (Railway add-on)    │  │                                       │
│                      │  │  • IFC Viewer plugin installed        │
│  Schema: bim_data    │◄─│  • Embedded SDK enabled               │
│  • model_entities    │  │  • Cross-filtering enabled            │
│  • model_properties  │  │  • REST API for auto-dashboard       │
│  • model_quantities  │  │                                       │
│  • model_relations   │  │  Guest token endpoint for embedding  │
│  • model_spatial     │  │                                       │
│                      │  └──────────────────────────────────────┘
│  Schema: superset    │
│  (Superset metadata) │
└──────────────────────┘
```

---

## Phase 0: Infrastructure Deployment

**Goal:** Get the existing server and supporting services running on Railway.

### 0.1 Deploy Rust Server to Railway

**What exists:** `apps/server/railway.toml`, `apps/server/Dockerfile` (multi-stage build).

**Steps:**
1. Create Railway project via CLI or dashboard
2. Connect GitHub repo, set root directory to project root
3. Railway auto-detects `railway.toml` and `Dockerfile`
4. Set environment variables:
   ```
   PORT=8080
   CORS_ORIGINS=https://ifc-lite.vercel.app,http://localhost:5173
   CACHE_DIR=/app/cache
   MAX_FILE_SIZE_MB=500
   WORKER_THREADS=4
   ```
5. Deploy and verify health check at `/api/v1/health`

**Config reference:** `apps/server/src/config.rs` loads all settings from env vars with sensible defaults.

**Estimated effort:** 1 day

### 0.2 Add PostgreSQL on Railway

**Steps:**
1. Add PostgreSQL add-on in Railway dashboard (one click)
2. Railway auto-provisions and sets `DATABASE_URL` env var
3. Create two schemas:
   - `bim_data` — IFC entity/property data (our tables)
   - `superset` — Superset metadata (managed by Superset)
4. Add `DATABASE_URL` to Rust server service env

**Estimated effort:** 1 hour

### 0.3 Deploy Apache Superset on Railway

**What exists:** Railway has an official Superset template at `railway.com/template/c0hqeB`.

**Steps:**
1. Fork/customize the Railway Superset template
2. Point it at the same PostgreSQL instance (separate `superset` schema)
3. Configure `superset_config.py`:
   ```python
   # Feature flags
   FEATURE_FLAGS = {
       "EMBEDDED_SUPERSET": True,
       "DASHBOARD_CROSS_FILTERS": True,
       "ENABLE_TEMPLATE_PROCESSING": True,
   }
   
   # Guest token for embedded dashboards
   GUEST_TOKEN_JWT_SECRET = "<strong-secret>"
   GUEST_ROLE_NAME = "Public"
   
   # CORS for embedded usage
   ENABLE_CORS = True
   CORS_OPTIONS = {
       "supports_credentials": True,
       "allow_headers": ["*"],
       "resources": ["/api/*"],
       "origins": ["https://ifc-lite.vercel.app", "http://localhost:5173"],
   }
   
   # Disable CSP in dev, configure properly in prod
   TALISMAN_ENABLED = False  # Dev only
   
   # Connect to shared PostgreSQL for BIM data
   SQLALCHEMY_DATABASE_URI = "postgresql://user:pass@host:5432/superset_schema"
   ```
4. Install IFC Viewer plugin into Superset build:
   - Copy compiled `packages/superset-plugin/dist/` into Superset frontend
   - Register in `MainPreset.ts`
   - Or use Module Federation (webpack remote) — `packages/superset-plugin/webpack.config.js` already supports this
5. Register the BIM data database as an additional database connection in Superset

**Estimated effort:** 2-3 days (most time in Superset config/plugin installation)

---

## Phase 1: PostgreSQL Data Pipeline

**Goal:** Add the ability to write extracted `DataModel` to PostgreSQL.

### 1.1 Database Schema Design

The schema maps directly to the Rust server's `DataModel` struct (defined in
`apps/server/src/services/data_model.rs`). This is also nearly identical to
the DuckDB tables created in `packages/query/src/duckdb-integration.ts`.

```sql
-- ============================================================
-- Schema: bim_data
-- ============================================================

CREATE SCHEMA IF NOT EXISTS bim_data;

-- Master table tracking published models
CREATE TABLE bim_data.models (
    model_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key       VARCHAR(64) UNIQUE NOT NULL,  -- SHA-256 hash
    file_name       VARCHAR(255),
    schema_version  VARCHAR(20),    -- IFC2X3, IFC4, IFC4X3
    entity_count    INTEGER,
    geometry_count  INTEGER,
    published_at    TIMESTAMPTZ DEFAULT NOW(),
    superset_dataset_id INTEGER,     -- Superset dataset FK
    superset_dashboard_id INTEGER,   -- Superset dashboard FK
    model_url       TEXT             -- Object storage URL (if applicable)
);

-- Entity metadata (maps to DataModel.entities / EntityMetadata)
CREATE TABLE bim_data.entities (
    model_id        UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    express_id      INTEGER NOT NULL,
    ifc_type        VARCHAR(100) NOT NULL,
    global_id       VARCHAR(36),
    name            VARCHAR(255),
    has_geometry    BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (model_id, express_id)
);

CREATE INDEX idx_entities_type ON bim_data.entities(model_id, ifc_type);
CREATE INDEX idx_entities_global_id ON bim_data.entities(model_id, global_id);

-- Flattened properties (maps to DataModel.property_sets -> flattened)
CREATE TABLE bim_data.properties (
    model_id        UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    pset_id         INTEGER NOT NULL,
    pset_name       VARCHAR(255) NOT NULL,
    property_name   VARCHAR(255) NOT NULL,
    property_type   VARCHAR(50),     -- "string", "number", "integer", "unknown"
    property_value  TEXT             -- JSON-encoded value
);

CREATE INDEX idx_properties_pset ON bim_data.properties(model_id, pset_id);

-- Flattened quantities (maps to DataModel.quantity_sets -> flattened)
CREATE TABLE bim_data.quantities (
    model_id        UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    qset_id         INTEGER NOT NULL,
    qset_name       VARCHAR(255) NOT NULL,
    quantity_name   VARCHAR(255) NOT NULL,
    quantity_type   VARCHAR(50),     -- "length", "area", "volume", "count", "weight", "time"
    quantity_value  DOUBLE PRECISION NOT NULL
);

CREATE INDEX idx_quantities_qset ON bim_data.quantities(model_id, qset_id);

-- Relationships (maps to DataModel.relationships)
CREATE TABLE bim_data.relationships (
    model_id        UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    rel_type        VARCHAR(100) NOT NULL,
    relating_id     INTEGER NOT NULL,
    related_id      INTEGER NOT NULL
);

CREATE INDEX idx_relationships_type ON bim_data.relationships(model_id, rel_type);

-- Spatial hierarchy nodes (maps to DataModel.spatial_hierarchy.nodes)
CREATE TABLE bim_data.spatial_nodes (
    model_id        UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    entity_id       INTEGER NOT NULL,
    parent_id       INTEGER,
    level           SMALLINT NOT NULL,
    path            TEXT NOT NULL,
    type_name       VARCHAR(100) NOT NULL,
    name            VARCHAR(255),
    elevation       DOUBLE PRECISION,
    PRIMARY KEY (model_id, entity_id)
);

-- Element-to-spatial containment (maps to spatial_hierarchy.element_to_*)
CREATE TABLE bim_data.spatial_containment (
    model_id        UUID NOT NULL REFERENCES bim_data.models(model_id) ON DELETE CASCADE,
    element_id      INTEGER NOT NULL,
    storey_id       INTEGER,
    building_id     INTEGER,
    site_id         INTEGER,
    space_id        INTEGER
);

CREATE INDEX idx_containment_storey ON bim_data.spatial_containment(model_id, storey_id);

-- ============================================================
-- Convenience Views for Superset Datasets
-- ============================================================

-- Flat entity view with storey name (most common query pattern)
CREATE VIEW bim_data.entity_summary AS
SELECT
    e.model_id,
    e.express_id,
    e.ifc_type,
    e.global_id,
    e.name AS entity_name,
    e.has_geometry,
    sn.name AS storey_name,
    sn.elevation AS storey_elevation
FROM bim_data.entities e
LEFT JOIN bim_data.spatial_containment sc
    ON e.model_id = sc.model_id AND e.express_id = sc.element_id
LEFT JOIN bim_data.spatial_nodes sn
    ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id;

-- Entity with quantities (for takeoff dashboards)
CREATE VIEW bim_data.entity_quantities AS
SELECT
    e.model_id,
    e.express_id,
    e.ifc_type,
    e.name AS entity_name,
    sn.name AS storey_name,
    r.related_id AS entity_id,
    q.qset_name,
    q.quantity_name,
    q.quantity_type,
    q.quantity_value
FROM bim_data.entities e
JOIN bim_data.relationships r
    ON e.model_id = r.model_id
    AND r.rel_type = 'IfcRelDefinesByProperties'
    AND r.related_id = e.express_id
JOIN bim_data.quantities q
    ON e.model_id = q.model_id AND r.relating_id = q.qset_id
LEFT JOIN bim_data.spatial_containment sc
    ON e.model_id = sc.model_id AND e.express_id = sc.element_id
LEFT JOIN bim_data.spatial_nodes sn
    ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id;
```

### 1.2 Rust Server Changes — Add sqlx + PostgreSQL

**New dependency in `apps/server/Cargo.toml`:**
```toml
# PostgreSQL (async, with TLS for Railway)
sqlx = { version = "0.8", features = ["runtime-tokio", "tls-rustls", "postgres", "uuid", "time"] }
uuid = { version = "1", features = ["v4"] }
```

**New config fields in `apps/server/src/config.rs`:**
```rust
pub struct Config {
    // ... existing fields ...
    pub database_url: Option<String>,       // DATABASE_URL env var
    pub superset_url: Option<String>,       // SUPERSET_URL env var
    pub superset_username: Option<String>,  // SUPERSET_ADMIN_USERNAME
    pub superset_password: Option<String>,  // SUPERSET_ADMIN_PASSWORD
}
```

**New AppState field:**
```rust
pub struct AppState {
    pub cache: Arc<DiskCache>,
    pub config: Arc<Config>,
    pub db_pool: Option<Arc<PgPool>>,  // None if DATABASE_URL not set
}
```

This keeps the server fully functional without PostgreSQL — the analytics endpoints
simply return 503 if `db_pool` is `None`.

### 1.3 New Service: `apps/server/src/services/analytics.rs`

**Core function — write DataModel to PostgreSQL:**

```rust
pub async fn publish_to_postgres(
    pool: &PgPool,
    cache_key: &str,
    data_model: &DataModel,
    metadata: &ModelMetadata,
    file_name: Option<&str>,
) -> Result<Uuid, AnalyticsError> {
    // 1. Insert into models table, get model_id
    // 2. Bulk insert entities using UNNEST (batch of arrays)
    // 3. Bulk insert flattened properties
    // 4. Bulk insert flattened quantities
    // 5. Bulk insert relationships
    // 6. Bulk insert spatial nodes
    // 7. Bulk insert spatial containment
    // Return model_id
}
```

**Bulk insert pattern (using UNNEST for performance):**

```rust
// Example: bulk insert entities
let entity_ids: Vec<i32> = data_model.entities.iter().map(|e| e.entity_id as i32).collect();
let type_names: Vec<&str> = data_model.entities.iter().map(|e| e.type_name.as_str()).collect();
let global_ids: Vec<Option<&str>> = data_model.entities.iter().map(|e| e.global_id.as_deref()).collect();
let names: Vec<Option<&str>> = data_model.entities.iter().map(|e| e.name.as_deref()).collect();
let has_geom: Vec<bool> = data_model.entities.iter().map(|e| e.has_geometry).collect();

sqlx::query(r#"
    INSERT INTO bim_data.entities (model_id, express_id, ifc_type, global_id, name, has_geometry)
    SELECT $1, * FROM UNNEST($2::INT[], $3::VARCHAR[], $4::VARCHAR[], $5::VARCHAR[], $6::BOOL[])
"#)
.bind(model_id)
.bind(&entity_ids)
.bind(&type_names)
.bind(&global_ids)
.bind(&names)
.bind(&has_geom)
.execute(pool)
.await?;
```

### 1.4 New Route: `POST /api/v1/analytics/publish/:cache_key`

**Flow:**
1. Look up cached `DataModel` via `{cache_key}-datamodel-v2`
2. If not cached, return 404 ("Parse the file first")
3. Check if already published (query `bim_data.models` by `cache_key`)
4. If already published, return existing `{ model_id, dashboard_url }`
5. Write DataModel to PostgreSQL (Phase 1.3)
6. Call Superset API to create dataset + dashboard (Phase 2)
7. Update `models` row with `superset_dataset_id` and `superset_dashboard_id`
8. Return `{ model_id, dataset_id, dashboard_id, dashboard_url }`

### 1.5 Data Model Source Mapping

This table shows exactly how the Rust `DataModel` maps to PostgreSQL tables:

| Rust Type | Rust Field | Postgres Table | Postgres Column |
|---|---|---|---|
| `EntityMetadata` | `entity_id` | `entities` | `express_id` |
| `EntityMetadata` | `type_name` | `entities` | `ifc_type` |
| `EntityMetadata` | `global_id` | `entities` | `global_id` |
| `EntityMetadata` | `name` | `entities` | `name` |
| `EntityMetadata` | `has_geometry` | `entities` | `has_geometry` |
| `PropertySet` | `pset_id` | `properties` | `pset_id` |
| `PropertySet` | `pset_name` | `properties` | `pset_name` |
| `Property` | `property_name` | `properties` | `property_name` |
| `Property` | `property_type` | `properties` | `property_type` |
| `Property` | `property_value` | `properties` | `property_value` |
| `QuantitySet` | `qset_id` | `quantities` | `qset_id` |
| `QuantitySet` | `qset_name` | `quantities` | `qset_name` |
| `Quantity` | `quantity_name` | `quantities` | `quantity_name` |
| `Quantity` | `quantity_type` | `quantities` | `quantity_type` |
| `Quantity` | `quantity_value` | `quantities` | `quantity_value` |
| `Relationship` | `rel_type` | `relationships` | `rel_type` |
| `Relationship` | `relating_id` | `relationships` | `relating_id` |
| `Relationship` | `related_id` | `relationships` | `related_id` |
| `SpatialNode` | `entity_id` | `spatial_nodes` | `entity_id` |
| `SpatialNode` | `parent_id` | `spatial_nodes` | `parent_id` |
| `SpatialNode` | `level` | `spatial_nodes` | `level` |
| `SpatialNode` | `path` | `spatial_nodes` | `path` |
| `SpatialNode` | `type_name` | `spatial_nodes` | `type_name` |
| `SpatialNode` | `name` | `spatial_nodes` | `name` |
| `SpatialNode` | `elevation` | `spatial_nodes` | `elevation` |
| `SpatialHierarchyData` | `element_to_storey` | `spatial_containment` | `(element_id, storey_id)` |
| `SpatialHierarchyData` | `element_to_building` | `spatial_containment` | `(element_id, building_id)` |

**Estimated effort:** 1-2 weeks

---

## Phase 2: Superset Auto-Dashboard Generation

**Goal:** Automatically create Superset datasets and dashboards when a model is published.

### 2.1 Superset API Client (Rust)

New service: `apps/server/src/services/superset_api.rs`

**Authentication flow:**
```
POST {superset_url}/api/v1/security/login
Body: { "username": "admin", "password": "..." }
Response: { "access_token": "jwt-token" }
```

**Dataset creation (virtual dataset via SQL):**
```
POST {superset_url}/api/v1/dataset/
Headers: Authorization: Bearer {token}
Body: {
    "database": 1,                    // BIM data database ID
    "schema": "bim_data",
    "table_name": "model_{uuid}_view",
    "sql": "SELECT e.express_id, ... FROM bim_data.entities e ... WHERE e.model_id = '{uuid}'",
    "owners": [1]
}
```

**Chart creation:**
```
POST {superset_url}/api/v1/chart/
Headers: Authorization: Bearer {token}
Body: {
    "slice_name": "3D Viewer - {model_name}",
    "viz_type": "ifc_viewer",
    "datasource_id": {dataset_id},
    "datasource_type": "table",
    "params": "{\"static_model_url\": \"...\", \"entity_id_column\": \"express_id\", ...}"
}
```

**Dashboard creation:**
```
POST {superset_url}/api/v1/dashboard/
Headers: Authorization: Bearer {token}
Body: {
    "dashboard_title": "BIM Dashboard: {model_name}",
    "position_json": "{ ... chart layout ... }",
    "json_metadata": "{ \"cross_filters_enabled\": true }"
}
```

### 2.2 Dashboard Template Engine

Detect model type from entity distribution and generate appropriate charts:

```rust
fn detect_model_type(data_model: &DataModel) -> ModelType {
    let type_counts: HashMap<&str, usize> = data_model.entities.iter()
        .fold(HashMap::new(), |mut acc, e| {
            *acc.entry(e.type_name.as_str()).or_default() += 1;
            acc
        });
    
    let has_walls = type_counts.contains_key("IfcWall") || type_counts.contains_key("IfcWallStandardCase");
    let has_beams = type_counts.contains_key("IfcBeam");
    let has_columns = type_counts.contains_key("IfcColumn");
    let has_mep = type_counts.contains_key("IfcFlowSegment") || type_counts.contains_key("IfcDistributionElement");
    
    if has_mep { ModelType::MEP }
    else if has_beams && has_columns && !has_walls { ModelType::Structural }
    else { ModelType::Architectural }
}
```

**Dashboard templates per model type:**

| Chart | Architectural | Structural | MEP |
|---|---|---|---|
| 3D Viewer (IFC plugin) | Yes | Yes | Yes |
| Element Type Breakdown (Pie) | Yes | Yes | Yes |
| Storey Distribution (Bar) | Yes | Yes | Yes |
| Area Takeoff (Table) | Yes | — | — |
| Volume Takeoff (Table) | — | Yes | — |
| System Breakdown (Pie) | — | — | Yes |
| Property Browser (Table) | Yes | Yes | Yes |

### 2.3 Chart SQL Queries (per template)

**Element Type Breakdown:**
```sql
SELECT ifc_type, COUNT(*) as count
FROM bim_data.entities
WHERE model_id = '{uuid}' AND has_geometry = true
GROUP BY ifc_type
ORDER BY count DESC
```

**Storey Distribution:**
```sql
SELECT sn.name as storey, COUNT(*) as element_count
FROM bim_data.spatial_containment sc
JOIN bim_data.spatial_nodes sn
    ON sc.model_id = sn.model_id AND sc.storey_id = sn.entity_id
WHERE sc.model_id = '{uuid}' AND sc.storey_id IS NOT NULL
GROUP BY sn.name, sn.elevation
ORDER BY sn.elevation
```

**Quantity Takeoff (areas):**
```sql
SELECT
    e.ifc_type,
    sn.name AS storey,
    q.quantity_name,
    SUM(q.quantity_value) AS total_value,
    q.quantity_type
FROM bim_data.quantities q
JOIN bim_data.relationships r
    ON q.model_id = r.model_id AND q.qset_id = r.relating_id
JOIN bim_data.entities e
    ON q.model_id = e.model_id AND r.related_id = e.express_id
LEFT JOIN bim_data.spatial_containment sc
    ON e.model_id = sc.model_id AND e.express_id = sc.element_id
LEFT JOIN bim_data.spatial_nodes sn
    ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id
WHERE q.model_id = '{uuid}' AND q.quantity_type = 'area'
GROUP BY e.ifc_type, sn.name, q.quantity_name, q.quantity_type
ORDER BY total_value DESC
```

**Estimated effort:** 1-2 weeks

---

## Phase 3: Viewer Integration

**Goal:** Add server connection UI and embedded analytics to the viewer.

### 3.1 Server Settings UI

Currently, server configuration is environment-variable only (`VITE_IFC_SERVER_URL`).
Add a settings panel where users can:

- Enter server URL (or use pre-configured hosted server)
- See connection status (green/yellow/red indicator)
- Toggle between WASM-only and server-connected modes

**New store slice: `serverSlice.ts`**
```typescript
interface ServerSlice {
    serverUrl: string;           // From env var or user input
    isServerConnected: boolean;  // Health check passed
    isAnalyticsAvailable: boolean; // Server has analytics enabled
    publishedModels: Map<string, PublishedModel>; // cache_key -> dashboard info
    setServerUrl: (url: string) => void;
    checkConnection: () => Promise<void>;
    publishModel: (cacheKey: string) => Promise<PublishedModel>;
}

interface PublishedModel {
    modelId: string;
    datasetId: number;
    dashboardId: number;
    dashboardUrl: string;
    publishedAt: number;
}
```

### 3.2 "Send to Analytics" Button

After a model is loaded via server, show a button in the toolbar:

```
[📊 Send to Analytics]
```

**Flow:**
1. User clicks "Send to Analytics"
2. Client calls `POST /api/v1/analytics/publish/{cache_key}` via `IfcServerClient`
3. Show progress indicator (writing data, creating dashboard...)
4. On success, show "Open Dashboard" button or embed directly

**New method in `packages/server-client/src/client.ts`:**
```typescript
async publishToAnalytics(cacheKey: string, fileName?: string): Promise<PublishResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/analytics/publish/${cacheKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: fileName }),
    });
    return response.json();
}
```

### 3.3 Embedded Dashboard Panel

Use `@superset-ui/embedded-sdk` to show the auto-generated dashboard inside the viewer.

**New component: `AnalyticsPanel.tsx`**
```typescript
import { embedDashboard } from '@superset-ui/embedded-sdk';

const AnalyticsPanel: React.FC<{ dashboardId: string }> = ({ dashboardId }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        if (!containerRef.current || !dashboardId) return;
        
        embedDashboard({
            id: dashboardId,
            supersetDomain: SUPERSET_URL,
            mountPoint: containerRef.current,
            fetchGuestToken: () => fetchGuestToken(dashboardId),
            dashboardUiConfig: {
                hideTitle: true,
                filters: { visible: true, expanded: false },
            },
        });
    }, [dashboardId]);
    
    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};
```

**Guest token flow:**
- Viewer calls backend endpoint: `GET /api/v1/analytics/guest-token/{dashboard_id}`
- Backend calls Superset: `POST /api/v1/security/guest_token/`
- Returns JWT guest token to viewer
- Embedded SDK uses token for iframe authentication

### 3.4 Cross-Filtering Between Viewer and Embedded Dashboard

The Superset plugin already emits cross-filters via `setDataMask` (lines 96-134 of
`IFCViewerChart.tsx`). When embedded:

1. User clicks entity in the IFC Viewer chart → filter emitted
2. All other charts in the embedded dashboard filter to that entity
3. User clicks a bar in a chart → IFC Viewer receives `filteredEntityIds`
4. Viewer shows only those entities (isolation mode)

This works **out of the box** because cross-filtering is handled by Superset's
dashboard container, not by individual charts.

**Estimated effort:** 2-3 weeks

---

## Phase 4: Developer Power Features

### 4.1 SQL Lab Access

- Superset's SQL Lab is available by default for authenticated users
- The BIM data database is already registered
- Add a "Open in SQL Lab" link from the viewer

### 4.2 REST API Documentation

Document the analytics API for programmatic use:

```
POST /api/v1/analytics/publish/:cache_key
GET  /api/v1/analytics/status/:cache_key
GET  /api/v1/analytics/dashboard/:cache_key
GET  /api/v1/analytics/guest-token/:dashboard_id
```

### 4.3 Cross-Model Comparison

Allow creating datasets that join entities across multiple published models:

```sql
-- Compare two models
SELECT
    a.ifc_type,
    SUM(qa.quantity_value) AS design_area,
    SUM(qb.quantity_value) AS asbuilt_area
FROM bim_data.entity_quantities a
JOIN bim_data.entity_quantities b
    ON a.global_id = b.global_id
    AND a.model_id = '{design_uuid}'
    AND b.model_id = '{asbuilt_uuid}'
GROUP BY a.ifc_type
```

**Estimated effort:** 1-2 weeks

---

## Phase 5: Natural Language & Smart Insights

### 5.1 Auto-Generated Insights

After publishing, run pre-defined insight queries:

```sql
-- Model summary
SELECT ifc_type, COUNT(*) FROM bim_data.entities WHERE model_id = ? GROUP BY ifc_type;

-- Missing fire rating check
SELECT COUNT(*) FROM bim_data.entities e
WHERE e.model_id = ? AND e.ifc_type IN ('IfcWall', 'IfcWallStandardCase')
AND NOT EXISTS (
    SELECT 1 FROM bim_data.properties p
    JOIN bim_data.relationships r ON p.model_id = r.model_id AND p.pset_id = r.relating_id
    WHERE r.related_id = e.express_id AND r.model_id = e.model_id
    AND p.pset_name = 'Pset_WallCommon' AND p.property_name = 'FireRating'
);

-- Total floor area
SELECT SUM(q.quantity_value) FROM bim_data.quantities q
WHERE q.model_id = ? AND q.quantity_name = 'GrossFloorArea';
```

### 5.2 Natural Language Query Interface

Add an LLM-powered text input that generates SQL from natural language:

```
User: "Which walls on floor 2 have no fire rating?"

System prompt: Given these tables... generate a SQL query.

Generated SQL → Execute → Return results → Highlight in 3D viewer
```

**Estimated effort:** 2-3 weeks

---

## Effort Summary

| Phase | Description | New Code Location | Effort |
|---|---|---|---|
| **0.1** | Deploy Rust server | Config only | 1 day |
| **0.2** | Add PostgreSQL | Railway dashboard | 1 hour |
| **0.3** | Deploy Superset | Railway + config | 2-3 days |
| **1.1** | Database schema | SQL migration | 1 day |
| **1.2** | sqlx integration | `apps/server/Cargo.toml`, `config.rs` | 2 days |
| **1.3** | Analytics service | `apps/server/src/services/analytics.rs` | 1 week |
| **1.4** | Publish endpoint | `apps/server/src/routes/analytics.rs` | 3 days |
| **2.1** | Superset API client | `apps/server/src/services/superset_api.rs` | 1 week |
| **2.2** | Dashboard templates | `apps/server/src/services/dashboard_templates.rs` | 3 days |
| **3.1** | Server settings UI | `apps/viewer/src/store/slices/serverSlice.ts` | 2 days |
| **3.2** | Send to Analytics | `apps/viewer/src/components/viewer/MainToolbar.tsx` | 2 days |
| **3.3** | Embedded dashboard | `apps/viewer/src/components/viewer/AnalyticsPanel.tsx` | 1 week |
| **3.4** | Cross-filtering | Already works (Superset native) | Verification only |
| **4** | Developer features | Docs + small API additions | 1 week |
| **5** | NL queries + insights | New service + UI | 2-3 weeks |
| | **Total** | | **~8-12 weeks** |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Superset plugin installation complexity | Medium | High | Module Federation avoids rebuilding Superset |
| Railway resource limits (memory/CPU) | Low | Medium | Monitor, upgrade tier if needed |
| Superset API undocumented fields | Medium | Medium | Inspect browser network traffic for payload format |
| Large model publish time (>100k entities) | Medium | Low | Async publish with status polling |
| CORS/CSP issues with embedding | Medium | Medium | Careful Superset config, test early |
| Guest token security | Low | High | Short-lived tokens, RLS in Superset |

---

## Success Criteria

1. **Phase 0 complete:** Server responds at Railway URL, Superset accessible
2. **Phase 1 complete:** Upload IFC via viewer → data appears in PostgreSQL → queryable in SQL Lab
3. **Phase 2 complete:** Dashboard auto-generated with 3D viewer + charts, cross-filtering works
4. **Phase 3 complete:** Non-technical user can upload IFC and see embedded dashboard in viewer
5. **Phase 4 complete:** Developers can write SQL, use API, compare models
6. **Phase 5 complete:** Users can ask questions in English, get highlighted answers in 3D

---

*Document created: 2026-02-06*
*Status: Implementation Planning*
*Based on: Full codebase analysis of ifc-lite repository*
