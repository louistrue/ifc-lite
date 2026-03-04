/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Vercel Edge Function — LLM proxy for ifc-lite chat.
 *
 * Validates Clerk JWT, checks subscription tier, enforces per-user
 * rate limits, then proxies streaming requests to OpenRouter.
 * The OpenRouter API key is stored server-side and never exposed to the client.
 *
 * Rate limits:
 * - Anonymous/free: 20 requests/day on free models only
 * - Pro (authenticated): 100 requests/week on all models
 */

// ---------------------------------------------------------------------------
// Model tier definitions
// ---------------------------------------------------------------------------

const FREE_MODELS = new Set([
  'qwen/qwen3-coder:free',
  'mistralai/devstral-2512:free',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
]);

const BUDGET_MODELS = new Set([
  'qwen/qwen3-coder',
  'x-ai/grok-code-fast-1',
  'minimax/minimax-m2.1',
  'google/gemini-3-flash-preview',
  'z-ai/glm-4.7',
]);

const FRONTIER_MODELS = new Set([
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.5',
  'google/gemini-3-pro-preview',
  'google/gemini-3.1-pro-preview',
  'openai/gpt-5.2-20251211',
  'x-ai/grok-4.1-fast',
]);

function isPaidModel(model: string): boolean {
  return BUDGET_MODELS.has(model) || FRONTIER_MODELS.has(model);
}

function isAllowedModel(model: string): boolean {
  return FREE_MODELS.has(model) || BUDGET_MODELS.has(model) || FRONTIER_MODELS.has(model);
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
// In-memory per-user rate limiting
// ---------------------------------------------------------------------------
// Uses edge function memory (resets on cold start, shared within instance).
// For production at scale, swap for Vercel KV / Upstash Redis.

interface RateBucket {
  count: number;
  resetAt: number; // epoch ms
}

const rateLimits = new Map<string, RateBucket>();

const RATE_LIMITS = {
  /** Anonymous / free users: daily limit on free models */
  free: { maxRequests: 20, windowMs: 24 * 60 * 60 * 1000 },
  /** Pro users: weekly limit on all models */
  pro: { maxRequests: 100, windowMs: 7 * 24 * 60 * 60 * 1000 },
} as const;

/**
 * Check and increment rate limit for a user.
 * Returns remaining requests, or -1 if limit exceeded.
 */
function checkRateLimit(userId: string, tier: 'free' | 'pro'): { remaining: number; resetAt: number } {
  const config = RATE_LIMITS[tier];
  const now = Date.now();
  const key = `${tier}:${userId}`;

  let bucket = rateLimits.get(key);

  // Reset expired buckets
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    rateLimits.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > config.maxRequests) {
    return { remaining: 0, resetAt: bucket.resetAt };
  }

  return { remaining: config.maxRequests - bucket.count, resetAt: bucket.resetAt };
}

// Periodically prune expired entries to prevent memory leaks (every 100 requests)
let requestCounter = 0;
function maybePrune() {
  if (++requestCounter % 100 !== 0) return;
  const now = Date.now();
  for (const [key, bucket] of rateLimits) {
    if (now >= bucket.resetAt) {
      rateLimits.delete(key);
    }
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

function corsResponse(status: number, body?: object, extraHeaders?: Record<string, string>): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
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

  // 3. Parse request body (content can be string or multimodal array for vision)
  const body = (await req.json()) as {
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
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

  if (isPaidModel(body.model)) {
    const hasPro = claims?.features?.includes('frontier_models') ||
                   claims?.plan === 'pro';
    if (!hasPro) {
      return corsResponse(403, {
        error: 'Pro subscription required for budget and frontier models',
        upgrade: true,
      });
    }
  }

  // 5. Rate limiting
  maybePrune();

  const userTier = (claims?.plan === 'pro' || claims?.features?.includes('frontier_models'))
    ? 'pro' as const
    : 'free' as const;

  // Use Clerk user ID if authenticated, otherwise derive from IP
  const userId = claims?.sub
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'anonymous';

  // Free users can only use free models
  if (userTier === 'free' && isPaidModel(body.model)) {
    return corsResponse(403, {
      error: 'Pro subscription required for this model',
      upgrade: true,
    });
  }

  const rateResult = checkRateLimit(userId, userTier);
  if (rateResult.remaining <= 0) {
    const resetDate = new Date(rateResult.resetAt).toISOString();
    const window = userTier === 'free' ? 'daily' : 'weekly';
    return corsResponse(429, {
      error: `Rate limit exceeded. ${RATE_LIMITS[userTier].maxRequests} requests per ${window === 'daily' ? 'day' : 'week'}. Resets at ${resetDate}.`,
      resetAt: rateResult.resetAt,
      limit: RATE_LIMITS[userTier].maxRequests,
      window,
    }, {
      'Retry-After': String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
      'X-RateLimit-Limit': String(RATE_LIMITS[userTier].maxRequests),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(rateResult.resetAt / 1000)),
    });
  }

  // 6. Build OpenRouter request
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

  // 7. Proxy to OpenRouter with streaming
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

  // 8. Stream response back to client with rate limit headers
  if (!upstream.body) {
    return corsResponse(502, { error: 'No response body from upstream' });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-RateLimit-Limit': String(RATE_LIMITS[userTier].maxRequests),
      'X-RateLimit-Remaining': String(rateResult.remaining),
      'X-RateLimit-Reset': String(Math.ceil(rateResult.resetAt / 1000)),
    },
  });
}
