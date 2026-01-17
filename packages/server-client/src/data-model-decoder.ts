/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Decode Parquet-encoded data model from server.
 */

import { ensureParquetInit } from './parquet-decoder';

export interface EntityMetadata {
  entity_id: number;
  type_name: string;
  global_id?: string;
  name?: string;
  has_geometry: boolean;
}

export interface Property {
  property_name: string;
  property_value: string;
  property_type: string;
}

export interface PropertySet {
  pset_id: number;
  pset_name: string;
  properties: Property[];
}

export interface Relationship {
  rel_type: string;
  relating_id: number;
  related_id: number;
}

export interface SpatialNode {
  entity_id: number;
  parent_id: number;
  level: number;
  path: string;
  type_name: string;
  name?: string;
  elevation?: number;
  children_ids: number[];
  element_ids: number[];
}

export interface SpatialHierarchy {
  nodes: SpatialNode[];
  project_id: number;
  element_to_storey: Map<number, number>;
  element_to_building: Map<number, number>;
  element_to_site: Map<number, number>;
  element_to_space: Map<number, number>;
}

export interface DataModel {
  entities: Map<number, EntityMetadata>;
  propertySets: Map<number, PropertySet>;
  relationships: Relationship[];
  spatialHierarchy: SpatialHierarchy;
}

/**
 * Decode data model from Parquet buffer.
 * 
 * Format: [entities_len][entities_data][properties_len][properties_data][relationships_len][relationships_data][spatial_len][spatial_data]
 */
export async function decodeDataModel(data: ArrayBuffer): Promise<DataModel> {
  // Initialize WASM module (only runs once)
  const parquet = await ensureParquetInit();
  // @ts-ignore - Apache Arrow types
  const arrow = await import('apache-arrow');

  const view = new DataView(data);
  let offset = 0;

  // Read entities Parquet section
  const entitiesLen = view.getUint32(offset, true);
  offset += 4;
  const entitiesData = new Uint8Array(data, offset, entitiesLen);
  offset += entitiesLen;

  // Read properties Parquet section
  const propertiesLen = view.getUint32(offset, true);
  offset += 4;
  const propertiesData = new Uint8Array(data, offset, propertiesLen);
  offset += propertiesLen;

  // Read relationships Parquet section
  const relationshipsLen = view.getUint32(offset, true);
  offset += 4;
  const relationshipsData = new Uint8Array(data, offset, relationshipsLen);
  offset += relationshipsLen;

  // Read spatial Parquet section
  const spatialLen = view.getUint32(offset, true);
  offset += 4;
  const spatialData = new Uint8Array(data, offset, spatialLen);

  // Parse Parquet tables in parallel
  // @ts-ignore - parquet-wasm API
  const entitiesTable = parquet.readParquet(entitiesData);
  // @ts-ignore
  const propertiesTable = parquet.readParquet(propertiesData);
  // @ts-ignore
  const relationshipsTable = parquet.readParquet(relationshipsData);
  // Note: spatialData is a nested format, parsed separately below

  // Convert to Arrow tables
  // @ts-ignore
  const entitiesArrow = arrow.tableFromIPC(entitiesTable.intoIPCStream());
  // @ts-ignore
  const propertiesArrow = arrow.tableFromIPC(propertiesTable.intoIPCStream());
  // @ts-ignore
  const relationshipsArrow = arrow.tableFromIPC(relationshipsTable.intoIPCStream());

  // Extract entities
  const entityIds = entitiesArrow.getChild('entity_id')?.toArray() as Uint32Array;
  const entityTypeNames = entitiesArrow.getChild('type_name');
  const globalIds = entitiesArrow.getChild('global_id');
  const entityNames = entitiesArrow.getChild('name');
  const hasGeometry = entitiesArrow.getChild('has_geometry')?.toArray() as Uint8Array;

  const entities = new Map<number, EntityMetadata>();
  for (let i = 0; i < entityIds.length; i++) {
    entities.set(entityIds[i], {
      entity_id: entityIds[i],
      type_name: entityTypeNames?.get(i) ?? '',
      global_id: globalIds?.get(i) || undefined,
      name: entityNames?.get(i) || undefined,
      has_geometry: hasGeometry[i] !== 0,
    });
  }

  // Extract properties
  const psetIds = propertiesArrow.getChild('pset_id')?.toArray() as Uint32Array;
  const psetNames = propertiesArrow.getChild('pset_name');
  const propertyNames = propertiesArrow.getChild('property_name');
  const propertyValues = propertiesArrow.getChild('property_value');
  const propertyTypes = propertiesArrow.getChild('property_type');

  const propertySets = new Map<number, PropertySet>();
  for (let i = 0; i < psetIds.length; i++) {
    const psetId = psetIds[i];
    if (!propertySets.has(psetId)) {
      propertySets.set(psetId, {
        pset_id: psetId,
        pset_name: psetNames?.get(i) ?? '',
        properties: [],
      });
    }
    const pset = propertySets.get(psetId)!;
    pset.properties.push({
      property_name: propertyNames?.get(i) ?? '',
      property_value: propertyValues?.get(i) ?? '',
      property_type: propertyTypes?.get(i) ?? '',
    });
  }

  // Extract relationships
  const relTypes = relationshipsArrow.getChild('rel_type');
  const relatingIds = relationshipsArrow.getChild('relating_id')?.toArray() as Uint32Array;
  const relatedIds = relationshipsArrow.getChild('related_id')?.toArray() as Uint32Array;

  const relationships: Relationship[] = [];
  for (let i = 0; i < relatingIds.length; i++) {
    relationships.push({
      rel_type: relTypes?.get(i) ?? '',
      relating_id: relatingIds[i],
      related_id: relatedIds[i],
    });
  }

  // Parse spatial hierarchy - format: [nodes_len][nodes_data][element_to_storey_len][element_to_storey_data]...
  const spatialView = new DataView(spatialData.buffer, spatialData.byteOffset, spatialData.byteLength);
  let spatialOffset = 0;

  // Read nodes table
  const nodesLen = spatialView.getUint32(spatialOffset, true);
  spatialOffset += 4;
  const nodesData = new Uint8Array(spatialData.buffer, spatialData.byteOffset + spatialOffset, nodesLen);
  spatialOffset += nodesLen;

  // Read lookup tables
  const elementToStoreyLen = spatialView.getUint32(spatialOffset, true);
  spatialOffset += 4;
  const elementToStoreyData = new Uint8Array(spatialData.buffer, spatialData.byteOffset + spatialOffset, elementToStoreyLen);
  spatialOffset += elementToStoreyLen;

  const elementToBuildingLen = spatialView.getUint32(spatialOffset, true);
  spatialOffset += 4;
  const elementToBuildingData = new Uint8Array(spatialData.buffer, spatialData.byteOffset + spatialOffset, elementToBuildingLen);
  spatialOffset += elementToBuildingLen;

  const elementToSiteLen = spatialView.getUint32(spatialOffset, true);
  spatialOffset += 4;
  const elementToSiteData = new Uint8Array(spatialData.buffer, spatialData.byteOffset + spatialOffset, elementToSiteLen);
  spatialOffset += elementToSiteLen;

  const elementToSpaceLen = spatialView.getUint32(spatialOffset, true);
  spatialOffset += 4;
  const elementToSpaceData = new Uint8Array(spatialData.buffer, spatialData.byteOffset + spatialOffset, elementToSpaceLen);
  spatialOffset += elementToSpaceLen;

  // Read project_id (final u32)
  const projectId = spatialView.getUint32(spatialOffset, true);

  // Parse nodes Parquet table
  // @ts-ignore
  const nodesTable = parquet.readParquet(nodesData);
  // @ts-ignore
  const nodesArrow = arrow.tableFromIPC(nodesTable.intoIPCStream());

  const spatialEntityIds = nodesArrow.getChild('entity_id')?.toArray() as Uint32Array;
  const parentIds = nodesArrow.getChild('parent_id');
  const levels = nodesArrow.getChild('level')?.toArray() as Uint16Array;
  const paths = nodesArrow.getChild('path');
  const spatialTypeNames = nodesArrow.getChild('type_name');
  const spatialNames = nodesArrow.getChild('name');
  const elevations = nodesArrow.getChild('elevation');
  const childrenIdsList = nodesArrow.getChild('children_ids');
  const elementIdsList = nodesArrow.getChild('element_ids');

  const spatialNodes: SpatialNode[] = [];
  for (let i = 0; i < spatialEntityIds.length; i++) {
    // Parse list arrays for children_ids and element_ids
    // Arrow ListArray.get(i) returns a sub-array (Vector)
    let childrenIds: number[] = [];
    let elementIds: number[] = [];
    
    if (childrenIdsList) {
      const childrenVector = childrenIdsList.get(i);
      if (childrenVector) {
        childrenIds = Array.from(childrenVector.toArray() as Uint32Array);
      }
    }
    
    if (elementIdsList) {
      const elementVector = elementIdsList.get(i);
      if (elementVector) {
        elementIds = Array.from(elementVector.toArray() as Uint32Array);
      }
    }
    
    spatialNodes.push({
      entity_id: spatialEntityIds[i],
      parent_id: parentIds?.get(i) ?? 0,
      level: levels[i],
      path: paths?.get(i) ?? '',
      type_name: spatialTypeNames?.get(i) ?? '',
      name: spatialNames?.get(i) || undefined,
      elevation: elevations?.get(i) ?? undefined,
      children_ids: childrenIds,
      element_ids: elementIds,
    });
  }

  // Parse lookup tables
  const parseLookupTable = (data: Uint8Array): Map<number, number> => {
    // @ts-ignore
    const table = parquet.readParquet(data);
    // @ts-ignore
    const arrowTable = arrow.tableFromIPC(table.intoIPCStream());
    const elementIds = arrowTable.getChild('element_id')?.toArray() as Uint32Array;
    const spatialIds = arrowTable.getChild('spatial_id')?.toArray() as Uint32Array;
    const map = new Map<number, number>();
    for (let i = 0; i < elementIds.length; i++) {
      map.set(elementIds[i], spatialIds[i]);
    }
    return map;
  };

  const elementToStorey = parseLookupTable(elementToStoreyData);
  const elementToBuilding = parseLookupTable(elementToBuildingData);
  const elementToSite = parseLookupTable(elementToSiteData);
  const elementToSpace = parseLookupTable(elementToSpaceData);

  return {
    entities,
    propertySets,
    relationships,
    spatialHierarchy: {
      nodes: spatialNodes,
      project_id: projectId,
      element_to_storey: elementToStorey,
      element_to_building: elementToBuilding,
      element_to_site: elementToSite,
      element_to_space: elementToSpace,
    },
  };
}
