/**
 * pixel-agents-secure (local): whether a Claude Code session is over, so the
 * office stops showing characters for sessions that already ended.
 *
 * Hooks deliver SessionEnd only for sessions whose hooks post to THIS server.
 * Sessions seen through an extra root (Windows sessions read from WSL, H16),
 * killed terminals and reboots never send it, and their characters stayed
 * forever. Two signals, both read-only and local:
 *
 * 1. The transcript ends in a `cost-state` record: Claude Code writes it when
 *    a session closes. A resumed session appends after it, so the signal
 *    clears by itself. Works for every root, Windows ones included.
 * 2. `~/.claude/sessions/<pid>.json` names the process of a session on this
 *    machine. The session is known dead when that pid no longer exists, or now
 *    belongs to another process (its start time differs from `procStart`). A
 *    session with no such file, or one from another pid namespace, is
 *    UNKNOWN, never dead.
 *
 * Reads only the last bytes of a transcript, and of each session file the
 * fields `sessionId`, `pid`, `procStart` and `pidDomain`. Nothing is written,
 * nothing is executed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** How much of the end of a transcript is read to find its last record. */
const TAIL_BYTES = 16_384;
/** A session file larger than this is not one (they are a few hundred bytes). */
const MAX_SESSION_FILE_BYTES = 16_384;

/** The last record's type, or null when it cannot be read. */
export function lastRecordType(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf.subarray(0, read).toString('utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const record = JSON.parse(line) as { type?: unknown };
        return typeof record.type === 'string' ? record.type : null;
      } catch {
        return null; // a line still being written, or cut by the tail window
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Whether the transcript's last record says the session closed. */
export function transcriptClosed(file: string): boolean {
  return lastRecordType(file) === 'cost-state';
}

interface SessionProcess {
  pid: number;
  procStart: string;
  pidDomain?: string;
}

type ProcessState = 'alive' | 'dead' | 'unknown';

/** Reads `~/.claude/sessions/*.json`, re-reading only files that changed. */
export class SessionProcessIndex {
  private files = new Map<string, { mtimeMs: number; sessionId?: string; proc?: SessionProcess }>();
  private ownNamespace: string | null | undefined;
  private refreshedAt = -Infinity;

  constructor(
    private readonly dir: string = path.join(os.homedir(), '.claude', 'sessions'),
    private readonly procRoot: string = '/proc',
    private readonly refreshMs: number = 5_000,
  ) {}

  /** The processes recorded for a session id; the index is refreshed at most every refreshMs. */
  private processesOf(sessionId: string): SessionProcess[] {
    const now = Date.now();
    if (now - this.refreshedAt >= this.refreshMs) {
      this.refreshedAt = now;
      this.refresh();
    }
    const out: SessionProcess[] = [];
    for (const entry of this.files.values()) {
      if (entry.sessionId === sessionId && entry.proc) out.push(entry.proc);
    }
    return out;
  }

  private refresh(): void {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      this.files.clear();
      return;
    }
    const seen = new Set<string>();
    for (const name of names) {
      if (!/^\d{1,10}\.json$/.test(name)) continue; // never the `.key` files
      const file = path.join(this.dir, name);
      seen.add(file);
      try {
        const stat = fs.statSync(file);
        const cached = this.files.get(file);
        if (cached && cached.mtimeMs === stat.mtimeMs) continue;
        if (!stat.isFile() || stat.size > MAX_SESSION_FILE_BYTES) {
          this.files.set(file, { mtimeMs: stat.mtimeMs });
          continue;
        }
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
        const pid = raw.pid;
        const entry: { mtimeMs: number; sessionId?: string; proc?: SessionProcess } = {
          mtimeMs: stat.mtimeMs,
        };
        if (typeof raw.sessionId === 'string') entry.sessionId = raw.sessionId;
        if (
          typeof pid === 'number' &&
          Number.isInteger(pid) &&
          pid > 0 &&
          (typeof raw.procStart === 'string' || typeof raw.procStart === 'number')
        ) {
          entry.proc = {
            pid,
            procStart: String(raw.procStart),
            ...(typeof raw.pidDomain === 'string' ? { pidDomain: raw.pidDomain } : {}),
          };
        }
        this.files.set(file, entry);
      } catch {
        this.files.delete(file);
      }
    }
    for (const file of this.files.keys()) if (!seen.has(file)) this.files.delete(file);
  }

  private namespace(): string | null {
    if (this.ownNamespace === undefined) {
      try {
        this.ownNamespace = fs.readlinkSync(path.join(this.procRoot, 'self', 'ns', 'pid'));
      } catch {
        this.ownNamespace = null;
      }
    }
    return this.ownNamespace;
  }

  private stateOf(proc: SessionProcess): ProcessState {
    // No readable /proc/self/ns/pid: not Linux (the extension on Windows or
    // macOS), or a /proc we cannot trust. Nothing can be judged there; a
    // missing /proc/<pid> would otherwise read as "dead" for every session.
    const ns = this.namespace();
    if (ns === null) return 'unknown';
    // e.g. `linux:<machine>:pid:[4026532221]`: only our own namespace is ours to judge.
    if (proc.pidDomain !== undefined && !proc.pidDomain.endsWith(ns)) return 'unknown';
    let stat: string;
    try {
      stat = fs.readFileSync(path.join(this.procRoot, String(proc.pid), 'stat'), 'utf-8');
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'dead' : 'unknown';
    }
    // Field 22 (starttime) comes 20 fields after the `)` that closes the name.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] === proc.procStart ? 'alive' : 'dead';
  }

  /** 'dead' only when every recorded process of the session is known gone. */
  sessionState(sessionId: string): ProcessState {
    const before = this.refreshedAt;
    const state = this.judge(sessionId);
    // Already judged on a fresh index: that answer stands.
    if (state !== 'dead' || this.refreshedAt !== before) return state;
    // A resumed session's new <pid>.json may be younger than the index: look
    // again before calling it dead.
    this.refreshedAt = -Infinity;
    return this.judge(sessionId);
  }

  private judge(sessionId: string): ProcessState {
    const procs = this.processesOf(sessionId);
    if (procs.length === 0) return 'unknown';
    let dead = 0;
    for (const proc of procs) {
      const state = this.stateOf(proc);
      if (state === 'alive') return 'alive';
      if (state === 'dead') dead++;
    }
    return dead === procs.length ? 'dead' : 'unknown';
  }
}

let defaultIndex: SessionProcessIndex | null = null;

/** Replace the session index (tests). */
export function setSessionProcessIndex(index: SessionProcessIndex | null): void {
  defaultIndex = index;
}

/** Whether the session of this transcript is over: closed, or its process gone. */
export function isSessionOver(file: string): boolean {
  if (transcriptClosed(file)) return true;
  defaultIndex ??= new SessionProcessIndex();
  return defaultIndex.sessionState(path.basename(file, '.jsonl')) === 'dead';
}
