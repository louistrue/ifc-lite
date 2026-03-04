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
// Clerk JWT verification (lightweight decode + expiry check)
// ---------------------------------------------------------------------------

interface ClerkClaims {
  sub: string;
  features?: string[];
  plan?: string;
  exp: number;
  iss: string;
}

function base64UrlDecode(str: string): string {
  // Replace URL-safe chars and pad
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

async function verifyClerkToken(token: string | undefined): Promise<ClerkClaims | null> {
  if (!token) return null;

  // Lightweight decode + expiry check for initial implementation.
  // TODO: Add full JWKS verification via @clerk/backend in production.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(base64UrlDecode(parts[1])) as ClerkClaims;

    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function corsResponse(status: number, body?: object): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Edge handler
// ---------------------------------------------------------------------------

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return corsResponse(405, { error: 'Method not allowed' });
  }

  // 1. Validate API key exists server-side
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return corsResponse(500, { error: 'OpenRouter API key not configured' });
  }

  // 2. Authenticate user via Clerk JWT (optional for free tier)
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || undefined;
  const claims = await verifyClerkToken(token);

  // 3. Parse request body
  const body = (await req.json()) as {
    messages: Array<{ role: string; content: string }>;
    model: string;
    system?: string;
  };

  if (!body?.messages || !body?.model) {
    return corsResponse(400, { error: 'Missing messages or model' });
  }

  // 4. Model access control
  if (!isAllowedModel(body.model)) {
    return corsResponse(400, { error: `Model not available: ${body.model}` });
  }

  if (isFrontierModel(body.model)) {
    const hasPro = claims?.features?.includes('frontier_models') ||
                   claims?.plan === 'pro';
    if (!hasPro) {
      return corsResponse(403, {
        error: 'Pro subscription required for frontier models',
        upgrade: true,
      });
    }
  }

  // 5. Build OpenRouter request
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

  // 6. Proxy to OpenRouter with streaming
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
    return corsResponse(upstream.status, {
      error: `OpenRouter error: ${upstream.status}`,
      detail: errorText,
    });
  }

  // 7. Stream response back to client
  if (!upstream.body) {
    return corsResponse(502, { error: 'No response body from upstream' });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
