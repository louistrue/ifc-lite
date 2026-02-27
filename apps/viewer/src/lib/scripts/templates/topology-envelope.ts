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

// ── 1. Gather topology data ───────────────────────────────────────────
const graph = bim.topology.buildGraph()
const metrics = bim.topology.metrics()
const adjacency = bim.topology.adjacency()
const envelope = bim.topology.envelope()
const components = bim.topology.connectedComponents()

if (graph.nodes.length === 0) {
  console.warn('No IfcSpace entities found in this model.')
  console.log('')
  console.log('This script requires IfcSpace entities to analyze')
  console.log('building envelope and energy topology.')
  throw new Error('no spaces')
}

console.log('═══════════════════════════════════════')
console.log('  BUILDING ENVELOPE & ENERGY TOPOLOGY')
console.log('═══════════════════════════════════════')

// ── 2. Space metrics summary ──────────────────────────────────────────
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
console.log('  Total area:      ' + totalArea.toFixed(1) + ' m² (' + spacesWithArea + ' spaces with data)')
console.log('  Total volume:    ' + totalVolume.toFixed(1) + ' m³ (' + spacesWithVolume + ' spaces with data)')
if (totalArea > 0 && totalVolume > 0) {
  console.log('  Avg ceiling ht:  ' + (totalVolume / totalArea).toFixed(2) + ' m')
}

// ── 3. Classify boundary elements ─────────────────────────────────────
// Internal = shared between 2+ spaces (walls between rooms)
// External = bounds only 1 space (exterior envelope)

// Count how many spaces each boundary element serves
const elementSpaceCount: Record<string, number> = {}
const elementTypes: Record<string, string> = {}

for (const pair of adjacency) {
  for (let i = 0; i < pair.sharedRefs.length; i++) {
    const ref = pair.sharedRefs[i]
    const key = ref.modelId + ':' + ref.expressId
    elementSpaceCount[key] = (elementSpaceCount[key] || 0) + 2 // shared by 2 spaces
    elementTypes[key] = pair.sharedTypes[i] || 'Unknown'
  }
}

// Envelope elements bound only 1 space
const envelopeByType: Record<string, number> = {}
for (const ref of envelope) {
  const entity = bim.query.entity(ref.modelId, ref.expressId)
  const type = entity?.Type || 'Unknown'
  envelopeByType[type] = (envelopeByType[type] || 0) + 1
}

const internalByType: Record<string, number> = {}
for (const [key, type] of Object.entries(elementTypes)) {
  internalByType[type] = (internalByType[type] || 0) + 1
}

console.log('')
console.log('── Boundary Classification ──')
console.log('  Internal (shared):  ' + Object.values(elementSpaceCount).length + ' elements')
console.log('  External (envelope): ' + envelope.length + ' elements')

if (Object.keys(envelopeByType).length > 0) {
  console.log('')
  console.log('  Envelope breakdown:')
  for (const [type, count] of Object.entries(envelopeByType).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + type + ': ' + count)
  }
}

if (Object.keys(internalByType).length > 0) {
  console.log('')
  console.log('  Internal breakdown:')
  for (const [type, count] of Object.entries(internalByType).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + type + ': ' + count)
  }
}

// ── 4. Color-code: envelope vs internal vs spaces ─────────────────────
const colorEnvelope = '#e74c3c'   // red — exterior envelope
const colorInternal = '#3498db'   // blue — internal boundaries
const colorSpaceLarge = '#2ecc71' // green — large spaces
const colorSpaceSmall = '#f1c40f' // yellow — small spaces
const colorIsolated = '#9b59b6'   // purple — isolated spaces

// Colorize envelope elements
const envelopeEntities: BimEntity[] = []
for (const ref of envelope) {
  const e = bim.query.entity(ref.modelId, ref.expressId)
  if (e) envelopeEntities.push(e)
}

// Classify spaces by area
const medianArea = totalArea / Math.max(spacesWithArea, 1)
const largeSpaces: BimEntity[] = []
const smallSpaces: BimEntity[] = []
const isolatedSpaces: BimEntity[] = []

// Find which spaces have adjacency
const connectedSpaceKeys = new Set<string>()
for (const pair of adjacency) {
  connectedSpaceKeys.add(pair.space1.modelId + ':' + pair.space1.expressId)
  connectedSpaceKeys.add(pair.space2.modelId + ':' + pair.space2.expressId)
}

for (const m of metrics) {
  const entity = bim.query.entity(m.ref.modelId, m.ref.expressId)
  if (!entity) continue

  const key = m.ref.modelId + ':' + m.ref.expressId
  if (!connectedSpaceKeys.has(key)) {
    isolatedSpaces.push(entity)
  } else if (m.area !== null && m.area >= medianArea) {
    largeSpaces.push(entity)
  } else {
    smallSpaces.push(entity)
  }
}

const vizBatches: Array<{ entities: BimEntity[]; color: string }> = []
if (envelopeEntities.length > 0) vizBatches.push({ entities: envelopeEntities, color: colorEnvelope })
if (largeSpaces.length > 0) vizBatches.push({ entities: largeSpaces, color: colorSpaceLarge })
if (smallSpaces.length > 0) vizBatches.push({ entities: smallSpaces, color: colorSpaceSmall })
if (isolatedSpaces.length > 0) vizBatches.push({ entities: isolatedSpaces, color: colorIsolated })
if (vizBatches.length > 0) bim.viewer.colorizeAll(vizBatches)

console.log('')
console.log('── Visualization Legend ──')
console.log('  Envelope elements: ' + envelopeEntities.length + '  ● red')
console.log('  Large spaces:      ' + largeSpaces.length + '  ● green (≥ ' + medianArea.toFixed(0) + ' m²)')
console.log('  Small spaces:      ' + smallSpaces.length + '  ● yellow')
console.log('  Isolated spaces:   ' + isolatedSpaces.length + '  ● purple')

// ── 5. ASCII topology diagram ─────────────────────────────────────────
console.log('')
console.log('── Topology Diagram (Adjacency Graph) ──')
console.log('')

// Build ASCII adjacency visualization for up to 20 nodes
const displayNodes = graph.nodes.slice(0, 20)
const nodeNames = displayNodes.map(n => {
  const short = (n.name || '?').slice(0, 12)
  return short
})

// Create an adjacency indicator
const adjSet = new Set<string>()
for (const pair of adjacency) {
  const k1 = pair.space1.modelId + ':' + pair.space1.expressId
  const k2 = pair.space2.modelId + ':' + pair.space2.expressId
  adjSet.add(k1 + '|' + k2)
  adjSet.add(k2 + '|' + k1)
}

if (displayNodes.length <= 15) {
  // Compact matrix view
  const header = '              ' + nodeNames.map((_, i) => ((i + 1) + '  ').slice(0, 3)).join('')
  console.log(header)
  console.log('              ' + '---'.repeat(displayNodes.length))

  for (let i = 0; i < displayNodes.length; i++) {
    const label = ((i + 1) + '. ' + nodeNames[i] + '              ').slice(0, 14)
    let row = ''
    for (let j = 0; j < displayNodes.length; j++) {
      if (i === j) {
        row += ' · '
      } else {
        const ki = displayNodes[i].ref.modelId + ':' + displayNodes[i].ref.expressId
        const kj = displayNodes[j].ref.modelId + ':' + displayNodes[j].ref.expressId
        row += adjSet.has(ki + '|' + kj) ? ' ■ ' : ' · '
      }
    }
    console.log(label + row)
  }
  console.log('')
  console.log('  ■ = adjacent (shared boundary)   · = not adjacent')
} else {
  // List view for larger graphs
  for (const node of displayNodes) {
    const key = node.ref.modelId + ':' + node.ref.expressId
    const neighbors: string[] = []
    for (const pair of adjacency) {
      const k1 = pair.space1.modelId + ':' + pair.space1.expressId
      const k2 = pair.space2.modelId + ':' + pair.space2.expressId
      if (k1 === key) {
        const n = graph.nodes.find(n => n.ref.modelId === pair.space2.modelId && n.ref.expressId === pair.space2.expressId)
        neighbors.push((n?.name || '?').slice(0, 10))
      }
      if (k2 === key) {
        const n = graph.nodes.find(n => n.ref.modelId === pair.space1.modelId && n.ref.expressId === pair.space1.expressId)
        neighbors.push((n?.name || '?').slice(0, 10))
      }
    }
    const name = ((node.name || '?') + '                ').slice(0, 16)
    console.log('  ' + name + ' ── ' + (neighbors.length > 0 ? neighbors.join(', ') : '(isolated)'))
  }
}

// ── 6. Energy metrics ─────────────────────────────────────────────────
const envelopeRatio = envelope.length > 0 && Object.keys(elementSpaceCount).length > 0
  ? envelope.length / (envelope.length + Object.keys(elementSpaceCount).length)
  : 0

console.log('')
console.log('── Energy-Relevant Metrics ──')
console.log('  Surface-to-volume ratio:  ' + (totalVolume > 0 ? (totalArea / totalVolume).toFixed(3) + ' m²/m³' : 'N/A'))
console.log('  Envelope-to-internal:     ' + (envelopeRatio * 100).toFixed(1) + '% envelope')
console.log('  Compactness factor:       ' + (components.length === 1 ? 'Connected (good)' : components.length + ' disconnected zones'))

// Check for thermal properties on envelope
let withThermal = 0
let withoutThermal = 0
for (const ref of envelope.slice(0, 50)) {
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

if (envelope.length > 0) {
  const sampled = Math.min(envelope.length, 50)
  console.log('')
  console.log('── Thermal Data Coverage (sampled ' + sampled + '/' + envelope.length + ' envelope elements) ──')
  console.log('  With thermal properties:    ' + withThermal)
  console.log('  Without thermal properties: ' + withoutThermal)
  if (withoutThermal > 0) {
    const pct = (withoutThermal / sampled * 100).toFixed(0)
    console.warn('  ' + pct + '% of envelope elements missing thermal transmittance data')
  }
}

// ── 7. Space schedule with topology data ──────────────────────────────
console.log('')
console.log('── Space Schedule (with topology) ──')
console.log('Name                | Area m²  | Vol m³   | Adj | Zone')
console.log('--------------------+----------+----------+-----+------')

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

const sortedMetrics = [...metrics].sort((a, b) => (b.area ?? 0) - (a.area ?? 0))
for (const m of sortedMetrics.slice(0, 30)) {
  const key = m.ref.modelId + ':' + m.ref.expressId
  const name = ((m.name || '<unnamed>') + '                    ').slice(0, 20)
  const area = m.area !== null ? (m.area.toFixed(1) + '        ').slice(0, 8) : '-       '
  const vol = m.volume !== null ? (m.volume.toFixed(1) + '        ').slice(0, 8) : '-       '
  const adj = ((adjCount[key] || 0) + '   ').slice(0, 3)
  const zone = ((zoneMap[key] || 0) + '    ').slice(0, 4)
  console.log(name + '| ' + area + ' | ' + vol + ' | ' + adj + ' | ' + zone)
}

if (metrics.length > 30) {
  console.log('... and ' + (metrics.length - 30) + ' more spaces')
}
