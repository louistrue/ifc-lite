/**
 * Debug arc calculation for the problematic profile
 */

// The problematic arc points from #742391
const p1 = { x: -0.022639584935674511, y: -4.3495710618914574 };
const p2 = { x: -0.0063198442713406156, y: 4.7424695126287611e-05 }; // Arc midpoint
const p3 = { x: 0.042638458770877567, y: 4.3494209884840176 };

console.log('Arc points:');
console.log(`  p1: (${p1.x.toFixed(6)}, ${p1.y.toFixed(6)})`);
console.log(`  p2: (${p2.x.toFixed(6)}, ${p2.y.toFixed(10)})`);
console.log(`  p3: (${p3.x.toFixed(6)}, ${p3.y.toFixed(6)})`);

// Calculate d (determinant for collinearity check)
const ax = p1.x, ay = p1.y;
const bx = p2.x, by = p2.y;
const cx = p3.x, cy = p3.y;

const d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
console.log(`\nd (determinant): ${d}`);
console.log(`d.abs(): ${Math.abs(d)}`);
console.log(`Is collinear (d < 1e-10)?: ${Math.abs(d) < 1e-10}`);

if (Math.abs(d) >= 1e-10) {
  // Circle center calculation
  const ux = ((ax * ax + ay * ay) * (by - cy)
    + (bx * bx + by * by) * (cy - ay)
    + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx)
    + (bx * bx + by * by) * (ax - cx)
    + (cx * cx + cy * cy) * (bx - ax)) / d;

  console.log(`\nCircle center: (${ux.toFixed(2)}, ${uy.toFixed(2)})`);

  const radius = Math.sqrt((p1.x - ux) ** 2 + (p1.y - uy) ** 2);
  console.log(`Radius: ${radius.toFixed(2)}`);

  // This is the issue! If radius is huge, the arc will be huge!
  if (radius > 100) {
    console.log(`\n*** HUGE RADIUS DETECTED! This is the root cause of the disc artifact! ***`);
  }
}

// What should happen: near-collinear points should be treated as a line
// Let's check how close to collinear these points are
const chordMidX = (p1.x + p3.x) / 2;
const chordMidY = (p1.y + p3.y) / 2;
console.log(`\nChord midpoint: (${chordMidX.toFixed(6)}, ${chordMidY.toFixed(6)})`);
console.log(`Actual arc mid (p2): (${p2.x.toFixed(6)}, ${p2.y.toFixed(10)})`);
console.log(`Distance from p2 to chord midpoint: ${Math.sqrt((p2.x - chordMidX)**2 + (p2.y - chordMidY)**2).toFixed(10)}`);
