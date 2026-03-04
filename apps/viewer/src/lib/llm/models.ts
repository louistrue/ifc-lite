/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LLM model registry — available models for free and pro tiers.
 */

import type { LLMModel } from './types.js';

export const FREE_MODELS: LLMModel[] = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    tier: 'free',
    contextWindow: 1_000_000,
  },
  {
    id: 'meta-llama/llama-4-maverick',
    name: 'Llama 4 Maverick',
    provider: 'Meta',
    tier: 'free',
    contextWindow: 128_000,
  },
  {
    id: 'mistralai/mistral-small-3.2',
    name: 'Mistral Small 3.2',
    provider: 'Mistral',
    tier: 'free',
    contextWindow: 128_000,
  },
  {
    id: 'qwen/qwen3-32b',
    name: 'Qwen3 32B',
    provider: 'Alibaba',
    tier: 'free',
    contextWindow: 32_000,
  },
];

export const PRO_MODELS: LLMModel[] = [
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    tier: 'pro',
    contextWindow: 200_000,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    tier: 'pro',
    contextWindow: 128_000,
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    tier: 'pro',
    contextWindow: 1_000_000,
  },
];

export const ALL_MODELS = [...FREE_MODELS, ...PRO_MODELS];

export const DEFAULT_FREE_MODEL = FREE_MODELS[0];
export const DEFAULT_PRO_MODEL = PRO_MODELS[0];

export function getModelById(id: string): LLMModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}
