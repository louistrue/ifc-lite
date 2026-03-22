/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF 3D Overlay Renderer — pure DOM, no framework dependency.
 *
 * Renders BCFMarker3D items as positioned HTML elements overlaid on a 3D
 * canvas. Works with any renderer that implements BCFOverlayProjection.
 *
 * Features:
 *   - Markers float above referenced 3D objects
 *   - Color-coded by priority / status
 *   - Click, hover callbacks
 *   - Automatic re-projection on camera change
 *   - Connector lines from marker to anchor point
 *   - Depth-based scaling (farther markers appear smaller)
 */

import type { BCFMarker3D, BCFOverlayProjection, OverlayPoint3D } from './overlay.js';

// ============================================================================
// Constants
// ============================================================================

const MARKER_CLASS = 'bcf-overlay-marker';
const CONNECTOR_CLASS = 'bcf-overlay-connector';
const ACTIVE_CLASS = 'bcf-overlay-active';
const TOOLTIP_CLASS = 'bcf-overlay-tooltip';

const PRIORITY_COLORS: Record<string, string> = {
  high: '#f7768e',
  critical: '#f7768e',
  medium: '#ff9e64',
  normal: '#ff9e64',
  low: '#9ece6a',
};

const STATUS_ICONS: Record<string, string> = {
  open: '●',
  'in progress': '◐',
  resolved: '✓',
  closed: '○',
};

// ============================================================================
// Overlay Renderer
// ============================================================================

export interface BCFOverlayRendererOptions {
  /** Show connector lines from marker to 3D anchor (default true) */
  showConnectors?: boolean;
  /** Show tooltip on hover (default true) */
  showTooltips?: boolean;
  /** Minimum marker scale at far distance (default 0.6) */
  minScale?: number;
  /** Maximum marker scale at near distance (default 1.2) */
  maxScale?: number;
  /** Offset in pixels above the projected point (default 40) */
  verticalOffset?: number;
}

export class BCFOverlayRenderer {
  private container: HTMLDivElement;
  private svgLayer: SVGSVGElement;
  private markerElements: Map<string, HTMLDivElement> = new Map();
  private connectorElements: Map<string, SVGLineElement> = new Map();
  private markers: BCFMarker3D[] = [];
  private activeMarkerId: string | null = null;
  private projection: BCFOverlayProjection;
  private unsubCamera: (() => void) | null = null;
  private rafId: number | null = null;
  private clickCallbacks: Array<(topicGuid: string) => void> = [];
  private hoverCallbacks: Array<(topicGuid: string | null) => void> = [];
  private opts: Required<BCFOverlayRendererOptions>;
  private _visible = true;

  constructor(
    parentElement: HTMLElement,
    projection: BCFOverlayProjection,
    options?: BCFOverlayRendererOptions,
  ) {
    this.projection = projection;
    this.opts = {
      showConnectors: options?.showConnectors ?? true,
      showTooltips: options?.showTooltips ?? true,
      minScale: options?.minScale ?? 0.6,
      maxScale: options?.maxScale ?? 1.2,
      verticalOffset: options?.verticalOffset ?? 40,
    };

    // Create overlay container (positioned over the canvas)
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:20;';
    parentElement.appendChild(this.container);

    // Create SVG layer for connector lines
    this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgLayer.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    this.container.appendChild(this.svgLayer);

    // Inject shared styles once
    this.injectStyles();

    // Subscribe to camera changes
    this.unsubCamera = projection.onCameraChange(() => this.scheduleUpdate());
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Update the set of markers to display */
  setMarkers(markers: BCFMarker3D[]): void {
    this.markers = markers;

    // Remove elements for markers no longer present
    const newGuids = new Set(markers.map((m) => m.topicGuid));
    for (const [guid, el] of this.markerElements) {
      if (!newGuids.has(guid)) {
        el.remove();
        this.markerElements.delete(guid);
      }
    }
    for (const [guid, el] of this.connectorElements) {
      if (!newGuids.has(guid)) {
        el.remove();
        this.connectorElements.delete(guid);
      }
    }

    // Create/update marker elements
    for (const marker of markers) {
      if (!this.markerElements.has(marker.topicGuid)) {
        this.createMarkerElement(marker);
      } else {
        this.updateMarkerContent(marker);
      }
    }

    this.updatePositions();
  }

  /** Highlight a specific marker as active */
  setActiveMarker(topicGuid: string | null): void {
    // Remove previous active
    if (this.activeMarkerId) {
      const prev = this.markerElements.get(this.activeMarkerId);
      if (prev) prev.classList.remove(ACTIVE_CLASS);
    }

    this.activeMarkerId = topicGuid;

    // Add new active
    if (topicGuid) {
      const el = this.markerElements.get(topicGuid);
      if (el) el.classList.add(ACTIVE_CLASS);
    }
  }

  /** Show/hide the entire overlay layer */
  setVisible(visible: boolean): void {
    this._visible = visible;
    this.container.style.display = visible ? '' : 'none';
  }

  /** Register click callback */
  onMarkerClick(callback: (topicGuid: string) => void): () => void {
    this.clickCallbacks.push(callback);
    return () => {
      this.clickCallbacks = this.clickCallbacks.filter((c) => c !== callback);
    };
  }

  /** Register hover callback */
  onMarkerHover(callback: (topicGuid: string | null) => void): () => void {
    this.hoverCallbacks.push(callback);
    return () => {
      this.hoverCallbacks = this.hoverCallbacks.filter((c) => c !== callback);
    };
  }

  /** Force re-projection of all markers */
  updatePositions(): void {
    if (!this._visible) return;
    const { width, height } = this.projection.getCanvasSize();

    for (const marker of this.markers) {
      const el = this.markerElements.get(marker.topicGuid);
      if (!el) continue;

      const screen = this.projection.projectToScreen(marker.position);

      if (!screen || screen.x < -50 || screen.y < -50 || screen.x > width + 50 || screen.y > height + 50) {
        // Off-screen or behind camera
        el.style.display = 'none';
        const conn = this.connectorElements.get(marker.topicGuid);
        if (conn) conn.style.display = 'none';
        continue;
      }

      el.style.display = '';

      // Position the marker (centered horizontally, offset above)
      const markerX = screen.x;
      const markerY = screen.y - this.opts.verticalOffset;
      el.style.transform = `translate(${markerX}px, ${markerY}px) translate(-50%, -100%)`;

      // Connector line from marker bottom to 3D point
      if (this.opts.showConnectors) {
        let conn = this.connectorElements.get(marker.topicGuid);
        if (!conn) {
          conn = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          conn.classList.add(CONNECTOR_CLASS);
          this.svgLayer.appendChild(conn);
          this.connectorElements.set(marker.topicGuid, conn);
        }
        conn.style.display = '';
        conn.setAttribute('x1', String(markerX));
        conn.setAttribute('y1', String(markerY));
        conn.setAttribute('x2', String(screen.x));
        conn.setAttribute('y2', String(screen.y));

        const color = this.getPriorityColor(marker.priority);
        conn.setAttribute('stroke', color);
        conn.setAttribute('stroke-width', '1.5');
        conn.setAttribute('stroke-dasharray', '4 3');
        conn.setAttribute('stroke-opacity', '0.5');
      }
    }
  }

  /** Clean up all DOM elements and listeners */
  dispose(): void {
    if (this.unsubCamera) this.unsubCamera();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.container.remove();
    this.markerElements.clear();
    this.connectorElements.clear();
    this.clickCallbacks = [];
    this.hoverCallbacks = [];
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private scheduleUpdate(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.updatePositions();
    });
  }

  private createMarkerElement(marker: BCFMarker3D): void {
    const el = document.createElement('div');
    el.className = MARKER_CLASS;
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.style.willChange = 'transform';

    this.updateMarkerInnerHTML(el, marker);

    // Click handler
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const cb of this.clickCallbacks) cb(marker.topicGuid);
    });

    // Hover handlers
    el.addEventListener('mouseenter', () => {
      for (const cb of this.hoverCallbacks) cb(marker.topicGuid);
      const tooltip = el.querySelector(`.${TOOLTIP_CLASS}`) as HTMLElement | null;
      if (tooltip) tooltip.style.display = '';
    });
    el.addEventListener('mouseleave', () => {
      for (const cb of this.hoverCallbacks) cb(null);
      const tooltip = el.querySelector(`.${TOOLTIP_CLASS}`) as HTMLElement | null;
      if (tooltip) tooltip.style.display = 'none';
    });

    if (marker.topicGuid === this.activeMarkerId) {
      el.classList.add(ACTIVE_CLASS);
    }

    this.container.appendChild(el);
    this.markerElements.set(marker.topicGuid, el);
  }

  private updateMarkerContent(marker: BCFMarker3D): void {
    const el = this.markerElements.get(marker.topicGuid);
    if (!el) return;
    this.updateMarkerInnerHTML(el, marker);
    if (marker.topicGuid === this.activeMarkerId) {
      el.classList.add(ACTIVE_CLASS);
    } else {
      el.classList.remove(ACTIVE_CLASS);
    }
  }

  private updateMarkerInnerHTML(el: HTMLDivElement, marker: BCFMarker3D): void {
    const color = this.getPriorityColor(marker.priority);
    const statusIcon = STATUS_ICONS[marker.status.toLowerCase()] ?? '●';

    el.innerHTML = `
      <div class="bcf-marker-pin" style="--marker-color:${color};">
        <span class="bcf-marker-index">${marker.index}</span>
      </div>
      <div class="${TOOLTIP_CLASS}" style="display:none;">
        <div class="bcf-tooltip-header">
          <span class="bcf-tooltip-status" style="color:${color}">${statusIcon}</span>
          <span class="bcf-tooltip-title">${this.escapeHtml(marker.title)}</span>
        </div>
        <div class="bcf-tooltip-meta">
          ${marker.status}${marker.commentCount > 0 ? ` · ${marker.commentCount} comment${marker.commentCount !== 1 ? 's' : ''}` : ''}
        </div>
      </div>
    `;
  }

  private getPriorityColor(priority: string): string {
    return PRIORITY_COLORS[priority.toLowerCase()] ?? '#7aa2f7';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --------------------------------------------------------------------------
  // Shared CSS (injected once per document)
  // --------------------------------------------------------------------------

  private static stylesInjected = false;

  private injectStyles(): void {
    if (BCFOverlayRenderer.stylesInjected) return;
    BCFOverlayRenderer.stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      /* BCF 3D Overlay Markers */

      .${MARKER_CLASS} {
        z-index: 21;
        transition: opacity 0.15s ease;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
      }

      .bcf-marker-pin {
        width: 28px;
        height: 28px;
        border-radius: 50% 50% 50% 0;
        background: var(--marker-color, #7aa2f7);
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid rgba(255,255,255,0.9);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .${MARKER_CLASS}:hover .bcf-marker-pin {
        transform: rotate(-45deg) scale(1.15);
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }

      .${ACTIVE_CLASS} .bcf-marker-pin {
        transform: rotate(-45deg) scale(1.2);
        box-shadow: 0 0 0 4px rgba(122,162,247,0.3), 0 4px 12px rgba(0,0,0,0.4);
        animation: bcf-pulse 2s ease-in-out infinite;
      }

      .bcf-marker-index {
        transform: rotate(45deg);
        font-size: 11px;
        font-weight: 700;
        color: white;
        font-family: ui-monospace, monospace;
        line-height: 1;
        user-select: none;
      }

      /* Tooltip */
      .${TOOLTIP_CLASS} {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 8px;
        background: #1a1b26;
        color: #a9b1d6;
        border: 1px solid #3b4261;
        padding: 8px 12px;
        min-width: 180px;
        max-width: 280px;
        font-family: ui-monospace, monospace;
        font-size: 12px;
        line-height: 1.4;
        white-space: nowrap;
        z-index: 100;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }

      .${TOOLTIP_CLASS}::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: #3b4261;
      }

      .bcf-tooltip-header {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .bcf-tooltip-status {
        font-size: 10px;
        flex-shrink: 0;
      }

      .bcf-tooltip-title {
        font-weight: 600;
        color: #c0caf5;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bcf-tooltip-meta {
        margin-top: 4px;
        font-size: 10px;
        color: #565f89;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      /* Connector lines */
      .${CONNECTOR_CLASS} {
        pointer-events: none;
      }

      /* Pulse animation for active marker */
      @keyframes bcf-pulse {
        0%, 100% { box-shadow: 0 0 0 4px rgba(122,162,247,0.3), 0 4px 12px rgba(0,0,0,0.4); }
        50% { box-shadow: 0 0 0 8px rgba(122,162,247,0.1), 0 4px 12px rgba(0,0,0,0.4); }
      }
    `;
    document.head.appendChild(style);
  }
}
