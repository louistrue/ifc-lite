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

const MODEL_STORAGE_KEY = 'ifc-lite-chat-model';
const MESSAGES_STORAGE_KEY = 'ifc-lite-chat-messages';
const AUTO_EXEC_STORAGE_KEY = 'ifc-lite-chat-auto-execute';
const MAX_MESSAGES = 200;

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
  /** Auto-captured viewport screenshot (base64 data URL) to include with next LLM message */
  chatViewportScreenshot: string | null;
  /** Clerk JWT for authenticated API calls (null for anonymous/free tier) */
  chatAuthToken: string | null;
  /** Whether the current user has a pro subscription */
  chatHasPro: boolean;
  /** Usage info from the server: credits (pro) or request count (free) */
  chatUsage: ChatUsage | null;

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
}

export interface ChatUsage {
  type: 'credits' | 'requests';
  used: number;
  limit: number;
  pct: number;
  resetAt: number;
  billable?: boolean;
}

function loadStoredModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_FREE_MODEL.id;
  } catch {
    return DEFAULT_FREE_MODEL.id;
  }
}

function loadStoredAutoExecute(): boolean {
  try {
    return localStorage.getItem(AUTO_EXEC_STORAGE_KEY) === 'true';
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
  chatPanelVisible: false,
  chatMessages: loadStoredMessages(),
  chatStatus: 'idle',
  chatStreamingContent: '',
  chatActiveModel: loadStoredModel(),
  chatAutoExecute: loadStoredAutoExecute(),
  chatError: null,
  chatAbortController: null,
  chatAttachments: [],
  chatViewportScreenshot: null,
  chatAuthToken: null,
  chatHasPro: false,
  chatUsage: null,

  // Actions
  setChatPanelVisible: (chatPanelVisible) => set({ chatPanelVisible }),

  toggleChatPanel: () => set((state) => ({ chatPanelVisible: !state.chatPanelVisible })),

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
    try { localStorage.setItem(MODEL_STORAGE_KEY, chatActiveModel); } catch { /* ignore */ }
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
    set({ chatMessages: [], chatStreamingContent: '', chatError: null });
    try { localStorage.removeItem(MESSAGES_STORAGE_KEY); } catch { /* ignore */ }
  },

  setChatViewportScreenshot: (chatViewportScreenshot) => set({ chatViewportScreenshot }),

  setChatAuthToken: (chatAuthToken) => set({ chatAuthToken }),

  setChatHasPro: (chatHasPro) => set({ chatHasPro }),

  setChatUsage: (chatUsage) => set({ chatUsage }),

  sendErrorFeedback: (code, error) => {
    const feedbackMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `The script failed with this error:\n\n\`\`\`\n${error}\n\`\`\`\n\nHere is the code that failed:\n\n\`\`\`js\n${code}\n\`\`\`\n\nPlease fix the issue and provide a corrected version.`,
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
