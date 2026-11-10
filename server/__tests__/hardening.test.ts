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
import { describe, expect, it, vi } from 'vitest';

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

describe('H4: the hook forwards an allowlisted, capped payload', () => {
  const load = async () => {
    const { filterHookPayload } =
      await import('../src/providers/hook/claude/hooks/hookPayloadFilter.js');
    const { claudeProvider } = await import('../src/providers/hook/claude/claude.js');
    return { filterHookPayload, claudeProvider };
  };

  it('drops file contents, tool_response, prompt text and unknown fields', async () => {
    const { filterHookPayload } = await load();
    const filtered = filterHookPayload({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: '/home/u/secret/notes.md', content: 'TOP SECRET' },
      tool_response: { stdout: 'TOP SECRET' },
      prompt: 'TOP SECRET',
      some_future_field: 'TOP SECRET',
    });
    expect(JSON.stringify(filtered)).not.toContain('TOP SECRET');
    expect(JSON.stringify(filtered)).not.toContain('/home/u/secret');
    expect(filtered).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: 'notes.md' },
    });
  });

  it('keeps a Bash command only as long as the status line can show it', async () => {
    const { filterHookPayload } = await load();
    const command = `echo ${'x'.repeat(500)} && cat ~/.ssh/id_rsa`;
    const filtered = filterHookPayload({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Bash',
      tool_input: { command },
    }) as { tool_input: { command: string } };
    expect(filtered.tool_input.command.length).toBeLessThanOrEqual(31);
    expect(filtered.tool_input.command).not.toContain('id_rsa');
  });

  it('the office reads the same thing from the filtered payload as from the raw one', async () => {
    const { filterHookPayload, claudeProvider } = await load();
    const raws: Record<string, unknown>[] = [
      { tool_name: 'Bash', tool_input: { command: 'npm run test -- --reporter=verbose --bail' } },
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' },
      },
      { tool_name: 'Read', tool_input: { file_path: '/repo/README.md' } },
      {
        tool_name: 'Agent',
        tool_input: {
          description: 'A'.repeat(80),
          prompt: 'secret plan',
          run_in_background: true,
          name: 'ana',
        },
      },
      { tool_name: 'SendMessage', tool_input: { recipient: 'ana', message: 'secret' } },
      { tool_name: 'TeamCreate', tool_input: { team_name: 'squad' } },
    ];
    for (const extra of raws) {
      const raw = { hook_event_name: 'PreToolUse', session_id: 's1', ...extra };
      const fromRaw = claudeProvider.normalizeHookEvent(raw)!.event as {
        toolName: string;
        input: unknown;
        runInBackground: boolean;
      };
      const fromFiltered = claudeProvider.normalizeHookEvent(filterHookPayload(raw))!
        .event as typeof fromRaw;
      expect(claudeProvider.formatToolStatus(fromFiltered.toolName, fromFiltered.input)).toBe(
        claudeProvider.formatToolStatus(fromRaw.toolName, fromRaw.input),
      );
      expect(fromFiltered.runInBackground).toBe(fromRaw.runInBackground);
      const team = claudeProvider.team!;
      const rawInput = fromRaw.input as Record<string, unknown>;
      const filteredInput = fromFiltered.input as Record<string, unknown>;
      expect(team.isTeammateSpawnCall(fromFiltered.toolName, filteredInput)).toBe(
        team.isTeammateSpawnCall(fromRaw.toolName, rawInput),
      );
      expect(team.namesTeammate?.(fromFiltered.toolName, filteredInput)).toBe(
        team.namesTeammate?.(fromRaw.toolName, rawInput),
      );
    }
  });

  it('reduces a Windows path to its file name too', async () => {
    const { filterHookPayload } = await load();
    const filtered = filterHookPayload({
      tool_input: { file_path: 'C:\\Users\\u\\secret\\a.ts' },
    }) as { tool_input: { file_path: string } };
    expect(filtered.tool_input.file_path).toBe('a.ts');
  });

  it('keeps every field the lifecycle and team events are routed by', async () => {
    const { filterHookPayload } = await load();
    const raw = {
      hook_event_name: 'SessionStart',
      session_id: 's1',
      source: 'resume',
      transcript_path: '/t/s1.jsonl',
      cwd: '/repo',
      reason: 'clear',
      notification_type: 'idle_prompt',
      agent_type: 'reviewer',
      agent_transcript_path: '/t/agent.jsonl',
      teammate_name: 'ana',
      task_subject: 'Fix it',
      subject: 'Fix it',
      run_in_background: true,
    };
    expect(filterHookPayload(raw)).toEqual(raw);
  });

  it('the hook script posts only the filtered payload', () => {
    const script = fs.readFileSync(
      path.join(REPO_ROOT, 'server/src/providers/hook/claude/hooks/claude-hook.ts'),
      'utf-8',
    );
    expect(script).toContain('JSON.stringify(filterHookPayload(data))');
    expect(script).not.toMatch(/JSON\.stringify\(data\)/);
  });
});

describe.skipIf(process.platform === 'win32')('H5: discovery files are owner-only', () => {
  it('tightens a loose ~/.pixel-agents and never reuses a loose leftover .tmp', async () => {
    const os = await import('os');
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const dir = path.join(os.homedir(), '.pixel-agents');
    // As config/layout persistence leaves it, plus a crash's leftover temp file.
    fs.mkdirSync(path.join(dir, 'servers'), { recursive: true });
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(path.join(dir, 'servers'), 0o755);
    fs.writeFileSync(path.join(dir, 'server.json.tmp'), '{}', { mode: 0o644 });

    const server = new PixelAgentsServer();
    const config = await server.start({ store: new AgentStateStore(), embedded: true });
    try {
      const mode = (p: string) => fs.statSync(p).mode & 0o777;
      expect(mode(dir)).toBe(0o700);
      expect(mode(path.join(dir, 'servers'))).toBe(0o700);
      expect(mode(path.join(dir, 'server.json'))).toBe(0o600);
      expect(mode(path.join(dir, 'servers', `${config.pid}-${config.port}.json`))).toBe(0o600);
      expect(fs.existsSync(path.join(dir, 'server.json.tmp'))).toBe(false);
    } finally {
      server.stop();
    }
  });
});

describe('H6: the VS Code webview runs under a Content-Security-Policy', () => {
  const SOURCE = 'https://file+.vscode-resource.vscode-cdn.net';

  it('allows only the extension bundle, inline styles, data/blob images and a blob worker', async () => {
    const { webviewCsp } = await import('../../adapters/vscode/webviewCsp.js');
    const policy = webviewCsp(SOURCE);
    const directives = Object.fromEntries(
      policy.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values];
      }),
    );
    expect(directives['default-src']).toEqual(["'none'"]);
    expect(directives['script-src']).toEqual([SOURCE]);
    expect(directives['base-uri']).toEqual(["'none'"]);
    expect(directives['form-action']).toEqual(["'none'"]);
    expect(policy).not.toMatch(/unsafe-eval|\*/);
    // No source other than the bundle's own origin may be a URL.
    const urls = policy.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(urls)).toEqual(new Set([SOURCE]));
  });

  it('puts the policy first in <head> and refuses HTML without one', async () => {
    const { withCsp } = await import('../../adapters/vscode/webviewCsp.js');
    const html = withCsp('<html><head><script src="x.js"></script></head></html>', SOURCE);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    expect(() => withCsp('<html><body></body></html>', SOURCE)).toThrow();
  });

  it('the provider applies the policy and restricts local resources to dist/webview', () => {
    const provider = fs.readFileSync(
      path.join(REPO_ROOT, 'adapters/vscode/PixelAgentsViewProvider.ts'),
      'utf-8',
    );
    expect(provider).toContain('return withCsp(html, webview.cspSource);');
    expect(provider).toMatch(
      /localResourceRoots: \[vscode\.Uri\.joinPath\(this\.extensionUri, 'dist', 'webview'\)\]/,
    );
  });
});

describe('H7: no CORS and a loopback-only Host on every request', () => {
  async function request(
    port: number,
    opts: { method?: string; host?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; headers: Record<string, unknown> }> {
    const http = await import('http');
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          method: opts.method ?? 'GET',
          headers: { ...(opts.host ? { host: opts.host } : {}), ...opts.headers },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, headers: res.headers });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('refuses a DNS-rebound Host and never sends CORS headers', async () => {
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const server = new PixelAgentsServer();
    const { port } = await server.start({ store: new AgentStateStore(), embedded: true });
    try {
      const evilOrigin = { origin: 'https://evil.example' };
      const ok = await request(port, { headers: evilOrigin });
      expect(ok.status).toBe(200);
      expect(ok.headers['access-control-allow-origin']).toBeUndefined();

      const preflight = await request(port, {
        method: 'OPTIONS',
        headers: { ...evilOrigin, 'access-control-request-method': 'POST' },
      });
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

      for (const host of [`evil.example:${port}`, `127.0.0.1.evil.example:${port}`]) {
        expect((await request(port, { host })).status).toBe(403);
      }
      expect((await request(port, { host: `localhost:${port}` })).status).toBe(200);
    } finally {
      server.stop();
    }
  });
});

describe('H4 (server side): the hook route filters too', () => {
  it('never hands the runtime an unfiltered payload, whatever script posted it', async () => {
    const { createHttpServer } = await import('../src/httpServer.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { MAX_HOOK_BODY_SIZE } = await import('../src/constants.js');
    expect(MAX_HOOK_BODY_SIZE).toBeLessThanOrEqual(8_192);
    const seen: Array<{ providerId: string; event: Record<string, unknown> }> = [];
    const { app, port } = await createHttpServer({
      embedded: true,
      token: 't',
      store: new AgentStateStore(),
      onHookEvent: (providerId, event) => seen.push({ providerId, event }),
    });
    const post = (providerId: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}/api/hooks/${providerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify(body),
      });
    try {
      const raw = {
        session_id: 's1',
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/home/u/x.md', content: 'TOP SECRET' },
        tool_response: 'TOP SECRET',
      };
      expect((await post('claude', raw)).status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(JSON.stringify(seen[0].event)).not.toContain('TOP SECRET');
      expect(seen[0].event.tool_input).toEqual({ file_path: 'x.md' });
      // A provider with no filter gets nothing through.
      await post('unknown-provider', raw);
      expect(seen).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('H8: the usage bridge can be removed but never installed', () => {
  it('refuses to enable it without touching the bridge', async () => {
    const { applyUsageBridgeChoice, USAGE_BRIDGE_DISABLED_MESSAGE } =
      await import('../src/usageLimits.js');
    const { claudeProvider } = await import('../src/providers/hook/claude/claude.js');
    let installs = 0;
    const provider = {
      ...claudeProvider,
      usageBridge: {
        ...claudeProvider.usageBridge!,
        install: async () => {
          installs++;
        },
      },
    };
    const status = await applyUsageBridgeChoice(provider, '/some/package/root', true);
    expect(installs).toBe(0);
    expect(status.error).toBe(USAGE_BRIDGE_DISABLED_MESSAGE);
  });
});

describe('H9: the hook script takes its debug log from its own environment only', () => {
  it('never adopts a path read from a registry entry', () => {
    const script = fs.readFileSync(
      path.join(REPO_ROOT, 'server/src/providers/hook/claude/hooks/claude-hook.ts'),
      'utf-8',
    );
    expect(script).not.toMatch(/\.debugLog/);
    expect(script).toContain("const debugLogPath = process.env['PIXEL_AGENTS_DEBUG_LOG'];");
  });
});

describe('H10: the package build runs only what the package needs', () => {
  it('vscode:prepublish skips code generation and lint', () => {
    const scripts = (
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['vscode:prepublish']).toBe('npm run package:secure');
    expect(scripts['package:secure']).not.toMatch(/asyncapi|lint|generate/);
  });
});

describe('H7 (routes that matter): a forged Host reaches no handler', () => {
  it('refuses the hook POST and the /ws upgrade under a foreign Host, even with the token', async () => {
    const http = await import('http');
    const { WebSocket } = await import('ws');
    const { createHttpServer } = await import('../src/httpServer.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    let handled = 0;
    const { app, port } = await createHttpServer({
      embedded: true,
      token: 't',
      store: new AgentStateStore(),
      onHookEvent: () => handled++,
    });
    const body = JSON.stringify({ session_id: 's', hook_event_name: 'Stop' });
    const post = (host?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/hooks/claude',
            method: 'POST',
            // One connection per request: a refused request leaves its body
            // unread, and a kept-alive socket in that state stalls app.close().
            agent: false,
            headers: {
              'content-type': 'application/json',
              authorization: 'Bearer t',
              ...(host ? { host } : {}),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(body);
      });
    try {
      expect(await post(`evil.example:${port}`)).toBe(403);
      expect(handled).toBe(0);
      expect(await post()).toBe(200);
      expect(handled).toBe(1);

      const opened = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
          headers: { host: `evil.example:${port}`, authorization: 'Bearer t' },
        });
        ws.on('open', () => {
          ws.close();
          resolve(true);
        });
        // Consume and drop the refused upgrade, or the server waits on it at close.
        ws.on('unexpected-response', (req, res) => {
          res.resume();
          req.destroy();
          resolve(false);
        });
        ws.on('error', () => resolve(false));
      });
      expect(opened).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('H7 (token before body): a request without the token never has its body read', () => {
  it('answers 401 to a malformed or oversized body, before the parser could object', async () => {
    const http = await import('http');
    const { createHttpServer } = await import('../src/httpServer.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { MAX_HOOK_BODY_SIZE } = await import('../src/constants.js');
    let handled = 0;
    const { app, port } = await createHttpServer({
      embedded: true,
      token: 't',
      store: new AgentStateStore(),
      onHookEvent: () => handled++,
    });
    const post = (urlPath: string, body: string, auth?: string) =>
      new Promise<{ status: number; connection: unknown }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: urlPath,
            method: 'POST',
            agent: false,
            headers: {
              'content-type': 'application/json',
              ...(auth ? { authorization: auth } : {}),
            },
          },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0, connection: res.headers.connection });
          },
        );
        // The server may close before the whole body is sent.
        req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'EPIPE' ? null : reject(e)));
        req.end(body);
      });
    const oversized = JSON.stringify({ pad: 'x'.repeat(MAX_HOOK_BODY_SIZE * 2) });
    try {
      for (const route of ['/api/hooks/claude', '/api/usage/claude']) {
        for (const auth of [undefined, 'Bearer wrong']) {
          for (const body of ['{not json', oversized]) {
            const res = await post(route, body, auth);
            expect(res.status).toBe(401);
            expect(res.connection).toBe('close');
          }
        }
      }
      expect(handled).toBe(0);
      // With the token, the parser does run: proof the 401s above came first.
      expect((await post('/api/hooks/claude', '{not json', 'Bearer t')).status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('auth is registered as onRequest, never preHandler', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'server/src/httpServer.ts'), 'utf-8');
    expect(src).not.toMatch(/preHandler:\s*bearerAuth/);
    expect(src.match(/onRequest:\s*bearerAuth\(options\.token\)/g)).toHaveLength(2);
  });
});

// The BUNDLED hook script, as Claude Code runs it. Needs dist/ (the governance
// build runs this suite after building, and fails on any skipped test).
const BUNDLED_HOOK = path.join(REPO_ROOT, 'dist/hooks/claude-hook.js');
describe.skipIf(!fs.existsSync(BUNDLED_HOOK))('H4 + H9: the bundled hook script', () => {
  it('posts only the filtered payload, prints nothing, exits 0, and ignores a registry debugLog', async () => {
    const http = await import('http');
    const os = await import('os');
    const { spawn } = await import('child_process');
    const { SERVER_REGISTRY_PROTOCOL_VERSION } = await import('../src/constants.js');

    const received: string[] = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        received.push(data);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-hardening-hook-'));
    const planted = path.join(home, 'planted-by-registry.log');
    const servers = path.join(home, '.pixel-agents', 'servers');
    fs.mkdirSync(servers, { recursive: true });
    fs.writeFileSync(
      path.join(servers, `${process.pid}-${port}.json`),
      JSON.stringify({
        port,
        pid: process.pid,
        token: 'registry-token',
        startedAt: Date.now(),
        servesSpa: false,
        protocol: SERVER_REGISTRY_PROTOCOL_VERSION,
        debugLog: planted,
      }),
    );

    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
    delete env['PIXEL_AGENTS_DEBUG_LOG'];
    const child = spawn(process.execPath, [BUNDLED_HOOK], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stdin.end(
      JSON.stringify({
        session_id: 's1',
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/home/u/private/notes.md', content: 'TOP SECRET' },
        tool_response: 'TOP SECRET',
        prompt: 'TOP SECRET',
      }),
    );
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    server.close();

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(received).toHaveLength(1);
    expect(received[0]).not.toContain('TOP SECRET');
    expect(received[0]).not.toContain('/home/u/private');
    expect(JSON.parse(received[0])).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Write',
      tool_input: { file_path: 'notes.md' },
    });
    expect(fs.existsSync(planted)).toBe(false);
  });
});

/** The viewer's login: trade the token for a one-time code, the code for a cookie. */
async function viewerLogin(port: number, token: string): Promise<string> {
  const base = `http://127.0.0.1:${port}`;
  const { code } = (await (
    await fetch(`${base}/api/login-code`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { code: string };
  const res = await fetch(`${base}/?code=${encodeURIComponent(code)}`, { redirect: 'manual' });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('H11: the office viewer is read-only', () => {
  it('a read-only server refuses every state-changing message, even with the token', async () => {
    const { WebSocket } = await import('ws');
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { PtySessionManager } = await import('../src/terminal/ptySessionManager.js');
    const toggles: boolean[] = [];
    const server = new PixelAgentsServer();
    const config = await server.start({
      store: new AgentStateStore(),
      embedded: false,
      readOnly: true,
      // A terminal manager IS supplied: without the readOnly rule the terminal
      // route would be registered.
      ptyManager: PtySessionManager.disabled('test'),
      onSetHooksEnabled: (_providerId: string, enabled: boolean) => {
        toggles.push(enabled);
      },
    });
    try {
      const cookie = await viewerLogin(config.port, config.token);
      // The token rides the handshake exactly as upstream's privileged client
      // sends it: without the readOnly rule this socket WOULD be privileged.
      const ws = new WebSocket(
        `ws://127.0.0.1:${config.port}/ws?token=${encodeURIComponent(config.token)}`,
        { headers: { cookie } },
      );
      const messages: Array<{ type?: string; readOnly?: boolean }> = [];
      ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });
      ws.send(JSON.stringify({ type: 'webviewReady' }));
      ws.send(JSON.stringify({ type: 'setHooksEnabled', providerId: 'claude', enabled: true }));
      ws.send(JSON.stringify({ type: 'launchAgent' }));
      ws.send(JSON.stringify({ type: 'setBypassPermissions', enabled: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      ws.close();
      expect(toggles).toEqual([]);
      expect(messages.find((m) => m.type === 'officeAccess')?.readOnly).toBe(true);
      expect(messages.some((m) => m.type === 'hooksConsentRequest')).toBe(false);

      // No terminal route: the path falls through to the SPA fallback or 404,
      // never to a WebSocket upgrade.
      const upgraded = await new Promise<boolean>((resolve) => {
        const t = new WebSocket(
          `ws://127.0.0.1:${config.port}/terminal/1?token=${encodeURIComponent(config.token)}`,
          { headers: { cookie } },
        );
        t.on('open', () => {
          t.close();
          resolve(true);
        });
        t.on('unexpected-response', (req, res) => {
          res.resume();
          req.destroy();
          resolve(false);
        });
        t.on('error', () => resolve(false));
      });
      expect(upgraded).toBe(false);
    } finally {
      server.stop();
    }
  });

  it('the viewer entry never installs hooks, launches agents or accepts a bind address', async () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'server/src/viewer.ts'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(
      /installHooks|uninstallHooks|copyHookScript|grantHooksConsent|launchStandaloneAgent|new PtySessionManager\(|onSetHooksEnabled|usageBridge|['"]--host['"]/,
    );
    expect(code).toContain('readOnly: true');
    const { parseViewerArgs } = await import('../src/viewer.js');
    expect(parseViewerArgs([]).port).toBe(3477);
    expect(() => parseViewerArgs(['--host', '0.0.0.0'])).toThrow();
    expect(() => parseViewerArgs(['--allowed-host', 'x'])).toThrow();
  });
});

// The BUNDLED viewer, started for real. Needs dist/ (run by the governance build).
const BUNDLED_VIEWER = path.join(REPO_ROOT, 'dist/office-server.js');
describe.skipIf(!fs.existsSync(BUNDLED_VIEWER))('H11 + H15: the bundled viewer', () => {
  it('starts, answers on loopback, and writes nothing under ~/.claude', async () => {
    const os = await import('os');
    const net = await import('net');
    const { spawn } = await import('child_process');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-hardening-viewer-'));
    const port = await new Promise<number>((resolve) => {
      const probe = net.createServer();
      probe.listen(0, '127.0.0.1', () => {
        const p = (probe.address() as { port: number }).port;
        probe.close(() => resolve(p));
      });
    });
    const child = spawn(process.execPath, [BUNDLED_VIEWER, '--port', String(port)], {
      cwd: home,
      env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c: Buffer) => (output += c.toString()));
    child.stderr.on('data', (c: Buffer) => (output += c.toString()));
    try {
      let status = 0;
      for (let i = 0; i < 80 && status !== 200; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = await fetch(`http://127.0.0.1:${port}/api/health`)
          .then((r) => r.status)
          .catch(() => 0);
      }
      expect(status, output).toBe(200);
      expect(fs.existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
      expect(fs.existsSync(path.join(home, '.pixel-agents', 'hooks'))).toBe(false);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('exit', resolve));
    }
  });
});

describe('H12 + H13 + H14: viewer access', () => {
  async function startViewer() {
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const server = new PixelAgentsServer();
    const config = await server.start({
      store: new AgentStateStore(),
      embedded: false,
      readOnly: true,
    });
    return { server, port: config.port, token: config.token, base: `http://127.0.0.1:${config.port}` };
  }

  it('H12: serves nothing and upgrades no socket without a session', async () => {
    const { WebSocket } = await import('ws');
    const { server, port, token, base } = await startViewer();
    try {
      for (const p of ['/', '/index.html', '/assets/x.js', '/ws']) {
        expect((await fetch(`${base}${p}`)).status, p).toBe(401);
      }
      const opened = (headers: Record<string, string>) =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
          ws.on('open', () => {
            ws.close();
            resolve(true);
          });
          ws.on('unexpected-response', (req, res) => {
            res.resume();
            req.destroy();
            resolve(false);
          });
          ws.on('error', () => resolve(false));
        });
      expect(await opened({})).toBe(false);
      expect(await opened({ cookie: 'pa_office=forged' })).toBe(false);
      // The token alone, in the query as upstream carries it, opens nothing.
      expect((await fetch(`${base}/?token=${encodeURIComponent(token)}`)).status).toBe(401);
      expect(await opened({ cookie: await viewerLogin(port, token) })).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('H13: the token never rides a URL; a one-time code becomes an HttpOnly, SameSite=Strict cookie', async () => {
    const { server, token, base } = await startViewer();
    try {
      // No code without the token.
      expect((await fetch(`${base}/api/login-code`, { method: 'POST' })).status).toBe(401);
      expect(
        (
          await fetch(`${base}/api/login-code`, {
            method: 'POST',
            headers: { authorization: 'Bearer wrong' },
          })
        ).status,
      ).toBe(401);
      const { code } = (await (
        await fetch(`${base}/api/login-code`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
      ).json()) as { code: string };
      expect(code).not.toBe(token);

      const login = await fetch(`${base}/?code=${encodeURIComponent(code)}`, { redirect: 'manual' });
      expect(login.status).toBe(302);
      expect(login.headers.get('location')).toBe('/');
      const setCookie = login.headers.get('set-cookie') ?? '';
      expect(setCookie).toMatch(/^pa_office=[A-Za-z0-9_-]{40,};/);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).not.toContain(token);

      // Single use: the same code buys nothing the second time.
      const again = await fetch(`${base}/?code=${encodeURIComponent(code)}`, { redirect: 'manual' });
      expect(again.status).toBe(401);
      expect(again.headers.get('set-cookie')).toBeNull();
      expect((await fetch(`${base}/?code=made-up`, { redirect: 'manual' })).status).toBe(401);

      // With the cookie the gate opens (404: this test server has no SPA to serve).
      const cookie = setCookie.split(';')[0];
      expect((await fetch(`${base}/anything`, { headers: { cookie } })).status).toBe(404);
    } finally {
      server.stop();
    }
  });

  it('H13: codes expire, and only session hashes are ever persisted', async () => {
    const os = await import('os');
    const { createViewerSessions, LOGIN_CODE_TTL_MS, sessionCookie } = await import(
      '../src/viewerAccess.js'
    );
    let clock = 1_000_000;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-viewer-sessions-')), 's.json');
    const sessions = createViewerSessions({ file, now: () => clock });
    const stale = sessions.issueCode();
    clock += LOGIN_CODE_TTL_MS + 1;
    expect(sessions.redeem(stale)).toBeNull();

    const session = sessions.redeem(sessions.issueCode())!;
    expect(sessions.hasSession(sessionCookie(session).split(';')[0])).toBe(true);
    const onDisk = fs.readFileSync(file, 'utf-8');
    expect(onDisk).not.toContain(session);
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    // A restarted viewer still knows the session.
    const restarted = createViewerSessions({ file, now: () => clock });
    expect(restarted.hasSession(`pa_office=${session}`)).toBe(true);
    expect(restarted.hasSession('pa_office=other')).toBe(false);
  });

  it('H14: every answer carries the CSP and hardening headers, refusals included', async () => {
    const { server, port, token, base } = await startViewer();
    try {
      const cookie = await viewerLogin(port, token);
      for (const res of [
        await fetch(`${base}/`),
        await fetch(`${base}/anything`, { headers: { cookie } }),
        await fetch(`${base}/api/health`),
      ]) {
        const csp = res.headers.get('content-security-policy') ?? '';
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`);
        expect(csp).not.toMatch(/unsafe-eval|https?:|\*/);
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('x-frame-options')).toBe('DENY');
        expect(res.headers.get('referrer-policy')).toBe('no-referrer');
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    } finally {
      server.stop();
    }
  });

  it('a server that is not the viewer keeps the upstream behaviour (no gate, no viewer headers)', async () => {
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const server = new PixelAgentsServer();
    const { port } = await server.start({ store: new AgentStateStore(), embedded: true });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-security-policy')).toBeNull();
    } finally {
      server.stop();
    }
  });
});

describe('H16: extra transcript roots are Claude transcript folders, and nothing else', () => {
  it('scans an extra root without blocking, and keeps only active sessions', async () => {
    const { findActiveSessionsInRoots } = await import('../src/fileWatcher.js');
    const os = await import('os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-extra-root-'));
    try {
      const dir = path.join(root, '-some-project');
      fs.mkdirSync(dir);
      const big = 'x'.repeat(4096);
      const active = path.join(dir, 'active.jsonl');
      const known = path.join(dir, 'known.jsonl');
      const old = path.join(dir, 'old.jsonl');
      fs.writeFileSync(active, big);
      fs.writeFileSync(known, big);
      fs.writeFileSync(old, big);
      fs.writeFileSync(path.join(dir, 'tiny.jsonl'), 'x');
      fs.writeFileSync(path.join(dir, 'notes.txt'), big);
      const anHourAgo = new Date(Date.now() - 3_600_000);
      fs.utimesSync(old, anHourAgo, anHourAgo);

      const pending = findActiveSessionsInRoots(
        [path.join(root, 'missing'), root],
        (file) => file === known,
      );
      // A promise, not a result: the caller's event loop is never held.
      expect(pending).toBeInstanceOf(Promise);
      expect(await pending).toEqual([{ file: active, dirPath: dir }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('honours only absolute paths ending in .claude/projects, capped and deduplicated', async () => {
    const { extraSessionRoots, claudeProvider } = await import(
      '../src/providers/hook/claude/claude.js'
    );
    const d = path.delimiter;
    const win = '/mnt/c/Users/someone/.claude/projects';
    expect(extraSessionRoots({})).toEqual([]);
    expect(
      extraSessionRoots({
        PIXEL_AGENTS_EXTRA_SESSION_ROOTS: [
          win,
          win, // duplicate
          'relative/.claude/projects',
          '/etc',
          '/home/someone/.ssh',
          '/home/someone/.claude', // not the projects folder
          `${win}/../../.ssh`, // normalizes away from .claude/projects
          '',
        ].join(d),
      }),
    ).toEqual([win]);
    const many = Array.from({ length: 9 }, (_, i) => `/h${i}/.claude/projects`).join(d);
    expect(extraSessionRoots({ PIXEL_AGENTS_EXTRA_SESSION_ROOTS: many })).toHaveLength(4);

    const before = process.env['PIXEL_AGENTS_EXTRA_SESSION_ROOTS'];
    process.env['PIXEL_AGENTS_EXTRA_SESSION_ROOTS'] = win;
    try {
      const roots = claudeProvider.getAllSessionRoots!();
      expect(roots).toHaveLength(2);
      expect(roots[1]).toBe(win);
    } finally {
      if (before === undefined) delete process.env['PIXEL_AGENTS_EXTRA_SESSION_ROOTS'];
      else process.env['PIXEL_AGENTS_EXTRA_SESSION_ROOTS'] = before;
    }
  });
});

describe('viewer review fixes (H11, H12, H14)', () => {
  it('H11: the viewer keeps watching every session after a browser connects', async () => {
    const { WebSocket } = await import('ws');
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { AgentRuntime } = await import('../src/agentRuntime.js');
    const { claudeProvider } = await import('../src/providers/hook/claude/claude.js');
    const { ViewerStateAdapter } = await import('../src/viewer.js');

    const adapter = new ViewerStateAdapter({ namespace: 'standalone' });
    // Persisted default is off, and the viewer never writes a setting.
    adapter.setSetting('pixel-agents.watchAllSessions', false);
    const soundBefore = adapter.getSetting('pixel-agents.soundEnabled', false);
    adapter.setSetting('pixel-agents.soundEnabled', !soundBefore);
    expect(adapter.getSetting('pixel-agents.watchAllSessions', false)).toBe(true);
    expect(adapter.getSetting('pixel-agents.soundEnabled', false)).toBe(soundBefore);

    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const runtime = new AgentRuntime(store, claudeProvider);
    runtime.watchAllSessions.current = true;
    const server = new PixelAgentsServer();
    const config = await server.start({ store, runtime, embedded: false, readOnly: true });
    try {
      const cookie = await viewerLogin(config.port, config.token);
      const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`, { headers: { cookie } });
      const seen: string[] = [];
      ws.on('message', (d: Buffer) => seen.push((JSON.parse(d.toString()) as { type: string }).type));
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });
      ws.send(JSON.stringify({ type: 'webviewReady' }));
      for (let i = 0; i < 40 && !seen.includes('officeAccess'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      ws.close();
      expect(seen).toContain('officeAccess');
      expect(runtime.watchAllSessions.current).toBe(true);
    } finally {
      runtime.dispose();
      server.stop();
    }
  });

  it('H12: nothing static is reachable through the open API prefixes', async () => {
    const os = await import('os');
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { isOpenRequest } = await import('../src/viewerAccess.js');
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-viewer-static-'));
    fs.mkdirSync(path.join(staticDir, 'assets'));
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>SPA-INDEX</html>');
    fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'SPA-BUNDLE');

    const server = new PixelAgentsServer();
    const config = await server.start({
      store: new AgentStateStore(),
      embedded: false,
      readOnly: true,
      staticDir,
    });
    const base = `http://127.0.0.1:${config.port}`;
    try {
      for (const p of [
        '/',
        '/index.html',
        '/assets/app.js',
        '/api/hooks/x',
        '/api/hooks/claude',
        '/api/usage/claude',
        '/api/hooks/..%2findex.html',
        '/api/hooks/..%2fassets%2fapp.js',
        '/api/hooks/%2e%2e/assets/app.js',
        '/api/health/../index.html',
        '/api/login-code',
      ]) {
        const res = await fetch(`${base}${p}`);
        const body = await res.text();
        expect(res.status, p).toBe(401);
        expect(body, p).not.toMatch(/SPA-INDEX|SPA-BUNDLE/);
      }
      // With a session the same files are served.
      const cookie = await viewerLogin(config.port, config.token);
      expect(await (await fetch(`${base}/assets/app.js`, { headers: { cookie } })).text()).toBe(
        'SPA-BUNDLE',
      );
      // H14: never cached, never "304 unchanged". The packaged files all carry
      // the same date, so a validator would call a new version unchanged.
      for (const p of ['/', '/assets/app.js']) {
        const res = await fetch(`${base}${p}`, {
          headers: {
            cookie,
            'if-modified-since': new Date(Date.now() + 86_400_000).toUTCString(),
            'if-none-match': '*',
          },
        });
        expect(res.status, p).toBe(200);
        expect(res.headers.get('cache-control'), p).toBe('no-store');
        expect(res.headers.get('etag'), p).toBeNull();
        expect(res.headers.get('last-modified'), p).toBeNull();
      }
      // The ingest routes still answer to their own Bearer check, not the session.
      const hook = await fetch(`${base}/api/hooks/claude`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      });
      expect(hook.status).toBe(200);
      expect(
        (
          await fetch(`${base}/api/hooks/claude`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(401);
    } finally {
      server.stop();
    }
    expect(isOpenRequest('GET', '/api/health')).toBe(true);
    expect(isOpenRequest('POST', '/api/hooks/claude')).toBe(true);
    expect(isOpenRequest('GET', '/api/hooks/claude')).toBe(false);
    expect(isOpenRequest('POST', '/api/hooks/..%2fx')).toBe(false);
    expect(isOpenRequest('POST', '/api/hooks/a/b')).toBe(false);
    expect(isOpenRequest('PUT', '/api/health')).toBe(false);
  });

  it('H14: the headers are on the redirect, the bad-code refusal and the Host refusal too', async () => {
    const http = await import('http');
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const server = new PixelAgentsServer();
    const config = await server.start({ store: new AgentStateStore(), embedded: false, readOnly: true });
    const base = `http://127.0.0.1:${config.port}`;
    try {
      const { code } = (await (
        await fetch(`${base}/api/login-code`, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.token}` },
        })
      ).json()) as { code: string };
      const redirect = await fetch(`${base}/?code=${encodeURIComponent(code)}`, { redirect: 'manual' });
      const badCode = await fetch(`${base}/?code=nope`, { redirect: 'manual' });
      expect(redirect.status).toBe(302);
      expect(badCode.status).toBe(401);
      for (const res of [redirect, badCode]) {
        expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect(res.headers.get('x-frame-options')).toBe('DENY');
      }
      const forbidden = await new Promise<{ status: number; csp: unknown }>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: config.port, path: '/', agent: false, headers: { host: 'evil.example' } },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0, csp: res.headers['content-security-policy'] });
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(forbidden.status).toBe(403);
      expect(String(forbidden.csp)).toContain("default-src 'none'");
    } finally {
      server.stop();
    }
  });

  it('H11: a viewer and an upstream standalone server never reuse each other', async () => {
    const { sameStandaloneAccess } = await import('../src/serverConfig.js');
    const plain = { terminal: false, host: '127.0.0.1', allowedHosts: [] };
    expect(sameStandaloneAccess(plain, { ...plain })).toBe(true);
    expect(sameStandaloneAccess(plain, { ...plain, readOnly: true })).toBe(false);
    expect(sameStandaloneAccess({ ...plain, readOnly: true }, { ...plain, readOnly: true })).toBe(true);
  });
});

describe('H17: the viewer conversation view is opt-in, text-only and bounded', () => {
  const line = (record: Record<string, unknown>) => JSON.stringify(record);

  it('shows prompts and replies, never tool inputs, outputs or thinking', async () => {
    const { conversationFromText } = await import('../src/viewerConversation.js');
    const text = [
      line({ type: 'user', timestamp: '2026-11-10T10:00:00Z', message: { role: 'user', content: 'faça X<system-reminder>SEGREDO-DO-HARNESS</system-reminder>' } }),
      line({ type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'PENSAMENTO-PRIVADO' },
        { type: 'text', text: 'Vou ler o arquivo.' },
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/home/u/projeto/notas.txt', content: 'CONTEUDO-DO-ARQUIVO' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls -la' } },
      ] } }),
      line({ type: 'user', toolUseResult: {}, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'SAIDA-DA-FERRAMENTA' }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'SAIDA-2' }] } }),
      line({ type: 'user', isMeta: true, message: { role: 'user', content: 'META-REGISTRO' } }),
      line({ type: 'user', isSidechain: true, message: { role: 'user', content: 'SUBAGENTE' } }),
      line({ type: 'user', message: { role: 'user', content: '<local-command-stdout>SAIDA-LOCAL</local-command-stdout>' } }),
      line({ type: 'user', message: { role: 'user', content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>' } }),
      line({ type: 'system', content: 'SISTEMA' }),
      'not json',
    ].join('\n');
    const { entries, truncated } = conversationFromText(text, false);
    const all = JSON.stringify(entries);
    for (const hidden of ['SEGREDO-DO-HARNESS', 'PENSAMENTO-PRIVADO', 'CONTEUDO-DO-ARQUIVO', 'SAIDA-DA-FERRAMENTA', 'SAIDA-2', 'META-REGISTRO', 'SUBAGENTE', 'SAIDA-LOCAL', 'SISTEMA', '/home/u/projeto']) {
      expect(all).not.toContain(hidden);
    }
    expect(entries.map((e) => e.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
    expect(entries[0].text).toBe('faça X');
    expect(entries[0].t).toBe(Date.parse('2026-11-10T10:00:00Z'));
    expect(entries[2].text).toBe('Writing notas.txt');
    expect(entries[4].text).toBe('/model opus');
    expect(truncated).toBe(false);
  });

  it('is bounded: last entries only, each text capped, a mid-file start drops the fragment', async () => {
    const { conversationFromText, CONVERSATION_MAX_ENTRIES, CONVERSATION_MAX_TEXT } = await import(
      '../src/viewerConversation.js'
    );
    const many = Array.from({ length: CONVERSATION_MAX_ENTRIES + 20 }, (_, i) =>
      line({ type: 'user', message: { role: 'user', content: `msg ${i}` } }),
    ).join('\n');
    const tail = conversationFromText(many, false);
    expect(tail.entries).toHaveLength(CONVERSATION_MAX_ENTRIES);
    expect(tail.entries[tail.entries.length - 1].text).toBe(`msg ${CONVERSATION_MAX_ENTRIES + 19}`);
    expect(tail.truncated).toBe(true);
    const long = conversationFromText(line({ type: 'user', message: { content: 'a'.repeat(CONVERSATION_MAX_TEXT * 3) } }), false);
    expect(long.entries[0].text.length).toBeLessThanOrEqual(CONVERSATION_MAX_TEXT + 1);
    const mid = conversationFromText(`"fragmento": "FRAG"}\n${line({ type: 'user', message: { content: 'ok' } })}`, true);
    expect(mid.entries.map((e) => e.text)).toEqual(['ok']);
    expect(mid.truncated).toBe(true);
  });

  it('masks what looks like a credential', async () => {
    const { redactSecrets } = await import('../src/secretMask.js');
    const samples = [
      'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'github_pat_11AAAAAAAAAAAAAAAAAAAAAAAAAA',
      'AKIAABCDEFGHIJKLMNOP',
      'xoxb-1234567890-abcdefghij',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----',
    ];
    for (const secret of samples) {
      const out = redactSecrets(`antes ${secret} depois`);
      expect(out).toContain('<redacted>');
      expect(out).not.toContain(secret);
    }
    expect(redactSecrets('Authorization: Bearer abc123def456ghi789')).not.toContain('abc123def456ghi789');
    expect(redactSecrets('DB_PASSWORD=hunter2hunter2')).toBe('DB_PASSWORD=<redacted>');
    expect(redactSecrets('https://user:s3cr3t@example.com/x')).toBe('https://user:<redacted>@example.com/x');
    // Ordinary prose stays readable.
    expect(redactSecrets('Basic authentication is fine')).toBe('Basic authentication is fine');
    expect(redactSecrets('commit 9d1e1f4 no secure')).toBe('commit 9d1e1f4 no secure');
  });

  it('is answered only by a viewer whose operator turned it on, and only from the agent\'s own transcript', async () => {
    const os = await import('os');
    const { WebSocket } = await import('ws');
    const { PixelAgentsServer } = await import('../src/server.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { createAgentState } = await import('../src/agentState.js');
    // Under the Claude transcript root: nothing else is read.
    const projects = path.join(os.homedir(), '.claude', 'projects');
    fs.mkdirSync(projects, { recursive: true });
    const dir = fs.mkdtempSync(path.join(projects, 'pxl-conv-'));
    const transcript = path.join(dir, 'sessao.jsonl');
    fs.writeFileSync(transcript, line({ type: 'user', message: { content: 'PROMPT-DO-AGENTE' } }) + '\n');
    const other = path.join(dir, 'outro.jsonl');
    fs.writeFileSync(other, line({ type: 'user', message: { content: 'OUTRO-ARQUIVO' } }) + '\n');

    const ask = async (options: { readOnly: boolean; conversation?: boolean }) => {
      const store = new AgentStateStore();
      store.set(7, createAgentState({ id: 7, sessionId: 's', projectDir: dir, jsonlFile: transcript, isExternal: true }));
      const server = new PixelAgentsServer();
      const config = await server.start({ store, embedded: false, ...options });
      try {
        const cookie = options.readOnly ? await viewerLogin(config.port, config.token) : '';
        const url = options.readOnly
          ? `ws://127.0.0.1:${config.port}/ws`
          : `ws://127.0.0.1:${config.port}/ws?token=${encodeURIComponent(config.token)}`;
        const ws = new WebSocket(url, { headers: { cookie } });
        const answers: Array<Record<string, unknown>> = [];
        ws.on('message', (d: Buffer) => {
          const m = JSON.parse(d.toString()) as Record<string, unknown>;
          if (m.type === 'agentConversation') answers.push(m);
        });
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve());
          ws.on('error', reject);
        });
        ws.send(JSON.stringify({ type: 'requestAgentConversation', id: 7, path: other, jsonlFile: other }));
        ws.send(JSON.stringify({ type: 'requestAgentConversation', id: 99 }));
        for (let i = 0; i < 40 && answers.length < 2; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        ws.close();
        return answers;
      } finally {
        server.stop();
      }
    };

    // Off by default: a viewer without the flag answers "disabled", nothing more.
    const off = await ask({ readOnly: true });
    expect(off[0]).toMatchObject({ id: 7, enabled: false, entries: [] });
    expect(JSON.stringify(off)).not.toContain('PROMPT-DO-AGENTE');

    // A privileged (non-viewer) server ignores the flag.
    const privileged = await ask({ readOnly: false, conversation: true });
    expect(privileged[0]).toMatchObject({ id: 7, enabled: false, entries: [] });

    // On: the agent's own transcript, whatever path the client names.
    const on = await ask({ readOnly: true, conversation: true });
    const seven = on.find((m) => m.id === 7)!;
    expect(seven.enabled).toBe(true);
    expect(JSON.stringify(seven)).toContain('PROMPT-DO-AGENTE');
    expect(JSON.stringify(on)).not.toContain('OUTRO-ARQUIVO');
    expect(on.find((m) => m.id === 99)).toMatchObject({ enabled: true, entries: [] });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the read-only gate gained exactly this one exception, and the switch is the service environment', async () => {
    const handler = fs.readFileSync(path.join(REPO_ROOT, 'server/src/clientMessageHandler.ts'), 'utf-8');
    expect(handler).toContain("if (!ctx.privileged && msg.type !== 'webviewReady') {");
    const beforeGate = handler.slice(0, handler.indexOf("if (!ctx.privileged && msg.type !== 'webviewReady') {"));
    const handled = [...beforeGate.matchAll(/msg\.type === '([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(handled).toEqual(['requestAgentConversation']);
    const http = fs.readFileSync(path.join(REPO_ROOT, 'server/src/httpServer.ts'), 'utf-8');
    expect(http).toContain('conversation: options.readOnly === true && options.conversation === true');
    const { conversationEnabled, CONVERSATION_ENV } = await import('../src/viewer.js');
    expect(conversationEnabled({})).toBe(false);
    expect(conversationEnabled({ [CONVERSATION_ENV]: 'true' })).toBe(false);
    expect(conversationEnabled({ [CONVERSATION_ENV]: '1' })).toBe(true);
    // The extension never offers it.
    for (const file of ['adapters/vscode/PixelAgentsViewProvider.ts', 'server/src/cli.ts']) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
      expect(source).not.toMatch(/conversation:\s*true|PIXEL_AGENTS_VIEWER_CONVERSATION|ActivityLog/);
    }
  });
});

describe('viewer activity history: only the labels the office already shows', () => {
  it('records turns, tool labels and permissions; never a tool input', async () => {
    const os = await import('os');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { createAgentState } = await import('../src/agentState.js');
    const { ActivityLog, cwdFromTranscriptHead, folderName } = await import('../src/activityLog.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-activity-'));
    const transcript = path.join(dir, 's.jsonl');
    fs.writeFileSync(transcript, JSON.stringify({ type: 'user', cwd: '/home/u/repos/meu-projeto', message: { content: 'x' } }) + '\n');
    let now = 1_000_000;
    const store = new AgentStateStore();
    const log = new ActivityLog(store, { now: () => now, max: 5 });
    const live: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m) => {
      if (m.type === 'agentActivity') live.push(m);
    });
    store.set(1, createAgentState({ id: 1, sessionId: 's', projectDir: dir, jsonlFile: transcript, isExternal: true }));
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    store.broadcast({ type: 'agentStatus', id: 1, status: 'active' });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'a', status: 'Reading x.ts', toolName: 'Read', input: { file_path: '/segredo/x.ts' }, tool_input: 'CONTEUDO' });
    // The same tool from the hook (a "hook-" id) and from the transcript: one entry.
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'hook-1', status: 'Reading x.ts' });
    now += 5_000;
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true });
    store.broadcast({ type: 'agentToolStart', id: 42, toolId: 'z', status: 'Ghost' });

    const [snap] = log.snapshot();
    expect(snap.entries.map((e) => e.k)).toEqual(['joined', 'turn', 'tool', 'permission', 'input']);
    for (const entry of snap.entries) {
      expect(Object.keys(entry).every((k) => ['n', 't', 'k', 'label', 'toolId'].includes(k))).toBe(true);
    }
    expect(JSON.stringify(snap)).not.toMatch(/segredo|CONTEUDO|Ghost/);
    expect(live.length).toBeGreaterThanOrEqual(5);

    // Capped.
    for (let i = 0; i < 10; i++) {
      now += 10_000;
      store.broadcast({ type: 'agentToolStart', id: 1, toolId: `t${i}`, status: `Tool ${i}` });
    }
    expect(log.snapshot()[0].entries).toHaveLength(5);

    // The project is the cwd's last segment, nothing more.
    for (let i = 0; i < 40 && !log.snapshot()[0].project; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(log.snapshot()[0].project).toBe('meu-projeto');
    expect(folderName('C:\\Users\\alguem\\repos\\app')).toBe('app');
    expect(cwdFromTranscriptHead('{"cwd":"/a/b\\"c"}')).toBe('/a/b"c');

    store.delete(1);
    expect(log.snapshot()).toEqual([]);
    log.dispose();
  });
});

describe('H17 (review fixes): harness blocks, linear time, files read, the gate', () => {
  const userRecord = (content: unknown) => ({ type: 'user', message: { role: 'user', content } });

  it('takes every harness block out, mixed with text or alone, names with "_" included', async () => {
    const { entriesFromRecord } = await import('../src/viewerConversation.js');
    const texts = (content: unknown) => entriesFromRecord(userRecord(content)).map((e) => e.text);
    const mixed = texts([
      { type: 'text', text: '<ide_selection>The user selected /x/.env:\nCONTEUDO_DO_ARQUIVO</ide_selection>' },
      { type: 'text', text: 'corrige isso' },
    ]);
    expect(JSON.stringify(mixed)).not.toMatch(/CONTEUDO_DO_ARQUIVO|\/x\/\.env/);
    expect(mixed[0]).toContain('corrige isso');
    expect(mixed[0]).toContain('[ide_selection omitido]');
    expect(texts('<ide_opened_file>The user opened /home/u/x.ts</ide_opened_file>')).toEqual([]);
    const stdout = texts('<bash-stdout>SAIDA</bash-stdout> e mais texto');
    expect(JSON.stringify(stdout)).not.toContain('SAIDA');
    expect(stdout[0]).toContain('e mais texto');
    // Nested and repeated blocks: the outermost goes, whole.
    const nested = texts('a <outer>x <inner>SEGREDO</inner> y</outer> b <system-reminder>R</system-reminder>');
    expect(nested).toEqual(['a [outer omitido] b']);
  });

  it('crafted text cannot stall the viewer: parsing and masking are linear', async () => {
    const { entriesFromRecord } = await import('../src/viewerConversation.js');
    const { redactSecrets } = await import('../src/secretMask.js');
    const MB = 1024 * 1024;
    const crafted = [
      'token.'.repeat(MB / 6),
      'a.'.repeat(MB / 2),
      '<br>'.repeat(MB / 4),
      '<system-reminder>'.repeat(MB / 17),
      'eyJ-'.repeat(MB / 4),
      '-----BEGIN RSA PRIVATE KEY-----'.repeat(MB / 31),
      'http://a'.repeat(MB / 8),
      `<x>${'a'.repeat(MB)}`,
    ];
    const started = Date.now();
    for (const text of crafted) {
      entriesFromRecord(userRecord(text));
      entriesFromRecord({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    }
    // The worst case before the fix: 8 KB of "token." took about 8 s.
    redactSecrets('token.'.repeat(8 * 1024 / 6));
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('reads only a .jsonl under a transcript root, and answers "unchanged" for a known version', async () => {
    const os = await import('os');
    const { answerConversationRequest, isUnderTranscriptRoot } = await import('../src/viewerConversation.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { createAgentState } = await import('../src/agentState.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-root-'));
    const away = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-away-'));
    fs.mkdirSync(path.join(root, 'p'));
    const inside = path.join(root, 'p', 's.jsonl');
    const outside = path.join(away, 's.jsonl');
    const link = path.join(root, 'p', 'link.jsonl');
    fs.writeFileSync(inside, JSON.stringify(userRecord('DENTRO')) + '\n');
    fs.writeFileSync(outside, JSON.stringify(userRecord('FORA')) + '\n');
    fs.writeFileSync(path.join(root, 'p', 's.txt'), 'x');
    fs.symlinkSync(outside, link);
    try {
      expect(await isUnderTranscriptRoot(inside, [root])).toBe(true);
      expect(await isUnderTranscriptRoot(outside, [root])).toBe(false);
      expect(await isUnderTranscriptRoot(link, [root])).toBe(false);
      expect(await isUnderTranscriptRoot(path.join(root, 'p', 's.txt'), [root])).toBe(false);

      const store = new AgentStateStore();
      store.set(1, createAgentState({ id: 1, sessionId: 'a', projectDir: root, jsonlFile: inside, isExternal: true }));
      store.set(2, createAgentState({ id: 2, sessionId: 'b', projectDir: away, jsonlFile: outside, isExternal: true }));
      store.set(3, createAgentState({ id: 3, sessionId: 'c', projectDir: root, jsonlFile: link, isExternal: true }));
      const sent: Array<Record<string, unknown>> = [];
      const ask = (msg: Record<string, unknown>) =>
        answerConversationRequest({ type: 'requestAgentConversation', ...msg }, (m) => sent.push(m), store, true, () => [root]);
      await ask({ id: 1 });
      expect(JSON.stringify(sent[0])).toContain('DENTRO');
      const version = sent[0].version as string;
      expect(typeof version).toBe('string');
      await ask({ id: 1, version });
      expect(sent[1]).toEqual({ type: 'agentConversation', id: 1, enabled: true, unchanged: true, version });
      await ask({ id: 2 });
      await ask({ id: 3 });
      expect(sent[2]).toMatchObject({ id: 2, unreadable: true, entries: [] });
      expect(sent[3]).toMatchObject({ id: 3, unreadable: true, entries: [] });
      expect(JSON.stringify(sent)).not.toContain('FORA');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(away, { recursive: true, force: true });
    }
  });

  it('a read-only client is refused every message type but webviewReady and requestAgentConversation', async () => {
    // A fresh module: refusals are logged once per type per process.
    vi.resetModules();
    const { handleClientMessage } = await import('../src/clientMessageHandler.js');
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const source = fs.readFileSync(path.join(REPO_ROOT, 'core/src/messages.ts'), 'utf-8');
    const union = /export type ClientMessage =([^;]+);/.exec(source)![1];
    const types = [...union.matchAll(/\|\s*(\w+)/g)].map(
      (m) => new RegExp(`export interface ${m[1]} \\{\\s*type: '(\\w+)'`).exec(source)?.[1],
    );
    expect(types.length).toBeGreaterThan(20);
    expect(types.every(Boolean)).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const type of [...(types as string[]), 'requestAgentConversation']) {
        if (type === 'webviewReady') continue;
        const sent: Array<Record<string, unknown>> = [];
        warn.mockClear();
        handleClientMessage({ type, id: 1 }, (m) => sent.push(m), {
          store: new AgentStateStore(),
          cache: null,
          privileged: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (type === 'requestAgentConversation') {
          expect(warn).not.toHaveBeenCalled();
          expect(sent).toEqual([{ type: 'agentConversation', id: 1, enabled: false, entries: [], truncated: false }]);
        } else {
          const refused = warn.mock.calls.some((c) => String(c[0]).includes(`Ignoring ${type} from a read-only client`));
          expect(refused, `${type} was not refused`).toBe(true);
        }
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('a Windows path in a tool label keeps only the file name (no user name, no folders)', async () => {
    const { formatToolStatus } = await import('../src/providers/hook/claude/claude.js');
    expect(formatToolStatus('Read', { file_path: 'C:\\Users\\alguem\\repos\\app\\segredo.ts' })).toBe('Reading segredo.ts');
    expect(formatToolStatus('Edit', { file_path: '/home/u/repos/app/y.ts' })).toBe('Editing y.ts');
  });

  it('activity: a re-announced tool is one entry, repeats from one source are kept, labels are masked', async () => {
    const { AgentStateStore } = await import('../src/agentStateStore.js');
    const { createAgentState } = await import('../src/agentState.js');
    const { ActivityLog } = await import('../src/activityLog.js');
    const { maskToolLabels } = await import('../src/secretMask.js');
    const store = new AgentStateStore();
    const log = new ActivityLog(store);
    store.set(1, createAgentState({ id: 1, sessionId: 's', projectDir: '/nao', jsonlFile: '', isExternal: true }));
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'x1', status: 'Subtask: build' });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'x1', status: 'Subtask: build', runInBackground: true });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'g1', status: 'Searching code' });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 'g2', status: 'Searching code' });
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 't9', status: 'Running: export API_KEY=abcd1234efgh' });
    const tools = log.snapshot()[0].entries.filter((e) => e.k === 'tool');
    expect(tools.map((e) => e.label)).toEqual([
      'Subtask: build',
      'Searching code',
      'Searching code',
      'Running: export API_KEY=<redacted>',
    ]);
    expect(tools.map((e) => e.n)).toEqual([...tools.map((e) => e.n)].sort((a, b) => a - b));
    // The live label a viewer receives is masked the same way.
    expect(maskToolLabels({ type: 'agentToolStart', status: 'Running: TOKEN=abcd1234efgh' }).status).toBe(
      'Running: TOKEN=<redacted>',
    );
    expect(maskToolLabels({ type: 'agentStatus', status: 'active' })).toEqual({ type: 'agentStatus', status: 'active' });
    log.dispose();
  });
});
