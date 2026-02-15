export {} // module boundary (stripped by transpiler)

// Color entities by IFC class using batch colorize
bim.viewer.resetColors()
const palette = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  '#e91e63', '#00bcd4', '#8bc34a', '#ff9800',
]

// Group entities by type
const all = bim.query.all()
const groups: Record<string, BimEntity[]> = {}
for (const e of all) {
  if (!groups[e.Type]) groups[e.Type] = []
  groups[e.Type].push(e)
}

// Build batch colorize entries
const sorted: [string, BimEntity[]][] = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
const batches: Array<{ entities: BimEntity[]; color: string }> = []
let i = 0
for (const [type, entities] of sorted) {
  const color = palette[i % palette.length]
  batches.push({ entities, color })
  console.log(type + ' (' + entities.length + '): ' + color)
  i++
}

// Apply all colors in a single call
bim.viewer.colorizeAll(batches)
console.log('\nColored ' + all.length + ' entities across ' + sorted.length + ' classes')
