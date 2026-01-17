// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Platform detection for binary downloads.
 */

import { execSync } from 'child_process';
import process from 'process';

export type Platform = 'darwin' | 'linux' | 'win32';
export type Arch = 'x64' | 'arm64';

export interface PlatformInfo {
  platform: Platform;
  arch: Arch;
  binaryName: string;
  archiveName: string;
  targetTriple: string;
  isMusl: boolean;
}

/**
 * Supported platform/arch combinations.
 */
const SUPPORTED_TARGETS = new Set([
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'linux-x64-musl',
  'win32-x64',
]);

/**
 * Detect if running on musl-based Linux (Alpine, etc.)
 */
function isMuslLinux(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    // Check if we're in an Alpine container or musl-based system
    const result = execSync('ldd --version 2>&1 || true', { encoding: 'utf-8' });
    return result.toLowerCase().includes('musl');
  } catch {
    // If we can't determine, assume glibc
    return false;
  }
}

/**
 * Get current platform information.
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = process.platform as Platform;
  const arch = process.arch as Arch;

  // Validate platform
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(
      `Unsupported platform: ${platform}. ` +
      `Supported platforms: macOS (darwin), Linux, Windows (win32)`
    );
  }

  // Validate architecture
  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(
      `Unsupported architecture: ${arch}. ` +
      `Supported architectures: x64 (Intel/AMD), arm64 (Apple Silicon, ARM)`
    );
  }

  // Check for musl on Linux
  const isMusl = platform === 'linux' && isMuslLinux();

  // Build target string
  const targetSuffix = isMusl ? '-musl' : '';
  const targetTriple = `${platform}-${arch}${targetSuffix}`;

  if (!SUPPORTED_TARGETS.has(targetTriple)) {
    throw new Error(
      `Unsupported platform/architecture combination: ${targetTriple}. ` +
      `Supported targets: ${Array.from(SUPPORTED_TARGETS).join(', ')}`
    );
  }

  // Binary name varies by platform
  const binaryName = platform === 'win32' ? 'ifc-lite-server.exe' : 'ifc-lite-server';

  // Archive name for downloads
  const archiveName = `ifc-lite-server-${targetTriple}.tar.gz`;

  return {
    platform,
    arch,
    binaryName,
    archiveName,
    targetTriple,
    isMusl,
  };
}

/**
 * Get a human-readable platform description.
 */
export function getPlatformDescription(info: PlatformInfo): string {
  const platformNames: Record<Platform, string> = {
    darwin: 'macOS',
    linux: 'Linux',
    win32: 'Windows',
  };

  const archNames: Record<Arch, string> = {
    x64: 'x64 (Intel/AMD)',
    arm64: 'ARM64 (Apple Silicon/ARM)',
  };

  const muslSuffix = info.isMusl ? ' (musl/Alpine)' : '';
  return `${platformNames[info.platform]} ${archNames[info.arch]}${muslSuffix}`;
}
