/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type ScriptDiagnosticSeverity = 'error' | 'warning';
export type ScriptDiagnosticSource = 'preflight' | 'runtime' | 'patch';

export type PreflightDiagnosticCode =
  | 'unknown_namespace'
  | 'unknown_method'
  | 'create_contract'
  | 'bare_identifier'
  | 'wall_hosted_opening_pattern'
  | 'metadata_query_pattern'
  | 'world_placement_elevation'
  | 'detached_snippet_scope';

export type RuntimeDiagnosticCode =
  | 'generic_placement_contract'
  | 'plate_contract_mismatch'
  | 'world_placement_elevation'
  | 'detached_snippet_scope'
  | 'wall_hosted_opening_alignment';

export type PatchDiagnosticCode =
  | 'patch_revision_conflict'
  | 'patch_range_error'
  | 'patch_semantic_error'
  | 'unsafe_full_replacement'
  | 'destructive_partial_rewrite';

export interface ScriptDiagnosticBase<TSource extends ScriptDiagnosticSource, TCode extends string> {
  source: TSource;
  code: TCode;
  severity: ScriptDiagnosticSeverity;
  message: string;
  data?: Record<string, unknown>;
}

export type PreflightScriptDiagnostic = ScriptDiagnosticBase<'preflight', PreflightDiagnosticCode>;
export type RuntimeScriptDiagnostic = ScriptDiagnosticBase<'runtime', RuntimeDiagnosticCode>;
export type PatchScriptDiagnostic = ScriptDiagnosticBase<'patch', PatchDiagnosticCode>;

export type ScriptDiagnostic =
  | PreflightScriptDiagnostic
  | RuntimeScriptDiagnostic
  | PatchScriptDiagnostic;

export function createPreflightDiagnostic(
  code: PreflightDiagnosticCode,
  message: string,
  severity: ScriptDiagnosticSeverity = 'error',
  data?: Record<string, unknown>,
): PreflightScriptDiagnostic {
  return { source: 'preflight', code, severity, message, data };
}

export function createRuntimeDiagnostic(
  code: RuntimeDiagnosticCode,
  message: string,
  severity: ScriptDiagnosticSeverity = 'error',
  data?: Record<string, unknown>,
): RuntimeScriptDiagnostic {
  return { source: 'runtime', code, severity, message, data };
}

export function createPatchDiagnostic(
  code: PatchDiagnosticCode,
  message: string,
  severity: ScriptDiagnosticSeverity = 'error',
  data?: Record<string, unknown>,
): PatchScriptDiagnostic {
  return { source: 'patch', code, severity, message, data };
}

export function formatDiagnosticsForDisplay(diagnostics: ScriptDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.message);
}

export function formatDiagnosticsForPrompt(diagnostics: ScriptDiagnostic[]): string {
  if (diagnostics.length === 0) return '';
  return diagnostics.map((diagnostic) => {
    const details = formatDiagnosticDetails(diagnostic.data);
    const hint = typeof diagnostic.data?.fixHint === 'string' ? ` Hint: ${diagnostic.data.fixHint}` : '';
    return `- [${diagnostic.source}:${diagnostic.code}] ${diagnostic.message}${details}${hint}`;
  }).join('\n');
}

function formatDiagnosticDetails(data?: Record<string, unknown>): string {
  if (!data) return '';

  const details: string[] = [];
  const opId = asString(data.opId);
  const methodName = asString(data.methodName);
  const symbol = asString(data.symbol);
  const failureKind = asString(data.failureKind);
  const range = formatRange(data.range);
  const selection = formatRange(data.selection);
  const currentEditorRevision = asNumber(data.currentEditorRevision);
  const expectedBaseRevision = asNumber(data.expectedBaseRevision);

  if (opId) details.push(`op=${opId}`);
  if (methodName) details.push(`method=${methodName}`);
  if (symbol) details.push(`symbol=${symbol}`);
  if (failureKind) details.push(`failure=${failureKind}`);
  if (range) details.push(`range=${range}`);
  if (selection) details.push(`selection=${selection}`);
  if (expectedBaseRevision !== null) details.push(`expectedRevision=${expectedBaseRevision}`);
  if (currentEditorRevision !== null) details.push(`currentRevision=${currentEditorRevision}`);

  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

function formatRange(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const from = asNumber((value as Record<string, unknown>).from);
  const to = asNumber((value as Record<string, unknown>).to);
  if (from === null || to === null) return null;
  return `${from}..${to}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
