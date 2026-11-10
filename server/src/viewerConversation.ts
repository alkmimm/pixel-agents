/**
 * pixel-agents-secure (H17): an agent's conversation, as text, for the office
 * viewer's details panel ("Conversa"). OFF unless the viewer service was
 * started with PIXEL_AGENTS_VIEWER_CONVERSATION=1 (scripts/office.sh
 * conversa on), and never offered by the VS Code extension.
 *
 * What leaves the server, and nothing else:
 * - the user's own prompts and the assistant's text replies, with every
 *   harness block (<system-reminder>, <ide_selection>, <bash-stdout>, ...)
 *   taken out, mixed with text or not;
 * - for each tool call, the same short label the office already shows
 *   (formatToolStatus: file name, a cut Bash command, a subtask title).
 * Never sent: tool inputs and outputs (file contents, command output), the
 * model's thinking, harness/meta records, subagent side chains.
 *
 * Bounded: only the transcript's last CONVERSATION_TAIL_BYTES are read, at
 * most CONVERSATION_MAX_ENTRIES entries of at most CONVERSATION_MAX_TEXT
 * characters each, and every pass over the text is linear (a crafted prompt
 * cannot stall the event loop). One read per file at a time, at most one per
 * CONVERSATION_MIN_REREAD_MS. The file is the agent's own transcript as the
 * server tracks it, and only under a Claude transcript root: a client names
 * an agent id, never a path.
 *
 * Secrets that look like secrets are masked (secretMask.ts), best effort: a
 * prompt with a pasted password in plain words is shown as written.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AgentStateStore } from './agentStateStore.js';
import { claudeProvider, formatToolStatus } from './providers/hook/claude/claude.js';
import { maskAndClip } from './secretMask.js';

export const CONVERSATION_TAIL_BYTES = 1024 * 1024;
export const CONVERSATION_MAX_ENTRIES = 150;
export const CONVERSATION_MAX_TEXT = 4000;
export const CONVERSATION_MIN_REREAD_MS = 1_000;
const CACHE_SIZE = 16;
const MAX_VERSION_LENGTH = 64;

export interface ConversationEntry {
  /** ms since epoch, from the record's timestamp when it has one. */
  t?: number;
  role: 'user' | 'assistant' | 'tool';
  text: string;
}

export interface ConversationTail {
  entries: ConversationEntry[];
  /** Older messages exist that are not included. */
  truncated: boolean;
}

// ── Harness blocks ─────────────────────────────────────────────

/** One tag, open or close. The name allows `_` (<ide_selection>) and the
 *  attributes are bounded, so a scan of the whole text stays linear. */
const TAG = /<(\/?)([a-z][a-z0-9_-]{0,63})(?:\s[^<>]{0,256})?>/g;

/** Tags whose blocks vanish without a trace; any other block leaves a marker. */
const SILENT_TAGS = new Set(['system-reminder']);

interface TagRange {
  name: string;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}

/** The outermost `<name ...>...</name>` blocks of a text, in one pass: each
 *  closing tag pairs with the latest unpaired opening tag of the same name. */
export function harnessBlocks(text: string): TagRange[] {
  const open = new Map<string, Array<{ start: number; innerStart: number }>>();
  const found: TagRange[] = [];
  for (const m of text.matchAll(TAG)) {
    const [whole, slash, name] = m;
    const at = m.index ?? 0;
    if (!slash) {
      const stack = open.get(name) ?? [];
      stack.push({ start: at, innerStart: at + whole.length });
      open.set(name, stack);
      continue;
    }
    const opening = open.get(name)?.pop();
    if (opening) {
      found.push({ name, ...opening, end: at + whole.length, innerEnd: at });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const outer: TagRange[] = [];
  for (const range of found) {
    const last = outer[outer.length - 1];
    if (!last || range.start >= last.end) outer.push(range);
  }
  return outer;
}

/** A user message with every harness block taken out. `null` when nothing the
 *  user wrote is left (a slash command shows as typed: "/model opus"). */
export function withoutHarness(text: string): string | null {
  const ranges = harnessBlocks(text);
  if (ranges.length === 0) return text.trim() || null;
  let shown = '';
  let written = '';
  let cursor = 0;
  let command: string | undefined;
  let args = '';
  for (const range of ranges) {
    shown += text.slice(cursor, range.start);
    written += text.slice(cursor, range.start);
    if (!SILENT_TAGS.has(range.name)) shown += `[${range.name} omitido]`;
    if (range.name === 'command-name') command = text.slice(range.innerStart, range.innerEnd).trim();
    if (range.name === 'command-args') args = text.slice(range.innerStart, range.innerEnd).trim();
    cursor = range.end;
  }
  shown += text.slice(cursor);
  written += text.slice(cursor);
  if (!written.trim()) return command ? `${command} ${args}`.trim() : null;
  return shown.trim();
}

// ── Records → entries ──────────────────────────────────────────

function clip(text: string): string {
  return maskAndClip(text.trim(), CONVERSATION_MAX_TEXT);
}

function timeOf(record: Record<string, unknown>): number | undefined {
  const t = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

function userText(content: unknown): string | null {
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (!block || typeof block !== 'object') continue;
      // A tool's result rides a user record: never shown.
      if (block.type === 'tool_result') return null;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else if (block.type === 'image') parts.push('[imagem]');
    }
    text = parts.join('\n');
  } else {
    return null;
  }
  const shown = withoutHarness(text);
  if (!shown || shown.startsWith('Caveat:')) return null;
  return shown;
}

/** The conversation entries one transcript record contributes. */
export function entriesFromRecord(record: Record<string, unknown>): ConversationEntry[] {
  if (record.isSidechain === true || record.isMeta === true) return [];
  if (record.isCompactSummary === true || record.toolUseResult !== undefined) return [];
  const message = record.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') return [];
  const t = timeOf(record);
  const at = t === undefined ? {} : { t };

  if (record.type === 'user') {
    const text = userText(message.content);
    return text ? [{ ...at, role: 'user', text: clip(text) }] : [];
  }
  if (record.type === 'assistant' && Array.isArray(message.content)) {
    const out: ConversationEntry[] = [];
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        out.push({ ...at, role: 'assistant', text: clip(block.text) });
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        const input =
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {};
        out.push({ ...at, role: 'tool', text: clip(formatToolStatus(block.name, input)) });
      }
      // thinking, redacted_thinking and anything else: never shown.
    }
    return out;
  }
  return [];
}

/** Entries from the text of a transcript's tail. The first line is dropped
 *  when the tail starts mid-file (it is a fragment). */
export function conversationFromText(text: string, startsMidFile: boolean): ConversationTail {
  const lines = text.split('\n');
  if (startsMidFile) lines.shift();
  const entries: ConversationEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record && typeof record === 'object') {
      entries.push(...entriesFromRecord(record as Record<string, unknown>));
    }
  }
  const truncated = startsMidFile || entries.length > CONVERSATION_MAX_ENTRIES;
  return {
    entries: entries.slice(-CONVERSATION_MAX_ENTRIES),
    truncated,
  };
}

// ── File reading (async, shared, cached by size + mtime) ───────

export interface VersionedTail extends ConversationTail {
  /** Size and mtime of the file the entries were read from. */
  version: string;
}

const cache = new Map<string, { version: string; at: number; tail: VersionedTail }>();
const inFlight = new Map<string, Promise<VersionedTail>>();

async function readFresh(file: string, now: number): Promise<VersionedTail> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const stat = await handle.stat();
    const version = `${stat.size}:${stat.mtimeMs}`;
    const cached = cache.get(file);
    if (cached && cached.version === version) {
      cached.at = now;
      return cached.tail;
    }
    const start = Math.max(0, stat.size - CONVERSATION_TAIL_BYTES);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const tail: VersionedTail = {
      ...conversationFromText(buffer.subarray(0, bytesRead).toString('utf8'), start > 0),
      version,
    };
    cache.delete(file);
    cache.set(file, { version, at: now, tail });
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return tail;
  } finally {
    await handle.close();
  }
}

/** The tail of a transcript. Requests for the same file share one read, and a
 *  file read less than CONVERSATION_MIN_REREAD_MS ago is answered from memory:
 *  however often a client asks, a file is parsed at most once a second. */
export function readConversationTail(file: string, now = Date.now()): Promise<VersionedTail> {
  const pending = inFlight.get(file);
  if (pending) return pending;
  const cached = cache.get(file);
  if (cached && now - cached.at < CONVERSATION_MIN_REREAD_MS) return Promise.resolve(cached.tail);
  const read = readFresh(file, now).finally(() => inFlight.delete(file));
  inFlight.set(file, read);
  return read;
}

/** Whether `file` is a .jsonl under one of the Claude transcript roots, with
 *  links resolved. A transcript path adopted from elsewhere is not read. */
export async function isUnderTranscriptRoot(file: string, roots: readonly string[]): Promise<boolean> {
  if (path.extname(file) !== '.jsonl') return false;
  let real: string;
  try {
    real = await fs.promises.realpath(file);
  } catch {
    return false;
  }
  for (const root of roots) {
    try {
      const realRoot = await fs.promises.realpath(root);
      if (real.startsWith(realRoot + path.sep)) return true;
    } catch {
      // A root that does not exist holds nothing.
    }
  }
  return false;
}

function transcriptRoots(): string[] {
  return claudeProvider.getAllSessionRoots?.() ?? [];
}

/**
 * Answer a client's `requestAgentConversation`. The only message a read-only
 * client may send besides webviewReady, and only while `enabled`. A client
 * that names the version it already has gets `unchanged: true` instead of
 * the same entries again.
 */
export async function answerConversationRequest(
  msg: Record<string, unknown>,
  send: (message: Record<string, unknown>) => void,
  store: AgentStateStore,
  enabled: boolean,
  roots: () => readonly string[] = transcriptRoots,
): Promise<void> {
  const id = msg.id;
  if (typeof id !== 'number' || !Number.isInteger(id)) return;
  if (!enabled) {
    send({ type: 'agentConversation', id, enabled: false, entries: [], truncated: false });
    return;
  }
  const file = store.get(id)?.jsonlFile;
  if (!file) {
    send({ type: 'agentConversation', id, enabled: true, entries: [], truncated: false });
    return;
  }
  const unreadable = {
    type: 'agentConversation',
    id,
    enabled: true,
    entries: [],
    truncated: false,
    unreadable: true,
  };
  try {
    if (!(await isUnderTranscriptRoot(file, roots()))) {
      send(unreadable);
      return;
    }
    const tail = await readConversationTail(file);
    const known =
      typeof msg.version === 'string' && msg.version.length <= MAX_VERSION_LENGTH ? msg.version : null;
    if (known === tail.version) {
      send({ type: 'agentConversation', id, enabled: true, unchanged: true, version: tail.version });
      return;
    }
    send({ type: 'agentConversation', id, enabled: true, ...tail });
  } catch {
    send(unreadable);
  }
}
