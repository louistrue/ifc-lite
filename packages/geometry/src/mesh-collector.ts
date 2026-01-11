/**
 * Mesh collector - extracts triangle data from web-ifc LoadAllGeometry
 */

import * as WebIFC from 'web-ifc';
import type { MeshData } from './types.js';
import { getDefaultColor } from './default-materials.js';
import { ProgressiveMeshLoader, GeometryQuality } from './progressive-loader.js';

export class MeshCollector {
    private ifcApi: WebIFC.IfcAPI;
    private modelID: number;
    // Pre-built index: Map<geometryExpressID, [r, g, b, a]>
    // Built once upfront for O(1) lookups
    private styleIndex: Map<number, [number, number, number, number]> = new Map();
    private styleIndexBuilt: boolean = false;
    private quality: GeometryQuality = GeometryQuality.Balanced;
    private entityIndex?: Map<number, any>;

    constructor(
        ifcApi: WebIFC.IfcAPI,
        modelID: number,
        quality: GeometryQuality = GeometryQuality.Balanced,
        entityIndex?: Map<number, any>
    ) {
        this.ifcApi = ifcApi;
        this.modelID = modelID;
        this.quality = quality;
        this.entityIndex = entityIndex;
    }

    /**
     * Build style index once - O(M) where M = IfcStyledItem count
     * Pre-computes all geometry-to-color mappings for O(1) lookups later
     */
    private buildStyleIndex(): void {
        if (this.styleIndexBuilt) {
            return; // Already built
        }

        try {
            // Get all IfcStyledItem entities
            // Type ID 3958052878 = IfcStyledItem
            let styledItemIds: { size(): number; get(index: number): number } | null = null;

            try {
                // IFCSTYLEDITEM type code = 3958052878
                styledItemIds = this.ifcApi.GetLineIDsWithType(this.modelID, 3958052878);
            } catch (e) {
                console.warn('[MeshCollector] Could not find IfcStyledItem entities:', e);
                this.styleIndexBuilt = true;
                return;
            }

            if (!styledItemIds || styledItemIds.size() === 0) {
                this.styleIndexBuilt = true;
                return;
            }

            console.log(`[MeshCollector] Building style index from ${styledItemIds.size()} IfcStyledItem entities`);

            // Iterate through all styled items ONCE
            for (let i = 0; i < styledItemIds.size(); i++) {
                const styledItemId = styledItemIds.get(i);
                try {
                    const styledItem = this.ifcApi.GetLine(this.modelID, styledItemId) as any;

                    // Get geometry reference from Item.value
                    if (styledItem.Item && styledItem.Item.value) {
                        const geometryExpressID = styledItem.Item.value;

                        // Skip if we already have a color for this geometry (first match wins)
                        if (this.styleIndex.has(geometryExpressID)) {
                            continue;
                        }

                        // Extract color from Styles chain
                        let color: [number, number, number, number] | null = null;

                        if (styledItem.Styles && Array.isArray(styledItem.Styles)) {
                            for (const styleRef of styledItem.Styles) {
                                if (styleRef && styleRef.value) {
                                    color = this.extractColorFromStyleAssignment(styleRef.value);
                                    if (color) break; // Found color, stop searching
                                }
                            }
                        } else if (styledItem.Styles && styledItem.Styles.value) {
                            color = this.extractColorFromStyleAssignment(styledItem.Styles.value);
                        }

                        // Store in index if color found
                        if (color) {
                            this.styleIndex.set(geometryExpressID, color);
                        }
                    }
                } catch (e) {
                    // Continue with next styled item
                    continue;
                }
            }

            console.log(`[MeshCollector] Style index built: ${this.styleIndex.size} geometry-to-color mappings`);
            this.styleIndexBuilt = true;
        } catch (e) {
            console.warn('[MeshCollector] Error building style index:', e);
            this.styleIndexBuilt = true; // Mark as built to avoid retrying
        }
    }

    /**
     * Get color from pre-built style index - O(1) lookup
     */
    private getStyleColor(geometryExpressID: number): [number, number, number, number] | null {
        return this.styleIndex.get(geometryExpressID) || null;
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
     * Optimized: pre-allocates typed arrays to avoid .push() overhead
     */
    collectMeshes(): MeshData[] {
        const totalStart = performance.now();

        // In Fast mode, skip style index entirely - use default colors (saves ~128ms)
        const styleIndexStart = performance.now();
        if (this.quality !== GeometryQuality.Fast) {
            this.buildStyleIndex();
        } else {
            console.log('[MeshCollector] Fast mode: skipping style index, using default colors');
        }
        const styleIndexTime = performance.now() - styleIndexStart;
        if (styleIndexTime > 50) {
            console.log(`[MeshCollector] Style index build: ${styleIndexTime.toFixed(2)}ms`);
        }

        const meshes: MeshData[] = [];
        console.log('[MeshCollector] Loading all geometry for model:', this.modelID);
        const loadGeometryStart = performance.now();
        const geometries = this.ifcApi.LoadAllGeometry(this.modelID);
        const loadGeometryTime = performance.now() - loadGeometryStart;
        const geomCount = geometries.size();
        console.log(`[MeshCollector] LoadAllGeometry: ${loadGeometryTime.toFixed(2)}ms, found ${geomCount} flat meshes`);

        // Cache WASM module reference once
        const wasmModule = (this.ifcApi as any).wasmModule;
        if (!wasmModule || !wasmModule.HEAPF32) {
            console.warn('[MeshCollector] WASM module not accessible');
            return meshes;
        }

        let noGeometriesCount = 0;
        let failedGetGeometry = 0;
        let noVertexData = 0;
        let successCount = 0;

        const processingStart = performance.now();

        // Use progressive loading if quality mode supports it
        if (this.quality === GeometryQuality.Balanced || this.quality === GeometryQuality.High) {
            // Standard processing (all meshes)
            for (let i = 0; i < geomCount; i++) {
                const flatMesh = geometries.get(i);
                const expressID = flatMesh.expressID;
                const placedGeomCount = flatMesh.geometries ? flatMesh.geometries.size() : 0;

                if (placedGeomCount === 0) {
                    noGeometriesCount++;
                    continue;
                }

                const mesh = this.processSingleMesh(flatMesh, expressID, wasmModule);
                if (mesh) {
                    meshes.push(mesh);
                    successCount++;
                } else {
                    noGeometriesCount++;
                }
            }
        } else {
            // Fast mode: process with quality filtering
            const loader = new ProgressiveMeshLoader(this.quality);
            const priorityMeshes = loader.prioritizeMeshes(geometries, this.entityIndex);

            for (const priorityMesh of priorityMeshes) {
                if (loader.shouldSkipMesh(priorityMesh, priorityMesh.flatMesh)) {
                    continue;
                }

                const placedGeomCount = priorityMesh.flatMesh.geometries ? priorityMesh.flatMesh.geometries.size() : 0;
                if (placedGeomCount === 0) {
                    noGeometriesCount++;
                    continue;
                }

                const mesh = this.processSingleMesh(priorityMesh.flatMesh, priorityMesh.expressId, wasmModule);
                if (mesh) {
                    meshes.push(mesh);
                    successCount++;
                } else {
                    noGeometriesCount++;
                }
            }
        }

        const processingTime = performance.now() - processingStart;
        const totalTime = performance.now() - totalStart;

        const nonDefaultColors = meshes.filter(m => m.color[0] !== 0.8 || m.color[1] !== 0.8 || m.color[2] !== 0.8).length;

        console.log('[MeshCollector] Stats:', {
            total: geomCount,
            noGeometries: noGeometriesCount,
            failedGetGeometry,
            noVertexData,
            successfulGeoms: successCount,
            outputMeshes: meshes.length,
            meshesWithNonDefaultColor: nonDefaultColors,
            styleIndexSize: this.styleIndex.size,
        });

        console.log('[MeshCollector] Performance breakdown:', {
            styleIndex: `${styleIndexTime.toFixed(2)}ms`,
            loadGeometry: `${loadGeometryTime.toFixed(2)}ms`,
            processing: `${processingTime.toFixed(2)}ms`,
            total: `${totalTime.toFixed(2)}ms`,
        });

        return meshes;
    }

    /**
     * Collect meshes incrementally, yielding batches for progressive rendering
     * @param batchSize Number of meshes per batch (default: 100)
     */
    async *collectMeshesStreaming(batchSize: number = 100): AsyncGenerator<MeshData[]> {
        const totalStart = performance.now();

        // In Fast mode, skip style index entirely - use default colors (saves ~128ms)
        const styleIndexStart = performance.now();
        if (this.quality !== GeometryQuality.Fast) {
            this.buildStyleIndex();
        } else {
            console.log('[MeshCollector] Fast mode: skipping style index, using default colors');
        }
        const styleIndexTime = performance.now() - styleIndexStart;
        if (styleIndexTime > 50) {
            console.log(`[MeshCollector] Style index build: ${styleIndexTime.toFixed(2)}ms`);
        }

        console.log('[MeshCollector] Loading all geometry for model:', this.modelID);
        const loadGeometryStart = performance.now();
        const geometries = this.ifcApi.LoadAllGeometry(this.modelID);
        const loadGeometryTime = performance.now() - loadGeometryStart;
        const geomCount = geometries.size();
        console.log(`[MeshCollector] LoadAllGeometry: ${loadGeometryTime.toFixed(2)}ms, found ${geomCount} flat meshes`);

        // Cache WASM module reference once
        const wasmModule = (this.ifcApi as any).wasmModule;
        if (!wasmModule || !wasmModule.HEAPF32) {
            console.warn('[MeshCollector] WASM module not accessible');
            return;
        }

        let batch: MeshData[] = [];
        let noGeometriesCount = 0;
        let successCount = 0;

        const processingStart = performance.now();

        // Use progressive loading if quality mode supports it
        if (this.quality === GeometryQuality.Balanced || this.quality === GeometryQuality.High) {
            // Standard processing (all meshes)
            for (let i = 0; i < geomCount; i++) {
                const flatMesh = geometries.get(i);
                const expressID = flatMesh.expressID;
                const placedGeomCount = flatMesh.geometries ? flatMesh.geometries.size() : 0;

                if (placedGeomCount === 0) {
                    noGeometriesCount++;
                    continue;
                }

                const mesh = this.processSingleMesh(flatMesh, expressID, wasmModule);
                if (mesh) {
                    batch.push(mesh);
                    successCount++;

                    // Yield batch when full
                    if (batch.length >= batchSize) {
                        yield batch;
                        batch = [];
                        // Yield to UI thread
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                } else {
                    noGeometriesCount++;
                }
            }
        } else {
            // Fast mode: process with quality filtering
            const loader = new ProgressiveMeshLoader(this.quality);
            const priorityMeshes = loader.prioritizeMeshes(geometries, this.entityIndex);

            for (const priorityMesh of priorityMeshes) {
                if (loader.shouldSkipMesh(priorityMesh, priorityMesh.flatMesh)) {
                    continue;
                }

                const placedGeomCount = priorityMesh.flatMesh.geometries ? priorityMesh.flatMesh.geometries.size() : 0;
                if (placedGeomCount === 0) {
                    noGeometriesCount++;
                    continue;
                }

                const mesh = this.processSingleMesh(priorityMesh.flatMesh, priorityMesh.expressId, wasmModule);
                if (mesh) {
                    batch.push(mesh);
                    successCount++;

                    // Yield batch when full
                    if (batch.length >= batchSize) {
                        yield batch;
                        batch = [];
                        // Yield to UI thread
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                } else {
                    noGeometriesCount++;
                }
            }
        }

        // Yield remaining meshes
        if (batch.length > 0) {
            yield batch;
        }

        const processingTime = performance.now() - processingStart;
        const totalTime = performance.now() - totalStart;

        console.log('[MeshCollector] Streaming Stats:', {
            total: geomCount,
            noGeometries: noGeometriesCount,
            successfulGeoms: successCount,
            styleIndexSize: this.styleIndex.size,
        });

        console.log('[MeshCollector] Streaming Performance breakdown:', {
            styleIndex: `${styleIndexTime.toFixed(2)}ms`,
            loadGeometry: `${loadGeometryTime.toFixed(2)}ms`,
            processing: `${processingTime.toFixed(2)}ms`,
            total: `${totalTime.toFixed(2)}ms`,
        });
    }

    /**
     * Process a single mesh from flatMesh data
     */
    private processSingleMesh(
        flatMesh: any,
        expressID: number,
        wasmModule: any
    ): MeshData | null {
        const placedGeomCount = flatMesh.geometries ? flatMesh.geometries.size() : 0;

        if (placedGeomCount === 0) {
            return null;
        }

        // OPTIMIZATION: First pass - calculate total sizes for pre-allocation
        let totalVertexCount = 0;
        let totalIndexCount = 0;
        const geometryInfos: Array<{
            vertexData: Float32Array;
            indexData: Uint32Array;
            vertexCount: number;
            transform: Float32Array | number[] | null;
        }> = [];

        let meshColor: [number, number, number, number] | null = null;
        let ifcStyleColor: [number, number, number, number] | null = null;

        // First pass: gather geometry info and calculate sizes
        for (let j = 0; j < placedGeomCount; j++) {
            const placed = flatMesh.geometries.get(j);

            // Get color from pre-built style index - O(1) lookup
            if (!ifcStyleColor && placed.geometryExpressID) {
                ifcStyleColor = this.getStyleColor(placed.geometryExpressID);
            }

            // Extract color from PlacedGeometry if available
            if (placed.color && !meshColor) {
                const color = placed.color as any;
                if (typeof color.x === 'number') {
                    meshColor = [color.x, color.y, color.z, color.w];
                } else if (Array.isArray(color) && color.length >= 4) {
                    meshColor = [color[0], color[1], color[2], color[3]];
                }
            }

            try {
                const meshGeom = this.ifcApi.GetGeometry(this.modelID, placed.geometryExpressID);
                const totalFloats = meshGeom.GetVertexDataSize();
                const indexSize = meshGeom.GetIndexDataSize();

                if (totalFloats > 0 && indexSize > 0) {
                    const vertexCount = totalFloats / 6;
                    const vertexPtr = meshGeom.GetVertexData();
                    const indexPtr = meshGeom.GetIndexData();

                    // Create views directly (faster than slice for read-only first pass)
                    const vertexByteOffset = vertexPtr / 4;
                    const indexByteOffset = indexPtr / 4;

                    // Copy from WASM heap (required - WASM memory may be invalidated)
                    const vertexData = new Float32Array(
                        wasmModule.HEAPF32.buffer,
                        vertexByteOffset * 4,
                        totalFloats
                    ).slice();

                    const indexData = new Uint32Array(
                        wasmModule.HEAPU32.buffer,
                        indexByteOffset * 4,
                        indexSize
                    ).slice();

                    // Keep transform as typed array if possible (avoid Array.from)
                    const transform = placed.flatTransformation;

                    geometryInfos.push({
                        vertexData,
                        indexData,
                        vertexCount,
                        transform,
                    });

                    totalVertexCount += vertexCount;
                    totalIndexCount += indexSize;
                }
            } catch (e) {
                // Skip failed geometry
                continue;
            }
        }

        if (totalVertexCount === 0) {
            return null;
        }

        // OPTIMIZATION: Pre-allocate typed arrays with exact sizes
        const positions = new Float32Array(totalVertexCount * 3);
        const normals = new Float32Array(totalVertexCount * 3);
        const indices = new Uint32Array(totalIndexCount);

        let posOffset = 0;
        let normOffset = 0;
        let idxOffset = 0;
        let vertexOffset = 0;

        // Second pass: fill pre-allocated arrays
        for (const info of geometryInfos) {
            const { vertexData, indexData, vertexCount, transform } = info;

            // Get transform values (avoid Array.from by accessing directly)
            let m0 = 1, m1 = 0, m2 = 0;
            let m4 = 0, m5 = 1, m6 = 0;
            let m8 = 0, m9 = 0, m10 = 1;
            let m12 = 0, m13 = 0, m14 = 0;
            let hasTransform = false;

            if (transform && (transform as any).length === 16) {
                const t = transform as any;
                // Check if it's a valid transform
                if (Number.isFinite(t[0]) && Number.isFinite(t[15])) {
                    hasTransform = true;
                    m0 = t[0]; m1 = t[1]; m2 = t[2];
                    m4 = t[4]; m5 = t[5]; m6 = t[6];
                    m8 = t[8]; m9 = t[9]; m10 = t[10];
                    m12 = t[12]; m13 = t[13]; m14 = t[14];
                }
            }

            // OPTIMIZATION: Unrolled loop with direct array access
            for (let k = 0; k < vertexCount; k++) {
                const base = k * 6;
                const x = vertexData[base];
                const y = vertexData[base + 1];
                const z = vertexData[base + 2];
                const nx = vertexData[base + 3];
                const ny = vertexData[base + 4];
                const nz = vertexData[base + 5];

                if (hasTransform) {
                    // Transform position
                    positions[posOffset] = m0 * x + m4 * y + m8 * z + m12;
                    positions[posOffset + 1] = m1 * x + m5 * y + m9 * z + m13;
                    positions[posOffset + 2] = m2 * x + m6 * y + m10 * z + m14;

                    // Transform normal
                    const tnx = m0 * nx + m4 * ny + m8 * nz;
                    const tny = m1 * nx + m5 * ny + m9 * nz;
                    const tnz = m2 * nx + m6 * ny + m10 * nz;

                    // Normalize
                    const len = Math.sqrt(tnx * tnx + tny * tny + tnz * tnz);
                    if (len > 1e-10) {
                        normals[normOffset] = tnx / len;
                        normals[normOffset + 1] = tny / len;
                        normals[normOffset + 2] = tnz / len;
                    } else {
                        normals[normOffset] = tnx;
                        normals[normOffset + 1] = tny;
                        normals[normOffset + 2] = tnz;
                    }
                } else {
                    positions[posOffset] = x;
                    positions[posOffset + 1] = y;
                    positions[posOffset + 2] = z;
                    normals[normOffset] = nx;
                    normals[normOffset + 1] = ny;
                    normals[normOffset + 2] = nz;
                }

                posOffset += 3;
                normOffset += 3;
            }

            // Copy indices with offset
            for (let k = 0; k < indexData.length; k++) {
                indices[idxOffset++] = indexData[k] + vertexOffset;
            }
            vertexOffset += vertexCount;
        }

        // Determine final color
        let finalColor: [number, number, number, number] = [0.8, 0.8, 0.8, 1.0];
        if (ifcStyleColor) {
            finalColor = ifcStyleColor;
        } else if (meshColor) {
            finalColor = meshColor;
        } else {
            try {
                const entityType = this.ifcApi.GetLineType(this.modelID, expressID);
                const entityTypeStr = typeof entityType === 'string' ? entityType : null;
                finalColor = getDefaultColor(entityTypeStr);
            } catch (e) {
                // Use default gray
            }
        }

        return {
            expressId: expressID,
            positions,
            normals,
            indices,
            color: finalColor,
        };
    }

}
