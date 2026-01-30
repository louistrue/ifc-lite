/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF file writer
 *
 * Creates .bcfzip files from BCFProject structure
 */

import JSZip from 'jszip';
import type {
  BCFProject,
  BCFTopic,
  BCFComment,
  BCFViewpoint,
  BCFComponents,
  BCFComponent,
  BCFVisibility,
  BCFColoring,
  BCFPerspectiveCamera,
  BCFOrthogonalCamera,
  BCFLine,
  BCFClippingPlane,
  BCFBitmap,
  BCFPoint,
  BCFDirection,
} from './types.js';
import { generateIfcGuid } from './guid.js';

/**
 * Write a BCFProject to a .bcfzip file
 *
 * @param project - BCF project to write
 * @returns Blob containing the .bcfzip file
 */
export async function writeBCF(project: BCFProject): Promise<Blob> {
  const zip = new JSZip();

  // Write version file
  writeVersionFile(zip, project.version);

  // Write project file (optional)
  if (project.projectId || project.name) {
    writeProjectFile(zip, project);
  }

  // Write topics
  for (const [guid, topic] of project.topics) {
    await writeTopicFolder(zip, topic);
  }

  // Generate zip file
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Write bcf.version file
 */
function writeVersionFile(zip: JSZip, version: '2.1' | '3.0'): void {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="${version}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="version.xsd">
  <DetailedVersion>${version}.0</DetailedVersion>
</Version>`;

  zip.file('bcf.version', content);
}

/**
 * Write project.bcfp file
 */
function writeProjectFile(zip: JSZip, project: BCFProject): void {
  const projectId = project.projectId || generateIfcGuid();
  const nameElement = project.name ? `\n  <Name>${escapeXml(project.name)}</Name>` : '';

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="project.xsd">
  <Project ProjectId="${projectId}">${nameElement}
  </Project>
</ProjectExtension>`;

  zip.file('project.bcfp', content);
}

/**
 * Write a topic folder with all its contents
 */
async function writeTopicFolder(zip: JSZip, topic: BCFTopic): Promise<void> {
  const folder = zip.folder(topic.guid);
  if (!folder) return;

  // Write markup.bcf
  writeMarkupFile(folder, topic);

  // Write viewpoints
  for (let i = 0; i < topic.viewpoints.length; i++) {
    const viewpoint = topic.viewpoints[i];
    const isDefault = i === 0;
    await writeViewpointFiles(folder, viewpoint, isDefault);
  }
}

/**
 * Write markup.bcf file
 */
function writeMarkupFile(folder: JSZip, topic: BCFTopic): void {
  let content = `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="markup.xsd">
  <Topic Guid="${topic.guid}"${topic.topicType ? ` TopicType="${escapeXml(topic.topicType)}"` : ''}${topic.topicStatus ? ` TopicStatus="${escapeXml(topic.topicStatus)}"` : ''}>
    <Title>${escapeXml(topic.title)}</Title>`;

  if (topic.description) {
    content += `\n    <Description>${escapeXml(topic.description)}</Description>`;
  }

  if (topic.priority) {
    content += `\n    <Priority>${escapeXml(topic.priority)}</Priority>`;
  }

  if (topic.index !== undefined) {
    content += `\n    <Index>${topic.index}</Index>`;
  }

  content += `\n    <CreationDate>${topic.creationDate}</CreationDate>`;
  content += `\n    <CreationAuthor>${escapeXml(topic.creationAuthor)}</CreationAuthor>`;

  if (topic.modifiedDate) {
    content += `\n    <ModifiedDate>${topic.modifiedDate}</ModifiedDate>`;
  }

  if (topic.modifiedAuthor) {
    content += `\n    <ModifiedAuthor>${escapeXml(topic.modifiedAuthor)}</ModifiedAuthor>`;
  }

  if (topic.dueDate) {
    content += `\n    <DueDate>${topic.dueDate}</DueDate>`;
  }

  if (topic.assignedTo) {
    content += `\n    <AssignedTo>${escapeXml(topic.assignedTo)}</AssignedTo>`;
  }

  if (topic.stage) {
    content += `\n    <Stage>${escapeXml(topic.stage)}</Stage>`;
  }

  if (topic.labels && topic.labels.length > 0) {
    for (const label of topic.labels) {
      content += `\n    <Labels>${escapeXml(label)}</Labels>`;
    }
  }

  if (topic.relatedTopics && topic.relatedTopics.length > 0) {
    for (const relatedGuid of topic.relatedTopics) {
      content += `\n    <RelatedTopic Guid="${relatedGuid}"/>`;
    }
  }

  content += `\n  </Topic>`;

  // Write viewpoint references
  for (let i = 0; i < topic.viewpoints.length; i++) {
    const viewpoint = topic.viewpoints[i];
    const filename = i === 0 ? 'viewpoint.bcfv' : `viewpoint_${i}.bcfv`;
    const snapshotName = i === 0 ? 'snapshot.png' : `snapshot_${i}.png`;

    content += `\n  <Viewpoints Guid="${viewpoint.guid}">`;
    content += `\n    <Viewpoint>${filename}</Viewpoint>`;
    if (viewpoint.snapshot || viewpoint.snapshotData) {
      content += `\n    <Snapshot>${snapshotName}</Snapshot>`;
    }
    content += `\n  </Viewpoints>`;
  }

  // Write comments
  for (const comment of topic.comments) {
    content += `\n  <Comment Guid="${comment.guid}">`;
    content += `\n    <Date>${comment.date}</Date>`;
    content += `\n    <Author>${escapeXml(comment.author)}</Author>`;
    content += `\n    <Comment>${escapeXml(comment.comment)}</Comment>`;
    if (comment.viewpointGuid) {
      content += `\n    <Viewpoint Guid="${comment.viewpointGuid}"/>`;
    }
    if (comment.modifiedDate) {
      content += `\n    <ModifiedDate>${comment.modifiedDate}</ModifiedDate>`;
    }
    if (comment.modifiedAuthor) {
      content += `\n    <ModifiedAuthor>${escapeXml(comment.modifiedAuthor)}</ModifiedAuthor>`;
    }
    content += `\n  </Comment>`;
  }

  content += `\n</Markup>`;

  folder.file('markup.bcf', content);
}

/**
 * Write viewpoint files (bcfv and snapshot)
 */
async function writeViewpointFiles(
  folder: JSZip,
  viewpoint: BCFViewpoint,
  isDefault: boolean
): Promise<void> {
  const filename = isDefault ? 'viewpoint.bcfv' : `viewpoint_${viewpoint.guid.substring(0, 8)}.bcfv`;
  const snapshotName = isDefault ? 'snapshot.png' : `snapshot_${viewpoint.guid.substring(0, 8)}.png`;

  // Write viewpoint XML
  let content = `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${viewpoint.guid}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="visinfo.xsd">`;

  // Write components
  if (viewpoint.components) {
    content += writeComponents(viewpoint.components);
  }

  // Write perspective camera
  if (viewpoint.perspectiveCamera) {
    content += writePerspectiveCamera(viewpoint.perspectiveCamera);
  }

  // Write orthogonal camera
  if (viewpoint.orthogonalCamera) {
    content += writeOrthogonalCamera(viewpoint.orthogonalCamera);
  }

  // Write lines
  if (viewpoint.lines && viewpoint.lines.length > 0) {
    content += `\n  <Lines>`;
    for (const line of viewpoint.lines) {
      content += writeLine(line);
    }
    content += `\n  </Lines>`;
  }

  // Write clipping planes
  if (viewpoint.clippingPlanes && viewpoint.clippingPlanes.length > 0) {
    content += `\n  <ClippingPlanes>`;
    for (const plane of viewpoint.clippingPlanes) {
      content += writeClippingPlane(plane);
    }
    content += `\n  </ClippingPlanes>`;
  }

  // Write bitmaps
  if (viewpoint.bitmaps && viewpoint.bitmaps.length > 0) {
    content += `\n  <Bitmaps>`;
    for (const bitmap of viewpoint.bitmaps) {
      content += writeBitmap(bitmap);
    }
    content += `\n  </Bitmaps>`;
  }

  content += `\n</VisualizationInfo>`;

  folder.file(filename, content);

  // Write snapshot
  if (viewpoint.snapshotData) {
    folder.file(snapshotName, viewpoint.snapshotData);
  } else if (viewpoint.snapshot && viewpoint.snapshot.startsWith('data:')) {
    // Convert data URL to binary
    const base64Data = viewpoint.snapshot.split(',')[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    folder.file(snapshotName, bytes);
  }
}

/**
 * Write components XML
 */
function writeComponents(components: BCFComponents): string {
  let content = `\n  <Components>`;

  // Write visibility
  if (components.visibility) {
    content += writeVisibility(components.visibility);
  }

  // Write selection
  if (components.selection && components.selection.length > 0) {
    content += `\n    <Selection>`;
    for (const component of components.selection) {
      content += writeComponent(component);
    }
    content += `\n    </Selection>`;
  }

  // Write coloring
  if (components.coloring && components.coloring.length > 0) {
    content += `\n    <Coloring>`;
    for (const coloring of components.coloring) {
      content += writeColoringEntry(coloring);
    }
    content += `\n    </Coloring>`;
  }

  content += `\n  </Components>`;
  return content;
}

/**
 * Write visibility XML
 */
function writeVisibility(visibility: BCFVisibility): string {
  let content = `\n    <Visibility DefaultVisibility="${visibility.defaultVisibility}">`;

  if (visibility.exceptions && visibility.exceptions.length > 0) {
    content += `\n      <Exceptions>`;
    for (const component of visibility.exceptions) {
      content += writeComponent(component, '        ');
    }
    content += `\n      </Exceptions>`;
  }

  if (visibility.viewSetupHints) {
    const hints = visibility.viewSetupHints;
    content += `\n      <ViewSetupHints`;
    if (hints.spacesVisible !== undefined) {
      content += ` SpacesVisible="${hints.spacesVisible}"`;
    }
    if (hints.spaceBoundariesVisible !== undefined) {
      content += ` SpaceBoundariesVisible="${hints.spaceBoundariesVisible}"`;
    }
    if (hints.openingsVisible !== undefined) {
      content += ` OpeningsVisible="${hints.openingsVisible}"`;
    }
    content += `/>`;
  }

  content += `\n    </Visibility>`;
  return content;
}

/**
 * Write a single component XML
 */
function writeComponent(component: BCFComponent, indent = '      '): string {
  let content = `\n${indent}<Component`;

  if (component.ifcGuid) {
    content += ` IfcGuid="${component.ifcGuid}"`;
  }
  if (component.authoringToolId) {
    content += ` AuthoringToolId="${component.authoringToolId}"`;
  }
  if (component.originatingSystem) {
    content += ` OriginatingSystem="${escapeXml(component.originatingSystem)}"`;
  }

  content += `/>`;
  return content;
}

/**
 * Write coloring entry XML
 */
function writeColoringEntry(coloring: BCFColoring): string {
  let content = `\n      <Color Color="${coloring.color}">`;
  for (const component of coloring.components) {
    content += writeComponent(component, '        ');
  }
  content += `\n      </Color>`;
  return content;
}

/**
 * Write perspective camera XML
 */
function writePerspectiveCamera(camera: BCFPerspectiveCamera): string {
  return `\n  <PerspectiveCamera>
    <CameraViewPoint>
      <X>${camera.cameraViewPoint.x}</X>
      <Y>${camera.cameraViewPoint.y}</Y>
      <Z>${camera.cameraViewPoint.z}</Z>
    </CameraViewPoint>
    <CameraDirection>
      <X>${camera.cameraDirection.x}</X>
      <Y>${camera.cameraDirection.y}</Y>
      <Z>${camera.cameraDirection.z}</Z>
    </CameraDirection>
    <CameraUpVector>
      <X>${camera.cameraUpVector.x}</X>
      <Y>${camera.cameraUpVector.y}</Y>
      <Z>${camera.cameraUpVector.z}</Z>
    </CameraUpVector>
    <FieldOfView>${camera.fieldOfView}</FieldOfView>
  </PerspectiveCamera>`;
}

/**
 * Write orthogonal camera XML
 */
function writeOrthogonalCamera(camera: BCFOrthogonalCamera): string {
  return `\n  <OrthogonalCamera>
    <CameraViewPoint>
      <X>${camera.cameraViewPoint.x}</X>
      <Y>${camera.cameraViewPoint.y}</Y>
      <Z>${camera.cameraViewPoint.z}</Z>
    </CameraViewPoint>
    <CameraDirection>
      <X>${camera.cameraDirection.x}</X>
      <Y>${camera.cameraDirection.y}</Y>
      <Z>${camera.cameraDirection.z}</Z>
    </CameraDirection>
    <CameraUpVector>
      <X>${camera.cameraUpVector.x}</X>
      <Y>${camera.cameraUpVector.y}</Y>
      <Z>${camera.cameraUpVector.z}</Z>
    </CameraUpVector>
    <ViewToWorldScale>${camera.viewToWorldScale}</ViewToWorldScale>
  </OrthogonalCamera>`;
}

/**
 * Write line XML
 */
function writeLine(line: BCFLine): string {
  return `\n    <Line>
      <StartPoint>
        <X>${line.startPoint.x}</X>
        <Y>${line.startPoint.y}</Y>
        <Z>${line.startPoint.z}</Z>
      </StartPoint>
      <EndPoint>
        <X>${line.endPoint.x}</X>
        <Y>${line.endPoint.y}</Y>
        <Z>${line.endPoint.z}</Z>
      </EndPoint>
    </Line>`;
}

/**
 * Write clipping plane XML
 */
function writeClippingPlane(plane: BCFClippingPlane): string {
  return `\n    <ClippingPlane>
      <Location>
        <X>${plane.location.x}</X>
        <Y>${plane.location.y}</Y>
        <Z>${plane.location.z}</Z>
      </Location>
      <Direction>
        <X>${plane.direction.x}</X>
        <Y>${plane.direction.y}</Y>
        <Z>${plane.direction.z}</Z>
      </Direction>
    </ClippingPlane>`;
}

/**
 * Write bitmap XML
 */
function writeBitmap(bitmap: BCFBitmap): string {
  return `\n    <Bitmap>
      <Format>${bitmap.format}</Format>
      <Reference>${escapeXml(bitmap.reference)}</Reference>
      <Location>
        <X>${bitmap.location.x}</X>
        <Y>${bitmap.location.y}</Y>
        <Z>${bitmap.location.z}</Z>
      </Location>
      <Normal>
        <X>${bitmap.normal.x}</X>
        <Y>${bitmap.normal.y}</Y>
        <Z>${bitmap.normal.z}</Z>
      </Normal>
      <Up>
        <X>${bitmap.up.x}</X>
        <Y>${bitmap.up.y}</Y>
        <Z>${bitmap.up.z}</Z>
      </Up>
      <Height>${bitmap.height}</Height>
    </Bitmap>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
