/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Title Block Renderer - Generates SVG for drawing title blocks
 *
 * Renders:
 * - Title block border and grid
 * - Field labels and values
 * - Company logo
 * - Revision history table
 */

import type { TitleBlockConfig, RevisionEntry } from './title-block-types';

/** Inner bounds of the frame (where title block is positioned) */
export interface FrameInnerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of title block rendering */
export interface TitleBlockRenderResult {
  /** SVG elements for the title block */
  svgElements: string;
  /** Bounds of the title block (mm from paper origin) */
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Render a title block to SVG
 */
export function renderTitleBlock(
  config: TitleBlockConfig,
  frameInnerBounds: FrameInnerBounds,
  revisions: RevisionEntry[] = []
): TitleBlockRenderResult {
  // Calculate title block position and size
  let x: number, y: number, w: number, h: number;

  switch (config.position) {
    case 'bottom-right':
      w = config.widthMm;
      h = config.heightMm;
      x = frameInnerBounds.x + frameInnerBounds.width - w;
      y = frameInnerBounds.y + frameInnerBounds.height - h;
      break;
    case 'bottom-full':
      w = frameInnerBounds.width;
      h = config.heightMm;
      x = frameInnerBounds.x;
      y = frameInnerBounds.y + frameInnerBounds.height - h;
      break;
    case 'right-strip':
      w = config.widthMm;
      h = frameInnerBounds.height;
      x = frameInnerBounds.x + frameInnerBounds.width - w;
      y = frameInnerBounds.y;
      break;
    default:
      w = config.widthMm;
      h = config.heightMm;
      x = frameInnerBounds.x + frameInnerBounds.width - w;
      y = frameInnerBounds.y + frameInnerBounds.height - h;
  }

  let svg = '  <g id="title-block">\n';

  // Background (if specified)
  if (config.backgroundColor) {
    svg += `    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" `;
    svg += `width="${w.toFixed(2)}" height="${h.toFixed(2)}" `;
    svg += `fill="${config.backgroundColor}"/>\n`;
  }

  // Outer border
  svg += `    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" `;
  svg += `width="${w.toFixed(2)}" height="${h.toFixed(2)}" `;
  svg += `fill="none" stroke="#000000" stroke-width="${config.borderWeight}"/>\n`;

  // Render fields based on layout
  svg += renderTitleBlockFields(config, x, y, w, h);

  // Logo
  if (config.logo?.source) {
    svg += renderLogo(config.logo, x, y, w, h);
  }

  // Revision history
  if (config.showRevisionHistory && revisions.length > 0) {
    svg += renderRevisionHistory(
      revisions.slice(0, config.maxRevisionEntries),
      x,
      y,
      w,
      h,
      config
    );
  }

  svg += '  </g>\n';

  return {
    svgElements: svg,
    bounds: { x, y, width: w, height: h },
  };
}

/**
 * Render title block fields in a grid layout
 */
function renderTitleBlockFields(
  config: TitleBlockConfig,
  x: number,
  y: number,
  w: number,
  h: number
): string {
  let svg = '    <g id="title-block-fields">\n';

  // Calculate grid dimensions
  const numCols = 2;
  const logoSpace = config.logo ? 50 : 0; // Reserve space for logo
  const revisionSpace = config.showRevisionHistory ? 20 : 0;
  const availableWidth = w - logoSpace - 5; // 5mm padding
  const availableHeight = h - revisionSpace - 3; // 3mm padding

  // Group fields by row
  const fieldsByRow = new Map<number, typeof config.fields>();
  for (const field of config.fields) {
    const row = field.row ?? 0;
    if (!fieldsByRow.has(row)) {
      fieldsByRow.set(row, []);
    }
    fieldsByRow.get(row)!.push(field);
  }

  const numRows = Math.max(...Array.from(fieldsByRow.keys())) + 1;
  const rowHeight = availableHeight / numRows;
  const colWidth = availableWidth / numCols;

  // Draw grid lines
  const gridStartX = x + logoSpace + 2;
  const gridStartY = y + 2;

  // Horizontal lines
  for (let i = 1; i < numRows; i++) {
    const lineY = gridStartY + i * rowHeight;
    svg += `      <line x1="${gridStartX.toFixed(2)}" y1="${lineY.toFixed(2)}" `;
    svg += `x2="${(gridStartX + availableWidth - 4).toFixed(2)}" y2="${lineY.toFixed(2)}" `;
    svg += `stroke="#000000" stroke-width="${config.gridWeight}"/>\n`;
  }

  // Vertical line (center divider)
  const centerX = gridStartX + colWidth;
  svg += `      <line x1="${centerX.toFixed(2)}" y1="${gridStartY.toFixed(2)}" `;
  svg += `x2="${centerX.toFixed(2)}" y2="${(gridStartY + availableHeight - 2).toFixed(2)}" `;
  svg += `stroke="#000000" stroke-width="${config.gridWeight}"/>\n`;

  // Render each field
  for (const [row, fields] of fieldsByRow) {
    for (const field of fields) {
      const col = field.col ?? 0;
      const colSpan = field.colSpan ?? 1;

      const fieldX = gridStartX + col * colWidth + 2;
      const fieldY = gridStartY + row * rowHeight + 2;
      const fieldW = colWidth * colSpan - 4;

      // Label (smaller, above value)
      const labelY = fieldY + field.fontSize * 0.4;
      svg += `      <text x="${fieldX.toFixed(2)}" y="${labelY.toFixed(2)}" `;
      svg += `font-family="Arial, sans-serif" font-size="${(field.fontSize * 0.6).toFixed(2)}" `;
      svg += `fill="#666666">${escapeXml(field.label)}</text>\n`;

      // Value
      const valueY = fieldY + rowHeight * 0.65;
      svg += `      <text x="${fieldX.toFixed(2)}" y="${valueY.toFixed(2)}" `;
      svg += `font-family="Arial, sans-serif" font-size="${field.fontSize.toFixed(2)}" `;
      svg += `font-weight="${field.fontWeight}" fill="#000000">${escapeXml(field.value)}</text>\n`;
    }
  }

  svg += '    </g>\n';
  return svg;
}

/**
 * Render company logo
 */
function renderLogo(
  logo: NonNullable<TitleBlockConfig['logo']>,
  x: number,
  y: number,
  w: number,
  h: number
): string {
  let svg = '    <g id="title-block-logo">\n';

  let logoX: number, logoY: number;

  switch (logo.position) {
    case 'top-left':
      logoX = x + 3;
      logoY = y + 3;
      break;
    case 'top-right':
      logoX = x + w - logo.widthMm - 3;
      logoY = y + 3;
      break;
    case 'bottom-left':
    default:
      logoX = x + 3;
      logoY = y + h - logo.heightMm - 3;
      break;
  }

  // Render logo as image
  svg += `      <image x="${logoX.toFixed(2)}" y="${logoY.toFixed(2)}" `;
  svg += `width="${logo.widthMm.toFixed(2)}" height="${logo.heightMm.toFixed(2)}" `;
  svg += `href="${escapeXml(logo.source)}" preserveAspectRatio="xMidYMid meet"/>\n`;

  svg += '    </g>\n';
  return svg;
}

/**
 * Render revision history table
 */
function renderRevisionHistory(
  revisions: RevisionEntry[],
  x: number,
  y: number,
  w: number,
  h: number,
  config: TitleBlockConfig
): string {
  let svg = '    <g id="revision-history">\n';

  const tableHeight = 18;
  const tableY = y - tableHeight - 2;
  const rowHeight = 4;
  const fontSize = 2.2;

  // Table header
  svg += `      <rect x="${x.toFixed(2)}" y="${tableY.toFixed(2)}" `;
  svg += `width="${w.toFixed(2)}" height="${tableHeight.toFixed(2)}" `;
  svg += `fill="none" stroke="#000000" stroke-width="${config.gridWeight}"/>\n`;

  // Column headers
  const cols = [
    { label: 'REV', width: w * 0.1 },
    { label: 'DESCRIPTION', width: w * 0.5 },
    { label: 'DATE', width: w * 0.2 },
    { label: 'BY', width: w * 0.2 },
  ];

  let colX = x;
  for (const col of cols) {
    // Header text
    svg += `      <text x="${(colX + 1).toFixed(2)}" y="${(tableY + 3).toFixed(2)}" `;
    svg += `font-family="Arial, sans-serif" font-size="${fontSize}" `;
    svg += `font-weight="bold" fill="#000000">${col.label}</text>\n`;

    // Vertical divider
    if (colX > x) {
      svg += `      <line x1="${colX.toFixed(2)}" y1="${tableY.toFixed(2)}" `;
      svg += `x2="${colX.toFixed(2)}" y2="${(tableY + tableHeight).toFixed(2)}" `;
      svg += `stroke="#000000" stroke-width="${config.gridWeight}"/>\n`;
    }

    colX += col.width;
  }

  // Header divider line
  svg += `      <line x1="${x.toFixed(2)}" y1="${(tableY + rowHeight).toFixed(2)}" `;
  svg += `x2="${(x + w).toFixed(2)}" y2="${(tableY + rowHeight).toFixed(2)}" `;
  svg += `stroke="#000000" stroke-width="${config.gridWeight}"/>\n`;

  // Revision entries
  for (let i = 0; i < revisions.length && i < config.maxRevisionEntries; i++) {
    const rev = revisions[i];
    const rowY = tableY + rowHeight * (i + 1.5);

    colX = x;
    const values = [rev.revision, rev.description, rev.date, rev.author];

    for (let j = 0; j < cols.length; j++) {
      const maxChars = Math.floor(cols[j].width / 2);
      const displayValue =
        values[j].length > maxChars
          ? values[j].substring(0, maxChars - 2) + '..'
          : values[j];

      svg += `      <text x="${(colX + 1).toFixed(2)}" y="${rowY.toFixed(2)}" `;
      svg += `font-family="Arial, sans-serif" font-size="${fontSize}" `;
      svg += `fill="#000000">${escapeXml(displayValue)}</text>\n`;

      colX += cols[j].width;
    }

    // Row divider
    if (i < revisions.length - 1) {
      svg += `      <line x1="${x.toFixed(2)}" y1="${(tableY + rowHeight * (i + 2)).toFixed(2)}" `;
      svg += `x2="${(x + w).toFixed(2)}" y2="${(tableY + rowHeight * (i + 2)).toFixed(2)}" `;
      svg += `stroke="#000000" stroke-width="${config.gridWeight * 0.5}"/>\n`;
    }
  }

  svg += '    </g>\n';
  return svg;
}

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
