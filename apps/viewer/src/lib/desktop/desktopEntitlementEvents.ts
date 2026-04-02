/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const DESKTOP_ENTITLEMENT_REFRESH_EVENT = 'ifc-lite:desktop-entitlement-refresh';

interface DesktopEntitlementRefreshDetail {
  resolve: () => void;
  reject: (error?: unknown) => void;
}

export function requestDesktopEntitlementRefresh(): Promise<void> {
  return new Promise((resolve, reject) => {
    window.dispatchEvent(new CustomEvent<DesktopEntitlementRefreshDetail>(
      DESKTOP_ENTITLEMENT_REFRESH_EVENT,
      { detail: { resolve, reject } },
    ));
  });
}
