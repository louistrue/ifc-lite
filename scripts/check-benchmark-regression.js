#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const baselinePath = join(rootDir, 'tests/benchmark/baseline.json');
const resultsDir = join(rootDir, 'tests/benchmark/benchmark-results');

const thresholds = {
  firstBatchWaitMs: 50,
  geometryStreamingMs: 50,
  entityScanMs: 50,
  dataModelParseMs: 50,
};

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function percentIncrease(current, baseline) {
  if (typeof current !== 'number' || typeof baseline !== 'number' || baseline <= 0) {
    return null;
  }
  return ((current - baseline) / baseline) * 100;
}

function formatMs(value) {
  if (typeof value !== 'number') return 'N/A';
  return `${value.toFixed(0)}ms`;
}

function formatPct(value) {
  if (value === null) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function loadResults() {
  if (!existsSync(resultsDir)) {
    throw new Error('No benchmark results directory found. Run `pnpm test:benchmark:viewer` first.');
  }

  const files = readdirSync(resultsDir).filter((name) => name.startsWith('viewer-') && name.endsWith('.json'));
  if (files.length === 0) {
    throw new Error('No viewer benchmark results found. Run `pnpm test:benchmark:viewer` first.');
  }

  return files.map((name) => {
    const path = join(resultsDir, name);
    const payload = loadJson(path);
    return { name, path, payload };
  });
}

function checkBenchmarkRegression() {
  if (!existsSync(baselinePath)) {
    throw new Error('No baseline available. Create one with `pnpm benchmark:baseline`.');
  }

  const baseline = loadJson(baselinePath);
  const results = loadResults();

  const regressions = [];
  const missingBaseline = [];

  console.log('Benchmark regression check');
  console.log('='.repeat(80));

  for (const { payload, name } of results) {
    const fileName = payload.file;
    const metrics = payload.metrics || {};
    const baselineMetrics = baseline[fileName]?.metrics;

    console.log(`\n${fileName}`);
    console.log(`  Result source: ${name}`);

    if (!baselineMetrics) {
      missingBaseline.push(fileName);
      console.log('  ⚠ No baseline entry for this model');
      continue;
    }

    for (const metricName of Object.keys(thresholds)) {
      const threshold = thresholds[metricName];
      const currentValue = metrics[metricName];
      const baselineValue = baselineMetrics[metricName];
      const increasePct = percentIncrease(currentValue, baselineValue);
      const line = `  - ${metricName}: ${formatMs(currentValue)} vs ${formatMs(baselineValue)} (${formatPct(increasePct)})`;

      if (increasePct !== null && increasePct > threshold) {
        regressions.push({
          fileName,
          metricName,
          currentValue,
          baselineValue,
          increasePct,
          threshold,
        });
        console.log(`${line}  ❌ threshold +${threshold}%`);
      } else {
        console.log(`${line}  ✅`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  if (missingBaseline.length > 0) {
    console.log(`Missing baseline entries: ${missingBaseline.length}`);
    for (const fileName of missingBaseline) {
      console.log(`  - ${fileName}`);
    }
  }

  if (regressions.length > 0) {
    console.error(`\nFound ${regressions.length} regression(s):`);
    for (const reg of regressions) {
      console.error(
        `  - ${reg.fileName} :: ${reg.metricName} increased by ${reg.increasePct.toFixed(1)}% ` +
          `(${reg.currentValue}ms vs ${reg.baselineValue}ms, allowed +${reg.threshold}%)`
      );
    }
    process.exit(1);
  }

  console.log('\nNo threshold regressions detected.');
  if (missingBaseline.length > 0) {
    console.log('Some models are missing baseline entries (warning only).');
  }
}

try {
  checkBenchmarkRegression();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
