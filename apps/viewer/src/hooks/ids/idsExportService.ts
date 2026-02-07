/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IDS Export Service
 *
 * Pure functions that generate downloadable JSON and HTML reports
 * from IDS validation results. No React dependencies.
 */

import type { IDSValidationReport, SupportedLocale } from '@ifc-lite/ids';

// ============================================================================
// JSON Export
// ============================================================================

/**
 * Generate a JSON export object from a validation report.
 * Returns a plain object suitable for JSON.stringify.
 */
export function buildReportJSON(report: IDSValidationReport): Record<string, unknown> {
  return {
    document: report.document,
    modelInfo: report.modelInfo,
    timestamp: report.timestamp.toISOString(),
    summary: report.summary,
    specificationResults: report.specificationResults.map(spec => ({
      specification: spec.specification,
      status: spec.status,
      applicableCount: spec.applicableCount,
      passedCount: spec.passedCount,
      failedCount: spec.failedCount,
      passRate: spec.passRate,
      entityResults: spec.entityResults.map(entity => ({
        expressId: entity.expressId,
        modelId: entity.modelId,
        entityType: entity.entityType,
        entityName: entity.entityName,
        globalId: entity.globalId,
        passed: entity.passed,
        requirementResults: entity.requirementResults.map(req => ({
          requirement: req.requirement,
          status: req.status,
          facetType: req.facetType,
          checkedDescription: req.checkedDescription,
          failureReason: req.failureReason,
          actualValue: req.actualValue,
          expectedValue: req.expectedValue,
        })),
      })),
    })),
  };
}

/**
 * Trigger a JSON report download in the browser.
 */
export function downloadReportJSON(report: IDSValidationReport): void {
  const exportData = buildReportJSON(report);
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = globalThis.document.createElement('a');
  a.href = url;
  a.download = `ids-report-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// HTML Export
// ============================================================================

/** HTML escape helper to prevent XSS */
function escapeHtml(str: string | undefined | null): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Map a status string to an inline CSS color style */
function statusClass(status: string): string {
  if (status === 'pass') return 'color: #22c55e;';
  if (status === 'fail') return 'color: #ef4444;';
  return 'color: #eab308;';
}

/**
 * Generate a complete HTML report string from a validation report.
 */
export function buildReportHTML(report: IDSValidationReport, locale: SupportedLocale): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IDS Validation Report - ${escapeHtml(report.document.info.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1, h2, h3 { margin-top: 0; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; }
    .summary-item { text-align: center; padding: 16px; background: #f9fafb; border-radius: 8px; }
    .summary-item .value { font-size: 24px; font-weight: bold; }
    .summary-item .label { color: #6b7280; font-size: 14px; }
    .pass { color: #22c55e; }
    .fail { color: #ef4444; }
    .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; transition: width 0.3s; }
    .spec-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; }
    .spec-header { padding: 16px; cursor: pointer; }
    .spec-header:hover { background: #f9fafb; }
    .entity-list { border-top: 1px solid #e5e7eb; max-height: 400px; overflow-y: auto; }
    .entity-row { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
    .entity-row:last-child { border-bottom: none; }
    .requirement { font-size: 13px; padding: 4px 0; color: #6b7280; }
    .failure-reason { color: #ef4444; font-size: 12px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(report.document.info.title)}</h1>
    ${report.document.info.description ? `<p>${escapeHtml(report.document.info.description)}</p>` : ''}
    <p><strong>Model:</strong> ${escapeHtml(report.modelInfo.modelId)} | <strong>Schema:</strong> ${escapeHtml(report.modelInfo.schemaVersion)} | <strong>Date:</strong> ${escapeHtml(report.timestamp.toLocaleString())}</p>
  </div>

  <div class="card">
    <h2>Summary</h2>
    <div class="summary">
      <div class="summary-item">
        <div class="value">${report.summary.totalSpecifications}</div>
        <div class="label">Specifications</div>
      </div>
      <div class="summary-item">
        <div class="value pass">${report.summary.passedSpecifications}</div>
        <div class="label">Passed</div>
      </div>
      <div class="summary-item">
        <div class="value fail">${report.summary.failedSpecifications}</div>
        <div class="label">Failed</div>
      </div>
      <div class="summary-item">
        <div class="value">${report.summary.totalEntitiesChecked}</div>
        <div class="label">Entities Checked</div>
      </div>
      <div class="summary-item">
        <div class="value">${report.summary.overallPassRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Specifications</h2>
    ${report.specificationResults.map(spec => `
      <div class="spec-card">
        <div class="spec-header">
          <h3 style="${statusClass(spec.status)}">${spec.status === 'pass' ? '\u2713' : '\u2717'} ${escapeHtml(spec.specification.name)}</h3>
          ${spec.specification.description ? `<p style="margin: 8px 0; color: #6b7280;">${escapeHtml(spec.specification.description)}</p>` : ''}
          <div style="display: flex; gap: 16px; font-size: 14px; color: #6b7280;">
            <span>${spec.applicableCount} entities</span>
            <span class="pass">${spec.passedCount} passed</span>
            <span class="fail">${spec.failedCount} failed</span>
          </div>
          <div class="progress-bar" style="margin-top: 8px;">
            <div class="progress-fill" style="width: ${spec.passRate}%; background: ${spec.passRate >= 80 ? '#22c55e' : spec.passRate >= 50 ? '#eab308' : '#ef4444'};"></div>
          </div>
        </div>
        ${spec.entityResults.length > 0 ? `
        <div class="entity-list">
          ${spec.entityResults.slice(0, 50).map(entity => `
            <div class="entity-row">
              <div style="${statusClass(entity.passed ? 'pass' : 'fail')}">
                ${entity.passed ? '\u2713' : '\u2717'} <strong>${escapeHtml(entity.entityName) || '#' + entity.expressId}</strong>
                <span style="color: #6b7280; font-size: 13px;"> - ${escapeHtml(entity.entityType)}${entity.globalId ? ' \u00b7 ' + escapeHtml(entity.globalId) : ''}</span>
              </div>
              ${entity.requirementResults.filter(r => r.status === 'fail').map(req => `
                <div class="requirement">
                  ${escapeHtml(req.checkedDescription)}
                  ${req.failureReason ? `<div class="failure-reason">${escapeHtml(req.failureReason)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
          ${spec.entityResults.length > 50 ? `<div class="entity-row" style="text-align: center; color: #6b7280;">... and ${spec.entityResults.length - 50} more entities</div>` : ''}
        </div>
        ` : ''}
      </div>
    `).join('')}
  </div>

  <footer style="text-align: center; color: #6b7280; padding: 20px;">
    Generated by IFC-Lite IDS Validator
  </footer>
</body>
</html>`;
}

/**
 * Trigger an HTML report download in the browser.
 */
export function downloadReportHTML(report: IDSValidationReport, locale: SupportedLocale): void {
  const html = buildReportHTML(report, locale);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = globalThis.document.createElement('a');
  a.href = url;
  a.download = `ids-report-${new Date().toISOString().split('T')[0]}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
