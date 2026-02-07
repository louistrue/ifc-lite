/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IDS (Information Delivery Specification) to BCF Reporter
 *
 * Creates BCF projects from IDS validation results, generating one topic
 * per failing entity with failure details as comments and viewpoints that
 * isolate and select the failing element.
 *
 * This is a pure function with no viewer/React dependencies — it can be
 * used headlessly (CLI, server-side, tests) as well as from the viewer.
 *
 * Inspired by IfcOpenShell's ifctester BCF reporter, but improved:
 * - Groups failures per entity (not per requirement×entity) to avoid topic flood
 * - Uses comments for requirement details instead of cramming into title
 * - Isolates the failing element (defaultVisibility=false)
 * - Colors the failing element red
 * - Sets topic metadata (type, status, priority, labels)
 * - Configurable grouping strategies
 */

import type { BCFProject, BCFTopic, BCFComment, BCFViewpoint } from './types.js';
import { generateUuid } from './guid.js';

// ============================================================================
// Internal BCF helpers (avoiding index.js import to prevent jszip dependency)
// ============================================================================

function createProject(name: string, version: '2.1' | '3.0'): BCFProject {
  return {
    version,
    projectId: generateUuid(),
    name,
    topics: new Map(),
  };
}

function createTopic(opts: {
  title: string;
  description?: string;
  author: string;
  topicType?: string;
  topicStatus?: string;
  priority?: string;
  labels?: string[];
}): BCFTopic {
  return {
    guid: generateUuid(),
    title: opts.title,
    description: opts.description,
    topicType: opts.topicType ?? 'Issue',
    topicStatus: opts.topicStatus ?? 'Open',
    priority: opts.priority,
    creationDate: new Date().toISOString(),
    creationAuthor: opts.author,
    labels: opts.labels,
    comments: [],
    viewpoints: [],
  };
}

function createComment(opts: { author: string; comment: string }): BCFComment {
  return {
    guid: generateUuid(),
    date: new Date().toISOString(),
    author: opts.author,
    comment: opts.comment,
  };
}

// ============================================================================
// Input types (structurally compatible with @ifc-lite/ids types, no import needed)
// ============================================================================

/** Input for the BCF reporter — structurally matches IDSValidationReport */
export interface IDSReportInput {
  /** IDS document title */
  title: string;
  /** Optional IDS document description */
  description?: string;
  /** Results per specification */
  specificationResults: IDSSpecResultInput[];
}

/** Specification result — structurally matches IDSSpecificationResult */
export interface IDSSpecResultInput {
  specification: {
    name: string;
    description?: string;
  };
  status: 'pass' | 'fail' | 'not_applicable';
  applicableCount: number;
  passedCount: number;
  failedCount: number;
  entityResults: IDSEntityResultInput[];
}

/** Entity result — structurally matches IDSEntityResult */
export interface IDSEntityResultInput {
  expressId: number;
  modelId: string;
  entityType: string;
  entityName?: string;
  globalId?: string;
  passed: boolean;
  requirementResults: IDSRequirementResultInput[];
}

/** Requirement result — structurally matches IDSRequirementResult */
export interface IDSRequirementResultInput {
  status: 'pass' | 'fail' | 'not_applicable';
  facetType: string;
  checkedDescription: string;
  failureReason?: string;
  actualValue?: string;
  expectedValue?: string;
}

// ============================================================================
// Export options
// ============================================================================

/** Options for the BCF IDS export */
export interface IDSBCFExportOptions {
  /** Author email for BCF topics (default: "ids-validator@ifc-lite") */
  author?: string;
  /** Project name (default: IDS document title) */
  projectName?: string;
  /** BCF version (default: "2.1") */
  version?: '2.1' | '3.0';
  /**
   * Topic grouping strategy:
   * - "per-entity": One topic per failing entity, requirements as comments (default)
   * - "per-specification": One topic per failing specification, entities as comments
   * - "per-requirement": One topic per (specification, requirement, entity) — like IfcOpenShell
   */
  topicGrouping?: 'per-entity' | 'per-specification' | 'per-requirement';
  /** Include passing entities as Info topics (default: false) */
  includePassingEntities?: boolean;
  /** Topic type for failures (default: "Error") */
  failureTopicType?: string;
  /** Topic type for passes (default: "Info") */
  passTopicType?: string;
  /** Maximum topics to create — safety valve for large models (default: 1000) */
  maxTopics?: number;
  /** ARGB hex color for failing elements in viewpoints (default: "FFFF3333" — red) */
  failureColor?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AUTHOR = 'ids-validator@ifc-lite';
const DEFAULT_MAX_TOPICS = 1000;
const DEFAULT_FAILURE_COLOR = 'FFFF3333'; // Semi-opaque red
const DEFAULT_FAILURE_TOPIC_TYPE = 'Error';
const DEFAULT_PASS_TOPIC_TYPE = 'Info';

// ============================================================================
// Main export function
// ============================================================================

/**
 * Create a BCF project from IDS validation results.
 *
 * Each failing entity becomes a BCF topic with:
 * - Title: "{EntityType}: {EntityName}"
 * - Description: specification context + failure summary
 * - Comments: one per failed requirement with full details
 * - Viewpoint: entity selected, isolated, colored red
 *
 * @param report - IDS validation results
 * @param options - Export configuration
 * @returns BCF project ready for writeBCF()
 */
export function createBCFFromIDSReport(
  report: IDSReportInput,
  options: IDSBCFExportOptions = {},
): BCFProject {
  const {
    author = DEFAULT_AUTHOR,
    projectName,
    version = '2.1',
    topicGrouping = 'per-entity',
    includePassingEntities = false,
    failureTopicType = DEFAULT_FAILURE_TOPIC_TYPE,
    passTopicType = DEFAULT_PASS_TOPIC_TYPE,
    maxTopics = DEFAULT_MAX_TOPICS,
    failureColor = DEFAULT_FAILURE_COLOR,
  } = options;

  const project = createProject(projectName ?? report.title, version);

  switch (topicGrouping) {
    case 'per-entity':
      buildTopicsPerEntity(project, report, {
        author,
        includePassingEntities,
        failureTopicType,
        passTopicType,
        maxTopics,
        failureColor,
      });
      break;
    case 'per-specification':
      buildTopicsPerSpecification(project, report, {
        author,
        failureTopicType,
        maxTopics,
        failureColor,
      });
      break;
    case 'per-requirement':
      buildTopicsPerRequirement(project, report, {
        author,
        failureTopicType,
        maxTopics,
        failureColor,
      });
      break;
  }

  return project;
}

// ============================================================================
// Per-entity grouping (default — recommended)
// ============================================================================

interface BuildOptions {
  author: string;
  includePassingEntities?: boolean;
  failureTopicType: string;
  passTopicType?: string;
  maxTopics: number;
  failureColor: string;
}

function buildTopicsPerEntity(
  project: BCFProject,
  report: IDSReportInput,
  opts: BuildOptions,
): void {
  let topicCount = 0;

  for (const specResult of report.specificationResults) {
    if (specResult.status === 'not_applicable') continue;

    for (const entity of specResult.entityResults) {
      if (topicCount >= opts.maxTopics) return;

      // Skip passing entities unless requested
      if (entity.passed && !opts.includePassingEntities) continue;

      const failedReqs = entity.requirementResults.filter(r => r.status === 'fail');
      const totalReqs = entity.requirementResults.filter(r => r.status !== 'not_applicable').length;

      const entityLabel = entity.entityName || `#${entity.expressId}`;
      const isFailed = !entity.passed;

      // Build topic
      const topic = createTopic({
        title: `${entity.entityType}: ${entityLabel}`,
        description: buildEntityDescription(
          specResult,
          entity,
          failedReqs.length,
          totalReqs,
        ),
        author: opts.author,
        topicType: isFailed ? opts.failureTopicType : (opts.passTopicType ?? DEFAULT_PASS_TOPIC_TYPE),
        topicStatus: isFailed ? 'Open' : 'Closed',
        priority: isFailed ? (failedReqs.length === totalReqs ? 'High' : 'Medium') : undefined,
        labels: ['IDS', specResult.specification.name],
      });

      // Add a comment per failed requirement
      for (const req of failedReqs) {
        const comment = createComment({
          author: opts.author,
          comment: buildRequirementComment(req),
        });
        topic.comments.push(comment);
      }

      // Add viewpoint with isolation + selection + coloring
      if (entity.globalId) {
        const viewpoint = buildEntityViewpoint(entity.globalId, isFailed ? opts.failureColor : undefined);
        topic.viewpoints.push(viewpoint);
      }

      project.topics.set(topic.guid, topic);
      topicCount++;
    }
  }
}

// ============================================================================
// Per-specification grouping
// ============================================================================

function buildTopicsPerSpecification(
  project: BCFProject,
  report: IDSReportInput,
  opts: Omit<BuildOptions, 'includePassingEntities' | 'passTopicType'>,
): void {
  let topicCount = 0;

  for (const specResult of report.specificationResults) {
    if (specResult.status !== 'fail') continue;
    if (topicCount >= opts.maxTopics) return;

    const failedEntities = specResult.entityResults.filter(e => !e.passed);

    const topic = createTopic({
      title: `[FAIL] ${specResult.specification.name}`,
      description: buildSpecDescription(specResult),
      author: opts.author,
      topicType: opts.failureTopicType,
      topicStatus: 'Open',
      priority: specResult.failedCount > specResult.passedCount ? 'High' : 'Medium',
      labels: ['IDS', specResult.specification.name],
    });

    // Add comments for failed entities (capped to avoid huge topics)
    const maxCommentsPerTopic = 50;
    const entitiesToComment = failedEntities.slice(0, maxCommentsPerTopic);

    for (const entity of entitiesToComment) {
      const entityLabel = entity.entityName || `#${entity.expressId}`;
      const failedReqs = entity.requirementResults.filter(r => r.status === 'fail');
      const failureSummary = failedReqs
        .map(r => r.failureReason ?? r.checkedDescription)
        .join('; ');

      const comment = createComment({
        author: opts.author,
        comment: `${entity.entityType}: ${entityLabel}${entity.globalId ? ` (${entity.globalId})` : ''}\n${failureSummary}`,
      });
      topic.comments.push(comment);
    }

    if (failedEntities.length > maxCommentsPerTopic) {
      const comment = createComment({
        author: opts.author,
        comment: `... and ${failedEntities.length - maxCommentsPerTopic} more failing entities`,
      });
      topic.comments.push(comment);
    }

    // Add viewpoint selecting all failed entities with globalIds
    const failedGuids = failedEntities
      .map(e => e.globalId)
      .filter((g): g is string => g !== undefined);

    if (failedGuids.length > 0) {
      const viewpoint = buildMultiEntityViewpoint(failedGuids, opts.failureColor);
      topic.viewpoints.push(viewpoint);
    }

    project.topics.set(topic.guid, topic);
    topicCount++;
  }
}

// ============================================================================
// Per-requirement grouping (like IfcOpenShell, but improved)
// ============================================================================

function buildTopicsPerRequirement(
  project: BCFProject,
  report: IDSReportInput,
  opts: Omit<BuildOptions, 'includePassingEntities' | 'passTopicType'>,
): void {
  let topicCount = 0;

  for (const specResult of report.specificationResults) {
    if (specResult.status !== 'fail') continue;

    for (const entity of specResult.entityResults) {
      if (entity.passed) continue;

      for (const req of entity.requirementResults) {
        if (req.status !== 'fail') continue;
        if (topicCount >= opts.maxTopics) return;

        const entityLabel = entity.entityName || `#${entity.expressId}`;

        const topic = createTopic({
          title: `${entity.entityType}: ${entityLabel} - ${req.failureReason ?? req.checkedDescription}`,
          description: `Specification: ${specResult.specification.name}\n${specResult.specification.description ?? ''}\n\nRequirement: ${req.checkedDescription}${entity.globalId ? `\nGlobalId: ${entity.globalId}` : ''}`,
          author: opts.author,
          topicType: opts.failureTopicType,
          topicStatus: 'Open',
          labels: ['IDS', specResult.specification.name],
        });

        // Single comment with full failure detail
        const comment = createComment({
          author: opts.author,
          comment: buildRequirementComment(req),
        });
        topic.comments.push(comment);

        // Viewpoint for single entity
        if (entity.globalId) {
          const viewpoint = buildEntityViewpoint(entity.globalId, opts.failureColor);
          topic.viewpoints.push(viewpoint);
        }

        project.topics.set(topic.guid, topic);
        topicCount++;
      }
    }
  }
}

// ============================================================================
// Helpers — Description builders
// ============================================================================

function buildEntityDescription(
  specResult: IDSSpecResultInput,
  entity: IDSEntityResultInput,
  failedCount: number,
  totalCount: number,
): string {
  const lines: string[] = [];

  if (!entity.passed) {
    lines.push(`IDS Validation Failure — ${failedCount} of ${totalCount} requirements failed`);
  } else {
    lines.push('IDS Validation Passed — all requirements satisfied');
  }

  lines.push('');
  lines.push(`Specification: ${specResult.specification.name}`);
  if (specResult.specification.description) {
    lines.push(`Description: ${specResult.specification.description}`);
  }
  lines.push(`Entity Type: ${entity.entityType}`);
  if (entity.globalId) {
    lines.push(`GlobalId: ${entity.globalId}`);
  }
  if (entity.entityName) {
    lines.push(`Name: ${entity.entityName}`);
  }

  return lines.join('\n');
}

function buildSpecDescription(specResult: IDSSpecResultInput): string {
  const lines: string[] = [];

  lines.push(`IDS Specification Failure — ${specResult.failedCount} of ${specResult.applicableCount} entities failed`);

  if (specResult.specification.description) {
    lines.push('');
    lines.push(specResult.specification.description);
  }

  lines.push('');
  lines.push(`Applicable: ${specResult.applicableCount}`);
  lines.push(`Passed: ${specResult.passedCount}`);
  lines.push(`Failed: ${specResult.failedCount}`);

  return lines.join('\n');
}

function buildRequirementComment(req: IDSRequirementResultInput): string {
  const lines: string[] = [];

  lines.push(`[${req.facetType}] ${req.checkedDescription}`);

  if (req.failureReason) {
    lines.push(`Failure: ${req.failureReason}`);
  }
  if (req.expectedValue) {
    lines.push(`Expected: ${req.expectedValue}`);
  }
  if (req.actualValue) {
    lines.push(`Actual: ${req.actualValue}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Helpers — Viewpoint builders
// ============================================================================

/**
 * Build a viewpoint for a single entity: selected, isolated, colored.
 * No camera is set — the consuming viewer should zoom-to-fit on the selected entity.
 */
function buildEntityViewpoint(
  globalId: string,
  failureColor: string | undefined,
): BCFViewpoint {
  const viewpoint: BCFViewpoint = {
    guid: generateUuid(),
    components: {
      selection: [{ ifcGuid: globalId }],
      visibility: {
        defaultVisibility: false,
        exceptions: [{ ifcGuid: globalId }],
      },
    },
  };

  if (failureColor) {
    viewpoint.components!.coloring = [
      {
        color: failureColor,
        components: [{ ifcGuid: globalId }],
      },
    ];
  }

  return viewpoint;
}

/**
 * Build a viewpoint for multiple entities: all selected and visible, colored.
 * Used by per-specification grouping where one topic covers many entities.
 */
function buildMultiEntityViewpoint(
  globalIds: string[],
  failureColor: string | undefined,
): BCFViewpoint {
  const components = globalIds.map(id => ({ ifcGuid: id }));

  const viewpoint: BCFViewpoint = {
    guid: generateUuid(),
    components: {
      selection: components,
      visibility: {
        defaultVisibility: false,
        exceptions: components,
      },
    },
  };

  if (failureColor) {
    viewpoint.components!.coloring = [
      {
        color: failureColor,
        components: components,
      },
    ];
  }

  return viewpoint;
}
