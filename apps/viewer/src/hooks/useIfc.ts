/**
 * Hook for loading and processing IFC files
 */

import { useMemo, useCallback, useRef } from 'react';
import { useViewerStore } from '../store.js';
import { IfcParser } from '@ifc-lite/parser';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { EntityTable, PropertyTable, QueryInterface } from '@ifc-lite/query';

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

  // Track if we've already logged for this parseResult
  const lastLoggedParseResultRef = useRef<typeof parseResult>(null);

  const loadFile = useCallback(async (file: File) => {
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
  }, [setLoading, setError, setProgress, setParseResult, setGeometryResult]);

  // Memoize queryInterface to prevent recreation on every render
  const queryInterface = useMemo(() => {
    if (!parseResult) return null;

    const propertyTable = new PropertyTable();

    // Only log once per parseResult
    const shouldLog = lastLoggedParseResultRef.current !== parseResult;
    if (shouldLog) {
      lastLoggedParseResultRef.current = parseResult;
      console.log('[useIfc] Property sets count:', parseResult.propertySets.size);
    }

    // Add property sets
    for (const [id, pset] of parseResult.propertySets) {
      propertyTable.addPropertySet(id, pset);
    }

    // Associate property sets with entities via relationships
    let associationCount = 0;
    for (const rel of parseResult.relationships) {
      if (rel.type.toUpperCase() === 'IFCRELDEFINESBYPROPERTIES' && rel.relatingObject !== null) {
        const propertySetId = rel.relatingObject;
        for (const entityId of rel.relatedObjects) {
          propertyTable.associatePropertySet(entityId, propertySetId);
          associationCount++;
        }
      }
    }

    if (shouldLog) {
      console.log('[useIfc] IfcRelDefinesByProperties count:', parseResult.relationships.filter(
        rel => rel.type.toUpperCase() === 'IFCRELDEFINESBYPROPERTIES'
      ).length);
      console.log('[useIfc] Property associations created:', associationCount);
    }

    return new QueryInterface(
      new EntityTable(parseResult.entities, parseResult.entityIndex),
      propertyTable
    );
  }, [parseResult]);

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
