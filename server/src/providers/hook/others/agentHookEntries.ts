/**
 * pixel-agents-secure (local): the hook entries Pixel Agents writes into
 * another agent's own configuration, so its sessions show in the office.
 *
 *   GitHub Copilot   a file of ours alone, `~/.copilot/hooks/pixel-agents.json`
 *                    (Copilot reads every file of that folder). Nothing of the
 *                    user's is touched; turning it off deletes the file.
 *   Gemini CLI       entries under `hooks` in `~/.gemini/settings.json`, beside
 *                    whatever is there, each recognisable by its command.
 *                    Turning it off removes exactly those entries.
 *
 * Every entry runs the hook script that is already installed for Claude Code,
 * naming the agent and the event on the command line. The script answers "no
 * decision" before doing anything else (hooks/claude-hook.ts) and the entries
 * themselves never fail: an observer must not be able to stop a tool.
 *
 * Never registered: the events that carry the user's prompt
 * (`userPromptSubmitted`, `BeforeAgent`) and the ones that decide a permission
 * (`permissionRequest`). Same rule as `UserPromptSubmit` for Claude Code.
 *
 * Everything here is pure (it builds and recognises JSON); the files are read
 * and written in otherAgents.ts. Written from each agent's documentation, not
 * tried against the real thing.
 */

export const COPILOT_HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'notification',
  'agentStop',
  'subagentStart',
  'subagentStop',
] as const;

export const GEMINI_HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'BeforeTool',
  'AfterTool',
  'AfterAgent',
  'Notification',
] as const;

/** Gemini's tool events take a matcher (a pattern over tool names). */
const GEMINI_TOOL_EVENTS: readonly string[] = ['BeforeTool', 'AfterTool'];
const GEMINI_HOOK_NAME = 'pixel-agents';
/** Seconds (Copilot) and milliseconds (Gemini): the POST itself gives up at 300 ms. */
const COPILOT_TIMEOUT_SEC = 5;
const GEMINI_TIMEOUT_MS = 5_000;

/** The path every command of ours ends its script argument with. */
const SCRIPT_SUFFIX = '/.pixel-agents/hooks/claude-hook.js"';

export function agentHookCommand(scriptPath: string, agent: string, event: string): string {
  return `node "${scriptPath}" --agent=${agent} --event=${event}`;
}

/** Whether a command is one of ours for `agent` (either path separator). */
export function isOurAgentCommand(command: unknown, agent: string): boolean {
  if (typeof command !== 'string') return false;
  const normal = command.replace(/\\/g, '/');
  return normal.startsWith('node "') && normal.includes(`${SCRIPT_SUFFIX} --agent=${agent} `);
}

// ── GitHub Copilot ──────────────────────────────────────────────────────────

/** The whole content of `~/.copilot/hooks/pixel-agents.json`. */
export function copilotHooksFile(scriptPath: string): Record<string, unknown> {
  const hooks: Record<string, unknown[]> = {};
  for (const event of COPILOT_HOOK_EVENTS) {
    const command = agentHookCommand(scriptPath, 'copilot', event);
    hooks[event] = [
      {
        type: 'command',
        // Copilot denies a tool whose preToolUse hook fails. With no `node` to
        // run, the entry still answers "no decision" and succeeds.
        bash: `${command} || echo '{}'`,
        powershell: `${command}; if (-not $?) { '{}' }; exit 0`,
        timeoutSec: COPILOT_TIMEOUT_SEC,
      },
    ];
  }
  return { version: 1, hooks };
}

/** Whether a parsed file is one we wrote: every entry runs our script, and
 *  nothing else is in it. Only such a file is ever overwritten or deleted. */
export function isOurCopilotHooksFile(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const { hooks, ...rest } = parsed as Record<string, unknown>;
  if (Object.keys(rest).some((key) => key !== 'version')) return false;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return false;
  const lists = Object.values(hooks as Record<string, unknown>);
  return (
    lists.length > 0 &&
    lists.every(
      (list) =>
        Array.isArray(list) &&
        list.length > 0 &&
        list.every(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            isOurAgentCommand((entry as Record<string, unknown>).bash, 'copilot'),
        ),
    )
  );
}

// ── Gemini CLI ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isOurGeminiEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const hooks = (entry as Json).hooks;
  return (
    Array.isArray(hooks) &&
    hooks.length > 0 &&
    hooks.every(
      (hook) =>
        typeof hook === 'object' && hook !== null && isOurAgentCommand((hook as Json).command, 'gemini'),
    )
  );
}

function hooksOf(settings: Json): Json {
  const hooks = settings.hooks;
  return typeof hooks === 'object' && hooks !== null && !Array.isArray(hooks) ? (hooks as Json) : {};
}

/** `settings` without our entries; everything else as it was. An event left
 *  with no entries, and a `hooks` left with no events, are removed. */
export function withoutGeminiHooks(settings: Json): Json {
  const hooks: Json = {};
  for (const [event, list] of Object.entries(hooksOf(settings))) {
    if (!Array.isArray(list)) {
      hooks[event] = list;
      continue;
    }
    const kept = list.filter((entry) => !isOurGeminiEntry(entry));
    if (kept.length > 0) hooks[event] = kept;
  }
  const { hooks: _dropped, ...rest } = settings;
  void _dropped;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

/** `settings` with our entries (once each), after whatever is already there. */
export function withGeminiHooks(settings: Json, scriptPath: string): Json {
  const clean = withoutGeminiHooks(settings);
  const hooks: Json = { ...hooksOf(clean) };
  for (const event of GEMINI_HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [
      ...existing,
      {
        ...(GEMINI_TOOL_EVENTS.includes(event) ? { matcher: '.*' } : {}),
        hooks: [
          {
            name: GEMINI_HOOK_NAME,
            type: 'command',
            command: agentHookCommand(scriptPath, 'gemini', event),
            timeout: GEMINI_TIMEOUT_MS,
          },
        ],
      },
    ];
  }
  return { ...clean, hooks };
}

/** Whether every event of ours has its entry. */
export function hasGeminiHooks(settings: Json): boolean {
  const hooks = hooksOf(settings);
  return GEMINI_HOOK_EVENTS.every(
    (event) => Array.isArray(hooks[event]) && (hooks[event] as unknown[]).some(isOurGeminiEntry),
  );
}
