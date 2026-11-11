/**
 * pixel-agents-secure (local + H4): Cursor sessions in the office, through the
 * hooks that are already installed.
 *
 * Cursor runs the hooks of `~/.claude/settings.json` by itself ("Third-Party
 * Imports", on by default), so this script is already started by Cursor's
 * agent, with Cursor's payload: `conversation_id` where Claude Code sends
 * `session_id`, `workspace_roots` for the folder, camelCase event names -- and
 * `user_email`, prompt text, file contents and tool output next to them.
 * Nothing is written to Cursor's configuration and no hook is added: the
 * payload is recognised here and reduced to the SAME allowlisted shape a
 * Claude Code event has, so everything after this point (the H4 filter, the
 * route, the runtime) treats it as one more session.
 *
 * What a Cursor session shows: when it starts and ends, the tool it runs
 * (name, file name, program and verb of a shell command), turn end, helpers.
 * What it cannot show: "waiting for approval" -- Cursor has no such event.
 * There is no transcript either: `transcript_path` is dropped on purpose (it is
 * not Claude Code's format, and transcripts are only read under
 * `.claude/projects`, H16).
 *
 * Written from Cursor's documentation (docs/LEVANTAMENTO-OUTROS-AGENTES.md in
 * the governance repository), not from a payload captured on a real machine.
 *
 * Pure and dependency-free: bundled into dist/hooks/claude-hook.js and used
 * again by the server's route.
 */

/** Marks the forwarded event as Cursor's, and prefixes its session id so it can
 *  never be taken for (or collide with) a Claude Code session. */
export const CURSOR_AGENT_KIND = 'cursor';
export const CURSOR_SESSION_PREFIX = 'cursor-';

const MAX_ID = 128;
const MAX_PATH = 512;

/** Cursor's event → the Claude Code event the runtime knows. Events not listed
 *  are dropped: the ones that only carry text (prompt, response, thought, file
 *  content) and the ones the office has no use for. */
const EVENT_NAMES: Record<string, string> = {
  sessionstart: 'SessionStart',
  sessionend: 'SessionEnd',
  pretooluse: 'PreToolUse',
  posttooluse: 'PostToolUse',
  posttoolusefailure: 'PostToolUseFailure',
  stop: 'Stop',
  subagentstart: 'SubagentStart',
  subagentstop: 'SubagentStop',
};

/** Cursor's tool names → the ones the status line is written for. */
const TOOL_NAMES: Record<string, string> = {
  Shell: 'Bash',
  Terminal: 'Bash',
  Delete: 'Edit',
  StrReplace: 'Edit',
};

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

/** Whether a hook payload came from Cursor's agent. */
export function isCursorPayload(data: Record<string, unknown>): boolean {
  return (
    typeof data.cursor_version === 'string' ||
    typeof data.conversation_id === 'string' ||
    Array.isArray(data.workspace_roots)
  );
}

/**
 * A Cursor payload as the Claude-shaped event it stands for, or `{}` for an
 * event that must not leave this process (no session id: the server drops it).
 * Only ids, names and the folder are read here; `tool_input` is passed on for
 * the H4 filter to reduce, exactly as for Claude Code.
 */
export function translateCursorPayload(data: Record<string, unknown>): Record<string, unknown> {
  const event = typeof data.hook_event_name === 'string' ? data.hook_event_name : '';
  const name = EVENT_NAMES[event.toLowerCase()];
  // The conversation is what every event names; `session_id` only comes with
  // the session's own start and end.
  const id = text(data.conversation_id, MAX_ID) ?? text(data.session_id, MAX_ID);
  if (!name || !id) return {};

  const out: Record<string, unknown> = {
    hook_event_name: name,
    session_id: id.startsWith(CURSOR_SESSION_PREFIX) ? id : CURSOR_SESSION_PREFIX + id,
    agent_kind: CURSOR_AGENT_KIND,
  };
  const roots = Array.isArray(data.workspace_roots) ? data.workspace_roots : [];
  const cwd = text(data.cwd, MAX_PATH) ?? text(roots[0], MAX_PATH);
  if (cwd) out.cwd = cwd;
  for (const key of ['source', 'reason'] as const) {
    const value = text(data[key], 64);
    if (value) out[key] = value;
  }
  const tool = text(data.tool_name, 128);
  if (tool) out.tool_name = TOOL_NAMES[tool] ?? tool;
  if (typeof data.tool_input === 'object' && data.tool_input !== null) {
    out.tool_input = data.tool_input;
  }
  const helper = text(data.subagent_type, 128) ?? text(data.agent_type, 128);
  if (helper) out.agent_type = helper;
  return out;
}
