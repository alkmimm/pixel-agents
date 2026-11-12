/**
 * pixel-agents-secure (local): what the office can tell about a session from
 * its transcript's METADATA, beyond the tool labels it already shows.
 *
 * - permissionMode: the mode Claude Code records on each message. Used by the
 *   permission heuristic (timerManager.ts) and shown by the viewer.
 * - title: the session's name set with /rename (`custom-title` record).
 * - aiTitle: the title Claude Code generates (`ai-title`). It is written by the
 *   model from the prompt, so it is prompt-derived text: only a viewer with
 *   the conversation view on (H17) ever receives it (httpServer.ts).
 * - errorStreak: consecutive failed tool results (`is_error`), never their text.
 * - quotaUntil: the session hit its plan limit (`error: "rate_limit"`), and
 *   when the limit resets (`quotaLimits.resetsAt`).
 * - repeats: how many times in a row the same tool was called with the same
 *   input. The input is only hashed (sha256), never kept nor sent.
 * - model, effort: the model id and the reasoning effort Claude Code records
 *   on each reply of the session itself (not a sub-agent's). The office dresses
 *   the character by them (webview-ui/src/viewer/modelLevel.ts). A sub-agent's
 *   own, read from its own transcript, reach the office as `subagentSignals`.
 *
 * Nothing here reads tool results' content, prompts, or replies.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';

import type { AgentStateStore } from './agentStateStore.js';
import { maskAndClip } from './secretMask.js';
import type { AgentState } from './types.js';

export interface SessionSignals {
  permissionMode?: string;
  title?: string;
  aiTitle?: string;
  errorStreak: number;
  rateLimited: boolean;
  quotaUntil?: number;
  repeats: number;
  model?: string;
  effort?: string;
  lastCallKey?: string;
  /** JSON of the last broadcast view, to send only changes. */
  sent?: string;
  seeded?: boolean;
}

/** Modes in which a session does not stop to ask (so no timed "needs approval"). */
export const NO_PROMPT_MODES: ReadonlySet<string> = new Set([
  'auto',
  'bypassPermissions',
  'dontAsk',
]);
/** Tools that never ask under acceptEdits. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Write',
]);

export const TITLE_MAX_LENGTH = 80;
/** Failed tool results in a row before the office is told. */
export const ERROR_STREAK_THRESHOLD = 3;
/** Identical calls in a row before the office is told (a loop). */
export const REPEAT_THRESHOLD = 4;
const MODE_PATTERN = /^[A-Za-z]{1,32}$/;
/** A model id ("claude-opus-5-5", "claude-fable-5-2[1m]"); "<synthetic>" does not match. */
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
export const EFFORT_PATTERN = /^[a-z]{1,16}$/;

/**
 * The model and effort of a reply of the transcript's own agent. In a session's
 * transcript a sidechain record is a sub-agent's, not the session's; in a
 * sub-agent's own transcript (`ownSidechain`, subagentWatch.ts) every reply is
 * a sidechain record, and is its own.
 */
function observeModel(s: SessionSignals, r: Record<string, unknown>, ownSidechain: boolean): void {
  if (r.type !== 'assistant' || (r.isSidechain === true && !ownSidechain)) return;
  const model = (r.message as { model?: unknown } | undefined)?.model;
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) return;
  const effort = typeof r.perTurnEffort === 'string' ? r.perTurnEffort : r.effort;
  // A reply of the same model that names no effort keeps the one known: not
  // every record of a reply carries it.
  if (typeof effort === 'string' && EFFORT_PATTERN.test(effort)) s.effort = effort;
  else if (model !== s.model) s.effort = undefined;
  s.model = model;
}
/** How much of a transcript's end is read once, for an agent adopted mid-session. */
const SEED_TAIL_BYTES = 256 * 1024;

export function signalsOf(agent: AgentState): SessionSignals {
  agent.signals ??= { errorStreak: 0, rateLimited: false, repeats: 0 };
  return agent.signals;
}

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine ? maskAndClip(oneLine, TITLE_MAX_LENGTH) : undefined;
}

function callKey(name: unknown, input: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  let json: string;
  try {
    json = JSON.stringify(input ?? null) ?? '';
  } catch {
    return undefined;
  }
  return `${name}:${crypto.createHash('sha256').update(json).digest('hex')}`;
}

function blocks(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = record.message as { content?: unknown } | undefined;
  const content = message?.content;
  return Array.isArray(content)
    ? content.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
    : [];
}

/** Fold one transcript record into the agent's signals. */
export function observeRecord(agent: AgentState, record: unknown): void {
  if (typeof record !== 'object' || record === null) return;
  const r = record as Record<string, unknown>;
  const s = signalsOf(agent);

  if (typeof r.permissionMode === 'string' && MODE_PATTERN.test(r.permissionMode)) {
    s.permissionMode = r.permissionMode;
  }
  if (r.type === 'custom-title') s.title = cleanTitle(r.customTitle) ?? s.title;
  if (r.type === 'ai-title') s.aiTitle = cleanTitle(r.aiTitle) ?? s.aiTitle;
  observeModel(s, r, isSubagentTranscript(agent));

  if (r.type === 'assistant') {
    if (r.error === 'rate_limit') {
      s.rateLimited = true;
      const quota = r.quotaLimits as { resetsAt?: unknown } | undefined;
      const resetsAt = quota?.resetsAt;
      s.quotaUntil =
        typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? resetsAt * 1000 : undefined;
      return;
    }
    if (!r.isApiErrorMessage) {
      // A real reply: the session is past any limit it hit.
      s.rateLimited = false;
      s.quotaUntil = undefined;
    }
    for (const block of blocks(r)) {
      if (block.type !== 'tool_use') continue;
      const key = callKey(block.name, block.input);
      if (key === undefined) continue;
      s.repeats = key === s.lastCallKey ? s.repeats + 1 : 1;
      s.lastCallKey = key;
    }
    return;
  }

  if (r.type === 'user') {
    const content = (r.message as { content?: unknown } | undefined)?.content;
    const results = blocks(r).filter((b) => b.type === 'tool_result');
    if (results.length > 0) {
      for (const result of results) {
        s.errorStreak = result.is_error === true ? s.errorStreak + 1 : 0;
      }
      return;
    }
    // A prompt from the user (not a harness meta message) starts over.
    if (!r.isMeta && (typeof content === 'string' || blocks(r).some((b) => b.type === 'text'))) {
      s.errorStreak = 0;
      s.repeats = 0;
      s.lastCallKey = undefined;
    }
  }
}

/**
 * For an agent adopted or restored mid-session: the mode, titles, model and
 * effort from the end of its transcript, once. Streaks and repeats start from now.
 */
export function seedSignals(agent: AgentState): void {
  const s = signalsOf(agent);
  if (s.seeded || !agent.jsonlFile) return;
  s.seeded = true;
  let text: string;
  try {
    const fd = fs.openSync(agent.jsonlFile, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, SEED_TAIL_BYTES);
      const buf = Buffer.alloc(length);
      const read = fs.readSync(fd, buf, 0, length, size - length);
      text = buf.subarray(0, read).toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    // Only records that can carry what is seeded are parsed.
    if (
      !line.includes('permissionMode') &&
      !line.includes('-title"') &&
      !line.includes('"model"')
    ) {
      continue;
    }
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // the fragment the tail window cut
    }
    if (typeof record.permissionMode === 'string' && MODE_PATTERN.test(record.permissionMode)) {
      s.permissionMode = record.permissionMode;
    }
    if (record.type === 'custom-title') s.title = cleanTitle(record.customTitle) ?? s.title;
    if (record.type === 'ai-title') s.aiTitle = cleanTitle(record.aiTitle) ?? s.aiTitle;
    observeModel(s, record, isSubagentTranscript(agent));
  }
}

/** Whether this agent is the watch of a sub-agent's own transcript (subagentWatch.ts). */
function isSubagentTranscript(agent: AgentState): boolean {
  return agent.spawnToolUseId !== undefined && agent.leadAgentId !== undefined;
}

/**
 * What the office receives about a sub-agent: only the model it runs on and its
 * effort, keyed like every other subagent* message (lead id, spawn tool id).
 * Nothing else of a sub-agent's signals leaves its watch. Undefined until its
 * transcript names a model.
 */
export function subagentSignalsMessage(
  agent: AgentState,
  leadId: number,
  parentToolId: string,
): Record<string, unknown> | undefined {
  const s = agent.signals;
  if (!s?.model) return undefined;
  return { type: 'subagentSignals', id: leadId, parentToolId, model: s.model, effort: s.effort };
}

/** The message the office receives about an agent's signals. */
export function signalsMessage(agent: AgentState): Record<string, unknown> {
  const s = signalsOf(agent);
  return {
    type: 'agentSignals',
    id: agent.id,
    permissionMode: s.permissionMode,
    title: s.title,
    aiTitle: s.aiTitle,
    // Below the thresholds there is nothing to show: 0, and no message.
    errorStreak: s.errorStreak >= ERROR_STREAK_THRESHOLD ? s.errorStreak : 0,
    rateLimited: s.rateLimited,
    quotaUntil: s.quotaUntil,
    repeats: s.repeats >= REPEAT_THRESHOLD ? s.repeats : 0,
    model: s.model,
    effort: s.effort,
  };
}

/** Whether the agent has anything to signal (a client needs no message otherwise). */
function isEmptyView(message: Record<string, unknown>): boolean {
  return (
    message.permissionMode === undefined &&
    message.title === undefined &&
    message.aiTitle === undefined &&
    message.errorStreak === 0 &&
    message.rateLimited === false &&
    message.quotaUntil === undefined &&
    message.repeats === 0 &&
    message.model === undefined
  );
}

/** Broadcast the agent's signals if they changed since the last broadcast. */
export function broadcastSignalsIfChanged(agent: AgentState, agents: AgentStateStore): void {
  const message = signalsMessage(agent);
  const json = JSON.stringify(message);
  const s = signalsOf(agent);
  if (json === s.sent) return;
  if (s.sent === undefined && isEmptyView(message)) return; // nothing yet
  s.sent = json;
  agents.broadcast(message);
}

/** The tools the permission heuristic must not flag in this session, or null
 *  when the session does not ask at all (no timed "needs approval"). */
export function permissionExemptFor(
  agent: AgentState | undefined,
  base: ReadonlySet<string>,
): ReadonlySet<string> | null {
  const mode = agent?.signals?.permissionMode;
  if (mode && NO_PROMPT_MODES.has(mode)) return null;
  if (mode === 'acceptEdits') return new Set([...base, ...EDIT_TOOLS]);
  return base;
}

/**
 * What a client may receive of an agentSignals message: the model-made title
 * only with the viewer's conversation view on (H17). Other messages pass.
 */
export function filterSignalsForClient(
  message: Record<string, unknown>,
  conversation: boolean,
): Record<string, unknown> {
  if (message.type !== 'agentSignals' || conversation) return message;
  const rest = { ...message };
  delete rest.aiTitle;
  return rest;
}
