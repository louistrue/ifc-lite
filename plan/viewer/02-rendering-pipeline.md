# IFC-Lite Viewer: Part 2 - Rendering Pipeline

## 2.1 WebGPU Rendering Architecture

### Render Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRAME RENDERING PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐                                                            │
│  │ Scene Graph │                                                            │
│  │  Updates    │                                                            │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    GPU CULLING PASS (Compute)                       │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐ │   │
│  │  │ Frustum Cull  │ │ Occlusion     │ │ LOD Selection             │ │   │
│  │  │ (all objects) │ │ Cull (HiZ)    │ │ (screen-space error)      │ │   │
│  │  └───────────────┘ └───────────────┘ └───────────────────────────┘ │   │
│  │                           │                                         │   │
│  │                           ▼                                         │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │              Visible Object List (GPU buffer)                 │ │   │
│  │  │              [drawId, instanceCount, lodLevel, ...]           │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    DEPTH PRE-PASS (Optional)                        │   │
│  │  - Opaque geometry only                                             │   │
│  │  - Builds Hi-Z pyramid for next frame occlusion                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    MAIN COLOR PASS                                  │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐ │   │
│  │  │ Opaque Pass   │ │ Transparency  │ │ Overlay Pass              │ │   │
│  │  │ (front→back)  │ │ (back→front)  │ │ (selection, annotations) │ │   │
│  │  └───────────────┘ └───────────────┘ └───────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    POST-PROCESSING                                  │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐ │   │
│  │  │ SSAO          │ │ Edge Outline  │ │ Tone mapping + FXAA       │ │   │
│  │  │ (optional)    │ │ (selection)   │ │                           │ │   │
│  │  └───────────────┘ └───────────────┘ └───────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                            │
│  │   Present   │                                                            │
│  └─────────────┘                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### WebGPU Pipeline Configuration

```typescript
/**
 * Main render pipeline for opaque geometry.
 */
const opaqueRenderPipeline: GPURenderPipelineDescriptor = {
  label: 'IFC Opaque Pipeline',
  layout: 'auto',
  vertex: {
    module: shaderModule,
    entryPoint: 'vs_main',
    buffers: [
      // Per-vertex attributes
      {
        arrayStride: 24, // 3 floats pos + 3 floats normal
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
          { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
        ],
      },
      // Per-instance attributes
      {
        arrayStride: 80, // 16 floats transform + 4 floats color + objectId
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 2, offset: 0, format: 'float32x4' },  // transform col 0
          { shaderLocation: 3, offset: 16, format: 'float32x4' }, // transform col 1
          { shaderLocation: 4, offset: 32, format: 'float32x4' }, // transform col 2
          { shaderLocation: 5, offset: 48, format: 'float32x4' }, // transform col 3
          { shaderLocation: 6, offset: 64, format: 'float32x4' }, // color override
          { shaderLocation: 7, offset: 76, format: 'uint32' },    // objectId
        ],
      },
    ],
  },
  fragment: {
    module: shaderModule,
    entryPoint: 'fs_main',
    targets: [
      { format: 'bgra8unorm' },           // Color
      { format: 'rg16float' },            // Normal (for edge detection)
      { format: 'r32uint' },              // Object ID (for picking)
    ],
  },
  primitive: {
    topology: 'triangle-list',
    cullMode: 'back',
    frontFace: 'ccw',
  },
  depthStencil: {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: 'less',
  },
  multisample: {
    count: 4, // MSAA
  },
};
```

---

## 2.2 GPU-Driven Culling System

### Frustum + Occlusion Culling Pipeline

```typescript
/**
 * GPU compute shader for frustum and occlusion culling.
 * Processes all objects in parallel, outputs visible list.
 */
const cullingShader = /* wgsl */ `
  struct CameraData {
    viewProj: mat4x4f,
    frustumPlanes: array<vec4f, 6>,
    cameraPos: vec3f,
    nearPlane: f32,
    screenSize: vec2f,
    lodBias: f32,
    frameId: u32,
  }

  struct ObjectData {
    boundingSphere: vec4f,    // xyz = center, w = radius
    boundingBox: array<f32, 6>, // minX, minY, minZ, maxX, maxY, maxZ
    meshId: u32,
    lodLevels: u32,           // Packed: LOD0 offset, LOD1 offset, LOD2 offset, count
    flags: u32,               // bit 0: visible, bit 1: selected, etc.
    expressId: u32,
  }

  struct DrawCommand {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
    meshId: u32,
    lodLevel: u32,
  }

  @group(0) @binding(0) var<uniform> camera: CameraData;
  @group(0) @binding(1) var<storage, read> objects: array<ObjectData>;
  @group(0) @binding(2) var<storage, read_write> drawCommands: array<DrawCommand>;
  @group(0) @binding(3) var<storage, read_write> visibleCount: atomic<u32>;
  @group(0) @binding(4) var hiZTexture: texture_2d<f32>;

  fn sphereInFrustum(center: vec3f, radius: f32) -> bool {
    for (var i = 0u; i < 6u; i++) {
      let plane = camera.frustumPlanes[i];
      let dist = dot(plane.xyz, center) + plane.w;
      if (dist < -radius) {
        return false;
      }
    }
    return true;
  }

  fn calcScreenSpaceError(center: vec3f, radius: f32) -> f32 {
    let dist = distance(camera.cameraPos, center);
    let projectedSize = (radius * camera.screenSize.y) / (dist * camera.nearPlane);
    return projectedSize;
  }

  fn selectLOD(screenSize: f32, lodLevels: u32) -> u32 {
    // LOD thresholds based on screen-space coverage
    if (screenSize > 100.0) { return 0u; }  // Full detail
    if (screenSize > 30.0) { return 1u; }   // Medium
    if (screenSize > 10.0) { return 2u; }   // Low
    return 3u;  // Billboard/proxy
  }

  fn isOccluded(boundingBox: array<f32, 6>) -> bool {
    // Project bounding box to screen, sample Hi-Z at that region
    // Returns true if fully occluded by closer geometry
    // ... Hi-Z sampling logic ...
    return false;
  }

  @compute @workgroup_size(256)
  fn main(@builtin(global_invocation_id) gid: vec3u) {
    let objectIdx = gid.x;
    if (objectIdx >= arrayLength(&objects)) {
      return;
    }

    let obj = objects[objectIdx];
    let center = obj.boundingSphere.xyz;
    let radius = obj.boundingSphere.w;

    // Frustum culling
    if (!sphereInFrustum(center, radius)) {
      return;
    }

    // Occlusion culling (skip for small objects - overhead not worth it)
    if (radius > 1.0 && isOccluded(obj.boundingBox)) {
      return;
    }

    // LOD selection
    let screenSize = calcScreenSpaceError(center, radius);
    let lodLevel = selectLOD(screenSize * camera.lodBias, obj.lodLevels);

    // Skip if too small to see
    if (screenSize < 1.0) {
      return;
    }

    // Add to visible list
    let drawIdx = atomicAdd(&visibleCount, 1u);
    
    drawCommands[drawIdx] = DrawCommand(
      getMeshVertexCount(obj.meshId, lodLevel),
      1u,
      getMeshVertexOffset(obj.meshId, lodLevel),
      objectIdx,
      obj.meshId,
      lodLevel
    );
  }
`;
```

### Culling Statistics

```typescript
interface CullingStats {
  totalObjects: number;
  frustumCulled: number;
  occlusionCulled: number;
  lodCulled: number;        // Too small to render
  visibleObjects: number;
  drawCalls: number;        // After batching
  trianglesRendered: number;
  
  // Performance
  cullingTimeMs: number;
  batchingTimeMs: number;
}

// Example stats for 100K object scene:
// totalObjects: 100,000
// frustumCulled: 70,000 (70%)
// occlusionCulled: 15,000 (15%)
// lodCulled: 5,000 (5%)
// visibleObjects: 10,000 (10%)
// drawCalls: 50 (after batching)
// trianglesRendered: 500,000
```

---

## 2.3 Dynamic LOD System

### LOD Level Definition

```typescript
/**
 * LOD configuration per geometry type.
 */
interface LODConfig {
  // Screen-space pixel thresholds for LOD transitions
  thresholds: [number, number, number]; // LOD0→1, LOD1→2, LOD2→proxy
  
  // Simplification ratios
  simplificationRatios: [number, number, number]; // LOD0=1.0, LOD1, LOD2
  
  // Transition style
  transition: 'instant' | 'dither' | 'blend';
  
  // Proxy type for very distant objects
  proxyType: 'billboard' | 'box' | 'point' | 'none';
}

const DEFAULT_LOD_CONFIG: LODConfig = {
  thresholds: [100, 30, 10],           // pixels on screen
  simplificationRatios: [1.0, 0.3, 0.1],
  transition: 'dither',
  proxyType: 'box',
};

// Special configs for specific element types
const LOD_CONFIGS: Record<string, LODConfig> = {
  'IfcWall': {
    thresholds: [150, 50, 15],
    simplificationRatios: [1.0, 0.5, 0.2],
    transition: 'dither',
    proxyType: 'box',
  },
  'IfcDoor': {
    thresholds: [80, 25, 8],
    simplificationRatios: [1.0, 0.3, 0.1],
    transition: 'dither',
    proxyType: 'billboard',
  },
  'IfcFurniture': {
    thresholds: [50, 15, 5],
    simplificationRatios: [1.0, 0.2, 0.05],
    transition: 'instant',
    proxyType: 'point',
  },
  'IfcFastener': {
    thresholds: [20, 8, 3],
    simplificationRatios: [1.0, 0.1, 0],
    transition: 'instant',
    proxyType: 'none',
  },
};
```

### LOD Generation Pipeline

```typescript
/**
 * Background worker for LOD mesh generation.
 */
class LODGenerator {
  private meshoptimizer: MeshOptimizerWasm;
  private queue: PriorityQueue<LODJob>;
  private cache: Map<string, LODMeshSet>;
  
  /**
   * Generate LOD meshes for a given geometry.
   */
  async generateLODs(
    mesh: ColumnarMesh,
    config: LODConfig
  ): Promise<LODMeshSet> {
    const cacheKey = this.computeMeshHash(mesh);
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    const lods: LODMesh[] = [
      { level: 0, mesh, triangleCount: mesh.indices.length / 3 },
    ];
    
    // Generate simplified LODs
    for (let level = 1; level <= 2; level++) {
      const targetRatio = config.simplificationRatios[level];
      const targetTriangles = Math.floor(lods[0].triangleCount * targetRatio);
      
      if (targetTriangles < 12) {
        // Too few triangles, skip this LOD
        break;
      }
      
      const simplified = await this.meshoptimizer.simplify(
        mesh.positions,
        mesh.indices,
        targetTriangles,
        0.01 // target error
      );
      
      // Recompute normals for simplified mesh
      const normals = this.computeNormals(simplified.positions, simplified.indices);
      
      lods.push({
        level,
        mesh: {
          ...mesh,
          positions: simplified.positions,
          indices: simplified.indices,
          normals,
        },
        triangleCount: simplified.indices.length / 3,
      });
    }
    
    // Generate proxy (billboard or bounding box)
    const proxy = this.generateProxy(mesh, config.proxyType);
    
    const lodSet: LODMeshSet = { lods, proxy, config };
    this.cache.set(cacheKey, lodSet);
    
    return lodSet;
  }
  
  /**
   * Generate billboard impostor for distant viewing.
   */
  private generateBillboard(mesh: ColumnarMesh): BillboardProxy {
    // Render mesh from 6 directions to create impostor atlas
    const atlas = this.renderImpostorAtlas(mesh, 6);
    
    return {
      type: 'billboard',
      atlas,
      center: this.computeCenter(mesh),
      size: this.computeBoundingSize(mesh),
    };
  }
  
  /**
   * Generate oriented bounding box proxy.
   */
  private generateBoxProxy(mesh: ColumnarMesh): BoxProxy {
    const obb = this.computeOBB(mesh);
    
    return {
      type: 'box',
      center: obb.center,
      halfExtents: obb.halfExtents,
      rotation: obb.rotation,
      color: this.computeAverageColor(mesh),
    };
  }
}

interface LODMeshSet {
  lods: LODMesh[];
  proxy: BillboardProxy | BoxProxy | null;
  config: LODConfig;
}

interface LODMesh {
  level: number;
  mesh: ColumnarMesh;
  triangleCount: number;
}
```

### LOD Transition Shader

```wgsl
// Dithered LOD transition to avoid popping
fn applyLODDither(
  fragCoord: vec2f,
  lodBlend: f32,  // 0.0 = current LOD, 1.0 = next LOD
  frameId: u32
) -> bool {
  // Bayer matrix dithering
  let bayerMatrix = array<f32, 16>(
    0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
    12.0/16.0, 4.0/16.0, 14.0/16.0,  6.0/16.0,
    3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
    15.0/16.0, 7.0/16.0, 13.0/16.0,  5.0/16.0
  );
  
  let x = u32(fragCoord.x) % 4u;
  let y = u32(fragCoord.y) % 4u;
  let threshold = bayerMatrix[y * 4u + x];
  
  // Animate threshold over frames for temporal stability
  let animatedThreshold = fract(threshold + f32(frameId % 16u) / 16.0);
  
  return lodBlend > animatedThreshold;
}
```

---

## 2.4 Instancing System

### Instance Detection and Batching

```typescript
/**
 * Automatic detection of repeated geometry for instancing.
 */
class InstancingManager {
  private prototypes: Map<string, GeometryPrototype> = new Map();
  private instances: Map<string, InstanceBatch> = new Map();
  
  /**
   * Analyze model and create instanced batches.
   */
  async analyzeAndBatch(store: IfcDataStore): Promise<BatchingResult> {
    // Step 1: Hash all geometries
    const geometryHashes = new Map<number, string>();
    const hashCounts = new Map<string, number>();
    
    for (let i = 0; i < store.geometry.meshes.count; i++) {
      const expressId = store.geometry.meshes.expressId[i];
      const mesh = store.geometry.getMesh(expressId);
      if (!mesh) continue;
      
      const hash = this.computeGeometryHash(mesh);
      geometryHashes.set(expressId, hash);
      hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
    }
    
    // Step 2: Identify prototypes (geometry used more than once)
    for (const [hash, count] of hashCounts) {
      if (count >= 2) {
        // This geometry is worth instancing
        const firstInstance = this.findFirstWithHash(geometryHashes, hash);
        const mesh = store.geometry.getMesh(firstInstance)!;
        
        this.prototypes.set(hash, {
          hash,
          mesh,
          gpuBuffer: null, // Will be created on upload
          instanceCount: count,
        });
      }
    }
    
    // Step 3: Create instance batches
    for (const [expressId, hash] of geometryHashes) {
      const prototype = this.prototypes.get(hash);
      
      if (prototype) {
        // Add to instanced batch
        let batch = this.instances.get(hash);
        if (!batch) {
          batch = {
            prototype,
            transforms: [],
            objectIds: [],
            colors: [],
          };
          this.instances.set(hash, batch);
        }
        
        const transform = this.getObjectTransform(store, expressId);
        batch.transforms.push(transform);
        batch.objectIds.push(expressId);
        batch.colors.push([1, 1, 1, 1]); // Default color
      }
    }
    
    // Step 4: Create GPU buffers
    await this.uploadToGPU();
    
    return {
      uniqueGeometries: this.prototypes.size,
      totalInstances: [...this.instances.values()].reduce((a, b) => a + b.objectIds.length, 0),
      memoryReduction: this.calculateMemoryReduction(),
      drawCallReduction: this.calculateDrawCallReduction(),
    };
  }
  
  /**
   * Compute geometry hash for deduplication.
   */
  private computeGeometryHash(mesh: ColumnarMesh): string {
    // Fast hash based on vertex count, triangle count, and bounds
    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;
    const bounds = mesh.bounds;
    
    // Sample some vertices for the hash
    const samples: number[] = [];
    const sampleCount = Math.min(10, vertexCount);
    const step = Math.floor(vertexCount / sampleCount);
    
    for (let i = 0; i < sampleCount; i++) {
      const idx = i * step * 3;
      samples.push(
        Math.round(mesh.positions[idx] * 1000),
        Math.round(mesh.positions[idx + 1] * 1000),
        Math.round(mesh.positions[idx + 2] * 1000)
      );
    }
    
    return `${vertexCount}_${triangleCount}_${samples.join('_')}`;
  }
  
  /**
   * Upload instance data to GPU.
   */
  private async uploadToGPU(): Promise<void> {
    for (const [hash, batch] of this.instances) {
      const instanceCount = batch.objectIds.length;
      
      // Create instance buffer
      // Layout: mat4x4 transform (64 bytes) + vec4 color (16 bytes) + uint objectId (4 bytes)
      const instanceData = new ArrayBuffer(instanceCount * 84);
      const floatView = new Float32Array(instanceData);
      const uintView = new Uint32Array(instanceData);
      
      for (let i = 0; i < instanceCount; i++) {
        const offset = i * 21; // 84 bytes / 4 = 21 floats
        
        // Transform (16 floats)
        floatView.set(batch.transforms[i], offset);
        
        // Color (4 floats)
        floatView.set(batch.colors[i], offset + 16);
        
        // Object ID (1 uint)
        uintView[offset + 20] = batch.objectIds[i];
      }
      
      batch.gpuInstanceBuffer = device.createBuffer({
        size: instanceData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      
      new Uint8Array(batch.gpuInstanceBuffer.getMappedRange()).set(new Uint8Array(instanceData));
      batch.gpuInstanceBuffer.unmap();
    }
  }
}

interface GeometryPrototype {
  hash: string;
  mesh: ColumnarMesh;
  gpuBuffer: GPUBuffer | null;
  lodBuffers?: GPUBuffer[];
  instanceCount: number;
}

interface InstanceBatch {
  prototype: GeometryPrototype;
  transforms: Float32Array[];
  objectIds: number[];
  colors: [number, number, number, number][];
  gpuInstanceBuffer?: GPUBuffer;
}

interface BatchingResult {
  uniqueGeometries: number;
  totalInstances: number;
  memoryReduction: number;  // Percentage
  drawCallReduction: number; // Percentage
}
```

### Instance Culling on GPU

```wgsl
// Per-instance frustum culling
@compute @workgroup_size(256)
fn cullInstances(@builtin(global_invocation_id) gid: vec3u) {
  let instanceIdx = gid.x;
  if (instanceIdx >= instanceCount) {
    return;
  }

  // Read instance transform
  let transform = instanceTransforms[instanceIdx];
  
  // Transform prototype bounding sphere to world space
  let worldCenter = (transform * vec4f(prototypeBounds.center, 1.0)).xyz;
  let worldRadius = prototypeBounds.radius * maxScale(transform);
  
  // Frustum test
  if (!sphereInFrustum(worldCenter, worldRadius)) {
    // Mark as culled
    instanceVisibility[instanceIdx] = 0u;
    return;
  }
  
  // Screen-space size for LOD
  let screenSize = calcScreenSize(worldCenter, worldRadius);
  
  // Select LOD level
  let lodLevel = selectLOD(screenSize);
  
  // Write to compacted visible list
  let visibleIdx = atomicAdd(&visibleInstanceCount, 1u);
  visibleInstances[visibleIdx] = VisibleInstance(
    instanceIdx,
    lodLevel,
    screenSize
  );
}
```

---

## 2.5 Material and Shading System

### PBR Material Pipeline

```typescript
/**
 * Material system with IFC style support.
 */
interface IFCMaterial {
  // Base PBR properties
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  
  // IFC-specific
  transparency: number;
  reflectance: number;
  
  // Rendering hints
  doubleSided: boolean;
  alphaMode: 'opaque' | 'mask' | 'blend';
  alphaCutoff: number;
}

// Default materials for IFC types (when model doesn't specify)
const DEFAULT_MATERIALS: Record<string, IFCMaterial> = {
  'IfcWall': {
    baseColor: [0.9, 0.9, 0.85, 1.0],
    metallic: 0.0,
    roughness: 0.8,
    transparency: 0.0,
    reflectance: 0.04,
    doubleSided: false,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
  },
  'IfcSlab': {
    baseColor: [0.85, 0.85, 0.8, 1.0],
    metallic: 0.0,
    roughness: 0.9,
    transparency: 0.0,
    reflectance: 0.04,
    doubleSided: false,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
  },
  'IfcWindow': {
    baseColor: [0.6, 0.8, 0.9, 0.3],
    metallic: 0.0,
    roughness: 0.1,
    transparency: 0.7,
    reflectance: 0.5,
    doubleSided: false,
    alphaMode: 'blend',
    alphaCutoff: 0.5,
  },
  'IfcDoor': {
    baseColor: [0.6, 0.4, 0.2, 1.0],
    metallic: 0.0,
    roughness: 0.6,
    transparency: 0.0,
    reflectance: 0.04,
    doubleSided: false,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
  },
  'IfcColumn': {
    baseColor: [0.7, 0.7, 0.7, 1.0],
    metallic: 0.0,
    roughness: 0.5,
    transparency: 0.0,
    reflectance: 0.04,
    doubleSided: false,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
  },
  'IfcBeam': {
    baseColor: [0.5, 0.5, 0.55, 1.0],
    metallic: 0.8,
    roughness: 0.4,
    transparency: 0.0,
    reflectance: 0.5,
    doubleSided: false,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
  },
  // ... more types
};
```

### Fragment Shader

```wgsl
struct FragmentInput {
  @builtin(position) fragCoord: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) color: vec4f,
  @location(3) @interpolate(flat) objectId: u32,
}

struct FragmentOutput {
  @location(0) color: vec4f,
  @location(1) normal: vec2f,
  @location(2) objectId: u32,
}

@fragment
fn fs_main(in: FragmentInput) -> FragmentOutput {
  var out: FragmentOutput;
  
  // Get material properties
  let material = getMaterial(in.objectId);
  let baseColor = material.baseColor * in.color;
  
  // Normal mapping (if available)
  let N = normalize(in.worldNormal);
  
  // View direction
  let V = normalize(camera.position - in.worldPos);
  
  // Simple directional light
  let L = normalize(vec3f(0.5, 1.0, 0.3));
  let H = normalize(V + L);
  
  // PBR lighting
  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  
  // Fresnel (Schlick)
  let F0 = mix(vec3f(0.04), baseColor.rgb, material.metallic);
  let F = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
  
  // Distribution (GGX)
  let roughness2 = material.roughness * material.roughness;
  let denom = NdotH * NdotH * (roughness2 - 1.0) + 1.0;
  let D = roughness2 / (PI * denom * denom);
  
  // Geometry (Smith GGX)
  let k = (material.roughness + 1.0) * (material.roughness + 1.0) / 8.0;
  let G1_V = NdotV / (NdotV * (1.0 - k) + k);
  let G1_L = NdotL / (NdotL * (1.0 - k) + k);
  let G = G1_V * G1_L;
  
  // Specular BRDF
  let specular = (D * F * G) / (4.0 * NdotV * NdotL + 0.001);
  
  // Diffuse
  let kD = (1.0 - F) * (1.0 - material.metallic);
  let diffuse = kD * baseColor.rgb / PI;
  
  // Final color
  let lightColor = vec3f(1.0, 0.98, 0.95);
  let ambient = vec3f(0.2, 0.22, 0.25) * baseColor.rgb;
  let color = ambient + (diffuse + specular) * lightColor * NdotL;
  
  // Tone mapping (ACES)
  let mapped = acesToneMap(color);
  
  // Selection highlight
  if (isSelected(in.objectId)) {
    let highlight = vec3f(0.2, 0.5, 1.0);
    mapped = mix(mapped, highlight, 0.3 + 0.1 * sin(time * 3.0));
  }
  
  out.color = vec4f(mapped, baseColor.a);
  out.normal = encodeNormal(N);
  out.objectId = in.objectId;
  
  return out;
}
```

---

## 2.6 Section Planes and Clipping

```typescript
/**
 * Section plane manager for architectural sections.
 */
class SectionPlaneManager {
  private planes: SectionPlane[] = [];
  private gpuBuffer: GPUBuffer;
  private maxPlanes = 6;
  
  /**
   * Add a section plane.
   */
  addPlane(plane: SectionPlane): number {
    if (this.planes.length >= this.maxPlanes) {
      throw new Error(`Maximum ${this.maxPlanes} section planes supported`);
    }
    
    this.planes.push(plane);
    this.updateGPUBuffer();
    
    return this.planes.length - 1;
  }
  
  /**
   * Update plane position/orientation.
   */
  updatePlane(index: number, plane: Partial<SectionPlane>): void {
    Object.assign(this.planes[index], plane);
    this.updateGPUBuffer();
  }
  
  private updateGPUBuffer(): void {
    // Pack planes into GPU buffer
    // Format: vec4 (normal.xyz, distance) per plane
    const data = new Float32Array(this.maxPlanes * 4);
    
    for (let i = 0; i < this.planes.length; i++) {
      const p = this.planes[i];
      data[i * 4 + 0] = p.normal[0];
      data[i * 4 + 1] = p.normal[1];
      data[i * 4 + 2] = p.normal[2];
      data[i * 4 + 3] = -vec3.dot(p.normal, p.position);
    }
    
    // Mark unused planes
    for (let i = this.planes.length; i < this.maxPlanes; i++) {
      data[i * 4 + 3] = 1e10; // Very far, never clips
    }
    
    device.queue.writeBuffer(this.gpuBuffer, 0, data);
  }
}

interface SectionPlane {
  position: [number, number, number];
  normal: [number, number, number];
  enabled: boolean;
  showCaps: boolean;
  capColor: [number, number, number, number];
}
```

### Section Plane Shader

```wgsl
// In fragment shader
fn applySectionPlanes(worldPos: vec3f) -> bool {
  for (var i = 0u; i < activePlaneCount; i++) {
    let plane = sectionPlanes[i];
    let distance = dot(plane.xyz, worldPos) + plane.w;
    
    if (distance < 0.0) {
      discard;
    }
  }
  return true;
}

// Section cap rendering (separate pass)
@fragment
fn fs_sectionCap(in: FragmentInput) -> @location(0) vec4f {
  // Render cut faces with section cap color
  // These are generated by finding triangles that cross the plane
  return sectionCapColor;
}
```

---

## Related Specifications

For detailed implementation strategies on critical rendering challenges, see:

- **[Part 8: Critical Solutions](../08-critical-solutions.md)** - Section plane caps, instance detection, large coordinate handling

---

*Continue to Part 3: Data Management*
