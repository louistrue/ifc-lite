export {} // module boundary (stripped by transpiler)

// ── Building Envelope & Energy Topology ────────────────────────────────
// Stakeholder: Energy Consultant / Sustainability Engineer
//
// Combines topology graph analysis with space metrics and boundary
// classification to produce a comprehensive building energy profile.
// Identifies external envelope elements, computes surface-to-volume
// ratios, analyzes the thermal boundary between interior and exterior,
// and produces an ASCII visualization of the building's topology.
// ────────────────────────────────────────────────────────────────────────

bim.viewer.resetColors()
bim.viewer.resetVisibility()

// ── 1. Force IfcSpace visibility & get spaces ───────────────────────
bim.viewer.showSpaces()
const spaces = bim.query.byType('IfcSpace')

if (spaces.length === 0) {
  console.warn('No IfcSpace entities found in this model.')
  console.log('')
  console.log('This script requires IfcSpace entities to analyze')
  console.log('building envelope and energy topology.')
  throw new Error('no spaces')
}

// Isolate spaces so they're visible
bim.viewer.isolate(spaces)

// ── 2. Gather topology data ─────────────────────────────────────────
const graph = bim.topology.buildGraph()
const metrics = bim.topology.metrics()
const adjacency = bim.topology.adjacency()
const envelope = bim.topology.envelope()
const components = bim.topology.connectedComponents()

console.log('═══════════════════════════════════════')
console.log('  BUILDING ENVELOPE & ENERGY TOPOLOGY')
console.log('═══════════════════════════════════════')

// ── 3. Space metrics summary ──────────────────────────────────────
let totalArea = 0
let totalVolume = 0
let spacesWithArea = 0
let spacesWithVolume = 0

for (const m of metrics) {
  if (m.area !== null) { totalArea += m.area; spacesWithArea++ }
  if (m.volume !== null) { totalVolume += m.volume; spacesWithVolume++ }
}

console.log('')
console.log('── Space Metrics ──')
console.log('  Total spaces:    ' + metrics.length)
console.log('  Total area:      ' + totalArea.toFixed(1) + ' m2 (' + spacesWithArea + ' spaces with data)')
console.log('  Total volume:    ' + totalVolume.toFixed(1) + ' m3 (' + spacesWithVolume + ' spaces with data)')
if (totalArea > 0 && totalVolume > 0) {
  console.log('  Avg ceiling ht:  ' + (totalVolume / totalArea).toFixed(2) + ' m')
}

// ── 4. Build entity lookup ────────────────────────────────────────
const entityMap: Record<string, BimEntity> = {}
for (const s of spaces) {
  entityMap[s.ref.modelId + ':' + s.ref.expressId] = s
}

// ── 5. Classify adjacency ─────────────────────────────────────────
const connectedSpaceKeys = new Set<string>()
for (const pair of adjacency) {
  connectedSpaceKeys.add(pair.space1.modelId + ':' + pair.space1.expressId)
  connectedSpaceKeys.add(pair.space2.modelId + ':' + pair.space2.expressId)
}

const boundaryTypes: Record<string, number> = {}
for (const pair of adjacency) {
  for (const t of pair.sharedTypes) {
    boundaryTypes[t] = (boundaryTypes[t] || 0) + 1
  }
}

console.log('')
console.log('── Boundary Classification ──')
console.log('  Adjacent pairs:     ' + adjacency.length)
console.log('  Connected spaces:   ' + connectedSpaceKeys.size + ' / ' + spaces.length)
console.log('  Envelope elements:  ' + envelope.length)

if (Object.keys(boundaryTypes).length > 0) {
  console.log('')
  console.log('  Boundary types:')
  for (const [type, count] of Object.entries(boundaryTypes).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + type + ': ' + count)
  }
}

// ── 6. Color-code spaces + show boundary elements ──────────────────
const medianArea = spacesWithArea > 0 ? totalArea / spacesWithArea : 0
const largeSpaces: BimEntity[] = []
const smallSpaces: BimEntity[] = []
const isolatedSpaces: BimEntity[] = []

for (const m of metrics) {
  const key = m.ref.modelId + ':' + m.ref.expressId
  const entity = entityMap[key]
  if (!entity) continue

  if (!connectedSpaceKeys.has(key) && adjacency.length > 0) {
    isolatedSpaces.push(entity)
  } else if (m.area !== null && m.area >= medianArea) {
    largeSpaces.push(entity)
  } else {
    smallSpaces.push(entity)
  }
}

const vizBatches: Array<{ entities: BimEntity[]; color: string }> = []

// Color spaces by connectivity/size
if (adjacency.length > 0) {
  if (largeSpaces.length > 0) vizBatches.push({ entities: largeSpaces, color: '#2ecc71' })
  if (smallSpaces.length > 0) vizBatches.push({ entities: smallSpaces, color: '#f1c40f' })
  if (isolatedSpaces.length > 0) vizBatches.push({ entities: isolatedSpaces, color: '#9b59b6' })
} else {
  // No adjacency — color by area instead
  const sortedByArea = [...metrics].sort((a, b) => (b.area ?? 0) - (a.area ?? 0))
  const top25pct = Math.ceil(sortedByArea.length * 0.25)
  const bottom25pct = Math.ceil(sortedByArea.length * 0.75)

  const largeBucket: BimEntity[] = []
  const medBucket: BimEntity[] = []
  const smallBucket: BimEntity[] = []

  for (let i = 0; i < sortedByArea.length; i++) {
    const key = sortedByArea[i].ref.modelId + ':' + sortedByArea[i].ref.expressId
    const entity = entityMap[key]
    if (!entity) continue

    if (i < top25pct) largeBucket.push(entity)
    else if (i < bottom25pct) medBucket.push(entity)
    else smallBucket.push(entity)
  }

  if (largeBucket.length > 0) vizBatches.push({ entities: largeBucket, color: '#2ecc71' })
  if (medBucket.length > 0) vizBatches.push({ entities: medBucket, color: '#3498db' })
  if (smallBucket.length > 0) vizBatches.push({ entities: smallBucket, color: '#f1c40f' })
}

// Show and color shared boundary elements
const sharedBoundaryEntities: BimEntity[] = []
const seenShared = new Set<string>()
for (const pair of adjacency) {
  for (const ref of pair.sharedRefs) {
    const key = ref.modelId + ':' + ref.expressId
    if (seenShared.has(key)) continue
    seenShared.add(key)
    const entity = bim.query.entity(ref.modelId, ref.expressId)
    if (entity) sharedBoundaryEntities.push(entity)
  }
}

if (sharedBoundaryEntities.length > 0) {
  vizBatches.push({ entities: sharedBoundaryEntities, color: '#95a5a6' })
  bim.viewer.show(sharedBoundaryEntities)
}

// Show and color envelope elements (external boundary)
const envelopeEntities: BimEntity[] = []
for (const ref of envelope.slice(0, 200)) {
  const entity = bim.query.entity(ref.modelId, ref.expressId)
  if (entity) envelopeEntities.push(entity)
}

if (envelopeEntities.length > 0) {
  vizBatches.push({ entities: envelopeEntities, color: '#e74c3c' })
  bim.viewer.show(envelopeEntities)
}

if (vizBatches.length > 0) bim.viewer.colorizeAll(vizBatches)
bim.viewer.flyTo(spaces)

console.log('')
console.log('── Visualization ──')
if (adjacency.length > 0) {
  console.log('  Large spaces (>= ' + medianArea.toFixed(0) + ' m2): ' + largeSpaces.length + '  ● green')
  console.log('  Small spaces:                ' + smallSpaces.length + '  ● yellow')
  console.log('  Isolated:                    ' + isolatedSpaces.length + '  ● purple')
} else {
  console.log('  Spaces colored by area (large=green, medium=blue, small=yellow)')
}
if (sharedBoundaryEntities.length > 0) {
  console.log('  Shared boundaries:           ' + sharedBoundaryEntities.length + '  ● grey')
}
if (envelopeEntities.length > 0) {
  console.log('  Envelope elements:           ' + envelopeEntities.length + '  ● red')
}

// ── 7. ASCII topology diagram ─────────────────────────────────────
console.log('')
console.log('── Topology Diagram ──')
console.log('')

const displayNodes = graph.nodes.slice(0, 15)
const adjSet = new Set<string>()
for (const pair of adjacency) {
  const k1 = pair.space1.modelId + ':' + pair.space1.expressId
  const k2 = pair.space2.modelId + ':' + pair.space2.expressId
  adjSet.add(k1 + '|' + k2)
  adjSet.add(k2 + '|' + k1)
}

if (adjacency.length > 0 && displayNodes.length <= 15) {
  // Matrix view
  const nodeNames = displayNodes.map(n => (n.name || '?').slice(0, 8))
  const header = '           ' + nodeNames.map((_, i) => ((i + 1) + '  ').slice(0, 3)).join('')
  console.log(header)

  for (let i = 0; i < displayNodes.length; i++) {
    const label = ((i + 1) + '.' + nodeNames[i] + '           ').slice(0, 11)
    let row = ''
    for (let j = 0; j < displayNodes.length; j++) {
      if (i === j) { row += ' . '; continue }
      const ki = displayNodes[i].ref.modelId + ':' + displayNodes[i].ref.expressId
      const kj = displayNodes[j].ref.modelId + ':' + displayNodes[j].ref.expressId
      row += adjSet.has(ki + '|' + kj) ? ' X ' : ' . '
    }
    console.log(label + row)
  }
  console.log('')
  console.log('  X = adjacent   . = not adjacent')
} else {
  // List view
  for (const node of displayNodes.slice(0, 20)) {
    const key = node.ref.modelId + ':' + node.ref.expressId
    const neighbors: string[] = []
    for (const pair of adjacency) {
      const k1 = pair.space1.modelId + ':' + pair.space1.expressId
      const k2 = pair.space2.modelId + ':' + pair.space2.expressId
      if (k1 === key) neighbors.push(graph.nodes.find(n => n.ref.modelId === pair.space2.modelId && n.ref.expressId === pair.space2.expressId)?.name?.slice(0, 10) || '?')
      if (k2 === key) neighbors.push(graph.nodes.find(n => n.ref.modelId === pair.space1.modelId && n.ref.expressId === pair.space1.expressId)?.name?.slice(0, 10) || '?')
    }
    const name = ((node.name || '?') + '                ').slice(0, 16)
    console.log('  ' + name + (neighbors.length > 0 ? '-- ' + neighbors.join(', ') : '(isolated)'))
  }
}

// ── 8. Energy metrics ─────────────────────────────────────────────
console.log('')
console.log('── Energy-Relevant Metrics ──')
console.log('  Surface-to-volume ratio:  ' + (totalVolume > 0 ? (totalArea / totalVolume).toFixed(3) + ' m2/m3' : 'N/A'))
console.log('  Compactness:              ' + (components.length === 1 ? 'Fully connected' : components.length + ' zones'))
console.log('  Connectivity:             ' + adjacency.length + ' shared boundaries')

// Check thermal properties
let withThermal = 0
let withoutThermal = 0
const envelopeSample = envelope.slice(0, 50)
for (const ref of envelopeSample) {
  const entity = bim.query.entity(ref.modelId, ref.expressId)
  if (!entity) continue
  const psets = bim.query.properties(entity)
  let hasThermal = false
  for (const pset of psets) {
    for (const p of pset.properties) {
      const lower = p.name.toLowerCase()
      if (lower.includes('thermal') || lower.includes('transmittance') || lower.includes('uvalue')) {
        hasThermal = true
        break
      }
    }
    if (hasThermal) break
  }
  if (hasThermal) withThermal++
  else withoutThermal++
}

if (envelopeSample.length > 0) {
  console.log('')
  console.log('── Thermal Data (sampled ' + envelopeSample.length + '/' + envelope.length + ' envelope elements) ──')
  console.log('  With thermal data:    ' + withThermal)
  console.log('  Without thermal data: ' + withoutThermal)
  if (withoutThermal > 0) {
    console.warn('  ' + (withoutThermal / envelopeSample.length * 100).toFixed(0) + '% missing thermal transmittance')
  }
}

// ── 9. Space schedule ─────────────────────────────────────────────
// Count adjacency per space
const adjCount: Record<string, number> = {}
for (const pair of adjacency) {
  const k1 = pair.space1.modelId + ':' + pair.space1.expressId
  const k2 = pair.space2.modelId + ':' + pair.space2.expressId
  adjCount[k1] = (adjCount[k1] || 0) + 1
  adjCount[k2] = (adjCount[k2] || 0) + 1
}

// Zone = connected component index
const zoneMap: Record<string, number> = {}
for (let i = 0; i < components.length; i++) {
  for (const ref of components[i]) {
    zoneMap[ref.modelId + ':' + ref.expressId] = i + 1
  }
}

console.log('')
console.log('── Space Schedule ──')
console.log('Name                | Area m2  | Vol m3   | Adj | Zone')
console.log('--------------------+----------+----------+-----+------')

const sortedMetrics = [...metrics].sort((a, b) => (b.area ?? 0) - (a.area ?? 0))
for (const m of sortedMetrics.slice(0, 25)) {
  const key = m.ref.modelId + ':' + m.ref.expressId
  const name = ((m.name || '<unnamed>') + '                    ').slice(0, 20)
  const area = m.area !== null ? (m.area.toFixed(1) + '        ').slice(0, 8) : '-       '
  const vol = m.volume !== null ? (m.volume.toFixed(1) + '        ').slice(0, 8) : '-       '
  const adj = ((adjCount[key] || 0) + '   ').slice(0, 3)
  const zone = ((zoneMap[key] || 0) + '    ').slice(0, 4)
  console.log(name + '| ' + area + ' | ' + vol + ' | ' + adj + ' | ' + zone)
}

if (metrics.length > 25) {
  console.log('... and ' + (metrics.length - 25) + ' more spaces')
}

// ── 10. Select envelope elements for visual highlight ─────────────
if (envelopeEntities.length > 0) {
  bim.viewer.select(envelopeEntities.slice(0, 50))
  console.log('')
  console.log('Selected ' + Math.min(envelopeEntities.length, 50) + ' envelope elements (highlighted with blue glow)')
}
