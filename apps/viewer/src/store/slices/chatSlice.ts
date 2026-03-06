/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Chat state slice — manages LLM chat messages, streaming state,
 * model selection, and code execution results.
 */

import type { StateCreator } from 'zustand';
import type { ChatMessage, ChatStatus, CodeExecResult, FileAttachment } from '../../lib/llm/types.js';
import { DEFAULT_FREE_MODEL } from '../../lib/llm/models.js';
import { extractCodeBlocks } from '../../lib/llm/code-extractor.js';
import type { ScriptDiagnostic } from '../../lib/llm/script-diagnostics.js';
import { formatDiagnosticsForPrompt } from '../../lib/llm/script-diagnostics.js';

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
    reason?: 'runtime' | 'preflight' | 'patch-conflict' | 'patch-apply';
  },
): string {
  const reason = options?.reason ?? 'runtime';
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

  return `The script needs a targeted fix.\n\nFailure type: ${reason}\n${revisionLine}${selectionLine}\n\`\`\`\n${error}\n\`\`\`${diagnosticsBlock}\nHere is the current script that should be repaired in place:\n\n\`\`\`js\n${code}\n\`\`\`${staleBlock}\nPlease fix the issue in the existing script, not as a detached standalone snippet.\n- Preserve the project handle, storey handles, loop variables, and surrounding declarations unless they are the direct cause of the error.\n- Prefer the smallest valid in-place correction.\n- Return exactly one \`ifc-script-edits\` block that patches the CURRENT script revision.\n- Do NOT return a \`js\` fence for repair turns.\n- Do NOT use \`replaceAll\` unless the user explicitly asked to regenerate the full script.\n- Do NOT answer with a smaller local loop/body fragment when the current script is a full model script.\n- If you are recovering from a patch conflict, re-target the latest revision shown above and regenerate edit ops with that exact \`baseRevision\`.\n- If a previous answer was rejected for losing script context, keep the full building script and patch only the failing region.\n- If the bug is a multi-storey facade placement issue, check whether the affected methods are world-placement based and whether their Z coordinates include the current storey elevation.\n\nReturn only the repair patch.`;
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
      chatStreamingContent: '',
      chatError: null,
      chatPendingPrompt: null,
      chatViewportScreenshot: null,
    });
    try { localStorage.removeItem(MESSAGES_STORAGE_KEY); } catch { /* ignore */ }
  },

  queueChatPrompt: (chatPendingPrompt) => set({ chatPendingPrompt }),

  consumeChatPendingPrompt: () => set({ chatPendingPrompt: null }),

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
