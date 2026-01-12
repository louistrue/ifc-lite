# IFC-Lite: Part 10 - Remaining Technical Solutions

## Overview

This document addresses the remaining technical risks, design gaps, and viewer-specific issues identified during specification review. These solutions complement the critical solutions in Part 8 and provide realistic expectations, compatibility strategies, and implementation details.

---

## 10.1 Realistic Performance Expectations

### The Problem

Original performance targets assumed best-case scenarios. Real-world IFC files vary dramatically in complexity:
- Simple architectural models: Mostly extrusions, minimal CSG
- Typical models: Some CSG, moderate instancing, mixed geometry types
- Complex models: Heavy CSG, MEP systems, advanced surfaces, nested Boolean operations

A single "10MB file" can take anywhere from 400ms to 10 seconds depending on geometry complexity.

### Solution: Performance Tiers

```typescript
/**
 * Classify IFC file complexity into performance tiers.
 */
class PerformanceTierAnalyzer {
  
  /**
   * Analyze file and predict performance tier.
   */
  analyze(store: IfcDataStore): PerformanceTier {
    let complexityScore = 0;
    
    // CSG operations (major complexity factor)
    const booleanCount = store.entityIndex.byType.get(IfcTypeEnum.IfcBooleanResult)?.length ?? 0;
    const clippingCount = store.entityIndex.byType.get(IfcTypeEnum.IfcBooleanClippingResult)?.length ?? 0;
    complexityScore += (booleanCount + clippingCount) * 10;
    
    // Opening relationships (require CSG)
    const voidsCount = store.entityIndex.byType.get(IfcTypeEnum.IfcRelVoidsElement)?.length ?? 0;
    complexityScore += voidsCount * 5;
    
    // Advanced geometry types
    const advancedTypes = [
      IfcTypeEnum.IfcAdvancedBrep,
      IfcTypeEnum.IfcSurfaceCurveSweptAreaSolid,
      IfcTypeEnum.IfcTriangulatedFaceSet, // Can be huge
    ];
    for (const type of advancedTypes) {
      const count = store.entityIndex.byType.get(type)?.length ?? 0;
      complexityScore += count * 3;
    }
    
    // Instance ratio (lower = more unique geometry = slower)
    const totalGeometric = this.countGeometricEntities(store);
    const instanced = this.countInstancedEntities(store);
    const instanceRatio = instanced / totalGeometric;
    if (instanceRatio < 0.1) complexityScore += 20; // Low instancing
    if (instanceRatio > 0.5) complexityScore -= 10; // High instancing
    
    // Profile complexity
    const complexProfiles = this.countComplexProfiles(store);
    complexityScore += complexProfiles * 2;
    
    // Determine tier
    if (complexityScore < 50) return 'tier1';
    if (complexityScore < 150) return 'tier2';
    return 'tier3';
  }
}

type PerformanceTier = 'tier1' | 'tier2' | 'tier3';
```

### Revised Performance Targets

| Metric | Tier 1 (Simple) | Tier 2 (Typical) | Tier 3 (Complex) |
|--------|-----------------|------------------|------------------|
| **File Size** | 10MB | 10MB | 10MB |
| **Characteristics** | No CSG, <10% instanced, basic profiles | Some CSG, 30-50% instanced, mixed profiles | Heavy CSG, MEP, advanced geometry |
| **Parse to Index** | 50-100ms | 50-100ms | 50-100ms |
| **Full Parse** | 400-600ms | 800-1500ms | 2-5s |
| **First Triangle** | 150-200ms | 300-500ms | 1-2s |
| **Full Geometry** | 1-2s | 3-6s | 10-30s |
| **Property Query** | <10ms | <15ms | <30ms |
| **Memory (peak)** | 60-100MB | 80-180MB | 200-400MB |

### Progressive Quality Strategy

```typescript
/**
 * Parse quality modes - trade accuracy for speed.
 */
const enum ParseQualityMode {
  Fast = 'fast',        // Skip CSG, use approximations
  Balanced = 'balanced', // Default - full CSG where needed
  Quality = 'quality',  // Full CSG, no approximations
}

interface ParseOptions {
  quality?: ParseQualityMode;
  
  // Fast mode options
  skipCSG?: boolean;              // Use visual approximations
  skipOpenings?: boolean;         // Don't subtract openings
  simplifyGeometry?: boolean;     // Aggressive simplification
  
  // Quality mode options
  csgTolerance?: number;          // CSG precision
  curveSegments?: number;         // Curve discretization quality
  maxGeometryTime?: number;       // Timeout for geometry processing
}

/**
 * Geometry complexity predictor.
 */
class GeometryComplexityPredictor {
  
  /**
   * Predict parse time based on file analysis.
   */
  predictParseTime(
    entityIndex: EntityIndex,
    fileSize: number,
    quality: ParseQualityMode
  ): ParseTimeEstimate {
    const analyzer = new PerformanceTierAnalyzer();
    const tier = analyzer.analyze({ entityIndex } as IfcDataStore);
    
    const baseTime = this.getBaseTime(tier, fileSize);
    const qualityMultiplier = this.getQualityMultiplier(quality);
    
    return {
      indexTime: baseTime.indexTime,
      fullParseTime: baseTime.fullParseTime * qualityMultiplier,
      firstTriangleTime: baseTime.firstTriangleTime * qualityMultiplier,
      confidence: this.calculateConfidence(tier),
    };
  }
  
  private getBaseTime(tier: PerformanceTier, sizeMB: number): TimeEstimate {
    const perMB = {
      tier1: { index: 10, full: 50, first: 20 },
      tier2: { index: 10, full: 100, first: 40 },
      tier3: { index: 10, full: 300, first: 100 },
    };
    
    const rates = perMB[tier];
    return {
      indexTime: rates.index * sizeMB,
      fullParseTime: rates.full * sizeMB,
      firstTriangleTime: rates.first * sizeMB,
    };
  }
  
  private getQualityMultiplier(quality: ParseQualityMode): number {
    return {
      'fast': 0.3,
      'balanced': 1.0,
      'quality': 2.0,
    }[quality];
  }
}

interface ParseTimeEstimate {
  indexTime: number;        // ms
  fullParseTime: number;    // ms
  firstTriangleTime: number; // ms
  confidence: 'high' | 'medium' | 'low';
}
```

### Performance Monitoring

```typescript
/**
 * Performance metrics collector.
 */
class PerformanceMetrics {
  private metrics: Map<string, number[]> = new Map();
  
  record(operation: string, durationMs: number): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation)!.push(durationMs);
  }
  
  getStats(operation: string): PerformanceStats | null {
    const values = this.metrics.get(operation);
    if (!values || values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50,
      p95,
      p99,
    };
  }
}

interface PerformanceStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}
```

---

## 10.2 Realistic Memory Budgets

### The Problem

Original estimate of "60MB for 10MB IFC" assumed:
- Perfect string deduplication (often 20-30% savings, not 50%+)
- High instance ratio (many models have <20% instancing)
- No geometry duplication (LODs, repair buffers, etc.)

Reality: Memory usage varies dramatically based on geometry complexity and instancing.

### Solution: Component-Based Memory Budget

```typescript
/**
 * Realistic memory budget calculator.
 */
class MemoryBudgetCalculator {
  
  /**
   * Calculate memory usage by component.
   */
  calculate(store: IfcDataStore, options: MemoryOptions = {}): MemoryBreakdown {
    const fileSizeMB = store.fileSize / (1024 * 1024);
    const entityCount = store.entityCount;
    
    // Source buffer (can be released)
    const sourceBufferMB = options.retainSource ? fileSizeMB : 0;
    
    // Entity index (compact references)
    const entityIndexMB = (entityCount * 24) / (1024 * 1024); // ~24 bytes per entity
    
    // Columnar tables
    const avgPropertiesPerEntity = this.estimateAvgProperties(store);
    const avgQuantitiesPerEntity = this.estimateAvgQuantities(store);
    const columnarMB = entityCount * (
      50 + // Base entity row
      avgPropertiesPerEntity * 20 + // Property rows
      avgQuantitiesPerEntity * 16   // Quantity rows
    ) / (1024 * 1024);
    
    // String table (deduplication varies)
    const stringDedupRatio = this.estimateStringDedup(store);
    const stringMB = (fileSizeMB * 0.3) * (1 - stringDedupRatio); // Assume 30% of file is strings
    
    // Relationship graph
    const avgRelationshipsPerEntity = 3; // Conservative estimate
    const graphMB = (entityCount * avgRelationshipsPerEntity * 16) / (1024 * 1024);
    
    // Geometry (varies massively)
    const geometryMB = this.estimateGeometryMemory(store, options);
    
    // Spatial index (BVH)
    const geometricEntityCount = this.countGeometricEntities(store);
    const spatialIndexMB = (geometricEntityCount * 64) / (1024 * 1024); // ~64 bytes per node
    
    const totalMB = sourceBufferMB + entityIndexMB + columnarMB + 
                    stringMB + graphMB + geometryMB + spatialIndexMB;
    
    return {
      sourceBufferMB,
      entityIndexMB,
      columnarMB,
      stringMB,
      graphMB,
      geometryMB,
      spatialIndexMB,
      totalMB,
      breakdown: {
        dataStructures: entityIndexMB + columnarMB + stringMB + graphMB,
        geometry: geometryMB + spatialIndexMB,
        source: sourceBufferMB,
      },
    };
  }
  
  /**
   * Estimate geometry memory (most variable component).
   */
  private estimateGeometryMemory(store: IfcDataStore, options: MemoryOptions): number {
    const geometricCount = this.countGeometricEntities(store);
    
    // Average triangle count per geometric entity
    const avgTriangles = this.estimateAvgTriangles(store);
    
    // Memory per triangle (positions + normals + indices)
    const bytesPerTriangle = 36 + 36 + 12; // 84 bytes
    
    // Instance ratio (reduces memory)
    const instanceRatio = this.estimateInstanceRatio(store);
    const uniqueTriangles = avgTriangles * geometricCount * (1 - instanceRatio);
    
    // Instance data overhead
    const instanceOverhead = geometricCount * instanceRatio * 64; // 64 bytes per instance
    
    // LOD overhead (if enabled)
    const lodOverhead = options.generateLODs 
      ? uniqueTriangles * bytesPerTriangle * 0.3 // 30% overhead for LODs
      : 0;
    
    const baseGeometryMB = (uniqueTriangles * bytesPerTriangle + instanceOverhead) / (1024 * 1024);
    
    return baseGeometryMB + lodOverhead / (1024 * 1024);
  }
  
  /**
   * Estimate string deduplication ratio.
   */
  private estimateStringDedup(store: IfcDataStore): number {
    // Real-world deduplication varies:
    // - Property set names: High dedup (many repeated)
    // - Property values: Low dedup (mostly unique)
    // - Entity names: Medium dedup
    // Average: 20-30% savings
    return 0.25; // 25% average
  }
}

interface MemoryBreakdown {
  sourceBufferMB: number;
  entityIndexMB: number;
  columnarMB: number;
  stringMB: number;
  graphMB: number;
  geometryMB: number;
  spatialIndexMB: number;
  totalMB: number;
  breakdown: {
    dataStructures: number;
    geometry: number;
    source: number;
  };
}

interface MemoryOptions {
  retainSource?: boolean;
  generateLODs?: boolean;
  compressGeometry?: boolean;
}
```

### Memory Budget Tiers

```typescript
/**
 * Device memory tier detection and budget allocation.
 */
class DeviceMemoryTier {
  
  /**
   * Detect device memory tier.
   */
  detect(): MemoryTier {
    // Use Device Memory API if available
    const deviceMemory = (navigator as any).deviceMemory;
    if (deviceMemory) {
      if (deviceMemory >= 8) return 'high';
      if (deviceMemory >= 4) return 'medium';
      return 'low';
    }
    
    // Fallback: Estimate from user agent or assume medium
    return 'medium';
  }
  
  /**
   * Get memory budget for tier.
   */
  getBudget(tier: MemoryTier): MemoryBudget {
    return {
      low: {
        maxTotalMB: 200,
        maxGeometryMB: 100,
        enableLODs: false,
        enableCompression: true,
        enableStreaming: true,
      },
      medium: {
        maxTotalMB: 500,
        maxGeometryMB: 300,
        enableLODs: true,
        enableCompression: false,
        enableStreaming: false,
      },
      high: {
        maxTotalMB: 2000,
        maxGeometryMB: 1500,
        enableLODs: true,
        enableCompression: false,
        enableStreaming: false,
      },
    }[tier];
  }
}

type MemoryTier = 'low' | 'medium' | 'high';

interface MemoryBudget {
  maxTotalMB: number;
  maxGeometryMB: number;
  enableLODs: boolean;
  enableCompression: boolean;
  enableStreaming: boolean;
}
```

### Memory Pressure Handling

```typescript
/**
 * Memory pressure manager - evicts geometry when needed.
 */
class MemoryPressureManager {
  private budget: MemoryBudget;
  private currentUsage: MemoryBreakdown;
  private evictionPolicy: EvictionPolicy;
  
  /**
   * Check if memory pressure is high.
   */
  checkPressure(): MemoryPressure {
    const usageRatio = this.currentUsage.totalMB / this.budget.maxTotalMB;
    const geometryRatio = this.currentUsage.geometryMB / this.budget.maxGeometryMB;
    
    if (usageRatio > 0.9 || geometryRatio > 0.9) {
      return 'critical';
    }
    if (usageRatio > 0.7 || geometryRatio > 0.7) {
      return 'high';
    }
    if (usageRatio > 0.5 || geometryRatio > 0.5) {
      return 'medium';
    }
    return 'low';
  }
  
  /**
   * Evict geometry to free memory.
   */
  async evict(targetMB: number): Promise<void> {
    const toEvict = this.currentUsage.geometryMB - targetMB;
    
    // Evict least recently used geometry
    const candidates = this.evictionPolicy.getLRUList();
    
    let evictedMB = 0;
    for (const meshId of candidates) {
      if (evictedMB >= toEvict) break;
      
      const meshSize = this.getMeshSize(meshId);
      await this.evictMesh(meshId);
      evictedMB += meshSize;
    }
    
    this.currentUsage.geometryMB -= evictedMB;
    this.currentUsage.totalMB -= evictedMB;
  }
}

type MemoryPressure = 'low' | 'medium' | 'high' | 'critical';
```

---

## 10.3 DuckDB Lazy Loading Strategy

### The Problem

DuckDB-WASM adds ~4.5MB to bundle size, but:
- Many use cases don't need SQL (fluent API is sufficient)
- JavaScript wrapper adds additional overhead
- Synchronous loading blocks initialization

### Solution: Load-on-Demand Pattern

```typescript
/**
 * Lazy-loaded DuckDB integration.
 */
class LazyDuckDBIntegration {
  private db: AsyncDuckDB | null = null;
  private conn: AsyncDuckDBConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private loadTime: number = 0;
  
  /**
   * Ensure DuckDB is loaded (lazy initialization).
   */
  async ensureLoaded(): Promise<AsyncDuckDBConnection> {
    if (this.conn) return this.conn;
    
    if (this.initPromise) {
      await this.initPromise;
      return this.conn!;
    }
    
    const startTime = performance.now();
    this.initPromise = this.doInit();
    await this.initPromise;
    this.loadTime = performance.now() - startTime;
    
    return this.conn!;
  }
  
  private async doInit(): Promise<void> {
    // Dynamic import - only loads when SQL is first used
    const duckdb = await import('@duckdb/duckdb-wasm');
    
    // Select appropriate bundle
    const bundle = await duckdb.selectBundle({
      mvp: {
        mainModule: '/duckdb-mvp.wasm',
        mainWorker: '/duckdb-mvp.worker.js',
      },
      eh: {
        mainModule: '/duckdb-eh.wasm',
        mainWorker: '/duckdb-eh.worker.js',
      },
    });
    
    // Initialize
    const logger = new duckdb.ConsoleLogger();
    const worker = new Worker(bundle.mainWorker!);
    this.db = new duckdb.AsyncDuckDB(logger, worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    this.conn = await this.db.connect();
  }
  
  /**
   * Check if DuckDB is loaded.
   */
  get isLoaded(): boolean {
    return this.conn !== null;
  }
  
  /**
   * Get load time (for metrics).
   */
  get loadTimeMs(): number {
    return this.loadTime;
  }
}

/**
 * Query interface with DuckDB fallback.
 */
class SQLQueryInterface {
  private duckdb: LazyDuckDBIntegration;
  private store: IfcDataStore;
  
  /**
   * Execute SQL query - loads DuckDB if needed.
   */
  async query(sql: string): Promise<SQLResult> {
    // Check if query can be handled without DuckDB
    if (this.canHandleWithoutDuckDB(sql)) {
      return this.executeNative(sql);
    }
    
    // Need DuckDB - ensure it's loaded
    const conn = await this.duckdb.ensureLoaded();
    return this.executeDuckDB(conn, sql);
  }
  
  /**
   * Check if query can be handled with native columnar scans.
   */
  private canHandleWithoutDuckDB(sql: string): boolean {
    const normalized = sql.toUpperCase().trim();
    
    // Simple SELECT with WHERE and basic aggregations
    const simplePattern = /^SELECT\s+.+\s+FROM\s+\w+\s*(WHERE\s+.+)?\s*(GROUP\s+BY\s+.+)?\s*(ORDER\s+BY\s+.+)?\s*$/;
    
    // No JOINs, subqueries, or complex functions
    if (normalized.includes('JOIN')) return false;
    if (normalized.includes('(') && normalized.includes('SELECT')) return false; // Subquery
    if (normalized.includes('WINDOW')) return false;
    if (normalized.includes('UNION')) return false;
    
    return simplePattern.test(normalized);
  }
  
  /**
   * Execute query using native columnar operations.
   */
  private async executeNative(sql: string): Promise<SQLResult> {
    // Parse simple SQL
    const parsed = this.parseSimpleSQL(sql);
    
    // Execute using columnar tables
    const results = this.executeColumnarQuery(parsed);
    
    return {
      columns: parsed.select,
      rows: results,
      rowCount: results.length,
      executionTimeMs: 0, // Fast native execution
    };
  }
  
  /**
   * Parse simple SQL into query plan.
   */
  private parseSimpleSQL(sql: string): SimpleQueryPlan {
    // Basic SQL parser for SELECT ... FROM ... WHERE ... GROUP BY ...
    // Implementation details...
    return {
      select: ['*'],
      from: 'entities',
      where: null,
      groupBy: null,
      orderBy: null,
    };
  }
  
  /**
   * Execute query plan on columnar tables.
   */
  private executeColumnarQuery(plan: SimpleQueryPlan): any[] {
    const table = this.getTable(plan.from);
    
    // Filter
    let filtered = table;
    if (plan.where) {
      filtered = this.applyWhere(filtered, plan.where);
    }
    
    // Group by
    if (plan.groupBy) {
      return this.applyGroupBy(filtered, plan.groupBy, plan.select);
    }
    
    // Select
    return this.applySelect(filtered, plan.select);
  }
}

interface SimpleQueryPlan {
  select: string[];
  from: string;
  where: any;
  groupBy: string[] | null;
  orderBy: string[] | null;
}
```

### Progressive SQL Feature Support

```typescript
/**
 * SQL capability detection.
 */
class SQLCapabilityDetector {
  
  /**
   * Check if query requires DuckDB.
   */
  requiresDuckDB(sql: string): boolean {
    const features = this.detectFeatures(sql);
    
    // Features that require DuckDB
    const duckdbFeatures = [
      'JOIN',
      'SUBQUERY',
      'WINDOW_FUNCTION',
      'UNION',
      'CTE',
      'COMPLEX_AGGREGATION',
    ];
    
    return features.some(f => duckdbFeatures.includes(f));
  }
  
  /**
   * Detect SQL features used in query.
   */
  private detectFeatures(sql: string): string[] {
    const normalized = sql.toUpperCase();
    const features: string[] = [];
    
    if (normalized.includes('JOIN')) features.push('JOIN');
    if (normalized.includes('(') && normalized.includes('SELECT')) features.push('SUBQUERY');
    if (normalized.includes('OVER(')) features.push('WINDOW_FUNCTION');
    if (normalized.includes('UNION')) features.push('UNION');
    if (normalized.includes('WITH') && normalized.includes('AS')) features.push('CTE');
    
    return features;
  }
}
```

### SQL Schema Definitions

```typescript
/**
 * Register IFC-Lite tables with DuckDB using Apache Arrow zero-copy.
 */
class DuckDBSchemaRegistry {
  private conn: AsyncDuckDBConnection;
  private store: IfcDataStore;
  
  /**
   * Register all tables from IfcDataStore.
   */
  async registerSchema(): Promise<void> {
    // Register entities table
    await this.registerEntitiesTable();
    
    // Register properties table
    await this.registerPropertiesTable();
    
    // Register quantities table
    await this.registerQuantitiesTable();
    
    // Register relationships table (as view)
    await this.registerRelationshipsView();
    
    // Create indexes for common query patterns
    await this.createIndexes();
  }
  
  /**
   * Register entities table with Arrow zero-copy.
   */
  private async registerEntitiesTable(): Promise<void> {
    const arrow = await import('apache-arrow');
    
    // Build Arrow table from columnar EntityTable
    const vectors = [
      arrow.makeVector(this.store.entities.expressId),
      arrow.makeVector(this.store.entities.typeEnum),
      arrow.makeVector(this.store.entities.globalId.map(idx => 
        this.store.strings.get(idx)
      )),
      arrow.makeVector(this.store.entities.name.map(idx => 
        this.store.strings.get(idx)
      )),
      arrow.makeVector(this.store.entities.containedInStorey),
    ];
    
    const schema = new arrow.Schema([
      new arrow.Field('express_id', new arrow.Int32()),
      new arrow.Field('type', new arrow.Int16()),
      new arrow.Field('global_id', new arrow.Utf8()),
      new arrow.Field('name', new arrow.Utf8()),
      new arrow.Field('storey_id', new arrow.Int32()),
    ]);
    
    const table = arrow.Table.new(vectors, schema);
    
    // Register with DuckDB (zero-copy if SharedArrayBuffer available)
    await this.conn.registerArrowTable('entities', table);
  }
  
  /**
   * Register properties table.
   */
  private async registerPropertiesTable(): Promise<void> {
    const arrow = await import('apache-arrow');
    
    const vectors = [
      arrow.makeVector(this.store.properties.entityId),
      arrow.makeVector(this.store.properties.psetName.map(idx => 
        this.store.strings.get(idx)
      )),
      arrow.makeVector(this.store.properties.propName.map(idx => 
        this.store.strings.get(idx)
      )),
      arrow.makeVector(this.store.properties.propType),
      // Value columns (union type - only one valid per row)
      arrow.makeVector(this.store.properties.valueString.map(idx => 
        idx >= 0 ? this.store.strings.get(idx) : null
      )),
      arrow.makeVector(this.store.properties.valueReal),
      arrow.makeVector(this.store.properties.valueInt),
      arrow.makeVector(this.store.properties.valueBool),
    ];
    
    const schema = new arrow.Schema([
      new arrow.Field('entity_id', new arrow.Uint32()),
      new arrow.Field('pset_name', new arrow.Utf8()),
      new arrow.Field('prop_name', new arrow.Utf8()),
      new arrow.Field('value_type', new arrow.Uint8()),
      new arrow.Field('value_string', new arrow.Utf8()),
      new arrow.Field('value_real', new arrow.Float64()),
      new arrow.Field('value_int', new arrow.Int32()),
      new arrow.Field('value_bool', new arrow.Uint8()),
    ]);
    
    const table = arrow.Table.new(vectors, schema);
    await this.conn.registerArrowTable('properties', table);
  }
  
  /**
   * Register quantities table.
   */
  private async registerQuantitiesTable(): Promise<void> {
    const arrow = await import('apache-arrow');
    
    const vectors = [
      arrow.makeVector(this.store.quantities.entityId),
      arrow.makeVector(this.store.quantities.qsetName.map(idx => 
        this.store.strings.get(idx)
      )),
      arrow.makeVector(this.store.quantities.quantityName.map(idx => 
        this.store.strings.get(idx)
      )),
      arrow.makeVector(this.store.quantities.quantityType),
      arrow.makeVector(this.store.quantities.value),
    ];
    
    const schema = new arrow.Schema([
      new arrow.Field('entity_id', new arrow.Uint32()),
      new arrow.Field('qset_name', new arrow.Utf8()),
      new arrow.Field('name', new arrow.Utf8()),
      new arrow.Field('type', new arrow.Uint8()),
      new arrow.Field('value', new arrow.Float64()),
    ]);
    
    const table = arrow.Table.new(vectors, schema);
    await this.conn.registerArrowTable('quantities', table);
  }
  
  /**
   * Register relationships as view (computed from graph).
   */
  private async registerRelationshipsView(): Promise<void> {
    // Create view that exposes relationship graph as table
    await this.conn.query(`
      CREATE VIEW relationships AS
      SELECT 
        source_id,
        target_id,
        rel_type,
        rel_id
      FROM (
        -- Forward relationships
        SELECT 
          source_id,
          target_id,
          rel_type,
          rel_id
        FROM relationship_edges_forward
        UNION ALL
        -- Inverse relationships (swapped)
        SELECT 
          target_id as source_id,
          source_id as target_id,
          rel_type,
          rel_id
        FROM relationship_edges_inverse
      )
    `);
  }
  
  /**
   * Create indexes for common query patterns.
   */
  private async createIndexes(): Promise<void> {
    // Index on entity type (for type filtering)
    await this.conn.query('CREATE INDEX idx_entities_type ON entities(type)');
    
    // Index on property lookups
    await this.conn.query('CREATE INDEX idx_properties_entity ON properties(entity_id)');
    await this.conn.query('CREATE INDEX idx_properties_pset ON properties(pset_name)');
    await this.conn.query('CREATE INDEX idx_properties_name ON properties(prop_name)');
    
    // Index on relationships
    await this.conn.query('CREATE INDEX idx_relationships_source ON relationships(source_id)');
    await this.conn.query('CREATE INDEX idx_relationships_target ON relationships(target_id)');
  }
}
```

### Virtual Table Implementation

```typescript
/**
 * Lazy view materialization from columnar stores.
 */
class VirtualTableManager {
  private conn: AsyncDuckDBConnection;
  private materializedViews: Set<string> = new Set();
  
  /**
   * Materialize view on first access.
   */
  async ensureMaterialized(viewName: string): Promise<void> {
    if (this.materializedViews.has(viewName)) return;
    
    // Materialize view to temporary table for faster queries
    await this.conn.query(`
      CREATE TEMPORARY TABLE ${viewName}_materialized AS
      SELECT * FROM ${viewName}
    `);
    
    this.materializedViews.add(viewName);
  }
  
  /**
   * Create convenience views for common queries.
   */
  async createConvenienceViews(): Promise<void> {
    // Walls view
    await this.conn.query(`
      CREATE VIEW walls AS
      SELECT * FROM entities
      WHERE type = ${IfcTypeEnum.IfcWall}
    `);
    
    // Doors view
    await this.conn.query(`
      CREATE VIEW doors AS
      SELECT * FROM entities
      WHERE type = ${IfcTypeEnum.IfcDoor}
    `);
    
    // Properties by entity (denormalized for easier queries)
    await this.conn.query(`
      CREATE VIEW entity_properties AS
      SELECT 
        e.express_id,
        e.type,
        e.name,
        p.pset_name,
        p.prop_name,
        CASE p.value_type
          WHEN ${PropertyValueType.String} THEN p.value_string
          WHEN ${PropertyValueType.Real} THEN CAST(p.value_real AS VARCHAR)
          WHEN ${PropertyValueType.Integer} THEN CAST(p.value_int AS VARCHAR)
          WHEN ${PropertyValueType.Boolean} THEN CAST(p.value_bool AS VARCHAR)
          ELSE NULL
        END as value
      FROM entities e
      LEFT JOIN properties p ON e.express_id = p.entity_id
    `);
  }
}
```

### Memory Sharing Strategy

```typescript
/**
 * Shared ArrayBuffer memory sharing between IfcDataStore and DuckDB.
 */
class SharedMemoryManager {
  private sharedBuffers: Map<string, SharedArrayBuffer> = new Map();
  private referenceCounts: Map<string, number> = new Map();
  
  /**
   * Share ArrayBuffer with DuckDB (zero-copy).
   */
  async shareBuffer(
    name: string,
    buffer: ArrayBuffer | SharedArrayBuffer
  ): Promise<SharedArrayBuffer> {
    // Convert to SharedArrayBuffer if needed
    let shared: SharedArrayBuffer;
    if (buffer instanceof SharedArrayBuffer) {
      shared = buffer;
    } else {
      // Check if SharedArrayBuffer is available
      if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error('SharedArrayBuffer not available - cannot share memory');
      }
      
      // Create SharedArrayBuffer and copy data
      shared = new SharedArrayBuffer(buffer.byteLength);
      new Uint8Array(shared).set(new Uint8Array(buffer));
    }
    
    this.sharedBuffers.set(name, shared);
    this.referenceCounts.set(name, 1);
    
    return shared;
  }
  
  /**
   * Increment reference count for shared buffer.
   */
  incrementReference(name: string): void {
    const count = this.referenceCounts.get(name) ?? 0;
    this.referenceCounts.set(name, count + 1);
  }
  
  /**
   * Decrement reference count and release if zero.
   */
  decrementReference(name: string): boolean {
    const count = this.referenceCounts.get(name) ?? 0;
    if (count <= 1) {
      this.sharedBuffers.delete(name);
      this.referenceCounts.delete(name);
      return true; // Released
    }
    
    this.referenceCounts.set(name, count - 1);
    return false; // Still referenced
  }
  
  /**
   * Check if SharedArrayBuffer is available.
   */
  static isSharedArrayBufferAvailable(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
  }
  
  /**
   * Fallback: Copy data when SharedArrayBuffer unavailable.
   */
  async registerTableWithCopy(
    conn: AsyncDuckDBConnection,
    tableName: string,
    table: ArrowTable
  ): Promise<void> {
    // DuckDB will copy the data internally
    // Less efficient but works without SharedArrayBuffer
    await conn.registerArrowTable(tableName, table);
  }
}
```

### Complete DuckDB Integration Example

```typescript
/**
 * Complete DuckDB integration with schema registration.
 */
class CompleteDuckDBIntegration extends LazyDuckDBIntegration {
  private schemaRegistry: DuckDBSchemaRegistry;
  private memoryManager: SharedMemoryManager;
  private viewManager: VirtualTableManager;
  
  async ensureLoaded(): Promise<AsyncDuckDBConnection> {
    const conn = await super.ensureLoaded();
    
    // Register schema on first load
    if (!this.schemaRegistry) {
      this.schemaRegistry = new DuckDBSchemaRegistry(conn, this.store);
      await this.schemaRegistry.registerSchema();
      
      this.viewManager = new VirtualTableManager(conn);
      await this.viewManager.createConvenienceViews();
    }
    
    return conn;
  }
  
  /**
   * Execute SQL query with automatic schema registration.
   */
  async query(sql: string): Promise<SQLResult> {
    const conn = await this.ensureLoaded();
    const result = await conn.query(sql);
    return this.convertResult(result);
  }
  
  /**
   * Convert DuckDB result to SQLResult format.
   */
  private convertResult(result: DuckDBResult): SQLResult {
    return {
      columns: result.schema.fields.map(f => f.name),
      rows: result.toArray(),
      rowCount: result.numRows,
      executionTimeMs: result.executionTimeMs,
    };
  }
}
```

---

## 10.4 Data Structure Versioning

### The Problem

Columnar table schemas may evolve:
- New fields added to PropertyTable
- Changes to relationship graph structure
- Geometry format improvements

Need strategy for:
- Reading old exports
- Migrating cached data
- Forward compatibility

### Solution: Schema Versioning System

```typescript
/**
 * Schema version management.
 */
class SchemaVersionManager {
  private readonly CURRENT_VERSION = '2.0.0';
  private readonly MIN_SUPPORTED_VERSION = '1.0.0';
  
  /**
   * Embed version in export metadata.
   */
  createMetadata(store: IfcDataStore): ExportMetadata {
    return {
      formatVersion: this.CURRENT_VERSION,
      schemaHash: this.computeSchemaHash(),
      features: this.detectFeatures(store),
      exportTime: new Date().toISOString(),
      generator: 'IFC-Lite',
      generatorVersion: this.CURRENT_VERSION,
    };
  }
  
  /**
   * Compute hash of columnar table schemas.
   */
  private computeSchemaHash(): string {
    const schema = {
      entities: ['expressId', 'typeEnum', 'globalId', 'name', 'description', 'objectType', 'flags'],
      properties: ['entityId', 'psetName', 'propName', 'propType', 'valueString', 'valueReal', 'valueInt', 'valueBool'],
      quantities: ['entityId', 'qsetName', 'quantityName', 'quantityType', 'value'],
      // ... all table schemas
    };
    
    const json = JSON.stringify(schema);
    return this.hashString(json);
  }
  
  /**
   * Detect enabled features.
   */
  private detectFeatures(store: IfcDataStore): string[] {
    const features: string[] = [];
    
    if (store.geometry) features.push('geometry');
    if (store.properties.count > 0) features.push('properties');
    if (store.quantities.count > 0) features.push('quantities');
    if (store.graph) features.push('relationships');
    if (store.spatialIndex) features.push('spatial');
    
    return features;
  }
  
  /**
   * Validate and migrate import.
   */
  async import(data: ExportedData): Promise<IfcDataStore> {
    const metadata = data.metadata;
    
    // Check version compatibility
    if (this.compareVersions(metadata.formatVersion, this.MIN_SUPPORTED_VERSION) < 0) {
      throw new Error(
        `Unsupported format version: ${metadata.formatVersion}. ` +
        `Minimum supported: ${this.MIN_SUPPORTED_VERSION}`
      );
    }
    
    // Migrate if needed
    if (metadata.formatVersion !== this.CURRENT_VERSION) {
      return this.migrate(data);
    }
    
    // Direct import
    return this.importCurrent(data);
  }
  
  /**
   * Migrate from older version.
   */
  private async migrate(data: ExportedData): Promise<IfcDataStore> {
    const version = data.metadata.formatVersion;
    
    // Migration chain: 1.0.0 → 1.1.0 → 2.0.0
    let migrated = data;
    
    if (this.compareVersions(version, '1.1.0') < 0) {
      migrated = await this.migrate_1_0_to_1_1(migrated);
    }
    
    if (this.compareVersions(migrated.metadata.formatVersion, '2.0.0') < 0) {
      migrated = await this.migrate_1_1_to_2_0(migrated);
    }
    
    return this.importCurrent(migrated);
  }
  
  /**
   * Migrate from 1.0.0 to 1.1.0.
   */
  private async migrate_1_0_to_1_1(data: ExportedData): Promise<ExportedData> {
    // Example: Add new field with default value
    const entities = data.entities;
    
    // Add 'objectType' field if missing
    if (!entities.objectType) {
      const count = entities.expressId.length;
      entities.objectType = new Uint32Array(count).fill(0); // Empty string index
    }
    
    return {
      ...data,
      metadata: {
        ...data.metadata,
        formatVersion: '1.1.0',
      },
    };
  }
  
  /**
   * Migrate from 1.1.0 to 2.0.0.
   */
  private async migrate_1_1_to_2_0(data: ExportedData): Promise<ExportedData> {
    // Example: Restructure property table
    // Implementation depends on actual schema changes
    return {
      ...data,
      metadata: {
        ...data.metadata,
        formatVersion: '2.0.0',
      },
    };
  }
}

interface ExportMetadata {
  formatVersion: string;
  schemaHash: string;
  features: string[];
  exportTime: string;
  generator: string;
  generatorVersion: string;
}

interface ExportedData {
  metadata: ExportMetadata;
  entities: any;
  properties: any;
  quantities: any;
  geometry?: any;
  // ... other tables
}
```

### Forward-Compatible Field Addition

```typescript
/**
 * Columnar table with version-aware field access.
 */
class VersionedPropertyTable {
  private data: PropertyTable;
  private version: string;
  
  /**
   * Get property value (handles missing fields gracefully).
   */
  getPropertyValue(
    expressId: number,
    psetName: string,
    propName: string
  ): PropertyValue | null {
    // Check if field exists in this version
    if (this.version < '2.0.0' && !this.data.enumDefinitionId) {
      // Fall back to simple value lookup
      return this.getSimpleValue(expressId, psetName, propName);
    }
    
    // Use full feature set
    return this.getFullValue(expressId, psetName, propName);
  }
  
  /**
   * Add new field with default for older versions.
   */
  addField<T>(fieldName: string, defaultValue: T): void {
    if (!(this.data as any)[fieldName]) {
      const count = this.data.count;
      (this.data as any)[fieldName] = new Array(count).fill(defaultValue);
    }
  }
}
```

### Parquet Metadata Embedding

```typescript
/**
 * Embed version in Parquet file metadata.
 */
class VersionedParquetExporter {
  
  /**
   * Export with version metadata.
   */
  async exportBOS(store: IfcDataStore): Promise<Uint8Array> {
    const metadata = this.versionManager.createMetadata(store);
    
    // Embed in Parquet file metadata
    const files = new Map<string, Uint8Array>();
    
    // Add metadata file
    files.set('Metadata.json', new TextEncoder().encode(
      JSON.stringify(metadata, null, 2)
    ));
    
    // Export tables with schema version in metadata
    files.set('Entities.parquet', await this.writeEntitiesWithVersion(store, metadata));
    files.set('Properties.parquet', await this.writePropertiesWithVersion(store, metadata));
    // ... other tables
    
    return this.createZipArchive(files);
  }
  
  /**
   * Write Parquet with schema version in metadata.
   */
  private async writeEntitiesWithVersion(
    store: IfcDataStore,
    metadata: ExportMetadata
  ): Promise<Uint8Array> {
    const parquet = await import('parquet-wasm');
    
    // Build Arrow table
    const table = this.buildArrowTable(store.entities);
    
    // Add metadata to schema
    const schema = table.schema;
    schema.metadata.set('formatVersion', metadata.formatVersion);
    schema.metadata.set('schemaHash', metadata.schemaHash);
    
    // Write Parquet
    const writer = new parquet.ParquetWriter(schema);
    writer.writeTable(table);
    return writer.finish();
  }
}
```

---

## 10.5 Complex Property Types

### The Problem

IFC property system is richer than simple single values:
- `IfcPropertyEnumeratedValue` - Enum with definition
- `IfcPropertyBoundedValue` - Min/max range
- `IfcPropertyTableValue` - Lookup table
- `IfcPropertyReferenceValue` - Reference to another entity
- `IfcComplexProperty` - Nested property sets

Current design uses `PropertyValueType.List` catch-all, losing queryability.

### Solution: Extended Property Table

```typescript
/**
 * Extended property table supporting all IFC property types.
 */
interface PropertyTableExtended extends PropertyTable {
  // === ENUMERATED VALUES ===
  
  // Enum definition table
  enumDefinitions: EnumDefinitionTable;
  
  // Reference to enum definition (for enumerated properties)
  enumDefinitionId: Int32Array;  // -1 if not enumerated
  enumValueIndex: Int32Array;    // Index into enum definition values
  
  // === BOUNDED VALUES ===
  
  // Lower and upper bounds (for bounded properties)
  lowerBound: Float64Array;      // NaN if not bounded
  upperBound: Float64Array;      // NaN if not bounded
  boundType: Uint8Array;          // 0=inclusive, 1=exclusive, 255=not bounded
  
  // === TABLE VALUES ===
  
  // Table definition table
  tableDefinitions: TableDefinitionTable;
  
  // Reference to table definition (for table properties)
  tableDefinitionId: Int32Array;  // -1 if not table
  tableRowIndex: Int32Array;      // Row index in table
  tableColumnIndex: Int32Array;   // Column index in table
  
  // === REFERENCE VALUES ===
  
  // Reference to another entity (for reference properties)
  referenceEntityId: Int32Array;  // -1 if not reference
  
  // === COMPLEX PROPERTIES ===
  
  // Nested property set (for complex properties)
  complexPropertySetId: Int32Array;  // -1 if not complex
}

/**
 * Enum definition table.
 */
interface EnumDefinitionTable {
  count: number;
  definitionId: Uint32Array;
  name: Uint32Array;              // Index into StringTable
  values: Uint32Array[];          // Array of value indices per definition
}

/**
 * Table definition table.
 */
interface TableDefinitionTable {
  count: number;
  definitionId: Uint32Array;
  name: Uint32Array;               // Index into StringTable
  rowCount: Uint32Array;
  columnCount: Uint32Array;
  headers: Uint32Array[];          // Column headers
  cells: Float64Array[];           // Table data (flattened)
}
```

### Property Extraction with Full Type Support

```typescript
/**
 * Property extractor supporting all IFC property types.
 */
class ExtendedPropertyExtractor {
  
  /**
   * Extract property with full type information.
   */
  extractProperty(
    property: IfcProperty,
    decoder: EntityDecoder
  ): ExtendedPropertyRow {
    const base: ExtendedPropertyRow = {
      propName: property.name,
      propType: this.detectPropertyType(property),
      // ... base fields
    };
    
    switch (property.type) {
      case 'IfcPropertySingleValue':
        return {
          ...base,
          propType: PropertyValueType.Real, // or String, Integer, etc.
          valueReal: property.nominalValue as number,
          // ... simple value
        };
        
      case 'IfcPropertyEnumeratedValue':
        const enumDef = decoder.decodeEnumDefinition(property.enumerationReference);
        return {
          ...base,
          propType: PropertyValueType.Enum,
          enumDefinitionId: enumDef.expressId,
          enumValueIndex: enumDef.values.indexOf(property.enumerationValues[0]),
          // Also store resolved string for queryability
          valueString: this.strings.intern(property.enumerationValues[0]),
        };
        
      case 'IfcPropertyBoundedValue':
        return {
          ...base,
          propType: PropertyValueType.Bounded,
          lowerBound: property.lowerBoundValue,
          upperBound: property.upperBoundValue,
          boundType: this.encodeBoundType(property.setPoint),
          // Store nominal value for queries
          valueReal: property.upperBoundValue, // or average
        };
        
      case 'IfcPropertyTableValue':
        const tableDef = decoder.decodeTableDefinition(property.definingValues);
        return {
          ...base,
          propType: PropertyValueType.Table,
          tableDefinitionId: tableDef.expressId,
          tableRowIndex: this.findTableRow(tableDef, property.definedValues),
          tableColumnIndex: 0, // Primary column
          // Store resolved value for queries
          valueReal: this.resolveTableValue(tableDef, property.definedValues),
        };
        
      case 'IfcPropertyReferenceValue':
        return {
          ...base,
          propType: PropertyValueType.Reference,
          referenceEntityId: property.propertyReference.expressId,
          // Store referenced entity type/name for queries
          valueString: this.strings.intern(property.propertyReference.type),
        };
        
      case 'IfcComplexProperty':
        const nestedPset = decoder.decodePropertySet(property.usageName);
        return {
          ...base,
          propType: PropertyValueType.Complex,
          complexPropertySetId: nestedPset.expressId,
          // Store summary for queries
          valueString: this.strings.intern(`Complex:${nestedPset.name}`),
        };
    }
  }
  
  /**
   * Encode bound type (inclusive/exclusive).
   */
  private encodeBoundType(setPoint: string): number {
    if (setPoint.includes('INCLUSIVE')) return 0;
    if (setPoint.includes('EXCLUSIVE')) return 1;
    return 0; // Default inclusive
  }
}

interface ExtendedPropertyRow {
  propName: string;
  propType: PropertyValueType;
  // Simple value (always populated for queryability)
  valueString?: number;  // String index
  valueReal?: number;
  valueInt?: number;
  valueBool?: number;
  
  // Extended type-specific fields
  enumDefinitionId?: number;
  enumValueIndex?: number;
  lowerBound?: number;
  upperBound?: number;
  boundType?: number;
  tableDefinitionId?: number;
  tableRowIndex?: number;
  tableColumnIndex?: number;
  referenceEntityId?: number;
  complexPropertySetId?: number;
}
```

### Queryability Preservation

```typescript
/**
 * Query interface that handles all property types.
 */
class ExtendedPropertyQuery {
  
  /**
   * Query property value (handles all types).
   */
  getPropertyValue(
    expressId: number,
    psetName: string,
    propName: string
  ): PropertyValue | PropertyRange | PropertyEnum | PropertyTable | PropertyReference | null {
    const row = this.findPropertyRow(expressId, psetName, propName);
    if (!row) return null;
    
    switch (row.propType) {
      case PropertyValueType.Real:
      case PropertyValueType.Integer:
      case PropertyValueType.String:
        return this.getSimpleValue(row);
        
      case PropertyValueType.Enum:
        return {
          type: 'enum',
          value: this.strings.get(row.valueString!),
          enumDefinition: this.getEnumDefinition(row.enumDefinitionId!),
          enumValue: this.getEnumValue(row.enumDefinitionId!, row.enumValueIndex!),
        };
        
      case PropertyValueType.Bounded:
        return {
          type: 'bounded',
          lower: row.lowerBound!,
          upper: row.upperBound!,
          boundType: row.boundType === 0 ? 'inclusive' : 'exclusive',
          nominal: row.valueReal, // For queries
        };
        
      case PropertyValueType.Table:
        return {
          type: 'table',
          tableDefinition: this.getTableDefinition(row.tableDefinitionId!),
          row: row.tableRowIndex!,
          column: row.tableColumnIndex!,
          value: row.valueReal, // Resolved value
        };
        
      case PropertyValueType.Reference:
        return {
          type: 'reference',
          entityId: row.referenceEntityId!,
          entityType: this.strings.get(row.valueString!),
        };
        
      case PropertyValueType.Complex:
        return {
          type: 'complex',
          propertySetId: row.complexPropertySetId!,
          nestedProperties: this.getNestedProperties(row.complexPropertySetId!),
        };
    }
  }
  
  /**
   * Query with range filtering (works for bounded values).
   */
  wherePropertyInRange(
    psetName: string,
    propName: string,
    min: number,
    max: number
  ): number[] {
    const psetIdx = this.strings.indexOf(psetName);
    const propIdx = this.strings.indexOf(propName);
    
    const results: number[] = [];
    
    for (let i = 0; i < this.properties.count; i++) {
      if (this.properties.psetName[i] !== psetIdx) continue;
      if (this.properties.propName[i] !== propIdx) continue;
      
      const row = this.getPropertyRow(i);
      
      // Handle bounded values
      if (row.propType === PropertyValueType.Bounded) {
        const lower = row.lowerBound!;
        const upper = row.upperBound!;
        
        // Check overlap
        if (upper >= min && lower <= max) {
          results.push(row.entityId);
        }
      } else {
        // Simple value comparison
        const value = row.valueReal ?? row.valueInt ?? 0;
        if (value >= min && value <= max) {
          results.push(row.entityId);
        }
      }
    }
    
    return results;
  }
}
```

---

## 10.6 IFC Version Compatibility Matrix

### The Problem

IFC2X3, IFC4, and IFC4X3 have:
- Different entity hierarchies
- Renamed/merged entities
- New relationship types
- Different property set definitions

Need unified handling across versions.

### Solution: Version Normalization System

```typescript
/**
 * IFC version compatibility manager.
 */
class IFCVersionCompatibility {
  
  /**
   * Entity type mapping across versions.
   */
  private readonly ENTITY_MAPPINGS: Map<string, Map<SchemaVersion, string>> = new Map([
    // IFC2X3 → Unified
    ['IfcWallStandardCase', new Map([
      ['IFC2X3', 'IfcWallStandardCase'],
      ['IFC4', 'IfcWall'],
      ['IFC4X3', 'IfcWall'],
    ])],
    
    // IFC4 additions
    ['IfcRelInterferesElements', new Map([
      ['IFC2X3', null], // Doesn't exist
      ['IFC4', 'IfcRelInterferesElements'],
      ['IFC4X3', 'IfcRelInterferesElements'],
    ])],
    
    // Relationship splits
    ['IfcRelDefines', new Map([
      ['IFC2X3', 'IfcRelDefines'],
      ['IFC4', 'IfcRelDefinesByProperties'], // Split into subtypes
      ['IFC4X3', 'IfcRelDefinesByProperties'],
    ])],
  ]);
  
  /**
   * Normalize entity type to unified form.
   */
  normalizeEntityType(
    type: string,
    sourceVersion: SchemaVersion,
    targetVersion: SchemaVersion = 'IFC4'
  ): string {
    // If already in target version, return as-is
    if (sourceVersion === targetVersion) return type;
    
    // Check mapping
    const mapping = this.ENTITY_MAPPINGS.get(type);
    if (mapping) {
      const targetType = mapping.get(targetVersion);
      if (targetType) return targetType;
    }
    
    // No mapping - assume compatible
    return type;
  }
  
  /**
   * Get all versions that support entity type.
   */
  getSupportedVersions(entityType: string): SchemaVersion[] {
    const mapping = this.ENTITY_MAPPINGS.get(entityType);
    if (!mapping) {
      // Assume available in all versions if not in mapping
      return ['IFC2X3', 'IFC4', 'IFC4X3'];
    }
    
    return Array.from(mapping.keys()).filter(v => mapping.get(v) !== null) as SchemaVersion[];
  }
}

type SchemaVersion = 'IFC2X3' | 'IFC4' | 'IFC4X3';
```

### Version-Specific Decoders

```typescript
/**
 * Version-aware entity decoder.
 */
class VersionAwareDecoder {
  private compatibility: IFCVersionCompatibility;
  
  /**
   * Decode entity with version-specific handling.
   */
  decodeEntity(
    buffer: Uint8Array,
    ref: EntityRef,
    schemaVersion: SchemaVersion
  ): DecodedEntity {
    const typeEnum = ref.typeEnum;
    const typeName = IfcTypeEnumToString(typeEnum);
    
    // Normalize type name
    const normalizedType = this.compatibility.normalizeEntityType(
      typeName,
      schemaVersion
    );
    
    // Route to version-specific decoder
    switch (schemaVersion) {
      case 'IFC2X3':
        return this.decodeIFC2X3(buffer, ref, normalizedType);
      case 'IFC4':
        return this.decodeIFC4(buffer, ref, normalizedType);
      case 'IFC4X3':
        return this.decodeIFC4X3(buffer, ref, normalizedType);
    }
  }
  
  /**
   * IFC2X3-specific decoding.
   */
  private decodeIFC2X3(
    buffer: Uint8Array,
    ref: EntityRef,
    type: string
  ): DecodedEntity {
    // IFC2X3 has different attribute order in some entities
    if (type === 'IfcWallStandardCase') {
      return this.decodeWallStandardCase_2X3(buffer, ref);
    }
    
    // Default decoder
    return this.decodeGeneric(buffer, ref);
  }
  
  /**
   * IFC4-specific decoding.
   */
  private decodeIFC4(
    buffer: Uint8Array,
    ref: EntityRef,
    type: string
  ): DecodedEntity {
    // IFC4 introduced new attributes
    if (type === 'IfcWall') {
      return this.decodeWall_4(buffer, ref);
    }
    
    return this.decodeGeneric(buffer, ref);
  }
}
```

### Property Set Version Differences

```typescript
/**
 * Property set compatibility across versions.
 */
class PropertySetCompatibility {
  
  /**
   * Known property set differences.
   */
  private readonly PSET_DIFFERENCES: Map<string, VersionDifferences> = new Map([
    ['Pset_WallCommon', {
      ifc2x3: ['FireRating', 'LoadBearing', 'IsExternal'],
      ifc4: ['FireRating', 'LoadBearing', 'IsExternal', 'AcousticRating'], // Added
      ifc4x3: ['FireRating', 'LoadBearing', 'IsExternal', 'AcousticRating', 'ThermalTransmittance'], // Added
    }],
    ['Pset_DoorCommon', {
      ifc2x3: ['FireRating', 'AcousticRating'],
      ifc4: ['FireRating', 'AcousticRating', 'SecurityRating'], // Added
      ifc4x3: ['FireRating', 'AcousticRating', 'SecurityRating'], // Same as IFC4
    }],
  ]);
  
  /**
   * Get available properties for pset in version.
   */
  getAvailableProperties(
    psetName: string,
    version: SchemaVersion
  ): string[] {
    const differences = this.PSET_DIFFERENCES.get(psetName);
    if (!differences) {
      // Assume same across versions
      return []; // Would need to query actual schema
    }
    
    return differences[version.toLowerCase() as 'ifc2x3' | 'ifc4' | 'ifc4x3'];
  }
  
  /**
   * Check if property exists in version.
   */
  hasProperty(
    psetName: string,
    propName: string,
    version: SchemaVersion
  ): boolean {
    const available = this.getAvailableProperties(psetName, version);
    return available.includes(propName);
  }
}

interface VersionDifferences {
  ifc2x3: string[];
  ifc4: string[];
  ifc4x3: string[];
}
```

### Unified Query Interface

```typescript
/**
 * Query interface that handles version differences transparently.
 */
class UnifiedQueryInterface {
  private compatibility: IFCVersionCompatibility;
  private psetCompatibility: PropertySetCompatibility;
  
  /**
   * Query property (handles version differences).
   */
  async queryProperty(
    expressId: number,
    psetName: string,
    propName: string
  ): Promise<PropertyValue | null> {
    const entity = this.store.entities.get(expressId);
    const version = this.store.schemaVersion;
    
    // Check if property exists in this version
    if (!this.psetCompatibility.hasProperty(psetName, propName, version)) {
      // Try to find equivalent property
      const equivalent = this.findEquivalentProperty(psetName, propName, version);
      if (equivalent) {
        return this.queryProperty(expressId, psetName, equivalent);
      }
      
      return null;
    }
    
    // Query normally
    return this.store.properties.getPropertyValue(expressId, psetName, propName);
  }
  
  /**
   * Find equivalent property name across versions.
   */
  private findEquivalentProperty(
    psetName: string,
    propName: string,
    version: SchemaVersion
  ): string | null {
    // Property name mappings
    const mappings: Record<string, Record<string, string>> = {
      'Pset_WallCommon': {
        'ThermalTransmittance': 'UValue', // IFC2X3 name
      },
    };
    
    const psetMapping = mappings[psetName];
    if (!psetMapping) return null;
    
    return psetMapping[propName] ?? null;
  }
}
```

---

## 10.7 Renderer Abstraction Layer

### The Problem

WebGPU is primary target, but fallback to WebGL2 is needed. Current design is WebGPU-centric with no shared abstraction.

### Solution: Common Renderer Interface

```typescript
/**
 * Common renderer interface for WebGPU and WebGL2.
 */
interface IFCRenderer {
  // === INITIALIZATION ===
  
  /**
   * Initialize renderer with canvas.
   */
  init(canvas: HTMLCanvasElement): Promise<void>;
  
  /**
   * Check if renderer is initialized.
   */
  readonly isInitialized: boolean;
  
  // === GEOMETRY MANAGEMENT ===
  
  /**
   * Upload mesh to GPU.
   */
  uploadGeometry(mesh: ColumnarMesh): MeshHandle;
  
  /**
   * Update mesh geometry (for LOD switching).
   */
  updateGeometry(handle: MeshHandle, mesh: ColumnarMesh): void;
  
  /**
   * Remove mesh from GPU.
   */
  removeGeometry(handle: MeshHandle): void;
  
  // === INSTANCING ===
  
  /**
   * Create instance batch.
   */
  createInstanceBatch(
    prototype: MeshHandle,
    instances: InstanceData[]
  ): InstanceBatchHandle;
  
  /**
   * Update instance transforms.
   */
  updateInstances(batch: InstanceBatchHandle, instances: InstanceData[]): void;
  
  // === CAMERA & TRANSFORMS ===
  
  /**
   * Set camera matrices.
   */
  setCamera(view: Mat4, proj: Mat4, position: Vec3): void;
  
  // === RENDERING ===
  
  /**
   * Render frame.
   */
  render(options?: RenderOptions): void;
  
  /**
   * Render with custom visibility list.
   */
  renderVisible(visibleMeshes: MeshHandle[], options?: RenderOptions): void;
  
  // === PICKING ===
  
  /**
   * Pick object at screen coordinates.
   */
  pick(x: number, y: number): Promise<PickResult | null>;
  
  /**
   * Pick objects in rectangle.
   */
  pickRect(x: number, y: number, width: number, height: number): Promise<PickResult[]>;
  
  // === CAPABILITIES ===
  
  /**
   * Check if feature is supported.
   */
  readonly supportsInstancing: boolean;
  readonly supportsComputeCulling: boolean;
  readonly supportsIndirectDraw: boolean;
  readonly supportsOcclusionCulling: boolean;
  readonly maxTextureSize: number;
  readonly maxVertexAttributes: number;
  
  // === RESOURCES ===
  
  /**
   * Get GPU memory usage.
   */
  getMemoryUsage(): GPUMemoryUsage;
  
  /**
   * Cleanup and release resources.
   */
  dispose(): void;
}

interface MeshHandle {
  id: number;
  vertexCount: number;
  triangleCount: number;
}

interface InstanceBatchHandle {
  id: number;
  instanceCount: number;
}

interface InstanceData {
  transform: Mat4;
  color?: [number, number, number, number];
  objectId: number;
}

interface RenderOptions {
  clearColor?: [number, number, number, number];
  enableDepthTest?: boolean;
  enableCulling?: boolean;
  sectionPlanes?: SectionPlane[];
}

interface PickResult {
  objectId: number;
  distance: number;
  position: Vec3;
  normal: Vec3;
}

interface GPUMemoryUsage {
  buffersMB: number;
  texturesMB: number;
  totalMB: number;
}
```

### WebGPU Implementation

```typescript
/**
 * WebGPU renderer implementation.
 */
class WebGPURenderer implements IFCRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private commandEncoder: GPUCommandEncoder | null = null;
  
  readonly supportsInstancing = true;
  readonly supportsComputeCulling = true;
  readonly supportsIndirectDraw = true;
  readonly supportsOcclusionCulling = true;
  readonly maxTextureSize = 16384;
  readonly maxVertexAttributes = 30;
  
  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU not available');
    
    this.device = await adapter.requestDevice();
    this.context = canvas.getContext('webgpu')!;
    
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  
  uploadGeometry(mesh: ColumnarMesh): MeshHandle {
    // Create GPU buffers
    const positionBuffer = this.device.createBuffer({
      size: mesh.positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(positionBuffer, 0, mesh.positions);
    
    // ... similar for normals, indices
    
    return {
      id: this.nextHandleId++,
      vertexCount: mesh.positions.length / 3,
      triangleCount: mesh.indices.length / 3,
    };
  }
  
  render(options?: RenderOptions): void {
    // WebGPU rendering with compute culling, indirect draws, etc.
    // Implementation details...
  }
  
  async pick(x: number, y: number): Promise<PickResult | null> {
    // GPU-based picking using compute shader
    // Implementation details...
  }
}
```

### WebGL2 Fallback Implementation

```typescript
/**
 * WebGL2 renderer implementation (fallback).
 */
class WebGL2Renderer implements IFCRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  
  readonly supportsInstancing = true; // ANGLE_instanced_arrays
  readonly supportsComputeCulling = false;
  readonly supportsIndirectDraw = false; // No multi-draw in WebGL2
  readonly supportsOcclusionCulling = false;
  readonly maxTextureSize = 16384;
  readonly maxVertexAttributes = 16;
  
  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2')!;
    if (!this.gl) throw new Error('WebGL2 not available');
    
    // Enable extensions
    this.gl.getExtension('ANGLE_instanced_arrays');
  }
  
  uploadGeometry(mesh: ColumnarMesh): MeshHandle {
    // Create WebGL buffers
    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, mesh.positions, this.gl.STATIC_DRAW);
    
    // ... similar for normals, indices
    
    return {
      id: this.nextHandleId++,
      vertexCount: mesh.positions.length / 3,
      triangleCount: mesh.indices.length / 3,
    };
  }
  
  render(options?: RenderOptions): void {
    // CPU-based frustum culling
    const visible = this.cullCPU(this.getAllMeshes());
    
    // Render visible meshes
    for (const mesh of visible) {
      this.renderMesh(mesh);
    }
  }
  
  async pick(x: number, y: number): Promise<PickResult | null> {
    // CPU-based raycasting or render-to-texture picking
    // Implementation details...
  }
  
  /**
   * CPU frustum culling (fallback when compute shaders unavailable).
   */
  private cullCPU(meshes: MeshHandle[]): MeshHandle[] {
    const frustum = this.computeFrustum();
    return meshes.filter(mesh => {
      const bounds = this.getMeshBounds(mesh);
      return this.isAABBInFrustum(bounds, frustum);
    });
  }
}
```

### Renderer Factory

```typescript
/**
 * Renderer factory - selects best available renderer.
 */
class RendererFactory {
  
  /**
   * Create renderer (WebGPU preferred, WebGL2 fallback).
   */
  static async create(canvas: HTMLCanvasElement): Promise<IFCRenderer> {
    // Try WebGPU first
    if (await this.isWebGPUSupported()) {
      const renderer = new WebGPURenderer();
      await renderer.init(canvas);
      return renderer;
    }
    
    // Fallback to WebGL2
    if (this.isWebGL2Supported()) {
      const renderer = new WebGL2Renderer();
      await renderer.init(canvas);
      return renderer;
    }
    
    throw new Error('No supported renderer available');
  }
  
  private static async isWebGPUSupported(): Promise<boolean> {
    return 'gpu' in navigator && navigator.gpu !== undefined;
  }
  
  private static isWebGL2Supported(): boolean {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  }
}
```

### Feature Degradation Table

| Feature | WebGPU | WebGL2 Fallback | Notes |
|---------|--------|-----------------|-------|
| **Frustum Culling** | GPU compute shader | CPU per-frame | WebGL2: ~5ms for 10K objects |
| **Occlusion Culling** | Hi-Z pyramid | Skip | Not feasible in WebGL2 |
| **LOD Selection** | GPU screen-space | CPU, fewer levels | WebGL2: 2-3 LOD levels max |
| **Instancing** | Full support | ANGLE_instanced_arrays | Both support, WebGPU faster |
| **Indirect Draws** | Multi-draw indirect | Multiple draw calls | WebGL2: More draw calls |
| **Section Caps** | GPU generation | Pre-compute CPU | WebGL2: Slower updates |
| **Picking** | Compute shader | Render-to-texture | WebGL2: ~16ms vs ~1ms |

### GLSL ES 3.0 Shader Equivalents

#### Vertex Shader (Instanced Rendering)

```glsl
#version 300 es

// Per-vertex attributes
in vec3 a_position;
in vec3 a_normal;

// Per-instance attributes (ANGLE_instanced_arrays)
in mat4 a_instanceTransform;
in vec4 a_instanceColor;
in uint a_instanceObjectId;

// Uniforms
uniform mat4 u_viewMatrix;
uniform mat4 u_projectionMatrix;
uniform mat4 u_modelMatrix;
uniform vec3 u_cameraPosition;

// Outputs
out vec3 v_worldPosition;
out vec3 v_worldNormal;
out vec4 v_color;
flat out uint v_objectId;

void main() {
  // Apply instance transform
  vec4 worldPos = a_instanceTransform * vec4(a_position, 1.0);
  
  // Transform normal (upper 3x3 of transform)
  mat3 normalMatrix = mat3(
    a_instanceTransform[0].xyz,
    a_instanceTransform[1].xyz,
    a_instanceTransform[2].xyz
  );
  vec3 worldNormal = normalize(normalMatrix * a_normal);
  
  // Apply model-view-projection
  gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
  
  // Pass to fragment shader
  v_worldPosition = worldPos.xyz;
  v_worldNormal = worldNormal;
  v_color = a_instanceColor;
  v_objectId = a_instanceObjectId;
}
```

#### Fragment Shader (PBR Lighting)

```glsl
#version 300 es
precision highp float;

// Inputs
in vec3 v_worldPosition;
in vec3 v_worldNormal;
in vec4 v_color;
flat in uint v_objectId;

// Uniforms
uniform vec3 u_cameraPosition;
uniform vec3 u_lightDirection;
uniform vec3 u_lightColor;
uniform vec3 u_ambientColor;
uniform float u_metallic;
uniform float u_roughness;
uniform vec4 u_sectionPlanes[6]; // xyz=normal, w=distance
uniform int u_sectionPlaneCount;

// Outputs
out vec4 fragColor;
out vec2 fragNormal; // Encoded normal for edge detection
out uint fragObjectId; // For picking

// Section plane clipping
bool applySectionPlanes(vec3 worldPos) {
  for (int i = 0; i < u_sectionPlaneCount; i++) {
    float dist = dot(u_sectionPlanes[i].xyz, worldPos) + u_sectionPlanes[i].w;
    if (dist < 0.0) {
      discard;
    }
  }
  return true;
}

// PBR lighting (simplified from WebGPU version)
vec3 calculatePBR(vec3 baseColor, vec3 N, vec3 V, vec3 L) {
  vec3 H = normalize(V + L);
  
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  
  // Fresnel (Schlick approximation)
  vec3 F0 = mix(vec3(0.04), baseColor, u_metallic);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
  
  // Distribution (GGX)
  float roughness2 = u_roughness * u_roughness;
  float denom = NdotH * NdotH * (roughness2 - 1.0) + 1.0;
  float D = roughness2 / (3.14159265 * denom * denom);
  
  // Geometry (Smith GGX)
  float k = (u_roughness + 1.0) * (u_roughness + 1.0) / 8.0;
  float G1_V = NdotV / (NdotV * (1.0 - k) + k);
  float G1_L = NdotL / (NdotL * (1.0 - k) + k);
  float G = G1_V * G1_L;
  
  // Specular BRDF
  vec3 specular = (D * F * G) / (4.0 * NdotV * NdotL + 0.001);
  
  // Diffuse
  float kD = (1.0 - F.x) * (1.0 - u_metallic);
  vec3 diffuse = kD * baseColor / 3.14159265;
  
  // Final color
  vec3 color = u_ambientColor * baseColor + 
               (diffuse + specular) * u_lightColor * NdotL;
  
  return color;
}

// Encode normal to 2D (octahedron encoding)
vec2 encodeNormal(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.z < 0.0) {
    n.xy = (1.0 - abs(n.yx)) * (n.xy >= 0.0 ? 1.0 : -1.0);
  }
  return n.xy * 0.5 + 0.5;
}

void main() {
  // Section plane clipping
  if (!applySectionPlanes(v_worldPosition)) {
    discard;
  }
  
  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPosition - v_worldPosition);
  vec3 L = normalize(-u_lightDirection);
  
  vec3 baseColor = v_color.rgb;
  vec3 color = calculatePBR(baseColor, N, V, L);
  
  // Tone mapping (ACES approximation)
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2)); // Gamma correction
  
  fragColor = vec4(color, v_color.a);
  fragNormal = encodeNormal(N);
  fragObjectId = v_objectId;
}
```

### Feature Detection Strategy

```typescript
/**
 * WebGL2 feature detection and capability tier.
 */
class WebGL2FeatureDetector {
  private gl: WebGL2RenderingContext;
  private extensions: Map<string, any> = new Map();
  private tier: 'high' | 'medium' | 'low' = 'low';
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.detectExtensions();
    this.determineTier();
  }
  
  /**
   * Detect available extensions.
   */
  private detectExtensions(): void {
    const extensionNames = [
      'ANGLE_instanced_arrays',
      'EXT_color_buffer_float',
      'OES_texture_float_linear',
      'EXT_texture_filter_anisotropic',
      'WEBGL_depth_texture',
      'OES_element_index_uint',
    ];
    
    for (const name of extensionNames) {
      const ext = this.gl.getExtension(name);
      if (ext) {
        this.extensions.set(name, ext);
      }
    }
  }
  
  /**
   * Determine capability tier.
   */
  private determineTier(): void {
    let score = 0;
    
    // Instancing support
    if (this.extensions.has('ANGLE_instanced_arrays')) score += 20;
    
    // Float texture support (for HDR)
    if (this.extensions.has('EXT_color_buffer_float')) score += 15;
    if (this.extensions.has('OES_texture_float_linear')) score += 10;
    
    // Anisotropic filtering
    if (this.extensions.has('EXT_texture_filter_anisotropic')) score += 5;
    
    // Depth texture (for shadows)
    if (this.extensions.has('WEBGL_depth_texture')) score += 10;
    
    // Large index buffers
    if (this.extensions.has('OES_element_index_uint')) score += 5;
    
    // Max texture size
    const maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    if (maxTextureSize >= 8192) score += 10;
    if (maxTextureSize >= 16384) score += 10;
    
    // Max vertex attributes
    const maxAttribs = this.gl.getParameter(this.gl.MAX_VERTEX_ATTRIBS);
    if (maxAttribs >= 16) score += 5;
    
    // Determine tier
    if (score >= 60) {
      this.tier = 'high';
    } else if (score >= 30) {
      this.tier = 'medium';
    } else {
      this.tier = 'low';
    }
  }
  
  /**
   * Check if extension is available.
   */
  hasExtension(name: string): boolean {
    return this.extensions.has(name);
  }
  
  /**
   * Get capability tier.
   */
  getCapabilityTier(): 'high' | 'medium' | 'low' {
    return this.tier;
  }
  
  /**
   * Get feature capability matrix.
   */
  getFeatureMatrix(): FeatureCapabilityMatrix {
    return {
      instancing: this.extensions.has('ANGLE_instanced_arrays'),
      floatTextures: this.extensions.has('EXT_color_buffer_float'),
      floatTextureLinear: this.extensions.has('OES_texture_float_linear'),
      anisotropicFiltering: this.extensions.has('EXT_texture_filter_anisotropic'),
      depthTexture: this.extensions.has('WEBGL_depth_texture'),
      uintIndices: this.extensions.has('OES_element_index_uint'),
      maxTextureSize: this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE),
      maxVertexAttribs: this.gl.getParameter(this.gl.MAX_VERTEX_ATTRIBS),
      tier: this.tier,
    };
  }
}

interface FeatureCapabilityMatrix {
  instancing: boolean;
  floatTextures: boolean;
  floatTextureLinear: boolean;
  anisotropicFiltering: boolean;
  depthTexture: boolean;
  uintIndices: boolean;
  maxTextureSize: number;
  maxVertexAttribs: number;
  tier: 'high' | 'medium' | 'low';
}
```

### Graceful Degradation Path

```typescript
/**
 * Renderer selection with graceful degradation.
 */
class RendererSelector {
  
  /**
   * Select best available renderer with fallback chain.
   */
  static async selectRenderer(canvas: HTMLCanvasElement): Promise<IFCRenderer> {
    // Try WebGPU first
    if (await this.isWebGPUSupported()) {
      try {
        const renderer = new WebGPURenderer();
        await renderer.init(canvas);
        return renderer;
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to WebGL2:', e);
      }
    }
    
    // Try WebGL2 with extensions
    if (this.isWebGL2Supported()) {
      const gl = canvas.getContext('webgl2');
      if (gl) {
        const detector = new WebGL2FeatureDetector(gl);
        const tier = detector.getCapabilityTier();
        
        if (tier === 'high' || tier === 'medium') {
          const renderer = new WebGL2Renderer();
          await renderer.init(canvas);
          renderer.setCapabilityTier(tier);
          return renderer;
        }
      }
    }
    
    // Try basic WebGL2 (no extensions)
    if (this.isWebGL2Supported()) {
      const renderer = new WebGL2Renderer();
      await renderer.init(canvas);
      renderer.setCapabilityTier('low');
      return renderer;
    }
    
    throw new Error('No supported renderer available');
  }
  
  /**
   * Get performance expectations for renderer tier.
   */
  static getPerformanceExpectations(tier: 'high' | 'medium' | 'low'): PerformanceExpectations {
    return {
      high: {
        maxTriangles: 10_000_000,
        targetFPS: 60,
        frustumCullingTimeMs: 1,
        pickingLatencyMs: 16,
      },
      medium: {
        maxTriangles: 5_000_000,
        targetFPS: 45,
        frustumCullingTimeMs: 5,
        pickingLatencyMs: 50,
      },
      low: {
        maxTriangles: 1_000_000,
        targetFPS: 30,
        frustumCullingTimeMs: 10,
        pickingLatencyMs: 100,
      },
    }[tier];
  }
  
  private static async isWebGPUSupported(): Promise<boolean> {
    return 'gpu' in navigator && navigator.gpu !== undefined;
  }
  
  private static isWebGL2Supported(): boolean {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  }
}

interface PerformanceExpectations {
  maxTriangles: number;
  targetFPS: number;
  frustumCullingTimeMs: number;
  pickingLatencyMs: number;
}
```

### Feature Polyfills

```typescript
/**
 * Polyfills for missing WebGL2 features.
 */
class WebGL2Polyfills {
  
  /**
   * Polyfill instanced arrays if extension unavailable.
   */
  static polyfillInstancedArrays(gl: WebGL2RenderingContext): InstancedArraysPolyfill {
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    
    if (ext) {
      // Native support
      return {
        vertexAttribDivisor: (index, divisor) => ext.vertexAttribDivisorANGLE(index, divisor),
        drawArraysInstanced: (mode, first, count, instanceCount) => 
          ext.drawArraysInstancedANGLE(mode, first, count, instanceCount),
        drawElementsInstanced: (mode, count, type, offset, instanceCount) =>
          ext.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount),
      };
    }
    
    // Fallback: manual instancing (multiple draw calls)
    return {
      vertexAttribDivisor: () => {}, // No-op
      drawArraysInstanced: (mode, first, count, instanceCount) => {
        for (let i = 0; i < instanceCount; i++) {
          gl.drawArrays(mode, first, count);
        }
      },
      drawElementsInstanced: (mode, count, type, offset, instanceCount) => {
        for (let i = 0; i < instanceCount; i++) {
          gl.drawElements(mode, count, type, offset);
        }
      },
    };
  }
  
  /**
   * Polyfill float textures (use half-float or RGBA8).
   */
  static polyfillFloatTextures(gl: WebGL2RenderingContext): TextureFormatPolyfill {
    const floatExt = gl.getExtension('EXT_color_buffer_float');
    
    if (floatExt) {
      return {
        internalFormat: gl.RGBA32F,
        format: gl.RGBA,
        type: gl.FLOAT,
        supported: true,
      };
    }
    
    // Fallback to half-float
    const halfFloatExt = gl.getExtension('OES_texture_half_float');
    if (halfFloatExt) {
      return {
        internalFormat: gl.RGBA,
        format: gl.RGBA,
        type: halfFloatExt.HALF_FLOAT_OES,
        supported: true,
      };
    }
    
    // Final fallback: RGBA8 (clamp values)
    return {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      supported: false, // Limited precision
    };
  }
}

interface InstancedArraysPolyfill {
  vertexAttribDivisor: (index: number, divisor: number) => void;
  drawArraysInstanced: (mode: number, first: number, count: number, instanceCount: number) => void;
  drawElementsInstanced: (mode: number, count: number, type: number, offset: number, instanceCount: number) => void;
}

interface TextureFormatPolyfill {
  internalFormat: number;
  format: number;
  type: number;
  supported: boolean;
}
```

---

## 10.8 LOD Generation Priority Strategy

### The Problem

LOD generation is CPU-intensive:
- 10K meshes × 50ms = 500 seconds
- Can't block main thread
- User needs to navigate before LODs are ready

### Solution: Phased LOD Generation

```typescript
/**
 * Priority-based LOD generation manager.
 */
class LODGenerationManager {
  private queue: PriorityQueue<LODJob>;
  private workerPool: WorkerPool;
  private generated: Set<number> = new Set();
  private inProgress: Set<number> = new Set();
  
  /**
   * Schedule LOD generation with priority.
   */
  scheduleLODGeneration(
    mesh: ColumnarMesh,
    priority: LODPriority
  ): void {
    if (this.generated.has(mesh.expressId)) return;
    if (this.inProgress.has(mesh.expressId)) return;
    
    const job: LODJob = {
      expressId: mesh.expressId,
      mesh,
      priority: this.calculatePriority(mesh, priority),
      urgency: this.determineUrgency(mesh, priority),
      triangleCount: mesh.indices.length / 3,
    };
    
    this.queue.enqueue(job);
  }
  
  /**
   * Calculate generation priority.
   */
  private calculatePriority(
    mesh: ColumnarMesh,
    basePriority: LODPriority
  ): number {
    let priority = basePriority === 'high' ? 1000 : basePriority === 'medium' ? 500 : 100;
    
    // Larger meshes benefit more from LOD
    priority += Math.min(mesh.indices.length / 3 / 1000, 500);
    
    // Closer to camera = higher priority
    const distance = this.estimateDistance(mesh.bounds);
    priority += Math.max(0, 1000 - distance);
    
    // Screen-space size
    const screenSize = this.estimateScreenSize(mesh.bounds);
    priority += Math.min(screenSize, 500);
    
    return priority;
  }
  
  /**
   * Determine urgency level.
   */
  private determineUrgency(
    mesh: ColumnarMesh,
    basePriority: LODPriority
  ): 'immediate' | 'soon' | 'background' {
    if (basePriority === 'high') return 'immediate';
    
    const screenSize = this.estimateScreenSize(mesh.bounds);
    if (screenSize > 100) return 'soon';
    if (screenSize > 10) return 'soon';
    
    return 'background';
  }
  
  /**
   * Process LOD generation queue.
   */
  async processQueue(): Promise<void> {
    // Phase 1: Immediate (during load, skip entirely)
    // Phase 2: After first paint (generate visible large objects)
    // Phase 3: Background (generate remaining)
    
    const phase = this.getCurrentPhase();
    
    switch (phase) {
      case 'loading':
        // Skip LOD generation during load
        return;
        
      case 'post-paint':
        await this.processUrgent('immediate');
        await this.processUrgent('soon');
        break;
        
      case 'background':
        await this.processAll();
        break;
    }
  }
  
  /**
   * Process jobs of specific urgency.
   */
  private async processUrgent(urgency: 'immediate' | 'soon'): Promise<void> {
    const jobs = this.queue.dequeueMany(job => job.urgency === urgency);
    
    for (const job of jobs) {
      this.inProgress.add(job.expressId);
      
      try {
        const lods = await this.workerPool.submit('generate-lod', {
          mesh: job.mesh,
          config: this.getLODConfig(job.mesh),
        });
        
        this.onLODGenerated(job.expressId, lods);
        this.generated.add(job.expressId);
      } catch (e) {
        console.error(`LOD generation failed for #${job.expressId}:`, e);
      } finally {
        this.inProgress.delete(job.expressId);
      }
      
      // Yield to UI thread periodically
      if (performance.now() % 16 < 1) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }
  
  /**
   * Get current generation phase.
   */
  private getCurrentPhase(): 'loading' | 'post-paint' | 'background' {
    // Implementation: track loading state, first paint, etc.
    return 'background';
  }
}

interface LODJob {
  expressId: number;
  mesh: ColumnarMesh;
  priority: number;
  urgency: 'immediate' | 'soon' | 'background';
  triangleCount: number;
}

type LODPriority = 'high' | 'medium' | 'low';
```

### Generation Timing Strategy

```typescript
/**
 * LOD generation timing phases.
 */
class LODTimingStrategy {
  
  /**
   * Phase 1: During load - skip entirely.
   */
  phase1_Loading(): LODStrategy {
    return {
      generateLODs: false,
      useFullMeshes: true,
      maxTriangles: Infinity, // No limit
    };
  }
  
  /**
   * Phase 2: After first paint - generate visible large objects.
   */
  phase2_PostPaint(visibleMeshes: ColumnarMesh[]): LODStrategy {
    // Sort by screen size (largest first)
    const sorted = visibleMeshes.sort((a, b) => {
      const sizeA = this.estimateScreenSize(a.bounds);
      const sizeB = this.estimateScreenSize(b.bounds);
      return sizeB - sizeA;
    });
    
    // Generate LODs for top 100 largest visible meshes
    const targetMeshes = sorted.slice(0, 100);
    
    return {
      generateLODs: true,
      targetMeshes,
      maxTimeMs: 5000, // 5 seconds
      useFullMeshes: true, // Fallback to full until LOD ready
    };
  }
  
  /**
   * Phase 3: Background - generate remaining.
   */
  phase3_Background(): LODStrategy {
    return {
      generateLODs: true,
      pauseDuringNavigation: true, // Don't generate while user moves camera
      lowPriority: true,
      maxTimePerFrameMs: 16, // One frame budget
    };
  }
}

interface LODStrategy {
  generateLODs: boolean;
  useFullMeshes?: boolean;
  targetMeshes?: ColumnarMesh[];
  maxTimeMs?: number;
  maxTimePerFrameMs?: number;
  pauseDuringNavigation?: boolean;
  lowPriority?: boolean;
  maxTriangles?: number;
}
```

### Acceptable Degradation

```typescript
/**
 * Handle missing LODs gracefully.
 */
class LODFallbackManager {
  
  /**
   * Get mesh to render (LOD if available, full otherwise).
   */
  getMeshForRendering(
    expressId: number,
    screenSize: number,
    lods: Map<number, LODMeshSet>
  ): ColumnarMesh {
    const lodSet = lods.get(expressId);
    
    if (!lodSet) {
      // No LODs generated yet - use full mesh
      return this.getFullMesh(expressId);
    }
    
    // Select appropriate LOD level
    const lodLevel = this.selectLODLevel(screenSize, lodSet);
    
    if (lodLevel === 0) {
      // Use full resolution
      return this.getFullMesh(expressId);
    }
    
    // Use LOD mesh
    const lodMesh = lodSet.lods.find(l => l.level === lodLevel);
    if (!lodMesh) {
      // LOD not ready - use full mesh
      return this.getFullMesh(expressId);
    }
    
    return lodMesh.mesh;
  }
  
  /**
   * Select LOD level based on screen size.
   */
  private selectLODLevel(screenSize: number, lodSet: LODMeshSet): number {
    const thresholds = lodSet.config.thresholds;
    
    if (screenSize > thresholds[0]) return 0; // Full
    if (screenSize > thresholds[1]) return 1; // LOD1
    if (screenSize > thresholds[2]) return 2; // LOD2
    return 3; // Proxy
  }
  
  /**
   * Use bounding box placeholder for very small objects.
   */
  getPlaceholderMesh(expressId: number, bounds: AABB): ColumnarMesh {
    // Generate simple box mesh
    return this.generateBoxMesh(bounds);
  }
}
```

### Performance Monitoring

```typescript
/**
 * Track LOD generation performance.
 */
class LODPerformanceMonitor {
  private stats: LODStats = {
    totalMeshes: 0,
    generatedLODs: 0,
    skippedMeshes: 0,
    averageGenerationTimeMs: 0,
    totalGenerationTimeMs: 0,
  };
  
  recordGeneration(expressId: number, timeMs: number): void {
    this.stats.generatedLODs++;
    this.stats.totalGenerationTimeMs += timeMs;
    this.stats.averageGenerationTimeMs = 
      this.stats.totalGenerationTimeMs / this.stats.generatedLODs;
  }
  
  recordSkip(expressId: number, reason: string): void {
    this.stats.skippedMeshes++;
  }
  
  getStats(): LODStats {
    return { ...this.stats };
  }
}

interface LODStats {
  totalMeshes: number;
  generatedLODs: number;
  skippedMeshes: number;
  averageGenerationTimeMs: number;
  totalGenerationTimeMs: number;
}
```

---

## Summary

This document addresses the remaining technical gaps:

| Issue | Solution | Status |
|-------|----------|--------|
| **Performance Targets** | Tiered expectations (Tier 1/2/3) | ✅ Complete |
| **Memory Budgets** | Component-based calculator, device tiers | ✅ Complete |
| **DuckDB Loading** | Lazy load-on-demand, native fallback | ✅ Complete |
| **Data Versioning** | Schema versioning, migration system | ✅ Complete |
| **Complex Properties** | Extended property table, full type support | ✅ Complete |
| **IFC Compatibility** | Version normalization, entity mapping | ✅ Complete |
| **Renderer Abstraction** | Common interface, WebGPU/WebGL2 | ✅ Complete |
| **LOD Priority** | Phased generation, acceptable degradation | ✅ Complete |

All solutions include detailed implementation code, fallback strategies, and performance considerations.

---

*This document completes the technical specification. Together with Parts 1-9, it provides a comprehensive foundation for implementing IFC-Lite.*
