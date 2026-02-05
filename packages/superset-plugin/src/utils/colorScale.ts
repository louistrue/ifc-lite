/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Color scale utilities for mapping entity metrics/categories to RGBA colors.
 *
 * Provides both sequential (numeric → gradient) and categorical (string → palette)
 * color mappings. When running inside a real Superset build, prefer using
 * @superset-ui/core's color registries instead.
 */

/** RGBA tuple where each channel is 0-255. */
export type RGBA = [number, number, number, number];

/* -------------------------------------------------------------------------- */
/*  Built-in palettes (used standalone; Superset overrides when available)    */
/* -------------------------------------------------------------------------- */

const SEQUENTIAL_PALETTES: Record<string, Array<[number, number, number]>> = {
  superset_seq_1: [
    [44, 123, 182],
    [87, 163, 190],
    [147, 204, 185],
    [210, 232, 177],
    [255, 255, 191],
    [253, 212, 132],
    [249, 160, 89],
    [231, 104, 60],
    [215, 25, 28],
  ],
  superset_seq_2: [
    [5, 48, 97],
    [33, 102, 172],
    [67, 147, 195],
    [146, 197, 222],
    [209, 229, 240],
    [253, 219, 199],
    [244, 165, 130],
    [214, 96, 77],
    [178, 24, 43],
  ],
  reds: [
    [255, 245, 240],
    [254, 224, 210],
    [252, 187, 161],
    [252, 146, 114],
    [251, 106, 74],
    [239, 59, 44],
    [203, 24, 29],
    [165, 15, 21],
    [103, 0, 13],
  ],
  blues: [
    [247, 251, 255],
    [222, 235, 247],
    [198, 219, 239],
    [158, 202, 225],
    [107, 174, 214],
    [66, 146, 198],
    [33, 113, 181],
    [8, 81, 156],
    [8, 48, 107],
  ],
  greens: [
    [247, 252, 245],
    [229, 245, 224],
    [199, 233, 192],
    [161, 217, 155],
    [116, 196, 118],
    [65, 171, 93],
    [35, 139, 69],
    [0, 109, 44],
    [0, 68, 27],
  ],
  oranges: [
    [255, 245, 235],
    [254, 230, 206],
    [253, 208, 162],
    [253, 174, 107],
    [253, 141, 60],
    [241, 105, 19],
    [217, 72, 1],
    [166, 54, 3],
    [127, 39, 4],
  ],
  blue_white_yellow: [
    [33, 102, 172],
    [67, 147, 195],
    [146, 197, 222],
    [209, 229, 240],
    [247, 247, 247],
    [253, 237, 176],
    [254, 196, 79],
    [236, 144, 22],
    [178, 89, 0],
  ],
};

const CATEGORICAL_PALETTE: Array<[number, number, number]> = [
  [31, 168, 201],  // teal
  [69, 78, 124],   // navy
  [162, 112, 181], // purple
  [255, 159, 60],  // orange
  [75, 173, 78],   // green
  [255, 96, 96],   // red
  [255, 206, 86],  // yellow
  [54, 162, 235],  // sky blue
  [153, 102, 255], // violet
  [255, 159, 164], // pink
  [128, 128, 128], // gray
  [0, 166, 153],   // dark teal
];

/* -------------------------------------------------------------------------- */
/*  Sequential color mapping (numeric → gradient)                             */
/* -------------------------------------------------------------------------- */

/**
 * Linearly interpolate between palette stops for a normalized value [0,1].
 */
function interpolatePalette(
  palette: Array<[number, number, number]>,
  t: number,
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const maxIdx = palette.length - 1;
  const scaledIdx = clamped * maxIdx;
  const lower = Math.floor(scaledIdx);
  const upper = Math.min(lower + 1, maxIdx);
  const frac = scaledIdx - lower;

  const lo = palette[lower];
  const hi = palette[upper];
  return [
    Math.round(lo[0] + (hi[0] - lo[0]) * frac),
    Math.round(lo[1] + (hi[1] - lo[1]) * frac),
    Math.round(lo[2] + (hi[2] - lo[2]) * frac),
  ];
}

/**
 * Build a sequential color map from entity metric values.
 *
 * Maps each entity's numeric value to a color from the palette by
 * normalizing the value into the [min, max] range.
 */
export function buildSequentialColorMap(
  entityMetrics: Map<string, number>,
  schemeName: string,
): Map<string, RGBA> {
  const colorMap = new Map<string, RGBA>();
  if (entityMetrics.size === 0) return colorMap;

  const palette =
    SEQUENTIAL_PALETTES[schemeName] ?? SEQUENTIAL_PALETTES['superset_seq_1'];

  const values = Array.from(entityMetrics.values());
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const range = max - min || 1;

  for (const [entityId, value] of entityMetrics) {
    const t = (value - min) / range;
    const [r, g, b] = interpolatePalette(palette, t);
    colorMap.set(entityId, [r, g, b, 255]);
  }

  return colorMap;
}

/* -------------------------------------------------------------------------- */
/*  Categorical color mapping (string → discrete palette)                     */
/* -------------------------------------------------------------------------- */

/**
 * Build a categorical color map from entity category values.
 *
 * Assigns each unique category a distinct color from the palette,
 * cycling if there are more categories than palette entries.
 */
export function buildCategoricalColorMap(
  entityCategories: Map<string, string>,
): Map<string, RGBA> {
  const colorMap = new Map<string, RGBA>();
  if (entityCategories.size === 0) return colorMap;

  // Collect unique categories in first-seen order
  const categorySet = new Set<string>();
  for (const cat of entityCategories.values()) {
    categorySet.add(cat);
  }
  const categories = Array.from(categorySet);

  // Assign palette index to each category
  const categoryColorIndex = new Map<string, number>();
  for (let i = 0; i < categories.length; i++) {
    categoryColorIndex.set(categories[i], i % CATEGORICAL_PALETTE.length);
  }

  for (const [entityId, category] of entityCategories) {
    const idx = categoryColorIndex.get(category) ?? 0;
    const [r, g, b] = CATEGORICAL_PALETTE[idx];
    colorMap.set(entityId, [r, g, b, 255]);
  }

  return colorMap;
}

/* -------------------------------------------------------------------------- */
/*  Hex parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse a hex color string (#rgb, #rrggbb, #rrggbbaa) into normalized
 * RGBA values [0-1].
 */
export function parseHexToNormalized(
  hex: string,
): [number, number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [
    isNaN(r) ? 0.96 : r,
    isNaN(g) ? 0.96 : g,
    isNaN(b) ? 0.96 : b,
    isNaN(a) ? 1 : a,
  ];
}
