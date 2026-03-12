/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite query <file.ifc> [options]
 *
 * Query entities from an IFC file with type and property filters.
 * Supports all entity data: properties, quantities, materials,
 * classifications, attributes, relationships, type properties.
 */

import { createHeadlessContext } from '../loader.js';
import { printJson, formatTable, getFlag, hasFlag, fatal } from '../output.js';

export async function queryCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite query <file.ifc> --type IfcWall [--props] [--limit N]');

  const type = getFlag(args, '--type');
  const limit = getFlag(args, '--limit');
  const offset = getFlag(args, '--offset');
  const propFilter = getFlag(args, '--where');
  const showProps = hasFlag(args, '--props');
  const showQuantities = hasFlag(args, '--quantities');
  const showMaterials = hasFlag(args, '--materials');
  const showClassifications = hasFlag(args, '--classifications');
  const showAttributes = hasFlag(args, '--attributes');
  const showRelationships = hasFlag(args, '--relationships');
  const showTypeProps = hasFlag(args, '--type-props');
  const showDocuments = hasFlag(args, '--documents');
  const showAll = hasFlag(args, '--all');
  const jsonOutput = hasFlag(args, '--json');
  const countOnly = hasFlag(args, '--count');
  const spatial = hasFlag(args, '--spatial');

  const { bim } = await createHeadlessContext(filePath);

  // Spatial tree mode
  if (spatial) {
    const storeys = bim.storeys();
    const tree: Record<string, unknown[]> = {};
    for (const storey of storeys) {
      const contained = bim.contains(storey.ref);
      tree[storey.name || `Storey #${storey.ref.expressId}`] = contained.map(e => ({
        type: e.type,
        name: e.name,
        globalId: e.globalId,
      }));
    }
    printJson(tree);
    return;
  }

  // Build query
  let q = bim.query();
  if (type) {
    const types = type.split(',');
    q = q.byType(...types);
  }
  if (propFilter) {
    // Format: "PsetName.PropName=Value" or "PsetName.PropName"
    const eqIdx = propFilter.indexOf('=');
    const dotIdx = propFilter.indexOf('.');
    if (dotIdx > 0) {
      const psetName = propFilter.slice(0, dotIdx);
      if (eqIdx > dotIdx) {
        const propName = propFilter.slice(dotIdx + 1, eqIdx);
        const value = propFilter.slice(eqIdx + 1);
        q = q.where(psetName, propName, '=', value);
      } else {
        const propName = propFilter.slice(dotIdx + 1);
        q = q.where(psetName, propName, 'exists');
      }
    }
  }
  if (limit) q = q.limit(parseInt(limit, 10));
  if (offset) q = q.offset(parseInt(offset, 10));

  if (countOnly) {
    const count = q.count();
    if (jsonOutput) {
      printJson({ count });
    } else {
      process.stdout.write(`${count}\n`);
    }
    return;
  }

  const entities = q.toArray();
  const needsDetail = showProps || showQuantities || showMaterials || showClassifications
    || showAttributes || showRelationships || showTypeProps || showDocuments || showAll;

  if (jsonOutput || needsDetail) {
    const result = entities.map(e => {
      const entry: Record<string, unknown> = {
        type: e.type,
        name: e.name,
        globalId: e.globalId,
        description: e.description || undefined,
        objectType: e.objectType || undefined,
      };
      if (showAttributes || showAll) entry.attributes = bim.attributes(e.ref);
      if (showProps || showAll) entry.properties = bim.properties(e.ref);
      if (showQuantities || showAll) entry.quantities = bim.quantities(e.ref);
      if (showMaterials || showAll) entry.materials = bim.materials(e.ref);
      if (showClassifications || showAll) entry.classifications = bim.classifications(e.ref);
      if (showTypeProps || showAll) entry.typeProperties = bim.typeProperties(e.ref);
      if (showDocuments || showAll) entry.documents = bim.documents(e.ref);
      if (showRelationships || showAll) entry.relationships = bim.relationships(e.ref);
      return entry;
    });
    printJson(result);
    return;
  }

  // Table output
  const rows = entities.map(e => [e.type, e.name, e.globalId]);
  process.stdout.write(formatTable(['Type', 'Name', 'GlobalId'], rows) + '\n');
  process.stderr.write(`\n${entities.length} entities\n`);
}
