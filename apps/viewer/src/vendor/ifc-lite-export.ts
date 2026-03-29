/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Browser-safe viewer shim for @ifc-lite/export.
 *
 * The package root also exposes Node-oriented LOD generators. Re-export only
 * the browser-safe symbols here so Vite does not traverse Node-only modules
 * while building the viewer.
 */

export { GLTFExporter, type GLTFExportOptions } from '../../../../packages/export/src/gltf-exporter.js';
export { CSVExporter, type CSVExportOptions } from '../../../../packages/export/src/csv-exporter.js';
export {
  StepExporter,
  exportToStep,
  type StepExportOptions,
  type StepExportResult,
  type StepExportProgress,
} from '../../../../packages/export/src/step-exporter.js';
export {
  MergedExporter,
  type MergeModelInput,
  type MergeExportOptions,
  type MergeExportResult,
  type ExportProgress,
} from '../../../../packages/export/src/merged-exporter.js';
export {
  Ifc5Exporter,
  IFC5_KNOWN_PROP_NAMES,
  type Ifc5ExportOptions,
  type Ifc5ExportResult,
} from '../../../../packages/export/src/ifc5-exporter.js';
export {
  collectReferencedEntityIds,
  getVisibleEntityIds,
  collectStyleEntities,
} from '../../../../packages/export/src/reference-collector.js';
export {
  convertEntityType,
  convertStepLine,
  needsConversion,
  describeConversion,
  type IfcSchemaVersion,
} from '../../../../packages/export/src/schema-converter.js';
