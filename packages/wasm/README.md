<p align="center">
  <img src="docs/assets/logo.svg" alt="IFClite Logo" width="120" height="120">
</p>

<h1 align="center">IFClite</h1>

<p align="center">
  <strong>Fast, lightweight IFC for the browser</strong>
</p>

<p align="center">
  <a href="https://github.com/louistrue/ifc-lite/actions"><img src="https://img.shields.io/github/actions/workflow/status/louistrue/ifc-lite/ci.yml?branch=main&style=flat-square&logo=github" alt="Build Status"></a>
  <a href="https://github.com/louistrue/ifc-lite/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-blue?style=flat-square" alt="License"></a>
  <a href="https://www.npmjs.com/package/@ifc-lite/parser"><img src="https://img.shields.io/npm/v/@ifc-lite/parser?style=flat-square&logo=npm&label=parser" alt="npm parser"></a>
  <a href="https://crates.io/crates/ifc-lite-core"><img src="https://img.shields.io/crates/v/ifc-lite-core?style=flat-square&logo=rust&label=core" alt="crates.io"></a>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#documentation">Documentation</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#performance">Performance</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## Overview

**IFClite** parses, processes, and renders IFC files in the browser using **Rust + WebAssembly** and **WebGPU**. Smaller and faster than the alternatives.

<p align="center">
  <strong>0.65 MB WASM</strong> &nbsp;•&nbsp; <strong>5x faster</strong> &nbsp;•&nbsp; <strong>Clean columnar API</strong>
</p>

## Features

| Feature | Description |
|---------|-------------|
| **Clean DX** | Columnar data structures, TypedArrays, consistent API — built from scratch for clarity |
| **STEP/IFC Parsing** | Zero-copy tokenization with full IFC4X3 schema support (876 entities) |
| **Streaming Pipeline** | Progressive geometry processing — first triangles in 300-500ms |
| **WebGPU Rendering** | Modern GPU-accelerated 3D with depth testing and frustum culling |
| **Zero-Copy GPU** | Direct WASM memory to GPU buffers, 60-70% less RAM |

## Quick Start

### Prerequisites

- **Node.js** 18.0+ with **pnpm** 8.0+
- **Rust** toolchain with wasm32-unknown-unknown target
- Modern browser with **WebGPU** support (Chrome 113+, Edge 113+, Firefox 127+, Safari 18+)

### Installation

```bash
# Clone the repository
git clone https://github.com/louistrue/ifc-lite.git
cd ifc-lite

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the viewer
cd apps/viewer
pnpm dev
```

### Basic Usage

```typescript
import { IfcParser } from '@ifc-lite/parser';
import { Renderer } from '@ifc-lite/renderer';

// Parse IFC file
const parser = new IfcParser();
const result = await parser.parse(ifcArrayBuffer);

// Access entities
const walls = result.entities.filter(e => e.type === 'IFCWALL');
console.log(`Found ${walls.length} walls`);

// Render geometry
const renderer = new Renderer(canvas);
await renderer.loadGeometry(result.geometry);
renderer.render();
```

## Documentation

| Resource | Description |
|----------|-------------|
| [**User Guide**](https://louistrue.github.io/ifc-lite/) | Complete guide with tutorials and examples |
| [**API Reference**](https://louistrue.github.io/ifc-lite/api/) | Rustdoc API documentation |
| [**Architecture**](docs/architecture.md) | System design and data flow |
| [**Contributing**](CONTRIBUTING.md) | How to contribute to the project |

## Architecture

IFC files flow through three layers:

**Parser** (Rust/WASM) — Zero-copy STEP tokenizer, entity scanner, and geometry processor using nom, earcutr, and nalgebra.

**Data** (TypeScript) — Columnar TypedArrays for properties, CSR graph for relationships, GPU-ready geometry buffers.

**Output** — WebGPU renderer, Parquet analytics, glTF/JSON-LD/CSV export.

## Project Structure

```
ifc-lite/
├── rust/                      # Rust/WASM backend
│   ├── core/                  # IFC/STEP parsing (~2,000 LOC)
│   ├── geometry/              # Geometry processing (~2,500 LOC)
│   └── wasm-bindings/         # JavaScript API (~800 LOC)
│
├── packages/                  # TypeScript packages
│   ├── parser/                # High-level IFC parser
│   ├── geometry/              # Geometry bridge (WASM)
│   ├── renderer/              # WebGPU rendering
│   ├── query/                 # Query system
│   ├── data/                  # Columnar data structures
│   ├── spatial/               # Spatial indexing
│   ├── export/                # Export formats
│   └── codegen/               # Schema generator
│
├── apps/
│   └── viewer/                # React web application
│
└── docs/                      # Documentation (MkDocs)
```

## Performance

### Bundle Size Comparison

| Library | WASM Size | Gzipped |
|---------|-----------|---------|
| **IFClite** | **0.65 MB** | **0.26 MB** |
| web-ifc | 1.1 MB | 0.4 MB |
| IfcOpenShell | 15 MB | — |

### Parse Performance

| Model Size | IFClite | Notes |
|------------|----------|-------|
| 10 MB | ~100-200ms | Small models |
| 50 MB | ~600-700ms | Typical models |
| 100+ MB | ~1.5-2s | Complex geometry |

*Based on [benchmark results](../../tests/benchmark/benchmark-results.json) across 67 IFC files.*

### Geometry Processing

- **5x faster** overall than web-ifc (median 2.18x, up to 104x on some files)
- Streaming pipeline with batched processing (100 meshes/batch)
- First triangles visible in **300-500ms**

*See [full benchmark data](../../tests/benchmark/benchmark-results.json) for per-file comparisons.*

## Browser Requirements

| Browser | Minimum Version | WebGPU |
|---------|----------------|--------|
| Chrome | 113+ | ✅ |
| Edge | 113+ | ✅ |
| Firefox | 127+ | ✅ |
| Safari | 18+ | ✅ |

## Development

```bash
# Watch mode for all packages
pnpm -r dev

# Build specific package
cd packages/parser && pnpm build

# Run tests
pnpm test

# Build Rust/WASM
cd rust && cargo build --release --target wasm32-unknown-unknown

# Generate Rustdoc
cd rust && cargo doc --no-deps --open

# Build documentation site
cd docs && mkdocs serve
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@ifc-lite/parser` | STEP tokenizer & entity extraction | ✅ Stable |
| `@ifc-lite/geometry` | Geometry processing bridge | ✅ Stable |
| `@ifc-lite/renderer` | WebGPU rendering pipeline | ✅ Stable |
| `@ifc-lite/query` | Fluent & SQL query system | 🚧 Beta |
| `@ifc-lite/data` | Columnar data structures | ✅ Stable |
| `@ifc-lite/spatial` | Spatial indexing & culling | 🚧 Beta |
| `@ifc-lite/export` | Export (glTF, Parquet, etc.) | 🚧 Beta |

## Rust Crates

| Crate | Description | Status |
|-------|-------------|--------|
| `ifc-lite-core` | STEP/IFC parsing | ✅ Stable |
| `ifc-lite-geometry` | Mesh triangulation | ✅ Stable |
| `ifc-lite-wasm` | WASM bindings | ✅ Stable |

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/ifc-lite.git

# Create a branch
git checkout -b feature/my-feature

# Make changes and test
pnpm test

# Submit a pull request
```

## License

This project is licensed under the [Mozilla Public License 2.0](LICENSE).

## Acknowledgments

- Built with [nom](https://github.com/rust-bakery/nom) for parsing
- [earcutr](https://github.com/nickel-org/earcutr) for polygon triangulation
- [nalgebra](https://nalgebra.org/) for linear algebra
- [wasm-bindgen](https://rustwasm.github.io/wasm-bindgen/) for Rust/JS interop

---

<p align="center">
  Made with ❤️ for the AEC industry
</p>
