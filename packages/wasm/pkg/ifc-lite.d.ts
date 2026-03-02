/* tslint:disable */
/* eslint-disable */

/**
 * Georeferencing information exposed to JavaScript
 */
export class GeoReferenceJs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Transform local coordinates to map coordinates
     */
    localToMap(x: number, y: number, z: number): Float64Array;
    /**
     * Transform map coordinates to local coordinates
     */
    mapToLocal(e: number, n: number, h: number): Float64Array;
    /**
     * Get 4x4 transformation matrix (column-major for WebGL)
     */
    toMatrix(): Float64Array;
    /**
     * Get CRS name
     */
    readonly crsName: string | undefined;
    /**
     * Get rotation angle in radians
     */
    readonly rotation: number;
    /**
     * Eastings (X offset)
     */
    eastings: number;
    /**
     * Northings (Y offset)
     */
    northings: number;
    /**
     * Orthogonal height (Z offset)
     */
    orthogonal_height: number;
    /**
     * Scale factor
     */
    scale: number;
    /**
     * X-axis abscissa (cos of rotation)
     */
    x_axis_abscissa: number;
    /**
     * X-axis ordinate (sin of rotation)
     */
    x_axis_ordinate: number;
}

/**
 * GPU-ready geometry stored in WASM linear memory
 *
 * Data layout:
 * - vertex_data: Interleaved [px, py, pz, nx, ny, nz, ...] (6 floats per vertex)
 * - indices: Triangle indices [i0, i1, i2, ...]
 * - mesh_metadata: Per-mesh metadata for draw calls
 *
 * All coordinates are pre-converted from IFC Z-up to WebGL Y-up
 */
export class GpuGeometry {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get IFC type name by index
     */
    getIfcTypeName(index: number): string | undefined;
    /**
     * Get metadata for a specific mesh
     */
    getMeshMetadata(index: number): GpuMeshMetadata | undefined;
    /**
     * Create a new empty GPU geometry container
     */
    constructor();
    /**
     * Set the RTC (Relative To Center) offset applied to coordinates
     */
    set_rtc_offset(x: number, y: number, z: number): void;
    /**
     * Check if RTC offset is active (non-zero)
     */
    readonly hasRtcOffset: boolean;
    /**
     * Get byte length of indices (for GPU buffer creation)
     */
    readonly indicesByteLength: number;
    /**
     * Get length of indices array (in u32 elements)
     */
    readonly indicesLen: number;
    /**
     * Get pointer to indices array for zero-copy view
     */
    readonly indicesPtr: number;
    /**
     * Check if geometry is empty
     */
    readonly isEmpty: boolean;
    /**
     * Get number of meshes in this geometry batch
     */
    readonly meshCount: number;
    /**
     * Get X component of RTC offset
     */
    readonly rtcOffsetX: number;
    /**
     * Get Y component of RTC offset
     */
    readonly rtcOffsetY: number;
    /**
     * Get Z component of RTC offset
     */
    readonly rtcOffsetZ: number;
    /**
     * Get total triangle count
     */
    readonly totalTriangleCount: number;
    /**
     * Get total vertex count
     */
    readonly totalVertexCount: number;
    /**
     * Get byte length of vertex data (for GPU buffer creation)
     */
    readonly vertexDataByteLength: number;
    /**
     * Get length of vertex data array (in f32 elements, not bytes)
     */
    readonly vertexDataLen: number;
    /**
     * Get pointer to vertex data for zero-copy view
     *
     * SAFETY: View is only valid until next WASM allocation!
     * Create view, upload to GPU, then discard view immediately.
     */
    readonly vertexDataPtr: number;
}

/**
 * GPU-ready instanced geometry for efficient rendering of repeated shapes
 *
 * Data layout:
 * - vertex_data: Interleaved [px, py, pz, nx, ny, nz, ...] (shared geometry)
 * - indices: Triangle indices (shared geometry)
 * - instance_data: [transform (16 floats) + color (4 floats)] per instance = 20 floats
 */
export class GpuInstancedGeometry {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create new instanced geometry
     */
    constructor(geometry_id: bigint);
    readonly geometryId: bigint;
    readonly indicesByteLength: number;
    readonly indicesLen: number;
    readonly indicesPtr: number;
    readonly instanceCount: number;
    readonly instanceDataByteLength: number;
    readonly instanceDataLen: number;
    readonly instanceDataPtr: number;
    readonly instanceExpressIdsPtr: number;
    readonly triangleCount: number;
    readonly vertexCount: number;
    readonly vertexDataByteLength: number;
    readonly vertexDataLen: number;
    readonly vertexDataPtr: number;
}

/**
 * Collection of GPU-ready instanced geometries
 */
export class GpuInstancedGeometryCollection {
    free(): void;
    [Symbol.dispose](): void;
    get(index: number): GpuInstancedGeometry | undefined;
    /**
     * Get geometry by index with zero-copy access
     * Returns a reference that provides pointer access
     */
    getRef(index: number): GpuInstancedGeometryRef | undefined;
    constructor();
    readonly length: number;
}

/**
 * Reference to geometry in collection for zero-copy access
 * This avoids cloning when accessing geometry data
 */
export class GpuInstancedGeometryRef {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly geometryId: bigint;
    readonly indicesByteLength: number;
    readonly indicesLen: number;
    readonly indicesPtr: number;
    readonly instanceCount: number;
    readonly instanceDataByteLength: number;
    readonly instanceDataLen: number;
    readonly instanceDataPtr: number;
    readonly instanceExpressIdsPtr: number;
    readonly vertexDataByteLength: number;
    readonly vertexDataLen: number;
    readonly vertexDataPtr: number;
}

/**
 * Metadata for a single mesh within the GPU geometry buffer
 */
export class GpuMeshMetadata {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly color: Float32Array;
    readonly expressId: number;
    readonly ifcTypeIdx: number;
    readonly indexCount: number;
    readonly indexOffset: number;
    readonly vertexCount: number;
    readonly vertexOffset: number;
}

/**
 * Main IFC-Lite API
 */
export class IfcAPI {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Debug: Test processing entity #953 (FacetedBrep wall)
     */
    debugProcessEntity953(content: string): string;
    /**
     * Debug: Test processing a single wall
     */
    debugProcessFirstWall(content: string): string;
    /**
     * Extract georeferencing information from IFC content
     * Returns null if no georeferencing is present
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const georef = api.getGeoReference(ifcData);
     * if (georef) {
     *   console.log('CRS:', georef.crsName);
     *   const [e, n, h] = georef.localToMap(10, 20, 5);
     * }
     * ```
     */
    getGeoReference(content: string): GeoReferenceJs | undefined;
    /**
     * Get WASM memory for zero-copy access
     */
    getMemory(): any;
    /**
     * Create and initialize the IFC API
     */
    constructor();
    /**
     * Parse IFC file (traditional - waits for completion)
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const result = await api.parse(ifcData);
     * console.log('Entities:', result.entityCount);
     * ```
     */
    parse(content: string): Promise<any>;
    /**
     * Parse IFC file and return individual meshes with express IDs and colors
     * This matches the MeshData[] format expected by the viewer
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const collection = api.parseMeshes(ifcData);
     * for (let i = 0; i < collection.length; i++) {
     *   const mesh = collection.get(i);
     *   console.log('Express ID:', mesh.expressId);
     *   console.log('Positions:', mesh.positions);
     *   console.log('Color:', mesh.color);
     * }
     * ```
     */
    parseMeshes(content: string): MeshCollection;
    /**
     * Parse IFC file with streaming mesh batches for progressive rendering
     * Calls the callback with batches of meshes, yielding to browser between batches
     *
     * Options:
     * - `batchSize`: Number of meshes per batch (default: 25)
     * - `onBatch(meshes, progress)`: Called for each batch of meshes
     * - `onRtcOffset({x, y, z, hasRtc})`: Called early with RTC offset for camera/world setup
     * - `onColorUpdate(Map<id, color>)`: Called with style updates after initial render
     * - `onComplete(stats)`: Called when parsing completes with stats including rtcOffset
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * await api.parseMeshesAsync(ifcData, {
     *   batchSize: 100,
     *   onRtcOffset: (rtc) => {
     *     if (rtc.hasRtc) {
     *       // Model uses large coordinates - adjust camera/world origin
     *       viewer.setWorldOffset(rtc.x, rtc.y, rtc.z);
     *     }
     *   },
     *   onBatch: (meshes, progress) => {
     *     for (const mesh of meshes) {
     *       scene.add(createThreeMesh(mesh));
     *     }
     *     console.log(`Progress: ${progress.percent}%`);
     *   },
     *   onComplete: (stats) => {
     *     console.log(`Done! ${stats.totalMeshes} meshes`);
     *     // stats.rtcOffset also available here: {x, y, z, hasRtc}
     *   }
     * });
     * ```
     */
    parseMeshesAsync(content: string, options: any): Promise<any>;
    /**
     * Parse IFC file and return instanced geometry grouped by geometry hash
     * This reduces draw calls by grouping identical geometries with different transforms
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const collection = api.parseMeshesInstanced(ifcData);
     * for (let i = 0; i < collection.length; i++) {
     *   const geometry = collection.get(i);
     *   console.log('Geometry ID:', geometry.geometryId);
     *   console.log('Instances:', geometry.instanceCount);
     *   for (let j = 0; j < geometry.instanceCount; j++) {
     *     const inst = geometry.getInstance(j);
     *     console.log('  Express ID:', inst.expressId);
     *     console.log('  Transform:', inst.transform);
     *   }
     * }
     * ```
     */
    parseMeshesInstanced(content: string): InstancedMeshCollection;
    /**
     * Parse IFC file with streaming instanced geometry batches for progressive rendering
     * Groups identical geometries and yields batches of InstancedGeometry
     * Uses fast-first-frame streaming: simple geometry (walls, slabs) first
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * await api.parseMeshesInstancedAsync(ifcData, {
     *   batchSize: 25,  // Number of unique geometries per batch
     *   onBatch: (geometries, progress) => {
     *     for (const geom of geometries) {
     *       renderer.addInstancedGeometry(geom);
     *     }
     *   },
     *   onComplete: (stats) => {
     *     console.log(`Done! ${stats.totalGeometries} unique geometries, ${stats.totalInstances} instances`);
     *   }
     * });
     * ```
     */
    parseMeshesInstancedAsync(content: string, options: any): Promise<any>;
    /**
     * Parse IFC file and return mesh with RTC offset for large coordinates
     * This handles georeferenced models by shifting to centroid
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const result = api.parseMeshesWithRtc(ifcData);
     * const rtcOffset = result.rtcOffset;
     * const meshes = result.meshes;
     *
     * // Convert local coords back to world:
     * if (rtcOffset.isSignificant()) {
     *   const [wx, wy, wz] = rtcOffset.toWorld(localX, localY, localZ);
     * }
     * ```
     */
    parseMeshesWithRtc(content: string): MeshCollectionWithRtc;
    /**
     * Parse IFC file with streaming events
     * Calls the callback function for each parse event
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * await api.parseStreaming(ifcData, (event) => {
     *   console.log('Event:', event);
     * });
     * ```
     */
    parseStreaming(content: string, callback: Function): Promise<any>;
    /**
     * Parse IFC file and extract symbolic representations (Plan, Annotation, FootPrint)
     * These are 2D curves used for architectural drawings instead of sectioning 3D geometry
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const symbols = api.parseSymbolicRepresentations(ifcData);
     * console.log('Found', symbols.totalCount, 'symbolic items');
     * for (let i = 0; i < symbols.polylineCount; i++) {
     *   const polyline = symbols.getPolyline(i);
     *   console.log('Polyline for', polyline.ifcType, ':', polyline.points);
     * }
     * ```
     */
    parseSymbolicRepresentations(content: string): SymbolicRepresentationCollection;
    /**
     * Parse IFC file and return GPU-ready geometry for zero-copy upload
     *
     * This method generates geometry that is:
     * - Pre-interleaved (position + normal per vertex)
     * - Coordinate-converted (Z-up to Y-up)
     * - Ready for direct GPU upload via pointer access
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const gpuGeom = api.parseToGpuGeometry(ifcData);
     *
     * // Get WASM memory for zero-copy views
     * const memory = api.getMemory();
     *
     * // Create views directly into WASM memory (NO COPY!)
     * const vertexView = new Float32Array(
     *   memory.buffer,
     *   gpuGeom.vertexDataPtr,
     *   gpuGeom.vertexDataLen
     * );
     * const indexView = new Uint32Array(
     *   memory.buffer,
     *   gpuGeom.indicesPtr,
     *   gpuGeom.indicesLen
     * );
     *
     * // Upload directly to GPU (single copy: WASM → GPU)
     * device.queue.writeBuffer(vertexBuffer, 0, vertexView);
     * device.queue.writeBuffer(indexBuffer, 0, indexView);
     *
     * // Free when done
     * gpuGeom.free();
     * ```
     */
    parseToGpuGeometry(content: string): GpuGeometry;
    /**
     * Parse IFC file with streaming GPU-ready geometry batches
     *
     * Yields batches of GPU-ready geometry for progressive rendering with zero-copy upload.
     * Uses fast-first-frame streaming: simple geometry (walls, slabs) first.
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const memory = api.getMemory();
     *
     * await api.parseToGpuGeometryAsync(ifcData, {
     *   batchSize: 25,
     *   onBatch: (gpuGeom, progress) => {
     *     // Create zero-copy views
     *     const vertexView = new Float32Array(
     *       memory.buffer,
     *       gpuGeom.vertexDataPtr,
     *       gpuGeom.vertexDataLen
     *     );
     *
     *     // Upload to GPU
     *     device.queue.writeBuffer(vertexBuffer, 0, vertexView);
     *
     *     // IMPORTANT: Free immediately after upload!
     *     gpuGeom.free();
     *   },
     *   onComplete: (stats) => {
     *     console.log(`Done! ${stats.totalMeshes} meshes`);
     *   }
     * });
     * ```
     */
    parseToGpuGeometryAsync(content: string, options: any): Promise<any>;
    /**
     * Parse IFC file to GPU-ready instanced geometry for zero-copy upload
     *
     * Groups identical geometries by hash for efficient GPU instancing.
     * Returns a collection of instanced geometries with pointer access.
     */
    parseToGpuInstancedGeometry(content: string): GpuInstancedGeometryCollection;
    /**
     * Parse IFC file with zero-copy mesh data
     * Maximum performance - returns mesh with direct memory access
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const mesh = await api.parseZeroCopy(ifcData);
     *
     * // Create TypedArray views (NO COPYING!)
     * const memory = await api.getMemory();
     * const positions = new Float32Array(
     *   memory.buffer,
     *   mesh.positions_ptr,
     *   mesh.positions_len
     * );
     *
     * // Upload directly to GPU
     * gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
     * ```
     */
    parseZeroCopy(content: string): ZeroCopyMesh;
    /**
     * Fast entity scanning using SIMD-accelerated Rust scanner
     * Returns array of entity references for data model parsing
     * Much faster than TypeScript byte-by-byte scanning (5-10x speedup)
     */
    scanEntitiesFast(content: string): any;
    /**
     * Fast entity scanning from raw bytes (avoids TextDecoder.decode on JS side).
     * Accepts Uint8Array directly — saves ~2-5s for 487MB files by skipping
     * JS string creation and UTF-16→UTF-8 conversion.
     */
    scanEntitiesFastBytes(data: Uint8Array): any;
    /**
     * Fast geometry-only entity scanning
     * Scans only entities that have geometry, skipping 99% of non-geometry entities
     * Returns array of geometry entity references for parallel processing
     * Much faster than scanning all entities (3x speedup for large files)
     */
    scanGeometryEntitiesFast(content: string): any;
    /**
     * Check if API is initialized
     */
    readonly is_ready: boolean;
    /**
     * Get version string
     */
    readonly version: string;
}

/**
 * Instance data for instanced rendering
 */
export class InstanceData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly color: Float32Array;
    readonly expressId: number;
    readonly transform: Float32Array;
}

/**
 * Instanced geometry - one geometry definition with multiple instances
 */
export class InstancedGeometry {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    get_instance(index: number): InstanceData | undefined;
    readonly geometryId: bigint;
    readonly indices: Uint32Array;
    readonly instance_count: number;
    readonly normals: Float32Array;
    readonly positions: Float32Array;
}

/**
 * Collection of instanced geometries
 */
export class InstancedMeshCollection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    get(index: number): InstancedGeometry | undefined;
    readonly length: number;
    readonly totalGeometries: number;
    readonly totalInstances: number;
}

/**
 * Collection of mesh data for returning multiple meshes
 */
export class MeshCollection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get mesh at index
     */
    get(index: number): MeshDataJs | undefined;
    /**
     * Check if RTC offset is significant (>10km)
     */
    hasRtcOffset(): boolean;
    /**
     * Convert local coordinates to world coordinates
     * Use this to convert mesh positions back to original IFC coordinates
     */
    localToWorld(x: number, y: number, z: number): Float64Array;
    /**
     * Get building rotation angle in radians (from IfcSite placement)
     * Returns None if no rotation was detected
     */
    readonly buildingRotation: number | undefined;
    /**
     * Get number of meshes
     */
    readonly length: number;
    /**
     * Get RTC offset X (for converting local coords back to world coords)
     * Add this to local X coordinates to get world X coordinates
     */
    readonly rtcOffsetX: number;
    /**
     * Get RTC offset Y
     */
    readonly rtcOffsetY: number;
    /**
     * Get RTC offset Z
     */
    readonly rtcOffsetZ: number;
    /**
     * Get total triangle count across all meshes
     */
    readonly totalTriangles: number;
    /**
     * Get total vertex count across all meshes
     */
    readonly totalVertices: number;
}

/**
 * Mesh collection with RTC offset for large coordinates
 */
export class MeshCollectionWithRtc {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get mesh at index
     */
    get(index: number): MeshDataJs | undefined;
    /**
     * Get number of meshes
     */
    readonly length: number;
    /**
     * Get the mesh collection
     */
    readonly meshes: MeshCollection;
    /**
     * Get the RTC offset
     */
    readonly rtcOffset: RtcOffsetJs;
}

/**
 * Individual mesh data with express ID and color (matches MeshData interface)
 */
export class MeshDataJs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get color as [r, g, b, a] array
     */
    readonly color: Float32Array;
    /**
     * Get express ID
     */
    readonly expressId: number;
    /**
     * Get IFC type name (e.g., "IfcWall", "IfcSpace")
     */
    readonly ifcType: string;
    /**
     * Get indices as Uint32Array (copy to JS)
     */
    readonly indices: Uint32Array;
    /**
     * Get normals as Float32Array (copy to JS)
     */
    readonly normals: Float32Array;
    /**
     * Get positions as Float32Array (copy to JS)
     */
    readonly positions: Float32Array;
    /**
     * Get triangle count
     */
    readonly triangleCount: number;
    /**
     * Get vertex count
     */
    readonly vertexCount: number;
}

/**
 * RTC offset information exposed to JavaScript
 */
export class RtcOffsetJs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Check if offset is significant (>10km)
     */
    isSignificant(): boolean;
    /**
     * Convert local coordinates to world coordinates
     */
    toWorld(x: number, y: number, z: number): Float64Array;
    /**
     * X offset (subtracted from positions)
     */
    x: number;
    /**
     * Y offset
     */
    y: number;
    /**
     * Z offset
     */
    z: number;
}

/**
 * A 2D circle/arc for symbolic representations
 */
export class SymbolicCircle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly centerX: number;
    readonly centerY: number;
    readonly endAngle: number;
    readonly expressId: number;
    readonly ifcType: string;
    /**
     * Check if this is a full circle
     */
    readonly isFullCircle: boolean;
    readonly radius: number;
    readonly repIdentifier: string;
    readonly startAngle: number;
}

/**
 * A single 2D polyline for symbolic representations (Plan, Annotation, FootPrint)
 * Points are stored as [x1, y1, x2, y2, ...] in 2D coordinates
 */
export class SymbolicPolyline {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get express ID of the parent element
     */
    readonly expressId: number;
    /**
     * Get IFC type name (e.g., "IfcDoor", "IfcWindow")
     */
    readonly ifcType: string;
    /**
     * Check if this is a closed loop
     */
    readonly isClosed: boolean;
    /**
     * Get number of points
     */
    readonly pointCount: number;
    /**
     * Get 2D points as Float32Array [x1, y1, x2, y2, ...]
     */
    readonly points: Float32Array;
    /**
     * Get representation identifier ("Plan", "Annotation", "FootPrint", "Axis")
     */
    readonly repIdentifier: string;
}

/**
 * Collection of symbolic representations for an IFC model
 */
export class SymbolicRepresentationCollection {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get circle at index
     */
    getCircle(index: number): SymbolicCircle | undefined;
    /**
     * Get all express IDs that have symbolic representations
     */
    getExpressIds(): Uint32Array;
    /**
     * Get polyline at index
     */
    getPolyline(index: number): SymbolicPolyline | undefined;
    /**
     * Get number of circles/arcs
     */
    readonly circleCount: number;
    /**
     * Check if collection is empty
     */
    readonly isEmpty: boolean;
    /**
     * Get number of polylines
     */
    readonly polylineCount: number;
    /**
     * Get total count of all symbolic items
     */
    readonly totalCount: number;
}

/**
 * Zero-copy mesh that exposes pointers to WASM memory
 */
export class ZeroCopyMesh {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get bounding box maximum point
     */
    bounds_max(): Float32Array;
    /**
     * Get bounding box minimum point
     */
    bounds_min(): Float32Array;
    /**
     * Create a new zero-copy mesh from a Mesh
     */
    constructor();
    /**
     * Get length of indices array
     */
    readonly indices_len: number;
    /**
     * Get pointer to indices array
     */
    readonly indices_ptr: number;
    /**
     * Check if mesh is empty
     */
    readonly is_empty: boolean;
    /**
     * Get length of normals array
     */
    readonly normals_len: number;
    /**
     * Get pointer to normals array
     */
    readonly normals_ptr: number;
    /**
     * Get length of positions array (in f32 elements, not bytes)
     */
    readonly positions_len: number;
    /**
     * Get pointer to positions array
     * JavaScript can create Float32Array view: new Float32Array(memory.buffer, ptr, length)
     */
    readonly positions_ptr: number;
    /**
     * Get triangle count
     */
    readonly triangle_count: number;
    /**
     * Get vertex count
     */
    readonly vertex_count: number;
}

/**
 * Get WASM memory to allow JavaScript to create TypedArray views
 */
export function get_memory(): any;

/**
 * Initialize the WASM module.
 *
 * This function is called automatically when the WASM module is loaded.
 * It sets up panic hooks for better error messages in the browser console.
 */
export function init(): void;

/**
 * Get the version of IFC-Lite.
 *
 * # Returns
 *
 * Version string (e.g., "0.1.0")
 *
 * # Example
 *
 * ```javascript
 * console.log(`IFC-Lite version: ${version()}`);
 * ```
 */
export function version(): string;
