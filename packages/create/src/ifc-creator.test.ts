/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { IfcCreator } from './ifc-creator.js';

describe('IfcCreator', () => {
  it('creates a minimal valid IFC file with project, site, building', () => {
    const creator = new IfcCreator({ Name: 'Test Project' });
    const result = creator.toIfc();

    expect(result.content).toContain('ISO-10303-21');
    expect(result.content).toContain('IFCPROJECT');
    expect(result.content).toContain('IFCSITE');
    expect(result.content).toContain('IFCBUILDING');
    expect(result.content).toContain('IFCRELAGGREGATES');
    expect(result.content).toContain("'Test Project'");
    expect(result.content).toContain('END-ISO-10303-21');
    expect(result.stats.entityCount).toBeGreaterThan(10);
    expect(result.stats.fileSize).toBeGreaterThan(0);
    expect(result.entities.some(e => e.type === 'IfcProject')).toBe(true);
  });

  it('adds a storey and includes it in aggregation', () => {
    const creator = new IfcCreator();
    const storeyId = creator.addIfcBuildingStorey({ Name: 'Ground Floor', Elevation: 0 });
    const result = creator.toIfc();

    expect(storeyId).toBeGreaterThan(0);
    expect(result.content).toContain('IFCBUILDINGSTOREY');
    expect(result.content).toContain("'Ground Floor'");
    expect(result.entities.some(e => e.type === 'IfcBuildingStorey')).toBe(true);
  });

  it('creates a wall with geometry', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const wallId = creator.addIfcWall(storey, {
      Name: 'Test Wall',
      Start: [0, 0, 0],
      End: [5, 0, 0],
      Thickness: 0.2,
      Height: 3,
    });
    const result = creator.toIfc();

    expect(wallId).toBeGreaterThan(0);
    expect(result.content).toContain('IFCWALL');
    expect(result.content).toContain("'Test Wall'");
    expect(result.content).toContain('IFCEXTRUDEDAREASOLID');
    expect(result.content).toContain('IFCRECTANGLEPROFILEDEF');
    expect(result.content).toContain('IFCSHAPEREPRESENTATION');
    expect(result.content).toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE');
  });

  it('creates a wall with openings', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcWall(storey, {
      Name: 'Wall with Opening',
      Start: [0, 0, 0],
      End: [5, 0, 0],
      Thickness: 0.2,
      Height: 3,
      Openings: [
        { Name: 'Window', Width: 1.2, Height: 1.5, Position: [2, 0, 0.9] },
      ],
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCOPENINGELEMENT');
    expect(result.content).toContain('IFCRELVOIDSELEMENT');
    expect(result.content).toContain("'Window'");
  });

  it('creates a slab', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcSlab(storey, {
      Name: 'Floor Slab',
      Position: [0, 0, 0],
      Thickness: 0.3,
      Width: 10,
      Depth: 8,
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCSLAB');
    expect(result.content).toContain("'Floor Slab'");
  });

  it('creates a slab with arbitrary profile', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcSlab(storey, {
      Name: 'L-Shape Slab',
      Position: [0, 0, 0],
      Thickness: 0.3,
      Profile: [[0, 0], [5, 0], [5, 3], [2, 3], [2, 8], [0, 8]],
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCSLAB');
    expect(result.content).toContain('IFCARBITRARYCLOSEDPROFILEDEF');
    expect(result.content).toContain('IFCPOLYLINE');
  });

  it('creates a column', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcColumn(storey, {
      Name: 'Corner Column',
      Position: [0, 0, 0],
      Width: 0.3,
      Depth: 0.3,
      Height: 3,
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCCOLUMN');
    expect(result.content).toContain("'Corner Column'");
  });

  it('creates a beam', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcBeam(storey, {
      Name: 'Ridge Beam',
      Start: [0, 0, 3],
      End: [5, 0, 3],
      Width: 0.2,
      Height: 0.4,
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCBEAM');
    expect(result.content).toContain("'Ridge Beam'");
  });

  it('creates a stair', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcStair(storey, {
      Name: 'Main Stair',
      Position: [1, 1, 0],
      NumberOfRisers: 10,
      RiserHeight: 0.18,
      TreadLength: 0.28,
      Width: 1.0,
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCSTAIR');
    expect(result.content).toContain("'Main Stair'");
    // 10 risers = 10 extruded solids
    const solidCount = (result.content.match(/IFCEXTRUDEDAREASOLID/g) || []).length;
    expect(solidCount).toBeGreaterThanOrEqual(10);
  });

  it('creates a roof', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcRoof(storey, {
      Name: 'Flat Roof',
      Position: [0, 0, 3],
      Width: 10,
      Depth: 8,
      Thickness: 0.25,
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCROOF');
    expect(result.content).toContain("'Flat Roof'");
  });

  it('creates a sloped roof', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    creator.addIfcRoof(storey, {
      Name: 'Pitched Roof',
      Position: [0, 0, 3],
      Width: 10,
      Depth: 8,
      Thickness: 0.2,
      Slope: Math.PI / 12, // 15 degrees
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCROOF');
    expect(result.content).toContain("'Pitched Roof'");
  });

  it('attaches property sets', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const wallId = creator.addIfcWall(storey, {
      Start: [0, 0, 0], End: [5, 0, 0],
      Thickness: 0.2, Height: 3,
    });

    creator.addIfcPropertySet(wallId, {
      Name: 'Pset_WallCommon',
      Properties: [
        { Name: 'IsExternal', NominalValue: true, Type: 'IfcBoolean' },
        { Name: 'FireRating', NominalValue: 'REI60' },
        { Name: 'ThermalTransmittance', NominalValue: 0.25 },
      ],
    });

    const result = creator.toIfc();

    expect(result.content).toContain('IFCPROPERTYSET');
    expect(result.content).toContain('IFCPROPERTYSINGLEVALUE');
    expect(result.content).toContain('IFCRELDEFINESBYPROPERTIES');
    expect(result.content).toContain("'Pset_WallCommon'");
    expect(result.content).toContain("'IsExternal'");
    expect(result.content).toContain('IFCBOOLEAN(.T.)');
    expect(result.content).toContain("IFCLABEL('REI60')");
    expect(result.content).toContain('IFCREAL(0.25)');
  });

  it('attaches quantity sets', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const slabId = creator.addIfcSlab(storey, {
      Position: [0, 0, 0], Thickness: 0.3, Width: 10, Depth: 8,
    });

    creator.addIfcElementQuantity(slabId, {
      Name: 'Qto_SlabBaseQuantities',
      Quantities: [
        { Name: 'GrossArea', Value: 80, Kind: 'IfcQuantityArea' },
        { Name: 'GrossVolume', Value: 24, Kind: 'IfcQuantityVolume' },
      ],
    });

    const result = creator.toIfc();

    expect(result.content).toContain('IFCELEMENTQUANTITY');
    expect(result.content).toContain('IFCQUANTITYAREA');
    expect(result.content).toContain('IFCQUANTITYVOLUME');
    expect(result.content).toContain("'Qto_SlabBaseQuantities'");
  });

  it('attaches a simple material via IfcRelAssociatesMaterial', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const colId = creator.addIfcColumn(storey, {
      Position: [0, 0, 0], Width: 0.3, Depth: 0.3, Height: 3,
    });

    creator.addIfcMaterial(colId, { Name: 'Concrete C30/37', Category: 'Concrete' });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCMATERIAL');
    expect(result.content).toContain("'Concrete C30/37'");
    expect(result.content).toContain("'Concrete'");
    expect(result.content).toContain('IFCRELASSOCIATESMATERIAL');
  });

  it('attaches a layered material set', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const wallId = creator.addIfcWall(storey, {
      Start: [0, 0, 0], End: [5, 0, 0], Thickness: 0.2, Height: 3,
    });

    creator.addIfcMaterial(wallId, {
      Name: 'Wall Assembly',
      Layers: [
        { Name: 'Gypsum', Thickness: 0.013, Category: 'Finish' },
        { Name: 'Concrete', Thickness: 0.2, Category: 'Structural' },
      ],
    });
    const result = creator.toIfc();

    expect(result.content).toContain('IFCMATERIAL');
    expect(result.content).toContain('IFCMATERIALLAYER');
    expect(result.content).toContain('IFCMATERIALLAYERSET');
    expect(result.content).toContain("'Wall Assembly'");
    expect(result.content).toContain("'Gypsum'");
    expect(result.content).toContain("'Concrete'");
    expect(result.content).toContain('IFCRELASSOCIATESMATERIAL');
  });

  it('shares IfcMaterial entities across elements with same material name', () => {
    const creator = new IfcCreator();
    const storey = creator.addIfcBuildingStorey({ Name: 'GF', Elevation: 0 });
    const col1 = creator.addIfcColumn(storey, { Position: [0, 0, 0], Width: 0.3, Depth: 0.3, Height: 3 });
    const col2 = creator.addIfcColumn(storey, { Position: [5, 0, 0], Width: 0.3, Depth: 0.3, Height: 3 });

    creator.addIfcMaterial(col1, { Name: 'Concrete' });
    creator.addIfcMaterial(col2, { Name: 'Concrete' });
    const result = creator.toIfc();

    // Only one IFCMATERIAL('Concrete'...) should be created, shared between both
    const materialMatches = result.content.match(/IFCMATERIAL\('Concrete'/g) ?? [];
    expect(materialMatches.length).toBe(1);

    // But one IfcRelAssociatesMaterial should link both elements
    const relMatches = result.content.match(/IFCRELASSOCIATESMATERIAL/g) ?? [];
    expect(relMatches.length).toBe(1);
  });

  it('produces valid STEP header', () => {
    const creator = new IfcCreator({ Schema: 'IFC4' });
    const result = creator.toIfc();

    expect(result.content).toMatch(/^ISO-10303-21;/);
    expect(result.content).toContain("FILE_SCHEMA(('IFC4'))");
    expect(result.content).toContain('HEADER;');
    expect(result.content).toContain('ENDSEC;');
    expect(result.content).toContain('DATA;');
    expect(result.content).toMatch(/END-ISO-10303-21;\s*$/);
  });

  it('generates unique GlobalIds', () => {
    const creator = new IfcCreator();
    creator.addIfcBuildingStorey({ Name: 'S1', Elevation: 0 });
    creator.addIfcBuildingStorey({ Name: 'S2', Elevation: 3 });
    const result = creator.toIfc();

    // Extract all GlobalIds
    const globalIds = result.content.match(/'[0-9A-Za-z_$]{22}'/g) ?? [];
    const uniqueIds = new Set(globalIds);
    expect(uniqueIds.size).toBe(globalIds.length);
  });

  it('builds a complete building', () => {
    const creator = new IfcCreator({ Name: 'Complete Building' });
    const gf = creator.addIfcBuildingStorey({ Name: 'Ground Floor', Elevation: 0 });
    const ff = creator.addIfcBuildingStorey({ Name: 'First Floor', Elevation: 3.2 });

    // Ground floor walls
    creator.addIfcWall(gf, { Start: [0, 0, 0], End: [10, 0, 0], Thickness: 0.2, Height: 3 });
    creator.addIfcWall(gf, { Start: [10, 0, 0], End: [10, 8, 0], Thickness: 0.2, Height: 3 });
    creator.addIfcWall(gf, { Start: [10, 8, 0], End: [0, 8, 0], Thickness: 0.2, Height: 3 });
    creator.addIfcWall(gf, { Start: [0, 8, 0], End: [0, 0, 0], Thickness: 0.2, Height: 3 });

    // Ground floor slab
    creator.addIfcSlab(gf, { Position: [0, 0, -0.3], Thickness: 0.3, Width: 10, Depth: 8 });

    // Columns
    creator.addIfcColumn(gf, { Position: [5, 4, 0], Width: 0.4, Depth: 0.4, Height: 3 });

    // First floor slab
    creator.addIfcSlab(ff, { Position: [0, 0, 3], Thickness: 0.3, Width: 10, Depth: 8 });

    // Roof
    creator.addIfcRoof(ff, { Position: [0, 0, 6.2], Width: 10, Depth: 8, Thickness: 0.25 });

    const result = creator.toIfc();

    // Check all element types are present
    expect(result.content).toContain('IFCWALL');
    expect(result.content).toContain('IFCSLAB');
    expect(result.content).toContain('IFCCOLUMN');
    expect(result.content).toContain('IFCROOF');
    expect(result.content).toContain('IFCBUILDINGSTOREY');

    // Check proper spatial containment
    const containedCount = (result.content.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE/g) || []).length;
    expect(containedCount).toBe(2); // One per storey

    expect(result.stats.entityCount).toBeGreaterThan(50);
    expect(result.entities.length).toBeGreaterThan(10);
  });
});
