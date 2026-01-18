/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState, useEffect } from 'react';

export interface WebGPUStatus {
  supported: boolean;
  checking: boolean;
  reason: string | null;
}

/**
 * Robust WebGPU detection hook.
 *
 * Detection method:
 * 1. Check if navigator.gpu exists (basic API availability)
 * 2. Attempt to request a GPU adapter (confirms actual hardware/driver support)
 *
 * This two-step check is necessary because:
 * - Some browsers expose navigator.gpu but fail to provide an adapter
 * - Software rendering may be available but unsuitable for our use case
 * - Driver issues can prevent adapter creation even with WebGPU support
 */
export function useWebGPU(): WebGPUStatus {
  const [status, setStatus] = useState<WebGPUStatus>({
    supported: false,
    checking: true,
    reason: null,
  });

  useEffect(() => {
    async function checkWebGPUSupport() {
      // Step 1: Check if WebGPU API is available
      if (!navigator.gpu) {
        setStatus({
          supported: false,
          checking: false,
          reason: 'WebGPU API not available in this browser',
        });
        return;
      }

      try {
        // Step 2: Try to get a GPU adapter
        // This confirms actual hardware/driver support
        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) {
          setStatus({
            supported: false,
            checking: false,
            reason: 'No compatible GPU adapter found',
          });
          return;
        }

        // Optional: Check for required features if needed
        // const features = adapter.features;
        // const limits = adapter.limits;

        setStatus({
          supported: true,
          checking: false,
          reason: null,
        });
      } catch (error) {
        setStatus({
          supported: false,
          checking: false,
          reason: error instanceof Error ? error.message : 'Failed to initialize WebGPU',
        });
      }
    }

    checkWebGPUSupport();
  }, []);

  return status;
}
