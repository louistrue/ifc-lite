# Agent Guidelines: ifc-lite

## 1. Mandatory Schema Compliance
- **Strict Nomenclature:** Use exact IFC EXPRESS names in user-facing APIs, scripting, and exports. Never invent simplified aliases.
- **Attributes:** Use IFC PascalCase (`GlobalId`, `Name`, `Description`, `ObjectType`, `Type`) as the default user-facing shape.
- **Relationships:** Use full IFC relationship entity names (e.g., `IfcRelAggregates`, **not** `Aggregates`).
- **Type Casing:** STEP entity names are stored as `UPPERCASE`. For display/API output, use `store.entities.getTypeName(id)` to return proper `IfcPascalCase`.

## 2. Critical Performance Patterns
- **On-Demand Extraction:** `extractEntityAttributesOnDemand` parses the source buffer and is expensive. **Never** call it in large loops; use cached `EntityNode` getters instead.
- **Federation-Aware IDs:** Always distinguish `localExpressId` from federated `globalId`; convert via `FederationRegistry` methods (`toGlobalId`, `fromGlobalId`, `getModelForGlobalId`), never ad-hoc math in UI code.

## 3. Mandatory Workflows
- **License Headers:** Every new source file must include the MPL-2.0 header documented in [`./LICENSE_HEADER.md`](./LICENSE_HEADER.md).
- **Changesets:** If changes affect published `packages/*`, add a changeset with `pnpm changeset`. Never manually edit package versions or `CHANGELOG.md`.
- **Generated Artifacts:** Do not edit generated WASM JS/TS declaration outputs in `packages/wasm/`; make source changes in Rust crates and regenerate.

## 4. Single-Model vs Federated-Model Correctness (Common Failure Mode)
- **Treat both modes as first-class:** Code must work when there is exactly one model *and* when multiple federated models are loaded.
- **Use canonical resolution path:** Resolve selections/IDs through `FederationRegistry` (`toGlobalId`, `fromGlobalId`, `getModelForGlobalId`) rather than assuming federation map state.
- **Honor fallback behavior:** If federation lookup misses, support single-model fallback (`globalId === expressId`).
- **Do not hardcode multi-model assumptions:** Avoid logic that only works when `models.size > 1`; verify behavior for `models.size` of `1` and `N`.

## 5. CLI Toolkit (`@ifc-lite/cli`)
- **Headless BIM operations:** Use `ifc-lite` CLI for terminal-based IFC file operations without a browser/viewer.
- **Discovery:** Run `ifc-lite schema` to get the full SDK API as JSON (16 namespaces).
- **Key commands:** `info` (summary), `query` (filter entities with `--all` for full data), `props` (entity details), `export` (CSV/JSON/IFC), `ids` (validation), `bcf` (collaboration), `create` (generate IFC, 30+ element types), `merge` (combine IFC files), `convert` (schema version conversion), `diff` (compare files), `validate` (structural checks), `bsdd` (Data Dictionary lookup), `eval` (SDK expressions), `run` (execute scripts), `schema` (API reference), `stats` (entity statistics), `mutate` (modify entities), `ask` (AI-assisted queries).
- **Machine-readable output:** Always use `--json` flag for structured JSON output. Stdout = data, stderr = status messages.
- **`eval` is the power tool:** `ifc-lite eval model.ifc "bim.query().byType('IfcWall').count()"` — the `bim` object exposes the full `@ifc-lite/sdk` API.
- **HeadlessBackend:** `packages/cli/src/headless-backend.ts` implements `BimBackend` without a renderer. Viewer-specific operations are no-ops; query, export, create, IDS, and BCF work fully.

## 6. 3D Viewer (`@ifc-lite/viewer`)
- **Separate package** (`packages/viewer`) — browser-based 3D visualization. All headless CLI commands work without it.
- **Full API reference:** See [`docs/guide/viewer-api.md`](./docs/guide/viewer-api.md) for launch options, REST API, element creation, and analysis overlays.
- **Coordinate convention (coding-relevant):** IFC uses Z-up; the viewer uses Y-up internally. The geometry layer converts automatically during mesh parsing. When using `/api/create`, pass coordinates in IFC Z-up convention (`[x, y, z]` where Z is up).

## 7. Feedback Loop
- If a pattern is confusing or repeatedly error-prone, call it out explicitly in your PR notes.
- Prefer refactors that make the correct path the easiest path (single source of truth helpers, stricter types, fewer implicit fallbacks).
