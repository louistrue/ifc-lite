export {} // module boundary (stripped by transpiler)

// ── Spatial Connectivity & Wayfinding ──────────────────────────────────
// Stakeholder: Facility Manager / Safety Engineer
//
// Computes centrality metrics (degree, closeness, betweenness) for all
// spaces in the building to identify the most important connector rooms,
// bottleneck corridors, and isolated areas. Visualizes shortest paths
// between spaces and highlights critical circulation nodes that, if
// blocked, would most disrupt building connectivity.
// ────────────────────────────────────────────────────────────────────────

bim.viewer.resetColors()
bim.viewer.resetVisibility()

// ── 1. Build graph & compute centrality ───────────────────────────────
const graph = bim.topology.buildGraph()

if (graph.nodes.length === 0) {
  console.warn('No IfcSpace entities found in this model.')
  console.log('')
  console.log('This script requires IfcSpace entities to analyze spatial')
  console.log('connectivity and wayfinding paths.')
  throw new Error('no spaces')
}

if (graph.edges.length === 0) {
  console.warn('No adjacency relationships found between spaces.')
  console.log('Ensure the model has IfcRelSpaceBoundary relationships.')
  console.log('')
  console.log('Found ' + graph.nodes.length + ' spaces but no connections.')
  throw new Error('no edges')
}

const centrality = bim.topology.centrality()

console.log('═══════════════════════════════════════')
console.log('  SPATIAL CONNECTIVITY & WAYFINDING')
console.log('═══════════════════════════════════════')
console.log('')
console.log('Spaces:      ' + graph.nodes.length)
console.log('Connections: ' + graph.edges.length)

// ── 2. Identify key spaces by betweenness centrality ──────────────────
// High betweenness = many shortest paths pass through this space (corridor/hub)
const sortedByBetweenness = [...centrality].sort((a, b) => b.betweenness - a.betweenness)
const maxBetweenness = sortedByBetweenness[0]?.betweenness ?? 0

// 5-tier classification by betweenness
const critical: CentralityResult[] = []    // top 10% — critical corridors
const important: CentralityResult[] = []   // 10-30% — important connectors
const moderate: CentralityResult[] = []    // 30-60% — moderate
const peripheral: CentralityResult[] = []  // 60-90% — peripheral
const terminal: CentralityResult[] = []    // bottom 10% — dead ends

for (const c of sortedByBetweenness) {
  if (maxBetweenness === 0) {
    terminal.push(c)
    continue
  }
  const pct = c.betweenness / maxBetweenness
  if (pct > 0.7) critical.push(c)
  else if (pct > 0.4) important.push(c)
  else if (pct > 0.15) moderate.push(c)
  else if (pct > 0.02) peripheral.push(c)
  else terminal.push(c)
}

// ── 3. Color-code by betweenness centrality ───────────────────────────
const colors = {
  critical: '#e74c3c',    // red — critical path
  important: '#e67e22',   // orange — important connector
  moderate: '#f1c40f',    // yellow — moderate
  peripheral: '#2ecc71',  // green — peripheral
  terminal: '#3498db',    // blue — dead end / terminal room
}

const batches: Array<{ entities: BimEntity[]; color: string }> = []

function refsToEntities(results: CentralityResult[]): BimEntity[] {
  const entities: BimEntity[] = []
  for (const r of results) {
    const e = bim.query.entity(r.ref.modelId, r.ref.expressId)
    if (e) entities.push(e)
  }
  return entities
}

if (critical.length > 0) batches.push({ entities: refsToEntities(critical), color: colors.critical })
if (important.length > 0) batches.push({ entities: refsToEntities(important), color: colors.important })
if (moderate.length > 0) batches.push({ entities: refsToEntities(moderate), color: colors.moderate })
if (peripheral.length > 0) batches.push({ entities: refsToEntities(peripheral), color: colors.peripheral })
if (terminal.length > 0) batches.push({ entities: refsToEntities(terminal), color: colors.terminal })
if (batches.length > 0) bim.viewer.colorizeAll(batches)

// ── 4. Centrality legend ──────────────────────────────────────────────
console.log('')
console.log('── Betweenness Centrality (Circulation Importance) ──')
console.log('  Critical corridors:   ' + critical.length + '  ● red')
console.log('  Important connectors: ' + important.length + '  ● orange')
console.log('  Moderate:             ' + moderate.length + '  ● yellow')
console.log('  Peripheral:           ' + peripheral.length + '  ● green')
console.log('  Terminal / dead ends: ' + terminal.length + '  ● blue')

// ── 5. Top spaces by each centrality metric ───────────────────────────
console.log('')
console.log('── Top 10 by Betweenness (most paths pass through) ──')
console.log('Name                    | Between. | Close.  | Degree  | Role')
console.log('------------------------+----------+---------+---------+-----------')

for (const c of sortedByBetweenness.slice(0, 10)) {
  const name = ((c.name || '<unnamed>') + '                        ').slice(0, 24)
  const bw = (c.betweenness.toFixed(3) + '        ').slice(0, 8)
  const cl = (c.closeness.toFixed(3) + '       ').slice(0, 7)
  const dg = (c.degree.toFixed(3) + '       ').slice(0, 7)

  let role = 'leaf'
  if (maxBetweenness > 0) {
    const pct = c.betweenness / maxBetweenness
    if (pct > 0.7) role = 'CRITICAL'
    else if (pct > 0.4) role = 'important'
    else if (pct > 0.15) role = 'moderate'
    else if (pct > 0.02) role = 'peripheral'
  }
  console.log(name + '| ' + bw + ' | ' + cl + ' | ' + dg + ' | ' + role)
}

// ── 6. Closeness centrality analysis ──────────────────────────────────
const sortedByCloseness = [...centrality].sort((a, b) => b.closeness - a.closeness)

console.log('')
console.log('── Top 10 by Closeness (fastest access to all spaces) ──')
for (const c of sortedByCloseness.slice(0, 10)) {
  const name = ((c.name || '<unnamed>') + '                    ').slice(0, 20)
  console.log('  ' + name + '  closeness=' + c.closeness.toFixed(4))
}

// ── 7. Shortest path demo ─────────────────────────────────────────────
// Find path between the most central and the most peripheral space
if (sortedByBetweenness.length >= 2) {
  const hub = sortedByBetweenness[0]
  const leaf = sortedByBetweenness[sortedByBetweenness.length - 1]

  console.log('')
  console.log('── Shortest Path Demo ──')
  console.log('From: ' + hub.name + ' (most central)')
  console.log('To:   ' + leaf.name + ' (most peripheral)')

  const pathResult = bim.topology.shortestPath(hub.ref, leaf.ref)

  if (pathResult) {
    console.log('')
    console.log('Path found! ' + pathResult.hops + ' hop(s), weight=' + pathResult.totalWeight.toFixed(1))
    console.log('Route:')
    for (let i = 0; i < pathResult.path.length; i++) {
      const ref = pathResult.path[i]
      const node = graph.nodes.find(n =>
        n.ref.modelId === ref.modelId && n.ref.expressId === ref.expressId
      )
      const prefix = i === 0 ? '  START → ' : i === pathResult.path.length - 1 ? '  END   → ' : '        → '
      console.log(prefix + (node?.name || 'Space #' + ref.expressId))
    }
  } else {
    console.warn('No path found! Spaces are in disconnected components.')
  }
}

// ── 8. Find all pairs shortest path summary ───────────────────────────
// Compute the diameter (longest shortest path) by sampling
const components = bim.topology.connectedComponents()
if (components.length > 0 && components[0].length >= 2) {
  const mainComponent = components[0]
  let maxHops = 0
  let maxPairFrom = ''
  let maxPairTo = ''

  // Sample pairs to find diameter (full enumeration would be O(n²))
  const sampleSize = Math.min(mainComponent.length, 15)
  for (let i = 0; i < sampleSize; i++) {
    for (let j = i + 1; j < sampleSize; j++) {
      const p = bim.topology.shortestPath(mainComponent[i], mainComponent[j])
      if (p && p.hops > maxHops) {
        maxHops = p.hops
        const n1 = graph.nodes.find(n =>
          n.ref.modelId === mainComponent[i].modelId && n.ref.expressId === mainComponent[i].expressId
        )
        const n2 = graph.nodes.find(n =>
          n.ref.modelId === mainComponent[j].modelId && n.ref.expressId === mainComponent[j].expressId
        )
        maxPairFrom = n1?.name || '?'
        maxPairTo = n2?.name || '?'
      }
    }
  }

  console.log('')
  console.log('── Connectivity Summary ──')
  console.log('  Estimated diameter: ' + maxHops + ' hops')
  console.log('  Farthest pair:     ' + maxPairFrom + ' ↔ ' + maxPairTo)
  console.log('  Components:        ' + components.length)
  if (components.length > 1) {
    console.warn('  WARNING: ' + (components.length - 1) + ' disconnected group(s) detected')
  }
}

// ── 9. Bottleneck analysis ────────────────────────────────────────────
// Spaces with high betweenness but low degree are bottlenecks
const bottlenecks = centrality
  .filter(c => c.betweenness > 0 && c.degree <= 0.3)
  .sort((a, b) => b.betweenness - a.betweenness)
  .slice(0, 5)

if (bottlenecks.length > 0) {
  console.log('')
  console.warn('── Potential Bottlenecks ──')
  console.warn('Spaces with high centrality but few connections:')
  for (const b of bottlenecks) {
    console.warn('  ' + b.name + '  (betweenness=' + b.betweenness.toFixed(3) + ', degree=' + b.degree.toFixed(3) + ')')
  }
  console.warn('Blocking these spaces would most disrupt building circulation.')
}
