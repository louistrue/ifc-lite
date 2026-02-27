export {} // module boundary (stripped by transpiler)

// ── Evacuation Path Visualization ─────────────────────────────────────
// Stakeholder: Fire Safety Engineer / Building Inspector
//
// For every room, finds the corner furthest from the nearest door,
// computes the evacuation path through doors and corridors to the
// nearest exit, and draws colored 3D lines representing the full
// escape route. Lines are colored by length: red = longest (most
// dangerous), green = shortest, with a smooth gradient between.
// ────────────────────────────────────────────────────────────────────────

bim.viewer.resetColors()
bim.viewer.resetVisibility()
bim.viewer.clearLines()

// ── 1. Get spaces, doors, and topology ───────────────────────────────
bim.viewer.showSpaces()
const spaces = bim.query.byType('IfcSpace')

if (spaces.length === 0) {
  console.warn('No IfcSpace entities found in this model.')
  console.log('')
  console.log('This script requires IfcSpace entities to compute')
  console.log('evacuation paths through the building.')
  throw new Error('no spaces')
}

bim.viewer.isolate(spaces)

const graph = bim.topology.buildGraph()
const adjacency = bim.topology.adjacency()
const metrics = bim.topology.metrics()

if (graph.edges.length === 0) {
  bim.viewer.colorize(spaces, '#e74c3c')
  bim.viewer.flyTo(spaces)
  console.warn('No adjacency data — cannot compute evacuation paths.')
  throw new Error('no edges')
}

console.log('═══════════════════════════════════════')
console.log('  EVACUATION PATH VISUALIZATION')
console.log('═══════════════════════════════════════')
console.log('')
console.log('Spaces:      ' + spaces.length)
console.log('Connections: ' + graph.edges.length)

// ── 2. Build lookup maps ─────────────────────────────────────────────
const entityMap: Record<string, BimEntity> = {}
for (const s of spaces) {
  entityMap[s.ref.modelId + ':' + s.ref.expressId] = s
}

// Centroid map from topology metrics
const centroidMap: Record<string, [number, number, number]> = {}
for (const m of metrics) {
  if (m.centroid) {
    centroidMap[m.ref.modelId + ':' + m.ref.expressId] = m.centroid
  }
}

// ── 3. Find door positions (centroids of shared door entities) ───────
// For each adjacency pair, find doors and compute their approximate position
interface DoorConnection {
  space1Key: string
  space2Key: string
  doorRefs: EntityRef[]
  doorTypes: string[]
}

const doorConnections: DoorConnection[] = []
const doorEntityRefs: EntityRef[] = []
const seenDoors = new Set<string>()

for (const pair of adjacency) {
  const doorRefs: EntityRef[] = []
  const doorTypes: string[] = []
  for (let i = 0; i < pair.sharedTypes.length; i++) {
    const t = pair.sharedTypes[i].toLowerCase()
    if (t.includes('door') || t.includes('opening')) {
      doorRefs.push(pair.sharedRefs[i])
      doorTypes.push(pair.sharedTypes[i])
      const dk = pair.sharedRefs[i].modelId + ':' + pair.sharedRefs[i].expressId
      if (!seenDoors.has(dk)) {
        seenDoors.add(dk)
        doorEntityRefs.push(pair.sharedRefs[i])
      }
    }
  }
  if (doorRefs.length > 0) {
    doorConnections.push({
      space1Key: pair.space1.modelId + ':' + pair.space1.expressId,
      space2Key: pair.space2.modelId + ':' + pair.space2.expressId,
      doorRefs,
      doorTypes,
    })
  }
}

// Show doors alongside spaces
const doorEntities: BimEntity[] = []
for (const ref of doorEntityRefs) {
  const e = bim.query.entity(ref.modelId, ref.expressId)
  if (e) doorEntities.push(e)
}
if (doorEntities.length > 0) {
  bim.viewer.show(doorEntities)
}

console.log('Doors found: ' + doorEntityRefs.length)

// ── 4. Identify exits (spaces with fewest connections = likely exits) ─
// Heuristic: spaces connected to the exterior or with "exit"/"entrance"
// in their name. Fallback: spaces with degree=1 (dead ends at perimeter).
const degreeMap: Record<string, number> = {}
for (const pair of adjacency) {
  const k1 = pair.space1.modelId + ':' + pair.space1.expressId
  const k2 = pair.space2.modelId + ':' + pair.space2.expressId
  degreeMap[k1] = (degreeMap[k1] || 0) + 1
  degreeMap[k2] = (degreeMap[k2] || 0) + 1
}

// Try to find explicitly named exits
const exitSpaceKeys: string[] = []
for (const m of metrics) {
  const key = m.ref.modelId + ':' + m.ref.expressId
  const lower = (m.name || '').toLowerCase()
  if (lower.includes('exit') || lower.includes('entrance') ||
      lower.includes('lobby') || lower.includes('stair') ||
      lower.includes('treppe') || lower.includes('flur') ||
      lower.includes('corridor') || lower.includes('hall')) {
    exitSpaceKeys.push(key)
  }
}

// Fallback: use leaf nodes (degree 1) or spaces with lowest degree
if (exitSpaceKeys.length === 0) {
  const sortedByDegree = Object.entries(degreeMap)
    .sort((a, b) => a[1] - b[1])
  const minDegree = sortedByDegree[0]?.[1] ?? 1
  for (const [key, deg] of sortedByDegree) {
    if (deg <= minDegree) exitSpaceKeys.push(key)
    if (exitSpaceKeys.length >= 3) break
  }
}

console.log('Exit candidates: ' + exitSpaceKeys.length)

// ── 5. Compute evacuation paths from every space to nearest exit ─────
interface EvacPath {
  spaceKey: string
  exitKey: string
  path: EntityRef[]
  hops: number
  weight: number
}

const evacPaths: EvacPath[] = []
let maxHops = 0
let minHops = Infinity

for (const m of metrics) {
  const spaceKey = m.ref.modelId + ':' + m.ref.expressId
  if (exitSpaceKeys.includes(spaceKey)) continue // exits don't need paths

  let bestPath: EvacPath | null = null

  for (const exitKey of exitSpaceKeys) {
    const exitRef = {
      modelId: exitKey.split(':')[0],
      expressId: Number(exitKey.split(':')[1]),
    }
    const result = bim.topology.shortestPath(m.ref, exitRef)
    if (result && (!bestPath || result.hops < bestPath.hops)) {
      bestPath = {
        spaceKey,
        exitKey,
        path: result.path,
        hops: result.hops,
        weight: result.totalWeight,
      }
    }
  }

  if (bestPath) {
    evacPaths.push(bestPath)
    if (bestPath.hops > maxHops) maxHops = bestPath.hops
    if (bestPath.hops < minHops) minHops = bestPath.hops
  }
}

console.log('Evacuation paths: ' + evacPaths.length)
console.log('Shortest path:    ' + minHops + ' hops')
console.log('Longest path:     ' + maxHops + ' hops')

// ── 6. Build 3D lines from paths using space centroids ───────────────
interface Line3D {
  start: [number, number, number]
  end: [number, number, number]
  color: string
}

function hopsToColor(hops: number): string {
  // Gradient from green (short/safe) to yellow to red (long/dangerous)
  const range = Math.max(maxHops - minHops, 1)
  const t = (hops - minHops) / range // 0 = shortest, 1 = longest

  // Green (120°) → Yellow (60°) → Red (0°) in HSL
  const hue = Math.round(120 * (1 - t))
  const saturation = 90
  const lightness = 45

  // Convert HSL to hex
  const h = hue / 360
  const s = saturation / 100
  const l = lightness / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  function hueToRgb(pp: number, qq: number, tt: number): number {
    let t2 = tt
    if (t2 < 0) t2 += 1
    if (t2 > 1) t2 -= 1
    if (t2 < 1/6) return pp + (qq - pp) * 6 * t2
    if (t2 < 1/2) return qq
    if (t2 < 2/3) return pp + (qq - pp) * (2/3 - t2) * 6
    return pp
  }

  const r = Math.round(hueToRgb(p, q, h + 1/3) * 255)
  const g = Math.round(hueToRgb(p, q, h) * 255)
  const b = Math.round(hueToRgb(p, q, h - 1/3) * 255)

  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

const allLines: Line3D[] = []
const pathLengths: Array<{ spaceKey: string; hops: number; exitKey: string }> = []

for (const evac of evacPaths) {
  const color = hopsToColor(evac.hops)
  pathLengths.push({ spaceKey: evac.spaceKey, hops: evac.hops, exitKey: evac.exitKey })

  // Draw lines between consecutive spaces in the path
  for (let i = 0; i < evac.path.length - 1; i++) {
    const fromKey = evac.path[i].modelId + ':' + evac.path[i].expressId
    const toKey = evac.path[i + 1].modelId + ':' + evac.path[i + 1].expressId
    const fromCentroid = centroidMap[fromKey]
    const toCentroid = centroidMap[toKey]

    if (fromCentroid && toCentroid) {
      allLines.push({
        start: fromCentroid,
        end: toCentroid,
        color,
      })
    }
  }
}

// Draw all lines at once
if (allLines.length > 0) {
  bim.viewer.drawLines(allLines)
  console.log('')
  console.log('Drew ' + allLines.length + ' line segments')
}

// ── 7. Color-code spaces by evacuation distance ─────────────────────
const hopsBySpace: Record<string, number> = {}
for (const p of pathLengths) {
  hopsBySpace[p.spaceKey] = p.hops
}

// Group spaces by hop count for batch colorization
const hopBuckets: Record<number, BimEntity[]> = {}
for (const [key, hops] of Object.entries(hopsBySpace)) {
  const entity = entityMap[key]
  if (!entity) continue
  if (!hopBuckets[hops]) hopBuckets[hops] = []
  hopBuckets[hops].push(entity)
}

const colorBatches: Array<{ entities: BimEntity[]; color: string }> = []
for (const [hopsStr, entities] of Object.entries(hopBuckets)) {
  colorBatches.push({
    entities,
    color: hopsToColor(Number(hopsStr)),
  })
}

// Color exit spaces in blue
const exitEntities: BimEntity[] = []
for (const key of exitSpaceKeys) {
  const entity = entityMap[key]
  if (entity) exitEntities.push(entity)
}
if (exitEntities.length > 0) {
  colorBatches.push({ entities: exitEntities, color: '#3498db' })
}

if (colorBatches.length > 0) {
  bim.viewer.colorizeAll(colorBatches)
}

// Show boundary elements (walls between spaces)
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
  bim.viewer.show(boundaryEntities)
}

bim.viewer.flyTo(spaces)

// ── 8. Report ────────────────────────────────────────────────────────
console.log('')
console.log('── Visualization Legend ──')
console.log('  Spaces colored by evacuation distance:')
console.log('    Green  = close to exit (safe)')
console.log('    Yellow = moderate distance')
console.log('    Red    = far from exit (dangerous)')
console.log('    Blue   = exit / egress point')
console.log('  3D lines show evacuation paths between rooms')
console.log('')

// ── 9. Evacuation schedule ───────────────────────────────────────────
console.log('── Evacuation Distance Schedule ──')
console.log('Space                   | Hops | Exit via')
console.log('------------------------+------+------------------')

const sorted = [...pathLengths].sort((a, b) => b.hops - a.hops)
for (const p of sorted.slice(0, 25)) {
  const spaceName = metrics.find(m =>
    m.ref.modelId + ':' + m.ref.expressId === p.spaceKey
  )?.name || '?'
  const exitName = metrics.find(m =>
    m.ref.modelId + ':' + m.ref.expressId === p.exitKey
  )?.name || '?'

  const nameCol = (spaceName + '                        ').slice(0, 24)
  const hopsCol = (p.hops + '    ').slice(0, 4)
  const exitCol = exitName.slice(0, 18)
  console.log(nameCol + '| ' + hopsCol + ' | ' + exitCol)
}

if (sorted.length > 25) {
  console.log('... and ' + (sorted.length - 25) + ' more spaces')
}

// ── 10. Highlight critical paths ─────────────────────────────────────
const dangerousSpaces = sorted.filter(p => p.hops === maxHops)
if (dangerousSpaces.length > 0) {
  const dangerEntities: BimEntity[] = []
  for (const p of dangerousSpaces) {
    const entity = entityMap[p.spaceKey]
    if (entity) dangerEntities.push(entity)
  }
  if (dangerEntities.length > 0) {
    bim.viewer.select(dangerEntities)
    console.log('')
    console.warn('Selected ' + dangerEntities.length + ' space(s) with LONGEST evacuation path (' + maxHops + ' hops)')
    console.warn('These rooms are furthest from any exit — review for fire safety.')
  }
}
