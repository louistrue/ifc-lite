/**
 * Property panel component
 */

import { useViewerStore } from '../store.js';
import { useIfc } from '../hooks/useIfc.js';

export function PropertyPanel() {
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const { queryInterface } = useIfc();

  if (!selectedEntityId || !queryInterface) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Select an object to view properties
      </div>
    );
  }

  const entity = queryInterface.getEntity(selectedEntityId);
  const properties = queryInterface.getProperties(selectedEntityId);

  if (!entity) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Entity not found
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Entity #{entity.expressId}</h3>
      <p><strong>Type:</strong> {entity.type}</p>

      <h4>Properties</h4>
      {properties.size === 0 ? (
        <p style={{ color: '#666' }}>No properties available</p>
      ) : (
        Array.from(properties.entries()).map(([psetName, pset]) => (
          <div key={psetName} style={{ marginBottom: '1rem' }}>
            <h5>{psetName}</h5>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {Array.from(pset.properties.entries()).map(([propName, prop]) => (
                  <tr key={propName}>
                    <td style={{ padding: '0.25rem', fontWeight: 'bold' }}>{propName}</td>
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
