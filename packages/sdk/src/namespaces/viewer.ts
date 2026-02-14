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
    this.backend.colorize(refs, rgba);
  }

  /** Colorize with RGBA tuple [0-1] */
  colorizeRgba(refs: EntityRef[], color: RGBAColor): void {
    this.backend.colorize(refs, color);
  }

  /** Reset color overrides */
  resetColors(refs?: EntityRef[]): void {
    this.backend.resetColors(refs);
  }

  // ── Visibility ─────────────────────────────────────────────

  /** Hide entities */
  hide(refs: EntityRef[]): void {
    this.backend.hideEntities(refs);
  }

  /** Show previously hidden entities */
  show(refs: EntityRef[]): void {
    this.backend.showEntities(refs);
  }

  /** Isolate entities (hide everything else) */
  isolate(refs: EntityRef[]): void {
    this.backend.isolateEntities(refs);
  }

  /** Reset all visibility to default */
  resetVisibility(): void {
    this.backend.resetVisibility();
  }

  // ── Selection ──────────────────────────────────────────────

  /** Set the selection to given entities */
  select(refs: EntityRef[]): void {
    this.backend.setSelection(refs);
  }

  /** Clear selection */
  deselect(): void {
    this.backend.setSelection([]);
  }

  /** Get current selection */
  getSelection(): EntityRef[] {
    return this.backend.getSelection();
  }

  // ── Camera ─────────────────────────────────────────────────

  /** Fly camera to frame the given entities */
  flyTo(refs: EntityRef[]): void {
    this.backend.flyTo(refs);
  }

  /** Set camera state */
  setCamera(state: Partial<CameraState>): void {
    this.backend.setCamera(state);
  }

  /** Get current camera state */
  getCamera(): CameraState {
    return this.backend.getCamera();
  }

  /** Switch projection mode */
  setProjection(mode: ProjectionMode): void {
    this.backend.setCamera({ mode });
  }

  // ── Section planes ─────────────────────────────────────────

  /** Set a section plane */
  setSection(section: SectionPlane): void {
    this.backend.setSection(section);
  }

  /** Get current section plane */
  getSection(): SectionPlane | null {
    return this.backend.getSection();
  }

  /** Remove section plane */
  clearSection(): void {
    this.backend.setSection(null);
  }
}
