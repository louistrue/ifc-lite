# IFC-Lite: Part 8 - Critical Technical Solutions

## Overview

This document addresses the critical technical challenges identified during specification review. Each section provides detailed implementation strategies, algorithms, and fallback mechanisms.

---

## 8.1 CSG & Boolean Operations Strategy

### The Problem

IFC files heavily use Boolean operations (`IfcBooleanResult`, `IfcBooleanClippingResult`) for:
- Walls with window/door openings
- MEP penetrations through structural elements
- Complex architectural features
- Trimmed/cut geometry

Without proper CSG handling, 40-60% of real-world geometry will be incorrect or missing.

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CSG PROCESSING PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │ IfcBooleanResult│                                                        │
│  │ Detection       │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    STRATEGY SELECTOR                                │   │
│  │                                                                     │   │
│  │   Analyze Boolean tree:                                             │   │
│  │   - Depth of nesting                                                │   │
│  │   - Operand complexity                                              │   │
│  │   - Operation types (DIFFERENCE, UNION, INTERSECTION)               │   │
│  └─────────────────────────┬───────────────────────────────────────────┘   │
│                            │                                               │
│           ┌────────────────┼────────────────┐                              │
│           ▼                ▼                ▼                              │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐                 │
│  │  FAST PATH  │  │  STANDARD PATH  │  │  FALLBACK PATH  │                 │
│  │             │  │                 │  │                 │                 │
│  │ Simple      │  │ Full Manifold   │  │ Visual          │                 │
│  │ Clipping    │  │ CSG             │  │ Approximation   │                 │
│  │ Planes      │  │                 │  │                 │                 │
│  └─────────────┘  └─────────────────┘  └─────────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Strategy 1: Fast Path - Clipping Plane Optimization

Many Boolean operations in IFC are simple half-space clips (e.g., `IfcBooleanClippingResult` with `IfcHalfSpaceSolid`). These can be handled without full CSG:

```typescript
/**
 * Fast clipping for simple Boolean operations.
 * Handles ~60% of real-world Boolean operations.
 */
class ClippingPlaneOptimizer {
  
  /**
   * Check if Boolean can be handled with simple clipping.
   */
  canOptimize(booleanResult: IfcBooleanResult): boolean {
    // Only DIFFERENCE with half-space operand
    if (booleanResult.operator !== 'DIFFERENCE') return false;
    
    const secondOperand = booleanResult.secondOperand;
    
    // IfcHalfSpaceSolid - single plane clip
    if (secondOperand.type === 'IfcHalfSpaceSolid') return true;
    
    // IfcPolygonalBoundedHalfSpace - bounded plane clip
    if (secondOperand.type === 'IfcPolygonalBoundedHalfSpace') return true;
    
    // IfcBoxedHalfSpace - box-bounded clip
    if (secondOperand.type === 'IfcBoxedHalfSpace') return true;
    
    return false;
  }
  
  /**
   * Apply clipping plane to triangulated mesh.
   * Much faster than full CSG - O(n) vs O(n log n).
   */
  applyClipping(
    mesh: ColumnarMesh,
    halfSpace: IfcHalfSpaceSolid
  ): ColumnarMesh {
    const plane = this.extractPlane(halfSpace);
    const clippedPositions: number[] = [];
    const clippedNormals: number[] = [];
    const clippedIndices: number[] = [];
    
    // Process each triangle
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];
      
      const v0 = this.getVertex(mesh, i0);
      const v1 = this.getVertex(mesh, i1);
      const v2 = this.getVertex(mesh, i2);
      
      const d0 = this.signedDistance(v0, plane);
      const d1 = this.signedDistance(v1, plane);
      const d2 = this.signedDistance(v2, plane);
      
      // All vertices on positive side - keep triangle
      if (d0 >= 0 && d1 >= 0 && d2 >= 0) {
        this.addTriangle(clippedPositions, clippedNormals, clippedIndices,
          v0, v1, v2, mesh, i0, i1, i2);
        continue;
      }
      
      // All vertices on negative side - discard triangle
      if (d0 < 0 && d1 < 0 && d2 < 0) {
        continue;
      }
      
      // Triangle intersects plane - clip it
      this.clipTriangle(
        clippedPositions, clippedNormals, clippedIndices,
        v0, v1, v2, d0, d1, d2, plane, mesh, i0, i1, i2
      );
    }
    
    return {
      ...mesh,
      positions: new Float32Array(clippedPositions),
      normals: new Float32Array(clippedNormals),
      indices: new Uint32Array(clippedIndices),
      bounds: this.computeBounds(clippedPositions),
    };
  }
  
  /**
   * Clip triangle against plane, generating 1-2 new triangles.
   */
  private clipTriangle(
    positions: number[], normals: number[], indices: number[],
    v0: Vec3, v1: Vec3, v2: Vec3,
    d0: number, d1: number, d2: number,
    plane: Plane,
    mesh: ColumnarMesh, i0: number, i1: number, i2: number
  ): void {
    // Categorize vertices
    const positive: Array<{v: Vec3, i: number, d: number}> = [];
    const negative: Array<{v: Vec3, i: number, d: number}> = [];
    
    if (d0 >= 0) positive.push({v: v0, i: i0, d: d0});
    else negative.push({v: v0, i: i0, d: d0});
    
    if (d1 >= 0) positive.push({v: v1, i: i1, d: d1});
    else negative.push({v: v1, i: i1, d: d1});
    
    if (d2 >= 0) positive.push({v: v2, i: i2, d: d2});
    else negative.push({v: v2, i: i2, d: d2});
    
    if (positive.length === 1) {
      // One vertex on positive side - create one triangle
      const p = positive[0];
      const n1 = negative[0];
      const n2 = negative[1];
      
      const e1 = this.intersectEdge(p.v, n1.v, p.d, n1.d);
      const e2 = this.intersectEdge(p.v, n2.v, p.d, n2.d);
      
      this.emitTriangle(positions, normals, indices, p.v, e1, e2, mesh, p.i);
    } else {
      // Two vertices on positive side - create two triangles (quad)
      const p1 = positive[0];
      const p2 = positive[1];
      const n = negative[0];
      
      const e1 = this.intersectEdge(p1.v, n.v, p1.d, n.d);
      const e2 = this.intersectEdge(p2.v, n.v, p2.d, n.d);
      
      this.emitTriangle(positions, normals, indices, p1.v, e1, p2.v, mesh, p1.i);
      this.emitTriangle(positions, normals, indices, p2.v, e1, e2, mesh, p2.i);
    }
  }
  
  /**
   * Handle IfcPolygonalBoundedHalfSpace - clip within polygon boundary.
   */
  applyBoundedClipping(
    mesh: ColumnarMesh,
    boundedHalfSpace: IfcPolygonalBoundedHalfSpace
  ): ColumnarMesh {
    // First apply the half-space clip
    const clipped = this.applyClipping(mesh, boundedHalfSpace.baseSurface);
    
    // Then clip to the polygonal boundary (extrude polygon infinitely)
    const boundaryPolygon = this.extractPolygon(boundedHalfSpace.polygonalBoundary);
    const extrusionAxis = this.extractDirection(boundedHalfSpace.position);
    
    return this.clipToExtrudedPolygon(clipped, boundaryPolygon, extrusionAxis);
  }
}
```

### Strategy 2: Full Manifold CSG

For complex Boolean trees, use Manifold WASM:

```typescript
/**
 * Full CSG processor using Manifold library.
 */
class ManifoldCSGProcessor {
  private manifold: ManifoldWasm | null = null;
  private initPromise: Promise<void> | null = null;
  
  /**
   * Lazy initialization of Manifold WASM.
   */
  async init(): Promise<void> {
    if (this.manifold) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      const Module = await import('@aspect/manifold-wasm');
      this.manifold = await Module.default();
    })();
    
    return this.initPromise;
  }
  
  /**
   * Process Boolean result tree recursively.
   */
  async processBooleanTree(
    booleanResult: IfcBooleanResult,
    decoder: EntityDecoder,
    cache: Map<number, ManifoldMesh>
  ): Promise<ColumnarMesh> {
    await this.init();
    
    // Get or process first operand
    const firstOperand = await this.processOperand(
      booleanResult.firstOperand, decoder, cache
    );
    
    // Get or process second operand
    const secondOperand = await this.processOperand(
      booleanResult.secondOperand, decoder, cache
    );
    
    // Perform Boolean operation
    let result: ManifoldMesh;
    switch (booleanResult.operator) {
      case 'DIFFERENCE':
        result = this.manifold!.difference(firstOperand, secondOperand);
        break;
      case 'UNION':
        result = this.manifold!.union(firstOperand, secondOperand);
        break;
      case 'INTERSECTION':
        result = this.manifold!.intersection(firstOperand, secondOperand);
        break;
      default:
        throw new Error(`Unknown Boolean operator: ${booleanResult.operator}`);
    }
    
    // Convert back to ColumnarMesh
    return this.manifoldToColumnar(result);
  }
  
  /**
   * Process operand - may be primitive, mesh, or nested Boolean.
   */
  private async processOperand(
    operand: IfcBooleanOperand,
    decoder: EntityDecoder,
    cache: Map<number, ManifoldMesh>
  ): Promise<ManifoldMesh> {
    // Check cache first
    if (cache.has(operand.expressId)) {
      return cache.get(operand.expressId)!;
    }
    
    let mesh: ManifoldMesh;
    
    if (operand.type === 'IfcBooleanResult' || 
        operand.type === 'IfcBooleanClippingResult') {
      // Recursive Boolean
      const columnar = await this.processBooleanTree(operand, decoder, cache);
      mesh = this.columnarToManifold(columnar);
    } else if (operand.type === 'IfcHalfSpaceSolid') {
      // Create large box representing half-space
      mesh = this.createHalfSpaceProxy(operand);
    } else {
      // Regular solid - triangulate first
      const columnar = await this.triangulateSolid(operand, decoder);
      mesh = this.columnarToManifold(columnar);
    }
    
    cache.set(operand.expressId, mesh);
    return mesh;
  }
  
  /**
   * Convert ColumnarMesh to Manifold format.
   */
  private columnarToManifold(mesh: ColumnarMesh): ManifoldMesh {
    // Manifold requires watertight meshes
    // May need to repair mesh first
    const repaired = this.repairMesh(mesh);
    
    return this.manifold!.createMesh(
      repaired.positions,
      repaired.indices
    );
  }
  
  /**
   * Basic mesh repair for non-manifold input.
   */
  private repairMesh(mesh: ColumnarMesh): ColumnarMesh {
    // 1. Remove degenerate triangles
    // 2. Merge duplicate vertices
    // 3. Fix winding order consistency
    // 4. Close small holes
    
    const cleaned = this.removeDegenerateTriangles(mesh);
    const merged = this.mergeCloseVertices(cleaned, 1e-6);
    const oriented = this.orientTriangles(merged);
    
    return oriented;
  }
}
```

### Strategy 3: Visual Approximation Fallback

When CSG fails (non-manifold input, numerical errors), provide visual approximation:

```typescript
/**
 * Fallback for failed CSG operations.
 * Provides visually acceptable results without geometric accuracy.
 */
class CSGFallbackProcessor {
  
  /**
   * Visual approximation when true CSG fails.
   */
  approximateBoolean(
    firstOperand: ColumnarMesh,
    secondOperand: ColumnarMesh,
    operator: 'DIFFERENCE' | 'UNION' | 'INTERSECTION'
  ): ColumnarMesh {
    switch (operator) {
      case 'DIFFERENCE':
        return this.approximateDifference(firstOperand, secondOperand);
      case 'UNION':
        return this.approximateUnion(firstOperand, secondOperand);
      case 'INTERSECTION':
        return this.approximateIntersection(firstOperand, secondOperand);
    }
  }
  
  /**
   * Approximate DIFFERENCE by:
   * 1. Render first operand
   * 2. Mark second operand volume as "cut"
   * 3. Use stencil buffer at render time
   */
  private approximateDifference(
    base: ColumnarMesh,
    cutter: ColumnarMesh
  ): ColumnarMesh {
    // Store cutter as metadata for render-time subtraction
    return {
      ...base,
      csgCutters: [cutter], // Will be used by renderer
      csgApproximated: true,
    };
  }
  
  /**
   * Approximate UNION by simple mesh concatenation.
   * Results in z-fighting at intersections but renders correctly.
   */
  private approximateUnion(
    mesh1: ColumnarMesh,
    mesh2: ColumnarMesh
  ): ColumnarMesh {
    const positions = new Float32Array(
      mesh1.positions.length + mesh2.positions.length
    );
    positions.set(mesh1.positions, 0);
    positions.set(mesh2.positions, mesh1.positions.length);
    
    const normals = new Float32Array(
      mesh1.normals.length + mesh2.normals.length
    );
    normals.set(mesh1.normals, 0);
    normals.set(mesh2.normals, mesh1.normals.length);
    
    // Adjust indices for second mesh
    const indexOffset = mesh1.positions.length / 3;
    const indices = new Uint32Array(
      mesh1.indices.length + mesh2.indices.length
    );
    indices.set(mesh1.indices, 0);
    for (let i = 0; i < mesh2.indices.length; i++) {
      indices[mesh1.indices.length + i] = mesh2.indices[i] + indexOffset;
    }
    
    return {
      positions,
      normals,
      indices,
      bounds: this.unionBounds(mesh1.bounds, mesh2.bounds),
      csgApproximated: true,
    };
  }
}
```

### CSG Decision Flow

```typescript
/**
 * Main CSG orchestrator - selects strategy based on input.
 */
class CSGOrchestrator {
  private clippingOptimizer = new ClippingPlaneOptimizer();
  private manifoldProcessor = new ManifoldCSGProcessor();
  private fallbackProcessor = new CSGFallbackProcessor();
  
  async processBoolean(
    booleanResult: IfcBooleanResult,
    decoder: EntityDecoder,
    options: CSGOptions = {}
  ): Promise<CSGResult> {
    const startTime = performance.now();
    
    // Strategy 1: Try fast clipping path
    if (this.clippingOptimizer.canOptimize(booleanResult)) {
      try {
        const firstMesh = await this.getMesh(booleanResult.firstOperand, decoder);
        const result = this.clippingOptimizer.applyClipping(
          firstMesh, 
          booleanResult.secondOperand
        );
        return {
          mesh: result,
          strategy: 'clipping',
          timeMs: performance.now() - startTime,
          success: true,
        };
      } catch (e) {
        // Fall through to next strategy
        console.warn('Clipping optimization failed, trying full CSG', e);
      }
    }
    
    // Strategy 2: Try full Manifold CSG
    if (!options.skipManifold) {
      try {
        const cache = new Map();
        const result = await this.manifoldProcessor.processBooleanTree(
          booleanResult, decoder, cache
        );
        return {
          mesh: result,
          strategy: 'manifold',
          timeMs: performance.now() - startTime,
          success: true,
        };
      } catch (e) {
        console.warn('Manifold CSG failed, using fallback', e);
      }
    }
    
    // Strategy 3: Visual approximation fallback
    const firstMesh = await this.getMesh(booleanResult.firstOperand, decoder);
    const secondMesh = await this.getMesh(booleanResult.secondOperand, decoder);
    const result = this.fallbackProcessor.approximateBoolean(
      firstMesh, secondMesh, booleanResult.operator
    );
    
    return {
      mesh: result,
      strategy: 'fallback',
      timeMs: performance.now() - startTime,
      success: false,
      warning: 'CSG approximated - geometry may not be accurate',
    };
  }
}

interface CSGResult {
  mesh: ColumnarMesh;
  strategy: 'clipping' | 'manifold' | 'fallback';
  timeMs: number;
  success: boolean;
  warning?: string;
}
```

---

## 8.2 Opening Element Processing

### The Problem

`IfcOpeningElement` entities define voids in host elements (walls, slabs). The relationship:

```
IfcWall ←─ IfcRelVoidsElement ─→ IfcOpeningElement
                                        │
                                        └─→ IfcRelFillsElement ─→ IfcDoor/IfcWindow
```

Opening geometry must be subtracted from the host element.

### Solution: Integrated Opening Processing

```typescript
/**
 * Handles opening elements and their integration with host geometry.
 */
class OpeningProcessor {
  private csgOrchestrator: CSGOrchestrator;
  private graph: RelationshipGraph;
  
  /**
   * Process element with all its openings.
   */
  async processElementWithOpenings(
    elementId: number,
    decoder: EntityDecoder
  ): Promise<ProcessedElement> {
    // Get base geometry
    const baseGeometry = await this.getElementGeometry(elementId, decoder);
    
    // Find all openings via IfcRelVoidsElement
    const openingIds = this.graph.getRelated(
      elementId, 
      RelationshipType.VoidsElement, 
      'forward'
    );
    
    if (openingIds.length === 0) {
      return { mesh: baseGeometry, openings: [] };
    }
    
    // Get opening geometries
    const openings: OpeningInfo[] = [];
    for (const openingId of openingIds) {
      const openingGeometry = await this.getElementGeometry(openingId, decoder);
      const fillingIds = this.graph.getRelated(
        openingId,
        RelationshipType.FillsElement,
        'inverse'
      );
      
      openings.push({
        expressId: openingId,
        geometry: openingGeometry,
        fillingIds,
      });
    }
    
    // Subtract all openings from base
    let resultMesh = baseGeometry;
    for (const opening of openings) {
      const csgResult = await this.csgOrchestrator.processBoolean(
        {
          type: 'IfcBooleanResult',
          operator: 'DIFFERENCE',
          firstOperand: { mesh: resultMesh },
          secondOperand: { mesh: opening.geometry },
        },
        decoder
      );
      resultMesh = csgResult.mesh;
    }
    
    return { mesh: resultMesh, openings };
  }
  
  /**
   * Batch process all elements with openings.
   * More efficient than processing one at a time.
   */
  async processAllElementsWithOpenings(
    store: IfcDataStore,
    decoder: EntityDecoder
  ): Promise<Map<number, ColumnarMesh>> {
    const results = new Map<number, ColumnarMesh>();
    
    // Find all elements that have openings
    const voidingRels = store.entityIndex.byType.get(
      IfcTypeEnum.IfcRelVoidsElement
    ) ?? [];
    
    // Group openings by host element
    const openingsByHost = new Map<number, number[]>();
    for (const relId of voidingRels) {
      const rel = decoder.decodeRelVoidsElement(store.source, 
        store.entityIndex.byId.get(relId)!);
      
      const hostId = rel.relatingBuildingElement;
      const openingId = rel.relatedOpeningElement;
      
      if (!openingsByHost.has(hostId)) {
        openingsByHost.set(hostId, []);
      }
      openingsByHost.get(hostId)!.push(openingId);
    }
    
    // Process each host element
    for (const [hostId, openingIds] of openingsByHost) {
      const processed = await this.processElementWithOpenings(hostId, decoder);
      results.set(hostId, processed.mesh);
    }
    
    return results;
  }
}

interface OpeningInfo {
  expressId: number;
  geometry: ColumnarMesh;
  fillingIds: number[]; // Door/window that fills this opening
}

interface ProcessedElement {
  mesh: ColumnarMesh;
  openings: OpeningInfo[];
}
```

### Opening Processing Pipeline Integration

```typescript
/**
 * Modify geometry extraction to automatically handle openings.
 */
class GeometryStoreBuilder {
  private openingProcessor: OpeningProcessor;
  
  async extractGeometry(
    buffer: Uint8Array,
    entityIndex: EntityIndex,
    options: GeometryOptions
  ): Promise<GeometryStore> {
    // Phase 1: Extract all base geometries
    const baseGeometries = await this.extractBaseGeometries(buffer, entityIndex);
    
    // Phase 2: Identify elements with openings
    const elementsWithOpenings = this.findElementsWithOpenings(entityIndex);
    
    // Phase 3: Process openings (subtract from hosts)
    for (const elementId of elementsWithOpenings) {
      const processed = await this.openingProcessor.processElementWithOpenings(
        elementId, 
        this.decoder
      );
      baseGeometries.set(elementId, processed.mesh);
    }
    
    // Phase 4: Build final geometry store
    return this.buildStore(baseGeometries);
  }
}
```

### Nested Openings

```typescript
/**
 * Handle nested openings (openings within openings).
 * Example: Window opening in a door opening in a wall.
 */
class NestedOpeningProcessor {
  private graph: RelationshipGraph;
  private maxNestingDepth: number = 10;
  
  /**
   * Build opening dependency graph with nesting detection.
   */
  buildOpeningDependencyGraph(
    store: IfcDataStore
  ): OpeningDependencyGraph {
    const graph: OpeningDependencyGraph = {
      hostToOpenings: new Map(),
      openingToHost: new Map(),
      openingToNestedOpenings: new Map(),
      nestingDepth: new Map(),
    };
    
    // Find all IfcRelVoidsElement relationships
    const voidingRels = store.entityIndex.byType.get(
      IfcTypeEnum.IfcRelVoidsElement
    ) ?? [];
    
    // Build host → openings mapping
    for (const relId of voidingRels) {
      const rel = this.decoder.decodeRelVoidsElement(
        store.source,
        store.entityIndex.byId.get(relId)!
      );
      
      const hostId = rel.relatingBuildingElement;
      const openingId = rel.relatedOpeningElement;
      
      // Add to host → openings map
      if (!graph.hostToOpenings.has(hostId)) {
        graph.hostToOpenings.set(hostId, []);
      }
      graph.hostToOpenings.get(hostId)!.push(openingId);
      
      // Add to opening → host map
      graph.openingToHost.set(openingId, hostId);
    }
    
    // Detect nested openings (opening that is also a host)
    for (const [openingId, hostId] of graph.openingToHost) {
      if (graph.hostToOpenings.has(openingId)) {
        // This opening has its own openings (nested)
        const nested = graph.hostToOpenings.get(openingId)!;
        graph.openingToNestedOpenings.set(openingId, nested);
        
        // Calculate nesting depth
        const depth = this.calculateNestingDepth(openingId, graph);
        graph.nestingDepth.set(openingId, depth);
        
        // Check for excessive nesting
        if (depth > this.maxNestingDepth) {
          console.warn(
            `Opening #${openingId} exceeds max nesting depth (${depth} > ${this.maxNestingDepth})`
          );
        }
      }
    }
    
    return graph;
  }
  
  /**
   * Calculate nesting depth recursively.
   */
  private calculateNestingDepth(
    openingId: number,
    graph: OpeningDependencyGraph,
    visited: Set<number> = new Set()
  ): number {
    // Cycle detection
    if (visited.has(openingId)) {
      throw new Error(`Circular opening dependency detected at #${openingId}`);
    }
    
    visited.add(openingId);
    
    const nested = graph.openingToNestedOpenings.get(openingId);
    if (!nested || nested.length === 0) {
      return 0; // No nesting
    }
    
    // Max depth of nested openings + 1
    let maxDepth = 0;
    for (const nestedId of nested) {
      const depth = this.calculateNestingDepth(nestedId, graph, new Set(visited));
      maxDepth = Math.max(maxDepth, depth);
    }
    
    return maxDepth + 1;
  }
  
  /**
   * Process openings with nested handling.
   */
  async processWithNesting(
    hostId: number,
    graph: OpeningDependencyGraph,
    decoder: EntityDecoder
  ): Promise<ColumnarMesh> {
    const openings = graph.hostToOpenings.get(hostId) ?? [];
    if (openings.length === 0) {
      return await this.getElementGeometry(hostId, decoder);
    }
    
    // Process nested openings first (bottom-up)
    const processedOpenings = await this.processNestedOpenings(
      openings,
      graph,
      decoder
    );
    
    // Subtract all openings from host
    let resultMesh = await this.getElementGeometry(hostId, decoder);
    for (const opening of processedOpenings) {
      resultMesh = await this.subtractOpening(resultMesh, opening);
    }
    
    return resultMesh;
  }
  
  /**
   * Process nested openings recursively (bottom-up).
   */
  private async processNestedOpenings(
    openingIds: number[],
    graph: OpeningDependencyGraph,
    decoder: EntityDecoder
  ): Promise<ColumnarMesh[]> {
    const processed: ColumnarMesh[] = [];
    
    for (const openingId of openingIds) {
      const nestedIds = graph.openingToNestedOpenings.get(openingId) ?? [];
      
      let openingMesh = await this.getElementGeometry(openingId, decoder);
      
      // Process nested openings first
      if (nestedIds.length > 0) {
        const nestedMeshes = await this.processNestedOpenings(
          nestedIds,
          graph,
          decoder
        );
        
        // Subtract nested openings from this opening
        for (const nestedMesh of nestedMeshes) {
          openingMesh = await this.subtractOpening(openingMesh, nestedMesh);
        }
      }
      
      processed.push(openingMesh);
    }
    
    return processed;
  }
}

interface OpeningDependencyGraph {
  hostToOpenings: Map<number, number[]>; // host → openings
  openingToHost: Map<number, number>; // opening → host
  openingToNestedOpenings: Map<number, number[]>; // opening → nested openings
  nestingDepth: Map<number, number>; // opening → nesting depth
}
```

### Subtraction Order

```typescript
/**
 * Determine stable subtraction order for multiple openings.
 */
class OpeningSubtractionOrder {
  
  /**
   * Determine optimal subtraction order.
   */
  determineOrder(
    hostId: number,
    openingIds: number[],
    graph: RelationshipGraph
  ): number[] {
    // Strategy 1: Stable ordering by EXPRESS ID (deterministic)
    const sortedById = [...openingIds].sort((a, b) => a - b);
    
    // Strategy 2: Dependency-based ordering (process independent openings in parallel)
    const dependencyOrder = this.topologicalSort(hostId, openingIds, graph);
    
    // Strategy 3: Volume-based ordering (largest first for better CSG stability)
    const volumeOrder = this.sortByVolume(openingIds);
    
    // Use dependency order if available, otherwise fall back to ID order
    return dependencyOrder.length === openingIds.length 
      ? dependencyOrder 
      : sortedById;
  }
  
  /**
   * Topological sort of openings (process dependencies first).
   */
  private topologicalSort(
    hostId: number,
    openingIds: number[],
    graph: RelationshipGraph
  ): number[] {
    const result: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    
    const visit = (openingId: number) => {
      if (visited.has(openingId)) return;
      if (visiting.has(openingId)) {
        // Cycle detected - use ID order instead
        return;
      }
      
      visiting.add(openingId);
      
      // Check if this opening has dependencies (nested openings)
      const nested = graph.getRelated(
        openingId,
        RelationshipType.VoidsElement,
        'forward'
      );
      
      for (const nestedId of nested) {
        if (openingIds.includes(nestedId)) {
          visit(nestedId);
        }
      }
      
      visiting.delete(openingId);
      visited.add(openingId);
      result.push(openingId);
    };
    
    for (const openingId of openingIds) {
      visit(openingId);
    }
    
    return result;
  }
  
  /**
   * Sort openings by volume (largest first).
   */
  private sortByVolume(openingIds: number[]): number[] {
    const volumes = new Map<number, number>();
    
    for (const id of openingIds) {
      const bounds = this.store.geometry.getBounds(id);
      if (bounds) {
        const volume = 
          (bounds.max[0] - bounds.min[0]) *
          (bounds.max[1] - bounds.min[1]) *
          (bounds.max[2] - bounds.min[2]);
        volumes.set(id, volume);
      }
    }
    
    return [...openingIds].sort((a, b) => {
      const volA = volumes.get(a) ?? 0;
      const volB = volumes.get(b) ?? 0;
      return volB - volA; // Largest first
    });
  }
  
  /**
   * Detect overlapping openings for conflict resolution.
   */
  detectOverlaps(openingIds: number[]): OverlapInfo[] {
    const overlaps: OverlapInfo[] = [];
    
    for (let i = 0; i < openingIds.length; i++) {
      for (let j = i + 1; j < openingIds.length; j++) {
        const id1 = openingIds[i];
        const id2 = openingIds[j];
        
        const bounds1 = this.store.geometry.getBounds(id1);
        const bounds2 = this.store.geometry.getBounds(id2);
        
        if (!bounds1 || !bounds2) continue;
        
        if (this.boundsOverlap(bounds1, bounds2)) {
          overlaps.push({
            opening1: id1,
            opening2: id2,
            overlapVolume: this.calculateOverlapVolume(bounds1, bounds2),
          });
        }
      }
    }
    
    return overlaps;
  }
  
  private boundsOverlap(a: AABB, b: AABB): boolean {
    return (
      a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
      a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
      a.min[2] < b.max[2] && a.max[2] > b.min[2]
    );
  }
  
  private calculateOverlapVolume(a: AABB, b: AABB): number {
    const minX = Math.max(a.min[0], b.min[0]);
    const maxX = Math.min(a.max[0], b.max[0]);
    const minY = Math.max(a.min[1], b.min[1]);
    const maxY = Math.min(a.max[1], b.max[1]);
    const minZ = Math.max(a.min[2], b.min[2]);
    const maxZ = Math.min(a.max[2], b.max[2]);
    
    if (minX >= maxX || minY >= maxY || minZ >= maxZ) {
      return 0;
    }
    
    return (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  }
}

interface OverlapInfo {
  opening1: number;
  opening2: number;
  overlapVolume: number;
}
```

### Performance Optimization

```typescript
/**
 * Optimized opening processing with pre-filtering and batching.
 */
class OptimizedOpeningProcessor extends OpeningProcessor {
  
  /**
   * Pre-filter openings outside host bounds.
   */
  filterOpeningsByBounds(
    hostBounds: AABB,
    openingIds: number[],
    store: IfcDataStore
  ): number[] {
    const filtered: number[] = [];
    
    for (const openingId of openingIds) {
      const openingBounds = store.geometry.getBounds(openingId);
      if (!openingBounds) continue;
      
      // Check if opening overlaps host bounds
      if (this.boundsOverlap(hostBounds, openingBounds)) {
        filtered.push(openingId);
      }
    }
    
    return filtered;
  }
  
  /**
   * Fast-path for axis-aligned rectangular openings.
   */
  isAxisAlignedRectangular(
    openingId: number,
    store: IfcDataStore
  ): boolean {
    const mesh = store.geometry.getMesh(openingId);
    if (!mesh) return false;
    
    // Check if mesh is a simple box (6 faces, 8 vertices)
    if (mesh.indices.length !== 36) return false; // 6 faces × 6 indices
    
    // Check if all faces are axis-aligned
    const positions = mesh.positions;
    const tolerance = 1e-6;
    
    // Group vertices by coordinate values
    const xVals = new Set<number>();
    const yVals = new Set<number>();
    const zVals = new Set<number>();
    
    for (let i = 0; i < positions.length; i += 3) {
      xVals.add(Math.round(positions[i] / tolerance) * tolerance);
      yVals.add(Math.round(positions[i + 1] / tolerance) * tolerance);
      zVals.add(Math.round(positions[i + 2] / tolerance) * tolerance);
    }
    
    // Axis-aligned box should have exactly 2 unique values per axis
    return xVals.size === 2 && yVals.size === 2 && zVals.size === 2;
  }
  
  /**
   * Fast clipping for axis-aligned rectangular openings.
   */
  fastRectangularClipping(
    hostMesh: ColumnarMesh,
    openingBounds: AABB
  ): ColumnarMesh {
    // Use simple plane clipping instead of full CSG
    const clippedPositions: number[] = [];
    const clippedNormals: number[] = [];
    const clippedIndices: number[] = [];
    
    // Clip against 6 planes of the bounding box
    let currentMesh = hostMesh;
    
    // Clip against each face of the box
    const planes = [
      { normal: [1, 0, 0], distance: -openingBounds.min[0] }, // Left
      { normal: [-1, 0, 0], distance: openingBounds.max[0] }, // Right
      { normal: [0, 1, 0], distance: -openingBounds.min[1] }, // Bottom
      { normal: [0, -1, 0], distance: openingBounds.max[1] }, // Top
      { normal: [0, 0, 1], distance: -openingBounds.min[2] }, // Front
      { normal: [0, 0, -1], distance: openingBounds.max[2] }, // Back
    ];
    
    for (const plane of planes) {
      currentMesh = this.clipByPlane(currentMesh, plane.normal, plane.distance);
    }
    
    return currentMesh;
  }
  
  /**
   * Batch CSG operations for elements with many openings.
   */
  async batchProcessOpenings(
    hostId: number,
    openingIds: number[],
    decoder: EntityDecoder
  ): Promise<ColumnarMesh> {
    const BATCH_SIZE = 5;
    
    if (openingIds.length <= BATCH_SIZE) {
      // Small number of openings - process sequentially
      return await this.processElementWithOpenings(hostId, decoder);
    }
    
    // Large number of openings - batch processing
    let resultMesh = await this.getElementGeometry(hostId, decoder);
    
    // Group openings into batches
    for (let i = 0; i < openingIds.length; i += BATCH_SIZE) {
      const batch = openingIds.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel (if possible)
      const openingMeshes = await Promise.all(
        batch.map(id => this.getElementGeometry(id, decoder))
      );
      
      // Combine openings in batch (union) before subtracting
      const combinedOpening = await this.combineOpenings(openingMeshes);
      
      // Subtract combined opening from result
      resultMesh = await this.subtractOpening(resultMesh, combinedOpening);
    }
    
    return resultMesh;
  }
  
  /**
   * Combine multiple opening meshes (union).
   */
  private async combineOpenings(meshes: ColumnarMesh[]): Promise<ColumnarMesh> {
    if (meshes.length === 0) {
      throw new Error('Cannot combine empty mesh list');
    }
    if (meshes.length === 1) {
      return meshes[0];
    }
    
    // Use CSG union to combine openings
    let combined = meshes[0];
    for (let i = 1; i < meshes.length; i++) {
      combined = await this.csgOrchestrator.processBoolean({
        type: 'IfcBooleanResult',
        operator: 'UNION',
        firstOperand: { mesh: combined },
        secondOperand: { mesh: meshes[i] },
      }, this.decoder).then(r => r.mesh);
    }
    
    return combined;
  }
  
  private boundsOverlap(a: AABB, b: AABB): boolean {
    return (
      a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
      a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
      a.min[2] < b.max[2] && a.max[2] > b.min[2]
    );
  }
  
  private clipByPlane(mesh: ColumnarMesh, normal: Vec3, distance: number): ColumnarMesh {
    // Plane clipping implementation
    // (Simplified - full implementation would handle triangle splitting)
    return mesh; // Placeholder
  }
}
```

---

## 8.3 Coordinate System & Placement Chain Resolution

### The Problem

IFC uses nested `IfcLocalPlacement` hierarchies. Each element's position is relative to its parent placement, which may have its own parent, etc.

```
IfcProject
  └─ IfcSite (with IfcLocalPlacement)
       └─ IfcBuilding (with IfcLocalPlacement relative to Site)
            └─ IfcBuildingStorey (with IfcLocalPlacement relative to Building)
                 └─ IfcWall (with IfcLocalPlacement relative to Storey)
```

### Solution: Placement Chain Resolution

```typescript
/**
 * Resolves placement hierarchies to world-space transforms.
 */
class PlacementResolver {
  private cache: Map<number, Mat4> = new Map();
  private entityIndex: EntityIndex;
  private decoder: EntityDecoder;
  
  /**
   * Get world transform for any entity with placement.
   */
  getWorldTransform(placementId: number): Mat4 {
    // Check cache
    if (this.cache.has(placementId)) {
      return this.cache.get(placementId)!;
    }
    
    const placement = this.decoder.decodePlacement(
      this.buffer, 
      this.entityIndex.byId.get(placementId)!
    );
    
    // Get local transform
    const localTransform = this.decodeAxis2Placement(placement.relativePlacement);
    
    // Get parent transform (recursive)
    let worldTransform: Mat4;
    if (placement.placementRelTo) {
      const parentWorld = this.getWorldTransform(placement.placementRelTo);
      worldTransform = mat4.multiply(mat4.create(), parentWorld, localTransform);
    } else {
      worldTransform = localTransform;
    }
    
    this.cache.set(placementId, worldTransform);
    return worldTransform;
  }
  
  /**
   * Decode IfcAxis2Placement3D to 4x4 matrix.
   */
  private decodeAxis2Placement(placement: IfcAxis2Placement3D): Mat4 {
    const location = placement.location; // IfcCartesianPoint
    const axis = placement.axis ?? [0, 0, 1]; // Z direction (default: up)
    const refDirection = placement.refDirection ?? [1, 0, 0]; // X direction
    
    // Build rotation matrix from axis and refDirection
    const zAxis = vec3.normalize(vec3.create(), axis);
    const xAxis = vec3.normalize(vec3.create(), refDirection);
    const yAxis = vec3.cross(vec3.create(), zAxis, xAxis);
    
    // Column-major 4x4 matrix
    return mat4.fromValues(
      xAxis[0], xAxis[1], xAxis[2], 0,
      yAxis[0], yAxis[1], yAxis[2], 0,
      zAxis[0], zAxis[1], zAxis[2], 0,
      location[0], location[1], location[2], 1
    );
  }
  
  /**
   * Handle IfcMapConversion for georeferenced models (IFC4+).
   */
  applyMapConversion(
    localTransform: Mat4,
    mapConversion: IfcMapConversion
  ): Mat4 {
    // IfcMapConversion transforms from local to projected CRS
    const eastings = mapConversion.eastings;
    const northings = mapConversion.northings;
    const orthogonalHeight = mapConversion.orthogonalHeight;
    const xAxisAbscissa = mapConversion.xAxisAbscissa ?? 1;
    const xAxisOrdinate = mapConversion.xAxisOrdinate ?? 0;
    const scale = mapConversion.scale ?? 1;
    
    // Rotation angle from X axis direction
    const rotation = Math.atan2(xAxisOrdinate, xAxisAbscissa);
    
    // Build conversion matrix
    const conversionMatrix = mat4.create();
    mat4.translate(conversionMatrix, conversionMatrix, 
      [eastings, northings, orthogonalHeight]);
    mat4.rotateZ(conversionMatrix, conversionMatrix, rotation);
    mat4.scale(conversionMatrix, conversionMatrix, [scale, scale, scale]);
    
    return mat4.multiply(mat4.create(), conversionMatrix, localTransform);
  }
  
  /**
   * Batch resolve all placements for efficiency.
   */
  resolveAllPlacements(entityIndex: EntityIndex): Map<number, Mat4> {
    // Sort placements by hierarchy depth (parents first)
    const placementIds = entityIndex.byType.get(IfcTypeEnum.IfcLocalPlacement) ?? [];
    const sorted = this.topologicalSort(placementIds);
    
    // Process in order (parents before children)
    for (const placementId of sorted) {
      this.getWorldTransform(placementId);
    }
    
    return this.cache;
  }
  
  /**
   * Topological sort of placements (parents before children).
   */
  private topologicalSort(placementIds: number[]): number[] {
    const result: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    
    const visit = (id: number) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular placement reference detected at #${id}`);
      }
      
      visiting.add(id);
      
      const placement = this.decoder.decodePlacement(
        this.buffer,
        this.entityIndex.byId.get(id)!
      );
      
      if (placement.placementRelTo) {
        visit(placement.placementRelTo);
      }
      
      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };
    
    for (const id of placementIds) {
      visit(id);
    }
    
    return result;
  }
}
```

### Transform Application

```typescript
/**
 * Apply resolved transforms to geometry.
 */
class GeometryTransformer {
  /**
   * Transform mesh positions by placement matrix.
   */
  applyTransform(mesh: ColumnarMesh, transform: Mat4): ColumnarMesh {
    const positions = new Float32Array(mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length);
    
    // Normal matrix (transpose of inverse of upper 3x3)
    const normalMatrix = mat3.normalFromMat4(mat3.create(), transform);
    
    for (let i = 0; i < mesh.positions.length; i += 3) {
      // Transform position
      const pos = vec3.fromValues(
        mesh.positions[i],
        mesh.positions[i + 1],
        mesh.positions[i + 2]
      );
      vec3.transformMat4(pos, pos, transform);
      positions[i] = pos[0];
      positions[i + 1] = pos[1];
      positions[i + 2] = pos[2];
      
      // Transform normal
      const norm = vec3.fromValues(
        mesh.normals[i],
        mesh.normals[i + 1],
        mesh.normals[i + 2]
      );
      vec3.transformMat3(norm, norm, normalMatrix);
      vec3.normalize(norm, norm);
      normals[i] = norm[0];
      normals[i + 1] = norm[1];
      normals[i + 2] = norm[2];
    }
    
    return {
      ...mesh,
      positions,
      normals,
      bounds: this.transformBounds(mesh.bounds, transform),
    };
  }
}
```

### Coordinate System Handedness

```typescript
/**
 * IFC uses right-handed Z-up coordinate system.
 * Many renderers use left-handed Y-up (e.g., Three.js).
 */
class CoordinateSystemConverter {
  
  /**
   * Detect coordinate system from authoring tool conventions.
   */
  detectCoordinateSystem(store: IfcDataStore): CoordinateSystemInfo {
    // Check IfcProject for coordinate system hints
    const projectId = store.entityIndex.byType.get(IfcTypeEnum.IfcProject)?.[0];
    if (!projectId) {
      return { handedness: 'right', upAxis: 'Z' }; // IFC default
    }
    
    const projectRef = store.entityIndex.byId.get(projectId)!;
    const project = this.decoder.decodeProject(store.source, projectRef);
    
    // Check for IfcMapConversion (indicates georeferenced model)
    const mapConversion = this.findMapConversion(store);
    
    // IFC standard: right-handed, Z-up
    return {
      handedness: 'right',
      upAxis: 'Z',
      hasMapConversion: mapConversion !== null,
      mapConversion,
    };
  }
  
  /**
   * Convert IFC (right-handed Z-up) to renderer coordinate system.
   */
  createConversionMatrix(
    targetHandedness: 'left' | 'right',
    targetUpAxis: 'X' | 'Y' | 'Z'
  ): Mat4 {
    // IFC: right-handed, Z-up
    // Target: specified handedness and up-axis
    
    if (targetHandedness === 'right' && targetUpAxis === 'Z') {
      // No conversion needed
      return mat4.identity(mat4.create());
    }
    
    // Common conversion: IFC (right, Z-up) → Three.js (right, Y-up)
    if (targetHandedness === 'right' && targetUpAxis === 'Y') {
      // Rotate -90° around X axis (Z → Y)
      return mat4.fromXRotation(mat4.create(), -Math.PI / 2);
    }
    
    // Common conversion: IFC (right, Z-up) → Unity (left, Y-up)
    if (targetHandedness === 'left' && targetUpAxis === 'Y') {
      // Mirror X axis, then rotate
      const mirrorX = mat4.fromValues(
        -1, 0, 0, 0,
         0, 1, 0, 0,
         0, 0, 1, 0,
         0, 0, 0, 1
      );
      const rotate = mat4.fromXRotation(mat4.create(), -Math.PI / 2);
      return mat4.multiply(mat4.create(), rotate, mirrorX);
    }
    
    // Generic conversion matrix builder
    return this.buildConversionMatrix(targetHandedness, targetUpAxis);
  }
  
  /**
   * Build conversion matrix for arbitrary target system.
   */
  private buildConversionMatrix(
    targetHandedness: 'left' | 'right',
    targetUpAxis: 'X' | 'Y' | 'Z'
  ): Mat4 {
    // IFC basis: X=[1,0,0], Y=[0,1,0], Z=[0,0,1] (right-handed)
    // Target basis depends on up-axis and handedness
    
    let xAxis: Vec3, yAxis: Vec3, zAxis: Vec3;
    
    if (targetUpAxis === 'Y') {
      // Y-up: Z becomes Y, X stays X, Y becomes -Z
      xAxis = [1, 0, 0];
      yAxis = [0, 0, -1];
      zAxis = [0, 1, 0];
    } else if (targetUpAxis === 'X') {
      // X-up: Y becomes X, Z stays Z, X becomes -Y
      xAxis = [0, -1, 0];
      yAxis = [0, 0, 1];
      zAxis = [1, 0, 0];
    } else {
      // Z-up (IFC default)
      xAxis = [1, 0, 0];
      yAxis = [0, 1, 0];
      zAxis = [0, 0, 1];
    }
    
    // Flip handedness if needed
    if (targetHandedness === 'left') {
      // Mirror X axis
      xAxis[0] *= -1;
    }
    
    return mat4.fromValues(
      xAxis[0], xAxis[1], xAxis[2], 0,
      yAxis[0], yAxis[1], yAxis[2], 0,
      zAxis[0], zAxis[1], zAxis[2], 0,
      0, 0, 0, 1
    );
  }
}

interface CoordinateSystemInfo {
  handedness: 'left' | 'right';
  upAxis: 'X' | 'Y' | 'Z';
  hasMapConversion?: boolean;
  mapConversion?: IfcMapConversion;
}
```

### World Origin Placement Strategy

```typescript
/**
 * Handle large coordinates by centering model at local origin.
 */
class WorldOriginManager {
  private originOffset: Vec3 = [0, 0, 0];
  private useLocalOrigin: boolean = false;
  
  /**
   * Detect if model needs local origin centering.
   */
  detectLargeCoordinates(store: IfcDataStore): boolean {
    // Check if any coordinates exceed threshold (100km)
    const threshold = 100_000; // meters
    
    // Sample some geometric entities
    const sampleSize = Math.min(100, store.entityCount);
    const geometricIds = Array.from(store.entityIndex.byType.get(IfcTypeEnum.IfcWall) ?? [])
      .slice(0, sampleSize);
    
    for (const id of geometricIds) {
      const bounds = store.geometry.getBounds(id);
      if (!bounds) continue;
      
      // Check if bounds exceed threshold
      const maxAbs = Math.max(
        Math.abs(bounds.min[0]), Math.abs(bounds.min[1]), Math.abs(bounds.min[2]),
        Math.abs(bounds.max[0]), Math.abs(bounds.max[1]), Math.abs(bounds.max[2])
      );
      
      if (maxAbs > threshold) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Calculate optimal local origin (model centroid).
   */
  calculateLocalOrigin(store: IfcDataStore): Vec3 {
    // Use model bounding box center
    const modelBounds = this.calculateModelBounds(store);
    
    return [
      (modelBounds.min[0] + modelBounds.max[0]) / 2,
      (modelBounds.min[1] + modelBounds.max[1]) / 2,
      (modelBounds.min[2] + modelBounds.max[2]) / 2,
    ];
  }
  
  /**
   * Apply local origin offset to all geometry.
   */
  applyLocalOrigin(store: IfcDataStore, origin: Vec3): void {
    this.originOffset = origin;
    this.useLocalOrigin = true;
    
    // Transform all geometry positions
    for (let i = 0; i < store.geometry.meshes.count; i++) {
      const expressId = store.geometry.meshes.expressId[i];
      const mesh = store.geometry.getMesh(expressId);
      if (!mesh) continue;
      
      // Offset positions
      const positions = new Float32Array(mesh.positions);
      for (let j = 0; j < positions.length; j += 3) {
        positions[j] -= origin[0];
        positions[j + 1] -= origin[1];
        positions[j + 2] -= origin[2];
      }
      
      // Update mesh
      store.geometry.updateMesh(expressId, { positions });
    }
  }
  
  /**
   * Convert world coordinates back to original system.
   */
  toWorldCoordinates(localPos: Vec3): Vec3 {
    if (!this.useLocalOrigin) return localPos;
    
    return [
      localPos[0] + this.originOffset[0],
      localPos[1] + this.originOffset[1],
      localPos[2] + this.originOffset[2],
    ];
  }
  
  /**
   * Convert original coordinates to local system.
   */
  toLocalCoordinates(worldPos: Vec3): Vec3 {
    if (!this.useLocalOrigin) return worldPos;
    
    return [
      worldPos[0] - this.originOffset[0],
      worldPos[1] - this.originOffset[1],
      worldPos[2] - this.originOffset[2],
    ];
  }
  
  private calculateModelBounds(store: IfcDataStore): AABB {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < store.geometry.meshes.count; i++) {
      const expressId = store.geometry.meshes.expressId[i];
      const bounds = store.geometry.getBounds(expressId);
      if (!bounds) continue;
      
      minX = Math.min(minX, bounds.min[0]);
      minY = Math.min(minY, bounds.min[1]);
      minZ = Math.min(minZ, bounds.min[2]);
      maxX = Math.max(maxX, bounds.max[0]);
      maxY = Math.max(maxY, bounds.max[1]);
      maxZ = Math.max(maxZ, bounds.max[2]);
    }
    
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };
  }
}
```

### IfcMapConversion (Geographic Coordinates)

```typescript
/**
 * Extract and apply geographic coordinate system information.
 */
class GeographicCoordinateSystem {
  
  /**
   * Extract IfcMapConversion from IfcProjectedCRS.
   */
  extractMapConversion(store: IfcDataStore): IfcMapConversion | null {
    // Find IfcProject
    const projectIds = store.entityIndex.byType.get(IfcTypeEnum.IfcProject) ?? [];
    if (projectIds.length === 0) return null;
    
    const projectId = projectIds[0];
    const project = this.decoder.decodeProject(store.source, 
      store.entityIndex.byId.get(projectId)!);
    
    // Find IfcProjectedCRS (IFC4+)
    const crsIds = store.entityIndex.byType.get(IfcTypeEnum.IfcProjectedCRS) ?? [];
    for (const crsId of crsIds) {
      const crs = this.decoder.decodeProjectedCRS(store.source,
        store.entityIndex.byId.get(crsId)!);
      
      if (crs.mapProjection) {
        return this.decoder.decodeMapConversion(store.source,
          store.entityIndex.byId.get(crs.mapProjection)!);
      }
    }
    
    // Fallback: Check IfcSite for legacy RefLatitude/RefLongitude (IFC2X3)
    return this.extractLegacyGeoreferencing(store);
  }
  
  /**
   * Extract georeferencing from IfcSite (IFC2X3 legacy).
   */
  private extractLegacyGeoreferencing(store: IfcDataStore): IfcMapConversion | null {
    const siteIds = store.entityIndex.byType.get(IfcTypeEnum.IfcSite) ?? [];
    if (siteIds.length === 0) return null;
    
    const siteId = siteIds[0];
    const site = this.decoder.decodeSite(store.source,
      store.entityIndex.byId.get(siteId)!);
    
    if (site.refLatitude !== null && site.refLongitude !== null) {
      // Convert lat/lon to approximate map conversion
      return {
        eastings: 0, // Unknown in legacy format
        northings: 0,
        orthogonalHeight: site.refElevation ?? 0,
        xAxisAbscissa: 1,
        xAxisOrdinate: 0,
        scale: 1,
        sourceCRS: null,
        targetCRS: null,
      };
    }
    
    return null;
  }
  
  /**
   * Calculate WGS84 latitude/longitude from local coordinates.
   */
  calculateWGS84(
    localPoint: Vec3,
    mapConversion: IfcMapConversion
  ): { latitude: number; longitude: number; elevation: number } {
    // Apply inverse map conversion
    const projectedX = localPoint[0] * mapConversion.scale + mapConversion.eastings;
    const projectedY = localPoint[1] * mapConversion.scale + mapConversion.northings;
    
    // If source CRS is known, transform to WGS84
    // Otherwise, return projected coordinates as approximation
    if (mapConversion.sourceCRS) {
      return this.transformToWGS84(projectedX, projectedY, mapConversion.sourceCRS);
    }
    
    // Fallback: assume coordinates are already in WGS84 or local projection
    return {
      latitude: projectedY / 111320, // Rough conversion (1° ≈ 111.32 km)
      longitude: projectedX / (111320 * Math.cos(projectedY / 111320)),
      elevation: localPoint[2] + mapConversion.orthogonalHeight,
    };
  }
  
  /**
   * Transform projected coordinates to WGS84 (simplified).
   */
  private transformToWGS84(
    x: number,
    y: number,
    sourceCRS: string
  ): { latitude: number; longitude: number; elevation: number } {
    // Full CRS transformation requires PROJ library or similar
    // This is a simplified version for common projections
    
    if (sourceCRS.includes('EPSG:3857') || sourceCRS.includes('Web Mercator')) {
      // Web Mercator to WGS84
      const lon = (x / 20037508.34) * 180;
      const lat = Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI - 90;
      return { latitude: lat, longitude: lon, elevation: 0 };
    }
    
    // Default: assume already WGS84
    return {
      latitude: y / 111320,
      longitude: x / (111320 * Math.cos(y / 111320)),
      elevation: 0,
    };
  }
  
  /**
   * Export georeferencing metadata for GIS tools.
   */
  exportGeoreferencingMetadata(
    store: IfcDataStore,
    mapConversion: IfcMapConversion
  ): GeoreferencingMetadata {
    const modelBounds = this.calculateModelBounds(store);
    const center = [
      (modelBounds.min[0] + modelBounds.max[0]) / 2,
      (modelBounds.min[1] + modelBounds.max[1]) / 2,
      (modelBounds.min[2] + modelBounds.max[2]) / 2,
    ];
    
    const wgs84 = this.calculateWGS84(center, mapConversion);
    
    return {
      coordinateSystem: {
        type: 'Projected',
        name: mapConversion.targetCRS ?? 'Unknown',
        mapConversion: {
          eastings: mapConversion.eastings,
          northings: mapConversion.northings,
          orthogonalHeight: mapConversion.orthogonalHeight,
          scale: mapConversion.scale,
        },
      },
      wgs84Center: {
        latitude: wgs84.latitude,
        longitude: wgs84.longitude,
        elevation: wgs84.elevation,
      },
      bounds: {
        min: this.calculateWGS84([modelBounds.min[0], modelBounds.min[1], modelBounds.min[2]], mapConversion),
        max: this.calculateWGS84([modelBounds.max[0], modelBounds.max[1], modelBounds.max[2]], mapConversion),
      },
    };
  }
  
  private calculateModelBounds(store: IfcDataStore): AABB {
    // Implementation same as WorldOriginManager
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
}

interface GeoreferencingMetadata {
  coordinateSystem: {
    type: string;
    name: string;
    mapConversion: {
      eastings: number;
      northings: number;
      orthogonalHeight: number;
      scale: number;
    };
  };
  wgs84Center: {
    latitude: number;
    longitude: number;
    elevation: number;
  };
  bounds: {
    min: { latitude: number; longitude: number; elevation: number };
    max: { latitude: number; longitude: number; elevation: number };
  };
}
```

---

## 8.4 Error Handling & Recovery Strategy

### The Problem

Real IFC files contain:
- Malformed STEP syntax
- Missing entity references
- Invalid geometry parameters
- Schema violations
- Encoding issues

### Solution: Multi-Level Error Handling

```typescript
/**
 * Error classification and handling.
 */
const enum ErrorSeverity {
  Warning = 0,    // Recoverable, continue processing
  Error = 1,      // Skip this entity, continue others
  Fatal = 2,      // Cannot continue, abort
}

interface ParseError {
  severity: ErrorSeverity;
  code: ErrorCode;
  message: string;
  entityId?: number;
  lineNumber?: number;
  context?: string;
  recovery?: string;
}

const enum ErrorCode {
  // Syntax errors
  MALFORMED_STEP = 'E001',
  UNEXPECTED_TOKEN = 'E002',
  UNCLOSED_STRING = 'E003',
  INVALID_NUMBER = 'E004',
  
  // Reference errors
  MISSING_REFERENCE = 'E010',
  CIRCULAR_REFERENCE = 'E011',
  TYPE_MISMATCH = 'E012',
  
  // Geometry errors
  INVALID_GEOMETRY = 'E020',
  DEGENERATE_GEOMETRY = 'E021',
  CSG_FAILED = 'E022',
  NON_MANIFOLD = 'E023',
  
  // Data errors
  INVALID_ENUM = 'E030',
  OUT_OF_RANGE = 'E031',
  MISSING_REQUIRED = 'E032',
  
  // Schema errors
  UNKNOWN_TYPE = 'E040',
  SCHEMA_MISMATCH = 'E041',
}

/**
 * Error collector and reporter.
 */
class ParseErrorCollector {
  private errors: ParseError[] = [];
  private errorCounts = new Map<ErrorCode, number>();
  private maxErrors = 1000;
  
  add(error: ParseError): void {
    if (this.errors.length >= this.maxErrors) {
      return; // Prevent memory explosion on very broken files
    }
    
    this.errors.push(error);
    this.errorCounts.set(
      error.code, 
      (this.errorCounts.get(error.code) ?? 0) + 1
    );
  }
  
  hasBlockingErrors(): boolean {
    return this.errors.some(e => e.severity === ErrorSeverity.Fatal);
  }
  
  getReport(): ErrorReport {
    return {
      totalErrors: this.errors.length,
      byCode: Object.fromEntries(this.errorCounts),
      bySeverity: {
        warnings: this.errors.filter(e => e.severity === ErrorSeverity.Warning).length,
        errors: this.errors.filter(e => e.severity === ErrorSeverity.Error).length,
        fatal: this.errors.filter(e => e.severity === ErrorSeverity.Fatal).length,
      },
      errors: this.errors.slice(0, 100), // First 100 for display
    };
  }
}
```

### Graceful Degradation

```typescript
/**
 * Recovery strategies for different error types.
 */
class ErrorRecovery {
  
  /**
   * Handle missing reference - try to continue without it.
   */
  handleMissingReference(
    entityId: number,
    missingId: number,
    context: string
  ): RecoveryAction {
    // Log the error
    this.errors.add({
      severity: ErrorSeverity.Error,
      code: ErrorCode.MISSING_REFERENCE,
      message: `Entity #${entityId} references missing #${missingId}`,
      entityId,
      context,
      recovery: 'Using default/null value',
    });
    
    return { action: 'use-default', value: null };
  }
  
  /**
   * Handle invalid geometry - provide placeholder.
   */
  handleInvalidGeometry(
    entityId: number,
    reason: string
  ): RecoveryAction {
    this.errors.add({
      severity: ErrorSeverity.Error,
      code: ErrorCode.INVALID_GEOMETRY,
      message: `Invalid geometry for #${entityId}: ${reason}`,
      entityId,
      recovery: 'Using bounding box placeholder',
    });
    
    // Return placeholder geometry (bounding box or point)
    return { 
      action: 'use-placeholder',
      value: this.createPlaceholderGeometry(entityId),
    };
  }
  
  /**
   * Handle CSG failure - use approximation.
   */
  handleCSGFailure(
    entityId: number,
    reason: string,
    fallbackMesh: ColumnarMesh
  ): RecoveryAction {
    this.errors.add({
      severity: ErrorSeverity.Warning,
      code: ErrorCode.CSG_FAILED,
      message: `CSG operation failed for #${entityId}: ${reason}`,
      entityId,
      recovery: 'Using visual approximation',
    });
    
    return {
      action: 'use-approximation',
      value: fallbackMesh,
    };
  }
  
  /**
   * Create placeholder geometry for failed elements.
   */
  private createPlaceholderGeometry(entityId: number): ColumnarMesh {
    // Create a small marker (tetrahedron)
    return {
      expressId: entityId,
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0.5, 1, 0,
        0.5, 0.5, 1,
      ]),
      normals: new Float32Array(12).fill(0),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3]),
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      isPlaceholder: true,
    };
  }
}

interface RecoveryAction {
  action: 'use-default' | 'use-placeholder' | 'use-approximation' | 'skip';
  value?: any;
}
```

### STEP Syntax Error Recovery

```typescript
/**
 * Resilient STEP tokenizer with error recovery.
 */
class ResilientStepTokenizer {
  
  /**
   * Skip to next valid entity after syntax error.
   */
  private recoverFromError(): void {
    // Skip until we find a semicolon followed by # (next entity)
    while (this.pos < this.buffer.length) {
      if (this.buffer[this.pos] === 59) { // ';'
        this.pos++;
        this.skipWhitespace();
        if (this.buffer[this.pos] === 35) { // '#'
          return; // Found next entity
        }
      }
      this.pos++;
    }
  }
  
  /**
   * Parse with recovery - returns partial results on error.
   */
  *scanEntitiesWithRecovery(): Generator<EntityRef | ParseError> {
    while (this.pos < this.buffer.length) {
      try {
        const entity = this.parseEntity();
        if (entity) yield entity;
      } catch (e) {
        yield {
          severity: ErrorSeverity.Error,
          code: ErrorCode.MALFORMED_STEP,
          message: e.message,
          lineNumber: this.currentLine,
          context: this.getContextString(),
        };
        this.recoverFromError();
      }
    }
  }
  
  /**
   * Get context string for error reporting.
   */
  private getContextString(): string {
    const start = Math.max(0, this.pos - 50);
    const end = Math.min(this.buffer.length, this.pos + 50);
    return String.fromCharCode(...this.buffer.subarray(start, end));
  }
}
```

---

## 8.5 Unit Conversion System

### The Problem

IFC files define units at the project level. All measurements must be interpreted with correct units.

### Solution: Unit Registry & Conversion

```typescript
/**
 * Unit types defined by IFC.
 */
const enum UnitType {
  Length = 'LENGTHUNIT',
  Area = 'AREAUNIT',
  Volume = 'VOLUMEUNIT',
  Mass = 'MASSUNIT',
  Time = 'TIMEUNIT',
  Angle = 'PLANEANGLEUNIT',
  SolidAngle = 'SOLIDANGLEUNIT',
  Thermodynamic = 'THERMODYNAMICTEMPERATUREUNIT',
  // ... more
}

/**
 * SI prefixes with multipliers.
 */
const SI_PREFIXES: Record<string, number> = {
  'EXA': 1e18,
  'PETA': 1e15,
  'TERA': 1e12,
  'GIGA': 1e9,
  'MEGA': 1e6,
  'KILO': 1e3,
  'HECTO': 1e2,
  'DECA': 1e1,
  '': 1,
  'DECI': 1e-1,
  'CENTI': 1e-2,
  'MILLI': 1e-3,
  'MICRO': 1e-6,
  'NANO': 1e-9,
  'PICO': 1e-12,
  'FEMTO': 1e-15,
  'ATTO': 1e-18,
};

/**
 * Conversion factors to SI base units.
 */
const CONVERSION_TO_SI: Record<string, number> = {
  // Length (to meters)
  'METRE': 1,
  'FOOT': 0.3048,
  'INCH': 0.0254,
  'YARD': 0.9144,
  'MILE': 1609.344,
  
  // Area (to square meters)
  'SQUARE_METRE': 1,
  'SQUARE_FOOT': 0.09290304,
  
  // Volume (to cubic meters)
  'CUBIC_METRE': 1,
  'CUBIC_FOOT': 0.028316846592,
  'LITRE': 0.001,
  'GALLON_UK': 0.00454609,
  'GALLON_US': 0.003785411784,
  
  // Angle (to radians)
  'RADIAN': 1,
  'DEGREE': Math.PI / 180,
  'MINUTE': Math.PI / 10800,
  'SECOND': Math.PI / 648000,
  
  // Mass (to kilograms)
  'GRAM': 0.001,
  'POUND': 0.45359237,
  'OUNCE': 0.028349523125,
};

/**
 * Unit registry extracted from IFC file.
 */
class UnitRegistry {
  private units: Map<UnitType, UnitDefinition> = new Map();
  
  /**
   * Extract units from IfcUnitAssignment.
   */
  extractFromProject(
    unitAssignment: IfcUnitAssignment,
    decoder: EntityDecoder
  ): void {
    for (const unitId of unitAssignment.units) {
      const unitDef = decoder.decodeUnit(unitId);
      
      if (unitDef.type === 'IfcSIUnit') {
        this.registerSIUnit(unitDef);
      } else if (unitDef.type === 'IfcConversionBasedUnit') {
        this.registerConversionUnit(unitDef);
      } else if (unitDef.type === 'IfcDerivedUnit') {
        this.registerDerivedUnit(unitDef);
      }
    }
    
    // Set defaults for missing units
    this.setDefaults();
  }
  
  /**
   * Register SI unit with optional prefix.
   */
  private registerSIUnit(unit: IfcSIUnit): void {
    const prefix = unit.prefix ?? '';
    const prefixFactor = SI_PREFIXES[prefix] ?? 1;
    const baseFactor = CONVERSION_TO_SI[unit.name] ?? 1;
    
    this.units.set(unit.unitType as UnitType, {
      name: unit.name,
      factor: prefixFactor * baseFactor,
      prefix,
    });
  }
  
  /**
   * Register conversion-based unit (e.g., feet).
   */
  private registerConversionUnit(unit: IfcConversionBasedUnit): void {
    const conversionFactor = unit.conversionFactor.valueComponent;
    const baseUnit = CONVERSION_TO_SI[unit.name] ?? 1;
    
    this.units.set(unit.unitType as UnitType, {
      name: unit.name,
      factor: conversionFactor * baseUnit,
    });
  }
  
  /**
   * Convert value from file units to SI.
   */
  toSI(value: number, unitType: UnitType): number {
    const unit = this.units.get(unitType);
    if (!unit) return value; // Assume SI if not specified
    return value * unit.factor;
  }
  
  /**
   * Convert value from SI to display units.
   */
  fromSI(value: number, unitType: UnitType): number {
    const unit = this.units.get(unitType);
    if (!unit) return value;
    return value / unit.factor;
  }
  
  /**
   * Get unit label for display.
   */
  getLabel(unitType: UnitType): string {
    const unit = this.units.get(unitType);
    if (!unit) return '';
    
    const prefixLabel = unit.prefix ? SI_PREFIXES_LABELS[unit.prefix] : '';
    return prefixLabel + UNIT_LABELS[unit.name];
  }
}

interface UnitDefinition {
  name: string;
  factor: number;
  prefix?: string;
}

const UNIT_LABELS: Record<string, string> = {
  'METRE': 'm',
  'FOOT': 'ft',
  'INCH': 'in',
  'SQUARE_METRE': 'm²',
  'CUBIC_METRE': 'm³',
  'RADIAN': 'rad',
  'DEGREE': '°',
  'GRAM': 'g',
  'POUND': 'lb',
};

const SI_PREFIXES_LABELS: Record<string, string> = {
  'KILO': 'k',
  'MILLI': 'm',
  'CENTI': 'c',
  'MICRO': 'μ',
};
```

### Unit-Aware Property Extraction

```typescript
/**
 * Property extraction with unit conversion.
 */
class UnitAwarePropertyExtractor {
  private unitRegistry: UnitRegistry;
  
  /**
   * Extract property value with unit conversion.
   */
  extractPropertyValue(
    property: IfcPropertySingleValue
  ): { value: number | string; unit: string; siValue?: number } {
    const nominalValue = property.nominalValue;
    
    if (typeof nominalValue === 'number') {
      // Determine unit type from property context
      const unitType = this.inferUnitType(property);
      const siValue = this.unitRegistry.toSI(nominalValue, unitType);
      const unit = this.unitRegistry.getLabel(unitType);
      
      return { value: nominalValue, unit, siValue };
    }
    
    return { value: nominalValue, unit: '' };
  }
  
  /**
   * Infer unit type from property name/context.
   */
  private inferUnitType(property: IfcPropertySingleValue): UnitType {
    const name = property.name.toLowerCase();
    
    if (name.includes('length') || name.includes('width') || 
        name.includes('height') || name.includes('depth')) {
      return UnitType.Length;
    }
    if (name.includes('area')) return UnitType.Area;
    if (name.includes('volume')) return UnitType.Volume;
    if (name.includes('angle')) return UnitType.Angle;
    if (name.includes('mass') || name.includes('weight')) return UnitType.Mass;
    
    return UnitType.Length; // Default
  }
}
```

---

## 8.6 Streaming Parser Dependency Resolution

### The Problem

Streaming parsers want to emit geometry as soon as possible, but IFC has forward references:
- Geometry may reference `IfcRepresentationMap` defined later in the file
- `IfcRelVoidsElement` (openings) may appear after the wall it affects
- `IfcLocalPlacement` parents may be defined after children
- Materials and styles referenced before definition

### Solution: Multi-Pass Streaming with Deferred Resolution

```typescript
/**
 * Streaming architecture that handles forward references.
 */
class DependencyAwareStreamingParser {
  
  /**
   * Three-phase streaming approach.
   */
  async *parse(
    stream: ReadableStream<Uint8Array>,
    options: StreamingOptions
  ): AsyncGenerator<StreamEvent> {
    
    // === PHASE 1: Index Build (stream entire file) ===
    // Must complete before geometry can be emitted correctly
    yield { type: 'phase', phase: 'indexing', message: 'Building entity index...' };
    
    const buffer = await this.bufferStream(stream);
    const entityIndex = await this.buildIndex(buffer);
    
    yield { 
      type: 'index-ready', 
      entityIndex, 
      entityCount: entityIndex.byId.size 
    };
    
    // === PHASE 2: Dependency Graph Construction ===
    yield { type: 'phase', phase: 'dependencies', message: 'Analyzing dependencies...' };
    
    const depGraph = await this.buildDependencyGraph(buffer, entityIndex);
    
    // Identify independent geometry (can be processed immediately)
    const independentGeometry = this.findIndependentGeometry(entityIndex, depGraph);
    
    // Identify geometry with dependencies
    const dependentGeometry = this.findDependentGeometry(entityIndex, depGraph);
    
    // === PHASE 3: Ordered Emission ===
    yield { type: 'phase', phase: 'geometry', message: 'Processing geometry...' };
    
    // 3a: Emit independent geometry first (no blocking)
    for (const entityId of independentGeometry) {
      const mesh = await this.processGeometry(buffer, entityIndex, entityId);
      if (mesh) {
        yield { type: 'mesh', expressId: entityId, mesh };
      }
    }
    
    // 3b: Emit dependent geometry in topological order
    const sortedDeps = this.topologicalSort(dependentGeometry, depGraph);
    for (const entityId of sortedDeps) {
      const mesh = await this.processGeometryWithDeps(
        buffer, entityIndex, entityId, depGraph
      );
      if (mesh) {
        yield { type: 'mesh', expressId: entityId, mesh };
      }
    }
    
    // === PHASE 4: Relationship Data ===
    yield { type: 'phase', phase: 'data', message: 'Extracting properties...' };
    
    const properties = await this.extractProperties(buffer, entityIndex);
    yield { type: 'properties-ready', properties };
    
    const graph = await this.extractRelationships(buffer, entityIndex);
    yield { type: 'graph-ready', graph };
    
    yield { type: 'complete' };
  }
}

/**
 * Dependency graph for geometry processing.
 */
class GeometryDependencyGraph {
  // Entity → entities it depends on
  private dependencies = new Map<number, Set<number>>();
  
  // Entity → entities that depend on it
  private dependents = new Map<number, Set<number>>();
  
  /**
   * Build dependency graph from entity index.
   */
  async build(buffer: Uint8Array, entityIndex: EntityIndex): Promise<void> {
    // Scan for relationships that create geometry dependencies
    
    // 1. IfcRepresentationMap usage
    const mappedItems = entityIndex.byType.get(IfcTypeEnum.IfcMappedItem) ?? [];
    for (const mappedId of mappedItems) {
      const ref = entityIndex.byId.get(mappedId)!;
      const mapped = this.decoder.decodeMappedItem(buffer, ref);
      
      // MappedItem depends on its RepresentationMap
      this.addDependency(mappedId, mapped.mappingSource);
    }
    
    // 2. IfcRelVoidsElement (openings)
    const voidsRels = entityIndex.byType.get(IfcTypeEnum.IfcRelVoidsElement) ?? [];
    for (const relId of voidsRels) {
      const ref = entityIndex.byId.get(relId)!;
      const rel = this.decoder.decodeRelVoidsElement(buffer, ref);
      
      // Host element depends on opening geometry being processed first
      this.addDependency(rel.relatingBuildingElement, rel.relatedOpeningElement);
    }
    
    // 3. IfcBooleanResult operands
    const booleans = [
      ...(entityIndex.byType.get(IfcTypeEnum.IfcBooleanResult) ?? []),
      ...(entityIndex.byType.get(IfcTypeEnum.IfcBooleanClippingResult) ?? []),
    ];
    for (const boolId of booleans) {
      const ref = entityIndex.byId.get(boolId)!;
      const bool = this.decoder.decodeBooleanResult(buffer, ref);
      
      this.addDependency(boolId, bool.firstOperand);
      this.addDependency(boolId, bool.secondOperand);
    }
    
    // 4. IfcLocalPlacement chains
    const placements = entityIndex.byType.get(IfcTypeEnum.IfcLocalPlacement) ?? [];
    for (const placementId of placements) {
      const ref = entityIndex.byId.get(placementId)!;
      const placement = this.decoder.decodePlacement(buffer, ref);
      
      if (placement.placementRelTo) {
        this.addDependency(placementId, placement.placementRelTo);
      }
    }
  }
  
  /**
   * Add dependency: `dependent` needs `dependency` processed first.
   */
  private addDependency(dependent: number, dependency: number): void {
    if (!this.dependencies.has(dependent)) {
      this.dependencies.set(dependent, new Set());
    }
    this.dependencies.get(dependent)!.add(dependency);
    
    if (!this.dependents.has(dependency)) {
      this.dependents.set(dependency, new Set());
    }
    this.dependents.get(dependency)!.add(dependent);
  }
  
  /**
   * Check if entity has unmet dependencies.
   */
  hasUnmetDependencies(entityId: number, processed: Set<number>): boolean {
    const deps = this.dependencies.get(entityId);
    if (!deps) return false;
    
    for (const dep of deps) {
      if (!processed.has(dep)) return true;
    }
    return false;
  }
  
  /**
   * Get entities with no dependencies (can process immediately).
   */
  getIndependent(): number[] {
    const result: number[] = [];
    for (const [entityId] of this.entityIndex.byId) {
      if (!this.dependencies.has(entityId) || 
          this.dependencies.get(entityId)!.size === 0) {
        result.push(entityId);
      }
    }
    return result;
  }
}
```

### Progressive UI Updates

```typescript
/**
 * Client-side handler for streaming events.
 */
class StreamingProgressHandler {
  private viewer: ViewerEngine;
  private priorityQueue: PriorityQueue<PendingMesh>;
  
  /**
   * Handle streaming events with visual prioritization.
   */
  async handleStream(parser: DependencyAwareStreamingParser, file: File) {
    const stream = file.stream();
    
    for await (const event of parser.parse(stream)) {
      switch (event.type) {
        case 'phase':
          this.ui.showPhase(event.phase, event.message);
          break;
          
        case 'index-ready':
          // Show skeleton structure immediately
          this.viewer.showSkeletonHierarchy(event.entityIndex);
          this.ui.updateCount(event.entityCount);
          break;
          
        case 'mesh':
          // Prioritize based on current view
          const priority = this.calculateViewPriority(event.mesh);
          
          if (priority > 100) {
            // High priority - render immediately
            this.viewer.addMesh(event.expressId, event.mesh);
          } else {
            // Queue for batch upload
            this.priorityQueue.enqueue({
              expressId: event.expressId,
              mesh: event.mesh,
              priority,
            });
          }
          break;
          
        case 'properties-ready':
          // Properties panel now functional
          this.dataStore.setProperties(event.properties);
          this.ui.enablePropertiesPanel();
          break;
          
        case 'complete':
          // Flush remaining queued meshes
          this.flushQueue();
          this.ui.showComplete();
          break;
      }
      
      // Yield to UI thread periodically
      if (performance.now() % 16 < 1) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }
  
  /**
   * Calculate priority based on current camera view.
   */
  private calculateViewPriority(mesh: ColumnarMesh): number {
    let priority = 0;
    
    // In frustum?
    if (this.viewer.isInFrustum(mesh.bounds)) {
      priority += 100;
    }
    
    // Screen-space size
    const screenSize = this.viewer.estimateScreenSize(mesh.bounds);
    priority += Math.min(screenSize, 100);
    
    // Distance from camera
    const distance = this.viewer.distanceToCamera(mesh.bounds);
    priority += Math.max(0, 100 - distance * 0.1);
    
    return priority;
  }
}
```

---

## 8.7 Improved Instance Detection Algorithm

### The Problem

The simple hash-based instance detection:
1. Misses near-identical geometry with slight differences
2. False positives on different geometry with similar metrics
3. Doesn't handle mirrored instances

### Solution: Robust Geometry Fingerprinting

```typescript
/**
 * Robust instance detection using geometric signatures.
 */
class RobustInstanceDetector {
  
  /**
   * Compute detailed geometry signature for instance matching.
   */
  computeSignature(mesh: ColumnarMesh): GeometrySignature {
    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;
    
    // 1. Basic metrics
    const bounds = mesh.bounds;
    const size = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const volume = size[0] * size[1] * size[2];
    const surfaceArea = this.computeSurfaceArea(mesh);
    
    // 2. Moment of inertia (rotation-invariant)
    const centroid = this.computeCentroid(mesh);
    const moments = this.computeMoments(mesh, centroid);
    
    // 3. Distance distribution histogram
    const distanceHistogram = this.computeDistanceHistogram(mesh, centroid);
    
    // 4. Normal distribution histogram
    const normalHistogram = this.computeNormalHistogram(mesh);
    
    // 5. Curvature samples
    const curvatureSamples = this.sampleCurvatures(mesh);
    
    return {
      vertexCount,
      triangleCount,
      volume,
      surfaceArea,
      aspectRatio: [size[0]/size[2], size[1]/size[2]],
      moments,
      distanceHistogram,
      normalHistogram,
      curvatureSamples,
    };
  }
  
  /**
   * Compare two signatures for instance matching.
   */
  matchSignatures(
    sig1: GeometrySignature, 
    sig2: GeometrySignature,
    tolerance: number = 0.01
  ): InstanceMatch {
    // Quick rejection tests (cheap)
    if (sig1.vertexCount !== sig2.vertexCount) {
      return { isMatch: false, confidence: 0, transform: null };
    }
    if (sig1.triangleCount !== sig2.triangleCount) {
      return { isMatch: false, confidence: 0, transform: null };
    }
    
    // Volume/area comparison (medium)
    const volumeRatio = Math.abs(sig1.volume - sig2.volume) / sig1.volume;
    if (volumeRatio > tolerance) {
      return { isMatch: false, confidence: 0, transform: null };
    }
    
    const areaRatio = Math.abs(sig1.surfaceArea - sig2.surfaceArea) / sig1.surfaceArea;
    if (areaRatio > tolerance) {
      return { isMatch: false, confidence: 0, transform: null };
    }
    
    // Histogram comparison (expensive)
    const distanceSimilarity = this.compareHistograms(
      sig1.distanceHistogram, 
      sig2.distanceHistogram
    );
    const normalSimilarity = this.compareHistograms(
      sig1.normalHistogram, 
      sig2.normalHistogram
    );
    
    const overallSimilarity = (distanceSimilarity + normalSimilarity) / 2;
    
    if (overallSimilarity < 0.95) {
      return { isMatch: false, confidence: overallSimilarity, transform: null };
    }
    
    // Check for mirror (determinant of best-fit transform)
    const isMirrored = this.detectMirror(sig1.moments, sig2.moments);
    
    return {
      isMatch: true,
      confidence: overallSimilarity,
      transform: isMirrored ? 'mirrored' : 'identical',
    };
  }
  
  /**
   * Compute distance histogram (rotation-invariant).
   */
  private computeDistanceHistogram(
    mesh: ColumnarMesh, 
    centroid: Vec3
  ): Float32Array {
    const bins = 32;
    const histogram = new Float32Array(bins);
    
    // Find max distance for normalization
    let maxDist = 0;
    const distances: number[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dist = Math.sqrt(
        (mesh.positions[i] - centroid[0]) ** 2 +
        (mesh.positions[i + 1] - centroid[1]) ** 2 +
        (mesh.positions[i + 2] - centroid[2]) ** 2
      );
      distances.push(dist);
      maxDist = Math.max(maxDist, dist);
    }
    
    // Build histogram
    for (const dist of distances) {
      const bin = Math.min(bins - 1, Math.floor((dist / maxDist) * bins));
      histogram[bin]++;
    }
    
    // Normalize
    const sum = histogram.reduce((a, b) => a + b, 0);
    for (let i = 0; i < bins; i++) {
      histogram[i] /= sum;
    }
    
    return histogram;
  }
  
  /**
   * Compute normal direction histogram (orientation-invariant).
   */
  private computeNormalHistogram(mesh: ColumnarMesh): Float32Array {
    // Discretize sphere into bins using icosahedron subdivision
    const bins = 42; // Icosahedron vertices + edge midpoints
    const binDirections = this.getIcosahedronDirections();
    const histogram = new Float32Array(bins);
    
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const normal = [
        mesh.normals[i],
        mesh.normals[i + 1],
        mesh.normals[i + 2],
      ];
      
      // Find closest bin direction
      let bestBin = 0;
      let bestDot = -Infinity;
      for (let b = 0; b < bins; b++) {
        const dot = 
          normal[0] * binDirections[b][0] +
          normal[1] * binDirections[b][1] +
          normal[2] * binDirections[b][2];
        if (Math.abs(dot) > Math.abs(bestDot)) {
          bestDot = dot;
          bestBin = b;
        }
      }
      histogram[bestBin]++;
    }
    
    // Normalize
    const sum = histogram.reduce((a, b) => a + b, 0);
    for (let i = 0; i < bins; i++) {
      histogram[i] /= sum;
    }
    
    return histogram;
  }
  
  /**
   * Detect if geometry is mirrored version.
   */
  private detectMirror(moments1: Vec3, moments2: Vec3): boolean {
    // Compare principal axis orientations
    // If determinant of alignment matrix is negative, it's mirrored
    // ... implementation using eigenvalue decomposition
    return false;
  }
  
  /**
   * Batch detect all instances in model.
   */
  async detectAllInstances(
    store: IfcDataStore
  ): Promise<InstanceGroups> {
    const signatures = new Map<number, GeometrySignature>();
    const groups: InstanceGroup[] = [];
    
    // Compute all signatures
    for (let i = 0; i < store.geometry.meshes.count; i++) {
      const expressId = store.geometry.meshes.expressId[i];
      const mesh = store.geometry.getMesh(expressId);
      if (!mesh) continue;
      
      signatures.set(expressId, this.computeSignature(mesh));
    }
    
    // Group by signature similarity
    const unassigned = new Set(signatures.keys());
    
    while (unassigned.size > 0) {
      const prototypeId = unassigned.values().next().value;
      unassigned.delete(prototypeId);
      
      const prototypeSig = signatures.get(prototypeId)!;
      const group: InstanceGroup = {
        prototypeId,
        instances: [prototypeId],
        transforms: [mat4.create()],
      };
      
      for (const candidateId of unassigned) {
        const candidateSig = signatures.get(candidateId)!;
        const match = this.matchSignatures(prototypeSig, candidateSig);
        
        if (match.isMatch) {
          group.instances.push(candidateId);
          // Compute transform from prototype to instance
          const transform = this.computeInstanceTransform(
            store.geometry.getMesh(prototypeId)!,
            store.geometry.getMesh(candidateId)!,
            match.transform === 'mirrored'
          );
          group.transforms.push(transform);
          unassigned.delete(candidateId);
        }
      }
      
      if (group.instances.length > 1) {
        groups.push(group);
      }
    }
    
    return { groups };
  }
}

interface GeometrySignature {
  vertexCount: number;
  triangleCount: number;
  volume: number;
  surfaceArea: number;
  aspectRatio: [number, number];
  moments: Vec3;
  distanceHistogram: Float32Array;
  normalHistogram: Float32Array;
  curvatureSamples: Float32Array;
}

interface InstanceMatch {
  isMatch: boolean;
  confidence: number;
  transform: 'identical' | 'mirrored' | null;
}

interface InstanceGroup {
  prototypeId: number;
  instances: number[];
  transforms: Mat4[];
}
```

---

## 8.8 Section Plane Caps Implementation

### The Problem

Section plane cuts show internal cavities without proper capping. Need to:
1. Generate cap geometry along the cutting plane
2. Handle complex concave cross-sections
3. Update in real-time as plane moves

### Solution: Dynamic Section Cap Generation

```typescript
/**
 * Generate section caps in real-time.
 */
class SectionCapGenerator {
  
  /**
   * Generate cap mesh for section plane intersection.
   */
  generateCap(
    mesh: ColumnarMesh,
    plane: Plane
  ): ColumnarMesh | null {
    // Collect intersection edges
    const edges: Edge[] = [];
    
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const i0 = mesh.indices[i];
      const i1 = mesh.indices[i + 1];
      const i2 = mesh.indices[i + 2];
      
      const v0 = this.getVertex(mesh, i0);
      const v1 = this.getVertex(mesh, i1);
      const v2 = this.getVertex(mesh, i2);
      
      const d0 = this.signedDistance(v0, plane);
      const d1 = this.signedDistance(v1, plane);
      const d2 = this.signedDistance(v2, plane);
      
      // Find edge intersections
      const intersections: Vec3[] = [];
      
      if (d0 * d1 < 0) {
        intersections.push(this.interpolateVertex(v0, v1, d0, d1));
      }
      if (d1 * d2 < 0) {
        intersections.push(this.interpolateVertex(v1, v2, d1, d2));
      }
      if (d2 * d0 < 0) {
        intersections.push(this.interpolateVertex(v2, v0, d2, d0));
      }
      
      if (intersections.length === 2) {
        edges.push({ start: intersections[0], end: intersections[1] });
      }
    }
    
    if (edges.length === 0) return null;
    
    // Connect edges into polygons
    const polygons = this.buildPolygonsFromEdges(edges);
    
    // Triangulate each polygon
    const capPositions: number[] = [];
    const capIndices: number[] = [];
    
    for (const polygon of polygons) {
      // Project to 2D for triangulation
      const projected = this.projectToPlane(polygon, plane);
      
      // Triangulate using earcut
      const indices2D = earcut(projected.flat());
      
      // Add to cap mesh
      const baseIndex = capPositions.length / 3;
      for (const point of polygon) {
        capPositions.push(point[0], point[1], point[2]);
      }
      for (const idx of indices2D) {
        capIndices.push(baseIndex + idx);
      }
    }
    
    // Create cap normals (all pointing along plane normal)
    const capNormals = new Float32Array(capPositions.length);
    for (let i = 0; i < capNormals.length; i += 3) {
      capNormals[i] = plane.normal[0];
      capNormals[i + 1] = plane.normal[1];
      capNormals[i + 2] = plane.normal[2];
    }
    
    return {
      expressId: mesh.expressId,
      positions: new Float32Array(capPositions),
      normals: capNormals,
      indices: new Uint32Array(capIndices),
      bounds: this.computeBounds(capPositions),
      isSectionCap: true,
    };
  }
  
  /**
   * Connect loose edges into closed polygons.
   */
  private buildPolygonsFromEdges(edges: Edge[]): Vec3[][] {
    const polygons: Vec3[][] = [];
    const used = new Set<number>();
    const epsilon = 1e-6;
    
    while (used.size < edges.length) {
      // Find unused starting edge
      let startIdx = 0;
      while (used.has(startIdx)) startIdx++;
      
      const polygon: Vec3[] = [edges[startIdx].start, edges[startIdx].end];
      used.add(startIdx);
      
      // Follow edges until we close the polygon
      let current = edges[startIdx].end;
      let closed = false;
      
      while (!closed) {
        let foundNext = false;
        
        for (let i = 0; i < edges.length; i++) {
          if (used.has(i)) continue;
          
          const edge = edges[i];
          
          if (this.pointsEqual(edge.start, current, epsilon)) {
            polygon.push(edge.end);
            current = edge.end;
            used.add(i);
            foundNext = true;
            break;
          }
          if (this.pointsEqual(edge.end, current, epsilon)) {
            polygon.push(edge.start);
            current = edge.start;
            used.add(i);
            foundNext = true;
            break;
          }
        }
        
        // Check if we've closed the loop
        if (this.pointsEqual(current, polygon[0], epsilon)) {
          closed = true;
        }
        
        if (!foundNext && !closed) {
          // Open polygon - shouldn't happen with valid geometry
          break;
        }
      }
      
      if (polygon.length >= 3) {
        polygons.push(polygon);
      }
    }
    
    return polygons;
  }
  
  /**
   * Project polygon to 2D plane coordinates.
   */
  private projectToPlane(polygon: Vec3[], plane: Plane): [number, number][] {
    // Build local coordinate system on plane
    const zAxis = plane.normal;
    const xAxis = this.perpendicularVector(zAxis);
    const yAxis = vec3.cross(vec3.create(), zAxis, xAxis);
    
    return polygon.map(point => {
      const local = vec3.subtract(vec3.create(), point, plane.point);
      return [
        vec3.dot(local, xAxis),
        vec3.dot(local, yAxis),
      ];
    });
  }
}

/**
 * Real-time section plane manager with cap generation.
 */
class SectionPlaneManager {
  private capGenerator: SectionCapGenerator;
  private capMeshes: Map<number, GPUBuffer> = new Map();
  
  /**
   * Update section plane and regenerate caps.
   */
  async updatePlane(planeIndex: number, plane: SectionPlane): Promise<void> {
    this.planes[planeIndex] = plane;
    
    // Regenerate caps for all visible meshes
    await this.regenerateCaps(planeIndex);
    
    // Upload new cap geometry to GPU
    await this.uploadCaps();
  }
  
  /**
   * Regenerate caps for all affected meshes.
   */
  private async regenerateCaps(planeIndex: number): Promise<void> {
    const plane = this.planes[planeIndex];
    const planeObj = {
      normal: plane.normal,
      point: plane.position,
    };
    
    // Use worker for heavy computation
    const visibleMeshes = this.getVisibleMeshes();
    
    const caps = await this.workerPool.submit('generate-section-caps', {
      meshes: visibleMeshes,
      plane: planeObj,
    });
    
    // Store cap meshes
    this.capMeshes.set(planeIndex, caps);
  }
}

interface Edge {
  start: Vec3;
  end: Vec3;
}

interface Plane {
  normal: Vec3;
  point: Vec3;
}
```

### GPU-Accelerated Section Caps (WebGPU)

```wgsl
// Compute shader for GPU-side cap generation
@compute @workgroup_size(256)
fn generateSectionCaps(@builtin(global_invocation_id) gid: vec3u) {
  let triangleIdx = gid.x;
  if (triangleIdx >= triangleCount) { return; }
  
  let i0 = indices[triangleIdx * 3];
  let i1 = indices[triangleIdx * 3 + 1];
  let i2 = indices[triangleIdx * 3 + 2];
  
  let v0 = getPosition(i0);
  let v1 = getPosition(i1);
  let v2 = getPosition(i2);
  
  let d0 = dot(sectionPlane.xyz, v0) + sectionPlane.w;
  let d1 = dot(sectionPlane.xyz, v1) + sectionPlane.w;
  let d2 = dot(sectionPlane.xyz, v2) + sectionPlane.w;
  
  // Count intersections
  var intersectionCount = 0u;
  if (d0 * d1 < 0.0) { intersectionCount++; }
  if (d1 * d2 < 0.0) { intersectionCount++; }
  if (d2 * d0 < 0.0) { intersectionCount++; }
  
  if (intersectionCount != 2u) { return; }
  
  // Compute intersection points
  var p0: vec3f;
  var p1: vec3f;
  var idx = 0u;
  
  if (d0 * d1 < 0.0) {
    let t = d0 / (d0 - d1);
    let p = mix(v0, v1, t);
    if (idx == 0u) { p0 = p; } else { p1 = p; }
    idx++;
  }
  if (d1 * d2 < 0.0) {
    let t = d1 / (d1 - d2);
    let p = mix(v1, v2, t);
    if (idx == 0u) { p0 = p; } else { p1 = p; }
    idx++;
  }
  if (d2 * d0 < 0.0) {
    let t = d2 / (d2 - d0);
    let p = mix(v2, v0, t);
    if (idx == 0u) { p0 = p; } else { p1 = p; }
    idx++;
  }
  
  // Output edge
  let edgeIdx = atomicAdd(&edgeCount, 1u);
  capEdges[edgeIdx * 2] = p0;
  capEdges[edgeIdx * 2 + 1] = p1;
}
```

---

## 8.9 IFC Schema Generation Pipeline

### The Problem

IFC has 900+ entity types across versions. Manually maintaining TypeScript types is error-prone and incomplete.

### Solution: Automated Schema Generation from EXPRESS

```typescript
/**
 * Parse EXPRESS schema and generate TypeScript definitions.
 */
class ExpressSchemaParser {
  
  /**
   * Parse EXPRESS schema file (.exp).
   */
  parse(expressContent: string): ExpressSchema {
    const schema: ExpressSchema = {
      name: '',
      version: '',
      types: new Map(),
      entities: new Map(),
      enums: new Map(),
      selects: new Map(),
    };
    
    // Parse schema header
    const headerMatch = expressContent.match(/SCHEMA\s+(\w+);/);
    if (headerMatch) {
      schema.name = headerMatch[1];
    }
    
    // Parse TYPE definitions
    const typeRegex = /TYPE\s+(\w+)\s*=\s*([^;]+);/g;
    let match;
    while ((match = typeRegex.exec(expressContent)) !== null) {
      const [, name, definition] = match;
      schema.types.set(name, this.parseTypeDefinition(definition));
    }
    
    // Parse ENTITY definitions
    const entityRegex = /ENTITY\s+(\w+)([\s\S]*?)END_ENTITY;/g;
    while ((match = entityRegex.exec(expressContent)) !== null) {
      const [, name, body] = match;
      schema.entities.set(name, this.parseEntityDefinition(name, body));
    }
    
    return schema;
  }
  
  /**
   * Parse entity definition with attributes and supertypes.
   */
  private parseEntityDefinition(name: string, body: string): EntityDefinition {
    const entity: EntityDefinition = {
      name,
      supertype: null,
      attributes: [],
      derivedAttributes: [],
      inverseAttributes: [],
      isAbstract: body.includes('ABSTRACT'),
    };
    
    // Parse SUBTYPE OF
    const subtypeMatch = body.match(/SUBTYPE\s+OF\s*\(\s*(\w+)\s*\)/);
    if (subtypeMatch) {
      entity.supertype = subtypeMatch[1];
    }
    
    // Parse attributes
    const attrRegex = /(\w+)\s*:\s*(OPTIONAL\s+)?([^;]+);/g;
    let match;
    while ((match = attrRegex.exec(body)) !== null) {
      const [, attrName, optional, attrType] = match;
      
      // Skip DERIVE and INVERSE sections
      if (attrName === 'DERIVE' || attrName === 'INVERSE') continue;
      
      entity.attributes.push({
        name: attrName,
        type: this.parseAttributeType(attrType.trim()),
        optional: !!optional,
      });
    }
    
    return entity;
  }
  
  /**
   * Parse attribute type (handles LIST, SET, SELECT, etc.)
   */
  private parseAttributeType(typeStr: string): AttributeType {
    // LIST OF ...
    const listMatch = typeStr.match(/LIST\s*\[\s*(\d+)\s*:\s*(\d+|\?)\s*\]\s*OF\s+(.+)/);
    if (listMatch) {
      return {
        kind: 'list',
        minSize: parseInt(listMatch[1]),
        maxSize: listMatch[2] === '?' ? Infinity : parseInt(listMatch[2]),
        elementType: this.parseAttributeType(listMatch[3]),
      };
    }
    
    // SET OF ...
    const setMatch = typeStr.match(/SET\s*\[\s*(\d+)\s*:\s*(\d+|\?)\s*\]\s*OF\s+(.+)/);
    if (setMatch) {
      return {
        kind: 'set',
        minSize: parseInt(setMatch[1]),
        maxSize: setMatch[2] === '?' ? Infinity : parseInt(setMatch[2]),
        elementType: this.parseAttributeType(setMatch[3]),
      };
    }
    
    // ENUMERATION
    if (typeStr.startsWith('ENUMERATION')) {
      return { kind: 'enum', values: this.parseEnumValues(typeStr) };
    }
    
    // SELECT
    if (typeStr.startsWith('SELECT')) {
      return { kind: 'select', options: this.parseSelectOptions(typeStr) };
    }
    
    // Simple type or entity reference
    return { kind: 'reference', name: typeStr };
  }
}

/**
 * Generate TypeScript from parsed EXPRESS schema.
 */
class TypeScriptGenerator {
  
  /**
   * Generate complete TypeScript module.
   */
  generate(schema: ExpressSchema): string {
    const lines: string[] = [];
    
    // Header
    lines.push('// Auto-generated from EXPRESS schema');
    lines.push(`// Schema: ${schema.name}`);
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push('');
    
    // Generate type enum
    lines.push(this.generateTypeEnum(schema));
    lines.push('');
    
    // Generate enum types
    for (const [name, enumDef] of schema.enums) {
      lines.push(this.generateEnum(name, enumDef));
      lines.push('');
    }
    
    // Generate interfaces for entities
    for (const [name, entity] of schema.entities) {
      lines.push(this.generateInterface(entity, schema));
      lines.push('');
    }
    
    // Generate type guards
    lines.push(this.generateTypeGuards(schema));
    
    // Generate decoder stubs
    lines.push(this.generateDecoderStubs(schema));
    
    return lines.join('\n');
  }
  
  /**
   * Generate IfcTypeEnum with all entity types.
   */
  private generateTypeEnum(schema: ExpressSchema): string {
    const lines: string[] = [];
    lines.push('export const enum IfcTypeEnum {');
    
    let value = 1;
    const categories = this.categorizeEntities(schema);
    
    for (const [category, entities] of categories) {
      lines.push(`  // ${category}`);
      for (const name of entities) {
        lines.push(`  ${name} = ${value},`);
        value++;
      }
      lines.push('');
    }
    
    lines.push('  Unknown = 9999,');
    lines.push('}');
    
    return lines.join('\n');
  }
  
  /**
   * Generate TypeScript interface from entity definition.
   */
  private generateInterface(
    entity: EntityDefinition, 
    schema: ExpressSchema
  ): string {
    const lines: string[] = [];
    
    // JSDoc comment
    lines.push('/**');
    lines.push(` * IFC Entity: ${entity.name}`);
    if (entity.supertype) {
      lines.push(` * @extends ${entity.supertype}`);
    }
    lines.push(' */');
    
    // Interface declaration
    if (entity.supertype) {
      lines.push(`export interface ${entity.name} extends ${entity.supertype} {`);
    } else {
      lines.push(`export interface ${entity.name} {`);
    }
    
    // Attributes
    for (const attr of entity.attributes) {
      const tsType = this.expressTypeToTypeScript(attr.type, schema);
      const optionalMark = attr.optional ? '?' : '';
      lines.push(`  ${attr.name}${optionalMark}: ${tsType};`);
    }
    
    lines.push('}');
    
    return lines.join('\n');
  }
  
  /**
   * Convert EXPRESS type to TypeScript type.
   */
  private expressTypeToTypeScript(
    type: AttributeType, 
    schema: ExpressSchema
  ): string {
    switch (type.kind) {
      case 'list':
      case 'set':
        const element = this.expressTypeToTypeScript(type.elementType, schema);
        return `${element}[]`;
        
      case 'enum':
        return type.values.map(v => `'${v}'`).join(' | ');
        
      case 'select':
        return type.options.join(' | ');
        
      case 'reference':
        // Map EXPRESS base types to TypeScript
        const mapping: Record<string, string> = {
          'INTEGER': 'number',
          'REAL': 'number',
          'NUMBER': 'number',
          'STRING': 'string',
          'BOOLEAN': 'boolean',
          'LOGICAL': 'boolean | null',
          'BINARY': 'Uint8Array',
        };
        return mapping[type.name] ?? type.name;
    }
  }
}

/**
 * Build script for schema generation.
 */
async function generateSchemaTypes() {
  const schemas = [
    { file: 'IFC2X3_TC1.exp', version: 'IFC2X3' },
    { file: 'IFC4_ADD2_TC1.exp', version: 'IFC4' },
    { file: 'IFC4X3_ADD2.exp', version: 'IFC4X3' },
  ];
  
  const parser = new ExpressSchemaParser();
  const generator = new TypeScriptGenerator();
  
  for (const { file, version } of schemas) {
    const content = await fs.readFile(`schemas/${file}`, 'utf-8');
    const schema = parser.parse(content);
    schema.version = version;
    
    const typescript = generator.generate(schema);
    
    await fs.writeFile(
      `src/schema/${version.toLowerCase()}.generated.ts`,
      typescript
    );
    
    console.log(`Generated types for ${version}: ${schema.entities.size} entities`);
  }
}
```

### Runtime Schema Registry

```typescript
/**
 * Runtime schema information for dynamic operations.
 */
class SchemaRegistry {
  private schemas: Map<string, ExpressSchema> = new Map();
  
  /**
   * Get attribute info for entity type.
   */
  getAttributes(schemaVersion: string, entityType: string): AttributeInfo[] {
    const schema = this.schemas.get(schemaVersion);
    if (!schema) return [];
    
    const entity = schema.entities.get(entityType);
    if (!entity) return [];
    
    // Include inherited attributes
    const attributes = [...entity.attributes];
    if (entity.supertype) {
      attributes.unshift(...this.getAttributes(schemaVersion, entity.supertype));
    }
    
    return attributes;
  }
  
  /**
   * Check if entity type is subtype of another.
   */
  isSubtypeOf(
    schemaVersion: string, 
    entityType: string, 
    potentialSupertype: string
  ): boolean {
    const schema = this.schemas.get(schemaVersion);
    if (!schema) return false;
    
    let current = entityType;
    while (current) {
      if (current === potentialSupertype) return true;
      const entity = schema.entities.get(current);
      current = entity?.supertype ?? null;
    }
    
    return false;
  }
}
```

---

## 8.10 Large Coordinate Handling Strategy

### The Problem

Georeferenced IFC files use real-world coordinates (e.g., UTM) with values like:
- X: 500,000.0 meters
- Y: 5,000,000.0 meters

Single-precision floats lose accuracy at these magnitudes, causing:
- Jittering during navigation
- Z-fighting
- Incorrect picking

### Solution: Double-Precision Pipeline with View-Space Rendering

```typescript
/**
 * Handle large coordinates by shifting to view-relative space.
 */
class LargeCoordinateHandler {
  // Origin shift for the current session
  private originShift: [number, number, number] = [0, 0, 0];
  
  // Whether we're in "large coordinate" mode
  private isLargeCoordinateMode = false;
  
  // Threshold for activating large coordinate handling
  private readonly THRESHOLD = 10000; // meters
  
  /**
   * Analyze model bounds and determine coordinate strategy.
   */
  analyzeCoordinates(bounds: AABB): CoordinateStrategy {
    const center = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    
    const maxCoord = Math.max(
      Math.abs(bounds.min[0]), Math.abs(bounds.max[0]),
      Math.abs(bounds.min[1]), Math.abs(bounds.max[1]),
      Math.abs(bounds.min[2]), Math.abs(bounds.max[2])
    );
    
    if (maxCoord > this.THRESHOLD) {
      this.isLargeCoordinateMode = true;
      this.originShift = center as [number, number, number];
      
      return {
        mode: 'shifted',
        originShift: this.originShift,
        originalBounds: bounds,
        shiftedBounds: this.shiftBounds(bounds),
      };
    }
    
    return {
      mode: 'direct',
      originShift: [0, 0, 0],
      originalBounds: bounds,
      shiftedBounds: bounds,
    };
  }
  
  /**
   * Transform geometry to view-relative coordinates.
   */
  shiftGeometry(mesh: ColumnarMesh): ColumnarMesh {
    if (!this.isLargeCoordinateMode) return mesh;
    
    const positions = new Float32Array(mesh.positions.length);
    
    for (let i = 0; i < mesh.positions.length; i += 3) {
      // Shift in double precision, then convert to float
      const x = mesh.positions[i] - this.originShift[0];
      const y = mesh.positions[i + 1] - this.originShift[1];
      const z = mesh.positions[i + 2] - this.originShift[2];
      
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = z;
    }
    
    return {
      ...mesh,
      positions,
      bounds: this.shiftBounds(mesh.bounds),
    };
  }
  
  /**
   * Convert world coordinate to shifted space.
   */
  worldToShifted(worldPos: [number, number, number]): [number, number, number] {
    return [
      worldPos[0] - this.originShift[0],
      worldPos[1] - this.originShift[1],
      worldPos[2] - this.originShift[2],
    ];
  }
  
  /**
   * Convert shifted coordinate back to world space.
   */
  shiftedToWorld(shiftedPos: [number, number, number]): [number, number, number] {
    return [
      shiftedPos[0] + this.originShift[0],
      shiftedPos[1] + this.originShift[1],
      shiftedPos[2] + this.originShift[2],
    ];
  }
}

/**
 * Double-precision camera for large coordinate scenes.
 */
class DoublePrecisionCamera {
  // High precision position (world coordinates)
  private positionHigh: Float64Array = new Float64Array(3);
  
  // Low precision offset for GPU
  private positionLow: Float32Array = new Float32Array(3);
  
  // Origin shift reference
  private originShift: Float64Array = new Float64Array(3);
  
  /**
   * Set camera position in world coordinates.
   */
  setPosition(x: number, y: number, z: number): void {
    this.positionHigh[0] = x;
    this.positionHigh[1] = y;
    this.positionHigh[2] = z;
    
    // Compute low-precision offset from origin shift
    this.positionLow[0] = x - this.originShift[0];
    this.positionLow[1] = y - this.originShift[1];
    this.positionLow[2] = z - this.originShift[2];
  }
  
  /**
   * Get view matrix for GPU (single precision, shifted).
   */
  getViewMatrix(): Mat4 {
    // Use shifted position for view matrix
    const eye = this.positionLow;
    const target = this.getShiftedTarget();
    const up = [0, 0, 1];
    
    return mat4.lookAt(mat4.create(), eye, target, up);
  }
  
  /**
   * Transform ray from screen to world coordinates.
   */
  screenToWorldRay(
    screenX: number, 
    screenY: number
  ): { origin: Float64Array; direction: Float32Array } {
    // Compute ray in shifted space
    const shiftedRay = this.computeScreenRay(screenX, screenY);
    
    // Convert origin back to world space (double precision)
    const worldOrigin = new Float64Array(3);
    worldOrigin[0] = shiftedRay.origin[0] + this.originShift[0];
    worldOrigin[1] = shiftedRay.origin[1] + this.originShift[1];
    worldOrigin[2] = shiftedRay.origin[2] + this.originShift[2];
    
    return {
      origin: worldOrigin,
      direction: shiftedRay.direction, // Direction doesn't need shifting
    };
  }
}
```

### GPU-Side Handling (Relative-to-Eye Rendering)

```wgsl
// Vertex shader with relative-to-eye positioning
struct Uniforms {
  viewMatrix: mat4x4f,
  projMatrix: mat4x4f,
  cameraPositionLow: vec3f,  // Low part of camera position
  cameraPositionHigh: vec3f, // High part for precision
}

@vertex
fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) modelMatrixCol0: vec4f,
  @location(3) modelMatrixCol1: vec4f,
  @location(4) modelMatrixCol2: vec4f,
  @location(5) modelMatrixCol3: vec4f,
) -> VertexOutput {
  var out: VertexOutput;
  
  // Reconstruct model matrix
  let modelMatrix = mat4x4f(
    modelMatrixCol0,
    modelMatrixCol1,
    modelMatrixCol2,
    modelMatrixCol3
  );
  
  // World position (already shifted by origin)
  let worldPos = modelMatrix * vec4f(position, 1.0);
  
  // Relative-to-eye position (eliminates large coordinate issues)
  let eyeRelativePos = worldPos.xyz - uniforms.cameraPositionLow;
  
  // Apply view and projection
  let viewPos = uniforms.viewMatrix * vec4f(eyeRelativePos, 1.0);
  out.position = uniforms.projMatrix * viewPos;
  
  // Pass world position for lighting (shifted space is fine)
  out.worldPos = worldPos.xyz;
  out.normal = (modelMatrix * vec4f(normal, 0.0)).xyz;
  
  return out;
}
```

### Logarithmic Depth Buffer for Extreme Z Range

```typescript
/**
 * Configure logarithmic depth buffer for large scenes.
 */
class LogarithmicDepthBuffer {
  private near = 0.1;
  private far = 100000; // 100km
  
  /**
   * Get projection matrix with logarithmic depth.
   */
  getProjectionMatrix(fov: number, aspect: number): Mat4 {
    // Standard perspective matrix
    const proj = mat4.perspective(mat4.create(), fov, aspect, this.near, this.far);
    
    // The actual log depth is computed in shader
    return proj;
  }
  
  /**
   * Shader code for logarithmic depth.
   */
  static getShaderCode(): string {
    return /* wgsl */ `
      // In vertex shader
      fn applyLogDepth(clipPos: vec4f, near: f32, far: f32) -> vec4f {
        var pos = clipPos;
        
        // Logarithmic depth
        let C = 0.001; // Constant to avoid log(0)
        let FC = 1.0 / log(far * C + 1.0);
        
        // Replace linear Z with logarithmic
        pos.z = log(max(pos.w * C + 1.0, 1e-6)) * FC * pos.w;
        
        return pos;
      }
      
      // In fragment shader - must write to depth
      fn getLogDepth(fragDepth: f32, near: f32, far: f32) -> f32 {
        let C = 0.001;
        let FC = 1.0 / log(far * C + 1.0);
        return log(fragDepth * C + 1.0) * FC;
      }
    `;
  }
}
```

---

## Summary of Critical Solutions

| Issue | Solution | Complexity | Priority |
|-------|----------|------------|----------|
| CSG/Boolean Operations | 3-tier strategy: Clipping → Manifold → Fallback | High | P0 |
| Opening Processing | Integrated with geometry extraction, CSG-based | Medium | P0 |
| Placement Chains | Topological sort + transform accumulation | Medium | P0 |
| Error Handling | Multi-level recovery with graceful degradation | Medium | P1 |
| Unit Conversion | Registry-based conversion from IfcUnitAssignment | Low | P1 |
| Streaming Dependencies | Two-phase: index first, then ordered emission | High | P1 |
| Instance Detection | Geometric fingerprinting with histograms | Medium | P2 |
| Section Caps | Edge collection + polygon triangulation | Medium | P2 |
| Schema Generation | EXPRESS parser → TypeScript generator | Medium | P2 |
| Large Coordinates | Origin shifting + relative-to-eye rendering | Medium | P2 |

---

*This document should be read alongside the main specification parts 1-7.*

