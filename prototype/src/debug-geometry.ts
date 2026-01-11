/**
 * Debug Geometry Coordinates
 * 
 * Standalone test to analyze geometry coordinate ranges and identify
 * why bounds calculation is producing extreme values.
 */

import { GeometryProcessor } from '../../packages/geometry/src/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';

interface CoordinateAnalysis {
    totalMeshes: number;
    totalVertices: number;
    bounds: {
        min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number };
    };
    coordinateRanges: {
        normal: number;      // -10000 to 10000
        large: number;       // 10000 to 1e6
        extreme: number;    // >1e6
        invalid: number;    // NaN or Infinity
    };
    meshesWithExtremeValues: Array<{
        index: number;
        expressId: number;
        vertexCount: number;
        minCoord: number;
        maxCoord: number;
        sampleCoords: number[][];
    }>;
    sampleCoords: Array<{
        meshIndex: number;
        expressId: number;
        first10: number[][];
    }>;
}

async function debugGeometry(filePath: string): Promise<CoordinateAnalysis> {
    console.log(`\n🔍 Loading IFC file: ${filePath}\n`);

    const buffer = readFileSync(filePath);
    console.log(`📦 File size: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB\n`);

    const processor = new GeometryProcessor();
    
    console.log('⏳ Initializing web-ifc...');
    // For Node.js, use the public directory where WASM files are located
    const wasmPath = join(process.cwd(), 'public') + '/';
    await processor.init(wasmPath);
    console.log('✓ web-ifc initialized\n');

    console.log('⏳ Processing geometry...');
    const startTime = performance.now();
    const geometryResult = await processor.process(new Uint8Array(buffer));
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✓ Geometry processed in ${elapsed}s\n`);

    console.log(`📊 Analyzing ${geometryResult.meshes.length} meshes...\n`);

    const analysis: CoordinateAnalysis = {
        totalMeshes: geometryResult.meshes.length,
        totalVertices: 0,
        bounds: {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
        },
        coordinateRanges: {
            normal: 0,
            large: 0,
            extreme: 0,
            invalid: 0,
        },
        meshesWithExtremeValues: [],
        sampleCoords: [],
    };

    const MAX_NORMAL = 10000;
    const MAX_LARGE = 1e6;

    for (let i = 0; i < geometryResult.meshes.length; i++) {
        const mesh = geometryResult.meshes[i];
        const positions = mesh.positions;
        const vertexCount = positions.length / 3;
        analysis.totalVertices += vertexCount;

        let meshMin = Infinity;
        let meshMax = -Infinity;
        const sampleCoords: number[][] = [];

        for (let j = 0; j < positions.length; j += 3) {
            const x = positions[j];
            const y = positions[j + 1];
            const z = positions[j + 2];

            // Check for invalid values
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                analysis.coordinateRanges.invalid++;
                continue;
            }

            // Categorize coordinate values
            const absMax = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
            if (absMax > MAX_LARGE) {
                analysis.coordinateRanges.extreme++;
            } else if (absMax > MAX_NORMAL) {
                analysis.coordinateRanges.large++;
            } else {
                analysis.coordinateRanges.normal++;
            }

            // Track mesh bounds
            meshMin = Math.min(meshMin, x, y, z);
            meshMax = Math.max(meshMax, x, y, z);

            // Update global bounds (only if reasonable)
            if (absMax < MAX_LARGE) {
                analysis.bounds.min.x = Math.min(analysis.bounds.min.x, x);
                analysis.bounds.min.y = Math.min(analysis.bounds.min.y, y);
                analysis.bounds.min.z = Math.min(analysis.bounds.min.z, z);
                analysis.bounds.max.x = Math.max(analysis.bounds.max.x, x);
                analysis.bounds.max.y = Math.max(analysis.bounds.max.y, y);
                analysis.bounds.max.z = Math.max(analysis.bounds.max.z, z);
            }

            // Collect samples from first few vertices
            if (sampleCoords.length < 10) {
                sampleCoords.push([x, y, z]);
            }
        }

        // Record mesh with extreme values
        if (Math.abs(meshMax) > MAX_LARGE || Math.abs(meshMin) > MAX_LARGE) {
            analysis.meshesWithExtremeValues.push({
                index: i,
                expressId: mesh.expressId,
                vertexCount,
                minCoord: meshMin,
                maxCoord: meshMax,
                sampleCoords: sampleCoords.slice(0, 5),
            });
        }

        // Store samples from first 3 meshes
        if (i < 3) {
            analysis.sampleCoords.push({
                meshIndex: i,
                expressId: mesh.expressId,
                first10: sampleCoords,
            });
        }
    }

    return analysis;
}

function printAnalysis(analysis: CoordinateAnalysis): void {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 GEOMETRY COORDINATE ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Total Meshes: ${analysis.totalMeshes}`);
    console.log(`Total Vertices: ${analysis.totalVertices.toLocaleString()}\n`);

    console.log('Coordinate Ranges:');
    const total = analysis.coordinateRanges.normal + 
                  analysis.coordinateRanges.large + 
                  analysis.coordinateRanges.extreme + 
                  analysis.coordinateRanges.invalid;
    console.log(`  Normal (-10km to 10km):     ${analysis.coordinateRanges.normal.toLocaleString()} (${(100 * analysis.coordinateRanges.normal / total).toFixed(1)}%)`);
    console.log(`  Large (10km to 1000km):     ${analysis.coordinateRanges.large.toLocaleString()} (${(100 * analysis.coordinateRanges.large / total).toFixed(1)}%)`);
    console.log(`  Extreme (>1000km):          ${analysis.coordinateRanges.extreme.toLocaleString()} (${(100 * analysis.coordinateRanges.extreme / total).toFixed(1)}%)`);
    console.log(`  Invalid (NaN/Infinity):     ${analysis.coordinateRanges.invalid.toLocaleString()} (${(100 * analysis.coordinateRanges.invalid / total).toFixed(1)}%)\n`);

    console.log('Bounds (filtered, excluding extreme values):');
    console.log(`  Min: (${analysis.bounds.min.x.toFixed(2)}, ${analysis.bounds.min.y.toFixed(2)}, ${analysis.bounds.min.z.toFixed(2)})`);
    console.log(`  Max: (${analysis.bounds.max.x.toFixed(2)}, ${analysis.bounds.max.y.toFixed(2)}, ${analysis.bounds.max.z.toFixed(2)})`);
    const size = {
        x: analysis.bounds.max.x - analysis.bounds.min.x,
        y: analysis.bounds.max.y - analysis.bounds.min.y,
        z: analysis.bounds.max.z - analysis.bounds.min.z,
    };
    console.log(`  Size: (${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);
    console.log(`  Max dimension: ${Math.max(size.x, size.y, size.z).toFixed(2)}m\n`);

    if (analysis.meshesWithExtremeValues.length > 0) {
        console.log(`⚠️  Meshes with extreme values: ${analysis.meshesWithExtremeValues.length}`);
        console.log('   First 10 meshes:');
        for (const mesh of analysis.meshesWithExtremeValues.slice(0, 10)) {
            console.log(`   - Mesh #${mesh.index} (expressId: ${mesh.expressId}):`);
            console.log(`     Vertices: ${mesh.vertexCount}, Range: [${mesh.minCoord.toExponential(2)}, ${mesh.maxCoord.toExponential(2)}]`);
            console.log(`     Sample coords: ${mesh.sampleCoords.map(c => `(${c[0].toFixed(2)}, ${c[1].toFixed(2)}, ${c[2].toFixed(2)})`).join(', ')}`);
        }
        console.log('');
    }

    console.log('Sample coordinates from first 3 meshes:');
    for (const sample of analysis.sampleCoords) {
        console.log(`\n  Mesh #${sample.meshIndex} (expressId: ${sample.expressId}):`);
        for (let i = 0; i < sample.first10.length; i++) {
            const [x, y, z] = sample.first10[i];
            console.log(`    [${i}]: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');
}

// Main execution
const filePath = process.argv[2] || join(process.cwd(), '..', '01_Snowdon_Towers_Sample_Structural(1).ifc');

debugGeometry(filePath)
    .then(printAnalysis)
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
