export {} // module boundary (stripped by transpiler)

// Solar Analysis — estimate solar exposure and colorize building elements
//
// Implements the NOAA solar position algorithm to calculate real sun altitude
// and azimuth, then scores every element by estimated solar exposure and
// applies a heat-map color gradient to the 3D view.
//
// Future: with npm package support (esbuild-wasm), you could replace the
// inline math with `suncalc` and use `chroma-js` for color interpolation.
//
// ─── Configuration ──────────────────────────────────────────────
// Change these values to match your project location and analysis time

const LATITUDE = 47.37      // degrees North  (Zurich, Switzerland)
const LONGITUDE = 8.54      // degrees East
const MONTH = 6             // 1–12
const DAY = 21              // summer solstice
const HOUR = 14             // 24 h local solar time
const MAX_PROPERTY_SCAN = 200 // limit IsExternal scan for performance

// ─── Sun Position (NOAA simplified) ─────────────────────────────

const DEG = Math.PI / 180

// Day-of-year approximation
const N = Math.floor((275 * MONTH) / 9) - Math.floor((MONTH + 9) / 12) + DAY - 30

// Solar declination (degrees)
const declination = 23.45 * Math.sin(DEG * (360 / 365) * (N - 81))

// Solar hour angle (degrees from solar noon, 15°/h)
const hourAngle = 15 * (HOUR - 12)

// Altitude — angle above horizon
const sinAlt =
  Math.sin(DEG * LATITUDE) * Math.sin(DEG * declination) +
  Math.cos(DEG * LATITUDE) * Math.cos(DEG * declination) * Math.cos(DEG * hourAngle)
const altitude = Math.asin(sinAlt) / DEG

// Azimuth — compass bearing (0° = N, 90° = E, 180° = S)
const cosAz =
  (Math.sin(DEG * declination) - Math.sin(DEG * LATITUDE) * sinAlt) /
  (Math.cos(DEG * LATITUDE) * Math.cos(Math.asin(sinAlt)))
let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) / DEG
if (hourAngle > 0) azimuth = 360 - azimuth

console.log('=== Solar Analysis ===')
console.log('Location: ' + LATITUDE + '\u00b0N, ' + LONGITUDE + '\u00b0E')
console.log('Date: ' + MONTH + '/' + DAY + '  Time: ' + HOUR + ':00')
console.log('Sun altitude: ' + altitude.toFixed(1) + '\u00b0  (0\u00b0 = horizon, 90\u00b0 = zenith)')
console.log('Sun azimuth:  ' + azimuth.toFixed(1) + '\u00b0  (0\u00b0=N  90\u00b0=E  180\u00b0=S  270\u00b0=W)')
console.log('')

// ─── Heat-Map Color Scale ───────────────────────────────────────
// Maps a 0..1 exposure score to a blue → cyan → green → yellow → red gradient.

function exposureColor(t: number): string {
  const v = Math.max(0, Math.min(1, t))
  const stops: Array<[number, number, number]> = [
    [26, 35, 126],    // deep blue   (0.00)
    [66, 165, 245],   // light blue  (0.25)
    [102, 187, 106],  // green       (0.50)
    [255, 238, 88],   // yellow      (0.75)
    [244, 67, 54],    // red         (1.00)
  ]
  const idx = v * (stops.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, stops.length - 1)
  const f = idx - lo
  const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f)
  const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f)
  const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f)
  return '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
}

// ─── Element Exposure Scoring ───────────────────────────────────

bim.viewer.resetColors()
const allEntities = bim.query.all()

// Base exposure by IFC element type (0..1)
const TYPE_EXPOSURE: Record<string, number> = {
  IfcRoof: 0.95,
  IfcSlab: 0.30,
  IfcWall: 0.70,
  IfcWallStandardCase: 0.70,
  IfcCurtainWall: 0.90,
  IfcWindow: 0.80,
  IfcDoor: 0.40,
  IfcColumn: 0.20,
  IfcBeam: 0.15,
  IfcStair: 0.10,
  IfcRailing: 0.50,
  IfcPlate: 0.60,
  IfcCovering: 0.45,
  IfcMember: 0.30,
  IfcFurnishingElement: 0.05,
}

// Sun altitude factor: high sun → more horizontal (roof) exposure, less facade
const altFactor = Math.sin(DEG * Math.max(0, altitude))

// Pre-scan a limited set of elements for IsExternal property
const externalSet = new Set<string>() // set of GlobalIds that are external
const scanTypes = ['IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcRoof', 'IfcCurtainWall', 'IfcWindow', 'IfcDoor']
let scannedCount = 0
for (const entity of allEntities) {
  if (scannedCount >= MAX_PROPERTY_SCAN) break
  if (!scanTypes.includes(entity.Type)) continue
  const psets = bim.query.properties(entity)
  for (const pset of psets) {
    for (const p of pset.properties) {
      if (p.name === 'IsExternal' && (p.value === true || p.value === 'TRUE' || p.value === '.T.')) {
        externalSet.add(entity.GlobalId)
      }
    }
  }
  scannedCount++
}

console.log('Scanned ' + scannedCount + ' elements for IsExternal property')
console.log('Found ' + externalSet.size + ' external elements')
console.log('')

// Score every entity
const scored: Array<{ entity: BimEntity; score: number }> = []
const typeStats: Record<string, { count: number; total: number; ext: number }> = {}

for (const entity of allEntities) {
  const base = TYPE_EXPOSURE[entity.Type] ?? 0.10
  const isExternal = externalSet.has(entity.GlobalId)

  let score = base

  // External elements get a 30% boost
  if (isExternal) {
    score = Math.min(1, score * 1.3)
  } else if (entity.Type === 'IfcWall' || entity.Type === 'IfcWallStandardCase') {
    // Interior walls — heavily reduced
    score *= 0.25
  }

  // Horizontal elements (roofs, slabs) benefit from high sun altitude
  if (entity.Type === 'IfcRoof' || entity.Type === 'IfcSlab') {
    score *= (0.4 + 0.6 * altFactor)
  }

  // Vertical elements (walls, facades) benefit from lower sun angle
  if (entity.Type.includes('Wall') || entity.Type === 'IfcCurtainWall') {
    score *= (0.4 + 0.6 * (1 - altFactor))
  }

  scored.push({ entity, score })

  if (!typeStats[entity.Type]) {
    typeStats[entity.Type] = { count: 0, total: 0, ext: 0 }
  }
  typeStats[entity.Type].count++
  typeStats[entity.Type].total += score
  if (isExternal) typeStats[entity.Type].ext++
}

// ─── Batch Colorize ─────────────────────────────────────────────
// Group entities into 20 color buckets for efficient rendering

const BUCKETS = 20
const colorGroups: Record<string, BimEntity[]> = {}
for (const item of scored) {
  const bucket = Math.round(item.score * BUCKETS) / BUCKETS
  const color = exposureColor(bucket)
  if (!colorGroups[color]) colorGroups[color] = []
  colorGroups[color].push(item.entity)
}

const batches: Array<{ entities: BimEntity[]; color: string }> = []
for (const color of Object.keys(colorGroups)) {
  batches.push({ entities: colorGroups[color], color })
}
bim.viewer.colorizeAll(batches)

// ─── Report ─────────────────────────────────────────────────────

console.log('=== Exposure by Element Type ===')
const sortedTypes: [string, { count: number; total: number; ext: number }][] =
  Object.entries(typeStats).sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))

for (const [type, stats] of sortedTypes) {
  const avg = (stats.total / stats.count * 100).toFixed(0)
  const extLabel = stats.ext > 0 ? ' (' + stats.ext + ' external)' : ''
  const bar = '#'.repeat(Math.ceil(stats.total / stats.count * 20))
  console.log(type + ': ' + stats.count + ' elements, avg ' + avg + '% exposure' + extLabel)
  console.log('  ' + bar + ' ' + exposureColor(stats.total / stats.count))
}

// Global stats
const totalExposure = scored.reduce((sum: number, s) => sum + s.score, 0)
const avgExposure = totalExposure / scored.length

console.log('\n=== Summary ===')
console.log('Total elements: ' + scored.length)
console.log('Color buckets:  ' + batches.length)
console.log('Avg exposure:   ' + (avgExposure * 100).toFixed(1) + '%')

// Top exposed elements
const top = scored
  .filter(s => s.score > 0.75)
  .sort((a, b) => b.score - a.score)
  .slice(0, 10)

if (top.length > 0) {
  console.log('\n=== Highest Exposure (top 10) ===')
  for (const item of top) {
    const pct = (item.score * 100).toFixed(0)
    console.log('  ' + pct + '% — ' + (item.entity.Name || item.entity.Type) + ' ' + exposureColor(item.score))
  }
}

// Legend
console.log('\n=== Color Legend ===')
console.log('  ' + exposureColor(0) + ' 0%    (deep blue  — no exposure)')
console.log('  ' + exposureColor(0.25) + ' 25%   (light blue — low)')
console.log('  ' + exposureColor(0.5) + ' 50%   (green      — moderate)')
console.log('  ' + exposureColor(0.75) + ' 75%   (yellow     — high)')
console.log('  ' + exposureColor(1) + ' 100%  (red        — maximum)')
console.log('\nTip: edit LATITUDE, LONGITUDE, MONTH, DAY, HOUR at the top to analyze different conditions')
