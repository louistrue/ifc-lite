/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { neon } from '@neondatabase/serverless';
import {
  createChatHandler,
  loadChatConfig,
  requireEnv,
} from '../server/chat/chat-handler.js';
import { SqlChatUsageStore } from '../server/chat/sql-chat-usage-store.js';

const chatConfig = loadChatConfig(process.env);
const databaseUrl = requireEnv('DATABASE_URL');
const usageStore = new SqlChatUsageStore(neon(databaseUrl), chatConfig);

export const runtime = 'edge';
export const config = { runtime: 'edge' };

const handler = createChatHandler(chatConfig, {
  fetchImpl: fetch,
  usageStore,
  now: () => Date.now(),
});

export default handler;
