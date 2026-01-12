# IFC-Lite: Part 5 - Export Formats

## 5.1 Export Overview

IFC-Lite supports multiple export formats for interoperability:

| Format | Use Case | Size | Speed |
|--------|----------|------|-------|
| **glTF/GLB** | 3D visualization, game engines | Medium | Fast |
| **Parquet** | Analytics, BI tools, ara3d compatible | Compact | Fast |
| **Arrow IPC** | In-memory analytics, streaming | Compact | Very Fast |
| **JSON-LD** | Semantic web, linked data | Large | Slow |
| **CSV** | Spreadsheets, simple import | Medium | Fast |

---

## 5.2 Parquet Export (ara3d BOS Compatible)

```typescript
/**
 * Export to ara3d BIM Open Schema compatible Parquet files.
 * Creates a .bos archive (ZIP of Parquet files).
 */
class ParquetExporter {
  private store: IfcDataStore;
  
  constructor(store: IfcDataStore) {
    this.store = store;
  }
  
  /**
   * Export full model to .bos archive.
   */
  async exportBOS(): Promise<Uint8Array> {
    const files = new Map<string, Uint8Array>();
    
    // Non-geometry files
    files.set('Entities.parquet', await this.writeEntities());
    files.set('Properties.parquet', await this.writeProperties());
    files.set('Quantities.parquet', await this.writeQuantities());
    files.set('Relationships.parquet', await this.writeRelationships());
    files.set('Strings.parquet', await this.writeStrings());
    
    // Geometry files
    if (this.store.geometry) {
      files.set('VertexBuffer.parquet', await this.writeVertexBuffer());
      files.set('IndexBuffer.parquet', await this.writeIndexBuffer());
      files.set('Meshes.parquet', await this.writeMeshes());
      files.set('Instances.parquet', await this.writeInstances());
      files.set('Materials.parquet', await this.writeMaterials());
    }
    
    // Spatial hierarchy
    files.set('SpatialHierarchy.parquet', await this.writeSpatialHierarchy());
    
    // Metadata
    files.set('Metadata.json', this.writeMetadata());
    
    return this.createZipArchive(files);
  }
  
  /**
   * Export individual Parquet file.
   */
  async exportTable(tableName: string): Promise<Uint8Array> {
    switch (tableName) {
      case 'entities': return this.writeEntities();
      case 'properties': return this.writeProperties();
      case 'quantities': return this.writeQuantities();
      case 'vertices': return this.writeVertexBuffer();
      case 'indices': return this.writeIndexBuffer();
      case 'meshes': return this.writeMeshes();
      default: throw new Error(`Unknown table: ${tableName}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ENTITY DATA
  // ═══════════════════════════════════════════════════════════════
  
  private async writeEntities(): Promise<Uint8Array> {
    const { entities, strings } = this.store;
    
    return this.toParquet({
      ExpressId: entities.expressId,
      GlobalId: mapTypedArray(entities.globalId, i => strings.get(i)),
      Name: mapTypedArray(entities.name, i => strings.get(i)),
      Description: mapTypedArray(entities.description, i => strings.get(i)),
      Type: mapTypedArray(entities.typeEnum, i => IfcTypeEnumToString(i)),
      ObjectType: mapTypedArray(entities.objectType, i => strings.get(i)),
      HasGeometry: mapTypedArray(entities.flags, f => (f & EntityFlags.HAS_GEOMETRY) !== 0),
      IsType: mapTypedArray(entities.flags, f => (f & EntityFlags.IS_TYPE) !== 0),
      ContainedInStorey: entities.containedInStorey,
      DefinedByType: entities.definedByType,
      GeometryIndex: entities.geometryIndex,
    });
  }
  
  private async writeProperties(): Promise<Uint8Array> {
    const { properties, strings } = this.store;
    
    return this.toParquet({
      EntityId: properties.entityId,
      PsetName: mapTypedArray(properties.psetName, i => strings.get(i)),
      PsetGlobalId: mapTypedArray(properties.psetGlobalId, i => strings.get(i)),
      PropName: mapTypedArray(properties.propName, i => strings.get(i)),
      PropType: mapTypedArray(properties.propType, t => PropertyValueTypeToString(t)),
      ValueString: mapTypedArray(properties.valueString, i => i >= 0 ? strings.get(i) : null),
      ValueReal: properties.valueReal,
      ValueInt: properties.valueInt,
      ValueBool: mapTypedArray(properties.valueBool, v => v === 255 ? null : v === 1),
    });
  }
  
  private async writeQuantities(): Promise<Uint8Array> {
    const { quantities, strings } = this.store;
    
    return this.toParquet({
      EntityId: quantities.entityId,
      QsetName: mapTypedArray(quantities.qsetName, i => strings.get(i)),
      QuantityName: mapTypedArray(quantities.quantityName, i => strings.get(i)),
      QuantityType: mapTypedArray(quantities.quantityType, t => QuantityTypeToString(t)),
      Value: quantities.value,
      Formula: mapTypedArray(quantities.formula, i => i >= 0 ? strings.get(i) : null),
    });
  }
  
  private async writeRelationships(): Promise<Uint8Array> {
    const { graph } = this.store;
    const edges = graph.forward;
    
    // Flatten CSR format to row-based
    const sourceIds: number[] = [];
    const targetIds: number[] = [];
    const relTypes: string[] = [];
    const relIds: number[] = [];
    
    for (const [sourceId, offset] of edges.offsets) {
      const count = edges.counts.get(sourceId)!;
      for (let i = offset; i < offset + count; i++) {
        sourceIds.push(sourceId);
        targetIds.push(edges.edgeTargets[i]);
        relTypes.push(RelationshipTypeToString(edges.edgeTypes[i]));
        relIds.push(edges.edgeRelIds[i]);
      }
    }
    
    return this.toParquet({
      SourceId: new Uint32Array(sourceIds),
      TargetId: new Uint32Array(targetIds),
      RelType: relTypes,
      RelId: new Uint32Array(relIds),
    });
  }
  
  private async writeStrings(): Promise<Uint8Array> {
    const { strings } = this.store;
    
    const indices = new Uint32Array(strings.count);
    for (let i = 0; i < strings.count; i++) {
      indices[i] = i;
    }
    
    return this.toParquet({
      Index: indices,
      Value: strings.strings,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // GEOMETRY DATA (ara3d G3D compatible)
  // ═══════════════════════════════════════════════════════════════
  
  private async writeVertexBuffer(): Promise<Uint8Array> {
    const { geometry } = this.store;
    const positions = geometry.positions;
    const normals = geometry.normals;
    const vertexCount = positions.length / 3;
    
    // Columnar layout (X[], Y[], Z[] instead of [x,y,z, x,y,z])
    const x = new Float32Array(vertexCount);
    const y = new Float32Array(vertexCount);
    const z = new Float32Array(vertexCount);
    const nx = new Float32Array(vertexCount);
    const ny = new Float32Array(vertexCount);
    const nz = new Float32Array(vertexCount);
    
    for (let i = 0; i < vertexCount; i++) {
      x[i] = positions[i * 3];
      y[i] = positions[i * 3 + 1];
      z[i] = positions[i * 3 + 2];
      nx[i] = normals[i * 3];
      ny[i] = normals[i * 3 + 1];
      nz[i] = normals[i * 3 + 2];
    }
    
    const result: Record<string, Float32Array> = { X: x, Y: y, Z: z, NormalX: nx, NormalY: ny, NormalZ: nz };
    
    // Optional UVs
    if (geometry.uvs) {
      const u = new Float32Array(vertexCount);
      const v = new Float32Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) {
        u[i] = geometry.uvs[i * 2];
        v[i] = geometry.uvs[i * 2 + 1];
      }
      result.U = u;
      result.V = v;
    }
    
    return this.toParquet(result);
  }
  
  private async writeIndexBuffer(): Promise<Uint8Array> {
    const indices = this.store.geometry.indices;
    const triangleCount = indices.length / 3;
    
    const i0 = new Uint32Array(triangleCount);
    const i1 = new Uint32Array(triangleCount);
    const i2 = new Uint32Array(triangleCount);
    
    for (let i = 0; i < triangleCount; i++) {
      i0[i] = indices[i * 3];
      i1[i] = indices[i * 3 + 1];
      i2[i] = indices[i * 3 + 2];
    }
    
    return this.toParquet({ Index0: i0, Index1: i1, Index2: i2 });
  }
  
  private async writeMeshes(): Promise<Uint8Array> {
    const meshes = this.store.geometry.meshes;
    
    return this.toParquet({
      ExpressId: meshes.expressId,
      VertexStart: meshes.vertexStart,
      VertexCount: meshes.vertexCount,
      IndexStart: meshes.indexStart,
      IndexCount: meshes.indexCount,
      MaterialIndex: meshes.materialIndex,
      MinX: meshes.boundsMinX,
      MinY: meshes.boundsMinY,
      MinZ: meshes.boundsMinZ,
      MaxX: meshes.boundsMaxX,
      MaxY: meshes.boundsMaxY,
      MaxZ: meshes.boundsMaxZ,
    });
  }
  
  private async writeInstances(): Promise<Uint8Array> {
    const instances = this.store.geometry.instances;
    const count = instances.count;
    
    // Extract transform components
    const tx = new Float32Array(count);
    const ty = new Float32Array(count);
    const tz = new Float32Array(count);
    const m00 = new Float32Array(count);
    const m01 = new Float32Array(count);
    const m02 = new Float32Array(count);
    const m10 = new Float32Array(count);
    const m11 = new Float32Array(count);
    const m12 = new Float32Array(count);
    const m20 = new Float32Array(count);
    const m21 = new Float32Array(count);
    const m22 = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      const base = i * 16;
      // Column-major 4x4 matrix
      m00[i] = instances.transforms[base + 0];
      m01[i] = instances.transforms[base + 1];
      m02[i] = instances.transforms[base + 2];
      m10[i] = instances.transforms[base + 4];
      m11[i] = instances.transforms[base + 5];
      m12[i] = instances.transforms[base + 6];
      m20[i] = instances.transforms[base + 8];
      m21[i] = instances.transforms[base + 9];
      m22[i] = instances.transforms[base + 10];
      tx[i] = instances.transforms[base + 12];
      ty[i] = instances.transforms[base + 13];
      tz[i] = instances.transforms[base + 14];
    }
    
    return this.toParquet({
      ExpressId: instances.expressId,
      PrototypeIndex: instances.prototypeIndex,
      TranslateX: tx,
      TranslateY: ty,
      TranslateZ: tz,
      M00: m00, M01: m01, M02: m02,
      M10: m10, M11: m11, M12: m12,
      M20: m20, M21: m21, M22: m22,
    });
  }
  
  private async writeMaterials(): Promise<Uint8Array> {
    const { materials, strings } = this.store.geometry;
    
    // Extract color components
    const count = materials.count;
    const dr = new Float32Array(count);
    const dg = new Float32Array(count);
    const db = new Float32Array(count);
    const da = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      dr[i] = materials.diffuseColor[i * 4];
      dg[i] = materials.diffuseColor[i * 4 + 1];
      db[i] = materials.diffuseColor[i * 4 + 2];
      da[i] = materials.diffuseColor[i * 4 + 3];
    }
    
    return this.toParquet({
      Name: mapTypedArray(materials.name, i => this.store.strings.get(i)),
      DiffuseR: dr,
      DiffuseG: dg,
      DiffuseB: db,
      DiffuseA: da,
      Transparency: materials.transparency,
      Shininess: materials.shininess,
      Roughness: materials.roughness,
      Metallic: materials.metallic,
    });
  }
  
  private async writeSpatialHierarchy(): Promise<Uint8Array> {
    const rows: Array<{
      ElementId: number;
      StoreyId: number;
      BuildingId: number;
      SiteId: number;
      SpaceId: number;
    }> = [];
    
    const { spatialHierarchy } = this.store;
    
    for (const [storeyId, elementIds] of spatialHierarchy.byStorey) {
      const storey = new EntityNode(this.store, storeyId);
      const building = storey.building();
      const site = building?.decomposedBy();
      
      for (const elementId of elementIds) {
        rows.push({
          ElementId: elementId,
          StoreyId: storeyId,
          BuildingId: building?.expressId ?? -1,
          SiteId: site?.expressId ?? -1,
          SpaceId: -1, // TODO: space lookup
        });
      }
    }
    
    return this.toParquet({
      ElementId: new Uint32Array(rows.map(r => r.ElementId)),
      StoreyId: new Int32Array(rows.map(r => r.StoreyId)),
      BuildingId: new Int32Array(rows.map(r => r.BuildingId)),
      SiteId: new Int32Array(rows.map(r => r.SiteId)),
      SpaceId: new Int32Array(rows.map(r => r.SpaceId)),
    });
  }
  
  private writeMetadata(): Uint8Array {
    const metadata = {
      version: '2.0.0',
      generator: 'IFC-Lite',
      sourceFile: {
        size: this.store.fileSize,
        schema: this.store.schemaVersion,
        entityCount: this.store.entityCount,
      },
      export: {
        timestamp: new Date().toISOString(),
        format: 'ara3d-bos-compatible',
      },
      statistics: {
        meshCount: this.store.geometry?.meshes.count ?? 0,
        instanceCount: this.store.geometry?.instances.count ?? 0,
        vertexCount: (this.store.geometry?.positions.length ?? 0) / 3,
        triangleCount: (this.store.geometry?.indices.length ?? 0) / 3,
        propertyCount: this.store.properties.count,
        relationshipCount: this.store.graph.relationships.count,
      },
    };
    
    return new TextEncoder().encode(JSON.stringify(metadata, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════
  
  private async toParquet(columns: Record<string, TypedArray | string[] | boolean[] | null[]>): Promise<Uint8Array> {
    // Use parquet-wasm for encoding
    const parquet = await import('parquet-wasm');
    
    // Build Arrow table first
    const arrow = await import('apache-arrow');
    const fields: arrow.Field[] = [];
    const arrays: arrow.Vector[] = [];
    
    for (const [name, data] of Object.entries(columns)) {
      const { field, vector } = this.columnToArrow(arrow, name, data);
      fields.push(field);
      arrays.push(vector);
    }
    
    const schema = new arrow.Schema(fields);
    const table = new arrow.Table(schema, arrays);
    
    // Convert to Parquet
    const writer = new parquet.ParquetWriter(schema);
    writer.writeTable(table);
    return writer.finish();
  }
  
  private columnToArrow(
    arrow: typeof import('apache-arrow'),
    name: string,
    data: TypedArray | string[] | boolean[] | null[]
  ): { field: arrow.Field; vector: arrow.Vector } {
    if (data instanceof Float32Array) {
      return {
        field: new arrow.Field(name, new arrow.Float32()),
        vector: arrow.makeVector(data),
      };
    }
    if (data instanceof Float64Array) {
      return {
        field: new arrow.Field(name, new arrow.Float64()),
        vector: arrow.makeVector(data),
      };
    }
    if (data instanceof Uint32Array) {
      return {
        field: new arrow.Field(name, new arrow.Uint32()),
        vector: arrow.makeVector(data),
      };
    }
    if (data instanceof Int32Array) {
      return {
        field: new arrow.Field(name, new arrow.Int32()),
        vector: arrow.makeVector(data),
      };
    }
    if (data instanceof Uint16Array) {
      return {
        field: new arrow.Field(name, new arrow.Uint16()),
        vector: arrow.makeVector(data),
      };
    }
    if (data instanceof Uint8Array) {
      return {
        field: new arrow.Field(name, new arrow.Uint8()),
        vector: arrow.makeVector(data),
      };
    }
    if (Array.isArray(data) && typeof data[0] === 'string') {
      return {
        field: new arrow.Field(name, new arrow.Utf8()),
        vector: arrow.makeVector(data as string[]),
      };
    }
    if (Array.isArray(data) && typeof data[0] === 'boolean') {
      return {
        field: new arrow.Field(name, new arrow.Bool()),
        vector: arrow.makeVector(data as boolean[]),
      };
    }
    
    // Fallback: string
    return {
      field: new arrow.Field(name, new arrow.Utf8()),
      vector: arrow.makeVector((data as any[]).map(v => String(v))),
    };
  }
  
  private async createZipArchive(files: Map<string, Uint8Array>): Promise<Uint8Array> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    for (const [name, data] of files) {
      zip.file(name, data);
    }
    
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
}

function mapTypedArray<T extends TypedArray, U>(arr: T, fn: (v: number) => U): U[] {
  const result: U[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    result[i] = fn(arr[i]);
  }
  return result;
}

type TypedArray = Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;
```

---

## 5.3 glTF Export

```typescript
/**
 * Export to glTF 2.0 format.
 */
class GLTFExporter {
  private store: IfcDataStore;
  
  constructor(store: IfcDataStore) {
    this.store = store;
  }
  
  /**
   * Export to GLB (binary glTF).
   */
  async exportGLB(options: GLTFExportOptions = {}): Promise<Uint8Array> {
    const gltf = await this.buildGLTF(options);
    return this.packGLB(gltf);
  }
  
  /**
   * Export to glTF (JSON + .bin).
   */
  async exportGLTF(options: GLTFExportOptions = {}): Promise<{ json: string; bin: Uint8Array }> {
    const gltf = await this.buildGLTF(options);
    return {
      json: JSON.stringify(gltf.json, null, 2),
      bin: gltf.bin,
    };
  }
  
  private async buildGLTF(options: GLTFExportOptions): Promise<GLTFData> {
    const { geometry, entities, strings } = this.store;
    
    // Build buffer with all geometry data
    const bufferParts: Uint8Array[] = [];
    let bufferOffset = 0;
    
    // Positions
    const positionsView = {
      buffer: 0,
      byteOffset: bufferOffset,
      byteLength: geometry.positions.byteLength,
      target: 34962, // ARRAY_BUFFER
    };
    bufferParts.push(new Uint8Array(geometry.positions.buffer));
    bufferOffset += geometry.positions.byteLength;
    
    // Normals
    const normalsView = {
      buffer: 0,
      byteOffset: bufferOffset,
      byteLength: geometry.normals.byteLength,
      target: 34962,
    };
    bufferParts.push(new Uint8Array(geometry.normals.buffer));
    bufferOffset += geometry.normals.byteLength;
    
    // Indices
    const indicesView = {
      buffer: 0,
      byteOffset: bufferOffset,
      byteLength: geometry.indices.byteLength,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    };
    bufferParts.push(new Uint8Array(geometry.indices.buffer));
    bufferOffset += geometry.indices.byteLength;
    
    // Build accessors for each mesh
    const accessors: any[] = [];
    const meshes: any[] = [];
    const nodes: any[] = [];
    
    const meshTable = geometry.meshes;
    for (let i = 0; i < meshTable.count; i++) {
      const expressId = meshTable.expressId[i];
      const name = entities.getName(expressId);
      
      // Position accessor
      const posAccessor = {
        bufferView: 0,
        byteOffset: meshTable.vertexStart[i] * 12, // 3 floats * 4 bytes
        componentType: 5126, // FLOAT
        count: meshTable.vertexCount[i],
        type: 'VEC3',
        min: [meshTable.boundsMinX[i], meshTable.boundsMinY[i], meshTable.boundsMinZ[i]],
        max: [meshTable.boundsMaxX[i], meshTable.boundsMaxY[i], meshTable.boundsMaxZ[i]],
      };
      
      // Normal accessor
      const normAccessor = {
        bufferView: 1,
        byteOffset: meshTable.vertexStart[i] * 12,
        componentType: 5126,
        count: meshTable.vertexCount[i],
        type: 'VEC3',
      };
      
      // Index accessor
      const idxAccessor = {
        bufferView: 2,
        byteOffset: meshTable.indexStart[i] * 4, // Uint32
        componentType: 5125, // UNSIGNED_INT
        count: meshTable.indexCount[i],
        type: 'SCALAR',
      };
      
      const posIdx = accessors.length;
      accessors.push(posAccessor, normAccessor, idxAccessor);
      
      // Mesh
      const mesh = {
        name: `${name}_geometry`,
        primitives: [{
          attributes: {
            POSITION: posIdx,
            NORMAL: posIdx + 1,
          },
          indices: posIdx + 2,
          material: meshTable.materialIndex[i] >= 0 ? meshTable.materialIndex[i] : undefined,
        }],
      };
      meshes.push(mesh);
      
      // Node with extras for IFC metadata
      const node = {
        name,
        mesh: i,
        extras: {
          expressId,
          globalId: entities.getGlobalId(expressId),
          ifcType: entities.getTypeName(expressId),
        },
      };
      nodes.push(node);
    }
    
    // Handle instances
    if (geometry.instances.count > 0 && options.useInstancing) {
      // Use EXT_mesh_gpu_instancing extension
      // ... (implementation details)
    }
    
    // Build materials
    const materials = this.buildMaterials();
    
    // Build glTF JSON
    const gltfJson = {
      asset: {
        version: '2.0',
        generator: 'IFC-Lite',
        extras: {
          sourceSchema: this.store.schemaVersion,
          entityCount: this.store.entityCount,
        },
      },
      scene: 0,
      scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes,
      meshes,
      materials,
      accessors,
      bufferViews: [positionsView, normalsView, indicesView],
      buffers: [{ byteLength: bufferOffset }],
      extensionsUsed: options.useInstancing ? ['EXT_mesh_gpu_instancing'] : undefined,
    };
    
    // Combine buffer parts
    const bin = new Uint8Array(bufferOffset);
    let offset = 0;
    for (const part of bufferParts) {
      bin.set(part, offset);
      offset += part.byteLength;
    }
    
    return { json: gltfJson, bin };
  }
  
  private buildMaterials(): any[] {
    const { materials } = this.store.geometry;
    const result: any[] = [];
    
    for (let i = 0; i < materials.count; i++) {
      const dr = materials.diffuseColor[i * 4];
      const dg = materials.diffuseColor[i * 4 + 1];
      const db = materials.diffuseColor[i * 4 + 2];
      const da = materials.diffuseColor[i * 4 + 3];
      
      result.push({
        name: this.store.strings.get(materials.name[i]),
        pbrMetallicRoughness: {
          baseColorFactor: [dr, dg, db, da],
          metallicFactor: materials.metallic[i],
          roughnessFactor: materials.roughness[i],
        },
        alphaMode: da < 1.0 ? 'BLEND' : 'OPAQUE',
      });
    }
    
    return result;
  }
  
  private packGLB(data: GLTFData): Uint8Array {
    const jsonString = JSON.stringify(data.json);
    const jsonBuffer = new TextEncoder().encode(jsonString);
    
    // Pad JSON to 4-byte boundary
    const jsonPadding = (4 - (jsonBuffer.byteLength % 4)) % 4;
    const paddedJsonLength = jsonBuffer.byteLength + jsonPadding;
    
    // Pad binary to 4-byte boundary
    const binPadding = (4 - (data.bin.byteLength % 4)) % 4;
    const paddedBinLength = data.bin.byteLength + binPadding;
    
    // GLB header + JSON chunk + BIN chunk
    const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    const bytes = new Uint8Array(glb);
    
    // GLB header
    view.setUint32(0, 0x46546C67, true); // 'glTF' magic
    view.setUint32(4, 2, true);           // version
    view.setUint32(8, totalLength, true); // total length
    
    // JSON chunk header
    view.setUint32(12, paddedJsonLength, true);
    view.setUint32(16, 0x4E4F534A, true); // 'JSON'
    
    // JSON chunk data
    bytes.set(jsonBuffer, 20);
    for (let i = 0; i < jsonPadding; i++) {
      bytes[20 + jsonBuffer.byteLength + i] = 0x20; // Space padding
    }
    
    // BIN chunk header
    const binChunkStart = 20 + paddedJsonLength;
    view.setUint32(binChunkStart, paddedBinLength, true);
    view.setUint32(binChunkStart + 4, 0x004E4942, true); // 'BIN\0'
    
    // BIN chunk data
    bytes.set(data.bin, binChunkStart + 8);
    // Zero padding is automatic from ArrayBuffer
    
    return new Uint8Array(glb);
  }
}

interface GLTFExportOptions {
  useInstancing?: boolean;      // Use EXT_mesh_gpu_instancing
  useDraco?: boolean;           // Use Draco compression
  includeMetadata?: boolean;    // Include IFC metadata in extras
  separateByStorey?: boolean;   // Create separate scenes per storey
}

interface GLTFData {
  json: any;
  bin: Uint8Array;
}
```

---

## 5.4 CSV Export

```typescript
/**
 * Export query results to CSV.
 */
class CSVExporter {
  /**
   * Export entities to CSV.
   */
  static exportEntities(results: QueryResultEntity[]): string {
    if (results.length === 0) return '';
    
    const headers = ['ExpressId', 'GlobalId', 'Name', 'Type', 'Description'];
    const rows = results.map(r => [
      r.expressId,
      r.globalId,
      this.escapeCSV(r.name),
      r.type,
      this.escapeCSV(r.description ?? ''),
    ]);
    
    return this.toCSV(headers, rows);
  }
  
  /**
   * Export properties to CSV (pivoted).
   */
  static exportProperties(results: QueryResultEntity[], psetName?: string): string {
    if (results.length === 0) return '';
    
    // Collect all unique property names
    const propNames = new Set<string>();
    for (const r of results) {
      for (const pset of r.properties) {
        if (psetName && pset.name !== psetName) continue;
        for (const prop of pset.properties) {
          propNames.add(`${pset.name}:${prop.name}`);
        }
      }
    }
    
    const sortedProps = [...propNames].sort();
    const headers = ['ExpressId', 'GlobalId', 'Name', 'Type', ...sortedProps];
    
    const rows = results.map(r => {
      const propValues = new Map<string, PropertyValue>();
      for (const pset of r.properties) {
        for (const prop of pset.properties) {
          propValues.set(`${pset.name}:${prop.name}`, prop.value);
        }
      }
      
      return [
        r.expressId,
        r.globalId,
        this.escapeCSV(r.name),
        r.type,
        ...sortedProps.map(p => this.formatValue(propValues.get(p))),
      ];
    });
    
    return this.toCSV(headers, rows);
  }
  
  /**
   * Export quantities to CSV.
   */
  static exportQuantities(results: QueryResultEntity[]): string {
    if (results.length === 0) return '';
    
    const rows: any[][] = [];
    const headers = ['ExpressId', 'GlobalId', 'Name', 'Type', 'QsetName', 'QuantityName', 'Value', 'QuantityType'];
    
    for (const r of results) {
      for (const qset of r.quantities) {
        for (const q of qset.quantities) {
          rows.push([
            r.expressId,
            r.globalId,
            this.escapeCSV(r.name),
            r.type,
            qset.name,
            q.name,
            q.value,
            QuantityTypeToString(q.type),
          ]);
        }
      }
    }
    
    return this.toCSV(headers, rows);
  }
  
  private static toCSV(headers: string[], rows: any[][]): string {
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }
  
  private static escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
  
  private static formatValue(value: PropertyValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return this.escapeCSV(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (Array.isArray(value)) return this.escapeCSV(JSON.stringify(value));
    return String(value);
  }
}
```

---

## 5.5 JSON-LD Export

```typescript
/**
 * Export to JSON-LD for semantic web compatibility.
 */
class JSONLDExporter {
  private store: IfcDataStore;
  
  constructor(store: IfcDataStore) {
    this.store = store;
  }
  
  /**
   * Export to JSON-LD with IFC ontology.
   */
  export(options: JSONLDOptions = {}): object {
    const context = {
      '@vocab': 'https://standards.buildingsmart.org/IFC/DEV/IFC4/ADD2/OWL#',
      'express': 'https://w3id.org/express#',
      'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
      'xsd': 'http://www.w3.org/2001/XMLSchema#',
      'geo': 'http://www.opengis.net/ont/geosparql#',
    };
    
    const entities: object[] = [];
    
    // Export spatial structure
    const project = this.store.spatialHierarchy.project;
    entities.push(this.entityToLD(project.expressId, options));
    
    // Export building elements
    if (options.includeElements !== false) {
      for (const [, elementIds] of this.store.spatialHierarchy.byStorey) {
        for (const id of elementIds) {
          entities.push(this.entityToLD(id, options));
        }
      }
    }
    
    return {
      '@context': context,
      '@graph': entities,
    };
  }
  
  private entityToLD(expressId: number, options: JSONLDOptions): object {
    const entity = this.store.entities;
    const globalId = entity.getGlobalId(expressId);
    const name = entity.getName(expressId);
    const type = entity.getTypeName(expressId);
    
    const ld: any = {
      '@id': `urn:ifc:${globalId}`,
      '@type': type,
      'express:hasExpressId': expressId,
      'rdfs:label': name,
    };
    
    // Add properties
    if (options.includeProperties !== false) {
      const props = this.store.properties.getForEntity(expressId);
      for (const pset of props) {
        const psetId = `${globalId}_${pset.name}`;
        ld[pset.name] = {
          '@id': `urn:ifc:pset:${psetId}`,
          '@type': 'IfcPropertySet',
        };
        
        for (const prop of pset.properties) {
          ld[pset.name][prop.name] = this.valueToLD(prop.value, prop.type);
        }
      }
    }
    
    // Add relationships
    const container = this.store.graph.getRelated(
      expressId, RelationshipType.ContainsElements, 'inverse'
    )[0];
    if (container) {
      const containerGlobalId = entity.getGlobalId(container);
      ld['containedInStructure'] = { '@id': `urn:ifc:${containerGlobalId}` };
    }
    
    return ld;
  }
  
  private valueToLD(value: PropertyValue, type: PropertyValueType): any {
    if (value === null) return null;
    
    switch (type) {
      case PropertyValueType.Real:
        return { '@value': value, '@type': 'xsd:double' };
      case PropertyValueType.Integer:
        return { '@value': value, '@type': 'xsd:integer' };
      case PropertyValueType.Boolean:
        return { '@value': value, '@type': 'xsd:boolean' };
      default:
        return value;
    }
  }
}

interface JSONLDOptions {
  includeElements?: boolean;
  includeProperties?: boolean;
  includeGeometry?: boolean;
}
```

---

*Continue to Part 6: Implementation Roadmap*
