# Installation

This guide covers installing IFC-Lite in various environments.

## Package Manager Installation

### npm / pnpm / yarn

=== "pnpm"

    ```bash
    pnpm add @ifc-lite/parser @ifc-lite/renderer
    ```

=== "npm"

    ```bash
    npm install @ifc-lite/parser @ifc-lite/renderer
    ```

=== "yarn"

    ```bash
    yarn add @ifc-lite/parser @ifc-lite/renderer
    ```

### Available Packages

| Package | Description | Size |
|---------|-------------|------|
| `@ifc-lite/parser` | IFC parsing and entity extraction | ~45 KB |
| `@ifc-lite/geometry` | Geometry processing (WASM) | ~30 KB |
| `@ifc-lite/renderer` | WebGPU rendering pipeline | ~25 KB |
| `@ifc-lite/query` | Query system (fluent + SQL) | ~15 KB |
| `@ifc-lite/data` | Columnar data structures | ~10 KB |
| `@ifc-lite/export` | Export formats (glTF, Parquet) | ~20 KB |

## Rust Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
ifc-lite-core = "0.1"
ifc-lite-geometry = "0.1"
```

Or install via cargo:

```bash
cargo add ifc-lite-core ifc-lite-geometry
```

## Building from Source

### Prerequisites

- **Node.js** 18.0 or higher
- **pnpm** 8.0 or higher
- **Rust** toolchain (stable)
- **wasm-pack** for WASM builds

### Clone and Build

```bash
# Clone the repository
git clone https://github.com/louistrue/ifc-lite.git
cd ifc-lite

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build WASM module
cd rust && wasm-pack build --target web --release
```

### Development Mode

```bash
# Watch mode for all packages
pnpm -r dev

# Run the viewer application
cd apps/viewer && pnpm dev
```

## CDN Usage

For quick prototyping, you can use IFC-Lite directly from a CDN:

```html
<script type="module">
  import { IfcParser } from 'https://esm.sh/@ifc-lite/parser';
  import { Renderer } from 'https://esm.sh/@ifc-lite/renderer';

  // Your code here
</script>
```

!!! warning "Production Usage"
    For production applications, we recommend installing packages locally rather than using CDN links.

## Verifying Installation

After installation, verify everything works:

```typescript
import { IfcParser } from '@ifc-lite/parser';

const parser = new IfcParser();
console.log('IFC-Lite version:', parser.version);
// Should output: IFC-Lite version: 0.1.0
```

## Next Steps

- [Quick Start Guide](quickstart.md) - Parse your first IFC file
- [Browser Requirements](browser-requirements.md) - Check WebGPU support
- [API Reference](../api/typescript.md) - Explore the API
