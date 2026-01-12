/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Fluent query API builder
 */

import type { IfcEntity } from '@ifc-lite/parser';
import { EntityTable } from './entity-table.js';
import { PropertyTable } from './property-table.js';

export class QueryBuilder {
    private entityTable: EntityTable;
    private propertyTable: PropertyTable;
    private currentFilter: (entity: IfcEntity) => boolean;

    constructor(entityTable: EntityTable, propertyTable: PropertyTable) {
        this.entityTable = entityTable;
        this.propertyTable = propertyTable;
        this.currentFilter = () => true;
    }

    /**
     * Filter by entity type
     */
    ofType(type: string): this {
        const previousFilter = this.currentFilter;
        this.currentFilter = (entity) => previousFilter(entity) && entity.type === type;
        return this;
    }

    /**
     * Filter by property value
     */
    withProperty(propertySetName: string, propertyName: string, value?: any): this {
        const previousFilter = this.currentFilter;
        if (value !== undefined) {
            this.currentFilter = (entity) => {
                if (!previousFilter(entity)) return false;
                const prop = this.propertyTable.getProperty(entity.expressId, propertySetName, propertyName);
                return prop !== null && prop.value === value;
            };
        } else {
            this.currentFilter = (entity) => {
                if (!previousFilter(entity)) return false;
                const prop = this.propertyTable.getProperty(entity.expressId, propertySetName, propertyName);
                return prop !== null;
            };
        }
        return this;
    }

    /**
     * Execute query
     */
    execute(): IfcEntity[] {
        const allEntities = this.entityTable.getAllEntities();
        return allEntities.filter(this.currentFilter);
    }
}

/**
 * Query interface
 */
export class QueryInterface {
    private entityTable: EntityTable;
    private propertyTable: PropertyTable;

    constructor(entityTable: EntityTable, propertyTable: PropertyTable) {
        this.entityTable = entityTable;
        this.propertyTable = propertyTable;
    }

    /**
     * Start a new query
     */
    query(): QueryBuilder {
        return new QueryBuilder(this.entityTable, this.propertyTable);
    }

    /**
     * Get entity by ID
     */
    getEntity(id: number): IfcEntity | null {
        return this.entityTable.getEntity(id);
    }

    /**
     * Get properties for entity
     */
    getProperties(entityId: number): Map<string, any> {
        return this.propertyTable.getProperties(entityId);
    }
}
