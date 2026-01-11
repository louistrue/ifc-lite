/**
 * Spike 5: Columnar Data Structures
 * Goal: Test columnar storage vs Map-based approach
 * Success: Measure memory savings and query performance improvements
 */

import { IfcParser } from '@ifc-lite/parser';
import type { ParseResult } from '@ifc-lite/parser';

export interface ColumnarSpikeResult {
    passed: boolean;
    mapMemoryMB: number;
    columnarMemoryMB: number;
    memorySavingsPercent: number;
    mapQueryTimeMs: number;
    columnarQueryTimeMs: number;
    querySpeedup: number;
    stringDedupRatio: number;
    entityCount: number;
}

/**
 * StringTable implementation for deduplication
 */
class StringTable {
    private strings: string[] = [''];
    private index: Map<string, number> = new Map([['', 0]]);

    get count(): number {
        return this.strings.length;
    }

    intern(value: string | null | undefined): number {
        if (value === null || value === undefined || value === '') {
            return 0;
        }

        const existing = this.index.get(value);
        if (existing !== undefined) {
            return existing;
        }

        const newIndex = this.strings.length;
        this.strings.push(value);
        this.index.set(value, newIndex);
        return newIndex;
    }

    get(index: number): string {
        if (index < 0 || index >= this.strings.length) {
            return '';
        }
        return this.strings[index];
    }

    getMemoryEstimate(): number {
        // Estimate memory: strings array overhead + string data
        let totalBytes = 0;
        for (const str of this.strings) {
            totalBytes += str.length * 2; // UTF-16 encoding
        }
        totalBytes += this.strings.length * 8; // Array overhead
        totalBytes += this.index.size * 40; // Map overhead (rough estimate)
        return totalBytes;
    }
}

/**
 * Columnar EntityTable implementation
 */
class ColumnarEntityTable {
    expressId: Uint32Array;
    typeEnum: Uint16Array;
    globalId: Uint32Array;
    name: Uint32Array;
    description: Uint32Array;
    objectType: Uint32Array;
    flags: Uint8Array;

    private count: number = 0;
    private capacity: number;
    private strings: StringTable;

    constructor(capacity: number, strings: StringTable) {
        this.capacity = capacity;
        this.strings = strings;

        this.expressId = new Uint32Array(capacity);
        this.typeEnum = new Uint16Array(capacity);
        this.globalId = new Uint32Array(capacity);
        this.name = new Uint32Array(capacity);
        this.description = new Uint32Array(capacity);
        this.objectType = new Uint32Array(capacity);
        this.flags = new Uint8Array(capacity);
    }

    add(expressId: number, type: string, globalId: string, name: string, description: string, objectType: string): void {
        const i = this.count++;
        this.expressId[i] = expressId;
        this.typeEnum[i] = this.typeToEnum(type);
        this.globalId[i] = this.strings.intern(globalId);
        this.name[i] = this.strings.intern(name);
        this.description[i] = this.strings.intern(description);
        this.objectType[i] = this.strings.intern(objectType);
    }

    private typeToEnum(type: string): number {
        // Simple hash-based enum (for testing)
        const commonTypes: Record<string, number> = {
            'IfcWall': 1,
            'IfcWallStandardCase': 2,
            'IfcDoor': 3,
            'IfcWindow': 4,
            'IfcSlab': 5,
            'IfcColumn': 6,
            'IfcBeam': 7,
            'IfcBuildingStorey': 8,
            'IfcBuilding': 9,
            'IfcSite': 10,
            'IfcProject': 11,
        };
        return commonTypes[type] || 0;
    }

    getByType(typeEnum: number): number[] {
        const results: number[] = [];
        for (let i = 0; i < this.count; i++) {
            if (this.typeEnum[i] === typeEnum) {
                results.push(this.expressId[i]);
            }
        }
        return results;
    }

    getMemoryEstimate(): number {
        return (
            this.expressId.byteLength +
            this.typeEnum.byteLength +
            this.globalId.byteLength +
            this.name.byteLength +
            this.description.byteLength +
            this.objectType.byteLength +
            this.flags.byteLength
        );
    }

    trim(): void {
        // Trim arrays to actual size
        this.expressId = this.expressId.subarray(0, this.count);
        this.typeEnum = this.typeEnum.subarray(0, this.count);
        this.globalId = this.globalId.subarray(0, this.count);
        this.name = this.name.subarray(0, this.count);
        this.description = this.description.subarray(0, this.count);
        this.objectType = this.objectType.subarray(0, this.count);
        this.flags = this.flags.subarray(0, this.count);
    }
}

/**
 * Columnar PropertyTable implementation
 */
class ColumnarPropertyTable {
    entityId: Uint32Array;
    psetName: Uint32Array;
    propName: Uint32Array;
    valueString: Uint32Array;
    valueReal: Float64Array;
    propType: Uint8Array;

    private count: number = 0;
    private capacity: number;
    private strings: StringTable;

    constructor(capacity: number, strings: StringTable) {
        this.capacity = capacity;
        this.strings = strings;

        this.entityId = new Uint32Array(capacity);
        this.psetName = new Uint32Array(capacity);
        this.propName = new Uint32Array(capacity);
        this.valueString = new Uint32Array(capacity);
        this.valueReal = new Float64Array(capacity);
        this.propType = new Uint8Array(capacity);
    }

    add(entityId: number, psetName: string, propName: string, value: any): void {
        const i = this.count++;
        this.entityId[i] = entityId;
        this.psetName[i] = this.strings.intern(psetName);
        this.propName[i] = this.strings.intern(propName);

        if (typeof value === 'string') {
            this.propType[i] = 0; // String
            this.valueString[i] = this.strings.intern(value);
            this.valueReal[i] = 0;
        } else if (typeof value === 'number') {
            this.propType[i] = 1; // Real
            this.valueString[i] = 0;
            this.valueReal[i] = value;
        } else {
            this.propType[i] = 0;
            this.valueString[i] = 0;
            this.valueReal[i] = 0;
        }
    }

    findByProperty(psetName: string, propName: string, operator: string, value: number): number[] {
        const psetIdx = this.strings.intern(psetName);
        const propIdx = this.strings.intern(propName);
        const results: number[] = [];

        for (let i = 0; i < this.count; i++) {
            if (this.psetName[i] !== psetIdx || this.propName[i] !== propIdx) {
                continue;
            }

            if (this.propType[i] === 1) { // Real
                const propValue = this.valueReal[i];
                let match = false;

                switch (operator) {
                    case '>=':
                        match = propValue >= value;
                        break;
                    case '>':
                        match = propValue > value;
                        break;
                    case '<=':
                        match = propValue <= value;
                        break;
                    case '<':
                        match = propValue < value;
                        break;
                    case '=':
                        match = propValue === value;
                        break;
                }

                if (match) {
                    results.push(this.entityId[i]);
                }
            }
        }

        return results;
    }

    getMemoryEstimate(): number {
        return (
            this.entityId.byteLength +
            this.psetName.byteLength +
            this.propName.byteLength +
            this.valueString.byteLength +
            this.valueReal.byteLength +
            this.propType.byteLength
        );
    }

    trim(): void {
        this.entityId = this.entityId.subarray(0, this.count);
        this.psetName = this.psetName.subarray(0, this.count);
        this.propName = this.propName.subarray(0, this.count);
        this.valueString = this.valueString.subarray(0, this.count);
        this.valueReal = this.valueReal.subarray(0, this.count);
        this.propType = this.propType.subarray(0, this.count);
    }
}

/**
 * Estimate memory usage of Map-based approach
 */
function estimateMapMemory(parseResult: ParseResult): number {
    let totalBytes = 0;

    // Entities Map
    for (const [id, entity] of parseResult.entities) {
        totalBytes += 8; // Map entry overhead
        totalBytes += 8; // Key (number)
        totalBytes += 50; // Object overhead
        totalBytes += (entity.type?.length || 0) * 2;
        totalBytes += (entity.attributes?.length || 0) * 8;
    }

    // PropertySets Map
    for (const [id, pset] of parseResult.propertySets) {
        totalBytes += 8; // Map entry overhead
        totalBytes += 8; // Key
        totalBytes += 50; // Object overhead
        totalBytes += (pset.name?.length || 0) * 2;

        // Properties Map
        for (const [propName, propValue] of pset.properties) {
            totalBytes += 8; // Map entry overhead
            totalBytes += (propName?.length || 0) * 2;
            totalBytes += 30; // PropertyValue object
            if (typeof propValue.value === 'string') {
                totalBytes += (propValue.value.length || 0) * 2;
            }
        }
    }

    return totalBytes;
}

/**
 * Run columnar spike test
 */
export async function runColumnarSpike(file: File): Promise<ColumnarSpikeResult> {
    console.log('[Spike5] Starting columnar data structures test...');

    // Parse IFC file
    const buffer = await file.arrayBuffer();
    const parser = new IfcParser();
    const parseResult = await parser.parse(buffer);

    const entityCount = parseResult.entityCount;
    console.log(`[Spike5] Parsed ${entityCount} entities`);

    // === Measure Map-based memory ===
    const mapMemoryBytes = estimateMapMemory(parseResult);
    const mapMemoryMB = mapMemoryBytes / (1024 * 1024);
    console.log(`[Spike5] Map-based memory: ${mapMemoryMB.toFixed(2)} MB`);

    // === Build columnar structures ===
    const stringTable = new StringTable();
    const entityTable = new ColumnarEntityTable(entityCount, stringTable);
    const propertyTable = new ColumnarPropertyTable(parseResult.propertySets.size * 10, stringTable);

    // Populate entity table
    for (const [id, entity] of parseResult.entities) {
        const attrs = entity.attributes || [];
        const globalId = attrs[0] || '';
        const name = attrs[2] || '';
        const description = attrs[3] || '';
        const objectType = attrs[7] || '';

        entityTable.add(id, entity.type, String(globalId), String(name), String(description), String(objectType));
    }
    entityTable.trim();

    // Populate property table
    let propertyCount = 0;
    for (const [psetId, pset] of parseResult.propertySets) {
        for (const [propName, propValue] of pset.properties) {
            propertyCount++;
            // Find entities with this property set
            for (const rel of parseResult.relationships) {
                if (rel.type === 'IfcRelDefinesByProperties' && rel.relatingObject === psetId) {
                    for (const entityId of rel.relatedObjects) {
                        propertyTable.add(entityId, pset.name, propName, propValue.value);
                    }
                }
            }
        }
    }
    propertyTable.trim();

    // === Measure columnar memory ===
    const stringMemoryBytes = stringTable.getMemoryEstimate();
    const entityMemoryBytes = entityTable.getMemoryEstimate();
    const propertyMemoryBytes = propertyTable.getMemoryEstimate();
    const columnarMemoryBytes = stringMemoryBytes + entityMemoryBytes + propertyMemoryBytes;
    const columnarMemoryMB = columnarMemoryBytes / (1024 * 1024);

    console.log(`[Spike5] Columnar memory breakdown:`);
    console.log(`  - StringTable: ${(stringMemoryBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  - EntityTable: ${(entityMemoryBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  - PropertyTable: ${(propertyMemoryBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`[Spike5] Total columnar memory: ${columnarMemoryMB.toFixed(2)} MB`);

    const memorySavingsPercent = ((mapMemoryMB - columnarMemoryMB) / mapMemoryMB) * 100;
    console.log(`[Spike5] Memory savings: ${memorySavingsPercent.toFixed(1)}%`);

    // === Measure string deduplication ===
    const originalStringBytes = mapMemoryBytes * 0.3; // Estimate 30% of memory is strings
    const deduplicatedStringBytes = stringMemoryBytes;
    const stringDedupRatio = deduplicatedStringBytes / originalStringBytes;
    console.log(`[Spike5] String deduplication ratio: ${(stringDedupRatio * 100).toFixed(1)}%`);

    // === Query performance test ===
    // Test: Find all walls (type filter)
    const wallTypeEnum = 1; // IfcWall

    // Map-based query
    const mapStart = performance.now();
    const mapWalls: number[] = [];
    for (const [id, entity] of parseResult.entities) {
        if (entity.type === 'IfcWall' || entity.type === 'IfcWallStandardCase') {
            mapWalls.push(id);
        }
    }
    const mapQueryTimeMs = performance.now() - mapStart;

    // Columnar query
    const columnarStart = performance.now();
    const columnarWalls = entityTable.getByType(wallTypeEnum);
    const columnarQueryTimeMs = performance.now() - columnarStart;

    console.log(`[Spike5] Query performance:`);
    console.log(`  - Map-based: ${mapQueryTimeMs.toFixed(3)}ms (${mapWalls.length} results)`);
    console.log(`  - Columnar: ${columnarQueryTimeMs.toFixed(3)}ms (${columnarWalls.length} results)`);

    const querySpeedup = mapQueryTimeMs / columnarQueryTimeMs;
    console.log(`[Spike5] Query speedup: ${querySpeedup.toFixed(2)}x`);

    const passed = memorySavingsPercent > 0 && querySpeedup >= 1.0;

    return {
        passed,
        mapMemoryMB,
        columnarMemoryMB,
        memorySavingsPercent,
        mapQueryTimeMs,
        columnarQueryTimeMs,
        querySpeedup,
        stringDedupRatio,
        entityCount,
    };
}
