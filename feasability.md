# Testing IFC-Lite Feasibility

## The Core Questions We Need to Answer

Before committing to full development, we need to validate:

1. **Can we parse fast enough?** - <1s scan for 100MB file (index only)
2. **Can we triangulate reliably?** - 80%+ geometry coverage
3. **Can we render fast enough?** - 60 FPS with 10M triangles
4. **Can we query fast enough?** - <15ms property lookups
5. **Does WebGPU work broadly?** - Major browsers, reasonable hardware

*Note: Full performance varies by file complexity (Tier 1/2/3). See plan/10-remaining-solutions.md.*

---

## Phased Feasibility Testing

### Phase 0: Quick Spikes

**Goal:** Answer "is this even possible?" with minimal investment.

#### Spike 1: Parsing Speed

```typescript
// Test: Can we scan a 100MB IFC file in <100ms?

// Approach: Just find entity boundaries, don't parse content
const buffer = await file.arrayBuffer();
const bytes = new Uint8Array(buffer);

console.time('scan');
let entityCount = 0;
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 35) { // '#' character
    entityCount++;
  }
}
console.timeEnd('scan');
```

**Success criteria:** 
- Scan 100MB in <200ms ✓
- If >500ms, investigate WASM scanner

**Test files:**
- Download from [IFC Wiki samples](https://www.ifcwiki.org/index.php?title=KIT_IFC_Examples)
- Or use [BIMcollab sample files](https://www.bimcollab.com/en/resources/ifc-sample-files)

---

#### Spike 2: Triangulation Coverage

```typescript
// Test: What % of geometry can web-ifc triangulate?

import * as WebIFC from 'web-ifc';

const ifcApi = new WebIFC.IfcAPI();
await ifcApi.Init();

const modelID = ifcApi.OpenModel(buffer);
const geometries = ifcApi.LoadAllGeometry(modelID);

let success = 0, failed = 0;
for (const geom of geometries) {
  if (geom.vertexData.length > 0) success++;
  else failed++;
}

console.log(`Coverage: ${(success / (success + failed) * 100).toFixed(1)}%`);
```

**Success criteria:**
- 80%+ coverage on test files ✓
- Identify which geometry types fail

**Test files:**
- Residential (simple): Duplex Apartment
- Commercial (medium): Office Building
- Complex (hard): MEP-heavy hospital model

---

#### Spike 3: WebGPU Triangle Throughput

```typescript
// Test: Can we render 10M triangles at 60 FPS?

// Generate test geometry (random triangles)
const triangleCount = 10_000_000;
const vertices = new Float32Array(triangleCount * 3 * 3);
// ... fill with random data

// Upload and render
const buffer = device.createBuffer({
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX,
  mappedAtCreation: true,
});

// Measure frame time
function frame() {
  const start = performance.now();
  // render pass...
  const elapsed = performance.now() - start;
  console.log(`Frame: ${elapsed.toFixed(2)}ms (${(1000/elapsed).toFixed(0)} FPS)`);
  requestAnimationFrame(frame);
}
```

**Success criteria:**
- 10M triangles, single draw call: <16ms ✓
- 10M triangles, 1000 draw calls: <16ms ✓ (harder)
- Works on MacBook Air M1, mid-range Windows laptop

---

#### Spike 4: Columnar Query Speed

```typescript
// Test: How fast can we filter 100K entities?

// Simulate columnar property table
const entityCount = 100_000;
const propertyCount = 500_000;

const entityIds = new Uint32Array(propertyCount);
const psetNames = new Uint16Array(propertyCount);  // index into string table
const propNames = new Uint16Array(propertyCount);
const values = new Float32Array(propertyCount);

// Fill with test data...

// Query: Find all walls with FireRating >= 60
console.time('query');
const results = [];
const targetPset = stringTable.indexOf('Pset_WallCommon');
const targetProp = stringTable.indexOf('FireRating');

for (let i = 0; i < propertyCount; i++) {
  if (psetNames[i] === targetPset && 
      propNames[i] === targetProp && 
      values[i] >= 60) {
    results.push(entityIds[i]);
  }
}
console.timeEnd('query');
```

**Success criteria:**
- Filter 500K properties in <20ms ✓
- If slower, test with SIMD or WASM

---

### Phase 1: Integrated Prototype

**Goal:** Build minimal end-to-end pipeline, validate integration.

#### Prototype Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PROTOTYPE SCOPE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  IN SCOPE (must work):                                     │
│  ├── Load IFC file via drag & drop                         │
│  ├── Parse entities (streaming, show progress)             │
│  ├── Triangulate geometry (via web-ifc initially)          │
│  ├── Upload to WebGPU                                      │
│  ├── Basic orbit camera                                    │
│  ├── Frustum culling (CPU is fine)                         │
│  ├── Click to select → show properties                     │
│  └── Measure: time to first triangle, FPS, memory          │
│                                                             │
│  OUT OF SCOPE (later):                                     │
│  ├── LOD generation                                        │
│  ├── Instancing                                            │
│  ├── GPU culling                                           │
│  ├── IndexedDB caching                                     │
│  ├── Pretty UI                                             │
│  └── Mobile support                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Prototype Milestones

| Milestone | Deliverable | Success Metric |
|-----------|-------------|----------------|
| M1 | Parser + entity index | 100MB file indexed in <1s |
| M2 | Geometry extraction | 80% triangulation success |
| M3 | WebGPU renderer | 1M triangles @ 60 FPS |
| M4 | Selection + properties | Click → properties in <100ms |

*Note: Full parse time depends on complexity tier. Index-only scan is fast; full geometry varies.*

#### Code Structure

```
prototype/
├── src/
│   ├── parser/
│   │   ├── scanner.ts        # Byte-level STEP scanning
│   │   └── entity-index.ts   # Build entity lookup table
│   │
│   ├── geometry/
│   │   ├── triangulator.ts   # Wrapper around web-ifc
│   │   └── upload.ts         # GPU buffer creation
│   │
│   ├── renderer/
│   │   ├── webgpu.ts         # Device, pipeline setup
│   │   ├── camera.ts         # Orbit controls
│   │   └── picking.ts        # Object ID buffer
│   │
│   └── main.ts               # Glue code, UI
│
├── test-files/               # Sample IFC files
└── benchmarks/               # Performance measurements
```

---

### Phase 2: Stress Testing

**Goal:** Find the breaking points.

#### Test Matrix

Performance varies by complexity tier. These targets assume Tier 2 (typical) files:

| File Size | Elements | Triangles | Target Load (Tier 2) | Target FPS |
|-----------|----------|-----------|----------------------|------------|
| 1 MB | 1K | 50K | <0.2s | 60 |
| 10 MB | 10K | 500K | 1-2s | 60 |
| 50 MB | 50K | 2M | 5-10s | 60 |
| 100 MB | 100K | 5M | 10-20s | 60 |
| 500 MB | 500K | 20M | 60-90s | 30 |

*Tier 1 (simple) files load ~2x faster. Tier 3 (complex) files load ~2-3x slower.*

#### Memory Profiling

```typescript
// Track memory at each stage
function logMemory(stage: string) {
  if (performance.memory) {
    console.log(`[${stage}] Heap: ${(performance.memory.usedJSHeapSize / 1e6).toFixed(1)} MB`);
  }
  
  // GPU memory (estimate from buffer sizes)
  console.log(`[${stage}] GPU: ${gpuMemoryTracker.total / 1e6} MB`);
}

logMemory('start');
await parser.scan(buffer);
logMemory('after scan');
await geometry.triangulate();
logMemory('after triangulate');
await renderer.upload();
logMemory('after upload');
```

#### Device Testing

| Device | Browser | Expected Result |
|--------|---------|-----------------|
| MacBook Air M1 | Chrome | Full performance |
| MacBook Air M1 | Safari | Full performance |
| Windows laptop (GTX 1650) | Chrome | Full performance |
| Windows laptop (Intel UHD) | Chrome | Reduced (no discrete GPU) |
| iPad Pro | Safari | Good (test touch) |
| Android tablet | Chrome | Limited (test limits) |
| iPhone 14 | Safari | Limited (memory constrained) |

---

### Phase 3: Risk Reduction

**Goal:** Tackle the scariest unknowns.

#### Risk: Boolean Operations Fail

```typescript
// Test: What happens with complex geometry?

const testCases = [
  'wall-with-openings.ifc',      // Simple boolean
  'curtain-wall-complex.ifc',    // Many booleans
  'mep-penetrations.ifc',        // Pipes through walls
  'stair-with-railings.ifc',     // Thin features
];

for (const file of testCases) {
  const result = await triangulate(file);
  console.log(`${file}: ${result.coverage}% success, ${result.failedTypes}`);
}
```

**Fallback plan:** 
- Show bounding box for failed geometry
- Log which IFC types fail → prioritize fixes

---

#### Risk: WebGPU Not Ready

```typescript
// Test: WebGPU availability and fallback

async function checkGPUSupport() {
  // WebGPU
  if (navigator.gpu) {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      const device = await adapter.requestDevice();
      console.log('WebGPU: ✓', adapter.info);
      return 'webgpu';
    }
  }
  
  // WebGL 2 fallback
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (gl) {
    console.log('WebGL 2: ✓');
    return 'webgl2';
  }
  
  console.log('No GPU support!');
  return 'none';
}
```

**Fallback plan:**
- Build WebGL 2 renderer in parallel (simpler, fewer features)
- Accept lower performance on WebGL path

---

#### Risk: Memory Explosion

```typescript
// Test: Memory scaling behavior

async function memoryScalingTest() {
  const results = [];
  
  for (const size of [10, 50, 100, 200, 500]) {
    // Generate synthetic data of size MB
    const data = generateTestData(size * 1e6);
    
    const before = performance.memory?.usedJSHeapSize ?? 0;
    const parsed = await parse(data);
    const after = performance.memory?.usedJSHeapSize ?? 0;
    
    results.push({
      inputMB: size,
      memoryMB: (after - before) / 1e6,
      ratio: (after - before) / (size * 1e6),
    });
    
    // Cleanup
    parsed.dispose();
    await gc(); // Force GC if exposed
  }
  
  console.table(results);
  // Want: ratio stays constant (linear scaling)
  // Bad: ratio grows (super-linear scaling)
}
```

---

## Quick Feasibility Checklist

```
MUST PASS (deal-breakers):
─────────────────────────
□ Index 100MB in <1s (scan phase)
□ Parse 100MB Tier 2 in <20s (full geometry)
□ Triangulate 80%+ geometry
□ Render 5M triangles @ 60 FPS
□ Memory <20x file size (realistic for complex geometry)
□ WebGPU works on target browsers

SHOULD PASS (important):
─────────────────────────
□ First triangle in <5s for 100MB Tier 2 file
□ Property query <15ms
□ Click-to-select works
□ No browser crashes on 500MB file

NICE TO HAVE (validate later):
─────────────────────────
□ Works on mobile
□ Instancing reduces draw calls 10x
□ LOD generation quality acceptable
```

*Performance targets are tiered. Tier 1 (simple) achieves best-case numbers.*

---

## Decision Framework

```
After Phase 0 (Spikes):
───────────────────────
├── All spikes pass → Continue to Phase 1
├── 1-2 spikes fail → Investigate, maybe continue
└── 3+ spikes fail → Stop, rethink approach

After Phase 1 (Prototype):
───────────────────────
├── Prototype works → Continue to Phase 2
├── Major issues found → Extend prototype phase
└── Fundamental blockers → Stop, document learnings

After Phase 2+3 (Stress + Risk):
───────────────────────
├── All targets achievable → GREEN LIGHT full project
├── Some targets need adjustment → Adjust scope/timeline
└── Critical risks unmitigated → NO-GO or major pivot
```

---

## What Could Kill the Project?

| Blocker | Likelihood | Detection Point |
|---------|------------|-----------------|
| WebGPU too immature | Low | Phase 0, Spike 3 |
| Geometry coverage too low | Medium | Phase 0, Spike 2 |
| Memory scaling non-linear | Low | Phase 2 |
| Boolean ops unreliable | Medium | Phase 3 |
| Performance too variable across devices | Medium | Phase 2 |

**Most likely outcome:** Feasibility confirmed with some scope adjustments (e.g., "mobile support limited to tablets", "500MB files require desktop", or "Tier 3 complex files get degraded experience").

---

## Immediate Next Step

**Start with Spike 1+2:**

1. Download 3-4 test IFC files (1MB, 10MB, 50MB, 100MB)
2. Write simple parser benchmark
3. Test web-ifc triangulation coverage
4. Document results, decide on Phase 1

That's enough to know if the core approach is viable.