/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite ids <file.ifc> <rules.ids> [options]
 *
 * Validate an IFC file against IDS (Information Delivery Specification) rules.
 */

import { readFile } from 'node:fs/promises';
import { createHeadlessContext, loadIfcFile } from '../loader.js';
import { printJson, formatTable, hasFlag, getFlag, fatal } from '../output.js';

export async function idsCommand(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'));
  if (positional.length < 2) fatal('Usage: ifc-lite ids <file.ifc> <rules.ids> [--json]');

  const [ifcPath, idsPath] = positional;
  const jsonOutput = hasFlag(args, '--json');
  const locale = (getFlag(args, '--locale') ?? 'en') as 'en' | 'de' | 'fr';

  const { bim, store } = await createHeadlessContext(ifcPath);

  // Read IDS file
  const idsContent = await readFile(idsPath, 'utf-8');

  // Parse and validate
  const idsDoc = await bim.ids.parse(idsContent);

  // Build accessor for validation
  const accessor = buildIdsAccessor(store);

  const report = await bim.ids.validate(idsDoc as any, {
    accessor,
    modelInfo: { schemaVersion: store.schemaVersion },
    locale,
    onProgress: (p) => {
      if (!jsonOutput) {
        process.stderr.write(`\r  Validating: ${p.specName} (${p.current}/${p.total})`);
      }
    },
  });

  if (!jsonOutput) process.stderr.write('\n');

  const summary = bim.ids.summarize(report as any);

  if (jsonOutput) {
    printJson({ summary, report });
    return;
  }

  process.stdout.write(`\n  IDS Validation Results\n`);
  process.stdout.write(`  ─────────────────────\n`);
  process.stdout.write(`  Specifications: ${summary.passedSpecifications}/${summary.totalSpecifications} passed\n`);
  process.stdout.write(`  Entities:       ${summary.passedEntities}/${summary.totalEntities} passed\n`);
  process.stdout.write(`  Failed:         ${summary.failedEntities} entities in ${summary.failedSpecifications} specs\n`);

  const exitCode = summary.failedSpecifications > 0 ? 1 : 0;
  process.stdout.write(`\n  Result: ${exitCode === 0 ? 'PASS' : 'FAIL'}\n\n`);
  process.exitCode = exitCode;
}

/**
 * Build a data accessor compatible with @ifc-lite/ids validation.
 * Maps IFC data store access patterns to what the IDS validator expects.
 */
function buildIdsAccessor(store: any): unknown {
  // The IDS validator expects an accessor object with methods to query
  // entity data from the model. This is a simplified accessor.
  return {
    store,
    getEntitiesByType(typeName: string): number[] {
      const upper = typeName.toUpperCase();
      return store.entityIndex.byType.get(upper) ?? [];
    },
    getEntityType(expressId: number): string {
      return store.entities.getTypeName(expressId);
    },
    getEntityName(expressId: number): string {
      return store.entities.getName(expressId) ?? '';
    },
  };
}
