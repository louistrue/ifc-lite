/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API type mapper
 *
 * Converts between local BCF types (camelCase) and API JSON types (snake_case).
 */

import type {
  BCFTopic,
  BCFComment,
  BCFViewpoint,
  BCFPerspectiveCamera,
  BCFOrthogonalCamera,
  BCFComponents,
  BCFComponent,
  BCFVisibility,
  BCFColoring,
  BCFLine,
  BCFClippingPlane,
  BCFBitmap,
  BCFExtensions,
} from '../types.js';

import type {
  ApiTopic,
  ApiTopicCreate,
  ApiComment,
  ApiCommentCreate,
  ApiViewpoint,
  ApiViewpointCreate,
  ApiPerspectiveCamera,
  ApiOrthogonalCamera,
  ApiComponents,
  ApiComponent,
  ApiVisibility,
  ApiColoring,
  ApiLine,
  ApiClippingPlane,
  ApiBitmap,
  ApiExtensions,
  ApiProject,
} from './types.js';

// ============================================================================
// Extensions
// ============================================================================

export function apiExtensionsToLocal(api: ApiExtensions): BCFExtensions {
  return {
    topicTypes: api.topic_type,
    topicStatuses: api.topic_status,
    priorities: api.priority,
    topicLabels: api.topic_label,
    users: api.user_id_type,
    stages: api.stage,
  };
}

// ============================================================================
// Topic Mapping
// ============================================================================

export function apiTopicToLocal(
  api: ApiTopic,
  comments: BCFComment[] = [],
  viewpoints: BCFViewpoint[] = []
): BCFTopic {
  return {
    guid: api.guid,
    title: api.title,
    description: api.description,
    topicType: api.topic_type,
    topicStatus: api.topic_status,
    priority: api.priority,
    index: api.index,
    creationDate: api.creation_date,
    creationAuthor: api.creation_author,
    modifiedDate: api.modified_date,
    modifiedAuthor: api.modified_author,
    dueDate: api.due_date,
    assignedTo: api.assigned_to,
    stage: api.stage,
    labels: api.labels,
    relatedTopics: api.related_topics?.map((r) => r.related_topic_guid),
    comments,
    viewpoints,
  };
}

export function localTopicToApiCreate(topic: BCFTopic): ApiTopicCreate {
  return {
    title: topic.title,
    topic_type: topic.topicType,
    topic_status: topic.topicStatus,
    priority: topic.priority,
    index: topic.index,
    labels: topic.labels,
    assigned_to: topic.assignedTo,
    stage: topic.stage,
    description: topic.description,
    due_date: topic.dueDate,
  };
}

// ============================================================================
// Comment Mapping
// ============================================================================

export function apiCommentToLocal(api: ApiComment): BCFComment {
  return {
    guid: api.guid,
    date: api.date,
    author: api.author,
    comment: api.comment,
    viewpointGuid: api.viewpoint_guid,
    modifiedDate: api.modified_date,
    modifiedAuthor: api.modified_author,
  };
}

export function localCommentToApiCreate(comment: BCFComment): ApiCommentCreate {
  return {
    comment: comment.comment,
    viewpoint_guid: comment.viewpointGuid,
  };
}

// ============================================================================
// Component Mapping
// ============================================================================

function apiComponentToLocal(api: ApiComponent): BCFComponent {
  return {
    ifcGuid: api.ifc_guid,
    authoringToolId: api.authoring_tool_id,
    originatingSystem: api.originating_system,
  };
}

function localComponentToApi(local: BCFComponent): ApiComponent {
  return {
    ifc_guid: local.ifcGuid,
    authoring_tool_id: local.authoringToolId,
    originating_system: local.originatingSystem,
  };
}

function apiVisibilityToLocal(api: ApiVisibility): BCFVisibility {
  return {
    defaultVisibility: api.default_visibility,
    exceptions: api.exceptions?.map(apiComponentToLocal),
    viewSetupHints: api.view_setup_hints
      ? {
          spacesVisible: api.view_setup_hints.spaces_visible,
          spaceBoundariesVisible: api.view_setup_hints.space_boundaries_visible,
          openingsVisible: api.view_setup_hints.openings_visible,
        }
      : undefined,
  };
}

function localVisibilityToApi(local: BCFVisibility): ApiVisibility {
  return {
    default_visibility: local.defaultVisibility,
    exceptions: local.exceptions?.map(localComponentToApi),
    view_setup_hints: local.viewSetupHints
      ? {
          spaces_visible: local.viewSetupHints.spacesVisible,
          space_boundaries_visible: local.viewSetupHints.spaceBoundariesVisible,
          openings_visible: local.viewSetupHints.openingsVisible,
        }
      : undefined,
  };
}

function apiColoringToLocal(api: ApiColoring): BCFColoring {
  return {
    color: api.color,
    components: api.components.map(apiComponentToLocal),
  };
}

function localColoringToApi(local: BCFColoring): ApiColoring {
  return {
    color: local.color,
    components: local.components.map(localComponentToApi),
  };
}

function apiComponentsToLocal(api: ApiComponents): BCFComponents {
  return {
    selection: api.selection?.map(apiComponentToLocal),
    visibility: api.visibility ? apiVisibilityToLocal(api.visibility) : undefined,
    coloring: api.coloring?.map(apiColoringToLocal),
  };
}

function localComponentsToApi(local: BCFComponents): ApiComponents {
  return {
    selection: local.selection?.map(localComponentToApi),
    visibility: local.visibility ? localVisibilityToApi(local.visibility) : undefined,
    coloring: local.coloring?.map(localColoringToApi),
  };
}

// ============================================================================
// Camera Mapping
// ============================================================================

function apiPerspectiveCameraToLocal(api: ApiPerspectiveCamera): BCFPerspectiveCamera {
  return {
    cameraViewPoint: api.camera_view_point,
    cameraDirection: api.camera_direction,
    cameraUpVector: api.camera_up_vector,
    fieldOfView: api.field_of_view,
    aspectRatio: api.aspect_ratio,
  };
}

function localPerspectiveCameraToApi(local: BCFPerspectiveCamera): ApiPerspectiveCamera {
  return {
    camera_view_point: local.cameraViewPoint,
    camera_direction: local.cameraDirection,
    camera_up_vector: local.cameraUpVector,
    field_of_view: local.fieldOfView,
    aspect_ratio: local.aspectRatio,
  };
}

function apiOrthogonalCameraToLocal(api: ApiOrthogonalCamera): BCFOrthogonalCamera {
  return {
    cameraViewPoint: api.camera_view_point,
    cameraDirection: api.camera_direction,
    cameraUpVector: api.camera_up_vector,
    viewToWorldScale: api.view_to_world_scale,
    aspectRatio: api.aspect_ratio,
  };
}

function localOrthogonalCameraToApi(local: BCFOrthogonalCamera): ApiOrthogonalCamera {
  return {
    camera_view_point: local.cameraViewPoint,
    camera_direction: local.cameraDirection,
    camera_up_vector: local.cameraUpVector,
    view_to_world_scale: local.viewToWorldScale,
    aspect_ratio: local.aspectRatio,
  };
}

// ============================================================================
// Line / ClippingPlane / Bitmap Mapping
// ============================================================================

function apiLineToLocal(api: ApiLine): BCFLine {
  return {
    startPoint: api.start_point,
    endPoint: api.end_point,
  };
}

function localLineToApi(local: BCFLine): ApiLine {
  return {
    start_point: local.startPoint,
    end_point: local.endPoint,
  };
}

function apiClippingPlaneToLocal(api: ApiClippingPlane): BCFClippingPlane {
  return {
    location: api.location,
    direction: api.direction,
  };
}

function localClippingPlaneToApi(local: BCFClippingPlane): ApiClippingPlane {
  return {
    location: local.location,
    direction: local.direction,
  };
}

function apiBitmapToLocal(api: ApiBitmap): BCFBitmap {
  return {
    format: api.bitmap_type === 'png' ? 'PNG' : 'JPG',
    reference: api.bitmap_data ?? '',
    location: api.location,
    normal: api.normal,
    up: api.up,
    height: api.height,
  };
}

function localBitmapToApi(local: BCFBitmap): ApiBitmap {
  return {
    bitmap_type: local.format === 'PNG' ? 'png' : 'jpg',
    bitmap_data: local.reference,
    location: local.location,
    normal: local.normal,
    up: local.up,
    height: local.height,
  };
}

// ============================================================================
// Viewpoint Mapping
// ============================================================================

/**
 * Convert API viewpoint to local type.
 * Snapshot data URL must be provided separately (fetched via GET .../snapshot).
 */
export function apiViewpointToLocal(
  api: ApiViewpoint,
  snapshotDataUrl?: string
): BCFViewpoint {
  return {
    guid: api.guid,
    perspectiveCamera: api.perspective_camera
      ? apiPerspectiveCameraToLocal(api.perspective_camera)
      : undefined,
    orthogonalCamera: api.orthogonal_camera
      ? apiOrthogonalCameraToLocal(api.orthogonal_camera)
      : undefined,
    lines: api.lines?.map(apiLineToLocal),
    clippingPlanes: api.clipping_planes?.map(apiClippingPlaneToLocal),
    bitmaps: api.bitmaps?.map(apiBitmapToLocal),
    snapshot: snapshotDataUrl,
    components: api.components ? apiComponentsToLocal(api.components) : undefined,
  };
}

export function localViewpointToApiCreate(local: BCFViewpoint): ApiViewpointCreate {
  const result: ApiViewpointCreate = {};

  if (local.perspectiveCamera) {
    result.perspective_camera = localPerspectiveCameraToApi(local.perspectiveCamera);
  }
  if (local.orthogonalCamera) {
    result.orthogonal_camera = localOrthogonalCameraToApi(local.orthogonalCamera);
  }
  if (local.lines) {
    result.lines = local.lines.map(localLineToApi);
  }
  if (local.clippingPlanes) {
    result.clipping_planes = local.clippingPlanes.map(localClippingPlaneToApi);
  }
  if (local.bitmaps) {
    result.bitmaps = local.bitmaps.map(localBitmapToApi);
  }
  if (local.components) {
    result.components = localComponentsToApi(local.components);
  }

  // Include snapshot as base64 if available
  if (local.snapshot) {
    const base64Match = local.snapshot.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
    if (base64Match) {
      result.snapshot = {
        snapshot_type: base64Match[1] === 'png' ? 'png' : 'jpg',
        snapshot_data: base64Match[2],
      };
    }
  }

  return result;
}

// ============================================================================
// Project Mapping Utility
// ============================================================================

export type { ApiProject };
