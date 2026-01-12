/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Box selection overlay for drag-to-select
 */

import { useViewerStore } from '@/store';

export function BoxSelectionOverlay() {
  const boxSelect = useViewerStore((s) => s.boxSelect);

  if (!boxSelect.isSelecting) {
    return null;
  }

  // Calculate rectangle bounds
  const left = Math.min(boxSelect.startX, boxSelect.currentX);
  const top = Math.min(boxSelect.startY, boxSelect.currentY);
  const width = Math.abs(boxSelect.currentX - boxSelect.startX);
  const height = Math.abs(boxSelect.currentY - boxSelect.startY);

  // Don't render if the box is too small
  if (width < 5 && height < 5) {
    return null;
  }

  return (
    <div
      className="fixed pointer-events-none border-2 border-primary bg-primary/10 z-30"
      style={{
        left,
        top,
        width,
        height,
      }}
    >
      {/* Corner handles for visual feedback */}
      <div className="absolute -left-1 -top-1 w-2 h-2 bg-primary rounded-full" />
      <div className="absolute -right-1 -top-1 w-2 h-2 bg-primary rounded-full" />
      <div className="absolute -left-1 -bottom-1 w-2 h-2 bg-primary rounded-full" />
      <div className="absolute -right-1 -bottom-1 w-2 h-2 bg-primary rounded-full" />

      {/* Dimensions label */}
      {(width > 50 || height > 30) && (
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded whitespace-nowrap">
          {Math.round(width)} x {Math.round(height)}
        </div>
      )}
    </div>
  );
}
