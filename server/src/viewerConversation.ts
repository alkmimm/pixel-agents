/**
 * pixel-agents-secure (H17): an agent's conversation, as text, for the office
 * viewer's details panel ("Conversa"). OFF unless the viewer service was
 * started with PIXEL_AGENTS_VIEWER_CONVERSATION=1 (scripts/office.sh
 * conversa on), and never offered by the VS Code extension.
 *
 * What leaves the server, and nothing else:
 * - the user's own prompts and the assistant's text replies;
 * - for each tool call, the same short label the office already shows
 *   (formatToolStatus: file basename, a cut Bash command, a subtask title).
 * Never sent: tool inputs and outputs (file contents, command output), the
 * model's thinking, harness/meta records, subagent side chains.
 *
 * Bounded: only the transcript's last CONVERSATION_TAIL_BYTES are read, at
 * most CONVERSATION_MAX_ENTRIES entries of at most CONVERSATION_MAX_TEXT
 * characters each. The file is the agent's own transcript as the server
 * tracks it: a client names an agent id, never a path.
 *
 * Secrets that look like secrets are masked (redactSecrets), best effort: a
 * prompt with a pasted password in plain words is shown as written.
 */
import * as fs from 'node:fs';

import type { AgentStateStore } from './agentStateStore.js';
import { formatToolStatus } from './providers/hook/claude/claude.js';

export const CONVERSATION_TAIL_BYTES = 1024 * 1024;
export const CONVERSATION_MAX_ENTRIES = 150;
export const CONVERSATION_MAX_TEXT = 4000;
const CACHE_SIZE = 16;

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

// ── Redaction ──────────────────────────────────────────────────

const REDACTED = '<redacted>';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    REDACTED,
  ],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Authorization values (the lookahead wants a digit, so prose is left alone)
  [/\b(Bearer|Basic)\s+(?=[A-Za-z._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${REDACTED}`],
  // user:password@ in a URL
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi, `$1:${REDACTED}@`],
  // name=value / name: value where the name says it is a secret
  [
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["']?)[^\s"',;]{4,}/gi,
    `$1$2$3${REDACTED}`,
  ],
];

/** Mask what looks like a credential. Best effort, by pattern. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

// ── Records → entries ──────────────────────────────────────────

/** Harness tags (<command-name>, <system-reminder>, <local-command-stdout>,
 *  <task-notification>...). A message made only of them is not something the
 *  user wrote. */
const TAG_BLOCK = /<([a-z][a-z0-9-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

function clip(text: string): string {
  const masked = redactSecrets(text.trim());
  return masked.length > CONVERSATION_MAX_TEXT
    ? masked.slice(0, CONVERSATION_MAX_TEXT) + '…'
    : masked;
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
  text = text.replace(SYSTEM_REMINDER, '').trim();
  if (!text || text.startsWith('Caveat:')) return null;
  if (text.replace(TAG_BLOCK, '').trim() === '') {
    // Only harness tags: a slash command shows as typed, anything else not at all.
    const name = COMMAND_NAME.exec(text)?.[1]?.trim();
    if (!name) return null;
    return `${name} ${COMMAND_ARGS.exec(text)?.[1]?.trim() ?? ''}`.trim();
  }
  return text;
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

// ── File reading (async, cached by size + mtime) ───────────────

const cache = new Map<string, { size: number; mtimeMs: number; tail: ConversationTail }>();

export async function readConversationTail(file: string): Promise<ConversationTail> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const stat = await handle.stat();
    const cached = cache.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.tail;
    }
    const start = Math.max(0, stat.size - CONVERSATION_TAIL_BYTES);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const tail = conversationFromText(buffer.subarray(0, bytesRead).toString('utf8'), start > 0);
    cache.delete(file);
    cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, tail });
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    return tail;
  } finally {
    await handle.close();
  }
}

/**
 * Answer a client's `requestAgentConversation`. The only message a read-only
 * client may send besides webviewReady, and only while `enabled`.
 */
export async function answerConversationRequest(
  msg: Record<string, unknown>,
  send: (message: Record<string, unknown>) => void,
  store: AgentStateStore,
  enabled: boolean,
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
  try {
    const tail = await readConversationTail(file);
    send({ type: 'agentConversation', id, enabled: true, ...tail });
  } catch {
    send({
      type: 'agentConversation',
      id,
      enabled: true,
      entries: [],
      truncated: false,
      unreadable: true,
    });
  }
}
