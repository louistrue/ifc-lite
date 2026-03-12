/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite eval <file.ifc> "<expression>"
 *
 * Evaluate a JavaScript expression against the BIM SDK.
 * The `bim` object is available with the full SDK API.
 *
 * Examples:
 *   ifc-lite eval model.ifc "bim.query().byType('IfcWall').count()"
 *   ifc-lite eval model.ifc "bim.query().byType('IfcDoor').toArray().map(d => d.name)"
 */

import { createHeadlessContext } from '../loader.js';
import { printJson, fatal } from '../output.js';

export async function evalCommand(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'));
  if (positional.length < 2) fatal('Usage: ifc-lite eval <file.ifc> "<expression>"');

  const [filePath, ...exprParts] = positional;
  const expression = exprParts.join(' ');

  const { bim } = await createHeadlessContext(filePath);

  // Build evaluation context
  // Detect if expression is a statement (contains const/let/var/for/if/return or ;)
  // If so, wrap in async IIFE to allow multi-statement code
  const isStatement = /^\s*(const |let |var |for |if |while |return |class |function |try |switch |{)/.test(expression)
    || expression.includes(';');

  const body = isStatement
    ? `return (async () => { ${expression} })()`
    : `return (${expression})`;

  const evalFn = new Function('bim', `
    "use strict";
    ${body};
  `);

  try {
    const result = evalFn(bim);

    // Handle async results
    const resolved = result instanceof Promise ? await result : result;

    if (resolved === undefined || resolved === null) {
      process.stdout.write('null\n');
    } else if (typeof resolved === 'object') {
      printJson(resolved);
    } else {
      process.stdout.write(String(resolved) + '\n');
    }
  } catch (err: any) {
    fatal(`Evaluation error: ${err.message}`);
  }
}
