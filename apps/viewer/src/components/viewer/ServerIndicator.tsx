/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react';
import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';

/**
 * Small status indicator in the status bar showing server connection state.
 *
 * - Green dot: connected, analytics available
 * - Yellow dot: connected, analytics unavailable
 * - Red dot: disconnected or error
 * - Spinner: health check in progress
 */
export function ServerIndicator() {
  const serverUrl = useViewerStore((s) => s.serverUrl);
  const isServerConnected = useViewerStore((s) => s.isServerConnected);
  const isAnalyticsAvailable = useViewerStore((s) => s.isAnalyticsAvailable);
  const serverCheckInProgress = useViewerStore((s) => s.serverCheckInProgress);
  const serverError = useViewerStore((s) => s.serverError);
  const checkServerConnection = useViewerStore((s) => s.checkServerConnection);

  // Auto-check on mount when URL is configured
  useEffect(() => {
    if (serverUrl) {
      checkServerConnection();
    }
  }, [serverUrl, checkServerConnection]);

  // Don't render if no server URL is configured
  if (!serverUrl) return null;

  const tooltipText = (() => {
    if (serverCheckInProgress) return 'Checking server...';
    if (serverError) return `Server error: ${serverError}`;
    if (!isServerConnected) return 'Server disconnected';
    if (isAnalyticsAvailable) return 'Server connected (analytics enabled)';
    return 'Server connected (analytics not configured)';
  })();

  const dotColor = (() => {
    if (serverCheckInProgress) return 'bg-blue-500';
    if (!isServerConnected) return 'bg-red-500';
    if (isAnalyticsAvailable) return 'bg-green-500';
    return 'bg-yellow-500';
  })();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={checkServerConnection}
        >
          {serverCheckInProgress ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isServerConnected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
