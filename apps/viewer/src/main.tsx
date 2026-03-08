/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Application entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './App';
import './index.css';

const clerkPublishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <App />
      </ClerkProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
