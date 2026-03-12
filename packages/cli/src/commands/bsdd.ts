/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite bsdd <subcommand> [options]
 *
 * Query the buildingSMART Data Dictionary (bSDD) for IFC class info,
 * property sets, and search for related classifications.
 *
 * Subcommands:
 *   class    <IfcType>    Get class info and properties
 *   search   <query>      Search bSDD for classes
 *   psets    <IfcType>    List standard property sets
 *   qsets    <IfcType>    List standard quantity sets
 */

import { hasFlag, fatal, printJson } from '../output.js';

export async function bsddCommand(args: string[]): Promise<void> {
  const subcommand = args.find(a => !a.startsWith('-'));
  if (!subcommand) fatal('Usage: ifc-lite bsdd <class|search|psets|qsets> <type-or-query>');

  const jsonOutput = hasFlag(args, '--json');
  const positional = args.filter(a => !a.startsWith('-'));

  // Lazy-load BsddNamespace to avoid importing SDK at startup
  const { BsddNamespace } = await import('@ifc-lite/sdk');
  const bsdd = new BsddNamespace();

  switch (subcommand) {
    case 'class': {
      const ifcType = positional[1];
      if (!ifcType) fatal('Usage: ifc-lite bsdd class <IfcType>');
      const info = await bsdd.fetchClassInfo(ifcType);
      if (!info) fatal(`No bSDD info found for ${ifcType}`);
      printJson(info);
      break;
    }
    case 'search': {
      const query = positional[1];
      if (!query) fatal('Usage: ifc-lite bsdd search <query>');
      const results = await bsdd.search(query);
      printJson(results);
      break;
    }
    case 'psets': {
      const ifcType = positional[1];
      if (!ifcType) fatal('Usage: ifc-lite bsdd psets <IfcType>');
      const psets = await bsdd.getPropertySets(ifcType);
      const obj: Record<string, unknown[]> = {};
      for (const [name, props] of psets) {
        obj[name] = props;
      }
      printJson(obj);
      break;
    }
    case 'qsets': {
      const ifcType = positional[1];
      if (!ifcType) fatal('Usage: ifc-lite bsdd qsets <IfcType>');
      const qsets = await bsdd.getQuantitySets(ifcType);
      const obj: Record<string, unknown[]> = {};
      for (const [name, props] of qsets) {
        obj[name] = props;
      }
      printJson(obj);
      break;
    }
    default:
      fatal(`Unknown bsdd subcommand: ${subcommand}. Use: class, search, psets, qsets`);
  }
}
