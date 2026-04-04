## BWK Normalized Comparison

File: `O-S1-BWK-BIM architectural - BIM bouwkundig.ifc`

### Run annotations
- Browser: `browser-wasm`, `vite preview`, `cacheMode=cold`, `buildMode=preview`
- Desktop: `desktop-native`, `tauri dev --release`, Vite frontend dev server on `:3001`, harness flag `--wait-for-metadata`
- Browser benchmark exited non-zero because of an older regression baseline, but it still wrote valid metrics JSON for this run.
- Desktop run used a fresh app process with warm local Rust build artifacts.

### Matched milestones

| Milestone | Browser WASM | Desktop Native | Delta |
| --- | ---: | ---: | ---: |
| `firstBatchWaitMs` | 3966 | 2039 | desktop faster by 1927 ms |
| `firstAppendGeometryBatchMs` | 3966 | 2040 | desktop faster by 1926 ms |
| `firstVisibleGeometryMs` | 4013 | 2040 | desktop faster by 1973 ms |
| `streamCompleteMs` | 5130 | 5198 | browser faster by 68 ms |
| `metadataCompleteMs` | 2637 | 5951 | browser faster by 3314 ms |
| `spatialReadyMs` | 2503 | 5747 | browser faster by 3244 ms |
| `totalWallClockMs` | 5144 | 6213 | browser faster by 1069 ms |

### Decision
- The plan decision rule is met: matched desktop `firstVisibleGeometryMs` is already below browser.
- Do not prioritize native `processParallel()` parity for geometry first-frame right now.
- The remaining gap is metadata and spatial readiness, not initial geometry visibility.

### Important caveat
- Mesh accounting is still not perfectly aligned between the two paths in these outputs: browser reports `16243` total meshes while desktop reports `29854`. That makes mesh-count-based completion comparisons less trustworthy than the matched timing milestones above.
