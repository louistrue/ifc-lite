/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type DesktopPanelActionType =
  | 'bcf-import'
  | 'bcf-export'
  | 'ids-open'
  | 'ids-run-validation';

interface DesktopPanelAction {
  id: number;
  type: DesktopPanelActionType;
}

type DesktopPanelActionListener = () => void;

let nextActionId = 1;
const pendingActions: DesktopPanelAction[] = [];
const listeners = new Set<DesktopPanelActionListener>();

export function requestDesktopPanelAction(type: DesktopPanelActionType): void {
  pendingActions.push({ id: nextActionId++, type });
  for (const listener of listeners) {
    listener();
  }
}

export function claimNextDesktopPanelAction(type: DesktopPanelActionType): DesktopPanelAction | null {
  const index = pendingActions.findIndex((action) => action.type === type);
  if (index < 0) {
    return null;
  }
  const [action] = pendingActions.splice(index, 1);
  return action ?? null;
}

export function subscribeDesktopPanelActions(listener: DesktopPanelActionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
