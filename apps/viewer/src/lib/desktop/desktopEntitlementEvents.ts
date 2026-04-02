/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const DESKTOP_ENTITLEMENT_REFRESH_EVENT = 'ifc-lite:desktop-entitlement-refresh';

interface DesktopEntitlementRefreshDetail {
  resolve: () => void;
  reject: (error?: unknown) => void;
}

const ENTITLEMENT_REFRESH_TIMEOUT_MS = 10_000;

export function requestDesktopEntitlementRefresh(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(
        `Desktop entitlement refresh timed out after ${ENTITLEMENT_REFRESH_TIMEOUT_MS}ms — ` +
        'no listener responded to the refresh event.',
      ));
    }, ENTITLEMENT_REFRESH_TIMEOUT_MS);

    window.dispatchEvent(new CustomEvent<DesktopEntitlementRefreshDetail>(
      DESKTOP_ENTITLEMENT_REFRESH_EVENT,
      {
        detail: {
          resolve: () => {
            globalThis.clearTimeout(timeoutId);
            resolve();
          },
          reject: (error?: unknown) => {
            globalThis.clearTimeout(timeoutId);
            reject(error);
          },
        },
      },
    ));
  });
}
