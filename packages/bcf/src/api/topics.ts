/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API Topic service
 */

import type { BCFApiClient } from './client.js';
import type { ApiTopic, ApiTopicCreate } from './types.js';
import type { BCFTopic, BCFComment, BCFViewpoint } from '../types.js';
import { apiTopicToLocal, localTopicToApiCreate } from './mapper.js';
import { getComments } from './comments.js';
import { getViewpoints } from './viewpoints.js';

/**
 * Fetch all topics for a project.
 * Returns local BCFTopic[] (without comments/viewpoints — use getFullTopic for those).
 */
export async function getTopics(
  client: BCFApiClient,
  projectId: string
): Promise<BCFTopic[]> {
  const apiTopics = await client.get<ApiTopic[]>(`/projects/${projectId}/topics`);
  return apiTopics.map((t) => apiTopicToLocal(t));
}

/**
 * Fetch a single topic with its comments and viewpoints (full data).
 */
export async function getFullTopic(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string
): Promise<BCFTopic> {
  // Fetch topic, comments, and viewpoints in parallel
  const [apiTopic, comments, viewpoints] = await Promise.all([
    client.get<ApiTopic>(`/projects/${projectId}/topics/${topicGuid}`),
    getComments(client, projectId, topicGuid),
    getViewpoints(client, projectId, topicGuid),
  ]);

  return apiTopicToLocal(apiTopic, comments, viewpoints);
}

/**
 * Create a new topic on the server. Returns the created topic.
 */
export async function createTopic(
  client: BCFApiClient,
  projectId: string,
  topic: BCFTopic
): Promise<BCFTopic> {
  const body = localTopicToApiCreate(topic);
  const created = await client.post<ApiTopic>(
    `/projects/${projectId}/topics`,
    body
  );
  return apiTopicToLocal(created);
}

/**
 * Update an existing topic. Returns the updated topic.
 */
export async function updateTopic(
  client: BCFApiClient,
  projectId: string,
  topic: BCFTopic
): Promise<BCFTopic> {
  const body = localTopicToApiCreate(topic);
  const updated = await client.put<ApiTopic>(
    `/projects/${projectId}/topics/${topic.guid}`,
    body
  );
  return apiTopicToLocal(updated);
}

/**
 * Delete a topic from the server.
 */
export async function deleteTopic(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string
): Promise<void> {
  await client.delete(`/projects/${projectId}/topics/${topicGuid}`);
}
