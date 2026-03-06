/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ScriptEditOperation, ScriptEditorSelection } from './types.js';

const EDIT_FENCE_LANGUAGES = new Set(['ifc-script-edits', 'ifc-script-edit']);

type RawEditsEnvelope = {
  scriptEdits?: unknown;
  ops?: unknown;
};

export interface ParsedScriptEditOps {
  operations: ScriptEditOperation[];
  parseErrors: string[];
}

export interface ApplyScriptEditOpsResult {
  ok: boolean;
  content: string;
  selection: ScriptEditorSelection;
  revision: number;
  appliedOpIds: string[];
  error?: string;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function parseOperation(raw: unknown, index: number): { op?: ScriptEditOperation; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { error: `scriptEdits[${index}] must be an object.` };
  }

  const record = raw as Record<string, unknown>;
  const opId = typeof record.opId === 'string' ? record.opId.trim() : '';
  const type = typeof record.type === 'string' ? record.type.trim() : '';
  const baseRevision = asFiniteNumber(record.baseRevision);

  if (!opId) return { error: `scriptEdits[${index}] is missing a valid opId.` };
  if (baseRevision === null) return { error: `scriptEdits[${index}] is missing a valid baseRevision.` };

  const text = typeof record.text === 'string' ? record.text : '';

  switch (type) {
    case 'insert': {
      const at = asFiniteNumber(record.at);
      if (at === null) return { error: `insert op "${opId}" is missing a valid "at" index.` };
      return { op: { type, opId, baseRevision, at, text } };
    }
    case 'replaceRange': {
      const from = asFiniteNumber(record.from);
      const to = asFiniteNumber(record.to);
      if (from === null || to === null) {
        return { error: `replaceRange op "${opId}" requires numeric "from" and "to".` };
      }
      return { op: { type, opId, baseRevision, from, to, text } };
    }
    case 'replaceSelection':
      return { op: { type, opId, baseRevision, text } };
    case 'append':
      return { op: { type, opId, baseRevision, text } };
    case 'replaceAll':
      return { op: { type, opId, baseRevision, text } };
    default:
      return { error: `scriptEdits[${index}] has unsupported type "${type}".` };
  }
}

export function extractScriptEditOps(markdown: string): ParsedScriptEditOps {
  const operations: ScriptEditOperation[] = [];
  const parseErrors: string[] = [];
  const seenIds = new Set<string>();
  const fenceRegex = /```([\w-]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const language = (match[1] ?? '').toLowerCase();
    if (!EDIT_FENCE_LANGUAGES.has(language)) continue;

    let parsed: RawEditsEnvelope | null = null;
    try {
      parsed = JSON.parse(match[2]) as RawEditsEnvelope;
    } catch (error) {
      parseErrors.push(`Invalid JSON in ${language} block: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const rawOps = Array.isArray(parsed.scriptEdits)
      ? parsed.scriptEdits
      : Array.isArray(parsed.ops)
        ? parsed.ops
        : null;

    if (!rawOps) {
      parseErrors.push(`No "scriptEdits" array found in ${language} block.`);
      continue;
    }

    rawOps.forEach((raw, index) => {
      const { op, error } = parseOperation(raw, index);
      if (error) {
        parseErrors.push(error);
        return;
      }
      if (!op) return;
      if (seenIds.has(op.opId)) return;
      seenIds.add(op.opId);
      operations.push(op);
    });
  }

  return { operations, parseErrors };
}

export function filterUnappliedScriptOps(
  operations: ScriptEditOperation[],
  appliedOpIds: Set<string>,
): ScriptEditOperation[] {
  return operations.filter((op) => !appliedOpIds.has(op.opId));
}

function replaceRange(content: string, from: number, to: number, insert: string): string {
  return content.slice(0, from) + insert + content.slice(to);
}

function validateRange(from: number, to: number, max: number): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return 'range indices must be integers.';
  }
  if (from < 0 || to < 0 || from > max || to > max) {
    return `range [${from}, ${to}] is outside content bounds 0..${max}.`;
  }
  if (from > to) {
    return `range [${from}, ${to}] is invalid (from > to).`;
  }
  return null;
}

export function applyScriptEditOperations(params: {
  content: string;
  selection: ScriptEditorSelection;
  revision: number;
  operations: ScriptEditOperation[];
  acceptedBaseRevision?: number;
}): ApplyScriptEditOpsResult {
  const { operations, revision } = params;
  const expectedBaseRevision = params.acceptedBaseRevision ?? revision;
  let content = params.content;
  let selection = params.selection;
  const appliedOpIds: string[] = [];

  if (operations.length === 0) {
    return { ok: true, content, selection, revision, appliedOpIds };
  }

  for (const op of operations) {
    if (op.baseRevision !== expectedBaseRevision) {
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        error: `Edit op "${op.opId}" targets revision ${op.baseRevision}, but expected base revision is ${expectedBaseRevision}.`,
      };
    }

    if (op.type === 'replaceAll') {
      content = op.text;
      selection = { from: op.text.length, to: op.text.length };
      appliedOpIds.push(op.opId);
      continue;
    }

    if (op.type === 'append') {
      const at = content.length;
      content = replaceRange(content, at, at, op.text);
      selection = { from: at + op.text.length, to: at + op.text.length };
      appliedOpIds.push(op.opId);
      continue;
    }

    if (op.type === 'replaceSelection') {
      const issue = validateRange(selection.from, selection.to, content.length);
      if (issue) {
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          error: `replaceSelection failed: ${issue}`,
        };
      }
      content = replaceRange(content, selection.from, selection.to, op.text);
      const cursor = selection.from + op.text.length;
      selection = { from: cursor, to: cursor };
      appliedOpIds.push(op.opId);
      continue;
    }

    if (op.type === 'insert') {
      const issue = validateRange(op.at, op.at, content.length);
      if (issue) {
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          error: `insert failed: ${issue}`,
        };
      }
      content = replaceRange(content, op.at, op.at, op.text);
      const cursor = op.at + op.text.length;
      selection = { from: cursor, to: cursor };
      appliedOpIds.push(op.opId);
      continue;
    }

    const issue = validateRange(op.from, op.to, content.length);
    if (issue) {
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        error: `replaceRange failed: ${issue}`,
      };
    }
    content = replaceRange(content, op.from, op.to, op.text);
    const cursor = op.from + op.text.length;
    selection = { from: cursor, to: cursor };
    appliedOpIds.push(op.opId);
  }

  return {
    ok: true,
    content,
    selection,
    revision: revision + 1,
    appliedOpIds,
  };
}
