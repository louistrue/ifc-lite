export {} // module boundary (stripped by transpiler)

// ── Room Adjacency Analysis ────────────────────────────────────────────
// Stakeholder: Architect / Facility Manager
//
// Builds a topology graph from IfcSpace entities and their shared boundary
// elements. Visualizes which rooms are connected, groups them by adjacency
// cluster, and color-codes the 3D view as a connectivity heat map. This
// analysis instantly reveals spatial relationships that would take hours
// to determine from floor plans alone.
// ────────────────────────────────────────────────────────────────────────

bim.viewer.resetColors()
bim.viewer.resetVisibility()

// ── 1. Build the topology graph ───────────────────────────────────────
const graph = bim.topology.buildGraph()

if (graph.nodes.length === 0) {
  console.warn('No IfcSpace entities found in this model.')
  console.log('')
  console.log('This script requires IfcSpace entities with IfcRelSpaceBoundary')
  console.log('relationships to analyze room adjacency.')
  console.log('')
  const storeys = bim.query.byType('IfcBuildingStorey')
  if (storeys.length > 0) {
    console.log('Found ' + storeys.length + ' storey(s) but no spaces defined.')
  }
  throw new Error('no spaces')
}

const adjacency = bim.topology.adjacency()

console.log('═══════════════════════════════════════')
console.log('  ROOM ADJACENCY ANALYSIS')
console.log('═══════════════════════════════════════')
console.log('')
console.log('Spaces:      ' + graph.nodes.length)
console.log('Connections: ' + graph.edges.length)
console.log('Adjacencies: ' + adjacency.length)

// ── 2. Compute degree for each space ──────────────────────────────────
const degreeMap: Record<string, number> = {}
const nameMap: Record<string, string> = {}

for (const node of graph.nodes) {
  const key = node.ref.modelId + ':' + node.ref.expressId
  degreeMap[key] = 0
  nameMap[key] = node.name
}

for (const edge of graph.edges) {
  const srcKey = edge.source.modelId + ':' + edge.source.expressId
  const tgtKey = edge.target.modelId + ':' + edge.target.expressId
  degreeMap[srcKey] = (degreeMap[srcKey] || 0) + 1
  degreeMap[tgtKey] = (degreeMap[tgtKey] || 0) + 1
}

// ── 3. Color-code by connectivity (heat map) ──────────────────────────
// More connections = warmer color (red), fewer = cooler (blue)
const degrees = Object.values(degreeMap)
const maxDeg = Math.max(...degrees, 1)

// 6-tier heat map
const heatColors = [
  '#3498db',  // 0 connections — isolated (blue)
  '#2ecc71',  // low (green)
  '#f1c40f',  // medium-low (yellow)
  '#e67e22',  // medium-high (orange)
  '#e74c3c',  // high (red)
  '#9b59b6',  // very high — hub (purple)
]

const tierNames = ['Isolated', 'Low (1-2)', 'Medium (3-4)', 'High (5-6)', 'Very high (7+)', 'Hub (top)']

const tiers: BimEntity[][] = [[], [], [], [], [], []]
const tierThresholds = [0, 1, 3, 5, 7, Infinity]

for (const node of graph.nodes) {
  const key = node.ref.modelId + ':' + node.ref.expressId
  const deg = degreeMap[key] || 0
  const entity = bim.query.entity(node.ref.modelId, node.ref.expressId)
  if (!entity) continue

  let tierIdx = 0
  if (deg === 0) tierIdx = 0
  else if (deg <= 2) tierIdx = 1
  else if (deg <= 4) tierIdx = 2
  else if (deg <= 6) tierIdx = 3
  else if (deg < maxDeg) tierIdx = 4
  else tierIdx = 5

  tiers[tierIdx].push(entity)
}

const batches: Array<{ entities: BimEntity[]; color: string }> = []
for (let i = 0; i < tiers.length; i++) {
  if (tiers[i].length > 0) {
    batches.push({ entities: tiers[i], color: heatColors[i] })
  }
}
if (batches.length > 0) bim.viewer.colorizeAll(batches)

// ── 4. Heat map legend ────────────────────────────────────────────────
console.log('')
console.log('── Connectivity Heat Map ──')
for (let i = 0; i < tiers.length; i++) {
  if (tiers[i].length > 0) {
    console.log('  ' + tierNames[i] + ': ' + tiers[i].length + ' spaces  ● ' + heatColors[i])
  }
}

// ── 5. Adjacency matrix (top 20 spaces) ───────────────────────────────
console.log('')
console.log('── Top Connected Spaces ──')
console.log('Name                    | Connections | Adjacent to')
console.log('------------------------+-------------+---------------------------')

const sorted = Object.entries(degreeMap)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)

for (const [key, deg] of sorted) {
  const name = ((nameMap[key] || '<unnamed>') + '                        ').slice(0, 24)
  const degStr = (deg + '           ').slice(0, 11)

  // Find neighbors
  const neighbors: string[] = []
  for (const pair of adjacency) {
    const k1 = pair.space1.modelId + ':' + pair.space1.expressId
    const k2 = pair.space2.modelId + ':' + pair.space2.expressId
    if (k1 === key) neighbors.push(nameMap[k2] || '?')
    if (k2 === key) neighbors.push(nameMap[k1] || '?')
  }
  const neighborStr = neighbors.slice(0, 4).join(', ') + (neighbors.length > 4 ? ', ...' : '')
  console.log(name + '| ' + degStr + ' | ' + neighborStr)
}

// ── 6. Shared boundary breakdown ──────────────────────────────────────
const boundaryTypes: Record<string, number> = {}
for (const pair of adjacency) {
  for (const t of pair.sharedTypes) {
    boundaryTypes[t] = (boundaryTypes[t] || 0) + 1
  }
}

if (Object.keys(boundaryTypes).length > 0) {
  console.log('')
  console.log('── Shared Boundary Types ──')
  for (const [type, count] of Object.entries(boundaryTypes).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.min(Math.round(count / adjacency.length * 30), 30))
    console.log('  ' + type + ': ' + count + ' ' + bar)
  }
}

// ── 7. Connected components ───────────────────────────────────────────
const components = bim.topology.connectedComponents()

console.log('')
console.log('── Connected Components ──')
console.log('Found ' + components.length + ' component(s)')
for (let i = 0; i < Math.min(components.length, 5); i++) {
  const comp = components[i]
  const names = comp.slice(0, 5).map(ref => {
    const n = graph.nodes.find(n =>
      n.ref.modelId === ref.modelId && n.ref.expressId === ref.expressId
    )
    return n?.name || '?'
  })
  console.log('  Component ' + (i + 1) + ': ' + comp.length + ' spaces — ' + names.join(', ') + (comp.length > 5 ? ', ...' : ''))
}

if (components.length > 1) {
  console.warn('')
  console.warn('Multiple connected components detected! Some spaces are')
  console.warn('topologically disconnected from each other.')
}

// ── 8. Statistics ─────────────────────────────────────────────────────
const avgDeg = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0
const density = graph.nodes.length > 1
  ? (2 * graph.edges.length) / (graph.nodes.length * (graph.nodes.length - 1))
  : 0

console.log('')
console.log('── Graph Statistics ──')
console.log('  Average degree:  ' + avgDeg.toFixed(2) + ' connections per space')
console.log('  Graph density:   ' + (density * 100).toFixed(1) + '%')
console.log('  Max degree:      ' + maxDeg)
console.log('  Components:      ' + components.length)
