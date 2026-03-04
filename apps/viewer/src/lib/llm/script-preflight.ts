/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NAMESPACE_SCHEMAS } from '@ifc-lite/sandbox/schema';

const REQUIRED_CREATE_KEYS: Record<string, string[]> = {
  addIfcBuildingStorey: ['Elevation'],
  addIfcWall: ['Start', 'End', 'Thickness', 'Height'],
  addIfcSlab: ['Position', 'Thickness'],
  addIfcColumn: ['Position', 'Width', 'Depth', 'Height'],
};

const SUSPICIOUS_BARE_IDENTIFIERS = new Set([
  'Position', 'Start', 'End', 'Width', 'Depth', 'Height', 'Thickness',
]);

function nearestMethodName(method: string, options: string[]): string | null {
  const lower = method.toLowerCase();
  const hit = options.find((m) => m.toLowerCase() === lower);
  if (hit) return hit;
  const close = options.find((m) => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
  return close ?? null;
}

function validateKnownBimMethods(code: string): string[] {
  const errors: string[] = [];
  const byNamespace = new Map<string, Set<string>>();
  for (const schema of NAMESPACE_SCHEMAS) {
    byNamespace.set(schema.name, new Set(schema.methods.map((m) => m.name)));
  }

  const regex = /\bbim\.(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(code)) !== null) {
    const namespace = m[1];
    const method = m[2];
    const knownMethods = byNamespace.get(namespace);
    if (!knownMethods) {
      errors.push(`Unknown namespace \`bim.${namespace}\`.`);
      continue;
    }
    if (!knownMethods.has(method)) {
      const suggestion = nearestMethodName(method, Array.from(knownMethods));
      errors.push(
        suggestion
          ? `Unknown method \`bim.${namespace}.${method}()\`. Did you mean \`bim.${namespace}.${suggestion}()\`?`
          : `Unknown method \`bim.${namespace}.${method}()\`.`,
      );
    }
  }

  return errors;
}

function extractObjectArgBodies(code: string, methodName: string): string[] {
  const objectBodies: string[] = [];
  const regex = new RegExp(String.raw`\bbim\.create\.${methodName}\s*\(([\s\S]*?)\)\s*`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const call = match[1];
    const openIdx = call.lastIndexOf('{');
    const closeIdx = call.lastIndexOf('}');
    if (openIdx >= 0 && closeIdx > openIdx) {
      objectBodies.push(call.slice(openIdx + 1, closeIdx));
    }
  }
  return objectBodies;
}

function validateRequiredCreateKeys(code: string): string[] {
  const errors: string[] = [];
  for (const [methodName, requiredKeys] of Object.entries(REQUIRED_CREATE_KEYS)) {
    const objects = extractObjectArgBodies(code, methodName);
    for (const objectBody of objects) {
      const missing = requiredKeys.filter((key) => !new RegExp(String.raw`\b${key}\s*:`, 'm').test(objectBody));
      if (missing.length > 0) {
        errors.push(
          `\`bim.create.${methodName}(...)\` is missing required key(s): ${missing.map((k) => `\`${k}\``).join(', ')}.`,
        );
      }
    }
  }
  return errors;
}

function validateBareIdentifierTraps(code: string): string[] {
  const errors: string[] = [];
  const createCalls = /\bbim\.create\.\w+\s*\(([\s\S]*?)\)\s*/g;
  let match: RegExpExecArray | null;
  while ((match = createCalls.exec(code)) !== null) {
    const call = match[1];
    const objectStart = call.lastIndexOf('{');
    const objectEnd = call.lastIndexOf('}');
    if (objectStart < 0 || objectEnd <= objectStart) continue;
    const objectBody = call.slice(objectStart + 1, objectEnd);

    const valueRegex = /:\s*([A-Za-z_]\w*)\s*(?=,|$)/g;
    let valueMatch: RegExpExecArray | null;
    while ((valueMatch = valueRegex.exec(objectBody)) !== null) {
      const ident = valueMatch[1];
      if (SUSPICIOUS_BARE_IDENTIFIERS.has(ident)) {
        errors.push(
          `Suspicious bare identifier value \`${ident}\` in BIM parameter object. Use a literal/array (e.g. \`${ident}: [..]\` or \`${ident}: 1\`) or declare the variable explicitly.`,
        );
      }
    }
  }
  return errors;
}

export function validateScriptPreflight(code: string): string[] {
  return [
    ...validateKnownBimMethods(code),
    ...validateRequiredCreateKeys(code),
    ...validateBareIdentifierTraps(code),
  ];
}
