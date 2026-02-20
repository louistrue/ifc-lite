/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Main application component
 */

import { ViewerLayout } from './components/viewer/ViewerLayout';
import { BimProvider } from './sdk/BimProvider';

export function App() {
  return (
    <BimProvider>
      <ViewerLayout />
    </BimProvider>
  );
}

export default App;
