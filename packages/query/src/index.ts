/**
 * @ifc-lite/query - Query system
 */

export { PropertyTable } from './property-table.js';
export { EntityTable } from './entity-table.js';
export { QueryBuilder, QueryInterface } from './fluent-api.js';
export { IfcQuery } from './ifc-query.js';
export { EntityQuery, type ComparisonOperator } from './entity-query.js';
export { EntityNode } from './entity-node.js';
export { QueryResultEntity } from './query-result-entity.js';
export { DuckDBIntegration, type SQLResult } from './duckdb-integration.js';
