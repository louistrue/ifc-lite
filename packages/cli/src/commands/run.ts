/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite run <script.js> <file.ifc>
 *
 * Execute a JavaScript file against the BIM SDK.
 * The `bim` object is available globally in the script.
 *
 * Example script:
 *   const walls = bim.query().byType('IfcWall').toArray();
 *   console.log(`Found ${walls.length} walls`);
 *   for (const wall of walls) {
 *     const props = bim.properties(wall.ref);
 *     console.log(wall.name, props.length, 'property sets');
 *   }
 */

import { readFile } from 'node:fs/promises';
import { createHeadlessContext } from '../loader.js';
import { fatal } from '../output.js';

export async function runCommand(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'));
  if (positional.length < 2) fatal('Usage: ifc-lite run <script.js> <file.ifc>');

  const [scriptPath, filePath] = positional;

  const scriptContent = await readFile(scriptPath, 'utf-8');
  const { bim } = await createHeadlessContext(filePath);

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
