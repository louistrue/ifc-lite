/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/sdk — The scripting SDK for ifc-lite
 *
 * Single entry point for all BIM automation:
 *
 * ```ts
 * import { createBimContext } from '@ifc-lite/sdk';
 *
 * // Embedded mode (viewer internal)
 * const bim = createBimContext({ backend: myLocalBackend });
 *
 * // Connected mode (cross-tab)
 * import { BroadcastTransport } from '@ifc-lite/sdk';
 * const transport = new BroadcastTransport('ifc-lite');
 * const bim = createBimContext({ transport });
 *
 * // Use the API
 * const walls = bim.query().byType('IfcWall').toArray();
 * bim.viewer.colorize(walls.map(w => w.ref), '#ff0000');
 * ```
 */

// ============================================================================
// Core
// ============================================================================

export { BimContext, createBimContext } from './context.js';

// ============================================================================
// Types
// ============================================================================

export type {
  // Entity references
  EntityRef,
  EntityRefString,
  EntityData,
  PropertySetData,
  PropertyData,
  QuantitySetData,
  QuantityData,

  // Model
  ModelInfo,
  SchemaVersion,

  // Query
  QueryDescriptor,
  QueryFilter,
  ComparisonOp,

  // Viewer
  CameraState,
  ProjectionMode,
  SectionPlane,

  // Spatial
  AABB,
  SpatialPlane,
  SpatialFrustum,

  // Mutation
  MutationRecord,

  // Events
  BimEventType,
  BimEventData,
  BimEventHandler,

  // Transport protocol
  SdkRequest,
  SdkResponse,
  SdkEvent,
  Transport,

  // Backend
  BimBackend,
  BimContextOptions,

  // Backend namespace interfaces
  ModelBackendMethods,
  QueryBackendMethods,
  SelectionBackendMethods,
  VisibilityBackendMethods,
  ViewerBackendMethods,
  MutateBackendMethods,
  SpatialBackendMethods,
  ExportBackendMethods,
  LensBackendMethods,
} from './types.js';

export { entityRefToString, stringToEntityRef, dispatchToBackend } from './types.js';

// ============================================================================
// Namespaces (for type access)
// ============================================================================

export { QueryBuilder, QueryNamespace } from './namespaces/query.js';
export { ModelNamespace } from './namespaces/model.js';
export { ViewerNamespace } from './namespaces/viewer.js';
export { MutateNamespace } from './namespaces/mutate.js';
export { LensNamespace } from './namespaces/lens.js';
export { ExportNamespace } from './namespaces/export.js';
export type { ExportCsvOptions, ExportGltfOptions, ExportStepOptions } from './namespaces/export.js';
export { IDSNamespace } from './namespaces/ids.js';
export type { IDSValidationSummary } from './namespaces/ids.js';
export { BCFNamespace } from './namespaces/bcf.js';
export type { TopicOptions, CommentOptions } from './namespaces/bcf.js';
export { DrawingNamespace } from './namespaces/drawing.js';
export type { SectionCutOptions, FloorPlanOptions } from './namespaces/drawing.js';
export { ListNamespace } from './namespaces/list.js';
export { SpatialNamespace } from './namespaces/spatial.js';
export { EventsNamespace } from './namespaces/events.js';

// ============================================================================
// Transport
// ============================================================================

export { BroadcastTransport } from './transport/broadcast.js';
export { MessagePortTransport } from './transport/message-port.js';
export { RemoteBackend } from './transport/remote-backend.js';

// ============================================================================
// Host (viewer side)
// ============================================================================

export { BimHost } from './host.js';
