# ifc-lite-headless

Headless IFC processing toolkit built on [ifc-lite](https://github.com/louistrue/ifc-lite) Rust crates.

## Features

### GLB Export
Converts IFC to GLB 2.0 with each node named by its IFC GlobalId.

```bash
cargo build --release
./target/release/ifc-lite-headless input.ifc output.glb [options]
```

- IfcConvert-compatible CLI (see `--help`)
- `node.name` = IFC GlobalId (default), Name, StepId, or Type
- PBR materials with IFC style colors
- Parallel geometry processing via rayon

## Benchmark vs IfcConvert 0.8.4

```bash
python3 docker/benchmark.py > docker/benchmark_results.csv
```

Outputs CSV with anonymized file IDs, entity complexity counts, timing, and GLB sizes. Both tools run natively with full CPU.

**30 files tested (0.3 MB - 652 MB), 43x average speedup:**

| Size range | Files | Avg speedup |
|------------|-------|-------------|
| < 1 MB     | 8     | 13x         |
| 1 - 20 MB  | 11    | 63x         |
| 20 - 70 MB | 7     | 39x         |
| 300+ MB    | 4     | 35x         |

IfcConvert binary: macOS ARM64 native (`ifcconvert-0.8.4-macosm164`).

See [`docker/benchmark_results.csv`](docker/benchmark_results.csv) for full results with entity counts.

## License

MPL-2.0
