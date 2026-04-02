/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isClerkConfigured } from './llm/clerk-auth';

export type DesktopPlanTier = 'free' | 'pro';
export type DesktopEntitlementStatus = 'anonymous' | 'signed_out' | 'active' | 'trial' | 'expired' | 'grace_offline';
export type DesktopEntitlementSource = 'anonymous' | 'clerk_claims' | 'cached';

export type DesktopFeature =
  | 'viewer_basic'
  | 'workspace_restore'
  | 'exports'
  | 'ids_validation'
  | 'bcf_issue_management'
  | 'ai_assistant';

export interface DesktopEntitlement {
  tier: DesktopPlanTier;
  status: DesktopEntitlementStatus;
  source: DesktopEntitlementSource;
  userId: string | null;
  validatedAt: number | null;
  graceUntil: number | null;
  trialEndsAt: number | null;
}

export interface DesktopUsageSummary {
  type: 'credits' | 'requests';
  used: number;
  limit: number;
  pct?: number;
  resetAt?: number;
}

interface DesktopFeatureDefinition {
  label: string;
  description: string;
  free: boolean;
}

const DESKTOP_FEATURES: Record<DesktopFeature, DesktopFeatureDefinition> = {
  viewer_basic: {
    label: 'Desktop viewer',
    description: 'Open IFC files, inspect hierarchy and properties, navigate, section, and measure offline.',
    free: true,
  },
  workspace_restore: {
    label: 'Workspace restore',
    description: 'Restore workspace layout, camera position, and saved desktop context across launches.',
    free: false,
  },
  exports: {
    label: 'Exports',
    description: 'IFC export, GLB, CSV, JSON, screenshots, and other native save flows.',
    free: false,
  },
  ids_validation: {
    label: 'IDS validation',
    description: 'Load IDS files, validate models, inspect results, and export validation reports.',
    free: false,
  },
  bcf_issue_management: {
    label: 'BCF issue management',
    description: 'Create, import, edit, and export BCF topics with viewpoints and screenshots.',
    free: false,
  },
  ai_assistant: {
    label: 'AI assistant',
    description: 'Script repair and model generation with the same monthly LLM limits and routing as web.',
    free: false,
  },
};

export function isDesktopBillingEnforced(): boolean {
  return isClerkConfigured();
}

export function getDesktopPlanTier(entitlementOrHasPro: DesktopEntitlement | boolean): DesktopPlanTier {
  return typeof entitlementOrHasPro === 'boolean'
    ? (entitlementOrHasPro ? 'pro' : 'free')
    : entitlementOrHasPro.tier;
}

export function hasDesktopPro(entitlementOrHasPro: DesktopEntitlement | boolean): boolean {
  return getDesktopPlanTier(entitlementOrHasPro) === 'pro';
}

export function hasDesktopFeatureAccess(entitlementOrHasPro: DesktopEntitlement | boolean, feature: DesktopFeature): boolean {
  if (!isDesktopBillingEnforced()) {
    return true;
  }
  if (hasDesktopPro(entitlementOrHasPro)) {
    return true;
  }
  return DESKTOP_FEATURES[feature].free;
}

export function getDesktopFeatureCatalog(entitlementOrHasPro: DesktopEntitlement | boolean) {
  return (Object.entries(DESKTOP_FEATURES) as Array<[DesktopFeature, DesktopFeatureDefinition]>).map(([key, value]) => ({
    key,
    ...value,
    enabled: hasDesktopFeatureAccess(entitlementOrHasPro, key),
  }));
}

export function buildDesktopUpgradeUrl(returnTo?: string): string {
  const fallbackReturnTo = typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search}`
    : '/';
  const nextReturnTo = returnTo ?? fallbackReturnTo;
  return `/upgrade?returnTo=${encodeURIComponent(nextReturnTo)}`;
}

export function getDefaultDesktopEntitlement(): DesktopEntitlement {
  return {
    tier: 'free',
    status: isDesktopBillingEnforced() ? 'signed_out' : 'anonymous',
    source: isDesktopBillingEnforced() ? 'cached' : 'anonymous',
    userId: null,
    validatedAt: null,
    graceUntil: null,
    trialEndsAt: null,
  };
}

export function getDesktopPlanSummary(entitlementOrHasPro: DesktopEntitlement | boolean, usage: DesktopUsageSummary | null): string {
  if (!isDesktopBillingEnforced()) {
    return 'Auth and billing are not configured in this build.';
  }
  const entitlement = typeof entitlementOrHasPro === 'boolean'
    ? { ...getDefaultDesktopEntitlement(), tier: entitlementOrHasPro ? 'pro' : 'free' }
    : entitlementOrHasPro;
  if (entitlement.status === 'trial' && entitlement.trialEndsAt) {
    return `Trial active until ${new Date(entitlement.trialEndsAt).toLocaleDateString()}. Pro features are unlocked during the trial.`;
  }
  if (entitlement.status === 'grace_offline' && entitlement.graceUntil) {
    return `Offline grace active until ${new Date(entitlement.graceUntil).toLocaleDateString()}.`;
  }
  if (hasDesktopPro(entitlement)) {
    if (usage) {
      const unit = usage.type === 'credits' ? 'credits' : 'requests';
      return `Pro plan active. AI usage: ${usage.used}/${usage.limit} ${unit}.`;
    }
    return 'Pro plan active. AI assistant limits follow the same monthly quota system as web.';
  }
  if (entitlement.status === 'expired') {
    return 'Desktop Pro has expired. Core viewing remains available, while advanced features are locked.';
  }
  return 'Free plan active. The desktop viewer stays available, while Pro unlocks advanced app-wide features.';
}
