/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ScriptEditOperation, ScriptEditorSelection } from './types.js';
import type { PatchScriptDiagnostic } from './script-diagnostics.js';
import { createPatchDiagnostic } from './script-diagnostics.js';
import {
  type ScriptMutationIntent,
  validateScriptReplacementCandidate,
} from './script-preservation.js';

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
  status: 'ok' | 'revision_conflict' | 'range_error' | 'semantic_error';
  error?: string;
  diagnostic?: PatchScriptDiagnostic;
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
  priorAcceptedOps?: ScriptEditOperation[];
  acceptedBaseRevision?: number;
  baseContentSnapshot?: string;
  intent?: ScriptMutationIntent;
}): ApplyScriptEditOpsResult {
  const { operations, revision } = params;
  const expectedBaseRevision = params.acceptedBaseRevision ?? revision;
  const baseContent = params.baseContentSnapshot ?? params.content;
  let content = params.content;
  let selection = params.selection;
  const appliedOpIds: string[] = [];
  const baseMutations = buildBaseMutations(params.priorAcceptedOps ?? [], baseContent.length);
  let selectionMutationSeen = (params.priorAcceptedOps ?? []).some((op) => op.type === 'replaceSelection');

  if (operations.length === 0) {
    return { ok: true, content, selection, revision, appliedOpIds, status: 'ok' };
  }

  for (const op of operations) {
    if (op.baseRevision !== expectedBaseRevision) {
      const attemptedOpIds = operations.map((candidate) => candidate.opId);
      const diagnostic = createPatchDiagnostic(
        'patch_revision_conflict',
        `Edit op "${op.opId}" targets revision ${op.baseRevision}, but expected base revision is ${expectedBaseRevision}.`,
        'error',
        {
          attemptedOpIds,
          opBaseRevision: op.baseRevision,
          currentEditorRevision: revision,
          expectedBaseRevision,
          appliedOpIds: [...appliedOpIds],
        },
      );
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        status: 'revision_conflict',
        error: diagnostic.message,
        diagnostic,
      };
    }

    if (op.type === 'replaceAll') {
      const replacementCheck = validateScriptReplacementCandidate({
        previousContent: params.content,
        candidateContent: op.text,
        intent: params.intent ?? 'create',
        source: 'replaceAll',
      });
      if (!replacementCheck.ok) {
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          status: 'semantic_error',
          error: replacementCheck.diagnostic?.message,
          diagnostic: replacementCheck.diagnostic,
        };
      }
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
      baseMutations.push({
        from: baseContent.length,
        to: baseContent.length,
        delta: op.text.length,
        opId: op.opId,
      });
      continue;
    }

    if (op.type === 'replaceSelection') {
      const issue = validateRange(selection.from, selection.to, content.length);
      if (issue) {
        const diagnostic = createPatchDiagnostic(
          'patch_range_error',
          `replaceSelection failed: ${issue}`,
          'error',
          {
            opId: op.opId,
            range: { from: selection.from, to: selection.to },
            contentLength: content.length,
          },
        );
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          status: 'range_error',
          error: diagnostic.message,
          diagnostic,
        };
      }
      content = replaceRange(content, selection.from, selection.to, op.text);
      const cursor = selection.from + op.text.length;
      selection = { from: cursor, to: cursor };
      appliedOpIds.push(op.opId);
      selectionMutationSeen = true;
      continue;
    }

    if (op.type === 'insert') {
      if (selectionMutationSeen) {
        const diagnostic = createPatchDiagnostic(
          'patch_semantic_error',
          `insert op "${op.opId}" cannot follow a selection-based edit in the same patch set.`,
          'error',
          {
            opId: op.opId,
            fixHint: 'Use only positional ops from the same base snapshot, or emit a single replaceSelection patch.',
          },
        );
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          status: 'semantic_error',
          error: diagnostic.message,
          diagnostic,
        };
      }
      const issue = validateRange(op.at, op.at, baseContent.length);
      if (issue) {
        const diagnostic = createPatchDiagnostic(
          'patch_range_error',
          `insert failed against base snapshot: ${issue}`,
          'error',
          {
            opId: op.opId,
            at: op.at,
            baseContentLength: baseContent.length,
          },
        );
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          status: 'range_error',
          error: diagnostic.message,
          diagnostic,
        };
      }
      const rebasedAt = rebaseIndex(op.at, baseMutations);
      if (rebasedAt === null) {
        const diagnostic = createPatchDiagnostic(
          'patch_revision_conflict',
          `insert op "${op.opId}" targets a stale location in the original script snapshot.`,
          'error',
          {
            opId: op.opId,
            at: op.at,
            fixHint: 'Re-read the current script and regenerate ops against the latest unchanged base snapshot.',
          },
        );
        return {
          ok: false,
          content: params.content,
          selection: params.selection,
          revision,
          appliedOpIds: [],
          status: 'revision_conflict',
          error: diagnostic.message,
          diagnostic,
        };
      }
      content = replaceRange(content, rebasedAt, rebasedAt, op.text);
      const cursor = rebasedAt + op.text.length;
      selection = { from: cursor, to: cursor };
      appliedOpIds.push(op.opId);
      baseMutations.push({
        from: op.at,
        to: op.at,
        delta: op.text.length,
        opId: op.opId,
      });
      continue;
    }

    if (selectionMutationSeen) {
      const diagnostic = createPatchDiagnostic(
        'patch_semantic_error',
        `replaceRange op "${op.opId}" cannot follow a selection-based edit in the same patch set.`,
        'error',
        {
          opId: op.opId,
          range: { from: op.from, to: op.to },
          fixHint: 'Use positional ops only, or emit a single replaceSelection patch for the selected region.',
        },
      );
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        status: 'semantic_error',
        error: diagnostic.message,
        diagnostic,
      };
    }

    const issue = validateRange(op.from, op.to, baseContent.length);
    if (issue) {
      const diagnostic = createPatchDiagnostic(
        'patch_range_error',
        `replaceRange failed against base snapshot: ${issue}`,
        'error',
        {
          opId: op.opId,
          range: { from: op.from, to: op.to },
          baseContentLength: baseContent.length,
        },
      );
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        status: 'range_error',
        error: diagnostic.message,
        diagnostic,
      };
    }
    if (hasOverlappingBaseMutation(op.from, op.to, baseMutations)) {
      const diagnostic = createPatchDiagnostic(
        'patch_revision_conflict',
        `replaceRange op "${op.opId}" overlaps an earlier edit against the same base snapshot.`,
        'error',
        {
          opId: op.opId,
          range: { from: op.from, to: op.to },
          appliedOpIds: [...appliedOpIds],
          fixHint: 'Regenerate non-overlapping ops in order from the latest script snapshot.',
        },
      );
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        status: 'revision_conflict',
        error: diagnostic.message,
        diagnostic,
      };
    }

    const rebasedFrom = rebaseIndex(op.from, baseMutations);
    const rebasedTo = rebaseIndex(op.to, baseMutations);
    if (rebasedFrom === null || rebasedTo === null) {
      const diagnostic = createPatchDiagnostic(
        'patch_revision_conflict',
        `replaceRange op "${op.opId}" targets stale text in the original script snapshot.`,
        'error',
        {
          opId: op.opId,
          range: { from: op.from, to: op.to },
          appliedOpIds: [...appliedOpIds],
          fixHint: 'Re-read the current script and regenerate ops against the latest unchanged base snapshot.',
        },
      );
      return {
        ok: false,
        content: params.content,
        selection: params.selection,
        revision,
        appliedOpIds: [],
        status: 'revision_conflict',
        error: diagnostic.message,
        diagnostic,
      };
    }

    content = replaceRange(content, rebasedFrom, rebasedTo, op.text);
    const cursor = rebasedFrom + op.text.length;
    selection = { from: cursor, to: cursor };
    appliedOpIds.push(op.opId);
    baseMutations.push({
      from: op.from,
      to: op.to,
      delta: op.text.length - (op.to - op.from),
      opId: op.opId,
    });
  }

  return {
    ok: true,
    content,
    selection,
    revision: revision + 1,
    appliedOpIds,
    status: 'ok',
  };
}

function rebaseIndex(
  index: number,
  mutations: Array<{ from: number; to: number; delta: number }>,
): number | null {
  let rebased = index;
  for (const mutation of mutations) {
    const isPureInsert = mutation.from === mutation.to;
    if (isPureInsert) {
      if (mutation.from <= index) rebased += mutation.delta;
      continue;
    }
    if (index > mutation.from && index < mutation.to) {
      return null;
    }
    if (mutation.to <= index) rebased += mutation.delta;
  }
  return rebased;
}

function hasOverlappingBaseMutation(
  from: number,
  to: number,
  mutations: Array<{ from: number; to: number }>,
): boolean {
  return mutations.some((mutation) => {
    if (mutation.from === mutation.to) return false;
    return from < mutation.to && to > mutation.from;
  });
}

function buildBaseMutations(
  operations: ScriptEditOperation[],
  baseContentLength: number,
): Array<{ from: number; to: number; delta: number; opId: string }> {
  return operations.flatMap((op) => {
    switch (op.type) {
      case 'insert':
        return [{ from: op.at, to: op.at, delta: op.text.length, opId: op.opId }];
      case 'replaceRange':
        return [{ from: op.from, to: op.to, delta: op.text.length - (op.to - op.from), opId: op.opId }];
      case 'append':
        return [{ from: baseContentLength, to: baseContentLength, delta: op.text.length, opId: op.opId }];
      default:
        return [];
    }
  });
}
