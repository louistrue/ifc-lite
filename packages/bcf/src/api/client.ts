/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API HTTP client
 *
 * Thin wrapper around fetch() with:
 * - Bearer token authentication
 * - Automatic token refresh on 401
 * - JSON serialization/deserialization
 * - Binary (snapshot) support
 */

import type { ApiTokenResponse } from './types.js';

// ============================================================================
// Error Types
// ============================================================================

export class BCFApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'BCFApiError';
  }
}

// ============================================================================
// Client
// ============================================================================

export interface BCFApiClientOptions {
  /** Server base URL (e.g., "https://bcf.example.com") */
  baseUrl: string;
  /** BCF API version (e.g., "3.0" or "2.1") */
  version: string;
  /** Current access token */
  accessToken: string;
  /** Refresh token for automatic renewal */
  refreshToken?: string;
  /** OAuth2 token endpoint URL */
  tokenUrl?: string;
  /** Callback when tokens are refreshed */
  onTokenRefresh?: (accessToken: string, refreshToken: string, expiresIn: number) => void;
  /** Callback when authentication fails permanently */
  onAuthFailure?: () => void;
}

export class BCFApiClient {
  private baseUrl: string;
  private version: string;
  private accessToken: string;
  private refreshToken: string | undefined;
  private tokenUrl: string | undefined;
  private onTokenRefresh: BCFApiClientOptions['onTokenRefresh'];
  private onAuthFailure: BCFApiClientOptions['onAuthFailure'];
  private refreshPromise: Promise<boolean> | null = null;

  constructor(options: BCFApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.version = options.version;
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.tokenUrl = options.tokenUrl;
    this.onTokenRefresh = options.onTokenRefresh;
    this.onAuthFailure = options.onAuthFailure;
  }

  /** Update access token (e.g., after refresh) */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /** Build the full API path for BCF endpoints */
  private bcfPath(path: string): string {
    return `${this.baseUrl}/bcf/${this.version}${path}`;
  }

  /** Build the full API path for foundation endpoints */
  foundationPath(path: string): string {
    return `${this.baseUrl}/foundation/${this.version}${path}`;
  }

  /** Common headers for all requests */
  private headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };
    if (contentType) {
      h['Content-Type'] = contentType;
    }
    return h;
  }

  /**
   * Try to refresh the access token.
   * Returns true if successful, false otherwise.
   * Deduplicates concurrent refresh attempts.
   */
  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken || !this.tokenUrl) {
      return false;
    }

    // Deduplicate concurrent refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken!,
        });

        const response = await fetch(this.tokenUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!response.ok) {
          return false;
        }

        const data: ApiTokenResponse = await response.json();
        this.accessToken = data.access_token;
        if (data.refresh_token) {
          this.refreshToken = data.refresh_token;
        }

        this.onTokenRefresh?.(
          data.access_token,
          data.refresh_token ?? this.refreshToken ?? '',
          data.expires_in ?? 3600
        );

        return true;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Core fetch wrapper with auth and retry on 401.
   */
  private async request(
    url: string,
    init: RequestInit,
    isBinary = false
  ): Promise<Response> {
    let response = await fetch(url, init);

    // On 401, try token refresh then retry once
    if (response.status === 401) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        // Update authorization header and retry
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${this.accessToken}`);
        response = await fetch(url, { ...init, headers });
      }

      if (response.status === 401) {
        this.onAuthFailure?.();
        throw new BCFApiError(
          'Authentication failed',
          401,
          response.statusText
        );
      }
    }

    if (!response.ok && !(isBinary && response.status === 404)) {
      const bodyText = await response.text().catch(() => '');
      throw new BCFApiError(
        `BCF API error: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
        bodyText
      );
    }

    return response;
  }

  // ============================================================================
  // JSON Methods
  // ============================================================================

  async get<T>(path: string): Promise<T> {
    const response = await this.request(this.bcfPath(path), {
      method: 'GET',
      headers: this.headers(),
    });
    return response.json();
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(this.bcfPath(path), {
      method: 'POST',
      headers: this.headers('application/json'),
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(this.bcfPath(path), {
      method: 'PUT',
      headers: this.headers('application/json'),
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async delete(path: string): Promise<void> {
    await this.request(this.bcfPath(path), {
      method: 'DELETE',
      headers: this.headers(),
    });
  }

  // ============================================================================
  // Binary Methods (for snapshots)
  // ============================================================================

  /** GET binary content and return as data URL */
  async getBinaryAsDataUrl(path: string): Promise<string | null> {
    try {
      const response = await this.request(
        this.bcfPath(path),
        {
          method: 'GET',
          headers: {
            ...this.headers(),
            Accept: 'image/png, image/jpeg',
          },
        },
        true
      );

      if (response.status === 404) {
        return null;
      }

      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read snapshot blob'));
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Foundation API Methods
  // ============================================================================

  async getFoundation<T>(path: string): Promise<T> {
    const response = await this.request(this.foundationPath(path), {
      method: 'GET',
      headers: this.headers(),
    });
    return response.json();
  }
}
