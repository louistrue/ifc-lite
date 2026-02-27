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

// Build waypoint lookup: for each pair of adjacent spaces, find the
// door or stair that connects them so we can route lines through it.
const waypointMap: Record<string, { centroid: [number, number, number]; type: string }> = {}
for (const pair of adjacency) {
  const k1 = pair.space1.modelId + ':' + pair.space1.expressId
  const k2 = pair.space2.modelId + ':' + pair.space2.expressId

  // Pick the best waypoint: prefer doors over stairs over anything else
  let bestWaypoint: { centroid: [number, number, number]; type: string } | null = null
  for (let i = 0; i < pair.sharedTypes.length; i++) {
    const t = pair.sharedTypes[i].toLowerCase()
    const c = pair.sharedCentroids[i]
    if (!c) continue

    if (t.includes('door') || t.includes('opening')) {
      bestWaypoint = { centroid: c, type: 'door' }
      break // doors are the ideal waypoint
    }
    if ((t.includes('stair') || t === 'vertical') && !bestWaypoint) {
      bestWaypoint = { centroid: c, type: 'stair' }
    }
  }

  if (bestWaypoint) {
    waypointMap[k1 + '|' + k2] = bestWaypoint
    waypointMap[k2 + '|' + k1] = bestWaypoint
  }
}

// ── 3. Euclidean distance helper ─────────────────────────────────────
function dist3d(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ── 4. Find door entities and external exit doors ───────────────────
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

// Find external doors from the building envelope.
// Envelope elements border only ONE space (exterior on the other side).
const envelopeRefs = bim.topology.envelope()
const exitDoors: Array<{ ref: EntityRef; centroid: [number, number, number] }> = []
for (const ref of envelopeRefs) {
  const entity = bim.query.entity(ref.modelId, ref.expressId)
  if (!entity) continue
  const t = entity.type.toLowerCase()
  if (t.includes('door') || t.includes('opening')) {
    const c = bim.topology.entityCentroid(ref)
    if (c) {
      exitDoors.push({ ref, centroid: c })
    }
  }
}

console.log('Doors found: ' + doorEntityRefs.length)
console.log('Exit doors:  ' + exitDoors.length)

// ── 5. Identify exits ────────────────────────────────────────────────
// Find exit spaces: spaces that contain or are adjacent to external doors.
// For each exit door, find the nearest space centroid.
const exitSpaceKeys: string[] = []
const exitSpaceKeySet = new Set<string>()

// Map each exit door to the nearest space — that space becomes an exit
const exitDoorBySpace: Record<string, { ref: EntityRef; centroid: [number, number, number] }> = {}
for (const ed of exitDoors) {
  let bestKey = ''
  let bestDist = Infinity
  for (const m of metrics) {
    if (!m.centroid) continue
    const key = m.ref.modelId + ':' + m.ref.expressId
    const d = dist3d(m.centroid, ed.centroid)
    if (d < bestDist) { bestDist = d; bestKey = key }
  }
  if (bestKey && !exitSpaceKeySet.has(bestKey)) {
    exitSpaceKeySet.add(bestKey)
    exitSpaceKeys.push(bestKey)
    exitDoorBySpace[bestKey] = ed
  }
}

// Fallback: if no external doors found, use name-based heuristic
if (exitSpaceKeys.length === 0) {
  const degreeMap: Record<string, number> = {}
  for (const pair of adjacency) {
    const k1 = pair.space1.modelId + ':' + pair.space1.expressId
    const k2 = pair.space2.modelId + ':' + pair.space2.expressId
    degreeMap[k1] = (degreeMap[k1] || 0) + 1
    degreeMap[k2] = (degreeMap[k2] || 0) + 1
  }

  for (const m of metrics) {
    const key = m.ref.modelId + ':' + m.ref.expressId
    const lower = (m.name || '').toLowerCase()
    if (lower.includes('exit') || lower.includes('entrance') ||
        lower.includes('lobby') || lower.includes('treppe') ||
        lower.includes('flur') || lower.includes('hall')) {
      if (!exitSpaceKeySet.has(key)) {
        exitSpaceKeySet.add(key)
        exitSpaceKeys.push(key)
      }
    }
  }

  // Last resort: lowest-degree spaces
  if (exitSpaceKeys.length === 0) {
    const sortedByDegree = Object.entries(degreeMap)
      .sort((a, b) => a[1] - b[1])
    const minDegree = sortedByDegree[0]?.[1] ?? 1
    for (const [key, deg] of sortedByDegree) {
      if (deg <= minDegree && !exitSpaceKeySet.has(key)) {
        exitSpaceKeySet.add(key)
        exitSpaceKeys.push(key)
      }
      if (exitSpaceKeys.length >= 3) break
    }
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
// Scale factor: how many model units per meter
const MODEL_UNITS_PER_M = unitLabel === 'mm' ? 1000 : 1
// Floor height threshold to detect inter-floor transitions
const FLOOR_Z_THRESHOLD = 1.5 * MODEL_UNITS_PER_M
// Max allowed evacuation distance (fire safety code)
const MAX_EVAC_DISTANCE = 35 * MODEL_UNITS_PER_M // 35 m
// Visual extension past exit door (not counted in distance)
const EXIT_EXTENSION = 3 * MODEL_UNITS_PER_M // 3 m

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

    // Build segments that route through doors and stair flights.
    // Distance measurement STOPS at the external exit door — anything
    // past it is drawn visually but not counted.
    const segments: EvacPath['segments'] = []
    let totalLength = 0
    const extDoor = exitDoorBySpace[exitKey]

    for (let i = 0; i < result.path.length - 1; i++) {
      const fromKey = result.path[i].modelId + ':' + result.path[i].expressId
      const toKey = result.path[i + 1].modelId + ':' + result.path[i + 1].expressId
      const fromC = centroidMap[fromKey]
      const toC = centroidMap[toKey]
      if (!fromC || !toC) continue

      const wp = waypointMap[fromKey + '|' + toKey]
      const dz = Math.abs(toC[2] - fromC[2])

      // ── Inter-floor via stair ──
      if (dz > FLOOR_Z_THRESHOLD && wp) {
        const stairEntry: [number, number, number] = [wp.centroid[0], wp.centroid[1], fromC[2]]
        const stairExit: [number, number, number] = [wp.centroid[0], wp.centroid[1], toC[2]]

        const len1 = dist3d(fromC, stairEntry)
        if (len1 > 0.01) {
          segments.push({ from: fromC, to: stairEntry, length: len1 })
          totalLength += len1
        }

        const stairLen = dz * STAIR_WALK_FACTOR
        segments.push({ from: stairEntry, to: stairExit, length: stairLen })
        totalLength += stairLen

        const len3 = dist3d(stairExit, toC)
        if (len3 > 0.01) {
          segments.push({ from: stairExit, to: toC, length: len3 })
          totalLength += len3
        }

      // ── Same floor via door ──
      } else if (wp && wp.type === 'door') {
        const doorPos: [number, number, number] = [
          wp.centroid[0], wp.centroid[1], (fromC[2] + toC[2]) / 2
        ]

        const len1 = dist3d(fromC, doorPos)
        segments.push({ from: fromC, to: doorPos, length: len1 })
        totalLength += len1

        const len2 = dist3d(doorPos, toC)
        segments.push({ from: doorPos, to: toC, length: len2 })
        totalLength += len2

      // ── Fallback: direct line ──
      } else {
        const segLen = dist3d(fromC, toC)
        if (dz > FLOOR_Z_THRESHOLD) {
          const stairLen = Math.max(segLen, dz * STAIR_WALK_FACTOR)
          segments.push({ from: fromC, to: toC, length: stairLen })
          totalLength += stairLen
        } else {
          segments.push({ from: fromC, to: toC, length: segLen })
          totalLength += segLen
        }
      }
    }

    // ── Final segment: route through the external exit door ──────────
    // The path so far ends at the exit space centroid. Now extend
    // through the actual external door and a few meters past it.
    if (extDoor && segments.length > 0) {
      const lastPt = segments[segments.length - 1].to
      const exitDoorPos: [number, number, number] = [
        extDoor.centroid[0], extDoor.centroid[1], lastPt[2]
      ]

      // Measured: exit space centroid → external door
      const lenToDoor = dist3d(lastPt, exitDoorPos)
      if (lenToDoor > 0.01) {
        segments.push({ from: lastPt, to: exitDoorPos, length: lenToDoor })
        totalLength += lenToDoor
      }

      // Visual-only: extend 3m past external door (not counted)
      const dx = exitDoorPos[0] - lastPt[0]
      const dy = exitDoorPos[1] - lastPt[1]
      const hLen = Math.sqrt(dx * dx + dy * dy)
      if (hLen > 0.01) {
        const extEnd: [number, number, number] = [
          exitDoorPos[0] + (dx / hLen) * EXIT_EXTENSION,
          exitDoorPos[1] + (dy / hLen) * EXIT_EXTENSION,
          exitDoorPos[2],
        ]
        segments.push({ from: exitDoorPos, to: extEnd, length: 0 })
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
  // Scale against the 35 m regulatory limit, not the actual max
  const t = Math.min(length / MAX_EVAC_DISTANCE, 1) // 0 = 0 m, 1 = 35 m+

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
console.log('  Distance measured to exit door (not room centroid).')
console.log('  Max allowed distance: 35 m')
console.log('  3D path lines overlaid (always visible):')
console.log('    Green  = short path to exit door (safe)')
console.log('    Yellow = moderate distance')
console.log('    Red    = approaching or exceeding 35 m limit')
console.log('  Spaces colored by evacuation distance.')
console.log('    Blue   = exit / egress point')
console.log('')

// ── 12. Evacuation distance schedule ─────────────────────────────────
console.log('── Evacuation Distance Schedule (to exit door) ──')
console.log('Space                   | Distance   | Status | Exit via')
console.log('------------------------+------------+--------+------------------')

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
  const pass = p.totalLength <= MAX_EVAC_DISTANCE
  const nameCol = (spaceName + '                        ').slice(0, 24)
  const distCol = (displayLen + '            ').slice(0, 12)
  const statusCol = pass ? 'OK     ' : 'FAIL   '
  const exitCol = exitName.slice(0, 18)
  const logFn = pass ? console.log : console.warn
  logFn(nameCol + '| ' + distCol + '| ' + statusCol + '| ' + exitCol)
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
console.log('  Max allowed:     35.00 ' + displayUnit)
console.log('  Total exits:     ' + exitSpaceKeys.length)
console.log('  Doors traversed: ' + doorEntityRefs.length)

// ── 14. Fire safety compliance — 35 m max evacuation distance ────────
const nonCompliant = sorted.filter(p => p.totalLength > MAX_EVAC_DISTANCE)
const compliant = sorted.filter(p => p.totalLength <= MAX_EVAC_DISTANCE)

console.log('')
console.log('── Fire Safety Compliance (35 m max) ──')
console.log('  PASS: ' + compliant.length + ' space(s) within 35 m')

if (nonCompliant.length > 0) {
  const failEntities: BimEntity[] = []
  for (const p of nonCompliant) {
    const entity = entityMap[p.spaceKey]
    if (entity) failEntities.push(entity)
  }
  if (failEntities.length > 0) {
    bim.viewer.colorize(failEntities, '#e74c3c')
    bim.viewer.select(failEntities)
  }

  console.warn('  FAIL: ' + nonCompliant.length + ' space(s) EXCEED 35 m limit!')
  for (const p of nonCompliant.slice(0, 10)) {
    const name = metrics.find(m =>
      m.ref.modelId + ':' + m.ref.expressId === p.spaceKey
    )?.name || '?'
    const dist = unitLabel === 'mm'
      ? (p.totalLength * unitScale).toFixed(1)
      : p.totalLength.toFixed(1)
    console.warn('    ' + name + ': ' + dist + ' ' + displayUnit)
  }
  console.warn('  Review these spaces for fire safety compliance.')
} else {
  console.log('  All spaces comply with the 35 m evacuation limit.')
}
