/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API module
 *
 * Provides a complete client for the buildingSMART BCF REST API,
 * including OAuth2 authentication, service discovery, and CRUD operations.
 *
 * @see https://github.com/buildingSMART/BCF-API
 */

// Client
export { BCFApiClient, BCFApiError } from './client.js';
export type { BCFApiClientOptions } from './client.js';

// Authentication
export {
  discoverServer,
  startOAuthPopupFlow,
  getCurrentUser,
  generateCodeVerifier,
  computeCodeChallenge,
  encodeBasicAuth,
  validateBasicAuth,
} from './auth.js';
export type { ServerInfo, OAuthFlowOptions, OAuthResult } from './auth.js';

// Services
export {
  getProjects,
  getProject,
  getProjectExtensions,
} from './projects.js';

export {
  getTopics,
  getFullTopic,
  createTopic as apiCreateTopic,
  updateTopic as apiUpdateTopic,
  deleteTopic as apiDeleteTopic,
} from './topics.js';

export {
  getComments,
  createComment as apiCreateComment,
  updateComment as apiUpdateComment,
  deleteComment as apiDeleteComment,
} from './comments.js';

export {
  getViewpoints,
  getViewpointWithSnapshot,
  getViewpointSnapshot,
  createViewpoint as apiCreateViewpoint,
  deleteViewpoint as apiDeleteViewpoint,
  getViewpointSnapshots,
} from './viewpoints.js';

// Mappers (for custom integrations)
export {
  apiTopicToLocal,
  localTopicToApiCreate,
  apiCommentToLocal,
  localCommentToApiCreate,
  apiViewpointToLocal,
  localViewpointToApiCreate,
  apiExtensionsToLocal,
} from './mapper.js';

// API Types
export type {
  ApiVersions,
  ApiVersion,
  BcfNativeVersions,
  BcfNativeVersion,
  ApiAuth,
  ApiTokenResponse,
  ApiCurrentUser,
  ApiProject,
  ApiProjectAuthorization,
  ApiExtensions,
  ApiTopic,
  ApiTopicCreate,
  ApiTopicAuthorization,
  ApiComment,
  ApiCommentCreate,
  ApiViewpoint,
  ApiViewpointCreate,
  ApiSnapshot,
  ApiPerspectiveCamera,
  ApiOrthogonalCamera,
  ApiComponents,
  ApiComponent,
  ApiVisibility,
  ApiColoring,
  ApiLine,
  ApiClippingPlane,
  ApiBitmap,
  BCFApiConnectionState,
} from './types.js';
