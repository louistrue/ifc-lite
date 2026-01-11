/**
 * Property panel component
 */

import { useViewerStore } from '../store.js';
import { useIfc } from '../hooks/useIfc.js';
import { getAttributeNames, type PropertySet } from '@ifc-lite/parser';

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
        Entity not found (ID: {selectedEntityId})
      </div>
    );
  }

  // Get attribute names using proper IFC schema
  const attrNames = getAttributeNames(entity.type);

  // Fallback to indexed names if schema doesn't have enough attributes
  const getAttributeName = (index: number): string => {
    if (index < attrNames.length && attrNames[index]) {
      return attrNames[index];
    }
    return `[${index}]`;
  };

  /**
   * Extract meaningful display value from a referenced entity
   */
  const getEntityDisplayValue = (refEntity: any, depth: number = 0): string => {
    if (!refEntity || depth > 2) return '...';

    const typeUpper = refEntity.type.toUpperCase();
    const attrs = refEntity.attributes;

    // IfcOwnerHistory - show application and date
    if (typeUpper === 'IFCOWNERHISTORY') {
      // attrs: [OwningUser, OwningApplication, State, ChangeAction, LastModifiedDate, LastModifyingUser, LastModifyingApplication, CreationDate]
      const creationDate = attrs[7];
      if (creationDate && typeof creationDate === 'number') {
        const date = new Date(creationDate * 1000);
        return `Created: ${date.toLocaleDateString()}`;
      }
      return 'OwnerHistory';
    }

    // IfcLocalPlacement - resolve placement chain
    if (typeUpper === 'IFCLOCALPLACEMENT') {
      return 'LocalPlacement';
    }

    // IfcProductDefinitionShape
    if (typeUpper === 'IFCPRODUCTDEFINITIONSHAPE') {
      return 'ProductDefinitionShape';
    }

    // IfcApplication - show name
    if (typeUpper === 'IFCAPPLICATION') {
      // attrs: [ApplicationDeveloper, Version, ApplicationFullName, ApplicationIdentifier]
      const appName = attrs[2] || attrs[3];
      return appName ? String(appName) : 'Application';
    }

    // IfcPerson - show name
    if (typeUpper === 'IFCPERSON') {
      const familyName = attrs[2];
      const givenName = attrs[1];
      if (familyName || givenName) {
        return [givenName, familyName].filter(Boolean).join(' ');
      }
      return 'Person';
    }

    // IfcOrganization - show name
    if (typeUpper === 'IFCORGANIZATION') {
      // attrs: [Identification, Name, Description, ...]
      return attrs[1] ? String(attrs[1]) : 'Organization';
    }

    // IfcPersonAndOrganization
    if (typeUpper === 'IFCPERSONANDORGANIZATION') {
      // attrs: [ThePerson, TheOrganization, Roles]
      const personId = attrs[0];
      const orgId = attrs[1];
      const parts: string[] = [];

      if (typeof personId === 'number') {
        const person = queryInterface.getEntity(personId);
        if (person) parts.push(getEntityDisplayValue(person, depth + 1));
      }
      if (typeof orgId === 'number') {
        const org = queryInterface.getEntity(orgId);
        if (org) parts.push(getEntityDisplayValue(org, depth + 1));
      }

      return parts.length > 0 ? parts.join(' @ ') : 'PersonAndOrganization';
    }

    // IfcMaterial - show name
    if (typeUpper === 'IFCMATERIAL') {
      return attrs[0] ? String(attrs[0]) : 'Material';
    }

    // IfcDirection - show vector
    if (typeUpper === 'IFCDIRECTION') {
      const coords = attrs[0];
      if (Array.isArray(coords)) {
        return `(${coords.map(c => typeof c === 'number' ? c.toFixed(2) : c).join(', ')})`;
      }
      return 'Direction';
    }

    // IfcCartesianPoint - show coordinates
    if (typeUpper === 'IFCCARTESIANPOINT') {
      const coords = attrs[0];
      if (Array.isArray(coords)) {
        return `(${coords.map(c => typeof c === 'number' ? c.toFixed(2) : c).join(', ')})`;
      }
      return 'Point';
    }

    // Default: return type name
    return refEntity.type.replace(/^IFC/i, '');
  };

  // Resolve an attribute value to a displayable string
  const resolveAttributeValue = (attr: any): { display: string; isRef: boolean; refType?: string } => {
    if (attr === null || attr === undefined) {
      return { display: '$', isRef: false };
    }

    // Entity reference (positive integer)
    if (typeof attr === 'number' && Number.isInteger(attr) && attr > 0) {
      const refEntity = queryInterface.getEntity(attr);
      if (refEntity) {
        const displayValue = getEntityDisplayValue(refEntity);
        return { display: displayValue, isRef: false };
      }
      return { display: `#${attr}`, isRef: true, refType: '?' };
    }

    // Array of references or values
    if (Array.isArray(attr)) {
      if (attr.length === 0) return { display: '[]', isRef: false };

      const resolved = attr.slice(0, 3).map(item => {
        if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
          const refEntity = queryInterface.getEntity(item);
          if (refEntity) {
            return getEntityDisplayValue(refEntity);
          }
          return `#${item}`;
        }
        return String(item);
      });

      const suffix = attr.length > 3 ? `, +${attr.length - 3} more` : '';
      return { display: `[${resolved.join(', ')}${suffix}]`, isRef: false };
    }

    // String or other value
    return { display: String(attr), isRef: false };
  };

  return (
    <div style={{ padding: '1rem', fontSize: '0.875rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Entity #{entity.expressId}</h3>
      <p style={{ margin: '0.25rem 0' }}><strong>Type:</strong> {entity.type}</p>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Attributes</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
        <tbody>
          {entity.attributes.map((attr, i) => {
            const resolved = resolveAttributeValue(attr);
            return (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.25rem', fontWeight: 'bold', color: '#555', width: '40%' }}>
                  {getAttributeName(i)}
                </td>
                <td style={{ padding: '0.25rem', wordBreak: 'break-all' }}>
                  {resolved.isRef ? (
                    <span>
                      <span style={{ color: '#0066cc' }}>{resolved.display}</span>
                      {resolved.refType && (
                        <span style={{ color: '#888', marginLeft: '0.25rem', fontSize: '0.7rem' }}>
                          ({resolved.refType})
                        </span>
                      )}
                    </span>
                  ) : resolved.display === '$' ? (
                    <span style={{ color: '#999' }}>$</span>
                  ) : (
                    <span>{resolved.display}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>Property Sets</h4>
      {properties.size === 0 ? (
        <p style={{ color: '#666', fontSize: '0.75rem' }}>No property sets linked</p>
      ) : (
        Array.from(properties.entries()).map((entry) => {
          const [psetName, pset] = entry as [string, PropertySet];
          return (
            <div key={psetName} style={{ marginBottom: '1rem' }}>
              <h5 style={{ margin: '0.5rem 0 0.25rem', color: '#333' }}>{psetName}</h5>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <tbody>
                  {Array.from(pset.properties.entries()).map((propEntry) => {
                    const [propName, prop] = propEntry;
                    return (
                      <tr key={propName} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.25rem', fontWeight: 'bold', color: '#555' }}>{propName}</td>
                        <td style={{ padding: '0.25rem' }}>
                          {prop.value !== null && prop.value !== undefined
                            ? String(prop.value)
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
