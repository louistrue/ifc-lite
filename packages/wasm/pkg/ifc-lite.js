/* @ts-self-types="./ifc-lite.d.ts" */

import * as wasm from "./ifc-lite_bg.wasm";
import { __wbg_set_wasm } from "./ifc-lite_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    GeoReferenceJs, GpuGeometry, GpuInstancedGeometry, GpuInstancedGeometryCollection, GpuInstancedGeometryRef, GpuMeshMetadata, IfcAPI, InstanceData, InstancedGeometry, InstancedMeshCollection, MeshCollection, MeshCollectionWithRtc, MeshDataJs, RtcOffsetJs, SymbolicCircle, SymbolicPolyline, SymbolicRepresentationCollection, ZeroCopyMesh, get_memory, init, version
} from "./ifc-lite_bg.js";
