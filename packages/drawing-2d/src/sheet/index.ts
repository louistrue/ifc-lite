/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drawing Sheet Module
 *
 * Provides complete architectural drawing sheet support:
 * - Paper sizes (ISO, ANSI, ARCH)
 * - Drawing frames with zone references
 * - Title blocks with editable fields
 * - Scale bars and north arrows
 */

// Paper sizes
export type {
  PaperOrientation,
  PaperSizeCategory,
  PaperSizeDefinition,
} from './paper-sizes';
export {
  PAPER_SIZE_REGISTRY,
  getPaperSizesByCategory,
  getDefaultPaperSize,
} from './paper-sizes';

// Frame types
export type {
  FrameStyle,
  FrameBorderConfig,
  FrameMargins,
  DrawingFrame,
} from './frame-types';
export {
  FRAME_PRESETS,
  createFrame,
  getDefaultFrame,
} from './frame-types';

// Title block types
export type {
  TitleBlockPosition,
  TitleBlockLayout,
  TitleBlockField,
  TitleBlockLogo,
  RevisionEntry,
  TitleBlockConfig,
} from './title-block-types';
export {
  DEFAULT_TITLE_BLOCK_FIELDS,
  TITLE_BLOCK_PRESETS,
  createTitleBlock,
  getDefaultTitleBlock,
  updateTitleBlockField,
} from './title-block-types';

// Scale bar types
export type {
  ScaleBarStyle,
  ScaleBarPosition,
  ScaleBarUnits,
  ScaleBarConfig,
  NorthArrowStyle,
  NorthArrowConfig,
} from './scale-bar-types';
export {
  DEFAULT_SCALE_BAR,
  DEFAULT_NORTH_ARROW,
  calculateOptimalScaleBarLength,
  calculateOptimalDivisions,
} from './scale-bar-types';

// Sheet types
export type {
  ViewportBounds,
  DrawingSheet,
  SheetCreationOptions,
} from './sheet-types';
export {
  calculateViewportBounds,
  calculateDrawingTransform,
} from './sheet-types';

// Renderers
export type {
  FrameRenderResult,
} from './frame-renderer';
export { renderFrame } from './frame-renderer';

export type {
  FrameInnerBounds,
  TitleBlockRenderResult,
  TitleBlockExtras,
} from './title-block-renderer';
export { renderTitleBlock } from './title-block-renderer';

export type { PositionMm } from './scale-bar-renderer';
export { renderScaleBar, renderNorthArrow } from './scale-bar-renderer';
