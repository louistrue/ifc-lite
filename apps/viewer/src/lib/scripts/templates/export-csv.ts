export {} // module boundary (stripped by transpiler)

// Export entities as CSV with properties (triggers file download)
let entities = bim.query.byType('IfcWall')
let label = 'walls'

if (entities.length === 0) {
  entities = bim.query.all().slice(0, 500) // Limit for performance
  label = 'entities'
}

if (entities.length === 0) {
  console.log('No entities found')
} else {
  // Export basic IFC attributes (PascalCase per IFC schema)
  const csv = bim.export.csv(entities, {
    columns: ['Name', 'Type', 'GlobalId'],
    filename: 'ifc-export.csv'
  })
  console.log('Exported ' + entities.length + ' ' + label + ' to ifc-export.csv')

  // Also print summary to console
  console.log('\n=== Preview (first 10) ===')
  console.log('Name | Type | GlobalId')
  console.log('-'.repeat(60))
  for (const e of entities.slice(0, 10)) {
    console.log((e.Name || '-') + ' | ' + e.Type + ' | ' + e.GlobalId)
  }
  if (entities.length > 10) {
    console.log('... and ' + (entities.length - 10) + ' more')
  }
}
