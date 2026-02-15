export {} // module boundary (stripped by transpiler)

// Door & window schedule — list all with extracted quantities
const doors = bim.query.byType('IfcDoor')
const windows = bim.query.byType('IfcWindow')

console.log('=== Door Schedule (' + doors.length + ') ===')
if (doors.length === 0) {
  console.log('No doors found')
} else {
  for (const door of doors) {
    const label = door.Name || door.ObjectType || 'Door'
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

console.log('\n=== Window Schedule (' + windows.length + ') ===')
if (windows.length === 0) {
  console.log('No windows found')
} else {
  for (const win of windows) {
    const label = win.Name || win.ObjectType || 'Window'
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
const batches: Array<{ entities: BimEntity[]; color: string }> = []
if (doors.length > 0) batches.push({ entities: doors, color: '#e74c3c' })
if (windows.length > 0) batches.push({ entities: windows, color: '#3498db' })
if (batches.length > 0) {
  bim.viewer.colorizeAll(batches)
  console.log('\nDoors=red, Windows=blue')
}
