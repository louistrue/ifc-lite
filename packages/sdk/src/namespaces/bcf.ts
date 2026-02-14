/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * bim.bcf — BCF collaboration (topics, viewpoints, comments)
 *
 * Wraps @ifc-lite/bcf for reading/writing BCF files and creating
 * collaboration data structures. Uses dynamic imports.
 */

export interface TopicOptions {
  title: string;
  description?: string;
  author: string;
  topicType?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  labels?: string[];
}

export interface CommentOptions {
  author: string;
  comment: string;
}

// Dynamic import helper
async function loadBCF(): Promise<Record<string, unknown>> {
  const name = '@ifc-lite/bcf';
  return import(/* webpackIgnore: true */ name) as Promise<Record<string, unknown>>;
}

type AnyFn = (...args: unknown[]) => unknown;

/** bim.bcf — BCF (BIM Collaboration Format) */
export class BCFNamespace {
  /** Create a new BCF project. */
  async createProject(name?: string): Promise<unknown> {
    const mod = await loadBCF();
    return (mod.createBCFProject as AnyFn)({ name });
  }

  /** Create a topic. */
  async createTopic(options: TopicOptions): Promise<unknown> {
    const mod = await loadBCF();
    return (mod.createBCFTopic as AnyFn)(options);
  }

  /** Create a comment. */
  async createComment(options: CommentOptions): Promise<unknown> {
    const mod = await loadBCF();
    return (mod.createBCFComment as AnyFn)(options);
  }

  /** Read a BCF file. */
  async read(data: Blob | ArrayBuffer): Promise<unknown> {
    const mod = await loadBCF();
    return (mod.readBCF as AnyFn)(data);
  }

  /** Write a BCF project to a downloadable Blob. */
  async write(project: unknown): Promise<Blob> {
    const mod = await loadBCF();
    return (mod.writeBCF as AnyFn)(project) as Promise<Blob>;
  }

  /** Generate a new IFC GUID. */
  async generateGuid(): Promise<string> {
    const mod = await loadBCF();
    return (mod.generateIfcGuid as () => string)();
  }
}
