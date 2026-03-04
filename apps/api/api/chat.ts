/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Vercel Edge Function — LLM chat proxy.
 *
 * Authenticates users, enforces usage limits, and proxies streaming
 * requests to the configured LLM provider. All model IDs, limits,
 * and API configuration are read from environment variables.
 *
 * Env vars (set in Vercel project settings):
 *   LLM_API_KEY          — provider API key
 *   LLM_API_BASE         — provider base URL
 *   LLM_FREE_MODELS      — comma-separated free model IDs
 *   LLM_PRO_MODELS       — comma-separated pro model IDs
 *   LLM_FREE_DAILY_LIMIT — daily request cap for free users (default: 50)
 *   LLM_PRO_MONTHLY_CREDITS — monthly credit allowance for pro users (default: 1000)
 *   LLM_COST_TO_CREDITS  — multiplier: API cost × this = credits consumed (default: 200)
 *   APP_URL              — app URL for referer header
 */

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

function getEnvSet(key: string, fallback: string[]): Set<string> {
  const val = process.env[key];
  if (!val) return new Set(fallback);
  return new Set(val.split(',').map((s) => s.trim()).filter(Boolean));
}

function getEnvInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

const API_BASE = (process.env.LLM_API_BASE ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');

const FREE_MODELS = getEnvSet('LLM_FREE_MODELS', [
  'qwen/qwen3-coder:free',
  'mistralai/devstral-2512:free',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
]);

const PRO_MODELS = getEnvSet('LLM_PRO_MODELS', [
  'qwen/qwen3-coder',
  'google/gemini-3-flash-preview',
  'minimax/minimax-m2.1',
  'z-ai/glm-4.7',
  'x-ai/grok-code-fast-1',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.2',
  'x-ai/grok-4.1-fast',
  'google/gemini-3-pro-preview',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-opus-4.5',
]);

const FREE_DAILY_LIMIT = getEnvInt('LLM_FREE_DAILY_LIMIT', 50);
const PRO_MONTHLY_CREDITS = getEnvInt('LLM_PRO_MONTHLY_CREDITS', 1000);
const COST_TO_CREDITS = getEnvInt('LLM_COST_TO_CREDITS', 200);

function isFreeModel(model: string): boolean {
  return FREE_MODELS.has(model);
}

function isPaidModel(model: string): boolean {
  return PRO_MODELS.has(model);
}

function isAllowedModel(model: string): boolean {
  return FREE_MODELS.has(model) || PRO_MODELS.has(model);
}

// ---------------------------------------------------------------------------
// JWT verification (lightweight decode + expiry check)
// ---------------------------------------------------------------------------

interface AuthClaims {
  sub: string;
  features?: string[];
  plan?: string;
  exp: number;
  iss: string;
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

async function verifyToken(token: string | undefined): Promise<AuthClaims | null> {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as AuthClaims;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-user usage tracking (in-memory, resets on cold start)
// ---------------------------------------------------------------------------

interface CreditBucket {
  used: number;
  resetAt: number;
}

const creditBuckets = new Map<string, CreditBucket>();
const freeRequestCounts = new Map<string, { count: number; resetAt: number }>();

function getMonthlyResetTime(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
}

function getCreditBucket(userId: string): CreditBucket {
  const now = Date.now();
  let bucket = creditBuckets.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { used: 0, resetAt: getMonthlyResetTime() };
    creditBuckets.set(userId, bucket);
  }
  return bucket;
}

function checkFreeLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = freeRequestCounts.get(userId);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };
    freeRequestCounts.set(userId, entry);
  }
  entry.count++;
  if (entry.count > FREE_DAILY_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: FREE_DAILY_LIMIT - entry.count, resetAt: entry.resetAt };
}

function recordCredits(userId: string, apiCost: number): void {
  const bucket = getCreditBucket(userId);
  bucket.used += apiCost * COST_TO_CREDITS;
}

let reqCounter = 0;
function maybePrune() {
  if (++reqCounter % 200 !== 0) return;
  const now = Date.now();
  for (const [k, v] of creditBuckets) { if (now >= v.resetAt) creditBuckets.delete(k); }
  for (const [k, v] of freeRequestCounts) { if (now >= v.resetAt) freeRequestCounts.delete(k); }
}

// ---------------------------------------------------------------------------
// Cost tracking — poll provider for generation cost after stream
// ---------------------------------------------------------------------------

async function fetchGenerationCost(generationId: string, apiKey: string): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/generation?id=${generationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { data?: { total_cost?: number } };
    return data.data?.total_cost ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'X-Credits-Used, X-Credits-Limit, X-Credits-Pct, X-Credits-Reset, X-Usage-Used, X-Usage-Limit, X-Usage-Pct, X-Usage-Reset',
};

function corsResponse(status: number, body?: object, extra?: Record<string, string>): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

// ---------------------------------------------------------------------------
// Edge handler
// ---------------------------------------------------------------------------

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return corsResponse(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return corsResponse(500, { error: 'AI service not configured. Please contact support.' });
  }

  // Auth
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || undefined;
  const claims = await verifyToken(token);

  // Parse body
  const body = (await req.json()) as {
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    model: string;
    system?: string;
  };

  if (!body?.messages || !body?.model) {
    return corsResponse(400, { error: 'Missing messages or model' });
  }

  if (!isAllowedModel(body.model)) {
    return corsResponse(400, { error: 'Model not available' });
  }

  const userTier = (claims?.plan === 'pro' || claims?.features?.includes('pro_models'))
    ? 'pro' as const
    : 'free' as const;

  const userId = claims?.sub
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'anonymous';

  if (userTier === 'free' && isPaidModel(body.model)) {
    return corsResponse(403, {
      error: 'Upgrade to Pro to use this model',
      upgrade: true,
    });
  }

  // Usage checks
  maybePrune();

  if (userTier === 'free') {
    const cap = checkFreeLimit(userId);
    if (!cap.allowed) {
      return corsResponse(429, {
        error: 'You\'ve reached your daily limit. Upgrade to Pro for more.',
        type: 'request_cap',
        limit: FREE_DAILY_LIMIT,
        resetAt: cap.resetAt,
      }, {
        'Retry-After': String(Math.ceil((cap.resetAt - Date.now()) / 1000)),
      });
    }
  } else {
    const bucket = getCreditBucket(userId);
    if (bucket.used >= PRO_MONTHLY_CREDITS) {
      return corsResponse(429, {
        error: 'Monthly credits used up. Resets next month.',
        type: 'credits',
        creditsUsed: Math.round(bucket.used),
        creditsLimit: PRO_MONTHLY_CREDITS,
        resetAt: bucket.resetAt,
      }, {
        'Retry-After': String(Math.ceil((bucket.resetAt - Date.now()) / 1000)),
      });
    }
  }

  // Build upstream request
  const upstreamMessages = body.system
    ? [{ role: 'system', content: body.system }, ...body.messages]
    : body.messages;

  const upstream = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'https://ifc-lite.com',
      'X-Title': 'ifc-lite',
    },
    body: JSON.stringify({
      model: body.model,
      messages: upstreamMessages,
      stream: true,
      temperature: 0.3,
      max_tokens: 8192,
    }),
  });

  if (!upstream.ok) {
    const _errorText = await upstream.text();

    if (upstream.status === 429) {
      return corsResponse(429, {
        error: 'You\'ve reached your daily limit. Upgrade to Pro for more.',
        type: 'request_cap',
        limit: FREE_DAILY_LIMIT,
      });
    }

    if (upstream.status === 402) {
      return corsResponse(502, {
        error: 'Service temporarily unavailable. Please try again later.',
      });
    }

    return corsResponse(upstream.status, {
      error: `Request failed (${upstream.status}). Please try again.`,
    });
  }

  if (!upstream.body) {
    return corsResponse(502, { error: 'No response body' });
  }

  // Usage headers
  const usageHeaders: Record<string, string> = {};

  if (userTier === 'pro') {
    const bucket = getCreditBucket(userId);
    const pct = Math.min(100, Math.round((bucket.used / PRO_MONTHLY_CREDITS) * 100));
    usageHeaders['X-Credits-Used'] = String(Math.round(bucket.used));
    usageHeaders['X-Credits-Limit'] = String(PRO_MONTHLY_CREDITS);
    usageHeaders['X-Credits-Pct'] = String(pct);
    usageHeaders['X-Credits-Reset'] = String(Math.ceil(bucket.resetAt / 1000));
  } else {
    let entry = freeRequestCounts.get(userId);
    if (!entry) entry = { count: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 };
    usageHeaders['X-Usage-Used'] = String(entry.count);
    usageHeaders['X-Usage-Limit'] = String(FREE_DAILY_LIMIT);
    usageHeaders['X-Usage-Pct'] = String(Math.min(100, Math.round((entry.count / FREE_DAILY_LIMIT) * 100)));
    usageHeaders['X-Usage-Reset'] = String(Math.ceil(entry.resetAt / 1000));
  }

  // Stream through, capturing generation ID for cost tracking
  let generationId: string | null = null;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (!generationId) {
        const text = new TextDecoder().decode(chunk);
        const m = text.match(/"id"\s*:\s*"(gen-[^"]+)"/);
        if (m) generationId = m[1];
      }
    },
    async flush() {
      if (generationId && userTier === 'pro' && !isFreeModel(body.model)) {
        fetchGenerationCost(generationId, apiKey!).then((cost) => {
          if (cost > 0) recordCredits(userId, cost);
        }).catch(() => {});
      }
    },
  });

  upstream.body.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...usageHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
