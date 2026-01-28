/**
 * Debug script to analyze wall and window relationships in AR.ifc
 *
 * Investigating:
 * - 12_xLsc_f3OgK3Ufdk0g8Q (inner wall layer not getting voids cut)
 * - 12_xLsc_f3OgK3Ufdk0ghJ (window frame part 1)
 * - 12_xLsc_f3OgK3Ufdk0jPo (window frame part 2)
 * - 12_xLsc_f3OgK3Ufdk0gRv (window from screenshot)
 *
 * Run with: npx tsx tests/debug-wall-window.ts
 */

import * as fs from 'fs';

// Path to AR.ifc - adjust if needed
const IFC_PATH = process.argv[2] || '/Users/louistrue/Development/ifc-lite/tests/models/local/AR.ifc';

// Target GlobalIds to investigate
const TARGET_GUIDS = [
  // Window panels that should be ONE object
  '12_xLsc_f3OgK3Ufdk0gRx',  // Glass panel 1
  '12_xLsc_f3OgK3Ufdk0gQT',  // Glass panel 2
  '12_xLsc_f3OgK3Ufdk0gRW',  // Glass panel 3
  '12_xLsc_f3OgK3Ufdk0gRu',  // Expected parent window
];

interface Entity {
  id: number;
  type: string;
  globalId?: string;
  name?: string;
  args: string;
}

interface Relationship {
  id: number;
  type: string;
  relatingId: number;
  relatedIds: number[];
}

function parseIfcArgs(args: string): string[] {
  // Simple argument parser that handles nested parentheses
  const result: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '(') {
      depth++;
      current += c;
    } else if (c === ')') {
      depth--;
      current += c;
    } else if (c === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
}

function parseRef(s: string): number | null {
  const m = s.match(/^#(\d+)$/);
  return m ? parseInt(m[1]) : null;
}

function parseRefList(s: string): number[] {
  // Parse something like "(#123,#456,#789)"
  const refs: number[] = [];
  const matches = s.matchAll(/#(\d+)/g);
  for (const m of matches) {
    refs.push(parseInt(m[1]));
  }
  return refs;
}

function parseIfc(content: string) {
  const entities = new Map<number, Entity>();
  const guidToId = new Map<string, number>();
  const relationships: Relationship[] = [];

  // Parse all entities
  const entityRegex = /^#(\d+)\s*=\s*(\w+)\s*\(([\s\S]*?)\)\s*;/gm;
  let match;

  while ((match = entityRegex.exec(content)) !== null) {
    const id = parseInt(match[1]);
    const type = match[2].toUpperCase();
    const argsStr = match[3];

    const entity: Entity = { id, type, args: argsStr };

    // Parse arguments
    const args = parseIfcArgs(argsStr);

    // Extract GlobalId if present (first argument, quoted string)
    if (args[0] && args[0].startsWith("'") && args[0].endsWith("'")) {
      entity.globalId = args[0].slice(1, -1);
      guidToId.set(entity.globalId, id);
    }

    // Extract Name (3rd argument for most elements)
    if (args[2] && args[2].startsWith("'") && args[2].endsWith("'")) {
      entity.name = args[2].slice(1, -1);
    }

    entities.set(id, entity);

    // Parse relationships
    // IfcRelAggregates: GlobalId, OwnerHistory, Name, Description, RelatingObject, RelatedObjects
    // Indices:          0         1             2     3            4               5
    if (type === 'IFCRELAGGREGATES' || type === 'IFCRELNESTS') {
      const relatingId = parseRef(args[4]);
      const relatedIds = parseRefList(args[5]);

      if (relatingId !== null && relatedIds.length > 0) {
        relationships.push({ id, type, relatingId, relatedIds });
      }
    }
    // IfcRelVoidsElement: GlobalId, OwnerHistory, Name, Description, RelatingBuildingElement, RelatedOpeningElement
    else if (type === 'IFCRELVOIDSELEMENT') {
      const relatingId = parseRef(args[4]);
      const relatedId = parseRef(args[5]);

      if (relatingId !== null && relatedId !== null) {
        relationships.push({ id, type, relatingId, relatedIds: [relatedId] });
      }
    }
    // IfcRelFillsElement: GlobalId, OwnerHistory, Name, Description, RelatingOpeningElement, RelatedBuildingElement
    else if (type === 'IFCRELFILLSELEMENT') {
      const relatingId = parseRef(args[4]);
      const relatedId = parseRef(args[5]);

      if (relatingId !== null && relatedId !== null) {
        relationships.push({ id, type, relatingId, relatedIds: [relatedId] });
      }
    }
  }

  return { entities, guidToId, relationships };
}

function main() {
  console.log('='.repeat(80));
  console.log('DEBUG: Wall and Window Relationship Analysis');
  console.log('='.repeat(80));

  if (!fs.existsSync(IFC_PATH)) {
    console.error(`ERROR: IFC file not found: ${IFC_PATH}`);
    console.log('Usage: npx tsx tests/debug-wall-window.ts <path-to-ifc>');
    process.exit(1);
  }

  console.log(`\nLoading: ${IFC_PATH}`);
  const content = fs.readFileSync(IFC_PATH, 'utf-8');
  console.log(`File size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);

  const { entities, guidToId, relationships } = parseIfc(content);
  console.log(`Parsed ${entities.size} entities`);
  console.log(`Found ${relationships.length} relationships`);

  // Count relationship types
  const relCounts = new Map<string, number>();
  for (const rel of relationships) {
    relCounts.set(rel.type, (relCounts.get(rel.type) || 0) + 1);
  }
  console.log('\nRelationship counts:');
  for (const [type, count] of relCounts) {
    console.log(`  ${type}: ${count}`);
  }

  // Analyze target entities
  console.log('\n' + '='.repeat(80));
  console.log('TARGET ENTITY ANALYSIS');
  console.log('='.repeat(80));

  for (const guid of TARGET_GUIDS) {
    const entityId = guidToId.get(guid);
    if (!entityId) {
      console.log(`\n❌ GlobalId "${guid}" NOT FOUND in file`);
      continue;
    }

    const entity = entities.get(entityId);
    if (!entity) continue;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 #${entityId} = ${entity.type}`);
    console.log(`   GlobalId: ${guid}`);
    console.log(`   Name: ${entity.name || '(none)'}`);

    // Find relationships involving this entity
    console.log('\n   Relationships:');

    // As relating (parent)
    const asRelating = relationships.filter(r => r.relatingId === entityId);
    if (asRelating.length > 0) {
      console.log('   As PARENT (RelatingObject):');
      for (const rel of asRelating) {
        const children = rel.relatedIds.map(id => {
          const e = entities.get(id);
          return `#${id} (${e?.type || '?'}, ${e?.globalId || ''})`;
        });
        console.log(`     ${rel.type} → [${children.join(', ')}]`);
      }
    }

    // As related (child)
    const asRelated = relationships.filter(r => r.relatedIds.includes(entityId));
    if (asRelated.length > 0) {
      console.log('   As CHILD (RelatedObject):');
      for (const rel of asRelated) {
        const parent = entities.get(rel.relatingId);
        console.log(`     ${rel.type} ← #${rel.relatingId} (${parent?.type || '?'}, ${parent?.globalId || ''})`);
      }
    }

    // For walls: check if has voids
    if (entity.type.includes('WALL')) {
      const voids = relationships.filter(r =>
        r.type === 'IFCRELVOIDSELEMENT' && r.relatingId === entityId
      );
      if (voids.length > 0) {
        console.log(`   VOIDS (direct): ${voids.length}`);
        for (const v of voids) {
          for (const openingId of v.relatedIds) {
            const opening = entities.get(openingId);
            console.log(`     Opening #${openingId} (${opening?.type || '?'})`);

            // Check what fills this opening
            const fills = relationships.filter(r =>
              r.type === 'IFCRELFILLSELEMENT' && r.relatingId === openingId
            );
            for (const fill of fills) {
              for (const fillId of fill.relatedIds) {
                const filler = entities.get(fillId);
                console.log(`       → Filled by #${fillId} (${filler?.type}, ${filler?.globalId})`);
              }
            }
          }
        }
      } else {
        console.log('   VOIDS (direct): NONE');

        // Check if parent has voids
        const aggregateParents = relationships.filter(r =>
          r.type === 'IFCRELAGGREGATES' && r.relatedIds.includes(entityId)
        );
        if (aggregateParents.length > 0) {
          for (const agg of aggregateParents) {
            const parentVoids = relationships.filter(r =>
              r.type === 'IFCRELVOIDSELEMENT' && r.relatingId === agg.relatingId
            );
            const parent = entities.get(agg.relatingId);
            console.log(`   AGGREGATE PARENT: #${agg.relatingId} (${parent?.type}, ${parent?.globalId})`);
            if (parentVoids.length > 0) {
              console.log(`   VOIDS (via parent): ${parentVoids.length}`);
              for (const v of parentVoids) {
                for (const openingId of v.relatedIds) {
                  const opening = entities.get(openingId);
                  console.log(`     Opening #${openingId} (${opening?.type || '?'})`);
                }
              }
            } else {
              console.log(`   VOIDS (via parent): NONE`);
            }
          }
        } else {
          console.log('   NO AGGREGATE PARENT');
        }
      }
    }

    // For windows/doors: check what opening it fills
    if (entity.type.includes('WINDOW') || entity.type.includes('DOOR')) {
      const fills = relationships.filter(r =>
        r.type === 'IFCRELFILLSELEMENT' && r.relatedIds.includes(entityId)
      );
      if (fills.length > 0) {
        console.log('   FILLS OPENING:');
        for (const fill of fills) {
          const opening = entities.get(fill.relatingId);
          console.log(`     Opening #${fill.relatingId} (${opening?.type || '?'})`);

          // What wall does this opening belong to?
          const voids = relationships.filter(r =>
            r.type === 'IFCRELVOIDSELEMENT' && r.relatedIds.includes(fill.relatingId)
          );
          for (const v of voids) {
            const wall = entities.get(v.relatingId);
            console.log(`       → In wall #${v.relatingId} (${wall?.type}, ${wall?.globalId})`);
          }
        }
      } else {
        console.log('   FILLS OPENING: NONE (no IfcRelFillsElement)');
      }

      // Check if window has child parts (aggregates)
      const childParts = relationships.filter(r =>
        (r.type === 'IFCRELAGGREGATES' || r.type === 'IFCRELNESTS') && r.relatingId === entityId
      );
      if (childParts.length > 0) {
        console.log('   CHILD PARTS:');
        for (const agg of childParts) {
          for (const childId of agg.relatedIds) {
            const child = entities.get(childId);
            console.log(`     #${childId} (${child?.type}, ${child?.globalId})`);
          }
        }
      }

      // Check if window IS a child part
      const parentParts = relationships.filter(r =>
        (r.type === 'IFCRELAGGREGATES' || r.type === 'IFCRELNESTS') && r.relatedIds.includes(entityId)
      );
      if (parentParts.length > 0) {
        console.log('   IS CHILD OF:');
        for (const agg of parentParts) {
          const parent = entities.get(agg.relatingId);
          console.log(`     #${agg.relatingId} (${parent?.type}, ${parent?.globalId}) via ${agg.type}`);

          // Show siblings
          const siblings = agg.relatedIds.filter(id => id !== entityId);
          if (siblings.length > 0) {
            console.log(`     SIBLINGS:`);
            for (const sibId of siblings) {
              const sib = entities.get(sibId);
              console.log(`       #${sibId} (${sib?.type}, ${sib?.globalId})`);
            }
          }
        }
      }
    }
  }

  // Find all walls and their aggregate relationships
  console.log('\n' + '='.repeat(80));
  console.log('WALL AGGREGATE ANALYSIS');
  console.log('='.repeat(80));

  const wallAggregates = relationships.filter(r => {
    if (r.type !== 'IFCRELAGGREGATES') return false;
    const parent = entities.get(r.relatingId);
    return parent?.type.includes('WALL');
  });

  console.log(`\nFound ${wallAggregates.length} wall aggregate relationships`);

  for (const agg of wallAggregates.slice(0, 5)) { // Show first 5
    const parent = entities.get(agg.relatingId);
    console.log(`\n  Parent: #${agg.relatingId} (${parent?.type}, ${parent?.globalId})`);

    // Check if parent has voids
    const parentVoids = relationships.filter(r =>
      r.type === 'IFCRELVOIDSELEMENT' && r.relatingId === agg.relatingId
    );
    console.log(`    Has ${parentVoids.length} voids`);

    console.log(`    Children (${agg.relatedIds.length}):`);
    for (const childId of agg.relatedIds) {
      const child = entities.get(childId);
      const childVoids = relationships.filter(r =>
        r.type === 'IFCRELVOIDSELEMENT' && r.relatingId === childId
      );
      console.log(`      #${childId} (${child?.type}, ${child?.globalId}) - ${childVoids.length} direct voids`);
    }
  }

  // Find windows with aggregates
  console.log('\n' + '='.repeat(80));
  console.log('WINDOW/DOOR AGGREGATE ANALYSIS');
  console.log('='.repeat(80));

  const windowAggregates = relationships.filter(r => {
    if (r.type !== 'IFCRELAGGREGATES') return false;
    const parent = entities.get(r.relatingId);
    return parent?.type.includes('WINDOW') || parent?.type.includes('DOOR');
  });

  console.log(`\nFound ${windowAggregates.length} window/door aggregate relationships`);

  for (const agg of windowAggregates.slice(0, 5)) {
    const parent = entities.get(agg.relatingId);
    console.log(`\n  Parent: #${agg.relatingId} (${parent?.type}, ${parent?.globalId})`);
    console.log(`    Children (${agg.relatedIds.length}):`);
    for (const childId of agg.relatedIds) {
      const child = entities.get(childId);
      console.log(`      #${childId} (${child?.type}, ${child?.globalId})`);
    }
  }

  // Find windows with nests
  const windowNests = relationships.filter(r => {
    if (r.type !== 'IFCRELNESTS') return false;
    const parent = entities.get(r.relatingId);
    return parent?.type.includes('WINDOW') || parent?.type.includes('DOOR');
  });

  console.log(`\nFound ${windowNests.length} window/door NESTS relationships`);

  for (const nest of windowNests.slice(0, 5)) {
    const parent = entities.get(nest.relatingId);
    console.log(`\n  Parent: #${nest.relatingId} (${parent?.type}, ${parent?.globalId})`);
    console.log(`    Children (${nest.relatedIds.length}):`);
    for (const childId of nest.relatedIds) {
      const child = entities.get(childId);
      console.log(`      #${childId} (${child?.type}, ${child?.globalId})`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main();
