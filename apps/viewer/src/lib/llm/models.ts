/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LLM model registry — available models across free, budget, and frontier tiers.
 *
 * Free tier: zero-cost models (OpenRouter :free suffix), daily request limit.
 * Budget tier: pay-per-token models (~$8/month), weekly request limit.
 * Frontier tier: best-of-best models, weekly request limit (pro users only).
 */

import type { LLMModel } from './types.js';

// ---------------------------------------------------------------------------
// FREE TIER — zero cost, daily limit for anonymous/free users
// ---------------------------------------------------------------------------

export const FREE_MODELS: LLMModel[] = [
  {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen3 Coder 480B',
    provider: 'Alibaba',
    tier: 'free',
    contextWindow: 262_000,
    notes: 'Best free coding model',
  },
  {
    id: 'mistralai/devstral-2512:free',
    name: 'Devstral 2512',
    provider: 'Mistral',
    tier: 'free',
    contextWindow: 128_000,
    notes: 'Multi-file agentic coding',
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    tier: 'free',
    contextWindow: 128_000,
    notes: 'Reasoning-heavy tasks',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B',
    provider: 'Meta',
    tier: 'free',
    contextWindow: 128_000,
    notes: 'GPT-4 level general purpose',
  },
  {
    id: 'openai/gpt-oss-120b:free',
    name: 'GPT-OSS 120B',
    provider: 'OpenAI',
    tier: 'free',
    contextWindow: 131_000,
    notes: 'OpenAI open-weight MoE',
  },
];

// ---------------------------------------------------------------------------
// BUDGET TIER — ~$8/month pay-per-token, weekly limit for pro users
// ---------------------------------------------------------------------------

export const BUDGET_MODELS: LLMModel[] = [
  {
    id: 'qwen/qwen3-coder',
    name: 'Qwen3 Coder 480B',
    provider: 'Alibaba',
    tier: 'budget',
    contextWindow: 262_000,
    notes: 'Higher throughput than free',
  },
  {
    id: 'x-ai/grok-code-fast-1',
    name: 'Grok Code Fast 1',
    provider: 'xAI',
    tier: 'budget',
    contextWindow: 256_000,
    notes: '#1 coding leaderboard',
  },
  {
    id: 'minimax/minimax-m2.1',
    name: 'MiniMax M2.1',
    provider: 'MiniMax',
    tier: 'budget',
    contextWindow: 197_000,
    notes: 'Great for agent loops',
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    tier: 'budget',
    contextWindow: 1_000_000,
    notes: 'Near-Pro, huge context',
  },
  {
    id: 'z-ai/glm-4.7',
    name: 'GLM 4.7',
    provider: 'Zhipu',
    tier: 'budget',
    contextWindow: 128_000,
    notes: 'Strong agentic + front-end',
  },
];

// ---------------------------------------------------------------------------
// FRONTIER TIER — best models, weekly limit for pro users
// ---------------------------------------------------------------------------

export const FRONTIER_MODELS: LLMModel[] = [
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    tier: 'frontier',
    contextWindow: 1_000_000,
    notes: '#2 coding, best agentic Sonnet',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    tier: 'frontier',
    contextWindow: 200_000,
    notes: 'Latest Sonnet',
  },
  {
    id: 'anthropic/claude-opus-4.5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    tier: 'frontier',
    contextWindow: 200_000,
    notes: 'Top real-world coding',
  },
  {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    provider: 'Google',
    tier: 'frontier',
    contextWindow: 1_000_000,
    notes: '80.6% SWE-bench',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    tier: 'frontier',
    contextWindow: 1_000_000,
    notes: 'Newest Google flagship',
  },
  {
    id: 'openai/gpt-5.2-20251211',
    name: 'GPT-5.2',
    provider: 'OpenAI',
    tier: 'frontier',
    contextWindow: 400_000,
    notes: 'Most cost-effective frontier OpenAI',
  },
  {
    id: 'x-ai/grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'xAI',
    tier: 'frontier',
    contextWindow: 2_000_000,
    notes: 'Best agentic tool-calling, 2M context',
  },
];

export const ALL_MODELS = [...FREE_MODELS, ...BUDGET_MODELS, ...FRONTIER_MODELS];

export const DEFAULT_FREE_MODEL = FREE_MODELS[0];
export const DEFAULT_BUDGET_MODEL = BUDGET_MODELS[0];
export const DEFAULT_FRONTIER_MODEL = FRONTIER_MODELS[0];

export function getModelById(id: string): LLMModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

/** Check whether a model ID requires a pro subscription */
export function requiresPro(modelId: string): boolean {
  const model = getModelById(modelId);
  return model?.tier === 'budget' || model?.tier === 'frontier';
}
