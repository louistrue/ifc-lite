/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Title Block Types
 *
 * Professional title block configurations with:
 * - Editable fields (project, drawing, revision, etc.)
 * - Auto-population from IFC metadata
 * - Company logo support
 * - Revision history
 */

/** Title block position relative to frame */
export type TitleBlockPosition = 'bottom-right' | 'bottom-full' | 'right-strip';

/** Title block layout preset */
export type TitleBlockLayout = 'compact' | 'standard' | 'extended' | 'custom';

/** Editable field in title block */
export interface TitleBlockField {
  /** Unique field identifier */
  id: string;
  /** Field label displayed in title block */
  label: string;
  /** Current value */
  value: string;
  /** Whether this field is editable by user */
  editable: boolean;
  /** Whether this field is auto-populated from model metadata */
  autoPopulate: boolean;
  /** Source path for auto-population (e.g., 'project.name', 'model.author') */
  autoPopulateSource?: string;
  /** Font size in mm */
  fontSize: number;
  /** Font weight */
  fontWeight: 'normal' | 'bold';
  /** Maximum width in mm (for wrapping) */
  maxWidth?: number;
  /** Row position in grid (0-based) */
  row?: number;
  /** Column position in grid (0-based) */
  col?: number;
  /** Row span in grid layout */
  rowSpan?: number;
  /** Column span in grid layout */
  colSpan?: number;
}

/** Company/firm logo configuration */
export interface TitleBlockLogo {
  /** Logo source (data URL or URL) */
  source: string;
  /** Width in mm */
  widthMm: number;
  /** Height in mm */
  heightMm: number;
  /** Position within title block */
  position: 'top-left' | 'top-right' | 'bottom-left';
}

/** Revision history entry */
export interface RevisionEntry {
  /** Revision number/letter */
  revision: string;
  /** Description of changes */
  description: string;
  /** Date of revision */
  date: string;
  /** Author/approver */
  author: string;
}

/** Complete title block configuration */
export interface TitleBlockConfig {
  /** Layout preset */
  layout: TitleBlockLayout;
  /** Position relative to frame */
  position: TitleBlockPosition;
  /** Width in mm (for bottom-right) or ignored for full width */
  widthMm: number;
  /** Height in mm */
  heightMm: number;
  /** Border line weight */
  borderWeight: number;
  /** Internal grid line weight */
  gridWeight: number;
  /** Background color (optional) */
  backgroundColor?: string;
  /** All fields in the title block */
  fields: TitleBlockField[];
  /** Logo configuration */
  logo: TitleBlockLogo | null;
  /** Show revision history table */
  showRevisionHistory: boolean;
  /** Maximum revision entries to display */
  maxRevisionEntries: number;
}

/** Default title block fields for architectural drawings */
export const DEFAULT_TITLE_BLOCK_FIELDS: TitleBlockField[] = [
  {
    id: 'project-name',
    label: 'Project',
    value: '',
    editable: true,
    autoPopulate: true,
    autoPopulateSource: 'project.name',
    fontSize: 4.5,
    fontWeight: 'bold',
    row: 0,
    col: 0,
    colSpan: 2,
  },
  {
    id: 'drawing-title',
    label: 'Drawing Title',
    value: 'Section',
    editable: true,
    autoPopulate: false,
    fontSize: 5,
    fontWeight: 'bold',
    row: 1,
    col: 0,
    colSpan: 2,
  },
  {
    id: 'drawing-number',
    label: 'Drawing No.',
    value: 'A-001',
    editable: true,
    autoPopulate: false,
    fontSize: 4,
    fontWeight: 'bold',
    row: 2,
    col: 0,
  },
  {
    id: 'revision',
    label: 'Rev',
    value: '-',
    editable: true,
    autoPopulate: false,
    fontSize: 3.5,
    fontWeight: 'bold',
    row: 2,
    col: 1,
  },
  {
    id: 'scale',
    label: 'Scale',
    value: '1:100',
    editable: false,
    autoPopulate: true,
    autoPopulateSource: 'drawing.scale',
    fontSize: 3.5,
    fontWeight: 'normal',
    row: 3,
    col: 0,
  },
  {
    id: 'date',
    label: 'Date',
    value: '',
    editable: true,
    autoPopulate: true,
    autoPopulateSource: 'date.today',
    fontSize: 3,
    fontWeight: 'normal',
    row: 3,
    col: 1,
  },
  {
    id: 'drawn-by',
    label: 'Drawn',
    value: '',
    editable: true,
    autoPopulate: false,
    fontSize: 3,
    fontWeight: 'normal',
    row: 4,
    col: 0,
  },
  {
    id: 'checked-by',
    label: 'Checked',
    value: '',
    editable: true,
    autoPopulate: false,
    fontSize: 3,
    fontWeight: 'normal',
    row: 4,
    col: 1,
  },
  {
    id: 'sheet-number',
    label: 'Sheet',
    value: '1 of 1',
    editable: true,
    autoPopulate: false,
    fontSize: 3,
    fontWeight: 'normal',
    row: 5,
    col: 0,
    colSpan: 2,
  },
];

/** Title block layout presets */
export const TITLE_BLOCK_PRESETS: Record<TitleBlockLayout, Omit<TitleBlockConfig, 'fields' | 'logo'>> = {
  compact: {
    layout: 'compact',
    position: 'bottom-right',
    widthMm: 120,
    heightMm: 35,
    borderWeight: 0.5,
    gridWeight: 0.25,
    showRevisionHistory: false,
    maxRevisionEntries: 0,
  },
  standard: {
    layout: 'standard',
    position: 'bottom-right',
    widthMm: 180,
    heightMm: 55,
    borderWeight: 0.5,
    gridWeight: 0.25,
    showRevisionHistory: true,
    maxRevisionEntries: 3,
  },
  extended: {
    layout: 'extended',
    position: 'bottom-full',
    widthMm: 0, // Full width
    heightMm: 70,
    borderWeight: 0.5,
    gridWeight: 0.25,
    showRevisionHistory: true,
    maxRevisionEntries: 5,
  },
  custom: {
    layout: 'custom',
    position: 'bottom-right',
    widthMm: 180,
    heightMm: 55,
    borderWeight: 0.5,
    gridWeight: 0.25,
    showRevisionHistory: false,
    maxRevisionEntries: 0,
  },
};

/** Create a title block with a specific layout */
export function createTitleBlock(layout: TitleBlockLayout): TitleBlockConfig {
  return {
    ...TITLE_BLOCK_PRESETS[layout],
    fields: DEFAULT_TITLE_BLOCK_FIELDS.map((f) => ({ ...f })),
    logo: null,
  };
}

/** Get default title block (standard layout) */
export function getDefaultTitleBlock(): TitleBlockConfig {
  return createTitleBlock('standard');
}

/** Update a specific field in a title block */
export function updateTitleBlockField(
  config: TitleBlockConfig,
  fieldId: string,
  value: string
): TitleBlockConfig {
  return {
    ...config,
    fields: config.fields.map((f) => (f.id === fieldId ? { ...f, value } : f)),
  };
}
