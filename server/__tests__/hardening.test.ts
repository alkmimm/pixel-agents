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
