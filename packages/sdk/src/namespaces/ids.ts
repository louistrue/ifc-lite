/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.ids — IDS validation
 *
 * Exposes parsing, validation, and reporting for IDS (Information Delivery Specification).
 * Uses dynamic imports to @ifc-lite/ids.
 */

export interface IDSValidationSummary {
  totalSpecifications: number;
  passedSpecifications: number;
  failedSpecifications: number;
  totalEntities: number;
  passedEntities: number;
  failedEntities: number;
}

// Dynamic import helper
async function loadIDS(): Promise<Record<string, unknown>> {
  const name = '@ifc-lite/ids';
  return import(/* webpackIgnore: true */ name) as Promise<Record<string, unknown>>;
}

/** bim.ids — IDS (Information Delivery Specification) validation */
export class IDSNamespace {
  /** Parse an IDS XML document. */
  async parse(xmlContent: string): Promise<unknown> {
    const mod = await loadIDS();
    return (mod.parseIDS as (xml: string) => unknown)(xmlContent);
  }

  /** Summarize a validation report. */
  summarize(report: { specificationResults: Array<{ entityResults: Array<{ passed: boolean }> }> }): IDSValidationSummary {
    let totalSpecs = 0, passedSpecs = 0, failedSpecs = 0;
    let totalEntities = 0, passedEntities = 0, failedEntities = 0;

    for (const spec of report.specificationResults) {
      totalSpecs++;
      let specPassed = true;
      for (const entity of spec.entityResults) {
        totalEntities++;
        if (entity.passed) passedEntities++;
        else { failedEntities++; specPassed = false; }
      }
      if (specPassed) passedSpecs++;
      else failedSpecs++;
    }

    return { totalSpecifications: totalSpecs, passedSpecifications: passedSpecs, failedSpecifications: failedSpecs, totalEntities, passedEntities, failedEntities };
  }
}
