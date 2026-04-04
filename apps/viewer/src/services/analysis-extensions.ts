/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ComponentType, ReactNode } from 'react';

export type AnalysisExtensionPlacement = 'right' | 'bottom';

export interface AnalysisExtensionRenderProps {
  onClose: () => void;
}

export interface AnalysisExtensionDefinition {
  id: string;
  label: string;
  description?: string;
  placement?: AnalysisExtensionPlacement;
  icon: ComponentType<{ className?: string }>;
  renderPanel: (props: AnalysisExtensionRenderProps) => ReactNode;
  onBeforeOpen?: () => boolean | void;
}

export interface AnalysisExtensionsSnapshot {
  activeId: string | null;
  extensions: AnalysisExtensionDefinition[];
}

const listeners = new Set<() => void>();
const extensions = new Map<string, AnalysisExtensionDefinition>();

let activeId: string | null = null;
let snapshot: AnalysisExtensionsSnapshot = {
  activeId,
  extensions: [],
};

function rebuildSnapshot(): void {
  snapshot = {
    activeId,
    extensions: Array.from(extensions.values()),
  };
}

function emit(): void {
  rebuildSnapshot();
  listeners.forEach((listener) => listener());
}

function setActiveId(nextActiveId: string | null): void {
  if (activeId === nextActiveId) {
    return;
  }
  activeId = nextActiveId;
  emit();
}

function canOpen(definition: AnalysisExtensionDefinition): boolean {
  return definition.onBeforeOpen?.() !== false;
}

export function subscribeAnalysisExtensions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAnalysisExtensionsSnapshot(): AnalysisExtensionsSnapshot {
  return snapshot;
}

export function getAnalysisExtensionById(id: string | null | undefined): AnalysisExtensionDefinition | null {
  if (!id) {
    return null;
  }
  return extensions.get(id) ?? null;
}

export function closeActiveAnalysisExtension(): void {
  setActiveId(null);
}

export function openAnalysisExtension(id: string): boolean {
  const definition = extensions.get(id);
  if (!definition) {
    return false;
  }
  if (!canOpen(definition)) {
    return false;
  }
  setActiveId(id);
  return true;
}

export function toggleAnalysisExtension(id: string): boolean {
  if (activeId === id) {
    closeActiveAnalysisExtension();
    return false;
  }
  return openAnalysisExtension(id);
}

export function registerAnalysisExtensions(definitions: AnalysisExtensionDefinition[]): () => void {
  const nextEntries = definitions.map((definition) => [definition.id, definition] as const);
  nextEntries.forEach(([id, definition]) => {
    extensions.set(id, definition);
  });
  emit();

  return () => {
    let shouldEmit = false;
    for (const [id] of nextEntries) {
      if (extensions.delete(id)) {
        shouldEmit = true;
      }
      if (activeId === id) {
        activeId = null;
        shouldEmit = true;
      }
    }
    if (shouldEmit) {
      emit();
    }
  };
}
