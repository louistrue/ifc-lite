/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Inline text editor overlay for text annotations on the 2D drawing.
 * Positioned absolutely over the canvas at the annotation's screen coordinates.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TextAnnotation2D } from '@/store/slices/drawing2DSlice';

interface TextAnnotationEditorProps {
  /** The text annotation being edited */
  annotation: TextAnnotation2D;
  /** Screen position (top-left of the editor) */
  screenX: number;
  screenY: number;
  /** Called with the new text when user confirms (Enter) */
  onConfirm: (id: string, text: string) => void;
  /** Called when user cancels (Escape) or submits empty text */
  onCancel: (id: string) => void;
}

export function TextAnnotationEditor({
  annotation,
  screenX,
  screenY,
  onConfirm,
  onCancel,
}: TextAnnotationEditorProps): React.ReactElement {
  const [text, setText] = useState(annotation.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Guard against blur firing during the initial click that created this editor.
  // Without this, the mouseup from the placement click can steal focus from the
  // textarea before the user has a chance to type, causing an immediate cancel.
  const readyRef = useRef(false);

  // Auto-focus on mount, but defer slightly so the originating mouseup
  // from the placement click doesn't immediately steal focus / trigger blur.
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      textareaRef.current?.focus();
      // Mark ready after focus is established so blur handler is enabled
      readyRef.current = true;
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onConfirm(annotation.id, trimmed);
      } else {
        onCancel(annotation.id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel(annotation.id);
    }
    // Stop propagation so the canvas doesn't receive these events
    e.stopPropagation();
  }, [text, annotation.id, onConfirm, onCancel]);

  const handleBlur = useCallback(() => {
    // Ignore blur events that fire before the editor is fully ready
    // (e.g. from the originating click's mouseup stealing focus)
    if (!readyRef.current) return;

    const trimmed = text.trim();
    if (trimmed) {
      onConfirm(annotation.id, trimmed);
    } else {
      onCancel(annotation.id);
    }
  }, [text, annotation.id, onConfirm, onCancel]);

  return (
    <div
      className="absolute z-20 pointer-events-auto"
      style={{
        left: screenX,
        top: screenY,
      }}
      // Prevent mousedown from propagating to canvas (which would place another annotation)
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="Type annotation text..."
        className="min-w-[120px] max-w-[300px] min-h-[32px] px-2 py-1 text-sm border-2 border-blue-500 rounded bg-white text-black resize shadow-lg outline-none"
        rows={2}
        style={{ fontSize: annotation.fontSize }}
      />
      <div className="text-[10px] text-muted-foreground mt-0.5 bg-white/80 px-1 rounded">
        Enter to confirm · Shift+Enter for newline · Esc to cancel
      </div>
    </div>
  );
}
