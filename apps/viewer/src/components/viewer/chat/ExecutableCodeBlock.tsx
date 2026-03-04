/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ExecutableCodeBlock — renders a code block from an LLM response
 * with a "Run" button that executes it in the QuickJS sandbox.
 * Results (logs, return value, errors) appear inline below the code.
 */

import { memo, useCallback, useState } from 'react';
import {
  Play,
  Copy,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileCode2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSandbox } from '@/hooks/useSandbox';
import { useViewerStore } from '@/store';
import type { CodeBlock, CodeExecResult } from '@/lib/llm/types';

interface ExecutableCodeBlockProps {
  block: CodeBlock;
  messageId: string;
  result?: CodeExecResult;
}

export const ExecutableCodeBlock = memo(function ExecutableCodeBlock({
  block,
  messageId,
  result,
}: ExecutableCodeBlockProps) {
  const { execute } = useSandbox();
  const setCodeExecResult = useViewerStore((s) => s.setCodeExecResult);
  const [copied, setCopied] = useState(false);

  const handleRun = useCallback(async () => {
    setCodeExecResult(messageId, block.index, { status: 'running' });

    try {
      const scriptResult = await execute(block.code);
      if (scriptResult) {
        setCodeExecResult(messageId, block.index, {
          status: 'success',
          logs: scriptResult.logs,
          value: scriptResult.value,
          durationMs: scriptResult.durationMs,
        });
      } else {
        // execute returned null = error was handled via store
        const error = useViewerStore.getState().scriptLastError;
        setCodeExecResult(messageId, block.index, {
          status: 'error',
          error: error ?? 'Script execution failed',
        });
      }
    } catch (err) {
      setCodeExecResult(messageId, block.index, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [execute, block.code, block.index, messageId, setCodeExecResult]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [block.code]);

  const handleSendToEditor = useCallback(() => {
    useViewerStore.getState().setScriptEditorContent(block.code);
    useViewerStore.getState().setScriptPanelVisible(true);
  }, [block.code]);

  const isRunning = result?.status === 'running';

  return (
    <div className="my-2 rounded-md border bg-muted/30 overflow-hidden">
      {/* Code header with action buttons */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b">
        <span className="text-[10px] font-mono text-muted-foreground uppercase">
          {block.language || 'js'}
        </span>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={handleCopy}>
              {copied ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy code</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={handleSendToEditor}>
              <FileCode2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in Script Editor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="default"
              size="sm"
              onClick={handleRun}
              disabled={isRunning}
              className="gap-1 h-6 px-2 text-xs"
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {isRunning ? 'Running...' : 'Run'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Execute in sandbox</TooltipContent>
        </Tooltip>
      </div>

      {/* Code content */}
      <pre className="px-3 py-2 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto">
        <code>{block.code}</code>
      </pre>

      {/* Execution result */}
      {result && result.status !== 'running' && (
        <div className="border-t px-3 py-2 text-xs font-mono space-y-0.5">
          {result.status === 'error' && (
            <div className="flex items-start gap-1.5 text-destructive">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap break-all">{result.error}</span>
            </div>
          )}
          {result.status === 'success' && result.logs && result.logs.length > 0 && (
            <div className="space-y-0.5">
              {result.logs.map((log, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-1.5',
                  log.level === 'error' && 'text-destructive',
                  log.level === 'warn' && 'text-yellow-600 dark:text-yellow-400',
                  log.level === 'info' && 'text-blue-600 dark:text-blue-400',
                )}>
                  <span className="whitespace-pre-wrap break-all">
                    {log.args.map((a) =>
                      typeof a === 'object' ? JSON.stringify(a) : String(a)
                    ).join(' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
          {result.status === 'success' && result.value !== undefined && result.value !== null && (
            <div className="text-muted-foreground mt-1 pt-1 border-t border-border/50">
              <span className="opacity-60">Return: </span>
              <span className="text-foreground">
                {typeof result.value === 'object'
                  ? JSON.stringify(result.value, null, 2)
                  : String(result.value)}
              </span>
            </div>
          )}
          {result.status === 'success' && result.durationMs !== undefined && (
            <div className="text-green-600 dark:text-green-400 flex items-center gap-1 mt-1">
              <CheckCircle2 className="h-3 w-3" />
              <span>Completed in {result.durationMs}ms</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
