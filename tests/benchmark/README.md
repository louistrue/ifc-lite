# Performance Benchmarking Guide

This directory contains performance benchmarks for IFC-Lite geometry processing and rendering.

## Quick Start

### Run All Benchmarks

```bash
# Build viewer first
pnpm --filter viewer build

# Run benchmarks (headed browser for accurate GPU timing)
pnpm test:benchmark:viewer
```

### Run Specific Model

```bash
VIEWER_BENCHMARK_FILES="tests/models/ara3d/AC20-FZK-Haus.ifc" pnpm test:benchmark:viewer
```

### Check for Regressions

```bash
# After running benchmarks, check against baseline
pnpm benchmark:check
```

## Test Models

The benchmark suite includes 4 models covering different scenarios:

| Model | Size | Purpose | Key Metrics |
|-------|------|---------|-------------|
| **FZK-Haus** | 2.4MB | Cutout/boolean testing | Window/door openings must be visible |
| **Snowdon Towers** | 8.3MB | Structural elements | Fast loading baseline |
| **BWK-BIM** | 326.8MB | Large architectural | Stress test for streaming |
| **Holter Tower** | 169.2MB | Complex geometry | Crash prevention (MAX_OPENINGS safeguard) |

## Establishing Baseline

1. **Run benchmarks on clean branch** (e.g., main):
   ```bash
   pnpm benchmark:baseline
   ```

2. **Copy results to baseline.json**:
   ```bash
   # Results are saved to tests/benchmark/benchmark-results/
   # Manually copy metrics to tests/benchmark/baseline.json
   ```

3. **Commit baseline.json** - This becomes the reference for regression detection.

## Metrics Captured

Primary metrics captured in the current benchmark log format:

- **firstBatchWaitMs**: Time until first geometry appears (user-perceived speed)
- **totalWallClockMs**: End-to-end load time for the model
- **totalMeshes**: Total mesh count (geometry correctness check)
- **fileSizeMB**: Model size used for comparisons
- **wasmWaitMs**: Total WASM processing wait time during geometry streaming
- **entityScanMs**: Fast entity scanning time
- **dataModelParseMs**: Data model parse time

## Geometry Correctness Validation

The benchmark suite includes mesh count validation to detect geometry regressions:

- **Expected mesh counts** are defined in `viewer-benchmark.spec.ts`
- **Tolerance**: 5% variance allowed
- **Warning**: Logs warning if mesh count differs significantly (may indicate missing cutouts)

## Performance Targets

Baseline updated from local run on 2026-02-21:

| Model | First Geometry (`firstBatchWaitMs`) | Total Time (`totalWallClockMs`) | WASM Wait (`wasmWaitMs`) | Meshes |
|-------|--------------------------------------|----------------------------------|---------------------------|--------|
| FZK-Haus | ~202ms | ~0.25s | ~14ms | 244 |
| Snowdon | ~217ms | ~0.59s | ~292ms | 1,556 |
| BWK-BIM | ~5.43s | ~11.89s | ~2.98s | 39,146 |
| Holter | ~3.05s | ~11.04s | ~5.60s | 108,551 |

## Deflection Benchmark

Focused curved-tessellation benchmark captured on March 7, 2026 for the client-side WASM viewer
using `tests/models/various/01_Snowdon_Towers_Sample_Structural(1).ifc` (includes
`IfcReinforcingBar` geometry). These runs were collected headless with SwiftShader so the
absolute numbers are less important than the relative comparison:

| Deflection (m) | Total Time (`totalWallClockMs`) | First Geometry (`firstBatchWaitMs`) | WASM Wait (`wasmWaitMs`) | Meshes |
|----------------|----------------------------------|--------------------------------------|---------------------------|--------|
| `0.001` (default) | `282ms` | `126ms` | `132ms` | `1,556` |
| `0.003` | `271ms` | `126ms` | `122ms` | `1,556` |
| `0.005` | `277ms` | `129ms` | `125ms` | `1,556` |

Current recommendation for the demo viewer's rebar-heavy path:

- Keep the library default at `0.001m`.
- Use `curveDeflection=0.003` in the viewer when you want a lighter curved tessellation tradeoff
  without changing mesh counts on this benchmark model.
- The raw results are saved in:
  - `tests/benchmark/benchmark-results/viewer-snowdon-default.json`
  - `tests/benchmark/benchmark-results/viewer-snowdon-deflection-0_003.json`
  - `tests/benchmark/benchmark-results/viewer-snowdon-deflection-0_005.json`

## CI Integration

Viewer benchmark CI mode is available via:

```bash
pnpm test:benchmark:viewer:ci
```

This runs headless with software rendering (`--use-angle=swiftshader`) and is useful for reproducible CI-style timing checks.

## Troubleshooting

**Benchmarks fail with "No baseline available"**:
- Run `pnpm benchmark:baseline` first to establish baseline

**Performance regressions detected**:
- Check if optimizations broke geometry (mesh count validation)
- Profile WASM with browser DevTools Performance tab
- Compare console logs between baseline and current run

**Geometry correctness warnings**:
- Verify cutouts are visible in FZK-Haus model
- Check if MAX_OPENINGS safeguard is skipping too much
- Ensure CSG operations complete successfully
