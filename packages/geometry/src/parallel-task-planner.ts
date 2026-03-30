/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Plan a front-loaded task schedule for browser worker geometry processing.
 * Small early tasks improve time-to-first-batch; larger tail tasks preserve throughput.
 */
export function planParallelTaskRanges(
  totalJobs: number,
  workerCount: number,
  fileSizeBytes: number,
  options?: {
    preferThroughput?: boolean;
  }
): Array<[start: number, end: number]> {
  if (totalJobs <= 0 || workerCount <= 0) return [];

  if (totalJobs <= workerCount * 2) {
    const evenChunkSize = Math.ceil(totalJobs / workerCount);
    const ranges: Array<[number, number]> = [];
    for (let start = 0; start < totalJobs; start += evenChunkSize) {
      ranges.push([start, Math.min(totalJobs, start + evenChunkSize)]);
    }
    return ranges;
  }

  const baselineChunkSize = Math.ceil(totalJobs / workerCount);
  const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);
  const isHugeWorkload = fileSizeGB >= 0.5 || totalJobs >= 50_000;
  const preferThroughput = options?.preferThroughput === true;

  // Large browser workloads pay a steep fixed cost per processGeometryBatch()
  // call, so excessive slicing destroys throughput. For these inputs, use a
  // single warm-up slice plus one near-baseline chunk per worker.
  if (isHugeWorkload) {
    if (preferThroughput) {
      const ranges: Array<[number, number]> = [];
      for (let start = 0; start < totalJobs; start += baselineChunkSize) {
        ranges.push([start, Math.min(totalJobs, start + baselineChunkSize)]);
      }
      return ranges;
    }

    const warmupTaskSize = clamp(
      Math.ceil(baselineChunkSize * (workerCount >= 4 ? 0.08 : 0.12)),
      4_000,
      fileSizeGB >= 0.75 ? 12_000 : 16_000
    );
    const tailChunkSize = Math.max(
      warmupTaskSize,
      Math.ceil((totalJobs - warmupTaskSize) / workerCount)
    );

    const ranges: Array<[number, number]> = [];
    let nextStart = 0;

    ranges.push([nextStart, Math.min(totalJobs, nextStart + warmupTaskSize)]);
    nextStart = ranges[0][1];

    while (nextStart < totalJobs) {
      const end = Math.min(totalJobs, nextStart + tailChunkSize);
      ranges.push([nextStart, end]);
      nextStart = end;
    }

    return ranges;
  }

  const smallTaskSize = clamp(
    Math.ceil(totalJobs / Math.max(workerCount * 12, 1)),
    750,
    fileSizeGB >= 0.75 ? 2000 : fileSizeGB >= 0.25 ? 3000 : 4000
  );
  const mediumTaskSize = clamp(
    Math.ceil(totalJobs / Math.max(workerCount * 8, 1)),
    1500,
    fileSizeGB >= 0.75 ? 5000 : fileSizeGB >= 0.25 ? 7000 : 9000
  );
  const largeTaskSize = clamp(
    Math.ceil(totalJobs / Math.max(workerCount * 4, 1)),
    3000,
    fileSizeGB >= 0.75 ? 12000 : fileSizeGB >= 0.25 ? 16000 : 20000
  );

  const smallWaveCount = workerCount * 2;
  const mediumWaveCount = workerCount * 2;
  const ranges: Array<[number, number]> = [];
  let nextStart = 0;

  const pushRange = (size: number) => {
    if (nextStart >= totalJobs) return;
    const end = Math.min(totalJobs, nextStart + size);
    ranges.push([nextStart, end]);
    nextStart = end;
  };

  for (let i = 0; i < smallWaveCount && nextStart < totalJobs; i++) {
    pushRange(smallTaskSize);
  }
  for (let i = 0; i < mediumWaveCount && nextStart < totalJobs; i++) {
    pushRange(mediumTaskSize);
  }
  while (nextStart < totalJobs) {
    pushRange(largeTaskSize);
  }

  return ranges;
}
