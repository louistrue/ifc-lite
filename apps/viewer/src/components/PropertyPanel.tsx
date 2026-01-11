/**
 * Property panel component
 */

import { useMemo } from 'react';
import { useViewerStore } from '../store.js';
import { useIfc } from '../hooks/useIfc.js';

export function PropertyPanel() {
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const { query, ifcDataStore } = useIfc();

  // Get spatial location info
  const spatialInfo = useMemo(() => {
    if (!selectedEntityId || !ifcDataStore?.spatialHierarchy) return null;

    const hierarchy = ifcDataStore.spatialHierarchy;

    // Find which storey contains this element
    let storeyId: number | null = null;
    for (const [sid, elementIds] of hierarchy.byStorey) {
      if (elementIds.includes(selectedEntityId)) {
        storeyId = sid;
        break;
      }
    }

    // Also check elementToStorey map if available
    if (!storeyId && (hierarchy as any).elementToStorey) {
      storeyId = (hierarchy as any).elementToStorey.get(selectedEntityId) ?? null;
    }

    if (!storeyId) return null;

    const storeyName = ifcDataStore.entities.getName(storeyId);
    const elevation = hierarchy.storeyElevations.get(storeyId);

    // Try to find building using getPath if available, otherwise traverse manually
    let buildingName: string | null = null;
    if (typeof (hierarchy as any).getPath === 'function') {
      const path = (hierarchy as any).getPath(selectedEntityId);
      for (const node of path) {
        if (node.type === 3) { // IfcBuilding
          buildingName = node.name;
          break;
        }
      }
    }

    return {
      storeyId,
      storeyName: storeyName || `Storey #${storeyId}`,
      elevation,
      buildingName,
    };
  }, [selectedEntityId, ifcDataStore]);

  if (!selectedEntityId || !query) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Select an object to view properties
      </div>
    );
  }

  const entityNode = query.entity(selectedEntityId);
  const properties = entityNode.properties();

  // Entity info
  const entityType = entityNode.type;
  const entityName = entityNode.name;
  const entityGlobalId = entityNode.globalId;

  return (
    <div style={{ padding: '1rem', fontSize: '0.875rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>
        Entity #{selectedEntityId}
      </h3>
      <p style={{ margin: '0.25rem 0' }}>
        <strong>Type:</strong> {entityType}
      </p>
      {entityName && (
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Name:</strong> {entityName}
        </p>
      )}
      {entityGlobalId && (
        <p style={{ margin: '0.25rem 0', wordBreak: 'break-all' }}>
          <strong>GlobalId:</strong> <span style={{ fontSize: '0.75rem' }}>{entityGlobalId}</span>
        </p>
      )}

      {/* Spatial location */}
      {spatialInfo && (
        <div style={{ marginTop: '0.75rem', padding: '0.5rem', backgroundColor: '#e8f5e9', borderRadius: '4px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#2e7d32', marginBottom: '0.25rem' }}>
            Spatial Location
          </div>
          {spatialInfo.buildingName && (
            <div style={{ fontSize: '0.75rem' }}>
              <strong>Building:</strong> {spatialInfo.buildingName}
            </div>
          )}
          <div style={{ fontSize: '0.75rem' }}>
            <strong>Storey:</strong> {spatialInfo.storeyName}
            {spatialInfo.elevation !== undefined && ` (${spatialInfo.elevation.toFixed(2)}m)`}
          </div>
        </div>
      )}

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Property Sets</h4>
      {properties.length === 0 ? (
        <p style={{ color: '#666', fontSize: '0.75rem' }}>No property sets</p>
      ) : (
        properties.map((pset) => (
          <div key={pset.name} style={{ marginBottom: '1rem' }}>
            <h5 style={{ margin: '0.5rem 0 0.25rem', color: '#333' }}>{pset.name}</h5>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <tbody>
                {pset.properties.map((prop) => (
                  <tr key={prop.name} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.25rem', fontWeight: 'bold', color: '#555' }}>
                      {prop.name}
                    </td>
                    <td style={{ padding: '0.25rem' }}>
                      {prop.value !== null && prop.value !== undefined
                        ? String(prop.value)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
