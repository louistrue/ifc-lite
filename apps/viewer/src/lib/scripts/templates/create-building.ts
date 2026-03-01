export {} // module boundary for type checking
/**
 * Create IFC from scratch — generate a simple building
 *
 * Demonstrates the bim.create API: build a complete IFC file with
 * walls, slab, columns, beams, stair, roof, property sets, and quantities.
 */

// 1. Create a new IFC project
const h = bim.create.project({
  Name: 'Sample Building',
  Description: 'Created via ifc-lite scripting',
  Author: 'ifc-lite',
});

// 2. Add a ground-floor storey
const gf = bim.create.addStorey(h, { Name: 'Ground Floor', Elevation: 0 });

// 3. Add exterior walls (5m × 8m footprint, 3m high, 0.2m thick)
const w1 = bim.create.addWall(h, gf, {
  Name: 'South Wall',
  Start: [0, 0, 0], End: [5, 0, 0],
  Thickness: 0.2, Height: 3,
  Openings: [
    { Name: 'Window', Width: 1.2, Height: 1.5, Position: [2, 0, 0.9] },
  ],
});
const w2 = bim.create.addWall(h, gf, {
  Name: 'East Wall',
  Start: [5, 0, 0], End: [5, 8, 0],
  Thickness: 0.2, Height: 3,
  Openings: [
    { Name: 'Door', Width: 0.9, Height: 2.1, Position: [0, 3, 0] },
  ],
});
bim.create.addWall(h, gf, {
  Name: 'North Wall',
  Start: [5, 8, 0], End: [0, 8, 0],
  Thickness: 0.2, Height: 3,
});
bim.create.addWall(h, gf, {
  Name: 'West Wall',
  Start: [0, 8, 0], End: [0, 0, 0],
  Thickness: 0.2, Height: 3,
});

// 4. Floor slab
const slab = bim.create.addSlab(h, gf, {
  Name: 'Ground Floor Slab',
  Position: [0, 0, -0.3],
  Thickness: 0.3, Width: 5, Depth: 8,
});

// 5. Columns at corners
for (const [x, y] of [[0.1, 0.1], [4.7, 0.1], [0.1, 7.7], [4.7, 7.7]]) {
  bim.create.addColumn(h, gf, {
    Name: 'Column',
    Position: [x, y, 0],
    Width: 0.3, Depth: 0.3, Height: 3,
  });
}

// 6. Beams along the top
bim.create.addBeam(h, gf, {
  Name: 'Ridge Beam',
  Start: [0, 0, 3], End: [5, 0, 3],
  Width: 0.2, Height: 0.4,
});
bim.create.addBeam(h, gf, {
  Name: 'Ridge Beam',
  Start: [0, 8, 3], End: [5, 8, 3],
  Width: 0.2, Height: 0.4,
});

// 7. Stair
bim.create.addStair(h, gf, {
  Name: 'Main Stair',
  Position: [1, 2, 0],
  NumberOfRisers: 17,
  RiserHeight: 0.176,
  TreadLength: 0.28,
  Width: 1.0,
});

// 8. Roof
bim.create.addRoof(h, gf, {
  Name: 'Flat Roof',
  Position: [0, 0, 3],
  Width: 5, Depth: 8, Thickness: 0.25,
});

// 9. Add properties to the south wall
bim.create.addPropertySet(h, w1, {
  Name: 'Pset_WallCommon',
  Properties: [
    { Name: 'IsExternal', NominalValue: true, Type: 'IfcBoolean' },
    { Name: 'FireRating', NominalValue: 'REI60', Type: 'IfcLabel' },
    { Name: 'ThermalTransmittance', NominalValue: 0.25, Type: 'IfcReal' },
  ],
});

// 10. Add quantities to the slab
bim.create.addQuantitySet(h, slab, {
  Name: 'Qto_SlabBaseQuantities',
  Quantities: [
    { Name: 'GrossArea', Value: 40, Kind: 'IfcQuantityArea' },
    { Name: 'GrossVolume', Value: 12, Kind: 'IfcQuantityVolume' },
    { Name: 'Width', Value: 0.3, Kind: 'IfcQuantityLength' },
  ],
});

// 11. Generate the IFC file
const result = bim.create.toIfc(h);

console.log(`Created ${result.stats.entityCount} entities, ${(result.stats.fileSize / 1024).toFixed(1)} KB`);

// 12. Load into the 3D viewer for preview
bim.model.loadIfc(result.content, 'sample-building.ifc');

// 13. Download the file
bim.export.download(result.content, 'sample-building.ifc', 'application/x-step');
