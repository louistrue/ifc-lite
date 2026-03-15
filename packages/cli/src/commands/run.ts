/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite run <script.js> <file.ifc> [--viewer PORT]
 *
 * Execute a JavaScript file against the BIM SDK.
 * The `bim` object is available globally in the script.
 *
 * With --viewer PORT, bim.viewer.* calls are streamed to a running
 * `ifc-lite view` instance, updating the 3D view in real time.
 *
 * Example script:
 *   const walls = bim.query().byType('IfcWall').toArray();
 *   console.log(`Found ${walls.length} walls`);
 *   bim.viewer.colorize(walls.map(w => w.ref), 'red');
 */

import { readFile } from 'node:fs/promises';
import { createHeadlessContext, createStreamingContext } from '../loader.js';
import { fatal, getFlag, validateViewerPort } from '../output.js';

export async function runCommand(args: string[]): Promise<void> {
  const viewerPort = validateViewerPort(getFlag(args, '--viewer'));
  const positional = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '--viewer');
  if (positional.length < 2) fatal('Usage: ifc-lite run <script.js> <file.ifc> [--viewer PORT]');

  const [scriptPath, filePath] = positional;

  const scriptContent = await readFile(scriptPath, 'utf-8');

  // Use streaming context if --viewer is specified
  const { bim } = viewerPort
    ? await createStreamingContext(filePath, viewerPort)
    : await createHeadlessContext(filePath);

  // Execute script with bim context available
  const wrappedScript = `
    "use strict";
    return (async function(bim, console) {
      ${scriptContent}
    })(bim, console);
  `;

  try {
    const fn = new Function('bim', 'console', wrappedScript);
    await fn(bim, console);
  } catch (err: any) {
    fatal(`Script error: ${err.message}`);
  }
}
