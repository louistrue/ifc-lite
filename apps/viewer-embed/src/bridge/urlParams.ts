/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Parse URL parameters for the embed viewer.
 *
 * URL format:
 *   /v1?modelUrl=https://...&theme=dark&select=42,43&view=front
 */

import type { EmbedUrlParams, ViewPreset } from '@ifc-lite/embed-protocol';

const VALID_VIEWS: ViewPreset[] = ['top', 'bottom', 'front', 'back', 'left', 'right'];

export function parseUrlParams(): EmbedUrlParams {
  const params = new URLSearchParams(window.location.search);
  const result: EmbedUrlParams = {};

  const modelUrl = params.get('modelUrl');
  if (modelUrl) result.modelUrl = modelUrl;

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') result.theme = theme;

  const bg = params.get('bg');
  if (bg) result.bg = bg;

  const controls = params.get('controls');
  if (controls === 'orbit' || controls === 'pan' || controls === 'all' || controls === 'none') {
    result.controls = controls;
  }

  const autoLoad = params.get('autoLoad');
  if (autoLoad !== null) result.autoLoad = autoLoad !== 'false';

  const hideAxis = params.get('hideAxis');
  if (hideAxis === 'true') result.hideAxis = true;

  const hideScale = params.get('hideScale');
  if (hideScale === 'true') result.hideScale = true;

  const select = params.get('select');
  if (select) {
    const ids = select.split(',').map(Number).filter(n => !isNaN(n));
    if (ids.length > 0) result.select = ids;
  }

  const isolate = params.get('isolate');
  if (isolate) {
    const ids = isolate.split(',').map(Number).filter(n => !isNaN(n));
    if (ids.length > 0) result.isolate = ids;
  }

  const hideTypes = params.get('hideTypes');
  if (hideTypes) result.hideTypes = hideTypes.split(',').map(s => s.trim());

  const camera = params.get('camera');
  if (camera) {
    const parts = camera.split(',').map(Number);
    if (parts.length >= 2 && parts.every(n => !isNaN(n))) {
      result.camera = { azimuth: parts[0], elevation: parts[1], zoom: parts[2] };
    }
  }

  const view = params.get('view') as ViewPreset;
  if (VALID_VIEWS.includes(view)) result.view = view;

  return result;
}
