# Agent Guidelines: ifc-lite

## 1. Mandatory Schema Compliance
- **Strict Nomenclature:** Use exact IFC EXPRESS names in user-facing APIs, scripting, and exports. Never invent simplified aliases.
- **Attributes:** Use IFC PascalCase (`GlobalId`, `Name`, `Description`, `ObjectType`, `Type`) as the default user-facing shape.
- **Relationships:** Use full IFC relationship entity names (e.g., `IfcRelAggregates`, **not** `Aggregates`).
- **Type Casing:** STEP entity names are stored as `UPPERCASE`. For display/API output, use `store.entities.getTypeName(id)` to return proper `IfcPascalCase`.

## 2. Critical Performance Patterns
- **On-Demand Extraction:** `extractEntityAttributesOnDemand` parses the source buffer and is expensive. **Never** call it in large loops; use cached `EntityNode` getters or the list adapter provider.
- **Zustand Subscriptions:** Use fine-grained selectors (`useViewerStore((s) => s.item)`) to avoid unnecessary re-renders.
- **Federation-Aware IDs:** Always distinguish `localExpressId` from federated `globalId`; convert via federation helpers/offsets, never ad-hoc math in UI code.

## 3. Mandatory Workflows
- **License Headers:** Every new source file must include the MPL-2.0 header documented in [`./LICENSE_HEADER.md`](./LICENSE_HEADER.md).
- **Changesets:** If changes affect published `packages/*`, add a changeset with `pnpm changeset`. Never manually edit package versions or `CHANGELOG.md`.
- **Generated Artifacts:** Do not edit generated WASM JS/TS declaration outputs in `packages/wasm/`; make source changes in Rust crates and regenerate.

## 4. Single-Model vs Federated-Model Correctness (Common Failure Mode)
- **Treat both modes as first-class:** Code must work when there is exactly one legacy model *and* when multiple federated models are loaded.
- **Use canonical resolution path:** Resolve selections/IDs through store-based helpers (`resolveGlobalIdFromModels` and `resolveEntityRef`) rather than assuming federation map state.
- **Honor fallback behavior:** If federation lookup misses, support single-model fallback (`globalId === expressId`) and legacy sentinel behavior (`modelId: 'legacy'`) where required.
- **Do not hardcode multi-model assumptions:** Avoid logic that only works when `models.size > 1`; verify behavior for `models.size === 0` (legacy), `1`, and `N`.

## 5. Feedback Loop
- If a pattern is confusing or repeatedly error-prone, call it out explicitly in your PR notes.
- Prefer refactors that make the correct path the easiest path (single source of truth helpers, stricter types, fewer implicit fallbacks).
