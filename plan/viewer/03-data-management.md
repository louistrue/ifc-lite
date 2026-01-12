# IFC-Lite Viewer: Part 3 - Data Management

## 3.1 Progressive Loading Pipeline

```
PHASE 0 (0-100ms):    Skeleton UI, start file reading
PHASE 1 (100-500ms):  Stream-parse entity index → hierarchy tree visible
PHASE 2 (500ms-2s):   Largest elements first → USER CAN NAVIGATE
PHASE 3 (2s-30s):     Progressive fill (visible > large > small)
PHASE 4 (30s+):       Background LOD generation, caching
```

### Priority-Based Loading

```typescript
class LoadingPriorityQueue {
  calculatePriority(expressId: number, bounds: AABB, type: string, camera: Camera): number {
    let priority = 0;
    priority += this.estimateScreenSize(bounds, camera) * 100;  // Screen size
    priority += Math.max(0, 1000 - this.distanceToCamera(bounds, camera)) * 0.5;  // Distance
    if (this.isInFrustum(bounds, camera)) priority += 500;  // Visibility
    priority += TYPE_IMPORTANCE[type] ?? 25;  // Type importance
    return priority;
  }
}

const TYPE_IMPORTANCE = {
  'IfcBuilding': 100, 'IfcSlab': 80, 'IfcWall': 70,
  'IfcDoor': 40, 'IfcFurniture': 20, 'IfcFastener': 5
};
```

---

## 3.2 GPU Memory Management

```typescript
class GPUMemoryManager {
  private allocatedBytes = 0;
  private maxBytes: number;
  private buffers = new Map<string, ManagedBuffer>();
  private lruList: LRUCache<string, ManagedBuffer>;
  
  async allocate(key: string, data: ArrayBuffer, usage: GPUBufferUsageFlags): Promise<GPUBuffer> {
    while (this.allocatedBytes + data.byteLength > this.maxBytes) {
      if (!this.evictLRU()) throw new Error('Memory full');
    }
    
    const buffer = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
    buffer.unmap();
    
    this.buffers.set(key, { buffer, size: data.byteLength, lastUsed: performance.now() });
    this.allocatedBytes += data.byteLength;
    return buffer;
  }
  
  touch(key: string): void { /* Update LRU */ }
  private evictLRU(): boolean { /* Destroy oldest buffer */ }
}
```

---

## 3.3 IndexedDB Model Cache

```typescript
class ModelCache {
  async saveModel(fileHash: string, store: IfcDataStore, geometry: Map<number, ArrayBuffer>): Promise<void> {
    const tx = this.db.transaction(['models', 'geometry', 'data'], 'readwrite');
    tx.objectStore('models').put({ hash: fileHash, lastAccessed: Date.now(), entityCount: store.entityCount });
    for (const [id, buffer] of geometry) {
      tx.objectStore('geometry').put({ id: `${fileHash}_${id}`, data: buffer });
    }
    tx.objectStore('data').put({ id: `${fileHash}_entities`, data: serialize(store.entities) });
  }
  
  async loadModel(fileHash: string): Promise<CachedModelData | null> { /* Load from cache */ }
  async cleanup(maxAgeDays = 30, maxSizeMB = 2000): Promise<void> { /* Evict old entries */ }
}
```

---

## 3.4 Worker Pool

```typescript
class WorkerPool {
  private workers: Worker[] = [];
  private taskQueue: Task[] = [];
  
  constructor(count = navigator.hardwareConcurrency || 4) {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => this.handleMessage(worker, e);
      this.workers.push(worker);
    }
  }
  
  async submit<T>(type: TaskType, data: any): Promise<T> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ id: crypto.randomUUID(), type, data, resolve, reject });
      this.processQueue();
    });
  }
}

type TaskType = 'parse-geometry' | 'generate-lod' | 'build-bvh' | 'simplify-mesh';
```

---

## 3.5 Geometry Compression

```typescript
class GeometryCompressor {
  // Quantize positions to 16-bit (50% size reduction)
  quantizePositions(positions: Float32Array, bounds: AABB): Uint16Array { /* ... */ }
  
  // Octahedron-encode normals to 2 bytes (66% size reduction)
  encodeNormals(normals: Float32Array): Uint16Array { /* ... */ }
  
  // Delta + varint encode indices
  compressIndices(indices: Uint32Array): Uint8Array { /* ... */ }
}
```

---

## 3.6 Memory Budget Calculator

```typescript
class MemoryBudgetCalculator {
  estimateMemory(entityCount: number, triangleCount: number, instanceRatio: number): MemoryEstimate {
    const entityDataMB = (entityCount * 100) / (1024 * 1024);
    const geometryMB = (triangleCount * (1 - instanceRatio) * 36) / (1024 * 1024);
    const instancesMB = (triangleCount * instanceRatio / 100 * 64) / (1024 * 1024);
    return { entityDataMB, geometryMB, instancesMB, totalMB: (entityDataMB + geometryMB + instancesMB) * 1.2 };
  }
  
  getRecommendedSettings(): ViewerSettings {
    const memory = (navigator as any).deviceMemory || 4;
    const gpu = 'gpu' in navigator ? 'high' : 'medium';
    
    if (memory >= 8 && gpu === 'high') {
      return { maxTriangles: 50_000_000, lodLevels: 4, occlusionCulling: true, msaaSamples: 4 };
    } else if (memory >= 4) {
      return { maxTriangles: 10_000_000, lodLevels: 3, occlusionCulling: true, msaaSamples: 2 };
    }
    return { maxTriangles: 2_000_000, lodLevels: 2, occlusionCulling: false, msaaSamples: 1 };
  }
}
```

---

*Continue to Part 4: User Interface*
