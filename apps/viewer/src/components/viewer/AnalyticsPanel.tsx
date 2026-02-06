/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Database,
  X,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { IfcServerClient } from '@ifc-lite/server-client';
import { SERVER_URL } from '@/utils/ifcConfig';

/** Superset URL from environment (for embedding dashboards). */
const SUPERSET_URL = import.meta.env.VITE_SUPERSET_URL || '';

/** Shared client instance — avoids creating a new client on each publish. */
let sharedClient: IfcServerClient | null = null;

function getClient(): IfcServerClient {
  if (!sharedClient && SERVER_URL) {
    sharedClient = new IfcServerClient({ baseUrl: SERVER_URL });
  }
  return sharedClient!;
}

interface AnalyticsPanelProps {
  onClose?: () => void;
}

export function AnalyticsPanel({ onClose }: AnalyticsPanelProps) {
  const analyticsStatus = useViewerStore((s) => s.analyticsStatus);
  const analyticsError = useViewerStore((s) => s.analyticsError);
  const analyticsModelId = useViewerStore((s) => s.analyticsModelId);
  const analyticsDashboardId = useViewerStore((s) => s.analyticsDashboardId);
  const analyticsDashboardUrl = useViewerStore((s) => s.analyticsDashboardUrl);
  const analyticsPublishedCacheKey = useViewerStore((s) => s.analyticsPublishedCacheKey);
  const analyticsEmbedVisible = useViewerStore((s) => s.analyticsEmbedVisible);
  const setAnalyticsPublishing = useViewerStore((s) => s.setAnalyticsPublishing);
  const setAnalyticsPublished = useViewerStore((s) => s.setAnalyticsPublished);
  const setAnalyticsError = useViewerStore((s) => s.setAnalyticsError);
  const setAnalyticsEmbedVisible = useViewerStore((s) => s.setAnalyticsEmbedVisible);

  // Get the current model's cache key from the data store
  const models = useViewerStore((s) => s.models);

  // Find the cache key from the first loaded model
  const cacheKey = (() => {
    if (analyticsPublishedCacheKey) return analyticsPublishedCacheKey;
    for (const [, model] of models) {
      if (model.id) return model.id;
    }
    return null;
  })();

  const handlePublish = useCallback(async () => {
    if (!cacheKey || !SERVER_URL) return;

    setAnalyticsPublishing();

    try {
      const client = getClient();

      // Get the first model's name for the dashboard title
      let fileName: string | undefined;
      for (const [, model] of models) {
        if (model.name) {
          fileName = model.name;
          break;
        }
      }

      const result = await client.publishToAnalytics(cacheKey, fileName);

      setAnalyticsPublished(
        result.model_id,
        cacheKey,
        result.dashboard_id,
        result.dashboard_url,
      );
    } catch (err) {
      setAnalyticsError(
        err instanceof Error ? err.message : 'Failed to publish to analytics',
      );
    }
  }, [cacheKey, models, setAnalyticsPublishing, setAnalyticsPublished, setAnalyticsError]);

  // Determine if we can embed the dashboard
  const canEmbed = analyticsDashboardId != null && SUPERSET_URL !== '';

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          <span className="font-medium text-sm">Analytics</span>
        </div>
        <div className="flex items-center gap-1">
          {canEmbed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAnalyticsEmbedVisible(!analyticsEmbedVisible)}
              title={analyticsEmbedVisible ? 'Hide embedded dashboard' : 'Show embedded dashboard'}
            >
              {analyticsEmbedVisible ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto flex flex-col">
        {/* Embedded Dashboard */}
        {analyticsEmbedVisible && canEmbed ? (
          <EmbeddedDashboard
            dashboardId={analyticsDashboardId!}
            supersetUrl={SUPERSET_URL}
          />
        ) : (
          <div className="p-4 space-y-4">
            {/* Status Section */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Publication Status
              </h3>

              {analyticsStatus === 'idle' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Database className="h-4 w-4" />
                  <span>Model not yet published to analytics database</span>
                </div>
              )}

              {analyticsStatus === 'publishing' && (
                <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Publishing to database...</span>
                </div>
              )}

              {analyticsStatus === 'published' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Published to analytics database</span>
                  </div>
                  {analyticsModelId && (
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      Model ID: {analyticsModelId}
                    </div>
                  )}
                </div>
              )}

              {analyticsStatus === 'error' && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span>Publication failed</span>
                  </div>
                  {analyticsError && (
                    <p className="text-xs text-muted-foreground pl-6">
                      {analyticsError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              {(analyticsStatus === 'idle' || analyticsStatus === 'error') && (
                <Button
                  onClick={handlePublish}
                  disabled={!cacheKey || !SERVER_URL}
                  className="w-full"
                  size="sm"
                >
                  <Database className="h-4 w-4 mr-2" />
                  Send to Analytics
                </Button>
              )}

              {analyticsStatus === 'published' && !analyticsDashboardUrl && (
                <Button
                  onClick={handlePublish}
                  variant="outline"
                  className="w-full"
                  size="sm"
                  disabled
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Published
                </Button>
              )}

              {!cacheKey && (
                <p className="text-xs text-muted-foreground text-center">
                  Load a model via server parsing to enable analytics
                </p>
              )}

              {!SERVER_URL && (
                <p className="text-xs text-muted-foreground text-center">
                  Server URL not configured. Set VITE_SERVER_URL environment variable.
                </p>
              )}
            </div>

            {/* Dashboard Section */}
            {analyticsDashboardUrl && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  Dashboard
                </h3>
                {canEmbed && (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={() => setAnalyticsEmbedVisible(true)}
                  >
                    <Maximize2 className="h-4 w-4 mr-2" />
                    Open Embedded Dashboard
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => window.open(analyticsDashboardUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Superset
                </Button>
                {analyticsDashboardId && (
                  <p className="text-xs text-muted-foreground text-center">
                    Dashboard ID: {analyticsDashboardId}
                  </p>
                )}
              </div>
            )}

            {/* Info Section */}
            <div className="space-y-2 pt-2 border-t">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                About Analytics
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Publish your IFC model data to a PostgreSQL database for
                advanced analytics and visualization with Apache Superset.
                Entity metadata, properties, quantities, relationships, and
                spatial hierarchy are all exported.
              </p>
              {SUPERSET_URL && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Embedded dashboards are available. After publishing, click
                  &ldquo;Open Embedded Dashboard&rdquo; to view charts inline.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Embedded Dashboard Component
// ============================================================================

interface EmbeddedDashboardProps {
  dashboardId: number;
  supersetUrl: string;
}

/**
 * Embedded Superset dashboard using a guest-token-authenticated iframe.
 *
 * Flow:
 * 1. Fetch guest token from server: GET /api/v1/analytics/guest-token/:dashboard_id
 * 2. Construct embedded URL: {supersetUrl}/superset/dashboard/{id}/?standalone=3&guest_token={token}
 * 3. Render in sandboxed iframe
 */
function EmbeddedDashboard({ dashboardId, supersetUrl }: EmbeddedDashboardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchGuestToken() {
      try {
        setLoading(true);
        setError(null);

        const client = getClient();
        const { token } = await client.getGuestToken(dashboardId);

        if (cancelled) return;

        // Build the embedded URL with standalone mode and guest token
        // standalone=3 hides the Superset chrome (header, nav)
        const url = `${supersetUrl}/superset/dashboard/${dashboardId}/?standalone=3&guest_token=${encodeURIComponent(token)}`;
        setEmbedUrl(url);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load embedded dashboard',
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchGuestToken();

    return () => {
      cancelled = true;
    };
  }, [dashboardId, supersetUrl]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading dashboard...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <AlertCircle className="h-6 w-6 text-destructive mx-auto" />
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-xs text-muted-foreground">
            The embedded dashboard could not be loaded. You can still open it
            externally using the link below.
          </p>
        </div>
      </div>
    );
  }

  if (!embedUrl) return null;

  return (
    <iframe
      ref={iframeRef}
      src={embedUrl}
      className="flex-1 w-full border-0"
      title="Superset Dashboard"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      loading="lazy"
    />
  );
}
