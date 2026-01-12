#!/usr/bin/env node
import { readFileSync } from 'fs';
import wasm_module from './pkg/ifc_lite_wasm.js';

// Initialize WASM
const wasmBuffer = readFileSync('./pkg/ifc_lite_wasm_bg.wasm');
await wasm_module.init(wasmBuffer);

// Load IFC file
const ifcData = readFileSync('../../01_Snowdon_Towers_Sample_Structural(1).ifc', 'utf-8');

// Test
const api = new wasm_module.IfcAPI();
console.log('Testing first wall processing...');
const result = api.debugProcessFirstWall(ifcData);
console.log('\nResult:', result);
