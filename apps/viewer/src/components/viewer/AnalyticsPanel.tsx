/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback } from 'react';
import {
  BarChart3,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Database,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { IfcServerClient } from '@ifc-lite/server-client';
import { SERVER_URL } from '@/utils/ifcConfig';

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
  const setAnalyticsPublishing = useViewerStore((s) => s.setAnalyticsPublishing);
  const setAnalyticsPublished = useViewerStore((s) => s.setAnalyticsPublished);
  const setAnalyticsError = useViewerStore((s) => s.setAnalyticsError);

  // Get the current model's cache key from the data store
  // We look for models that have a cacheKey, or we check the loading state
  const models = useViewerStore((s) => s.models);

  // Find the cache key from the first loaded model
  const cacheKey = (() => {
    if (analyticsPublishedCacheKey) return analyticsPublishedCacheKey;
    for (const [, model] of models) {
      if (model.id) return model.id; // Model ID is typically the cache key in server mode
    }
    return null;
  })();

  const handlePublish = useCallback(async () => {
    if (!cacheKey || !SERVER_URL) return;

    setAnalyticsPublishing();

    try {
      const client = new IfcServerClient({ baseUrl: SERVER_URL });

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

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          <span className="font-medium text-sm">Analytics</span>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
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
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.open(analyticsDashboardUrl, '_blank')}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Superset Dashboard
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
        </div>
      </div>
    </div>
  );
}
