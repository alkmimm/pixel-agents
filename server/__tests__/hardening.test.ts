/**
 * pixel-agents-secure: invariants of the hardening commits (H0–H7).
 *
 * One file on purpose: the governance repo runs it on every update branch
 * (scripts/check-hardening.sh) to prove the hardening still holds after an
 * upstream merge (checklist item C13). A failure here means an upstream change
 * undid a hardening commit -- fix the merge, do not relax the test.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(__dirname, '../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
  name: string;
  publisher: string;
  displayName: string;
  bin?: unknown;
  files?: string[];
};

describe('H0: own extension identity', () => {
  it('never ships under the upstream Marketplace ID', () => {
    expect(rootPackage.publisher).not.toBe('pablodelucca');
    expect(rootPackage.name).toBe('pixel-agents-secure');
    expect(`${rootPackage.publisher}.${rootPackage.name}`).not.toBe('pablodelucca.pixel-agents');
  });
});

/** Every source file under the shipped trees (tests excluded). */
function sourceFiles(): string[] {
  const roots = ['adapters', 'core/src', 'server/src', 'webview-ui/src'];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs|html)$/.test(entry.name)) out.push(full);
    }
  };
  for (const root of roots) walk(path.join(REPO_ROOT, root));
  return out;
}

describe('H1: no Skip Permissions', () => {
  it('the launch command never carries the skip-permissions flag', async () => {
    const { claudeProvider } = await import('../src/providers/hook/claude/claude.js');
    for (const opts of [undefined, {}, { resume: true }, { bypassPermissions: true }]) {
      const launch = claudeProvider.buildLaunchCommand!(
        '00000000-0000-4000-8000-000000000000',
        '/tmp',
        opts as { resume?: boolean },
      );
      expect(launch.args.join(' ')).not.toMatch(/dangerously|skip-permissions/);
    }
  });

  it('no shipped source file contains the flag or the toggle', () => {
    const offenders = sourceFiles().filter((file) => {
      const text = fs.readFileSync(file, 'utf-8');
      return /dangerously-skip-permissions|>\s*Skip Permissions\s*</.test(text);
    });
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });
});

describe('H2: loopback-only bind', () => {
  it('refuses every non-loopback bind address before listening', async () => {
    const { createHttpServer } = await import('../src/httpServer.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    for (const host of ['0.0.0.0', '::', 'localhost', '192.168.0.10']) {
      await expect(
        createHttpServer({ embedded: true, host, token: 't', store: new AgentStateStore() }),
      ).rejects.toThrow(/127\.0\.0\.1 only/);
    }
  });

  it('listens on 127.0.0.1 when no host is given', async () => {
    const { createHttpServer } = await import('../src/httpServer.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { app } = await createHttpServer({
      embedded: true,
      token: 't',
      store: new AgentStateStore(),
    });
    try {
      const address = app.server.address();
      expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
    } finally {
      await app.close();
    }
  });

  it('the CLI refuses --host off loopback and --allowed-host', async () => {
    const { parseArgs } = await import('../src/cli.js');
    expect(() => parseArgs(['--host', '0.0.0.0'])).toThrow();
    expect(() => parseArgs(['--allowed-host', 'proxy.example'])).toThrow();
  });
});

describe('H3: no standalone CLI and no PTY in the extension package', () => {
  it('package.json exposes no bin and ships neither the CLI nor the PTY host', () => {
    expect(rootPackage.bin).toBeUndefined();
    const files = rootPackage.files ?? [];
    expect(files.length).toBeGreaterThan(0);
    for (const entry of files) {
      expect(entry).not.toMatch(/cli\.js|pty-host|node_modules|node-pty/);
    }
  });

  it('the VS Code adapter never wires a PTY', () => {
    const adapterFiles = fs
      .readdirSync(path.join(REPO_ROOT, 'adapters/vscode'))
      .map((f) => fs.readFileSync(path.join(REPO_ROOT, 'adapters/vscode', f), 'utf-8'));
    for (const text of adapterFiles) {
      expect(text).not.toMatch(/PtySessionManager|RemotePtySessions|ptyManager|node-pty/);
    }
  });
});
