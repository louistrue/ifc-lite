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
console.log('\\nEntity types (' + all.length + ' total):')
for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + type + ': ' + count)
}`,
  },
  {
    name: 'Color walls red',
    description: 'Find all walls (including IfcWallStandardCase) and colorize them',
    code: `// Find all walls and colorize them red
// byType('IfcWall') automatically includes subtypes like IfcWallStandardCase
const walls = bim.query.byType('IfcWall')
if (walls.length > 0) {
  bim.viewer.colorize(walls, '#e74c3c')
  console.log('Colored ' + walls.length + ' walls red')
} else {
  console.log('No walls found in the model')
}`,
  },
  {
    name: 'Color by IFC type',
    description: 'Assign unique colors to each IFC type',
    code: `// Assign a unique color to each IFC type
bim.viewer.resetColors()
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
    description: 'Print all properties of the first wall (or first entity)',
    code: `// Inspect properties and quantities of an entity
// Try walls first, fall back to any entity
let entities = bim.query.byType('IfcWall')
if (entities.length === 0) entities = bim.query.all()

if (entities.length === 0) {
  console.log('No entities found')
} else {
  const entity = entities[0]
  console.log('Entity: ' + entity.name + ' (' + entity.type + ')')
  console.log('GlobalId: ' + entity.globalId)
  console.log('')

  // Use bim.query.properties() to get property sets
  const psets = bim.query.properties(entity)
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
  const qsets = bim.query.quantities(entity)
  for (const qset of qsets) {
    console.log('--- ' + qset.name + ' (quantities) ---')
    for (const q of qset.quantities) {
      console.log('  ' + q.name + ': ' + q.value)
    }
  }
}`,
  },
  {
    name: 'Export to CSV',
    description: 'Export walls (or all entities) with name and global ID',
    code: `// Export entities as CSV (triggers file download)
let entities = bim.query.byType('IfcWall')
let label = 'walls'
if (entities.length === 0) {
  entities = bim.query.all()
  label = 'entities'
}
if (entities.length === 0) {
  console.log('No entities found')
} else {
  const csv = bim.export.csv(entities, {
    columns: ['name', 'type', 'globalId'],
    filename: 'export.csv'
  })
  console.log('Exported ' + entities.length + ' ' + label + ' to export.csv')
}`,
  },
  {
    name: 'Hide openings',
    description: 'Hide opening elements to see clean walls',
    code: `// Hide opening elements (IfcOpeningElement / IfcOpeningStandardCase)
const openings = bim.query.byType('IfcOpeningElement')
if (openings.length > 0) {
  bim.viewer.hide(openings)
  console.log('Hidden ' + openings.length + ' openings')
} else {
  console.log('No openings found')
}`,
  },
  {
    name: 'Isolate walls',
    description: 'Show only walls, hiding everything else',
    code: `// Isolate walls — hide everything else
// byType('IfcWall') automatically includes IfcWallStandardCase
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
