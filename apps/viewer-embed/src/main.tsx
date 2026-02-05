/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Embed viewer entry point.
 *
 * Minimal entry that mounts the EmbedViewer component with no additional chrome.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { EmbedViewer } from './components/EmbedViewer';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EmbedViewer />
  </React.StrictMode>
);
