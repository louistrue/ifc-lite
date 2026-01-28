/**
 * Debug arc calculation for element #439847 - still showing disc
 */

// Points from #439839
const points = [
  { x: -0.0070080964169712389, y: 47.186187714200834 },   // 0 (idx 1)
  { x: -0.48465268771956238, y: 23.592961978624718 },     // 1 (idx 2) - arc mid
  { x: -0.0059950680475609266, y: -0.00024322645000055446 }, // 2 (idx 3)
  { x: 0.0059950680472837126, y: 0.0002432264558307111 },    // 3 (idx 4)
  { x: -0.47265268768720037, y: 23.592960599626437 },       // 4 (idx 5) - arc mid
  { x: 0.0049819280045758207, y: 47.185698505568261 }       // 5 (idx 6)
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

    // Sagitta calculation
    const sagitta = Math.abs((p3.y - p1.y) * p2.x - (p3.x - p1.x) * p2.y + p3.x * p1.y - p3.y * p1.x) / chord_len;
    console.log(`  Sagitta: ${sagitta.toFixed(6)}`);
    console.log(`  Sagitta / Chord ratio: ${(sagitta / chord_len).toFixed(6)}`);

    if (sagitta < chord_len * 0.01) {
      console.log(`  *** Would be LINE (sagitta < 1% chord) ***`);
    } else if (radius / chord_len > 20) {
      console.log(`  *** Would be LINE (radius > 20x chord) ***`);
    } else {
      console.log(`  *** Still ARC! ***`);
    }
  }
}

// Arc 1: IFCARCINDEX((1,2,3)) - indices 0,1,2
analyzeArc('Arc 1 (indices 1,2,3)', points[0], points[1], points[2]);

// Arc 2: IFCARCINDEX((4,5,6)) - indices 3,4,5
analyzeArc('Arc 2 (indices 4,5,6)', points[3], points[4], points[5]);
