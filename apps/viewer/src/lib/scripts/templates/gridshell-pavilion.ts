export {} // module boundary for type checking
/**
 * Parametric Timber Gridshell Pavilion
 *
 * Demonstrates advanced parametric creation: a doubly-curved timber
 * gridshell with two families of curved laths forming a diamond lattice
 * on an undulating surface. Each lath is a sequence of short beam
 * segments that follow the surface curvature — hundreds of beams
 * generated from a single mathematical surface definition.
 */

// ─── Parameters ────────────────────────────────────────────────────────

const SPAN_X  = 12;      // pavilion span in X (m)
const SPAN_Y  = 10;      // pavilion span in Y (m)
const PEAK_H  = 4.5;     // maximum height at crown (m)
const GRID_U  = 16;      // surface divisions along U
const GRID_V  = 14;      // surface divisions along V
const SECTION = 0.06;    // timber lath section size (60 mm)
const DEPTH   = 0.08;    // timber lath depth (80 mm)

// ─── Surface definition ───────────────────────────────────────────────

const cx = SPAN_X / 2;
const cy = SPAN_Y / 2;
const ax = cx * 0.95;    // ellipse semi-axis X (slightly inset)
const ay = cy * 0.95;    // ellipse semi-axis Y

/**
 * Doubly-curved pavilion surface.
 * A cosine dome on an elliptical plan with a gentle asymmetric wave
 * that gives it architectural character — not a boring symmetric dome.
 */
function surfaceZ(x: number, y: number): number {
  const dx = (x - cx) / ax;
  const dy = (y - cy) / ay;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r >= 1) return 0;
  // Main dome
  const dome = PEAK_H * Math.cos((Math.PI / 2) * r);
  // Subtle saddle undulation for visual interest
  const wave = 0.4 * Math.sin(Math.PI * dx) * Math.cos(Math.PI * dy);
  return Math.max(0, dome + wave);
}

function surfacePt(u: number, v: number): [number, number, number] {
  const x = u * SPAN_X;
  const y = v * SPAN_Y;
  return [x, y, surfaceZ(x, y)];
}

// ─── Build grid of surface points ──────────────────────────────────────

const pts: [number, number, number][][] = [];
for (let i = 0; i <= GRID_U; i++) {
  const row: [number, number, number][] = [];
  for (let j = 0; j <= GRID_V; j++) {
    row.push(surfacePt(i / GRID_U, j / GRID_V));
  }
  pts.push(row);
}

// ─── IFC project setup ────────────────────────────────────────────────

const h = bim.create.project({
  Name: 'Timber Gridshell Pavilion',
  Description: 'Parametric doubly-curved timber gridshell — two-directional lath lattice',
  Author: 'ifc-lite',
  Organization: 'ifc-lite',
});

const storey = bim.create.addStorey(h, {
  Name: 'Ground Level',
  Elevation: 0,
});

// ─── Colour palette — warm timber tones ───────────────────────────────

const COLOR_A: [number, number, number] = [0.82, 0.62, 0.38]; // larch / warm
const COLOR_B: [number, number, number] = [0.72, 0.52, 0.30]; // darker oak
const COLOR_NODE: [number, number, number] = [0.35, 0.35, 0.38]; // steel nodes

// ─── Helper — create a beam segment if above ground ───────────────────

const MIN_Z = 0.15; // skip beams too close to ground plane
let beamCount = 0;
let nodeCount = 0;

function addLath(
  family: string,
  index: number,
  segIdx: number,
  start: [number, number, number],
  end: [number, number, number],
  color: [number, number, number],
): number | null {
  if (start[2] < MIN_Z && end[2] < MIN_Z) return null;
  // Clamp to ground
  const s: [number, number, number] = [start[0], start[1], Math.max(0, start[2])];
  const e: [number, number, number] = [end[0], end[1], Math.max(0, end[2])];

  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const dz = e[2] - s[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.01) return null;

  const beamId = bim.create.addBeam(h, storey, {
    Name: `${family}-${index.toString().padStart(2, '0')}/${segIdx}`,
    Description: `Gridshell lath ${family} #${index} segment ${segIdx}`,
    ObjectType: 'Timber Lath:GL24h 60x80',
    Start: s,
    End: e,
    Width: SECTION,
    Height: DEPTH,
  });
  bim.create.setColor(h, beamId, 'Timber - Larch', color);
  bim.create.addMaterial(h, beamId, {
    Name: 'Glulam GL24h Spruce',
    Category: 'Timber',
  });
  beamCount++;
  return beamId;
}

// ─── Family A — diagonal laths (i+1, j+1) direction ──────────────────

// Each diagonal has constant (i - j). Diagonals run from top-left to bottom-right.
for (let d = -(GRID_V); d <= GRID_U; d++) {
  const segments: number[] = [];
  // Walk along diagonal d where i - j = d
  const iStart = Math.max(0, d);
  const iEnd = Math.min(GRID_U, GRID_V + d);
  for (let i = iStart; i < iEnd; i++) {
    const j = i - d;
    if (j < 0 || j >= GRID_V) continue;
    const beamId = addLath('A', d + GRID_V, i - iStart, pts[i][j], pts[i + 1][j + 1], COLOR_A);
    if (beamId != null) segments.push(beamId);
  }
}

// ─── Family B — diagonal laths (i+1, j-1) direction ──────────────────

// Each diagonal has constant (i + j). Diagonals run from bottom-left to top-right.
for (let s = 0; s <= GRID_U + GRID_V; s++) {
  const iStart = Math.max(0, s - GRID_V);
  const iEnd = Math.min(GRID_U, s);
  for (let i = iStart; i < iEnd; i++) {
    const j = s - i;
    if (j <= 0 || j > GRID_V) continue;
    const beamId = addLath('B', s, i - iStart, pts[i][j], pts[i + 1][j - 1], COLOR_B);
    if (beamId != null) segments.push(0);
  }
}

// ─── Node columns at grid intersections (where laths cross) ──────────

// Place small steel connection nodes at interior grid intersections
// where the surface is high enough
for (let i = 1; i < GRID_U; i += 2) {
  for (let j = 1; j < GRID_V; j += 2) {
    const [x, y, z] = pts[i][j];
    if (z < 0.5) continue;
    const colId = bim.create.addColumn(h, storey, {
      Name: `Node-${i}-${j}`,
      Description: 'Gridshell connection node',
      ObjectType: 'Connection:Steel Node',
      Position: [x, y, z - 0.04],
      Width: 0.10,
      Depth: 0.10,
      Height: 0.08,
    });
    bim.create.setColor(h, colId, 'Steel Node', COLOR_NODE);
    bim.create.addMaterial(h, colId, {
      Name: 'Stainless Steel 316',
      Category: 'Steel',
    });
    nodeCount++;
  }
}

// ─── Ground ring beam — elliptical footprint ──────────────────────────

const RING_N = 40; // segments around the ellipse
for (let k = 0; k < RING_N; k++) {
  const a1 = (k / RING_N) * 2 * Math.PI;
  const a2 = ((k + 1) / RING_N) * 2 * Math.PI;
  const s: [number, number, number] = [
    cx + ax * Math.cos(a1),
    cy + ay * Math.sin(a1),
    0,
  ];
  const e: [number, number, number] = [
    cx + ax * Math.cos(a2),
    cy + ay * Math.sin(a2),
    0,
  ];
  const ringId = bim.create.addBeam(h, storey, {
    Name: `Ring-${k.toString().padStart(2, '0')}`,
    Description: 'Elliptical ground ring beam',
    ObjectType: 'Beam:Glulam GL28h 120x200',
    Start: s,
    End: e,
    Width: 0.12,
    Height: 0.20,
  });
  bim.create.setColor(h, ringId, 'Timber - Dark', [0.45, 0.32, 0.20]);
  bim.create.addMaterial(h, ringId, {
    Name: 'Glulam GL28h Larch',
    Category: 'Timber',
  });
  beamCount++;
}

// ─── Ground slab (thin foundation pad) ─────────────────────────────────

const slabId = bim.create.addSlab(h, storey, {
  Name: 'Foundation Pad',
  Description: 'Lightweight concrete foundation pad',
  ObjectType: 'Slab:Concrete - 150mm',
  Position: [cx - ax - 0.5, cy - ay - 0.5, -0.15],
  Thickness: 0.15,
  Width: 2 * ax + 1,
  Depth: 2 * ay + 1,
});
bim.create.setColor(h, slabId, 'Concrete - Light', [0.78, 0.78, 0.76]);
bim.create.addMaterial(h, slabId, {
  Name: 'Lightweight Concrete C20/25',
  Category: 'Concrete',
});

// ─── Generate, preview, download ───────────────────────────────────────

const result = bim.create.toIfc(h);

console.log(
  `Timber Gridshell Pavilion generated:\n` +
  `  ${beamCount} beam segments (laths + ring)\n` +
  `  ${nodeCount} connection nodes\n` +
  `  ${result.entities.length} IFC entities total\n` +
  `  ${result.stats.entityCount} STEP lines\n` +
  `  ${(result.stats.fileSize / 1024).toFixed(1)} KB`,
);

bim.model.loadIfc(result.content, 'gridshell-pavilion.ifc');
bim.export.download(result.content, 'gridshell-pavilion.ifc', 'application/x-step');
