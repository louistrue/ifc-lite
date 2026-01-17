# @ifc-lite/server-bin

Pre-built IFC-Lite server binary - run without Docker or Rust.

## Quick Start

```bash
# Run directly with npx (downloads binary on first run)
npx @ifc-lite/server-bin

# Or install globally
npm install -g @ifc-lite/server-bin
ifc-lite-server
```

## Features

- **Zero dependencies**: No Docker, Rust, or compilation required
- **Auto-download**: Binary is downloaded on first run
- **Cross-platform**: macOS, Linux, and Windows support
- **Fast startup**: Native binary starts instantly

## Usage

### CLI

```bash
# Start server on default port (8080)
npx @ifc-lite/server-bin

# Start on custom port
PORT=3001 npx @ifc-lite/server-bin

# Download binary without starting (for CI/CD)
npx @ifc-lite/server-bin download

# Show platform and binary info
npx @ifc-lite/server-bin info

# Show help
npx @ifc-lite/server-bin help
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `RUST_LOG` | info | Log level: error, warn, info, debug |
| `MAX_FILE_SIZE_MB` | 500 | Maximum upload size |
| `WORKER_THREADS` | CPU cores | Parallel processing threads |
| `CACHE_DIR` | ./.cache | Cache directory |
| `REQUEST_TIMEOUT_SECS` | 300 | Request timeout |
| `INITIAL_BATCH_SIZE` | 100 | Streaming initial batch |
| `MAX_BATCH_SIZE` | 1000 | Streaming max batch |
| `CACHE_MAX_AGE_DAYS` | 7 | Cache retention |

### Programmatic Usage

```typescript
import { runBinary, ensureBinary, getBinaryInfo } from '@ifc-lite/server-bin';

// Get binary info
const info = getBinaryInfo();
console.log(`Platform: ${info.platform.targetTriple}`);
console.log(`Cached: ${info.isCached}`);

// Ensure binary is downloaded
const binaryPath = await ensureBinary();

// Run the server with custom args
const exitCode = await runBinary(['--help']);
```

## Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS | x64 (Intel) | ✅ |
| macOS | arm64 (Apple Silicon) | ✅ |
| Linux | x64 (glibc) | ✅ |
| Linux | arm64 (glibc) | ✅ |
| Linux | x64 (musl/Alpine) | ✅ |
| Windows | x64 | ✅ |

## Skipping Auto-Download

To skip the automatic binary download during `npm install`:

```bash
IFC_LITE_SKIP_DOWNLOAD=1 npm install @ifc-lite/server-bin
```

You can then download manually when needed:

```bash
npx @ifc-lite/server-bin download
```

## Alternatives

If pre-built binaries don't work for your platform:

```bash
# Use Docker
npx create-ifc-lite my-app --template server
cd my-app
docker compose up -d

# Or build from source
git clone https://github.com/louistrue/ifc-lite
cd ifc-lite/apps/server
cargo build --release
```

## API Reference

### `runBinary(args?: string[]): Promise<number>`

Run the server binary with optional arguments. Returns exit code.

### `ensureBinary(onProgress?: ProgressCallback): Promise<string>`

Ensure binary is downloaded, returns path to binary.

### `downloadBinary(onProgress?: ProgressCallback): Promise<string>`

Force download binary, returns path.

### `getBinaryInfo(): BinaryInfo`

Get information about the binary and current platform.

### `isBinaryCached(): Promise<boolean>`

Check if binary is already downloaded.

## License

[Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/)
