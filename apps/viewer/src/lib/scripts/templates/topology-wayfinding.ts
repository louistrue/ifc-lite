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
bim.viewer.clearLines()

// ── 1. Force IfcSpace visibility & get spaces ───────────────────────
bim.viewer.showSpaces()
const spaces = bim.query.byType('IfcSpace')

if (spaces.length === 0) {
  console.warn('No IfcSpace entities found in this model.')
  console.log('')
  console.log('This script requires IfcSpace entities to analyze spatial')
  console.log('connectivity and wayfinding paths.')
  throw new Error('no spaces')
}

// Isolate spaces so they're visible
bim.viewer.isolate(spaces)

// ── 2. Build graph & compute centrality ─────────────────────────────
const graph = bim.topology.buildGraph()

if (graph.edges.length === 0) {
  // Still show the spaces even without adjacency data
  bim.viewer.colorize(spaces, '#9b59b6')
  bim.viewer.flyTo(spaces)
  console.warn('No adjacency relationships found between spaces.')
  console.log('The model may not have IfcRelSpaceBoundary relationships')
  console.log('or space geometry for proximity detection.')
  console.log('')
  console.log('Showing ' + spaces.length + ' spaces (purple) without connectivity data.')
  throw new Error('no edges')
}

const centrality = bim.topology.centrality()
const adjacency = bim.topology.adjacency()

console.log('═══════════════════════════════════════')
console.log('  SPATIAL CONNECTIVITY & WAYFINDING')
console.log('═══════════════════════════════════════')
console.log('')
console.log('Spaces:      ' + graph.nodes.length)
console.log('Connections: ' + graph.edges.length)

// ── 3. Classify by betweenness centrality ─────────────────────────
const sortedByBetweenness = [...centrality].sort((a, b) => b.betweenness - a.betweenness)
const maxBetweenness = sortedByBetweenness[0]?.betweenness ?? 0

const critical: CentralityResult[] = []
const important: CentralityResult[] = []
const moderate: CentralityResult[] = []
const peripheral: CentralityResult[] = []
const terminal: CentralityResult[] = []

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

// ── 4. Color-code by centrality ─────────────────────────────────────
const colors = {
  critical: '#e74c3c',
  important: '#e67e22',
  moderate: '#f1c40f',
  peripheral: '#2ecc71',
  terminal: '#3498db',
}

// Build entity lookup
const entityMap: Record<string, BimEntity> = {}
for (const s of spaces) {
  entityMap[s.ref.modelId + ':' + s.ref.expressId] = s
}

function refsToEntities(results: CentralityResult[]): BimEntity[] {
  const entities: BimEntity[] = []
  for (const r of results) {
    const e = entityMap[r.ref.modelId + ':' + r.ref.expressId]
    if (e) entities.push(e)
  }
  return entities
}

const vizBatches: Array<{ entities: BimEntity[]; color: string }> = []
if (critical.length > 0) vizBatches.push({ entities: refsToEntities(critical), color: colors.critical })
if (important.length > 0) vizBatches.push({ entities: refsToEntities(important), color: colors.important })
if (moderate.length > 0) vizBatches.push({ entities: refsToEntities(moderate), color: colors.moderate })
if (peripheral.length > 0) vizBatches.push({ entities: refsToEntities(peripheral), color: colors.peripheral })
if (terminal.length > 0) vizBatches.push({ entities: refsToEntities(terminal), color: colors.terminal })

// Also show shared boundary elements (walls/slabs between spaces)
const boundaryEntities: BimEntity[] = []
const seenBoundary = new Set<string>()
for (const pair of adjacency) {
  for (const ref of pair.sharedRefs) {
    const key = ref.modelId + ':' + ref.expressId
    if (seenBoundary.has(key)) continue
    seenBoundary.add(key)
    const entity = bim.query.entity(ref.modelId, ref.expressId)
    if (entity) boundaryEntities.push(entity)
  }
}
if (boundaryEntities.length > 0) {
  vizBatches.push({ entities: boundaryEntities, color: '#bdc3c7' })
  bim.viewer.show(boundaryEntities)
}

if (vizBatches.length > 0) bim.viewer.colorizeAll(vizBatches)

// Fly to spaces
bim.viewer.flyTo(spaces)

// ── 5. Centrality legend ──────────────────────────────────────────
console.log('')
console.log('── Betweenness Centrality (Circulation Importance) ──')
console.log('  Critical corridors:   ' + critical.length + '  ● red')
console.log('  Important connectors: ' + important.length + '  ● orange')
console.log('  Moderate:             ' + moderate.length + '  ● yellow')
console.log('  Peripheral:           ' + peripheral.length + '  ● green')
console.log('  Terminal / dead ends: ' + terminal.length + '  ● blue')
if (boundaryEntities.length > 0) {
  console.log('  Shared boundaries:    ' + boundaryEntities.length + '  ● grey')
}

// ── 6. Top spaces by centrality ───────────────────────────────────
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

// ── 7. Closeness centrality ───────────────────────────────────────
const sortedByCloseness = [...centrality].sort((a, b) => b.closeness - a.closeness)

console.log('')
console.log('── Top 10 by Closeness (fastest access to all spaces) ──')
for (const c of sortedByCloseness.slice(0, 10)) {
  const name = ((c.name || '<unnamed>') + '                    ').slice(0, 20)
  console.log('  ' + name + '  closeness=' + c.closeness.toFixed(4))
}

// ── 8. Shortest path demo with visual highlight ───────────────────
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
      const prefix = i === 0 ? '  START -> ' : i === pathResult.path.length - 1 ? '  END   -> ' : '        -> '
      console.log(prefix + (node?.name || 'Space #' + ref.expressId))
    }

    // Highlight path entities with selection (blue fresnel glow)
    const pathEntities: BimEntity[] = []
    for (const ref of pathResult.path) {
      const e = entityMap[ref.modelId + ':' + ref.expressId]
      if (e) pathEntities.push(e)
    }

    // Also find walls along the path
    for (let i = 0; i < pathResult.path.length - 1; i++) {
      const k1 = pathResult.path[i].modelId + ':' + pathResult.path[i].expressId
      const k2 = pathResult.path[i + 1].modelId + ':' + pathResult.path[i + 1].expressId
      for (const pair of adjacency) {
        const pk1 = pair.space1.modelId + ':' + pair.space1.expressId
        const pk2 = pair.space2.modelId + ':' + pair.space2.expressId
        if ((pk1 === k1 && pk2 === k2) || (pk1 === k2 && pk2 === k1)) {
          for (const ref of pair.sharedRefs) {
            const wall = bim.query.entity(ref.modelId, ref.expressId)
            if (wall) pathEntities.push(wall)
          }
        }
      }
    }

    if (pathEntities.length > 0) {
      bim.viewer.select(pathEntities)
      console.log('')
      console.log('Selected ' + pathEntities.length + ' entities along path (highlighted with blue glow)')
    }
  } else {
    console.warn('No path found! Spaces are in disconnected components.')
  }
}

// ── 9. Diameter estimation ────────────────────────────────────────
const components = bim.topology.connectedComponents()
if (components.length > 0 && components[0].length >= 2) {
  const mainComponent = components[0]
  let maxHops = 0
  let maxPairFrom = ''
  let maxPairTo = ''

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
  console.log('  Farthest pair:     ' + maxPairFrom + ' <-> ' + maxPairTo)
  console.log('  Components:        ' + components.length)
  if (components.length > 1) {
    console.warn('  WARNING: ' + (components.length - 1) + ' disconnected group(s) detected')
  }
}

// ── 10. Bottleneck analysis ───────────────────────────────────────
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
