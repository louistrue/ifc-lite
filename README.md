<table align="center">
<tr>
<td valign="top">
<h1>
<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=48&duration=2000&pause=5000&color=6366F1&vCenter=true&width=300&height=55&lines=IFClite" alt="IFClite">
</h1>
Open, view, and work with IFC files — right in the browser.
</td>
<td width="120" align="center" valign="middle">
<img src="docs/assets/logo.png" alt="" width="100">
</td>
</tr>
</table>

<p align="center">
  <a href="https://www.ifclite.com/"><img src="https://img.shields.io/badge/🚀_Try_it_Live-ifclite.com-ff6b6b?style=for-the-badge&labelColor=1a1a2e" alt="Try it Live"></a>
</p>

<p align="center">
  <a href="https://github.com/louistrue/ifc-lite/actions"><img src="https://img.shields.io/github/actions/workflow/status/louistrue/ifc-lite/release.yml?branch=main&style=flat-square&logo=github" alt="Build Status"></a>
  <a href="https://github.com/louistrue/ifc-lite/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-blue?style=flat-square" alt="License"></a>
  <a href="https://www.npmjs.com/package/@ifc-lite/parser"><img src="https://img.shields.io/npm/v/@ifc-lite/parser?style=flat-square&logo=npm&label=parser" alt="npm parser"></a>
  <a href="https://crates.io/crates/ifc-lite-core"><img src="https://img.shields.io/crates/v/ifc-lite-core?style=flat-square&logo=rust&label=core" alt="crates.io"></a>
</p>

---

## What is IFClite?

IFClite is an open-source toolkit for working with IFC files. It lets you load, view, query, and export BIM models from a web browser, a server, or a desktop app — no plugins or installs needed.

- **View 3D models** in the browser with a fast WebGPU renderer
- **Extract data** — properties, quantities, spatial structure, relationships
- **Check compliance** against IDS (Information Delivery Specification) rules
- **Generate 2D drawings** — floor plans, sections, and elevations from 3D
- **Collaborate** with BCF (BIM Collaboration Format) for issues and viewpoints
- **Export** to glTF, IFC, or Parquet

Works with **IFC4 / IFC4X3** and the new **IFC5 (IFCX)** format. ~260 KB gzipped.

## Get Started

Create a project in one command:

```bash
npx create-ifc-lite my-app
cd my-app && npm install && npm run parse
```

This parses an IFC file and logs what it finds. From here you can start building.

**Want a 3D viewer?** Pick a template:

```bash
npx create-ifc-lite my-viewer --template react       # WebGPU viewer
npx create-ifc-lite my-viewer --template threejs      # Three.js (WebGL)
npx create-ifc-lite my-viewer --template babylonjs    # Babylon.js (WebGL)
```

**Want a server backend?**

```bash
npx create-ifc-lite my-backend --template server
cd my-backend && npm run server:start
```

**Or add to an existing project:**

```bash
npm install @ifc-lite/parser
```

```typescript
import { IfcParser } from '@ifc-lite/parser';

const parser = new IfcParser();
const result = await parser.parse(ifcBuffer);
console.log(`Found ${result.entityCount} entities`);
```

> See [Installation](docs/guide/installation.md) for all options including Cargo (Rust) and Docker.

## Choose Your Setup

IFClite runs in four different environments. Pick what fits:

| Setup | Best for | You get |
|-------|----------|---------|
| [**Browser (WebGPU)**](docs/guide/quickstart.md) | Viewing and inspecting models | Full-featured 3D viewer, runs entirely client-side |
| [**Three.js / Babylon.js**](docs/tutorials/threejs-integration.md) | Adding IFC support to an existing 3D app | IFC parsing + geometry, rendered by your engine ([Babylon.js](docs/tutorials/babylonjs-integration.md)) |
| [**Server**](docs/guide/server.md) | Teams, large files, repeat access | Rust backend with caching, parallel processing, streaming |
| [**Desktop (Tauri)**](docs/guide/desktop.md) | Offline use, very large files (500 MB+) | Native app with multi-threading and direct filesystem access |

**Not sure?** Start with the browser setup. You can add a server or switch to Three.js/Babylon.js later.

## What Do I Install?

You don't need all 25 packages. Here's what to grab for common tasks:

| I want to... | Packages |
|--------------|----------|
| Parse an IFC file | `@ifc-lite/parser` |
| View a 3D model (WebGPU) | + `@ifc-lite/geometry` + `@ifc-lite/renderer` |
| Use Three.js or Babylon.js | + `@ifc-lite/geometry` (you handle the rendering) |
| Query properties and types | + `@ifc-lite/query` |
| Validate against IDS rules | + `@ifc-lite/ids` |
| Generate 2D drawings | + `@ifc-lite/drawing-2d` |
| Export to glTF / IFC / Parquet | + `@ifc-lite/export` |
| Connect to a server backend | + `@ifc-lite/server-client` |

> Full list: [API Reference](docs/api/typescript.md) (25 TypeScript packages, 4 Rust crates)

## Examples

Ready-to-run projects in the [`examples/`](examples/) folder:

- **[Three.js Viewer](examples/threejs-viewer/)** — load and display IFC models with Three.js (WebGL)
- **[Babylon.js Viewer](examples/babylonjs-viewer/)** — load and display IFC models with Babylon.js (WebGL)

## Documentation

| | |
|---|---|
| **Start here** | [Quick Start](docs/guide/quickstart.md) · [Installation](docs/guide/installation.md) · [Browser Requirements](docs/guide/browser-requirements.md) |
| **Guides** | [Parsing](docs/guide/parsing.md) · [Geometry](docs/guide/geometry.md) · [Rendering](docs/guide/rendering.md) · [Querying](docs/guide/querying.md) · [Exporting](docs/guide/exporting.md) |
| **BIM features** | [Federation](docs/guide/federation.md) · [BCF](docs/guide/bcf.md) · [IDS Validation](docs/guide/ids.md) · [2D Drawings](docs/guide/drawing-2d.md) · [Property Editing](docs/guide/mutations.md) |
| **Tutorials** | [Build a Viewer](docs/tutorials/building-viewer.md) · [Three.js](docs/tutorials/threejs-integration.md) · [Babylon.js](docs/tutorials/babylonjs-integration.md) · [Custom Queries](docs/tutorials/custom-queries.md) |
| **Deep dives** | [Architecture](docs/architecture/overview.md) · [Data Flow](docs/architecture/data-flow.md) · [Performance](tests/benchmark/) |
| **API** | [TypeScript](docs/api/typescript.md) · [Rust](docs/api/rust.md) · [WASM](docs/api/wasm.md) |

## Contributing

We welcome contributions! No Rust toolchain needed — WASM comes pre-built.

```bash
git clone https://github.com/louistrue/ifc-lite.git
cd ifc-lite
pnpm install && pnpm build && pnpm dev   # opens viewer at localhost:5173
```

See the [Contributing Guide](docs/contributing/setup.md) and [Release Process](RELEASE.md) for details.

## Community Projects

| Project | Description |
|---------|-------------|
| [bimifc.de](https://bimifc.de/) | Pure Rust/Bevy IFC viewer by [@holg](https://github.com/holg) |

*Built something with IFClite? Open a PR to add it here!*

## License

[Mozilla Public License 2.0](LICENSE)

---

<p align="center">
  Made with ❤️ for the AEC industry
</p>
