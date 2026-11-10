/**
 * pixel-agents-secure (H12, H13, H14): who may open the office viewer, and
 * what the browser is allowed to do with the page.
 *
 * H12 -- a session is required even to WATCH. Upstream lets a tokenless client
 * load the SPA and follow every agent; the viewer answers nothing (page, assets,
 * /ws) without a session cookie.
 *
 * H13 -- the server token never rides a URL. A local command proves it holds
 * the token (Bearer, read from the 0600 token file) and gets a ONE-TIME login
 * code, valid for a minute. The browser opens `/?code=...`; the code is
 * consumed, a session cookie is set (HttpOnly, SameSite=Strict) and the browser
 * is redirected to the clean URL. Nothing durable reaches the address bar, the
 * history or a bookmark, and the page's own JavaScript cannot read the cookie.
 *
 * H14 -- every response carries a Content-Security-Policy and hardening
 * headers: the page loads and connects to nothing but its own origin and
 * cannot be framed by another site.
 *
 * Known limit: cookies are scoped to a host, not a port. Another server on
 * this machine, reached under the same host name, is sent this cookie too.
 * That takes code already running locally plus a visit to its page.
 */

import * as crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';

import { HOOK_API_PREFIX, USAGE_API_PREFIX } from './constants.js';
import { writePrivateFileAtomic } from './privateFile.js';
import { bearerTokenValid } from './wsAuth.js';

export const VIEWER_COOKIE = 'pa_office';
export const LOGIN_CODE_TTL_MS = 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_CODE_PATH = '/api/login-code';

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const randomSecret = (): string => crypto.randomBytes(32).toString('base64url');

export interface ViewerSessions {
  /** A fresh one-time login code. */
  issueCode(): string;
  /** Consume a login code; returns a new session id, or null. */
  redeem(code: string | undefined): string | null;
  /** Whether a Cookie header carries a live session. */
  hasSession(cookieHeader: string | undefined): boolean;
}

/**
 * Login codes live in memory. Sessions are kept as HASHES (never the id
 * itself), optionally persisted to an owner-only file so an installed browser
 * app keeps working across a restart of the viewer.
 */
export function createViewerSessions(
  options: { file?: string; now?: () => number } = {},
): ViewerSessions {
  const now = options.now ?? Date.now;
  const codes = new Map<string, number>();
  const sessions = new Map<string, number>();

  if (options.file) {
    try {
      const saved = JSON.parse(fs.readFileSync(options.file, 'utf-8')) as unknown;
      if (saved !== null && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [hash, expires] of Object.entries(saved)) {
          if (/^[0-9a-f]{64}$/.test(hash) && typeof expires === 'number' && expires > now()) {
            sessions.set(hash, expires);
          }
        }
      }
    } catch {
      // Absent or unreadable: start with no sessions.
    }
  }

  const persist = (): void => {
    if (!options.file) return;
    try {
      writePrivateFileAtomic(options.file, JSON.stringify(Object.fromEntries(sessions)));
    } catch (err) {
      console.error(`[Pixel Agents viewer] could not persist sessions: ${String(err)}`);
    }
  };
  const sweep = (map: Map<string, number>): void => {
    for (const [key, expires] of map) if (expires <= now()) map.delete(key);
  };

  return {
    issueCode() {
      sweep(codes);
      const code = randomSecret();
      codes.set(sha256(code), now() + LOGIN_CODE_TTL_MS);
      return code;
    },
    redeem(code) {
      if (!code) return null;
      const key = sha256(code);
      const expires = codes.get(key);
      codes.delete(key); // single use, valid or not
      if (expires === undefined || expires <= now()) return null;
      sweep(sessions);
      const session = randomSecret();
      sessions.set(sha256(session), now() + SESSION_TTL_MS);
      persist();
      return session;
    },
    hasSession(cookieHeader) {
      const session = readCookie(cookieHeader, VIEWER_COOKIE);
      if (!session) return false;
      const expires = sessions.get(sha256(session));
      return expires !== undefined && expires > now();
    },
  };
}

/** One cookie's value from a Cookie header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function sessionCookie(session: string): string {
  return `${VIEWER_COOKIE}=${session}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Strict`;
}

/** H14: the viewer page may load and reach only its own origin. `'self'` in
 *  connect-src covers the same-origin WebSocket; the explicit ws: sources are
 *  for browsers that do not apply it to ws. */
export function viewerCsp(port: number): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
    "manifest-src 'self'",
    'worker-src blob:',
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const NO_SESSION_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Pixel Agents</title>' +
  '<body style="font-family:sans-serif;background:#1e1e2e;color:#ddd;padding:2rem">' +
  '<h1>Sem sessão</h1><p>Abra o escritório pelo link de entrada: no terminal, ' +
  '<code>make office-open</code>.</p></body>';

const INGEST_ROUTE = new RegExp(`^(?:${HOOK_API_PREFIX}|${USAGE_API_PREFIX})/[a-z0-9-]+$`);

/**
 * The only requests that pass without a session: routes that authenticate on
 * their own (Bearer) or carry no data. Matched by METHOD and EXACT path, on the
 * raw path: anything else under those prefixes (a GET, an encoded `..%2f`)
 * would otherwise fall through to the static handler and be served ungated.
 */
export function isOpenRequest(method: string, rawPath: string): boolean {
  if (method === 'GET') return rawPath === '/api/health';
  if (method === 'POST') return rawPath === LOGIN_CODE_PATH || INGEST_ROUTE.test(rawPath);
  return false;
}

/** H14. Registered on its own, BEFORE every other hook, so even the answers of
 *  earlier gates (the Host allowlist's 403) carry the headers. */
export function registerViewerHeaders(app: FastifyInstance, port: () => number): void {
  app.addHook('onRequest', async (_request, reply) => {
    void reply.headers({
      'content-security-policy': viewerCsp(port()),
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    });
  });
}

/**
 * Install the viewer's access gate. Call BEFORE registering the plugins
 * (static, websocket), so their routes inherit the hook.
 */
export function registerViewerAccess(
  app: FastifyInstance,
  options: { token: string; sessions: ViewerSessions },
): void {
  const { sessions } = options;

  app.addHook('onRequest', async (request, reply) => {
    const rawPath = request.url.split('?')[0];
    if (isOpenRequest(request.method, rawPath)) return;

    // A request answered here never reaches @fastify/websocket, so a refused
    // or redirected upgrade must have its socket closed by us.
    const closeUpgrade = (): void => {
      if (request.raw.headers.upgrade) request.raw.socket.destroy();
    };
    const refuse = async (): Promise<void> => {
      await reply.code(401).type('text/html; charset=utf-8').send(NO_SESSION_PAGE);
      closeUpgrade();
    };

    // H13: the token is never accepted from a URL. Only a one-time code is.
    let code: string | null = null;
    try {
      code = new URL(request.url, 'http://localhost').searchParams.get('code');
    } catch {
      await refuse();
      return;
    }
    if (code !== null) {
      const session = sessions.redeem(code);
      if (session === null) {
        await refuse();
        return;
      }
      await reply.header('set-cookie', sessionCookie(session)).redirect('/', 302);
      closeUpgrade();
      return;
    }

    // H12: nothing is served, and no socket is upgraded, without a session.
    if (!sessions.hasSession(request.headers.cookie)) await refuse();
  });

  // The local command that holds the token file trades it for a login code.
  app.post(LOGIN_CODE_PATH, async (request, reply) => {
    if (!bearerTokenValid(request.headers.authorization, options.token)) {
      await reply.code(401).send('unauthorized');
      return;
    }
    await reply.send({ code: sessions.issueCode(), ttlSeconds: LOGIN_CODE_TTL_MS / 1000 });
  });
}
