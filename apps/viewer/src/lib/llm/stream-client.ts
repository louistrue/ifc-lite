/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Streaming client for the LLM proxy.
 *
 * Sends chat messages to the Vercel Edge proxy and streams
 * the response back as SSE, parsing OpenRouter's streaming format.
 * Extracts budget usage headers from the response for UI display.
 */

/** A text content part in a multimodal message */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/** An image content part in a multimodal message (OpenRouter/OpenAI vision format) */
export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export type MessageContent = string | Array<TextContentPart | ImageContentPart>;

export interface StreamMessage {
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
}

/** Usage info extracted from proxy response headers (both free and pro) */
export interface UsageInfo {
  /** 'budget' for pro (USD-based), 'requests' for free (count-based) */
  type: 'budget' | 'requests';
  /** Amount used: USD spent (pro) or request count (free) */
  used: number;
  /** Limit: USD budget (pro) or request cap (free) */
  limit: number;
  /** Percentage used (0-100) */
  pct: number;
  /** Reset time (epoch seconds) */
  resetAt: number;
}

export interface StreamOptions {
  /** Proxy URL (Vercel Edge Function) */
  proxyUrl: string;
  /** Model ID (e.g. 'google/gemini-2.5-flash') */
  model: string;
  /** Conversation messages */
  messages: StreamMessage[];
  /** System prompt (sent separately for prompt caching) */
  system?: string;
  /** Clerk JWT for authentication */
  authToken?: string | null;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Called for each text chunk as it arrives */
  onChunk: (text: string) => void;
  /** Called when the stream completes */
  onComplete: (fullText: string) => void;
  /** Called on error */
  onError: (error: Error) => void;
  /** Called with usage info from response headers (budget or request count) */
  onUsageInfo?: (usage: UsageInfo) => void;
}

/**
 * Stream a chat completion from the LLM proxy.
 * Parses OpenRouter's SSE format (data: {...}\n\n).
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
      // Surface upgrade hint for 403
      if (response.status === 403 && errorBody.upgrade) {
        errorDetail = 'Pro subscription required for this model. Upgrade to unlock budget & frontier models.';
      }
      // Surface rate limit / budget info for 429
      if (response.status === 429) {
        if (errorBody.type === 'budget') {
          // Our proxy: pro user budget exhausted
          errorDetail = `Monthly budget exhausted ($${(errorBody.budgetSpent ?? 0).toFixed(2)} / $${(errorBody.budgetLimit ?? 5).toFixed(2)}). Resets ${errorBody.resetAt ? new Date(errorBody.resetAt).toLocaleDateString() : 'next month'}.`;
        } else if (errorBody.type === 'request_cap') {
          // Our proxy: free user daily cap
          errorDetail = `Daily limit reached (${errorBody.limit ?? 50} requests/day). Resets ${errorBody.resetAt ? new Date(errorBody.resetAt).toLocaleString() : 'tomorrow'}.`;
        } else if (errorBody.type === 'openrouter_limit') {
          // OpenRouter's own rate limit (passed through by our proxy)
          errorDetail = errorBody.error || 'Rate limit reached. Please wait a moment and try again.';
        } else {
          // Fallback for any other 429
          errorDetail = errorBody.error || 'Rate limit reached. Please wait and try again.';
        }
      }
    } catch {
      // ignore parse failure
    }
    onError(new Error(errorDetail));
    return;
  }

  // Extract usage info from response headers (pro: budget, free: request count)
  if (onUsageInfo) {
    const budgetLimit = parseFloat(response.headers.get('X-Budget-Limit') ?? '0');
    const budgetSpent = parseFloat(response.headers.get('X-Budget-Spent') ?? '0');
    const usageUsed = parseInt(response.headers.get('X-Usage-Used') ?? '0', 10);
    const usageLimit = parseInt(response.headers.get('X-Usage-Limit') ?? '0', 10);

    if (budgetLimit > 0) {
      // Pro user: budget-based
      onUsageInfo({
        type: 'budget',
        used: budgetSpent,
        limit: budgetLimit,
        pct: parseInt(response.headers.get('X-Budget-Pct') ?? '0', 10),
        resetAt: parseInt(response.headers.get('X-Budget-Reset') ?? '0', 10),
      });
    } else if (usageLimit > 0) {
      // Free user: request count-based
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

      // Process complete SSE events (separated by double newline)
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
