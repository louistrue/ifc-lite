# Desktop Fast Path Status

This page tracks the shared `ifc-lite` side of the desktop large-file optimization work that is currently integrated on branch `desktop`.

It complements the private shell-side status doc in `ifc-lite-desktop` and focuses on the shared viewer, geometry, and Rust engine changes.

## Landed Shared Changes

The current desktop fast-path bucket in `ifc-lite/desktop` includes:

1. Rust streaming compatibility for:
   - quick metadata bootstrap
   - non-retained emitted meshes
   - desktop memory/streaming settings used by the private shell
2. Packed shard transport support in the shared native bridge.
3. Packed shard polling for desktop path streaming.
4. Shared telemetry schema support for harness cache reporting.
5. Removal of the old path-stream fallback for this bucket in `processGeometryStreamingPath()`.

## Why This Matters

The desktop shell shares its hot path with code from this repo:

- `apps/viewer`
- `packages/geometry`
- `rust/engine`
- `rust/processing`

If these changes are not committed here on the `desktop` branch, the desktop shell can drift away from the exact fast-path behavior that was benchmarked locally.

## Latest Observed 1 GB Local Result

Measured through the desktop shell harness using the shared code from this branch:

- fixture: `merged_export(13).ifc`
- size: `986.44 MB`
- cold miss: `true`
- first visible geometry: `4468 ms`
- metadata bootstrap complete: `4741 ms`
- native geometry total: `11692 ms`
- stream complete: `46544 ms`
- total wall clock: `47431 ms`

## Current Interpretation

The shared fast path has now achieved two important things on the tested 1 GB local fixture:

1. It gets first visible geometry under `5s`.
2. It removes the previous bad freeze/backlog shape where the run could appear stuck at the first small batch.

However, it has **not** yet achieved:

- full cold completion under `5s`

The remaining dominant cost is downstream of the native packed transport, in the frontend/render drain path after native geometry work has substantially completed.

## What Still Needs Work

The highest-value remaining shared work is:

1. Optional streamed metadata bootstrap consumption on top of the already-working desktop metadata path.
2. More reduction in frontend append/drain overhead after native completion.
3. More reduction in renderer batching/finalization cost for the full large-model path.

## Branch Policy

Until this work is merged back to `main`, the intended shared integration branch for these desktop-facing changes is:

- `ifc-lite/desktop`

That branch should remain the source of truth for the shared portion of the desktop fast path.
