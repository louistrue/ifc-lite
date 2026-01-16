// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type {
  ErrorResponse,
  HealthResponse,
  MetadataResponse,
  ParseResponse,
  ServerConfig,
  StreamEvent,
} from './types';

/**
 * Client for the IFC-Lite Server API.
 *
 * @example
 * ```typescript
 * const client = new IfcServerClient({
 *   baseUrl: 'https://ifc-lite.railway.app'
 * });
 *
 * // Check server health
 * const health = await client.health();
 * console.log(health.status);
 *
 * // Parse IFC file
 * const result = await client.parse(file);
 * console.log(`Meshes: ${result.meshes.length}`);
 * ```
 */
export class IfcServerClient {
  private baseUrl: string;
  private timeout: number;

  /**
   * Create a new IFC server client.
   *
   * @param config - Client configuration
   */
  constructor(config: ServerConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 300000; // 5 minutes default
  }

  /**
   * Check server health.
   *
   * @returns Health status
   */
  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  /**
   * Parse IFC file and return all geometry.
   *
   * For large files (>10MB), consider using `parseStream()` instead
   * to receive progressive updates.
   *
   * @param file - File or ArrayBuffer containing IFC data
   * @returns Parse result with all meshes
   *
   * @example
   * ```typescript
   * const result = await client.parse(file);
   * for (const mesh of result.meshes) {
   *   scene.add(createMesh(mesh.positions, mesh.indices, mesh.color));
   * }
   * ```
   */
  async parse(file: File | ArrayBuffer): Promise<ParseResponse> {
    const formData = new FormData();
    formData.append(
      'file',
      file instanceof File ? file : new Blob([file]),
      file instanceof File ? file.name : 'model.ifc'
    );

    const response = await fetch(`${this.baseUrl}/api/v1/parse`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  /**
   * Parse IFC file with streaming response.
   *
   * Yields events as geometry is processed, allowing for
   * progressive rendering of large models.
   *
   * @param file - File or ArrayBuffer containing IFC data
   * @yields Stream events (start, progress, batch, complete, error)
   *
   * @example
   * ```typescript
   * for await (const event of client.parseStream(file)) {
   *   switch (event.type) {
   *     case 'start':
   *       console.log(`Processing ~${event.total_estimate} entities`);
   *       break;
   *     case 'progress':
   *       updateProgressBar(event.processed / event.total);
   *       break;
   *     case 'batch':
   *       for (const mesh of event.meshes) {
   *         scene.add(createMesh(mesh));
   *       }
   *       break;
   *     case 'complete':
   *       console.log(`Done in ${event.stats.total_time_ms}ms`);
   *       break;
   *     case 'error':
   *       console.error(event.message);
   *       break;
   *   }
   * }
   * ```
   */
  async *parseStream(file: File | ArrayBuffer): AsyncGenerator<StreamEvent> {
    const formData = new FormData();
    const blob = file instanceof File ? file : new Blob([file], { type: 'application/octet-stream' });
    formData.append(
      'file',
      blob,
      file instanceof File ? file.name : 'model.ifc'
    );

    const response = await fetch(`${this.baseUrl}/api/v1/parse/stream`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header - browser will set it with boundary for FormData
      headers: {
        Accept: 'text/event-stream',
      },
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as StreamEvent;
              yield data;
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith('data: ')) {
        try {
          const data = JSON.parse(buffer.slice(6)) as StreamEvent;
          yield data;
        } catch {
          // Skip malformed events
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get quick metadata about an IFC file without processing geometry.
   *
   * This is much faster than a full parse and is useful for
   * showing file information before processing.
   *
   * @param file - File or ArrayBuffer containing IFC data
   * @returns Metadata about the file
   *
   * @example
   * ```typescript
   * const meta = await client.getMetadata(file);
   * console.log(`${meta.entity_count} entities, ${meta.geometry_count} with geometry`);
   * console.log(`Schema: ${meta.schema_version}`);
   * ```
   */
  async getMetadata(file: File | ArrayBuffer): Promise<MetadataResponse> {
    const formData = new FormData();
    formData.append(
      'file',
      file instanceof File ? file : new Blob([file]),
      file instanceof File ? file.name : 'model.ifc'
    );

    const response = await fetch(`${this.baseUrl}/api/v1/parse/metadata`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000), // 30 second timeout for metadata
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  /**
   * Retrieve a cached parse result by key.
   *
   * @param key - Cache key (SHA256 hash of file content)
   * @returns Cached parse result, or null if not found
   *
   * @example
   * ```typescript
   * // Store the cache key from a previous parse
   * const result = await client.parse(file);
   * const cacheKey = result.cache_key;
   *
   * // Later, retrieve from cache
   * const cached = await client.getCached(cacheKey);
   * if (cached) {
   *   console.log('Loaded from cache!');
   * }
   * ```
   */
  async getCached(key: string): Promise<ParseResponse | null> {
    const response = await fetch(`${this.baseUrl}/api/v1/cache/${key}`, {
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  /**
   * Handle error responses from the server.
   */
  private async handleError(response: Response): Promise<Error> {
    try {
      const error: ErrorResponse = await response.json();
      return new Error(`Server error (${error.code}): ${error.error}`);
    } catch {
      return new Error(`Server error: ${response.status} ${response.statusText}`);
    }
  }
}
