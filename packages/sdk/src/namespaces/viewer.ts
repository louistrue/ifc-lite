/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BimBackend, EntityRef, SectionPlane, CameraState, ProjectionMode, RGBAColor } from '../types.js';
import { hexToRgba } from '@ifc-lite/lens';

/** bim.viewer — Renderer control, camera, section planes */
export class ViewerNamespace {
  constructor(private backend: BimBackend) {}

  // ── Color overlays ─────────────────────────────────────────

  /** Colorize entities with a hex color string */
  colorize(refs: EntityRef[], color: string): void {
    const rgba = hexToRgba(color, 1.0);
    this.backend.viewer.colorize(refs, rgba);
  }

  /** Colorize with RGBA tuple [0-1] */
  colorizeRgba(refs: EntityRef[], color: RGBAColor): void {
    this.backend.viewer.colorize(refs, color);
  }

  /** Batch colorize: apply multiple entity-color pairs in a single call */
  colorizeAll(batches: Array<{ refs: EntityRef[]; color: string }>): void {
    const resolved = batches.map(b => ({ refs: b.refs, color: hexToRgba(b.color, 1.0) }));
    this.backend.viewer.colorizeAll(resolved);
  }

  /** Reset color overrides */
  resetColors(refs?: EntityRef[]): void {
    this.backend.viewer.resetColors(refs);
  }

  // ── Visibility ─────────────────────────────────────────────

  /** Hide entities */
  hide(refs: EntityRef[]): void {
    this.backend.visibility.hide(refs);
  }

  /** Show previously hidden entities */
  show(refs: EntityRef[]): void {
    this.backend.visibility.show(refs);
  }

  /** Isolate entities (hide everything else) */
  isolate(refs: EntityRef[]): void {
    this.backend.visibility.isolate(refs);
  }

  /** Reset all visibility to default */
  resetVisibility(): void {
    this.backend.visibility.reset();
  }

  // ── Selection ──────────────────────────────────────────────

  /** Set the selection to given entities */
  select(refs: EntityRef[]): void {
    this.backend.selection.set(refs);
  }

  /** Clear selection */
  deselect(): void {
    this.backend.selection.set([]);
  }

  /** Get current selection */
  getSelection(): EntityRef[] {
    return this.backend.selection.get();
  }

  // ── Camera ─────────────────────────────────────────────────

  /** Fly camera to frame the given entities */
  flyTo(refs: EntityRef[]): void {
    this.backend.viewer.flyTo(refs);
  }

  /** Set camera state */
  setCamera(state: Partial<CameraState>): void {
    this.backend.viewer.setCamera(state);
  }

  /** Get current camera state */
  getCamera(): CameraState {
    return this.backend.viewer.getCamera();
  }

  /** Switch projection mode */
  setProjection(mode: ProjectionMode): void {
    this.backend.viewer.setCamera({ mode });
  }

  // ── Section planes ─────────────────────────────────────────

  /** Set a section plane */
  setSection(section: SectionPlane): void {
    this.backend.viewer.setSection(section);
  }

  /** Get current section plane */
  getSection(): SectionPlane | null {
    return this.backend.viewer.getSection();
  }

  /** Remove section plane */
  clearSection(): void {
    this.backend.viewer.setSection(null);
  }
}
