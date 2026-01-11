/**
 * Main query interface - provides multiple access patterns
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { IfcTypeEnumFromString } from '@ifc-lite/data';
import { EntityQuery } from './entity-query.js';
import { EntityNode } from './entity-node.js';
import { DuckDBIntegration, type SQLResult } from './duckdb-integration.js';

export class IfcQuery {
  private store: IfcDataStore;
  private duckdb: DuckDBIntegration | null = null;
  
  constructor(store: IfcDataStore) {
    this.store = store;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SQL API - Full SQL power via DuckDB-WASM
  // ═══════════════════════════════════════════════════════════════
  
  async sql(query: string): Promise<SQLResult> {
    await this.ensureDuckDB();
    return this.duckdb!.query(query);
  }
  
  private async ensureDuckDB(): Promise<void> {
    if (!this.duckdb) {
      const available = await DuckDBIntegration.isAvailable();
      if (!available) {
        throw new Error('DuckDB-WASM is not available. Install @duckdb/duckdb-wasm to use SQL queries.');
      }
      this.duckdb = new DuckDBIntegration();
      await this.duckdb.init(this.store);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // FLUENT API - Type-safe query builder
  // ═══════════════════════════════════════════════════════════════
  
  walls(): EntityQuery {
    return this.ofType('IfcWall', 'IfcWallStandardCase');
  }
  
  doors(): EntityQuery {
    return this.ofType('IfcDoor');
  }
  
  windows(): EntityQuery {
    return this.ofType('IfcWindow');
  }
  
  slabs(): EntityQuery {
    return this.ofType('IfcSlab');
  }
  
  columns(): EntityQuery {
    return this.ofType('IfcColumn');
  }
  
  beams(): EntityQuery {
    return this.ofType('IfcBeam');
  }
  
  spaces(): EntityQuery {
    return this.ofType('IfcSpace');
  }
  
  ofType(...types: string[]): EntityQuery {
    const typeEnums = types.map(t => IfcTypeEnumFromString(t));
    return new EntityQuery(this.store, typeEnums);
  }
  
  all(): EntityQuery {
    return new EntityQuery(this.store, null);
  }
  
  byId(expressId: number): EntityQuery {
    return new EntityQuery(this.store, null, [expressId]);
  }

  // ═══════════════════════════════════════════════════════════════
  // GRAPH API - Relationship traversal
  // ═══════════════════════════════════════════════════════════════
  
  entity(expressId: number): EntityNode {
    return new EntityNode(this.store, expressId);
  }
}
