/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Streaming client for the LLM chat proxy.
 *
 * Sends chat messages to the Edge proxy and streams the response
 * back as SSE. Extracts usage headers from the response for UI display.
 */

/** A text content part in a multimodal message */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/** An image content part in a multimodal message */
export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export type MessageContent = string | Array<TextContentPart | ImageContentPart>;

export interface StreamMessage {
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
}

/** Usage info extracted from proxy response headers */
export interface UsageInfo {
  /** 'credits' for pro, 'requests' for free */
  type: 'credits' | 'requests';
  /** Amount used: credits consumed (pro) or request count (free) */
  used: number;
  /** Limit: credit allowance (pro) or request cap (free) */
  limit: number;
  /** Percentage used (0-100) */
  pct: number;
  /** Reset time (epoch seconds) */
  resetAt: number;
}

export interface StreamOptions {
  /** Proxy URL (Edge Function) */
  proxyUrl: string;
  /** Model ID */
  model: string;
  /** Conversation messages */
  messages: StreamMessage[];
  /** System prompt */
  system?: string;
  /** Auth JWT */
  authToken?: string | null;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Called for each text chunk as it arrives */
  onChunk: (text: string) => void;
  /** Called when the stream completes */
  onComplete: (fullText: string) => void;
  /** Called on error */
  onError: (error: Error) => void;
  /** Called with usage info from response headers */
  onUsageInfo?: (usage: UsageInfo) => void;
}

/**
 * Stream a chat completion from the LLM proxy.
 * Parses SSE format (data: {...}\n\n).
 */
export async function streamChat(options: StreamOptions): Promise<void> {
  const { proxyUrl, model, messages, system, authToken, signal, onChunk, onComplete, onError, onUsageInfo } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, model, system }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json();
      errorDetail = errorBody.error || errorDetail;

      if (response.status === 403 && errorBody.upgrade) {
        errorDetail = 'Upgrade to Pro to use this model.';
      }

      if (response.status === 429) {
        if (errorBody.type === 'credits') {
          errorDetail = `Monthly credits used up. Resets ${errorBody.resetAt ? new Date(errorBody.resetAt).toLocaleDateString() : 'next month'}.`;
        } else if (errorBody.type === 'request_cap') {
          errorDetail = errorBody.error || 'Daily limit reached. Upgrade to Pro for more.';
        } else {
          errorDetail = errorBody.error || 'Limit reached. Please try again later.';
        }
      }
    } catch {
      // ignore parse failure
    }
    onError(new Error(errorDetail));
    return;
  }

  // Extract usage info from response headers
  if (onUsageInfo) {
    const creditsUsed = parseInt(response.headers.get('X-Credits-Used') ?? '0', 10);
    const creditsLimit = parseInt(response.headers.get('X-Credits-Limit') ?? '0', 10);
    const usageUsed = parseInt(response.headers.get('X-Usage-Used') ?? '0', 10);
    const usageLimit = parseInt(response.headers.get('X-Usage-Limit') ?? '0', 10);

    if (creditsLimit > 0) {
      onUsageInfo({
        type: 'credits',
        used: creditsUsed,
        limit: creditsLimit,
        pct: parseInt(response.headers.get('X-Credits-Pct') ?? '0', 10),
        resetAt: parseInt(response.headers.get('X-Credits-Reset') ?? '0', 10),
      });
    } else if (usageLimit > 0) {
      onUsageInfo({
        type: 'requests',
        used: usageUsed,
        limit: usageLimit,
        pct: parseInt(response.headers.get('X-Usage-Pct') ?? '0', 10),
        resetAt: parseInt(response.headers.get('X-Usage-Reset') ?? '0', 10),
      });
    }
  }

  if (!response.body) {
    onError(new Error('No response body'));
    return;
  }

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            };

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              onChunk(content);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  onComplete(fullText);
}
