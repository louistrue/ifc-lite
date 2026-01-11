/**
 * DuckDB-WASM integration for SQL queries
 * Lazy-loaded to avoid adding ~4MB to bundle unless needed
 */

import type { IfcDataStore } from '@ifc-lite/parser';

export interface SQLResult {
  columns: string[];
  rows: any[][];
  toArray(): any[];
  toJSON(): any[];
}

export class DuckDBIntegration {
  private db: any = null;
  private conn: any = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  
  /**
   * Initialize DuckDB (lazy-loaded)
   */
  async init(store: IfcDataStore): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      try {
        // Dynamic import using Function constructor to prevent Vite static analysis
        // DuckDB is optional - this will fail gracefully if not installed
        // @ts-ignore - DuckDB is optional dependency
        const duckdb = await new Function('return import("@duckdb/duckdb-wasm")')();
        // @ts-ignore
        const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
        
        const worker = new Worker(bundle.mainWorker!);
        // @ts-ignore
        this.db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
        await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        this.conn = await this.db.connect();
        
        await this.registerTables(store);
        await this.createViews();
        
        this.initialized = true;
      } catch (error) {
        throw new Error(`Failed to initialize DuckDB: ${error}`);
      }
    })();
    
    return this.initPromise;
  }
  
  /**
   * Execute SQL query
   */
  async query(sql: string): Promise<SQLResult> {
    if (!this.initialized) {
      throw new Error('DuckDB not initialized. Call init() first.');
    }
    
    const result = await this.conn.query(sql);
    
    return {
      columns: result.schema.fields.map((f: any) => f.name),
      rows: result.toArray(),
      toArray: () => result.toArray(),
      toJSON: () => result.toArray().map((row: any[]) => {
        const obj: any = {};
        result.schema.fields.forEach((field: any, i: number) => {
          obj[field.name] = row[i];
        });
        return obj;
      }),
    };
  }
  
  /**
   * Register tables from columnar store
   */
  private async registerTables(store: IfcDataStore): Promise<void> {
    // Convert columnar data to Arrow format for DuckDB
    // This is a simplified version - full implementation would use apache-arrow
    
    // Note: Full implementation would use Arrow IPC format
    // For now, this is a placeholder that shows the structure
    console.log('[DuckDB] Would register entities table with', store.entities.count, 'rows');
    // TODO: Implement Arrow table registration
    void store;
  }
  
  /**
   * Create convenience views
   */
  private async createViews(): Promise<void> {
    try {
      await this.conn.query(`
        CREATE VIEW IF NOT EXISTS walls AS 
        SELECT * FROM entities WHERE type IN ('IfcWall', 'IfcWallStandardCase')
      `);
      
      await this.conn.query(`
        CREATE VIEW IF NOT EXISTS doors AS 
        SELECT * FROM entities WHERE type = 'IfcDoor'
      `);
      
      await this.conn.query(`
        CREATE VIEW IF NOT EXISTS windows AS 
        SELECT * FROM entities WHERE type = 'IfcWindow'
      `);
    } catch (error) {
      // Views may fail if tables aren't registered yet - that's OK
      console.warn('[DuckDB] Could not create views:', error);
    }
  }
  
  /**
   * Check if DuckDB is available
   */
  static async isAvailable(): Promise<boolean> {
    try {
      // Dynamic import using Function constructor to prevent Vite static analysis
      // @ts-ignore - DuckDB is optional dependency
      await new Function('return import("@duckdb/duckdb-wasm")')();
      return true;
    } catch {
      return false;
    }
  }
}
