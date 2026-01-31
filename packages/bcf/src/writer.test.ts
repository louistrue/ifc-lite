/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { writeBCF } from './writer.js';
import { readBCF } from './reader.js';
import type { BCFProject, BCFTopic, BCFViewpoint } from './types.js';
import { generateUuid } from './guid.js';

// Helper to convert Blob to ArrayBuffer for Node.js environment
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

describe('BCF Writer', () => {
  it('should create valid bcf.version file', async () => {
    const project: BCFProject = {
      version: '2.1',
      topics: new Map(),
    };

    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    const versionContent = await zip.file('bcf.version')?.async('string');
    expect(versionContent).toContain('VersionId="2.1"');
    expect(versionContent).toContain('<DetailedVersion>2.1</DetailedVersion>');
    expect(versionContent).toContain('xmlns:xsd');
  });

  it('should create project.bcfp file when project has name', async () => {
    const project: BCFProject = {
      version: '2.1',
      name: 'Test Project',
      projectId: 'test-project-id',
      topics: new Map(),
    };

    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    const projectContent = await zip.file('project.bcfp')?.async('string');
    expect(projectContent).toContain('Test Project');
    expect(projectContent).toContain('test-project-id');
  });

  it('should create topic folder with markup.bcf', async () => {
    const topicGuid = generateUuid();
    const topic: BCFTopic = {
      guid: topicGuid,
      title: 'Test Topic',
      creationDate: new Date().toISOString(),
      creationAuthor: 'test@example.com',
      viewpoints: [],
      comments: [],
    };

    const project: BCFProject = {
      version: '2.1',
      topics: new Map([[topicGuid, topic]]),
    };

    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    const markupContent = await zip.file(`${topicGuid}/markup.bcf`)?.async('string');
    expect(markupContent).toContain('Test Topic');
    expect(markupContent).toContain(`Guid="${topicGuid}"`);
  });

  it('should use consistent filenames between markup and viewpoint files', async () => {
    const topicGuid = generateUuid();
    const viewpointGuid = generateUuid();

    const viewpoint: BCFViewpoint = {
      guid: viewpointGuid,
      perspectiveCamera: {
        cameraViewPoint: { x: 0, y: 0, z: 10 },
        cameraDirection: { x: 0, y: 0, z: -1 },
        cameraUpVector: { x: 0, y: 1, z: 0 },
        fieldOfView: 60,
      },
    };

    const topic: BCFTopic = {
      guid: topicGuid,
      title: 'Viewpoint Test',
      creationDate: new Date().toISOString(),
      creationAuthor: 'test@example.com',
      viewpoints: [viewpoint],
      comments: [],
    };

    const project: BCFProject = {
      version: '2.1',
      topics: new Map([[topicGuid, topic]]),
    };

    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    // Check markup references
    const markupContent = await zip.file(`${topicGuid}/markup.bcf`)?.async('string');
    expect(markupContent).toContain(`<Viewpoint>Viewpoint_${viewpointGuid}.bcfv</Viewpoint>`);

    // Check actual viewpoint file exists with same name
    const viewpointFile = zip.file(`${topicGuid}/Viewpoint_${viewpointGuid}.bcfv`);
    expect(viewpointFile).not.toBeNull();

    const viewpointContent = await viewpointFile?.async('string');
    expect(viewpointContent).toContain(`Guid="${viewpointGuid}"`);
    expect(viewpointContent).toContain('PerspectiveCamera');
  });

  it('should use consistent snapshot filenames', async () => {
    const topicGuid = generateUuid();
    const viewpointGuid = generateUuid();

    const viewpoint: BCFViewpoint = {
      guid: viewpointGuid,
      perspectiveCamera: {
        cameraViewPoint: { x: 0, y: 0, z: 10 },
        cameraDirection: { x: 0, y: 0, z: -1 },
        cameraUpVector: { x: 0, y: 1, z: 0 },
        fieldOfView: 60,
      },
      // Minimal PNG data (1x1 pixel)
      snapshotData: new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
    };

    const topic: BCFTopic = {
      guid: topicGuid,
      title: 'Snapshot Test',
      creationDate: new Date().toISOString(),
      creationAuthor: 'test@example.com',
      viewpoints: [viewpoint],
      comments: [],
    };

    const project: BCFProject = {
      version: '2.1',
      topics: new Map([[topicGuid, topic]]),
    };

    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    // Check markup references snapshot with correct name
    const markupContent = await zip.file(`${topicGuid}/markup.bcf`)?.async('string');
    expect(markupContent).toContain(`<Snapshot>Snapshot_${viewpointGuid}.png</Snapshot>`);

    // Check actual snapshot file exists with same name
    const snapshotFile = zip.file(`${topicGuid}/Snapshot_${viewpointGuid}.png`);
    expect(snapshotFile).not.toBeNull();
  });

  it('should handle multiple viewpoints with unique filenames', async () => {
    const topicGuid = generateUuid();
    const viewpoint1Guid = generateUuid();
    const viewpoint2Guid = generateUuid();

    const viewpoint1: BCFViewpoint = {
      guid: viewpoint1Guid,
      perspectiveCamera: {
        cameraViewPoint: { x: 0, y: 0, z: 10 },
        cameraDirection: { x: 0, y: 0, z: -1 },
        cameraUpVector: { x: 0, y: 1, z: 0 },
        fieldOfView: 60,
      },
    };

    const viewpoint2: BCFViewpoint = {
      guid: viewpoint2Guid,
      perspectiveCamera: {
        cameraViewPoint: { x: 10, y: 0, z: 0 },
        cameraDirection: { x: -1, y: 0, z: 0 },
        cameraUpVector: { x: 0, y: 1, z: 0 },
        fieldOfView: 45,
      },
    };

    const topic: BCFTopic = {
      guid: topicGuid,
      title: 'Multiple Viewpoints',
      creationDate: new Date().toISOString(),
      creationAuthor: 'test@example.com',
      viewpoints: [viewpoint1, viewpoint2],
      comments: [],
    };

    const project: BCFProject = {
      version: '2.1',
      topics: new Map([[topicGuid, topic]]),
    };

    const blob = await writeBCF(project);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));

    // Check both viewpoints exist
    expect(zip.file(`${topicGuid}/Viewpoint_${viewpoint1Guid}.bcfv`)).not.toBeNull();
    expect(zip.file(`${topicGuid}/Viewpoint_${viewpoint2Guid}.bcfv`)).not.toBeNull();

    // Check markup references both
    const markupContent = await zip.file(`${topicGuid}/markup.bcf`)?.async('string');
    expect(markupContent).toContain(`<Viewpoint>Viewpoint_${viewpoint1Guid}.bcfv</Viewpoint>`);
    expect(markupContent).toContain(`<Viewpoint>Viewpoint_${viewpoint2Guid}.bcfv</Viewpoint>`);
  });

  it('should roundtrip through reader', async () => {
    const topicGuid = generateUuid();
    const viewpointGuid = generateUuid();

    const viewpoint: BCFViewpoint = {
      guid: viewpointGuid,
      perspectiveCamera: {
        cameraViewPoint: { x: 1, y: 2, z: 3 },
        cameraDirection: { x: 0.5, y: 0.5, z: -0.707 },
        cameraUpVector: { x: 0, y: 1, z: 0 },
        fieldOfView: 60,
      },
    };

    const topic: BCFTopic = {
      guid: topicGuid,
      title: 'Roundtrip Test',
      description: 'Testing roundtrip',
      creationDate: new Date().toISOString(),
      creationAuthor: 'test@example.com',
      topicType: 'Issue',
      topicStatus: 'Open',
      viewpoints: [viewpoint],
      comments: [],
    };

    const project: BCFProject = {
      version: '2.1',
      name: 'Roundtrip Project',
      topics: new Map([[topicGuid, topic]]),
    };

    // Write
    const blob = await writeBCF(project);

    // Read back
    const arrayBuffer = await blob.arrayBuffer();
    const readProject = await readBCF(arrayBuffer);

    // Verify
    expect(readProject.version).toBe('2.1');
    expect(readProject.topics.size).toBe(1);

    const readTopic = readProject.topics.get(topicGuid);
    expect(readTopic).toBeDefined();
    expect(readTopic?.title).toBe('Roundtrip Test');
    expect(readTopic?.viewpoints.length).toBe(1);

    const readViewpoint = readTopic?.viewpoints[0];
    expect(readViewpoint?.guid).toBe(viewpointGuid);
    expect(readViewpoint?.perspectiveCamera).toBeDefined();
    expect(readViewpoint?.perspectiveCamera?.fieldOfView).toBe(60);
  });
});
