/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  Lens,
  LensEvaluationResult,
  LensDataProvider,
  RGBAColor,
  LensRule,
} from './types.js';
import { matchesCriteria } from './matching.js';
import { hexToRgba, GHOST_COLOR } from './colors.js';

/**
 * Evaluate a lens against all entities in the data provider.
 *
 * - O(n × r) where n = entity count, r = enabled rules
 * - First matching rule wins (short-circuit per entity)
 * - Unmatched entities receive {@link GHOST_COLOR} for context
 *
 * @param lens - Lens configuration to evaluate
 * @param provider - Data provider for entity access
 * @returns Color map, hidden IDs, per-rule counts, and execution time
 */
export function evaluateLens(
  lens: Lens,
  provider: LensDataProvider,
): LensEvaluationResult {
  const startTime = performance.now();

  const enabledRules = lens.rules.filter(r => r.enabled);

  // Early exit — no enabled rules means no evaluation
  if (enabledRules.length === 0) {
    return {
      colorMap: new Map(),
      hiddenIds: new Set(),
      ruleCounts: new Map(),
      ruleEntityIds: new Map(),
      executionTime: performance.now() - startTime,
    };
  }

  const colorMap = new Map<number, RGBAColor>();
  const hiddenIds = new Set<number>();
  const ruleCounts = new Map<string, number>();
  const ruleEntityIds = new Map<string, number[]>();

  // Initialize rule counts and entity ID lists
  for (const rule of enabledRules) {
    ruleCounts.set(rule.id, 0);
    ruleEntityIds.set(rule.id, []);
  }

  // Evaluate all entities
  provider.forEachEntity((globalId) => {
    let matched = false;

    // First matching rule wins
    for (const rule of enabledRules) {
      if (matchesCriteria(rule.criteria, globalId, provider)) {
        matched = true;
        ruleCounts.set(rule.id, (ruleCounts.get(rule.id) ?? 0) + 1);
        ruleEntityIds.get(rule.id)!.push(globalId);
        applyRuleAction(rule, globalId, colorMap, hiddenIds);
        break;
      }
    }

    // Ghost unmatched entities for context
    if (!matched) {
      colorMap.set(globalId, GHOST_COLOR);
    }
  });

  return {
    colorMap,
    hiddenIds,
    ruleCounts,
    ruleEntityIds,
    executionTime: performance.now() - startTime,
  };
}

/** Apply rule action to an entity */
function applyRuleAction(
  rule: LensRule,
  globalId: number,
  colorMap: Map<number, RGBAColor>,
  hiddenIds: Set<number>,
): void {
  switch (rule.action) {
    case 'colorize':
      colorMap.set(globalId, hexToRgba(rule.color, 1));
      break;
    case 'transparent':
      colorMap.set(globalId, hexToRgba(rule.color, 0.3));
      break;
    case 'hide':
      hiddenIds.add(globalId);
      break;
  }
}
