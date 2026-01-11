/**
 * Debug IFC Color Extraction
 * 
 * Standalone test to analyze how to extract colors from web-ifc.
 * Tests different methods to get colors from IfcSurfaceStyle, IfcStyledItem, etc.
 */

import * as WebIFC from 'web-ifc';
import { readFileSync } from 'fs';
import { join } from 'path';

interface ColorTestResult {
    expressId: number;
    entityType: string;
    methods: {
        placedGeometryColor?: {
            found: boolean;
            color?: { x: number; y: number; z: number; w: number };
        };
        styledItem?: {
            found: boolean;
            styledItemId?: number;
            styles?: any[];
        };
        surfaceStyle?: {
            found: boolean;
            styleId?: number;
            styles?: any[];
        };
        directEntity?: {
            found: boolean;
            entity?: any;
        };
    };
}

async function testColorExtraction(filePath: string): Promise<void> {
    console.log(`\n🔍 Testing IFC Color Extraction: ${filePath}\n`);

    const buffer = readFileSync(filePath);
    console.log(`📦 File size: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB\n`);

    // Initialize web-ifc
    const ifcApi = new WebIFC.IfcAPI();
    console.log('⏳ Initializing web-ifc...');
    const wasmPath = join(process.cwd(), 'public') + '/';
    ifcApi.SetWasmPath(wasmPath, true);
    await ifcApi.Init();
    console.log('✓ web-ifc initialized\n');

    // Load model
    console.log('⏳ Loading IFC model...');
    const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
    console.log(`✓ Model loaded (ID: ${modelID})\n`);

    // Get all geometry to find expressIds
    console.log('⏳ Loading geometry...');
    const geometries = ifcApi.LoadAllGeometry(modelID);
    const geomCount = geometries.size();
    console.log(`✓ Found ${geomCount} flat meshes\n`);

    // Debug: Log geometry expressIDs
    console.log('\n🔍 Checking geometry expressIDs vs IfcStyledItem.Item values:\n');
    
    // Get all IfcStyledItem.Item values
    const styledItemItemValues = new Set<number>();
    const styledItemIds = ifcApi.GetLineIDsWithType(modelID, 3958052878); // IfcStyledItem type ID
    console.log(`Found ${styledItemIds.size()} IfcStyledItem entities`);
    
    for (let i = 0; i < styledItemIds.size(); i++) {
        try {
            const styledItem = ifcApi.GetLine(modelID, styledItemIds.get(i)) as any;
            if (styledItem.Item && styledItem.Item.value) {
                styledItemItemValues.add(styledItem.Item.value);
            }
        } catch (e) {}
    }
    console.log(`Unique IfcStyledItem.Item values: ${styledItemItemValues.size}`);
    console.log(`Sample values: ${Array.from(styledItemItemValues).slice(0, 20).join(', ')}`);
    
    // Check first few geometry expressIDs
    console.log('\nFirst 10 flatMesh geometry expressIDs:');
    for (let i = 0; i < Math.min(10, geomCount); i++) {
        const flatMesh = geometries.get(i);
        const geomIds: number[] = [];
        for (let j = 0; j < flatMesh.geometries.size(); j++) {
            const placed = flatMesh.geometries.get(j);
            geomIds.push(placed.geometryExpressID);
        }
        console.log(`  Mesh ${i} (element #${flatMesh.expressID}): geometryExpressIDs = [${geomIds.join(', ')}]`);
        
        // Check if any match
        const matches = geomIds.filter(id => styledItemItemValues.has(id));
        if (matches.length > 0) {
            console.log(`    ✓ MATCH FOUND: ${matches.join(', ')}`);
        }
    }

    // Test first 10 meshes
    const testCount = Math.min(10, geomCount);
    const results: ColorTestResult[] = [];

    console.log(`\n🔬 Testing color extraction for first ${testCount} meshes:\n`);
    console.log('═'.repeat(80));

    for (let i = 0; i < testCount; i++) {
        const flatMesh = geometries.get(i);
        const expressID = flatMesh.expressID;
        
        // Get entity type
        let entityType = 'UNKNOWN';
        try {
            entityType = ifcApi.GetLineType(modelID, expressID);
        } catch (e) {
            // Ignore
        }

        const result: ColorTestResult = {
            expressId: expressID,
            entityType,
            methods: {},
        };

        // Method 1: Check PlacedGeometry color
        if (flatMesh.geometries && flatMesh.geometries.size() > 0) {
            const placed = flatMesh.geometries.get(0);
            if (placed.color) {
                const color = placed.color as any;
                result.methods.placedGeometryColor = {
                    found: true,
                    color: {
                        x: color.x,
                        y: color.y,
                        z: color.z,
                        w: color.w,
                    },
                };
            } else {
                result.methods.placedGeometryColor = { found: false };
            }
        }

        // Method 2: Try to get IfcStyledItem
        try {
            // Search for IfcStyledItem that references this expressID
            // IfcStyledItem.Item = expressID
            const allLines = ifcApi.GetLineIDsWithType(modelID, 'IFCSTYLEDITEM');
            for (let j = 0; j < allLines.size(); j++) {
                const styledItemId = allLines.get(j);
                try {
                    const styledItem = ifcApi.GetLine(modelID, styledItemId);
                    // Check if this styled item references our expressID
                    // Item attribute is usually at index 1
                    const itemRef = styledItem[1];
                    if (itemRef && itemRef.value === expressID) {
                        result.methods.styledItem = {
                            found: true,
                            styledItemId,
                            styles: [],
                        };
                        
                        // Get styles (Styles attribute is usually at index 2)
                        const stylesRef = styledItem[2];
                        if (stylesRef) {
                            if (Array.isArray(stylesRef)) {
                                for (const styleRef of stylesRef) {
                                    if (styleRef && styleRef.value) {
                                        result.methods.styledItem!.styles!.push(styleRef.value);
                                    }
                                }
                            } else if (stylesRef.value) {
                                result.methods.styledItem!.styles!.push(stylesRef.value);
                            }
                        }
                        break;
                    }
                } catch (e) {
                    // Continue searching
                }
            }
            
            if (!result.methods.styledItem) {
                result.methods.styledItem = { found: false };
            }
        } catch (e) {
            result.methods.styledItem = { found: false };
        }

        // Method 3: Try to get IfcSurfaceStyle directly
        try {
            const surfaceStyleIds = ifcApi.GetLineIDsWithType(modelID, 'IFCSURFACESTYLE');
            if (surfaceStyleIds.size() > 0) {
                // Get first surface style as example
                const styleId = surfaceStyleIds.get(0);
                const surfaceStyle = ifcApi.GetLine(modelID, styleId);
                result.methods.surfaceStyle = {
                    found: true,
                    styleId,
                    styles: [surfaceStyle],
                };
            } else {
                result.methods.surfaceStyle = { found: false };
            }
        } catch (e) {
            result.methods.surfaceStyle = { found: false };
        }

        // Method 4: Get the entity directly and inspect it
        try {
            const entity = ifcApi.GetLine(modelID, expressID);
            result.methods.directEntity = {
                found: true,
                entity: entity,
            };
        } catch (e) {
            result.methods.directEntity = { found: false };
        }

        results.push(result);

        // Print result
        console.log(`\n📦 Mesh ${i + 1} (expressID: ${expressID}, type: ${entityType})`);
        console.log('─'.repeat(80));
        
        if (result.methods.placedGeometryColor?.found) {
            const c = result.methods.placedGeometryColor.color!;
            console.log(`  ✓ PlacedGeometry.color: rgba(${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}, ${c.w.toFixed(3)})`);
        } else {
            console.log(`  ✗ PlacedGeometry.color: NOT FOUND`);
        }

        if (result.methods.styledItem?.found) {
            console.log(`  ✓ IfcStyledItem: Found (ID: ${result.methods.styledItem.styledItemId})`);
            console.log(`    Styles: ${result.methods.styledItem.styles?.length || 0} style(s)`);
            if (result.methods.styledItem.styles && result.methods.styledItem.styles.length > 0) {
                for (const styleId of result.methods.styledItem.styles) {
                    try {
                        const style = ifcApi.GetLine(modelID, styleId);
                        const styleType = ifcApi.GetLineType(modelID, styleId);
                        console.log(`      - Style ${styleId} (${styleType}):`, JSON.stringify(style, null, 2).substring(0, 200));
                    } catch (e) {
                        console.log(`      - Style ${styleId}: Error reading`);
                    }
                }
            }
        } else {
            console.log(`  ✗ IfcStyledItem: NOT FOUND`);
        }

        if (result.methods.surfaceStyle?.found) {
            console.log(`  ✓ IfcSurfaceStyle: Found (ID: ${result.methods.surfaceStyle.styleId})`);
            const style = result.methods.surfaceStyle.styles![0];
            console.log(`    Style data:`, JSON.stringify(style, null, 2).substring(0, 300));
        } else {
            console.log(`  ✗ IfcSurfaceStyle: NOT FOUND`);
        }

        if (result.methods.directEntity?.found) {
            console.log(`  ✓ Direct entity: Found`);
            const entity = result.methods.directEntity.entity;
            console.log(`    Entity keys:`, Object.keys(entity).slice(0, 10).join(', '));
            // Look for color-related attributes
            const colorKeys = Object.keys(entity).filter(k => 
                k.toLowerCase().includes('color') || 
                k.toLowerCase().includes('colour') ||
                k.toLowerCase().includes('style')
            );
            if (colorKeys.length > 0) {
                console.log(`    Color-related keys:`, colorKeys.join(', '));
            }
        } else {
            console.log(`  ✗ Direct entity: NOT FOUND`);
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('\n📊 SUMMARY\n');
    
    const withPlacedColor = results.filter(r => r.methods.placedGeometryColor?.found).length;
    const withStyledItem = results.filter(r => r.methods.styledItem?.found).length;
    const withSurfaceStyle = results.filter(r => r.methods.surfaceStyle?.found).length;
    
    console.log(`Meshes with PlacedGeometry.color: ${withPlacedColor}/${testCount}`);
    console.log(`Meshes with IfcStyledItem: ${withStyledItem}/${testCount}`);
    console.log(`IfcSurfaceStyle found in model: ${withSurfaceStyle > 0 ? 'YES' : 'NO'}`);

    // Test getting IfcColourRgb - try both string and direct access
    console.log('\n🎨 Testing IfcColourRgb extraction:\n');
    try {
        // Try string type name
        let colorRgbIds = ifcApi.GetLineIDsWithType(modelID, 'IFCCOLOURRGB');
        console.log(`GetLineIDsWithType('IFCCOLOURRGB'): Found ${colorRgbIds.size()} entities`);
        
        // Try known expressIDs from IFC file (from grep results: #423, #4980, #5127)
        const knownColorIds = [423, 4980, 5127];
        console.log(`\nTrying known IfcColourRgb expressIDs: ${knownColorIds.join(', ')}`);
        
        for (const colorId of knownColorIds) {
            try {
                const entityType = ifcApi.GetLineType(modelID, colorId);
                const entityTypeStr = typeof entityType === 'string' ? entityType : `numeric(${entityType})`;
                console.log(`  ExpressID ${colorId}: type = ${entityTypeStr}`);
                
                // Type ID 776857604 appears to be IfcColourRgb
                const colorRgb = ifcApi.GetLine(modelID, colorId);
                console.log(`  Entity data:`, JSON.stringify(colorRgb, null, 2).substring(0, 500));
                
                // Try to extract RGB values - web-ifc stores entities as arrays
                // IfcColourRgb structure: Name (0), Red (1), Green (2), Blue (3)
                if (Array.isArray(colorRgb)) {
                    console.log(`  Array length: ${colorRgb.length}`);
                    if (colorRgb.length >= 4) {
                        const red = colorRgb[1];
                        const green = colorRgb[2];
                        const blue = colorRgb[3];
                        console.log(`  ✓ RGB: (${red}, ${green}, ${blue})`);
                        console.log(`  ✓ Normalized RGB: (${red.toFixed(3)}, ${green.toFixed(3)}, ${blue.toFixed(3)})`);
                    }
                } else if (typeof colorRgb === 'object') {
                    console.log(`  Object keys:`, Object.keys(colorRgb).slice(0, 10).join(', '));
                    // Check common color property names
                    if (colorRgb.Red !== undefined || colorRgb.red !== undefined) {
                        console.log(`  RGB (as object): (${colorRgb.Red || colorRgb.red}, ${colorRgb.Green || colorRgb.green}, ${colorRgb.Blue || colorRgb.blue})`);
                    }
                }
            } catch (e) {
                console.log(`  ExpressID ${colorId}: Error - ${e}`);
            }
        }
    } catch (e) {
        console.log(`Error getting IfcColourRgb:`, e);
    }

    // Test IfcSurfaceStyleRendering - try known IDs
    console.log('\n🎨 Testing IfcSurfaceStyleRendering extraction:\n');
    try {
        let renderingIds = ifcApi.GetLineIDsWithType(modelID, 'IFCSURFACESTYLERENDERING');
        console.log(`GetLineIDsWithType('IFCSURFACESTYLERENDERING'): Found ${renderingIds.size()} entities`);
        
        // Known IDs from IFC file: #424, #4981, #5128
        const knownRenderingIds = [424, 4981, 5128];
        console.log(`\nTrying known IfcSurfaceStyleRendering expressIDs: ${knownRenderingIds.join(', ')}`);
        
        for (const renderingId of knownRenderingIds) {
            try {
                const entityType = ifcApi.GetLineType(modelID, renderingId);
                const entityTypeStr = typeof entityType === 'string' ? entityType : `numeric(${entityType})`;
                console.log(`  ExpressID ${renderingId}: type = ${entityTypeStr}`);
                
                // Type ID 1878645084 appears to be IfcSurfaceStyleRendering
                const rendering = ifcApi.GetLine(modelID, renderingId);
                console.log(`  Entity data:`, JSON.stringify(rendering, null, 2).substring(0, 800));
                
                // IfcSurfaceStyleRendering structure:
                // SurfaceColour (0) - IfcColourRgb reference
                // Transparency (1) - OPTIONAL
                // DiffuseColour (2) - OPTIONAL
                // SpecularColour (6) - OPTIONAL
                // ReflectanceMethod (8) - enum
                if (Array.isArray(rendering)) {
                    console.log(`  Array length: ${rendering.length}`);
                    if (rendering[0] && rendering[0].value) {
                        const surfaceColorId = rendering[0].value;
                        console.log(`  SurfaceColour reference: ${surfaceColorId}`);
                        // Get the actual color
                        try {
                            const surfaceColor = ifcApi.GetLine(modelID, surfaceColorId);
                            if (Array.isArray(surfaceColor) && surfaceColor.length >= 4) {
                                console.log(`  ✓ SurfaceColour RGB: (${surfaceColor[1]}, ${surfaceColor[2]}, ${surfaceColor[3]})`);
                            }
                        } catch (e) {
                            console.log(`  Error getting surface color: ${e}`);
                        }
                    }
                    if (rendering[1] !== undefined && rendering[1] !== null) {
                        console.log(`  Transparency: ${rendering[1]}`);
                    }
                    if (rendering[8] !== undefined) {
                        console.log(`  ReflectanceMethod: ${rendering[8]}`);
                    }
                }
            } catch (e) {
                console.log(`  ExpressID ${renderingId}: Error - ${e}`);
            }
        }
    } catch (e) {
        console.log(`Error getting IfcSurfaceStyleRendering:`, e);
    }

    // Test IfcStyledItem - try known IDs
    console.log('\n🎨 Testing IfcStyledItem extraction:\n');
    try {
        let styledItemIds = ifcApi.GetLineIDsWithType(modelID, 'IFCSTYLEDITEM');
        console.log(`GetLineIDsWithType('IFCSTYLEDITEM'): Found ${styledItemIds.size()} entities`);
        
        // Known IDs from IFC file: #427, #5131, etc.
        const knownStyledItemIds = [427, 5131];
        console.log(`\nTrying known IfcStyledItem expressIDs: ${knownStyledItemIds.join(', ')}`);
        
        for (const styledItemId of knownStyledItemIds) {
            try {
                const entityType = ifcApi.GetLineType(modelID, styledItemId);
                const entityTypeStr = typeof entityType === 'string' ? entityType : `numeric(${entityType})`;
                console.log(`  ExpressID ${styledItemId}: type = ${entityTypeStr}`);
                
                // Type ID 3958052878 appears to be IfcStyledItem
                const styledItem = ifcApi.GetLine(modelID, styledItemId);
                console.log(`  Entity data:`, JSON.stringify(styledItem, null, 2).substring(0, 500));
                
                // IfcStyledItem structure:
                // Item (0) - reference to styled entity
                // Styles (1) - SET OF IfcPresentationStyleAssignment or IfcSurfaceStyle
                if (Array.isArray(styledItem)) {
                    console.log(`  Array length: ${styledItem.length}`);
                    if (styledItem[0] && styledItem[0].value) {
                        console.log(`  Item (styled entity) reference: ${styledItem[0].value}`);
                    }
                    if (styledItem[1]) {
                        const styles = Array.isArray(styledItem[1]) ? styledItem[1] : [styledItem[1]];
                        console.log(`  Styles count: ${styles.length}`);
                        for (const styleRef of styles) {
                            if (styleRef && styleRef.value) {
                                console.log(`    Style reference: ${styleRef.value}`);
                                // Get the style
                                try {
                                    const style = ifcApi.GetLine(modelID, styleRef.value);
                                    const styleType = ifcApi.GetLineType(modelID, styleRef.value);
                                    console.log(`      Style type: ${typeof styleType === 'string' ? styleType : `numeric(${styleType})`}`);
                                    console.log(`      Style data:`, JSON.stringify(style, null, 2).substring(0, 300));
                                } catch (e) {
                                    console.log(`      Error getting style: ${e}`);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log(`  ExpressID ${styledItemId}: Error - ${e}`);
            }
        }
    } catch (e) {
        console.log(`Error getting IfcStyledItem:`, e);
    }

    console.log('\n✅ Color extraction test complete!\n');
}

// Main execution
const filePath = process.argv[2] || join(process.cwd(), '..', '01_Snowdon_Towers_Sample_Structural(1).ifc');

testColorExtraction(filePath)
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
