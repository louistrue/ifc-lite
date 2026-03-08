/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface ChatConfig {
  apiBase: string;
  apiKey: string;
  appUrl: string;
  allowedOrigins: string[];
  freeModels: Set<string>;
  proModels: Set<string>;
  freeDailyLimit: number;
  proMonthlyCredits: number;
  costToCredits: number;
  debugCredits: boolean;
  clerkJwtKey?: string;
  clerkAllowedIssuers: Set<string>;
  clerkAudiences: Set<string>;
  clerkAuthorizedParties: Set<string>;
}

export interface AuthClaims {
  sub: string;
  features?: string[];
  plan?: string;
  pla?: string;
  fea?: string[] | string;
  exp: number;
  iss: string;
  aud?: string | string[];
  azp?: string;
}

export type UsageTier = 'pro' | 'free';

export interface UsageSnapshot {
  type: 'credits' | 'requests';
  used: number;
  limit: number;
  pct: number;
  resetAt: number;
  billable?: boolean;
}

export interface UsageReservationResult {
  allowed: boolean;
  snapshot: UsageSnapshot;
}

export interface ChatUsageStore {
  getUsageSnapshot(userId: string, tier: UsageTier): Promise<UsageSnapshot>;
  consumeFreeRequest(userId: string): Promise<UsageReservationResult>;
  reserveProCredits(userId: string, credits: number): Promise<UsageReservationResult>;
  releaseProCredits(userId: string, credits: number): Promise<void>;
}

export interface ChatHandlerDeps {
  fetchImpl: typeof fetch;
  usageStore: ChatUsageStore;
  now: () => number;
}

type HeaderBag = Headers | Record<string, string | string[] | undefined> | undefined;

type HandlerRequest = Request | {
  method?: string;
  url?: string;
  headers?: HeaderBag;
  json?: () => Promise<unknown>;
  body?: unknown;
};

interface JwtHeader {
  alg?: string;
  kid?: string;
}

type ClerkJwk = JsonWebKey & { kid?: string };

const jwksCache = new Map<string, { keys: ClerkJwk[]; expiresAt: number }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

export function requireEnv(key: string, env: Record<string, string | undefined> = process.env): string {
  const val = env[key]?.trim();
  if (!val) {
    throw new Error(`[chat-config] Missing required env var: ${key}`);
  }
  return val;
}

function getEnvSet(key: string, env: Record<string, string | undefined> = process.env): Set<string> {
  const val = requireEnv(key, env);
  const values = val.split(',').map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new Error(`[chat-config] Env var ${key} must include at least one model`);
  }
  return new Set(values);
}

function getOptionalEnvSet(keys: string[], env: Record<string, string | undefined> = process.env): Set<string> {
  for (const key of keys) {
    const val = env[key]?.trim();
    if (!val) continue;
    return new Set(val.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return new Set();
}

function getEnvInt(key: string, env: Record<string, string | undefined> = process.env): number {
  const val = requireEnv(key, env);
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) {
    throw new Error(`[chat-config] Env var ${key} must be an integer`);
  }
  return n;
}

function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

export function loadChatConfig(env: Record<string, string | undefined> = process.env): ChatConfig {
  const proModelsLow = getOptionalEnvSet(['LLM_PRO_MODELS_LOW'], env);
  const proModelsMedium = getOptionalEnvSet(['LLM_PRO_MODELS_MEDIUM'], env);
  const proModelsHigh = getOptionalEnvSet(['LLM_PRO_MODELS_HIGH'], env);
  const hasCostBuckets = proModelsLow.size > 0 || proModelsMedium.size > 0 || proModelsHigh.size > 0;
  const proModels = hasCostBuckets
    ? new Set([...proModelsLow, ...proModelsMedium, ...proModelsHigh])
    : getEnvSet('LLM_PRO_MODELS', env);
  const clerkAllowedIssuers = getOptionalEnvSet(['CLERK_ALLOWED_ISSUERS', 'CLERK_ISSUER_URL'], env);

  return {
    apiBase: requireEnv('LLM_API_BASE', env).replace(/\/+$/, ''),
    apiKey: requireEnv('LLM_API_KEY', env),
    appUrl: requireEnv('APP_URL', env),
    allowedOrigins: (env.APP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    freeModels: getEnvSet('LLM_FREE_MODELS', env),
    proModels,
    freeDailyLimit: getEnvInt('LLM_FREE_DAILY_LIMIT', env),
    proMonthlyCredits: getEnvInt('LLM_PRO_MONTHLY_CREDITS', env),
    costToCredits: getEnvInt('LLM_COST_TO_CREDITS', env),
    debugCredits: env.LLM_DEBUG_CREDITS === '1' || env.NODE_ENV !== 'production',
    clerkJwtKey: env.CLERK_JWT_KEY?.trim() || undefined,
    clerkAllowedIssuers: new Set([...clerkAllowedIssuers].map(normalizeIssuer)),
    clerkAudiences: getOptionalEnvSet(['CLERK_JWT_AUDIENCE', 'CLERK_JWT_AUDIENCES'], env),
    clerkAuthorizedParties: getOptionalEnvSet(['CLERK_AUTHORIZED_PARTY', 'CLERK_AUTHORIZED_PARTIES'], env),
  };
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
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  } catch {
    return false;
  }
}

function normalizeScopedValue(value: string): string {
  const idx = value.indexOf(':');
  return idx >= 0 ? value.slice(idx + 1) : value;
}

export function extractFeatureSet(claims: AuthClaims | null): Set<string> {
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

export function hasProPlan(claims: AuthClaims | null): boolean {
  if (!claims) return false;
  const plan = claims.plan ?? claims.pla;
  if (!plan) return false;
  return normalizeScopedValue(plan) === 'pro';
}

function matchesExpectedAudience(claims: AuthClaims, config: ChatConfig): boolean {
  if (config.clerkAudiences.size === 0) return true;
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  return audiences.some((aud) => config.clerkAudiences.has(aud));
}

function matchesExpectedAuthorizedParty(claims: AuthClaims, config: ChatConfig): boolean {
  if (config.clerkAuthorizedParties.size === 0) return true;
  return typeof claims.azp === 'string' && config.clerkAuthorizedParties.has(claims.azp);
}

function areClaimsAllowed(claims: AuthClaims, config: ChatConfig): boolean {
  if (config.clerkAllowedIssuers.size === 0) return false;
  if (!claims.iss || !config.clerkAllowedIssuers.has(normalizeIssuer(claims.iss))) return false;
  if (!matchesExpectedAudience(claims, config)) return false;
  if (!matchesExpectedAuthorizedParty(claims, config)) return false;
  return true;
}

async function getJwksForIssuer(iss: string, fetchImpl: typeof fetch): Promise<ClerkJwk[]> {
  const normalizedIssuer = normalizeIssuer(iss);
  const now = Date.now();
  const cached = jwksCache.get(normalizedIssuer);
  if (cached && cached.expiresAt > now) return cached.keys;

  const res = await fetchImpl(`${normalizedIssuer}/.well-known/jwks.json`);
  if (!res.ok) return [];
  const data = await res.json() as { keys?: ClerkJwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.set(normalizedIssuer, { keys, expiresAt: now + JWKS_TTL_MS });
  return keys;
}

async function verifyJwtWithIssuerJwks(token: string, iss: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(base64UrlDecode(headerB64)) as JwtHeader;
    if (header.alg !== 'RS256' || !header.kid) return false;

    const jwks = await getJwksForIssuer(iss, fetchImpl);
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
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  } catch {
    return false;
  }
}

export async function verifyToken(
  token: string | undefined,
  config: ChatConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthClaims | null> {
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as AuthClaims;
    if (!areClaimsAllowed(payload, config)) return null;

    let valid = false;
    if (config.clerkJwtKey) {
      valid = await verifyJwtWithPublicKey(token, config.clerkJwtKey);
    } else {
      valid = await verifyJwtWithIssuerJwks(token, payload.iss, fetchImpl);
    }
    if (!valid) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isFreeModel(config: ChatConfig, model: string): boolean {
  return config.freeModels.has(model);
}

export function isPaidModel(config: ChatConfig, model: string): boolean {
  return config.proModels.has(model);
}

export function isAllowedModel(config: ChatConfig, model: string): boolean {
  return config.freeModels.has(model) || config.proModels.has(model);
}

function getAllowedModelList(config: ChatConfig): string[] {
  return [...config.freeModels, ...config.proModels];
}

function debugCredits(config: ChatConfig, event: string, data: Record<string, unknown>): void {
  if (!config.debugCredits) return;
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

export function isOriginAllowed(config: ChatConfig, requestOrigin: string | null, isDev: boolean): boolean {
  if (!requestOrigin) return true;
  if (requestOrigin === config.appUrl) return true;
  if (config.allowedOrigins.includes(requestOrigin)) return true;

  if (isDev) {
    try {
      const url = new URL(requestOrigin);
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (isLocalhost && (url.protocol === 'http:' || url.protocol === 'https:')) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

function getAllowedOrigin(config: ChatConfig, requestOrigin: string | null, isDev: boolean): string {
  if (requestOrigin && isOriginAllowed(config, requestOrigin, isDev)) {
    return requestOrigin;
  }
  return config.appUrl;
}

function getCorsHeaders(config: ChatConfig, requestOrigin: string | null, isDev: boolean): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(config, requestOrigin, isDev),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-Credits-Used, X-Credits-Limit, X-Credits-Pct, X-Credits-Reset, X-Credits-Billable, X-Usage-Used, X-Usage-Limit, X-Usage-Pct, X-Usage-Reset',
    Vary: 'Origin',
  };
}

function corsResponse(
  config: ChatConfig,
  status: number,
  requestOrigin: string | null,
  body?: object,
  extra?: Record<string, string>,
  isDev: boolean = process.env.NODE_ENV !== 'production',
): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { ...getCorsHeaders(config, requestOrigin, isDev), 'Content-Type': 'application/json', ...extra },
  });
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

async function hashValue(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getHeader(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function getRequestUrl(req: HandlerRequest, config: ChatConfig): URL {
  const host = getHeader(req.headers, 'x-forwarded-host') ?? getHeader(req.headers, 'host');
  const proto = getHeader(req.headers, 'x-forwarded-proto') ?? 'https';
  const fallbackBase = host ? `${proto}://${host}` : config.appUrl;
  return new URL(req.url ?? '/api/chat', fallbackBase);
}

async function readJsonBody<T>(req: HandlerRequest): Promise<T> {
  if (typeof req.json === 'function') {
    return await req.json() as T;
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as T;
  }
  if (req.body !== undefined) {
    return req.body as T;
  }
  throw new Error('Invalid JSON body');
}

export async function getAnonymousUserId(req: HandlerRequest): Promise<string> {
  const forwarded = getHeader(req.headers, 'x-forwarded-for')
    ?? getHeader(req.headers, 'x-real-ip')
    ?? getHeader(req.headers, 'cf-connecting-ip');
  const ip = forwarded?.split(',')[0]?.trim();
  if (!ip) return 'anonymous';
  const fingerprint = await hashValue(ip);
  return `anon:${fingerprint.slice(0, 24)}`;
}

export function createChatHandler(config: ChatConfig, deps: ChatHandlerDeps) {
  return async function handler(req: HandlerRequest): Promise<Response> {
    const supportEmail = 'louis@ltplus.com';
    const url = getRequestUrl(req, config);
    const requestOrigin = getHeader(req.headers, 'origin');
    const isDev = process.env.NODE_ENV !== 'production';
    const isUsageSnapshotRequest = req.method === 'GET' && url.searchParams.get('usage') === '1';

    if (req.method === 'OPTIONS') {
      if (!isOriginAllowed(config, requestOrigin, isDev)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 200, headers: getCorsHeaders(config, requestOrigin, isDev) });
    }
    if (req.method !== 'POST' && !isUsageSnapshotRequest) {
      return corsResponse(config, 405, requestOrigin, { error: 'Method not allowed' }, undefined, isDev);
    }
    if (!isOriginAllowed(config, requestOrigin, isDev)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed', code: 'origin_not_allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authHeader = getHeader(req.headers, 'authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '') || undefined;
    const claims = await verifyToken(token, config, deps.fetchImpl);
    if (token && !claims) {
      return corsResponse(config, 401, requestOrigin, {
        error: 'Authentication invalid or expired. Please sign in again.',
        code: 'auth_invalid',
      }, undefined, isDev);
    }

    const featureSet = extractFeatureSet(claims);
    const userTier = (hasProPlan(claims) || featureSet.has('pro_models'))
      ? 'pro' as const
      : 'free' as const;
    const userId = claims?.sub ?? await getAnonymousUserId(req);

    if (isUsageSnapshotRequest) {
      const snapshot = await deps.usageStore.getUsageSnapshot(userId, userTier);
      return corsResponse(
        config,
        200,
        requestOrigin,
        { usage: snapshot },
        buildUsageHeaders(snapshot),
        isDev,
      );
    }

    let body: {
      messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
      model: string;
      system?: string;
    };
    try {
      body = await readJsonBody<typeof body>(req);
    } catch {
      return corsResponse(config, 400, requestOrigin, { error: 'Invalid JSON body' }, undefined, isDev);
    }

    if (!body?.messages || !body?.model) {
      return corsResponse(config, 400, requestOrigin, { error: 'Missing messages or model' }, undefined, isDev);
    }

    if (!isAllowedModel(config, body.model)) {
      return corsResponse(config, 400, requestOrigin, {
        error: `Model not allowed: ${body.model}. Check LLM_*_MODELS env configuration.`,
        code: 'model_not_allowed',
        model: body.model,
        allowedModels: getAllowedModelList(config),
      }, undefined, isDev);
    }

    if (userTier === 'free' && isPaidModel(config, body.model)) {
      return corsResponse(config, 403, requestOrigin, {
        error: 'Upgrade to Pro to use this model',
        code: 'plan_required',
        upgrade: true,
      }, undefined, isDev);
    }

    const billableRequest = userTier === 'pro' && !isFreeModel(config, body.model);
    let usageSnapshot = await deps.usageStore.getUsageSnapshot(userId, userTier);
    let reservedCredits = 0;

    if (userTier === 'free') {
      const consumed = await deps.usageStore.consumeFreeRequest(userId);
      usageSnapshot = consumed.snapshot;
      if (!consumed.allowed) {
        return corsResponse(config, 429, requestOrigin, {
          error: 'You\'ve reached your daily limit. Upgrade to Pro for more.',
          type: 'request_cap',
          code: 'quota_exceeded',
          limit: config.freeDailyLimit,
          resetAt: consumed.snapshot.resetAt * 1000,
        }, {
          'Retry-After': String(Math.max(1, consumed.snapshot.resetAt - Math.ceil(deps.now() / 1000))),
          ...buildUsageHeaders(consumed.snapshot),
        }, isDev);
      }
    } else if (billableRequest) {
      const reserved = await deps.usageStore.reserveProCredits(userId, 1);
      usageSnapshot = { ...reserved.snapshot, billable: true };
      if (!reserved.allowed) {
        return corsResponse(config, 429, requestOrigin, {
          error: `Monthly credits used up. Need more? Reach out at ${supportEmail}.`,
          type: 'credits',
          code: 'credits_exhausted',
          creditsUsed: reserved.snapshot.used,
          creditsLimit: config.proMonthlyCredits,
          resetAt: reserved.snapshot.resetAt * 1000,
          contactEmail: supportEmail,
        }, {
          'Retry-After': String(Math.max(1, reserved.snapshot.resetAt - Math.ceil(deps.now() / 1000))),
          ...buildUsageHeaders(usageSnapshot),
        }, isDev);
      }
      reservedCredits = 1;
    }

    const upstreamMessages = body.system
      ? [{ role: 'system', content: body.system }, ...body.messages]
      : body.messages;

    debugCredits(config, 'request_start', {
      userId: summarizeUserId(userId),
      model: body.model,
      userTier,
      billableRequest,
      isFreeModel: isFreeModel(config, body.model),
    });

    let upstream: Response;
    try {
      upstream = await deps.fetchImpl(`${config.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.appUrl,
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
    } catch (error) {
      if (reservedCredits > 0) {
        await deps.usageStore.releaseProCredits(userId, reservedCredits);
      }
      return corsResponse(config, 502, requestOrigin, {
        error: 'Provider request failed before a response was received.',
        code: 'provider_unreachable',
        providerMessage: error instanceof Error ? error.message : String(error),
      }, undefined, isDev);
    }

    if (!upstream.ok) {
      if (reservedCredits > 0) {
        await deps.usageStore.releaseProCredits(userId, reservedCredits);
      }

      let providerErrorText = '';
      let providerBody: unknown = null;
      try {
        providerErrorText = await upstream.text();
        providerBody = providerErrorText ? JSON.parse(providerErrorText) : null;
      } catch {
        providerBody = null;
      }

      if (upstream.status === 429) {
        return corsResponse(config, 429, requestOrigin, {
          error: `Provider rate limit reached for model ${body.model}. Please retry shortly or switch models.`,
          type: 'provider_rate_limit',
          code: 'provider_rate_limited',
          limit: config.freeDailyLimit,
          model: body.model,
        }, undefined, isDev);
      }

      if (upstream.status === 404) {
        const providerMessage = typeof providerBody === 'object' && providerBody !== null
          ? (providerBody as { error?: { message?: string } }).error?.message
          : undefined;
        return corsResponse(config, 502, requestOrigin, {
          error: `Model "${body.model}" is currently unavailable from provider routing.`,
          code: 'provider_model_not_found',
          model: body.model,
          providerStatus: 404,
          providerMessage: providerMessage ?? (providerErrorText || undefined),
        }, undefined, isDev);
      }

      if (upstream.status === 402) {
        return corsResponse(config, 502, requestOrigin, {
          error: 'Service temporarily unavailable. Please try again later.',
        }, undefined, isDev);
      }

      const providerMessage = typeof providerBody === 'object' && providerBody !== null
        ? (providerBody as { error?: { message?: string } }).error?.message
        : undefined;

      return corsResponse(config, upstream.status, requestOrigin, {
        error: `Request failed (${upstream.status}) for model ${body.model}.`,
        code: 'provider_error',
        model: body.model,
        providerStatus: upstream.status,
        providerMessage: providerMessage ?? (providerErrorText || undefined),
      }, undefined, isDev);
    }

    if (!upstream.body) {
      if (reservedCredits > 0) {
        await deps.usageStore.releaseProCredits(userId, reservedCredits);
      }
      return corsResponse(config, 502, requestOrigin, { error: 'No response body' }, undefined, isDev);
    }

    const usageHeaders = buildUsageHeaders({ ...usageSnapshot, billable: billableRequest });
    const sseEncoder = new TextEncoder();

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      async flush(controller) {
        const snapshot = await deps.usageStore.getUsageSnapshot(userId, userTier);
        const usageEvent = JSON.stringify({
          __ifcLiteUsage: {
            ...snapshot,
            billable: billableRequest,
          },
        });
        debugCredits(config, 'usage_event_emitted', {
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

    upstream.body.pipeTo(writable).catch(async () => {
      // Billing is reserved before streaming starts, so stream errors do not
      // silently skip usage accounting. Swallow to preserve response shutdown.
    });

    return new Response(readable, {
      status: 200,
      headers: {
        ...getCorsHeaders(config, requestOrigin, isDev),
        ...usageHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  };
}
