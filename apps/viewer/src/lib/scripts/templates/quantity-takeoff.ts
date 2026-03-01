export {} // module boundary (stripped by transpiler)

// ── Template-Driven Quantity Takeoff ─────────────────────────────────
// Stakeholder: Cost Estimator / Project Manager
//
// Uses IFC4 standard Qto templates (modeled after IfcOpenShell's
// IFC4QtoBaseQuantities ruleset) to extract and validate quantities
// for every element type. For each entity, the script knows exactly
// which Qto set and quantities to expect based on the IFC schema,
// then reports totals, averages, and data completeness per type.
// ─────────────────────────────────────────────────────────────────────

// ── Inline QTO Rules ─────────────────────────────────────────────────
// Embedded here so the script is self-contained in the sandbox.

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

// ── Rule lookup ──────────────────────────────────────────────────────
const ruleLookup = new Map<string, QtoRule>()
for (const rule of QTO_RULES) {
  for (const t of rule.types) ruleLookup.set(t, rule)
}

// Collect every unique IFC type covered by rules
const ALL_TYPES = Array.from(new Set(QTO_RULES.flatMap(r => r.types)))

// ── Aggregation structures ───────────────────────────────────────────
interface QuantityAgg {
  sum: number
  count: number
  unit: string
  kind: QuantityKind
}

interface TypeReport {
  type: string
  entityCount: number
  qtoSetName: string
  expectedCount: number
  foundCount: number
  quantities: Map<string, QuantityAgg>
}

console.log('═══════════════════════════════════════')
console.log('  QUANTITY TAKEOFF (Template-Driven)')
console.log('═══════════════════════════════════════')
console.log('')

// ── Process each entity type ─────────────────────────────────────────
const reports: TypeReport[] = []
let totalElements = 0
let totalFound = 0
let totalExpected = 0
// Track CSV column paths
const csvColumns = new Set<string>()

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
      foundCount: 0,
      quantities: new Map(),
    }

    totalElements += entities.length

    // Initialize aggregation for every expected quantity
    for (const qdef of qtoSetDef.quantities) {
      report.quantities.set(qdef.name, { sum: 0, count: 0, unit: qdef.unit, kind: qdef.kind })
    }

    // Cap at 500 to avoid timeout on large models
    const sample = entities.length > 500 ? entities.slice(0, 500) : entities
    const scaleFactor = entities.length / sample.length

    for (const entity of sample) {
      const qsets = bim.query.quantities(entity)

      // Find the matching Qto set by name
      const matchingSet = qsets.find(qs => qs.name === qtoSetDef.name)

      // Also search all sets for quantities (some models use non-standard set names)
      const allQuantities = new Map<string, number>()
      for (const qs of qsets) {
        for (const q of qs.quantities) {
          if (q.value !== null && q.value !== 0) {
            allQuantities.set(q.name, q.value)
            csvColumns.add(qs.name + '.' + q.name)
          }
        }
      }

      // Extract each expected quantity
      for (const qdef of qtoSetDef.quantities) {
        let value: number | null = null

        // Prefer the value from the standard Qto set
        if (matchingSet) {
          const match = matchingSet.quantities.find(q => q.name === qdef.name)
          if (match && match.value !== null && match.value !== 0) {
            value = match.value
          }
        }

        // Fallback: look in any Qto set for same quantity name
        if (value === null) {
          const fallback = allQuantities.get(qdef.name)
          if (fallback !== undefined) value = fallback
        }

        if (value !== null) {
          const agg = report.quantities.get(qdef.name)!
          agg.sum += value
          agg.count++
        }
      }
    }

    // Scale up if sampled
    if (scaleFactor > 1) {
      for (const agg of report.quantities.values()) {
        agg.sum = agg.sum * scaleFactor
      }
    }

    // Count how many quantity types have at least one value
    for (const agg of report.quantities.values()) {
      if (agg.count > 0) report.foundCount++
    }

    totalFound += report.foundCount
    totalExpected += report.expectedCount

    reports.push(report)
  }
}

if (reports.length === 0) {
  console.error('No elements with quantity templates found')
  throw new Error('no quantities')
}

// ── Detailed Report ──────────────────────────────────────────────────
console.log('Scanned ' + totalElements + ' elements across ' + reports.length + ' type/Qto-set combinations')
console.log('')

for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  const pct = r.expectedCount > 0 ? Math.round((r.foundCount / r.expectedCount) * 100) : 0
  const completeness = r.foundCount + '/' + r.expectedCount + ' (' + pct + '%)'
  console.log('── ' + r.type + ' (' + r.entityCount + ') — ' + r.qtoSetName + ' ──')
  console.log('   Data completeness: ' + completeness)

  for (const [name, agg] of r.quantities) {
    if (agg.count > 0) {
      const avg = agg.sum / agg.count
      console.log('   ✓ ' + name + ': total=' + agg.sum.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (from ' + agg.count + ' entities)')
    } else {
      console.log('   ✗ ' + name + ': missing')
    }
  }
  console.log('')
}

// ── Completeness Summary ─────────────────────────────────────────────
console.log('── Data Completeness Summary ──')
console.log('Type                       | Count | Completeness | Qto Set')
console.log('---------------------------+-------+--------------+--------')
for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  const pct = r.expectedCount > 0 ? Math.round((r.foundCount / r.expectedCount) * 100) : 0
  const typeStr = (r.type + '                           ').slice(0, 27)
  const countStr = ('     ' + r.entityCount).slice(-5)
  const compStr = (r.foundCount + '/' + r.expectedCount + ' (' + pct + '%)            ').slice(0, 12)
  console.log(typeStr + '| ' + countStr + ' | ' + compStr + ' | ' + r.qtoSetName)
}

const overallPct = totalExpected > 0 ? Math.round((totalFound / totalExpected) * 100) : 0
console.log('')
console.log('Overall: ' + totalFound + '/' + totalExpected + ' quantity types populated (' + overallPct + '%)')

// ── Totals by Kind ───────────────────────────────────────────────────
console.log('')
console.log('── Aggregate Totals by Category ──')

const kindTotals = new Map<QuantityKind, { sum: number; unit: string }>()
for (const r of reports) {
  for (const agg of r.quantities.values()) {
    if (agg.count === 0) continue
    const existing = kindTotals.get(agg.kind)
    if (existing) {
      existing.sum += agg.sum
    } else {
      kindTotals.set(agg.kind, { sum: agg.sum, unit: agg.unit })
    }
  }
}
for (const [kind, tot] of kindTotals) {
  console.log('  ' + kind + ': ' + tot.sum.toFixed(2) + ' ' + tot.unit)
}

// ── Summary Table ────────────────────────────────────────────────────
console.log('')
console.log('── Summary ──')
console.log('Type                       | Count |    Area    |   Volume   |   Length')
console.log('---------------------------+-------+------------+------------+----------')
for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  let area = 0
  let volume = 0
  let length = 0
  for (const [name, agg] of r.quantities) {
    if (agg.count === 0) continue
    if (agg.kind === 'area') area += agg.sum
    if (agg.kind === 'volume') volume += agg.sum
    if (agg.kind === 'length') length += agg.sum
  }
  const typeStr = (r.type + '                           ').slice(0, 27)
  const countStr = ('     ' + r.entityCount).slice(-5)
  const areaStr = area > 0 ? (area.toFixed(1) + ' m²') : '-'
  const volStr = volume > 0 ? (volume.toFixed(2) + ' m³') : '-'
  const lenStr = length > 0 ? (length.toFixed(1) + ' m') : '-'
  console.log(typeStr + '| ' + countStr + ' | ' + ('          ' + areaStr).slice(-10) + ' | ' + ('          ' + volStr).slice(-10) + ' | ' + ('        ' + lenStr).slice(-8))
}

// ── Color by Completeness ────────────────────────────────────────────
const colorBatches: Array<{ entities: typeof entities; color: string }> = []
const greenEntities: BimEntity[] = []
const yellowEntities: BimEntity[] = []
const redEntities: BimEntity[] = []

for (const r of reports) {
  const pct = r.expectedCount > 0 ? Math.round((r.foundCount / r.expectedCount) * 100) : 0
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
  const qtyCols = Array.from(csvColumns).sort()
  bim.export.csv(allElements, {
    columns: ['Name', 'Type', 'ObjectType', 'GlobalId', ...qtyCols],
    filename: 'quantity-takeoff.csv'
  })
  console.log('')
  console.log('Exported ' + allElements.length + ' elements (' + (4 + qtyCols.length) + ' columns) to quantity-takeoff.csv')
}
