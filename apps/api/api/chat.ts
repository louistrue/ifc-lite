/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Vercel Edge Function — LLM proxy for ifc-lite chat.
 *
 * Validates Clerk JWT, checks subscription tier, then proxies
 * streaming requests to OpenRouter. The OpenRouter API key is
 * stored server-side and never exposed to the client.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// Model tier definitions
// ---------------------------------------------------------------------------

const FREE_MODELS = new Set([
  'meta-llama/llama-4-maverick',
  'google/gemini-2.5-flash',
  'mistralai/mistral-small-3.2',
  'qwen/qwen3-32b',
]);

const FRONTIER_MODELS = new Set([
  'anthropic/claude-sonnet-4',
  'openai/gpt-4.1',
  'google/gemini-2.5-pro',
  'anthropic/claude-3.5-sonnet',
]);

function isFrontierModel(model: string): boolean {
  return FRONTIER_MODELS.has(model);
}

function isAllowedModel(model: string): boolean {
  return FREE_MODELS.has(model) || FRONTIER_MODELS.has(model);
}

// ---------------------------------------------------------------------------
// Clerk JWT verification (lightweight, no SDK dependency at edge)
// ---------------------------------------------------------------------------

interface ClerkClaims {
  sub: string;
  features?: string[];
  plan?: string;
  exp: number;
  iss: string;
}

async function verifyClerkToken(token: string | undefined): Promise<ClerkClaims | null> {
  if (!token) return null;

  // In production, verify the JWT signature against Clerk's JWKS endpoint.
  // For the initial implementation we do a lightweight decode + expiry check.
  // TODO: Add full JWKS verification via @clerk/backend in production.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as ClerkClaims;

    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Edge handler
// ---------------------------------------------------------------------------

export const config = {
  runtime: 'edge',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------------------------------------------------------------------------
  // 1. Validate API key exists server-side
  // ---------------------------------------------------------------------------
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return res.status(500).json({ error: 'OpenRouter API key not configured' });
  }

  // ---------------------------------------------------------------------------
  // 2. Authenticate user via Clerk JWT (optional for free tier)
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.authorization;
  const token = typeof authHeader === 'string'
    ? authHeader.replace('Bearer ', '')
    : undefined;
  const claims = await verifyClerkToken(token);

  // ---------------------------------------------------------------------------
  // 3. Parse request body
  // ---------------------------------------------------------------------------
  const body = req.body as {
    messages: Array<{ role: string; content: string }>;
    model: string;
    system?: string;
  };

  if (!body?.messages || !body?.model) {
    return res.status(400).json({ error: 'Missing messages or model' });
  }

  // ---------------------------------------------------------------------------
  // 4. Model access control
  // ---------------------------------------------------------------------------
  if (!isAllowedModel(body.model)) {
    return res.status(400).json({ error: `Model not available: ${body.model}` });
  }

  if (isFrontierModel(body.model)) {
    // Frontier models require a Pro subscription
    const hasPro = claims?.features?.includes('frontier_models') ||
                   claims?.plan === 'pro';

    if (!hasPro) {
      return res.status(403).json({
        error: 'Pro subscription required for frontier models',
        upgrade: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Build OpenRouter request
  // ---------------------------------------------------------------------------
  const openRouterMessages = body.system
    ? [{ role: 'system', content: body.system }, ...body.messages]
    : body.messages;

  const openRouterBody = {
    model: body.model,
    messages: openRouterMessages,
    stream: true,
    temperature: 0.3,
    max_tokens: 8192,
  };

  // ---------------------------------------------------------------------------
  // 6. Proxy to OpenRouter with streaming
  // ---------------------------------------------------------------------------
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'https://ifc-lite.com',
      'X-Title': 'ifc-lite',
    },
    body: JSON.stringify(openRouterBody),
  });

  if (!upstream.ok) {
    const errorText = await upstream.text();
    return res.status(upstream.status).json({
      error: `OpenRouter error: ${upstream.status}`,
      detail: errorText,
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Stream response back to client
  // ---------------------------------------------------------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!upstream.body) {
    return res.status(502).json({ error: 'No response body from upstream' });
  }

  // Pipe the SSE stream from OpenRouter directly to the client
  const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }
  } catch (err) {
    console.error('[chat proxy] Stream error:', err);
  } finally {
    res.end();
  }
}
