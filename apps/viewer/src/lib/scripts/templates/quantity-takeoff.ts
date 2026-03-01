export {} // module boundary (stripped by transpiler)

// ── Template-Driven Quantity Takeoff with Computation ────────────────
// Stakeholder: Cost Estimator / Project Manager
//
// Uses IFC4 standard Qto templates (modeled after IfcOpenShell's
// IFC4QtoBaseQuantities ruleset) to extract quantities for every
// element type. When quantities are missing, the script COMPUTES them
// from other available quantities using geometric derivation rules
// (e.g. Volume = Length × Width × Height, Area = Width × Height).
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

// ── Derivation Rules ─────────────────────────────────────────────────
// When a quantity is missing, compute it from other available quantities.
// Each rule: [target, [required inputs], compute function]
// Rules are tried in order; first successful match wins.

type Derivation = [string, string[], (v: Record<string, number>) => number]

const DERIVATIONS: Record<string, Derivation[]> = {
  // ── Walls ──────────────────────────────────────────────────
  'IfcWall': [
    ['GrossSideArea',      ['Length', 'Height'],                  v => v.Length * v.Height],
    ['GrossFootprintArea', ['Length', 'Width'],                   v => v.Length * v.Width],
    ['GrossVolume',        ['Length', 'Width', 'Height'],         v => v.Length * v.Width * v.Height],
    ['GrossVolume',        ['GrossSideArea', 'Width'],            v => v.GrossSideArea * v.Width],
    ['GrossVolume',        ['GrossFootprintArea', 'Height'],      v => v.GrossFootprintArea * v.Height],
    ['NetSideArea',        ['GrossSideArea'],                     v => v.GrossSideArea],  // approximation without openings
    ['NetFootprintArea',   ['GrossFootprintArea'],                v => v.GrossFootprintArea],
    ['NetVolume',          ['GrossVolume'],                       v => v.GrossVolume],
  ],

  // ── Slabs ──────────────────────────────────────────────────
  'IfcSlab': [
    ['GrossArea',    ['Length', 'Width'],                v => v.Length * v.Width],
    ['Perimeter',    ['Length', 'Width'],                v => 2 * (v.Length + v.Width)],
    ['GrossVolume',  ['GrossArea', 'Depth'],             v => v.GrossArea * v.Depth],
    ['GrossVolume',  ['Length', 'Width', 'Depth'],       v => v.Length * v.Width * v.Depth],
    ['NetArea',      ['GrossArea'],                      v => v.GrossArea],
    ['NetVolume',    ['GrossVolume'],                    v => v.GrossVolume],
  ],

  // ── Columns ────────────────────────────────────────────────
  'IfcColumn': [
    ['GrossVolume',      ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * v.Length],
    ['NetVolume',        ['GrossVolume'],                 v => v.GrossVolume],
    ['GrossSurfaceArea', ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * 2 + Math.sqrt(v.CrossSectionArea * 4 * Math.PI) * v.Length],
    ['NetSurfaceArea',   ['GrossSurfaceArea'],            v => v.GrossSurfaceArea],
  ],

  // ── Beams ──────────────────────────────────────────────────
  'IfcBeam': [
    ['GrossVolume',      ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * v.Length],
    ['NetVolume',        ['GrossVolume'],                 v => v.GrossVolume],
    ['GrossSurfaceArea', ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * 2 + Math.sqrt(v.CrossSectionArea * 4 * Math.PI) * v.Length],
    ['NetSurfaceArea',   ['GrossSurfaceArea'],            v => v.GrossSurfaceArea],
  ],

  // ── Members ────────────────────────────────────────────────
  'IfcMember': [
    ['GrossVolume',      ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * v.Length],
    ['NetVolume',        ['GrossVolume'],                 v => v.GrossVolume],
    ['GrossSurfaceArea', ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * 2 + Math.sqrt(v.CrossSectionArea * 4 * Math.PI) * v.Length],
    ['NetSurfaceArea',   ['GrossSurfaceArea'],            v => v.GrossSurfaceArea],
  ],

  // ── Doors ──────────────────────────────────────────────────
  'IfcDoor': [
    ['Area',      ['Width', 'Height'],  v => v.Width * v.Height],
    ['Perimeter', ['Width', 'Height'],  v => 2 * (v.Width + v.Height)],
  ],

  // ── Windows ────────────────────────────────────────────────
  'IfcWindow': [
    ['Area',      ['Width', 'Height'],  v => v.Width * v.Height],
    ['Perimeter', ['Width', 'Height'],  v => 2 * (v.Width + v.Height)],
  ],

  // ── Curtain Walls ──────────────────────────────────────────
  'IfcCurtainWall': [
    ['GrossSideArea', ['Length', 'Height'],  v => v.Length * v.Height],
    ['NetSideArea',   ['GrossSideArea'],     v => v.GrossSideArea],
  ],

  // ── Ramps ──────────────────────────────────────────────────
  'IfcRamp': [
    ['GrossArea',   ['Length', 'Width'],  v => v.Length * v.Width],
    ['NetArea',     ['GrossArea'],        v => v.GrossArea],
  ],

  // ── Footings ───────────────────────────────────────────────
  'IfcFooting': [
    ['CrossSectionArea', ['Width', 'Height'],                v => v.Width * v.Height],
    ['GrossVolume',      ['Length', 'Width', 'Height'],      v => v.Length * v.Width * v.Height],
    ['GrossVolume',      ['CrossSectionArea', 'Length'],     v => v.CrossSectionArea * v.Length],
    ['NetVolume',        ['GrossVolume'],                    v => v.GrossVolume],
    ['GrossSurfaceArea', ['Length', 'Width', 'Height'],      v => 2 * (v.Length * v.Width + v.Length * v.Height + v.Width * v.Height)],
    ['OuterSurfaceArea', ['GrossSurfaceArea'],               v => v.GrossSurfaceArea],
  ],

  // ── Piles ──────────────────────────────────────────────────
  'IfcPile': [
    ['GrossVolume', ['CrossSectionArea', 'Length'],  v => v.CrossSectionArea * v.Length],
    ['NetVolume',   ['GrossVolume'],                 v => v.GrossVolume],
  ],

  // ── Openings ───────────────────────────────────────────────
  'IfcOpeningElement': [
    ['Area',   ['Width', 'Height'],          v => v.Width * v.Height],
    ['Volume', ['Width', 'Height', 'Depth'], v => v.Width * v.Height * v.Depth],
    ['Volume', ['Area', 'Depth'],            v => v.Area * v.Depth],
  ],

  // ── Spaces ─────────────────────────────────────────────────
  'IfcSpace': [
    ['GrossVolume', ['GrossFloorArea', 'Height'],  v => v.GrossFloorArea * v.Height],
    ['NetVolume',   ['NetFloorArea', 'Height'],    v => v.NetFloorArea * v.Height],
    ['NetVolume',   ['GrossVolume'],               v => v.GrossVolume],
  ],
}

// Alias shared derivations for StandardCase subtypes
DERIVATIONS['IfcWallStandardCase'] = DERIVATIONS['IfcWall']
DERIVATIONS['IfcDoorStandardCase'] = DERIVATIONS['IfcDoor']
DERIVATIONS['IfcStairFlight'] = DERIVATIONS['IfcStair'] ?? []
DERIVATIONS['IfcRampFlight'] = DERIVATIONS['IfcRamp'] ?? []

/**
 * Given a set of known quantities for one entity, try to derive missing
 * ones using the derivation rules. Runs multiple passes so that a
 * quantity computed in pass 1 can feed a derivation in pass 2.
 */
function deriveQuantities(
  ifcType: string,
  known: Map<string, number>,
  expectedNames: string[],
): Map<string, number> {
  const rules = DERIVATIONS[ifcType]
  if (!rules) return new Map()

  const derived = new Map<string, number>()
  const all = new Map(known) // working copy: known + derived so far

  // Up to 3 passes to resolve chained derivations
  for (let pass = 0; pass < 3; pass++) {
    let progress = false
    for (const [target, inputs, compute] of rules) {
      // Skip if already known or already derived
      if (all.has(target)) continue
      // Skip if not an expected quantity for this type
      if (!expectedNames.includes(target)) continue
      // Check all inputs are available
      if (!inputs.every(inp => all.has(inp))) continue

      const vals: Record<string, number> = {}
      for (const inp of inputs) vals[inp] = all.get(inp)!
      const result = compute(vals)
      if (result > 0 && isFinite(result)) {
        derived.set(target, result)
        all.set(target, result)
        progress = true
      }
    }
    if (!progress) break
  }

  return derived
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
  foundAfterDerivation: number
  quantities: Map<string, QuantityAgg>
}

console.log('═══════════════════════════════════════════')
console.log('  QUANTITY TAKEOFF (Template + Computation)')
console.log('═══════════════════════════════════════════')
console.log('')

// ── Process each entity type ─────────────────────────────────────────
const reports: TypeReport[] = []
let totalElements = 0
let totalFromIfc = 0
let totalComputed = 0
let totalExpected = 0
const csvColumns = new Set<string>()

for (const ifcType of ALL_TYPES) {
  const entities = bim.query.byType(ifcType)
  if (entities.length === 0) continue

  const rule = ruleLookup.get(ifcType)!

  for (const qtoSetDef of rule.qtoSets) {
    const expectedNames = qtoSetDef.quantities.map(q => q.name)
    const report: TypeReport = {
      type: ifcType,
      entityCount: entities.length,
      qtoSetName: qtoSetDef.name,
      expectedCount: qtoSetDef.quantities.length,
      foundFromIfc: 0,
      foundAfterDerivation: 0,
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
      const qsets = bim.query.quantities(entity)

      // Collect all available quantities from the IFC file
      const ifcValues = new Map<string, number>()
      for (const qs of qsets) {
        for (const q of qs.quantities) {
          if (q.value !== null && q.value !== 0) {
            ifcValues.set(q.name, q.value)
            csvColumns.add(qs.name + '.' + q.name)
          }
        }
      }

      // Derive missing quantities from available ones
      const derived = deriveQuantities(ifcType, ifcValues, expectedNames)

      // Track computed columns for CSV export
      for (const name of derived.keys()) {
        csvColumns.add(qtoSetDef.name + '.' + name + ' (computed)')
      }

      // Aggregate: IFC values first, then computed values
      for (const qdef of qtoSetDef.quantities) {
        const agg = report.quantities.get(qdef.name)!
        const ifcVal = ifcValues.get(qdef.name)
        const derivedVal = derived.get(qdef.name)

        if (ifcVal !== undefined) {
          agg.sum += ifcVal
          agg.count++
        } else if (derivedVal !== undefined) {
          agg.computedSum += derivedVal
          agg.computedCount++
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
      if (agg.count > 0 || agg.computedCount > 0) report.foundAfterDerivation++
    }

    totalFromIfc += report.foundFromIfc
    totalComputed += (report.foundAfterDerivation - report.foundFromIfc)
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
  const ifcPct = r.expectedCount > 0 ? Math.round((r.foundFromIfc / r.expectedCount) * 100) : 0
  const totalPct = r.expectedCount > 0 ? Math.round((r.foundAfterDerivation / r.expectedCount) * 100) : 0
  const computed = r.foundAfterDerivation - r.foundFromIfc

  console.log('── ' + r.type + ' (' + r.entityCount + ') — ' + r.qtoSetName + ' ──')
  console.log('   From IFC: ' + r.foundFromIfc + '/' + r.expectedCount + ' (' + ifcPct + '%)' +
    (computed > 0 ? '  +' + computed + ' computed → ' + r.foundAfterDerivation + '/' + r.expectedCount + ' (' + totalPct + '%)' : ''))

  for (const [name, agg] of r.quantities) {
    const total = agg.sum + agg.computedSum
    const totalCount = agg.count + agg.computedCount
    if (agg.count > 0 && agg.computedCount === 0) {
      // Purely from IFC
      const avg = agg.sum / agg.count
      console.log('   ✓ ' + name + ': total=' + agg.sum.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (' + agg.count + ' from IFC)')
    } else if (agg.computedCount > 0 && agg.count === 0) {
      // Purely computed
      const avg = agg.computedSum / agg.computedCount
      console.log('   ≈ ' + name + ': total=' + agg.computedSum.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (' + agg.computedCount + ' computed)')
    } else if (agg.count > 0 && agg.computedCount > 0) {
      // Mix of IFC + computed
      const avg = total / totalCount
      console.log('   ✓ ' + name + ': total=' + total.toFixed(2) + ' ' + agg.unit + '  avg=' + avg.toFixed(2) + '  (' + agg.count + ' IFC + ' + agg.computedCount + ' computed)')
    } else {
      console.log('   ✗ ' + name + ': missing')
    }
  }
  console.log('')
}

// ── Completeness Summary ─────────────────────────────────────────────
console.log('── Completeness Summary ──')
console.log('Type                       | Count | From IFC    | + Computed  | Total')
console.log('---------------------------+-------+-------------+-------------+----------')
for (const r of reports.sort((a, b) => b.entityCount - a.entityCount)) {
  const ifcPct = r.expectedCount > 0 ? Math.round((r.foundFromIfc / r.expectedCount) * 100) : 0
  const totalPct = r.expectedCount > 0 ? Math.round((r.foundAfterDerivation / r.expectedCount) * 100) : 0
  const computed = r.foundAfterDerivation - r.foundFromIfc
  const typeStr = (r.type + '                           ').slice(0, 27)
  const countStr = ('     ' + r.entityCount).slice(-5)
  const ifcStr = (r.foundFromIfc + '/' + r.expectedCount + ' (' + ifcPct + '%)           ').slice(0, 11)
  const compStr = computed > 0 ? ('+' + computed + '           ').slice(0, 11) : '—          '
  const totStr = (r.foundAfterDerivation + '/' + r.expectedCount + ' (' + totalPct + '%)').slice(0, 11)
  console.log(typeStr + '| ' + countStr + ' | ' + ifcStr + ' | ' + compStr + ' | ' + totStr)
}

const ifcPctTotal = totalExpected > 0 ? Math.round((totalFromIfc / totalExpected) * 100) : 0
const finalTotal = totalFromIfc + totalComputed
const finalPct = totalExpected > 0 ? Math.round((finalTotal / totalExpected) * 100) : 0
console.log('')
console.log('From IFC: ' + totalFromIfc + '/' + totalExpected + ' (' + ifcPctTotal + '%)' +
  '  +' + totalComputed + ' computed → ' + finalTotal + '/' + totalExpected + ' (' + finalPct + '%)')

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
console.log('── Summary (IFC + computed) ──')
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
  const pct = r.expectedCount > 0 ? Math.round((r.foundAfterDerivation / r.expectedCount) * 100) : 0
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
  console.log('Color key: green=≥75% complete, orange=25-74%, red=<25% (after computation)')
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
