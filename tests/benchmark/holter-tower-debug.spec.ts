/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test, expect } from '@playwright/test';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const HOLTER_TOWER_FILE = 'tests/models/ara3d/ISSUE_053_20181220Holter_Tower_10.ifc';

test.describe('Holter Tower Debug', () => {
  test('debug WASM crash', async ({ page }) => {
    const filePath = join(process.cwd(), HOLTER_TOWER_FILE);

    // Skip if file doesn't exist
    if (!existsSync(filePath)) {
      console.log(`Skipping - file not found at ${filePath}`);
      test.skip();
      return;
    }

    // Capture all console messages
    const consoleLogs: Array<{ type: string; text: string; timestamp: number }> = [];
    page.on('console', (msg) => {
      const logEntry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      };
      consoleLogs.push(logEntry);
      console.log(`[CONSOLE ${logEntry.type}] ${logEntry.text}`);
    });

    // Capture page errors (WASM crashes)
    const pageErrors: Array<{ message: string; stack?: string; timestamp: number }> = [];
    page.on('pageerror', (error) => {
      const errorEntry = {
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      };
      pageErrors.push(errorEntry);
      console.error('\n[PAGE ERROR]', error.message);
      if (error.stack) {
        console.error('[STACK]', error.stack);
      }
    });

    // Capture unhandled promise rejections
    page.on('requestfailed', (request) => {
      console.error('[REQUEST FAILED]', request.url(), request.failure()?.errorText);
    });

    // Navigate to viewer
    console.log(`\n${'='.repeat(80)}`);
    console.log('Loading Holter Tower for debugging...');
    console.log(`${'='.repeat(80)}\n`);

    await page.goto('http://localhost:3000');
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 30000 });

    const loadStartTime = Date.now();

    // Load file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
    console.log('File uploaded, waiting for processing...\n');

    // Wait for either completion or crash
    const timeoutMs = 600000; // 10 minutes
    const startTime = Date.now();
    let crashed = false;
    let completed = false;

    while (Date.now() - startTime < timeoutMs) {
      // Check if we have a crash
      if (pageErrors.length > 0) {
        crashed = true;
        console.log('\n' + '='.repeat(80));
        console.log('CRASH DETECTED!');
        console.log('='.repeat(80) + '\n');

        // Show the error
        const error = pageErrors[0];
        console.log('Error Message:', error.message);
        if (error.stack) {
          console.log('\nStack Trace:');
          console.log(error.stack);
        }

        // Show last 50 console messages before crash
        console.log('\n' + '='.repeat(80));
        console.log('Last 50 console messages before crash:');
        console.log('='.repeat(80));
        const lastMessages = consoleLogs.slice(-50);
        lastMessages.forEach((log, idx) => {
          console.log(`[${idx + 1}] [${log.type}] ${log.text}`);
        });

        // Find key milestones
        console.log('\n' + '='.repeat(80));
        console.log('Key Milestones:');
        console.log('='.repeat(80));
        
        const milestones = [
          { pattern: /\[useIfc\] File:.*size:.*read in/, label: 'File Read' },
          { pattern: /\[IfcParser\] WASM scan:/, label: 'WASM Scan Start' },
          { pattern: /\[IfcParser\] Fast scan:.*entities in/, label: 'Fast Scan Complete' },
          { pattern: /\[useIfc\] Model opened at/, label: 'Model Opened' },
          { pattern: /\[useIfc\] Starting geometry streaming/, label: 'Geometry Streaming Start' },
          { pattern: /\[ColumnarParser\] Parsed.*entities in/, label: 'Columnar Parse Complete' },
          { pattern: /\[useIfc\] Batch #/, label: 'First Batch' },
        ];

        milestones.forEach(({ pattern, label }) => {
          const match = consoleLogs.find(log => pattern.test(log.text));
          if (match) {
            const timeSinceStart = match.timestamp - loadStartTime;
            console.log(`✓ ${label}: ${timeSinceStart}ms after load start`);
            console.log(`  ${match.text}`);
          } else {
            console.log(`✗ ${label}: NOT REACHED`);
          }
        });

        // Find messages related to geometry processing
        console.log('\n' + '='.repeat(80));
        console.log('Geometry Processing Messages:');
        console.log('='.repeat(80));
        const geometryMessages = consoleLogs.filter(log =>
          log.text.includes('geometry') ||
          log.text.includes('Geometry') ||
          log.text.includes('mesh') ||
          log.text.includes('Mesh') ||
          log.text.includes('CSG') ||
          log.text.includes('process') ||
          log.text.includes('Process')
        );
        geometryMessages.slice(-20).forEach((log, idx) => {
          console.log(`[${idx + 1}] [${log.type}] ${log.text}`);
        });

        // Save full log to file
        const outputDir = join(process.cwd(), 'tests/benchmark/debug-output');
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        const logOutput = {
          timestamp: new Date().toISOString(),
          file: HOLTER_TOWER_FILE,
          crash: {
            message: error.message,
            stack: error.stack,
            crashTime: error.timestamp - loadStartTime,
          },
          milestones: milestones.map(({ pattern, label }) => {
            const match = consoleLogs.find(log => pattern.test(log.text));
            return {
              label,
              reached: !!match,
              time: match ? match.timestamp - loadStartTime : null,
              message: match ? match.text : null,
            };
          }),
          last50Messages: lastMessages,
          geometryMessages: geometryMessages.slice(-20),
          allConsoleLogs: consoleLogs,
        };

        const outputPath = join(outputDir, `holter-tower-crash-${Date.now()}.json`);
        writeFileSync(outputPath, JSON.stringify(logOutput, null, 2));
        console.log(`\nFull debug log saved to: ${outputPath}`);

        break;
      }

      // Check if we have completion signals
      const hasStreamingComplete = consoleLogs.some(log =>
        log.text.includes('[useIfc] Geometry streaming complete')
      );
      const hasDataModelComplete = consoleLogs.some(log =>
        log.text.includes('[useIfc] Data model parsing complete') ||
        log.text.includes('[ColumnarParser] Parsed')
      );

      if (hasStreamingComplete && hasDataModelComplete) {
        completed = true;
        console.log('\n' + '='.repeat(80));
        console.log('PROCESSING COMPLETED SUCCESSFULLY');
        console.log('='.repeat(80) + '\n');
        break;
      }

      // Wait a bit before checking again
      await page.waitForTimeout(100);
    }

    if (!crashed && !completed) {
      console.log('\n' + '='.repeat(80));
      console.log('TIMEOUT - Processing did not complete or crash within timeout');
      console.log('='.repeat(80) + '\n');
      console.log(`Total console messages: ${consoleLogs.length}`);
      console.log(`Total page errors: ${pageErrors.length}`);
    }

    // Output summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total console messages: ${consoleLogs.length}`);
    console.log(`Total page errors: ${pageErrors.length}`);
    console.log(`Status: ${crashed ? 'CRASHED' : completed ? 'COMPLETED' : 'TIMEOUT'}`);
    
    if (consoleLogs.length > 0) {
      const lastMessage = consoleLogs[consoleLogs.length - 1];
      const timeSinceStart = lastMessage.timestamp - loadStartTime;
      console.log(`Last message at: ${timeSinceStart}ms`);
      console.log(`Last message: [${lastMessage.type}] ${lastMessage.text}`);
    }
  });
});
