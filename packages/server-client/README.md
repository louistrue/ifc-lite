# @ifc-lite/server-client

TypeScript SDK for the IFClite server API. Provides client-side caching, streaming, and Parquet/Arrow decoding for server-processed IFC data.

## Installation

```bash
npm install @ifc-lite/server-client
```

## Quick Start

```typescript
import { IfcServerClient } from '@ifc-lite/server-client';

const client = new IfcServerClient({ baseUrl: 'https://your-server.com' });

// Parse with intelligent caching (skips upload if cached)
const result = await client.parseParquet(file);

// Or stream for large files
for await (const event of client.parseStream(file)) {
  if (event.type === 'batch') {
    renderer.addMeshes(event.meshes);
  }
}
```

## Features

- Content-addressable caching (SHA-256 hash check before upload)
- Streaming SSE for progressive rendering
- Parquet and Arrow response decoding
- Automatic retry and error handling

## API

See the [Server Guide](../../docs/guide/server.md) and [API Reference](../../docs/api/typescript.md#ifc-liteserver-client).

## License

[MPL-2.0](../../LICENSE)
