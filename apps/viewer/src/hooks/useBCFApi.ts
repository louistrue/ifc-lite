/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API hook
 *
 * Provides functions to connect to a BCF server, fetch/push topics,
 * and synchronize state between the local store and the remote API.
 */

import { useCallback, useRef } from 'react';
import { useViewerStore } from '@/store';
import type { BCFProject, BCFTopic, BCFComment, BCFViewpoint } from '@ifc-lite/bcf';
import {
  BCFApiClient,
  discoverServer,
  startOAuthPopupFlow,
  getCurrentUser,
  encodeBasicAuth,
  validateBasicAuth,
  getProjects,
  getTopics,
  getFullTopic,
  apiCreateTopic,
  apiUpdateTopic,
  apiDeleteTopic,
  apiCreateComment,
  apiDeleteComment,
  apiCreateViewpoint,
  apiDeleteViewpoint,
  getViewpointSnapshots,
  getProjectExtensions,
} from '@ifc-lite/bcf';
import type { ServerInfo, ApiProject, BCFApiConnectionState } from '@ifc-lite/bcf';

// ============================================================================
// Types
// ============================================================================

export interface UseBCFApiResult {
  /** Discover a BCF server and get its capabilities */
  discover: (serverUrl: string) => Promise<ServerInfo>;
  /** Connect to a BCF server via OAuth2 */
  connect: (serverInfo: ServerInfo, clientId: string) => Promise<void>;
  /** Connect to a BCF server via API key (Basic Auth) */
  connectWithApiKey: (serverInfo: ServerInfo, username: string, apiKey: string) => Promise<void>;
  /** Select a project and load its topics */
  selectProject: (project: ApiProject) => Promise<void>;
  /** Disconnect from the BCF server */
  disconnect: () => void;
  /** Refresh all topics from the server */
  refreshTopics: () => Promise<void>;
  /** Create a topic on the server and update local state */
  syncCreateTopic: (topic: BCFTopic) => Promise<void>;
  /** Update a topic on the server and update local state */
  syncUpdateTopic: (topicId: string, updates: Partial<BCFTopic>) => Promise<void>;
  /** Delete a topic on the server and update local state */
  syncDeleteTopic: (topicId: string) => Promise<void>;
  /** Add a comment on the server and update local state */
  syncAddComment: (topicId: string, comment: BCFComment) => Promise<void>;
  /** Delete a comment on the server and update local state */
  syncDeleteComment: (topicId: string, commentGuid: string) => Promise<void>;
  /** Add a viewpoint on the server and update local state */
  syncAddViewpoint: (topicId: string, viewpoint: BCFViewpoint) => Promise<void>;
  /** Delete a viewpoint on the server and update local state */
  syncDeleteViewpoint: (topicId: string, viewpointGuid: string) => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

export function useBCFApi(): UseBCFApiResult {
  const clientRef = useRef<BCFApiClient | null>(null);

  // Store actions
  const setBcfProject = useViewerStore((s) => s.setBcfProject);
  const setBcfApiConnection = useViewerStore((s) => s.setBcfApiConnection);
  const setBcfMode = useViewerStore((s) => s.setBcfMode);
  const setBcfSyncing = useViewerStore((s) => s.setBcfSyncing);
  const setBcfApiProjects = useViewerStore((s) => s.setBcfApiProjects);
  const setBcfLoading = useViewerStore((s) => s.setBcfLoading);
  const setBcfError = useViewerStore((s) => s.setBcfError);
  const setBcfAuthor = useViewerStore((s) => s.setBcfAuthor);
  const disconnectBcfApi = useViewerStore((s) => s.disconnectBcfApi);
  const updateBcfApiTokens = useViewerStore((s) => s.updateBcfApiTokens);
  const addTopic = useViewerStore((s) => s.addTopic);
  const updateTopic = useViewerStore((s) => s.updateTopic);
  const deleteTopic = useViewerStore((s) => s.deleteTopic);
  const addComment = useViewerStore((s) => s.addComment);
  const deleteComment = useViewerStore((s) => s.deleteComment);
  const addViewpoint = useViewerStore((s) => s.addViewpoint);
  const deleteViewpoint = useViewerStore((s) => s.deleteViewpoint);

  /**
   * Get or create the API client from current connection state
   */
  const getClient = useCallback((): BCFApiClient | null => {
    const connection = useViewerStore.getState().bcfApiConnection;
    if (!connection) return null;

    // Reuse existing client if it's for the same server
    if (
      clientRef.current &&
      clientRef.current.foundationPath('') ===
        `${connection.serverUrl}/foundation/${connection.apiVersion}`
    ) {
      clientRef.current.setAccessToken(connection.accessToken);
      return clientRef.current;
    }

    // Create new client
    clientRef.current = new BCFApiClient({
      baseUrl: connection.serverUrl,
      version: connection.apiVersion,
      accessToken: connection.accessToken,
      authMethod: connection.authMethod,
      refreshToken: connection.refreshToken,
      onTokenRefresh: (accessToken, refreshToken, expiresIn) => {
        updateBcfApiTokens(
          accessToken,
          refreshToken,
          Date.now() + expiresIn * 1000
        );
      },
      onAuthFailure: () => {
        setBcfError('Authentication expired. Please reconnect.');
        disconnectBcfApi();
        clientRef.current = null;
      },
    });

    return clientRef.current;
  }, [updateBcfApiTokens, setBcfError, disconnectBcfApi]);

  /**
   * Discover a BCF server's capabilities
   */
  const discover = useCallback(async (serverUrl: string): Promise<ServerInfo> => {
    setBcfError(null);
    try {
      return await discoverServer(serverUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to server';
      setBcfError(message);
      throw error;
    }
  }, [setBcfError]);

  /**
   * Connect to a BCF server via OAuth2
   */
  const connect = useCallback(
    async (serverInfo: ServerInfo, clientId: string): Promise<void> => {
      if (!serverInfo.authUrl || !serverInfo.tokenUrl) {
        throw new Error('Server does not support OAuth2 authentication');
      }

      setBcfLoading(true);
      setBcfError(null);

      try {
        // Run OAuth2 popup flow
        const redirectUri = `${window.location.origin}/oauth/callback`;
        const oauthResult = await startOAuthPopupFlow({
          authUrl: serverInfo.authUrl,
          tokenUrl: serverInfo.tokenUrl,
          clientId,
          redirectUri,
          // BIMcollab and other servers require specific scopes
          scope: 'openid offline_access bcf',
        });

        // Get current user info
        const user = await getCurrentUser(
          serverInfo.baseUrl,
          serverInfo.apiVersion,
          oauthResult.accessToken,
          serverInfo.discoveryMethod
        );

        // Create client
        const client = new BCFApiClient({
          baseUrl: serverInfo.baseUrl,
          version: serverInfo.apiVersion,
          accessToken: oauthResult.accessToken,
          refreshToken: oauthResult.refreshToken,
          tokenUrl: serverInfo.tokenUrl,
          onTokenRefresh: (accessToken, refreshToken, expiresIn) => {
            updateBcfApiTokens(
              accessToken,
              refreshToken,
              Date.now() + expiresIn * 1000
            );
          },
          onAuthFailure: () => {
            setBcfError('Authentication expired. Please reconnect.');
            disconnectBcfApi();
            clientRef.current = null;
          },
        });
        clientRef.current = client;

        // Fetch available projects
        const projects = await getProjects(client);

        // Set author from server user info
        if (user.email) {
          setBcfAuthor(user.email);
        }

        // Store partial connection (no project selected yet)
        const connection: BCFApiConnectionState = {
          serverUrl: serverInfo.baseUrl,
          apiVersion: serverInfo.apiVersion,
          projectId: '',
          projectName: '',
          accessToken: oauthResult.accessToken,
          refreshToken: oauthResult.refreshToken,
          tokenExpiry: Date.now() + oauthResult.expiresIn * 1000,
          user,
          authMethod: 'oauth2',
        };

        setBcfApiConnection(connection);
        setBcfApiProjects(projects);
        setBcfMode('api');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authentication failed';
        setBcfError(message);
        throw error;
      } finally {
        setBcfLoading(false);
      }
    },
    [
      setBcfLoading,
      setBcfError,
      setBcfAuthor,
      setBcfApiConnection,
      setBcfApiProjects,
      setBcfMode,
      updateBcfApiTokens,
      disconnectBcfApi,
    ]
  );

  /**
   * Connect to a BCF server via API key (Basic Auth)
   */
  const connectWithApiKey = useCallback(
    async (serverInfo: ServerInfo, username: string, apiKey: string): Promise<void> => {
      setBcfLoading(true);
      setBcfError(null);

      try {
        // Encode credentials for Basic Auth
        const basicToken = encodeBasicAuth(username, apiKey);

        // Validate credentials
        const user = await validateBasicAuth(
          serverInfo.baseUrl,
          serverInfo.apiVersion,
          basicToken,
          serverInfo.discoveryMethod
        );

        // Create client with Basic auth
        const client = new BCFApiClient({
          baseUrl: serverInfo.baseUrl,
          version: serverInfo.apiVersion,
          accessToken: basicToken,
          authMethod: 'basic',
          onAuthFailure: () => {
            setBcfError('Authentication failed. Check your API key.');
            disconnectBcfApi();
            clientRef.current = null;
          },
        });
        clientRef.current = client;

        // Fetch available projects
        const projects = await getProjects(client);

        // Set author from user info
        if (user.email) {
          setBcfAuthor(user.email);
        } else if (username.includes('@')) {
          setBcfAuthor(username);
        }

        // Store connection
        const connection: BCFApiConnectionState = {
          serverUrl: serverInfo.baseUrl,
          apiVersion: serverInfo.apiVersion,
          projectId: '',
          projectName: '',
          accessToken: basicToken,
          refreshToken: '',
          tokenExpiry: 0,
          user,
          authMethod: 'basic',
        };

        setBcfApiConnection(connection);
        setBcfApiProjects(projects);
        setBcfMode('api');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Authentication failed';
        setBcfError(message);
        throw error;
      } finally {
        setBcfLoading(false);
      }
    },
    [
      setBcfLoading,
      setBcfError,
      setBcfAuthor,
      setBcfApiConnection,
      setBcfApiProjects,
      setBcfMode,
      disconnectBcfApi,
    ]
  );

  /**
   * Select a project and load its topics
   */
  const selectProject = useCallback(
    async (project: ApiProject): Promise<void> => {
      const client = getClient();
      if (!client) throw new Error('Not connected to a BCF server');

      setBcfLoading(true);
      setBcfError(null);

      try {
        // Update connection with selected project
        const connection = useViewerStore.getState().bcfApiConnection;
        if (connection) {
          setBcfApiConnection({
            ...connection,
            projectId: project.project_id,
            projectName: project.name,
          });
        }

        // Fetch extensions and topics in parallel
        const [extensions, apiTopics] = await Promise.all([
          getProjectExtensions(client, project.project_id).catch(() => undefined),
          getTopics(client, project.project_id),
        ]);

        // Build local BCFProject from API data
        const topicsMap = new Map<string, BCFTopic>();
        for (const topic of apiTopics) {
          topicsMap.set(topic.guid, topic);
        }

        const bcfProject: BCFProject = {
          version: '3.0',
          projectId: project.project_id,
          name: project.name,
          topics: topicsMap,
          extensions,
        };

        setBcfProject(bcfProject);

        // Fetch full details (comments + viewpoints) for each topic in parallel
        // Do this after setting the project so the UI shows topics immediately
        const fullTopics = await Promise.all(
          apiTopics.map((t) =>
            getFullTopic(client, project.project_id, t.guid).catch(() => t)
          )
        );

        // Fetch snapshots for all viewpoints across all topics
        for (const topic of fullTopics) {
          if (topic.viewpoints.length > 0) {
            const vpGuids = topic.viewpoints.map((vp) => vp.guid);
            const snapshots = await getViewpointSnapshots(
              client,
              project.project_id,
              topic.guid,
              vpGuids
            );
            // Apply snapshots to viewpoints
            for (const vp of topic.viewpoints) {
              const snap = snapshots.get(vp.guid);
              if (snap) {
                vp.snapshot = snap;
              }
            }
          }
        }

        // Update project with full topic data
        const fullTopicsMap = new Map<string, BCFTopic>();
        for (const topic of fullTopics) {
          fullTopicsMap.set(topic.guid, topic);
        }

        setBcfProject({
          ...bcfProject,
          topics: fullTopicsMap,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load project';
        setBcfError(message);
        throw error;
      } finally {
        setBcfLoading(false);
      }
    },
    [getClient, setBcfLoading, setBcfError, setBcfApiConnection, setBcfProject]
  );

  /**
   * Disconnect from the BCF server
   */
  const disconnect = useCallback(() => {
    clientRef.current = null;
    disconnectBcfApi();
  }, [disconnectBcfApi]);

  /**
   * Refresh all topics from the server
   */
  const refreshTopics = useCallback(async (): Promise<void> => {
    const client = getClient();
    const connection = useViewerStore.getState().bcfApiConnection;
    if (!client || !connection?.projectId) return;

    setBcfSyncing(true);
    try {
      const apiTopics = await getTopics(client, connection.projectId);

      // Fetch full details in parallel
      const fullTopics = await Promise.all(
        apiTopics.map((t) =>
          getFullTopic(client, connection.projectId, t.guid).catch(() => t)
        )
      );

      // Fetch snapshots
      for (const topic of fullTopics) {
        if (topic.viewpoints.length > 0) {
          const vpGuids = topic.viewpoints.map((vp) => vp.guid);
          const snapshots = await getViewpointSnapshots(
            client,
            connection.projectId,
            topic.guid,
            vpGuids
          );
          for (const vp of topic.viewpoints) {
            const snap = snapshots.get(vp.guid);
            if (snap) {
              vp.snapshot = snap;
            }
          }
        }
      }

      const topicsMap = new Map<string, BCFTopic>();
      for (const topic of fullTopics) {
        topicsMap.set(topic.guid, topic);
      }

      const currentProject = useViewerStore.getState().bcfProject;
      if (currentProject) {
        setBcfProject({
          ...currentProject,
          topics: topicsMap,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh topics';
      setBcfError(message);
    } finally {
      setBcfSyncing(false);
    }
  }, [getClient, setBcfSyncing, setBcfError, setBcfProject]);

  // ============================================================================
  // Sync Operations (pessimistic: server first, then local store)
  // ============================================================================

  const syncCreateTopic = useCallback(
    async (topic: BCFTopic): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;
      if (!client || !connection?.projectId) {
        addTopic(topic); // Fallback to local-only
        return;
      }

      setBcfSyncing(true);
      try {
        const created = await apiCreateTopic(client, connection.projectId, topic);
        // Use server-assigned GUID and timestamps
        addTopic({ ...topic, ...created });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create topic on server';
        setBcfError(message);
        // Still add locally so user doesn't lose work
        addTopic(topic);
      } finally {
        setBcfSyncing(false);
      }
    },
    [getClient, addTopic, setBcfSyncing, setBcfError]
  );

  const syncUpdateTopic = useCallback(
    async (topicId: string, updates: Partial<BCFTopic>): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;

      // Always update locally first for responsiveness
      updateTopic(topicId, updates);

      if (!client || !connection?.projectId) return;

      setBcfSyncing(true);
      try {
        const currentTopic = useViewerStore.getState().bcfProject?.topics.get(topicId);
        if (currentTopic) {
          await apiUpdateTopic(client, connection.projectId, currentTopic);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update topic on server';
        setBcfError(message);
      } finally {
        setBcfSyncing(false);
      }
    },
    [getClient, updateTopic, setBcfSyncing, setBcfError]
  );

  const syncDeleteTopic = useCallback(
    async (topicId: string): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;

      if (client && connection?.projectId) {
        setBcfSyncing(true);
        try {
          await apiDeleteTopic(client, connection.projectId, topicId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete topic on server';
          setBcfError(message);
        } finally {
          setBcfSyncing(false);
        }
      }

      deleteTopic(topicId);
    },
    [getClient, deleteTopic, setBcfSyncing, setBcfError]
  );

  const syncAddComment = useCallback(
    async (topicId: string, comment: BCFComment): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;

      if (client && connection?.projectId) {
        setBcfSyncing(true);
        try {
          const created = await apiCreateComment(
            client,
            connection.projectId,
            topicId,
            comment
          );
          addComment(topicId, { ...comment, ...created });
          setBcfSyncing(false);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to add comment on server';
          setBcfError(message);
          setBcfSyncing(false);
        }
      }

      addComment(topicId, comment);
    },
    [getClient, addComment, setBcfSyncing, setBcfError]
  );

  const syncDeleteComment = useCallback(
    async (topicId: string, commentGuid: string): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;

      if (client && connection?.projectId) {
        setBcfSyncing(true);
        try {
          await apiDeleteComment(client, connection.projectId, topicId, commentGuid);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete comment on server';
          setBcfError(message);
        } finally {
          setBcfSyncing(false);
        }
      }

      deleteComment(topicId, commentGuid);
    },
    [getClient, deleteComment, setBcfSyncing, setBcfError]
  );

  const syncAddViewpoint = useCallback(
    async (topicId: string, viewpoint: BCFViewpoint): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;

      if (client && connection?.projectId) {
        setBcfSyncing(true);
        try {
          const created = await apiCreateViewpoint(
            client,
            connection.projectId,
            topicId,
            viewpoint
          );
          addViewpoint(topicId, { ...viewpoint, ...created });
          setBcfSyncing(false);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to add viewpoint on server';
          setBcfError(message);
          setBcfSyncing(false);
        }
      }

      addViewpoint(topicId, viewpoint);
    },
    [getClient, addViewpoint, setBcfSyncing, setBcfError]
  );

  const syncDeleteViewpoint = useCallback(
    async (topicId: string, viewpointGuid: string): Promise<void> => {
      const client = getClient();
      const connection = useViewerStore.getState().bcfApiConnection;

      if (client && connection?.projectId) {
        setBcfSyncing(true);
        try {
          await apiDeleteViewpoint(
            client,
            connection.projectId,
            topicId,
            viewpointGuid
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete viewpoint on server';
          setBcfError(message);
        } finally {
          setBcfSyncing(false);
        }
      }

      deleteViewpoint(topicId, viewpointGuid);
    },
    [getClient, deleteViewpoint, setBcfSyncing, setBcfError]
  );

  return {
    discover,
    connect,
    connectWithApiKey,
    selectProject,
    disconnect,
    refreshTopics,
    syncCreateTopic,
    syncUpdateTopic,
    syncDeleteTopic,
    syncAddComment,
    syncDeleteComment,
    syncAddViewpoint,
    syncDeleteViewpoint,
  };
}
