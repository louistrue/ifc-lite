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

const STORAGE_KEY = 'ifc-lite-chat-model';
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

  // Actions
  setChatPanelVisible: (visible: boolean) => void;
  toggleChatPanel: () => void;
  addChatMessage: (message: ChatMessage) => void;
  updateLastAssistantMessage: (content: string) => void;
  finalizeAssistantMessage: (content: string) => void;
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
}

function loadStoredModel(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_FREE_MODEL.id;
  } catch {
    return DEFAULT_FREE_MODEL.id;
  }
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  // Initial state
  chatPanelVisible: false,
  chatMessages: [],
  chatStatus: 'idle',
  chatStreamingContent: '',
  chatActiveModel: loadStoredModel(),
  chatAutoExecute: false,
  chatError: null,
  chatAbortController: null,
  chatAttachments: [],

  // Actions
  setChatPanelVisible: (chatPanelVisible) => set({ chatPanelVisible }),

  toggleChatPanel: () => set((state) => ({ chatPanelVisible: !state.chatPanelVisible })),

  addChatMessage: (message) => {
    const messages = [...get().chatMessages, message];
    // Trim old messages to prevent unbounded growth
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    set({ chatMessages: messages, chatError: null });
  },

  updateLastAssistantMessage: (content) => {
    set({ chatStreamingContent: content });
  },

  finalizeAssistantMessage: (content) => {
    const codeBlocks = extractCodeBlocks(content);
    const message: ChatMessage = {
      id: crypto.randomUUID(),
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
  },

  setChatStatus: (chatStatus) => set({ chatStatus }),

  setChatStreamingContent: (chatStreamingContent) => set({ chatStreamingContent }),

  setChatActiveModel: (chatActiveModel) => {
    try { localStorage.setItem(STORAGE_KEY, chatActiveModel); } catch { /* ignore */ }
    set({ chatActiveModel });
  },

  setChatAutoExecute: (chatAutoExecute) => set({ chatAutoExecute }),

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
  },

  addChatAttachment: (attachment) => {
    set({ chatAttachments: [...get().chatAttachments, attachment] });
  },

  removeChatAttachment: (name) => {
    set({ chatAttachments: get().chatAttachments.filter((a) => a.name !== name) });
  },

  clearChatAttachments: () => set({ chatAttachments: [] }),

  clearChatMessages: () => set({ chatMessages: [], chatStreamingContent: '', chatError: null }),
});
