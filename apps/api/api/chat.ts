/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Vercel Edge Function — LLM proxy for ifc-lite chat.
 *
 * Validates Clerk JWT, checks subscription tier, enforces per-user
 * **budget-based** limits, then proxies streaming requests to OpenRouter.
 *
 * Budget limits (monthly, auto-reset):
 * - Anonymous/free: $0 budget — free models only (OpenRouter covers cost)
 * - Pro (authenticated): $5/month — any model, tracked via OpenRouter cost
 *
 * After each streamed response, the proxy polls OpenRouter's
 * GET /api/v1/generation?id={id} to get the actual cost and accumulates
 * it against the user's monthly budget.
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

const PRO_MODELS = new Set([
  // $ cheap
  'qwen/qwen3-coder',
  'google/gemini-3-flash-preview',
  'minimax/minimax-m2.1',
  'z-ai/glm-4.7',
  // $$ moderate
  'x-ai/grok-code-fast-1',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.2',
  'x-ai/grok-4.1-fast',
  // $$$ expensive
  'google/gemini-3-pro-preview',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-opus-4.5',
]);

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
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Budget-based per-user spending tracker
// ---------------------------------------------------------------------------
// Uses edge function memory (resets on cold start).
// For production at scale, swap for Vercel KV / Upstash Redis.

interface BudgetBucket {
  /** Cumulative spend in USD this period */
  spent: number;
  /** When this budget period resets (epoch ms, monthly) */
  resetAt: number;
}

const budgets = new Map<string, BudgetBucket>();

/** Monthly budget per tier in USD */
const MONTHLY_BUDGETS = {
  free: 0,   // Free users can only use free models (zero cost to us)
  pro: 5.00, // $5/month budget for pro users
} as const;

/** Daily request cap for free users (prevents abuse even on free models) */
const FREE_DAILY_REQUEST_CAP = 50;
const freeRequestCounts = new Map<string, { count: number; resetAt: number }>();

function getMonthlyResetTime(): number {
  const now = new Date();
  // Reset on the 1st of next month
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.getTime();
}

function getBudget(userId: string, tier: 'free' | 'pro'): BudgetBucket {
  const key = `${tier}:${userId}`;
  let bucket = budgets.get(key);
  const now = Date.now();

  if (!bucket || now >= bucket.resetAt) {
    bucket = { spent: 0, resetAt: getMonthlyResetTime() };
    budgets.set(key, bucket);
  }

  return bucket;
}

function checkFreeRequestCap(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = freeRequestCounts.get(userId);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };
    freeRequestCounts.set(userId, entry);
  }

  entry.count++;
  if (entry.count > FREE_DAILY_REQUEST_CAP) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: FREE_DAILY_REQUEST_CAP - entry.count, resetAt: entry.resetAt };
}

function recordSpend(userId: string, tier: 'free' | 'pro', cost: number): void {
  const bucket = getBudget(userId, tier);
  bucket.spent += cost;
}

// Prune expired entries every 200 requests
let requestCounter = 0;
function maybePrune() {
  if (++requestCounter % 200 !== 0) return;
  const now = Date.now();
  for (const [key, bucket] of budgets) {
    if (now >= bucket.resetAt) budgets.delete(key);
  }
  for (const [key, entry] of freeRequestCounts) {
    if (now >= entry.resetAt) freeRequestCounts.delete(key);
  }
}

// ---------------------------------------------------------------------------
// OpenRouter cost tracking
// ---------------------------------------------------------------------------

/**
 * Poll OpenRouter for generation cost. Called after stream completes.
 * Returns total_cost in USD, or 0 if unavailable.
 */
async function fetchGenerationCost(generationId: string, apiKey: string): Promise<number> {
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
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
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'X-Budget-Limit, X-Budget-Spent, X-Budget-Pct, X-Budget-Reset, X-Usage-Used, X-Usage-Limit, X-Usage-Pct, X-Usage-Reset',
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

  // 3. Parse request body
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

  const userTier = (claims?.plan === 'pro' || claims?.features?.includes('frontier_models'))
    ? 'pro' as const
    : 'free' as const;

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

  // 5. Budget / rate checks
  maybePrune();

  if (userTier === 'free') {
    // Free tier: daily request cap (free models cost us $0 but we cap abuse)
    const capResult = checkFreeRequestCap(userId);
    if (!capResult.allowed) {
      return corsResponse(429, {
        error: `Daily limit reached (${FREE_DAILY_REQUEST_CAP} requests/day on free models). Resets ${new Date(capResult.resetAt).toISOString()}.`,
        resetAt: capResult.resetAt,
        limit: FREE_DAILY_REQUEST_CAP,
        window: 'day',
        type: 'request_cap',
      }, {
        'Retry-After': String(Math.ceil((capResult.resetAt - Date.now()) / 1000)),
      });
    }
  } else {
    // Pro tier: check monthly budget
    const bucket = getBudget(userId, 'pro');
    const budgetLimit = MONTHLY_BUDGETS.pro;
    if (bucket.spent >= budgetLimit) {
      const pctUsed = 100;
      return corsResponse(429, {
        error: `Monthly budget exhausted ($${budgetLimit.toFixed(2)}/month). Resets ${new Date(bucket.resetAt).toISOString()}.`,
        resetAt: bucket.resetAt,
        budgetLimit,
        budgetSpent: bucket.spent,
        budgetPct: pctUsed,
        type: 'budget',
      }, {
        'Retry-After': String(Math.ceil((bucket.resetAt - Date.now()) / 1000)),
      });
    }
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

    // If OpenRouter returns 429 (rate limit), provide a helpful message
    if (upstream.status === 429) {
      // OpenRouter free tier: 50 req/day shared across all free models
      return corsResponse(429, {
        error: 'OpenRouter rate limit reached. Free models share a 50 requests/day limit on OpenRouter. Please wait a minute and try again, or try a different model.',
        type: 'openrouter_limit',
        detail: errorText,
      });
    }

    // If OpenRouter returns 402 (payment required / no credits)
    if (upstream.status === 402) {
      return corsResponse(502, {
        error: 'OpenRouter credits exhausted. The server API key needs more credits.',
        detail: errorText,
      });
    }

    return corsResponse(upstream.status, {
      error: `OpenRouter error: ${upstream.status}`,
      detail: errorText,
    });
  }

  if (!upstream.body) {
    return corsResponse(502, { error: 'No response body from upstream' });
  }

  // 8. Build usage info headers for client display
  const usageHeaders: Record<string, string> = {};

  if (userTier === 'pro') {
    const bucket = getBudget(userId, 'pro');
    const budgetLimit = MONTHLY_BUDGETS.pro;
    const budgetPct = Math.min(100, Math.round((bucket.spent / budgetLimit) * 100));
    usageHeaders['X-Budget-Limit'] = String(budgetLimit);
    usageHeaders['X-Budget-Spent'] = String(bucket.spent.toFixed(4));
    usageHeaders['X-Budget-Pct'] = String(budgetPct);
    usageHeaders['X-Budget-Reset'] = String(Math.ceil(bucket.resetAt / 1000));
  } else {
    // Free tier: show request count / cap
    let entry = freeRequestCounts.get(userId);
    if (!entry) entry = { count: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 };
    usageHeaders['X-Usage-Used'] = String(entry.count);
    usageHeaders['X-Usage-Limit'] = String(FREE_DAILY_REQUEST_CAP);
    usageHeaders['X-Usage-Pct'] = String(Math.min(100, Math.round((entry.count / FREE_DAILY_REQUEST_CAP) * 100)));
    usageHeaders['X-Usage-Reset'] = String(Math.ceil(entry.resetAt / 1000));
  }

  // 9. Stream response, intercepting generation ID for cost tracking
  // We use a TransformStream to pass data through while extracting the gen ID.
  let generationId: string | null = null;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      // Try to extract generation ID from SSE chunks
      if (!generationId) {
        const text = new TextDecoder().decode(chunk);
        const idMatch = text.match(/"id"\s*:\s*"(gen-[^"]+)"/);
        if (idMatch) {
          generationId = idMatch[1];
        }
      }
    },
    async flush() {
      // After stream ends, fetch generation cost and record spend
      if (generationId && userTier === 'pro' && !isFreeModel(body.model)) {
        // Fire-and-forget: don't block the response
        fetchGenerationCost(generationId, openRouterKey!).then((cost) => {
          if (cost > 0) {
            recordSpend(userId, userTier, cost);
          }
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
