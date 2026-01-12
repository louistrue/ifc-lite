/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * JSON-LD exporter for semantic web compatibility
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { PropertyValue } from '@ifc-lite/data';

const DEFAULT_CONTEXT = 'https://standards.buildingsmart.org/IFC/DEV/IFC4/ADD2/OWL';

export interface JSONLDExportOptions {
  context?: string;
  includeGeometry?: boolean;
  includeProperties?: boolean;
  includeQuantities?: boolean;
  entityIds?: number[];
}

export class JSONLDExporter {
  private store: IfcDataStore;

  constructor(store: IfcDataStore) {
    this.store = store;
  }

  /**
   * Export to JSON-LD format
   */
  export(options: JSONLDExportOptions = {}): object {
    const context = options.context ?? DEFAULT_CONTEXT;
    const includeProperties = options.includeProperties ?? true;
    const includeQuantities = options.includeQuantities ?? false;
    const entityIds = options.entityIds ?? this.getAllEntityIds();

    const graph: any[] = [];

    for (const id of entityIds) {
      const node: any = {
        '@id': `ifc:${id}`,
        '@type': `ifc:${this.store.entities.getTypeName(id)}`,
        'ifc:expressId': id,
      };

      const globalId = this.store.entities.getGlobalId(id);
      if (globalId) {
        node['ifc:globalId'] = globalId;
      }

      const name = this.store.entities.getName(id);
      if (name) {
        node['ifc:name'] = name;
      }

      if (includeProperties) {
        const properties = this.store.properties.getForEntity(id);
        if (properties.length > 0) {
          const propertySets: any[] = [];
          for (const pset of properties) {
            const psetNode: any = {
              '@type': 'ifc:IfcPropertySet',
              'ifc:name': pset.name,
            };

            if (pset.globalId) {
              psetNode['ifc:globalId'] = pset.globalId;
            }

            const props: any[] = [];
            for (const prop of pset.properties) {
              const propNode: any = {
                '@type': `ifc:${this.getPropertyTypeName(prop.type)}`,
                'ifc:name': prop.name,
              };

              const value = this.formatPropertyValue(prop.value);
              if (value !== null) {
                propNode['ifc:nominalValue'] = value;
              }

              if (prop.unit) {
                propNode['ifc:unit'] = prop.unit;
              }

              props.push(propNode);
            }

            if (props.length > 0) {
              psetNode['ifc:hasProperties'] = props;
            }

            propertySets.push(psetNode);
          }

          if (propertySets.length > 0) {
            node['ifc:hasPropertySets'] = propertySets;
          }
        }
      }

      if (includeQuantities && this.store.quantities) {
        const quantities = this.store.quantities.getForEntity(id);
        if (quantities.length > 0) {
          const quantitySets: any[] = [];
          for (const qset of quantities) {
            const qsetNode: any = {
              '@type': 'ifc:IfcElementQuantity',
              'ifc:name': qset.name,
            };

            const quants: any[] = [];
            for (const quant of qset.quantities) {
              const quantNode: any = {
                '@type': `ifc:${this.getQuantityTypeName(quant.type)}`,
                'ifc:name': quant.name,
                'ifc:value': quant.value,
              };

              if (quant.unit) {
                quantNode['ifc:unit'] = quant.unit;
              }

              if (quant.formula) {
                quantNode['ifc:formula'] = quant.formula;
              }

              quants.push(quantNode);
            }

            if (quants.length > 0) {
              qsetNode['ifc:quantities'] = quants;
            }

            quantitySets.push(qsetNode);
          }

          if (quantitySets.length > 0) {
            node['ifc:hasQuantitySets'] = quantitySets;
          }
        }
      }

      graph.push(node);
    }

    return {
      '@context': {
        '@vocab': context + '#',
        'ifc': context + '#',
      },
      '@graph': graph,
    };
  }

  /**
   * Get all entity IDs from the store
   */
  private getAllEntityIds(): number[] {
    const ids: number[] = [];
    for (let i = 0; i < this.store.entities.count; i++) {
      ids.push(this.store.entities.expressId[i]);
    }
    return ids;
  }

  /**
   * Format property value for JSON-LD
   */
  private formatPropertyValue(value: PropertyValue): any {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.map(v => this.formatPropertyValue(v));
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  }

  /**
   * Get property type name from enum
   */
  private getPropertyTypeName(type: number): string {
    const typeNames: Record<number, string> = {
      0: 'IfcPropertySingleValue',
      1: 'IfcPropertySingleValue',
      2: 'IfcPropertyEnumeratedValue',
      3: 'IfcPropertyBoundedValue',
      4: 'IfcPropertyListValue',
    };
    return typeNames[type] ?? 'IfcPropertySingleValue';
  }

  /**
   * Get quantity type name from enum
   */
  private getQuantityTypeName(type: number): string {
    const typeNames: Record<number, string> = {
      0: 'IfcQuantityLength',
      1: 'IfcQuantityArea',
      2: 'IfcQuantityVolume',
      3: 'IfcQuantityCount',
      4: 'IfcQuantityWeight',
      5: 'IfcQuantityTime',
    };
    return typeNames[type] ?? 'IfcQuantityLength';
  }
}
