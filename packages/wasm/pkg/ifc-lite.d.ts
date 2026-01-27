/* tslint:disable */
/* eslint-disable */

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
   * X-axis abscissa (cos of rotation)
   */
  x_axis_abscissa: number;
  /**
   * X-axis ordinate (sin of rotation)
   */
  x_axis_ordinate: number;
  /**
   * Scale factor
   */
  scale: number;
  /**
   * Get CRS name
   */
  readonly crsName: string | undefined;
  /**
   * Get rotation angle in radians
   */
  readonly rotation: number;
}

export class GpuGeometry {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Set the RTC (Relative To Center) offset applied to coordinates
   */
  set_rtc_offset(x: number, y: number, z: number): void;
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
   * Get number of meshes in this geometry batch
   */
  readonly meshCount: number;
  /**
   * Get length of indices array (in u32 elements)
   */
  readonly indicesLen: number;
  /**
   * Get pointer to indices array for zero-copy view
   */
  readonly indicesPtr: number;
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
   * Check if RTC offset is active (non-zero)
   */
  readonly hasRtcOffset: boolean;
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
  /**
   * Get total vertex count
   */
  readonly totalVertexCount: number;
  /**
   * Get byte length of indices (for GPU buffer creation)
   */
  readonly indicesByteLength: number;
  /**
   * Get total triangle count
   */
  readonly totalTriangleCount: number;
  /**
   * Get byte length of vertex data (for GPU buffer creation)
   */
  readonly vertexDataByteLength: number;
  /**
   * Check if geometry is empty
   */
  readonly isEmpty: boolean;
}

export class GpuInstancedGeometry {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create new instanced geometry
   */
  constructor(geometry_id: bigint);
  readonly geometryId: bigint;
  readonly indicesLen: number;
  readonly indicesPtr: number;
  readonly vertexCount: number;
  readonly instanceCount: number;
  readonly triangleCount: number;
  readonly vertexDataLen: number;
  readonly vertexDataPtr: number;
  readonly instanceDataLen: number;
  readonly instanceDataPtr: number;
  readonly indicesByteLength: number;
  readonly vertexDataByteLength: number;
  readonly instanceExpressIdsPtr: number;
  readonly instanceDataByteLength: number;
}

export class GpuInstancedGeometryCollection {
  free(): void;
  [Symbol.dispose](): void;
  get(index: number): GpuInstancedGeometry | undefined;
  constructor();
  /**
   * Get geometry by index with zero-copy access
   * Returns a reference that provides pointer access
   */
  getRef(index: number): GpuInstancedGeometryRef | undefined;
  readonly length: number;
}

export class GpuInstancedGeometryRef {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly geometryId: bigint;
  readonly indicesLen: number;
  readonly indicesPtr: number;
  readonly instanceCount: number;
  readonly vertexDataLen: number;
  readonly vertexDataPtr: number;
  readonly instanceDataLen: number;
  readonly instanceDataPtr: number;
  readonly indicesByteLength: number;
  readonly vertexDataByteLength: number;
  readonly instanceExpressIdsPtr: number;
  readonly instanceDataByteLength: number;
}

export class GpuMeshMetadata {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly expressId: number;
  readonly indexCount: number;
  readonly ifcTypeIdx: number;
  readonly indexOffset: number;
  readonly vertexCount: number;
  readonly vertexOffset: number;
  readonly color: Float32Array;
}

export class IfcAPI {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get WASM memory for zero-copy access
   */
  getMemory(): any;
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
   * Fast entity scanning using SIMD-accelerated Rust scanner
   * Returns array of entity references for data model parsing
   * Much faster than TypeScript byte-by-byte scanning (5-10x speedup)
   */
  scanEntitiesFast(content: string): any;
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
   * Debug: Test processing entity #953 (FacetedBrep wall)
   */
  debugProcessEntity953(content: string): string;
  /**
   * Debug: Test processing a single wall
   */
  debugProcessFirstWall(content: string): string;
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
   * Fast geometry-only entity scanning
   * Scans only entities that have geometry, skipping 99% of non-geometry entities
   * Returns array of geometry entity references for parallel processing
   * Much faster than scanning all entities (3x speedup for large files)
   */
  scanGeometryEntitiesFast(content: string): any;
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
   * Parse IFC file to GPU-ready instanced geometry for zero-copy upload
   *
   * Groups identical geometries by hash for efficient GPU instancing.
   * Returns a collection of instanced geometries with pointer access.
   */
  parseToGpuInstancedGeometry(content: string): GpuInstancedGeometryCollection;
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
   * Get version string
   */
  readonly version: string;
  /**
   * Check if API is initialized
   */
  readonly is_ready: boolean;
}

export class InstanceData {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  readonly expressId: number;
  readonly color: Float32Array;
  readonly transform: Float32Array;
}

export class InstancedGeometry {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  get_instance(index: number): InstanceData | undefined;
  readonly geometryId: bigint;
  readonly instance_count: number;
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

export class InstancedMeshCollection {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  get(index: number): InstancedGeometry | undefined;
  readonly totalInstances: number;
  readonly totalGeometries: number;
  readonly length: number;
}

export class MeshCollection {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
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
   * Get mesh at index
   */
  get(index: number): MeshDataJs | undefined;
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
   * Get total vertex count across all meshes
   */
  readonly totalVertices: number;
  /**
   * Get total triangle count across all meshes
   */
  readonly totalTriangles: number;
  /**
   * Get number of meshes
   */
  readonly length: number;
}

export class MeshCollectionWithRtc {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get mesh at index
   */
  get(index: number): MeshDataJs | undefined;
  /**
   * Get the RTC offset
   */
  readonly rtcOffset: RtcOffsetJs;
  /**
   * Get number of meshes
   */
  readonly length: number;
  /**
   * Get the mesh collection
   */
  readonly meshes: MeshCollection;
}

export class MeshDataJs {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get express ID
   */
  readonly expressId: number;
  /**
   * Get vertex count
   */
  readonly vertexCount: number;
  /**
   * Get triangle count
   */
  readonly triangleCount: number;
  /**
   * Get color as [r, g, b, a] array
   */
  readonly color: Float32Array;
  /**
   * Get indices as Uint32Array (copy to JS)
   */
  readonly indices: Uint32Array;
  /**
   * Get normals as Float32Array (copy to JS)
   */
  readonly normals: Float32Array;
  /**
   * Get IFC type name (e.g., "IfcWall", "IfcSpace")
   */
  readonly ifcType: string;
  /**
   * Get positions as Float32Array (copy to JS)
   */
  readonly positions: Float32Array;
}

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
   * Get length of normals array
   */
  readonly normals_len: number;
  /**
   * Get pointer to normals array
   */
  readonly normals_ptr: number;
  /**
   * Get vertex count
   */
  readonly vertex_count: number;
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
   * Check if mesh is empty
   */
  readonly is_empty: boolean;
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_georeferencejs_free: (a: number, b: number) => void;
  readonly __wbg_get_georeferencejs_eastings: (a: number) => number;
  readonly __wbg_get_georeferencejs_northings: (a: number) => number;
  readonly __wbg_get_georeferencejs_orthogonal_height: (a: number) => number;
  readonly __wbg_get_georeferencejs_scale: (a: number) => number;
  readonly __wbg_get_georeferencejs_x_axis_abscissa: (a: number) => number;
  readonly __wbg_get_georeferencejs_x_axis_ordinate: (a: number) => number;
  readonly __wbg_gpugeometry_free: (a: number, b: number) => void;
  readonly __wbg_gpuinstancedgeometry_free: (a: number, b: number) => void;
  readonly __wbg_gpuinstancedgeometrycollection_free: (a: number, b: number) => void;
  readonly __wbg_gpuinstancedgeometryref_free: (a: number, b: number) => void;
  readonly __wbg_gpumeshmetadata_free: (a: number, b: number) => void;
  readonly __wbg_ifcapi_free: (a: number, b: number) => void;
  readonly __wbg_instancedata_free: (a: number, b: number) => void;
  readonly __wbg_instancedgeometry_free: (a: number, b: number) => void;
  readonly __wbg_instancedmeshcollection_free: (a: number, b: number) => void;
  readonly __wbg_meshcollection_free: (a: number, b: number) => void;
  readonly __wbg_meshcollectionwithrtc_free: (a: number, b: number) => void;
  readonly __wbg_meshdatajs_free: (a: number, b: number) => void;
  readonly __wbg_rtcoffsetjs_free: (a: number, b: number) => void;
  readonly __wbg_set_georeferencejs_eastings: (a: number, b: number) => void;
  readonly __wbg_set_georeferencejs_northings: (a: number, b: number) => void;
  readonly __wbg_set_georeferencejs_orthogonal_height: (a: number, b: number) => void;
  readonly __wbg_set_georeferencejs_scale: (a: number, b: number) => void;
  readonly __wbg_set_georeferencejs_x_axis_abscissa: (a: number, b: number) => void;
  readonly __wbg_set_georeferencejs_x_axis_ordinate: (a: number, b: number) => void;
  readonly __wbg_zerocopymesh_free: (a: number, b: number) => void;
  readonly georeferencejs_crsName: (a: number, b: number) => void;
  readonly georeferencejs_localToMap: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly georeferencejs_mapToLocal: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly georeferencejs_rotation: (a: number) => number;
  readonly georeferencejs_toMatrix: (a: number, b: number) => void;
  readonly gpugeometry_getIfcTypeName: (a: number, b: number, c: number) => void;
  readonly gpugeometry_getMeshMetadata: (a: number, b: number) => number;
  readonly gpugeometry_hasRtcOffset: (a: number) => number;
  readonly gpugeometry_indicesByteLength: (a: number) => number;
  readonly gpugeometry_indicesLen: (a: number) => number;
  readonly gpugeometry_indicesPtr: (a: number) => number;
  readonly gpugeometry_isEmpty: (a: number) => number;
  readonly gpugeometry_meshCount: (a: number) => number;
  readonly gpugeometry_new: () => number;
  readonly gpugeometry_rtcOffsetX: (a: number) => number;
  readonly gpugeometry_rtcOffsetY: (a: number) => number;
  readonly gpugeometry_rtcOffsetZ: (a: number) => number;
  readonly gpugeometry_set_rtc_offset: (a: number, b: number, c: number, d: number) => void;
  readonly gpugeometry_totalTriangleCount: (a: number) => number;
  readonly gpugeometry_totalVertexCount: (a: number) => number;
  readonly gpugeometry_vertexDataByteLength: (a: number) => number;
  readonly gpugeometry_vertexDataLen: (a: number) => number;
  readonly gpugeometry_vertexDataPtr: (a: number) => number;
  readonly gpuinstancedgeometry_geometryId: (a: number) => bigint;
  readonly gpuinstancedgeometry_indicesByteLength: (a: number) => number;
  readonly gpuinstancedgeometry_indicesLen: (a: number) => number;
  readonly gpuinstancedgeometry_indicesPtr: (a: number) => number;
  readonly gpuinstancedgeometry_instanceCount: (a: number) => number;
  readonly gpuinstancedgeometry_instanceDataByteLength: (a: number) => number;
  readonly gpuinstancedgeometry_instanceDataLen: (a: number) => number;
  readonly gpuinstancedgeometry_instanceDataPtr: (a: number) => number;
  readonly gpuinstancedgeometry_instanceExpressIdsPtr: (a: number) => number;
  readonly gpuinstancedgeometry_new: (a: bigint) => number;
  readonly gpuinstancedgeometry_triangleCount: (a: number) => number;
  readonly gpuinstancedgeometry_vertexCount: (a: number) => number;
  readonly gpuinstancedgeometry_vertexDataByteLength: (a: number) => number;
  readonly gpuinstancedgeometry_vertexDataLen: (a: number) => number;
  readonly gpuinstancedgeometry_vertexDataPtr: (a: number) => number;
  readonly gpuinstancedgeometrycollection_get: (a: number, b: number) => number;
  readonly gpuinstancedgeometrycollection_getRef: (a: number, b: number) => number;
  readonly gpuinstancedgeometrycollection_length: (a: number) => number;
  readonly gpuinstancedgeometrycollection_new: () => number;
  readonly gpuinstancedgeometryref_geometryId: (a: number) => bigint;
  readonly gpuinstancedgeometryref_indicesByteLength: (a: number) => number;
  readonly gpuinstancedgeometryref_indicesLen: (a: number) => number;
  readonly gpuinstancedgeometryref_indicesPtr: (a: number) => number;
  readonly gpuinstancedgeometryref_instanceCount: (a: number) => number;
  readonly gpuinstancedgeometryref_instanceDataByteLength: (a: number) => number;
  readonly gpuinstancedgeometryref_instanceDataLen: (a: number) => number;
  readonly gpuinstancedgeometryref_instanceDataPtr: (a: number) => number;
  readonly gpuinstancedgeometryref_instanceExpressIdsPtr: (a: number) => number;
  readonly gpuinstancedgeometryref_vertexDataByteLength: (a: number) => number;
  readonly gpuinstancedgeometryref_vertexDataLen: (a: number) => number;
  readonly gpuinstancedgeometryref_vertexDataPtr: (a: number) => number;
  readonly gpumeshmetadata_color: (a: number, b: number) => void;
  readonly gpumeshmetadata_expressId: (a: number) => number;
  readonly gpumeshmetadata_ifcTypeIdx: (a: number) => number;
  readonly gpumeshmetadata_indexCount: (a: number) => number;
  readonly gpumeshmetadata_indexOffset: (a: number) => number;
  readonly gpumeshmetadata_vertexCount: (a: number) => number;
  readonly gpumeshmetadata_vertexOffset: (a: number) => number;
  readonly ifcapi_debugProcessEntity953: (a: number, b: number, c: number, d: number) => void;
  readonly ifcapi_debugProcessFirstWall: (a: number, b: number, c: number, d: number) => void;
  readonly ifcapi_getGeoReference: (a: number, b: number, c: number) => number;
  readonly ifcapi_getMemory: (a: number) => number;
  readonly ifcapi_is_ready: (a: number) => number;
  readonly ifcapi_new: () => number;
  readonly ifcapi_parse: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseMeshes: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseMeshesAsync: (a: number, b: number, c: number, d: number) => number;
  readonly ifcapi_parseMeshesInstanced: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseMeshesInstancedAsync: (a: number, b: number, c: number, d: number) => number;
  readonly ifcapi_parseMeshesWithRtc: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseStreaming: (a: number, b: number, c: number, d: number) => number;
  readonly ifcapi_parseToGpuGeometry: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseToGpuGeometryAsync: (a: number, b: number, c: number, d: number) => number;
  readonly ifcapi_parseToGpuInstancedGeometry: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseZeroCopy: (a: number, b: number, c: number) => number;
  readonly ifcapi_scanEntitiesFast: (a: number, b: number, c: number) => number;
  readonly ifcapi_scanGeometryEntitiesFast: (a: number, b: number, c: number) => number;
  readonly ifcapi_version: (a: number, b: number) => void;
  readonly instancedata_color: (a: number, b: number) => void;
  readonly instancedata_expressId: (a: number) => number;
  readonly instancedata_transform: (a: number) => number;
  readonly instancedgeometry_get_instance: (a: number, b: number) => number;
  readonly instancedgeometry_indices: (a: number) => number;
  readonly instancedgeometry_instance_count: (a: number) => number;
  readonly instancedgeometry_normals: (a: number) => number;
  readonly instancedgeometry_positions: (a: number) => number;
  readonly instancedmeshcollection_get: (a: number, b: number) => number;
  readonly instancedmeshcollection_totalInstances: (a: number) => number;
  readonly meshcollection_get: (a: number, b: number) => number;
  readonly meshcollection_hasRtcOffset: (a: number) => number;
  readonly meshcollection_length: (a: number) => number;
  readonly meshcollection_localToWorld: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly meshcollection_totalTriangles: (a: number) => number;
  readonly meshcollection_totalVertices: (a: number) => number;
  readonly meshcollectionwithrtc_get: (a: number, b: number) => number;
  readonly meshcollectionwithrtc_length: (a: number) => number;
  readonly meshcollectionwithrtc_meshes: (a: number) => number;
  readonly meshcollectionwithrtc_rtcOffset: (a: number) => number;
  readonly meshdatajs_color: (a: number, b: number) => void;
  readonly meshdatajs_expressId: (a: number) => number;
  readonly meshdatajs_ifcType: (a: number, b: number) => void;
  readonly meshdatajs_indices: (a: number) => number;
  readonly meshdatajs_normals: (a: number) => number;
  readonly meshdatajs_positions: (a: number) => number;
  readonly meshdatajs_triangleCount: (a: number) => number;
  readonly meshdatajs_vertexCount: (a: number) => number;
  readonly rtcoffsetjs_toWorld: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly version: (a: number) => void;
  readonly zerocopymesh_bounds_max: (a: number, b: number) => void;
  readonly zerocopymesh_bounds_min: (a: number, b: number) => void;
  readonly zerocopymesh_is_empty: (a: number) => number;
  readonly zerocopymesh_new: () => number;
  readonly zerocopymesh_normals_len: (a: number) => number;
  readonly zerocopymesh_positions_len: (a: number) => number;
  readonly zerocopymesh_positions_ptr: (a: number) => number;
  readonly zerocopymesh_vertex_count: (a: number) => number;
  readonly init: () => void;
  readonly instancedmeshcollection_length: (a: number) => number;
  readonly instancedmeshcollection_totalGeometries: (a: number) => number;
  readonly zerocopymesh_indices_len: (a: number) => number;
  readonly __wbg_set_rtcoffsetjs_x: (a: number, b: number) => void;
  readonly __wbg_set_rtcoffsetjs_y: (a: number, b: number) => void;
  readonly __wbg_set_rtcoffsetjs_z: (a: number, b: number) => void;
  readonly zerocopymesh_triangle_count: (a: number) => number;
  readonly get_memory: () => number;
  readonly zerocopymesh_indices_ptr: (a: number) => number;
  readonly zerocopymesh_normals_ptr: (a: number) => number;
  readonly rtcoffsetjs_isSignificant: (a: number) => number;
  readonly __wbg_get_rtcoffsetjs_x: (a: number) => number;
  readonly __wbg_get_rtcoffsetjs_y: (a: number) => number;
  readonly __wbg_get_rtcoffsetjs_z: (a: number) => number;
  readonly instancedgeometry_geometryId: (a: number) => bigint;
  readonly meshcollection_rtcOffsetX: (a: number) => number;
  readonly meshcollection_rtcOffsetY: (a: number) => number;
  readonly meshcollection_rtcOffsetZ: (a: number) => number;
  readonly __wasm_bindgen_func_elem_848: (a: number, b: number, c: number) => void;
  readonly __wasm_bindgen_func_elem_846: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_408: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_406: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_879: (a: number, b: number, c: number, d: number) => void;
  readonly __wbindgen_export: (a: number) => void;
  readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export3: (a: number, b: number) => number;
  readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
