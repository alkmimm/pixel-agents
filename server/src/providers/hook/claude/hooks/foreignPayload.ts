/**
 * pixel-agents-secure (local + H4): GitHub Copilot and Gemini CLI sessions in
 * the office.
 *
 * Unlike Cursor (cursorPayload.ts), these two do not run Claude Code's hooks:
 * the user turns each one on in the panel (Opções → Outros agentes), which
 * writes hook entries of ours into that agent's own configuration
 * (providers/hook/others/). Those entries start this same script with
 * `--agent=<kind> --event=<name>`; the payload on stdin is the agent's own.
 *
 * As for Cursor, the payload is rewritten here as the Claude-shaped event it
 * stands for, and then goes through the one allowlist of the H4 filter. Only
 * ids, names and the folder are read; the tool's arguments are narrowed to the
 * two fields the status line uses (a command, a file path) and the H4 filter
 * reduces those further (program and verb; file name). Never forwarded: the
 * prompt, the model's text, tool results, notification text.
 *
 * Written from each agent's documentation
 * (docs/LEVANTAMENTO-OUTROS-AGENTES.md in the governance repository) and from
 * what other forks do, not from payloads captured on a real machine.
 *
 * Pure and dependency-free: bundled into dist/hooks/claude-hook.js.
 */
import { type AgentKind, kindSessionId } from './agentKinds.js';

/** Set by the script from its own arguments, before filtering; never forwarded. */
export const AGENT_HINT = '__pixel_agent';
export const EVENT_HINT = '__pixel_event';

const MAX_PATH = 512;
/** A tool's arguments may come as a JSON string: no more than this is parsed. */
const MAX_ARGS_JSON = 16_384;

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.length <= MAX_ARGS_JSON) {
    try {
      const parsed: unknown = JSON.parse(value);
      return record(typeof parsed === 'string' ? undefined : parsed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Of a tool's arguments, the two things the status line can use. */
function toolInput(args: unknown): Record<string, unknown> | undefined {
  const raw = record(args);
  if (!raw) return undefined;
  const out: Record<string, unknown> = {};
  const command = text(raw.command, MAX_ARGS_JSON);
  if (command) out.command = command;
  const file =
    text(raw.file_path, MAX_PATH) ??
    text(raw.absolute_path, MAX_PATH) ??
    text(raw.path, MAX_PATH) ??
    text(raw.filePath, MAX_PATH);
  if (file) out.file_path = file;
  return out;
}

interface AgentDialect {
  /** The agent's event name (lower case) → the Claude Code event. */
  events: Record<string, string>;
  /** The agent's tool name (lower case) → the one the status line is written for. */
  tools: Record<string, string>;
  /** Field names, in the agent's own spelling. */
  sessionId: string[];
  toolName: string[];
  toolArgs: string[];
  helper: string[];
  /** A notification that means "waiting for approval". */
  permissionNotice: (type: string) => boolean;
}

const DIALECTS: Record<Exclude<AgentKind, 'cursor'>, AgentDialect> = {
  copilot: {
    events: {
      sessionstart: 'SessionStart',
      sessionend: 'SessionEnd',
      pretooluse: 'PreToolUse',
      posttooluse: 'PostToolUse',
      posttoolusefailure: 'PostToolUseFailure',
      permissionrequest: 'PermissionRequest',
      notification: 'Notification',
      agentstop: 'Stop',
      subagentstart: 'SubagentStart',
      subagentstop: 'SubagentStop',
    },
    tools: {
      bash: 'Bash',
      shell: 'Bash',
      powershell: 'Bash',
      view: 'Read',
      read: 'Read',
      edit: 'Edit',
      str_replace_editor: 'Edit',
      create: 'Write',
      write: 'Write',
      grep: 'Grep',
      glob: 'Glob',
      task: 'Task',
    },
    sessionId: ['sessionId', 'session_id'],
    toolName: ['toolName', 'tool_name'],
    toolArgs: ['toolArgs', 'tool_input'],
    helper: ['agentName', 'agentType'],
    permissionNotice: (type) => /permission/i.test(type),
  },
  gemini: {
    events: {
      sessionstart: 'SessionStart',
      sessionend: 'SessionEnd',
      beforetool: 'PreToolUse',
      aftertool: 'PostToolUse',
      afteragent: 'Stop',
      notification: 'Notification',
    },
    tools: {
      run_shell_command: 'Bash',
      read_file: 'Read',
      read_many_files: 'Read',
      write_file: 'Write',
      replace: 'Edit',
      search_file_content: 'Grep',
      grep: 'Grep',
      glob: 'Glob',
      web_fetch: 'WebFetch',
      google_web_search: 'WebSearch',
    },
    sessionId: ['session_id'],
    toolName: ['tool_name'],
    toolArgs: ['tool_input'],
    helper: [],
    permissionNotice: (type) => type === 'ToolPermission',
  },
};

function first(data: Record<string, unknown>, keys: string[], max: number): string | undefined {
  for (const key of keys) {
    const value = text(data[key], max);
    if (value) return value;
  }
  return undefined;
}

/**
 * A Copilot or Gemini payload as the Claude-shaped event it stands for, or
 * `{}` for anything that must not leave this process: an unknown agent, an
 * event not listed above, a notification that is not a permission prompt, a
 * payload with no session.
 */
export function translateForeignPayload(
  agent: unknown,
  event: unknown,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (agent !== 'copilot' && agent !== 'gemini') return {};
  const dialect = DIALECTS[agent];
  const named = text(event, 64) ?? text(data.hook_event_name, 64) ?? text(data.hookType, 64) ?? '';
  let name = dialect.events[named.toLowerCase()];
  const id = first(data, dialect.sessionId, 128);
  if (!name || !id) return {};
  if (name === 'Notification') {
    // Only "it is asking for approval" is of use; the notification's text is not read.
    const type = text(data.notification_type, 64) ?? text(data.notificationType, 64) ?? '';
    if (!dialect.permissionNotice(type)) return {};
    name = 'PermissionRequest';
  }

  const out: Record<string, unknown> = {
    hook_event_name: name,
    session_id: kindSessionId(agent, id),
    agent_kind: agent,
  };
  const cwd = text(data.cwd, MAX_PATH);
  if (cwd) out.cwd = cwd;
  for (const key of ['source', 'reason'] as const) {
    const value = text(data[key], 64);
    if (value) out[key] = value;
  }
  const tool = first(data, dialect.toolName, 128);
  if (tool) out.tool_name = dialect.tools[tool.toLowerCase()] ?? tool;
  for (const key of dialect.toolArgs) {
    const input = toolInput(data[key]);
    if (input) {
      out.tool_input = input;
      break;
    }
  }
  const helper = first(data, dialect.helper, 128);
  if (helper) out.agent_type = helper;
  return out;
}
