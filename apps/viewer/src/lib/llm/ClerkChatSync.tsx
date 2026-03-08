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
  const switchChatUserContext = useViewerStore((s) => s.switchChatUserContext);
  const currentChatUserId = useViewerStore((s) => s.chatStorageUserId);
  const currentChatHasPro = useViewerStore((s) => s.chatHasPro);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      switchChatUserContext(null, false, {
        clearPersistedCurrent: currentChatUserId !== null,
        restoreMessages: false,
      });
      setChatAuthToken(null);
      return;
    }

    let cancelled = false;

    const syncAuth = async () => {
      try {
        const token = await getToken({ skipCache: true });
        const proPlan = has?.({ plan: 'pro' }) ?? false;
        const proFeature = has?.({ feature: 'pro_models' }) ?? false;
        const nextHasPro = proPlan || proFeature;
        if (!cancelled) {
          // Avoid resetting chat usage/messages on routine token refreshes for
          // the same signed-in user. Only switch context when identity or
          // entitlement actually changes.
          if (currentChatUserId !== (userId ?? null) || currentChatHasPro !== nextHasPro) {
            switchChatUserContext(userId ?? null, nextHasPro, {
              clearPersistedCurrent: currentChatUserId !== null && currentChatUserId !== userId,
              restoreMessages: true,
            });
          }
          if (token) {
            setChatAuthToken(token);
          }
        }
      } catch {
        if (!cancelled) {
          // Preserve the current signed-in chat context on transient token
          // refresh failures. Explicit sign-out is handled above.
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
  }, [currentChatHasPro, currentChatUserId, getToken, has, isLoaded, isSignedIn, setChatAuthToken, switchChatUserContext, userId]);

  return null;
}
