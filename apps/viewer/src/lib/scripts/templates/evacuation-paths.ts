export {} // module boundary (stripped by transpiler)

// ── Evacuation Path Visualization ─────────────────────────────────────
// Stakeholder: Fire Safety Engineer / Building Inspector
//
// For every room, computes the evacuation path through doors and
// corridors to the nearest exit, calculates real path lengths from
// centroid-to-centroid distances, and draws colored 3D lines.
// Lines are colored by total path length: red = longest (most
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

// ── 3. Euclidean distance helper ─────────────────────────────────────
function dist3d(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ── 4. Find door entities ────────────────────────────────────────────
const doorEntityRefs: EntityRef[] = []
const seenDoors = new Set<string>()

for (const pair of adjacency) {
  for (let i = 0; i < pair.sharedTypes.length; i++) {
    const t = pair.sharedTypes[i].toLowerCase()
    if (t.includes('door') || t.includes('opening')) {
      const dk = pair.sharedRefs[i].modelId + ':' + pair.sharedRefs[i].expressId
      if (!seenDoors.has(dk)) {
        seenDoors.add(dk)
        doorEntityRefs.push(pair.sharedRefs[i])
      }
    }
  }
}

console.log('Doors found: ' + doorEntityRefs.length)

// ── 5. Identify exits ────────────────────────────────────────────────
const degreeMap: Record<string, number> = {}
for (const pair of adjacency) {
  const k1 = pair.space1.modelId + ':' + pair.space1.expressId
  const k2 = pair.space2.modelId + ':' + pair.space2.expressId
  degreeMap[k1] = (degreeMap[k1] || 0) + 1
  degreeMap[k2] = (degreeMap[k2] || 0) + 1
}

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

// ── 6. Detect length unit from model ─────────────────────────────────
// IFC geometry is in model units. Most IFC files use meters, but some
// use millimeters. We check typical space dimensions to decide.
let unitLabel = 'm'
let unitScale = 1.0

// Sample a few spaces to detect if coordinates are in mm
const sampleCentroids = Object.values(centroidMap).slice(0, 5)
if (sampleCentroids.length >= 2) {
  const sampleDist = dist3d(sampleCentroids[0], sampleCentroids[1])
  if (sampleDist > 100) {
    // Likely millimeters — typical room-to-room distance > 100mm = unreasonable in meters
    unitLabel = 'mm'
    unitScale = 0.001 // convert to meters for display
  }
}

// Typical stair slope: ~33° → walking distance ≈ 1.83× rise
const STAIR_WALK_FACTOR = 1.83
// Floor height threshold to detect inter-floor transitions
const FLOOR_Z_THRESHOLD = 1.5

// ── 7. Compute evacuation paths with stair-aware distances ───────────
interface EvacPath {
  spaceKey: string
  exitKey: string
  path: EntityRef[]
  hops: number
  totalLength: number // walking distance (stair-adjusted)
  segments: Array<{
    from: [number, number, number]
    to: [number, number, number]
    length: number
  }>
}

const evacPaths: EvacPath[] = []
let maxLength = 0
let minLength = Infinity

for (const m of metrics) {
  const spaceKey = m.ref.modelId + ':' + m.ref.expressId
  if (exitSpaceKeys.includes(spaceKey)) continue

  let bestPath: EvacPath | null = null

  for (const exitKey of exitSpaceKeys) {
    const exitRef = {
      modelId: exitKey.split(':')[0],
      expressId: Number(exitKey.split(':')[1]),
    }
    const result = bim.topology.shortestPath(m.ref, exitRef)
    if (!result) continue

    // Compute path length — inter-floor segments use stair walking distance
    const segments: EvacPath['segments'] = []
    let totalLength = 0

    for (let i = 0; i < result.path.length - 1; i++) {
      const fromKey = result.path[i].modelId + ':' + result.path[i].expressId
      const toKey = result.path[i + 1].modelId + ':' + result.path[i + 1].expressId
      const fromC = centroidMap[fromKey]
      const toC = centroidMap[toKey]
      if (fromC && toC) {
        const dz = Math.abs(toC[2] - fromC[2])

        if (dz > FLOOR_Z_THRESHOLD) {
          // Inter-floor transition via stairwell
          // Draw direct line (topology now routes through stairwell spaces
          // which are at the stair XY position), but use realistic stair
          // walking distance instead of straight-line euclidean
          const euclidean = dist3d(fromC, toC)
          const stairWalkDist = dz * STAIR_WALK_FACTOR
          // Use the greater of euclidean and stair walk distance
          const segLen = Math.max(euclidean, stairWalkDist)
          segments.push({ from: fromC, to: toC, length: segLen })
          totalLength += segLen
        } else {
          // Same floor — direct centroid-to-centroid line
          const segLen = dist3d(fromC, toC)
          segments.push({ from: fromC, to: toC, length: segLen })
          totalLength += segLen
        }
      }
    }

    if (!bestPath || totalLength < bestPath.totalLength) {
      bestPath = {
        spaceKey,
        exitKey,
        path: result.path,
        hops: result.hops,
        totalLength,
        segments,
      }
    }
  }

  if (bestPath && bestPath.segments.length > 0) {
    evacPaths.push(bestPath)
    if (bestPath.totalLength > maxLength) maxLength = bestPath.totalLength
    if (bestPath.totalLength < minLength) minLength = bestPath.totalLength
  }
}

// Convert for display
const displayMin = unitLabel === 'mm' ? (minLength * unitScale).toFixed(2) : minLength.toFixed(2)
const displayMax = unitLabel === 'mm' ? (maxLength * unitScale).toFixed(2) : maxLength.toFixed(2)
const displayUnit = unitLabel === 'mm' ? 'm' : unitLabel

console.log('')
console.log('Evacuation paths: ' + evacPaths.length)
console.log('Shortest path:    ' + displayMin + ' ' + displayUnit)
console.log('Longest path:     ' + displayMax + ' ' + displayUnit)

// ── 9. Build colored 3D lines ────────────────────────────────────────
interface Line3D {
  start: [number, number, number]
  end: [number, number, number]
  color: string
}

function lengthToColor(length: number): string {
  // Gradient from green (short/safe) → yellow → red (long/dangerous)
  const range = Math.max(maxLength - minLength, 0.001)
  const t = (length - minLength) / range // 0 = shortest, 1 = longest

  // Green (120°) → Yellow (60°) → Red (0°) in HSL
  const hue = Math.round(120 * (1 - t))
  const saturation = 90
  const lightness = 50

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

for (const evac of evacPaths) {
  const color = lengthToColor(evac.totalLength)

  for (const seg of evac.segments) {
    allLines.push({
      start: seg.from,
      end: seg.to,
      color,
    })
  }
}

// ── 10. Visualization setup ──────────────────────────────────────────
// Hide all building elements except doors, stairs, and spaces so paths
// are clearly visible. Spaces are colored by evacuation distance below.
const doors = bim.query.byType('IfcDoor')
const stairs = bim.query.byType('IfcStairFlight')
const stairStructures = bim.query.byType('IfcStair')
const keepVisible: BimEntity[] = [...spaces, ...doors, ...stairs, ...stairStructures]

// Deduplicate by ref key
const visibleKeys = new Set<string>()
const dedupedVisible: BimEntity[] = []
for (const e of keepVisible) {
  const key = e.ref.modelId + ':' + e.ref.expressId
  if (!visibleKeys.has(key)) {
    visibleKeys.add(key)
    dedupedVisible.push(e)
  }
}

if (dedupedVisible.length > 0) {
  bim.viewer.isolate(dedupedVisible)
}

// Color spaces by evacuation distance bucket
const distBySpace: Record<string, number> = {}
for (const p of evacPaths) {
  distBySpace[p.spaceKey] = p.totalLength
}

const bucketCount = 8
const bucketSize = (maxLength - minLength) / bucketCount
const colorBatches: Array<{ entities: BimEntity[]; color: string }> = []

for (let b = 0; b < bucketCount; b++) {
  const lo = minLength + b * bucketSize
  const hi = lo + bucketSize
  const entities: BimEntity[] = []
  for (const [key, dist] of Object.entries(distBySpace)) {
    if (dist >= lo && (b === bucketCount - 1 ? dist <= hi : dist < hi)) {
      const entity = entityMap[key]
      if (entity) entities.push(entity)
    }
  }
  if (entities.length > 0) {
    const midDist = lo + bucketSize / 2
    colorBatches.push({ entities, color: lengthToColor(midDist) })
  }
}

// Color exit spaces blue
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

// Draw all path lines (rendered as overlay on top of geometry)
if (allLines.length > 0) {
  bim.viewer.drawLines(allLines)
  console.log('Drew ' + allLines.length + ' line segments')
}

bim.viewer.flyTo(spaces)

// ── 11. Report ───────────────────────────────────────────────────────
console.log('')
console.log('── Visualization Legend ──')
console.log('  All elements hidden except doors, stairs & spaces.')
console.log('  3D path lines overlaid (always visible):')
console.log('    Green  = short path to exit (safe)')
console.log('    Yellow = moderate distance')
console.log('    Red    = long path to exit (dangerous)')
console.log('  Spaces colored by evacuation distance.')
console.log('    Blue   = exit / egress point')
console.log('')

// ── 12. Evacuation distance schedule ─────────────────────────────────
console.log('── Evacuation Distance Schedule ──')
console.log('Space                   | Distance   | Hops | Exit via')
console.log('------------------------+------------+------+------------------')

const sorted = [...evacPaths].sort((a, b) => b.totalLength - a.totalLength)
for (const p of sorted.slice(0, 30)) {
  const spaceName = metrics.find(m =>
    m.ref.modelId + ':' + m.ref.expressId === p.spaceKey
  )?.name || '?'
  const exitName = metrics.find(m =>
    m.ref.modelId + ':' + m.ref.expressId === p.exitKey
  )?.name || '?'

  const displayLen = unitLabel === 'mm'
    ? (p.totalLength * unitScale).toFixed(2) + ' m'
    : p.totalLength.toFixed(2) + ' ' + unitLabel
  const nameCol = (spaceName + '                        ').slice(0, 24)
  const distCol = (displayLen + '            ').slice(0, 12)
  const hopsCol = (p.hops + '    ').slice(0, 4)
  const exitCol = exitName.slice(0, 18)
  console.log(nameCol + '| ' + distCol + '| ' + hopsCol + ' | ' + exitCol)
}

if (sorted.length > 30) {
  console.log('... and ' + (sorted.length - 30) + ' more spaces')
}

// ── 13. Summary statistics ───────────────────────────────────────────
const totalPathLength = evacPaths.reduce((sum, p) => sum + p.totalLength, 0)
const avgLength = totalPathLength / Math.max(evacPaths.length, 1)
const displayAvg = unitLabel === 'mm' ? (avgLength * unitScale).toFixed(2) : avgLength.toFixed(2)

console.log('')
console.log('── Summary ──')
console.log('  Total paths:     ' + evacPaths.length)
console.log('  Shortest path:   ' + displayMin + ' ' + displayUnit)
console.log('  Longest path:    ' + displayMax + ' ' + displayUnit)
console.log('  Average path:    ' + displayAvg + ' ' + displayUnit)
console.log('  Total exits:     ' + exitSpaceKeys.length)
console.log('  Doors traversed: ' + doorEntityRefs.length)

// ── 14. Highlight critical paths ─────────────────────────────────────
// Find and select the spaces with longest evacuation distance
const dangerThreshold = minLength + (maxLength - minLength) * 0.8 // top 20%
const dangerousPaths = sorted.filter(p => p.totalLength >= dangerThreshold)
if (dangerousPaths.length > 0) {
  // Show the dangerous spaces and color them red
  const dangerEntities: BimEntity[] = []
  for (const p of dangerousPaths) {
    const entity = entityMap[p.spaceKey]
    if (entity) dangerEntities.push(entity)
  }
  if (dangerEntities.length > 0) {
    bim.viewer.colorize(dangerEntities, '#e74c3c')
    bim.viewer.select(dangerEntities)

    const worstLen = unitLabel === 'mm'
      ? (dangerousPaths[0].totalLength * unitScale).toFixed(1)
      : dangerousPaths[0].totalLength.toFixed(1)
    console.log('')
    console.warn(dangerEntities.length + ' space(s) exceed 80% of max evacuation distance')
    console.warn('Worst: ' + worstLen + ' ' + displayUnit + ' — review for fire safety compliance.')
  }
}
