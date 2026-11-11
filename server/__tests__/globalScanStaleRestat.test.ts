import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GLOBAL_SCAN_STALE_RESTAT_MS } from '../src/constants.js';
import { findActiveSessionsInRoots } from '../src/fileWatcher.js';

describe('global scan: a past session is not stat-ed on every pass', () => {
  let root = '';
  afterEach(() => {
    vi.restoreAllMocks();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('re-stats a stale transcript only after the restat window, then adopts it once resumed', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-stale-restat-'));
    const dir = path.join(root, '-project');
    fs.mkdirSync(dir);
    const old = path.join(dir, 'old.jsonl');
    const fresh = path.join(dir, 'fresh.jsonl');
    fs.writeFileSync(old, 'x'.repeat(4096));
    fs.writeFileSync(fresh, 'x'); // fresh but under the size gate
    const anHourAgo = new Date(Date.now() - 3_600_000);
    fs.utimesSync(old, anHourAgo, anHourAgo);

    const stat = vi.spyOn(fs.promises, 'stat');
    const statted = () => stat.mock.calls.map((c) => String(c[0]));
    const t0 = Date.now();

    expect(await findActiveSessionsInRoots([root], () => false, t0)).toEqual([]);
    expect(statted()).toEqual(expect.arrayContaining([old, fresh]));

    // The session is resumed, but inside the window the file is not looked at.
    fs.utimesSync(old, new Date(t0), new Date(t0));
    stat.mockClear();
    expect(await findActiveSessionsInRoots([root], () => false, t0 + 1_000)).toEqual([]);
    expect(statted()).not.toContain(old);
    // A fresh file under the size gate is still looked at every pass.
    expect(statted()).toContain(fresh);

    stat.mockClear();
    const later = t0 + GLOBAL_SCAN_STALE_RESTAT_MS + 1;
    expect(await findActiveSessionsInRoots([root], () => false, later)).toEqual([
      { file: old, dirPath: dir },
    ]);
    expect(statted()).toContain(old);
  });
});
