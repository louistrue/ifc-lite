/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite props <file.ifc> --id <expressId>
 *
 * Show all properties, quantities, materials, and classifications for an entity.
 */

import { createHeadlessContext } from '../loader.js';
import { printJson, getFlag, fatal } from '../output.js';

export async function propsCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  const idStr = getFlag(args, '--id');
  if (!filePath || !idStr) fatal('Usage: ifc-lite props <file.ifc> --id <expressId>');

  const expressId = parseInt(idStr, 10);
  if (isNaN(expressId)) fatal('--id must be a number');

  const { bim } = await createHeadlessContext(filePath);

  const ref = { modelId: 'default', expressId };
  const entity = bim.entity(ref);
  if (!entity) fatal(`Entity #${expressId} not found`);

  const result: Record<string, unknown> = {
    type: entity.type,
    name: entity.name,
    globalId: entity.globalId,
    description: entity.description || undefined,
    objectType: entity.objectType || undefined,
    attributes: bim.attributes(ref),
    properties: bim.properties(ref),
    quantities: bim.quantities(ref),
    classifications: bim.classifications(ref),
    materials: bim.materials(ref),
    typeProperties: bim.typeProperties(ref),
    relationships: bim.relationships(ref),
  };

  printJson(result);
}
