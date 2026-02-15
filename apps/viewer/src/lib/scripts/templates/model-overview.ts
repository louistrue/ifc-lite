export {} // module boundary (stripped by transpiler)

// Model overview — comprehensive model summary
console.log('[debug] Script started — model overview')
const models = bim.model.list()
console.log('=== Models (' + models.length + ') ===')
for (const m of models) {
  console.log(m.name + ' — ' + m.schemaVersion + ', ' + m.entityCount + ' entities, ' + (m.fileSize / 1024 / 1024).toFixed(1) + ' MB')
}

// Count entities by type, sorted by frequency
const all = bim.query.all()
const counts: Record<string, number> = {}
for (const e of all) {
  counts[e.Type] = (counts[e.Type] || 0) + 1
}
const sorted: [string, number][] = Object.entries(counts).sort((a, b) => b[1] - a[1])

console.log('\n=== Entity Types (' + sorted.length + ' types, ' + all.length + ' total) ===')
for (const [type, count] of sorted) {
  const pct = (count / all.length * 100).toFixed(1)
  const bar = '#'.repeat(Math.ceil(count / all.length * 30))
  console.log(type + ': ' + count + ' (' + pct + '%)  ' + bar)
}

// Structural summary
const walls = bim.query.byType('IfcWall')
const slabs = bim.query.byType('IfcSlab')
const columns = bim.query.byType('IfcColumn')
const doors = bim.query.byType('IfcDoor')
const windows = bim.query.byType('IfcWindow')
console.log('\n=== Quick Stats ===')
console.log('Walls: ' + walls.length + ', Slabs: ' + slabs.length + ', Columns: ' + columns.length)
console.log('Doors: ' + doors.length + ', Windows: ' + windows.length)
