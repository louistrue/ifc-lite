/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Chat state slice — manages LLM chat messages, streaming state,
 * model selection, and code execution results.
 */

import type { StateCreator } from 'zustand';
import type { ChatMessage, ChatRepairRequest, ChatStatus, CodeExecResult, FileAttachment } from '../../lib/llm/types.js';
import { DEFAULT_FREE_MODEL } from '../../lib/llm/models.js';
import { extractCodeBlocks } from '../../lib/llm/code-extractor.js';
import type { ScriptDiagnostic } from '../../lib/llm/script-diagnostics.js';
import { formatDiagnosticsForPrompt, getPrimaryRootCause, groupDiagnosticsByRootCause } from '../../lib/llm/script-diagnostics.js';

const MODEL_STORAGE_KEY = 'ifc-lite-chat-model';
const MESSAGES_STORAGE_KEY = 'ifc-lite-chat-messages';
const AUTO_EXEC_STORAGE_KEY = 'ifc-lite-chat-auto-execute';
const PANEL_VISIBLE_STORAGE_KEY = 'ifc-lite-chat-panel-visible';
const MAX_MESSAGES = 200;

function getModelStorageKey(userId: string | null): string {
  return userId ? `${MODEL_STORAGE_KEY}:${userId}` : MODEL_STORAGE_KEY;
}

export interface ChatSlice {
  // State
  chatPanelVisible: boolean;
  chatMessages: ChatMessage[];
  chatStatus: ChatStatus;
  chatStreamingContent: string;
  chatActiveModel: string;
  chatAutoExecute: boolean;
  chatError: string | null;
  chatAbortController: AbortController | null;
  chatAttachments: FileAttachment[];
  chatPendingPrompt: string | null;
  chatPendingRepairRequest: ChatRepairRequest | null;
  /** Auto-captured viewport screenshot (base64 data URL) to include with next LLM message */
  chatViewportScreenshot: string | null;
  /** Clerk JWT for authenticated API calls (null for anonymous/free tier) */
  chatAuthToken: string | null;
  /** Whether the current user has a pro subscription */
  chatHasPro: boolean;
  /** Usage info from the server: credits (pro) or request count (free) */
  chatUsage: ChatUsage | null;
  /** User ID used to scope persisted model preference (null for anonymous). */
  chatStorageUserId: string | null;

  // Actions
  setChatPanelVisible: (visible: boolean) => void;
  toggleChatPanel: () => void;
  addChatMessage: (message: ChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  /** Finalize streaming into a real message. Returns the finalized message ID. */
  finalizeAssistantMessage: (content: string) => string;
  setChatStatus: (status: ChatStatus) => void;
  setChatStreamingContent: (content: string) => void;
  setChatActiveModel: (model: string) => void;
  setChatAutoExecute: (auto: boolean) => void;
  setChatError: (error: string | null) => void;
  setChatAbortController: (controller: AbortController | null) => void;
  setCodeExecResult: (messageId: string, blockIndex: number, result: CodeExecResult) => void;
  addChatAttachment: (attachment: FileAttachment) => void;
  removeChatAttachment: (name: string) => void;
  clearChatAttachments: () => void;
  clearChatMessages: () => void;
  queueChatPrompt: (prompt: string) => void;
  consumeChatPendingPrompt: () => void;
  queueChatRepairRequest: (request: ChatRepairRequest) => void;
  consumeChatPendingRepairRequest: () => void;
  /** Send an error from a failed code block back to the chat as a user message for retry. */
  sendErrorFeedback: (code: string, error: string) => void;
  /** Store a viewport screenshot to include with the next LLM message */
  setChatViewportScreenshot: (dataUrl: string | null) => void;
  /** Set the Clerk auth token (called by ClerkProvider wrapper when user signs in) */
  setChatAuthToken: (token: string | null) => void;
  /** Set whether user has pro subscription (called by ClerkProvider wrapper) */
  setChatHasPro: (hasPro: boolean) => void;
  /** Update usage info from server response headers */
  setChatUsage: (usage: ChatUsage | null) => void;
  /** Set user ID for per-user model persistence and restore that user's last model. */
  setChatStorageUserId: (userId: string | null) => void;
}

export interface ChatUsage {
  type: 'credits' | 'requests';
  used: number;
  limit: number;
  pct: number;
  resetAt: number;
  billable?: boolean;
}

/** Build the standardized "Fix this" feedback message sent to the LLM. */
export function buildErrorFeedbackContent(
  code: string,
  error: string,
  options?: {
    diagnostics?: ScriptDiagnostic[];
    currentRevision?: number;
    currentSelection?: { from: number; to: number };
    staleCodeBlock?: string;
    reason?: ChatRepairRequest['reason'];
    requestedRepairScope?: ChatRepairRequest['requestedRepairScope'];
  },
): string {
  const reason = options?.reason ?? 'runtime';
  const rootCauseGroups = groupDiagnosticsByRootCause(options?.diagnostics ?? []);
  const primaryRootCause = getPrimaryRootCause(options?.diagnostics ?? []);
  const requestedRepairScope = options?.requestedRepairScope ?? primaryRootCause?.repairScope;
  const diagnosticsBlock = options?.diagnostics && options.diagnostics.length > 0
    ? `\nStructured diagnostics:\n${formatDiagnosticsForPrompt(options.diagnostics)}\n`
    : '';
  const revisionLine = options?.currentRevision !== undefined
    ? `Current script revision: ${options.currentRevision}\n`
    : '';
  const selectionLine = options?.currentSelection
    ? `Current selection: from=${options.currentSelection.from}, to=${options.currentSelection.to}\n`
    : '';
  const staleBlock = options?.staleCodeBlock
    ? `\nPrevious message code block for reference only (it may be stale relative to the editor):\n\n\`\`\`js\n${options.staleCodeBlock}\n\`\`\`\n`
    : '';
  const rootCauseBlock = primaryRootCause
    ? `\nRoot cause to fix first:\n- key: ${primaryRootCause.rootCauseKey}\n- scope: ${requestedRepairScope ?? primaryRootCause.repairScope}\n- summary: ${primaryRootCause.summary}\n`
    : '';
  const evidenceBlock = rootCauseGroups.length > 0
    ? `\nSupporting evidence:\n${rootCauseGroups.flatMap((group) => group.evidence.slice(0, 3).map((evidence) => {
      const method = evidence.methodName ? ` method=${evidence.methodName};` : '';
      const range = evidence.range ? ` range=${formatRange(evidence.range)};` : '';
      const snippet = evidence.snippet ? ` snippet=${JSON.stringify(evidence.snippet.trim())};` : '';
      return `- [${group.rootCauseKey}]${method}${range}${snippet}`.trimEnd();
    })).join('\n')}\n`
    : '';

  return `The script needs a root-cause repair.\n\nFailure type: ${reason}\n${revisionLine}${selectionLine}\n\`\`\`\n${error}\n\`\`\`${rootCauseBlock}${evidenceBlock}${diagnosticsBlock}\nHere is the current script that should be repaired in place:\n\n\`\`\`js\n${code}\n\`\`\`${staleBlock}\nPlease fix the underlying cause in the existing script, not just the first visible symptom.\n- Preserve the project handle, storey handles, loop variables, and surrounding declarations unless they are the direct cause of the error.
- Match the requested repair scope above: \`local\` for one call/site, \`block\` for a related cluster, \`structural\` for broader context-preserving repairs. Use a full rewrite only if the user explicitly asked for it.
- Return exactly one \`ifc-script-edits\` block that patches the CURRENT script revision.
- Use exact SEARCH/REPLACE blocks inside that fence. Copy SEARCH text verbatim from the CURRENT script.
- Every SEARCH block must match exactly one location in the CURRENT script. If a match is missing or ambiguous, add more unchanged surrounding context.
- For insertions, include unchanged surrounding context in SEARCH and place the inserted code inside REPLACE. Do not use an empty SEARCH block.
- Do NOT return a \`js\` fence for repair turns.
- Do NOT use \`replaceAll\` unless the user explicitly asked to regenerate the full script.
- Do NOT answer with a detached fragment or smaller local body when the current script is larger and the root cause spans surrounding context.
- If the diagnostics share one root cause, you may use multiple coordinated SEARCH/REPLACE blocks in one patch to resolve that cause.
- If you are recovering from a patch conflict, re-target the latest revision shown above and copy SEARCH blocks from that latest revision, not from an older reply.
- If a previous answer was rejected for losing script context, keep the full script intact and patch only the necessary regions.

Return only the repair patch.`;
}

function loadStoredModel(userId: string | null, fallback?: string): string {
  try {
    const perUserKey = getModelStorageKey(userId);
    const fromUserKey = localStorage.getItem(perUserKey);
    if (fromUserKey) return fromUserKey;
    // Backward compatibility: migrate previous global key into user-specific key on first read.
    if (userId) {
      const legacy = localStorage.getItem(MODEL_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(perUserKey, legacy);
        return legacy;
      }
    }
    return fallback ?? DEFAULT_FREE_MODEL.id;
  } catch {
    return fallback ?? DEFAULT_FREE_MODEL.id;
  }
}

function loadStoredAutoExecute(): boolean {
  try {
    const val = localStorage.getItem(AUTO_EXEC_STORAGE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function loadStoredPanelVisible(): boolean {
  try {
    return localStorage.getItem(PANEL_VISIBLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Load persisted messages from localStorage. */
function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed.map((m) => ({
      id: m.id as string,
      role: m.role as ChatMessage['role'],
      content: m.content as string,
      createdAt: m.createdAt as number,
      codeBlocks: m.codeBlocks as ChatMessage['codeBlocks'],
      attachments: m.attachments as ChatMessage['attachments'],
      // Re-hydrate execResults from serialized array of entries
      execResults: m.execResults
        ? new Map(m.execResults as Array<[number, CodeExecResult]>)
        : undefined,
    }));
  } catch {
    return [];
  }
}

/** Persist messages to localStorage. */
function persistMessages(messages: ChatMessage[]) {
  try {
    // Only keep last 50 messages in storage to avoid quota issues
    const toStore = messages.slice(-50).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      codeBlocks: m.codeBlocks,
      attachments: m.attachments,
      // Serialize Map as array of entries
      execResults: m.execResults ? Array.from(m.execResults.entries()) : undefined,
    }));
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* quota exceeded — ignore */ }
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  // Initial state
  chatPanelVisible: loadStoredPanelVisible(),
  chatMessages: loadStoredMessages(),
  chatStatus: 'idle',
  chatStreamingContent: '',
  chatActiveModel: loadStoredModel(null),
  chatAutoExecute: loadStoredAutoExecute(),
  chatError: null,
  chatAbortController: null,
  chatAttachments: [],
  chatPendingPrompt: null,
  chatPendingRepairRequest: null,
  chatViewportScreenshot: null,
  chatAuthToken: null,
  chatHasPro: false,
  chatUsage: null,
  chatStorageUserId: null,

  // Actions
  setChatPanelVisible: (chatPanelVisible) => {
    try { localStorage.setItem(PANEL_VISIBLE_STORAGE_KEY, String(chatPanelVisible)); } catch { /* ignore */ }
    set({ chatPanelVisible });
  },

  toggleChatPanel: () => {
    const next = !get().chatPanelVisible;
    try { localStorage.setItem(PANEL_VISIBLE_STORAGE_KEY, String(next)); } catch { /* ignore */ }
    set({ chatPanelVisible: next });
  },

  addChatMessage: (message) => {
    const messages = [...get().chatMessages, message];
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    set({ chatMessages: messages, chatError: null });
    persistMessages(messages);
  },

  updateLastAssistantMessage: (content) => {
    set({ chatStreamingContent: content });
  },

  finalizeAssistantMessage: (content) => {
    const codeBlocks = extractCodeBlocks(content);
    const id = crypto.randomUUID();
    const message: ChatMessage = {
      id,
      role: 'assistant',
      content,
      createdAt: Date.now(),
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
    };
    const messages = [...get().chatMessages, message];
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    set({
      chatMessages: messages,
      chatStreamingContent: '',
      chatStatus: 'idle',
      chatAbortController: null,
    });
    persistMessages(messages);
    return id;
  },

  setChatStatus: (chatStatus) => set({ chatStatus }),

  setChatStreamingContent: (chatStreamingContent) => set({ chatStreamingContent }),

  setChatActiveModel: (chatActiveModel) => {
    try {
      const key = getModelStorageKey(get().chatStorageUserId);
      localStorage.setItem(key, chatActiveModel);
    } catch { /* ignore */ }
    set({ chatActiveModel });
  },

  setChatAutoExecute: (chatAutoExecute) => {
    try { localStorage.setItem(AUTO_EXEC_STORAGE_KEY, String(chatAutoExecute)); } catch { /* ignore */ }
    set({ chatAutoExecute });
  },

  setChatError: (chatError) => set({ chatError, chatStatus: chatError ? 'error' : 'idle' }),

  setChatAbortController: (chatAbortController) => set({ chatAbortController }),

  setCodeExecResult: (messageId, blockIndex, result) => {
    const messages = get().chatMessages.map((msg) => {
      if (msg.id !== messageId) return msg;
      const execResults = new Map(msg.execResults ?? []);
      execResults.set(blockIndex, result);
      return { ...msg, execResults };
    });
    set({ chatMessages: messages });
    persistMessages(messages);
  },

  addChatAttachment: (attachment) => {
    set({ chatAttachments: [...get().chatAttachments, attachment] });
  },

  removeChatAttachment: (name) => {
    set({ chatAttachments: get().chatAttachments.filter((a) => a.name !== name) });
  },

  clearChatAttachments: () => set({ chatAttachments: [] }),

  clearChatMessages: () => {
    set({
      chatMessages: [],
      chatStatus: 'idle',
      chatStreamingContent: '',
      chatError: null,
      chatAbortController: null,
      chatPendingPrompt: null,
      chatPendingRepairRequest: null,
      chatViewportScreenshot: null,
    });
    try { localStorage.removeItem(MESSAGES_STORAGE_KEY); } catch { /* ignore */ }
  },

  queueChatPrompt: (chatPendingPrompt) => set({ chatPendingPrompt }),

  consumeChatPendingPrompt: () => set({ chatPendingPrompt: null }),

  queueChatRepairRequest: (chatPendingRepairRequest) => set({ chatPendingRepairRequest }),

  consumeChatPendingRepairRequest: () => set({ chatPendingRepairRequest: null }),

  setChatViewportScreenshot: (chatViewportScreenshot) => set({ chatViewportScreenshot }),

  setChatAuthToken: (chatAuthToken) => set({ chatAuthToken }),

  setChatHasPro: (chatHasPro) => set({ chatHasPro }),

  setChatUsage: (chatUsage) => set({ chatUsage }),

  setChatStorageUserId: (chatStorageUserId) => {
    const currentModel = get().chatActiveModel;
    const restoredModel = loadStoredModel(chatStorageUserId, currentModel);
    set({
      chatStorageUserId,
      chatActiveModel: restoredModel,
    });
  },

  sendErrorFeedback: (code, error) => {
    const feedbackMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: buildErrorFeedbackContent(code, error),
      createdAt: Date.now(),
    };
    const messages = [...get().chatMessages, feedbackMessage];
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    set({ chatMessages: messages, chatError: null });
    persistMessages(messages);
  },
});

function formatRange(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown';
  const from = (value as Record<string, unknown>).from;
  const to = (value as Record<string, unknown>).to;
  return typeof from === 'number' && typeof to === 'number'
    ? `${from}..${to}`
    : 'unknown';
}
