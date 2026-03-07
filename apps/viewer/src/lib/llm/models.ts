/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LLM model registry.
 * Model IDs are sourced from environment variables only.
 * Pro model cost metadata comes from cost-bucket env vars:
 * - *_PRO_MODELS_LOW => $
 * - *_PRO_MODELS_MEDIUM => $$
 * - *_PRO_MODELS_HIGH => $$$
 */

import type { LLMModel } from './types.js';

function readEnv(key: string): string | undefined {
  const importMetaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const viteVal = importMetaEnv?.[key];
  const nodeVal = typeof process !== 'undefined' ? process.env[key] : undefined;
  const val = typeof viteVal === 'string' ? viteVal : nodeVal;
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCsvEnv(key: string): string[] {
  const raw = readEnv(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCsvFromFirstDefined(keys: string[]): string[] {
  for (const key of keys) {
    const values = parseCsvEnv(key);
    if (values.length > 0) return values;
  }
  return [];
}

function uniqueInOrder(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function titleCaseProvider(rawProvider: string): string {
  const overrides: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    meta: 'Meta',
    'meta-llama': 'Meta',
    xai: 'xAI',
    'x-ai': 'xAI',
    mistralai: 'Mistral',
    qwen: 'Alibaba',
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    'z-ai': 'Zhipu',
  };

  const normalized = rawProvider.toLowerCase();
  if (overrides[normalized]) return overrides[normalized];
  return rawProvider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function humanizeModelSlug(slug: string): string {
  const withoutTier = slug.split(':')[0] ?? slug;
  return withoutTier
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^[0-9.]+$/.test(word)) return word;
      const upper = word.toUpperCase();
      if (upper === 'GPT' || upper === 'OSS' || upper === 'R1') return upper;
      if (word.length <= 2) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function buildModel(id: string, tier: 'free' | 'pro', cost?: LLMModel['cost']): LLMModel {
  const [providerRaw, modelRaw = id] = id.split('/');
  return {
    id,
    tier,
    name: humanizeModelSlug(modelRaw),
    provider: titleCaseProvider(providerRaw ?? 'Unknown'),
    contextWindow: 128_000,
    supportsImages: false,
    supportsFileAttachments: true,
    cost: tier === 'pro' ? cost : undefined,
  };
}

const freeModelIds = uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_FREE_MODELS', 'LLM_FREE_MODELS']));
const proLowCostIds = uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_PRO_MODELS_LOW', 'LLM_PRO_MODELS_LOW']));
const proMediumCostIds = uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_PRO_MODELS_MEDIUM', 'LLM_PRO_MODELS_MEDIUM']));
const proHighCostIds = uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_PRO_MODELS_HIGH', 'LLM_PRO_MODELS_HIGH']));

// Backward-compatible fallback for older env shape with one pro list.
const legacyProIds = uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_PRO_MODELS', 'LLM_PRO_MODELS']));
const useLegacyProList = proLowCostIds.length === 0 && proMediumCostIds.length === 0 && proHighCostIds.length === 0;

const rawFreeModels: LLMModel[] = freeModelIds.map((id) => buildModel(id, 'free'));

const proCostBuckets: Array<{ ids: string[]; cost: LLMModel['cost'] }> = [
  { ids: proLowCostIds, cost: '$' },
  { ids: useLegacyProList ? legacyProIds : proMediumCostIds, cost: '$$' },
  { ids: proHighCostIds, cost: '$$$' },
];

const seenProModelIds = new Set<string>();
const rawProModels: LLMModel[] = proCostBuckets.flatMap(({ ids, cost }) =>
  ids.flatMap((id) => {
    if (seenProModelIds.has(id)) return [];
    seenProModelIds.add(id);
    return [buildModel(id, 'pro', cost)];
  }),
);

const imageCapableModelIds = new Set(
  uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_IMAGE_MODELS', 'LLM_IMAGE_MODELS'])),
);
const fileCapableModelIds = new Set(
  uniqueInOrder(parseCsvFromFirstDefined(['VITE_LLM_FILE_ATTACHMENT_MODELS', 'LLM_FILE_ATTACHMENT_MODELS'])),
);
const hasImageOverrideList = imageCapableModelIds.size > 0;
const hasFileOverrideList = fileCapableModelIds.size > 0;

function applyCapabilities(model: LLMModel): LLMModel {
  const supportsImages = hasImageOverrideList ? imageCapableModelIds.has(model.id) : model.supportsImages;
  const supportsFileAttachments = hasFileOverrideList
    ? fileCapableModelIds.has(model.id)
    : model.supportsFileAttachments;
  return {
    ...model,
    supportsImages,
    supportsFileAttachments,
  };
}

export const FREE_MODELS: LLMModel[] = rawFreeModels.map(applyCapabilities);
export const PRO_MODELS: LLMModel[] = rawProModels.map(applyCapabilities);
export const ALL_MODELS = [...FREE_MODELS, ...PRO_MODELS];

const FALLBACK_MODEL: LLMModel = {
  id: 'llm-model-missing',
  name: 'No model configured',
  provider: 'Unknown',
  tier: 'free',
  contextWindow: 128_000,
  supportsImages: false,
  supportsFileAttachments: true,
  notes: 'Set VITE_LLM_FREE_MODELS and VITE_LLM_PRO_MODELS_LOW/MEDIUM/HIGH in environment.',
};

export const DEFAULT_FREE_MODEL = FREE_MODELS[0] ?? PRO_MODELS[0] ?? FALLBACK_MODEL;
export const DEFAULT_PRO_MODEL = PRO_MODELS[0] ?? DEFAULT_FREE_MODEL;

export function getModelById(id: string): LLMModel | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

/** Check whether a model ID requires a pro subscription */
export function requiresPro(modelId: string): boolean {
  const model = getModelById(modelId);
  return model?.tier === 'pro';
}
