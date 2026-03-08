/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  createChatHandler,
  loadChatConfig,
  verifyToken,
  type AuthClaims,
  type ChatConfig,
  type ChatUsageStore,
  type UsageReservationResult,
  type UsageSnapshot,
  type UsageTier,
} from './chat-handler.js';

function createConfig(overrides: Partial<ChatConfig> = {}): ChatConfig {
  return {
    apiBase: 'https://provider.example',
    apiKey: 'test-key',
    appUrl: 'https://app.example',
    allowedOrigins: [],
    freeModels: new Set(['openai/gpt-free']),
    proModels: new Set(['openai/gpt-pro']),
    freeDailyLimit: 3,
    proMonthlyCredits: 10,
    costToCredits: 1,
    debugCredits: false,
    clerkJwtKey: undefined,
    clerkAllowedIssuers: new Set(['https://issuer.example']),
    clerkAudiences: new Set(),
    clerkAuthorizedParties: new Set(),
    ...overrides,
  };
}

class MemoryUsageStore implements ChatUsageStore {
  readonly snapshots = new Map<string, { pro: number; free: number }>();
  lastUserIds: string[] = [];
  releasedCredits = 0;

  private ensure(userId: string) {
    this.lastUserIds.push(userId);
    let entry = this.snapshots.get(userId);
    if (!entry) {
      entry = { pro: 0, free: 0 };
      this.snapshots.set(userId, entry);
    }
    return entry;
  }

  async getUsageSnapshot(userId: string, tier: UsageTier): Promise<UsageSnapshot> {
    const entry = this.ensure(userId);
    return tier === 'pro'
      ? { type: 'credits', used: entry.pro, limit: 10, pct: entry.pro * 10, resetAt: 1_700_000_000 }
      : { type: 'requests', used: entry.free, limit: 3, pct: entry.free * 33, resetAt: 1_700_000_000 };
  }

  async consumeFreeRequest(userId: string): Promise<UsageReservationResult> {
    const entry = this.ensure(userId);
    if (entry.free >= 3) {
      return { allowed: false, snapshot: await this.getUsageSnapshot(userId, 'free') };
    }
    entry.free += 1;
    return { allowed: true, snapshot: await this.getUsageSnapshot(userId, 'free') };
  }

  async reserveProCredits(userId: string, credits: number): Promise<UsageReservationResult> {
    const entry = this.ensure(userId);
    if (entry.pro + credits > 10) {
      return { allowed: false, snapshot: await this.getUsageSnapshot(userId, 'pro') };
    }
    entry.pro += credits;
    return { allowed: true, snapshot: await this.getUsageSnapshot(userId, 'pro') };
  }

  async releaseProCredits(userId: string, credits: number): Promise<void> {
    const entry = this.ensure(userId);
    entry.pro = Math.max(0, entry.pro - credits);
    this.releasedCredits += credits;
  }
}

function createJwt(claims: AuthClaims, privateKeyPem: string): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const headerB64 = encode(header);
  const payloadB64 = encode(claims);
  const signer = createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

test('verifyToken rejects tokens from a foreign Clerk issuer even with a valid signature', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const token = createJwt({
    sub: 'user_123',
    iss: 'https://another-instance.clerk.accounts.dev',
    exp: Math.ceil(Date.now() / 1000) + 3600,
    plan: 'pro',
  }, privatePem);

  const claims = await verifyToken(token, createConfig({
    clerkJwtKey: publicPem,
    clerkAllowedIssuers: new Set(['https://expected-instance.clerk.accounts.dev']),
  }));

  assert.equal(claims, null);
});

test('chat handler rejects disallowed origins before provider work begins', async () => {
  const usageStore = new MemoryUsageStore();
  let fetchCalls = 0;
  const handler = createChatHandler(createConfig(), {
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('nope', { status: 500 });
    },
    usageStore,
    now: () => Date.now(),
  });

  const response = await handler(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'text/plain',
    },
    body: JSON.stringify({ model: 'openai/gpt-free', messages: [{ role: 'user', content: 'hi' }] }),
  }));

  assert.equal(response.status, 403);
  assert.equal(fetchCalls, 0);
  assert.equal(usageStore.lastUserIds.length, 0);
});

test('chat handler returns a structured provider_unreachable error and refunds reserved credits', async () => {
  const usageStore = new MemoryUsageStore();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const token = createJwt({
    sub: 'user_123',
    iss: 'https://issuer.example',
    exp: Math.ceil(Date.now() / 1000) + 3600,
    plan: 'pro',
  }, privatePem);

  const handler = createChatHandler(createConfig({
    clerkJwtKey: publicPem,
  }), {
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
    usageStore,
    now: () => Date.now(),
  });

  const response = await handler(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: {
      origin: 'https://app.example',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model: 'openai/gpt-pro', messages: [{ role: 'user', content: 'hi' }] }),
  }));

  const body = await response.json() as { code?: string; providerMessage?: string };

  assert.equal(response.status, 502);
  assert.equal(body.code, 'provider_unreachable');
  assert.match(String(body.providerMessage), /socket hang up/);
  assert.equal(usageStore.releasedCredits, 1);
});

test('anonymous usage is isolated per forwarded IP fingerprint', async () => {
  const usageStore = new MemoryUsageStore();
  const handler = createChatHandler(createConfig(), {
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    usageStore,
    now: () => Date.now(),
  });

  await handler(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: {
      origin: 'https://app.example',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.1',
    },
    body: JSON.stringify({ model: 'openai/gpt-free', messages: [{ role: 'user', content: 'one' }] }),
  }));
  await handler(new Request('https://app.example/api/chat', {
    method: 'POST',
    headers: {
      origin: 'https://app.example',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.2',
    },
    body: JSON.stringify({ model: 'openai/gpt-free', messages: [{ role: 'user', content: 'two' }] }),
  }));

  const anonIds = [...new Set(usageStore.lastUserIds.filter((id) => id.startsWith('anon:')))];
  assert.equal(anonIds.length, 2);
  assert.notEqual(anonIds[0], anonIds[1]);
});

test('chat handler accepts preview-style relative request URLs for usage snapshots', async () => {
  const usageStore = new MemoryUsageStore();
  const handler = createChatHandler(createConfig(), {
    fetchImpl: async () => new Response('unused', { status: 500 }),
    usageStore,
    now: () => Date.now(),
  });

  const request = {
    method: 'GET',
    url: '/api/chat?usage=1',
    headers: new Headers({
      host: 'preview.example',
      'x-forwarded-proto': 'https',
      origin: 'https://app.example',
      'x-forwarded-for': '203.0.113.10',
    }),
  } as Request;

  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Usage-Limit'), '3');
});

test('loadChatConfig supports explicit Clerk issuer and audience config', () => {
  const config = loadChatConfig({
    LLM_API_BASE: 'https://provider.example',
    LLM_API_KEY: 'key',
    LLM_FREE_MODELS: 'openai/gpt-free',
    LLM_PRO_MODELS: 'openai/gpt-pro',
    LLM_FREE_DAILY_LIMIT: '3',
    LLM_PRO_MONTHLY_CREDITS: '10',
    LLM_COST_TO_CREDITS: '1',
    APP_URL: 'https://app.example',
    CLERK_ISSUER_URL: 'https://issuer.example',
    CLERK_JWT_AUDIENCE: 'viewer-app',
    CLERK_AUTHORIZED_PARTY: 'https://app.example',
  });

  assert.deepEqual([...config.clerkAllowedIssuers], ['https://issuer.example']);
  assert.deepEqual([...config.clerkAudiences], ['viewer-app']);
  assert.deepEqual([...config.clerkAuthorizedParties], ['https://app.example']);
});
