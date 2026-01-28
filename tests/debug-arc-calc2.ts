/**
 * Debug arc calculation for element #433788
 * Arc: IFCARCINDEX((1,2,3)) with points from #433780
 */

// Points from #433780 (0-indexed: indices 0,1,2 for IFCARCINDEX((1,2,3)))
const p1 = { x: -0.0059945229789585943, y: 12.951470382956527 };
const p2 = { x: -0.04215832194313171, y: 6.4757017034397233 };   // Arc midpoint
const p3 = { x: -0.005999625854020087, y: -6.7004571713749785e-05 };

console.log('Arc 1 points (IFCARCINDEX((1,2,3))):');
console.log(`  p1 (idx 0): (${p1.x.toFixed(6)}, ${p1.y.toFixed(6)})`);
console.log(`  p2 (idx 1): (${p2.x.toFixed(6)}, ${p2.y.toFixed(6)})`);
console.log(`  p3 (idx 2): (${p3.x.toFixed(10)}, ${p3.y.toFixed(10)})`);

// Calculate d (determinant for collinearity check)
const ax = p1.x, ay = p1.y;
const bx = p2.x, by = p2.y;
const cx = p3.x, cy = p3.y;

const d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
console.log(`\nd (determinant): ${d}`);

if (Math.abs(d) >= 1e-10) {
  const ux = ((ax * ax + ay * ay) * (by - cy)
    + (bx * bx + by * by) * (cy - ay)
    + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx)
    + (bx * bx + by * by) * (ax - cx)
    + (cx * cx + cy * cy) * (bx - ax)) / d;

  console.log(`Circle center: (${ux.toFixed(2)}, ${uy.toFixed(2)})`);

  const radius = Math.sqrt((p1.x - ux) ** 2 + (p1.y - uy) ** 2);
  console.log(`Radius: ${radius.toFixed(2)}`);

  const chord_len = Math.sqrt((p3.x - p1.x) ** 2 + (p3.y - p1.y) ** 2);
  console.log(`Chord length: ${chord_len.toFixed(4)}`);
  console.log(`Radius / Chord ratio: ${(radius / chord_len).toFixed(2)}`);

  if (radius > chord_len * 50.0) {
    console.log(`\n*** Would be treated as LINE (ratio > 50) ***`);
  } else {
    console.log(`\n*** Still treated as ARC! Need stricter threshold ***`);
  }
}

// Second arc: IFCARCINDEX((4,5,6)) - indices 3,4,5
console.log('\n\n=== Second Arc ===');
const p4 = { x: 0.005999625853950784, y: 6.7004575460470058e-05 };
const p5 = { x: -0.030158321943065131, y: 6.4757016987080043 };
const p6 = { x: 0.0060047286232551419, y: 12.951336364346504 };

console.log('Arc 2 points (IFCARCINDEX((4,5,6))):');
console.log(`  p4 (idx 3): (${p4.x.toFixed(10)}, ${p4.y.toFixed(10)})`);
console.log(`  p5 (idx 4): (${p5.x.toFixed(6)}, ${p5.y.toFixed(6)})`);
console.log(`  p6 (idx 5): (${p6.x.toFixed(6)}, ${p6.y.toFixed(6)})`);

const ax2 = p4.x, ay2 = p4.y;
const bx2 = p5.x, by2 = p5.y;
const cx2 = p6.x, cy2 = p6.y;

const d2 = 2.0 * (ax2 * (by2 - cy2) + bx2 * (cy2 - ay2) + cx2 * (ay2 - by2));
console.log(`\nd (determinant): ${d2}`);

if (Math.abs(d2) >= 1e-10) {
  const ux2 = ((ax2 * ax2 + ay2 * ay2) * (by2 - cy2)
    + (bx2 * bx2 + by2 * by2) * (cy2 - ay2)
    + (cx2 * cx2 + cy2 * cy2) * (ay2 - by2)) / d2;
  const uy2 = ((ax2 * ax2 + ay2 * ay2) * (cx2 - bx2)
    + (bx2 * bx2 + by2 * by2) * (ax2 - cx2)
    + (cx2 * cx2 + cy2 * cy2) * (bx2 - ax2)) / d2;

  console.log(`Circle center: (${ux2.toFixed(2)}, ${uy2.toFixed(2)})`);

  const radius2 = Math.sqrt((p4.x - ux2) ** 2 + (p4.y - uy2) ** 2);
  console.log(`Radius: ${radius2.toFixed(2)}`);

  const chord_len2 = Math.sqrt((p6.x - p4.x) ** 2 + (p6.y - p4.y) ** 2);
  console.log(`Chord length: ${chord_len2.toFixed(4)}`);
  console.log(`Radius / Chord ratio: ${(radius2 / chord_len2).toFixed(2)}`);
}
