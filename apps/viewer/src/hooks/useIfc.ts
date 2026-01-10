/**
 * Hook for loading and processing IFC files
 */

import { useEffect } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser } from '@ifc-lite/parser';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { EntityTable, PropertyTable, QueryInterface } from '@ifc-lite/query';
import type { Relationship } from '@ifc-lite/parser';

export function useIfc() {
  const {
    loading,
    progress,
    error,
    parseResult,
    geometryResult,
    setLoading,
    setProgress,
    setError,
    setParseResult,
    setGeometryResult,
  } = useViewerStore();

  const loadFile = async (file: File) => {
    try {
      setLoading(true);
      setError(null);
      setProgress({ phase: 'Loading file', percent: 0 });

      // Read file
      const buffer = await file.arrayBuffer();
      setProgress({ phase: 'Parsing IFC', percent: 10 });

      // Parse IFC
      const parser = new IfcParser();
      const result = await parser.parse(buffer, {
        onProgress: (prog) => {
          setProgress({
            phase: `Parsing: ${prog.phase}`,
            percent: 10 + (prog.percent * 0.4),
          });
        },
      });

      setParseResult(result);
      setProgress({ phase: 'Triangulating geometry', percent: 50 });

      // Process geometry
      const geometryProcessor = new GeometryProcessor();
      await geometryProcessor.init();
      const geometry = await geometryProcessor.process(new Uint8Array(buffer));

      setGeometryResult(geometry);
      setProgress({ phase: 'Complete', percent: 100 });
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  const queryInterface = parseResult
    ? (() => {
        const propertyTable = new PropertyTable();
        
        // Add property sets
        for (const [id, pset] of parseResult.propertySets) {
          propertyTable.addPropertySet(id, pset);
        }
        
        // Associate property sets with entities via relationships
        for (const rel of parseResult.relationships) {
          if (rel.type === 'IfcRelDefinesByProperties' && rel.relatingObject !== null) {
            const propertySetId = rel.relatingObject;
            for (const entityId of rel.relatedObjects) {
              propertyTable.associatePropertySet(entityId, propertySetId);
            }
          }
        }
        
        return new QueryInterface(
          new EntityTable(parseResult.entities, parseResult.entityIndex),
          propertyTable
        );
      })()
    : null;

  return {
    loading,
    progress,
    error,
    parseResult,
    geometryResult,
    queryInterface,
    loadFile,
  };
}
