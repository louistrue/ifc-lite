/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Revision cloud (scalloped border) path generation.
 * Generates arc data for drawing cloud annotations on a canvas or SVG.
 */

interface Point2D {
  x: number;
  y: number;
}

/** A single arc segment in the cloud border */
export interface CloudArc {
  /** Start point of the arc */
  start: Point2D;
  /** End point of the arc */
  end: Point2D;
  /** Center of the arc circle */
  center: Point2D;
  /** Radius of the arc */
  radius: number;
  /** Start angle in radians */
  startAngle: number;
  /** End angle in radians */
  endAngle: number;
}

/**
 * Generate cloud arc data from two rectangle corner points.
 * The two points define opposite corners of the rectangle.
 * Arcs bulge outward from the rectangle edges.
 *
 * @param p1 First corner (e.g. top-left)
 * @param p2 Second corner (e.g. bottom-right)
 * @param arcRadius Radius of each scallop arc in drawing coords
 * @returns Array of arc segments forming the cloud border
 */
export function generateCloudArcs(
  p1: Point2D,
  p2: Point2D,
  arcRadius: number
): CloudArc[] {
  // Build rectangle corners in clockwise order
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  const corners: Point2D[] = [
    { x: minX, y: minY }, // top-left (in drawing coords, Y increases downward on screen)
    { x: maxX, y: minY }, // top-right
    { x: maxX, y: maxY }, // bottom-right
    { x: minX, y: maxY }, // bottom-left
  ];

  const arcs: CloudArc[] = [];

  // For each edge, generate scallop arcs
  for (let i = 0; i < corners.length; i++) {
    const edgeStart = corners[i];
    const edgeEnd = corners[(i + 1) % corners.length];

    const dx = edgeEnd.x - edgeStart.x;
    const dy = edgeEnd.y - edgeStart.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    if (edgeLength < 0.001) continue;

    // Number of arcs along this edge
    const arcDiameter = arcRadius * 2;
    const arcCount = Math.max(1, Math.round(edgeLength / arcDiameter));
    const segmentLength = edgeLength / arcCount;
    const actualRadius = segmentLength / 2;

    // Unit direction along edge
    const ux = dx / edgeLength;
    const uy = dy / edgeLength;

    // Outward normal (perpendicular, pointing outward from rectangle)
    // For clockwise winding, outward normal is to the right of the edge direction
    const nx = uy;
    const ny = -ux;

    for (let j = 0; j < arcCount; j++) {
      const t0 = j / arcCount;
      const t1 = (j + 1) / arcCount;

      const arcStart: Point2D = {
        x: edgeStart.x + dx * t0,
        y: edgeStart.y + dy * t0,
      };
      const arcEnd: Point2D = {
        x: edgeStart.x + dx * t1,
        y: edgeStart.y + dy * t1,
      };

      // Center of the arc is offset outward from the midpoint
      const midX = (arcStart.x + arcEnd.x) / 2;
      const midY = (arcStart.y + arcEnd.y) / 2;

      // The arc center is at the midpoint of the segment (on the edge)
      // The arc bulges outward by the radius amount
      const center: Point2D = {
        x: midX,
        y: midY,
      };

      // Compute angles from center to start and end
      const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
      const endAngle = Math.atan2(arcEnd.y - center.y, arcEnd.x - center.x);

      arcs.push({
        start: arcStart,
        end: arcEnd,
        center,
        radius: actualRadius,
        startAngle,
        endAngle,
      });
    }
  }

  return arcs;
}

/**
 * Draw cloud arcs on a Canvas 2D context.
 * Arcs are drawn as semicircular bumps bulging outward.
 */
export function drawCloudOnCanvas(
  ctx: CanvasRenderingContext2D,
  p1: Point2D,
  p2: Point2D,
  arcRadius: number,
  toScreenX: (x: number) => number,
  toScreenY: (y: number) => number,
  screenScale: number
): void {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  const corners: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  ctx.beginPath();

  for (let i = 0; i < corners.length; i++) {
    const edgeStart = corners[i];
    const edgeEnd = corners[(i + 1) % corners.length];

    const dx = edgeEnd.x - edgeStart.x;
    const dy = edgeEnd.y - edgeStart.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    if (edgeLength < 0.001) continue;

    const arcDiameter = arcRadius * 2;
    const arcCount = Math.max(1, Math.round(edgeLength / arcDiameter));
    const actualRadius = (edgeLength / arcCount) / 2;

    // Unit direction along edge
    const ux = dx / edgeLength;
    const uy = dy / edgeLength;

    // Outward normal for clockwise winding
    const nx = uy;
    const ny = -ux;

    for (let j = 0; j < arcCount; j++) {
      const t0 = j / arcCount;
      const t1 = (j + 1) / arcCount;

      const sx = edgeStart.x + dx * t0;
      const sy = edgeStart.y + dy * t0;
      const ex = edgeStart.x + dx * t1;
      const ey = edgeStart.y + dy * t1;

      // Arc center is on the edge at midpoint
      const cx = (sx + ex) / 2;
      const cy = (sy + ey) / 2;

      // Convert to screen coords
      const scx = toScreenX(cx);
      const scy = toScreenY(cy);
      const screenRadius = actualRadius * screenScale;

      // Angles in screen space (Y may be flipped)
      const ssx = toScreenX(sx);
      const ssy = toScreenY(sy);
      const sex = toScreenX(ex);
      const sey = toScreenY(ey);

      const startAngle = Math.atan2(ssy - scy, ssx - scx);
      const endAngle = Math.atan2(sey - scy, sex - scx);

      // Draw arc clockwise (false) so the semicircle bulges outward from the rectangle
      ctx.arc(scx, scy, screenRadius, startAngle, endAngle, false);
    }
  }

  ctx.closePath();
}

/**
 * Generate SVG path data for a cloud annotation.
 */
export function generateCloudSVGPath(
  p1: Point2D,
  p2: Point2D,
  arcRadius: number,
  transformX: (x: number) => number,
  transformY: (y: number) => number,
): string {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  const corners: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  let path = '';

  for (let i = 0; i < corners.length; i++) {
    const edgeStart = corners[i];
    const edgeEnd = corners[(i + 1) % corners.length];

    const dx = edgeEnd.x - edgeStart.x;
    const dy = edgeEnd.y - edgeStart.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    if (edgeLength < 0.001) continue;

    const arcDiameter = arcRadius * 2;
    const arcCount = Math.max(1, Math.round(edgeLength / arcDiameter));
    const segmentLength = edgeLength / arcCount;
    const r = segmentLength / 2;

    for (let j = 0; j < arcCount; j++) {
      const t0 = j / arcCount;
      const t1 = (j + 1) / arcCount;

      const sx = transformX(edgeStart.x + (edgeEnd.x - edgeStart.x) * t0);
      const sy = transformY(edgeStart.y + (edgeEnd.y - edgeStart.y) * t0);
      const ex = transformX(edgeStart.x + (edgeEnd.x - edgeStart.x) * t1);
      const ey = transformY(edgeStart.y + (edgeEnd.y - edgeStart.y) * t1);

      // Move to start of first arc
      if (i === 0 && j === 0) {
        path += `M ${sx.toFixed(4)} ${sy.toFixed(4)}`;
      }

      // SVG arc: A rx ry x-rotation large-arc-flag sweep-flag x y
      // sweep-flag=1 for clockwise (outward bulge from rectangle)
      const trR = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2) / 2;
      path += ` A ${trR.toFixed(4)} ${trR.toFixed(4)} 0 0 1 ${ex.toFixed(4)} ${ey.toFixed(4)}`;
    }
  }

  path += ' Z';
  return path;
}
