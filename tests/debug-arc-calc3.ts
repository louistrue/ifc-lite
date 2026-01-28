/**
 * Debug arc calculation for element #439960
 * IFCARCINDEX((1,2,3)) - points 0,1,2
 */

// Points from #439952
const points = [
  { x: -0.0025424253004179263, y: 36.826003508600621 },   // 0 (idx 1)
  { x: -0.29594085193632363, y: 18.412934377932441 },     // 1 (idx 2) - arc mid
  { x: -0.005997007529883195, y: -0.00018947476434776151 }, // 2 (idx 3)
  { x: 0.0059935554924481042, y: 0.00029873447025623818 },  // 3 (idx 4)
  { x: 0.0058041049298190048, y: 0.0062959924074130584 },   // 4 (idx 5) - arc mid
  { x: 0.0056147162672708873, y: 0.012293252299907386 },    // 5 (idx 6)
  { x: -0.28394025803641126, y: 18.418934627508435 },       // 6 (idx 7) - arc mid
  { x: 0.0094481174395521523, y: 36.825515300190965 }       // 7 (idx 8)
];

function analyzeArc(name: string, p1: {x: number, y: number}, p2: {x: number, y: number}, p3: {x: number, y: number}) {
  console.log(`\n=== ${name} ===`);
  console.log(`  p1: (${p1.x.toFixed(6)}, ${p1.y.toFixed(6)})`);
  console.log(`  p2: (${p2.x.toFixed(6)}, ${p2.y.toFixed(6)})`);
  console.log(`  p3: (${p3.x.toFixed(6)}, ${p3.y.toFixed(6)})`);

  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  console.log(`  d (determinant): ${d.toFixed(6)}`);

  if (Math.abs(d) >= 1e-10) {
    const ux = ((ax * ax + ay * ay) * (by - cy)
      + (bx * bx + by * by) * (cy - ay)
      + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx)
      + (bx * bx + by * by) * (ax - cx)
      + (cx * cx + cy * cy) * (bx - ax)) / d;

    console.log(`  Circle center: (${ux.toFixed(2)}, ${uy.toFixed(2)})`);

    const radius = Math.sqrt((p1.x - ux) ** 2 + (p1.y - uy) ** 2);
    console.log(`  Radius: ${radius.toFixed(2)}`);

    const chord_len = Math.sqrt((p3.x - p1.x) ** 2 + (p3.y - p1.y) ** 2);
    console.log(`  Chord length: ${chord_len.toFixed(4)}`);
    console.log(`  Radius / Chord ratio: ${(radius / chord_len).toFixed(2)}`);

    if (radius / chord_len > 20) {
      console.log(`  *** Would be LINE (ratio > 20) ***`);
    } else {
      console.log(`  *** Still ARC! ***`);
    }
  }
}

// Arc 1: IFCARCINDEX((1,2,3)) - indices 0,1,2
analyzeArc('Arc 1 (indices 1,2,3)', points[0], points[1], points[2]);

// Arc 2: IFCARCINDEX((4,5,6)) - indices 3,4,5
analyzeArc('Arc 2 (indices 4,5,6)', points[3], points[4], points[5]);

// Arc 3: IFCARCINDEX((6,7,8)) - indices 5,6,7
analyzeArc('Arc 3 (indices 6,7,8)', points[5], points[6], points[7]);
