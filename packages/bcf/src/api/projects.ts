/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API Project service
 */

import type { BCFApiClient } from './client.js';
import type { ApiProject, ApiExtensions } from './types.js';
import type { BCFExtensions } from '../types.js';
import { apiExtensionsToLocal } from './mapper.js';

/**
 * List all projects accessible to the current user.
 */
export async function getProjects(client: BCFApiClient): Promise<ApiProject[]> {
  return client.get<ApiProject[]>('/projects');
}

/**
 * Get a specific project by ID.
 */
export async function getProject(
  client: BCFApiClient,
  projectId: string
): Promise<ApiProject> {
  return client.get<ApiProject>(`/projects/${projectId}`);
}

/**
 * Get the extensions (allowed values) for a project.
 */
export async function getProjectExtensions(
  client: BCFApiClient,
  projectId: string
): Promise<BCFExtensions> {
  const api = await client.get<ApiExtensions>(`/projects/${projectId}/extensions`);
  return apiExtensionsToLocal(api);
}
