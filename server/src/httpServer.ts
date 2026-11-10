import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import { agentCreatedMessage } from './agentMessages.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type {
  AssetCache,
  ReloadAssetsSideEffect,
  SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import {
  HOOK_API_PREFIX,
  LOOPBACK_BIND_HOST,
  MAX_HOOK_BODY_SIZE,
  USAGE_API_PREFIX,
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
} from './constants.js';
import { applyReportedContext } from './contextUsage.js';
import { hookProviderById } from './providers/index.js';
import { isRecord } from './serverConfig.js';
import { registerTerminalRoutes } from './terminal/terminalRoutes.js';
import type { TerminalSessions } from './terminal/terminalSessions.js';
import type { AgentState } from './types.js';
import { createViewerSessions, registerViewerAccess } from './viewerAccess.js';
import {
  PRIVILEGED_BROADCAST_TYPES,
  recordUsageReport,
  usageLimitsMessage,
} from './usageLimits.js';
import {
  bearerTokenValid,
  isAllowedWebSocketOrigin,
  normalizeHostname,
  privilegedHostnames,
  redactTokenQuery,
  standaloneHandshakeVerdict,
} from './wsAuth.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** pixel-agents-secure (H11): the office viewer. No client is ever
   *  privileged, whatever token it carries, and no terminal route exists. */
  readOnly?: boolean;
  /** Where a read-only server keeps its browser sessions (hashes only). */
  viewerSessionsFile?: string;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
  /** PTY terminals for standalone-launched agents. Absent = terminal feature off
   *  (VS Code embedded mode, where the editor owns terminals). */
  ptyManager?: TerminalSessions;
  /** The package root holding dist/hooks/ (standalone), from which the Usage
   *  Bars toggle installs the status line bridge script. */
  packageRoot?: string;
  /** Extra Host names (beyond loopback and a specific bind address) a
   *  privileged standalone handshake may arrive under -- e.g. a reverse proxy's
   *  public name. See wsAuth.privilegedHostnames. */
  allowedHosts?: readonly string[];
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  // pixel-agents-secure (H2): loopback only. Any other bind request is a bug or
  // an attack, never a configuration -- fail closed before anything is built.
  if (options.host !== undefined && options.host !== LOOPBACK_BIND_HOST) {
    throw new Error(
      `Refusing to bind to "${options.host}": this build listens on ${LOOPBACK_BIND_HOST} only.`,
    );
  }
  const host = LOOPBACK_BIND_HOST;
  const allowedHostnames = privilegedHostnames(host, options.allowedHosts ?? []);

  const app = Fastify({
    // Standalone logs every request. The privilege token rides `/ws?token=`
    // and `/terminal/:id?token=` handshakes, so the url is redacted before it
    // is written -- otherwise every (re)connect would put the secret in stdout
    // and any log file (see wsAuth.redactTokenQuery).
    logger: options.embedded ? false : { serializers: { req: serializeRequestForLog } },
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  // pixel-agents-secure (H7): every request must name this machine's loopback
  // (or an explicit allowed host) in Host. A DNS-rebound page reaches
  // 127.0.0.1 under its own domain name and is refused here, before any route
  // -- health, hooks, /ws, the terminal, the SPA -- runs. Registered before the
  // plugins so their routes inherit it.
  app.addHook('onRequest', async (request, reply) => {
    const name = normalizeHostname(request.headers.host);
    if (name === null || !allowedHostnames.has(name)) {
      // `connection: close`: a refused request must not leave its socket open.
      // For a WebSocket upgrade nothing else would ever close it.
      await reply.code(403).header('connection', 'close').send('forbidden host');
      // A refused WebSocket upgrade: its socket was detached from the HTTP
      // server and @fastify/websocket only destroys it for requests that got
      // past this hook, so nothing else would ever close it.
      if (request.raw.headers.upgrade) request.raw.socket.destroy();
    }
  });

  // pixel-agents-secure (H12-H14): the viewer answers nothing without a
  // session and sends its security headers on everything (viewerAccess.ts).
  let listeningPort = options.port ?? 0;
  if (options.readOnly) {
    registerViewerAccess(app, {
      token: options.token,
      sessions: createViewerSessions({ file: options.viewerSessionsFile }),
      port: () => listeningPort,
    });
  }

  // pixel-agents-secure (H7): no CORS. Legitimate clients are same-origin (the
  // standalone SPA) or not browsers (hook scripts); reflecting every Origin
  // only let arbitrary web pages read our responses (e.g. /api/health).
  await app.register(fastifyCors, { origin: false });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerHookRoute(app, options);
  registerUsageRoute(app, options);
  registerWebSocketRoute(app, options, allowedHostnames);
  // pixel-agents-secure (H11): a read-only server has no terminal route at all.
  if (!options.readOnly) {
    registerTerminalRoutes(app, {
      token: options.token,
      allowedHostnames,
      ptyManager: options.ptyManager,
    });
  }

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host, port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;
  listeningPort = port;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      // pixel-agents-secure (H4): the filter runs here too, not only in the
      // hook script. ~/.pixel-agents/hooks/claude-hook.js is a path shared with
      // the upstream extension, so an unfiltered script can still POST; and a
      // provider with no filter gets nothing through.
      const sanitize = hookProviderById(providerId)?.sanitizeHookPayload;
      const event = sanitize && isRecord(request.body) ? sanitize(request.body) : {};

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── Usage reports ──────────────────────────────────────────────

/** A provider's usage bridge reports the account's plan limits here. Stored,
 *  and passed on to the office when they moved (recordUsageReport). */
function registerUsageRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{ Params: { providerId: string }; Body: unknown }>(
    `${USAGE_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: { providerId: { type: 'string', pattern: '^[a-z0-9-]+$' } },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const provider = hookProviderById(request.params.providerId);
      if (provider && recordUsageReport(provider, request.body)) {
        options.store.broadcast({ ...usageLimitsMessage(provider.id) });
      }
      const context = provider?.usageBridge?.normalizeContext(request.body);
      if (context) applyReportedContext(options.store, context);
      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(
  app: FastifyInstance,
  options: HttpServerOptions,
  allowedHostnames: ReadonlySet<string>,
): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // CONNECTION gate. Embedded (VS Code) requires the Bearer token. Standalone
    // requires a same-origin handshake instead (isAllowedWebSocketOrigin), so a
    // non-browser local client with no Origin can still watch the office. What
    // may be DONE over an accepted connection is a separate question, decided
    // below.
    if (options.embedded) {
      if (!bearerTokenValid(request.headers.authorization, options.token)) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
    } else if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }

    // Both modes prove privilege with the SAME out-of-band secret, differently
    // carried: embedded sends the Bearer token it was handed in-process;
    // standalone sends the `?token=` the CLI printed in the local URL and the
    // SPA forwarded on this handshake, and it must arrive under an allowed Host
    // -- the same verdict the terminal socket applies. A network POSITION
    // never grants privilege, because every position is reproducible by a
    // forwarder; the Host allowlist can only take it away.
    let privileged = options.embedded;
    if (!options.embedded) {
      const verdict = standaloneHandshakeVerdict(
        request.url,
        request.headers.host,
        options.token,
        allowedHostnames,
      );
      // pixel-agents-secure (H11): in a read-only server the token proves
      // nothing more than the right to watch.
      privileged = verdict === 'privileged' && !options.readOnly;
      if (verdict === 'untrusted-host') {
        // The operator has the right URL but reached us under a name they never
        // listed (typically a reverse proxy). Say how to fix it, or the session
        // silently stays watch-only.
        console.warn(
          `[Pixel Agents] Tokened connection via Host "${request.headers.host ?? ''}" is read-only: restart with --allowed-host <that name> to allow changes from it.`,
        );
      }
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, agentCreatedMessage(id, agent));
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      // The operator's account usage is not for read-only viewers.
      if (!privileged && PRIVILEGED_BROADCAST_TYPES.has(String(message.type))) return;
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onReloadAssets: options.onReloadAssets,
          packageRoot: options.packageRoot,
          privileged,
          ptyManager: options.ptyManager,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerTokenValid(request.headers.authorization, expectedToken)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Logging ────────────────────────────────────────────────────

/** Fastify's default request serializer, minus the token query. Exported so a
 *  test can pin that the secret never reaches the log line. */
export function serializeRequestForLog(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactTokenQuery(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
