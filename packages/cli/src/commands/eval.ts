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
import { printJson, fatal, hasFlag } from '../output.js';

/** Known flags that take a value argument */
const EVAL_VALUE_FLAGS = new Set(['--type', '--limit']);

export async function evalCommand(args: string[]): Promise<void> {
  const jsonOutput = hasFlag(args, '--json');

  // Parse positional args, skipping known flags and their values
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (EVAL_VALUE_FLAGS.has(arg)) {
      i++; // skip flag value
      continue;
    }
    if (arg.startsWith('-')) continue; // skip boolean flags
    positional.push(arg);
  }

  if (positional.length < 2) fatal('Usage: ifc-lite eval <file.ifc> "<expression>"');

  const [filePath, ...exprParts] = positional;
  const expression = exprParts.join(' ');

  const { bim } = await createHeadlessContext(filePath);

  // Build evaluation context
  // Detect if expression is a statement (contains const/let/var/for/if/return or ;)
  // If so, wrap in async IIFE to allow multi-statement code
  const isStatement = /^\s*(const |let |var |for |if |while |return |class |function |try |switch |{)/.test(expression)
    || expression.includes(';');

  let body: string;
  if (isStatement) {
    // For multi-statement code: if the last statement is an expression (not a declaration),
    // auto-return it so users don't need to write explicit return
    const statements = expression.split(';').map(s => s.trim()).filter(Boolean);
    const last = statements[statements.length - 1];
    const isLastDeclaration = /^(const |let |var |for |if |while |return |class |function |try |switch |{)/.test(last);
    if (!isLastDeclaration && statements.length > 1) {
      // Replace last statement with return
      statements[statements.length - 1] = `return (${last})`;
    } else if (isLastDeclaration && /^(const |let |var )\s*(\w+)/.test(last)) {
      // If last is a variable declaration, return the variable name
      const varMatch = last.match(/^(?:const |let |var )\s*(\w+)/);
      if (varMatch) {
        statements.push(`return ${varMatch[1]}`);
      }
    }
    body = `return (async () => { ${statements.join('; ')} })()`;
  } else {
    body = `return (${expression})`;
  }

  const evalFn = new Function('bim', `
    "use strict";
    ${body};
  `);

  try {
    const result = evalFn(bim);

    // Handle async results
    const resolved = result instanceof Promise ? await result : result;

    if (jsonOutput) {
      // B8: --json wraps output in a JSON envelope
      printJson({ result: resolved ?? null });
    } else if (resolved === undefined || resolved === null) {
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
