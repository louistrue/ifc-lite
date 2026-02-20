/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useViewerStore } from './index.js';

type BasketViewSource = 'selection' | 'visible' | 'hierarchy' | 'manual';

interface SelectionSnapshot {
  selectedEntityId: number | null;
  selectedEntityIds: Set<number>;
  selectedEntity: ReturnType<typeof useViewerStore.getState>['selectedEntity'];
  selectedEntitiesSet: Set<string>;
  selectedEntities: ReturnType<typeof useViewerStore.getState>['selectedEntities'];
  selectedModelId: string | null;
}

function hasSelection(snapshot: SelectionSnapshot): boolean {
  return (
    snapshot.selectedEntityId !== null ||
    snapshot.selectedEntityIds.size > 0 ||
    snapshot.selectedEntity !== null ||
    snapshot.selectedEntitiesSet.size > 0 ||
    snapshot.selectedEntities.length > 0
  );
}

function snapshotSelectionState(): SelectionSnapshot {
  const state = useViewerStore.getState();
  return {
    selectedEntityId: state.selectedEntityId,
    selectedEntityIds: new Set(state.selectedEntityIds),
    selectedEntity: state.selectedEntity ? { ...state.selectedEntity } : null,
    selectedEntitiesSet: new Set(state.selectedEntitiesSet),
    selectedEntities: state.selectedEntities.map((ref) => ({ ...ref })),
    selectedModelId: state.selectedModelId,
  };
}

function restoreSelectionState(snapshot: SelectionSnapshot): void {
  useViewerStore.setState({
    selectedEntityId: snapshot.selectedEntityId,
    selectedEntityIds: new Set(snapshot.selectedEntityIds),
    selectedEntity: snapshot.selectedEntity ? { ...snapshot.selectedEntity } : null,
    selectedEntitiesSet: new Set(snapshot.selectedEntitiesSet),
    selectedEntities: snapshot.selectedEntities.map((ref) => ({ ...ref })),
    selectedModelId: snapshot.selectedModelId,
  });
}

async function captureCanvasThumbnail(): Promise<string | null> {
  const src = document.querySelector('canvas[data-viewport="main"]') as HTMLCanvasElement | null;
  if (!src) return null;

  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  try {
    const thumb = document.createElement('canvas');
    thumb.width = 320;
    thumb.height = 180;
    const ctx = thumb.getContext('2d');
    if (!ctx) return null;

    // Preserve viewport aspect ratio while filling thumbnail bounds (crop, no stretch).
    ctx.fillStyle = '#0f0f12';
    ctx.fillRect(0, 0, thumb.width, thumb.height);

    const srcW = src.width || src.clientWidth;
    const srcH = src.height || src.clientHeight;
    if (srcW <= 0 || srcH <= 0) return null;

    const scale = Math.max(thumb.width / srcW, thumb.height / srcH);
    const drawW = Math.round(srcW * scale);
    const drawH = Math.round(srcH * scale);
    const offsetX = Math.floor((thumb.width - drawW) / 2);
    const offsetY = Math.floor((thumb.height - drawH) / 2);
    ctx.drawImage(src, offsetX, offsetY, drawW, drawH);
    return thumb.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  }
}

export async function saveBasketViewWithThumbnailFromStore(
  source: BasketViewSource = 'manual',
): Promise<string | null> {
  const before = snapshotSelectionState();
  const hadSelection = hasSelection(before);

  if (hadSelection) {
    useViewerStore.getState().clearEntitySelection();
  }

  try {
    const thumbnailDataUrl = await captureCanvasThumbnail();
    return useViewerStore.getState().saveCurrentBasketView({ source, thumbnailDataUrl });
  } finally {
    if (hadSelection) {
      restoreSelectionState(before);
    }
  }
}
