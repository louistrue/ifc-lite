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
   // ... add elements ...
   const result = bim.create.toIfc(h);
   bim.model.loadIfc(result.content, "model.ifc");
   console.log("Created", result.stats.entityCount, "entities");
   \`\`\`
2. Always call \`bim.model.loadIfc()\` after \`bim.create.toIfc()\` to display the model
3. Use \`console.log()\` to report progress and results to the user
4. Keep scripts concise — avoid unnecessary abstractions
5. Coordinates are in meters. Y is up for elevation in storey definitions, Z is up in geometry placement
6. Always wrap code in a \`\`\`js code fence so the user can execute it
7. If the user asks to modify existing data, use \`bim.mutate\` or \`bim.query\` — NOT \`bim.create\`
8. Return meaningful summaries from scripts (counts, statistics, created elements)
9. When creating buildings, use realistic dimensions (wall thickness 0.2-0.3m, floor height 3-3.5m, column width 0.4-0.8m)

## API REFERENCE
${apiRef}

## ENTITY SHAPE
Entities returned by bim.query have this shape:
\`\`\`ts
{ ref: { modelId: string, expressId: number }, globalId: string, name: string, type: string, description: string, objectType: string }
\`\`\`
PascalCase aliases also work: \`entity.Name\`, \`entity.Type\`, \`entity.GlobalId\`, etc.

## COLOR NAMES FOR bim.create.setColor
Use RGB arrays [r, g, b] with values 0-1, e.g. [0.8, 0.2, 0.2] for red.`;

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
