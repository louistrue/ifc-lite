export {} // module boundary (stripped by transpiler)

// ── Template-Driven Quantity Takeoff with Geometry Computation ───────
// Stakeholder: Cost Estimator / Project Manager
//
// Uses IFC4 standard Qto templates (modeled after IfcOpenShell's
// IFC4QtoBaseQuantities ruleset) to extract quantities for every
// element type. When IFC-embedded quantities are missing, the script
// COMPUTES them from actual mesh geometry using the signed tetrahedron
// method for volume and triangle area summation for surface area —
// the same algorithms used by IfcOpenShell's geometry engine.
// ─────────────────────────────────────────────────────────────────────

// ── Inline QTO Rules ─────────────────────────────────────────────────

type QuantityKind = 'length' | 'area' | 'volume' | 'weight' | 'count'

interface QDef { name: string; kind: QuantityKind; unit: string }
interface QtoSetDef { name: string; quantities: QDef[] }
interface QtoRule { types: string[]; qtoSets: QtoSetDef[] }

const QTO_RULES: QtoRule[] = [
  {
    types: ['IfcWall', 'IfcWallStandardCase'],
    qtoSets: [{ name: 'Qto_WallBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'GrossFootprintArea', kind: 'area', unit: 'm²' },
      { name: 'NetFootprintArea', kind: 'area', unit: 'm²' },
      { name: 'GrossSideArea', kind: 'area', unit: 'm²' },
      { name: 'NetSideArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcSlab'],
    qtoSets: [{ name: 'Qto_SlabBaseQuantities', quantities: [
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'Depth', kind: 'length', unit: 'm' },
      { name: 'Perimeter', kind: 'length', unit: 'm' },
      { name: 'GrossArea', kind: 'area', unit: 'm²' },
      { name: 'NetArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcColumn'],
    qtoSets: [{ name: 'Qto_ColumnBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'CrossSectionArea', kind: 'area', unit: 'm²' },
      { name: 'OuterSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'NetSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcBeam'],
    qtoSets: [{ name: 'Qto_BeamBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'CrossSectionArea', kind: 'area', unit: 'm²' },
      { name: 'OuterSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'NetSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcMember'],
    qtoSets: [{ name: 'Qto_MemberBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'CrossSectionArea', kind: 'area', unit: 'm²' },
      { name: 'OuterSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'NetSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcPlate'],
    qtoSets: [{ name: 'Qto_PlateBaseQuantities', quantities: [
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Perimeter', kind: 'length', unit: 'm' },
      { name: 'GrossArea', kind: 'area', unit: 'm²' },
      { name: 'NetArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcDoor', 'IfcDoorStandardCase'],
    qtoSets: [{ name: 'Qto_DoorBaseQuantities', quantities: [
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'Perimeter', kind: 'length', unit: 'm' },
      { name: 'Area', kind: 'area', unit: 'm²' },
    ]}],
  },
  {
    types: ['IfcWindow'],
    qtoSets: [{ name: 'Qto_WindowBaseQuantities', quantities: [
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'Perimeter', kind: 'length', unit: 'm' },
      { name: 'Area', kind: 'area', unit: 'm²' },
    ]}],
  },
  {
    types: ['IfcCovering'],
    qtoSets: [{ name: 'Qto_CoveringBaseQuantities', quantities: [
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'GrossArea', kind: 'area', unit: 'm²' },
      { name: 'NetArea', kind: 'area', unit: 'm²' },
    ]}],
  },
  {
    types: ['IfcCurtainWall'],
    qtoSets: [{ name: 'Qto_CurtainWallQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'GrossSideArea', kind: 'area', unit: 'm²' },
      { name: 'NetSideArea', kind: 'area', unit: 'm²' },
    ]}],
  },
  {
    types: ['IfcRoof'],
    qtoSets: [{ name: 'Qto_RoofBaseQuantities', quantities: [
      { name: 'GrossArea', kind: 'area', unit: 'm²' },
      { name: 'NetArea', kind: 'area', unit: 'm²' },
      { name: 'ProjectedArea', kind: 'area', unit: 'm²' },
    ]}],
  },
  {
    types: ['IfcStair', 'IfcStairFlight'],
    qtoSets: [{ name: 'Qto_StairFlightBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
    ]}],
  },
  {
    types: ['IfcRamp', 'IfcRampFlight'],
    qtoSets: [{ name: 'Qto_RampFlightBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'GrossArea', kind: 'area', unit: 'm²' },
      { name: 'NetArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
    ]}],
  },
  {
    types: ['IfcRailing'],
    qtoSets: [{ name: 'Qto_RailingBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
    ]}],
  },
  {
    types: ['IfcFooting'],
    qtoSets: [{ name: 'Qto_FootingBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'CrossSectionArea', kind: 'area', unit: 'm²' },
      { name: 'OuterSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcPile'],
    qtoSets: [{ name: 'Qto_PileBaseQuantities', quantities: [
      { name: 'Length', kind: 'length', unit: 'm' },
      { name: 'CrossSectionArea', kind: 'area', unit: 'm²' },
      { name: 'OuterSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossSurfaceArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
      { name: 'GrossWeight', kind: 'weight', unit: 'kg' },
      { name: 'NetWeight', kind: 'weight', unit: 'kg' },
    ]}],
  },
  {
    types: ['IfcOpeningElement'],
    qtoSets: [{ name: 'Qto_OpeningElementBaseQuantities', quantities: [
      { name: 'Width', kind: 'length', unit: 'm' },
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'Depth', kind: 'length', unit: 'm' },
      { name: 'Area', kind: 'area', unit: 'm²' },
      { name: 'Volume', kind: 'volume', unit: 'm³' },
    ]}],
  },
  {
    types: ['IfcSpace'],
    qtoSets: [{ name: 'Qto_SpaceBaseQuantities', quantities: [
      { name: 'Height', kind: 'length', unit: 'm' },
      { name: 'GrossPerimeter', kind: 'length', unit: 'm' },
      { name: 'NetPerimeter', kind: 'length', unit: 'm' },
      { name: 'GrossFloorArea', kind: 'area', unit: 'm²' },
      { name: 'NetFloorArea', kind: 'area', unit: 'm²' },
      { name: 'GrossWallArea', kind: 'area', unit: 'm²' },
      { name: 'NetWallArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
    ]}],
  },
  {
    types: ['IfcBuildingStorey'],
    qtoSets: [{ name: 'Qto_BuildingStoreyBaseQuantities', quantities: [
      { name: 'GrossHeight', kind: 'length', unit: 'm' },
      { name: 'NetHeight', kind: 'length', unit: 'm' },
      { name: 'GrossPerimeter', kind: 'length', unit: 'm' },
      { name: 'GrossFloorArea', kind: 'area', unit: 'm²' },
      { name: 'NetFloorArea', kind: 'area', unit: 'm²' },
      { name: 'GrossVolume', kind: 'volume', unit: 'm³' },
      { name: 'NetVolume', kind: 'volume', unit: 'm³' },
    ]}],
  },
]

// ── Geometry quantity name mapping ───────────────────────────────────
// Maps standard Qto quantity names to the geometry-computed field that
// can fill them when missing from the IFC data.

const GEOMETRY_MAP: Record<string, 'volume' | 'surfaceArea' | 'bboxDx' | 'bboxDy' | 'bboxDz'> = {
  // Volume quantities
  'GrossVolume': 'volume',
  'NetVolume': 'volume',
  'Volume': 'volume',
  // Surface area quantities
  'GrossSurfaceArea': 'surfaceArea',
  'NetSurfaceArea': 'surfaceArea',
  'OuterSurfaceArea': 'surfaceArea',
  'GrossSideArea': 'surfaceArea',
  'NetSideArea': 'surfaceArea',
  'GrossArea': 'surfaceArea',
  'NetArea': 'surfaceArea',
  'Area': 'surfaceArea',
}

// ── Rule lookup ──────────────────────────────────────────────────────
const ruleLookup = new Map<string, QtoRule>()
for (const rule of QTO_RULES) {
  for (const t of rule.types) ruleLookup.set(t, rule)
}

const ALL_TYPES = Array.from(new Set(QTO_RULES.flatMap(r => r.types)))

// ── Aggregation structures ───────────────────────────────────────────
interface QuantityAgg {
  sum: number
  count: number
  computedSum: number
  computedCount: number
  unit: string
  kind: QuantityKind
}

interface TypeReport {
  type: string
  entityCount: number
  qtoSetName: string
  expectedCount: number
  foundFromIfc: number
  foundAfterComputation: number
  quantities: Map<string, QuantityAgg>
}

console.log('═══════════════════════════════════════════════')
console.log('  QUANTITY TAKEOFF (Template + Geometry Engine)')
console.log('═══════════════════════════════════════════════')
console.log('')

// ── Process each entity type ─────────────────────────────────────────
const reports: TypeReport[] = []
let totalElements = 0
let totalFromIfc = 0
let totalComputed = 0
let totalExpected = 0
let geometryHits = 0
let geometryMisses = 0
let mutationCount = 0

for (const ifcType of ALL_TYPES) {
  const entities = bim.query.byType(ifcType)
  if (entities.length === 0) continue

  const rule = ruleLookup.get(ifcType)!

  for (const qtoSetDef of rule.qtoSets) {
    const report: TypeReport = {
      type: ifcType,
      entityCount: entities.length,
      qtoSetName: qtoSetDef.name,
      expectedCount: qtoSetDef.quantities.length,
      foundFromIfc: 0,
      foundAfterComputation: 0,
      quantities: new Map(),
    }

    totalElements += entities.length

    for (const qdef of qtoSetDef.quantities) {
      report.quantities.set(qdef.name, {
        sum: 0, count: 0,
        computedSum: 0, computedCount: 0,
        unit: qdef.unit, kind: qdef.kind,
      })
    }

    const sample = entities.length > 500 ? entities.slice(0, 500) : entities
    const scaleFactor = entities.length / sample.length

    for (const entity of sample) {
      // 1. Extract IFC-embedded quantities
      const qsets = bim.query.quantities(entity)
      const ifcValues = new Map<string, number>()
      for (const qs of qsets) {
        for (const q of qs.quantities) {
          if (q.value !== null && q.value !== 0) {
            ifcValues.set(q.name, q.value)
          }
        }
      }

      // 2. Get geometry-computed quantities (volume, surfaceArea, bbox)
      const geo = bim.query.computedQuantities(entity)
      if (geo) {
        geometryHits++
      } else {
        geometryMisses++
      }

      // 3. For each expected quantity: use IFC value, or fall back to geometry
      //    When filling from geometry, MUTATE the value into the model so
      //    the user sees it in the quantities panel with an "edited" badge.
      for (const qdef of qtoSetDef.quantities) {
        const agg = report.quantities.get(qdef.name)!
        const ifcVal = ifcValues.get(qdef.name)

        if (ifcVal !== undefined) {
          agg.sum += ifcVal
          agg.count++
        } else if (geo) {
          // Try to fill from geometry computation
          const geoField = GEOMETRY_MAP[qdef.name]
          if (geoField && geo[geoField] > 0) {
            const computedValue = geo[geoField]
            agg.computedSum += computedValue
            agg.computedCount++
            // Persist the computed quantity into the model so it shows
            // in the quantities panel with a "computed" badge
            bim.mutate.setProperty(entity, qtoSetDef.name, qdef.name, computedValue)
            mutationCount++
          }
        }
      }
    }

    // Scale up if sampled
    if (scaleFactor > 1) {
      for (const agg of report.quantities.values()) {
        agg.sum *= scaleFactor
        agg.computedSum *= scaleFactor
      }
    }

    // Count completeness
    for (const agg of report.quantities.values()) {
      if (agg.count > 0) report.foundFromIfc++
      if (agg.count > 0 || agg.computedCount > 0) report.foundAfterComputation++
    }

    totalFromIfc += report.foundFromIfc
    totalComputed += (report.foundAfterComputation - report.foundFromIfc)
    totalExpected += report.expectedCount

    reports.push(report)
  }
}

if (reports.length === 0) {
  console.error('No elements with quantity templates found')
  throw new Error('no quantities')
}

// ── Geometry Engine Stats ────────────────────────────────────────────
console.log('Scanned ' + totalElements + ' elements across ' + reports.length + ' type/Qto-set combinations')
console.log('Geometry engine: ' + geometryHits + ' meshes resolved, ' + geometryMisses + ' without geometry')
if (mutationCount > 0) {
  console.log('Wrote ' + mutationCount + ' computed quantities into the model (click any element to see them)')
}
console.log('')

// ── Detailed Report ──────────────────────────────────────────────────
for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  const ifcPct = r.expectedCount > 0 ? Math.round((r.foundFromIfc / r.expectedCount) * 100) : 0
  const totalPct = r.expectedCount > 0 ? Math.round((r.foundAfterComputation / r.expectedCount) * 100) : 0
  const computed = r.foundAfterComputation - r.foundFromIfc

  console.log('── ' + r.type + ' (' + r.entityCount + ') — ' + r.qtoSetName + ' ──')
  console.log('   From IFC: ' + r.foundFromIfc + '/' + r.expectedCount + ' (' + ifcPct + '%)' +
    (computed > 0 ? '  +' + computed + ' from geometry → ' + r.foundAfterComputation + '/' + r.expectedCount + ' (' + totalPct + '%)' : ''))

  for (const [name, agg] of r.quantities) {
    const total = agg.sum + agg.computedSum
    const totalCount = agg.count + agg.computedCount
    if (agg.count > 0 && agg.computedCount === 0) {
      const avg = agg.sum / agg.count
      console.log('   ✓ ' + name + ': total=' + agg.sum.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (' + agg.count + ' from IFC)')
    } else if (agg.computedCount > 0 && agg.count === 0) {
      const avg = agg.computedSum / agg.computedCount
      console.log('   ⚙ ' + name + ': total=' + agg.computedSum.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (' + agg.computedCount + ' from geometry)')
    } else if (agg.count > 0 && agg.computedCount > 0) {
      const avg = total / totalCount
      console.log('   ✓ ' + name + ': total=' + total.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (' + agg.count + ' IFC + ' + agg.computedCount + ' geometry)')
    } else {
      console.log('   ✗ ' + name + ': missing')
    }
  }
  console.log('')
}

// ── Completeness Summary ─────────────────────────────────────────────
console.log('── Completeness Summary ──')
console.log('Type                       | Count | From IFC    | + Geometry  | Total')
console.log('---------------------------+-------+-------------+-------------+----------')
for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  const ifcPct = r.expectedCount > 0 ? Math.round((r.foundFromIfc / r.expectedCount) * 100) : 0
  const totalPct = r.expectedCount > 0 ? Math.round((r.foundAfterComputation / r.expectedCount) * 100) : 0
  const computed = r.foundAfterComputation - r.foundFromIfc
  const typeStr = (r.type + '                           ').slice(0, 27)
  const countStr = ('     ' + r.entityCount).slice(-5)
  const ifcStr = (r.foundFromIfc + '/' + r.expectedCount + ' (' + ifcPct + '%)           ').slice(0, 11)
  const compStr = computed > 0 ? ('+' + computed + '           ').slice(0, 11) : '—          '
  const totStr = (r.foundAfterComputation + '/' + r.expectedCount + ' (' + totalPct + '%)').slice(0, 11)
  console.log(typeStr + '| ' + countStr + ' | ' + ifcStr + ' | ' + compStr + ' | ' + totStr)
}

const ifcPctTotal = totalExpected > 0 ? Math.round((totalFromIfc / totalExpected) * 100) : 0
const finalTotal = totalFromIfc + totalComputed
const finalPct = totalExpected > 0 ? Math.round((finalTotal / totalExpected) * 100) : 0
console.log('')
console.log('From IFC: ' + totalFromIfc + '/' + totalExpected + ' (' + ifcPctTotal + '%)' +
  '  +' + totalComputed + ' from geometry → ' + finalTotal + '/' + totalExpected + ' (' + finalPct + '%)')

// ── Totals by Kind ───────────────────────────────────────────────────
console.log('')
console.log('── Aggregate Totals by Category ──')

const kindTotals = new Map<QuantityKind, { sum: number; unit: string }>()
for (const r of reports) {
  for (const agg of r.quantities.values()) {
    const total = agg.sum + agg.computedSum
    if (total === 0) continue
    const existing = kindTotals.get(agg.kind)
    if (existing) {
      existing.sum += total
    } else {
      kindTotals.set(agg.kind, { sum: total, unit: agg.unit })
    }
  }
}
for (const [kind, tot] of kindTotals) {
  console.log('  ' + kind + ': ' + tot.sum.toFixed(2) + ' ' + tot.unit)
}

// ── Summary Table ────────────────────────────────────────────────────
console.log('')
console.log('── Summary (IFC + geometry-computed) ──')
console.log('Type                       | Count |    Area    |   Volume   |   Length')
console.log('---------------------------+-------+------------+------------+----------')
for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  let area = 0
  let volume = 0
  let length = 0
  for (const [, agg] of r.quantities) {
    const total = agg.sum + agg.computedSum
    if (total === 0) continue
    if (agg.kind === 'area') area += total
    if (agg.kind === 'volume') volume += total
    if (agg.kind === 'length') length += total
  }
  const typeStr = (r.type + '                           ').slice(0, 27)
  const countStr = ('     ' + r.entityCount).slice(-5)
  const areaStr = area > 0 ? (area.toFixed(1) + ' m²') : '-'
  const volStr = volume > 0 ? (volume.toFixed(2) + ' m³') : '-'
  const lenStr = length > 0 ? (length.toFixed(1) + ' m') : '-'
  console.log(typeStr + '| ' + countStr + ' | ' + ('          ' + areaStr).slice(-10) + ' | ' + ('          ' + volStr).slice(-10) + ' | ' + ('        ' + lenStr).slice(-8))
}

// ── Color by Completeness ────────────────────────────────────────────
const colorBatches: Array<{ entities: BimEntity[]; color: string }> = []
const greenEntities: BimEntity[] = []
const yellowEntities: BimEntity[] = []
const redEntities: BimEntity[] = []

for (const r of reports) {
  const pct = r.expectedCount > 0 ? Math.round((r.foundAfterComputation / r.expectedCount) * 100) : 0
  const entities = bim.query.byType(r.type)
  if (pct >= 75) {
    greenEntities.push(...entities)
  } else if (pct >= 25) {
    yellowEntities.push(...entities)
  } else {
    redEntities.push(...entities)
  }
}

if (greenEntities.length > 0) colorBatches.push({ entities: greenEntities, color: '#4caf50' })
if (yellowEntities.length > 0) colorBatches.push({ entities: yellowEntities, color: '#ff9800' })
if (redEntities.length > 0) colorBatches.push({ entities: redEntities, color: '#f44336' })

if (colorBatches.length > 0) {
  bim.viewer.colorizeAll(colorBatches)
  console.log('')
  console.log('Color key: green=≥75% complete, orange=25-74%, red=<25%')
}

// ── CSV Export ────────────────────────────────────────────────────────
const allElements = bim.query.byType(...ALL_TYPES)
if (allElements.length > 0) {
  // Build quantity columns from all Qto sets encountered
  const qtyColumns: string[] = []
  const seenCols = new Set<string>()
  for (const r of reports) {
    for (const [qName] of r.quantities) {
      const col = r.qtoSetName + '.' + qName
      if (!seenCols.has(col)) {
        seenCols.add(col)
        qtyColumns.push(col)
      }
    }
  }
  bim.export.csv(allElements, {
    columns: ['Name', 'Type', 'GlobalId', ...qtyColumns],
    filename: 'quantity-takeoff.csv'
  })
  console.log('')
  console.log('Exported ' + allElements.length + ' elements with ' + qtyColumns.length + ' quantity columns to quantity-takeoff.csv')
}
