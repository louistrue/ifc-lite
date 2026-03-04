/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Types for the LLM chat integration.
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Timestamp in ms */
  createdAt: number;
  /** Parsed code blocks from assistant messages */
  codeBlocks?: CodeBlock[];
  /** Execution results for code blocks in this message */
  execResults?: Map<number, CodeExecResult>;
  /** Attached files (user messages only) */
  attachments?: FileAttachment[];
}

export interface CodeBlock {
  /** Index within the message */
  index: number;
  /** Language hint from the code fence (e.g. 'js', 'typescript') */
  language: string;
  /** The code content */
  code: string;
}

export interface CodeExecResult {
  status: 'running' | 'success' | 'error';
  logs?: Array<{ level: string; args: unknown[] }>;
  value?: unknown;
  error?: string;
  durationMs?: number;
}

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  /** Parsed CSV rows (if CSV file) */
  csvData?: Record<string, string>[];
  /** Column names (if CSV file) */
  csvColumns?: string[];
  /** Raw text content */
  textContent?: string;
  /** Base64-encoded image data (for image attachments) */
  imageBase64?: string;
  /** Whether this is an image attachment */
  isImage?: boolean;
}

export type ModelTier = 'free' | 'budget' | 'frontier';

export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  tier: ModelTier;
  contextWindow: number;
  /** Notes shown in model selector */
  notes?: string;
}

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error';
