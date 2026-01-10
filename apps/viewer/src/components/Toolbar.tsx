/**
 * Toolbar component
 */

import { useRef } from 'react';
import { useIfc } from '../hooks/useIfc.js';
import { useViewerStore } from '../store.js';

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadFile, loading, progress } = useIfc();
  const error = useViewerStore((state) => state.error);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadFile(file);
    }
  };

  return (
    <div
      style={{
        padding: '1rem',
        borderBottom: '1px solid #ddd',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={loading}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Loading...' : 'Load IFC File'}
      </button>

      {progress && (
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.875rem', color: '#666' }}>
            {progress.phase}: {Math.round(progress.percent)}%
          </div>
          <div
            style={{
              width: '100%',
              height: '4px',
              backgroundColor: '#eee',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress.percent}%`,
                height: '100%',
                backgroundColor: '#007bff',
                transition: 'width 0.1s',
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: '#d32f2f', fontSize: '0.875rem' }}>
          Error: {error}
        </div>
      )}
    </div>
  );
}
