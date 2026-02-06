/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API OAuth2 Authentication
 *
 * Supports two discovery methods:
 * 1. OpenCDE Foundation API: /foundation/versions + /foundation/{version}/auth
 * 2. BCF-API 2.1 native: /bcf/versions + /bcf/{version}/auth
 *
 * This ensures compatibility with both modern OpenCDE servers and older
 * BCF-API servers like BIMcollab.
 *
 * @see https://github.com/buildingSMART/foundation-API
 * @see https://github.com/buildingSMART/BCF-API/tree/release_2_1
 */

import type {
  ApiVersions,
  BcfNativeVersions,
  ApiAuth,
  ApiTokenResponse,
  ApiCurrentUser,
} from './types.js';

// ============================================================================
// Discovery
// ============================================================================

export interface ServerInfo {
  /** Base URL of the server */
  baseUrl: string;
  /** Supported BCF API version */
  apiVersion: string;
  /** Which discovery method was used */
  discoveryMethod: 'foundation' | 'bcf-native';
  /** OAuth2 authorization URL */
  authUrl?: string;
  /** OAuth2 token exchange URL */
  tokenUrl?: string;
  /** Supported OAuth2 flows */
  supportedFlows?: string[];
  /** Whether HTTP Basic auth is supported */
  httpBasicSupported?: boolean;
}

/**
 * Try to fetch JSON from a URL. Returns null on non-2xx or network errors.
 */
async function tryFetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Discover a BCF-API server's capabilities.
 *
 * Tries two discovery methods in order:
 * 1. OpenCDE Foundation API: GET /foundation/versions + GET /foundation/{version}/auth
 * 2. BCF-API 2.1 native: GET /bcf/versions + GET /bcf/{version}/auth
 *
 * This ensures compatibility with both modern OpenCDE servers and older BCF-API
 * servers like BIMcollab that predate the Foundation API standard.
 */
export async function discoverServer(serverUrl: string): Promise<ServerInfo> {
  const baseUrl = serverUrl.replace(/\/+$/, '');

  // ==========================================================================
  // Strategy 1: OpenCDE Foundation API
  // ==========================================================================
  const foundationVersions = await tryFetchJson<ApiVersions>(
    `${baseUrl}/foundation/versions`
  );

  if (foundationVersions?.versions?.length) {
    // Prefer BCF 3.0, fall back to 2.1, then any BCF entry
    const bcfVersion =
      foundationVersions.versions.find((v) => v.api_id === 'bcf' && v.version_id === '3.0') ??
      foundationVersions.versions.find((v) => v.api_id === 'bcf' && v.version_id === '2.1') ??
      foundationVersions.versions.find((v) => v.api_id === 'bcf');

    if (bcfVersion) {
      const apiVersion = bcfVersion.version_id;

      // Try Foundation auth endpoint
      const authData = await tryFetchJson<ApiAuth>(
        `${baseUrl}/foundation/${apiVersion}/auth`
      );

      return {
        baseUrl,
        apiVersion,
        discoveryMethod: 'foundation',
        authUrl: authData?.oauth2_auth_url,
        tokenUrl: authData?.oauth2_token_url,
        supportedFlows: authData?.supported_oauth2_flows,
        httpBasicSupported: authData?.http_basic_supported,
      };
    }
  }

  // ==========================================================================
  // Strategy 2: BCF-API 2.1 native (e.g., BIMcollab)
  // Spec: GET /bcf/versions → { versions: [{ version_id, detailed_version }] }
  //       GET /bcf/{version}/auth → { oauth2_auth_url, oauth2_token_url, ... }
  // ==========================================================================
  const bcfVersions = await tryFetchJson<BcfNativeVersions>(
    `${baseUrl}/bcf/versions`
  );

  if (bcfVersions?.versions?.length) {
    // BCF native versions don't have api_id — just version_id
    // Prefer 3.0, fall back to 2.1, then any available version
    const bcfVersion =
      bcfVersions.versions.find((v) => v.version_id === '3.0') ??
      bcfVersions.versions.find((v) => v.version_id === '2.1') ??
      bcfVersions.versions[0];

    if (bcfVersion) {
      const apiVersion = bcfVersion.version_id;

      // Try BCF native auth endpoint: GET /bcf/{version}/auth
      const authData = await tryFetchJson<ApiAuth>(
        `${baseUrl}/bcf/${apiVersion}/auth`
      );

      return {
        baseUrl,
        apiVersion,
        discoveryMethod: 'bcf-native',
        authUrl: authData?.oauth2_auth_url,
        tokenUrl: authData?.oauth2_token_url,
        supportedFlows: authData?.supported_oauth2_flows,
        httpBasicSupported: authData?.http_basic_supported,
      };
    }
  }

  // ==========================================================================
  // Neither method worked
  // ==========================================================================
  throw new Error(
    'Server discovery failed: no BCF API found. ' +
    'Tried /foundation/versions and /bcf/versions. ' +
    'Ensure the URL points to a BCF-API compatible server.'
  );
}

// ============================================================================
// PKCE Utilities
// ============================================================================

/**
 * Generate a random code verifier for PKCE (43-128 chars, unreserved characters).
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Compute the code challenge from a code verifier using SHA-256.
 */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Base64 URL encode (no padding, URL-safe characters).
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============================================================================
// OAuth2 Flow
// ============================================================================

export interface OAuthFlowOptions {
  /** OAuth2 authorization URL */
  authUrl: string;
  /** OAuth2 token URL */
  tokenUrl: string;
  /** Client ID registered with the BCF server */
  clientId: string;
  /** Redirect URI for the OAuth callback */
  redirectUri: string;
  /** Additional scopes to request */
  scope?: string;
}

export interface OAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Start the OAuth2 Authorization Code + PKCE flow using a popup window.
 *
 * 1. Opens popup to authUrl with PKCE challenge
 * 2. Waits for redirect with authorization code
 * 3. Exchanges code for tokens
 * 4. Returns tokens
 */
export async function startOAuthPopupFlow(
  options: OAuthFlowOptions
): Promise<OAuthResult> {
  const { authUrl, tokenUrl, clientId, redirectUri, scope } = options;

  // Generate PKCE pair
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);

  // Generate state for CSRF protection
  const stateArray = new Uint8Array(16);
  crypto.getRandomValues(stateArray);
  const state = base64UrlEncode(stateArray);

  // Build authorization URL
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  if (scope) {
    authParams.set('scope', scope);
  }

  const fullAuthUrl = `${authUrl}?${authParams.toString()}`;

  // Open popup
  const popup = window.open(
    fullAuthUrl,
    'bcf-oauth',
    'width=600,height=700,menubar=no,toolbar=no,location=yes,status=no'
  );

  if (!popup) {
    throw new Error(
      'Failed to open authentication popup. Please allow popups for this site.'
    );
  }

  // Wait for the redirect with the authorization code
  const code = await waitForOAuthCode(popup, redirectUri, state);

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text().catch(() => '');
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
  }

  const tokenData: ApiTokenResponse = await tokenResponse.json();

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? '',
    expiresIn: tokenData.expires_in ?? 3600,
  };
}

/**
 * Wait for the OAuth popup to redirect to our redirectUri with the authorization code.
 */
function waitForOAuthCode(
  popup: Window,
  redirectUri: string,
  expectedState: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const redirectOrigin = new URL(redirectUri).origin;

    // Listen for postMessage from the popup (if using a callback page)
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== redirectOrigin) return;
      if (event.data?.type === 'oauth_callback') {
        cleanup();
        const { code, state, error } = event.data;
        if (error) {
          reject(new Error(`OAuth error: ${error}`));
        } else if (state !== expectedState) {
          reject(new Error('OAuth state mismatch - possible CSRF attack'));
        } else {
          resolve(code);
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // Also poll the popup URL (fallback for servers that don't use postMessage)
    const pollInterval = setInterval(() => {
      try {
        if (popup.closed) {
          cleanup();
          reject(new Error('Authentication cancelled - popup was closed'));
          return;
        }

        // Try to read the popup's location (same-origin only)
        const popupUrl = popup.location.href;
        if (popupUrl.startsWith(redirectUri)) {
          cleanup();
          const url = new URL(popupUrl);
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          popup.close();

          if (error) {
            reject(new Error(`OAuth error: ${error}`));
          } else if (state !== expectedState) {
            reject(new Error('OAuth state mismatch'));
          } else if (!code) {
            reject(new Error('No authorization code in callback'));
          } else {
            resolve(code);
          }
        }
      } catch {
        // Cross-origin access to popup location will throw — that's expected
      }
    }, 500);

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      cleanup();
      popup.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);

    function cleanup(): void {
      window.removeEventListener('message', messageHandler);
      clearInterval(pollInterval);
      clearTimeout(timeout);
    }
  });
}

// ============================================================================
// Basic Auth (API Key)
// ============================================================================

/**
 * Encode credentials for HTTP Basic Authentication.
 *
 * This is used for servers like OpenProject that support API key auth.
 * The returned string should be used as: `Authorization: Basic <result>`
 */
export function encodeBasicAuth(username: string, password: string): string {
  const encoded = btoa(`${username}:${password}`);
  return encoded;
}

/**
 * Validate Basic Auth credentials by attempting to fetch the current user.
 *
 * Tries both Foundation API and BCF native paths, same as getCurrentUser.
 * Throws on invalid credentials.
 */
export async function validateBasicAuth(
  baseUrl: string,
  version: string,
  basicToken: string,
  discoveryMethod: 'foundation' | 'bcf-native' = 'foundation'
): Promise<ApiCurrentUser> {
  const headers = {
    Authorization: `Basic ${basicToken}`,
    Accept: 'application/json',
  };

  const primaryPath = discoveryMethod === 'foundation'
    ? `${baseUrl}/foundation/${version}/current-user`
    : `${baseUrl}/bcf/${version}/current-user`;

  const fallbackPath = discoveryMethod === 'foundation'
    ? `${baseUrl}/bcf/${version}/current-user`
    : `${baseUrl}/foundation/${version}/current-user`;

  // Try primary
  try {
    const response = await fetch(primaryPath, { headers });
    if (response.ok) {
      return await response.json();
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid credentials. Check your username and API key.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Invalid credentials')) throw e;
    // Network error — try fallback
  }

  // Try fallback
  try {
    const response = await fetch(fallbackPath, { headers });
    if (response.ok) {
      return await response.json();
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid credentials. Check your username and API key.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Invalid credentials')) throw e;
    // Network error — return default
  }

  // Neither worked but no auth error — return placeholder
  return { id: 'unknown', name: 'User' };
}

// ============================================================================
// User Info
// ============================================================================

/**
 * Get the current user's info.
 *
 * Tries Foundation API (/foundation/{version}/current-user) first,
 * then BCF native (/bcf/{version}/current-user) as fallback.
 * If neither works, returns a minimal user object with the provided email.
 */
export async function getCurrentUser(
  baseUrl: string,
  version: string,
  accessToken: string,
  discoveryMethod: 'foundation' | 'bcf-native' = 'foundation'
): Promise<ApiCurrentUser> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };

  // Try the endpoint that matches the discovery method first
  const primaryPath = discoveryMethod === 'foundation'
    ? `${baseUrl}/foundation/${version}/current-user`
    : `${baseUrl}/bcf/${version}/current-user`;

  const fallbackPath = discoveryMethod === 'foundation'
    ? `${baseUrl}/bcf/${version}/current-user`
    : `${baseUrl}/foundation/${version}/current-user`;

  // Try primary
  try {
    const response = await fetch(primaryPath, { headers });
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error — try fallback
  }

  // Try fallback
  try {
    const response = await fetch(fallbackPath, { headers });
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error — return default
  }

  // Neither worked — return a placeholder user (auth still succeeded)
  return { id: 'unknown', name: 'User' };
}
