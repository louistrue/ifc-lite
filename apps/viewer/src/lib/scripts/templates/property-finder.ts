export {} // module boundary (stripped by transpiler)

// Property finder — scan all walls for properties
const walls = bim.query.byType('IfcWall')
console.log('Scanning ' + walls.length + ' walls for properties...\n')

// Collect all unique property names across walls
const propIndex: Record<string, { count: number; sample: string | number | boolean | null }> = {}
let scanned = 0
for (const wall of walls) {
  const psets = bim.query.properties(wall)
  for (const pset of psets) {
    for (const p of pset.properties) {
      const key = pset.name + '.' + p.name
      if (!propIndex[key]) {
        propIndex[key] = { count: 0, sample: null }
      }
      propIndex[key].count++
      if (propIndex[key].sample === null && p.value !== null && p.value !== '') {
        propIndex[key].sample = p.value
      }
    }
  }
  scanned++
}

// Print all discovered property paths sorted by frequency
const props = Object.entries(propIndex).sort((a, b) => b[1].count - a[1].count)
console.log('=== Properties found across ' + scanned + ' walls ===')
console.log('(showing Pset.Property: count, sample value)\n')
for (const [key, info] of props) {
  const sample = info.sample !== null ? ' \u2192 "' + info.sample + '"' : ''
  console.log(key + ': ' + info.count + '/' + scanned + sample)
}

// Also show quantity paths
console.log('\n=== Quantities ===')
const qtyIndex: Record<string, number | null> = {}
for (const wall of walls.slice(0, 10)) {
  const qsets = bim.query.quantities(wall)
  for (const qset of qsets) {
    for (const q of qset.quantities) {
      const key = qset.name + '.' + q.name
      if (!(key in qtyIndex)) qtyIndex[key] = q.value
    }
  }
}
for (const [key, sample] of Object.entries(qtyIndex)) {
  console.log(key + ' \u2192 ' + sample)
}
