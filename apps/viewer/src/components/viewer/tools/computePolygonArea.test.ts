/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computePolygonArea,
  computePolygonPerimeter,
  computePolygonCentroid,
  formatArea,
} from './computePolygonArea.js';

describe('computePolygonArea', () => {
  it('returns 0 for fewer than 3 points', () => {
    assert.strictEqual(computePolygonArea([]), 0);
    assert.strictEqual(computePolygonArea([{ x: 0, y: 0 }]), 0);
    assert.strictEqual(computePolygonArea([{ x: 0, y: 0 }, { x: 1, y: 0 }]), 0);
  });

  it('computes area of a unit square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    assert.strictEqual(computePolygonArea(square), 1);
  });

  it('computes area of a right triangle', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    assert.strictEqual(computePolygonArea(triangle), 6);
  });

  it('computes area of a rectangle', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 0, y: 3 },
    ];
    assert.strictEqual(computePolygonArea(rect), 15);
  });

  it('returns positive area regardless of winding direction', () => {
    // Counter-clockwise
    const ccw = [
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
    ];
    assert.strictEqual(computePolygonArea(ccw), 4);
  });

  it('computes area of an irregular polygon', () => {
    // L-shaped polygon (6 vertices)
    const lShape = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    // Area: 3*1 + 1*1 = 4
    assert.strictEqual(computePolygonArea(lShape), 4);
  });
});

describe('computePolygonPerimeter', () => {
  it('returns 0 for fewer than 2 points', () => {
    assert.strictEqual(computePolygonPerimeter([]), 0);
    assert.strictEqual(computePolygonPerimeter([{ x: 0, y: 0 }]), 0);
  });

  it('computes perimeter of a unit square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    assert.strictEqual(computePolygonPerimeter(square), 4);
  });

  it('computes perimeter of a 3-4-5 right triangle', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    assert.strictEqual(computePolygonPerimeter(triangle), 12);
  });

  it('computes perimeter of a rectangle', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
      { x: 0, y: 3 },
    ];
    assert.strictEqual(computePolygonPerimeter(rect), 16);
  });
});

describe('computePolygonCentroid', () => {
  it('returns origin for empty polygon', () => {
    const c = computePolygonCentroid([]);
    assert.strictEqual(c.x, 0);
    assert.strictEqual(c.y, 0);
  });

  it('returns the point for a single point', () => {
    const c = computePolygonCentroid([{ x: 3, y: 7 }]);
    assert.strictEqual(c.x, 3);
    assert.strictEqual(c.y, 7);
  });

  it('computes centroid of a unit square at origin', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const c = computePolygonCentroid(square);
    assert.strictEqual(c.x, 1);
    assert.strictEqual(c.y, 1);
  });

  it('computes centroid of a triangle', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 6 },
    ];
    const c = computePolygonCentroid(triangle);
    assert.strictEqual(c.x, 2);
    assert.strictEqual(c.y, 2);
  });
});

describe('formatArea', () => {
  it('formats small areas in cm²', () => {
    assert.strictEqual(formatArea(0.005), '50.0 cm²');
    assert.strictEqual(formatArea(0.001), '10.0 cm²');
  });

  it('formats medium areas in m²', () => {
    assert.strictEqual(formatArea(1), '1.00 m²');
    assert.strictEqual(formatArea(25.5), '25.50 m²');
    assert.strictEqual(formatArea(100), '100.00 m²');
  });

  it('formats large areas in hectares', () => {
    assert.strictEqual(formatArea(10000), '1.00 ha');
    assert.strictEqual(formatArea(50000), '5.00 ha');
  });
});
