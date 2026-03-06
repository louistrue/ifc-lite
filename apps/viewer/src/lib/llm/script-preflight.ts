/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NAMESPACE_SCHEMAS } from '@ifc-lite/sandbox/schema';

interface MethodRule {
  required: string[];
  anyOf?: string[][];
  positiveKeys?: string[];
  pointArity?: Record<string, number>;
  axisPair?: [string, string];
  forbidKeys?: Array<{ key: string; message: string }>;
  custom?: (body: string) => string[];
}

const METHOD_RULES: Record<string, MethodRule> = {
  addIfcBuildingStorey: {
    required: ['Elevation'],
  },
  addIfcWall: {
    required: ['Start', 'End', 'Thickness', 'Height'],
    positiveKeys: ['Thickness', 'Height'],
    pointArity: { Start: 3, End: 3 },
    axisPair: ['Start', 'End'],
  },
  addIfcSlab: {
    required: ['Position', 'Thickness'],
    anyOf: [['Profile'], ['Width', 'Depth']],
    positiveKeys: ['Thickness', 'Width', 'Depth'],
    pointArity: { Position: 3 },
    custom: validateSlabShape,
  },
  addIfcColumn: {
    required: ['Position', 'Width', 'Depth', 'Height'],
    positiveKeys: ['Width', 'Depth', 'Height'],
    pointArity: { Position: 3 },
  },
  addIfcBeam: {
    required: ['Start', 'End', 'Width', 'Height'],
    positiveKeys: ['Width', 'Height'],
    pointArity: { Start: 3, End: 3 },
    axisPair: ['Start', 'End'],
  },
  addIfcMember: {
    required: ['Start', 'End', 'Width', 'Height'],
    positiveKeys: ['Width', 'Height'],
    pointArity: { Start: 3, End: 3 },
    axisPair: ['Start', 'End'],
  },
  addIfcCurtainWall: {
    required: ['Start', 'End', 'Height'],
    positiveKeys: ['Height', 'Thickness'],
    pointArity: { Start: 3, End: 3 },
    axisPair: ['Start', 'End'],
  },
  addIfcRailing: {
    required: ['Start', 'End', 'Height'],
    positiveKeys: ['Height', 'Width'],
    pointArity: { Start: 3, End: 3 },
    axisPair: ['Start', 'End'],
  },
  addIfcStair: {
    required: ['Position', 'NumberOfRisers', 'RiserHeight', 'TreadLength', 'Width'],
    positiveKeys: ['NumberOfRisers', 'RiserHeight', 'TreadLength', 'Width'],
    pointArity: { Position: 3 },
  },
  addIfcRoof: {
    required: ['Position', 'Width', 'Depth', 'Thickness'],
    positiveKeys: ['Width', 'Depth', 'Thickness', 'Slope'],
    pointArity: { Position: 3 },
    forbidKeys: [
      { key: 'Profile', message: '`bim.create.addIfcRoof(...)` does not support `Profile`. Use `Position`, `Width`, `Depth`, `Thickness`, and optional `Slope`.' },
      { key: 'ExtrusionHeight', message: '`bim.create.addIfcRoof(...)` uses `Depth`, not `ExtrusionHeight`.' },
      { key: 'Height', message: '`bim.create.addIfcRoof(...)` uses `Thickness` and `Depth`, not `Height`.' },
      { key: 'Overhang', message: '`bim.create.addIfcRoof(...)` does not support `Overhang`. Use `addIfcGableRoof(...)` for a house-style roof with pitch and overhang.' },
    ],
    custom: (body) => validateRoofShape('addIfcRoof', body),
  },
  addIfcGableRoof: {
    required: ['Position', 'Width', 'Depth', 'Thickness', 'Slope'],
    positiveKeys: ['Width', 'Depth', 'Thickness', 'Slope'],
    pointArity: { Position: 3 },
    forbidKeys: [
      { key: 'Profile', message: '`bim.create.addIfcGableRoof(...)` does not support `Profile`. Use `Position`, `Width`, `Depth`, `Thickness`, `Slope`, and optional `Overhang`.' },
      { key: 'ExtrusionHeight', message: '`bim.create.addIfcGableRoof(...)` uses `Thickness`, not `ExtrusionHeight`.' },
      { key: 'Height', message: '`bim.create.addIfcGableRoof(...)` uses `Thickness` for roof thickness and derives ridge height from `Slope`.' },
    ],
    custom: (body) => validateRoofShape('addIfcGableRoof', body),
  },
  addIfcWallDoor: {
    required: ['Position', 'Width', 'Height'],
    positiveKeys: ['Width', 'Height', 'Thickness'],
    pointArity: { Position: 3 },
    forbidKeys: [
      { key: 'Start', message: '`bim.create.addIfcWallDoor(...)` uses wall-local `Position`, not `Start`/`End`.' },
      { key: 'End', message: '`bim.create.addIfcWallDoor(...)` uses wall-local `Position`, not `Start`/`End`.' },
      { key: 'Rotation', message: '`bim.create.addIfcWallDoor(...)` auto-aligns to the host wall. Do not pass `Rotation`.' },
      { key: 'Direction', message: '`bim.create.addIfcWallDoor(...)` auto-aligns to the host wall. Do not pass `Direction`.' },
      { key: 'Axis', message: '`bim.create.addIfcWallDoor(...)` auto-aligns to the host wall. Do not pass `Axis`.' },
      { key: 'RefDirection', message: '`bim.create.addIfcWallDoor(...)` auto-aligns to the host wall. Do not pass `RefDirection`.' },
      { key: 'Placement', message: '`bim.create.addIfcWallDoor(...)` uses wall-local `Position`, not `Placement`.' },
    ],
  },
  addIfcWallWindow: {
    required: ['Position', 'Width', 'Height'],
    positiveKeys: ['Width', 'Height', 'Thickness'],
    pointArity: { Position: 3 },
    forbidKeys: [
      { key: 'Start', message: '`bim.create.addIfcWallWindow(...)` uses wall-local `Position`, not `Start`/`End`.' },
      { key: 'End', message: '`bim.create.addIfcWallWindow(...)` uses wall-local `Position`, not `Start`/`End`.' },
      { key: 'Rotation', message: '`bim.create.addIfcWallWindow(...)` auto-aligns to the host wall. Do not pass `Rotation`.' },
      { key: 'Direction', message: '`bim.create.addIfcWallWindow(...)` auto-aligns to the host wall. Do not pass `Direction`.' },
      { key: 'Axis', message: '`bim.create.addIfcWallWindow(...)` auto-aligns to the host wall. Do not pass `Axis`.' },
      { key: 'RefDirection', message: '`bim.create.addIfcWallWindow(...)` auto-aligns to the host wall. Do not pass `RefDirection`.' },
      { key: 'Placement', message: '`bim.create.addIfcWallWindow(...)` uses wall-local `Position`, not `Placement`.' },
    ],
  },
  addIfcDoor: {
    required: ['Position', 'Width', 'Height'],
    positiveKeys: ['Width', 'Height', 'Thickness'],
    pointArity: { Position: 3 },
    forbidKeys: [
      { key: 'Start', message: '`bim.create.addIfcDoor(...)` uses `Position`, not `Start`/`End`.' },
      { key: 'End', message: '`bim.create.addIfcDoor(...)` uses `Position`, not `Start`/`End`.' },
      { key: 'Direction', message: '`bim.create.addIfcDoor(...)` does not support wall-axis rotation. It creates a world-aligned standalone door element.' },
      { key: 'Rotation', message: '`bim.create.addIfcDoor(...)` does not support rotation. For wall-hosted inserts, use `bim.create.addIfcWallDoor(...)` or wall `Openings`.' },
      { key: 'Axis', message: '`bim.create.addIfcDoor(...)` does not accept `Axis`. It is not a generic placement API.' },
      { key: 'RefDirection', message: '`bim.create.addIfcDoor(...)` does not accept `RefDirection`. It is not auto-aligned to wall direction.' },
      { key: 'Placement', message: '`bim.create.addIfcDoor(...)` uses `Position`, not `Placement`.' },
    ],
  },
  addIfcWindow: {
    required: ['Position', 'Width', 'Height'],
    positiveKeys: ['Width', 'Height', 'Thickness'],
    pointArity: { Position: 3 },
    forbidKeys: [
      { key: 'Start', message: '`bim.create.addIfcWindow(...)` uses `Position`, not `Start`/`End`.' },
      { key: 'End', message: '`bim.create.addIfcWindow(...)` uses `Position`, not `Start`/`End`.' },
      { key: 'Direction', message: '`bim.create.addIfcWindow(...)` does not support wall-axis rotation. It creates a world-aligned standalone window element.' },
      { key: 'Rotation', message: '`bim.create.addIfcWindow(...)` does not support rotation. For wall-hosted inserts, use `bim.create.addIfcWallWindow(...)` or wall `Openings`.' },
      { key: 'Axis', message: '`bim.create.addIfcWindow(...)` does not accept `Axis`. It is not a generic placement API.' },
      { key: 'RefDirection', message: '`bim.create.addIfcWindow(...)` does not accept `RefDirection`. It is not auto-aligned to wall direction.' },
      { key: 'Placement', message: '`bim.create.addIfcWindow(...)` uses `Position`, not `Placement`.' },
    ],
  },
  addElement: {
    required: ['IfcType', 'Placement', 'Profile', 'Depth'],
    positiveKeys: ['Depth'],
    custom: validateGenericElementShape,
  },
  addAxisElement: {
    required: ['IfcType', 'Start', 'End', 'Profile'],
    pointArity: { Start: 3, End: 3 },
    axisPair: ['Start', 'End'],
    custom: validateAxisElementShape,
  },
};

const SUSPICIOUS_BARE_IDENTIFIERS = new Set([
  'Position', 'Placement', 'Start', 'End', 'Width', 'Depth', 'Height', 'Thickness', 'Elevation', 'IfcType',
]);

function nearestMethodName(method: string, options: string[]): string | null {
  const lower = method.toLowerCase();
  const hit = options.find((m) => m.toLowerCase() === lower);
  if (hit) return hit;
  const close = options.find((m) => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
  return close ?? null;
}

function scanToMatching(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: '"' | '\'' | '`' | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelItems(text: string): string[] {
  const items: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote: '"' | '\'' | '`' | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;

    if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      if (current.trim()) items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function hasKey(body: string, key: string): boolean {
  return new RegExp(String.raw`\b${key}\s*:`, 'm').test(body);
}

function findPropertyValue(body: string, key: string): string | null {
  const match = new RegExp(String.raw`\b${key}\s*:\s*`, 'm').exec(body);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const trimmed = body.slice(start).trimStart();
  if (!trimmed) return null;
  const offset = body.slice(start).length - trimmed.length;
  const absolute = start + offset;
  const first = body[absolute];
  if (first === '[') {
    const end = scanToMatching(body, absolute, '[', ']');
    return end >= 0 ? body.slice(absolute, end + 1) : null;
  }
  if (first === '{') {
    const end = scanToMatching(body, absolute, '{', '}');
    return end >= 0 ? body.slice(absolute, end + 1) : null;
  }
  const rest = body.slice(absolute);
  const top = splitTopLevelItems(rest);
  return top[0] ?? null;
}

function getArrayLiteralArity(body: string, key: string): number | null {
  const value = findPropertyValue(body, key);
  if (!value || !value.startsWith('[')) return null;
  return splitTopLevelItems(value.slice(1, -1)).length;
}

function parseNumericPointLiteral(body: string, key: string): number[] | null {
  const value = findPropertyValue(body, key);
  if (!value || !value.startsWith('[')) return null;
  const parts = splitTopLevelItems(value.slice(1, -1));
  if (parts.length === 0) return null;
  const nums = parts.map((part) => Number(part.trim()));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

function getObjectBodiesForMethod(code: string, methodName: string): string[] {
  const marker = `bim.create.${methodName}(`;
  const bodies: string[] = [];
  let start = 0;
  while (true) {
    const idx = code.indexOf(marker, start);
    if (idx < 0) break;
    const openParen = idx + marker.length - 1;
    const closeParen = scanToMatching(code, openParen, '(', ')');
    if (closeParen < 0) break;
    const callBody = code.slice(openParen + 1, closeParen);
    let lastObject: string | null = null;
    for (let i = 0; i < callBody.length; i++) {
      if (callBody[i] !== '{') continue;
      const closeBrace = scanToMatching(callBody, i, '{', '}');
      if (closeBrace < 0) break;
      lastObject = callBody.slice(i + 1, closeBrace);
      i = closeBrace;
    }
    if (lastObject) bodies.push(lastObject);
    start = closeParen + 1;
  }
  return bodies;
}

function validateKnownBimMethods(code: string): string[] {
  const errors: string[] = [];
  const byNamespace = new Map<string, Set<string>>();
  for (const schema of NAMESPACE_SCHEMAS) {
    byNamespace.set(schema.name, new Set(schema.methods.map((m) => m.name)));
  }

  const regex = /\bbim\.(\w+)\.(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const namespace = match[1];
    const method = match[2];
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

function validatePositiveLiterals(body: string, methodName: string, keys: string[]): string[] {
  const errors: string[] = [];
  for (const key of keys) {
    const value = findPropertyValue(body, key);
    if (!value) continue;
    const n = Number(value.trim());
    if (!Number.isNaN(n) && n <= 0) {
      errors.push(`\`bim.create.${methodName}(...)\` requires \`${key}\` to be > 0.`);
    }
  }
  return errors;
}

function validatePointArities(body: string, methodName: string, pointArity: Record<string, number>): string[] {
  const errors: string[] = [];
  for (const [key, arity] of Object.entries(pointArity)) {
    const actual = getArrayLiteralArity(body, key);
    if (actual !== null && actual !== arity) {
      errors.push(`\`bim.create.${methodName}(...)\` expects \`${key}\` to be a ${arity}D point array.`);
    }
  }
  return errors;
}

function validateAxisPair(body: string, methodName: string, startKey: string, endKey: string): string[] {
  const start = parseNumericPointLiteral(body, startKey);
  const end = parseNumericPointLiteral(body, endKey);
  if (!start || !end) return [];
  if (start.length === end.length && start.every((value, index) => value === end[index])) {
    return [`\`bim.create.${methodName}(...)\` requires \`${startKey}\` and \`${endKey}\` to define a non-zero axis.`];
  }
  return [];
}

function validateAlternativeShapes(body: string, methodName: string, anyOf: string[][]): string[] {
  if (anyOf.some((group) => group.every((key) => hasKey(body, key)))) {
    return [];
  }
  return [
    `\`bim.create.${methodName}(...)\` requires one of: ${anyOf.map((group) => group.map((key) => `\`${key}\``).join(' + ')).join(' OR ')}.`,
  ];
}

function validateForbiddenKeys(body: string, forbidKeys: Array<{ key: string; message: string }>): string[] {
  return forbidKeys.filter(({ key }) => hasKey(body, key)).map(({ message }) => message);
}

function validateSlabShape(body: string): string[] {
  const errors: string[] = [];
  const profileValue = findPropertyValue(body, 'Profile');
  if (profileValue?.startsWith('{')) {
    errors.push('`bim.create.addIfcSlab(...)` expects `Profile` to be a 2D point array, not a generic profile object.');
  }
  return errors;
}

function validateRoofShape(methodName: 'addIfcRoof' | 'addIfcGableRoof', body: string): string[] {
  const errors: string[] = [];
  const slopeValue = findPropertyValue(body, 'Slope');
  if (slopeValue) {
    const slope = Number(slopeValue.trim());
    if (!Number.isNaN(slope) && slope >= Math.PI / 2) {
      errors.push(
        `\`bim.create.${methodName}(...)\` expects \`Slope\` in radians between 0 and π/2. If you meant degrees, convert them first (for example \`15 * Math.PI / 180\`).`,
      );
    }
  }

  const overhangValue = findPropertyValue(body, 'Overhang');
  if (overhangValue) {
    const overhang = Number(overhangValue.trim());
    if (!Number.isNaN(overhang) && overhang < 0) {
      errors.push(`\`bim.create.${methodName}(...)\` requires \`Overhang\` to be >= 0.`);
    }
  }

  if (methodName === 'addIfcRoof') {
    const nameValue = findPropertyValue(body, 'Name');
    if (nameValue && /gable/i.test(nameValue)) {
      errors.push('`bim.create.addIfcRoof(...)` is a flat/mono-pitch roof helper. Use `bim.create.addIfcGableRoof(...)` for standard dual-pitch or gable roofs.');
    }
  }

  return errors;
}

function validateGenericElementShape(body: string): string[] {
  const errors: string[] = [];
  if (hasKey(body, 'Type')) {
    errors.push('`bim.create.addElement(...)` uses `IfcType`, not `Type`.');
  }
  if (hasKey(body, 'Position')) {
    errors.push('`bim.create.addElement(...)` uses `Placement: { Location: [...] }`, not `Position`.');
  }
  if (hasKey(body, 'Height')) {
    errors.push('`bim.create.addElement(...)` uses `Depth`, not `Height`.');
  }
  if (hasKey(body, 'ExtrusionHeight')) {
    errors.push('`bim.create.addElement(...)` uses `Depth`, not `ExtrusionHeight`.');
  }
  const placementValue = findPropertyValue(body, 'Placement');
  if (placementValue?.startsWith('{') && !/\bLocation\s*:/.test(placementValue)) {
    errors.push('`bim.create.addElement(...)` requires `Placement.Location`.');
  }
  const profileValue = findPropertyValue(body, 'Profile');
  if (profileValue?.startsWith('{')) {
    if (!/\bProfileType\s*:/.test(profileValue)) {
      errors.push('`bim.create.addElement(...)` requires a valid IFC-style `Profile` object with `ProfileType`.');
    }
    if (/\bkind\s*:|\bxDim\s*:|\byDim\s*:/.test(profileValue)) {
      errors.push('`bim.create.addElement(...)` profile keys must use IFC casing such as `XDim`, `YDim`, `Radius`, `OuterCurve`, and `ProfileType`.');
    }
  }
  return errors;
}

function validateAxisElementShape(body: string): string[] {
  const errors: string[] = [];
  if (hasKey(body, 'Type')) {
    errors.push('`bim.create.addAxisElement(...)` uses `IfcType`, not `Type`.');
  }
  const profileValue = findPropertyValue(body, 'Profile');
  if (profileValue?.startsWith('{') && !/\bProfileType\s*:/.test(profileValue)) {
    errors.push('`bim.create.addAxisElement(...)` requires a valid IFC-style `Profile` object with `ProfileType`.');
  }
  return errors;
}

function validateCreateContracts(code: string): string[] {
  const errors: string[] = [];
  for (const [methodName, rule] of Object.entries(METHOD_RULES)) {
    const objectBodies = getObjectBodiesForMethod(code, methodName);
    for (const body of objectBodies) {
      const missing = rule.required.filter((key) => !hasKey(body, key));
      if (missing.length > 0) {
        errors.push(`\`bim.create.${methodName}(...)\` is missing required key(s): ${missing.map((key) => `\`${key}\``).join(', ')}.`);
      }
      if (rule.anyOf) errors.push(...validateAlternativeShapes(body, methodName, rule.anyOf));
      if (rule.positiveKeys) errors.push(...validatePositiveLiterals(body, methodName, rule.positiveKeys));
      if (rule.pointArity) errors.push(...validatePointArities(body, methodName, rule.pointArity));
      if (rule.axisPair) errors.push(...validateAxisPair(body, methodName, rule.axisPair[0], rule.axisPair[1]));
      if (rule.forbidKeys) errors.push(...validateForbiddenKeys(body, rule.forbidKeys));
      if (rule.custom) errors.push(...rule.custom(body));
    }
  }
  return errors;
}

function validateBareIdentifierTraps(code: string): string[] {
  const errors: string[] = [];
  for (const methodName of Object.keys(METHOD_RULES)) {
    for (const objectBody of getObjectBodiesForMethod(code, methodName)) {
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
  }
  return errors;
}

function validateWallHostedOpeningPatterns(code: string): string[] {
  const hasWallCalls = code.includes('bim.create.addIfcWall(');
  if (!hasWallCalls) return [];

  const hasWallOpenings = /\bOpenings\s*:/.test(code);
  const errors: string[] = [];

  if (code.includes('bim.create.addIfcWindow(') && !hasWallOpenings) {
    errors.push('Suspicious pattern: `bim.create.addIfcWindow(...)` is being used alongside walls, but no wall `Openings` are defined. `addIfcWindow(...)` creates a world-aligned standalone window and will not auto-align or host into a wall. For wall-hosted inserts, use `bim.create.addIfcWallWindow(...)` or `Openings` on `bim.create.addIfcWall(...)`.');
  }

  if (code.includes('bim.create.addIfcDoor(') && !hasWallOpenings) {
    errors.push('Suspicious pattern: `bim.create.addIfcDoor(...)` is being used alongside walls, but no wall `Openings` are defined. `addIfcDoor(...)` creates a world-aligned standalone door and will not auto-align or host into a wall. For wall-hosted inserts, use `bim.create.addIfcWallDoor(...)` or `Openings` on `bim.create.addIfcWall(...)`.');
  }

  return errors;
}

function validateMetadataQueryPatterns(code: string): string[] {
  const errors: string[] = [];

  if (/bim\.query\.property\(\s*[^,]+,\s*["'`]Pset_MaterialCommon["'`]/.test(code) || /bim\.query\.property\(\s*[^,]+,\s*["'`]Material["'`]\s*,\s*["'`]Name["'`]/.test(code)) {
    errors.push('Suspicious material lookup: materials are usually not stored as ordinary property-set values. Prefer `bim.query.materials(entity)` over querying `Pset_MaterialCommon` or `Material.Name` as a property set.');
  }

  return errors;
}

export function validateScriptPreflight(code: string): string[] {
  return [
    ...validateKnownBimMethods(code),
    ...validateCreateContracts(code),
    ...validateBareIdentifierTraps(code),
    ...validateWallHostedOpeningPatterns(code),
    ...validateMetadataQueryPatterns(code),
  ];
}
