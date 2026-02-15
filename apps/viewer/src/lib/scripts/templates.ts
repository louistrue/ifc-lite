/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in script templates for the script editor.
 *
 * Templates are real .ts files in ./templates/ that are type-checked
 * against the bim-globals.d.ts declaration. They are loaded as raw
 * strings via Vite's ?raw import and served to the sandbox transpiler.
 */

// Raw source imports — Vite returns the file content as a string
import modelOverview from './templates/model-overview.ts?raw';
import colorByType from './templates/color-by-type.ts?raw';
import structuralAnalysis from './templates/structural-analysis.ts?raw';
import propertyFinder from './templates/property-finder.ts?raw';
import exportCsv from './templates/export-csv.ts?raw';
import isolateByType from './templates/isolate-by-type.ts?raw';
import doorWindowSchedule from './templates/door-window-schedule.ts?raw';
import resetView from './templates/reset-view.ts?raw';

export interface ScriptTemplate {
  name: string;
  description: string;
  code: string;
}

/** Strip the `export {}` module boundary line that enables type checking */
function stripModuleLine(raw: string): string {
  return raw.replace(/^export \{\}[^\n]*\n\n?/, '');
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    name: 'Model overview',
    description: 'Summarize models, count entities by type, compute statistics',
    code: stripModuleLine(modelOverview),
  },
  {
    name: 'Color by IFC type',
    description: 'Assign unique colors to each product type (batch colorize)',
    code: stripModuleLine(colorByType),
  },
  {
    name: 'Structural analysis',
    description: 'Analyze walls, slabs, columns with properties and color by material',
    code: stripModuleLine(structuralAnalysis),
  },
  {
    name: 'Property finder',
    description: 'Search for entities with specific property values',
    code: stripModuleLine(propertyFinder),
  },
  {
    name: 'Export to CSV',
    description: 'Export entity data with properties to CSV file download',
    code: stripModuleLine(exportCsv),
  },
  {
    name: 'Isolate by type',
    description: 'Isolate walls, doors, or windows — change the type to explore',
    code: stripModuleLine(isolateByType),
  },
  {
    name: 'Door & window schedule',
    description: 'Generate a schedule listing all doors and windows with dimensions',
    code: stripModuleLine(doorWindowSchedule),
  },
  {
    name: 'Reset view',
    description: 'Remove all color overrides and show all entities',
    code: stripModuleLine(resetView),
  },
];
