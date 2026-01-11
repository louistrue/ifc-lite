/**
 * Property panel component
 */

import { useViewerStore } from '../store.js';
import { useIfc } from '../hooks/useIfc.js';

export function PropertyPanel() {
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const { query } = useIfc();

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
        <p style={{ margin: '0.25rem 0' }}>
          <strong>GlobalId:</strong> {entityGlobalId}
        </p>
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
