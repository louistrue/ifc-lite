/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  createPatchDiagnostic,
  type PatchScriptDiagnostic,
  type PreflightScriptDiagnostic,
} from './script-diagnostics.js';
import { validateScriptPreflightDetailed } from './script-preflight.js';

export type ScriptMutationIntent = 'create' | 'repair' | 'explicit_rewrite';
export type ScriptReplacementSource = 'replaceAll' | 'code_block_fallback' | 'manual_replace_all';

export interface ScriptReplacementCheckResult {
  ok: boolean;
  diagnostic?: PatchScriptDiagnostic;
  detachedDiagnostics: PreflightScriptDiagnostic[];
}

const CRITICAL_ANCHORS = [
  { key: 'project', label: 'project handle', pattern: /\bbim\.create\.project\s*\(/ },
  { key: 'storey', label: 'storey creation', pattern: /\bbim\.create\.addIfcBuildingStorey\s*\(/ },
  { key: 'export', label: 'IFC export', pattern: /\bbim\.create\.toIfc\s*\(/ },
  { key: 'load', label: 'viewer load', pattern: /\bbim\.model\.loadIfc\s*\(/ },
  { key: 'loop', label: 'outer loop', pattern: /\bfor\s*\(/ },
] as const;

function countMeaningfulLines(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .length;
}

function getDroppedAnchors(previousContent: string, candidateContent: string): string[] {
  return CRITICAL_ANCHORS
    .filter(({ pattern }) => pattern.test(previousContent) && !pattern.test(candidateContent))
    .map(({ label }) => label);
}

function buildReplacementDiagnostic(
  code: 'unsafe_full_replacement' | 'destructive_partial_rewrite',
  message: string,
  data: Record<string, unknown>,
  detachedDiagnostics: PreflightScriptDiagnostic[],
): ScriptReplacementCheckResult {
  return {
    ok: false,
    diagnostic: createPatchDiagnostic(code, message, 'error', {
      ...data,
      detachedDiagnosticCount: detachedDiagnostics.length,
    }),
    detachedDiagnostics,
  };
}

export function canUsePlainCodeBlockFallback(intent: ScriptMutationIntent): boolean {
  return intent !== 'repair';
}

export function validateScriptReplacementCandidate(params: {
  previousContent: string;
  candidateContent: string;
  intent: ScriptMutationIntent;
  source: ScriptReplacementSource;
}): ScriptReplacementCheckResult {
  const previousContent = params.previousContent.trim();
  const candidateContent = params.candidateContent.trim();
  const previousLineCount = countMeaningfulLines(previousContent);
  const candidateLineCount = countMeaningfulLines(candidateContent);
  const shrinkRatio = previousLineCount > 0 ? candidateLineCount / previousLineCount : 1;
  const droppedAnchors = getDroppedAnchors(previousContent, candidateContent);
  const detachedDiagnostics = validateScriptPreflightDetailed(candidateContent).filter(
    (diagnostic): diagnostic is PreflightScriptDiagnostic => diagnostic.code === 'detached_snippet_scope',
  );

  const baseData = {
    intent: params.intent,
    source: params.source,
    previousLineCount,
    candidateLineCount,
    shrinkRatio,
    droppedAnchors,
  };

  if (!candidateContent) {
    return buildReplacementDiagnostic(
      'unsafe_full_replacement',
      'Full-script replacement candidate is empty.',
      baseData,
      detachedDiagnostics,
    );
  }

  if (params.intent === 'repair' && params.source === 'code_block_fallback') {
    return buildReplacementDiagnostic(
      'unsafe_full_replacement',
      'Repair turns must not replace the whole script from a plain `js` block. Return localized `ifc-script-edits` against the current revision instead.',
      baseData,
      detachedDiagnostics,
    );
  }

  if (params.intent === 'repair' && params.source === 'replaceAll') {
    return buildReplacementDiagnostic(
      'unsafe_full_replacement',
      'Repair turns cannot use `replaceAll` unless the system explicitly allows a full rewrite.',
      baseData,
      detachedDiagnostics,
    );
  }

  if (detachedDiagnostics.length > 0 && (params.intent !== 'create' || previousLineCount >= 8)) {
    return buildReplacementDiagnostic(
      'destructive_partial_rewrite',
      'Replacement candidate still looks like a detached local snippet and would discard surrounding script context.',
      baseData,
      detachedDiagnostics,
    );
  }

  if (params.intent === 'repair' && droppedAnchors.length > 0) {
    return buildReplacementDiagnostic(
      'destructive_partial_rewrite',
      `Repair candidate dropped critical script anchors: ${droppedAnchors.join(', ')}.`,
      baseData,
      detachedDiagnostics,
    );
  }

  if (params.intent === 'repair' && previousLineCount >= 12 && shrinkRatio < 0.6) {
    return buildReplacementDiagnostic(
      'destructive_partial_rewrite',
      'Repair candidate shrank far below the current script and likely removed unrelated building context.',
      baseData,
      detachedDiagnostics,
    );
  }

  if (params.intent !== 'repair' && previousLineCount >= 12 && shrinkRatio < 0.35 && droppedAnchors.length >= 2) {
    return buildReplacementDiagnostic(
      'unsafe_full_replacement',
      'Full-script replacement candidate looks like a local fragment rather than a complete script.',
      baseData,
      detachedDiagnostics,
    );
  }

  return { ok: true, detachedDiagnostics };
}
