
let imports = {};
imports['__wbindgen_placeholder__'] = module.exports;

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

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
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
function decodeText(ptr, len) {
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

function __wasm_bindgen_func_elem_272(arg0, arg1, arg2) {
    wasm.__wasm_bindgen_func_elem_272(arg0, arg1, addHeapObject(arg2));
}

function __wasm_bindgen_func_elem_339(arg0, arg1, arg2, arg3) {
    wasm.__wasm_bindgen_func_elem_339(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}

const IfcAPIFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ifcapi_free(ptr >>> 0, 1));

const ZeroCopyMeshFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_zerocopymesh_free(ptr >>> 0, 1));

/**
 * Main IFC-Lite API
 */
class IfcAPI {
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
exports.IfcAPI = IfcAPI;

/**
 * Zero-copy mesh that exposes pointers to WASM memory
 */
class ZeroCopyMesh {
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
exports.ZeroCopyMesh = ZeroCopyMesh;

/**
 * Get WASM memory to allow JavaScript to create TypedArray views
 * @returns {any}
 */
function get_memory() {
    const ret = wasm.get_memory();
    return takeObject(ret);
}
exports.get_memory = get_memory;

/**
 * Initialize the WASM module
 */
function init() {
    wasm.init();
}
exports.init = init;

/**
 * Get the version of IFC-Lite
 * @returns {string}
 */
function version() {
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
exports.version = version;

exports.__wbg___wbindgen_debug_string_adfb662ae34724b6 = function(arg0, arg1) {
    const ret = debugString(getObject(arg1));
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

exports.__wbg___wbindgen_is_function_8d400b8b1af978cd = function(arg0) {
    const ret = typeof(getObject(arg0)) === 'function';
    return ret;
};

exports.__wbg___wbindgen_is_undefined_f6b95eab589e0269 = function(arg0) {
    const ret = getObject(arg0) === undefined;
    return ret;
};

exports.__wbg___wbindgen_memory_a342e963fbcabd68 = function() {
    const ret = wasm.memory;
    return addHeapObject(ret);
};

exports.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

exports.__wbg__wbg_cb_unref_87dfb5aaa0cbcea7 = function(arg0) {
    getObject(arg0)._wbg_cb_unref();
};

exports.__wbg_call_3020136f7a2d6e44 = function() { return handleError(function (arg0, arg1, arg2) {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
}, arguments) };

exports.__wbg_call_abb4ff46ce38be40 = function() { return handleError(function (arg0, arg1) {
    const ret = getObject(arg0).call(getObject(arg1));
    return addHeapObject(ret);
}, arguments) };

exports.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
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

exports.__wbg_log_1d990106d99dacb7 = function(arg0) {
    console.log(getObject(arg0));
};

exports.__wbg_new_1ba21ce319a06297 = function() {
    const ret = new Object();
    return addHeapObject(ret);
};

exports.__wbg_new_8a6f238a6ece86ea = function() {
    const ret = new Error();
    return addHeapObject(ret);
};

exports.__wbg_new_ff12d2b041fb48f1 = function(arg0, arg1) {
    try {
        var state0 = {a: arg0, b: arg1};
        var cb0 = (arg0, arg1) => {
            const a = state0.a;
            state0.a = 0;
            try {
                return __wasm_bindgen_func_elem_339(a, state0.b, arg0, arg1);
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

exports.__wbg_new_no_args_cb138f77cf6151ee = function(arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
};

exports.__wbg_queueMicrotask_9b549dfce8865860 = function(arg0) {
    const ret = getObject(arg0).queueMicrotask;
    return addHeapObject(ret);
};

exports.__wbg_queueMicrotask_fca69f5bfad613a5 = function(arg0) {
    queueMicrotask(getObject(arg0));
};

exports.__wbg_resolve_fd5bfbaa4ce36e1e = function(arg0) {
    const ret = Promise.resolve(getObject(arg0));
    return addHeapObject(ret);
};

exports.__wbg_set_781438a03c0c3c81 = function() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
    return ret;
}, arguments) };

exports.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
    const ret = getObject(arg1).stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

exports.__wbg_static_accessor_GLOBAL_769e6b65d6557335 = function() {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
};

exports.__wbg_static_accessor_GLOBAL_THIS_60cf02db4de8e1c1 = function() {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
};

exports.__wbg_static_accessor_SELF_08f5a74c69739274 = function() {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
};

exports.__wbg_static_accessor_WINDOW_a8924b26aa92d024 = function() {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
};

exports.__wbg_then_4f95312d68691235 = function(arg0, arg1) {
    const ret = getObject(arg0).then(getObject(arg1));
    return addHeapObject(ret);
};

exports.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
};

exports.__wbindgen_cast_7a9218f878f4eac5 = function(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 19, function: Function { arguments: [Externref], shim_idx: 20, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.__wasm_bindgen_func_elem_266, __wasm_bindgen_func_elem_272);
    return addHeapObject(ret);
};

exports.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return addHeapObject(ret);
};

exports.__wbindgen_object_clone_ref = function(arg0) {
    const ret = getObject(arg0);
    return addHeapObject(ret);
};

exports.__wbindgen_object_drop_ref = function(arg0) {
    takeObject(arg0);
};

const wasmPath = `${__dirname}/ifc_lite_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = exports.__wasm = new WebAssembly.Instance(wasmModule, imports).exports;

wasm.__wbindgen_start();
