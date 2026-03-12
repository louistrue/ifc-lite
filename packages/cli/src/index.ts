#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite CLI — BIM toolkit for the terminal
 *
 * Query, validate, export, create, and script IFC files from the command line.
 * Designed for both humans and LLM terminals (Claude Code, etc.).
 */

import { infoCommand } from './commands/info.js';
import { queryCommand } from './commands/query.js';
import { propsCommand } from './commands/props.js';
import { exportCommand } from './commands/export.js';
import { idsCommand } from './commands/ids.js';
import { bcfCommand } from './commands/bcf.js';
import { createCommand } from './commands/create.js';
import { evalCommand } from './commands/eval.js';
import { runCommand } from './commands/run.js';
import { schemaCommand } from './commands/schema.js';

const VERSION = '0.1.0';

const HELP = `
  ifc-lite — BIM toolkit for the terminal

  Usage: ifc-lite <command> [options]

  Commands:
    info     <file.ifc>                        Model summary (schema, entities, storeys)
    query    <file.ifc> [--type T] [--json]    Query entities by type/properties
    props    <file.ifc> --id <N>               All properties for a single entity
    export   <file.ifc> --format csv|json|ifc  Export data to file or stdout
    ids      <file.ifc> <rules.ids>            Validate against IDS rules
    bcf      <create|list|add-comment>         Work with BCF collaboration files
    create   <wall|slab|column|beam> --out F   Create IFC elements from scratch
    eval     <file.ifc> "<expression>"         Evaluate SDK expression
    run      <script.js> <file.ifc>            Execute a script against model
    schema                                     Dump SDK API schema (for LLM tools)

  Options:
    --help, -h       Show help
    --version, -v    Show version
    --json           Output as JSON (machine-readable)
    --out <file>     Write output to file instead of stdout

  Examples:
    ifc-lite info model.ifc
    ifc-lite query model.ifc --type IfcWall --json
    ifc-lite query model.ifc --type IfcDoor --props --limit 5
    ifc-lite query model.ifc --spatial
    ifc-lite props model.ifc --id 42
    ifc-lite export model.ifc --format csv --type IfcWall --columns Name,Type,GlobalId
    ifc-lite export model.ifc --format json --type IfcWall,IfcDoor
    ifc-lite ids model.ifc requirements.ids --json
    ifc-lite bcf create --title "Missing door" --out issue.bcf
    ifc-lite create wall --height 3 --thickness 0.2 --start 0,0,0 --end 5,0,0 --out wall.ifc
    ifc-lite eval model.ifc "bim.query().byType('IfcWall').count()"
    ifc-lite eval model.ifc "bim.storeys().map(s => s.name)"
    ifc-lite run analysis.js model.ifc
    ifc-lite schema
    ifc-lite schema --compact

  Pipe-friendly:
    ifc-lite query model.ifc --type IfcWall --json | jq '.[].name'
    ifc-lite export model.ifc --format csv --type IfcSlab > slabs.csv
    echo '{"Start":[0,0,0],"End":[10,0,0],"Height":3}' | ifc-lite create wall --from-json --out w.ifc

  Learn more: https://ifclite.com
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP + '\n');
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`ifc-lite ${VERSION}\n`);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'info':
      await infoCommand(commandArgs);
      break;
    case 'query':
      await queryCommand(commandArgs);
      break;
    case 'props':
      await propsCommand(commandArgs);
      break;
    case 'export':
      await exportCommand(commandArgs);
      break;
    case 'ids':
      await idsCommand(commandArgs);
      break;
    case 'bcf':
      await bcfCommand(commandArgs);
      break;
    case 'create':
      await createCommand(commandArgs);
      break;
    case 'eval':
      await evalCommand(commandArgs);
      break;
    case 'run':
      await runCommand(commandArgs);
      break;
    case 'schema':
      await schemaCommand(commandArgs);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stderr.write(`Run 'ifc-lite --help' for usage.\n`);
      process.exit(1);
  }
}

main().catch((err: Error) => {
  process.stderr.write(`Error: ${err.message}\n`);
  if (process.env.DEBUG) {
    process.stderr.write(err.stack ?? '' + '\n');
  }
  process.exit(1);
});
