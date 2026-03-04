/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Auth helpers for the LLM chat integration.
 *
 * Setup:
 * 1. Install: pnpm add @clerk/clerk-react
 * 2. Set VITE_CLERK_PUBLISHABLE_KEY in .env
 * 3. Create plans in dashboard:
 *    - Free plan (slug: 'free', features: ['llm_chat', 'free_models'])
 *    - Pro plan (slug: 'pro', features: ['llm_chat', 'free_models', 'pro_models'])
 * 4. Wrap app with <ClerkProvider>
 *
 * Usage in components:
 *
 * ```tsx
 * import { useAuth, useUser, Protect } from '@clerk/clerk-react';
 *
 * const { has } = useAuth();
 * const hasPro = has?.({ feature: 'pro_models' }) ?? false;
 *
 * const { getToken } = useAuth();
 * const token = await getToken();
 * ```
 */

/**
 * Subscription tiers and their features.
 */
export const SUBSCRIPTION_PLANS = {
  free: {
    slug: 'free',
    name: 'Free',
    features: ['llm_chat', 'free_models'],
    description: 'AI chat with free models',
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    features: ['llm_chat', 'free_models', 'pro_models'],
    description: 'All models with monthly credit allowance',
  },
} as const;

/**
 * Feature flags that map to plan features.
 */
export const FEATURES = {
  LLM_CHAT: 'llm_chat',
  FREE_MODELS: 'free_models',
  PRO_MODELS: 'pro_models',
} as const;

/**
 * Check if auth is configured (publishable key present).
 * When not configured, the chat works in anonymous free-tier mode.
 */
export function isClerkConfigured(): boolean {
  return Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
}
