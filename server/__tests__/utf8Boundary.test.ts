import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seenLines: string[] = [];
vi.mock('../src/transcriptParser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/transcriptParser.js')>()),
  processTranscriptLine: (_id: number, line: string) => {
    seenLines.push(line);
  },
}));

import { AgentStateStore } from '../src/agentStateStore.js';
import { readNewLines } from '../src/fileWatcher.js';
import type { AgentState } from '../src/types.js';
import { completeUtf8Length } from '../src/utf8Boundary.js';

describe('completeUtf8Length', () => {
  const b = (...bytes: number[]) => Uint8Array.from(bytes);

  it('keeps whole characters', () => {
    expect(completeUtf8Length(b())).toBe(0);
    expect(completeUtf8Length(Buffer.from('abc'))).toBe(3);
    for (const s of ['ç', 'ação', '€', '😀', 'x😀']) {
      const buf = Buffer.from(s);
      expect(completeUtf8Length(buf)).toBe(buf.length);
    }
  });

  it('holds back an incomplete trailing sequence', () => {
    for (const s of ['ç', '€', '😀']) {
      const buf = Buffer.from('ab' + s);
      for (let cut = 1; cut < Buffer.from(s).length; cut++) {
        expect(completeUtf8Length(buf.subarray(0, 2 + cut))).toBe(2);
      }
    }
  });

  it('never holds back bytes that are not valid UTF-8', () => {
    expect(completeUtf8Length(b(0x61, 0x80, 0x80, 0x80, 0x80))).toBe(5); // stray continuations
    expect(completeUtf8Length(b(0x61, 0xff))).toBe(2); // invalid lead
    expect(completeUtf8Length(b(0x80))).toBe(1);
  });
});

describe('readNewLines: a chunk that ends inside a character', () => {
  let dir = '';
  afterEach(() => {
    seenLines.length = 0;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('decodes every character whole across the 64 KB read cap', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utf8-boundary-'));
    const file = path.join(dir, 's.jsonl');
    // 'ç' is 2 bytes: put its first byte at offset 65535, the last of the first chunk.
    const first = JSON.stringify({ pad: 'a'.repeat(90) });
    // first + '\n', then '{"t":"', the padding, and the 'a' of 'ação' before the 'ç'.
    const padLen = 65535 - (Buffer.byteLength(first) + 1) - '{"t":"'.length - 1;
    const second = JSON.stringify({ t: 'b'.repeat(padLen) + 'ação' });
    fs.writeFileSync(file, `${first}\n${second}\n`);
    expect(Buffer.from(fs.readFileSync(file)).subarray(65535, 65537).toString()).toBe('ç');

    const agents = new AgentStateStore();
    agents.set(1, {
      id: 1,
      jsonlFile: file,
      fileOffset: 0,
      lineBuffer: '',
      permissionSent: false,
    } as unknown as AgentState);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    for (let i = 0; i < 4; i++) readNewLines(1, agents, timers, new Map());

    expect(seenLines).toEqual([first, second]);
    expect(seenLines.join('')).not.toContain('�');
    expect(agents.get(1)!.fileOffset).toBe(fs.statSync(file).size);
  });
});
