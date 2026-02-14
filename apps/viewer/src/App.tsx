/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Main application component
 */

import { ViewerLayout } from './components/viewer/ViewerLayout';
import { useBimHost } from './sdk/useBimHost';

export function App() {
  // Initialize SDK backend and BimHost — external tools (ifc-scripts, ifc-flow)
  // can connect via BroadcastChannel 'ifc-lite' to control the viewer.
  useBimHost();

  return <ViewerLayout />;
}

export default App;
