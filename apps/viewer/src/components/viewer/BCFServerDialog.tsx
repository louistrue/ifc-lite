/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCFServerDialog - Connection dialog for BCF-API servers
 *
 * Multi-step dialog:
 * 1. Enter server URL -> Discover server capabilities
 * 2. Authenticate via OAuth2 popup
 * 3. Select project from available projects
 */

import React, { useCallback, useState } from 'react';
import {
  X,
  Loader2,
  Server,
  LogIn,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useViewerStore } from '@/store';
import { useBCFApi } from '@/hooks/useBCFApi';
import type { ServerInfo, ApiProject } from '@ifc-lite/bcf';

// ============================================================================
// Types
// ============================================================================

type DialogStep = 'url' | 'authenticating' | 'project';

interface BCFServerDialogProps {
  onClose: () => void;
}

// ============================================================================
// Saved Servers
// ============================================================================

function getSavedServers(): string[] {
  try {
    const saved = localStorage.getItem('bcf-servers');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveServer(url: string): void {
  try {
    const servers = getSavedServers();
    if (!servers.includes(url)) {
      servers.unshift(url);
      // Keep only the last 5
      localStorage.setItem('bcf-servers', JSON.stringify(servers.slice(0, 5)));
    }
  } catch {
    // localStorage not available
  }
}

// ============================================================================
// Component
// ============================================================================

export function BCFServerDialog({ onClose }: BCFServerDialogProps) {
  const [step, setStep] = useState<DialogStep>('url');
  const [serverUrl, setServerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const bcfApiProjects = useViewerStore((s) => s.bcfApiProjects);
  const { discover, connect, selectProject } = useBCFApi();

  const savedServers = getSavedServers();

  // Step 1: Discover server
  const handleDiscover = useCallback(async () => {
    if (!serverUrl.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const info = await discover(serverUrl.trim());
      setServerInfo(info);

      if (!info.authUrl || !info.tokenUrl) {
        setError('Server does not support OAuth2 authentication. HTTP Basic auth is not currently supported.');
        setLoading(false);
        return;
      }

      // Proceed to authentication
      setStep('authenticating');
      setLoading(false);

      // Start OAuth flow
      try {
        if (!clientId.trim()) {
          setError('A Client ID is required. Register your application with the BCF server provider to get one.');
          setStep('url');
          return;
        }
        await connect(info, clientId.trim());
        saveServer(serverUrl.trim());
        setStep('project');
      } catch (authError) {
        setError(authError instanceof Error ? authError.message : 'Authentication failed');
        setStep('url');
      }
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : 'Failed to connect to server');
      setLoading(false);
    }
  }, [serverUrl, clientId, discover, connect]);

  // Step 3: Select project
  const handleSelectProject = useCallback(async () => {
    const project = bcfApiProjects.find((p) => p.project_id === selectedProjectId);
    if (!project) return;

    setLoading(true);
    setError(null);

    try {
      await selectProject(project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
      setLoading(false);
    }
  }, [selectedProjectId, bcfApiProjects, selectProject, onClose]);

  return (
    <div className="absolute inset-0 bg-background/90 flex items-center justify-center p-4 z-50">
      <div className="bg-card border rounded-lg p-4 w-full max-w-sm shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            <h3 className="font-medium text-sm">
              {step === 'url' && 'Connect to BCF Server'}
              {step === 'authenticating' && 'Authenticating...'}
              {step === 'project' && 'Select Project'}
            </h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-2 mb-3 bg-destructive/10 text-destructive text-xs rounded-md">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Server URL */}
        {step === 'url' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="server-url" className="text-xs">Server URL</Label>
              <Input
                id="server-url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://bcf.example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleDiscover();
                }}
                autoFocus
              />
              {savedServers.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Recent:</p>
                  <div className="flex flex-wrap gap-1">
                    {savedServers.map((url) => (
                      <Button
                        key={url}
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setServerUrl(url)}
                      >
                        {url.replace(/^https?:\/\//, '')}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-id" className="text-xs">
                Client ID
              </Label>
              <Input
                id="client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="your-registered-client-id"
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                OAuth2 client ID registered with the BCF server. Required for BIMcollab, Trimble Connect, etc.
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDiscover}
                disabled={!serverUrl.trim() || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <LogIn className="h-3 w-3 mr-1" />
                    Connect
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Authenticating */}
        {step === 'authenticating' && (
          <div className="text-center py-6 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Authenticating with server</p>
              <p className="text-xs text-muted-foreground">
                Please complete the login in the popup window.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setStep('url')}>
              Cancel
            </Button>
          </div>
        )}

        {/* Step 3: Select Project */}
        {step === 'project' && (
          <div className="space-y-3">
            <div className="p-2 bg-muted/50 rounded-md text-xs">
              <p className="text-muted-foreground">
                Connected to <span className="font-medium text-foreground">{serverUrl.replace(/^https?:\/\//, '')}</span>
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Project</Label>
              {bcfApiProjects.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">
                  No projects available on this server.
                </p>
              ) : (
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bcfApiProjects.map((project) => (
                      <SelectItem key={project.project_id} value={project.project_id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSelectProject}
                disabled={!selectedProjectId || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-3 w-3 mr-1" />
                    Open Project
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
