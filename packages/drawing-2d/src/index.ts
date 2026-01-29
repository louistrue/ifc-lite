/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/drawing-2d
 *
 * 2D architectural drawing generation from IFC models.
 * Generates section cuts, floor plans, and elevations with:
 * - Cut lines (geometry intersected by section plane)
 * - Projection lines (visible geometry beyond cut)
 * - Hidden lines (occluded geometry, dashed)
 * - Silhouettes and feature edges
 * - Hatching (material-based fill patterns by IFC type)
 * - Vector output (SVG)
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type {
  // Vector types
  Vec2,
  Vec3,
  Point2D,
  Line2D,
  Polyline2D,
  Polygon2D,
  Bounds2D,

  // Configuration
  SectionAxis,
  SectionPlaneConfig,
  SectionConfig,

  // Line classification
  LineCategory,
  VisibilityState,

  // Drawing elements
  DrawingLine,
  DrawingPolygon,

  // Intermediate results
  CutSegment,
  MeshCutResult,
  SectionCutResult,

  // Complete output
  Drawing2D,

  // Edge data
  EdgeData,

  // Utility types
  EntityKey,
} from './types';

export { DEFAULT_SECTION_CONFIG, makeEntityKey, parseEntityKey } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION CUTTING
// ═══════════════════════════════════════════════════════════════════════════

export { SectionCutter, cutMeshesStreaming } from './section-cutter';
export type { StreamingSectionCutterOptions } from './section-cutter';

// ═══════════════════════════════════════════════════════════════════════════
// POLYGON BUILDING
// ═══════════════════════════════════════════════════════════════════════════

export { PolygonBuilder, simplifyPolygon, polygonBounds } from './polygon-builder';

// ═══════════════════════════════════════════════════════════════════════════
// LINE MERGING
// ═══════════════════════════════════════════════════════════════════════════

export {
  mergeDrawingLines,
  mergeCollinearLines,
  deduplicateLines,
  splitLineAtParams,
} from './line-merger';
export type { LineMergerOptions } from './line-merger';

// ═══════════════════════════════════════════════════════════════════════════
// EDGE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

export { EdgeExtractor, getViewDirection } from './edge-extractor';

// ═══════════════════════════════════════════════════════════════════════════
// HIDDEN LINE REMOVAL
// ═══════════════════════════════════════════════════════════════════════════

export { HiddenLineClassifier } from './hidden-line';
export type { VisibilitySegment, VisibilityResult, HiddenLineOptions } from './hidden-line';

// ═══════════════════════════════════════════════════════════════════════════
// STYLES (HATCHING & LINE WEIGHTS)
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Hatch patterns
  HATCH_PATTERNS,
  getHatchPattern,

  // Line styles
  LINE_STYLES,
  TYPE_LINE_WEIGHTS,
  getLineStyle,

  // Scales
  COMMON_SCALES,
  getRecommendedScale,

  // Paper sizes
  PAPER_SIZES,
} from './styles';

export type {
  HatchPatternType,
  HatchPattern,
  LineStyle,
  DrawingScale,
  PaperSize,
} from './styles';

// ═══════════════════════════════════════════════════════════════════════════
// HATCH GENERATION
// ═══════════════════════════════════════════════════════════════════════════

export { HatchGenerator } from './hatch-generator';
export type { HatchLine, HatchResult } from './hatch-generator';

// ═══════════════════════════════════════════════════════════════════════════
// SVG EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export { SVGExporter, exportToSVG } from './svg-exporter';
export type { SVGExportOptions } from './svg-exporter';

// ═══════════════════════════════════════════════════════════════════════════
// GPU ACCELERATION
// ═══════════════════════════════════════════════════════════════════════════

export { GPUSectionCutter, isGPUComputeAvailable } from './gpu-section-cutter';

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-LEVEL GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export {
  Drawing2DGenerator,
  createSectionConfig,
  generateFloorPlan,
  generateSection,
} from './drawing-generator';
export type { GeneratorOptions, GeneratorProgress } from './drawing-generator';

// ═══════════════════════════════════════════════════════════════════════════
// MATH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Constants
  EPSILON,

  // Vec3 operations
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Cross,
  vec3Length,
  vec3Normalize,
  vec3Lerp,
  vec3Equals,
  vec3Distance,

  // Point2D operations
  point2D,
  point2DAdd,
  point2DSub,
  point2DScale,
  point2DDot,
  point2DLength,
  point2DDistance,
  point2DLerp,
  point2DEquals,
  point2DNormalize,
  point2DCross,

  // Line operations
  lineLength,
  lineMidpoint,
  lineDirection,
  linesCollinear,
  projectPointOnLine,

  // Bounds operations
  boundsEmpty,
  boundsExtendPoint,
  boundsExtendLine,
  boundsCenter,
  boundsSize,
  boundsValid,

  // Plane operations
  signedDistanceToPlane,
  getAxisNormal,
  getProjectionAxes,
  projectTo2D,

  // Polygon operations
  polygonSignedArea,
  isCounterClockwise,
  reversePolygon,
  ensureCCW,
  ensureCW,
} from './math';
