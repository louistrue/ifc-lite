/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateCloudArcs, generateCloudSVGPath } from './cloudPathGenerator.js';

describe('generateCloudArcs', () => {
  it('generates arcs for a simple rectangle', () => {
    const arcs = generateCloudArcs(
      { x: 0, y: 0 },
      { x: 4, y: 2 },
      0.5 // arcRadius
    );
    // Should produce arcs along all 4 edges
    assert.ok(arcs.length > 0, 'Should generate at least some arcs');
  });

  it('produces arcs proportional to edge length', () => {
    // A 4x2 rectangle with arcRadius=1 (diameter=2)
    // Top edge (4 units): ~2 arcs
    // Right edge (2 units): ~1 arc
    // Bottom edge (4 units): ~2 arcs
    // Left edge (2 units): ~1 arc
    // Total: ~6 arcs
    const arcs = generateCloudArcs(
      { x: 0, y: 0 },
      { x: 4, y: 2 },
      1.0
    );
    assert.strictEqual(arcs.length, 6);
  });

  it('handles equal corners (zero-size rectangle) gracefully', () => {
    const arcs = generateCloudArcs(
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      0.5
    );
    // All edges are zero-length, should skip them
    assert.strictEqual(arcs.length, 0);
  });

  it('handles reversed corner order', () => {
    const arcs1 = generateCloudArcs({ x: 0, y: 0 }, { x: 4, y: 2 }, 1.0);
    const arcs2 = generateCloudArcs({ x: 4, y: 2 }, { x: 0, y: 0 }, 1.0);
    // Should produce same number of arcs regardless of corner order
    assert.strictEqual(arcs1.length, arcs2.length);
  });

  it('each arc has valid start, end, center, and radius', () => {
    const arcs = generateCloudArcs({ x: 0, y: 0 }, { x: 2, y: 2 }, 0.5);
    for (const arc of arcs) {
      assert.ok(isFinite(arc.start.x) && isFinite(arc.start.y), 'Start should be finite');
      assert.ok(isFinite(arc.end.x) && isFinite(arc.end.y), 'End should be finite');
      assert.ok(isFinite(arc.center.x) && isFinite(arc.center.y), 'Center should be finite');
      assert.ok(arc.radius > 0, 'Radius should be positive');
      assert.ok(isFinite(arc.startAngle), 'Start angle should be finite');
      assert.ok(isFinite(arc.endAngle), 'End angle should be finite');
    }
  });
});

describe('generateCloudSVGPath', () => {
  it('generates a valid SVG path string', () => {
    const path = generateCloudSVGPath(
      { x: 0, y: 0 },
      { x: 4, y: 2 },
      1.0,
      (x) => x,
      (y) => y,
    );
    assert.ok(path.startsWith('M'), 'Path should start with M command');
    assert.ok(path.includes('A'), 'Path should contain arc commands');
    assert.ok(path.endsWith('Z'), 'Path should end with Z (close)');
  });

  it('uses clockwise sweep flag (1) for outward-bulging arcs', () => {
    const path = generateCloudSVGPath(
      { x: 0, y: 0 },
      { x: 4, y: 2 },
      1.0,
      (x) => x,
      (y) => y,
    );
    // All arcs should use sweep-flag=1 (clockwise = outward bulge)
    const arcMatches = path.match(/A\s+[\d.]+\s+[\d.]+\s+0\s+0\s+(\d)/g);
    assert.ok(arcMatches && arcMatches.length > 0, 'Should have arc commands');
    for (const match of arcMatches!) {
      assert.ok(match.endsWith('1'), `Arc sweep flag should be 1 (clockwise/outward), got: ${match}`);
    }
  });

  it('applies coordinate transforms', () => {
    // Flip X
    const path = generateCloudSVGPath(
      { x: 1, y: 0 },
      { x: 3, y: 2 },
      0.5,
      (x) => -x,
      (y) => y,
    );
    assert.ok(path.includes('-'), 'Flipped X should produce negative coordinates');
  });

  it('handles small rectangles', () => {
    const path = generateCloudSVGPath(
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
      0.02,
      (x) => x,
      (y) => y,
    );
    assert.ok(path.length > 0, 'Should produce a non-empty path');
    assert.ok(path.endsWith('Z'), 'Path should be closed');
  });
});
