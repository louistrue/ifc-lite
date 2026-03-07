/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { LLMModel } from './types.js';

function parseEnvValue(envText: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envText.match(new RegExp(`^${escapedKey}=(.*)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function parseCsvList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

test('registry free models match configured env list', async () => {
  const envText = await readFile('.env.local', 'utf8');
  const configuredFreeModels = parseCsvList(parseEnvValue(envText, 'VITE_LLM_FREE_MODELS'));
  assert.ok(configuredFreeModels.length > 0, 'VITE_LLM_FREE_MODELS must define at least one model');

  process.env.VITE_LLM_FREE_MODELS = configuredFreeModels.join(',');
  process.env.VITE_LLM_PRO_MODELS_LOW = '';
  process.env.VITE_LLM_PRO_MODELS_MEDIUM = '';
  process.env.VITE_LLM_PRO_MODELS_HIGH = '';
  process.env.VITE_LLM_IMAGE_MODELS = '';
  process.env.VITE_LLM_FILE_ATTACHMENT_MODELS = '';

  const { FREE_MODELS } = await import(`./models.ts?ts=${Date.now()}`) as { FREE_MODELS: LLMModel[] };
  assert.deepEqual(
    FREE_MODELS.map((model) => model.id),
    configuredFreeModels,
    'FREE_MODELS must follow VITE_LLM_FREE_MODELS order and values',
  );
});

test('model capabilities follow override env lists', async () => {
  process.env.VITE_LLM_FREE_MODELS = 'qwen/qwen3-coder,mistralai/devstral-2512';
  process.env.VITE_LLM_PRO_MODELS_LOW = '';
  process.env.VITE_LLM_PRO_MODELS_MEDIUM = '';
  process.env.VITE_LLM_PRO_MODELS_HIGH = '';
  process.env.VITE_LLM_IMAGE_MODELS = 'mistralai/devstral-2512';
  process.env.VITE_LLM_FILE_ATTACHMENT_MODELS = 'qwen/qwen3-coder';

  const { ALL_MODELS } = await import(`./models.ts?ts=${Date.now()}`) as { ALL_MODELS: LLMModel[] };
  const qwen = ALL_MODELS.find((m) => m.id === 'qwen/qwen3-coder');
  const devstral = ALL_MODELS.find((m) => m.id === 'mistralai/devstral-2512');

  assert.ok(qwen, 'Expected qwen model in registry');
  assert.ok(devstral, 'Expected devstral model in registry');
  assert.equal(qwen.supportsImages, false);
  assert.equal(qwen.supportsFileAttachments, true);
  assert.equal(devstral.supportsImages, true);
  assert.equal(devstral.supportsFileAttachments, false);
});

test('each configured free model exists in OpenRouter catalog', async () => {
  const envText = await readFile('.env.local', 'utf8');
  const configuredFreeModels = parseCsvList(parseEnvValue(envText, 'VITE_LLM_FREE_MODELS'));
  assert.ok(configuredFreeModels.length > 0, 'VITE_LLM_FREE_MODELS must define at least one model');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
    assert.equal(response.ok, true, `OpenRouter models API failed with HTTP ${response.status}`);

    const payload = await response.json() as { data?: Array<{ id?: string }> };
    const modelIdSet = new Set(
      Array.isArray(payload.data)
        ? payload.data.map((model) => model.id).filter((id): id is string => typeof id === 'string')
        : [],
    );

    const missing = configuredFreeModels.filter((id) => !modelIdSet.has(id));
    assert.deepEqual(
      missing,
      [],
      `Configured free model IDs missing from OpenRouter catalog: ${missing.join(', ')}`,
    );
  } finally {
    clearTimeout(timeout);
  }
});
