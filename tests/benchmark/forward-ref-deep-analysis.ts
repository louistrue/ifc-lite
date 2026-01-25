/**
 * Deep analysis of forward references - understand the actual dependency chains
 *
 * Key question: Can we process GEOMETRY without waiting, even if
 * FacetedBrep internal entities (IFCFACE, IFCFACEOUTERBOUND) have forward refs?
 *
 * IFC structure:
 *   IFCWALL → IFCPRODUCTDEFINITIONSHAPE → IFCSHAPEREPRESENTATION → IFCFACETEDBREP
 *              ↓                                                    ↓
 *   IFCLOCALPLACEMENT                           IFCCLOSEDSHELL → IFCFACE → IFCFACEOUTERBOUND → IFCPOLYLOOP
 *                                                                                               ↓
 *                                                                                        IFCCARTESIANPOINT
 *
 * The question: Are IFCFACEOUTERBOUND refs to IFCFACE forward, or to points/loops?
 */

import * as fs from 'fs';
import * as path from 'path';

interface EntityInfo {
  id: number;
  type: string;
  refs: number[];
}

// Types that are geometry "entry points" - these are what we need to process
const GEOMETRY_ROOTS = new Set([
  'IFCFACETEDBREP', 'IFCEXTRUDEDAREASOLID', 'IFCTRIANGULATEDFACESET',
  'IFCPOLYGONALFACESET', 'IFCADVANCEDBREP', 'IFCSWEPTDISKSOLID',
  'IFCREVOLVEDAREASOLID', 'IFCBOOLEANCLIPPINGRESULT', 'IFCMAPPEDITEM',
  'IFCFACEBASEDSURFACEMODEL', 'IFCSURFACEOFLINEAREXTRUSION'
]);

// Types that are internal to geometry (FacetedBrep components)
const GEOMETRY_INTERNAL = new Set([
  'IFCCLOSEDSHELL', 'IFCOPENSHELL', 'IFCFACE', 'IFCFACEOUTERBOUND',
  'IFCFACEBOUND', 'IFCPOLYLOOP', 'IFCORIENTEDEDGE', 'IFCEDGECURVE',
  'IFCVERTEXPOINT'
]);

// Types that are geometry support (profiles, curves, points)
const GEOMETRY_SUPPORT = new Set([
  'IFCCARTESIANPOINT', 'IFCDIRECTION', 'IFCAXIS2PLACEMENT3D',
  'IFCAXIS2PLACEMENT2D', 'IFCAXIS1PLACEMENT', 'IFCLOCALPLACEMENT',
  'IFCRECTANGLEPROFILEDEF', 'IFCARBITRARYCLOSEDPROFILEDEF',
  'IFCARBITRARYOPENPROFILEDEF', 'IFCCIRCLEPROFILEDEF', 'IFCISHAPEPROFILEDEF',
  'IFCPOLYLINE', 'IFCCOMPOSITECURVE', 'IFCTRIMMEDCURVE', 'IFCLINE', 'IFCCIRCLE'
]);

// Types that are NEVER needed for geometry processing
const NON_GEOMETRY = new Set([
  'IFCRELCONTAINEDINSPATIALSTRUCTURE', 'IFCRELDEFINESBYTYPE',
  'IFCRELDEFINESBYPROPERTIES', 'IFCRELASSOCIATESMATERIAL',
  'IFCRELASSOCIATESCLASSIFICATION', 'IFCPRESENTATIONLAYERASSIGNMENT',
  'IFCRELAGGREGATES', 'IFCRELVOIDSELEMENT', 'IFCRELSPACEBOUNDARY',
  'IFCPROPERTYSET', 'IFCPROPERTYSINGLEVALUE', 'IFCELEMENTQUANTITY'
]);

function parseEntities(content: string): Map<number, EntityInfo> {
  const entities = new Map<number, EntityInfo>();
  const regex = /#(\d+)\s*=\s*(\w+)\s*\(([^;]*)\);/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    const type = match[2];
    const args = match[3];

    // Extract refs
    const refs: number[] = [];
    const refRegex = /#(\d+)/g;
    let refMatch;
    while ((refMatch = refRegex.exec(args)) !== null) {
      refs.push(parseInt(refMatch[1], 10));
    }

    entities.set(id, { id, type, refs });
  }

  return entities;
}

function analyzeGeometryDependencies(entities: Map<number, EntityInfo>) {
  const results = {
    geometryRoots: 0,
    rootsWithAllBackwardRefs: 0,
    rootsWithForwardRefs: 0,
    forwardRefCategories: {
      toGeometryInternal: 0,  // IFCFACE → IFCFACEOUTERBOUND (acceptable - same BREP)
      toGeometrySupport: 0,   // To points/axes (should be backward)
      toNonGeometry: 0,       // To relationships (ignorable for geometry)
      toOtherRoots: 0,        // To other geometry entities (problematic)
      toUnknown: 0
    },
    // Detailed breakdown
    rootForwardRefsByType: new Map<string, number>(),
    internalForwardRefsByType: new Map<string, number>()
  };

  for (const [id, entity] of entities) {
    if (!GEOMETRY_ROOTS.has(entity.type)) continue;

    results.geometryRoots++;

    // Check ALL transitive dependencies for this geometry root
    const visited = new Set<number>();
    const queue = [id];
    let hasProblematicForwardRef = false;

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const current = entities.get(currentId);
      if (!current) continue;

      for (const refId of current.refs) {
        const refEntity = entities.get(refId);
        if (!refEntity) continue;

        // Is this a forward reference?
        if (refId > currentId) {
          // Categorize the forward ref
          if (GEOMETRY_INTERNAL.has(refEntity.type)) {
            results.forwardRefCategories.toGeometryInternal++;
          } else if (GEOMETRY_SUPPORT.has(refEntity.type)) {
            results.forwardRefCategories.toGeometrySupport++;
            // This is problematic - point defined AFTER face?
            hasProblematicForwardRef = true;
            const key = `${entity.type} → ${refEntity.type}`;
            const count = results.rootForwardRefsByType.get(key) || 0;
            results.rootForwardRefsByType.set(key, count + 1);
          } else if (NON_GEOMETRY.has(refEntity.type)) {
            results.forwardRefCategories.toNonGeometry++;
          } else if (GEOMETRY_ROOTS.has(refEntity.type)) {
            results.forwardRefCategories.toOtherRoots++;
            hasProblematicForwardRef = true;
          } else {
            results.forwardRefCategories.toUnknown++;
          }
        }

        // Continue traversing if this is a geometry-related entity
        if (GEOMETRY_INTERNAL.has(refEntity.type) || GEOMETRY_SUPPORT.has(refEntity.type)) {
          queue.push(refId);
        }
      }
    }

    if (hasProblematicForwardRef) {
      results.rootsWithForwardRefs++;
    } else {
      results.rootsWithAllBackwardRefs++;
    }
  }

  return results;
}

// Analyze IFCFACEOUTERBOUND specifically
function analyzeFaceOuterBoundPattern(entities: Map<number, EntityInfo>) {
  let total = 0;
  let forwardToPolyloop = 0;
  let backwardToPolyloop = 0;

  for (const [id, entity] of entities) {
    if (entity.type !== 'IFCFACEOUTERBOUND' && entity.type !== 'IFCFACEBOUND') continue;
    total++;

    // IFCFACEOUTERBOUND(#loop, .T.)
    // First ref should be the polyloop
    if (entity.refs.length > 0) {
      const loopRef = entity.refs[0];
      if (loopRef > id) {
        forwardToPolyloop++;
      } else {
        backwardToPolyloop++;
      }
    }
  }

  return { total, forwardToPolyloop, backwardToPolyloop };
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : [
    'tests/models/ara3d/AC20-FZK-Haus.ifc',
    'tests/models/various/01_BIMcollab_Example_ARC.ifc',
    'tests/models/ara3d/dental_clinic.ifc'
  ];

  console.log('='.repeat(80));
  console.log('DEEP FORWARD REFERENCE ANALYSIS - Geometry Dependencies');
  console.log('='.repeat(80));
  console.log('');

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      continue;
    }

    const fileName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileSize = fs.statSync(filePath).size;

    console.log(`Analyzing: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

    const entities = parseEntities(content);
    console.log(`  Total entities: ${entities.size.toLocaleString()}`);

    const geomAnalysis = analyzeGeometryDependencies(entities);
    console.log(`\n  GEOMETRY ROOT ANALYSIS:`);
    console.log(`    Geometry roots: ${geomAnalysis.geometryRoots.toLocaleString()}`);
    console.log(`    Roots with ALL backward refs: ${geomAnalysis.rootsWithAllBackwardRefs.toLocaleString()} (${(geomAnalysis.rootsWithAllBackwardRefs / geomAnalysis.geometryRoots * 100).toFixed(1)}%)`);
    console.log(`    Roots with problematic forward refs: ${geomAnalysis.rootsWithForwardRefs.toLocaleString()}`);

    console.log(`\n  FORWARD REF CATEGORIES (from geometry roots):`);
    console.log(`    To internal (IFCFACE etc): ${geomAnalysis.forwardRefCategories.toGeometryInternal} (OK - same BREP)`);
    console.log(`    To support (points/axes): ${geomAnalysis.forwardRefCategories.toGeometrySupport} (PROBLEMATIC)`);
    console.log(`    To relationships: ${geomAnalysis.forwardRefCategories.toNonGeometry} (ignorable)`);
    console.log(`    To other roots: ${geomAnalysis.forwardRefCategories.toOtherRoots} (PROBLEMATIC)`);
    console.log(`    To unknown: ${geomAnalysis.forwardRefCategories.toUnknown}`);

    if (geomAnalysis.rootForwardRefsByType.size > 0) {
      console.log(`\n  PROBLEMATIC FORWARD REF PATTERNS:`);
      const sorted = [...geomAnalysis.rootForwardRefsByType.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [pattern, count] of sorted) {
        console.log(`    ${pattern}: ${count}`);
      }
    }

    const faceAnalysis = analyzeFaceOuterBoundPattern(entities);
    if (faceAnalysis.total > 0) {
      console.log(`\n  IFCFACEBOUND/IFCFACEOUTERBOUND PATTERN:`);
      console.log(`    Total: ${faceAnalysis.total.toLocaleString()}`);
      console.log(`    Forward refs to polyloop: ${faceAnalysis.forwardToPolyloop.toLocaleString()} (${(faceAnalysis.forwardToPolyloop / faceAnalysis.total * 100).toFixed(1)}%)`);
      console.log(`    Backward refs to polyloop: ${faceAnalysis.backwardToPolyloop.toLocaleString()}`);
    }

    // Key insight: Can we process geometry immediately?
    const canStreamPercent = geomAnalysis.geometryRoots > 0
      ? (geomAnalysis.rootsWithAllBackwardRefs / geomAnalysis.geometryRoots * 100)
      : 0;

    console.log(`\n  📊 STREAMING VIABILITY:`);
    if (canStreamPercent >= 95) {
      console.log(`    ✅ ${canStreamPercent.toFixed(1)}% of geometry can be processed immediately`);
    } else if (canStreamPercent >= 80) {
      console.log(`    ⚠️  ${canStreamPercent.toFixed(1)}% of geometry can be processed immediately`);
    } else {
      console.log(`    ❌ Only ${canStreamPercent.toFixed(1)}% of geometry can be processed immediately`);
    }

    console.log('\n' + '-'.repeat(80) + '\n');
  }
}

main().catch(console.error);
