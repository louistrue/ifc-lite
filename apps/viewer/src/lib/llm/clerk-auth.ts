/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clerk authentication helpers for the LLM chat integration.
 *
 * Clerk provides:
 * - User authentication (sign in/sign up)
 * - Billing with PricingTable component
 * - Feature gating via has({ feature: 'frontier_models' })
 * - JWT tokens for API authentication
 *
 * Setup:
 * 1. Install: pnpm add @clerk/clerk-react
 * 2. Set VITE_CLERK_PUBLISHABLE_KEY in .env
 * 3. Create plans in Clerk Dashboard:
 *    - Free plan (slug: 'free', features: ['llm_chat', 'free_models'])
 *    - Pro plan (slug: 'pro', $8/month, features: ['llm_chat', 'free_models', 'frontier_models'])
 * 4. Wrap app with <ClerkProvider>
 *
 * Usage in components:
 *
 * ```tsx
 * import { useAuth, useUser, Protect } from '@clerk/clerk-react';
 *
 * // Check if user has pro features
 * const { has } = useAuth();
 * const hasPro = has?.({ feature: 'frontier_models' }) ?? false;
 *
 * // Gate content
 * <Protect feature="frontier_models" fallback={<UpgradePrompt />}>
 *   <FrontierModelSelector />
 * </Protect>
 *
 * // Get token for API calls
 * const { getToken } = useAuth();
 * const token = await getToken();
 * ```
 *
 * Pricing page:
 *
 * ```tsx
 * import { PricingTable } from '@clerk/clerk-react';
 * <PricingTable />
 * ```
 */

/**
 * Subscription tiers and their features.
 * These must match the plan configuration in the Clerk Dashboard.
 */
export const SUBSCRIPTION_PLANS = {
  free: {
    slug: 'free',
    name: 'Free',
    price: 0,
    features: ['llm_chat', 'free_models'],
    description: 'Basic AI chat with free models',
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    price: 8,
    features: ['llm_chat', 'free_models', 'frontier_models'],
    description: 'Full access to frontier AI models (Claude, GPT-4, Gemini Pro)',
  },
} as const;

/**
 * Feature flags that map to Clerk plan features.
 */
export const FEATURES = {
  LLM_CHAT: 'llm_chat',
  FREE_MODELS: 'free_models',
  FRONTIER_MODELS: 'frontier_models',
} as const;

/**
 * Check if Clerk is configured (publishable key present).
 * When not configured, the chat works in "anonymous free tier" mode.
 */
export function isClerkConfigured(): boolean {
  return Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
}
