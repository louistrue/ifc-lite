#!/usr/bin/env node
import { readFileSync } from 'fs';
import { initSync, IfcAPI } from './pkg/ifc_lite_wasm.js';

// Initialize WASM
const wasmBuffer = readFileSync('./pkg/ifc_lite_wasm_bg.wasm');
initSync(wasmBuffer);

// Test
const api = new IfcAPI();
console.log('IfcAPI methods:');
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(api)));

// Load IFC file
const ifcData = readFileSync('../../01_Snowdon_Towers_Sample_Structural(1).ifc', 'utf-8');

console.log('\nTesting first wall processing...');
const result = api.debugProcessFirstWall(ifcData);
console.log('\nResult:', result);
