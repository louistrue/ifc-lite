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
 * Required env vars:
 *   LLM_API_KEY
 *   LLM_API_BASE
 *   LLM_FREE_MODELS
 *   LLM_PRO_MODELS
 *   LLM_FREE_DAILY_LIMIT
 *   LLM_PRO_MONTHLY_CREDITS
 *   LLM_COST_TO_CREDITS
 *   APP_URL
 *   DATABASE_URL
 */

import { verifyToken as verifyClerkToken } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const val = process.env[key]?.trim();
  if (!val) {
    throw new Error(`[chat-config] Missing required env var: ${key}`);
  }
  return val;
}

function getEnvSet(key: string): Set<string> {
  const val = requireEnv(key);
  const values = val.split(',').map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`[chat-config] Env var ${key} must include at least one model`);
  }
  return new Set(values);
}

function getEnvInt(key: string): number {
  const val = requireEnv(key);
  const n = parseInt(val, 10);
  if (isNaN(n)) {
    throw new Error(`[chat-config] Env var ${key} must be an integer`);
  }
  return n;
}

const API_BASE = requireEnv('LLM_API_BASE').replace(/\/+$/, '');
const API_KEY = requireEnv('LLM_API_KEY');
const APP_URL = requireEnv('APP_URL');
const FREE_MODELS = getEnvSet('LLM_FREE_MODELS');
const PRO_MODELS = getEnvSet('LLM_PRO_MODELS');
const FREE_DAILY_LIMIT = getEnvInt('LLM_FREE_DAILY_LIMIT');
const PRO_MONTHLY_CREDITS = getEnvInt('LLM_PRO_MONTHLY_CREDITS');
const COST_TO_CREDITS = getEnvInt('LLM_COST_TO_CREDITS');
const DEBUG_CREDITS = process.env.LLM_DEBUG_CREDITS === '1' || process.env.NODE_ENV !== 'production';
const DATABASE_URL = requireEnv('DATABASE_URL');
const neonSql = neon(DATABASE_URL);

function isFreeModel(model: string): boolean {
  return FREE_MODELS.has(model);
}

function isPaidModel(model: string): boolean {
  return PRO_MODELS.has(model);
}

function isAllowedModel(model: string): boolean {
  return FREE_MODELS.has(model) || PRO_MODELS.has(model);
}

function debugCredits(event: string, data: Record<string, unknown>): void {
  if (!DEBUG_CREDITS) return;
  try {
    console.log(`[chat-credit] ${event} ${JSON.stringify(data)}`);
  } catch {
    console.log(`[chat-credit] ${event}`);
  }
}

function summarizeUserId(userId: string): string {
  if (!userId) return 'unknown';
  if (userId.length <= 8) return userId;
  return `${userId.slice(0, 4)}...${userId.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// JWT verification (lightweight decode + expiry check)
// ---------------------------------------------------------------------------

interface AuthClaims {
  sub: string;
  features?: string[];
  plan?: string;
  /** Clerk session JWT v2 plan claim (e.g. "u:pro") */
  pla?: string;
  /** Clerk session JWT v2 features claim (array or comma-separated, e.g. "u:pro_models") */
  fea?: string[] | string;
  exp: number;
  iss: string;
}

function normalizeScopedValue(value: string): string {
  const idx = value.indexOf(':');
  return idx >= 0 ? value.slice(idx + 1) : value;
}

function extractFeatureSet(claims: AuthClaims | null): Set<string> {
  const out = new Set<string>();
  if (!claims) return out;

  for (const f of claims.features ?? []) {
    out.add(normalizeScopedValue(f));
  }

  if (Array.isArray(claims.fea)) {
    for (const f of claims.fea) out.add(normalizeScopedValue(f));
  } else if (typeof claims.fea === 'string') {
    for (const f of claims.fea.split(',')) {
      const trimmed = f.trim();
      if (trimmed) out.add(normalizeScopedValue(trimmed));
    }
  }

  return out;
}

function hasProPlan(claims: AuthClaims | null): boolean {
  if (!claims) return false;
  const plan = claims.plan ?? claims.pla;
  if (!plan) return false;
  return normalizeScopedValue(plan) === 'pro';
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

async function verifyToken(token: string | undefined): Promise<AuthClaims | null> {
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (secretKey) {
    try {
      const payload = await verifyClerkToken(token, { secretKey });
      return payload as AuthClaims;
    } catch {
      return null;
    }
  }

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
  anchorAt: number;
}

const creditBuckets = new Map<string, CreditBucket>();
const freeRequestCounts = new Map<string, { count: number; resetAt: number }>();
const providerUsageWatermarkByUser = new Map<string, number>();
const providerUsageLockByUser = new Map<string, Promise<void>>();
let usageTableReadyPromise: Promise<void> | null = null;

function getNextCycleResetFromAnchor(anchorAt: number, nowMs: number = Date.now()): number {
  let next = new Date(anchorAt);
  if (!Number.isFinite(next.getTime())) {
    next = new Date(nowMs);
  }
  while (next.getTime() <= nowMs) {
    next = new Date(next);
    next.setMonth(next.getMonth() + 1);
  }
  return next.getTime();
}

function getCreditBucket(userId: string): CreditBucket {
  const now = Date.now();
  let bucket = creditBuckets.get(userId);
  if (!bucket) {
    const anchorAt = now;
    bucket = { used: 0, anchorAt, resetAt: getNextCycleResetFromAnchor(anchorAt, now) };
    creditBuckets.set(userId, bucket);
    return bucket;
  }

  if (now >= bucket.resetAt) {
    bucket.used = 0;
    bucket.resetAt = getNextCycleResetFromAnchor(bucket.anchorAt, now);
  }
  return bucket;
}

async function ensureUsageTableReady(): Promise<boolean> {
  if (!usageTableReadyPromise) {
    usageTableReadyPromise = (async () => {
      await neonSql`
        CREATE TABLE IF NOT EXISTS llm_chat_usage (
          user_id TEXT PRIMARY KEY,
          credits_used DOUBLE PRECISION NOT NULL DEFAULT 0,
          billing_anchor_at BIGINT NOT NULL,
          reset_at BIGINT NOT NULL,
          provider_usage_watermark DOUBLE PRECISION NULL,
          updated_at BIGINT NOT NULL
        )
      `;
      await neonSql`
        ALTER TABLE llm_chat_usage
        ADD COLUMN IF NOT EXISTS billing_anchor_at BIGINT
      `;
    })();
  }

  try {
    await usageTableReadyPromise;
    return true;
  } catch (error) {
    debugCredits('db_init_error', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

async function loadUsageStateFromDb(userId: string): Promise<void> {
  if (!(await ensureUsageTableReady())) return;
  const now = Date.now();
  const initialAnchorAt = now;
  const initialResetAt = getNextCycleResetFromAnchor(initialAnchorAt, now);
  try {
    await neonSql`
      INSERT INTO llm_chat_usage (user_id, credits_used, billing_anchor_at, reset_at, provider_usage_watermark, updated_at)
      VALUES (${userId}, 0, ${initialAnchorAt}, ${initialResetAt}, NULL, ${now})
      ON CONFLICT (user_id) DO NOTHING
    `;
    const rows = await neonSql`
      SELECT credits_used, billing_anchor_at, reset_at, provider_usage_watermark
      FROM llm_chat_usage
      WHERE user_id = ${userId}
      LIMIT 1
    ` as Array<{ credits_used: number; billing_anchor_at: number | null; reset_at: number; provider_usage_watermark: number | null }>;
    const row = rows[0];
    if (!row) return;

    let used = typeof row.credits_used === 'number' ? row.credits_used : 0;
    let anchorAt = typeof row.billing_anchor_at === 'number' && row.billing_anchor_at > 0
      ? row.billing_anchor_at
      : initialAnchorAt;
    let resetAt = typeof row.reset_at === 'number' ? row.reset_at : getNextCycleResetFromAnchor(anchorAt, now);
    let watermark = typeof row.provider_usage_watermark === 'number'
      ? row.provider_usage_watermark
      : undefined;

    // Per-user cycle rollover keeps accounting bounded to their billing period.
    if (now >= resetAt) {
      used = 0;
      resetAt = getNextCycleResetFromAnchor(anchorAt, now);
      watermark = undefined;
      await neonSql`
        UPDATE llm_chat_usage
        SET credits_used = 0,
            billing_anchor_at = ${anchorAt},
            reset_at = ${resetAt},
            provider_usage_watermark = NULL,
            updated_at = ${now}
        WHERE user_id = ${userId}
      `;
    }

    creditBuckets.set(userId, { used, anchorAt, resetAt });
    if (watermark === undefined) {
      providerUsageWatermarkByUser.delete(userId);
    } else {
      providerUsageWatermarkByUser.set(userId, watermark);
    }
  } catch (error) {
    debugCredits('db_load_error', {
      userId: summarizeUserId(userId),
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}

async function persistUsageStateToDb(userId: string): Promise<void> {
  if (!(await ensureUsageTableReady())) return;
  const bucket = getCreditBucket(userId);
  const watermark = providerUsageWatermarkByUser.get(userId);
  const now = Date.now();
  try {
    await neonSql`
      INSERT INTO llm_chat_usage (user_id, credits_used, billing_anchor_at, reset_at, provider_usage_watermark, updated_at)
      VALUES (${userId}, ${bucket.used}, ${bucket.anchorAt}, ${bucket.resetAt}, ${watermark ?? null}, ${now})
      ON CONFLICT (user_id)
      DO UPDATE SET
        credits_used = EXCLUDED.credits_used,
        billing_anchor_at = EXCLUDED.billing_anchor_at,
        reset_at = EXCLUDED.reset_at,
        provider_usage_watermark = EXCLUDED.provider_usage_watermark,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (error) {
    debugCredits('db_persist_error', {
      userId: summarizeUserId(userId),
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}

interface ReconcileResult {
  providerUsageUsd: number | null;
  watermarkBeforeUsd: number | null;
  watermarkAfterUsd: number | null;
  deltaUsd: number;
  committedUsd: number;
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
  const before = bucket.used;
  bucket.used += apiCost * COST_TO_CREDITS;
  debugCredits('recorded', {
    userId: summarizeUserId(userId),
    apiCostUsd: Number(apiCost.toFixed(8)),
    costToCredits: COST_TO_CREDITS,
    creditsAdded: Number((apiCost * COST_TO_CREDITS).toFixed(4)),
    bucketBefore: Number(before.toFixed(4)),
    bucketAfter: Number(bucket.used.toFixed(4)),
  });
}

let reqCounter = 0;
function maybePrune() {
  if (++reqCounter % 200 !== 0) return;
  const now = Date.now();
  for (const [k, v] of creditBuckets) { if (now >= v.resetAt) creditBuckets.delete(k); }
  for (const [k, v] of freeRequestCounts) { if (now >= v.resetAt) freeRequestCounts.delete(k); }
  // Keep reconciliation maps bounded by active users.
  if (providerUsageWatermarkByUser.size > 2000) {
    providerUsageWatermarkByUser.clear();
  }
  if (providerUsageLockByUser.size > 2000) {
    providerUsageLockByUser.clear();
  }
}

// ---------------------------------------------------------------------------
// Provider usage reconciliation
// ---------------------------------------------------------------------------

async function fetchCurrentKeyUsage(apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/key`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { usage?: number } };
    const usage = data.data?.usage;
    return typeof usage === 'number' ? usage : null;
  } catch {
    return null;
  }
}

async function withProviderUsageLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const existingLock = providerUsageLockByUser.get(userId);
  if (existingLock) {
    debugCredits('lock_contention', { userId: summarizeUserId(userId) });
  }

  const prev = existingLock ?? Promise.resolve();
  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  providerUsageLockByUser.set(userId, prev.then(() => current));

  await prev;
  try {
    return await run();
  } finally {
    releaseLock();
  }
}

async function reconcileProviderUsage(userId: string, apiKey: string, phase: string): Promise<ReconcileResult> {
  return withProviderUsageLock(userId, async () => {
    const summarizedUserId = summarizeUserId(userId);
    debugCredits('reconcile_start', { userId: summarizedUserId, phase });
    const finish = async (result: ReconcileResult): Promise<ReconcileResult> => {
      await persistUsageStateToDb(userId);
      debugCredits('reconcile_end', { userId: summarizedUserId, phase, ...result });
      return result;
    };

    const providerUsageUsd = await fetchCurrentKeyUsage(apiKey);
    debugCredits('provider_usage_read', {
      userId: summarizedUserId,
      phase,
      providerUsageUsd,
    });

    const watermarkBefore = providerUsageWatermarkByUser.get(userId);
    if (providerUsageUsd === null) {
      const result: ReconcileResult = {
        providerUsageUsd: null,
        watermarkBeforeUsd: watermarkBefore ?? null,
        watermarkAfterUsd: watermarkBefore ?? null,
        deltaUsd: 0,
        committedUsd: 0,
      };
      debugCredits('delta_skipped', {
        userId: summarizedUserId,
        phase,
        reason: 'provider_usage_unavailable',
        watermarkBeforeUsd: result.watermarkBeforeUsd,
      });
      return finish(result);
    }

    // First sighting bootstraps the watermark and does not charge retroactively.
    if (watermarkBefore === undefined) {
      providerUsageWatermarkByUser.set(userId, providerUsageUsd);
      const bucket = getCreditBucket(userId);
      // DB migration/bootstrap path: seed visible usage from provider total once.
      if (bucket.used <= 0 && providerUsageUsd > 0) {
        if (!bucket.anchorAt || bucket.anchorAt <= 0) {
          bucket.anchorAt = Date.now();
          bucket.resetAt = getNextCycleResetFromAnchor(bucket.anchorAt, Date.now());
        }
        bucket.used = providerUsageUsd * COST_TO_CREDITS;
        debugCredits('bootstrap_seeded_from_provider', {
          userId: summarizedUserId,
          phase,
          providerUsageUsd: Number(providerUsageUsd.toFixed(8)),
          seededCreditsUsed: Number(bucket.used.toFixed(4)),
        });
      }
      const result: ReconcileResult = {
        providerUsageUsd,
        watermarkBeforeUsd: null,
        watermarkAfterUsd: providerUsageUsd,
        deltaUsd: 0,
        committedUsd: 0,
      };
      debugCredits('delta_skipped', {
        userId: summarizedUserId,
        phase,
        reason: 'watermark_bootstrap',
        watermarkAfterUsd: result.watermarkAfterUsd,
      });
      return finish(result);
    }

    if (providerUsageUsd < watermarkBefore) {
      providerUsageWatermarkByUser.set(userId, providerUsageUsd);
      const result: ReconcileResult = {
        providerUsageUsd,
        watermarkBeforeUsd: watermarkBefore,
        watermarkAfterUsd: providerUsageUsd,
        deltaUsd: 0,
        committedUsd: 0,
      };
      debugCredits('delta_skipped', {
        userId: summarizedUserId,
        phase,
        reason: 'provider_usage_reset_or_rollover',
        watermarkBeforeUsd: result.watermarkBeforeUsd,
        watermarkAfterUsd: result.watermarkAfterUsd,
      });
      return finish(result);
    }

    const deltaUsd = providerUsageUsd - watermarkBefore;
    if (deltaUsd <= 0) {
      const result: ReconcileResult = {
        providerUsageUsd,
        watermarkBeforeUsd: watermarkBefore,
        watermarkAfterUsd: watermarkBefore,
        deltaUsd: 0,
        committedUsd: 0,
      };
      debugCredits('delta_skipped', {
        userId: summarizedUserId,
        phase,
        reason: 'no_positive_delta',
        watermarkBeforeUsd: result.watermarkBeforeUsd,
        providerUsageUsd: result.providerUsageUsd,
      });
      return finish(result);
    }

    recordCredits(userId, deltaUsd);
    providerUsageWatermarkByUser.set(userId, providerUsageUsd);
    const result: ReconcileResult = {
      providerUsageUsd,
      watermarkBeforeUsd: watermarkBefore,
      watermarkAfterUsd: providerUsageUsd,
      deltaUsd,
      committedUsd: deltaUsd,
    };
    debugCredits('delta_committed', {
      userId: summarizedUserId,
      phase,
      committedUsd: Number(result.committedUsd.toFixed(8)),
      watermarkBeforeUsd: Number((result.watermarkBeforeUsd ?? 0).toFixed(8)),
      watermarkAfterUsd: Number((result.watermarkAfterUsd ?? 0).toFixed(8)),
    });
    return finish({
      ...result,
      committedUsd: Number(result.committedUsd.toFixed(8)),
    });
  });
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'X-Credits-Used, X-Credits-Limit, X-Credits-Pct, X-Credits-Reset, X-Credits-Billable, X-Usage-Used, X-Usage-Limit, X-Usage-Pct, X-Usage-Reset',
};

function corsResponse(status: number, body?: object, extra?: Record<string, string>): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

type UsageTier = 'pro' | 'free';

interface UsageSnapshot {
  type: 'credits' | 'requests';
  used: number;
  limit: number;
  pct: number;
  resetAt: number;
  billable?: boolean;
}

function buildUsageSnapshot(userTier: UsageTier, userId: string, billableRequest: boolean): UsageSnapshot {
  if (userTier === 'pro') {
    const bucket = getCreditBucket(userId);
    const pct = Math.min(100, Math.round((bucket.used / PRO_MONTHLY_CREDITS) * 100));
    return {
      type: 'credits',
      used: Math.round(bucket.used),
      limit: PRO_MONTHLY_CREDITS,
      pct,
      resetAt: Math.ceil(bucket.resetAt / 1000),
      billable: billableRequest,
    };
  }

  const entry = freeRequestCounts.get(userId) ?? { count: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 };
  return {
    type: 'requests',
    used: entry.count,
    limit: FREE_DAILY_LIMIT,
    pct: Math.min(100, Math.round((entry.count / FREE_DAILY_LIMIT) * 100)),
    resetAt: Math.ceil(entry.resetAt / 1000),
  };
}

function buildUsageHeaders(snapshot: UsageSnapshot): Record<string, string> {
  if (snapshot.type === 'credits') {
    return {
      'X-Credits-Used': String(snapshot.used),
      'X-Credits-Limit': String(snapshot.limit),
      'X-Credits-Pct': String(snapshot.pct),
      'X-Credits-Reset': String(snapshot.resetAt),
      'X-Credits-Billable': String(snapshot.billable ?? false),
    };
  }

  return {
    'X-Usage-Used': String(snapshot.used),
    'X-Usage-Limit': String(snapshot.limit),
    'X-Usage-Pct': String(snapshot.pct),
    'X-Usage-Reset': String(snapshot.resetAt),
  };
}

// ---------------------------------------------------------------------------
// Edge handler
// ---------------------------------------------------------------------------

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const supportEmail = 'louis@ltplus.com';
  const url = new URL(req.url);
  const isUsageSnapshotRequest = req.method === 'GET' && url.searchParams.get('usage') === '1';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST' && !isUsageSnapshotRequest) {
    return corsResponse(405, { error: 'Method not allowed' });
  }

  const apiKey = API_KEY;

  // Auth
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || undefined;
  const claims = await verifyToken(token);
  if (token && !claims) {
    return corsResponse(401, {
      error: 'Authentication invalid or expired. Please sign in again.',
      code: 'auth_invalid',
    });
  }

  const featureSet = extractFeatureSet(claims);
  const userTier = (hasProPlan(claims) || featureSet.has('pro_models'))
    ? 'pro' as const
    : 'free' as const;

  const userId = claims?.sub
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'anonymous';

  // Always-available usage snapshot endpoint for instant UI hydration/polling.
  if (isUsageSnapshotRequest) {
    maybePrune();
    if (userTier === 'pro') {
      await loadUsageStateFromDb(userId);
      await reconcileProviderUsage(userId, apiKey, 'usage_snapshot');
    }
    const snapshot = buildUsageSnapshot(userTier, userId, false);
    return corsResponse(200, { usage: snapshot }, buildUsageHeaders(snapshot));
  }

  // Parse body (POST only)
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

  if (userTier === 'free' && isPaidModel(body.model)) {
    return corsResponse(403, {
      error: 'Upgrade to Pro to use this model',
      code: 'plan_required',
      upgrade: true,
    });
  }

  const billableRequest = userTier === 'pro' && !isFreeModel(body.model);

  // Usage checks
  maybePrune();

  if (userTier === 'pro') {
    await loadUsageStateFromDb(userId);
    await reconcileProviderUsage(userId, apiKey, 'pre_limit_check');
  }

  if (userTier === 'free') {
    const cap = checkFreeLimit(userId);
    if (!cap.allowed) {
      return corsResponse(429, {
        error: 'You\'ve reached your daily limit. Upgrade to Pro for more.',
        type: 'request_cap',
        code: 'quota_exceeded',
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
        error: `Monthly credits used up. Need more? Reach out at ${supportEmail}.`,
        type: 'credits',
        code: 'credits_exhausted',
        creditsUsed: Math.round(bucket.used),
        creditsLimit: PRO_MONTHLY_CREDITS,
        resetAt: bucket.resetAt,
        contactEmail: supportEmail,
      }, {
        'Retry-After': String(Math.ceil((bucket.resetAt - Date.now()) / 1000)),
      });
    }
  }

  // Build upstream request
  const upstreamMessages = body.system
    ? [{ role: 'system', content: body.system }, ...body.messages]
    : body.messages;

  debugCredits('request_start', {
    userId: summarizeUserId(userId),
    model: body.model,
    userTier,
    billableRequest,
    isFreeModel: isFreeModel(body.model),
  });

  const upstream = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': APP_URL,
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
      const limitMessage = userTier === 'pro'
        ? 'Request rate limit reached. Please retry shortly.'
        : 'You\'ve reached your daily limit. Upgrade to Pro for more.';
      return corsResponse(429, {
        error: limitMessage,
        type: 'request_cap',
        code: 'quota_exceeded',
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

  const usageHeaders = buildUsageHeaders(buildUsageSnapshot(userTier, userId, billableRequest));

  // Stream through and emit a final server-authoritative usage event.
  const sseEncoder = new TextEncoder();

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
    async flush(controller) {
      if (billableRequest) {
        await reconcileProviderUsage(userId, apiKey, 'post_stream');
      }

      const snapshot = buildUsageSnapshot(userTier, userId, billableRequest);
      const usageEvent = JSON.stringify({
        __ifcLiteUsage: snapshot,
      });
      debugCredits('usage_event_emitted', {
        userId: summarizeUserId(userId),
        usageType: snapshot.type,
        usageUsed: snapshot.used,
        usageLimit: snapshot.limit,
        pct: snapshot.pct,
        billable: billableRequest,
      });
      controller.enqueue(sseEncoder.encode(`data: ${usageEvent}\n\n`));
    },
  });

  upstream.body.pipeTo(writable).catch(() => { });

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
