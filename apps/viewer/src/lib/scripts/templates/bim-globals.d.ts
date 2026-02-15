/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Type declarations for the sandbox `bim` global.
 *
 * These types mirror the bridge-schema API surface and are used to
 * type-check template scripts at compile time.
 */

interface BimEntity {
  ref: { modelId: string; expressId: number };
  name: string; Name: string;
  type: string; Type: string;
  globalId: string; GlobalId: string;
  description: string; Description: string;
  objectType: string; ObjectType: string;
}

interface BimPropertySet {
  name: string;
  properties: Array<{ name: string; value: string | number | boolean | null }>;
}

interface BimQuantitySet {
  name: string;
  quantities: Array<{ name: string; value: number | null }>;
}

interface BimModel {
  id: string;
  name: string;
  schemaVersion: string;
  entityCount: number;
  fileSize: number;
}

declare const bim: {
  model: {
    list(): BimModel[];
    active(): BimModel | null;
    activeId(): string | null;
  };
  query: {
    all(): BimEntity[];
    byType(...types: string[]): BimEntity[];
    entity(modelId: string, expressId: number): BimEntity | null;
    properties(entity: BimEntity): BimPropertySet[];
    quantities(entity: BimEntity): BimQuantitySet[];
  };
  viewer: {
    colorize(entities: BimEntity[], color: string): void;
    colorizeAll(batches: Array<{ entities: BimEntity[]; color: string }>): void;
    hide(entities: BimEntity[]): void;
    show(entities: BimEntity[]): void;
    isolate(entities: BimEntity[]): void;
    select(entities: BimEntity[]): void;
    flyTo(entities: BimEntity[]): void;
    resetColors(): void;
    resetVisibility(): void;
  };
  mutate: {
    setProperty(ref: unknown, psetName: string, propName: string, value: unknown): void;
    deleteProperty(ref: unknown, psetName: string, propName: string): void;
    undo(modelId: string): void;
    redo(modelId: string): void;
  };
  export: {
    csv(entities: BimEntity[], options: { columns: string[]; filename?: string; separator?: string }): string;
    json(entities: BimEntity[], columns: string[]): unknown[];
  };
  lens: {
    presets(): unknown[];
  };
};
