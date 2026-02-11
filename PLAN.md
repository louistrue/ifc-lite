# Implementation Plan: Options A + B + Document References

## Overview

Three workstreams delivering complete BIM property panel data display, proper IFC roundtrip editing, and document reference support.

---

## PART A: Show Everything We Already Parse

### A1. Type-Level Properties in Property Panel
**Goal**: When an element has an IfcRelDefinesByType, show the type's properties in a separate "Type Properties" section.

**Files to modify**:
- `packages/parser/src/columnar-parser.ts`
  - Add `extractTypePropertiesOnDemand(store, entityId)` function
  - Uses relationship graph: `store.relationships.getRelated(entityId, RelationshipType.DefinesByType, 'inverse')` to get the type entity ID
  - Then calls `extractPropertiesOnDemand(store, typeId)` to get the type's properties
  - Returns `{ typeName: string; typeId: number; properties: PropertySet[] }` or null

- `packages/parser/src/index.ts`
  - Export `extractTypePropertiesOnDemand` and its return type

- `apps/viewer/src/components/viewer/PropertiesPanel.tsx`
  - Add `typeProperties` useMemo that calls `extractTypePropertiesOnDemand()`
  - Deps: `[selectedEntity, model, ifcDataStore]` (same as classifications)
  - Render after regular properties with a visual divider and "Type: IfcWallType" header
  - Use existing `PropertySetCard` with a distinct blue/indigo border to indicate type-level
  - These should be read-only (no inline editing) since they affect all occurrences

- `packages/parser/test/on-demand-type-properties.test.ts`
  - Test with STEP: `#100=IFCWALL(...)` + `#200=IFCWALLTYPE(...)` + `#300=IFCRELDEFINESBYTYPE(...,(#100),#200)` + `#400=IFCRELDEFINESBYPROPERTIES(...,(#200),#500)` + `#500=IFCPROPERTYSET(...)` + property entities

### A2. Advanced Property Value Types (Enumerated, Bounded, List, Table, Reference)
**Goal**: Extract and display all 6 IfcProperty subtypes, not just SingleValue.

**Files to modify**:
- `packages/parser/src/columnar-parser.ts` — `extractPropertiesOnDemand()` method (lines 548-576)
  - Currently only handles `IfcPropertySingleValue` (checks attrs[2] = NominalValue)
  - Add handling for each subtype based on entity type:
    - `IFCPROPERTYENUMERATEDVALUE`: attrs[0]=Name, attrs[2]=EnumerationValues (list), attrs[3]=EnumerationReference
      - Extract as `{ name, type: Enum, value: "Val1, Val2, Val3" }` (join list)
    - `IFCPROPERTYBOUNDEDVALUE`: attrs[0]=Name, attrs[2]=UpperBoundValue, attrs[3]=LowerBoundValue, attrs[4]=Unit, attrs[5]=SetPointValue
      - Extract as `{ name, type: Real, value: "12.5 [10.0 – 15.0]" }` or structured object
    - `IFCPROPERTYLISTVALUE`: attrs[0]=Name, attrs[2]=ListValues (list), attrs[3]=Unit
      - Extract as `{ name, type: List, value: [val1, val2, ...] }`
    - `IFCPROPERTYTABLEVALUE`: attrs[0]=Name, attrs[2]=DefiningValues, attrs[3]=DefinedValues, ...
      - Extract as `{ name, type: String, value: "Table(3 rows)" }` with structured data
    - `IFCPROPERTYREFERENCEVALUE`: attrs[0]=Name, attrs[2]=PropertyReference (entity ref)
      - Extract as `{ name, type: Reference, value: "#123 (IfcTimeSeries)" }`

- `apps/viewer/src/components/viewer/properties/PropertySetCard.tsx`
  - Currently renders all values as flat strings via `parsePropertyValue()`
  - Add special rendering for:
    - Enumerated: pill/badge list of enum values
    - Bounded: `value [min – max]` with tooltip showing unit
    - List: comma-separated with expandable full list
    - Table: collapsed "Table (N rows)" with expand to show grid
    - Reference: link-style text showing referenced entity type

- `packages/parser/test/on-demand-advanced-properties.test.ts`
  - Test each property type with STEP mock data

### A3. Opening/Void and Filling Relationship Display
**Goal**: Show "This wall has 2 openings" and "This door fills Opening #45" as info cards.

**Files to modify**:
- `packages/parser/src/columnar-parser.ts`
  - Add `extractRelationshipsOnDemand(store, entityId)` function
  - Uses relationship graph to find:
    - VoidsElement (forward): openings that void this element
    - FillsElement (inverse): elements that fill this opening
    - AssignsToGroup (inverse): groups this element belongs to
    - ConnectsPathElements: connected wall paths
  - Returns `{ voids: {id, name, type}[], fills: {id, name, type}[], groups: {id, name}[], connections: {id, name, type}[] }`

- `apps/viewer/src/components/viewer/properties/RelationshipsCard.tsx` (NEW)
  - Slate/zinc-themed collapsible card
  - Shows sections for Openings, Fills, Groups, Connections
  - Each item shows entity type + name, clickable to select that entity

- `apps/viewer/src/components/viewer/PropertiesPanel.tsx`
  - Add `relationships` useMemo calling `extractRelationshipsOnDemand()`
  - Render `<RelationshipsCard>` after materials section
  - Only show when at least one relationship exists

### A4. Georeferencing Display in Model Metadata
**Goal**: Show CRS, projection, and coordinate transform when user selects a model.

**Files to modify**:
- `apps/viewer/src/components/viewer/properties/ModelMetadataPanel.tsx`
  - Import `extractGeoreferencing, getCoordinateSystemDescription` from `@ifc-lite/parser`
  - Add georef extraction in a useMemo (pass model's ifcDataStore source + entityIndex)
  - Display section:
    - CRS Name (e.g., "EPSG:2056")
    - Geodetic Datum (e.g., "WGS84")
    - Map Projection (e.g., "Swiss Oblique Mercator")
    - Origin Offset: Eastings, Northings, Height
    - Scale factor
  - Only show when georef data exists

### A5. Unit Information Display
**Goal**: Show the model's length unit in model metadata.

**Files to modify**:
- `apps/viewer/src/components/viewer/properties/ModelMetadataPanel.tsx`
  - Import `extractLengthUnitScale` from `@ifc-lite/parser`
  - Extract unit scale and display: "Length Unit: Millimeters (scale: 0.001)" or "Meters (scale: 1.0)"
  - Show near top of metadata panel

---

## PART B: Fix Edit Mode for Real IFC Roundtrip

### B1. Extend Mutations System with Classification and Material Types
**Goal**: Add proper mutation types so edits serialize to valid IFC STEP.

**Files to modify**:
- `packages/mutations/src/types.ts`
  - Add new MutationType values:
    ```
    | 'CREATE_CLASSIFICATION'
    | 'DELETE_CLASSIFICATION'
    | 'CREATE_MATERIAL'
    | 'DELETE_MATERIAL'
    ```
  - Extend Mutation interface with optional fields:
    ```typescript
    classificationSystem?: string;
    classificationId?: string;
    classificationName?: string;
    materialType?: 'Material' | 'MaterialLayerSet' | ...;
    materialName?: string;
    materialCategory?: string;
    ```

- `packages/mutations/src/mutable-property-view.ts`
  - Add `classificationMutations: Map<string, ClassificationMutation>` overlay
  - Add `materialMutations: Map<string, MaterialMutation>` overlay
  - Add methods:
    - `createClassification(entityId, system, identification, name): Mutation`
    - `deleteClassification(entityId, classificationKey): Mutation`
    - `createMaterial(entityId, name, category?, description?): Mutation`
    - `deleteMaterial(entityId): Mutation`
  - Add `getClassificationsForEntity(entityId)` that merges base + mutations
  - Add `getMaterialForEntity(entityId)` that merges base + mutations

- `packages/mutations/src/index.ts`
  - Export new types and methods

### B2. Update Store Slice and Edit Dialogs
**Goal**: Wire new mutation types through the store to the UI.

**Files to modify**:
- `apps/viewer/src/store/slices/mutationSlice.ts`
  - Add `createClassification()` and `createMaterial()` store actions
  - Add `deleteClassification()` and `deleteMaterial()` store actions
  - Wire undo/redo for new mutation types (inverse of CREATE is DELETE and vice versa)

- `apps/viewer/src/components/viewer/PropertyEditor.tsx`
  - `AddClassificationDialog`: Replace fake pset creation with `store.createClassification()`
  - `AddMaterialDialog`: Replace fake pset creation with `store.createMaterial()`
  - Both dialogs should call `bumpMutationVersion()` after mutation

- `apps/viewer/src/components/viewer/PropertiesPanel.tsx`
  - Classification and material display should merge base data with mutations
  - Show "edited" badges on mutated classifications/materials
  - In edit mode, show delete buttons on classification/material cards

### B3. Serialize Classification/Material Mutations to STEP
**Goal**: ExportChangesButton produces valid IFC with new classifications/materials.

**Files to modify**:
- Check `packages/export/` (StepExporter) — needs to handle new mutation types
  - For CREATE_CLASSIFICATION: generate `IfcClassification` + `IfcClassificationReference` + `IfcRelAssociatesClassification` entities
  - For CREATE_MATERIAL: generate `IfcMaterial` + `IfcRelAssociatesMaterial` entities
  - Assign new EXPRESS IDs (max existing ID + offset)
  - Use `serializeValue()` / `toStepLine()` from generated serializers

### B4. IFC2X3 Property Set Definitions
**Goal**: Provide pset validation for IFC2X3 models.

**Files to create**:
- `apps/viewer/src/lib/ifc2x3-pset-definitions.ts`
  - Same structure as `ifc4-pset-definitions.ts`
  - IFC2X3 psets differ slightly:
    - `Pset_WallCommon` exists in both but IFC2X3 has fewer properties
    - IFC2X3 uses `IfcWallStandardCase` more frequently
    - No `Pset_BuildingElementProxyCommon` in IFC2X3
  - Include ~15 most common IFC2X3 psets
  - Export same interface (`PsetDefinition`, `getPsetDefinitionsForType`, etc.)

**Files to modify**:
- `apps/viewer/src/lib/ifc4-pset-definitions.ts`
  - Rename export functions to be version-aware or add a wrapper
  - `getPsetDefinitionsForType(entityType, schemaVersion?)` — delegates to IFC2X3 or IFC4 defs

- `apps/viewer/src/components/viewer/PropertyEditor.tsx`
  - Pass `schemaVersion` from `activeDataStore.schemaVersion` to `getPsetDefinitionsForType()`

- `packages/parser/src/columnar-parser.ts`
  - Detect actual schema version from STEP header `FILE_SCHEMA(('IFC2X3'))` or `FILE_SCHEMA(('IFC4'))`
  - In `parseLite()`, scan first ~500 bytes for FILE_SCHEMA pattern
  - Set `schemaVersion` correctly instead of hardcoded `'IFC4' as const`

### B5. Quantity Set (Qto_) Definitions
**Goal**: Provide standard quantity definitions for validation and suggestion.

**Files to create**:
- `apps/viewer/src/lib/ifc4-qto-definitions.ts`
  - Same structure pattern as pset-definitions but for quantities
  - Interface: `QtoDefinition { name, description, applicableTypes, quantities: QtoQuantityDef[] }`
  - `QtoQuantityDef { name, quantityType: QuantityType, description }`
  - Cover standard Qto sets: `Qto_WallBaseQuantities`, `Qto_DoorBaseQuantities`, `Qto_SlabBaseQuantities`, `Qto_SpaceBaseQuantities`, `Qto_ColumnBaseQuantities`, `Qto_BeamBaseQuantities`, etc.
  - Export: `getQtoDefinitionsForType()`, `isStandardQto()`, `getQuantitiesForQto()`

**Files to modify**:
- `apps/viewer/src/components/viewer/PropertyEditor.tsx`
  - Add `AddQuantityDialog` component (similar to NewPropertyDialog but for quantities)
  - Schema-aware: suggests standard Qto_ sets based on entity type
  - Add to `EditToolbar`

---

## PART C: Document Reference Extractor + Display

### C1. Document Relationship Extraction
**Goal**: Extract IfcRelAssociatesDocument relationships and resolve document info.

**Files to modify**:
- `packages/parser/src/columnar-parser.ts`
  - Add `'IFCRELASSOCIATESDOCUMENT'` to `ASSOCIATION_REL_TYPES` set
  - Add `'IFCRELASSOCIATESDOCUMENT'` to `RELATIONSHIP_TYPES` set and `REL_TYPE_MAP`
    - Need to check if `RelationshipType` enum has a Document type — if not, add one
  - Add `onDemandDocumentMap?: Map<number, number[]>` to `IfcDataStore` interface
  - In association parsing loop, handle `IFCRELASSOCIATESDOCUMENT`:
    - `relatedObjects` at [4], `relatingDocument` at [5]
    - Build `onDemandDocumentMap`: entityId -> [documentRefIds]

- `packages/data/src/types.ts`
  - Add `AssociatesDocument = 31` to `RelationshipType` enum (after AssociatesClassification = 30)
  - Add `IFCRELASSOCIATESDOCUMENT` mapping to type maps

- `packages/data/src/relationship-graph.ts`
  - Add `[RelationshipType.AssociatesDocument]: 'IfcRelAssociatesDocument'` to REL_TYPE_NAMES

### C2. Document Info Extractor
**Goal**: Resolve document entity to structured info (name, URI, description, etc.)

**Files to modify**:
- `packages/parser/src/columnar-parser.ts`
  - Add interfaces:
    ```typescript
    export interface DocumentInfo {
      name?: string;
      description?: string;
      location?: string;        // URI or file path
      identification?: string;  // Document ID
      purpose?: string;
      intendedUse?: string;
      revision?: string;
      creationTime?: string;
      lastRevisionTime?: string;
      confidentiality?: string;  // e.g., 'PUBLIC', 'RESTRICTED'
    }
    ```
  - Add `extractDocumentsOnDemand(store, entityId): DocumentInfo[]` function
  - Uses `onDemandDocumentMap` (or relationship graph fallback)
  - Also checks type-level documents via `IfcRelDefinesByType` (same pattern as classifications)
  - Resolves each document ref:
    - `IFCDOCUMENTREFERENCE`: [Location, Identification, Name, Description, ReferencedDocument]
      - Walk to `IFCDOCUMENTINFORMATION` if ReferencedDocument is set
    - `IFCDOCUMENTINFORMATION`: [Identification, Name, Description, Location, Purpose, IntendedUse, Scope, Revision, DocumentOwner, Editors, CreationTime, LastRevisionTime, ...]

- `packages/parser/src/index.ts`
  - Export `extractDocumentsOnDemand`, `type DocumentInfo`

### C3. Document Display Card
**Goal**: Show documents in the property panel like classifications/materials.

**Files to create**:
- `apps/viewer/src/components/viewer/properties/DocumentCard.tsx`
  - Blue/sky-themed collapsible card (consistent with other cards)
  - Shows: name, identification, description, location (as clickable link if URL), revision, purpose
  - Icon: `FileText` from lucide-react

**Files to modify**:
- `apps/viewer/src/components/viewer/PropertiesPanel.tsx`
  - Import `extractDocumentsOnDemand` and `DocumentCard`
  - Add `documents` useMemo: `extractDocumentsOnDemand(dataStore, selectedEntity.expressId)`
  - Deps: `[selectedEntity, model, ifcDataStore]`
  - Render after materials section with divider
  - Update empty state check to include `documents.length`

### C4. Tests
**Files to create**:
- `packages/parser/test/on-demand-documents.test.ts`
  - Test IfcDocumentReference extraction
  - Test chain walk to IfcDocumentInformation
  - Test type-level document inheritance
  - Test relationship graph fallback
  - Use same `buildStoreFromStep()` helper pattern

- `packages/data/test/relationship-types.test.ts` (if needed)
  - Verify AssociatesDocument enum value exists and maps correctly

---

## Execution Order

**Phase 1 — Foundation** (no UI changes, parser-only):
1. B4 partial: Schema version detection in columnar-parser
2. C1: Add document relationship extraction
3. C2: Add document info extractor
4. A1: Add type-level property extractor
5. A2: Extend property extraction for advanced types

**Phase 2 — Display** (UI additions, read-only):
6. A1 continued: Type properties in PropertiesPanel
7. A2 continued: Advanced property rendering in PropertySetCard
8. A3: Relationships card (openings, groups, connections)
9. A4: Georeferencing in model metadata
10. A5: Unit info in model metadata
11. C3: Document card in PropertiesPanel

**Phase 3 — Mutations** (edit mode improvements):
12. B1: Extend mutations types
13. B2: Store + dialog updates
14. B3: STEP serialization for new mutations
15. B4 continued: IFC2X3 pset definitions
16. B5: Qto_ definitions + AddQuantityDialog

**Phase 4 — Tests & Polish**:
17. All test files (can be written alongside each phase)
18. Updated changeset
19. Final build verification
