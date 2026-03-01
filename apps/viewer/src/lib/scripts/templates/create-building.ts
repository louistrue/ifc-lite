export {} // module boundary for type checking
/**
 * Create IFC from scratch — generate a fully attributed building
 *
 * Demonstrates the bim.create API: build a complete IFC file with
 * walls, slab, columns, beams, stair, roof — each with material colours,
 * standard IFC property sets, and base quantities.
 */

// ─── 1. Project ─────────────────────────────────────────────────────────

const h = bim.create.project({
  Name: 'Sample Building',
  Description: 'Demonstration of ifc-lite IFC creation from scratch',
  Author: 'ifc-lite',
  Organization: 'ifc-lite',
});

// ─── 2. Storey ──────────────────────────────────────────────────────────

const gf = bim.create.addStorey(h, { Name: 'Ground Floor', Elevation: 0 });

// ─── 3. Walls — 5 × 8 m footprint, 3 m high, 0.2 m thick ─────────────

const southWall = bim.create.addWall(h, gf, {
  Name: 'South Wall', Description: 'Exterior south façade', ObjectType: 'Basic Wall:Exterior - 200mm',
  Start: [0, 0, 0], End: [5, 0, 0], Thickness: 0.2, Height: 3,
  Openings: [
    { Name: 'W-01 Window', Width: 1.2, Height: 1.5, Position: [1.5, 0, 0.9] },
  ],
});
const eastWall = bim.create.addWall(h, gf, {
  Name: 'East Wall', Description: 'Exterior east façade', ObjectType: 'Basic Wall:Exterior - 200mm',
  Start: [5, 0, 0], End: [5, 8, 0], Thickness: 0.2, Height: 3,
  Openings: [
    { Name: 'D-01 Entrance Door', Width: 0.9, Height: 2.1, Position: [3, 0, 0] },
  ],
});
const northWall = bim.create.addWall(h, gf, {
  Name: 'North Wall', Description: 'Exterior north façade', ObjectType: 'Basic Wall:Exterior - 200mm',
  Start: [5, 8, 0], End: [0, 8, 0], Thickness: 0.2, Height: 3,
  Openings: [
    { Name: 'W-02 Window', Width: 1.4, Height: 1.5, Position: [1.8, 0, 0.9] },
  ],
});
const westWall = bim.create.addWall(h, gf, {
  Name: 'West Wall', Description: 'Exterior west façade', ObjectType: 'Basic Wall:Exterior - 200mm',
  Start: [0, 8, 0], End: [0, 0, 0], Thickness: 0.2, Height: 3,
});

// Wall colours and materials
for (const wId of [southWall, eastWall, northWall, westWall]) {
  bim.create.setColor(h, wId, 'Plaster - Beige', [0.92, 0.88, 0.80]);
  bim.create.addMaterial(h, wId, {
    Name: 'Exterior Wall Assembly',
    Layers: [
      { Name: 'Gypsum Board', Thickness: 0.013, Category: 'Finish' },
      { Name: 'Mineral Wool Insulation', Thickness: 0.08, Category: 'Insulation' },
      { Name: 'Concrete C30/37', Thickness: 0.2, Category: 'Structural' },
      { Name: 'External Render', Thickness: 0.015, Category: 'Finish' },
    ],
  });
}

// Wall properties & quantities (all walls share the same spec)
for (const [wId, wName, wLen] of [
  [southWall, 'South Wall', 5],
  [eastWall, 'East Wall', 8],
  [northWall, 'North Wall', 5],
  [westWall, 'West Wall', 8],
] as [number, string, number][]) {
  bim.create.addPropertySet(h, wId, {
    Name: 'Pset_WallCommon',
    Properties: [
      { Name: 'Reference', NominalValue: 'Exterior - 200mm', Type: 'IfcIdentifier' },
      { Name: 'IsExternal', NominalValue: true, Type: 'IfcBoolean' },
      { Name: 'LoadBearing', NominalValue: true, Type: 'IfcBoolean' },
      { Name: 'FireRating', NominalValue: 'REI60', Type: 'IfcLabel' },
      { Name: 'AcousticRating', NominalValue: 'STC 45', Type: 'IfcLabel' },
      { Name: 'ThermalTransmittance', NominalValue: 0.25, Type: 'IfcReal' },
    ],
  });
  bim.create.addQuantitySet(h, wId, {
    Name: 'Qto_WallBaseQuantities',
    Quantities: [
      { Name: 'Length', Value: wLen, Kind: 'IfcQuantityLength' },
      { Name: 'Height', Value: 3, Kind: 'IfcQuantityLength' },
      { Name: 'Width', Value: 0.2, Kind: 'IfcQuantityLength' },
      { Name: 'GrossSideArea', Value: wLen * 3, Kind: 'IfcQuantityArea' },
      { Name: 'GrossVolume', Value: wLen * 3 * 0.2, Kind: 'IfcQuantityVolume' },
    ],
  });
}

// ─── 4. Floor slab ──────────────────────────────────────────────────────

const slab = bim.create.addSlab(h, gf, {
  Name: 'Ground Floor Slab', Description: 'Reinforced concrete floor slab', ObjectType: 'Floor:Concrete - 300mm',
  Position: [0, 0, -0.3], Thickness: 0.3, Width: 5, Depth: 8,
});
bim.create.setColor(h, slab, 'Concrete - Grey', [0.65, 0.65, 0.65]);
bim.create.addMaterial(h, slab, {
  Name: 'Floor Slab Assembly',
  Layers: [
    { Name: 'Ceramic Tile', Thickness: 0.01, Category: 'Finish' },
    { Name: 'Screed', Thickness: 0.05, Category: 'Finish' },
    { Name: 'Reinforced Concrete C30/37', Thickness: 0.24, Category: 'Structural' },
  ],
});
bim.create.addPropertySet(h, slab, {
  Name: 'Pset_SlabCommon',
  Properties: [
    { Name: 'Reference', NominalValue: 'Concrete - 300mm', Type: 'IfcIdentifier' },
    { Name: 'IsExternal', NominalValue: false, Type: 'IfcBoolean' },
    { Name: 'LoadBearing', NominalValue: true, Type: 'IfcBoolean' },
    { Name: 'FireRating', NominalValue: 'REI90', Type: 'IfcLabel' },
    { Name: 'AcousticRating', NominalValue: 'STC 52', Type: 'IfcLabel' },
    { Name: 'Combustible', NominalValue: false, Type: 'IfcBoolean' },
  ],
});
bim.create.addQuantitySet(h, slab, {
  Name: 'Qto_SlabBaseQuantities',
  Quantities: [
    { Name: 'Width', Value: 0.3, Kind: 'IfcQuantityLength' },
    { Name: 'GrossArea', Value: 40, Kind: 'IfcQuantityArea' },
    { Name: 'NetArea', Value: 40, Kind: 'IfcQuantityArea' },
    { Name: 'GrossVolume', Value: 12, Kind: 'IfcQuantityVolume' },
    { Name: 'GrossWeight', Value: 28800, Kind: 'IfcQuantityWeight' },
  ],
});

// ─── 5. Columns at corners ──────────────────────────────────────────────

const columnPositions: [string, number, number][] = [
  ['C-01 SW', 0.1, 0.1],
  ['C-02 SE', 4.7, 0.1],
  ['C-03 NE', 4.7, 7.7],
  ['C-04 NW', 0.1, 7.7],
];
for (const [cName, cx, cy] of columnPositions) {
  const colId = bim.create.addColumn(h, gf, {
    Name: cName, Description: 'Reinforced concrete column', ObjectType: 'Column:Concrete 300x300',
    Position: [cx, cy, 0], Width: 0.3, Depth: 0.3, Height: 3,
  });
  bim.create.setColor(h, colId, 'Concrete - Light', [0.72, 0.72, 0.74]);
  bim.create.addMaterial(h, colId, { Name: 'Reinforced Concrete C30/37', Category: 'Concrete' });
  bim.create.addPropertySet(h, colId, {
    Name: 'Pset_ColumnCommon',
    Properties: [
      { Name: 'Reference', NominalValue: 'Concrete 300x300', Type: 'IfcIdentifier' },
      { Name: 'LoadBearing', NominalValue: true, Type: 'IfcBoolean' },
      { Name: 'IsExternal', NominalValue: false, Type: 'IfcBoolean' },
      { Name: 'FireRating', NominalValue: 'R120', Type: 'IfcLabel' },
      { Name: 'Slope', NominalValue: 0, Type: 'IfcInteger' },
    ],
  });
  bim.create.addQuantitySet(h, colId, {
    Name: 'Qto_ColumnBaseQuantities',
    Quantities: [
      { Name: 'Length', Value: 3, Kind: 'IfcQuantityLength' },
      { Name: 'CrossSectionArea', Value: 0.09, Kind: 'IfcQuantityArea' },
      { Name: 'GrossVolume', Value: 0.27, Kind: 'IfcQuantityVolume' },
      { Name: 'GrossWeight', Value: 648, Kind: 'IfcQuantityWeight' },
    ],
  });
}

// ─── 6. Beams along the top ─────────────────────────────────────────────

const beamDefs: [string, [number, number, number], [number, number, number]][] = [
  ['B-01 South Beam', [0, 0, 3], [5, 0, 3]],
  ['B-02 North Beam', [0, 8, 3], [5, 8, 3]],
];
for (const [bName, bStart, bEnd] of beamDefs) {
  const bLen = Math.sqrt(
    (bEnd[0] - bStart[0]) ** 2 + (bEnd[1] - bStart[1]) ** 2 + (bEnd[2] - bStart[2]) ** 2,
  );
  const beamId = bim.create.addBeam(h, gf, {
    Name: bName, Description: 'Steel I-beam', ObjectType: 'Beam:IPE 200',
    Start: bStart, End: bEnd, Width: 0.2, Height: 0.4,
  });
  bim.create.setColor(h, beamId, 'Steel - Grey', [0.55, 0.55, 0.58]);
  bim.create.addMaterial(h, beamId, { Name: 'Structural Steel S235', Category: 'Steel' });
  bim.create.addPropertySet(h, beamId, {
    Name: 'Pset_BeamCommon',
    Properties: [
      { Name: 'Reference', NominalValue: 'IPE 200', Type: 'IfcIdentifier' },
      { Name: 'LoadBearing', NominalValue: true, Type: 'IfcBoolean' },
      { Name: 'IsExternal', NominalValue: false, Type: 'IfcBoolean' },
      { Name: 'FireRating', NominalValue: 'R60', Type: 'IfcLabel' },
      { Name: 'Span', NominalValue: bLen, Type: 'IfcReal' },
    ],
  });
  bim.create.addQuantitySet(h, beamId, {
    Name: 'Qto_BeamBaseQuantities',
    Quantities: [
      { Name: 'Length', Value: bLen, Kind: 'IfcQuantityLength' },
      { Name: 'CrossSectionArea', Value: 0.08, Kind: 'IfcQuantityArea' },
      { Name: 'GrossVolume', Value: bLen * 0.08, Kind: 'IfcQuantityVolume' },
      { Name: 'GrossWeight', Value: bLen * 0.08 * 7850, Kind: 'IfcQuantityWeight' },
    ],
  });
}

// ─── 7. Stair ───────────────────────────────────────────────────────────

const numRisers = 17;
const riserH = 0.176;
const treadL = 0.28;
const stairW = 1.0;
const stairId = bim.create.addStair(h, gf, {
  Name: 'ST-01 Main Stair', Description: 'Straight-run concrete stair', ObjectType: 'Stair:Concrete - Straight Run',
  Position: [1, 2, 0],
  NumberOfRisers: numRisers, RiserHeight: riserH, TreadLength: treadL, Width: stairW,
});
bim.create.setColor(h, stairId, 'Concrete - Warm', [0.80, 0.78, 0.74]);
bim.create.addMaterial(h, stairId, { Name: 'Reinforced Concrete C25/30', Category: 'Concrete' });
bim.create.addPropertySet(h, stairId, {
  Name: 'Pset_StairCommon',
  Properties: [
    { Name: 'Reference', NominalValue: 'Concrete - Straight Run', Type: 'IfcIdentifier' },
    { Name: 'FireRating', NominalValue: 'REI60', Type: 'IfcLabel' },
    { Name: 'NumberOfRiser', NominalValue: numRisers, Type: 'IfcInteger' },
    { Name: 'NumberOfTreads', NominalValue: numRisers - 1, Type: 'IfcInteger' },
    { Name: 'RiserHeight', NominalValue: riserH, Type: 'IfcReal' },
    { Name: 'TreadLength', NominalValue: treadL, Type: 'IfcReal' },
    { Name: 'IsExternal', NominalValue: false, Type: 'IfcBoolean' },
    { Name: 'HandicapAccessible', NominalValue: false, Type: 'IfcBoolean' },
  ],
});
bim.create.addQuantitySet(h, stairId, {
  Name: 'Qto_StairBaseQuantities',
  Quantities: [
    { Name: 'Length', Value: numRisers * treadL, Kind: 'IfcQuantityLength' },
    { Name: 'GrossVolume', Value: numRisers * treadL * stairW * riserH * 0.5, Kind: 'IfcQuantityVolume' },
  ],
});

// ─── 8. Roof ────────────────────────────────────────────────────────────

const roofId = bim.create.addRoof(h, gf, {
  Name: 'R-01 Flat Roof', Description: 'Insulated flat roof assembly', ObjectType: 'Roof:Flat - 250mm',
  Position: [0, 0, 3], Width: 5, Depth: 8, Thickness: 0.25,
});
bim.create.setColor(h, roofId, 'Bitumen - Dark', [0.30, 0.28, 0.26]);
bim.create.addMaterial(h, roofId, {
  Name: 'Flat Roof Assembly',
  Layers: [
    { Name: 'Bitumen Membrane', Thickness: 0.01, Category: 'Waterproofing' },
    { Name: 'XPS Insulation', Thickness: 0.12, Category: 'Insulation' },
    { Name: 'Vapour Barrier', Thickness: 0.002, Category: 'Membrane' },
    { Name: 'Reinforced Concrete C30/37', Thickness: 0.2, Category: 'Structural' },
  ],
});
bim.create.addPropertySet(h, roofId, {
  Name: 'Pset_RoofCommon',
  Properties: [
    { Name: 'Reference', NominalValue: 'Flat - 250mm', Type: 'IfcIdentifier' },
    { Name: 'IsExternal', NominalValue: true, Type: 'IfcBoolean' },
    { Name: 'FireRating', NominalValue: 'REI30', Type: 'IfcLabel' },
    { Name: 'ThermalTransmittance', NominalValue: 0.18, Type: 'IfcReal' },
    { Name: 'ProjectedArea', NominalValue: 40, Type: 'IfcReal' },
  ],
});
bim.create.addQuantitySet(h, roofId, {
  Name: 'Qto_RoofBaseQuantities',
  Quantities: [
    { Name: 'GrossArea', Value: 40, Kind: 'IfcQuantityArea' },
    { Name: 'NetArea', Value: 40, Kind: 'IfcQuantityArea' },
    { Name: 'GrossVolume', Value: 10, Kind: 'IfcQuantityVolume' },
  ],
});

// ─── 9. Generate, preview, download ─────────────────────────────────────

const result = bim.create.toIfc(h);

console.log(
  `Created ${result.entities.length} entities, ` +
  `${result.stats.entityCount} STEP lines, ` +
  `${(result.stats.fileSize / 1024).toFixed(1)} KB`,
);

bim.model.loadIfc(result.content, 'sample-building.ifc');
bim.export.download(result.content, 'sample-building.ifc', 'application/x-step');
