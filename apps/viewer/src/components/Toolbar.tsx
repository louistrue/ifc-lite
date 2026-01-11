/**
 * Toolbar component
 */

import { useRef, useState, useCallback } from 'react';
import { useIfc } from '../hooks/useIfc.js';
import { useViewerStore } from '../store.js';
import { GLTFExporter } from '@ifc-lite/export';
import { ParquetExporter } from '@ifc-lite/export';

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadFile, loading, progress, ifcDataStore, geometryResult } = useIfc();
  const error = useViewerStore((state) => state.error);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadFile(file);
    }
  };

  const handleExportGLB = useCallback(async () => {
    if (!geometryResult) return;

    setExporting('GLB');
    try {
      const exporter = new GLTFExporter(geometryResult);
      const glbData = exporter.exportGLB({ includeMetadata: true });

      // Download the file
      const blob = new Blob([glbData as BlobPart], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('GLB export failed:', err);
      alert('GLB export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setExporting(null);
    }
  }, [geometryResult]);

  const handleExportBOS = useCallback(async () => {
    if (!ifcDataStore) return;

    setExporting('BOS');
    try {
      const exporter = new ParquetExporter(ifcDataStore, geometryResult || undefined);
      const bosData = await exporter.exportBOS({ includeGeometry: !!geometryResult });

      // Download the file
      const blob = new Blob([bosData as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.bos';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('BOS export failed:', err);
      alert('BOS export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setExporting(null);
    }
  }, [ifcDataStore, geometryResult]);

  const buttonStyle = {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    cursor: 'pointer',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
  };

  const disabledButtonStyle = {
    ...buttonStyle,
    cursor: 'not-allowed',
    opacity: 0.5,
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
        style={loading ? disabledButtonStyle : buttonStyle}
      >
        {loading ? 'Loading...' : 'Load IFC'}
      </button>

      {/* Export buttons */}
      <div style={{ borderLeft: '1px solid #ddd', paddingLeft: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleExportGLB}
          disabled={!geometryResult || !!exporting}
          style={!geometryResult || exporting ? disabledButtonStyle : buttonStyle}
          title="Export to GLB (3D model)"
        >
          {exporting === 'GLB' ? 'Exporting...' : 'Export GLB'}
        </button>
        <button
          onClick={handleExportBOS}
          disabled={!ifcDataStore || !!exporting}
          style={!ifcDataStore || exporting ? disabledButtonStyle : buttonStyle}
          title="Export to BOS (ara3d compatible Parquet)"
        >
          {exporting === 'BOS' ? 'Exporting...' : 'Export BOS'}
        </button>
      </div>

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
