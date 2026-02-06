/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF-API OAuth2 Authentication
 *
 * Implements the OpenCDE Foundation API discovery and OAuth2 Authorization Code + PKCE flow.
 * @see https://github.com/buildingSMART/foundation-API
 */

import type {
  ApiVersions,
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
 * Discover a BCF-API server's capabilities.
 * Calls GET /foundation/versions then GET /foundation/{version}/auth.
 */
export async function discoverServer(serverUrl: string): Promise<ServerInfo> {
  const baseUrl = serverUrl.replace(/\/+$/, '');

  // Step 1: Discover supported versions
  const versionsResponse = await fetch(`${baseUrl}/foundation/versions`, {
    headers: { Accept: 'application/json' },
  });

  if (!versionsResponse.ok) {
    throw new Error(
      `Server discovery failed: ${versionsResponse.status} ${versionsResponse.statusText}`
    );
  }

  const versionsData: ApiVersions = await versionsResponse.json();

  // Prefer BCF 3.0, fall back to 2.1
  const bcfVersion =
    versionsData.versions.find((v) => v.api_id === 'bcf' && v.version_id === '3.0') ??
    versionsData.versions.find((v) => v.api_id === 'bcf' && v.version_id === '2.1') ??
    versionsData.versions.find((v) => v.api_id === 'bcf');

  if (!bcfVersion) {
    throw new Error('Server does not support the BCF API');
  }

  const apiVersion = bcfVersion.version_id;

  // Step 2: Discover auth endpoints
  const authResponse = await fetch(`${baseUrl}/foundation/${apiVersion}/auth`, {
    headers: { Accept: 'application/json' },
  });

  if (!authResponse.ok) {
    // Auth endpoint not available — server may not require authentication
    return { baseUrl, apiVersion };
  }

  const authData: ApiAuth = await authResponse.json();

  return {
    baseUrl,
    apiVersion,
    authUrl: authData.oauth2_auth_url,
    tokenUrl: authData.oauth2_token_url,
    supportedFlows: authData.supported_oauth2_flows,
    httpBasicSupported: authData.http_basic_supported,
  };
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
// User Info
// ============================================================================

/**
 * Get the current user's info from the Foundation API.
 */
export async function getCurrentUser(
  baseUrl: string,
  version: string,
  accessToken: string
): Promise<ApiCurrentUser> {
  const response = await fetch(
    `${baseUrl}/foundation/${version}/current-user`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get current user: ${response.status}`);
  }

  return response.json();
}
