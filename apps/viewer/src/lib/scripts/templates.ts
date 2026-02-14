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
    name: 'Color walls by type',
    description: 'Find all walls and colorize them red',
    code: `// Find all walls and colorize them red
const walls = bim.query.byType('IfcWall')
bim.viewer.colorize(walls, '#e74c3c')
console.log(\`Colored \${walls.length} walls\`)`,
  },
  {
    name: 'List entity types',
    description: 'Count entities by IFC type',
    code: `// Count entities grouped by IFC type
const all = bim.query.all()
const counts = {}
for (const entity of all) {
  const t = entity.type
  counts[t] = (counts[t] || 0) + 1
}
// Sort by count descending
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
for (const [type, count] of sorted) {
  console.log(\`\${type}: \${count}\`)
}`,
  },
  {
    name: 'Export doors to CSV',
    description: 'Export all doors with name and global ID',
    code: `// Export all doors as CSV
const doors = bim.query.byType('IfcDoor')
const csv = bim.export.csv(doors, { columns: ['name', 'type', 'globalId'] })
console.log(csv)`,
  },
  {
    name: 'Hide structural elements',
    description: 'Hide beams, columns, and footings',
    code: `// Hide structural elements
const beams = bim.query.byType('IfcBeam')
const columns = bim.query.byType('IfcColumn')
const footings = bim.query.byType('IfcFooting')
bim.viewer.hide([...beams, ...columns, ...footings])
console.log('Hidden structural elements')`,
  },
  {
    name: 'Inspect selected entity',
    description: 'Print properties of the currently selected entity',
    code: `// Inspect the first selected entity
const models = bim.model.list()
if (models.length === 0) {
  console.log('No models loaded')
} else {
  const all = bim.query.all()
  if (all.length > 0) {
    const entity = all[0]
    console.log('Name:', entity.name)
    console.log('Type:', entity.type)
    console.log('GlobalId:', entity.globalId)
    const props = entity.properties()
    for (const pset of props) {
      console.log('---', pset.name, '---')
      for (const p of pset.properties) {
        console.log(\`  \${p.name}: \${p.value}\`)
      }
    }
  }
}`,
  },
];
