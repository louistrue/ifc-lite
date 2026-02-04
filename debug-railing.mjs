/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Debug script to trace geometry for the problematic railing
import pkg from './packages/wasm/pkg/ifc-lite.js';
const { processIfc, initWasm } = pkg;
import * as fs from 'fs';

await initWasm();

const ifcBuffer = fs.readFileSync('tests/models/local/AR.ifc');
const result = processIfc(ifcBuffer);

// Find the problematic railing by GlobalId
const targetGuid = '3ZveCIVhf3exFdDUAllrMA';

let found = false;
for (const [expressId, mesh] of result.meshes) {
    const entity = result.entities.get(expressId);
    if (!entity) continue;

    const globalId = entity.attributes?.GlobalId;
    if (globalId === targetGuid) {
        found = true;
        console.log(`\n=== Found Railing: ExpressID ${expressId} ===`);
        console.log(`Vertices: ${mesh.positions.length / 3}`);
        console.log(`Triangles: ${mesh.indices.length / 3}`);

        // Calculate bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < mesh.positions.length; i += 3) {
            const x = mesh.positions[i];
            const y = mesh.positions[i + 1];
            const z = mesh.positions[i + 2];
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
        }

        console.log(`\nBounding Box:`);
        console.log(`  X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)}m)`);
        console.log(`  Y: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)}m)`);
        console.log(`  Z: ${minZ.toFixed(2)} to ${maxZ.toFixed(2)} (span: ${(maxZ - minZ).toFixed(2)}m)`);

        // Sample vertices to see the distribution
        console.log(`\nSample vertices (first 10):`);
        for (let i = 0; i < Math.min(30, mesh.positions.length); i += 3) {
            console.log(`  (${mesh.positions[i].toFixed(2)}, ${mesh.positions[i + 1].toFixed(2)}, ${mesh.positions[i + 2].toFixed(2)})`);
        }

        // Check for stretched triangles
        console.log(`\nChecking for stretched triangles:`);
        let stretchedCount = 0;
        let maxEdge = 0;
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const i0 = mesh.indices[i];
            const i1 = mesh.indices[i + 1];
            const i2 = mesh.indices[i + 2];

            const p0 = [mesh.positions[i0 * 3], mesh.positions[i0 * 3 + 1], mesh.positions[i0 * 3 + 2]];
            const p1 = [mesh.positions[i1 * 3], mesh.positions[i1 * 3 + 1], mesh.positions[i1 * 3 + 2]];
            const p2 = [mesh.positions[i2 * 3], mesh.positions[i2 * 3 + 1], mesh.positions[i2 * 3 + 2]];

            const edge01 = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2 + (p1[2] - p0[2]) ** 2);
            const edge12 = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2 + (p2[2] - p1[2]) ** 2);
            const edge20 = Math.sqrt((p0[0] - p2[0]) ** 2 + (p0[1] - p2[1]) ** 2 + (p0[2] - p2[2]) ** 2);

            const longest = Math.max(edge01, edge12, edge20);
            maxEdge = Math.max(maxEdge, longest);

            if (longest > 50) {
                stretchedCount++;
                if (stretchedCount <= 3) {
                    console.log(`  Triangle ${i / 3}: edges ${edge01.toFixed(1)}, ${edge12.toFixed(1)}, ${edge20.toFixed(1)}`);
                    console.log(`    P0: (${p0.map(v => v.toFixed(2)).join(', ')})`);
                    console.log(`    P1: (${p1.map(v => v.toFixed(2)).join(', ')})`);
                    console.log(`    P2: (${p2.map(v => v.toFixed(2)).join(', ')})`);
                }
            }
        }
        console.log(`\nStretched triangles (>50m): ${stretchedCount}`);
        console.log(`Max edge length: ${maxEdge.toFixed(2)}m`);
    }
}

if (!found) {
    console.log(`Railing with GlobalId ${targetGuid} not found!`);
}
