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
        ws.on('unexpected-response', () => resolve(false));
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

    const env = { ...process.env, HOME: home, USERPROFILE: home };
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
