/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { createBCFFromIDSReport } from './ids-reporter.js';
import type { IDSReportInput } from './ids-reporter.js';

// ============================================================================
// Test fixtures
// ============================================================================

function createMockReport(overrides?: Partial<IDSReportInput>): IDSReportInput {
  return {
    title: 'Test IDS Report',
    description: 'Test description',
    specificationResults: [
      {
        specification: {
          name: 'Wall Fire Rating',
          description: 'All walls must have fire rating',
        },
        status: 'fail',
        applicableCount: 3,
        passedCount: 1,
        failedCount: 2,
        entityResults: [
          {
            expressId: 100,
            modelId: 'model-1',
            entityType: 'IfcWall',
            entityName: 'Basic Wall:Generic - 200mm',
            globalId: '2O2Fr$t4X7Zf8NOew3FL01',
            passed: false,
            requirementResults: [
              {
                status: 'fail',
                facetType: 'property',
                checkedDescription: 'Property FireRating must exist in Pset_WallCommon',
                failureReason: 'Property set Pset_WallCommon not found',
                actualValue: undefined,
                expectedValue: 'Pset_WallCommon.FireRating',
              },
              {
                status: 'fail',
                facetType: 'attribute',
                checkedDescription: 'Description must be provided',
                failureReason: 'Attribute Description is missing',
                actualValue: undefined,
                expectedValue: 'any value',
              },
            ],
          },
          {
            expressId: 200,
            modelId: 'model-1',
            entityType: 'IfcWall',
            entityName: 'Curtain Wall:Standard',
            globalId: '3P3Gs$u5Y8Ag9OPfx4GM02',
            passed: false,
            requirementResults: [
              {
                status: 'fail',
                facetType: 'property',
                checkedDescription: 'Property FireRating must exist in Pset_WallCommon',
                failureReason: 'Property FireRating not found',
                actualValue: undefined,
                expectedValue: 'Pset_WallCommon.FireRating',
              },
            ],
          },
          {
            expressId: 300,
            modelId: 'model-1',
            entityType: 'IfcWall',
            entityName: 'Fire Wall:REI120',
            globalId: '1A1Br$s3W6Ye7MPex2EK03',
            passed: true,
            requirementResults: [
              {
                status: 'pass',
                facetType: 'property',
                checkedDescription: 'Property FireRating must exist in Pset_WallCommon',
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createPassingReport(): IDSReportInput {
  return {
    title: 'Passing IDS Report',
    specificationResults: [
      {
        specification: { name: 'Naming Convention' },
        status: 'pass',
        applicableCount: 2,
        passedCount: 2,
        failedCount: 0,
        entityResults: [
          {
            expressId: 10,
            modelId: 'model-1',
            entityType: 'IfcDoor',
            entityName: 'Door A',
            globalId: 'GUID_DOOR_A_00000000001',
            passed: true,
            requirementResults: [
              { status: 'pass', facetType: 'attribute', checkedDescription: 'Name must exist' },
            ],
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('IDS BCF Reporter', () => {
  describe('createBCFFromIDSReport', () => {
    it('should create a BCF project with correct metadata', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      expect(project.version).toBe('2.1');
      expect(project.name).toBe('Test IDS Report');
      expect(project.projectId).toBeTruthy();
    });

    it('should allow custom project name and version', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, {
        projectName: 'Custom Project',
        version: '3.0',
      });

      expect(project.version).toBe('3.0');
      expect(project.name).toBe('Custom Project');
    });
  });

  // ==========================================================================
  // Per-entity grouping (default)
  // ==========================================================================

  describe('per-entity grouping (default)', () => {
    it('should create one topic per failing entity', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      expect(project.topics.size).toBe(2); // 2 failing entities
    });

    it('should not include passing entities by default', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const titles = [...project.topics.values()].map(t => t.title);
      expect(titles).not.toContain(expect.stringContaining('Fire Wall'));
    });

    it('should include passing entities when option is set', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { includePassingEntities: true });

      expect(project.topics.size).toBe(3); // 2 failing + 1 passing
    });

    it('should set correct topic title as EntityType: EntityName', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topics = [...project.topics.values()];
      expect(topics[0].title).toBe('IfcWall: Basic Wall:Generic - 200mm');
      expect(topics[1].title).toBe('IfcWall: Curtain Wall:Standard');
    });

    it('should fall back to expressId when entity has no name', () => {
      const report = createMockReport();
      report.specificationResults[0].entityResults[0].entityName = undefined;
      const project = createBCFFromIDSReport(report);

      const topic = [...project.topics.values()][0];
      expect(topic.title).toBe('IfcWall: #100');
    });

    it('should set topic description with spec info and failure count', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topic = [...project.topics.values()][0];
      expect(topic.description).toContain('2 of 2 requirements failed');
      expect(topic.description).toContain('Wall Fire Rating');
      expect(topic.description).toContain('IfcWall');
      expect(topic.description).toContain('2O2Fr$t4X7Zf8NOew3FL01');
    });

    it('should set topic type to Error for failures', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topic = [...project.topics.values()][0];
      expect(topic.topicType).toBe('Error');
      expect(topic.topicStatus).toBe('Open');
    });

    it('should set High priority when all requirements fail', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topics = [...project.topics.values()];
      // Entity with 2/2 failures = High
      expect(topics[0].priority).toBe('High');
      // Entity with 1/1 failure = High
      expect(topics[1].priority).toBe('High');
    });

    it('should set labels with IDS and spec name', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topic = [...project.topics.values()][0];
      expect(topic.labels).toEqual(['IDS', 'Wall Fire Rating']);
    });

    it('should create one comment per failed requirement', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topics = [...project.topics.values()];
      // First entity has 2 failed requirements
      expect(topics[0].comments.length).toBe(2);
      // Second entity has 1 failed requirement
      expect(topics[1].comments.length).toBe(1);
    });

    it('should include failure details in comments', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const comment = [...project.topics.values()][0].comments[0];
      expect(comment.comment).toContain('[property]');
      expect(comment.comment).toContain('Property FireRating must exist in Pset_WallCommon');
      expect(comment.comment).toContain('Property set Pset_WallCommon not found');
      expect(comment.comment).toContain('Expected: Pset_WallCommon.FireRating');
    });

    it('should use custom author', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { author: 'tester@example.com' });

      const topic = [...project.topics.values()][0];
      expect(topic.creationAuthor).toBe('tester@example.com');
      expect(topic.comments[0].author).toBe('tester@example.com');
    });
  });

  // ==========================================================================
  // Viewpoints
  // ==========================================================================

  describe('viewpoints', () => {
    it('should create viewpoint with entity selected', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const topic = [...project.topics.values()][0];
      expect(topic.viewpoints.length).toBe(1);

      const vp = topic.viewpoints[0];
      expect(vp.components?.selection).toHaveLength(1);
      expect(vp.components?.selection?.[0].ifcGuid).toBe('2O2Fr$t4X7Zf8NOew3FL01');
    });

    it('should isolate entity (defaultVisibility=false)', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const vp = [...project.topics.values()][0].viewpoints[0];
      expect(vp.components?.visibility?.defaultVisibility).toBe(false);
      expect(vp.components?.visibility?.exceptions).toHaveLength(1);
      expect(vp.components?.visibility?.exceptions?.[0].ifcGuid).toBe('2O2Fr$t4X7Zf8NOew3FL01');
    });

    it('should color failing entity red', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const vp = [...project.topics.values()][0].viewpoints[0];
      expect(vp.components?.coloring).toHaveLength(1);
      expect(vp.components?.coloring?.[0].color).toBe('FFFF3333');
      expect(vp.components?.coloring?.[0].components[0].ifcGuid).toBe('2O2Fr$t4X7Zf8NOew3FL01');
    });

    it('should use custom failure color', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { failureColor: 'FF0000FF' });

      const vp = [...project.topics.values()][0].viewpoints[0];
      expect(vp.components?.coloring?.[0].color).toBe('FF0000FF');
    });

    it('should not create viewpoint for entity without globalId', () => {
      const report = createMockReport();
      report.specificationResults[0].entityResults[0].globalId = undefined;
      const project = createBCFFromIDSReport(report);

      const topic = [...project.topics.values()][0];
      expect(topic.viewpoints.length).toBe(0);
    });

    it('should not have camera set (viewer should zoom-to-fit)', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const vp = [...project.topics.values()][0].viewpoints[0];
      expect(vp.perspectiveCamera).toBeUndefined();
      expect(vp.orthogonalCamera).toBeUndefined();
    });
  });

  // ==========================================================================
  // Per-specification grouping
  // ==========================================================================

  describe('per-specification grouping', () => {
    it('should create one topic per failing specification', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-specification' });

      expect(project.topics.size).toBe(1); // 1 failing spec
    });

    it('should title topic with spec name', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-specification' });

      const topic = [...project.topics.values()][0];
      expect(topic.title).toBe('[FAIL] Wall Fire Rating');
    });

    it('should include failing entity count in description', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-specification' });

      const topic = [...project.topics.values()][0];
      expect(topic.description).toContain('2 of 3 entities failed');
    });

    it('should add comments for each failing entity', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-specification' });

      const topic = [...project.topics.values()][0];
      expect(topic.comments.length).toBe(2); // 2 failing entities
    });

    it('should select all failing entities in viewpoint', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-specification' });

      const vp = [...project.topics.values()][0].viewpoints[0];
      expect(vp.components?.selection).toHaveLength(2);
    });

    it('should skip passing specifications', () => {
      const report = createPassingReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-specification' });

      expect(project.topics.size).toBe(0);
    });
  });

  // ==========================================================================
  // Per-requirement grouping
  // ==========================================================================

  describe('per-requirement grouping', () => {
    it('should create one topic per (spec, entity, requirement) failure', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-requirement' });

      // Entity 1 has 2 failures, Entity 2 has 1 failure = 3 topics
      expect(project.topics.size).toBe(3);
    });

    it('should include failure reason in title', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-requirement' });

      const topics = [...project.topics.values()];
      expect(topics[0].title).toContain('Property set Pset_WallCommon not found');
    });

    it('should include spec name in description', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { topicGrouping: 'per-requirement' });

      const topic = [...project.topics.values()][0];
      expect(topic.description).toContain('Wall Fire Rating');
    });
  });

  // ==========================================================================
  // Safety caps and edge cases
  // ==========================================================================

  describe('safety and edge cases', () => {
    it('should respect maxTopics limit', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report, { maxTopics: 1 });

      expect(project.topics.size).toBe(1);
    });

    it('should handle empty report', () => {
      const report: IDSReportInput = {
        title: 'Empty',
        specificationResults: [],
      };
      const project = createBCFFromIDSReport(report);

      expect(project.topics.size).toBe(0);
    });

    it('should handle all passing results with default options', () => {
      const report = createPassingReport();
      const project = createBCFFromIDSReport(report);

      expect(project.topics.size).toBe(0); // No failing entities
    });

    it('should handle not_applicable specifications', () => {
      const report: IDSReportInput = {
        title: 'N/A Report',
        specificationResults: [
          {
            specification: { name: 'IFC2X3 Only' },
            status: 'not_applicable',
            applicableCount: 0,
            passedCount: 0,
            failedCount: 0,
            entityResults: [],
          },
        ],
      };
      const project = createBCFFromIDSReport(report);

      expect(project.topics.size).toBe(0);
    });

    it('should generate unique GUIDs for all topics', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const guids = [...project.topics.keys()];
      expect(new Set(guids).size).toBe(guids.length);
    });

    it('should generate unique GUIDs for all viewpoints', () => {
      const report = createMockReport();
      const project = createBCFFromIDSReport(report);

      const vpGuids = [...project.topics.values()]
        .flatMap(t => t.viewpoints)
        .map(vp => vp.guid);
      expect(new Set(vpGuids).size).toBe(vpGuids.length);
    });
  });
});
