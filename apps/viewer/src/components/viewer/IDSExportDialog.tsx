/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IDS BCF Export Dialog
 *
 * Provides a configuration dialog for exporting IDS validation results to BCF.
 * Options include:
 * - Topic grouping strategy (per-entity, per-specification, per-requirement)
 * - Include passing entities
 * - Include per-entity camera positions (from entity bounds)
 * - Capture per-entity snapshots (batch render)
 * - Load into BCF panel after export
 */

import { useState, useCallback } from 'react';
import {
  FileBox,
  Loader2,
  Camera,
  Focus,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// ============================================================================
// Types
// ============================================================================

export type TopicGrouping = 'per-entity' | 'per-specification' | 'per-requirement';

export interface IDSBCFExportSettings {
  topicGrouping: TopicGrouping;
  includePassingEntities: boolean;
  includeCamera: boolean;
  includeSnapshots: boolean;
  loadIntoBcfPanel: boolean;
}

export interface IDSExportProgress {
  phase: 'building' | 'snapshots' | 'writing' | 'done';
  current: number;
  total: number;
  message: string;
}

interface IDSExportDialogProps {
  /** Trigger element (e.g., a button) — only used for uncontrolled mode */
  trigger?: React.ReactNode;
  /** Whether a report is available */
  hasReport: boolean;
  /** Total failing entity count for display */
  failedCount: number;
  /** Called when export is confirmed */
  onExport: (settings: IDSBCFExportSettings) => Promise<void>;
  /** Export progress (controlled externally) */
  progress: IDSExportProgress | null;
  /** Controlled open state (if provided, dialog is controlled externally) */
  open?: boolean;
  /** Controlled open state callback */
  onOpenChange?: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

export function IDSExportDialog({
  trigger,
  hasReport,
  failedCount,
  onExport,
  progress,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: IDSExportDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [settings, setSettings] = useState<IDSBCFExportSettings>({
    topicGrouping: 'per-entity',
    includePassingEntities: false,
    includeCamera: true,
    includeSnapshots: false,
    loadIntoBcfPanel: false,
  });

  const isExporting = progress !== null && progress.phase !== 'done';

  const handleExport = useCallback(async () => {
    await onExport(settings);
    // Don't close — let the progress indicator finish, then user closes
  }, [onExport, settings]);

  const handleOpenChange = useCallback((value: boolean) => {
    // Don't allow closing during export
    if (isExporting) return;
    setOpen(value);
  }, [isExporting, setOpen]);

  const progressPercent = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBox className="h-5 w-5 text-green-500" />
            Export IDS Report as BCF
          </DialogTitle>
          <DialogDescription>
            Create BCF topics from IDS validation failures.
            {failedCount > 0 && ` ${failedCount} failing entities found.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Topic Grouping */}
          <div className="grid gap-2">
            <Label htmlFor="grouping">Topic Grouping</Label>
            <Select
              value={settings.topicGrouping}
              onValueChange={(v) => setSettings(s => ({
                ...s,
                topicGrouping: v as TopicGrouping,
                // Reset includePassingEntities when switching away from per-entity (only valid in per-entity mode)
                ...(v !== 'per-entity' && { includePassingEntities: false }),
              }))}
              disabled={isExporting}
            >
              <SelectTrigger id="grouping">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per-entity">Per Entity (recommended)</SelectItem>
                <SelectItem value="per-specification">Per Specification</SelectItem>
                <SelectItem value="per-requirement">Per Requirement</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {settings.topicGrouping === 'per-entity' && 'One topic per failing entity. Failed requirements listed as comments.'}
              {settings.topicGrouping === 'per-specification' && 'One topic per failing specification. Entities listed as comments.'}
              {settings.topicGrouping === 'per-requirement' && 'One topic per failed requirement per entity (most granular).'}
            </p>
          </div>

          {/* Include Passing */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-passing">Include Passing Entities</Label>
              <p className="text-xs text-muted-foreground">Add topics for entities that passed validation</p>
            </div>
            <Switch
              id="include-passing"
              checked={settings.includePassingEntities}
              onCheckedChange={(v) => setSettings(s => ({ ...s, includePassingEntities: v }))}
              disabled={isExporting || settings.topicGrouping !== 'per-entity'}
            />
          </div>

          {/* Include Camera */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-camera" className="flex items-center gap-1.5">
                <Focus className="h-3.5 w-3.5" />
                Per-Entity Camera
              </Label>
              <p className="text-xs text-muted-foreground">Compute camera framing each entity from its bounding box</p>
            </div>
            <Switch
              id="include-camera"
              checked={settings.includeCamera}
              onCheckedChange={(v) => setSettings(s => ({ ...s, includeCamera: v }))}
              disabled={isExporting}
            />
          </div>

          {/* Include Snapshots */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-snapshots" className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                Capture Snapshots
              </Label>
              <p className="text-xs text-muted-foreground">
                Render a screenshot for each entity (slow for large reports)
              </p>
            </div>
            <Switch
              id="include-snapshots"
              checked={settings.includeSnapshots}
              onCheckedChange={(v) => setSettings(s => ({ ...s, includeSnapshots: v }))}
              disabled={isExporting}
            />
          </div>

          {/* Load into BCF Panel */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="load-panel" className="flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                Load into BCF Panel
              </Label>
              <p className="text-xs text-muted-foreground">Open the BCF panel with exported topics after export</p>
            </div>
            <Switch
              id="load-panel"
              checked={settings.loadIntoBcfPanel}
              onCheckedChange={(v) => setSettings(s => ({ ...s, loadIntoBcfPanel: v }))}
              disabled={isExporting}
            />
          </div>

          {/* Progress */}
          {progress && (
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{progress.message}</span>
                <span className="font-mono text-xs">{progress.current}/{progress.total}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isExporting}
          >
            {progress?.phase === 'done' ? 'Close' : 'Cancel'}
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !hasReport}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <FileBox className="h-4 w-4 mr-2" />
                Export BCF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
