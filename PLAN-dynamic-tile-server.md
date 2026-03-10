# Plan: Dynamic Tile API Server

> Goal: Add on-demand 3D Tiles 1.1 serving to the existing Rust server (`apps/server`), so clients can fetch `tileset.json` and individual tile GLBs via HTTP — without pre-generating all tiles upfront. The current static TS-based tile generation (`packages/3d-tiles`) remains untouched and fully functional.

---

## Architecture Overview

```
Client (CesiumJS / Three.js / any 3D Tiles viewer)
  │
  ├── GET /api/v1/tiles/{model_key}/tileset.json        ← tileset manifest
  ├── GET /api/v1/tiles/{model_key}/{zone}/{class}.glb   ← zone×class tile
  ├── GET /api/v1/tiles/{model_key}/zones.json           ← zone reference (optional)
  └── GET /api/v1/tiles/federated/tileset.json           ← multi-model root
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  ifc-lite-server (Axum)                             │
│                                                     │
│  Existing endpoints (unchanged):                    │
│    POST /api/v1/parse/*                             │
│    GET  /api/v1/cache/*                             │
│                                                     │
│  New tile endpoints:                                │
│    GET /api/v1/tiles/...                            │
│                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ TileRouter │→ │ ZoneAssigner │→ │ GlbBuilder │  │
│  └────────────┘  └──────────────┘  └────────────┘  │
│         │                │                │         │
│         ▼                ▼                ▼         │
│  ┌─────────────────────────────────────────────┐    │
│  │          DiskCache (cacache)                │    │
│  │  {hash}-zones-v1        → zone reference   │    │
│  │  {hash}-tileset-v1      → tileset.json     │    │
│  │  {hash}-tile-{z}-{c}-v1 → individual GLBs  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1: Zone Reference Extraction (Rust)

**What**: Extract spatial zones from an already-parsed IFC model and cache them as a `ZoneReference` — the foundation for all zone-based tiling.

**Where**: `apps/server/src/services/zone_reference.rs` (new file)

### Types

```rust
/// A spatial zone derived from IFC spatial hierarchy.
/// Each zone maps to an IfcBuildingStorey (or Building/Site for coarser levels).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    pub id: String,              // e.g. "storey_42"
    pub name: String,            // e.g. "Level 1"
    pub zone_type: ZoneType,     // Storey | Building | Site
    pub depth: u32,              // 0=project, 1=site, 2=building, 3=storey
    pub parent_id: Option<String>,
    pub elevation: Option<f64>,  // meters
    pub z_min: f64,              // bottom of zone (meters)
    pub z_max: f64,              // top of zone (meters)
    pub express_id: u32,         // original IFC express ID
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ZoneType { Site, Building, Storey, Space }

/// Complete zone reference for a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneReference {
    pub model_hash: String,
    pub zones: Vec<Zone>,
    pub element_zone_map: HashMap<u32, String>,  // expressId → zone.id
    pub ifc_class_index: HashMap<String, Vec<u32>>, // "IfcWall" → [expressId, ...]
}
```

### Logic

1. **Reuse `data_model.rs` spatial hierarchy** — the server already extracts `SpatialHierarchy` with storey elevations, element-to-storey mappings, etc. We piggyback on that.
2. **Compute z_min/z_max per storey** — use storey elevations + heights (elevation[n+1] - elevation[n]). For the top storey, use bounding box of its elements.
3. **Build element→zone map** — from the existing `element_to_storey` map in `data_model.rs`. Elements not assigned to any storey get assigned by centroid z-coordinate fallback.
4. **Build IFC class index** — group expressIds by their `ifc_type` string. Already available from the entity scan in `processor.rs`.
5. **Cache as** `{hash}-zones-v1` → JSON serialized `ZoneReference`.

### Integration point

Add `extract_zone_reference()` to `services/mod.rs`. It can run:
- **Eagerly**: as a background task after any `/parse/*` request (like data_model caching)
- **Lazily**: on first tile request for a given model hash

Lazy is simpler and avoids wasted work. Eager is faster for the first tile request. **Recommend: lazy with caching** — extract on first `/tiles/` request, cache, subsequent requests are instant.

---

## Phase 2: Dynamic Tileset Generation (Rust)

**What**: Generate `tileset.json` on-demand from `ZoneReference`, describing the zone×class tile hierarchy.

**Where**: `apps/server/src/services/tileset_builder.rs` (new file)

### Tileset Structure

```
root (geometric error: 1000)
├── Level_0 (zone tile, geometric error: 100)
│   ├── Level_0/IfcWall.glb
│   ├── Level_0/IfcSlab.glb
│   ├── Level_0/IfcColumn.glb
│   └── Level_0/IfcWindow.glb
├── Level_1 (zone tile, geometric error: 100)
│   ├── Level_1/IfcWall.glb
│   └── Level_1/IfcSlab.glb
└── Exterior (zone tile — elements not in any storey)
    └── Exterior/IfcBuildingElementProxy.glb
```

Each zone tile has:
- `boundingVolume`: computed from z_min/z_max of the zone + XY extent of contained elements
- `refine: "ADD"` — children (IFC class tiles) add to the parent
- `children`: one child per IFC class with elements in this zone

Each IFC class child tile has:
- `content.uri`: `{zone_id}/{IfcClass}.glb`
- `boundingVolume`: tight AABB of elements in this (zone, class) pair
- No children (leaf node)

### Metadata Schema (3D Tiles 1.1)

Embedded in `tileset.json`:
```json
{
  "schema": {
    "id": "ifc-lite-zones",
    "classes": {
      "Zone": {
        "properties": {
          "name": { "type": "STRING" },
          "zoneType": { "type": "STRING" },
          "depth": { "type": "SCALAR", "componentType": "UINT32" },
          "elevation": { "type": "SCALAR", "componentType": "FLOAT64" }
        }
      },
      "IfcClassGroup": {
        "properties": {
          "ifcType": { "type": "STRING" },
          "elementCount": { "type": "SCALAR", "componentType": "UINT32" }
        }
      }
    }
  }
}
```

### Bounding volume computation

- Need mesh bounding boxes per element. Two options:
  - **(A) Compute during zone extraction** — requires geometry data, heavier
  - **(B) Store AABB per mesh in cache** — add to existing parquet geometry cache

  **Recommend (B)**: extend the existing parquet geometry cache to include per-mesh AABB (6 floats). This is a small addition to `parquet.rs` and makes tileset generation purely metadata-driven (no re-parsing geometry).

### Cache

- `{hash}-tileset-v1` → the generated `tileset.json` bytes
- Invalidated when zone reference changes (which it won't, since zones are deterministic from the IFC file hash)

---

## Phase 3: On-Demand GLB Tile Serving (Rust)

**What**: When a viewer requests `GET /tiles/{hash}/{zone}/{class}.glb`, extract just the meshes for that (zone, class) pair and pack them into a GLB.

**Where**: `apps/server/src/services/glb_builder.rs` (new file)

### Workflow

```
Request: GET /api/v1/tiles/{model_key}/Level_1/IfcWall.glb
                                │
    ┌───────────────────────────▼──────────────────────┐
    │ 1. Check tile cache: {hash}-tile-Level_1-IfcWall │
    │    → HIT: return cached GLB bytes                │
    │    → MISS: continue                              │
    ├──────────────────────────────────────────────────┤
    │ 2. Load ZoneReference from cache                 │
    │    → Get expressIds for zone "Level_1"           │
    │    → Intersect with expressIds for "IfcWall"     │
    │    → Result: [42, 87, 103, ...]                  │
    ├──────────────────────────────────────────────────┤
    │ 3. Load cached geometry (parquet)                │
    │    → Filter: only meshes where expressId ∈ set   │
    │    → This is a columnar read — fast              │
    ├──────────────────────────────────────────────────┤
    │ 4. Build GLB from filtered meshes                │
    │    → Pack positions/normals/indices into glTF 2.0│
    │    → Return binary GLB                           │
    ├──────────────────────────────────────────────────┤
    │ 5. Cache GLB: {hash}-tile-Level_1-IfcWall-v1    │
    │    (background task)                             │
    └──────────────────────────────────────────────────┘
```

### GLB Builder (Rust)

Port the essence of `tile-content-builder.ts` to Rust:

```rust
pub fn build_glb(meshes: &[MeshData]) -> Vec<u8> {
    // 1. Collect all positions, normals, indices into flat buffers
    // 2. Build glTF JSON (nodes, meshes, accessors, bufferViews)
    // 3. Pack as GLB: [header][json_chunk][bin_chunk]
    // 4. Return bytes
}
```

This is a straightforward binary format — ~150 lines of Rust. The glTF structure is simple since we don't need materials, textures, or animations. Just:
- One buffer with all vertex + index data
- One mesh per IFC element (with expressId in extras)
- Positions (f32), normals (f32), indices (u32)

### Selective Parquet Reading

The cached geometry parquet has a mesh table with `express_id` column. We can:
1. Read the mesh table parquet (small, has offsets)
2. Filter rows where `express_id ∈ target_set`
3. Read only the vertex/index ranges we need from the vertex/index parquet tables

This is the key efficiency win — we don't re-parse or re-process geometry. We just slice the cached columnar data.

### Cache Strategy

Individual tile GLBs are cached at `{hash}-tile-{zone_id}-{ifc_class}-v1`. This means:
- First request for a tile: ~50-200ms (parquet read + GLB pack)
- Subsequent requests: ~5ms (cache hit)
- All tiles for a model can be pre-warmed with a single background pass after the first tileset.json request

---

## Phase 4: HTTP Routes (Rust)

**Where**: `apps/server/src/routes/tiles.rs` (new file)

### Endpoints

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/v1/tiles/{model_key}/tileset.json` | Zone-based tileset manifest | `application/json` |
| `GET` | `/api/v1/tiles/{model_key}/{zone_id}/{ifc_class}.glb` | Individual tile content | `model/gltf-binary` |
| `GET` | `/api/v1/tiles/{model_key}/zones.json` | Zone reference (for debugging/clients) | `application/json` |
| `GET` | `/api/v1/tiles/federated/tileset.json?models=k1,k2,k3` | Federated root tileset | `application/json` |
| `POST` | `/api/v1/tiles/{model_key}/warm` | Pre-generate all tiles for a model | `202 Accepted` |

### Route Registration

```rust
// main.rs — add to existing router
.nest("/api/v1/tiles", routes::tiles::router())
```

### Key Behaviors

1. **`GET tileset.json`**
   - If zone reference not cached → extract from cached geometry + data model (lazy)
   - If model not parsed yet → return `404` with message "Model not processed. POST to /api/v1/parse first."
   - Includes `Cache-Control: public, max-age=3600` (tilesets are immutable per hash)

2. **`GET {zone}/{class}.glb`**
   - Standard 3D Tiles content request
   - Returns `Content-Type: model/gltf-binary`
   - Returns `404` if no elements exist for this (zone, class) pair
   - Returns `Cache-Control: public, max-age=86400` (tiles are immutable)

3. **`GET federated/tileset.json`**
   - Takes `?models=hash1,hash2,hash3` query parameter
   - Returns root tileset with external tileset references to each model
   - Each child references `../{hash}/tileset.json`

4. **`POST warm`**
   - Triggers background generation of all tile GLBs
   - Returns immediately with `202 Accepted`
   - Client can poll individual tile URLs to check readiness

### Error Handling

- Model not found (never parsed): `404`
- Zone or class not found in model: `404`
- Zone reference extraction fails: `500` with details
- Geometry cache missing (evicted): `410 Gone` — client should re-upload

---

## Phase 5: Per-Mesh AABB in Geometry Cache

**What**: Extend the parquet geometry format to include bounding boxes per mesh, so tileset.json generation doesn't require re-reading all vertex data.

**Where**: `apps/server/src/services/parquet.rs` (modify existing)

### Changes to Mesh Table Schema

Add 6 columns to the mesh parquet table:

```
Existing:  express_id, ifc_type, vertex_start, vertex_count, index_start, index_count, color_r/g/b/a
New:       bbox_min_x, bbox_min_y, bbox_min_z, bbox_max_x, bbox_max_y, bbox_max_z
```

Computed during geometry extraction (already iterating positions). Cost: negligible — just track min/max while building position arrays.

### Cache Version Bump

Change cache key suffix from `-parquet-v2` to `-parquet-v3` so old caches don't break. Old cached models will re-parse on next request (existing behavior for version bumps).

**Alternative**: Keep `-parquet-v2` working by treating missing AABB columns as "recompute from vertices". This avoids cache invalidation but adds complexity. **Recommend: version bump** — simpler, and cache is transient anyway.

---

## Phase 6: Federated Tile Serving

**What**: Serve a federated root tileset that references multiple model tilesets.

This is straightforward given Phase 4 already supports per-model tilesets:

```json
// GET /api/v1/tiles/federated/tileset.json?models=abc123,def456
{
  "asset": { "version": "1.1" },
  "geometricError": 1000,
  "root": {
    "boundingVolume": { "box": [/* union of all models */] },
    "geometricError": 1000,
    "refine": "ADD",
    "children": [
      {
        "boundingVolume": { "box": [/* model abc123 bounds */] },
        "geometricError": 500,
        "content": { "uri": "../abc123/tileset.json" }
      },
      {
        "boundingVolume": { "box": [/* model def456 bounds */] },
        "geometricError": 500,
        "content": { "uri": "../def456/tileset.json" }
      }
    ]
  }
}
```

No new Rust types needed — just JSON construction in the route handler.

---

## Implementation Order

```
Phase 5 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 6
  │          │          │          │          │          │
  │          │          │          │          │          └─ Federated (1 day)
  │          │          │          │          └─ HTTP routes (1-2 days)
  │          │          │          └─ GLB builder + selective parquet read (2-3 days)
  │          │          └─ Tileset JSON generation (1-2 days)
  │          └─ Zone reference extraction (2-3 days)
  └─ Per-mesh AABB in parquet (0.5 day) ← do first, small change
```

**Phase 5 first** because it's a small, isolated change to `parquet.rs` that adds AABB data we need later. Everything else builds on it.

---

## What Stays Unchanged

| Component | Status |
|-----------|--------|
| `packages/3d-tiles/` (TypeScript) | **Untouched** — static generation still works for offline/client-side use |
| `POST /api/v1/parse/*` endpoints | **Untouched** — still the primary ingestion path |
| `GET /api/v1/cache/*` endpoints | **Untouched** — still available for direct cache access |
| Parquet streaming format | **Extended** (AABB columns added), backward-compatible for clients that ignore extra columns |
| `DiskCache` | **Shared** — tile cache uses same cacache instance with new key patterns |
| `packages/parser/` (TypeScript) | **Untouched** — `SpatialHierarchyBuilder` remains for client-side use |

---

## Client Integration (Not In Scope, But Noted)

The dynamic tile API is consumed by any 3D Tiles 1.1 viewer. The workflow:

1. Client uploads IFC to `POST /api/v1/parse/parquet-stream` (existing)
2. Client gets back `cache_key` in the Start event (existing)
3. Client points viewer at `GET /api/v1/tiles/{cache_key}/tileset.json` (new)
4. Viewer fetches tiles on demand as camera moves (new endpoints serve GLBs)

This means **the viewer can choose**: use the current streaming approach (get all geometry at once) OR use the tiled approach (get geometry on demand by zone/class). Both paths start with the same upload.

---

## Open Questions / Decisions Needed

1. **Octree fallback**: Should models without spatial hierarchy (e.g., exported geometry without IfcBuildingStorey) fall back to geometric octree subdivision? Or return a flat tileset with one tile per IFC class?

2. **LOD / geometric error**: Should zone tiles have simplified LOD geometry at the zone level (like the TS ImplicitTilingGenerator does), or just use ADD refinement with no parent content? ADD is simpler and good enough for most BIM models.

3. **Tile warming strategy**: Should the server pre-generate all tiles in background after first `tileset.json` request? Or purely lazy (each tile generated on first request)?

4. **Maximum model size for tiling**: The current streaming parquet can handle 500MB IFC files. Should tiling have a separate limit? Large models benefit most from tiling but also take more cache space.
