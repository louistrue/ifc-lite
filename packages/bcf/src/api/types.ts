/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API JSON types (snake_case)
 *
 * These types represent the JSON payloads from the BCF REST API.
 * They follow the buildingSMART BCF-API specification:
 * @see https://github.com/buildingSMART/BCF-API
 */

// ============================================================================
// Foundation API
// ============================================================================

export interface ApiVersion {
  api_id: string;
  version_id: string;
  detailed_version?: string;
}

export interface ApiVersions {
  versions: ApiVersion[];
}

export interface ApiAuth {
  oauth2_auth_url?: string;
  oauth2_token_url?: string;
  oauth2_dynamic_client_reg_url?: string;
  http_basic_supported?: boolean;
  supported_oauth2_flows?: string[];
}

export interface ApiCurrentUser {
  id: string;
  name?: string;
  email?: string;
}

// ============================================================================
// Token Response
// ============================================================================

export interface ApiTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

// ============================================================================
// Project
// ============================================================================

export interface ApiProject {
  project_id: string;
  name: string;
  authorization?: ApiProjectAuthorization;
}

export interface ApiProjectAuthorization {
  project_actions: string[];
}

export interface ApiExtensions {
  topic_type?: string[];
  topic_status?: string[];
  topic_label?: string[];
  priority?: string[];
  user_id_type?: string[];
  snippet_type?: string[];
  stage?: string[];
}

// ============================================================================
// Topic
// ============================================================================

export interface ApiTopic {
  guid: string;
  topic_type?: string;
  topic_status?: string;
  title: string;
  priority?: string;
  index?: number;
  labels?: string[];
  creation_date: string;
  creation_author: string;
  modified_date?: string;
  modified_author?: string;
  assigned_to?: string;
  stage?: string;
  description?: string;
  due_date?: string;
  bim_snippet?: ApiBimSnippet;
  related_topics?: ApiRelatedTopic[];
  authorization?: ApiTopicAuthorization;
}

export interface ApiTopicCreate {
  topic_type?: string;
  topic_status?: string;
  title: string;
  priority?: string;
  index?: number;
  labels?: string[];
  assigned_to?: string;
  stage?: string;
  description?: string;
  due_date?: string;
}

export interface ApiBimSnippet {
  snippet_type: string;
  is_external: boolean;
  reference: string;
  reference_schema?: string;
}

export interface ApiRelatedTopic {
  related_topic_guid: string;
}

export interface ApiTopicAuthorization {
  topic_actions: string[];
}

// ============================================================================
// Comment
// ============================================================================

export interface ApiComment {
  guid: string;
  date: string;
  author: string;
  comment: string;
  topic_guid: string;
  viewpoint_guid?: string;
  modified_date?: string;
  modified_author?: string;
  authorization?: ApiCommentAuthorization;
}

export interface ApiCommentCreate {
  comment: string;
  viewpoint_guid?: string;
}

export interface ApiCommentAuthorization {
  comment_actions: string[];
}

// ============================================================================
// Viewpoint
// ============================================================================

export interface ApiViewpoint {
  guid: string;
  index?: number;
  orthogonal_camera?: ApiOrthogonalCamera;
  perspective_camera?: ApiPerspectiveCamera;
  lines?: ApiLine[];
  clipping_planes?: ApiClippingPlane[];
  bitmaps?: ApiBitmap[];
  snapshot?: ApiSnapshot;
  components?: ApiComponents;
}

export interface ApiViewpointCreate {
  index?: number;
  orthogonal_camera?: ApiOrthogonalCamera;
  perspective_camera?: ApiPerspectiveCamera;
  lines?: ApiLine[];
  clipping_planes?: ApiClippingPlane[];
  bitmaps?: ApiBitmap[];
  snapshot?: ApiSnapshot;
  components?: ApiComponents;
}

export interface ApiSnapshot {
  snapshot_type: string;
  snapshot_data?: string; // base64-encoded
}

// ============================================================================
// Camera Types
// ============================================================================

export interface ApiPoint {
  x: number;
  y: number;
  z: number;
}

export interface ApiDirection {
  x: number;
  y: number;
  z: number;
}

export interface ApiPerspectiveCamera {
  camera_view_point: ApiPoint;
  camera_direction: ApiDirection;
  camera_up_vector: ApiDirection;
  field_of_view: number;
  aspect_ratio?: number;
}

export interface ApiOrthogonalCamera {
  camera_view_point: ApiPoint;
  camera_direction: ApiDirection;
  camera_up_vector: ApiDirection;
  view_to_world_scale: number;
  aspect_ratio?: number;
}

// ============================================================================
// Markup Elements
// ============================================================================

export interface ApiLine {
  start_point: ApiPoint;
  end_point: ApiPoint;
}

export interface ApiClippingPlane {
  location: ApiPoint;
  direction: ApiDirection;
}

export interface ApiBitmap {
  bitmap_type: 'png' | 'jpg';
  bitmap_data?: string; // base64
  location: ApiPoint;
  normal: ApiDirection;
  up: ApiDirection;
  height: number;
}

// ============================================================================
// Components (Visibility/Selection/Coloring)
// ============================================================================

export interface ApiComponents {
  selection?: ApiComponent[];
  visibility?: ApiVisibility;
  coloring?: ApiColoring[];
}

export interface ApiComponent {
  ifc_guid?: string;
  authoring_tool_id?: string;
  originating_system?: string;
}

export interface ApiVisibility {
  default_visibility: boolean;
  exceptions?: ApiComponent[];
  view_setup_hints?: ApiViewSetupHints;
}

export interface ApiViewSetupHints {
  spaces_visible?: boolean;
  space_boundaries_visible?: boolean;
  openings_visible?: boolean;
}

export interface ApiColoring {
  color: string;
  components: ApiComponent[];
}

// ============================================================================
// Connection State
// ============================================================================

export interface BCFApiConnectionState {
  /** Server base URL */
  serverUrl: string;
  /** BCF API version discovered from server */
  apiVersion: string;
  /** Selected project ID */
  projectId: string;
  /** Selected project name */
  projectName: string;
  /** OAuth2 access token */
  accessToken: string;
  /** OAuth2 refresh token */
  refreshToken: string;
  /** Token expiry timestamp (ms since epoch) */
  tokenExpiry: number;
  /** Authenticated user info */
  user: ApiCurrentUser;
}
