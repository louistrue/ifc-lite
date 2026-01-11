/**
 * Debug Property Sets
 * 
 * Standalone test to investigate why IfcRelDefinesByProperties relationships
 * aren't being found despite property sets existing.
 */

import { IfcParser } from '../../packages/parser/src/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';

interface DebugResult {
    totalEntities: number;
    relationshipCounts: Map<string, number>;
    sampleRelDefinesByProperties: Array<{
        expressId: number;
        type: string;
        attributes: any[];
        attributeCount: number;
    }>;
    samplePropertySets: Array<{
        expressId: number;
        name: string;
        propertyCount: number;
        sampleProperties: string[];
    }>;
    analysis: {
        relDefinesByPropertiesFound: number;
        propertySetsFound: number;
        potentialIssues: string[];
    };
}

export async function debugProperties(filePath: string): Promise<DebugResult> {
    console.log(`\n🔍 Loading IFC file: ${filePath}\n`);

    const buffer = readFileSync(filePath);
    console.log(`📦 File size: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB\n`);

    const parser = new IfcParser();

    console.log('⏳ Parsing IFC file...');
    const startTime = performance.now();
    const parseResult = await parser.parse(buffer, {
        onProgress: (progress: { phase: string; percent: number }) => {
            if (progress.phase === 'scan' && progress.percent === 100) {
                console.log(`✓ Indexed entities`);
            }
        },
    });
    const parseTime = performance.now() - startTime;
    console.log(`✓ Parsed in ${parseTime.toFixed(2)}ms\n`);

    // Count all relationship types
    const relationshipCounts = new Map<string, number>();
    const relDefinesByProperties: any[] = [];
    const propertySets: any[] = [];

    console.log('📊 Analyzing entities...\n');

    for (const [id, entity] of parseResult.entities) {
        const typeUpper = entity.type.toUpperCase();

        // Count all IFCREL* types
        if (typeUpper.startsWith('IFCREL')) {
            relationshipCounts.set(typeUpper, (relationshipCounts.get(typeUpper) || 0) + 1);

            // Collect IfcRelDefinesByProperties
            if (typeUpper === 'IFCRELDEFINESBYPROPERTIES') {
                relDefinesByProperties.push({
                    expressId: entity.expressId,
                    type: entity.type,
                    attributes: entity.attributes,
                    attributeCount: entity.attributes.length,
                });
            }
        }

        // Collect property sets
        if (typeUpper === 'IFCPROPERTYSET') {
            const pset = parseResult.propertySets.get(id);
            if (pset) {
                propertySets.push({
                    expressId: id,
                    name: pset.name,
                    propertyCount: pset.properties.size,
                    sampleProperties: Array.from(pset.properties.keys()).slice(0, 5),
                });
            }
        }
    }

    // Analyze potential issues
    const potentialIssues: string[] = [];

    if (relDefinesByProperties.length === 0) {
        potentialIssues.push('No IfcRelDefinesByProperties entities found - check if type name matches');
    }

    if (propertySets.length === 0) {
        potentialIssues.push('No IfcPropertySet entities found');
    }

    // Check attribute structure of first few relationships
    if (relDefinesByProperties.length > 0) {
        const first = relDefinesByProperties[0];
        if (first.attributeCount < 6) {
            potentialIssues.push(`IfcRelDefinesByProperties has only ${first.attributeCount} attributes, expected at least 6`);
        }

        // Check if attributes 4 and 5 are arrays/numbers
        if (first.attributes.length >= 5) {
            const attr4 = first.attributes[4];
            const attr5 = first.attributes[5];

            if (!Array.isArray(attr4) && typeof attr4 !== 'number') {
                potentialIssues.push(`Attribute 4 (RelatedObjects) is not array/number: ${typeof attr4}`);
            }
            if (typeof attr5 !== 'number') {
                potentialIssues.push(`Attribute 5 (RelatingPropertyDefinition) is not number: ${typeof attr5}`);
            }
        }
    }

    const result: DebugResult = {
        totalEntities: parseResult.entityCount,
        relationshipCounts,
        sampleRelDefinesByProperties: relDefinesByProperties.slice(0, 5),
        samplePropertySets: propertySets.slice(0, 5),
        analysis: {
            relDefinesByPropertiesFound: relDefinesByProperties.length,
            propertySetsFound: propertySets.length,
            potentialIssues,
        },
    };

    return result;
}

function printResults(result: DebugResult) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 DEBUG RESULTS');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Total entities: ${result.totalEntities.toLocaleString()}\n`);

    console.log('📊 Relationship Type Counts:');
    console.log('───────────────────────────────────────────────────────────');
    const sortedRels = Array.from(result.relationshipCounts.entries())
        .sort((a, b) => b[1] - a[1]);

    for (const [type, count] of sortedRels) {
        const marker = type === 'IFCRELDEFINESBYPROPERTIES' ? ' ⭐' : '';
        console.log(`  ${type.padEnd(40)} ${count.toLocaleString().padStart(8)}${marker}`);
    }
    console.log();

    console.log('🔗 Sample IfcRelDefinesByProperties (first 5):');
    console.log('───────────────────────────────────────────────────────────');
    if (result.sampleRelDefinesByProperties.length === 0) {
        console.log('  ❌ NONE FOUND!\n');
    } else {
        for (const rel of result.sampleRelDefinesByProperties) {
            console.log(`\n  Entity #${rel.expressId} (${rel.type})`);
            console.log(`    Attributes: ${rel.attributeCount}`);
            console.log(`    [0] GlobalId: ${rel.attributes[0]}`);
            console.log(`    [1] OwnerHistory: ${rel.attributes[1]}`);
            console.log(`    [2] Name: ${rel.attributes[2]}`);
            console.log(`    [3] Description: ${rel.attributes[3]}`);
            console.log(`    [4] RelatedObjects: ${JSON.stringify(rel.attributes[4])?.substring(0, 100)}`);
            console.log(`    [5] RelatingPropertyDefinition: ${rel.attributes[5]}`);
            if (rel.attributes.length > 6) {
                console.log(`    ... ${rel.attributes.length - 6} more attributes`);
            }
        }
        console.log();
    }

    console.log('📦 Sample Property Sets (first 5):');
    console.log('───────────────────────────────────────────────────────────');
    if (result.samplePropertySets.length === 0) {
        console.log('  ❌ NONE FOUND!\n');
    } else {
        for (const pset of result.samplePropertySets) {
            console.log(`\n  #${pset.expressId}: ${pset.name}`);
            console.log(`    Properties: ${pset.propertyCount}`);
            if (pset.sampleProperties.length > 0) {
                console.log(`    Sample: ${pset.sampleProperties.join(', ')}`);
            }
        }
        console.log();
    }

    console.log('🔍 Analysis:');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`  IfcRelDefinesByProperties found: ${result.analysis.relDefinesByPropertiesFound}`);
    console.log(`  Property sets found: ${result.analysis.propertySetsFound}`);

    if (result.analysis.potentialIssues.length > 0) {
        console.log('\n  ⚠️  Potential Issues:');
        for (const issue of result.analysis.potentialIssues) {
            console.log(`    • ${issue}`);
        }
    } else {
        console.log('\n  ✓ No obvious issues detected');
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');
}

// Main execution
async function main() {
    const filePath = process.argv[2] || join(__dirname, '../../01_Snowdon_Towers_Sample_Structural(1).ifc');

    try {
        const result = await debugProperties(filePath);
        printResults(result);
    } catch (error) {
        console.error('❌ Error:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
        process.exit(1);
    }
}

// Run if executed directly
main().catch(console.error);
