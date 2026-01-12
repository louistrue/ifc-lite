/**
 * Main application component
 */

import { useState, useMemo } from 'react';
import { Toolbar } from './components/Toolbar.js';
import { Viewport } from './components/Viewport.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { SpatialPanel } from './components/SpatialPanel.js';
import { useIfc } from './hooks/useIfc.js';
import { useViewerStore } from './store.js';

type RightPanelTab = 'properties' | 'spatial';

export function App() {
  const { geometryResult, ifcDataStore } = useIfc();
  const selectedStorey = useViewerStore((state) => state.selectedStorey);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('properties');

  // Filter geometry based on selected storey
  const filteredGeometry = useMemo(() => {
    if (!geometryResult?.meshes || !ifcDataStore?.spatialHierarchy) {
      return geometryResult?.meshes || null;
    }

    // If no storey is selected, show all meshes
    if (selectedStorey === null) {
      return geometryResult.meshes;
    }

    // Get element IDs for the selected storey
    const hierarchy = ifcDataStore.spatialHierarchy;
    const storeyElementIds = hierarchy.byStorey.get(selectedStorey);
    
    if (!storeyElementIds || storeyElementIds.length === 0) {
      console.warn('[App] No elements found for storey:', selectedStorey);
      return geometryResult.meshes; // Fallback to showing all
    }

    // Create a Set for fast lookup
    const storeyElementIdSet = new Set(storeyElementIds);
    
    // Filter meshes to only include those whose expressId is in the storey
    const filtered = geometryResult.meshes.filter(mesh => 
      storeyElementIdSet.has(mesh.expressId)
    );

    console.log(`[App] Filtered geometry: ${filtered.length} of ${geometryResult.meshes.length} meshes for storey ${selectedStorey}`);
    return filtered;
  }, [geometryResult, ifcDataStore, selectedStorey]);

  const tabStyle = (active: boolean) => ({
    flex: 1,
    padding: '0.5rem',
    border: 'none',
    borderBottom: active ? '2px solid #007bff' : '2px solid transparent',
    backgroundColor: active ? '#fff' : '#f0f0f0',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: active ? 'bold' : 'normal' as const,
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <Toolbar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Viewport 
            geometry={filteredGeometry}
            coordinateInfo={geometryResult?.coordinateInfo}
          />
        </div>
        <div
          style={{
            width: '320px',
            borderLeft: '1px solid #ddd',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#f9f9f9',
          }}
        >
          {/* Tab buttons */}
          <div style={{ display: 'flex', borderBottom: '1px solid #ddd' }}>
            <button
              onClick={() => setRightPanelTab('properties')}
              style={tabStyle(rightPanelTab === 'properties')}
            >
              Properties
            </button>
            <button
              onClick={() => setRightPanelTab('spatial')}
              style={tabStyle(rightPanelTab === 'spatial')}
            >
              Spatial
            </button>
          </div>
          
          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rightPanelTab === 'properties' && <PropertyPanel />}
            {rightPanelTab === 'spatial' && <SpatialPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
