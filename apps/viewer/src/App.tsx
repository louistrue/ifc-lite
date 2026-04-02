/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Main application component
 */

import { ViewerLayout } from './components/viewer/ViewerLayout';
import { SettingsPage } from './components/viewer/SettingsPage';
import { UpgradePage } from './components/viewer/UpgradePage';
import { BimProvider } from './sdk/BimProvider';
import { Toaster } from './components/ui/toast';
import { ClerkChatSync } from './lib/llm/ClerkChatSync';
import { isClerkConfigured } from './lib/llm/clerk-auth';
import { useEffect, useState } from 'react';
import { logToDesktopTerminal } from './services/desktop-logger';

export function App() {
  const clerkEnabled = isClerkConfigured();
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onRouteChange = () => setPathname(window.location.pathname);
    const onError = (event: ErrorEvent) => {
      void logToDesktopTerminal(
        'error',
        `[App/error] message=${event.message} source=${event.filename}:${event.lineno}:${event.colno}`
      );
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      void logToDesktopTerminal('error', `[App/unhandledrejection] ${reason}`);
    };
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  const isUpgradeRoute = pathname === '/upgrade';
  const isSettingsRoute = pathname === '/settings';

  return (
    <BimProvider>
      {clerkEnabled && <ClerkChatSync />}
      {isUpgradeRoute ? <UpgradePage /> : isSettingsRoute ? <SettingsPage /> : <ViewerLayout />}
      <Toaster />
    </BimProvider>
  );
}

export default App;
