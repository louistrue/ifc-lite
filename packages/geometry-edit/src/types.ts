/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for geometry editing in IFC-Lite
 *
 * Supports parametric editing (IFC parameters) and direct mesh manipulation.
 * Designed for live preview with immediate visual feedback.
 */

import type { MeshData, Vec3 } from '@ifc-lite/geometry';

// ============================================================================
// Base Types
// ============================================================================

/**
 * 2D point for profile definitions
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * 3D transformation matrix (4x4, column-major)
 */
export type Matrix4 = Float32Array; // 16 floats

/**
 * Axis-aligned bounding box
 */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

// ============================================================================
// Parameter Types
// ============================================================================

/**
 * Types of parameters that can be edited
 */
export enum ParameterType {
  /** Single numeric value (length, radius, angle) */
  Number = 'number',
  /** 2D point */
  Point2D = 'point2d',
  /** 3D vector/point */
  Vec3 = 'vec3',
  /** 2D profile (array of points) */
  Profile = 'profile',
  /** Boolean flag */
  Boolean = 'boolean',
  /** Enumeration value */
  Enum = 'enum',
  /** Reference to another entity */
  Reference = 'reference',
}

/**
 * Constraint types for geometry parameters
 */
export enum ConstraintType {
  /** Value must be >= min */
  MinValue = 'min_value',
  /** Value must be <= max */
  MaxValue = 'max_value',
  /** Value must be > 0 */
  Positive = 'positive',
  /** Points must form a closed loop */
  ClosedProfile = 'closed_profile',
  /** Must be parallel to another element */
  Parallel = 'parallel',
  /** Must be perpendicular to another element */
  Perpendicular = 'perpendicular',
  /** Fixed distance from another element */
  Distance = 'distance',
  /** Coincident with another point/edge */
  Coincident = 'coincident',
}

/**
 * A constraint on a geometry parameter
 */
export interface Constraint {
  type: ConstraintType;
  /** Reference entity for relational constraints */
  referenceEntityId?: number;
  /** Reference parameter path */
  referenceParameter?: string;
  /** Numeric value for distance/min/max constraints */
  value?: number;
  /** Whether constraint is active */
  enabled: boolean;
}

/**
 * A single editable geometry parameter
 */
export interface GeometryParameter {
  /** IFC entity EXPRESS ID */
  entityId: number;
  /** Model ID for multi-model support */
  modelId: string;
  /** Parameter path in IFC structure (e.g., "SweptArea.XDim") */
  path: string;
  /** Human-readable name */
  displayName: string;
  /** Parameter type */
  type: ParameterType;
  /** Current value */
  value: ParameterValue;
  /** Default/original value (for reset) */
  originalValue: ParameterValue;
  /** Unit (e.g., "m", "mm", "deg") */
  unit?: string;
  /** Active constraints */
  constraints: Constraint[];
  /** Whether parameter is currently editable */
  editable: boolean;
  /** IFC attribute path for export */
  ifcAttributePath: string;
}

/**
 * Union of all parameter value types
 */
export type ParameterValue =
  | number
  | Point2D
  | Vec3
  | Point2D[]
  | boolean
  | string
  | number; // Reference entityId

// ============================================================================
// Entity Types
// ============================================================================

/**
 * IFC entity types that support parametric editing
 */
export enum EditableIfcType {
  // Extrusions
  IfcExtrudedAreaSolid = 'IFCEXTRUDEDAREASOLID',
  IfcExtrudedAreaSolidTapered = 'IFCEXTRUDEDAREASOLIDTAPERED',

  // Profiles
  IfcRectangleProfileDef = 'IFCRECTANGLEPROFILEDEF',
  IfcCircleProfileDef = 'IFCCIRCLEPROFILEDEF',
  IfcEllipseProfileDef = 'IFCELLIPSEPROFILEDEF',
  IfcIShapeProfileDef = 'IFCISHAPEPROFILEDEF',
  IfcLShapeProfileDef = 'IFCLSHAPEPROFILEDEF',
  IfcTShapeProfileDef = 'IFCTSHAPEPROFILEDEF',
  IfcUShapeProfileDef = 'IFCUSHAPEPROFILEDEF',
  IfcCShapeProfileDef = 'IFCCSHAPEPROFILEDEF',
  IfcZShapeProfileDef = 'IFCZSHAPEPROFILEDEF',
  IfcArbitraryClosedProfileDef = 'IFCARBITRARYCLOSEDPROFILEDEF',

  // Placements
  IfcLocalPlacement = 'IFCLOCALPLACEMENT',
  IfcAxis2Placement3D = 'IFCAXIS2PLACEMENT3D',

  // Boolean operations
  IfcBooleanClippingResult = 'IFCBOOLEANCLIPPINGRESULT',
  IfcBooleanResult = 'IFCBOOLEANRESULT',

  // Tessellated (mesh editing only)
  IfcTriangulatedFaceSet = 'IFCTRIANGULATEDFACESET',
  IfcPolygonalFaceSet = 'IFCPOLYGONALFACESET',
  IfcFacetedBrep = 'IFCFACETEDBREP',
}

/**
 * Edit mode for an entity
 */
export enum EditMode {
  /** No editing */
  None = 'none',
  /** Parametric editing (change IFC parameters) */
  Parametric = 'parametric',
  /** Direct mesh editing (vertex/face manipulation) */
  Mesh = 'mesh',
}

/**
 * An entity that can be edited
 */
export interface EditableEntity {
  /** IFC EXPRESS ID */
  expressId: number;
  /** Model ID */
  modelId: string;
  /** Global ID for renderer reference */
  globalId: number;
  /** IFC type name */
  ifcType: string;
  /** Available edit mode */
  editMode: EditMode;
  /** Editable parameters (for parametric mode) */
  parameters: GeometryParameter[];
  /** Current mesh data */
  meshData: MeshData;
  /** Bounding box */
  bounds: AABB;
  /** Whether entity is currently being edited */
  isEditing: boolean;
}

// ============================================================================
// Mutation Types
// ============================================================================

/**
 * Types of geometry mutations
 */
export enum GeometryMutationType {
  /** Change a parametric value */
  ParameterChange = 'PARAMETER_CHANGE',
  /** Move vertex/vertices */
  VertexMove = 'VERTEX_MOVE',
  /** Move edge */
  EdgeMove = 'EDGE_MOVE',
  /** Move face */
  FaceMove = 'FACE_MOVE',
  /** Extrude face */
  FaceExtrude = 'FACE_EXTRUDE',
  /** Scale entity */
  Scale = 'SCALE',
  /** Rotate entity */
  Rotate = 'ROTATE',
  /** Translate entity */
  Translate = 'TRANSLATE',
  /** Add new entity */
  CreateEntity = 'CREATE_ENTITY',
  /** Delete entity */
  DeleteEntity = 'DELETE_ENTITY',
}

/**
 * A single geometry mutation operation
 */
export interface GeometryMutation {
  /** Unique mutation ID */
  id: string;
  /** Mutation type */
  type: GeometryMutationType;
  /** Timestamp */
  timestamp: number;
  /** Model ID */
  modelId: string;
  /** Entity EXPRESS ID */
  entityId: number;
  /** Global ID for renderer */
  globalId: number;

  // For parameter changes
  /** Parameter path */
  parameterPath?: string;
  /** Previous value (for undo) */
  oldValue?: ParameterValue;
  /** New value */
  newValue?: ParameterValue;

  // For mesh operations
  /** Affected vertex indices */
  vertexIndices?: number[];
  /** Affected face indices */
  faceIndices?: number[];
  /** Movement delta */
  delta?: Vec3;
  /** Previous mesh data (for undo) */
  oldMeshData?: MeshData;
  /** New mesh data */
  newMeshData?: MeshData;

  // For transform operations
  /** Transform matrix */
  transform?: Matrix4;
  /** Inverse transform (for undo) */
  inverseTransform?: Matrix4;
}

/**
 * Result of applying a geometry mutation
 */
export interface MutationResult {
  /** Whether mutation was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Updated mesh data */
  meshData?: MeshData;
  /** Updated parameter values */
  updatedParameters?: GeometryParameter[];
  /** Constraint violations */
  constraintViolations?: ConstraintViolation[];
}

/**
 * A constraint violation
 */
export interface ConstraintViolation {
  /** Constraint that was violated */
  constraint: Constraint;
  /** Parameter that violated constraint */
  parameterPath: string;
  /** Current value */
  currentValue: ParameterValue;
  /** Suggested valid value */
  suggestedValue?: ParameterValue;
  /** Human-readable message */
  message: string;
}

// ============================================================================
// Profile Types
// ============================================================================

/**
 * Profile type enumeration matching IFC
 */
export enum ProfileType {
  Rectangle = 'RECTANGLE',
  Circle = 'CIRCLE',
  Ellipse = 'ELLIPSE',
  IShape = 'ISHAPE',
  LShape = 'LSHAPE',
  TShape = 'TSHAPE',
  UShape = 'USHAPE',
  CShape = 'CSHAPE',
  ZShape = 'ZSHAPE',
  Arbitrary = 'ARBITRARY',
}

/**
 * 2D profile definition
 */
export interface Profile2D {
  /** Profile type */
  type: ProfileType;
  /** Profile points (for arbitrary profiles) */
  points?: Point2D[];
  /** Width (for rectangular/standard profiles) */
  width?: number;
  /** Height/depth */
  height?: number;
  /** Radius (for circular profiles) */
  radius?: number;
  /** Semi-axis 1 (for ellipse) */
  semiAxis1?: number;
  /** Semi-axis 2 (for ellipse) */
  semiAxis2?: number;
  /** Profile-specific parameters (flange thickness, web thickness, etc.) */
  params?: Record<string, number>;
  /** Inner curves for hollow profiles */
  innerCurves?: Point2D[][];
}

/**
 * Extrusion definition
 */
export interface ExtrusionDef {
  /** 2D profile to extrude */
  profile: Profile2D;
  /** Extrusion depth */
  depth: number;
  /** Extrusion direction (default: [0, 0, 1]) */
  direction?: Vec3;
  /** Position offset */
  position?: Vec3;
  /** Rotation (radians) */
  rotation?: number;
}

// ============================================================================
// Mesh Editing Types
// ============================================================================

/**
 * Mesh selection target type
 */
export enum MeshSelectionType {
  Vertex = 'vertex',
  Edge = 'edge',
  Face = 'face',
}

/**
 * Selected mesh element
 */
export interface MeshSelection {
  type: MeshSelectionType;
  /** Vertex indices (for vertex selection) */
  vertexIndices?: number[];
  /** Edge definition (two vertex indices) */
  edge?: [number, number];
  /** Face index */
  faceIndex?: number;
  /** World position of selection */
  position: Vec3;
  /** Normal at selection */
  normal?: Vec3;
}

/**
 * Mesh edit operation
 */
export interface MeshEditOperation {
  type: 'move' | 'scale' | 'rotate' | 'extrude';
  /** Selection to operate on */
  selection: MeshSelection;
  /** Movement/scale/rotation value */
  value: Vec3 | number;
  /** Constrain to normal direction */
  constrainToNormal?: boolean;
  /** Constrain to axis */
  constrainToAxis?: 'x' | 'y' | 'z';
  /** Preserve connected geometry */
  preserveTopology?: boolean;
}

// ============================================================================
// Edit Session Types
// ============================================================================

/**
 * Current geometry edit session state
 */
export interface EditSession {
  /** Session ID */
  id: string;
  /** Entity being edited */
  entity: EditableEntity;
  /** Edit mode */
  mode: EditMode;
  /** Pending mutations (not yet committed) */
  pendingMutations: GeometryMutation[];
  /** Current mesh preview (with pending changes applied) */
  previewMesh: MeshData;
  /** Active constraint violations */
  constraintViolations: ConstraintViolation[];
  /** Session start time */
  startedAt: number;
  /** Whether session has unsaved changes */
  isDirty: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique mutation ID
 */
export function generateMutationId(): string {
  return `geom_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a parameter key for lookup
 */
export function parameterKey(
  modelId: string,
  entityId: number,
  path: string
): string {
  return `${modelId}:${entityId}:${path}`;
}

/**
 * Check if an IFC type supports parametric editing
 */
export function isParametricType(ifcType: string): boolean {
  const normalizedType = ifcType.toUpperCase();
  return Object.values(EditableIfcType).includes(normalizedType as EditableIfcType);
}

/**
 * Get recommended edit mode for an IFC type
 */
export function getRecommendedEditMode(ifcType: string): EditMode {
  const normalizedType = ifcType.toUpperCase();

  // Parametric types
  const parametricTypes = [
    EditableIfcType.IfcExtrudedAreaSolid,
    EditableIfcType.IfcExtrudedAreaSolidTapered,
    EditableIfcType.IfcRectangleProfileDef,
    EditableIfcType.IfcCircleProfileDef,
    EditableIfcType.IfcEllipseProfileDef,
    EditableIfcType.IfcIShapeProfileDef,
    EditableIfcType.IfcLShapeProfileDef,
    EditableIfcType.IfcTShapeProfileDef,
    EditableIfcType.IfcUShapeProfileDef,
    EditableIfcType.IfcBooleanClippingResult,
  ];

  if (parametricTypes.includes(normalizedType as EditableIfcType)) {
    return EditMode.Parametric;
  }

  // Mesh-only types
  const meshTypes = [
    EditableIfcType.IfcTriangulatedFaceSet,
    EditableIfcType.IfcPolygonalFaceSet,
    EditableIfcType.IfcFacetedBrep,
  ];

  if (meshTypes.includes(normalizedType as EditableIfcType)) {
    return EditMode.Mesh;
  }

  return EditMode.None;
}

/**
 * Clone a Vec3
 */
export function cloneVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Clone a Point2D
 */
export function clonePoint2D(p: Point2D): Point2D {
  return { x: p.x, y: p.y };
}

/**
 * Add two Vec3
 */
export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Subtract Vec3: a - b
 */
export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Scale Vec3
 */
export function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/**
 * Vec3 length
 */
export function lengthVec3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * Normalize Vec3
 */
export function normalizeVec3(v: Vec3): Vec3 {
  const len = lengthVec3(v);
  if (len < 1e-10) return { x: 0, y: 0, z: 1 };
  return scaleVec3(v, 1 / len);
}

/**
 * Dot product
 */
export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Cross product
 */
export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Create identity matrix
 */
export function identityMatrix4(): Matrix4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/**
 * Create translation matrix
 */
export function translationMatrix4(v: Vec3): Matrix4 {
  const m = identityMatrix4();
  m[12] = v.x;
  m[13] = v.y;
  m[14] = v.z;
  return m;
}

/**
 * Create scale matrix
 */
export function scaleMatrix4(s: Vec3): Matrix4 {
  const m = new Float32Array(16);
  m[0] = s.x;
  m[5] = s.y;
  m[10] = s.z;
  m[15] = 1;
  return m;
}
