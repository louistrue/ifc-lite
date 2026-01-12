# IFC Parser Coverage: Our Implementation vs IfcOpenShell

## Executive Summary

**Our Parser:** Hand-crafted, schema-aware TypeScript/Rust implementation with ~50-70 manually implemented IFC entity types, optimized for web performance with columnar storage and WebGPU integration.

**IfcOpenShell:** Schema-generated C++ library with complete coverage of IFC2x3, IFC4, IFC4x1, IFC4x2, and IFC4x3 through automatic code generation from EXPRESS schemas.

**Key Gap:** IfcOpenShell achieves comprehensive coverage by **generating code from official .exp schema files**, while we manually implement entity types.

---

## Coverage Comparison

### Our Current Coverage (~50-70 Entity Types)

| Category | Entity Types | Coverage |
|----------|--------------|----------|
| **Spatial Structure** | IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey, IfcSpace | ✅ Core |
| **Building Elements** | IfcWall, IfcDoor, IfcWindow, IfcSlab, IfcColumn, IfcBeam, IfcStair, IfcRoof, IfcRailing, IfcCurtainWall, IfcCovering | ✅ Common |
| **MEP Systems** | IfcDistributionElement, IfcFlowSegment, IfcFlowTerminal, IfcFlowFitting | ⚠️ Basic |
| **Properties** | IfcPropertySet, IfcPropertySingleValue, IfcElementQuantity, various quantity types | ✅ Comprehensive |
| **Relationships** | 7 key types (containment, aggregation, properties, materials, voids, etc.) | ✅ Core |
| **Geometry** | IfcProduct, ObjectPlacement, Representation | ✅ Core |
| **Materials** | IfcRelAssociatesMaterial (relationship only) | ⚠️ Minimal |
| **Styles/Appearance** | IfcStyledItem, IfcSurfaceStyle, IfcColourRgb | ✅ Good |
| **Type Definitions** | IfcWallType, IfcDoorType, IfcWindowType, etc. | ⚠️ Limited |

### What We're Missing

❌ **Civil/Infrastructure (IFC4x3):**
- IfcRoad, IfcRailway, IfcBridge, IfcTunnel
- IfcAlignment, IfcCurveSegment
- IfcEarthworks

❌ **Advanced Geometry:**
- IfcAdvancedBrep, IfcManifoldSolidBrep
- IfcBooleanResult, IfcBooleanClippingResult
- IfcSweptDiskSolid, IfcRevolvedAreaSolid
- Complex curve types (IfcCompositeCurve, IfcBSplineCurve)

❌ **Materials System:**
- IfcMaterial, IfcMaterialLayer, IfcMaterialLayerSet
- IfcMaterialConstituent, IfcMaterialConstituentSet
- IfcMaterialProfile, IfcMaterialProfileSet

❌ **Georeferencing:**
- IfcMapConversion, IfcProjectedCRS
- IfcCoordinateOperation

❌ **Structural Analysis:**
- IfcStructuralAnalysisModel
- IfcStructuralLoadGroup, IfcStructuralMember
- IfcStructuralConnection

❌ **HVAC/Plumbing Details:**
- IfcAirTerminal, IfcBoiler, IfcChiller, IfcPump
- IfcDuctSegment, IfcPipeSegment
- IfcSanitaryTerminal, IfcFireSuppressionTerminal

❌ **Classification Systems:**
- IfcClassification, IfcClassificationReference
- IfcRelAssociatesClassification

❌ **Constraints & Approvals:**
- IfcConstraint, IfcObjective
- IfcApproval, IfcApprovalRelationship

❌ **Cost/Scheduling:**
- IfcCostItem, IfcCostSchedule
- IfcTask, IfcWorkSchedule

### IfcOpenShell Coverage

✅ **Complete parsing support:**
- IFC2x3 TC1 (~640 entities)
- IFC4 Add2 TC1 (~776 entities)
- IFC4x1 (~769 entities)
- IFC4x2 (~827 entities)
- IFC4x3 Add2 (~1063 entities + infrastructure)

✅ **Extensive geometric support:**
- IFC2x3 TC1
- IFC4 Add2 TC1

✅ **Format support:**
- IFC-SPF (STEP)
- IFC-XML
- IFC-JSON
- IFC-HDF5
- IFC-SQL

✅ **Additional standards:**
- BCF (BIM Collaboration Format)
- IDS (Information Delivery Specification)

---

## Architecture Comparison

### Our Approach: Manual Implementation

**Pros:**
- ✅ Optimized for specific use cases (web viewing)
- ✅ Fast byte-level STEP parsing (~1,259 MB/s)
- ✅ Lightweight (~50-70 entities vs 1000+)
- ✅ Columnar storage optimized for queries
- ✅ WebGPU integration
- ✅ Zero-copy TypedArrays
- ✅ Smaller bundle size

**Cons:**
- ❌ Requires manual updates for new IFC versions
- ❌ Limited entity coverage (~7% of IFC4x3)
- ❌ Missing advanced concepts (materials, georef, civil)
- ❌ Schema changes need code changes

**Architecture:**
```
IFC File → StepTokenizer → EntityIndexBuilder → EntityExtractor
    ↓
Specialized Extractors (Property, Relationship, Style, Spatial)
    ↓
Columnar Data Store (TypedArrays) → WebGPU Rendering
```

### IfcOpenShell Approach: Schema Generation

**Pros:**
- ✅ Complete schema coverage (100%)
- ✅ Automatic updates from .exp files
- ✅ Multiple IFC versions supported
- ✅ All concepts implemented (materials, georef, etc.)
- ✅ Runtime schema loading (Python)
- ✅ Multiple export formats

**Cons:**
- ❌ Larger binary size (comprehensive C++ library)
- ❌ Geometry processing is complex/slower
- ❌ Not optimized for web (C++/Python)
- ❌ Higher memory usage

**Architecture:**
```
IFC EXPRESS Schema (.exp file)
    ↓
EXPRESS Parser (Python/funcparserlib)
    ↓
Code Generator (ANTLR/Grammar)
    ↓
Generated C++ Classes (compile-time)
    ↓
ifcparse (parsing) + ifcgeom (geometry) + ifcwrap (bindings)
    ↓
Python/C++ API with complete schema access
```

---

## How to Achieve Broad Coverage Without Manual Implementation

### Option 1: TypeScript Code Generation from EXPRESS Schemas ⭐ **RECOMMENDED**

**Approach:** Build a TypeScript code generator that parses official IFC .exp files and generates type definitions, parsers, and entity handlers.

**Implementation Steps:**

1. **Download Official Schemas**
   - IFC4.exp from buildingSMART: https://github.com/buildingSMART/IFC4.3.x-output
   - IFC4x3.exp from buildingSMART
   - Store in `/packages/parser/schemas/`

2. **Build EXPRESS Parser**
   - Use existing JavaScript parser: https://github.com/AlanRynne/ifc-syntax-express-parser (Nearley.js)
   - Or port Python parser from IfcOpenShell
   - Parse .exp files into AST (Entity definitions, Type definitions, Attributes, Inheritance)

3. **Generate TypeScript Code**
   - **Entity Interfaces:** Generate TypeScript interfaces for each entity
   ```typescript
   // Generated from EXPRESS
   export interface IfcWall extends IfcBuildingElement {
     GlobalId: string;
     Name?: string;
     PredefinedType?: IfcWallTypeEnum;
     // ... all attributes from inheritance chain
   }
   ```

   - **Type Registry:** Generate schema registry similar to our current `ifc-schema.ts`
   ```typescript
   // Auto-generated
   export const IFC_SCHEMA = {
     IfcWall: {
       parent: 'IfcBuildingElement',
       attributes: ['GlobalId', 'OwnerHistory', ...],
       // ...
     }
   };
   ```

   - **Attribute Parsers:** Generate specialized parsers for complex types
   ```typescript
   // Generated parser for IfcMaterialLayerSet
   export function parseIfcMaterialLayerSet(entity: IfcEntity): IfcMaterialLayerSet {
     return {
       MaterialLayers: parseList(entity.attributes[0], parseIfcMaterialLayer),
       LayerSetName: parseString(entity.attributes[1]),
     };
   }
   ```

4. **Integration Points**
   - Keep existing StepTokenizer (fast byte-level parsing)
   - Replace manual entity handling with generated code
   - Add concept-specific extractors (materials, georeferencing) as needed
   - Maintain columnar storage for performance

**Benefits:**
- ✅ 100% schema coverage automatically
- ✅ Easy updates (regenerate from new .exp files)
- ✅ Type-safe TypeScript
- ✅ Keeps our performance optimizations
- ✅ Can generate only needed entities for bundle size

**Effort:** Medium (2-3 weeks initial, then maintenance-free)

**Example Tools:**
- IFC-gen (C#/TypeScript): https://github.com/hypar-io/IFC-gen
- ifc-syntax-express-parser (JS): https://github.com/AlanRynne/ifc-syntax-express-parser

---

### Option 2: Runtime Schema-Driven Parser

**Approach:** Load EXPRESS schemas at runtime and dynamically parse entities without code generation.

**Implementation:**
1. Parse .exp files into JSON schema at build time
2. Load schema definition at runtime
3. Use generic entity parser that consults schema for:
   - Attribute names and types
   - Inheritance chains
   - Valid relationships

**Benefits:**
- ✅ No code generation step
- ✅ Can load custom schemas
- ✅ Flexible for experimentation

**Drawbacks:**
- ❌ Runtime overhead (schema lookups)
- ❌ No TypeScript type safety
- ❌ Larger runtime schema payload

**Effort:** Low-Medium (1-2 weeks)

---

### Option 3: Hybrid Approach (Tiered Coverage)

**Approach:** Generate code for common entities, use dynamic parsing for rare entities.

**Implementation:**
1. Identify "hot path" entities (walls, doors, spatial, properties) - ~100 entities
2. Generate optimized code for these entities
3. Use generic parser for rare entities (cost scheduling, structural analysis)
4. Lazy load rare entity parsers on demand

**Benefits:**
- ✅ Best performance for common cases
- ✅ Complete coverage when needed
- ✅ Smaller initial bundle
- ✅ Type-safe for common entities

**Effort:** Medium-High (3-4 weeks)

---

### Option 4: Integrate IfcOpenShell via WASM

**Approach:** Compile IfcOpenShell to WebAssembly and use as parsing backend.

**Implementation:**
1. Compile IfcOpenShell C++ to WASM using Emscripten
2. Create JavaScript/TypeScript wrapper
3. Stream IFC files to WASM parser
4. Convert output to our columnar format

**Benefits:**
- ✅ Complete coverage immediately
- ✅ Battle-tested parser
- ✅ Geometric processing included

**Drawbacks:**
- ❌ Large WASM binary (~5-10 MB)
- ❌ Memory copying overhead (WASM ↔ JS)
- ❌ Less control over parsing
- ❌ Dependency maintenance

**Effort:** Low-Medium (1-2 weeks integration, but ongoing maintenance)

**Note:** IfcOpenShell already has WASM builds, so this may be simpler than expected.

---

### Option 5: Delegate to Backend Service

**Approach:** Parse IFC files server-side using IfcOpenShell/Python, stream results to client.

**Implementation:**
1. Upload IFC files to backend
2. Parse with IfcOpenShell (full coverage)
3. Extract needed data (geometry, properties)
4. Stream columnar data to frontend
5. Client only handles rendering/queries

**Benefits:**
- ✅ Complete coverage without client complexity
- ✅ Smaller client bundle
- ✅ Can use full IfcOpenShell ecosystem
- ✅ Preprocessing (optimization, validation) possible

**Drawbacks:**
- ❌ Network latency
- ❌ Server costs
- ❌ Requires backend infrastructure
- ❌ Privacy concerns (file upload)

**Effort:** Medium (2-3 weeks)

---

## Recommendations

### Immediate (Phase 1): TypeScript Code Generation ⭐

**Why:** Maximum benefit-to-effort ratio. Achieves 100% coverage while maintaining our performance advantages and TypeScript type safety.

**Action Items:**
1. Set up code generator project (`/packages/codegen/`)
2. Integrate EXPRESS parser (evaluate existing JS parsers)
3. Generate entity interfaces + schema registry
4. Test with IFC4 schema first (most common)
5. Update parser to use generated types
6. Add IFC4x3 support for infrastructure

**Timeline:** 2-3 weeks
**Risk:** Low (can run in parallel with current parser)

---

### Medium-term (Phase 2): Concept-Specific Handlers

After code generation is working, add specialized extractors for:

1. **Materials System Extractor** (`material-extractor.ts`)
   - Parse IfcMaterial, IfcMaterialLayer, IfcMaterialProfile
   - Build material hierarchy
   - Map to rendering materials

2. **Georeferencing Extractor** (`georef-extractor.ts`)
   - Extract IfcMapConversion, IfcProjectedCRS
   - Transform coordinates to target CRS
   - Enable GIS integration

3. **Classification Extractor** (`classification-extractor.ts`)
   - Extract IfcClassification, IfcClassificationReference
   - Support Uniclass, Omniclass, MasterFormat

4. **Advanced Geometry Processor** (Rust)
   - CSG boolean operations
   - B-rep geometry
   - Swept solids

**Timeline:** 1 week each
**Total:** 4-6 weeks

---

### Long-term (Phase 3): Multi-Format Support

1. **IFC-XML Parser**
   - SAX-based streaming parser
   - Convert to same columnar format
   - Enable XML-based workflows

2. **IFC-JSON Support**
   - Native JSON parsing
   - Potentially smaller payloads
   - Better web compatibility

3. **Export Formats**
   - Complete glTF export (done)
   - Parquet/DuckDB integration
   - CSV/JSON-LD for data analysis

---

## Performance Considerations

### Bundle Size Impact

| Approach | Estimated Bundle Size |
|----------|----------------------|
| Current (manual) | ~100 KB |
| Full code generation | ~500-800 KB (all entities) |
| Selective generation | ~200-300 KB (common entities) |
| Runtime schema | ~300 KB (schema JSON + parser) |
| IfcOpenShell WASM | ~5-10 MB |

**Mitigation:** Use tree-shaking and lazy loading for rare entities.

### Parse Performance

Code generation should not significantly impact performance:
- Entity extraction remains byte-level scanning
- Generated code can be optimized per entity type
- Columnar storage remains unchanged
- May be slightly slower due to more comprehensive parsing

### Memory Usage

More entities = more memory, but:
- Selective extraction (only parse what's needed)
- Streaming for large files
- Columnar format remains efficient

---

## Conclusion

**Current State:** Our parser is fast, lightweight, and optimized for web viewing, but covers only ~7% of the IFC4x3 schema and lacks key concepts like materials, georeferencing, and infrastructure.

**IfcOpenShell:** Achieves 100% coverage through automatic code generation from official EXPRESS schemas, supporting all IFC versions and concepts.

**Path Forward:** Implement TypeScript code generation from EXPRESS schemas to achieve comprehensive coverage while maintaining our performance advantages. This gives us the best of both worlds: IfcOpenShell's completeness with our web-optimized architecture.

**Key Insight:** The "secret" to broad coverage isn't manual implementation—it's treating IFC schemas as data and generating code from them. This is how IfcOpenShell supports 1000+ entities without manually implementing each one.

---

## References

- [IfcOpenShell GitHub](https://github.com/IfcOpenShell/IfcOpenShell)
- [IfcOpenShell Documentation](https://docs.ifcopenshell.org/)
- [buildingSMART IFC Schemas](https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/)
- [IFC4.3 EXPRESS Files](https://github.com/buildingSMART/IFC4.3.x-output)
- [IFC-gen Code Generator](https://github.com/hypar-io/IFC-gen)
- [ifc-syntax-express-parser](https://github.com/AlanRynne/ifc-syntax-express-parser)
- [IFC_parser (Python)](https://github.com/gsimon75/IFC_parser)

---

**Next Steps:**
1. Review this analysis with team
2. Decide on code generation approach
3. Set up proof-of-concept with IFC4 schema
4. Integrate with existing parser pipeline
5. Test with real-world IFC files
