// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type {
  ErrorResponse,
  HealthResponse,
  MetadataResponse,
  OptimizedParquetMetadataHeader,
  OptimizedParquetParseResponse,
  ParquetMetadataHeader,
  ParquetParseResponse,
  ParseResponse,
  ServerConfig,
  StreamEvent,
} from './types';
import { decodeParquetGeometry, decodeOptimizedParquetGeometry, isParquetAvailable } from './parquet-decoder';

/**
 * Compress a file or ArrayBuffer using gzip compression.
 * Uses the browser's CompressionStream API for efficient compression.
 *
 * @param file - File or ArrayBuffer to compress
 * @returns Compressed Blob
 */
async function compressGzip(file: File | ArrayBuffer): Promise<Blob> {
  const stream = file instanceof File ? file.stream() : new Blob([file]).stream();
  const compressionStream = new CompressionStream('gzip');
  const compressedStream = stream.pipeThrough(compressionStream);
  return new Response(compressedStream).blob();
}

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
    // Compress file before upload for faster transfer
    const compressedFile = await compressGzip(file);
    const fileName = file instanceof File ? file.name : 'model.ifc';

    const formData = new FormData();
    formData.append('file', compressedFile, fileName);

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
   * Parse IFC file and return geometry in Parquet format.
   *
   * This method provides ~15x smaller payload size compared to JSON,
   * which is critical for large IFC files over network connections.
   *
   * **Requirements:** This method requires `parquet-wasm` and `apache-arrow`
   * to be installed as peer dependencies.
   *
   * @param file - File or ArrayBuffer containing IFC data
   * @returns Parse result with all meshes (decoded from Parquet)
   *
   * @example
   * ```typescript
   * const result = await client.parseParquet(file);
   * console.log(`Payload: ${result.parquet_stats.payload_size} bytes`);
   * console.log(`Decode time: ${result.parquet_stats.decode_time_ms}ms`);
   * for (const mesh of result.meshes) {
   *   scene.add(createMesh(mesh.positions, mesh.indices, mesh.color));
   * }
   * ```
   */
  async parseParquet(file: File | ArrayBuffer): Promise<ParquetParseResponse> {
    // Check if Parquet decoding is available
    const parquetReady = await isParquetAvailable();
    if (!parquetReady) {
      throw new Error(
        'Parquet parsing requires parquet-wasm and apache-arrow. ' +
        'Install them with: npm install parquet-wasm apache-arrow'
      );
    }

    // Compress file before upload for faster transfer
    const compressedFile = await compressGzip(file);
    const fileName = file instanceof File ? file.name : 'model.ifc';

    const formData = new FormData();
    formData.append('file', compressedFile, fileName);

    const response = await fetch(`${this.baseUrl}/api/v1/parse/parquet`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    // Extract metadata from header
    const metadataHeader = response.headers.get('X-IFC-Metadata');
    if (!metadataHeader) {
      throw new Error('Missing X-IFC-Metadata header in Parquet response');
    }

    const metadata: ParquetMetadataHeader = JSON.parse(metadataHeader);

    // Get binary payload
    const payloadBuffer = await response.arrayBuffer();
    const payloadSize = payloadBuffer.byteLength;

    // Decode Parquet geometry
    const decodeStart = performance.now();
    const meshes = await decodeParquetGeometry(payloadBuffer);
    const decodeTime = performance.now() - decodeStart;

    return {
      cache_key: metadata.cache_key,
      meshes,
      metadata: metadata.metadata,
      stats: metadata.stats,
      parquet_stats: {
        payload_size: payloadSize,
        decode_time_ms: Math.round(decodeTime),
      },
    };
  }

  /**
   * Check if Parquet parsing is available.
   *
   * @returns true if parquet-wasm is available for parseParquet()
   */
  async isParquetSupported(): Promise<boolean> {
    return isParquetAvailable();
  }

  /**
   * Parse IFC file using the ara3d BOS-optimized Parquet format.
   *
   * This is the most efficient transfer format, providing:
   * - ~50x smaller payloads compared to JSON
   * - Integer quantized vertices (0.1mm precision)
   * - Mesh deduplication (instancing)
   * - Byte colors instead of floats
   * - Optional normals (computed on client if not included)
   *
   * **Requirements:** Requires `parquet-wasm` and `apache-arrow`.
   *
   * @param file - File or ArrayBuffer containing IFC data
   * @returns Parse result with all meshes (decoded from optimized Parquet)
   *
   * @example
   * ```typescript
   * const result = await client.parseParquetOptimized(file);
   * console.log(`Unique meshes: ${result.optimization_stats.unique_meshes}`);
   * console.log(`Mesh reuse ratio: ${result.optimization_stats.mesh_reuse_ratio}x`);
   * console.log(`Payload: ${result.parquet_stats.payload_size} bytes`);
   * ```
   */
  async parseParquetOptimized(file: File | ArrayBuffer): Promise<OptimizedParquetParseResponse> {
    // Check if Parquet decoding is available
    const parquetReady = await isParquetAvailable();
    if (!parquetReady) {
      throw new Error(
        'Parquet parsing requires parquet-wasm and apache-arrow. ' +
        'Install them with: npm install parquet-wasm apache-arrow'
      );
    }

    // Compress file before upload for faster transfer
    const compressedFile = await compressGzip(file);
    const fileName = file instanceof File ? file.name : 'model.ifc';

    const formData = new FormData();
    formData.append('file', compressedFile, fileName);

    const response = await fetch(`${this.baseUrl}/api/v1/parse/parquet/optimized`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    // Extract metadata from header
    const metadataHeader = response.headers.get('X-IFC-Metadata');
    if (!metadataHeader) {
      throw new Error('Missing X-IFC-Metadata header in optimized Parquet response');
    }

    const metadata: OptimizedParquetMetadataHeader = JSON.parse(metadataHeader);

    // Get binary payload
    const payloadBuffer = await response.arrayBuffer();
    const payloadSize = payloadBuffer.byteLength;

    // Decode optimized Parquet geometry
    const decodeStart = performance.now();
    const meshes = await decodeOptimizedParquetGeometry(payloadBuffer, metadata.vertex_multiplier);
    const decodeTime = performance.now() - decodeStart;

    return {
      cache_key: metadata.cache_key,
      meshes,
      metadata: metadata.metadata,
      stats: metadata.stats,
      optimization_stats: metadata.optimization_stats,
      parquet_stats: {
        payload_size: payloadSize,
        decode_time_ms: Math.round(decodeTime),
      },
    };
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
