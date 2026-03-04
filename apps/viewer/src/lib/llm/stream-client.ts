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

/** Budget usage info extracted from proxy response headers */
export interface BudgetInfo {
  /** Monthly budget limit in USD (0 = free tier) */
  limit: number;
  /** Amount spent so far in USD */
  spent: number;
  /** Percentage of budget used (0-100) */
  pct: number;
  /** Budget reset time (epoch seconds) */
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
  /** Called with budget usage info from response headers */
  onBudgetInfo?: (budget: BudgetInfo) => void;
}

/**
 * Stream a chat completion from the LLM proxy.
 * Parses OpenRouter's SSE format (data: {...}\n\n).
 */
export async function streamChat(options: StreamOptions): Promise<void> {
  const { proxyUrl, model, messages, system, authToken, signal, onChunk, onComplete, onError, onBudgetInfo } = options;

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
      // Surface budget/rate limit info for 429
      if (response.status === 429) {
        if (errorBody.type === 'budget') {
          errorDetail = `Monthly budget exhausted ($${errorBody.budgetLimit?.toFixed(2) ?? '?'}/month, ${errorBody.budgetPct ?? 100}% used). Resets ${errorBody.resetAt ? new Date(errorBody.resetAt).toLocaleDateString() : 'next month'}.`;
        } else {
          const resetAt = errorBody.resetAt ? new Date(errorBody.resetAt).toLocaleString() : '';
          errorDetail = `Daily limit reached (${errorBody.limit ?? '?'} requests/day). Resets ${resetAt || 'soon'}.`;
        }
      }
    } catch {
      // ignore parse failure
    }
    onError(new Error(errorDetail));
    return;
  }

  // Extract budget info from response headers
  if (onBudgetInfo) {
    const budgetLimit = parseFloat(response.headers.get('X-Budget-Limit') ?? '0');
    const budgetSpent = parseFloat(response.headers.get('X-Budget-Spent') ?? '0');
    const budgetPct = parseInt(response.headers.get('X-Budget-Pct') ?? '0', 10);
    const budgetReset = parseInt(response.headers.get('X-Budget-Reset') ?? '0', 10);
    if (budgetLimit > 0 || budgetSpent > 0) {
      onBudgetInfo({ limit: budgetLimit, spent: budgetSpent, pct: budgetPct, resetAt: budgetReset });
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
