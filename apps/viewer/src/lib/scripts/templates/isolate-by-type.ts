export {} // module boundary (stripped by transpiler)

// Isolate entities by type — change the type below to explore
// Common types: IfcWall, IfcSlab, IfcDoor, IfcWindow, IfcColumn, IfcBeam,
// IfcStair, IfcRoof, IfcCovering, IfcFurnishingElement
const TARGET_TYPE = 'IfcWall'

const entities = bim.query.byType(TARGET_TYPE)
if (entities.length === 0) {
  console.log('No ' + TARGET_TYPE + ' found. Available types:')
  const all = bim.query.all()
  const types: Record<string, number> = {}
  for (const e of all) types[e.Type] = (types[e.Type] || 0) + 1
  for (const [t, c] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + t + ': ' + c)
  }
} else {
  console.log('[debug] First entity ref: ' + JSON.stringify(entities[0].ref))
  console.log('[debug] Calling bim.viewer.isolate with ' + entities.length + ' entities...')
  bim.viewer.isolate(entities)
  console.log('[debug] isolate done')
  console.log('[debug] Calling bim.viewer.colorize...')
  bim.viewer.colorize(entities, '#e74c3c')
  console.log('[debug] colorize done')
  console.log('Isolated ' + entities.length + ' ' + TARGET_TYPE + ' entities')
  console.log('\nNames:')
  const names: Record<string, number> = {}
  for (const e of entities) {
    const key = e.Name || 'Unnamed'
    names[key] = (names[key] || 0) + 1
  }
  for (const [name, count] of Object.entries(names).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + name + (count > 1 ? ' (x' + count + ')' : ''))
  }
}
