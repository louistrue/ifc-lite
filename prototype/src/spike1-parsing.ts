/**
 * Spike 1: Parsing Speed
 * Goal: Scan 100MB IFC file in under 200ms (index only, not full parse)
 * Success: >500 MB/s scan rate
 */

export interface ParsingSpikeResult {
  passed: boolean;
  scanTimeMs: number;
  fileSizeMB: number;
  throughputMBps: number;
  entityCount: number;
  targetMBps: number;
}

export async function runParsingSpike(file: File): Promise<ParsingSpikeResult> {
  const targetMBps = 500; // Target: >500 MB/s
  
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fileSizeMB = buffer.byteLength / (1024 * 1024);
  
  // Scan for entity markers (# character = 35)
  const startTime = performance.now();
  let entityCount = 0;
  
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 35) { // '#' character
      entityCount++;
    }
  }
  
  const endTime = performance.now();
  const scanTimeMs = endTime - startTime;
  const throughputMBps = fileSizeMB / (scanTimeMs / 1000);
  
  const passed = throughputMBps >= targetMBps;
  
  return {
    passed,
    scanTimeMs,
    fileSizeMB,
    throughputMBps,
    entityCount,
    targetMBps,
  };
}
