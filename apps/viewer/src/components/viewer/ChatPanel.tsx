/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ChatPanel — Interactive LLM chat with live 3D model generation.
 *
 * Users type natural language prompts, the LLM generates bim.* scripts,
 * and code blocks can be executed with one click to create/modify
 * geometry in the 3D viewport in real time.
 */

import { useCallback, useRef, useEffect, useState, type KeyboardEvent } from 'react';
import {
  X,
  Send,
  Square,
  Bot,
  Trash2,
  Paperclip,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useViewerStore } from '@/store';
import { ChatMessageComponent } from './chat/ChatMessage';
import { ModelSelector } from './chat/ModelSelector';
import { streamChat } from '@/lib/llm/stream-client';
import { buildSystemPrompt } from '@/lib/llm/system-prompt';
import { getModelContext, parseCSV } from '@/lib/llm/context-builder';
import { extractCodeBlocks } from '@/lib/llm/code-extractor';
import type { ChatMessage, FileAttachment } from '@/lib/llm/types';

// Environment variable for the proxy URL
const PROXY_URL = import.meta.env.VITE_LLM_PROXY_URL as string || '/api/chat';

interface ChatPanelProps {
  onClose?: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const messages = useViewerStore((s) => s.chatMessages);
  const status = useViewerStore((s) => s.chatStatus);
  const streamingContent = useViewerStore((s) => s.chatStreamingContent);
  const activeModel = useViewerStore((s) => s.chatActiveModel);
  const error = useViewerStore((s) => s.chatError);
  const attachments = useViewerStore((s) => s.chatAttachments);
  const addMessage = useViewerStore((s) => s.addChatMessage);
  const setChatStatus = useViewerStore((s) => s.setChatStatus);
  const updateStreaming = useViewerStore((s) => s.updateLastAssistantMessage);
  const finalizeAssistant = useViewerStore((s) => s.finalizeAssistantMessage);
  const setChatError = useViewerStore((s) => s.setChatError);
  const setChatAbortController = useViewerStore((s) => s.setChatAbortController);
  const addAttachment = useViewerStore((s) => s.addChatAttachment);
  const removeAttachment = useViewerStore((s) => s.removeChatAttachment);
  const clearAttachments = useViewerStore((s) => s.clearChatAttachments);
  const clearMessages = useViewerStore((s) => s.clearChatMessages);

  const [inputText, setInputText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || status === 'streaming' || status === 'sending') return;

    // Build user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };
    addMessage(userMessage);
    setInputText('');
    setChatStatus('sending');

    // Build conversation history for the LLM
    const allMessages = [...messages, userMessage];
    const streamMessages = allMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Build system prompt with current model context
    const modelContext = getModelContext();
    const fileAttachments = attachments.length > 0 ? attachments : undefined;
    const systemPrompt = buildSystemPrompt(modelContext, fileAttachments);

    // Clear attachments after sending
    if (attachments.length > 0) clearAttachments();

    // Stream the response
    const abortController = new AbortController();
    setChatAbortController(abortController);

    let accumulated = '';

    await streamChat({
      proxyUrl: PROXY_URL,
      model: activeModel,
      messages: streamMessages,
      system: systemPrompt,
      signal: abortController.signal,
      onChunk: (chunk) => {
        accumulated += chunk;
        setChatStatus('streaming');
        updateStreaming(accumulated);
      },
      onComplete: (fullText) => {
        finalizeAssistant(fullText);

        // Auto-execute if enabled
        const autoExec = useViewerStore.getState().chatAutoExecute;
        if (autoExec) {
          const blocks = extractCodeBlocks(fullText);
          if (blocks.length > 0) {
            // Auto-execute the last code block only
            const lastBlock = blocks[blocks.length - 1];
            const lastMsg = useViewerStore.getState().chatMessages;
            const assistantMsg = lastMsg[lastMsg.length - 1];
            if (assistantMsg) {
              // Trigger execution via store (will be picked up by ExecutableCodeBlock)
              useViewerStore.getState().setCodeExecResult(
                assistantMsg.id,
                lastBlock.index,
                { status: 'running' },
              );
            }
          }
        }
      },
      onError: (err) => {
        setChatError(err.message);
        setChatAbortController(null);
      },
    });
  }, [
    inputText, status, messages, activeModel, attachments,
    addMessage, setChatStatus, updateStreaming, finalizeAssistant,
    setChatError, setChatAbortController, clearAttachments,
  ]);

  const handleStop = useCallback(() => {
    const controller = useViewerStore.getState().chatAbortController;
    if (controller) {
      controller.abort();
      // If we have partial content, finalize it
      const partial = useViewerStore.getState().chatStreamingContent;
      if (partial) {
        finalizeAssistant(partial);
      } else {
        setChatStatus('idle');
        setChatAbortController(null);
      }
    }
  }, [finalizeAssistant, setChatStatus, setChatAbortController]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const text = await file.text();
      const attachment: FileAttachment = {
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        textContent: text,
      };

      if (file.name.endsWith('.csv')) {
        const { columns, rows } = parseCSV(text);
        attachment.csvColumns = columns;
        attachment.csvData = rows;
      }

      addAttachment(attachment);
    }

    e.target.value = '';
  }, [addAttachment]);

  const isActive = status === 'streaming' || status === 'sending';

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0">
        <Bot className="h-4 w-4 text-blue-500 shrink-0" />
        <span className="text-sm font-medium">AI Assistant</span>
        <ModelSelector />
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={clearMessages} disabled={messages.length === 0}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear conversation</TooltipContent>
        </Tooltip>
        {onClose && (
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef}>
          {/* Empty state */}
          {messages.length === 0 && !streamingContent && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <Bot className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">
                Describe what you want to build or analyze
              </p>
              <p className="text-xs text-muted-foreground/60">
                &ldquo;Create a 3-story house with walls, slabs, and a roof&rdquo;
              </p>
              <p className="text-xs text-muted-foreground/60">
                &ldquo;Color all IfcWalls by their fire rating&rdquo;
              </p>
              <p className="text-xs text-muted-foreground/60">
                &ldquo;Export a quantity takeoff as CSV&rdquo;
              </p>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <ChatMessageComponent key={msg.id} message={msg} />
          ))}

          {/* Streaming assistant response */}
          {streamingContent && (
            <ChatMessageComponent
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamingContent,
                createdAt: Date.now(),
                codeBlocks: extractCodeBlocks(streamingContent),
              }}
            />
          )}

          {/* Sending indicator */}
          {status === 'sending' && (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Error display */}
      {error && (
        <div className="px-3 py-1.5 bg-destructive/10 text-destructive text-xs border-t">
          {error}
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="px-2 py-1 border-t flex flex-wrap gap-1">
          {attachments.map((a) => (
            <span
              key={a.name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs"
            >
              <Paperclip className="h-3 w-3" />
              {a.name}
              <button
                className="ml-0.5 hover:text-destructive"
                onClick={() => removeAttachment(a.name)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t p-2">
        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,.txt"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 mb-0.5"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach CSV or JSON</TooltipContent>
          </Tooltip>

          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what to create or analyze..."
            rows={1}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-1.5 text-sm min-h-[32px] max-h-[120px] focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />

          {isActive ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleStop}
                  className="shrink-0 mb-0.5"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop generating</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="icon-xs"
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                  className="shrink-0 mb-0.5"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send (Enter)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
