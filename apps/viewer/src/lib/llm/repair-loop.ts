/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ChatMessage } from './types.js';
import { getPrimaryRootCause, type ScriptDiagnostic } from './script-diagnostics.js';

const REPAIR_PROMPT_PREFIX = 'The script needs a root-cause repair.';

export function isRepairPromptMessage(content: string): boolean {
  return content.startsWith(REPAIR_PROMPT_PREFIX);
}

export function pruneMessagesForRepair(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let skippingRepairReply = false;

  for (const message of messages) {
    if (message.role === 'user' && isRepairPromptMessage(message.content)) {
      skippingRepairReply = true;
      continue;
    }

    if (skippingRepairReply && message.role === 'assistant') {
      continue;
    }

    if (message.role === 'user') skippingRepairReply = false;
    result.push(message);
  }

  return result;
}

export function buildRepairAttemptKey(params: {
  reason: string;
  currentCode: string;
  diagnostics?: ScriptDiagnostic[];
}): string {
  const primary = getPrimaryRootCause(params.diagnostics ?? []);

  return [
    params.reason,
    primary?.rootCauseKey ?? '',
    primary?.repairScope ?? '',
    hashText(params.currentCode),
  ].join('|');
}

export function buildRepairSessionKey(params: {
  currentCode: string;
  diagnostics?: ScriptDiagnostic[];
}): string {
  const primary = getPrimaryRootCause(params.diagnostics ?? []);
  return primary?.rootCauseKey ?? hashText(params.currentCode);
}

export function getEscalatedRepairScope(scope: ScriptDiagnostic['repairScope']): ScriptDiagnostic['repairScope'] | null {
  switch (scope) {
    case 'local':
      return 'block';
    case 'block':
      return 'structural';
    default:
      return null;
  }
}

export function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
