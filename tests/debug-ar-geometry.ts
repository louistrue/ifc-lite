/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Debug script for AR.ifc geometry issues
 *
 * Issues to investigate:
 * 1. Covering geometry spikes (IfcCovering 0cQX$rcqbFoQKGBpkuqVOC)
 * 2. Wall openings not cut out (IfcWall 12_xLsc_f3OgK3Ufdk0jPo)
 * 3. Window multi-part selection (IfcWindow 12_xLsc_f3OgK3Ufdk0ghH)
 *
 * Run: npx tsx tests/debug-ar-geometry.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Target entities from the screenshots
const TARGET_GUIDS = {
  covering: '0cQX$rcqbFoQKGBpkuqVOC', // IfcCovering with spikes
  wall: '12_xLsc_f3OgK3Ufdk0jPo',    // IfcWall with openings not cut
  window: '12_xLsc_f3OgK3Ufdk0ghH',   // IfcWindow multi-part selection issue
  anotherWall: '12_xLsc_f30gK3Ufdk0g8Q', // Another wall mentioned
};

interface EntityInfo {
  id: number;
  guid: string;
  type: string;
  name: string;
  representationId?: number;
  placementId?: number;
  lineStart: number;
  lineEnd: number;
}

interface OpeningInfo {
  id: number;
  wallId: number;
  geometryType: string;
  bounds?: { min: number[]; max: number[] };
}

async function main() {
  console.log('\n='.repeat(80));
  console.log('AR.ifc Geometry Debug Analysis');
  console.log('='.repeat(80) + '\n');

  const ifcPath = path.join(__dirname, 'models', 'local', 'AR.ifc');

  if (!fs.existsSync(ifcPath)) {
    console.error(`File not found: ${ifcPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(ifcPath, 'utf-8');
  const lines = content.split('\n');

  console.log(`File loaded: ${(content.length / 1024 / 1024).toFixed(2)} MB, ${lines.length} lines\n`);

  // Find target entities
  const entities: Map<string, EntityInfo> = new Map();
  const openings: OpeningInfo[] = [];
  const voidRelationships: Map<number, number[]> = new Map(); // wallId -> [openingIds]

  // Parse entities by GUID
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum].trim();

    // Find IFCWALL, IFCCOVERING, IFCWINDOW
    for (const [key, guid] of Object.entries(TARGET_GUIDS)) {
      if (line.includes(`'${guid}'`)) {
        const match = line.match(/^#(\d+)=(\w+)\(/);
        if (match) {
          const [, id, type] = match;
          // Extract name from attributes
          const nameMatch = line.match(/'([^']*)'/g);
          const guidVal = nameMatch?.[0]?.replace(/'/g, '') || '';
          const name = nameMatch?.[2]?.replace(/'/g, '') || 'unnamed';

          // Extract ALL entity references from the line
          const allRefs = line.match(/#\d+/g) || [];
          // Skip first ref (could be owner history)
          // For building elements: GlobalId, OwnerHistory(#), Name, Description, ObjectType, ObjectPlacement(#), Representation(#), Tag
          // Find placement and representation by looking for refs in positions 5 and 6
          let representationId: number | undefined;
          let placementId: number | undefined;

          // Parse the entity more carefully - find the refs after the quotes
          // Pattern: '...',#XX,'...',$ or '...',#XX,#XX,'...'
          const afterGuid = line.substring(line.indexOf(guid) + guid.length + 1);
          const refs = afterGuid.match(/#(\d+)/g);
          if (refs && refs.length >= 2) {
            // First two refs after GUID+OwnerHistory are usually ObjectPlacement and Representation
            // But OwnerHistory comes right after GUID, so refs[0] is likely OwnerHistory
            // Let's find refs between specific string patterns
            // Actually the format is: GUID, #OwnerHistory, 'Name', Description, 'ObjectType', #Placement, #Rep, 'Tag', ...
            const refNumbers = refs.map(r => parseInt(r.substring(1)));
            // The placement and representation are typically the last two refs before the tag string
            if (refNumbers.length >= 3) {
              placementId = refNumbers[refNumbers.length - 2];
              representationId = refNumbers[refNumbers.length - 1];
            }
          }

          entities.set(key, {
            id: parseInt(id),
            guid: guidVal,
            type,
            name,
            representationId,
            placementId,
            lineStart: lineNum,
            lineEnd: lineNum,
          });
        }
      }
    }

    // Find IFCRELVOIDSELEMENT relationships
    if (line.includes('IFCRELVOIDSELEMENT')) {
      const match = line.match(/#(\d+)=IFCRELVOIDSELEMENT\([^,]+,[^,]+,[^,]*,[^,]*,#(\d+),#(\d+)\)/);
      if (match) {
        const [, relId, wallIdStr, openingIdStr] = match;
        const wallId = parseInt(wallIdStr);
        const openingId = parseInt(openingIdStr);

        if (!voidRelationships.has(wallId)) {
          voidRelationships.set(wallId, []);
        }
        voidRelationships.get(wallId)!.push(openingId);
      }
    }
  }

  // Print found entities
  console.log('Target Entities Found:');
  console.log('-'.repeat(60));
  for (const [key, entity] of entities) {
    console.log(`\n${key.toUpperCase()}: #${entity.id} (${entity.type})`);
    console.log(`  GUID: ${entity.guid}`);
    console.log(`  Name: ${entity.name}`);
    console.log(`  Placement: #${entity.placementId || 'none'}`);
    console.log(`  Representation: #${entity.representationId || 'none'}`);

    // Check for voids
    if (voidRelationships.has(entity.id)) {
      const voids = voidRelationships.get(entity.id)!;
      console.log(`  Openings: ${voids.length} (${voids.map(v => '#' + v).join(', ')})`);
    }
  }

  // Analyze covering geometry
  console.log('\n' + '='.repeat(80));
  console.log('ISSUE 1: COVERING GEOMETRY SPIKES');
  console.log('='.repeat(80) + '\n');

  const covering = entities.get('covering');
  if (covering) {
    await analyzeCoveringGeometry(content, lines, covering);
  }

  // Analyze wall openings
  console.log('\n' + '='.repeat(80));
  console.log('ISSUE 2: WALL OPENINGS NOT CUT');
  console.log('='.repeat(80) + '\n');

  const wall = entities.get('wall');
  if (wall) {
    const wallVoids = voidRelationships.get(wall.id) || [];
    await analyzeWallGeometry(content, lines, wall, wallVoids);
  }

  // Analyze window
  console.log('\n' + '='.repeat(80));
  console.log('ISSUE 3: WINDOW MULTI-PART SELECTION');
  console.log('='.repeat(80) + '\n');

  const window = entities.get('window');
  if (window) {
    await analyzeWindowGeometry(content, lines, window);
  }

  // Summary of findings
  console.log('\n' + '='.repeat(80));
  console.log('ROOT CAUSE ANALYSIS');
  console.log('='.repeat(80) + '\n');

  printRootCauseAnalysis();
}

async function analyzeCoveringGeometry(content: string, lines: string[], covering: EntityInfo) {
  console.log(`Analyzing covering #${covering.id}...`);

  if (!covering.representationId) {
    console.log('ERROR: No representation found');
    return;
  }

  // Find representation line
  const repLine = findEntityLine(lines, covering.representationId);
  if (repLine) {
    console.log(`\nRepresentation #${covering.representationId}:`);
    console.log(`  ${repLine.substring(0, 200)}...`);
  }

  // Extract shape representation refs
  const repMatch = repLine?.match(/#(\d+)/g);
  if (repMatch) {
    console.log(`\nReferenced entities: ${repMatch.slice(0, 10).join(', ')}`);
  }

  // Find IfcPolygonalFaceSet or IfcTriangulatedFaceSet
  const faceSetPattern = /IFCPOLYGONALFACESET|IFCTRIANGULATEDFACESET/;
  const faceSetLines = lines.filter(l => faceSetPattern.test(l));

  // Find covering's body representation
  const bodyRepPattern = new RegExp(`#(\\d+)=IFCSHAPEREPRESENTATION\\([^,]+,'Body'`);
  let bodyRepId: number | undefined;

  for (const line of lines) {
    if (line.includes(covering.representationId!.toString())) {
      const match = line.match(bodyRepPattern);
      if (match) {
        // This is a body representation
      }
    }
  }

  // Look for CartesianPointList3D
  const cartPointPattern = /IFCCARTESIANPOINTLIST3D/;

  // Find the PolygonalFaceSet for this covering
  // The covering uses IfcPolygonalFaceSet at #739991
  const faceSetId = 739991; // From manual analysis
  const faceSetLine = findEntityLine(lines, faceSetId);

  if (faceSetLine) {
    console.log(`\nPolygonalFaceSet #${faceSetId}:`);
    console.log(`  Line: ${faceSetLine.substring(0, 300)}...`);

    // Extract coordinates ref
    const coordsMatch = faceSetLine.match(/#(\d+)/);
    if (coordsMatch) {
      const coordsId = parseInt(coordsMatch[1]);
      const coordsLine = findEntityLine(lines, coordsId);
      if (coordsLine) {
        console.log(`\nCoordinates #${coordsId}:`);

        // Parse coordinates
        const coords = parseCartesianPointList3D(coordsLine);
        console.log(`  ${coords.length} points`);

        if (coords.length > 0) {
          // Analyze coordinate ranges
          const xs = coords.map(p => p[0]);
          const ys = coords.map(p => p[1]);
          const zs = coords.map(p => p[2]);

          console.log(`\n  X range: ${Math.min(...xs).toFixed(4)} to ${Math.max(...xs).toFixed(4)}`);
          console.log(`  Y range: ${Math.min(...ys).toFixed(4)} to ${Math.max(...ys).toFixed(4)}`);
          console.log(`  Z range: ${Math.min(...zs).toFixed(4)} to ${Math.max(...zs).toFixed(4)}`);

          // Check for problematic coordinates (very small values that could cause precision issues)
          const tinyCoords = coords.filter(p =>
            Math.abs(p[0]) < 1e-10 || Math.abs(p[1]) < 1e-10 || Math.abs(p[2]) < 1e-10
          );
          if (tinyCoords.length > 0) {
            console.log(`\n  WARNING: ${tinyCoords.length} points have near-zero coordinates`);
          }

          // Check for very large coordinates
          const largeCoords = coords.filter(p =>
            Math.abs(p[0]) > 1000 || Math.abs(p[1]) > 1000 || Math.abs(p[2]) > 1000
          );
          if (largeCoords.length > 0) {
            console.log(`  WARNING: ${largeCoords.length} points have coordinates > 1000`);
          }

          // Print sample coordinates
          console.log('\n  Sample coordinates (first 5):');
          coords.slice(0, 5).forEach((p, i) => {
            console.log(`    [${i}]: (${p[0].toFixed(6)}, ${p[1].toFixed(6)}, ${p[2].toFixed(6)})`);
          });
        }
      }
    }

    // Analyze faces
    const facesMatch = faceSetLine.match(/\(#[\d,#]+\)/g);
    if (facesMatch && facesMatch.length > 1) {
      console.log(`\n  ${facesMatch.length - 1} faces referenced`);
    }
  }

  // Check placement transform
  if (covering.placementId) {
    console.log(`\nAnalyzing placement #${covering.placementId}...`);
    const placement = analyzePlacement(lines, covering.placementId);
    if (placement) {
      console.log(`  Location: (${placement.location.join(', ')})`);
      console.log(`  Direction: (${placement.direction.join(', ')})`);
    }
  }
}

async function analyzeWallGeometry(content: string, lines: string[], wall: EntityInfo, openingIds: number[]) {
  console.log(`Analyzing wall #${wall.id}...`);
  console.log(`  Has ${openingIds.length} openings: ${openingIds.map(id => '#' + id).join(', ')}`);

  if (!wall.representationId) {
    console.log('ERROR: No representation found');
    return;
  }

  // Find representation
  const repLine = findEntityLine(lines, wall.representationId);
  if (repLine) {
    console.log(`\nRepresentation #${wall.representationId}:`);
    console.log(`  ${repLine.substring(0, 200)}...`);
  }

  // Check the wall geometry type
  // From manual analysis, this wall uses SweptSolid (ExtrudedAreaSolid)

  // Analyze each opening
  for (const openingId of openingIds) {
    console.log(`\nOpening #${openingId}:`);
    const openingLine = findEntityLine(lines, openingId);
    if (openingLine) {
      // Extract representation
      const repMatch = openingLine.match(/,#(\d+),#(\d+),[^,]*\);?$/);
      if (repMatch) {
        const openingRepId = parseInt(repMatch[2]);
        const openingRepLine = findEntityLine(lines, openingRepId);
        if (openingRepLine) {
          console.log(`  Representation: ${openingRepLine.substring(0, 150)}...`);
        }
      }
    }
  }

  console.log('\nWall Geometry Analysis:');
  console.log('  The wall uses multiple ExtrudedAreaSolid geometries (compound wall)');
  console.log('  IfcRelVoidsElement relationships exist linking wall to openings');
  console.log('  Each opening has its own SweptSolid geometry');

  console.log('\nExpected Behavior:');
  console.log('  - Geometry router should detect void relationships');
  console.log('  - Opening geometry should be subtracted from wall geometry');
  console.log('  - CSG or 2D clipping should create cutouts');

  console.log('\nPotential Issues:');
  console.log('  1. Void index may not be built correctly for this wall');
  console.log('  2. Compound wall (multiple extrusions) may not be handled');
  console.log('  3. Opening geometry might be processed separately without subtraction');
}

async function analyzeWindowGeometry(content: string, lines: string[], window: EntityInfo) {
  console.log(`Analyzing window #${window.id}...`);

  if (!window.representationId) {
    console.log('ERROR: No representation found');
    return;
  }

  // Find representation
  const repLine = findEntityLine(lines, window.representationId);
  if (repLine) {
    console.log(`\nRepresentation #${window.representationId}:`);
    console.log(`  ${repLine.substring(0, 200)}...`);
  }

  // Windows often have multiple geometric representations for frame, glass, etc.
  // The selection issue might be that only one part gets an express ID

  console.log('\nWindow Geometry Analysis:');
  console.log('  Windows typically have multiple representation items:');
  console.log('  - Frame geometry (often ExtrudedAreaSolid or PolygonalFaceSet)');
  console.log('  - Glass/pane geometry (often separate mesh)');
  console.log('  - Potentially nested window panels');

  console.log('\nPotential Issues:');
  console.log('  1. Multiple geometry items share the same express ID');
  console.log('  2. Selection only highlights the first geometry item');
  console.log('  3. Window panels may not be properly associated with parent window');
}

function findEntityLine(lines: string[], entityId: number): string | undefined {
  const pattern = new RegExp(`^#${entityId}=`);
  return lines.find(line => pattern.test(line.trim()));
}

function parseCartesianPointList3D(line: string): number[][] {
  const coords: number[][] = [];

  // Extract the coordinate tuples
  const tuplesMatch = line.match(/\(\(([^)]+\)(?:,\([^)]+\))*)\)/);
  if (!tuplesMatch) return coords;

  const content = tuplesMatch[1];
  // Split by ),(
  const tupleStrings = content.split(/\),\(/);

  for (const tupleStr of tupleStrings) {
    // Clean up parentheses
    const cleaned = tupleStr.replace(/[()]/g, '');
    const values = cleaned.split(',').map(v => parseFloat(v.trim()));
    if (values.length >= 3 && values.every(v => !isNaN(v))) {
      coords.push(values);
    }
  }

  return coords;
}

function analyzePlacement(lines: string[], placementId: number): { location: number[], direction: number[] } | null {
  const placementLine = findEntityLine(lines, placementId);
  if (!placementLine) return null;

  // Extract nested placement refs
  const refs = placementLine.match(/#(\d+)/g);
  if (!refs) return null;

  // Find axis2placement3d
  for (const ref of refs) {
    const refId = parseInt(ref.substring(1));
    const refLine = findEntityLine(lines, refId);
    if (refLine?.includes('IFCAXIS2PLACEMENT3D')) {
      // Extract location and direction refs
      const locMatch = refLine.match(/#(\d+)/);
      if (locMatch) {
        const locId = parseInt(locMatch[1]);
        const locLine = findEntityLine(lines, locId);
        if (locLine?.includes('IFCCARTESIANPOINT')) {
          const coordMatch = locLine.match(/\(\(([^)]+)\)/);
          if (coordMatch) {
            const location = coordMatch[1].split(',').map(v => parseFloat(v.trim()));
            return { location, direction: [0, 0, 1] };
          }
        }
      }
    }
  }

  return null;
}

function printRootCauseAnalysis() {
  console.log('1. COVERING SPIKES:');
  console.log('   - IfcPolygonalFaceSet uses fan triangulation for non-triangular faces');
  console.log('   - Fan triangulation assumes convex polygons');
  console.log('   - Complex concave polygons may produce "spikes" or inverted triangles');
  console.log('   - FIX: Use ear-clipping triangulation for non-convex polygons');
  console.log('');

  console.log('2. WALL OPENINGS NOT CUT:');
  console.log('   - Wall geometry is processed as compound (multiple SweptSolids)');
  console.log('   - IfcRelVoidsElement relationships exist but may not be processed');
  console.log('   - Void subtraction may be skipped due to:');
  console.log('     a) Void index not built for this element type');
  console.log('     b) MAX_OPENINGS limit (15) exceeded');
  console.log('     c) Compound geometry not merged before CSG');
  console.log('   - FIX: Ensure void_index captures relationships for all building elements');
  console.log('   - FIX: Handle compound geometry before void subtraction');
  console.log('');

  console.log('3. WINDOW MULTI-PART SELECTION:');
  console.log('   - Window has single express ID but multiple geometry items');
  console.log('   - Renderer may store geometry per-item, not per-entity');
  console.log('   - Selection highlights by geometry ID, not express ID');
  console.log('   - FIX: Ensure all geometry items for an entity share selection state');
  console.log('   - FIX: Selection should highlight all meshes with same express ID');
}

// Run
main().catch(console.error);
