/**
 * Main application component
 */

import { Toolbar } from './components/Toolbar.js';
import { Viewport } from './components/Viewport.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { useIfc } from './hooks/useIfc.js';

export function App() {
  const { geometryResult } = useIfc();

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
          <Viewport geometry={geometryResult?.meshes || null} />
        </div>
        <div
          style={{
            width: '300px',
            borderLeft: '1px solid #ddd',
            overflowY: 'auto',
            backgroundColor: '#f9f9f9',
          }}
        >
          <PropertyPanel />
        </div>
      </div>
    </div>
  );
}
