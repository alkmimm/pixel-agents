import * as fs from 'fs';

import { HOOK_API_PREFIX } from '../../../../constants.js';
import { AGENT_HINT, EVENT_HINT } from './foreignPayload.js';
import { filterHookPayload } from './hookPayloadFilter.js';
import { liveServers, postToServer } from './serverRegistry.js';

/** Per-server POST timeout. */
// pixel-agents-secure: Claude Code waits for this script on every tool call. A
// healthy local server answers in under a millisecond; one that does not answer
// must cost the agent 300 ms, not 2 s.
const HOOK_POST_TIMEOUT_MS = 300;

/**
 * CI / e2e diagnostic: when PIXEL_AGENTS_DEBUG_LOG is set, record the hook
 * script's outcome at every exit point. The hook delivery chain (spawn
 * claude-hook.js -> read the registry -> POST to every live server) is
 * otherwise 100% silent: every failure path resolves quietly, so a dropped
 * hook is invisible in CI. Logging here lets a failing run show exactly
 * where delivery dies (bad-stdin, no-server-json, per-server POST
 * error/timeout/status). Zero cost when the env var is unset.
 */
// Env var is the primary source, but it doesn't reliably reach this spawned
// process across platforms (macOS VS Code terminal profiles with
// inheritEnv:false, etc.). After reading the registry we fall back to a
// live server's `debugLog` field, which the server populated from the same
// env var.
const debugLogPath = process.env['PIXEL_AGENTS_DEBUG_LOG'];
function hookDebug(line: string): void {
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, `${new Date().toISOString()} HOOKSCRIPT ${line}\n`);
  } catch {
    /* never let diagnostics break the hook */
  }
}

/**
 * pixel-agents-secure (local): started by another agent's hook entry
 * (`--agent=copilot --event=preToolUse`; providers/hook/others/). Those agents
 * read this script's output as the hook's answer, so the answer is written
 * first and is always "no decision": whatever happens after this line, the
 * office never allows, denies or changes anything the agent does.
 */
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const otherAgent = /^(copilot|gemini)$/.test(arg('agent') ?? '') ? arg('agent') : undefined;
if (otherAgent) process.stdout.write('{}\n');

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    hookDebug('exit reason=bad-stdin');
    process.exit(0);
  }

  if (otherAgent) {
    data[AGENT_HINT] = otherAgent;
    data[EVENT_HINT] = arg('event');
  }

  // pixel-agents-secure (local): started by Cursor (it runs Claude Code's hooks
  // by itself). Its environment says so even when the payload does not.
  if (typeof process.env['CURSOR_VERSION'] === 'string' && data.cursor_version === undefined) {
    data.cursor_version = process.env['CURSOR_VERSION'];
  }

  const eventName = (data.hook_event_name as string | undefined) ?? '?';
  const sid = (data.session_id as string | undefined)?.slice(0, 8) ?? '?';

  // Multi-server fan-out (D4): deliver to every live server in the registry,
  // or the single legacy server.json when the registry has no live entries.
  const label = `event=${eventName} sid=${sid}`;
  const servers = liveServers(hookDebug, label);
  if (servers === null) process.exit(0);

  // pixel-agents-secure (H9): the debug-log path comes from this process's own
  // environment only. Upstream also adopted it from a registry entry, which let
  // anything able to write ~/.pixel-agents/servers/ make every hook append to a
  // file of its choosing.

  // pixel-agents-secure (H4): only the allowlisted, capped fields leave this
  // process -- never tool_input contents, tool_response or prompt text.
  const body = JSON.stringify(filterHookPayload(data));
  await Promise.all(
    servers.map((server) =>
      postToServer(server, {
        path: `${HOOK_API_PREFIX}/${otherAgent ?? 'claude'}`,
        body,
        label,
        debug: hookDebug,
        timeoutMs: HOOK_POST_TIMEOUT_MS,
      }),
    ),
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
