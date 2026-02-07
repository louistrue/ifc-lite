/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API Viewpoint service
 */

import type { BCFApiClient } from './client.js';
import type { ApiViewpoint } from './types.js';
import type { BCFViewpoint } from '../types.js';
import { apiViewpointToLocal, localViewpointToApiCreate } from './mapper.js';

/**
 * Fetch all viewpoints for a topic (without snapshots).
 * Snapshots are fetched lazily via getViewpointSnapshot.
 */
export async function getViewpoints(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string
): Promise<BCFViewpoint[]> {
  const apiViewpoints = await client.get<ApiViewpoint[]>(
    `/projects/${projectId}/topics/${topicGuid}/viewpoints`
  );
  return apiViewpoints.map((vp) => apiViewpointToLocal(vp));
}

/**
 * Fetch a single viewpoint with its snapshot.
 */
export async function getViewpointWithSnapshot(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  viewpointGuid: string
): Promise<BCFViewpoint> {
  // Fetch viewpoint data and snapshot in parallel
  const [apiViewpoint, snapshotDataUrl] = await Promise.all([
    client.get<ApiViewpoint>(
      `/projects/${projectId}/topics/${topicGuid}/viewpoints/${viewpointGuid}`
    ),
    getViewpointSnapshot(client, projectId, topicGuid, viewpointGuid),
  ]);

  return apiViewpointToLocal(apiViewpoint, snapshotDataUrl ?? undefined);
}

/**
 * Fetch the snapshot image for a viewpoint as a data URL.
 * Returns null if no snapshot exists.
 */
export async function getViewpointSnapshot(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  viewpointGuid: string
): Promise<string | null> {
  return client.getBinaryAsDataUrl(
    `/projects/${projectId}/topics/${topicGuid}/viewpoints/${viewpointGuid}/snapshot`
  );
}

/**
 * Create a new viewpoint on a topic. Returns the created viewpoint.
 * Includes snapshot data in the request body if available.
 */
export async function createViewpoint(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  viewpoint: BCFViewpoint
): Promise<BCFViewpoint> {
  const body = localViewpointToApiCreate(viewpoint);
  const created = await client.post<ApiViewpoint>(
    `/projects/${projectId}/topics/${topicGuid}/viewpoints`,
    body
  );

  // Return with the original snapshot data URL so it's immediately displayable
  return apiViewpointToLocal(created, viewpoint.snapshot);
}

/**
 * Delete a viewpoint from a topic.
 */
export async function deleteViewpoint(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  viewpointGuid: string
): Promise<void> {
  await client.delete(
    `/projects/${projectId}/topics/${topicGuid}/viewpoints/${viewpointGuid}`
  );
}

/**
 * Fetch snapshots for all viewpoints in a topic.
 * Returns a map of viewpoint GUID -> data URL.
 */
export async function getViewpointSnapshots(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  viewpointGuids: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Fetch snapshots in parallel (max 6 concurrent for browser connection limits)
  const batchSize = 6;
  for (let i = 0; i < viewpointGuids.length; i += batchSize) {
    const batch = viewpointGuids.slice(i, i + batchSize);
    const snapshots = await Promise.all(
      batch.map(async (guid) => {
        const dataUrl = await getViewpointSnapshot(client, projectId, topicGuid, guid);
        return { guid, dataUrl };
      })
    );
    for (const { guid, dataUrl } of snapshots) {
      if (dataUrl) {
        results.set(guid, dataUrl);
      }
    }
  }

  return results;
}
