#!/usr/bin/env node
/**
 * Test IFC-Lite WASM Parser
 *
 * Tests the Rust+WASM parser with a real IFC file.
 */

import { readFileSync } from 'fs';
import { initSync, IfcAPI } from './pkg/ifc-lite.js';

console.log('🦀 IFC-Lite WASM Parser Test\n');

// Initialize WASM
console.log('🔧 Initializing WASM module...');
const wasmBuffer = readFileSync('./pkg/ifc-lite_bg.wasm');
initSync(wasmBuffer);
console.log('✅ WASM initialized\n');

// Load the IFC file
const IFC_FILE = '../../01_Snowdon_Towers_Sample_Structural(1).ifc';
console.log(`📁 Loading IFC file: ${IFC_FILE}`);

let ifcData;
try {
    ifcData = readFileSync(IFC_FILE, 'utf-8');
    console.log(`✅ File loaded: ${(ifcData.length / 1024 / 1024).toFixed(2)} MB\n`);
} catch (error) {
    console.error('❌ Failed to load IFC file:', error.message);
    process.exit(1);
}

// Initialize the API
console.log('🔧 Initializing IFC-Lite API...');
const api = new IfcAPI();
console.log(`✅ API ready (version: ${api.version})\n`);

// Test 1: Traditional parse (entity counting)
console.log('📊 Test 1: Traditional Parse (Entity Counting)');
console.log('─'.repeat(50));
const startTime = performance.now();

try {
    const result = await api.parse(ifcData);
    const duration = performance.now() - startTime;

    console.log(`✅ Parse completed in ${duration.toFixed(2)}ms`);
    console.log(`📦 Total entities: ${result.entityCount}`);
    console.log(`\n📋 Entity types:`);

    // Sort by count descending
    const types = Object.entries(result.entityTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10

    for (const [type, count] of types) {
        const bar = '█'.repeat(Math.ceil(count / 10));
        console.log(`  ${type.padEnd(30)} ${count.toString().padStart(5)} ${bar}`);
    }

    console.log(`\n✨ Parse performance: ${(result.entityCount / duration * 1000).toFixed(0)} entities/sec\n`);
} catch (error) {
    console.error('❌ Parse failed:', error.message);
}

// Test 2: Streaming parse (with events)
console.log('🌊 Test 2: Streaming Parse (With Events)');
console.log('─'.repeat(50));

let eventCount = 0;
let lastProgress = 0;

try {
    const streamStart = performance.now();

    await api.parseStreaming(ifcData, (event) => {
        eventCount++;

        if (event.type === 'started') {
            console.log(`🚀 Started parsing ${(event.fileSize / 1024 / 1024).toFixed(2)} MB file`);
        } else if (event.type === 'progress') {
            // Only show progress every 10%
            if (Math.floor(event.percent / 10) > Math.floor(lastProgress / 10)) {
                console.log(`   Progress: ${event.percent.toFixed(1)}% (${event.entitiesProcessed} entities)`);
                lastProgress = event.percent;
            }
        } else if (event.type === 'completed') {
            const duration = performance.now() - streamStart;
            console.log(`✅ Streaming completed in ${duration.toFixed(2)}ms`);
            console.log(`📊 Total events: ${eventCount}`);
            console.log(`📦 Entities processed: ${event.entityCount}`);
            console.log(`🔺 Triangles generated: ${event.triangleCount}`);
        } else if (event.type === 'entityScanned') {
            // Silently count
        } else if (event.type === 'error') {
            console.error(`❌ Error at position ${event.position}: ${event.message}`);
        }
    });

    console.log();
} catch (error) {
    console.error('❌ Streaming failed:', error.message);
}

// Test 3: Zero-copy parse (performance test)
console.log('⚡ Test 3: Zero-Copy Parse (Maximum Performance)');
console.log('─'.repeat(50));

try {
    const zeroCopyStart = performance.now();
    const mesh = await api.parseZeroCopy(ifcData);
    const duration = performance.now() - zeroCopyStart;

    console.log(`✅ Zero-copy parse completed in ${duration.toFixed(2)}ms`);
    console.log(`📊 Mesh info:`);
    console.log(`   Vertices: ${mesh.vertex_count}`);
    console.log(`   Triangles: ${mesh.triangle_count}`);
    console.log(`   Empty: ${mesh.is_empty ? 'Yes' : 'No'}`);

    if (!mesh.is_empty) {
        const min = mesh.bounds_min();
        const max = mesh.bounds_max();
        console.log(`   Bounds: [${min[0].toFixed(2)}, ${min[1].toFixed(2)}, ${min[2].toFixed(2)}] to [${max[0].toFixed(2)}, ${max[1].toFixed(2)}, ${max[2].toFixed(2)}]`);
    }

    console.log();
} catch (error) {
    console.error('❌ Zero-copy parse failed:', error.message);
}

console.log('✨ All tests completed!\n');
