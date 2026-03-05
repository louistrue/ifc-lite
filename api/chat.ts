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
// JWT verification (Edge-safe, networkless when CLERK_JWT_KEY is set)
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

function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s+/g, '');
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return base64ToBytes(padded);
}

function normalizePemKey(input: string): string {
  let key = input.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith('\'') && key.endsWith('\''))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n').replace(/\\ /g, ' ').trim();
}

function pemToDerBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/['"]/g, '')
    .trim();
  return base64ToBytes(body);
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

async function verifyJwtWithPublicKey(token: string, jwtKeyPem: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(base64UrlDecode(headerB64)) as JwtHeader;
    if (header.alg !== 'RS256') return false;

    const key = await crypto.subtle.importKey(
      'spki',
      Uint8Array.from(pemToDerBytes(normalizePemKey(jwtKeyPem))),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const data = Uint8Array.from(new TextEncoder().encode(`${headerB64}.${payloadB64}`));
    const signature = Uint8Array.from(base64UrlToBytes(signatureB64));
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      data,
    );
  } catch {
    return false;
  }
}

type ClerkJwk = JsonWebKey & { kid?: string };
const jwksCache = new Map<string, { keys: ClerkJwk[]; expiresAt: number }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

function isTrustedClerkIssuer(iss: string): boolean {
  try {
    const url = new URL(iss);
    if (url.protocol !== 'https:') return false;
    return url.hostname.endsWith('.clerk.accounts.dev') || url.hostname.endsWith('.clerk.com');
  } catch {
    return false;
  }
}

async function getJwksForIssuer(iss: string): Promise<ClerkJwk[]> {
  const now = Date.now();
  const cached = jwksCache.get(iss);
  if (cached && cached.expiresAt > now) return cached.keys;

  const res = await fetch(`${iss.replace(/\/+$/, '')}/.well-known/jwks.json`);
  if (!res.ok) return [];
  const data = (await res.json()) as { keys?: ClerkJwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.set(iss, { keys, expiresAt: now + JWKS_TTL_MS });
  return keys;
}

async function verifyJwtWithIssuerJwks(token: string, iss: string): Promise<boolean> {
  try {
    if (!isTrustedClerkIssuer(iss)) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(base64UrlDecode(headerB64)) as JwtHeader;
    if (header.alg !== 'RS256' || !header.kid) return false;

    const jwks = await getJwksForIssuer(iss);
    const jwk = jwks.find((k) => k.kid === header.kid && (k.kty === 'RSA' || !k.kty));
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = Uint8Array.from(new TextEncoder().encode(`${headerB64}.${payloadB64}`));
    const signature = Uint8Array.from(base64UrlToBytes(signatureB64));
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      data,
    );
  } catch {
    return false;
  }
}

async function verifyToken(token: string | undefined): Promise<AuthClaims | null> {
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as AuthClaims;
    const jwtKey = process.env.CLERK_JWT_KEY?.trim();
    let valid = false;
    if (jwtKey) {
      valid = await verifyJwtWithPublicKey(token, jwtKey);
    }
    if (!valid && payload.iss) {
      valid = await verifyJwtWithIssuerJwks(token, payload.iss);
    }
    if (!valid) return null;
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
const ANONYMOUS_USER_ID = 'anonymous';
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
      INSERT INTO llm_chat_usage (user_id, credits_used, billing_anchor_at, reset_at, updated_at)
      VALUES (${userId}, 0, ${initialAnchorAt}, ${initialResetAt}, ${now})
      ON CONFLICT (user_id) DO NOTHING
    `;
    const rows = await neonSql`
      SELECT credits_used, billing_anchor_at, reset_at
      FROM llm_chat_usage
      WHERE user_id = ${userId}
      LIMIT 1
    ` as Array<{ credits_used: number; billing_anchor_at: number | null; reset_at: number }>;
    const row = rows[0];
    if (!row) return;

    let used = typeof row.credits_used === 'number' ? row.credits_used : 0;
    let anchorAt = typeof row.billing_anchor_at === 'number' && row.billing_anchor_at > 0
      ? row.billing_anchor_at
      : initialAnchorAt;
    let resetAt = typeof row.reset_at === 'number' ? row.reset_at : getNextCycleResetFromAnchor(anchorAt, now);

    // Per-user cycle rollover keeps accounting bounded to their billing period.
    if (now >= resetAt) {
      used = 0;
      resetAt = getNextCycleResetFromAnchor(anchorAt, now);
      await neonSql`
        UPDATE llm_chat_usage
        SET credits_used = 0,
            billing_anchor_at = ${anchorAt},
            reset_at = ${resetAt},
            updated_at = ${now}
        WHERE user_id = ${userId}
      `;
    }

    creditBuckets.set(userId, { used, anchorAt, resetAt });
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
  const now = Date.now();
  try {
    await neonSql`
      INSERT INTO llm_chat_usage (user_id, credits_used, billing_anchor_at, reset_at, updated_at)
      VALUES (${userId}, ${bucket.used}, ${bucket.anchorAt}, ${bucket.resetAt}, ${now})
      ON CONFLICT (user_id)
      DO UPDATE SET
        credits_used = EXCLUDED.credits_used,
        billing_anchor_at = EXCLUDED.billing_anchor_at,
        reset_at = EXCLUDED.reset_at,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (error) {
    debugCredits('db_persist_error', {
      userId: summarizeUserId(userId),
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
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
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return APP_URL;
  if (requestOrigin === APP_URL) return requestOrigin;

  const extraAllowedOrigins = (process.env.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extraAllowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      const url = new URL(requestOrigin);
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (isLocalhost && (url.protocol === 'http:' || url.protocol === 'https:')) {
        return requestOrigin;
      }
    } catch {
      // Invalid origins fall through to APP_URL.
    }
  }

  return APP_URL;
}

function getCorsHeaders(requestOrigin: string | null): Record<string, string> {
  return {
  'Access-Control-Allow-Origin': getAllowedOrigin(requestOrigin),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'X-Credits-Used, X-Credits-Limit, X-Credits-Pct, X-Credits-Reset, X-Credits-Billable, X-Usage-Used, X-Usage-Limit, X-Usage-Pct, X-Usage-Reset',
  Vary: 'Origin',
};
}

function corsResponse(status: number, requestOrigin: string | null, body?: object, extra?: Record<string, string>): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...getCorsHeaders(requestOrigin), 'Content-Type': 'application/json', ...extra },
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
  const requestOrigin = req.headers.get('origin');
  const isUsageSnapshotRequest = req.method === 'GET' && url.searchParams.get('usage') === '1';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: getCorsHeaders(requestOrigin) });
  }
  if (req.method !== 'POST' && !isUsageSnapshotRequest) {
    return corsResponse(405, requestOrigin, { error: 'Method not allowed' });
  }

  const apiKey = API_KEY;

  // Auth
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || undefined;
  const jwtVerificationEnabled = Boolean(process.env.CLERK_JWT_KEY?.trim());
  const claims = await verifyToken(token);
  if (token && !claims && jwtVerificationEnabled) {
    return corsResponse(401, requestOrigin, {
      error: 'Authentication invalid or expired. Please sign in again.',
      code: 'auth_invalid',
    });
  }

  const featureSet = extractFeatureSet(claims);
  const userTier = (hasProPlan(claims) || featureSet.has('pro_models'))
    ? 'pro' as const
    : 'free' as const;

  const userId = claims?.sub ?? ANONYMOUS_USER_ID;

  // Always-available usage snapshot endpoint for instant UI hydration/polling.
  if (isUsageSnapshotRequest) {
    maybePrune();
    if (userTier === 'pro') {
      await loadUsageStateFromDb(userId);
    }
    const snapshot = buildUsageSnapshot(userTier, userId, false);
    return corsResponse(200, requestOrigin, { usage: snapshot }, buildUsageHeaders(snapshot));
  }

  // Parse body (POST only)
  let body: {
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    model: string;
    system?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return corsResponse(400, requestOrigin, { error: 'Invalid JSON body' });
  }

  if (!body?.messages || !body?.model) {
    return corsResponse(400, requestOrigin, { error: 'Missing messages or model' });
  }

  if (!isAllowedModel(body.model)) {
    return corsResponse(400, requestOrigin, { error: 'Model not available' });
  }

  if (userTier === 'free' && isPaidModel(body.model)) {
    return corsResponse(403, requestOrigin, {
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
  }

  if (userTier === 'free') {
    const cap = checkFreeLimit(userId);
    if (!cap.allowed) {
      return corsResponse(429, requestOrigin, {
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
      return corsResponse(429, requestOrigin, {
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
      return corsResponse(429, requestOrigin, {
        error: limitMessage,
        type: 'request_cap',
        code: 'quota_exceeded',
        limit: FREE_DAILY_LIMIT,
      });
    }

    if (upstream.status === 402) {
      return corsResponse(502, requestOrigin, {
        error: 'Service temporarily unavailable. Please try again later.',
      });
    }

    return corsResponse(upstream.status, requestOrigin, {
      error: `Request failed (${upstream.status}). Please try again.`,
    });
  }

  if (!upstream.body) {
    return corsResponse(502, requestOrigin, { error: 'No response body' });
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
        // Bill per request to avoid attributing shared provider key totals to a single user.
        recordCredits(userId, 1 / COST_TO_CREDITS);
        await persistUsageStateToDb(userId);
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

  upstream.body.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    status: 200,
    headers: {
      ...getCorsHeaders(requestOrigin),
      ...usageHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
