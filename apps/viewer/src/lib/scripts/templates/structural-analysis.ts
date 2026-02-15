export {} // module boundary (stripped by transpiler)

// Structural analysis — find structural elements, extract data, color them
bim.viewer.resetColors()

const walls = bim.query.byType('IfcWall')
const slabs = bim.query.byType('IfcSlab')
const columns = bim.query.byType('IfcColumn')
const beams = bim.query.byType('IfcBeam')

console.log('=== Structural Elements ===')
console.log('Walls: ' + walls.length)
console.log('Slabs: ' + slabs.length)
console.log('Columns: ' + columns.length)
console.log('Beams: ' + beams.length)

// Colorize structural elements by category (single batch call)
console.log('[debug] Calling bim.viewer.resetColors()...')
console.log('[debug] resetColors done')
const batches: Array<{ entities: BimEntity[]; color: string }> = []
if (walls.length > 0) batches.push({ entities: walls, color: '#e74c3c' })
if (slabs.length > 0) batches.push({ entities: slabs, color: '#3498db' })
if (columns.length > 0) batches.push({ entities: columns, color: '#f39c12' })
if (beams.length > 0) batches.push({ entities: beams, color: '#2ecc71' })
console.log('[debug] Built ' + batches.length + ' batches for colorizeAll')
if (batches.length > 0) {
  if (batches[0].entities[0]) {
    console.log('[debug] First entity ref: ' + JSON.stringify(batches[0].entities[0].ref))
  }
  console.log('[debug] Calling bim.viewer.colorizeAll...')
  bim.viewer.colorizeAll(batches)
  console.log('[debug] colorizeAll done')
}

console.log('\nColors: Walls=red, Slabs=blue, Columns=orange, Beams=green')

// Show wall properties summary
if (walls.length > 0) {
  console.log('\n=== Wall Details (first 5) ===')
  const sample = walls.slice(0, 5)
  for (const wall of sample) {
    console.log('\n' + (wall.Name || 'Unnamed') + ' (' + wall.Type + ')')
    const psets = bim.query.properties(wall)
    for (const pset of psets) {
      for (const p of pset.properties) {
        if (p.value !== null && p.value !== '') {
          console.log('  ' + pset.name + '.' + p.name + ' = ' + p.value)
        }
      }
    }
    const qsets = bim.query.quantities(wall)
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.value !== null) {
          console.log('  ' + qset.name + '.' + q.name + ' = ' + q.value)
        }
      }
    }
  }
}
