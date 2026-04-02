/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { SignInButton, SignedIn, SignedOut, UserButton, useAuth, useUser } from '@clerk/clerk-react';
import {
  ArrowLeft,
  Bot,
  Check,
  Clock3,
  Cloud,
  CreditCard,
  FolderOpen,
  LayoutPanelTop,
  Lock,
  RefreshCw,
  Settings2,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import {
  buildDesktopUpgradeUrl,
  getDesktopFeatureCatalog,
  getDesktopPlanSummary,
  getDesktopPlanTier,
  hasDesktopPro,
  isDesktopBillingEnforced,
  type DesktopEntitlement,
} from '@/lib/desktop-product';
import { isClerkConfigured } from '@/lib/llm/clerk-auth';
import { navigateToPath } from '@/services/app-navigation';
import { requestDesktopEntitlementRefresh } from '@/lib/desktop/desktopEntitlementEvents';
import {
  getDesktopPreferences,
  subscribeDesktopPreferences,
  updateDesktopPreferences,
} from '@/services/desktop-preferences';

export function SettingsPage() {
  const clerkEnabled = isClerkConfigured();
  const desktopEntitlement = useViewerStore((s) => s.desktopEntitlement);
  const chatUsage = useViewerStore((s) => s.chatUsage);
  const [preferences, setPreferences] = useState(() => getDesktopPreferences());
  const [isRefreshingAccount, setIsRefreshingAccount] = useState(false);
  const returnTo = (() => {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get('returnTo');
    return candidate && candidate.startsWith('/') ? candidate : '/';
  })();
  useEffect(() => subscribeDesktopPreferences(() => {
    setPreferences(getDesktopPreferences());
  }), []);

  const updatePreference = (updates: Partial<typeof preferences>) => {
    setPreferences(updateDesktopPreferences(updates));
  };
  const planTier = getDesktopPlanTier(desktopEntitlement);
  const planSummary = getDesktopPlanSummary(desktopEntitlement, chatUsage);
  const featureCatalog = getDesktopFeatureCatalog(desktopEntitlement);
  const canRestoreWorkspace = hasDesktopPro(desktopEntitlement);
  const usageSummary = useMemo(() => {
    if (!chatUsage) {
      return null;
    }
    const resetLabel = chatUsage.resetAt
      ? new Date(chatUsage.resetAt * 1000).toLocaleDateString()
      : 'Unknown';
    const unit = chatUsage.type === 'credits' ? 'credits' : 'requests';
    return `${chatUsage.used}/${chatUsage.limit} ${unit} used. Resets ${resetLabel}.`;
  }, [chatUsage]);

  const handleRefreshAccount = async () => {
    setIsRefreshingAccount(true);
    try {
      await requestDesktopEntitlementRefresh();
      toast.success('Account status refreshed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not refresh account status';
      toast.error(message);
    } finally {
      setIsRefreshingAccount(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigateToPath(returnTo, { replace: true })}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Viewer
          </Button>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <ShieldCheck className="h-5 w-5" />
              <div>
                <h1 className="text-2xl font-semibold">Desktop Account</h1>
                <p className="text-sm text-muted-foreground">
                  App-wide entitlement, trial state, offline grace, and AI usage limits.
                </p>
              </div>
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2">
              <StatusBadge entitlement={desktopEntitlement} />
              <Badge variant={hasDesktopPro(desktopEntitlement) ? 'default' : 'secondary'}>
                {planTier === 'pro' ? 'Desktop Pro' : 'Desktop Free'}
              </Badge>
              <Badge variant="outline">
                Source: {desktopEntitlement.source.replace('_', ' ')}
              </Badge>
            </div>

            <div className="mb-5 grid gap-3 md:grid-cols-2">
              <InfoCard
                title="Plan Summary"
                body={planSummary}
                icon={<CreditCard className="h-4 w-4" />}
              />
              <InfoCard
                title="AI Usage"
                body={usageSummary ?? 'No AI usage data yet. Pro usage appears after the first synced usage snapshot.'}
                icon={<Bot className="h-4 w-4" />}
              />
              <InfoCard
                title="Last Validated"
                body={formatTimestamp(desktopEntitlement.validatedAt)}
                icon={<Clock3 className="h-4 w-4" />}
              />
              <InfoCard
                title="Offline Grace"
                body={formatOfflineGrace(desktopEntitlement)}
                icon={<WifiOff className="h-4 w-4" />}
              />
            </div>

            {clerkEnabled ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => void handleRefreshAccount()}
                  disabled={isRefreshingAccount}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingAccount ? 'animate-spin' : ''}`} />
                  Refresh Account Status
                </Button>
                {!hasDesktopPro(desktopEntitlement) ? (
                  <Button onClick={() => navigateToPath(buildDesktopUpgradeUrl('/settings'))}>
                    Upgrade to Pro
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <Settings2 className="h-5 w-5" />
              <div>
                <h1 className="text-2xl font-semibold">Desktop Settings</h1>
                <p className="text-sm text-muted-foreground">
                  Local preferences for startup behavior and account access.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-md border p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <FolderOpen className="h-4 w-4" />
                    Reopen last model on launch
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Automatically load the most recently used IFC file when the desktop app starts.
                  </p>
                </div>
                <Switch
                  checked={preferences.reopenLastModelOnLaunch}
                  onCheckedChange={(checked) => updatePreference({ reopenLastModelOnLaunch: checked })}
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md border p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <LayoutPanelTop className="h-4 w-4" />
                    Restore workspace layout
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Restore panel visibility, camera view, sectioning, and other saved workspace state on launch. Desktop Pro feature.
                  </p>
                </div>
                <Switch
                  checked={preferences.restoreWorkspaceLayoutOnLaunch}
                  disabled={!canRestoreWorkspace}
                  onCheckedChange={(checked) => updatePreference({ restoreWorkspaceLayoutOnLaunch: checked })}
                />
              </div>
              {!canRestoreWorkspace && (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Workspace restore is included with Desktop Pro. Reopening the last model remains available on Free.
                  <div className="mt-3">
                    <Button size="sm" onClick={() => navigateToPath(buildDesktopUpgradeUrl('/settings'))}>
                      Upgrade to Desktop Pro
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <CreditCard className="h-5 w-5" />
              <div>
                <h2 className="text-xl font-semibold">Billing & Features</h2>
                <p className="text-sm text-muted-foreground">
                  Desktop billing is app-wide. The viewer stays available on Free, while Pro unlocks advanced desktop features and full AI access.
                </p>
              </div>
            </div>

            <div className="mb-5 rounded-md border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium capitalize">{planTier} plan</div>
                  <p className="text-sm text-muted-foreground">{planSummary}</p>
                  <p className="text-sm text-muted-foreground">
                    Desktop caches the latest validated plan locally and stores the auth bearer in native secure storage when available.
                  </p>
                </div>
                {isDesktopBillingEnforced() && !hasDesktopPro(desktopEntitlement) && (
                  <Button onClick={() => navigateToPath(buildDesktopUpgradeUrl('/settings'))}>
                    Upgrade to Pro
                  </Button>
                )}
              </div>
            </div>

            <div className="mb-5 grid gap-3">
              {featureCatalog.map((feature) => (
                <div key={feature.key} className="flex items-start justify-between gap-4 rounded-md border p-4">
                  <div>
                    <div className="font-medium">{feature.label}</div>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {feature.enabled ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-500" />
                        Included
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4 text-amber-500" />
                        Pro
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {!clerkEnabled ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Auth and billing are not configured in this build. Set `VITE_CLERK_PUBLISHABLE_KEY` to enable sign-in and subscription flows.
              </div>
            ) : (
              <SettingsAccountSection desktopEntitlement={desktopEntitlement} />
            )}
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <Cloud className="h-5 w-5" />
              <div>
                <h2 className="text-xl font-semibold">Privacy & Network</h2>
                <p className="text-sm text-muted-foreground">
                  Local IFC viewing remains available offline. Connected services degrade individually instead of blocking the desktop viewer.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <InfoCard
                title="Always Local"
                body="Model loading, hierarchy, properties, navigation, measurement, and core viewing stay on your machine."
                icon={<ShieldCheck className="h-4 w-4" />}
              />
              <InfoCard
                title="Needs Network"
                body="Cloud AI assistant, billing sync, and live bSDD lookups require network access. Cached Pro can continue during offline grace."
                icon={<Cloud className="h-4 w-4" />}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return 'Not validated yet';
  }
  return new Date(value).toLocaleString();
}

function formatOfflineGrace(entitlement: DesktopEntitlement): string {
  if (!entitlement.graceUntil) {
    return 'No offline grace cached yet';
  }
  const remainingDays = Math.max(0, Math.ceil((entitlement.graceUntil - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${new Date(entitlement.graceUntil).toLocaleString()}${remainingDays > 0 ? ` (${remainingDays} day${remainingDays === 1 ? '' : 's'} left)` : ''}`;
}

function describeDesktopStatus(entitlement: DesktopEntitlement): string {
  switch (entitlement.status) {
    case 'trial':
      return entitlement.trialEndsAt
        ? `Trial active until ${new Date(entitlement.trialEndsAt).toLocaleDateString()}`
        : 'Trial active';
    case 'grace_offline':
      return entitlement.graceUntil
        ? `Offline grace until ${new Date(entitlement.graceUntil).toLocaleDateString()}`
        : 'Offline grace active';
    case 'expired':
      return 'Subscription expired';
    case 'active':
      return 'Subscription active';
    case 'signed_out':
      return 'Signed out';
    case 'anonymous':
      return 'Auth unavailable in this build';
    default:
      return entitlement.status;
  }
}

function getStatusBadgeVariant(entitlement: DesktopEntitlement): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (entitlement.status) {
    case 'active':
    case 'trial':
      return 'default';
    case 'grace_offline':
      return 'secondary';
    case 'expired':
      return 'destructive';
    default:
      return 'outline';
  }
}

function StatusBadge({ entitlement }: { entitlement: DesktopEntitlement }) {
  return (
    <Badge variant={getStatusBadgeVariant(entitlement)}>
      {describeDesktopStatus(entitlement)}
    </Badge>
  );
}

function InfoCard({ title, body, icon }: { title: string; body: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function SettingsAccountSection({ desktopEntitlement }: { desktopEntitlement: DesktopEntitlement }) {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const hasPro = hasDesktopPro(desktopEntitlement);
  const statusLabel = describeDesktopStatus(desktopEntitlement);

  return (
    <div className="space-y-4">
      <SignedOut>
        <div className="rounded-md border p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Sign in to sync your desktop plan, subscription status, and AI usage limits across web and desktop.
          </p>
          <SignInButton mode="modal" forceRedirectUrl="/settings" fallbackRedirectUrl="/settings">
            <Button>Sign in</Button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div>
            <div className="font-medium">
              {user?.primaryEmailAddress?.emailAddress ?? user?.username ?? 'Signed in'}
            </div>
            <p className="text-sm text-muted-foreground">
              Plan: {hasPro ? 'Pro' : 'Free'}
            </p>
            <p className="text-sm text-muted-foreground">
              Status: {statusLabel}
            </p>
            <p className="text-sm text-muted-foreground">
              Last validated: {formatTimestamp(desktopEntitlement.validatedAt)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <UserButton afterSignOutUrl="/" />
            <Button onClick={() => navigateToPath(buildDesktopUpgradeUrl('/settings'))}>
              {isSignedIn && hasPro ? 'Manage Plan' : 'Upgrade to Pro'}
            </Button>
          </div>
        </div>
      </SignedIn>
    </div>
  );
}
