/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { StateCreator } from 'zustand';
import {
  getDefaultDesktopEntitlement,
  type DesktopEntitlement,
  type DesktopEntitlementSource,
  type DesktopEntitlementStatus,
} from '@/lib/desktop-product';

const STORAGE_KEY = 'ifc-lite:desktop-entitlement:v1';

function sanitizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStoredEntitlement(raw: string | null): DesktopEntitlement {
  if (!raw) {
    return getDefaultDesktopEntitlement();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DesktopEntitlement> | null;
    const fallback = getDefaultDesktopEntitlement();
    return {
      tier: parsed?.tier === 'pro' ? 'pro' : 'free',
      status: isEntitlementStatus(parsed?.status) ? parsed.status : fallback.status,
      source: isEntitlementSource(parsed?.source) ? parsed.source : fallback.source,
      userId: typeof parsed?.userId === 'string' ? parsed.userId : null,
      validatedAt: sanitizeTimestamp(parsed?.validatedAt),
      graceUntil: sanitizeTimestamp(parsed?.graceUntil),
      trialEndsAt: sanitizeTimestamp(parsed?.trialEndsAt),
    };
  } catch {
    return getDefaultDesktopEntitlement();
  }
}

function isEntitlementStatus(value: unknown): value is DesktopEntitlementStatus {
  return value === 'anonymous'
    || value === 'signed_out'
    || value === 'active'
    || value === 'trial'
    || value === 'expired'
    || value === 'grace_offline';
}

function isEntitlementSource(value: unknown): value is DesktopEntitlementSource {
  return value === 'anonymous' || value === 'clerk_claims' || value === 'cached';
}

function persistEntitlement(entitlement: DesktopEntitlement): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entitlement));
  } catch {
    // ignore storage failures
  }
}

export interface DesktopEntitlementSlice {
  desktopEntitlement: DesktopEntitlement;
  setDesktopEntitlement: (entitlement: DesktopEntitlement) => void;
  clearDesktopEntitlement: () => void;
}

export const createDesktopEntitlementSlice: StateCreator<
  DesktopEntitlementSlice,
  [],
  [],
  DesktopEntitlementSlice
> = (set) => ({
  desktopEntitlement: parseStoredEntitlement(typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)),

  setDesktopEntitlement: (desktopEntitlement) => {
    persistEntitlement(desktopEntitlement);
    set({ desktopEntitlement });
  },

  clearDesktopEntitlement: () => {
    const next = getDefaultDesktopEntitlement();
    persistEntitlement(next);
    set({ desktopEntitlement: next });
  },
});
