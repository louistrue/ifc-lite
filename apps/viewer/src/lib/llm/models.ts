/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LLM model registry.
 *
 * Free tier: zero-cost models, daily request cap.
 * Pro tier: all models with monthly credit allowance.
 *   Cost indicator: $ = low, $$ = moderate, $$$ = high credit usage per request.
 */

import type { LLMModel } from './types.js';

// ---------------------------------------------------------------------------
// FREE TIER
// ---------------------------------------------------------------------------

export const FREE_MODELS: LLMModel[] = [
  {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen3 Coder',
    provider: 'Alibaba',
    tier: 'free',
    contextWindow: 262_000,
    notes: 'Best free coding model',
  },
  {
    id: 'mistralai/devstral-2512:free',
    name: 'Devstral 2',
    provider: 'Mistral',
    tier: 'free',
    contextWindow: 256_000,
    notes: 'Agentic coding, 256K context',
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
    notes: 'Open-weight MoE, tool use',
  },
];

// ---------------------------------------------------------------------------
// PRO TIER — monthly credit allowance
// ---------------------------------------------------------------------------

export const PRO_MODELS: LLMModel[] = [
  // $ — low credit usage
  {
    id: 'qwen/qwen3-coder',
    name: 'Qwen3 Coder',
    provider: 'Alibaba',
    tier: 'pro',
    contextWindow: 262_000,
    cost: '$',
    notes: 'Higher throughput than free',
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    tier: 'pro',
    contextWindow: 1_000_000,
    cost: '$',
    notes: '1M context, near-Pro quality',
  },
  {
    id: 'minimax/minimax-m2.1',
    name: 'MiniMax M2.1',
    provider: 'MiniMax',
    tier: 'pro',
    contextWindow: 197_000,
    cost: '$',
    notes: 'Great for agent loops',
  },
  {
    id: 'z-ai/glm-4.7',
    name: 'GLM 4.7',
    provider: 'Zhipu',
    tier: 'pro',
    contextWindow: 128_000,
    cost: '$',
    notes: 'Strong agentic + front-end',
  },
  // $$ — moderate credit usage
  {
    id: 'x-ai/grok-code-fast-1',
    name: 'Grok Code Fast 1',
    provider: 'xAI',
    tier: 'pro',
    contextWindow: 2_000_000,
    cost: '$$',
    notes: '#1 coding leaderboard, 2M ctx',
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    tier: 'pro',
    contextWindow: 200_000,
    cost: '$$',
    notes: '#2 coding, best agentic Sonnet',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    tier: 'pro',
    contextWindow: 200_000,
    cost: '$$',
    notes: 'Latest Sonnet',
  },
  {
    id: 'openai/gpt-5.2',
    name: 'GPT-5.2',
    provider: 'OpenAI',
    tier: 'pro',
    contextWindow: 400_000,
    cost: '$$',
    notes: 'Adaptive reasoning, 400K ctx',
  },
  {
    id: 'x-ai/grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'xAI',
    tier: 'pro',
    contextWindow: 2_000_000,
    cost: '$$',
    notes: 'Best tool-calling, 2M context',
  },
  // $$$ — high credit usage
  {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    provider: 'Google',
    tier: 'pro',
    contextWindow: 1_000_000,
    cost: '$$$',
    notes: '80.6% SWE-bench, 1M ctx',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    tier: 'pro',
    contextWindow: 1_000_000,
    cost: '$$$',
    notes: 'Newest Google flagship',
  },
  {
    id: 'anthropic/claude-opus-4.5',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    tier: 'pro',
    contextWindow: 200_000,
    cost: '$$$',
    notes: 'Top real-world coding',
  },
];

export const ALL_MODELS = [...FREE_MODELS, ...PRO_MODELS];

export const DEFAULT_FREE_MODEL = FREE_MODELS[0];
export const DEFAULT_PRO_MODEL = PRO_MODELS[0];

export function getModelById(id: string): LLMModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

/** Check whether a model ID requires a pro subscription */
export function requiresPro(modelId: string): boolean {
  const model = getModelById(modelId);
  return model?.tier === 'pro';
}
