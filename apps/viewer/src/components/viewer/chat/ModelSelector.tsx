/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ModelSelector — dropdown to pick the LLM model.
 * Shows free models always, pro models with a lock icon if not subscribed.
 * Displays context window size for each model.
 */

import { useCallback } from 'react';
import { Crown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useViewerStore } from '@/store';
import { FREE_MODELS, PRO_MODELS, getModelById } from '@/lib/llm/models';

interface ModelSelectorProps {
  /** Whether the user has a pro subscription */
  hasPro?: boolean;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  return `${(tokens / 1_000).toFixed(0)}K`;
}

export function ModelSelector({ hasPro = false }: ModelSelectorProps) {
  const activeModel = useViewerStore((s) => s.chatActiveModel);
  const setActiveModel = useViewerStore((s) => s.setChatActiveModel);

  const handleChange = useCallback((value: string) => {
    setActiveModel(value);
  }, [setActiveModel]);

  const current = getModelById(activeModel);

  return (
    <Select value={activeModel} onValueChange={handleChange}>
      <SelectTrigger className="h-6 text-xs w-auto min-w-[140px] gap-1 border-0 bg-transparent hover:bg-muted/50">
        <SelectValue>
          <span className="truncate">
            {current?.name ?? activeModel}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* Free tier */}
        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Free
        </div>
        {FREE_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            <span className="flex items-center gap-1.5">
              <span>{m.name}</span>
              <span className="text-muted-foreground text-[10px]">{m.provider}</span>
              <span className="text-muted-foreground/50 text-[10px]">{formatContextWindow(m.contextWindow)}</span>
            </span>
          </SelectItem>
        ))}

        {/* Pro tier */}
        <div className="px-2 py-1 mt-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Crown className="h-3 w-3 text-amber-500" />
          Pro — $8/mo
        </div>
        {PRO_MODELS.map((m) => (
          <SelectItem
            key={m.id}
            value={m.id}
            disabled={!hasPro}
            className="text-xs"
          >
            <span className="flex items-center gap-1.5">
              <span>{m.name}</span>
              <span className="text-muted-foreground text-[10px]">{m.provider}</span>
              <span className="text-muted-foreground/50 text-[10px]">{formatContextWindow(m.contextWindow)}</span>
              {!hasPro && <Crown className="h-3 w-3 text-amber-500/50" />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
