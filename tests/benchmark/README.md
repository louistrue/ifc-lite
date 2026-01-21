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
| **FZK-Haus** | 2.5MB | Cutout/boolean testing | Window/door openings must be visible |
| **Snowdon Towers** | 8MB | Structural elements | Fast loading baseline |
| **BWK-BIM** | 327MB | Large architectural | Stress test for streaming |
| **Holter Tower** | 169MB | Complex geometry | Crash prevention (MAX_OPENINGS safeguard) |

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

- **firstBatchWaitMs**: Time until first geometry appears (user-perceived speed)
- **wasmWaitMs**: Total WASM processing time
- **geometryStreamingMs**: Total geometry streaming time
- **entityScanMs**: Entity scanning overhead
- **dataModelParseMs**: Data model parsing time
- **totalMeshes**: Total mesh count (geometry correctness check)

## Geometry Correctness Validation

The benchmark suite includes mesh count validation to detect geometry regressions:

- **Expected mesh counts** are defined in `viewer-benchmark.spec.ts`
- **Tolerance**: 5% variance allowed
- **Warning**: Logs warning if mesh count differs significantly (may indicate missing cutouts)

## Performance Targets

Based on baseline.json:

| Model | First Batch | WASM Wait | Total Time |
|-------|-------------|-----------|------------|
| FZK-Haus | < 150ms | < 500ms | < 1s |
| Snowdon | < 60ms | < 600ms | < 2s |
| BWK-BIM | < 1.2s | < 10s | < 25s |
| Holter | < 800ms | < 8s | < 25s |

## CI Integration

Benchmarks run automatically in CI on PRs that modify:
- `rust/**` (geometry processing)
- `packages/geometry/**`
- `packages/wasm/**`

CI uses headless mode with software rendering (`--use-angle=swiftshader`).

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
