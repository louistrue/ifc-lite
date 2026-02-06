# Server Analytics Architecture — Technical Reference

## Overview

This document provides the deep technical reference for integrating the ifc-lite Rust server
with PostgreSQL and Apache Superset. It covers the existing server architecture, the exact
data structures that flow through the system, and the precise changes needed at each layer.

---

## Part 1: Existing Server Architecture

### Request Flow (Current)

```
Client                          Server                           Cache
  │                               │                                │
  │  POST /parse/parquet-stream   │                                │
  │──────────────────────────────▶│                                │
  │                               │  compute SHA-256 hash          │
  │                               │  check cache ──────────────────▶│
  │                               │◀─── cache miss ────────────────│
  │                               │                                │
  │                               │  ┌─────────────────────────┐   │
  │                               │  │ Rayon Thread Pool        │   │
  │                               │  │                          │   │
  │                               │  │ 1. build_entity_index()  │   │
  │                               │  │ 2. build_style_indices() │   │
  │                               │  │ 3. process geometry      │   │
  │                               │  │    (parallel batches)    │   │
  │                               │  │ 4. serialize to Parquet  │   │
  │                               │  └─────────────────────────┘   │
  │                               │                                │
  │  SSE: start                   │                                │
  │◀──────────────────────────────│                                │
  │  SSE: batch (Parquet/base64)  │                                │
  │◀──────────────────────────────│                                │
  │  SSE: batch ...               │                                │
  │◀──────────────────────────────│                                │
  │  SSE: complete                │                                │
  │◀──────────────────────────────│                                │
  │                               │                                │
  │                               │  ┌─────────────────────────┐   │
  │                               │  │ Background Task          │   │
  │                               │  │ extract_data_model()     │   │
  │                               │  │ serialize to Parquet     │   │
  │                               │  │ cache as {key}-datamodel │   │
  │                               │  └─────────────────────────┘   │
  │                               │                                │
  │  GET /parse/data-model/{key}  │                                │
  │──────────────────────────────▶│  fetch from cache ─────────────▶│
  │◀──────────────────────────────│◀── Parquet binary ─────────────│
```

### Cache Key Structure

| Key Pattern | Contents | Format |
|---|---|---|
| `{sha256}` | Full JSON parse response | JSON |
| `{sha256}-parquet-v2` | Geometry Parquet binary | Binary |
| `{sha256}-parquet-metadata-v2` | Model metadata | JSON |
| `{sha256}-datamodel-v2` | DataModel Parquet | Binary |

### DataModel Extraction (Existing)

The `extract_data_model()` function in `apps/server/src/services/data_model.rs` runs
in a background task after streaming completes. It produces:

```rust
DataModel {
    entities: Vec<EntityMetadata>,        // ~all entities in file
    property_sets: Vec<PropertySet>,      // IfcPropertySet + properties
    quantity_sets: Vec<QuantitySet>,      // IfcElementQuantity + quantities
    relationships: Vec<Relationship>,     // All relationship types
    spatial_hierarchy: SpatialHierarchyData, // Tree + containment maps
}
```

**Performance characteristics (from production data):**
- 10k entity file: ~50ms extraction
- 100k entity file: ~500ms extraction
- Parallel via `rayon::join` — entities, properties, quantities, relationships
  extracted concurrently

---

## Part 2: New Analytics Pipeline

### Request Flow (New)

```
Client                          Server                    PostgreSQL         Superset
  │                               │                          │                  │
  │  User clicks "Send to         │                          │                  │
  │  Analytics" after model load  │                          │                  │
  │                               │                          │                  │
  │  POST /analytics/publish/{key}│                          │                  │
  │──────────────────────────────▶│                          │                  │
  │                               │                          │                  │
  │                               │  1. Fetch DataModel      │                  │
  │                               │     from cache           │                  │
  │                               │     ({key}-datamodel-v2) │                  │
  │                               │                          │                  │
  │                               │  2. Check if already     │                  │
  │                               │     published            │                  │
  │                               │─────────────────────────▶│                  │
  │                               │◀── not found ────────────│                  │
  │                               │                          │                  │
  │                               │  3. Write DataModel      │                  │
  │                               │     to PostgreSQL        │                  │
  │                               │─── INSERT entities ─────▶│                  │
  │                               │─── INSERT properties ───▶│                  │
  │                               │─── INSERT quantities ───▶│                  │
  │                               │─── INSERT relationships ▶│                  │
  │                               │─── INSERT spatial ──────▶│                  │
  │                               │                          │                  │
  │                               │  4. Create Superset      │                  │
  │                               │     resources            │                  │
  │                               │──── POST /dataset/ ──────────────────────▶│
  │                               │◀─── { dataset_id } ─────────────────────│
  │                               │──── POST /chart/ (x4-5) ────────────────▶│
  │                               │◀─── { chart_ids } ──────────────────────│
  │                               │──── POST /dashboard/ ───────────────────▶│
  │                               │◀─── { dashboard_id } ───────────────────│
  │                               │                          │                  │
  │                               │  5. Update models table  │                  │
  │                               │─── UPDATE models ───────▶│                  │
  │                               │                          │                  │
  │  Response:                    │                          │                  │
  │  { dashboardUrl, datasetId }  │                          │                  │
  │◀──────────────────────────────│                          │                  │
```

### New Rust Modules

```
apps/server/src/
├── routes/
│   ├── parse.rs          (existing)
│   ├── cache.rs          (existing)
│   ├── health.rs         (existing)
│   └── analytics.rs      (NEW — publish, status, guest-token endpoints)
├── services/
│   ├── processor.rs      (existing)
│   ├── streaming.rs      (existing)
│   ├── data_model.rs     (existing)
│   ├── cache.rs          (existing)
│   ├── parquet.rs        (existing)
│   ├── analytics.rs      (NEW — PostgreSQL write logic)
│   └── superset_api.rs   (NEW — Superset REST API client)
├── config.rs             (MODIFIED — add DATABASE_URL, SUPERSET_URL)
├── main.rs               (MODIFIED — add PgPool, new routes)
└── types.rs              (MODIFIED — add PublishResponse, etc.)
```

### New Dependencies (Cargo.toml additions)

```toml
# PostgreSQL
sqlx = { version = "0.8", features = [
    "runtime-tokio",
    "tls-rustls",
    "postgres",
    "uuid",
    "time",
    "migrate"     # For running schema migrations
] }
uuid = { version = "1", features = ["v4", "serde"] }

# HTTP client (for Superset API calls)
reqwest = { version = "0.12", features = [
    "json",
    "rustls-tls"
] }
```

### Graceful Degradation

The server must continue to work without PostgreSQL/Superset. The analytics
endpoints are **optional** — they return `503 Service Unavailable` if not configured:

```rust
// In main.rs
let db_pool = if let Some(database_url) = &config.database_url {
    match PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
    {
        Ok(pool) => {
            sqlx::migrate!("./migrations").run(&pool).await.ok();
            Some(Arc::new(pool))
        }
        Err(e) => {
            tracing::warn!("PostgreSQL unavailable: {e}. Analytics disabled.");
            None
        }
    }
} else {
    tracing::info!("DATABASE_URL not set. Analytics disabled.");
    None
};

let state = AppState {
    cache,
    config: Arc::new(config),
    db_pool,
};

// Analytics routes — always registered, gated internally
app.route("/api/v1/analytics/publish/:cache_key", post(routes::analytics::publish))
   .route("/api/v1/analytics/status/:cache_key", get(routes::analytics::status))
   .route("/api/v1/analytics/dashboard/:cache_key", get(routes::analytics::dashboard))
   .route("/api/v1/analytics/guest-token/:dashboard_id", get(routes::analytics::guest_token))
```

---

## Part 3: Bulk Insert Implementation

### Performance Targets

| Model Size | Entities | Properties | Quantities | Target Insert Time |
|---|---|---|---|---|
| Small (1MB) | ~500 | ~2,000 | ~1,000 | < 500ms |
| Medium (20MB) | ~10,000 | ~50,000 | ~20,000 | < 2s |
| Large (100MB) | ~50,000 | ~200,000 | ~100,000 | < 10s |
| Huge (500MB) | ~200,000 | ~1,000,000 | ~400,000 | < 30s |

### Insert Strategy: UNNEST Batch Arrays

Instead of individual INSERT statements, we collect all values into Rust `Vec`s
and use PostgreSQL's `UNNEST` to insert thousands of rows in a single statement.

**Entity insert:**

```rust
async fn insert_entities(
    pool: &PgPool,
    model_id: Uuid,
    entities: &[EntityMetadata],
) -> Result<(), sqlx::Error> {
    // Pre-allocate vectors (known size)
    let len = entities.len();
    let mut express_ids = Vec::with_capacity(len);
    let mut ifc_types = Vec::with_capacity(len);
    let mut global_ids: Vec<Option<String>> = Vec::with_capacity(len);
    let mut names: Vec<Option<String>> = Vec::with_capacity(len);
    let mut has_geometry_flags = Vec::with_capacity(len);
    
    for entity in entities {
        express_ids.push(entity.entity_id as i32);
        ifc_types.push(entity.type_name.clone());
        global_ids.push(entity.global_id.clone());
        names.push(entity.name.clone());
        has_geometry_flags.push(entity.has_geometry);
    }
    
    // Single round-trip for all entities
    sqlx::query(r#"
        INSERT INTO bim_data.entities
            (model_id, express_id, ifc_type, global_id, name, has_geometry)
        SELECT $1, * FROM UNNEST(
            $2::INT[],
            $3::VARCHAR[],
            $4::VARCHAR[],
            $5::VARCHAR[],
            $6::BOOL[]
        )
    "#)
    .bind(model_id)
    .bind(&express_ids)
    .bind(&ifc_types)
    .bind(&global_ids)
    .bind(&names)
    .bind(&has_geometry_flags)
    .execute(pool)
    .await?;
    
    Ok(())
}
```

**Property insert (flattened from PropertySets):**

```rust
async fn insert_properties(
    pool: &PgPool,
    model_id: Uuid,
    property_sets: &[PropertySet],
) -> Result<(), sqlx::Error> {
    // Flatten: each PropertySet has multiple Properties
    let total_props: usize = property_sets.iter().map(|ps| ps.properties.len()).sum();
    
    let mut pset_ids = Vec::with_capacity(total_props);
    let mut pset_names = Vec::with_capacity(total_props);
    let mut prop_names = Vec::with_capacity(total_props);
    let mut prop_types = Vec::with_capacity(total_props);
    let mut prop_values = Vec::with_capacity(total_props);
    
    for pset in property_sets {
        for prop in &pset.properties {
            pset_ids.push(pset.pset_id as i32);
            pset_names.push(pset.pset_name.clone());
            prop_names.push(prop.property_name.clone());
            prop_types.push(prop.property_type.clone());
            prop_values.push(prop.property_value.clone());
        }
    }
    
    // Batch by 10,000 rows to stay within PostgreSQL limits
    for chunk_start in (0..total_props).step_by(10_000) {
        let chunk_end = (chunk_start + 10_000).min(total_props);
        
        sqlx::query(r#"
            INSERT INTO bim_data.properties
                (model_id, pset_id, pset_name, property_name, property_type, property_value)
            SELECT $1, * FROM UNNEST(
                $2::INT[],
                $3::VARCHAR[],
                $4::VARCHAR[],
                $5::VARCHAR[],
                $6::TEXT[]
            )
        "#)
        .bind(model_id)
        .bind(&pset_ids[chunk_start..chunk_end])
        .bind(&pset_names[chunk_start..chunk_end])
        .bind(&prop_names[chunk_start..chunk_end])
        .bind(&prop_types[chunk_start..chunk_end])
        .bind(&prop_values[chunk_start..chunk_end])
        .execute(pool)
        .await?;
    }
    
    Ok(())
}
```

### Transaction Wrapper

All inserts for a single model wrapped in a transaction for atomicity:

```rust
pub async fn publish_model(
    pool: &PgPool,
    cache_key: &str,
    data_model: &DataModel,
    metadata: &ModelMetadata,
    file_name: Option<&str>,
) -> Result<Uuid, AnalyticsError> {
    let mut tx = pool.begin().await?;
    
    // 1. Create model record
    let model_id = Uuid::new_v4();
    sqlx::query(r#"
        INSERT INTO bim_data.models
            (model_id, cache_key, file_name, schema_version, entity_count, geometry_count)
        VALUES ($1, $2, $3, $4, $5, $6)
    "#)
    .bind(model_id)
    .bind(cache_key)
    .bind(file_name)
    .bind(&metadata.schema_version)
    .bind(metadata.entity_count as i32)
    .bind(metadata.geometry_entity_count as i32)
    .execute(&mut *tx)
    .await?;
    
    // 2. Insert all data (within same transaction)
    insert_entities(&mut *tx, model_id, &data_model.entities).await?;
    insert_properties(&mut *tx, model_id, &data_model.property_sets).await?;
    insert_quantities(&mut *tx, model_id, &data_model.quantity_sets).await?;
    insert_relationships(&mut *tx, model_id, &data_model.relationships).await?;
    insert_spatial_nodes(&mut *tx, model_id, &data_model.spatial_hierarchy).await?;
    insert_spatial_containment(&mut *tx, model_id, &data_model.spatial_hierarchy).await?;
    
    tx.commit().await?;
    
    Ok(model_id)
}
```

---

## Part 4: Superset API Integration

### Authentication

```rust
struct SupersetClient {
    base_url: String,
    access_token: Option<String>,
    http: reqwest::Client,
}

impl SupersetClient {
    async fn login(&mut self) -> Result<(), SupersetError> {
        let resp = self.http.post(format!("{}/api/v1/security/login", self.base_url))
            .json(&serde_json::json!({
                "username": self.username,
                "password": self.password,
                "provider": "db",
            }))
            .send().await?;
        
        let body: serde_json::Value = resp.json().await?;
        self.access_token = Some(body["access_token"].as_str().unwrap().to_string());
        Ok(())
    }
    
    fn auth_header(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(token) = &self.access_token {
            headers.insert("Authorization", format!("Bearer {}", token).parse().unwrap());
        }
        headers
    }
}
```

### Dataset Creation

```rust
async fn create_dataset(
    &self,
    database_id: i32,
    model_id: &Uuid,
    model_name: &str,
) -> Result<i32, SupersetError> {
    let sql = format!(r#"
        SELECT
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
            ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id
        WHERE e.model_id = '{}'
    "#, model_id);
    
    let resp = self.http.post(format!("{}/api/v1/dataset/", self.base_url))
        .headers(self.auth_header())
        .json(&serde_json::json!({
            "database": database_id,
            "schema": "bim_data",
            "table_name": format!("model_{}", model_id.to_string().replace('-', "_")),
            "sql": sql,
            "owners": [1],
        }))
        .send().await?;
    
    let body: serde_json::Value = resp.json().await?;
    Ok(body["id"].as_i64().unwrap() as i32)
}
```

### Chart Creation

```rust
async fn create_chart(
    &self,
    chart_config: &ChartConfig,
) -> Result<i32, SupersetError> {
    let resp = self.http.post(format!("{}/api/v1/chart/", self.base_url))
        .headers(self.auth_header())
        .json(&serde_json::json!({
            "slice_name": chart_config.name,
            "viz_type": chart_config.viz_type,
            "datasource_id": chart_config.dataset_id,
            "datasource_type": "table",
            "params": serde_json::to_string(&chart_config.params)?,
        }))
        .send().await?;
    
    let body: serde_json::Value = resp.json().await?;
    Ok(body["id"].as_i64().unwrap() as i32)
}
```

### Dashboard Layout Format

Superset dashboards use a grid layout system:

```json
{
    "DASHBOARD_VERSION_KEY": "v2",
    "ROOT_ID": {
        "type": "ROOT",
        "id": "ROOT_ID",
        "children": ["GRID_ID"]
    },
    "GRID_ID": {
        "type": "GRID",
        "id": "GRID_ID",
        "children": ["ROW-1", "ROW-2"],
        "parents": ["ROOT_ID"]
    },
    "ROW-1": {
        "type": "ROW",
        "id": "ROW-1",
        "children": ["CHART-viewer", "CHART-type-pie"],
        "parents": ["ROOT_ID", "GRID_ID"],
        "meta": { "background": "BACKGROUND_TRANSPARENT" }
    },
    "CHART-viewer": {
        "type": "CHART",
        "id": "CHART-viewer",
        "children": [],
        "parents": ["ROOT_ID", "GRID_ID", "ROW-1"],
        "meta": {
            "width": 8,
            "height": 50,
            "chartId": 42,
            "sliceName": "3D Viewer"
        }
    },
    "CHART-type-pie": {
        "type": "CHART",
        "id": "CHART-type-pie",
        "children": [],
        "parents": ["ROOT_ID", "GRID_ID", "ROW-1"],
        "meta": {
            "width": 4,
            "height": 50,
            "chartId": 43,
            "sliceName": "Element Types"
        }
    }
}
```

### Guest Token for Embedding

```rust
async fn create_guest_token(
    &self,
    dashboard_id: i32,
    rls_rules: Vec<RlsRule>,
) -> Result<String, SupersetError> {
    let resp = self.http.post(format!("{}/api/v1/security/guest_token/", self.base_url))
        .headers(self.auth_header())
        .json(&serde_json::json!({
            "user": {
                "username": "guest",
                "first_name": "Guest",
                "last_name": "User",
            },
            "resources": [{
                "type": "dashboard",
                "id": dashboard_id.to_string(),
            }],
            "rls": rls_rules,
        }))
        .send().await?;
    
    let body: serde_json::Value = resp.json().await?;
    Ok(body["token"].as_str().unwrap().to_string())
}
```

---

## Part 5: Client-Side Integration

### Server Client Extension

New methods in `packages/server-client/src/client.ts`:

```typescript
interface PublishResponse {
    model_id: string;
    dataset_id: number;
    dashboard_id: number;
    dashboard_url: string;
    status: 'created' | 'already_exists';
}

interface AnalyticsStatus {
    status: 'not_published' | 'publishing' | 'published' | 'failed';
    dashboard_url?: string;
    error?: string;
}

// New methods on IfcServerClient:

async publishToAnalytics(
    cacheKey: string,
    fileName?: string
): Promise<PublishResponse>;

async getAnalyticsStatus(
    cacheKey: string
): Promise<AnalyticsStatus>;

async getGuestToken(
    dashboardId: number
): Promise<string>;
```

### Viewer Store Extension

New slice: `apps/viewer/src/store/slices/analyticsSlice.ts`

```typescript
interface AnalyticsSlice {
    // State
    analyticsAvailable: boolean;     // Server has analytics enabled
    publishStatus: 'idle' | 'publishing' | 'published' | 'error';
    publishError: string | null;
    publishedDashboard: {
        dashboardId: number;
        dashboardUrl: string;
        modelId: string;
    } | null;
    
    // Actions
    checkAnalyticsAvailable: () => Promise<void>;
    publishCurrentModel: () => Promise<void>;
    clearAnalytics: () => void;
}
```

### Component Hierarchy

```
MainToolbar
├── [existing buttons]
├── ServerIndicator              (NEW - connection status dot)
└── SendToAnalyticsButton        (NEW - visible when server connected + model loaded)
    └── onClick → publishCurrentModel()

ViewerLayout
├── [existing panels]
└── AnalyticsPanel               (NEW - right panel or modal)
    ├── AnalyticsPanel.Header    (dashboard title, close button)
    └── SupersetEmbed            (embedded dashboard via SDK)
        └── fetchGuestToken → IfcServerClient.getGuestToken()
```

### Embedded Dashboard Component

```typescript
// apps/viewer/src/components/viewer/AnalyticsPanel.tsx

import { embedDashboard } from '@superset-ui/embedded-sdk';

interface AnalyticsPanelProps {
    dashboardId: string;
    supersetUrl: string;
    onClose: () => void;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
    dashboardId,
    supersetUrl,
    onClose,
}) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const serverClient = useServerClient();
    
    useEffect(() => {
        if (!mountRef.current || !dashboardId) return;
        
        const embed = embedDashboard({
            id: dashboardId,
            supersetDomain: supersetUrl,
            mountPoint: mountRef.current,
            fetchGuestToken: async () => {
                return serverClient.getGuestToken(parseInt(dashboardId));
            },
            dashboardUiConfig: {
                hideTitle: true,
                hideTab: true,
                hideChartControls: false,
                filters: {
                    visible: true,
                    expanded: false,
                },
                urlParams: {},
            },
        });
        
        return () => {
            // Cleanup: remove iframe
            if (mountRef.current) {
                mountRef.current.innerHTML = '';
            }
        };
    }, [dashboardId, supersetUrl]);
    
    return (
        <div className="analytics-panel">
            <div className="analytics-panel-header">
                <h3>BIM Analytics</h3>
                <button onClick={onClose}>Close</button>
            </div>
            <div ref={mountRef} className="analytics-panel-content" />
        </div>
    );
};
```

---

## Part 6: Superset Plugin Enhancements

### Current Cross-Filter Capability

The plugin already supports bidirectional cross-filtering:

**Outgoing (3D → Charts):**
```typescript
// IFCViewerChart.tsx, line 96-134
const handleClick = useCallback(async (e) => {
    const result = await renderer.pick(x, y);
    if (result) {
        setDataMask({
            extraFormData: {
                filters: [{ col: entityIdColumn, op: '==', val: String(result.expressId) }]
            },
            filterState: { value: String(result.expressId) }
        });
    }
}, [enablePicking, setDataMask, entityIdColumn]);
```

**Incoming (Charts → 3D):**
```typescript
// transformProps.ts
// Reads filterState.value from incoming cross-filters
// Converts to Set<string> → filteredEntityIds prop
// Renderer isolates only these entities
```

### Needed Enhancements

**1. Per-entity color override support:**
Currently, the color map is built but not applied (TODO in line 76-78 of `IFCViewerChart.tsx`).
The renderer needs to support setting colors per-entity from the metric data.

**2. Tooltip on hover:**
Show entity name + metric value when hovering over an entity in the 3D viewer.

**3. Multi-select cross-filter:**
Currently only single-entity filtering. Add Shift+Click for multi-select:
```typescript
setDataMask({
    extraFormData: {
        filters: [{ col: entityIdColumn, op: 'IN', val: selectedIds }]
    },
    filterState: { value: selectedIds }
});
```

**4. Filter by storey (from entity summary dataset):**
Allow filtering by `storey_name` column when entities are clicked, so clicking a wall
on Floor 2 filters all charts to Floor 2.

---

## Part 7: Environment Variables Reference

### Rust Server (all optional for backwards compatibility)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `CORS_ORIGINS` | `localhost:3000,localhost:5173` | Allowed origins |
| `CACHE_DIR` | Auto-detect | Cache storage path |
| `MAX_FILE_SIZE_MB` | `500` | Max upload size |
| `WORKER_THREADS` | CPU count | Rayon thread count |
| `DATABASE_URL` | *(none)* | PostgreSQL connection string |
| `SUPERSET_URL` | *(none)* | Superset base URL |
| `SUPERSET_ADMIN_USERNAME` | *(none)* | Superset admin user |
| `SUPERSET_ADMIN_PASSWORD` | *(none)* | Superset admin password |
| `SUPERSET_DATABASE_ID` | *(none)* | BIM data database ID in Superset |

### Viewer (Vite env vars)

| Variable | Default | Description |
|---|---|---|
| `VITE_IFC_SERVER_URL` | *(none)* | Server URL (enables server mode) |
| `VITE_USE_SERVER` | `true` (if URL set) | Disable server even if URL set |
| `VITE_SUPERSET_URL` | *(none)* | Superset URL (for embedded dashboards) |

### Superset (superset_config.py)

| Setting | Value | Purpose |
|---|---|---|
| `FEATURE_FLAGS["EMBEDDED_SUPERSET"]` | `True` | Enable embedded SDK |
| `FEATURE_FLAGS["DASHBOARD_CROSS_FILTERS"]` | `True` | Enable cross-filtering |
| `GUEST_TOKEN_JWT_SECRET` | Strong secret | Guest token signing |
| `GUEST_ROLE_NAME` | `"Public"` | Role for embedded guests |
| `TALISMAN_ENABLED` | `False` (dev) | CSP policy |
| `ENABLE_CORS` | `True` | Allow cross-origin requests |

---

## Part 8: Migration Strategy

### Database Migrations

Use sqlx's built-in migration system. Create migration files in
`apps/server/migrations/`:

```
migrations/
├── 001_create_bim_schema.sql
├── 002_create_models_table.sql
├── 003_create_entity_tables.sql
├── 004_create_convenience_views.sql
└── 005_create_indexes.sql
```

Migrations run automatically on server startup when `DATABASE_URL` is set.

### Backwards Compatibility

**Server:** No breaking changes. All new endpoints are additive. Existing
endpoints remain unchanged. Analytics functionality is gated behind
`DATABASE_URL` env var.

**Viewer:** No breaking changes. "Send to Analytics" button only appears
when server is connected and analytics is available. Pure WASM mode
unaffected.

**Superset Plugin:** No changes needed for basic integration. Plugin already
supports cross-filtering. Color overlay and tooltip enhancements are
separate, non-breaking additions.

---

## Part 9: Testing Strategy

### Server Tests

```rust
#[cfg(test)]
mod tests {
    // Unit tests for analytics service
    #[tokio::test]
    async fn test_publish_model_creates_all_tables() { ... }
    
    #[tokio::test]
    async fn test_publish_idempotent() { ... }
    
    #[tokio::test]
    async fn test_publish_without_database_returns_503() { ... }
    
    // Integration test with testcontainers
    #[tokio::test]
    async fn test_full_publish_flow() {
        // 1. Parse test IFC file
        // 2. Publish to test PostgreSQL
        // 3. Verify all tables populated
        // 4. Verify row counts match DataModel
    }
}
```

### Viewer Tests

```typescript
// Test analytics slice
describe('analyticsSlice', () => {
    test('publishCurrentModel sends correct cache key', async () => { ... });
    test('analytics unavailable when server disconnected', () => { ... });
    test('published dashboard URL stored correctly', () => { ... });
});
```

### End-to-End Test

```typescript
// Playwright test
test('upload IFC and publish to analytics', async ({ page }) => {
    // 1. Navigate to viewer with server configured
    // 2. Upload test IFC file
    // 3. Wait for model to load
    // 4. Click "Send to Analytics"
    // 5. Verify embedded dashboard appears
    // 6. Click entity in 3D viewer
    // 7. Verify cross-filter updates charts
});
```

---

*Document created: 2026-02-06*
*Status: Technical Reference*
*Based on: Complete source analysis of apps/server, apps/viewer, packages/superset-plugin,
packages/server-client, packages/query, packages/data, packages/export, packages/parser*
