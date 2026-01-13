/* tslint:disable */
/* eslint-disable */

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
   * Debug: Test processing entity #953 (FacetedBrep wall)
   */
  debugProcessEntity953(content: string): string;
  /**
   * Debug: Test processing a single wall
   */
  debugProcessFirstWall(content: string): string;
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

export class MeshCollection {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get mesh at index
   */
  get(index: number): MeshDataJs | undefined;
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
   * Get positions as Float32Array (copy to JS)
   */
  readonly positions: Float32Array;
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
