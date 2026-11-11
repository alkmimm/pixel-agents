import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isSessionOver,
  lastRecordType,
  SessionProcessIndex,
  setSessionProcessIndex,
  transcriptClosed,
} from '../src/sessionLiveness.js';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-liveness-'));
});
afterEach(() => {
  setSessionProcessIndex(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

const line = (o: unknown) => JSON.stringify(o) + '\n';

describe('transcriptClosed', () => {
  it('is true only when the last record is cost-state', () => {
    const f = path.join(dir, 's.jsonl');
    fs.writeFileSync(f, line({ type: 'user' }) + line({ type: 'cost-state', totalCostUSD: 1 }));
    expect(transcriptClosed(f)).toBe(true);
    // A resumed session appends after it.
    fs.appendFileSync(f, line({ type: 'assistant' }));
    expect(transcriptClosed(f)).toBe(false);
    expect(lastRecordType(f)).toBe('assistant');
  });

  it('a half-written last line, an empty or a missing file: not closed', () => {
    const f = path.join(dir, 's.jsonl');
    fs.writeFileSync(f, line({ type: 'cost-state' }) + '{"type":"assis');
    expect(transcriptClosed(f)).toBe(false);
    fs.writeFileSync(f, '');
    expect(transcriptClosed(f)).toBe(false);
    expect(transcriptClosed(path.join(dir, 'missing.jsonl'))).toBe(false);
  });
});

describe('SessionProcessIndex', () => {
  function fakeProc(pid: number, starttime: string, ns = 'pid:[1]'): string {
    const proc = path.join(dir, 'proc');
    fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
    // `comm` with spaces and a `)`: the fields are counted after the LAST `)`.
    const after = ['S', ...Array.from({ length: 18 }, (_, i) => String(i)), starttime, '0'];
    fs.writeFileSync(path.join(proc, String(pid), 'stat'), `${pid} (we ird) x) ${after.join(' ')}`);
    fs.mkdirSync(path.join(proc, 'self', 'ns'), { recursive: true });
    try {
      fs.symlinkSync(ns, path.join(proc, 'self', 'ns', 'pid'));
    } catch {
      /* already there */
    }
    return proc;
  }
  function session(pid: number, sessionId: string, extra: Record<string, unknown> = {}): string {
    const sessions = path.join(dir, 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      path.join(sessions, `${pid}.json`),
      JSON.stringify({ pid, sessionId, procStart: '500', cwd: '/x', ...extra }),
    );
    return sessions;
  }

  it('alive, dead (no process), dead (pid reused), unknown (no file, other namespace)', () => {
    const proc = fakeProc(100, '500');
    fakeProc(200, '999'); // pid 200 now belongs to another process
    const sessions = session(100, 'alive-session');
    session(200, 'reused-session');
    session(300, 'gone-session');
    session(400, 'other-ns', { pidDomain: 'linux:abc:pid:[2]' });
    const index = new SessionProcessIndex(sessions, proc, 0);
    expect(index.sessionState('alive-session')).toBe('alive');
    expect(index.sessionState('reused-session')).toBe('dead');
    expect(index.sessionState('gone-session')).toBe('dead');
    expect(index.sessionState('other-ns')).toBe('unknown');
    expect(index.sessionState('never-seen')).toBe('unknown');
  });

  it('without a readable /proc (Windows, macOS) nothing is ever dead', () => {
    const sessions = session(300, 'gone-session');
    session(400, 'with-domain', { pidDomain: 'linux:abc:pid:[1]' });
    const noProc = path.join(dir, 'no-proc');
    const index = new SessionProcessIndex(sessions, noProc, 0);
    expect(index.sessionState('gone-session')).toBe('unknown');
    expect(index.sessionState('with-domain')).toBe('unknown');
  });

  it('a session resumed under a new pid is not called dead on a stale index', () => {
    const proc = fakeProc(100, '500');
    const sessions = session(300, 'resumed'); // the old, dead process
    const index = new SessionProcessIndex(sessions, proc, 60_000);
    expect(index.sessionState('other')).toBe('unknown'); // index read now
    session(100, 'resumed'); // the new process, written after the read
    expect(index.sessionState('resumed')).toBe('alive');
  });

  it('ignores the .key files and anything that is not <pid>.json', () => {
    const proc = fakeProc(100, '500');
    const sessions = session(100, 'alive-session');
    fs.writeFileSync(path.join(sessions, '300.abc.key'), 'secret');
    fs.writeFileSync(path.join(sessions, 'notes.json'), JSON.stringify({ pid: 1, sessionId: 'x' }));
    const index = new SessionProcessIndex(sessions, proc, 0);
    expect(index.sessionState('x')).toBe('unknown');
    expect(index.sessionState('alive-session')).toBe('alive');
  });

  it('isSessionOver: a closed transcript, or a dead process; never on unknown', () => {
    const proc = fakeProc(100, '500');
    const sessions = session(300, 'dead-one');
    session(100, 'live-one');
    setSessionProcessIndex(new SessionProcessIndex(sessions, proc, 0));
    const write = (name: string, last: string) => {
      const f = path.join(dir, `${name}.jsonl`);
      fs.writeFileSync(f, line({ type: 'user' }) + line({ type: last }));
      return f;
    };
    expect(isSessionOver(write('dead-one', 'assistant'))).toBe(true);
    expect(isSessionOver(write('live-one', 'assistant'))).toBe(false);
    expect(isSessionOver(write('windows-one', 'assistant'))).toBe(false);
    expect(isSessionOver(write('windows-two', 'cost-state'))).toBe(true);
  });
});
