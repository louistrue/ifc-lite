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
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;

  // Wait two frames so render updates after selection clear are reflected.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  try {
    return canvas.toDataURL('image/png');
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
