/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useRef, useEffect, type MutableRefObject } from 'react';

/**
 * Keep a ref in sync with a value on every render.
 *
 * This replaces the common pattern of:
 *   const fooRef = useRef(foo);
 *   useEffect(() => { fooRef.current = foo; }, [foo]);
 *
 * The ref is updated synchronously during render (before effects),
 * so event handlers and animation loops always see the latest value
 * without needing to be re-created.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  // Update synchronously during render — no useEffect needed.
  // This is safe because we're only writing to a ref, not causing side effects.
  ref.current = value;
  return ref;
}
