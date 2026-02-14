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
    description: 'List loaded models and count entities by type',
    code: `// Model overview — list models and count entities by IFC type
const models = bim.model.list()
console.log('Models:', models.length)
for (const m of models) {
  console.log('  ' + m.name + ' (' + m.schemaVersion + ', ' + m.entityCount + ' entities)')
}

const all = bim.query.all()
const counts = {}
for (const e of all) {
  counts[e.type] = (counts[e.type] || 0) + 1
}
console.log('\\nEntity types:')
for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + type + ': ' + count)
}`,
  },
  {
    name: 'Color walls by type',
    description: 'Find all walls and colorize them red',
    code: `// Find all walls and colorize them red
const walls = bim.query.byType('IfcWall')
bim.viewer.colorize(walls, '#e74c3c')
console.log('Colored ' + walls.length + ' walls')`,
  },
  {
    name: 'Color by IFC type',
    description: 'Assign unique colors to each IFC type',
    code: `// Assign a unique color to each IFC type
const colors = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
]
const all = bim.query.all()
const types = {}
for (const e of all) {
  if (!types[e.type]) types[e.type] = []
  types[e.type].push(e)
}
let i = 0
for (const [type, entities] of Object.entries(types)) {
  const color = colors[i % colors.length]
  bim.viewer.colorize(entities, color)
  console.log(type + ' (' + entities.length + '): ' + color)
  i++
}`,
  },
  {
    name: 'Inspect entity properties',
    description: 'Print all properties of the first entity',
    code: `// Inspect all property sets of the first entity
const all = bim.query.all()
if (all.length === 0) {
  console.log('No entities found')
} else {
  const entity = all[0]
  console.log('Entity: ' + entity.name + ' (' + entity.type + ')')
  console.log('GlobalId: ' + entity.globalId)
  console.log('')

  // Get property sets
  const psets = entity.properties()
  if (psets.length === 0) {
    console.log('No property sets')
  }
  for (const pset of psets) {
    console.log('--- ' + pset.name + ' ---')
    for (const p of pset.properties) {
      console.log('  ' + p.name + ': ' + p.value)
    }
  }

  // Get quantity sets
  const qsets = entity.quantities()
  for (const qset of qsets) {
    console.log('--- ' + qset.name + ' (quantities) ---')
    for (const q of qset.quantities) {
      console.log('  ' + q.name + ': ' + q.value)
    }
  }
}`,
  },
  {
    name: 'Export doors to CSV',
    description: 'Export all doors with name and global ID',
    code: `// Export all doors as CSV
const doors = bim.query.byType('IfcDoor')
if (doors.length === 0) {
  console.log('No doors found')
} else {
  const csv = bim.export.csv(doors, { columns: ['name', 'type', 'globalId'] })
  console.log(csv)
  console.log('\\nExported ' + doors.length + ' doors')
}`,
  },
  {
    name: 'Hide structural elements',
    description: 'Hide beams, columns, and footings',
    code: `// Hide structural elements
const beams = bim.query.byType('IfcBeam')
const columns = bim.query.byType('IfcColumn')
const footings = bim.query.byType('IfcFooting')
const structural = [...beams, ...columns, ...footings]
if (structural.length > 0) {
  bim.viewer.hide(structural)
  console.log('Hidden ' + structural.length + ' structural elements')
  console.log('  Beams: ' + beams.length)
  console.log('  Columns: ' + columns.length)
  console.log('  Footings: ' + footings.length)
} else {
  console.log('No structural elements found')
}`,
  },
  {
    name: 'Isolate walls',
    description: 'Show only walls, hiding everything else',
    code: `// Isolate walls — hide everything else
const walls = bim.query.byType('IfcWall')
if (walls.length > 0) {
  bim.viewer.isolate(walls)
  console.log('Isolated ' + walls.length + ' walls')
} else {
  console.log('No walls found')
}`,
  },
  {
    name: 'Reset view',
    description: 'Remove all color overrides and show all entities',
    code: `// Reset colors and visibility
bim.viewer.resetColors()
bim.viewer.resetVisibility()
console.log('View reset')`,
  },
];
