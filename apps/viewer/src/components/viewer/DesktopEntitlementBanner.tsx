/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { AlertTriangle, Clock3, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { buildDesktopUpgradeUrl, hasDesktopPro } from '@/lib/desktop-product';
import { navigateToPath } from '@/services/app-navigation';

function formatDate(timestamp: number | null): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toLocaleDateString();
}

export function DesktopEntitlementBanner() {
  const entitlement = useViewerStore((s) => s.desktopEntitlement);

  if (entitlement.status === 'active' || entitlement.status === 'anonymous') {
    return null;
  }

  if (entitlement.status === 'trial') {
    return (
      <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
        <div className="flex items-center gap-2 min-w-0">
          <Clock3 className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Desktop Pro trial active{formatDate(entitlement.trialEndsAt) ? ` until ${formatDate(entitlement.trialEndsAt)}` : ''}.
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigateToPath('/settings')}>
          View Plan
        </Button>
      </div>
    );
  }

  if (entitlement.status === 'grace_offline') {
    return (
      <div className="flex items-center justify-between gap-3 border-b bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:bg-blue-950/60 dark:text-blue-200">
        <div className="flex items-center gap-2 min-w-0">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Offline grace active{formatDate(entitlement.graceUntil) ? ` until ${formatDate(entitlement.graceUntil)}` : ''}. Pro features remain available from the last validated plan.
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigateToPath('/settings')}>
          View Plan
        </Button>
      </div>
    );
  }

  if (!hasDesktopPro(entitlement)) {
    return (
      <div className="flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-2 text-sm text-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="truncate">
            Desktop Pro is not active. Core viewing stays available; advanced features are locked.
          </span>
        </div>
        <Button variant="default" size="sm" onClick={() => navigateToPath(buildDesktopUpgradeUrl())}>
          Upgrade
        </Button>
      </div>
    );
  }

  return null;
}
