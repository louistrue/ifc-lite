/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Quantity set display component for IFC element quantities.
 * Supports mutation tracking — computed/edited quantities show a badge.
 */

import { Sparkles, PenLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { decodeIfcString } from './encodingUtils';
import type { QuantitySet } from './encodingUtils';

/** Maps quantity type to friendly name for tooltip */
const QUANTITY_TYPE_NAMES: Record<number, string> = {
  0: 'Length',
  1: 'Area',
  2: 'Volume',
  3: 'Count',
  4: 'Weight',
  5: 'Time',
};

export function QuantitySetCard({ qset }: { qset: QuantitySet }) {
  const hasMutations = qset.quantities.some(q => q.isMutated);
  const isNew = qset.isNewQset;

  const formatValue = (value: number, type: number): string => {
    const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 3 });
    switch (type) {
      case 0: return `${formatted} m`;
      case 1: return `${formatted} m\u00B2`;
      case 2: return `${formatted} m\u00B3`;
      case 3: return formatted;
      case 4: return `${formatted} kg`;
      case 5: return `${formatted} s`;
      default: return formatted;
    }
  };

  const borderClass = isNew
    ? 'border-2 border-amber-400/50 dark:border-amber-500/30'
    : hasMutations
    ? 'border-2 border-purple-300/50 dark:border-purple-500/30'
    : 'border-2 border-blue-200 dark:border-blue-800';

  const bgClass = isNew
    ? 'bg-amber-50/30 dark:bg-amber-950/20'
    : hasMutations
    ? 'bg-purple-50/20 dark:bg-purple-950/10'
    : 'bg-blue-50/20 dark:bg-blue-950/20';

  const headerBg = isNew
    ? 'hover:bg-amber-50 dark:hover:bg-amber-900/30'
    : hasMutations
    ? 'hover:bg-purple-50 dark:hover:bg-purple-900/30'
    : 'hover:bg-blue-50 dark:hover:bg-blue-900/30';

  const titleColor = isNew
    ? 'text-amber-700 dark:text-amber-400'
    : hasMutations
    ? 'text-purple-700 dark:text-purple-400'
    : 'text-blue-700 dark:text-blue-400';

  const badgeBg = isNew
    ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
    : hasMutations
    ? 'bg-purple-100 dark:bg-purple-900/50 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300'
    : 'bg-blue-100 dark:bg-blue-900/50 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300';

  const dividerClass = isNew
    ? 'border-amber-200 dark:border-amber-800'
    : hasMutations
    ? 'border-purple-200 dark:border-purple-800'
    : 'border-blue-200 dark:border-blue-800';

  return (
    <Collapsible defaultOpen className={`${borderClass} ${bgClass} w-full max-w-full overflow-hidden`}>
      <CollapsibleTrigger className={`flex items-center gap-2 w-full p-2.5 ${headerBg} text-left transition-colors overflow-hidden`}>
        {isNew && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>Computed quantity set (not in original model)</TooltipContent>
          </Tooltip>
        )}
        {hasMutations && !isNew && (
          <Tooltip>
            <TooltipTrigger asChild>
              <PenLine className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>Has computed/edited quantities</TooltipContent>
          </Tooltip>
        )}
        <span className={`font-bold text-xs ${titleColor} truncate flex-1 min-w-0`}>{decodeIfcString(qset.name)}</span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 border shrink-0 ${badgeBg}`}>{qset.quantities.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={`border-t-2 ${dividerClass} divide-y divide-blue-100 dark:divide-blue-900/30`}>
          {qset.quantities.map((q: { name: string; value: number; type: number; isMutated?: boolean }, index: number) => {
            const decodedName = decodeIfcString(q.name);
            const typeName = QUANTITY_TYPE_NAMES[q.type];
            const isMutated = q.isMutated;

            return (
              <div
                key={`${q.name}-${index}`}
                className={`flex flex-col gap-0.5 px-3 py-2 text-xs ${
                  isMutated
                    ? 'bg-purple-50/50 dark:bg-purple-950/30 hover:bg-purple-100/50 dark:hover:bg-purple-900/30'
                    : 'hover:bg-blue-50/50 dark:hover:bg-blue-900/20'
                }`}
              >
                {/* Quantity name with type tooltip and mutation indicator */}
                <div className="flex items-center gap-1.5">
                  {isMutated && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700">
                          computed
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Computed from mesh geometry</TooltipContent>
                    </Tooltip>
                  )}
                  {typeName ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`font-medium cursor-help break-words ${isMutated ? 'text-purple-600 dark:text-purple-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                          {decodedName}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-[10px]">
                        <span className="text-zinc-400">{typeName}</span>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className={`font-medium break-words ${isMutated ? 'text-purple-600 dark:text-purple-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                      {decodedName}
                    </span>
                  )}
                </div>
                {/* Quantity value */}
                <span className={`font-mono select-all break-words ${isMutated ? 'text-purple-900 dark:text-purple-100 font-semibold' : 'text-blue-700 dark:text-blue-400'}`}>
                  {formatValue(q.value, q.type)}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
