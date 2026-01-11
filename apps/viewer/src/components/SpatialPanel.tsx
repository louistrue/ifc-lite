/**
 * Spatial hierarchy panel - shows project/building/storey tree
 */

import { useMemo } from 'react';
import { useIfc } from '../hooks/useIfc.js';
import { useViewerStore } from '../store.js';

export function SpatialPanel() {
  const { ifcDataStore, query } = useIfc();
  const selectedStorey = useViewerStore((state) => state.selectedStorey);
  const setSelectedStorey = useViewerStore((state) => state.setSelectedStorey);

  const spatialData = useMemo(() => {
    if (!ifcDataStore?.spatialHierarchy) return null;
    
    const hierarchy = ifcDataStore.spatialHierarchy;
    const storeys: Array<{
      id: number;
      name: string;
      elevation: number | undefined;
      elementCount: number;
    }> = [];
    
    // Collect storeys with their element counts
    for (const [storeyId, elementIds] of hierarchy.byStorey) {
      const name = ifcDataStore.entities.getName(storeyId);
      const elevation = hierarchy.storeyElevations.get(storeyId);
      storeys.push({
        id: storeyId,
        name: name || `Storey #${storeyId}`,
        elevation,
        elementCount: elementIds.length,
      });
    }
    
    // Sort by elevation (highest first)
    storeys.sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0));
    
    return {
      projectName: hierarchy.project.name || 'Project',
      buildingCount: hierarchy.byBuilding.size,
      storeys,
      totalElements: Array.from(hierarchy.byStorey.values()).reduce((sum, ids) => sum + ids.length, 0),
    };
  }, [ifcDataStore]);

  if (!spatialData) {
    return (
      <div style={{ padding: '1rem', color: '#666', fontSize: '0.875rem' }}>
        Load an IFC file to view spatial hierarchy
      </div>
    );
  }

  const handleStoreyClick = (storeyId: number | null) => {
    setSelectedStorey(storeyId === selectedStorey ? null : storeyId);
  };

  return (
    <div style={{ padding: '1rem', fontSize: '0.875rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1rem' }}>
        Spatial Hierarchy
      </h3>
      
      {/* Project info */}
      <div style={{ marginBottom: '1rem', padding: '0.5rem', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
        <div style={{ fontWeight: 'bold' }}>{spatialData.projectName}</div>
        <div style={{ fontSize: '0.75rem', color: '#666' }}>
          {spatialData.buildingCount} building(s) • {spatialData.storeys.length} storey(s) • {spatialData.totalElements} elements
        </div>
      </div>
      
      {/* Storey filter */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
          Filter by Storey:
        </div>
        <button
          onClick={() => handleStoreyClick(null)}
          style={{
            width: '100%',
            padding: '0.5rem',
            marginBottom: '0.25rem',
            textAlign: 'left',
            border: '1px solid #ddd',
            borderRadius: '4px',
            backgroundColor: selectedStorey === null ? '#007bff' : '#fff',
            color: selectedStorey === null ? '#fff' : '#333',
            cursor: 'pointer',
            fontSize: '0.75rem',
          }}
        >
          All Storeys
        </button>
      </div>
      
      {/* Storey list */}
      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {spatialData.storeys.map((storey) => (
          <button
            key={storey.id}
            onClick={() => handleStoreyClick(storey.id)}
            style={{
              width: '100%',
              padding: '0.5rem',
              marginBottom: '0.25rem',
              textAlign: 'left',
              border: '1px solid #ddd',
              borderRadius: '4px',
              backgroundColor: selectedStorey === storey.id ? '#007bff' : '#fff',
              color: selectedStorey === storey.id ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: '500', fontSize: '0.875rem' }}>{storey.name}</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
              {storey.elevation !== undefined && `Elev: ${storey.elevation.toFixed(2)}m • `}
              {storey.elementCount} elements
            </div>
          </button>
        ))}
      </div>
      
      {/* Spatial query info */}
      {selectedStorey !== null && query && (
        <div style={{ marginTop: '1rem', padding: '0.5rem', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '0.75rem' }}>
          <strong>Active Filter:</strong> Showing elements on selected storey
        </div>
      )}
    </div>
  );
}
