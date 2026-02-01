/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF Reader Tests
 *
 * Tests the BCF reader against official buildingSMART test files:
 * - PerspectiveCamera.bcf - Tests perspective camera viewpoint
 * - OrthogonalCamera.bcf - Tests orthogonal camera viewpoint
 *
 * @see https://github.com/buildingSMART/BCF-XML/tree/release_3_0/Test%20Cases/v2.1
 */

import { describe, it, expect } from 'vitest';
import { readBCF } from './reader.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '..', 'test-data');

describe('BCF Reader - buildingSMART Test Files', () => {
  describe('PerspectiveCamera.bcf', () => {
    it('should parse the BCF file successfully', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      expect(project).toBeDefined();
      expect(project.version).toBe('2.1');
    });

    it('should have exactly one topic', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      expect(project.topics.size).toBe(1);
    });

    it('should have a topic with viewpoint containing perspective camera', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      expect(topic).toBeDefined();
      expect(topic.viewpoints.length).toBeGreaterThan(0);

      const viewpoint = topic.viewpoints[0];
      expect(viewpoint).toBeDefined();
      expect(viewpoint.perspectiveCamera).toBeDefined();
      expect(viewpoint.orthogonalCamera).toBeUndefined();
    });

    it('should have valid perspective camera values', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      const viewpoint = topic.viewpoints[0];
      const camera = viewpoint.perspectiveCamera!;

      // Camera view point (position)
      expect(camera.cameraViewPoint).toBeDefined();
      expect(typeof camera.cameraViewPoint.x).toBe('number');
      expect(typeof camera.cameraViewPoint.y).toBe('number');
      expect(typeof camera.cameraViewPoint.z).toBe('number');

      // Camera direction
      expect(camera.cameraDirection).toBeDefined();
      expect(typeof camera.cameraDirection.x).toBe('number');
      expect(typeof camera.cameraDirection.y).toBe('number');
      expect(typeof camera.cameraDirection.z).toBe('number');

      // Camera up vector
      expect(camera.cameraUpVector).toBeDefined();
      expect(typeof camera.cameraUpVector.x).toBe('number');
      expect(typeof camera.cameraUpVector.y).toBe('number');
      expect(typeof camera.cameraUpVector.z).toBe('number');

      // Field of view (in degrees)
      expect(camera.fieldOfView).toBeDefined();
      expect(typeof camera.fieldOfView).toBe('number');
      expect(camera.fieldOfView).toBeGreaterThan(0);
      expect(camera.fieldOfView).toBeLessThan(180);
    });

    it('should have a snapshot image', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      const viewpoint = topic.viewpoints[0];

      // The test file includes a snapshot
      expect(viewpoint.snapshot).toBeDefined();
      expect(viewpoint.snapshot).toMatch(/^data:image\/(png|jpeg);base64,/);
    });
  });

  describe('OrthogonalCamera.bcf', () => {
    it('should parse the BCF file successfully', async () => {
      const filePath = join(TEST_DATA_DIR, 'OrthogonalCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      expect(project).toBeDefined();
      expect(project.version).toBe('2.1');
    });

    it('should have exactly one topic', async () => {
      const filePath = join(TEST_DATA_DIR, 'OrthogonalCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      expect(project.topics.size).toBe(1);
    });

    it('should have a topic with viewpoint containing orthogonal camera', async () => {
      const filePath = join(TEST_DATA_DIR, 'OrthogonalCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      expect(topic).toBeDefined();
      expect(topic.viewpoints.length).toBeGreaterThan(0);

      const viewpoint = topic.viewpoints[0];
      expect(viewpoint).toBeDefined();
      expect(viewpoint.orthogonalCamera).toBeDefined();
      expect(viewpoint.perspectiveCamera).toBeUndefined();
    });

    it('should have valid orthogonal camera values', async () => {
      const filePath = join(TEST_DATA_DIR, 'OrthogonalCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      const viewpoint = topic.viewpoints[0];
      const camera = viewpoint.orthogonalCamera!;

      // Camera view point (position)
      expect(camera.cameraViewPoint).toBeDefined();
      expect(typeof camera.cameraViewPoint.x).toBe('number');
      expect(typeof camera.cameraViewPoint.y).toBe('number');
      expect(typeof camera.cameraViewPoint.z).toBe('number');

      // Camera direction
      expect(camera.cameraDirection).toBeDefined();
      expect(typeof camera.cameraDirection.x).toBe('number');
      expect(typeof camera.cameraDirection.y).toBe('number');
      expect(typeof camera.cameraDirection.z).toBe('number');

      // Camera up vector
      expect(camera.cameraUpVector).toBeDefined();
      expect(typeof camera.cameraUpVector.x).toBe('number');
      expect(typeof camera.cameraUpVector.y).toBe('number');
      expect(typeof camera.cameraUpVector.z).toBe('number');

      // View to world scale (orthogonal specific)
      expect(camera.viewToWorldScale).toBeDefined();
      expect(typeof camera.viewToWorldScale).toBe('number');
      expect(camera.viewToWorldScale).toBeGreaterThan(0);
    });

    it('should have a snapshot image', async () => {
      const filePath = join(TEST_DATA_DIR, 'OrthogonalCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      const viewpoint = topic.viewpoints[0];

      // The test file includes a snapshot
      expect(viewpoint.snapshot).toBeDefined();
      expect(viewpoint.snapshot).toMatch(/^data:image\/(png|jpeg);base64,/);
    });
  });

  describe('Common BCF structure', () => {
    it('should have valid topic GUIDs', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      for (const topic of project.topics.values()) {
        expect(topic.guid).toBeDefined();
        expect(topic.guid.length).toBeGreaterThan(0);
      }
    });

    it('should have valid viewpoint GUIDs', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      for (const topic of project.topics.values()) {
        for (const viewpoint of topic.viewpoints) {
          expect(viewpoint.guid).toBeDefined();
          expect(viewpoint.guid.length).toBeGreaterThan(0);
        }
      }
    });

    it('should have topic title', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      expect(topic.title).toBeDefined();
      expect(topic.title.length).toBeGreaterThan(0);
    });

    it('should have creation date', async () => {
      const filePath = join(TEST_DATA_DIR, 'PerspectiveCamera.bcf');
      const buffer = await readFile(filePath);
      const project = await readBCF(buffer);

      const topic = Array.from(project.topics.values())[0];
      expect(topic.creationDate).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(topic.creationDate).toString()).not.toBe('Invalid Date');
    });
  });
});
