/**
 * pixel-agents-secure (H18): Codex sessions in the office, read-only.
 *
 * Codex (the CLI and the desktop app) keeps one file per session,
 * `<home>/.codex/sessions/YYYY/MM/DD/rollout-<date>-<uuid>.jsonl`, appended to
 * as the session goes. This module follows those files and tells the runtime
 * what it sees as the same Claude-shaped hook events another agent's hook
 * would post (hooks/foreignPayload.ts), through the same H4 filter. Nothing is
 * installed in Codex and nothing is ever written under a root.
 *
 * What it may read is narrow on purpose:
 * - only `rollout-*.jsonl` files under a root that ends in `.codex/sessions`
 *   (auth.json, config.toml, the databases and history.jsonl are never opened);
 * - never a whole file: the first line (the session's header) up to
 *   HEADER_MAX_BYTES, the last TAIL_BYTES once, then only what is appended;
 * - of each record, only the fields named in `headerOf` and `eventsOfRecord`.
 *   A session's instructions, its messages, the model's reasoning, tool output
 *   and the last answer of a turn are in these files and are never touched; a
 *   record type not listed there is dropped whole.
 *
 * Off unless the viewer's service names the roots (viewer.ts,
 * PIXEL_AGENTS_CODEX_SESSION_ROOTS). The VS Code extension never starts it.
 *
 * Sessions a person started (`thread_source: user`) come in as agents. The
 * reviewer sessions Codex opens by itself (`guardian_review`, each naming its
 * parent) are followed too, and reported apart (`onReviewer`): the office shows
 * one as a helper of its parent while it has a turn under way. A session's
 * model and effort (its `turn_context` records) are reported apart as well
 * (`onSignals`), for the class the office dresses it in. Neither is a hook event.
 */
import * as fs from 'fs';
import * as path from 'path';

import { kindSessionId } from './providers/hook/claude/hooks/agentKinds.js';
import { EFFORT_PATTERN, MODEL_PATTERN } from './sessionSignals.js';

/** How many roots are honoured. */
const MAX_ROOTS = 4;
/** The header line is about 20 KB (it carries the session's instructions). */
export const HEADER_MAX_BYTES = 64 * 1024;
/** How much of a session's end is read once, to see whether a turn is under way. */
export const TAIL_BYTES = 256 * 1024;
/** The most read of what was appended since the last look; a burst beyond it is skipped. */
export const APPEND_MAX_BYTES = 1024 * 1024;
/** A line longer than this (an image, a long output) is dropped unparsed. */
const LINE_MAX_BYTES = 512 * 1024;
/** A session not written to for this long is not in use. */
export const ACTIVE_WINDOW_MS = 10 * 60_000;
/** One with a turn under way is given longer: a command can run for a while. */
export const TURN_WINDOW_MS = 60 * 60_000;
/** A reviewer whose turn was seen stays shown this long, however short the turn. */
export const REVIEW_LINGER_MS = 8_000;
const SCAN_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;
/** In `passedOver`: a file that growing will not make ours. */
const NEVER = -1;
const ROLLOUT_NAME = /^rollout-[0-9A-Za-z_.:-]{1,120}\.jsonl$/;
const ID_PATTERN = /^[0-9A-Za-z-]{8,64}$/;

/**
 * The session roots named by PIXEL_AGENTS_CODEX_SESSION_ROOTS (path-delimiter
 * separated). A root is honoured only when it is an absolute path that ends in
 * `.codex/sessions`: the variable can add Codex session folders and nothing else.
 */
export function codexSessionRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  for (const raw of (env['PIXEL_AGENTS_CODEX_SESSION_ROOTS'] ?? '').split(path.delimiter)) {
    const root = path.normalize(raw.trim());
    if (!raw.trim() || !path.isAbsolute(root)) continue;
    if (path.basename(root) !== 'sessions' || path.basename(path.dirname(root)) !== '.codex') {
      continue;
    }
    if (roots.includes(root)) continue;
    roots.push(root);
    if (roots.length === MAX_ROOTS) break;
  }
  return roots;
}

/** What is kept of a session's header. */
export interface CodexHeader {
  id: string;
  cwd: string;
  /** Who started it: 'user', or Codex itself ('guardian_review', ...). */
  threadSource: string;
  /** The session a reviewer works for (a session Codex opened by itself names its parent). */
  parentId?: string;
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;

function parseLine(line: string): Record<string, unknown> | undefined {
  if (line.length === 0 || line.length > LINE_MAX_BYTES) return undefined;
  try {
    const record: unknown = JSON.parse(line);
    return typeof record === 'object' && record !== null && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined; // a line cut by a read window, or not JSON
  }
}

const payloadOf = (record: Record<string, unknown>): Record<string, unknown> =>
  typeof record.payload === 'object' && record.payload !== null
    ? (record.payload as Record<string, unknown>)
    : {};

/** The header of a session, from its first line: id, folder and who started it. */
export function headerOf(firstLine: string): CodexHeader | undefined {
  const record = parseLine(firstLine);
  if (!record || record.type !== 'session_meta') return undefined;
  const payload = payloadOf(record);
  const id = text(payload.id, 64);
  const cwd = text(payload.cwd, 512);
  if (!id || !ID_PATTERN.test(id) || !cwd) return undefined;
  const parent = text(payload.parent_thread_id, 64);
  return {
    id,
    cwd,
    threadSource: text(payload.thread_source, 32) ?? 'unknown',
    parentId: parent && ID_PATTERN.test(parent) ? parent : undefined,
  };
}

/** What a session is in the middle of, as far as its records say. */
export interface CodexTurn {
  /** A turn was started and has not completed. */
  open: boolean;
  /** Tool calls made and not yet answered. */
  calls: number;
  /** The ids of quiet calls not yet answered: their answers end no shown tool. */
  quiet?: Set<string>;
  /** The model and effort of its last turn (well-formed ids only, as sessionSignals.ts). */
  model?: string;
  effort?: string;
}
/** How many quiet calls are remembered at once. */
const MAX_QUIET_CALLS = 64;

/** Tools that are the agent waiting, not working: no activity is shown for them. */
const QUIET_TOOLS: ReadonlySet<string> = new Set(['sleep', 'wait', 'request_user_input_async']);

/** A hook-shaped event, before the H4 filter (which every one goes through). */
export type CodexEvent = Record<string, unknown>;

/**
 * The events one record stands for, and its effect on the turn. This is the
 * allowlist: of a record only its type, a tool's name, a call's id (to pair
 * a call with its answer; never sent), for `exec` the command (which the
 * H4 filter then cuts down to program and verb) and, of a turn's context, its
 * model and effort are read.
 */
export function eventsOfRecord(record: Record<string, unknown>, turn: CodexTurn): CodexEvent[] {
  const payload = payloadOf(record);
  if (record.type === 'turn_context') {
    const model = text(payload.model, 64);
    if (model && MODEL_PATTERN.test(model)) {
      const effort = text(payload.effort, 16);
      turn.model = model;
      turn.effort = effort && EFFORT_PATTERN.test(effort) ? effort : undefined;
    }
    return [];
  }
  if (record.type === 'event_msg') {
    if (payload.type === 'task_started') {
      turn.open = true;
      turn.calls = 0;
      turn.quiet = undefined;
      return [];
    }
    if (payload.type === 'task_complete') {
      turn.open = false;
      turn.calls = 0;
      turn.quiet = undefined;
      return [{ hook_event_name: 'Stop' }];
    }
    return [];
  }
  if (record.type !== 'response_item') return [];
  if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
    const name = text(payload.name, 64);
    if (!name) return [];
    if (QUIET_TOOLS.has(name)) {
      const id = text(payload.call_id, 128);
      if (id && (turn.quiet?.size ?? 0) < MAX_QUIET_CALLS) (turn.quiet ??= new Set()).add(id);
      return [];
    }
    turn.open = true;
    turn.calls++;
    // Codex runs commands through `exec`: shown as a shell command is.
    if (name === 'exec' && typeof payload.input === 'string') {
      return [
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: payload.input.slice(0, 2048) },
        },
      ];
    }
    return [{ hook_event_name: 'PreToolUse', tool_name: name, tool_input: {} }];
  }
  if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
    const id = text(payload.call_id, 128);
    if (id && turn.quiet?.delete(id)) return []; // the answer to a quiet tool
    if (turn.calls === 0) return []; // to a quiet tool, or to a call not seen
    turn.calls--;
    return [{ hook_event_name: 'PostToolUse' }];
  }
  return [];
}

interface Tracked {
  header: CodexHeader;
  offset: number;
  /** A line begun and not yet ended by what was read. */
  partial: string;
  turn: CodexTurn;
  lastGrowth: number;
  /** A session Codex opened to review its parent's approvals: a helper, not an agent. */
  reviewer: boolean;
  /** What was last reported of it (onSignals, onReviewer), to report only changes. */
  reported?: string;
  /** A reviewer is shown until then, at least: its turns can be shorter than a pass. */
  lingerUntil?: number;
}

/** A reviewer's state: whose helper it is, and whether it has a turn under way. */
export interface CodexReview {
  /** The parent's session id, as its hook events carry it. */
  parent: string;
  /** The reviewer's own id (well-formed: ID_PATTERN). */
  reviewer: string;
  active: boolean;
  model?: string;
  effort?: string;
}

export interface CodexSessionsOptions {
  now?: () => number;
  log?: (message: string) => void;
  /** A session's model and effort. False when the office has no such agent (yet): told again. */
  onSignals?: (sessionId: string, model: string, effort: string | undefined) => boolean;
  /** A reviewer's turn began or ended. False when its parent is not in the office: told again. */
  onReviewer?: (review: CodexReview) => boolean;
}

export class CodexSessions {
  private readonly tracked = new Map<string, Tracked>();
  /** Files looked at and not followed (not a user's session, or unreadable), by size seen. */
  private readonly passedOver = new Map<string, number>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly onSignals: NonNullable<CodexSessionsOptions['onSignals']>;
  private readonly onReviewer: NonNullable<CodexSessionsOptions['onReviewer']>;

  /**
   * @param roots From codexSessionRoots: nothing outside them is opened.
   * @param emit Receives each event; the caller filters it (H4) and routes it.
   */
  constructor(
    private readonly roots: readonly string[],
    private readonly emit: (event: CodexEvent) => void,
    options: CodexSessionsOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => {});
    this.onSignals = options.onSignals ?? (() => true);
    this.onReviewer = options.onReviewer ?? (() => true);
  }

  /** A person's session, or a reviewer that names the session it works for. */
  private static followed(header: CodexHeader | undefined): header is CodexHeader {
    return (
      header?.threadSource === 'user' ||
      (header?.threadSource === 'guardian_review' && header.parentId !== undefined)
    );
  }

  /** Tell what changed of a session's model and effort, or of a reviewer's turn. */
  private report(tracked: Tracked): void {
    const { turn, header } = tracked;
    if (tracked.reviewer) {
      if (turn.open) tracked.lingerUntil = this.now() + REVIEW_LINGER_MS;
      const active = turn.open || this.now() < (tracked.lingerUntil ?? 0);
      const state = active ? JSON.stringify([turn.model, turn.effort]) : '';
      if (state === (tracked.reported ?? '')) return;
      const shown = this.onReviewer({
        parent: kindSessionId('codex', header.parentId ?? ''),
        reviewer: header.id,
        active,
        model: turn.model,
        effort: turn.effort,
      });
      if (shown || !active) tracked.reported = state;
    } else if (turn.model) {
      const state = JSON.stringify([turn.model, turn.effort]);
      if (state === tracked.reported) return;
      if (this.onSignals(kindSessionId('codex', header.id), turn.model, turn.effort)) {
        tracked.reported = state;
      }
    }
  }

  start(): void {
    if (this.roots.length === 0 || this.scanTimer) return;
    this.scanTimer = setInterval(() => void this.tick(true), SCAN_INTERVAL_MS);
    this.pollTimer = setInterval(() => void this.tick(false), POLL_INTERVAL_MS);
    void this.tick(true);
  }

  /** Stop following, and tell the runtime every followed session is gone. */
  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.scanTimer = null;
    this.pollTimer = null;
    for (const file of [...this.tracked.keys()]) this.end(file);
  }

  /** How many sessions are followed now. */
  get size(): number {
    return this.tracked.size;
  }

  /** One pass: new sessions when `discover`, then what the followed ones appended. */
  async tick(discover: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (discover) await this.discover();
      for (const file of [...this.tracked.keys()]) await this.follow(file);
    } catch (err) {
      this.log(`Codex sessions: pass failed: ${String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Every rollout file under a root: `<root>/YYYY/MM/DD/rollout-*.jsonl`, real files only. */
  private async rolloutFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const dirs = async (dir: string, pattern: RegExp): Promise<string[]> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory() && pattern.test(e.name))
          .map((e) => path.join(dir, e.name));
      } catch {
        return [];
      }
    };
    for (const year of await dirs(root, /^\d{4}$/)) {
      for (const month of await dirs(year, /^\d{2}$/)) {
        for (const day of await dirs(month, /^\d{2}$/)) {
          try {
            for (const entry of await fs.promises.readdir(day, { withFileTypes: true })) {
              // A regular file by its own entry: a link could point anywhere.
              if (entry.isFile() && ROLLOUT_NAME.test(entry.name)) {
                files.push(path.join(day, entry.name));
              }
            }
          } catch {
            // unreadable day: nothing there for us
          }
        }
      }
    }
    return files;
  }

  private async discover(): Promise<void> {
    const now = this.now();
    for (const root of this.roots) {
      for (const file of await this.rolloutFiles(root)) {
        if (this.tracked.has(file)) continue;
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(file);
        } catch {
          continue;
        }
        if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue;
        // Looked at before and not grown since (or never to be ours): still not ours.
        const seen = this.passedOver.get(file);
        if (seen === stat.size || seen === NEVER) continue;
        // Idle since it was last written to, not since it was found.
        await this.adopt(file, stat.size, Math.min(now, stat.mtimeMs));
      }
    }
  }

  /** Read at most `length` bytes of `file` from `position`. */
  private async readAt(file: string, position: number, length: number): Promise<string> {
    const handle = await fs.promises.open(file, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await handle.close();
    }
  }

  private async adopt(file: string, size: number, now: number): Promise<void> {
    let header: CodexHeader | undefined;
    let tail = '';
    try {
      const head = await this.readAt(file, 0, Math.min(size, HEADER_MAX_BYTES));
      const end = head.indexOf('\n');
      if (end < 0 && size >= HEADER_MAX_BYTES) {
        // A header longer than is read: more of the file will not shorten it.
        this.passedOver.set(file, NEVER);
        this.log(`Codex sessions: ${path.basename(file)} left out: its header is too long`);
        return;
      }
      header = end > 0 ? headerOf(head.slice(0, end)) : undefined;
      if (CodexSessions.followed(header)) {
        const from = Math.max(0, size - TAIL_BYTES);
        tail = await this.readAt(file, from, size - from);
        // The window opens mid-line (or on the header): start at the next line.
        tail = tail.slice(tail.indexOf('\n') + 1);
      }
    } catch {
      header = undefined;
    }
    if (!CodexSessions.followed(header)) {
      this.passedOver.set(file, size);
      return;
    }
    this.passedOver.delete(file);

    // Where the session stands, from its last records: nothing of the past is
    // replayed, only whether a turn is under way.
    const turn: CodexTurn = { open: false, calls: 0 };
    let lastTool: CodexEvent | undefined;
    for (const line of tail.split('\n')) {
      const record = parseLine(line);
      if (!record) continue;
      for (const event of eventsOfRecord(record, turn)) {
        if (event.hook_event_name === 'PreToolUse') lastTool = event;
      }
    }
    const reviewer = header.threadSource !== 'user';
    const tracked: Tracked = { header, offset: size, partial: '', turn, lastGrowth: now, reviewer };
    this.tracked.set(file, tracked);
    this.log(`Codex sessions: following ${path.basename(file)}${reviewer ? ' (a reviewer)' : ''}`);
    if (reviewer) {
      this.report(tracked);
      return;
    }
    // Any event brings the session into the office; these say how it stands.
    if (turn.open && turn.calls > 0 && lastTool) this.send(tracked, lastTool);
    else if (!turn.open) this.send(tracked, { hook_event_name: 'Stop' });
    else this.send(tracked, { hook_event_name: 'PostToolUse' });
    this.report(tracked);
  }

  private async follow(file: string): Promise<void> {
    const tracked = this.tracked.get(file);
    if (!tracked) return;
    this.report(tracked); // again, what the office could not take before
    const now = this.now();
    let size: number;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {
      this.end(file); // gone
      return;
    }
    if (size < tracked.offset) {
      // Rewritten shorter: not the file we were reading. Start over when it is active again.
      this.end(file);
      return;
    }
    if (size === tracked.offset) {
      const idle = now - tracked.lastGrowth;
      if (idle > (tracked.turn.open ? TURN_WINDOW_MS : ACTIVE_WINDOW_MS)) this.end(file);
      return;
    }
    tracked.lastGrowth = now;
    let from = tracked.offset;
    if (size - from > APPEND_MAX_BYTES) {
      // Too much at once: only its end is read, and the line it cuts is dropped.
      from = size - APPEND_MAX_BYTES;
      tracked.partial = '';
    }
    let chunk: string;
    try {
      chunk = await this.readAt(file, from, size - from);
    } catch {
      return; // try again at the next pass
    }
    const skipped = from !== tracked.offset;
    tracked.offset = size;
    // What was skipped may have ended the turn: it stands as what is read now says.
    if (skipped) {
      tracked.turn = { open: false, calls: 0, model: tracked.turn.model, effort: tracked.turn.effort };
    }
    let stopped = false;
    const lines = (tracked.partial + chunk).split('\n');
    tracked.partial = lines.pop() ?? '';
    if (tracked.partial.length > LINE_MAX_BYTES) tracked.partial = '';
    if (skipped) lines.shift();
    for (const line of lines) {
      const record = parseLine(line);
      if (!record) continue;
      for (const event of eventsOfRecord(record, tracked.turn)) {
        stopped = event.hook_event_name === 'Stop';
        this.send(tracked, event);
      }
      // A turn begun and ended within this pass was a turn all the same.
      if (tracked.reviewer && tracked.turn.open) tracked.lingerUntil = now + REVIEW_LINGER_MS;
    }
    if (skipped && !tracked.turn.open && !stopped) this.send(tracked, { hook_event_name: 'Stop' });
    this.report(tracked);
  }

  private end(file: string): void {
    const tracked = this.tracked.get(file);
    if (!tracked) return;
    this.tracked.delete(file);
    if (tracked.reviewer) {
      // Gone with a turn shown: its helper leaves.
      tracked.turn.open = false;
      tracked.lingerUntil = 0;
      this.report(tracked);
      return;
    }
    this.send(tracked, { hook_event_name: 'SessionEnd', reason: 'exit' });
  }

  private send(tracked: Tracked, event: CodexEvent): void {
    if (tracked.reviewer) return; // a reviewer is no agent: it posts no event
    this.emit({
      ...event,
      agent_kind: 'codex',
      session_id: kindSessionId('codex', tracked.header.id),
      cwd: tracked.header.cwd,
    });
  }
}
