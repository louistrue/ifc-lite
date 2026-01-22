/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite Logger - Provides consistent error logging across packages
 *
 * Log levels:
 * - error: Always logged - critical failures that affect functionality
 * - warn: Always logged - recoverable issues, degraded functionality
 * - info: Logged when DEBUG is set - general operational info
 * - debug: Logged when DEBUG is set - detailed debugging info
 *
 * Enable debug logging by setting:
 * - localStorage.setItem('IFC_DEBUG', 'true') in browser
 * - IFC_DEBUG=true environment variable in Node.js
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogContext {
  /** Component/module name (e.g., 'Parser', 'Geometry', 'SpatialHierarchy') */
  component: string;
  /** Operation being performed (e.g., 'parseEntity', 'extractElevation') */
  operation?: string;
  /** Entity ID if applicable */
  entityId?: number;
  /** Entity type if applicable */
  entityType?: string;
  /** Additional context data */
  data?: Record<string, unknown>;
}

function isDebugEnabled(): boolean {
  // Check browser localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem('IFC_DEBUG') === 'true';
    } catch {
      // localStorage not available (e.g., in some workers)
    }
  }
  // Check Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env.IFC_DEBUG === 'true';
  }
  return false;
}

function formatContext(ctx: LogContext): string {
  let prefix = `[${ctx.component}]`;
  if (ctx.operation) {
    prefix += ` ${ctx.operation}`;
  }
  if (ctx.entityId !== undefined) {
    prefix += ` #${ctx.entityId}`;
  }
  if (ctx.entityType) {
    prefix += ` (${ctx.entityType})`;
  }
  return prefix;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

/**
 * Create a logger instance for a specific component
 */
export function createLogger(component: string) {
  return {
    /**
     * Log an error - always visible in console
     * Use for critical failures that affect functionality
     */
    error(message: string, error?: unknown, ctx?: Partial<LogContext>) {
      const prefix = formatContext({ component, ...ctx });
      if (error !== undefined) {
        if (ctx?.data !== undefined) {
          console.error(`${prefix} ${message}:`, formatError(error), ctx.data);
        } else {
          console.error(`${prefix} ${message}:`, formatError(error));
        }
      } else {
        if (ctx?.data !== undefined) {
          console.error(`${prefix} ${message}`, ctx.data);
        } else {
          console.error(`${prefix} ${message}`);
        }
      }
    },

    /**
     * Log a warning - always visible in console
     * Use for recoverable issues or degraded functionality
     */
    warn(message: string, ctx?: Partial<LogContext>) {
      const prefix = formatContext({ component, ...ctx });
      if (ctx?.data !== undefined) {
        console.warn(`${prefix} ${message}`, ctx.data);
      } else {
        console.warn(`${prefix} ${message}`);
      }
    },

    /**
     * Log info - only visible when IFC_DEBUG=true
     * Use for general operational information
     */
    info(message: string, ctx?: Partial<LogContext>) {
      if (!isDebugEnabled()) return;
      const prefix = formatContext({ component, ...ctx });
      if (ctx?.data !== undefined) {
        console.log(`${prefix} ${message}`, ctx.data);
      } else {
        console.log(`${prefix} ${message}`);
      }
    },

    /**
     * Log debug - only visible when IFC_DEBUG=true
     * Use for detailed debugging information
     */
    debug(message: string, data?: unknown, ctx?: Partial<LogContext>) {
      if (!isDebugEnabled()) return;
      const prefix = formatContext({ component, ...ctx });
      if (data !== undefined) {
        console.debug(`${prefix} ${message}`, data);
      } else {
        console.debug(`${prefix} ${message}`);
      }
    },

    /**
     * Log a caught error with context - visible when IFC_DEBUG=true
     * Use in catch blocks where the error is handled/recovered
     */
    caught(message: string, error: unknown, ctx?: Partial<LogContext>) {
      if (!isDebugEnabled()) return;
      const prefix = formatContext({ component, ...ctx });
      if (ctx?.data !== undefined) {
        console.debug(`${prefix} ${message} (recovered):`, formatError(error), ctx.data);
      } else {
        console.debug(`${prefix} ${message} (recovered):`, formatError(error));
      }
    },
  };
}

/**
 * Global logger for one-off logging without creating an instance
 */
export const logger = {
  error(component: string, message: string, error?: unknown) {
    createLogger(component).error(message, error);
  },
  warn(component: string, message: string) {
    createLogger(component).warn(message);
  },
  info(component: string, message: string) {
    createLogger(component).info(message);
  },
  debug(component: string, message: string, data?: unknown) {
    createLogger(component).debug(message, data);
  },
};
