import { runParsingSpike, type ParsingSpikeResult } from './spike1-parsing.js';
import { runTriangulationSpike, type TriangulationSpikeResult } from './spike2-triangulation.js';
import { runWebGPUSpike, type WebGPUSpikeResult } from './spike3-webgpu.js';
import { runQuerySpike, type QuerySpikeResult } from './spike4-query.js';

type SpikeResult = ParsingSpikeResult | TriangulationSpikeResult | WebGPUSpikeResult | QuerySpikeResult;

function updateStatus(spikeId: string, status: 'pending' | 'running' | 'pass' | 'fail') {
  const statusEl = document.getElementById(`${spikeId}-status`);
  if (statusEl) {
    statusEl.className = `status ${status}`;
    statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function displayResults(spikeId: string, result: SpikeResult) {
  const resultsEl = document.getElementById(`${spikeId}-results`);
  if (!resultsEl) return;
  
  resultsEl.innerHTML = '';
  
  if ('error' in result && result.error) {
    const errorDiv = document.createElement('div');
    errorDiv.style.color = '#f44336';
    errorDiv.textContent = `Error: ${result.error}`;
    resultsEl.appendChild(errorDiv);
    return;
  }
  
  // Display metrics based on spike type
  if ('throughputMBps' in result) {
    // Spike 1: Parsing
    const r = result as ParsingSpikeResult;
    addMetric(resultsEl, 'File Size', `${r.fileSizeMB.toFixed(2)} MB`);
    addMetric(resultsEl, 'Scan Time', `${r.scanTimeMs.toFixed(2)} ms`);
    addMetric(resultsEl, 'Throughput', `${r.throughputMBps.toFixed(2)} MB/s`);
    addMetric(resultsEl, 'Target', `>${r.targetMBps} MB/s`);
    addMetric(resultsEl, 'Entity Count', r.entityCount.toLocaleString());
  } else if ('coveragePercent' in result) {
    // Spike 2: Triangulation
    const r = result as TriangulationSpikeResult;
    addMetric(resultsEl, 'Coverage', `${r.coveragePercent.toFixed(1)}%`);
    addMetric(resultsEl, 'Target', `≥${r.targetCoverage}%`);
    addMetric(resultsEl, 'Success', r.successCount.toLocaleString());
    addMetric(resultsEl, 'Failed', r.failedCount.toLocaleString());
    addMetric(resultsEl, 'Total', r.totalCount.toLocaleString());
    
    if (r.failedTypes.size > 0) {
      const failedDiv = document.createElement('div');
      failedDiv.style.marginTop = '10px';
      failedDiv.style.padding = '10px';
      failedDiv.style.background = '#fff3cd';
      failedDiv.style.borderRadius = '4px';
      failedDiv.innerHTML = '<strong>Failed Types:</strong><br/>';
      const typesList = Array.from(r.failedTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([type, count]) => `${type}: ${count}`)
        .join('<br/>');
      failedDiv.innerHTML += typesList;
      resultsEl.appendChild(failedDiv);
    }
  } else if ('fps' in result) {
    // Spike 3: WebGPU
    const r = result as WebGPUSpikeResult;
    addMetric(resultsEl, 'Renderer', r.renderer.toUpperCase());
    addMetric(resultsEl, 'Frame Time', `${r.frameTimeMs.toFixed(2)} ms`);
    addMetric(resultsEl, 'FPS', `${r.fps.toFixed(1)}`);
    addMetric(resultsEl, 'Target', `<${r.targetMs} ms`);
    addMetric(resultsEl, 'Triangles', r.triangleCount.toLocaleString());
  } else if ('queryTimeMs' in result) {
    // Spike 4: Query
    const r = result as QuerySpikeResult;
    addMetric(resultsEl, 'Query Time', `${r.queryTimeMs.toFixed(2)} ms`);
    addMetric(resultsEl, 'Target', `<${r.targetMs} ms`);
    addMetric(resultsEl, 'Entities', r.entityCount.toLocaleString());
    addMetric(resultsEl, 'Properties', r.propertyCount.toLocaleString());
    addMetric(resultsEl, 'Results', r.resultCount.toLocaleString());
  }
}

function addMetric(container: HTMLElement, label: string, value: string) {
  const metricDiv = document.createElement('div');
  metricDiv.className = 'metric';
  
  const labelSpan = document.createElement('span');
  labelSpan.className = 'metric-label';
  labelSpan.textContent = label + ':';
  
  const valueSpan = document.createElement('span');
  valueSpan.className = 'metric-value';
  valueSpan.textContent = value;
  
  metricDiv.appendChild(labelSpan);
  metricDiv.appendChild(valueSpan);
  container.appendChild(metricDiv);
}

async function runSpike1() {
  const fileInput = document.getElementById('ifcFile') as HTMLInputElement;
  const file = fileInput?.files?.[0];
  
  if (!file) {
    alert('Please select an IFC file first');
    return;
  }
  
  updateStatus('spike1', 'running');
  
  try {
    const result = await runParsingSpike(file);
    updateStatus('spike1', result.passed ? 'pass' : 'fail');
    displayResults('spike1', result);
  } catch (error) {
    updateStatus('spike1', 'fail');
    const resultsEl = document.getElementById('spike1-results');
    if (resultsEl) {
      resultsEl.innerHTML = `<div style="color: #f44336;">Error: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
    }
  }
}

async function runSpike2() {
  const fileInput = document.getElementById('ifcFile') as HTMLInputElement;
  const file = fileInput?.files?.[0];
  
  if (!file) {
    alert('Please select an IFC file first');
    return;
  }
  
  updateStatus('spike2', 'running');
  
  try {
    const result = await runTriangulationSpike(file);
    updateStatus('spike2', result.passed ? 'pass' : 'fail');
    displayResults('spike2', result);
  } catch (error) {
    updateStatus('spike2', 'fail');
    const resultsEl = document.getElementById('spike2-results');
    if (resultsEl) {
      resultsEl.innerHTML = `<div style="color: #f44336;">Error: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
    }
  }
}

async function runSpike3() {
  updateStatus('spike3', 'running');
  
  try {
    const result = await runWebGPUSpike();
    updateStatus('spike3', result.passed ? 'pass' : 'fail');
    displayResults('spike3', result);
  } catch (error) {
    updateStatus('spike3', 'fail');
    const resultsEl = document.getElementById('spike3-results');
    if (resultsEl) {
      resultsEl.innerHTML = `<div style="color: #f44336;">Error: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
    }
  }
}

function runSpike4() {
  updateStatus('spike4', 'running');
  
  try {
    const result = runQuerySpike();
    updateStatus('spike4', result.passed ? 'pass' : 'fail');
    displayResults('spike4', result);
  } catch (error) {
    updateStatus('spike4', 'fail');
    const resultsEl = document.getElementById('spike4-results');
    if (resultsEl) {
      resultsEl.innerHTML = `<div style="color: #f44336;">Error: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
    }
  }
}

async function runAllSpikes() {
  const fileInput = document.getElementById('ifcFile') as HTMLInputElement;
  const file = fileInput?.files?.[0];
  
  if (!file) {
    alert('Please select an IFC file first (needed for Spikes 1 & 2)');
    return;
  }
  
  // Run spikes that don't need files first
  runSpike4();
  await runSpike3();
  
  // Then run file-dependent spikes
  await runSpike1();
  await runSpike2();
}

// Set up event listeners
document.getElementById('runAll')?.addEventListener('click', runAllSpikes);
document.getElementById('runSpike1')?.addEventListener('click', runSpike1);
document.getElementById('runSpike2')?.addEventListener('click', runSpike2);
document.getElementById('runSpike3')?.addEventListener('click', runSpike3);
document.getElementById('runSpike4')?.addEventListener('click', runSpike4);
