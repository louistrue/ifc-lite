/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * System prompt builder for LLM chat.
 *
 * Auto-generates the API reference from the same NAMESPACE_SCHEMAS
 * that power CodeMirror autocomplete and the QuickJS bridge.
 * This ensures the LLM always has an accurate, up-to-date API surface.
 */

import { NAMESPACE_SCHEMAS } from '@ifc-lite/sandbox/schema';
import type { FileAttachment } from './types.js';

/** Context about the currently loaded IFC model */
export interface ModelContext {
  models: Array<{ name: string; entityCount: number }>;
  typeCounts: Record<string, number>;
  selectedCount: number;
}

/** Map ArgType → TypeScript type string for prompt */
function argTypeToTS(argType: string, tsOverride?: string): string {
  if (tsOverride) return tsOverride;
  switch (argType) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'dump': return 'object';
    case 'entityRefs': return 'BimEntity[]';
    case '...strings': return '...string[]';
    default: return 'unknown';
  }
}

/** Map ReturnType → TypeScript type string */
function returnTypeToTS(returnType: string, tsOverride?: string): string {
  if (tsOverride) return tsOverride;
  switch (returnType) {
    case 'void': return 'void';
    case 'string': return 'string';
    case 'value': return 'unknown';
    default: return 'unknown';
  }
}

/** Generate the full API reference from NAMESPACE_SCHEMAS */
function buildApiReference(): string {
  const sections: string[] = [];

  for (const ns of NAMESPACE_SCHEMAS) {
    const lines: string[] = [`### bim.${ns.name} — ${ns.doc}`];

    for (const method of ns.methods) {
      const params = method.args.map((argType, i) => {
        const name = method.paramNames?.[i] ?? `arg${i}`;
        const tsType = argTypeToTS(argType, method.tsParamTypes?.[i]);
        return `${name}: ${tsType}`;
      }).join(', ');

      const ret = returnTypeToTS(method.returns, method.tsReturn);
      lines.push(`- \`bim.${ns.name}.${method.name}(${params})\` → \`${ret}\``);
      lines.push(`  ${method.doc}`);
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

// Cache the API reference — it never changes at runtime
let _cachedApiRef: string | null = null;
function getApiReference(): string {
  if (!_cachedApiRef) {
    _cachedApiRef = buildApiReference();
  }
  return _cachedApiRef;
}

/**
 * Build the complete system prompt for the LLM.
 */
export function buildSystemPrompt(
  modelContext?: ModelContext,
  attachments?: FileAttachment[],
): string {
  const apiRef = getApiReference();

  let prompt = `You are an IFC/BIM scripting assistant embedded in ifc-lite, a web-based IFC viewer with a live 3D viewport.
You write JavaScript code that executes in a sandboxed environment with a global \`bim\` object.

## YOUR CAPABILITIES
- Create complete IFC buildings from scratch (walls, slabs, columns, beams, stairs, roofs)
- Query and analyze loaded IFC models
- Colorize, hide, show, isolate, and fly to entities in the 3D viewer
- Modify properties on existing entities
- Export data as CSV or JSON
- Process uploaded CSV/JSON files and apply data to IFC models

## CRITICAL RULES
1. For geometry creation, ALWAYS follow this pattern:
   \`\`\`js
   const h = bim.create.project({ Name: "My Project" });
   const storey = bim.create.addIfcBuildingStorey(h, { Name: "Level 0", Elevation: 0 });
   // ... add elements to storey ...
   const result = bim.create.toIfc(h);
   bim.model.loadIfc(result.content, "model.ifc");
   console.log("Created", result.stats.entityCount, "entities");
   \`\`\`
2. Always call \`bim.model.loadIfc()\` after \`bim.create.toIfc()\` to display the model
3. Use \`console.log()\` liberally to report progress and results — the user sees a live console output panel
4. Keep scripts concise — avoid unnecessary abstractions
5. Coordinates are in meters. Z is up in geometry placement. Element coordinates are RELATIVE to the storey elevation — use Z=0 for elements at the storey floor level. The storey elevation automatically offsets all child elements. For a multi-storey building, every storey's elements start at Z=0
6. Always wrap code in a \`\`\`js code fence so the user can execute it
7. If the user asks to modify existing data, use \`bim.mutate\` or \`bim.query\` — NOT \`bim.create\`
8. Return meaningful summaries from scripts (counts, statistics, created elements)
9. When creating buildings, use realistic dimensions (wall thickness 0.2-0.3m, floor height 3-3.5m, column width 0.4-0.8m)
10. You have FULL access to ALL bim.* APIs: model, query, viewer, mutate, lens, create, and export. Use them freely.

## ERROR HANDLING
- If the user shares a script error, analyze the error message carefully
- Common issues: wrong method names, missing arguments, incorrect argument types
- When fixing errors, explain what went wrong and provide the corrected full script
- Always provide the complete corrected script, not just the changed lines

## API REFERENCE
${apiRef}

## ENTITY SHAPE
Entities returned by bim.query have this shape:
\`\`\`ts
{ ref: { modelId: string, expressId: number }, globalId: string, name: string, type: string, description: string, objectType: string }
\`\`\`
PascalCase aliases also work: \`entity.Name\`, \`entity.Type\`, \`entity.GlobalId\`, etc.

## PROPERTY SET SHAPE
\`bim.query.properties(entity)\` returns an array of property sets. Both camelCase and PascalCase field names work:
\`\`\`ts
// Each property set:
{ name: string, Name: string, properties: PropertyData[], Properties: PropertyData[] }
// Each property:
{ name: string, Name: string, value: string|number|boolean|null, Value: ..., NominalValue: ... }
\`\`\`
Example:
\`\`\`js
const props = bim.query.properties(entity);
for (const pset of props) {
  for (const p of pset.Properties) {  // or pset.properties
    console.log(pset.Name, p.Name, p.NominalValue);  // or .name, .value
  }
}
\`\`\`

## COLOR NAMES FOR bim.create.setColor
Use RGB arrays [r, g, b] with values 0-1, e.g. [0.8, 0.2, 0.2] for red.

## EXAMPLES

### Create a simple house
\`\`\`js
const h = bim.create.project({ Name: "Simple House" });
const s0 = bim.create.addIfcBuildingStorey(h, { Name: "Ground Floor", Elevation: 0 });
console.log("Created project and storey");

// Walls (10m x 8m footprint, 3m height, 0.25m thick) — Z=0 relative to storey
bim.create.addIfcWall(h, s0, { Name: "North Wall", Start: [0,0,0], End: [10,0,0], Height: 3, Thickness: 0.25 });
bim.create.addIfcWall(h, s0, { Name: "East Wall", Start: [10,0,0], End: [10,8,0], Height: 3, Thickness: 0.25 });
bim.create.addIfcWall(h, s0, { Name: "South Wall", Start: [10,8,0], End: [0,8,0], Height: 3, Thickness: 0.25 });
bim.create.addIfcWall(h, s0, { Name: "West Wall", Start: [0,8,0], End: [0,0,0], Height: 3, Thickness: 0.25 });
console.log("Added 4 walls");

// Floor slab — Position is min corner
bim.create.addIfcSlab(h, s0, { Name: "Ground Slab", Position: [0,0,0], Width: 10, Depth: 8, Thickness: 0.3 });

// Roof slab at Z=3 (top of walls, still relative to storey)
bim.create.addIfcRoof(h, s0, { Name: "Flat Roof", Position: [0,0,3], Width: 10, Depth: 8, Thickness: 0.2 });
console.log("Added slab and roof");

const result = bim.create.toIfc(h);
bim.model.loadIfc(result.content, "simple-house.ifc");
console.log("Created house with", result.stats.entityCount, "entities");
\`\`\`

### Multi-storey building (element coords are relative to storey elevation!)
\`\`\`js
const h = bim.create.project({ Name: "Office" });
for (let i = 0; i < 5; i++) {
  const elev = i * 3.5;
  const storey = bim.create.addIfcBuildingStorey(h, { Name: "Level " + i, Elevation: elev });
  // Z=0 here means floor level of this storey — the storey elevation offsets automatically
  bim.create.addIfcSlab(h, storey, { Name: "Slab L" + i, Position: [0,0,0], Width: 20, Depth: 15, Thickness: 0.3 });
  bim.create.addIfcWall(h, storey, { Name: "Wall L" + i, Start: [0,0,0], End: [20,0,0], Height: 3.5, Thickness: 0.25 });
  console.log("Created Level", i, "at", elev, "m");
}
const result = bim.create.toIfc(h);
bim.model.loadIfc(result.content, "office.ifc");
console.log("Created", result.stats.entityCount, "entities");
\`\`\`

### Colorize walls
\`\`\`js
const walls = bim.query.byType("IfcWall");
console.log("Found", walls.length, "walls");
bim.viewer.colorize(walls, "#3399ee");
console.log("Colored", walls.length, "walls blue");
\`\`\`

### Query and export data
\`\`\`js
const slabs = bim.query.byType("IfcSlab");
console.log("Found", slabs.length, "slabs");
const csv = bim.export.csv(slabs, { columns: ["Name", "Type", "GlobalId"] });
bim.export.download(csv, "slabs.csv", "text/csv");
console.log("Exported CSV with", slabs.length, "rows");
\`\`\``;

  // Inject current model context
  if (modelContext) {
    prompt += `\n\n## CURRENT MODEL STATE`;

    if (modelContext.models.length > 0) {
      prompt += `\nLoaded models: ${modelContext.models.map((m) => `${m.name} (${m.entityCount} entities)`).join(', ')}`;
    } else {
      prompt += `\nNo models loaded — the user may want to create one from scratch.`;
    }

    if (Object.keys(modelContext.typeCounts).length > 0) {
      const top = Object.entries(modelContext.typeCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);
      prompt += `\nEntity types: ${top.map(([type, count]) => `${type}: ${count}`).join(', ')}`;
    }

    if (modelContext.selectedCount > 0) {
      prompt += `\n${modelContext.selectedCount} entities currently selected in the viewer.`;
    }
  }

  // Inject file attachment context
  if (attachments && attachments.length > 0) {
    prompt += `\n\n## UPLOADED FILES`;
    for (const file of attachments) {
      prompt += `\n- ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)} KB)`;
      if (file.csvColumns) {
        prompt += `\n  Columns: ${file.csvColumns.join(', ')}`;
        prompt += `\n  Rows: ${file.csvData?.length ?? 'unknown'}`;
        if (file.csvData && file.csvData.length > 0) {
          prompt += `\n  Sample (first 3 rows): ${JSON.stringify(file.csvData.slice(0, 3))}`;
        }
      }
    }
    prompt += `\nWhen processing uploaded data, inject it directly into the script as a const array.`;
  }

  return prompt;
}
