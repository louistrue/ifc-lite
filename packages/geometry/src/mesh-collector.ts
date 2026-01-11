/**
 * Mesh collector - extracts triangle data from web-ifc LoadAllGeometry
 */

import * as WebIFC from 'web-ifc';
import type { MeshData } from './types.js';
import { getDefaultColor } from './default-materials.js';

export class MeshCollector {
    private ifcApi: WebIFC.IfcAPI;
    private modelID: number;
    private styleCache: Map<number, [number, number, number, number] | null> = new Map();

    constructor(ifcApi: WebIFC.IfcAPI, modelID: number) {
        this.ifcApi = ifcApi;
        this.modelID = modelID;
    }

    /**
     * Extract color from IFC surface style relationships
     * IfcStyledItem.Item references geometry representation IDs (not element IDs)
     * Traverses: geometryExpressID → IfcStyledItem → IfcSurfaceStyle → IfcSurfaceStyleRendering → IfcColourRgb
     */
    private extractIfcSurfaceStyleColor(geometryExpressID: number): [number, number, number, number] | null {
        // Check cache first
        if (this.styleCache.has(geometryExpressID)) {
            return this.styleCache.get(geometryExpressID) || null;
        }

        try {
            // Step 1: Find IfcStyledItem where Item.value == geometryExpressID
            // Type ID 3958052878 = IfcStyledItem
            // Try numeric type ID first, fall back to string if needed
            let styledItemIds: { size(): number; get(index: number): number } | null = null;

            try {
                styledItemIds = this.ifcApi.GetLineIDsWithType(this.modelID, 3958052878);
                // Log first time only
                if (!this.styleCache.size) {
                    console.log(`[MeshCollector] Found ${styledItemIds.size()} IfcStyledItem entities`);
                }
            } catch (e) {
                // Try string type name as fallback
                try {
                    styledItemIds = this.ifcApi.GetLineIDsWithType(this.modelID, 'IFCSTYLEDITEM');
                } catch (e2) {
                    // If both fail, return null
                    this.styleCache.set(geometryExpressID, null);
                    return null;
                }
            }

            if (styledItemIds && styledItemIds.size() > 0) {
                for (let i = 0; i < styledItemIds.size(); i++) {
                    const styledItemId = styledItemIds.get(i);
                    try {
                        const styledItem = this.ifcApi.GetLine(this.modelID, styledItemId) as any;

                        // Check if this styled item references our geometry expressID
                        if (styledItem.Item && styledItem.Item.value === geometryExpressID) {
                            // Step 2: Get Styles array (references to IfcSurfaceStyle or IfcPresentationStyleAssignment)
                            if (styledItem.Styles && Array.isArray(styledItem.Styles)) {
                                for (const styleRef of styledItem.Styles) {
                                    if (styleRef && styleRef.value) {
                                        const color = this.extractColorFromStyleAssignment(styleRef.value);
                                        if (color) {
                                            this.styleCache.set(geometryExpressID, color);
                                            return color;
                                        }
                                    }
                                }
                            } else if (styledItem.Styles && styledItem.Styles.value) {
                                const color = this.extractColorFromStyleAssignment(styledItem.Styles.value);
                                if (color) {
                                    this.styleCache.set(geometryExpressID, color);
                                    return color;
                                }
                            }
                        }
                    } catch (e) {
                        // Continue searching
                        continue;
                    }
                }
            }
        } catch (e) {
            // If styled item lookup fails, return null
        }

        // Cache null result to avoid repeated lookups
        this.styleCache.set(geometryExpressID, null);
        return null;
    }

    /**
     * Extract color from IfcPresentationStyleAssignment or IfcSurfaceStyle
     * Chain: IfcPresentationStyleAssignment → IfcSurfaceStyle → IfcSurfaceStyleRendering → IfcColourRgb
     */
    private extractColorFromStyleAssignment(styleId: number): [number, number, number, number] | null {
        try {
            const style = this.ifcApi.GetLine(this.modelID, styleId) as any;

            // Handle Styles attribute (both IfcPresentationStyleAssignment and IfcSurfaceStyle have this)
            if (style.Styles) {
                const stylesArray = Array.isArray(style.Styles) ? style.Styles : [style.Styles];

                for (const styleRef of stylesArray) {
                    if (styleRef && styleRef.value) {
                        // First try as IfcSurfaceStyle (which has IfcSurfaceStyleRendering inside)
                        const colorFromSurfaceStyle = this.extractColorFromSurfaceStyle(styleRef.value);
                        if (colorFromSurfaceStyle) return colorFromSurfaceStyle;

                        // Then try as direct IfcSurfaceStyleRendering
                        const colorFromRendering = this.extractColorFromRendering(styleRef.value);
                        if (colorFromRendering) return colorFromRendering;

                        // Finally try recursively (for IfcPresentationStyleAssignment → IfcSurfaceStyle)
                        const colorRecursive = this.extractColorFromStyleAssignment(styleRef.value);
                        if (colorRecursive) return colorRecursive;
                    }
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Extract color from IfcSurfaceStyle entity
     */
    private extractColorFromSurfaceStyle(surfaceStyleId: number): [number, number, number, number] | null {
        try {
            const surfaceStyle = this.ifcApi.GetLine(this.modelID, surfaceStyleId) as any;

            // IfcSurfaceStyle has Styles attribute (SET OF IfcSurfaceStyleElementSelect)
            // We need to find IfcSurfaceStyleRendering
            // Type ID 1878645084 = IfcSurfaceStyleRendering
            if (surfaceStyle.Styles && Array.isArray(surfaceStyle.Styles)) {
                for (const styleElementRef of surfaceStyle.Styles) {
                    if (styleElementRef && styleElementRef.value) {
                        const color = this.extractColorFromRendering(styleElementRef.value);
                        if (color) return color;
                    }
                }
            } else if (surfaceStyle.Styles && surfaceStyle.Styles.value) {
                return this.extractColorFromRendering(surfaceStyle.Styles.value);
            }
        } catch (e) {
            // Error reading surface style
        }

        return null;
    }

    /**
     * Extract color from IfcSurfaceStyleRendering entity
     */
    private extractColorFromRendering(renderingId: number): [number, number, number, number] | null {
        try {
            const rendering = this.ifcApi.GetLine(this.modelID, renderingId) as any;

            // IfcSurfaceStyleRendering has SurfaceColour attribute (IfcColourRgb reference)
            if (rendering.SurfaceColour && rendering.SurfaceColour.value) {
                const colorRgbId = rendering.SurfaceColour.value;
                const transparency = rendering.Transparency?.value ?? 0.0;

                // Extract RGB from IfcColourRgb
                // Type ID 776857604 = IfcColourRgb
                const colorRgb = this.ifcApi.GetLine(this.modelID, colorRgbId) as any;

                if (colorRgb.Red && colorRgb.Green && colorRgb.Blue) {
                    const red = colorRgb.Red.value ?? 0.8;
                    const green = colorRgb.Green.value ?? 0.8;
                    const blue = colorRgb.Blue.value ?? 0.8;
                    const alpha = 1.0 - transparency;

                    return [red, green, blue, alpha];
                }
            }
        } catch (e) {
            // Error reading rendering
        }

        return null;
    }

    /**
     * Collect all meshes from web-ifc
     */
    collectMeshes(): MeshData[] {
        const meshes: MeshData[] = [];
        console.log('[MeshCollector] Loading all geometry for model:', this.modelID);
        const geometries = this.ifcApi.LoadAllGeometry(this.modelID);
        const geomCount = geometries.size();
        console.log('[MeshCollector] Found', geomCount, 'flat meshes');

        let noGeometriesCount = 0;
        let failedGetGeometry = 0;
        let noVertexData = 0;
        let successCount = 0;

        for (let i = 0; i < geomCount; i++) {
            const flatMesh = geometries.get(i);
            const expressID = flatMesh.expressID;

            if (!flatMesh.geometries || flatMesh.geometries.size() === 0) {
                noGeometriesCount++;
                continue;
            }

            // Collect geometry from all placed geometries
            const positions: number[] = [];
            const normals: number[] = [];
            const indices: number[] = [];
            let indexOffset = 0;
            let meshColor: [number, number, number, number] | null = null;
            let ifcStyleColor: [number, number, number, number] | null = null;

            for (let j = 0; j < flatMesh.geometries.size(); j++) {
                const placed = flatMesh.geometries.get(j);

                // Try to extract color from IFC surface style using geometry expressID
                // IfcStyledItem.Item references the geometry representation, not the element
                if (!ifcStyleColor && placed.geometryExpressID) {
                    ifcStyleColor = this.extractIfcSurfaceStyleColor(placed.geometryExpressID);
                }

                // Extract color from PlacedGeometry if available
                if (placed.color && !meshColor) {
                    // web-ifc provides color as {x, y, z, w} or similar structure
                    const color = placed.color as any;

                    if (typeof color.x === 'number' && typeof color.y === 'number' &&
                        typeof color.z === 'number' && typeof color.w === 'number') {
                        meshColor = [color.x, color.y, color.z, color.w];
                    } else if (Array.isArray(color) && color.length >= 4) {
                        meshColor = [color[0], color[1], color[2], color[3]];
                    }
                }
                try {
                    const meshGeom = this.ifcApi.GetGeometry(this.modelID, placed.geometryExpressID);
                    // GetVertexDataSize() returns TOTAL FLOATS (not vertex count)
                    // Format: [x,y,z,nx,ny,nz, x,y,z,nx,ny,nz, ...] = 6 floats per vertex
                    const totalFloats = meshGeom.GetVertexDataSize();
                    const indexSize = meshGeom.GetIndexDataSize();
                    const vertexCount = totalFloats / 6; // Actual vertex count

                    if (totalFloats > 0 && indexSize > 0) {
                        // GetVertexData() returns a pointer (number) to WASM heap memory
                        // We need to read from the WASM heap using the pointer
                        const vertexPtr = meshGeom.GetVertexData();
                        const indexPtr = meshGeom.GetIndexData();

                        // Access WASM heap memory
                        // web-ifc exposes the WebAssembly module with HEAPF32/HEAPU32 views
                        const wasmModule = (this.ifcApi as any).wasmModule;

                        if (!wasmModule || !wasmModule.HEAPF32) {
                            if (i < 3) console.warn('[MeshCollector] WASM module not accessible');
                            noVertexData++;
                            continue;
                        }

                        // Calculate byte offsets (pointers are byte offsets)
                        // totalFloats is the total number of floats in the buffer
                        const vertexByteOffset = vertexPtr / 4; // Float32 is 4 bytes
                        const indexByteOffset = indexPtr / 4;   // Uint32 is 4 bytes

                        // Create copies from WASM heap
                        const vertexData = new Float32Array(
                            wasmModule.HEAPF32.buffer,
                            vertexByteOffset * 4,
                            totalFloats
                        ).slice(); // slice() creates a copy

                        const indexData = new Uint32Array(
                            wasmModule.HEAPU32.buffer,
                            indexByteOffset * 4,
                            indexSize
                        ).slice(); // slice() creates a copy

                        if (vertexData && vertexData.length > 0) {
                            // Get transformation matrix from placed geometry
                            // flatTransformation is a 4x4 matrix in column-major order (16 elements)
                            const transformRaw = placed.flatTransformation;

                            // Convert to number array for easier access
                            // Handle both Array and TypedArray (Float32Array, etc.)
                            let m: number[] | null = null;
                            if (transformRaw) {
                                if (Array.isArray(transformRaw)) {
                                    m = transformRaw;
                                } else if (ArrayBuffer.isView(transformRaw)) {
                                    // Cast to any to work around TypeScript's strict ArrayBufferView typing
                                    const typedArray = transformRaw as any;
                                    if (typedArray.length === 16) {
                                        m = Array.from(typedArray);
                                    }
                                }
                            }

                            // Validate transformation matrix
                            const hasValidTransform = m &&
                                m.length === 16 &&
                                Number.isFinite(m[0]) &&
                                Number.isFinite(m[15]);

                            // Extract positions and normals, applying transformation
                            for (let k = 0; k < vertexCount; k++) {
                                const base = k * 6;
                                if (base + 5 < vertexData.length) {
                                    // Local coordinates
                                    const x = vertexData[base];
                                    const y = vertexData[base + 1];
                                    const z = vertexData[base + 2];
                                    const nx = vertexData[base + 3];
                                    const ny = vertexData[base + 4];
                                    const nz = vertexData[base + 5];

                                    if (hasValidTransform && m) {
                                        // Transform position: worldPos = matrix * localPos
                                        // Column-major matrix: m[0-3] = col0, m[4-7] = col1, m[8-11] = col2, m[12-15] = col3
                                        const transformedX = m[0] * x + m[4] * y + m[8] * z + m[12];
                                        const transformedY = m[1] * x + m[5] * y + m[9] * z + m[13];
                                        const transformedZ = m[2] * x + m[6] * y + m[10] * z + m[14];

                                        // web-ifc outputs Y-up coordinates, matching WebGL convention
                                        positions.push(transformedX, transformedY, transformedZ);

                                        // Transform normal (rotation only, using upper-left 3x3 of matrix)
                                        const tnx = m[0] * nx + m[4] * ny + m[8] * nz;
                                        const tny = m[1] * nx + m[5] * ny + m[9] * nz;
                                        const tnz = m[2] * nx + m[6] * ny + m[10] * nz;

                                        const finalNX = tnx;
                                        const finalNY = tny;
                                        const finalNZ = tnz;

                                        // Renormalize (handles non-uniform scaling)
                                        const len = Math.sqrt(finalNX * finalNX + finalNY * finalNY + finalNZ * finalNZ);
                                        if (len > 1e-10) {
                                            normals.push(finalNX / len, finalNY / len, finalNZ / len);
                                        } else {
                                            // Fallback if normal becomes zero (shouldn't happen)
                                            normals.push(finalNX, finalNY, finalNZ);
                                        }
                                    } else {
                                        // No transformation matrix - use raw coordinates
                                        // web-ifc already outputs Y-up coordinates
                                        positions.push(x, y, z);
                                        normals.push(nx, ny, nz);
                                    }
                                }
                            }

                            // Extract indices with offset
                            if (indexData && indexData.length > 0) {
                                for (let k = 0; k < indexData.length; k++) {
                                    indices.push(indexData[k] + indexOffset);
                                }
                                indexOffset += vertexCount;
                            }
                            successCount++;
                        } else {
                            noVertexData++;
                        }
                    } else {
                        noVertexData++;
                    }
                } catch (e) {
                    failedGetGeometry++;
                    // Only log first few errors to avoid spam
                    if (failedGetGeometry <= 3) {
                        console.warn(`[MeshCollector] Failed to get geometry for expressID ${placed.geometryExpressID}:`, e);
                    }
                }
            }

            if (positions.length > 0) {
                // Priority order for color extraction:
                // 1. IFC Surface Style (IfcStyledItem → IfcSurfaceStyle → IfcSurfaceStyleRendering → IfcColourRgb)
                // 2. PlacedGeometry.color (from web-ifc's geometry extraction)
                // 3. Default material based on entity type
                // 4. Default gray

                let finalColor: [number, number, number, number] = [0.8, 0.8, 0.8, 1.0];

                // Use IFC surface style first (most accurate) - already extracted in loop above
                if (ifcStyleColor) {
                    finalColor = ifcStyleColor;
                } else if (meshColor) {
                    // Fall back to PlacedGeometry.color
                    finalColor = meshColor;
                } else {
                    // Try default material based on entity type
                    try {
                        const entityType = this.ifcApi.GetLineType(this.modelID, expressID);
                        // GetLineType can return string or number, convert to string for getDefaultColor
                        const entityTypeStr = typeof entityType === 'string' ? entityType : null;
                        finalColor = getDefaultColor(entityTypeStr);
                    } catch (e) {
                        // If GetLineType fails, use default gray
                        finalColor = [0.8, 0.8, 0.8, 1.0];
                    }
                }

                meshes.push({
                    expressId: expressID,
                    positions: new Float32Array(positions),
                    normals: new Float32Array(normals),
                    indices: new Uint32Array(indices),
                    color: finalColor,
                });
            }
        }

        // Count color sources (styleCache is keyed by geometry expressID, not element expressID)
        // Just count non-default colors as indication
        const nonDefaultColors = meshes.filter(m => m.color[0] !== 0.8 || m.color[1] !== 0.8 || m.color[2] !== 0.8).length;

        console.log('[MeshCollector] Stats:', {
            total: geomCount,
            noGeometries: noGeometriesCount,
            failedGetGeometry,
            noVertexData,
            successfulGeoms: successCount,
            outputMeshes: meshes.length,
            meshesWithNonDefaultColor: nonDefaultColors,
            styleCacheSize: this.styleCache.size,
        });

        return meshes;
    }
}
