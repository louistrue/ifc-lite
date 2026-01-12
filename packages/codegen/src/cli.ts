#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CLI for IFC code generation
 */

import { Command } from 'commander';
import { generateFromFile } from './generator.js';

const program = new Command();

program
  .name('ifc-codegen')
  .description('Generate TypeScript code from IFC EXPRESS schemas')
  .version('0.1.0');

program
  .argument('<schema>', 'Path to EXPRESS schema file (.exp)')
  .option('-o, --output <dir>', 'Output directory', './generated')
  .option('-v, --verbose', 'Verbose output', false)
  .action((schemaPath: string, options: { output: string; verbose: boolean }) => {
    try {
      console.log('🚀 IFC TypeScript Code Generator\n');
      console.log(`Schema: ${schemaPath}`);
      console.log(`Output: ${options.output}\n`);

      const start = Date.now();
      generateFromFile(schemaPath, options.output);
      const elapsed = Date.now() - start;

      console.log(`\n⏱️  Completed in ${elapsed}ms`);
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
