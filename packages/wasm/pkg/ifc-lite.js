let wasm;

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => state.dtor(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(128).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

function __wasm_bindgen_func_elem_302(arg0, arg1) {
    wasm.__wasm_bindgen_func_elem_302(arg0, arg1);
}

function __wasm_bindgen_func_elem_682(arg0, arg1, arg2) {
    wasm.__wasm_bindgen_func_elem_682(arg0, arg1, addHeapObject(arg2));
}

function __wasm_bindgen_func_elem_716(arg0, arg1, arg2, arg3) {
    wasm.__wasm_bindgen_func_elem_716(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}

const GeoReferenceJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_georeferencejs_free(ptr >>> 0, 1));

const IfcAPIFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ifcapi_free(ptr >>> 0, 1));

const InstanceDataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_instancedata_free(ptr >>> 0, 1));

const InstancedGeometryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_instancedgeometry_free(ptr >>> 0, 1));

const InstancedMeshCollectionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_instancedmeshcollection_free(ptr >>> 0, 1));

const MeshCollectionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_meshcollection_free(ptr >>> 0, 1));

const MeshCollectionWithRtcFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_meshcollectionwithrtc_free(ptr >>> 0, 1));

const MeshDataJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_meshdatajs_free(ptr >>> 0, 1));

const RtcOffsetJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rtcoffsetjs_free(ptr >>> 0, 1));

const ZeroCopyMeshFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_zerocopymesh_free(ptr >>> 0, 1));

/**
 * Georeferencing information exposed to JavaScript
 */
export class GeoReferenceJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(GeoReferenceJs.prototype);
        obj.__wbg_ptr = ptr;
        GeoReferenceJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GeoReferenceJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_georeferencejs_free(ptr, 0);
    }
    /**
     * Transform local coordinates to map coordinates
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Float64Array}
     */
    localToMap(x, y, z) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.georeferencejs_localToMap(retptr, this.__wbg_ptr, x, y, z);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Transform map coordinates to local coordinates
     * @param {number} e
     * @param {number} n
     * @param {number} h
     * @returns {Float64Array}
     */
    mapToLocal(e, n, h) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.georeferencejs_mapToLocal(retptr, this.__wbg_ptr, e, n, h);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get CRS name
     * @returns {string | undefined}
     */
    get crsName() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.georeferencejs_crsName(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1).slice();
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get rotation angle in radians
     * @returns {number}
     */
    get rotation() {
        const ret = wasm.georeferencejs_rotation(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get 4x4 transformation matrix (column-major for WebGL)
     * @returns {Float64Array}
     */
    toMatrix() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.georeferencejs_toMatrix(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Eastings (X offset)
     * @returns {number}
     */
    get eastings() {
        const ret = wasm.__wbg_get_georeferencejs_eastings(this.__wbg_ptr);
        return ret;
    }
    /**
     * Eastings (X offset)
     * @param {number} arg0
     */
    set eastings(arg0) {
        wasm.__wbg_set_georeferencejs_eastings(this.__wbg_ptr, arg0);
    }
    /**
     * Northings (Y offset)
     * @returns {number}
     */
    get northings() {
        const ret = wasm.__wbg_get_georeferencejs_northings(this.__wbg_ptr);
        return ret;
    }
    /**
     * Northings (Y offset)
     * @param {number} arg0
     */
    set northings(arg0) {
        wasm.__wbg_set_georeferencejs_northings(this.__wbg_ptr, arg0);
    }
    /**
     * Orthogonal height (Z offset)
     * @returns {number}
     */
    get orthogonal_height() {
        const ret = wasm.__wbg_get_georeferencejs_orthogonal_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Orthogonal height (Z offset)
     * @param {number} arg0
     */
    set orthogonal_height(arg0) {
        wasm.__wbg_set_georeferencejs_orthogonal_height(this.__wbg_ptr, arg0);
    }
    /**
     * X-axis abscissa (cos of rotation)
     * @returns {number}
     */
    get x_axis_abscissa() {
        const ret = wasm.__wbg_get_georeferencejs_x_axis_abscissa(this.__wbg_ptr);
        return ret;
    }
    /**
     * X-axis abscissa (cos of rotation)
     * @param {number} arg0
     */
    set x_axis_abscissa(arg0) {
        wasm.__wbg_set_georeferencejs_x_axis_abscissa(this.__wbg_ptr, arg0);
    }
    /**
     * X-axis ordinate (sin of rotation)
     * @returns {number}
     */
    get x_axis_ordinate() {
        const ret = wasm.__wbg_get_georeferencejs_x_axis_ordinate(this.__wbg_ptr);
        return ret;
    }
    /**
     * X-axis ordinate (sin of rotation)
     * @param {number} arg0
     */
    set x_axis_ordinate(arg0) {
        wasm.__wbg_set_georeferencejs_x_axis_ordinate(this.__wbg_ptr, arg0);
    }
    /**
     * Scale factor
     * @returns {number}
     */
    get scale() {
        const ret = wasm.__wbg_get_georeferencejs_scale(this.__wbg_ptr);
        return ret;
    }
    /**
     * Scale factor
     * @param {number} arg0
     */
    set scale(arg0) {
        wasm.__wbg_set_georeferencejs_scale(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) GeoReferenceJs.prototype[Symbol.dispose] = GeoReferenceJs.prototype.free;

/**
 * Main IFC-Lite API
 */
export class IfcAPI {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IfcAPIFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ifcapi_free(ptr, 0);
    }
    /**
     * Get WASM memory for zero-copy access
     * @returns {any}
     */
    getMemory() {
        const ret = wasm.ifcapi_getMemory(this.__wbg_ptr);
        return takeObject(ret);
    }
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
     * @param {string} content
     * @returns {MeshCollection}
     */
    parseMeshes(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseMeshes(this.__wbg_ptr, ptr0, len0);
        return MeshCollection.__wrap(ret);
    }
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
     * @param {string} content
     * @param {Function} callback
     * @returns {Promise<any>}
     */
    parseStreaming(content, callback) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseStreaming(this.__wbg_ptr, ptr0, len0, addHeapObject(callback));
        return takeObject(ret);
    }
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
     * @param {string} content
     * @returns {ZeroCopyMesh}
     */
    parseZeroCopy(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseZeroCopy(this.__wbg_ptr, ptr0, len0);
        return ZeroCopyMesh.__wrap(ret);
    }
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
     * @param {string} content
     * @returns {GeoReferenceJs | undefined}
     */
    getGeoReference(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_getGeoReference(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : GeoReferenceJs.__wrap(ret);
    }
    /**
     * Parse IFC file with streaming mesh batches for progressive rendering
     * Calls the callback with batches of meshes, yielding to browser between batches
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * await api.parseMeshesAsync(ifcData, {
     *   batchSize: 100,
     *   onBatch: (meshes, progress) => {
     *     // Add meshes to scene
     *     for (const mesh of meshes) {
     *       scene.add(createThreeMesh(mesh));
     *     }
     *     console.log(`Progress: ${progress.percent}%`);
     *   },
     *   onComplete: (stats) => {
     *     console.log(`Done! ${stats.totalMeshes} meshes`);
     *   }
     * });
     * ```
     * @param {string} content
     * @param {any} options
     * @returns {Promise<any>}
     */
    parseMeshesAsync(content, options) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseMeshesAsync(this.__wbg_ptr, ptr0, len0, addHeapObject(options));
        return takeObject(ret);
    }
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
     * @param {string} content
     * @returns {MeshCollectionWithRtc}
     */
    parseMeshesWithRtc(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseMeshesWithRtc(this.__wbg_ptr, ptr0, len0);
        return MeshCollectionWithRtc.__wrap(ret);
    }
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
     * @param {string} content
     * @returns {InstancedMeshCollection}
     */
    parseMeshesInstanced(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseMeshesInstanced(this.__wbg_ptr, ptr0, len0);
        return InstancedMeshCollection.__wrap(ret);
    }
    /**
     * Debug: Test processing entity #953 (FacetedBrep wall)
     * @param {string} content
     * @returns {string}
     */
    debugProcessEntity953(content) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.ifcapi_debugProcessEntity953(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Debug: Test processing a single wall
     * @param {string} content
     * @returns {string}
     */
    debugProcessFirstWall(content) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.ifcapi_debugProcessFirstWall(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
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
     * @param {string} content
     * @param {any} options
     * @returns {Promise<any>}
     */
    parseMeshesInstancedAsync(content, options) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parseMeshesInstancedAsync(this.__wbg_ptr, ptr0, len0, addHeapObject(options));
        return takeObject(ret);
    }
    /**
     * Create and initialize the IFC API
     */
    constructor() {
        const ret = wasm.ifcapi_new();
        this.__wbg_ptr = ret >>> 0;
        IfcAPIFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Parse IFC file (traditional - waits for completion)
     *
     * Example:
     * ```javascript
     * const api = new IfcAPI();
     * const result = await api.parse(ifcData);
     * console.log('Entities:', result.entityCount);
     * ```
     * @param {string} content
     * @returns {Promise<any>}
     */
    parse(content) {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ifcapi_parse(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Get version string
     * @returns {string}
     */
    get version() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.ifcapi_version(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Check if API is initialized
     * @returns {boolean}
     */
    get is_ready() {
        const ret = wasm.ifcapi_is_ready(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) IfcAPI.prototype[Symbol.dispose] = IfcAPI.prototype.free;

/**
 * Instance data for instanced rendering
 */
export class InstanceData {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(InstanceData.prototype);
        obj.__wbg_ptr = ptr;
        InstanceDataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InstanceDataFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_instancedata_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get expressId() {
        const ret = wasm.instancedata_expressId(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Float32Array}
     */
    get color() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.instancedata_color(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Float32Array}
     */
    get transform() {
        const ret = wasm.instancedata_transform(this.__wbg_ptr);
        return takeObject(ret);
    }
}
if (Symbol.dispose) InstanceData.prototype[Symbol.dispose] = InstanceData.prototype.free;

/**
 * Instanced geometry - one geometry definition with multiple instances
 */
export class InstancedGeometry {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(InstancedGeometry.prototype);
        obj.__wbg_ptr = ptr;
        InstancedGeometryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InstancedGeometryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_instancedgeometry_free(ptr, 0);
    }
    /**
     * @returns {bigint}
     */
    get geometryId() {
        const ret = wasm.instancedgeometry_geometryId(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @param {number} index
     * @returns {InstanceData | undefined}
     */
    get_instance(index) {
        const ret = wasm.instancedgeometry_get_instance(this.__wbg_ptr, index);
        return ret === 0 ? undefined : InstanceData.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get instance_count() {
        const ret = wasm.instancedgeometry_instance_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint32Array}
     */
    get indices() {
        const ret = wasm.instancedgeometry_indices(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * @returns {Float32Array}
     */
    get normals() {
        const ret = wasm.instancedgeometry_normals(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * @returns {Float32Array}
     */
    get positions() {
        const ret = wasm.instancedgeometry_positions(this.__wbg_ptr);
        return takeObject(ret);
    }
}
if (Symbol.dispose) InstancedGeometry.prototype[Symbol.dispose] = InstancedGeometry.prototype.free;

/**
 * Collection of instanced geometries
 */
export class InstancedMeshCollection {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(InstancedMeshCollection.prototype);
        obj.__wbg_ptr = ptr;
        InstancedMeshCollectionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InstancedMeshCollectionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_instancedmeshcollection_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get totalInstances() {
        const ret = wasm.instancedmeshcollection_totalInstances(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get totalGeometries() {
        const ret = wasm.instancedmeshcollection_length(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} index
     * @returns {InstancedGeometry | undefined}
     */
    get(index) {
        const ret = wasm.instancedmeshcollection_get(this.__wbg_ptr, index);
        return ret === 0 ? undefined : InstancedGeometry.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get length() {
        const ret = wasm.instancedmeshcollection_length(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) InstancedMeshCollection.prototype[Symbol.dispose] = InstancedMeshCollection.prototype.free;

/**
 * Collection of mesh data for returning multiple meshes
 */
export class MeshCollection {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MeshCollection.prototype);
        obj.__wbg_ptr = ptr;
        MeshCollectionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MeshCollectionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_meshcollection_free(ptr, 0);
    }
    /**
     * Get total vertex count across all meshes
     * @returns {number}
     */
    get totalVertices() {
        const ret = wasm.meshcollection_totalVertices(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get total triangle count across all meshes
     * @returns {number}
     */
    get totalTriangles() {
        const ret = wasm.meshcollection_totalTriangles(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get mesh at index
     * @param {number} index
     * @returns {MeshDataJs | undefined}
     */
    get(index) {
        const ret = wasm.meshcollection_get(this.__wbg_ptr, index);
        return ret === 0 ? undefined : MeshDataJs.__wrap(ret);
    }
    /**
     * Get number of meshes
     * @returns {number}
     */
    get length() {
        const ret = wasm.meshcollection_length(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) MeshCollection.prototype[Symbol.dispose] = MeshCollection.prototype.free;

/**
 * Mesh collection with RTC offset for large coordinates
 */
export class MeshCollectionWithRtc {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MeshCollectionWithRtc.prototype);
        obj.__wbg_ptr = ptr;
        MeshCollectionWithRtcFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MeshCollectionWithRtcFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_meshcollectionwithrtc_free(ptr, 0);
    }
    /**
     * Get the RTC offset
     * @returns {RtcOffsetJs}
     */
    get rtcOffset() {
        const ret = wasm.meshcollectionwithrtc_rtcOffset(this.__wbg_ptr);
        return RtcOffsetJs.__wrap(ret);
    }
    /**
     * Get mesh at index
     * @param {number} index
     * @returns {MeshDataJs | undefined}
     */
    get(index) {
        const ret = wasm.meshcollectionwithrtc_get(this.__wbg_ptr, index);
        return ret === 0 ? undefined : MeshDataJs.__wrap(ret);
    }
    /**
     * Get number of meshes
     * @returns {number}
     */
    get length() {
        const ret = wasm.meshcollectionwithrtc_length(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the mesh collection
     * @returns {MeshCollection}
     */
    get meshes() {
        const ret = wasm.meshcollectionwithrtc_meshes(this.__wbg_ptr);
        return MeshCollection.__wrap(ret);
    }
}
if (Symbol.dispose) MeshCollectionWithRtc.prototype[Symbol.dispose] = MeshCollectionWithRtc.prototype.free;

/**
 * Individual mesh data with express ID and color (matches MeshData interface)
 */
export class MeshDataJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MeshDataJs.prototype);
        obj.__wbg_ptr = ptr;
        MeshDataJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MeshDataJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_meshdatajs_free(ptr, 0);
    }
    /**
     * Get express ID
     * @returns {number}
     */
    get expressId() {
        const ret = wasm.meshdatajs_expressId(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get vertex count
     * @returns {number}
     */
    get vertexCount() {
        const ret = wasm.meshdatajs_vertexCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get triangle count
     * @returns {number}
     */
    get triangleCount() {
        const ret = wasm.meshdatajs_triangleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get color as [r, g, b, a] array
     * @returns {Float32Array}
     */
    get color() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.meshdatajs_color(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get indices as Uint32Array (copy to JS)
     * @returns {Uint32Array}
     */
    get indices() {
        const ret = wasm.meshdatajs_indices(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Get normals as Float32Array (copy to JS)
     * @returns {Float32Array}
     */
    get normals() {
        const ret = wasm.meshdatajs_normals(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Get IFC type name (e.g., "IfcWall", "IfcSpace")
     * @returns {string}
     */
    get ifcType() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.meshdatajs_ifcType(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get positions as Float32Array (copy to JS)
     * @returns {Float32Array}
     */
    get positions() {
        const ret = wasm.meshdatajs_positions(this.__wbg_ptr);
        return takeObject(ret);
    }
}
if (Symbol.dispose) MeshDataJs.prototype[Symbol.dispose] = MeshDataJs.prototype.free;

/**
 * RTC offset information exposed to JavaScript
 */
export class RtcOffsetJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RtcOffsetJs.prototype);
        obj.__wbg_ptr = ptr;
        RtcOffsetJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RtcOffsetJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rtcoffsetjs_free(ptr, 0);
    }
    /**
     * Check if offset is significant (>10km)
     * @returns {boolean}
     */
    isSignificant() {
        const ret = wasm.rtcoffsetjs_isSignificant(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Convert local coordinates to world coordinates
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Float64Array}
     */
    toWorld(x, y, z) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.rtcoffsetjs_toWorld(retptr, this.__wbg_ptr, x, y, z);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF64FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 8, 8);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * X offset (subtracted from positions)
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_georeferencejs_eastings(this.__wbg_ptr);
        return ret;
    }
    /**
     * X offset (subtracted from positions)
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_georeferencejs_eastings(this.__wbg_ptr, arg0);
    }
    /**
     * Y offset
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_georeferencejs_northings(this.__wbg_ptr);
        return ret;
    }
    /**
     * Y offset
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_georeferencejs_northings(this.__wbg_ptr, arg0);
    }
    /**
     * Z offset
     * @returns {number}
     */
    get z() {
        const ret = wasm.__wbg_get_georeferencejs_orthogonal_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Z offset
     * @param {number} arg0
     */
    set z(arg0) {
        wasm.__wbg_set_georeferencejs_orthogonal_height(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) RtcOffsetJs.prototype[Symbol.dispose] = RtcOffsetJs.prototype.free;

/**
 * Zero-copy mesh that exposes pointers to WASM memory
 */
export class ZeroCopyMesh {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ZeroCopyMesh.prototype);
        obj.__wbg_ptr = ptr;
        ZeroCopyMeshFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ZeroCopyMeshFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_zerocopymesh_free(ptr, 0);
    }
    /**
     * Get bounding box maximum point
     * @returns {Float32Array}
     */
    bounds_max() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.zerocopymesh_bounds_max(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get bounding box minimum point
     * @returns {Float32Array}
     */
    bounds_min() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.zerocopymesh_bounds_min(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get length of indices array
     * @returns {number}
     */
    get indices_len() {
        const ret = wasm.zerocopymesh_indices_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to indices array
     * @returns {number}
     */
    get indices_ptr() {
        const ret = wasm.zerocopymesh_indices_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get length of normals array
     * @returns {number}
     */
    get normals_len() {
        const ret = wasm.zerocopymesh_normals_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to normals array
     * @returns {number}
     */
    get normals_ptr() {
        const ret = wasm.zerocopymesh_normals_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get vertex count
     * @returns {number}
     */
    get vertex_count() {
        const ret = wasm.zerocopymesh_vertex_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get length of positions array (in f32 elements, not bytes)
     * @returns {number}
     */
    get positions_len() {
        const ret = wasm.zerocopymesh_positions_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to positions array
     * JavaScript can create Float32Array view: new Float32Array(memory.buffer, ptr, length)
     * @returns {number}
     */
    get positions_ptr() {
        const ret = wasm.zerocopymesh_positions_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get triangle count
     * @returns {number}
     */
    get triangle_count() {
        const ret = wasm.zerocopymesh_triangle_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Create a new zero-copy mesh from a Mesh
     */
    constructor() {
        const ret = wasm.zerocopymesh_new();
        this.__wbg_ptr = ret >>> 0;
        ZeroCopyMeshFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Check if mesh is empty
     * @returns {boolean}
     */
    get is_empty() {
        const ret = wasm.zerocopymesh_is_empty(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) ZeroCopyMesh.prototype[Symbol.dispose] = ZeroCopyMesh.prototype.free;

/**
 * Get WASM memory to allow JavaScript to create TypedArray views
 * @returns {any}
 */
export function get_memory() {
    const ret = wasm.get_memory();
    return takeObject(ret);
}

/**
 * Initialize the WASM module.
 *
 * This function is called automatically when the WASM module is loaded.
 * It sets up panic hooks for better error messages in the browser console.
 */
export function init() {
    wasm.init();
}

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
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.version(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
}

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg___wbindgen_debug_string_adfb662ae34724b6 = function(arg0, arg1) {
        const ret = debugString(getObject(arg1));
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_is_function_8d400b8b1af978cd = function(arg0) {
        const ret = typeof(getObject(arg0)) === 'function';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_undefined_f6b95eab589e0269 = function(arg0) {
        const ret = getObject(arg0) === undefined;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_memory_a342e963fbcabd68 = function() {
        const ret = wasm.memory;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg___wbindgen_number_get_9619185a74197f95 = function(arg0, arg1) {
        const obj = getObject(arg1);
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg__wbg_cb_unref_87dfb5aaa0cbcea7 = function(arg0) {
        getObject(arg0)._wbg_cb_unref();
    };
    imports.wbg.__wbg_call_3020136f7a2d6e44 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_call_abb4ff46ce38be40 = function() { return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_call_c8baa5c5e72d274e = function() { return handleError(function (arg0, arg1, arg2, arg3) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2), getObject(arg3));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_clearTimeout_5a54f8841c30079a = function(arg0) {
        const ret = clearTimeout(takeObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_export4(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_get_af9dab7e9603ea93 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_instancedgeometry_new = function(arg0) {
        const ret = InstancedGeometry.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_length_d45040a40c570362 = function(arg0) {
        const ret = getObject(arg0).length;
        return ret;
    };
    imports.wbg.__wbg_log_1d990106d99dacb7 = function(arg0) {
        console.log(getObject(arg0));
    };
    imports.wbg.__wbg_meshdatajs_new = function(arg0) {
        const ret = MeshDataJs.__wrap(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_1ba21ce319a06297 = function() {
        const ret = new Object();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_25f239778d6112b9 = function() {
        const ret = new Array();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_ff12d2b041fb48f1 = function(arg0, arg1) {
        try {
            var state0 = {a: arg0, b: arg1};
            var cb0 = (arg0, arg1) => {
                const a = state0.a;
                state0.a = 0;
                try {
                    return __wasm_bindgen_func_elem_716(a, state0.b, arg0, arg1);
                } finally {
                    state0.a = a;
                }
            };
            const ret = new Promise(cb0);
            return addHeapObject(ret);
        } finally {
            state0.a = state0.b = 0;
        }
    };
    imports.wbg.__wbg_new_from_slice_41e2764a343e3cb1 = function(arg0, arg1) {
        const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_from_slice_db0691b69e9d3891 = function(arg0, arg1) {
        const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_no_args_cb138f77cf6151ee = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_push_7d9be8f38fc13975 = function(arg0, arg1) {
        const ret = getObject(arg0).push(getObject(arg1));
        return ret;
    };
    imports.wbg.__wbg_queueMicrotask_9b549dfce8865860 = function(arg0) {
        const ret = getObject(arg0).queueMicrotask;
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_queueMicrotask_fca69f5bfad613a5 = function(arg0) {
        queueMicrotask(getObject(arg0));
    };
    imports.wbg.__wbg_resolve_fd5bfbaa4ce36e1e = function(arg0) {
        const ret = Promise.resolve(getObject(arg0));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_setTimeout_db2dbaeefb6f39c7 = function() { return handleError(function (arg0, arg1) {
        const ret = setTimeout(getObject(arg0), arg1);
        return addHeapObject(ret);
    }, arguments) };
    imports.wbg.__wbg_set_781438a03c0c3c81 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
        return ret;
    }, arguments) };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = getObject(arg1).stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_769e6b65d6557335 = function() {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_THIS_60cf02db4de8e1c1 = function() {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_SELF_08f5a74c69739274 = function() {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_static_accessor_WINDOW_a8924b26aa92d024 = function() {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addHeapObject(ret);
    };
    imports.wbg.__wbg_then_4f95312d68691235 = function(arg0, arg1) {
        const ret = getObject(arg0).then(getObject(arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_cast_344fafcc5114bf2d = function(arg0, arg1) {
        // Cast intrinsic for `Closure(Closure { dtor_idx: 108, function: Function { arguments: [Externref], shim_idx: 109, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
        const ret = makeMutClosure(arg0, arg1, wasm.__wasm_bindgen_func_elem_681, __wasm_bindgen_func_elem_682);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
        // Cast intrinsic for `F64 -> Externref`.
        const ret = arg0;
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_cast_f5edc6344c6146a4 = function(arg0, arg1) {
        // Cast intrinsic for `Closure(Closure { dtor_idx: 44, function: Function { arguments: [], shim_idx: 45, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
        const ret = makeMutClosure(arg0, arg1, wasm.__wasm_bindgen_func_elem_301, __wasm_bindgen_func_elem_302);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_clone_ref = function(arg0) {
        const ret = getObject(arg0);
        return addHeapObject(ret);
    };
    imports.wbg.__wbindgen_object_drop_ref = function(arg0) {
        takeObject(arg0);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('ifc-lite_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
