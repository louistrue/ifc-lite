/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ChatPanel — Interactive LLM chat with live 3D model generation.
 *
 * Features:
 * - Streaming responses with blinking cursor
 * - Executable code blocks with "Run" and "Fix this" buttons
 * - Drag-and-drop file upload with visual dropzone
 * - Smart auto-scroll with "scroll to bottom" button
 * - Clickable example prompts in empty state
 * - Auto-execute toggle for hands-free workflow
 * - Keyboard shortcuts (Cmd+L focus, Escape close)
 * - Conversation persistence via localStorage
 * - Clear confirmation dialog
 * - Error-to-LLM feedback loop for failed scripts
 */

import { useCallback, useRef, useEffect, useState, type KeyboardEvent, type DragEvent } from 'react';
import {
  X,
  Send,
  Square,
  Bot,
  Trash2,
  Paperclip,
  Loader2,
  ArrowDown,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { useViewerStore } from '@/store';
import { ChatMessageComponent } from './chat/ChatMessage';
import { ModelSelector } from './chat/ModelSelector';
import { streamChat, type TextContentPart, type ImageContentPart, type UsageInfo } from '@/lib/llm/stream-client';
import { buildSystemPrompt } from '@/lib/llm/system-prompt';
import { getModelContext, parseCSV } from '@/lib/llm/context-builder';
import { extractCodeBlocks } from '@/lib/llm/code-extractor';
import type { ChatMessage, FileAttachment } from '@/lib/llm/types';
import { Image as ImageIcon } from 'lucide-react';

// Environment variable for the proxy URL
const PROXY_URL = import.meta.env.VITE_LLM_PROXY_URL as string || '/api/chat';

const EXAMPLE_PROMPTS = [
  'Create a 3-story house with walls, slabs, and a roof',
  'Color all IfcWalls by their fire rating',
  'Export a quantity takeoff as CSV',
  'Create a skyscraper with 4x4 column grid, 30x40m, concrete shaft',
];

/** Convert a File to a base64 data URL */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface ChatPanelProps {
  onClose?: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const messages = useViewerStore((s) => s.chatMessages);
  const status = useViewerStore((s) => s.chatStatus);
  const streamingContent = useViewerStore((s) => s.chatStreamingContent);
  const activeModel = useViewerStore((s) => s.chatActiveModel);
  const autoExecute = useViewerStore((s) => s.chatAutoExecute);
  const error = useViewerStore((s) => s.chatError);
  const attachments = useViewerStore((s) => s.chatAttachments);
  const addMessage = useViewerStore((s) => s.addChatMessage);
  const setChatStatus = useViewerStore((s) => s.setChatStatus);
  const updateStreaming = useViewerStore((s) => s.updateLastAssistantMessage);
  const finalizeAssistant = useViewerStore((s) => s.finalizeAssistantMessage);
  const setChatError = useViewerStore((s) => s.setChatError);
  const setChatAbortController = useViewerStore((s) => s.setChatAbortController);
  const setAutoExecute = useViewerStore((s) => s.setChatAutoExecute);
  const addAttachment = useViewerStore((s) => s.addChatAttachment);
  const removeAttachment = useViewerStore((s) => s.removeChatAttachment);
  const clearAttachments = useViewerStore((s) => s.clearChatAttachments);
  const clearMessages = useViewerStore((s) => s.clearChatMessages);
  const sendErrorFeedback = useViewerStore((s) => s.sendErrorFeedback);
  const authToken = useViewerStore((s) => s.chatAuthToken);
  const hasPro = useViewerStore((s) => s.chatHasPro);
  const usage = useViewerStore((s) => s.chatUsage);
  const setChatUsage = useViewerStore((s) => s.setChatUsage);

  const [inputText, setInputText] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // ── Smart auto-scroll ──
  // Only auto-scroll if user hasn't scrolled up to read old messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!userScrolledUp) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingContent, userScrolledUp]);

  // Detect whether user has scrolled up from the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      setUserScrolledUp(!isNearBottom);
      setShowScrollBtn(!isNearBottom && (messages.length > 0 || !!streamingContent));
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [messages.length, streamingContent]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setUserScrolledUp(false);
      setShowScrollBtn(false);
    }
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      // Cmd+L / Ctrl+L → focus chat input
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape → close panel (only if chat input isn't focused or is empty)
      if (e.key === 'Escape' && onClose) {
        const isChatFocused = document.activeElement === inputRef.current;
        if (!isChatFocused || !inputText) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, inputText]);

  // ── Core send logic ──
  const doSend = useCallback(async (text: string) => {
    if (!text.trim() || status === 'streaming' || status === 'sending') return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      createdAt: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };
    addMessage(userMessage);
    setInputText('');
    setChatStatus('sending');
    setUserScrolledUp(false);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Check for auto-captured viewport screenshot to include
    const viewportScreenshot = useViewerStore.getState().chatViewportScreenshot;
    if (viewportScreenshot) {
      useViewerStore.getState().setChatViewportScreenshot(null);
    }

    const allMessages = [...messages, userMessage];
    const streamMessages = allMessages.map((m, idx) => {
      const isLastMessage = idx === allMessages.length - 1;
      // Build multimodal content array if message has image attachments
      const imageAttachments = m.attachments?.filter((a) => a.isImage && a.imageBase64);
      const hasImages = imageAttachments && imageAttachments.length > 0;
      const hasViewportShot = isLastMessage && viewportScreenshot;

      if (hasImages || hasViewportShot) {
        const parts: Array<TextContentPart | ImageContentPart> = [];
        // Add user-attached images
        if (imageAttachments) {
          for (const img of imageAttachments) {
            parts.push({ type: 'image_url', image_url: { url: img.imageBase64! } });
          }
        }
        // Add auto-captured viewport screenshot
        if (hasViewportShot) {
          parts.push({ type: 'image_url', image_url: { url: viewportScreenshot } });
          parts.push({ type: 'text', text: m.content + '\n\n[Attached: current viewport screenshot showing the 3D model state]' });
        } else {
          parts.push({ type: 'text', text: m.content });
        }
        return { role: m.role as 'user' | 'assistant', content: parts };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    const modelContext = getModelContext();
    const fileAttachments = attachments.length > 0 ? attachments : undefined;
    const systemPrompt = buildSystemPrompt(modelContext, fileAttachments);

    if (attachments.length > 0) clearAttachments();

    const abortController = new AbortController();
    setChatAbortController(abortController);

    let accumulated = '';

    await streamChat({
      proxyUrl: PROXY_URL,
      model: activeModel,
      messages: streamMessages,
      system: systemPrompt,
      authToken,
      signal: abortController.signal,
      onChunk: (chunk) => {
        accumulated += chunk;
        setChatStatus('streaming');
        updateStreaming(accumulated);
      },
      onComplete: (fullText) => {
        const messageId = finalizeAssistant(fullText);

        // Auto-execute if enabled
        const autoExec = useViewerStore.getState().chatAutoExecute;
        if (autoExec) {
          const blocks = extractCodeBlocks(fullText);
          if (blocks.length > 0) {
            const lastBlock = blocks[blocks.length - 1];
            useViewerStore.getState().setCodeExecResult(
              messageId,
              lastBlock.index,
              { status: 'running' },
            );
          }
        }
      },
      onUsageInfo: (info: UsageInfo) => {
        setChatUsage(info);
      },
      onError: (err) => {
        setChatError(err.message);
        setChatAbortController(null);
      },
    });
  }, [
    status, messages, activeModel, attachments, authToken,
    addMessage, setChatStatus, updateStreaming, finalizeAssistant,
    setChatError, setChatAbortController, clearAttachments, setChatUsage,
  ]);

  const handleSend = useCallback(() => {
    doSend(inputText);
  }, [inputText, doSend]);

  const handleStop = useCallback(() => {
    const controller = useViewerStore.getState().chatAbortController;
    if (controller) {
      controller.abort();
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

  // ── Error feedback (Fix this) ──
  const handleFixError = useCallback((code: string, errorMsg: string) => {
    sendErrorFeedback(code, errorMsg);
    // Auto-send the feedback to the LLM
    const state = useViewerStore.getState();
    const lastMsg = state.chatMessages[state.chatMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      doSend(lastMsg.content);
    }
  }, [sendErrorFeedback, doSend]);

  // ── Clickable example prompts ──
  const handleExampleClick = useCallback((prompt: string) => {
    setInputText(prompt);
    inputRef.current?.focus();
  }, []);

  // ── Clear with confirmation ──
  const handleClearClick = useCallback(() => {
    if (messages.length <= 2) {
      clearMessages();
    } else {
      setShowClearConfirm(true);
    }
  }, [messages.length, clearMessages]);

  const confirmClear = useCallback(() => {
    clearMessages();
    setShowClearConfirm(false);
  }, [clearMessages]);

  // ── File upload (button + drag-drop + paste) ──
  const processFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      // Handle image files
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        const attachment: FileAttachment = {
          name: file.name,
          type: file.type,
          size: file.size,
          imageBase64: base64,
          isImage: true,
        };
        addAttachment(attachment);
        continue;
      }
      // Only accept text-based files
      if (!file.name.match(/\.(csv|json|txt|tsv)$/i)) continue;
      const text = await file.text();
      const attachment: FileAttachment = {
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        textContent: text,
      };
      if (file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
        const { columns, rows } = parseCSV(text);
        attachment.csvColumns = columns;
        attachment.csvData = rows;
      }
      addAttachment(attachment);
    }
  }, [addAttachment]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    await processFiles(files);
    e.target.value = '';
  }, [processFiles]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processFiles(files);
    }
  }, [processFiles]);

  // ── Paste handler for images ──
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await processFiles(imageFiles);
    }
  }, [processFiles]);

  const isActive = status === 'streaming' || status === 'sending';

  return (
    <div
      className="h-full flex flex-col bg-background relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-md flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-500">
            <Paperclip className="h-8 w-8" />
            <span className="text-sm font-medium">Drop files or images</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0">
        <Bot className="h-4 w-4 text-blue-500 shrink-0" />
        <span className="text-sm font-medium">AI Assistant</span>
        <ModelSelector hasPro={hasPro} />
        {/* Usage indicator */}
        {usage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 mx-1">
                <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usage.pct >= 90 ? 'bg-destructive' : usage.pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, usage.pct)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">{usage.pct}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {usage.type === 'credits'
                ? `${usage.used} / ${usage.limit} credits this month`
                : `${usage.used} / ${usage.limit} requests today`
              }
            </TooltipContent>
          </Tooltip>
        )}
        <div className="flex-1" />

        {/* Auto-execute toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 mr-1">
              <Zap className={`h-3 w-3 ${autoExecute ? 'text-amber-500' : 'text-muted-foreground/50'}`} />
              <Switch
                checked={autoExecute}
                onCheckedChange={setAutoExecute}
                className="scale-75 origin-center"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Auto-execute: {autoExecute ? 'ON' : 'OFF'} — automatically run code when LLM responds
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleClearClick}
              disabled={messages.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear conversation</TooltipContent>
        </Tooltip>
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Clear confirmation */}
      {showClearConfirm && (
        <div className="px-3 py-2 bg-destructive/5 border-b flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Clear {messages.length} messages?</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={confirmClear}
            className="h-5 px-2 text-xs"
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowClearConfirm(false)}
            className="h-5 px-2 text-xs"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto relative" ref={scrollRef}>
        {/* Empty state with clickable examples */}
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              Describe what you want to build or analyze
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-xs">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleExampleClick(prompt)}
                  className="text-xs text-left px-3 py-2 rounded-md border border-border/50 hover:border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <ChatMessageComponent
            key={msg.id}
            message={msg}
            onFixError={handleFixError}
          />
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
            isStreaming
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

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <div className="absolute bottom-[120px] right-4 z-20">
          <Button
            variant="outline"
            size="icon-xs"
            onClick={scrollToBottom}
            className="rounded-full shadow-md bg-background"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

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
              {a.isImage ? (
                <>
                  {a.imageBase64 && (
                    <img
                      src={a.imageBase64}
                      alt={a.name}
                      className="h-6 w-6 object-cover rounded"
                    />
                  )}
                  <ImageIcon className="h-3 w-3" />
                </>
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
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
            accept=".csv,.json,.txt,.tsv,image/*"
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
            <TooltipContent>Attach file or image (paste, drag &amp; drop)</TooltipContent>
          </Tooltip>

          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground/50">
            {isActive ? 'Streaming...' : 'Shift+Enter for new line'}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            Ctrl+L focus
          </span>
        </div>
      </div>
    </div>
  );
}
