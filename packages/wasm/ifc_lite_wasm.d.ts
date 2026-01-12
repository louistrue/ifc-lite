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
 * Initialize the WASM module
 */
export function init(): void;

/**
 * Get the version of IFC-Lite
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_ifcapi_free: (a: number, b: number) => void;
  readonly __wbg_meshcollection_free: (a: number, b: number) => void;
  readonly __wbg_meshdatajs_free: (a: number, b: number) => void;
  readonly __wbg_zerocopymesh_free: (a: number, b: number) => void;
  readonly ifcapi_debugProcessEntity953: (a: number, b: number, c: number, d: number) => void;
  readonly ifcapi_debugProcessFirstWall: (a: number, b: number, c: number, d: number) => void;
  readonly ifcapi_getMemory: (a: number) => number;
  readonly ifcapi_is_ready: (a: number) => number;
  readonly ifcapi_new: () => number;
  readonly ifcapi_parse: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseMeshes: (a: number, b: number, c: number) => number;
  readonly ifcapi_parseStreaming: (a: number, b: number, c: number, d: number) => number;
  readonly ifcapi_parseZeroCopy: (a: number, b: number, c: number) => number;
  readonly ifcapi_version: (a: number, b: number) => void;
  readonly meshcollection_get: (a: number, b: number) => number;
  readonly meshcollection_length: (a: number) => number;
  readonly meshcollection_totalTriangles: (a: number) => number;
  readonly meshcollection_totalVertices: (a: number) => number;
  readonly meshdatajs_color: (a: number, b: number) => void;
  readonly meshdatajs_expressId: (a: number) => number;
  readonly meshdatajs_indices: (a: number) => number;
  readonly meshdatajs_normals: (a: number) => number;
  readonly meshdatajs_positions: (a: number) => number;
  readonly meshdatajs_triangleCount: (a: number) => number;
  readonly meshdatajs_vertexCount: (a: number) => number;
  readonly version: (a: number) => void;
  readonly zerocopymesh_bounds_max: (a: number, b: number) => void;
  readonly zerocopymesh_bounds_min: (a: number, b: number) => void;
  readonly zerocopymesh_indices_len: (a: number) => number;
  readonly zerocopymesh_indices_ptr: (a: number) => number;
  readonly zerocopymesh_is_empty: (a: number) => number;
  readonly zerocopymesh_new: () => number;
  readonly zerocopymesh_normals_len: (a: number) => number;
  readonly zerocopymesh_normals_ptr: (a: number) => number;
  readonly zerocopymesh_positions_len: (a: number) => number;
  readonly zerocopymesh_positions_ptr: (a: number) => number;
  readonly init: () => void;
  readonly zerocopymesh_triangle_count: (a: number) => number;
  readonly zerocopymesh_vertex_count: (a: number) => number;
  readonly get_memory: () => number;
  readonly __wasm_bindgen_func_elem_160: (a: number, b: number, c: number) => void;
  readonly __wasm_bindgen_func_elem_159: (a: number, b: number) => void;
  readonly __wasm_bindgen_func_elem_198: (a: number, b: number, c: number, d: number) => void;
  readonly __wbindgen_export: (a: number, b: number) => number;
  readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export3: (a: number) => void;
  readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
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
