/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API Comment service
 */

import type { BCFApiClient } from './client.js';
import type { ApiComment, ApiCommentCreate } from './types.js';
import type { BCFComment } from '../types.js';
import { apiCommentToLocal, localCommentToApiCreate } from './mapper.js';

/**
 * Fetch all comments for a topic.
 */
export async function getComments(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string
): Promise<BCFComment[]> {
  const apiComments = await client.get<ApiComment[]>(
    `/projects/${projectId}/topics/${topicGuid}/comments`
  );
  return apiComments.map(apiCommentToLocal);
}

/**
 * Create a new comment on a topic. Returns the created comment.
 */
export async function createComment(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  comment: BCFComment
): Promise<BCFComment> {
  const body = localCommentToApiCreate(comment);
  const created = await client.post<ApiComment>(
    `/projects/${projectId}/topics/${topicGuid}/comments`,
    body
  );
  return apiCommentToLocal(created);
}

/**
 * Update an existing comment. Returns the updated comment.
 */
export async function updateComment(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  comment: BCFComment
): Promise<BCFComment> {
  const body: ApiCommentCreate = { comment: comment.comment };
  const updated = await client.put<ApiComment>(
    `/projects/${projectId}/topics/${topicGuid}/comments/${comment.guid}`,
    body
  );
  return apiCommentToLocal(updated);
}

/**
 * Delete a comment from a topic.
 */
export async function deleteComment(
  client: BCFApiClient,
  projectId: string,
  topicGuid: string,
  commentGuid: string
): Promise<void> {
  await client.delete(
    `/projects/${projectId}/topics/${topicGuid}/comments/${commentGuid}`
  );
}
