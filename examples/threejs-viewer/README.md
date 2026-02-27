# IFC-Lite + Three.js Example

Minimal IFC viewer using `@ifc-lite/geometry` with Three.js — no WebGPU required.

## How it works

The `@ifc-lite/geometry` package outputs engine-agnostic mesh data:

```typescript
interface MeshData {
  expressId: number;
  positions: Float32Array;  // [x,y,z, ...]
  normals: Float32Array;    // [nx,ny,nz, ...]
  indices: Uint32Array;     // triangle indices
  color: [r, g, b, a];     // RGBA 0-1
}
```

The `ifc-to-threejs.ts` bridge converts these into Three.js `BufferGeometry` + `MeshStandardMaterial`.

## Quick start

```bash
npm install
npm run dev
```

> **Note:** `@ifc-lite/data` is listed as an explicit dependency here as a workaround —
> `@ifc-lite/geometry@1.11.0` uses it internally but omitted it from its own `dependencies`.
> It will be declared transitively in the next patch release and can be removed then.

Open `http://localhost:5173` and drop an IFC file.

## Key files

| File | Purpose |
|------|---------|
| `src/main.ts` | Three.js scene setup + streaming IFC loader |
| `src/ifc-to-threejs.ts` | MeshData → Three.js conversion utilities |

## Integration patterns

### 1. One mesh per IFC entity (simple, good for picking)

```typescript
import { meshDataToThree } from './ifc-to-threejs';

const threeMesh = meshDataToThree(meshData);
scene.add(threeMesh);
```

### 2. Batched by color (fewer draw calls)

```typescript
import { geometryResultToBatched } from './ifc-to-threejs';

const { group, expressIdMap } = geometryResultToBatched(geometryResult);
scene.add(group);
```

### 3. Streaming (progressive display)

```typescript
import { addStreamingBatchToScene } from './ifc-to-threejs';

for await (const event of processor.processStreaming(buffer)) {
  if (event.type === 'batch') {
    addStreamingBatchToScene(event.meshes, scene, expressIdMap);
  }
}
```

## License

MPL-2.0
