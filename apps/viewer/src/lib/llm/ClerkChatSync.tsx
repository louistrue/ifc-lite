/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useViewerStore } from '@/store';

/**
 * Sync Clerk session state into chat store for authenticated LLM requests.
 * Keeps chat UX decoupled from auth/billing details.
 */
export function ClerkChatSync() {
  const { isLoaded, isSignedIn, userId, getToken, has } = useAuth();
  const setChatAuthToken = useViewerStore((s) => s.setChatAuthToken);
  const setChatHasPro = useViewerStore((s) => s.setChatHasPro);
  const setChatStorageUserId = useViewerStore((s) => s.setChatStorageUserId);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setChatStorageUserId(null);
      setChatAuthToken(null);
      setChatHasPro(false);
      return;
    }

    setChatStorageUserId(userId ?? null);

    let cancelled = false;

    const syncAuth = async () => {
      try {
        const token = await getToken({ skipCache: true });
        const proPlan = has?.({ plan: 'pro' }) ?? false;
        const proFeature = has?.({ feature: 'pro_models' }) ?? false;
        if (!cancelled) {
          setChatAuthToken(token ?? null);
          setChatHasPro(proPlan || proFeature);
        }
      } catch {
        if (!cancelled) {
          setChatAuthToken(null);
          setChatHasPro(false);
        }
      }
    };

    void syncAuth();
    // Keep short-lived JWTs fresh so chat/usage polling doesn't reuse expired tokens.
    const timer = window.setInterval(() => {
      void syncAuth();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getToken, has, isLoaded, isSignedIn, setChatAuthToken, setChatHasPro, setChatStorageUserId, userId]);

  return null;
}
