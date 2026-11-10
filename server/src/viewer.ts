#!/usr/bin/env node

/**
 * pixel-agents-secure (H11): the office VIEWER.
 *
 * A read-only way to watch the office in a browser, bundled on its own as
 * `dist/office-server.js`. It is NOT the upstream standalone CLI (cli.ts):
 *
 * - it launches nothing: no PTY, no agent launcher, no terminal route;
 * - it installs nothing: it never touches a hook entry, a hook script or
 *   ~/.claude/settings.json. The VS Code extension owns the hooks; the viewer
 *   only receives the events an already-installed hook script fans out to it;
 * - every browser client is read-only (`readOnly` below), whatever it sends;
 * - the bind address is not an option (H2: 127.0.0.1 only).
 *
 * It composes the same AgentRuntime the two upstream surfaces compose, so what
 * it shows is what they show. Kept in its own file so upstream changes to
 * cli.ts never merge into it silently: if the runtime API moves, this file
 * stops compiling, which is the signal to review it.
 */

import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import { buildAssetCache } from './assetReload.js';
import { watchCharacterProfiles } from './characterProfilesPersistence.js';
import type { AssetCache } from './clientMessageHandler.js';
import { readConfig } from './configPersistence.js';
import { LOOPBACK_BIND_HOST, MAX_PORT, MIN_PORT } from './constants.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { claudeProvider } from './providers/index.js';
import { PixelAgentsServer } from './server.js';
import { PtySessionManager } from './terminal/ptySessionManager.js';

/** The viewer's fixed default port: one well-known local address to bookmark. */
export const VIEWER_DEFAULT_PORT = 3477;

const NO_TERMINAL_REASON = 'The office viewer is read-only: it never runs a terminal.';

export class ViewerArgsError extends Error {}

const WATCH_ALL_SESSIONS_KEY = 'pixel-agents.watchAllSessions';

/**
 * The viewer's settings. It has no workspace of its own, so it ALWAYS watches
 * every session; and it is read-only, so it never writes a setting.
 *
 * Without this, the first browser to connect switched discovery off: the
 * `webviewReady` handshake copies the persisted settings onto the runtime, the
 * persisted default for Watch All Sessions is off, and a read-only client can
 * never turn it on.
 */
export class ViewerStateAdapter extends FileStateAdapter {
  override getSetting<T>(key: string, defaultValue: T): T {
    if (key === WATCH_ALL_SESSIONS_KEY) return true as T;
    return super.getSetting(key, defaultValue);
  }

  override setSetting<T>(_key: string, _value: T): void {
    // Read-only: settings belong to the VS Code extension.
  }
}

/** `--port <n>` is the only option. Anything else, a bind address above all,
 *  is refused rather than ignored. */
export function parseViewerArgs(argv: string[]): { port: number } {
  let port = VIEWER_DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      const parsed = Number(argv[i + 1]);
      if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
        throw new ViewerArgsError(
          `Invalid --port: expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      port = parsed;
      i++;
    } else {
      throw new ViewerArgsError(
        `Unknown option "${argv[i]}". The viewer takes only --port; it always listens on ${LOOPBACK_BIND_HOST}.`,
      );
    }
  }
  return { port };
}

async function main(): Promise<void> {
  let args: { port: number };
  try {
    args = parseViewerArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Agents viewer] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const distRoot = __dirname;
  const assetCache: AssetCache = await buildAssetCache(
    distRoot,
    readConfig().externalAssetDirectories,
  );

  const store = new AgentStateStore();
  store.setAdapter(new ViewerStateAdapter({ namespace: 'standalone' }));
  const characterProfilesWatcher = watchCharacterProfiles(
    (message) => store.broadcast(message),
    store,
  );

  const runtime = new AgentRuntime(store, claudeProvider);
  const server = new PixelAgentsServer();
  server.onHookEvent((providerId, event) => runtime.handleHookEvent(providerId, event));

  const config = await server.start({
    store,
    runtime,
    embedded: false,
    readOnly: true,
    port: args.port,
    staticDir: path.join(distRoot, 'webview'),
    assetCache,
    // A disabled manager: the availability broadcast says "no terminal" and the
    // terminal route is never registered with a working PTY behind it.
    ptyManager: PtySessionManager.disabled(NO_TERMINAL_REASON),
  });

  // The viewer OBSERVES whether hooks are installed; it never installs them.
  runtime.hooksEnabled.current = await claudeProvider.areHooksInstalled();
  // A viewer has no workspace of its own: it watches every session.
  runtime.watchAllSessions.current = true;

  const projectDir = claudeProvider.getSessionDirs?.(process.cwd())?.[0];
  if (projectDir) {
    runtime.startProjectScan(projectDir);
    runtime.startExternalScanning(projectDir);
    runtime.startStaleCheck();
  }

  console.log(
    `[Pixel Agents viewer] read-only office on http://${LOOPBACK_BIND_HOST}:${config.port} ` +
      `(hooks ${runtime.hooksEnabled.current ? 'installed by the extension: live events' : 'not installed: transcripts only'})`,
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    characterProfilesWatcher.dispose();
    runtime.dispose();
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Pixel Agents viewer] failed to start:', err);
    process.exit(1);
  });
}
