/**
 * pixel-agents-secure (H4): what of a Claude Code hook payload ever leaves the
 * hook process.
 *
 * Claude Code hands the hook script the whole event: for PreToolUse the full
 * `tool_input` (a Write's file content, an Edit's old/new strings, a Bash
 * command), for PostToolUse the full `tool_response` (file contents, command
 * output). The office needs none of that: it draws a status line ("Running:
 * npm t…", "Editing foo.ts") and routes events by session. So the script
 * forwards an ALLOWLIST -- the fields `claude.ts normalizeHookEvent`,
 * `formatToolStatus` and the team provider actually read -- each one capped,
 * and drops everything else, unknown future fields included.
 *
 * Pure and dependency-free: bundled into dist/hooks/claude-hook.js and
 * unit-tested in server/__tests__/hardening.test.ts.
 */

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../../../constants.js';

/** Top-level string fields the server reads (event routing, lifecycle, teams). */
const TOP_LEVEL_STRINGS = [
  'hook_event_name',
  'session_id',
  'cwd',
  'transcript_path',
  'source',
  'reason',
  'tool_name',
  'notification_type',
  'agent_type',
  'agent_transcript_path',
  'teammate_name',
  'task_subject',
  'subject',
] as const;

/** Cap for any forwarded string that is not shortened further below. */
export const MAX_FORWARDED_STRING = 512;

/** `tool_input` string fields and how much of each the status line can show.
 *  One character past the display limit keeps formatToolStatus's ellipsis. */
const TOOL_INPUT_STRINGS: Record<string, number> = {
  command: BASH_COMMAND_DISPLAY_MAX_LENGTH + 1,
  description: TASK_DESCRIPTION_DISPLAY_MAX_LENGTH + 1,
  team_name: 128,
  recipient: 128,
  name: 128,
};

function capped(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

/** Last path segment, for either separator: the status line shows only that. */
function baseName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return capped(value.split(/[\\/]/).pop() ?? '', MAX_FORWARDED_STRING);
}

function filterToolInput(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const file = baseName(raw.file_path);
  if (file !== undefined) out.file_path = file;
  for (const [key, max] of Object.entries(TOOL_INPUT_STRINGS)) {
    const value = capped(raw[key], max);
    if (value !== undefined) out[key] = value;
  }
  if (typeof raw.run_in_background === 'boolean') out.run_in_background = raw.run_in_background;
  return out;
}

/** The forwarded subset of one hook payload. Never includes `tool_response`,
 *  prompt text, or any field not listed above. */
export function filterHookPayload(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TOP_LEVEL_STRINGS) {
    const value = capped(data[key], MAX_FORWARDED_STRING);
    if (value !== undefined) out[key] = value;
  }
  if (typeof data.run_in_background === 'boolean') out.run_in_background = data.run_in_background;
  const toolInput = filterToolInput(data.tool_input);
  if (toolInput !== undefined) out.tool_input = toolInput;
  return out;
}
