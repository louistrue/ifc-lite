/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in script templates for the script editor
 */

export interface ScriptTemplate {
  name: string;
  description: string;
  code: string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    name: 'Model overview',
    description: 'Summarize models, count entities by type, compute statistics',
    code: `// Model overview — comprehensive model summary
const models = bim.model.list()
console.log('=== Models (' + models.length + ') ===')
for (const m of models) {
  console.log(m.name + ' — ' + m.schemaVersion + ', ' + m.entityCount + ' entities, ' + (m.fileSize / 1024 / 1024).toFixed(1) + ' MB')
}

// Count entities by type, sorted by frequency
const all = bim.query.all()
const counts = {}
for (const e of all) {
  counts[e.type] = (counts[e.type] || 0) + 1
}
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])

console.log('\\n=== Entity Types (' + sorted.length + ' types, ' + all.length + ' total) ===')
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
console.log('\\n=== Quick Stats ===')
console.log('Walls: ' + walls.length + ', Slabs: ' + slabs.length + ', Columns: ' + columns.length)
console.log('Doors: ' + doors.length + ', Windows: ' + windows.length)`,
  },
  {
    name: 'Color by IFC type',
    description: 'Assign unique colors to each product type (batch colorize)',
    code: `// Color entities by IFC type using batch colorize
bim.viewer.resetColors()
const palette = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
  '#e91e63', '#00bcd4', '#8bc34a', '#ff9800',
]

// Group entities by type
const all = bim.query.all()
const groups = {}
for (const e of all) {
  if (!groups[e.type]) groups[e.type] = []
  groups[e.type].push(e)
}

// Build batch colorize entries
const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
const batches = []
let i = 0
for (const [type, entities] of sorted) {
  const color = palette[i % palette.length]
  batches.push({ entities, color })
  console.log(type + ' (' + entities.length + '): ' + color)
  i++
}

// Apply all colors in a single call
bim.viewer.colorizeAll(batches)
console.log('\\nColored ' + all.length + ' entities across ' + sorted.length + ' types')`,
  },
  {
    name: 'Structural analysis',
    description: 'Analyze walls, slabs, columns with properties and color by material',
    code: `// Structural analysis — find structural elements, extract data, color them
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
const batches = []
if (walls.length > 0) batches.push({ entities: walls, color: '#e74c3c' })
if (slabs.length > 0) batches.push({ entities: slabs, color: '#3498db' })
if (columns.length > 0) batches.push({ entities: columns, color: '#f39c12' })
if (beams.length > 0) batches.push({ entities: beams, color: '#2ecc71' })
if (batches.length > 0) bim.viewer.colorizeAll(batches)

console.log('\\nColors: Walls=red, Slabs=blue, Columns=orange, Beams=green')

// Show wall properties summary
if (walls.length > 0) {
  console.log('\\n=== Wall Details (first 5) ===')
  const sample = walls.slice(0, 5)
  for (const wall of sample) {
    console.log('\\n' + (wall.name || 'Unnamed') + ' (' + wall.type + ')')
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
}`,
  },
  {
    name: 'Property finder',
    description: 'Search for entities with specific property values',
    code: `// Property finder — scan all walls for fire-related properties
const walls = bim.query.byType('IfcWall')
console.log('Scanning ' + walls.length + ' walls for properties...\\n')

// Collect all unique property names across walls
const propIndex = {}
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
      if (!propIndex[key].sample && p.value !== null && p.value !== '') {
        propIndex[key].sample = p.value
      }
    }
  }
  scanned++
}

// Print all discovered property paths sorted by frequency
const props = Object.entries(propIndex).sort((a, b) => b[1].count - a[1].count)
console.log('=== Properties found across ' + scanned + ' walls ===')
console.log('(showing Pset.Property: count, sample value)\\n')
for (const [key, info] of props) {
  const sample = info.sample !== null ? ' → "' + info.sample + '"' : ''
  console.log(key + ': ' + info.count + '/' + scanned + sample)
}

// Also show quantity paths
console.log('\\n=== Quantities ===')
const qtyIndex = {}
for (const wall of walls.slice(0, 10)) {
  const qsets = bim.query.quantities(wall)
  for (const qset of qsets) {
    for (const q of qset.quantities) {
      const key = qset.name + '.' + q.name
      if (!qtyIndex[key]) qtyIndex[key] = q.value
    }
  }
}
for (const [key, sample] of Object.entries(qtyIndex)) {
  console.log(key + ' → ' + sample)
}`,
  },
  {
    name: 'Export to CSV',
    description: 'Export entity data with properties to CSV file download',
    code: `// Export entities as CSV with properties (triggers file download)
const walls = bim.query.byType('IfcWall')
let entities = walls
let label = 'walls'

if (entities.length === 0) {
  entities = bim.query.all().slice(0, 500) // Limit for performance
  label = 'entities'
}

if (entities.length === 0) {
  console.log('No entities found')
} else {
  // Export basic attributes
  const csv = bim.export.csv(entities, {
    columns: ['name', 'type', 'globalId'],
    filename: 'ifc-export.csv'
  })
  console.log('Exported ' + entities.length + ' ' + label + ' to ifc-export.csv')

  // Also print summary to console
  console.log('\\n=== Preview (first 10) ===')
  console.log('Name | Type | GlobalId')
  console.log('-'.repeat(60))
  for (const e of entities.slice(0, 10)) {
    console.log((e.name || '-') + ' | ' + e.type + ' | ' + e.globalId)
  }
  if (entities.length > 10) {
    console.log('... and ' + (entities.length - 10) + ' more')
  }
}`,
  },
  {
    name: 'Isolate by type',
    description: 'Isolate walls, doors, or windows — change the type to explore',
    code: `// Isolate entities by type — change the type below to explore
// Common types: IfcWall, IfcSlab, IfcDoor, IfcWindow, IfcColumn, IfcBeam,
// IfcStair, IfcRoof, IfcCovering, IfcFurnishingElement
const TARGET_TYPE = 'IfcWall'

const entities = bim.query.byType(TARGET_TYPE)
if (entities.length === 0) {
  console.log('No ' + TARGET_TYPE + ' found. Available types:')
  const all = bim.query.all()
  const types = {}
  for (const e of all) types[e.type] = (types[e.type] || 0) + 1
  for (const [t, c] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + t + ': ' + c)
  }
} else {
  bim.viewer.isolate(entities)
  bim.viewer.colorize(entities, '#e74c3c')
  console.log('Isolated ' + entities.length + ' ' + TARGET_TYPE + ' entities')
  console.log('\\nNames:')
  const names = {}
  for (const e of entities) {
    const key = e.name || 'Unnamed'
    names[key] = (names[key] || 0) + 1
  }
  for (const [name, count] of Object.entries(names).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + name + (count > 1 ? ' (x' + count + ')' : ''))
  }
}`,
  },
  {
    name: 'Door & window schedule',
    description: 'Generate a schedule listing all doors and windows with dimensions',
    code: `// Door & window schedule — list all with extracted quantities
const doors = bim.query.byType('IfcDoor')
const windows = bim.query.byType('IfcWindow')

console.log('=== Door Schedule (' + doors.length + ') ===')
if (doors.length === 0) {
  console.log('No doors found')
} else {
  for (const door of doors) {
    const label = door.name || door.objectType || 'Door'
    const qsets = bim.query.quantities(door)
    let dims = ''
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.name.toLowerCase().includes('width') || q.name.toLowerCase().includes('height') || q.name.toLowerCase().includes('area')) {
          dims += q.name + '=' + q.value + ' '
        }
      }
    }
    console.log('  ' + label + (dims ? '  [' + dims.trim() + ']' : ''))
  }
}

console.log('\\n=== Window Schedule (' + windows.length + ') ===')
if (windows.length === 0) {
  console.log('No windows found')
} else {
  for (const win of windows) {
    const label = win.name || win.objectType || 'Window'
    const qsets = bim.query.quantities(win)
    let dims = ''
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.name.toLowerCase().includes('width') || q.name.toLowerCase().includes('height') || q.name.toLowerCase().includes('area')) {
          dims += q.name + '=' + q.value + ' '
        }
      }
    }
    console.log('  ' + label + (dims ? '  [' + dims.trim() + ']' : ''))
  }
}

// Highlight doors red and windows blue
const batches = []
if (doors.length > 0) batches.push({ entities: doors, color: '#e74c3c' })
if (windows.length > 0) batches.push({ entities: windows, color: '#3498db' })
if (batches.length > 0) {
  bim.viewer.colorizeAll(batches)
  console.log('\\nDoors=red, Windows=blue')
}`,
  },
  {
    name: 'Reset view',
    description: 'Remove all color overrides and show all entities',
    code: `// Reset colors and visibility
bim.viewer.resetColors()
bim.viewer.resetVisibility()
console.log('View reset — all colors and visibility restored')`,
  },
];
