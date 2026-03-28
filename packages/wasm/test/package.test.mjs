/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

describe('@ifc-lite/wasm packaging', () => {
  it('packs the rayon snippet helper into the published tarball', () => {
    const packDir = mkdtempSync(join(tmpdir(), 'ifc-lite-wasm-pack-'));

    try {
      execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
        cwd: packageDir,
        stdio: 'pipe',
      });

      const [tarball] = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
      assert.ok(tarball, 'expected pnpm pack to produce a tarball');

      const listing = execFileSync('tar', ['-tf', join(packDir, tarball)], {
        encoding: 'utf8',
      });

      assert.match(
        listing,
        /package\/pkg\/snippets\/wasm-bindgen-rayon-[^/]+\/src\/workerHelpers\.js/,
      );
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  });
});
