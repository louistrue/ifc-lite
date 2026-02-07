/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React, { useRef, useState, useEffect } from 'react';
import {
  GraphicOverrideEngine,
  calculateDrawingTransform,
  type Drawing2D,
  type ElementData,
} from '@ifc-lite/drawing-2d';

// Fill colors for IFC types (architectural convention)
const IFC_TYPE_FILL_COLORS: Record<string, string> = {
  // Structural elements - solid gray
  IfcWall: '#b0b0b0',
  IfcWallStandardCase: '#b0b0b0',
  IfcColumn: '#909090',
  IfcBeam: '#909090',
  IfcSlab: '#c8c8c8',
  IfcRoof: '#d0d0d0',
  IfcFooting: '#808080',
  IfcPile: '#707070',

  // Windows/Doors - lighter
  IfcWindow: '#e8f4fc',
  IfcDoor: '#f5e6d3',

  // Stairs/Railings
  IfcStair: '#d8d8d8',
  IfcStairFlight: '#d8d8d8',
  IfcRailing: '#c0c0c0',

  // MEP - distinct colors
  IfcPipeSegment: '#a0d0ff',
  IfcDuctSegment: '#c0ffc0',

  // Furniture
  IfcFurnishingElement: '#ffe0c0',

  // Spaces (usually not shown in section)
  IfcSpace: '#f0f0f0',

  // Default
  default: '#d0d0d0',
};

export function getFillColorForType(ifcType: string): string {
  return IFC_TYPE_FILL_COLORS[ifcType] || IFC_TYPE_FILL_COLORS.default;
}

// Static style constant to avoid creating new object on every render
const CANVAS_STYLE = { imageRendering: 'crisp-edges' as const };

export interface Measure2DResultData {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  distance: number;
}

interface Drawing2DCanvasProps {
  drawing: Drawing2D;
  transform: { x: number; y: number; scale: number };
  showHiddenLines: boolean;
  overrideEngine: GraphicOverrideEngine;
  overridesEnabled: boolean;
  entityColorMap: Map<number, [number, number, number, number]>;
  useIfcMaterials: boolean;
  // Measure tool props
  measureMode?: boolean;
  measureStart?: { x: number; y: number } | null;
  measureCurrent?: { x: number; y: number } | null;
  measureResults?: Measure2DResultData[];
  measureSnapPoint?: { x: number; y: number } | null;
  // Sheet mode props
  sheetEnabled?: boolean;
  activeSheet?: import('@ifc-lite/drawing-2d').DrawingSheet | null;
  // Section plane info for axis-specific rendering
  sectionAxis: 'down' | 'front' | 'side';
  // Pinned mode - keep model fixed in place on sheet
  isPinned?: boolean;
  cachedSheetTransformRef?: React.MutableRefObject<{ translateX: number; translateY: number; scaleFactor: number } | null>;
}

export function Drawing2DCanvas({
  drawing,
  transform,
  showHiddenLines,
  overrideEngine,
  overridesEnabled,
  entityColorMap,
  useIfcMaterials,
  measureMode = false,
  measureStart = null,
  measureCurrent = null,
  measureResults = [],
  measureSnapPoint = null,
  sheetEnabled = false,
  activeSheet = null,
  sectionAxis,
  isPinned = false,
  cachedSheetTransformRef,
}: Drawing2DCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // ResizeObserver to track canvas size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize((prev) => {
          // Only update if size actually changed to avoid render loops
          if (prev.width !== width || prev.height !== height) {
            return { width, height };
          }
          return prev;
        });
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size using tracked dimensions
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear with light gray background (shows paper edge when in sheet mode)
    ctx.fillStyle = sheetEnabled && activeSheet ? '#e5e5e5' : '#ffffff';
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET MODE: Render paper, frame, title block, then drawing in viewport
    // ═══════════════════════════════════════════════════════════════════════
    if (sheetEnabled && activeSheet) {
      const paper = activeSheet.paper;
      const frame = activeSheet.frame;
      const titleBlock = activeSheet.titleBlock;
      const viewport = activeSheet.viewportBounds;
      const scaleBar = activeSheet.scaleBar;
      const northArrow = activeSheet.northArrow;

      // Helper: convert sheet mm to screen pixels
      const mmToScreen = (mm: number) => mm * transform.scale;
      const mmToScreenX = (x: number) => x * transform.scale + transform.x;
      const mmToScreenY = (y: number) => y * transform.scale + transform.y;

      // ─────────────────────────────────────────────────────────────────────
      // 1. Draw paper background (white with shadow)
      // ─────────────────────────────────────────────────────────────────────
      ctx.save();
      // Paper shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 10 * (transform.scale > 0.5 ? 1 : transform.scale * 2);
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        mmToScreenX(0),
        mmToScreenY(0),
        mmToScreen(paper.widthMm),
        mmToScreen(paper.heightMm)
      );
      ctx.restore();

      // Paper border
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        mmToScreenX(0),
        mmToScreenY(0),
        mmToScreen(paper.widthMm),
        mmToScreen(paper.heightMm)
      );

      // ─────────────────────────────────────────────────────────────────────
      // 2. Draw frame borders
      // ─────────────────────────────────────────────────────────────────────
      const frameLeft = frame.margins.left + frame.margins.bindingMargin;
      const frameTop = frame.margins.top;
      const frameRight = paper.widthMm - frame.margins.right;
      const frameBottom = paper.heightMm - frame.margins.bottom;
      const frameWidth = frameRight - frameLeft;
      const frameHeight = frameBottom - frameTop;

      // Outer border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, mmToScreen(frame.border.outerLineWeight));
      ctx.strokeRect(
        mmToScreenX(frameLeft),
        mmToScreenY(frameTop),
        mmToScreen(frameWidth),
        mmToScreen(frameHeight)
      );

      // Inner border (if gap > 0)
      if (frame.border.borderGap > 0) {
        const innerLeft = frameLeft + frame.border.borderGap;
        const innerTop = frameTop + frame.border.borderGap;
        const innerWidth = frameWidth - 2 * frame.border.borderGap;
        const innerHeight = frameHeight - 2 * frame.border.borderGap;

        ctx.lineWidth = Math.max(0.5, mmToScreen(frame.border.innerLineWeight));
        ctx.strokeRect(
          mmToScreenX(innerLeft),
          mmToScreenY(innerTop),
          mmToScreen(innerWidth),
          mmToScreen(innerHeight)
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // 3. Draw title block
      // ─────────────────────────────────────────────────────────────────────
      const innerLeft = frameLeft + frame.border.borderGap;
      const innerTop = frameTop + frame.border.borderGap;
      const innerWidth = frameWidth - 2 * frame.border.borderGap;
      const innerHeight = frameHeight - 2 * frame.border.borderGap;

      let tbX: number, tbY: number, tbW: number, tbH: number;
      switch (titleBlock.position) {
        case 'bottom-right':
          tbW = titleBlock.widthMm;
          tbH = titleBlock.heightMm;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop + innerHeight - tbH;
          break;
        case 'bottom-full':
          tbW = innerWidth;
          tbH = titleBlock.heightMm;
          tbX = innerLeft;
          tbY = innerTop + innerHeight - tbH;
          break;
        case 'right-strip':
          tbW = titleBlock.widthMm;
          tbH = innerHeight;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop;
          break;
        default:
          tbW = titleBlock.widthMm;
          tbH = titleBlock.heightMm;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop + innerHeight - tbH;
      }

      // Title block border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, mmToScreen(titleBlock.borderWeight));
      ctx.strokeRect(
        mmToScreenX(tbX),
        mmToScreenY(tbY),
        mmToScreen(tbW),
        mmToScreen(tbH)
      );

      // Title block fields - calculate row heights based on font sizes
      const logoSpace = titleBlock.logo ? 50 : 0;
      const revisionSpace = titleBlock.showRevisionHistory ? 20 : 0;
      const availableWidth = tbW - logoSpace - 5;
      const availableHeight = tbH - revisionSpace - 4;
      const numCols = 2;

      // Group fields by row
      const fieldsByRow = new Map<number, typeof titleBlock.fields>();
      for (const field of titleBlock.fields) {
        const row = field.row ?? 0;
        if (!fieldsByRow.has(row)) fieldsByRow.set(row, []);
        fieldsByRow.get(row)!.push(field);
      }

      // Calculate minimum height needed for each row based on its largest font
      const rowCount = Math.max(...Array.from(fieldsByRow.keys()), 0) + 1;
      const rowHeights: number[] = [];
      let totalMinHeight = 0;

      for (let r = 0; r < rowCount; r++) {
        const fields = fieldsByRow.get(r) || [];
        const maxFontSize = fields.length > 0 ? Math.max(...fields.map(f => f.fontSize)) : 3;
        const labelSize = Math.min(maxFontSize * 0.5, 2.2);
        const minRowHeight = labelSize + 1 + maxFontSize + 2;
        rowHeights.push(minRowHeight);
        totalMinHeight += minRowHeight;
      }

      // Scale row heights if they exceed available space
      const rowScaleFactor = totalMinHeight > availableHeight ? availableHeight / totalMinHeight : 1;
      const scaledRowHeights = rowHeights.map(h => h * rowScaleFactor);

      const colWidth = availableWidth / numCols;
      const gridStartX = tbX + logoSpace + 2;
      const gridStartY = tbY + 2;

      // Calculate row Y positions
      const rowYPositions: number[] = [gridStartY];
      for (let i = 0; i < scaledRowHeights.length - 1; i++) {
        rowYPositions.push(rowYPositions[i] + scaledRowHeights[i]);
      }

      // Draw grid lines
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(0.5, mmToScreen(titleBlock.gridWeight));

      // Horizontal lines
      for (let i = 1; i < rowCount; i++) {
        const lineY = rowYPositions[i];
        ctx.beginPath();
        ctx.moveTo(mmToScreenX(gridStartX), mmToScreenY(lineY));
        ctx.lineTo(mmToScreenX(gridStartX + availableWidth - 4), mmToScreenY(lineY));
        ctx.stroke();
      }

      // Vertical dividers (for rows with multiple columns)
      for (const [row, fields] of fieldsByRow) {
        const hasMultipleCols = fields.some(f => (f.colSpan ?? 1) < 2);
        if (hasMultipleCols) {
          const centerX = gridStartX + colWidth;
          const lineY1 = rowYPositions[row];
          const lineY2 = rowYPositions[row] + scaledRowHeights[row];
          ctx.beginPath();
          ctx.moveTo(mmToScreenX(centerX), mmToScreenY(lineY1));
          ctx.lineTo(mmToScreenX(centerX), mmToScreenY(lineY2));
          ctx.stroke();
        }
      }

      // Render field text - scale proportionally with zoom
      for (const [row, fields] of fieldsByRow) {
        const rowY = rowYPositions[row];
        if (rowY === undefined) continue;

        const rowH = scaledRowHeights[row] ?? 5;
        const screenRowH = mmToScreen(rowH);

        // Skip if row is too small to be readable
        if (screenRowH < 4) continue;

        for (const field of fields) {
          const col = field.col ?? 0;
          const fieldX = gridStartX + col * colWidth + 1.5;

          // Calculate font sizes in mm (accounting for compressed rows)
          const effectiveScale = rowScaleFactor < 1 ? rowScaleFactor : 1;
          const labelFontMm = Math.min(field.fontSize * 0.45, 2.2) * Math.max(effectiveScale, 0.7);
          const valueFontMm = field.fontSize * Math.max(effectiveScale, 0.7);

          // Convert to screen pixels - scales naturally with zoom
          const screenLabelFont = mmToScreen(labelFontMm);
          const screenValueFont = mmToScreen(valueFontMm);

          // Skip if too small to read
          if (screenLabelFont < 3) continue;

          const screenRowY = mmToScreenY(rowY);
          const screenFieldX = mmToScreenX(fieldX);

          // Label
          ctx.font = `${screenLabelFont}px Arial, sans-serif`;
          ctx.fillStyle = '#666666';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(field.label, screenFieldX, screenRowY + mmToScreen(0.3));

          // Value below label (spacing in mm, converted to screen)
          const valueY = screenRowY + mmToScreen(labelFontMm + 0.5);
          ctx.font = `${field.fontWeight === 'bold' ? 'bold ' : ''}${screenValueFont}px Arial, sans-serif`;
          ctx.fillStyle = '#000000';
          ctx.fillText(field.value, screenFieldX, valueY);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // 4. Clip to viewport and draw model content
      // ─────────────────────────────────────────────────────────────────────
      ctx.save();

      // Create clip region for viewport
      ctx.beginPath();
      ctx.rect(
        mmToScreenX(viewport.x),
        mmToScreenY(viewport.y),
        mmToScreen(viewport.width),
        mmToScreen(viewport.height)
      );
      ctx.clip();

      // Calculate drawing transform to fit in viewport
      const drawingBounds = {
        minX: drawing.bounds.min.x,
        minY: drawing.bounds.min.y,
        maxX: drawing.bounds.max.x,
        maxY: drawing.bounds.max.y,
      };

      // Axis-specific flipping
      const flipY = sectionAxis !== 'down';
      const flipX = sectionAxis === 'side';

      // Use cached transform when pinned, otherwise calculate new one
      let drawingTransform: { translateX: number; translateY: number; scaleFactor: number };

      if (isPinned && cachedSheetTransformRef?.current) {
        // Use cached transform to keep model fixed in place
        drawingTransform = cachedSheetTransformRef.current;
      } else {
        // Calculate new transform
        const baseTransform = calculateDrawingTransform(drawingBounds, viewport, activeSheet.scale);

        // Adjust for axis-specific flipping
        // calculateDrawingTransform assumes Y-flip (uses maxY), but for 'down' view we don't flip Y
        drawingTransform = {
          ...baseTransform,
          translateY: flipY
            ? baseTransform.translateY
            : baseTransform.translateY - (drawingBounds.maxY + drawingBounds.minY) * baseTransform.scaleFactor,
        };

        // Cache the transform for pinned mode
        if (cachedSheetTransformRef) {
          cachedSheetTransformRef.current = drawingTransform;
        }
      }

      // Apply combined transform: sheet mm -> screen, then drawing coords -> sheet mm
      // Drawing coord (meters) * scaleFactor = sheet mm, + translateX/Y
      // Then sheet mm -> screen via mmToScreenX/Y
      const drawModelContent = () => {
        // Determine flip behavior based on section axis
        // - 'down' (plan view): DON'T flip Y so north (Z+) is up
        // - 'front' and 'side': flip Y so height (Y+) is up
        // - 'side': also flip X to look from conventional direction

        // For each polygon/line, transform from model coords to screen coords
        const modelToScreen = (x: number, y: number) => {
          // Apply axis-specific flipping
          const adjustedX = flipX ? -x : x;
          const adjustedY = flipY ? -y : y;
          // Model to sheet mm
          const sheetX = adjustedX * drawingTransform.scaleFactor + drawingTransform.translateX;
          const sheetY = adjustedY * drawingTransform.scaleFactor + drawingTransform.translateY;
          // Sheet mm to screen
          return { x: mmToScreenX(sheetX), y: mmToScreenY(sheetY) };
        };

        // Line width in screen pixels (convert mm to screen)
        const mmLineToScreen = (mmWeight: number) => Math.max(0.5, mmToScreen(mmWeight / drawingTransform.scaleFactor * 0.001));

        // Fill cut polygons
        for (const polygon of drawing.cutPolygons) {
          let fillColor = getFillColorForType(polygon.ifcType);
          let opacity = 1;

          if (useIfcMaterials) {
            const materialColor = entityColorMap.get(polygon.entityId);
            if (materialColor) {
              const r = Math.round(materialColor[0] * 255);
              const g = Math.round(materialColor[1] * 255);
              const b = Math.round(materialColor[2] * 255);
              fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
              opacity = materialColor[3];
            }
          } else if (overridesEnabled) {
            const elementData: ElementData = {
              expressId: polygon.entityId,
              ifcType: polygon.ifcType,
            };
            const result = overrideEngine.applyOverrides(elementData);
            fillColor = result.style.fillColor;
            opacity = result.style.opacity;
          }

          ctx.globalAlpha = opacity;
          ctx.fillStyle = fillColor;
          ctx.beginPath();

          if (polygon.polygon.outer.length > 0) {
            const first = modelToScreen(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < polygon.polygon.outer.length; i++) {
              const pt = modelToScreen(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();

            for (const hole of polygon.polygon.holes) {
              if (hole.length > 0) {
                const holeFirst = modelToScreen(hole[0].x, hole[0].y);
                ctx.moveTo(holeFirst.x, holeFirst.y);
                for (let i = 1; i < hole.length; i++) {
                  const pt = modelToScreen(hole[i].x, hole[i].y);
                  ctx.lineTo(pt.x, pt.y);
                }
                ctx.closePath();
              }
            }
          }
          ctx.fill('evenodd');
          ctx.globalAlpha = 1;
        }

        // Stroke polygon outlines
        for (const polygon of drawing.cutPolygons) {
          let strokeColor = '#000000';
          let lineWeight = 0.5;

          if (overridesEnabled) {
            const elementData: ElementData = {
              expressId: polygon.entityId,
              ifcType: polygon.ifcType,
            };
            const result = overrideEngine.applyOverrides(elementData);
            strokeColor = result.style.strokeColor;
            lineWeight = result.style.lineWeight;
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(0.5, mmToScreen(lineWeight) * 0.3);
          ctx.beginPath();

          if (polygon.polygon.outer.length > 0) {
            const first = modelToScreen(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < polygon.polygon.outer.length; i++) {
              const pt = modelToScreen(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();

            for (const hole of polygon.polygon.holes) {
              if (hole.length > 0) {
                const holeFirst = modelToScreen(hole[0].x, hole[0].y);
                ctx.moveTo(holeFirst.x, holeFirst.y);
                for (let i = 1; i < hole.length; i++) {
                  const pt = modelToScreen(hole[i].x, hole[i].y);
                  ctx.lineTo(pt.x, pt.y);
                }
                ctx.closePath();
              }
            }
          }
          ctx.stroke();
        }

        // Draw lines (projection, silhouette, etc.)
        const lineBounds = drawing.bounds;
        const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
        const lineMinX = lineBounds.min.x - lineMargin;
        const lineMaxX = lineBounds.max.x + lineMargin;
        const lineMinY = lineBounds.min.y - lineMargin;
        const lineMaxY = lineBounds.max.y + lineMargin;

        for (const line of drawing.lines) {
          if (line.category === 'cut') continue;
          if (!showHiddenLines && line.visibility === 'hidden') continue;

          const { start, end } = line.line;
          if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;
          if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
            end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) continue;

          let strokeColor = '#000000';
          let lineWidth = 0.25;
          let dashPattern: number[] = [];

          switch (line.category) {
            case 'projection': lineWidth = 0.25; break;
            case 'hidden': lineWidth = 0.18; strokeColor = '#666666'; dashPattern = [4, 2]; break;
            case 'silhouette': lineWidth = 0.35; break;
            case 'crease': lineWidth = 0.18; break;
            case 'boundary': lineWidth = 0.25; break;
            case 'annotation': lineWidth = 0.13; break;
          }

          if (line.visibility === 'hidden') {
            strokeColor = '#888888';
            dashPattern = [4, 2];
            lineWidth *= 0.7;
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(0.5, mmToScreen(lineWidth) * 0.3);
          ctx.setLineDash(dashPattern);

          const screenStart = modelToScreen(start.x, start.y);
          const screenEnd = modelToScreen(end.x, end.y);

          ctx.beginPath();
          ctx.moveTo(screenStart.x, screenStart.y);
          ctx.lineTo(screenEnd.x, screenEnd.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      };

      drawModelContent();
      ctx.restore();

      // ─────────────────────────────────────────────────────────────────────
      // 6. Draw scale bar at BOTTOM LEFT of title block
      // Uses actual drawingTransform.scaleFactor which accounts for dynamic scaling
      // ─────────────────────────────────────────────────────────────────────
      if (scaleBar.visible && tbH > 10) {
        // Position: bottom left with small margin
        const sbX = tbX + 3;
        const sbY = tbY + tbH - 8; // 8mm from bottom (leaves room for label)

        // Calculate effective scale from the actual drawing transform
        // scaleFactor = mm per meter, so effective scale ratio = 1000 / scaleFactor
        const effectiveScaleFactor = drawingTransform.scaleFactor;

        // Scale bar length: we want to show a nice round number of meters
        // Calculate how many mm on paper for the desired real-world length
        const maxBarWidth = Math.min(tbW * 0.3, 50); // Max 30% of width or 50mm

        // Find a nice round length that fits
        // Start with the configured length and adjust if needed
        let targetLengthM = scaleBar.totalLengthM;
        let sbLengthMm = targetLengthM * effectiveScaleFactor;

        // If bar would be too long, reduce the target length
        while (sbLengthMm > maxBarWidth && targetLengthM > 0.5) {
          targetLengthM = targetLengthM / 2;
          sbLengthMm = targetLengthM * effectiveScaleFactor;
        }

        // If bar would be too short, increase the target length
        while (sbLengthMm < maxBarWidth * 0.3 && targetLengthM < 100) {
          targetLengthM = targetLengthM * 2;
          sbLengthMm = targetLengthM * effectiveScaleFactor;
        }

        // Clamp to max width
        sbLengthMm = Math.min(sbLengthMm, maxBarWidth);

        // Actual length represented by the bar
        const actualTotalLength = sbLengthMm / effectiveScaleFactor;

        const sbHeight = Math.min(scaleBar.heightMm, 3);

        // Scale bar divisions
        const divisions = scaleBar.primaryDivisions;
        const divWidth = sbLengthMm / divisions;
        for (let i = 0; i < divisions; i++) {
          ctx.fillStyle = i % 2 === 0 ? scaleBar.fillColor : '#ffffff';
          ctx.fillRect(
            mmToScreenX(sbX + i * divWidth),
            mmToScreenY(sbY),
            mmToScreen(divWidth),
            mmToScreen(sbHeight)
          );
        }

        // Scale bar border
        ctx.strokeStyle = scaleBar.strokeColor;
        ctx.lineWidth = Math.max(1, mmToScreen(scaleBar.lineWeight));
        ctx.strokeRect(
          mmToScreenX(sbX),
          mmToScreenY(sbY),
          mmToScreen(sbLengthMm),
          mmToScreen(sbHeight)
        );

        // Distance labels - only at 0 and end
        const labelFontSize = Math.max(7, mmToScreen(1.8));
        ctx.font = `${labelFontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'top';
        const labelScreenY = mmToScreenY(sbY + sbHeight) + 1;

        ctx.textAlign = 'left';
        ctx.fillText('0', mmToScreenX(sbX), labelScreenY);

        ctx.textAlign = 'right';
        const endLabel = actualTotalLength < 1
          ? `${(actualTotalLength * 100).toFixed(0)}cm`
          : `${actualTotalLength.toFixed(0)}m`;
        ctx.fillText(endLabel, mmToScreenX(sbX + sbLengthMm), labelScreenY);
      }

      // ─────────────────────────────────────────────────────────────────────
      // 7. Draw north arrow at BOTTOM RIGHT of title block
      // ─────────────────────────────────────────────────────────────────────
      if (northArrow.style !== 'none' && tbH > 10) {
        // Position: bottom right with margin
        const naSize = Math.min(northArrow.sizeMm, 8, tbH * 0.6);
        const naX = tbX + tbW - naSize - 5; // Right side with margin
        const naY = tbY + tbH - naSize / 2 - 3; // Bottom with margin

        ctx.save();
        ctx.translate(mmToScreenX(naX), mmToScreenY(naY));
        ctx.rotate((northArrow.rotation * Math.PI) / 180);

        // Draw arrow
        const arrowLen = mmToScreen(naSize);
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(0, -arrowLen / 2);
        ctx.lineTo(-arrowLen / 6, arrowLen / 2);
        ctx.lineTo(0, arrowLen / 3);
        ctx.lineTo(arrowLen / 6, arrowLen / 2);
        ctx.closePath();
        ctx.fill();

        // Draw "N" label
        const nFontSize = Math.max(8, mmToScreen(2.5));
        ctx.font = `bold ${nFontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('N', 0, -arrowLen / 2 - 1);

        ctx.restore();
      }

    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // NON-SHEET MODE: Original rendering (drawing coords -> screen)
      // ═══════════════════════════════════════════════════════════════════════

      // Apply transform with axis-specific flipping
      // - 'down' (plan view): DON'T flip Y so north (Z+) is up
      // - 'front' and 'side': flip Y so height (Y+) is up
      // - 'side': also flip X to look from conventional direction
      const scaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const scaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;

      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(scaleX, scaleY);

      // ═══════════════════════════════════════════════════════════════════════
      // 1. FILL CUT POLYGONS (with color from IFC materials, override engine, or type fallback)
      // ═══════════════════════════════════════════════════════════════════════
      for (const polygon of drawing.cutPolygons) {
        // Get fill color - priority: IFC materials > override engine > IFC type fallback
        let fillColor = getFillColorForType(polygon.ifcType);
        let strokeColor = '#000000';
        let opacity = 1;

        // Use actual IFC material colors from the mesh data
        if (useIfcMaterials) {
          const materialColor = entityColorMap.get(polygon.entityId);
          if (materialColor) {
            // Convert RGBA [0-1] to hex color
            const r = Math.round(materialColor[0] * 255);
            const g = Math.round(materialColor[1] * 255);
            const b = Math.round(materialColor[2] * 255);
            fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            opacity = materialColor[3];
          }
        } else if (overridesEnabled) {
          const elementData: ElementData = {
            expressId: polygon.entityId,
            ifcType: polygon.ifcType,
          };
          const result = overrideEngine.applyOverrides(elementData);
          fillColor = result.style.fillColor;
          strokeColor = result.style.strokeColor;
          opacity = result.style.opacity;
        }

        ctx.globalAlpha = opacity;
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (polygon.polygon.outer.length > 0) {
          ctx.moveTo(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
          for (let i = 1; i < polygon.polygon.outer.length; i++) {
            ctx.lineTo(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
          }
          ctx.closePath();

          // Draw holes (inner boundaries)
          for (const hole of polygon.polygon.holes) {
            if (hole.length > 0) {
              ctx.moveTo(hole[0].x, hole[0].y);
              for (let i = 1; i < hole.length; i++) {
                ctx.lineTo(hole[i].x, hole[i].y);
              }
              ctx.closePath();
            }
          }
        }
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. STROKE CUT POLYGON OUTLINES (with color from override engine)
      // ═══════════════════════════════════════════════════════════════════════
      for (const polygon of drawing.cutPolygons) {
        let strokeColor = '#000000';
        let lineWeight = 0.5;

        if (overridesEnabled) {
          const elementData: ElementData = {
            expressId: polygon.entityId,
            ifcType: polygon.ifcType,
          };
          const result = overrideEngine.applyOverrides(elementData);
          strokeColor = result.style.strokeColor;
          lineWeight = result.style.lineWeight;
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWeight / transform.scale;
        ctx.beginPath();
        if (polygon.polygon.outer.length > 0) {
          ctx.moveTo(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
          for (let i = 1; i < polygon.polygon.outer.length; i++) {
            ctx.lineTo(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
          }
          ctx.closePath();

          // Stroke holes too
          for (const hole of polygon.polygon.holes) {
            if (hole.length > 0) {
              ctx.moveTo(hole[0].x, hole[0].y);
              for (let i = 1; i < hole.length; i++) {
                ctx.lineTo(hole[i].x, hole[i].y);
              }
              ctx.closePath();
            }
          }
        }
        ctx.stroke();
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3. DRAW PROJECTION/SILHOUETTE LINES (skip 'cut' - already in polygons)
      // ═══════════════════════════════════════════════════════════════════════
      // Pre-compute bounds for line validation
      const lineBounds = drawing.bounds;
      const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
      const lineMinX = lineBounds.min.x - lineMargin;
      const lineMaxX = lineBounds.max.x + lineMargin;
      const lineMinY = lineBounds.min.y - lineMargin;
      const lineMaxY = lineBounds.max.y + lineMargin;

      for (const line of drawing.lines) {
        // Skip 'cut' lines - they're triangulation edges, already handled by polygons
        if (line.category === 'cut') continue;

        // Skip hidden lines if not showing
        if (!showHiddenLines && line.visibility === 'hidden') continue;

        // Skip lines with invalid coordinates (NaN, Infinity, or far outside bounds)
        const { start, end } = line.line;
        if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
          continue;
        }
        if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
          end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) {
          continue;
        }

        // Set line style based on category
        let strokeColor = '#000000';
        let lineWidth = 0.25;
        let dashPattern: number[] = [];

        switch (line.category) {
          case 'projection':
            lineWidth = 0.25;
            strokeColor = '#000000';
            break;
          case 'hidden':
            lineWidth = 0.18;
            strokeColor = '#666666';
            dashPattern = [2, 1];
            break;
          case 'silhouette':
            lineWidth = 0.35;
            strokeColor = '#000000';
            break;
          case 'crease':
            lineWidth = 0.18;
            strokeColor = '#000000';
            break;
          case 'boundary':
            lineWidth = 0.25;
            strokeColor = '#000000';
            break;
          case 'annotation':
            lineWidth = 0.13;
            strokeColor = '#000000';
            break;
        }

        // Hidden visibility overrides
        if (line.visibility === 'hidden') {
          strokeColor = '#888888';
          dashPattern = [2, 1];
          lineWidth *= 0.7;
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth / transform.scale;
        ctx.setLineDash(dashPattern.map((d) => d / transform.scale));

        ctx.beginPath();
        ctx.moveTo(line.line.start.x, line.line.start.y);
        ctx.lineTo(line.line.end.x, line.line.end.y);
        ctx.stroke();

        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. RENDER MEASUREMENTS (in screen space)
    // ═══════════════════════════════════════════════════════════════════════
    const drawMeasureLine = (
      start: { x: number; y: number },
      end: { x: number; y: number },
      distance: number,
      color: string = '#2196F3',
      isActive: boolean = false
    ) => {
      // Convert drawing coords to screen coords with axis-specific transforms
      const measureScaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const measureScaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;
      const screenStart = {
        x: start.x * measureScaleX + transform.x,
        y: start.y * measureScaleY + transform.y,
      };
      const screenEnd = {
        x: end.x * measureScaleX + transform.x,
        y: end.y * measureScaleY + transform.y,
      };

      // Draw line
      ctx.strokeStyle = color;
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.setLineDash(isActive ? [6, 3] : []);
      ctx.beginPath();
      ctx.moveTo(screenStart.x, screenStart.y);
      ctx.lineTo(screenEnd.x, screenEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw endpoints
      ctx.fillStyle = color;
      const endpointRadius = isActive ? 5 : 4;
      ctx.beginPath();
      ctx.arc(screenStart.x, screenStart.y, endpointRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(screenEnd.x, screenEnd.y, endpointRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw distance label
      const midX = (screenStart.x + screenEnd.x) / 2;
      const midY = (screenStart.y + screenEnd.y) / 2;

      // Format distance (assuming meters, convert to readable units)
      let labelText: string;
      if (distance < 0.01) {
        labelText = `${(distance * 1000).toFixed(1)} mm`;
      } else if (distance < 1) {
        labelText = `${(distance * 100).toFixed(1)} cm`;
      } else {
        labelText = `${distance.toFixed(3)} m`;
      }

      // Background for label
      ctx.font = '12px system-ui, sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const padding = 4;
      const bgWidth = textMetrics.width + padding * 2;
      const bgHeight = 18;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(midX - bgWidth / 2, midY - bgHeight / 2, bgWidth, bgHeight);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(midX - bgWidth / 2, midY - bgHeight / 2, bgWidth, bgHeight);

      // Text
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, midX, midY);
    };

    // Draw completed measurements
    for (const result of measureResults) {
      drawMeasureLine(result.start, result.end, result.distance, '#2196F3', false);
    }

    // Draw active measurement
    if (measureStart && measureCurrent) {
      const dx = measureCurrent.x - measureStart.x;
      const dy = measureCurrent.y - measureStart.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      drawMeasureLine(measureStart, measureCurrent, distance, '#FF5722', true);
    }

    // Draw snap indicator
    if (measureMode && measureSnapPoint) {
      // Use axis-specific transforms (matching canvas rendering)
      const snapScaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const snapScaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;
      const screenSnap = {
        x: measureSnapPoint.x * snapScaleX + transform.x,
        y: measureSnapPoint.y * snapScaleY + transform.y,
      };

      // Draw snap crosshair
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 1.5;
      const snapSize = 12;

      ctx.beginPath();
      ctx.moveTo(screenSnap.x - snapSize, screenSnap.y);
      ctx.lineTo(screenSnap.x + snapSize, screenSnap.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(screenSnap.x, screenSnap.y - snapSize);
      ctx.lineTo(screenSnap.x, screenSnap.y + snapSize);
      ctx.stroke();

      // Draw snap circle
      ctx.beginPath();
      ctx.arc(screenSnap.x, screenSnap.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [drawing, transform, showHiddenLines, canvasSize, overrideEngine, overridesEnabled, entityColorMap, useIfcMaterials, measureMode, measureStart, measureCurrent, measureResults, measureSnapPoint, sheetEnabled, activeSheet, sectionAxis, isPinned]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={CANVAS_STYLE}
    />
  );
}
