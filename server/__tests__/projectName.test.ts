import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { cwdOfTranscript, projectDirOfCwd, projectNameFromCwd } from '../src/projectName.js';

describe('projectNameFromCwd', () => {
  it('names a session after its folder, and a worktree after its repository', () => {
    expect(projectNameFromCwd('/home/u/repos/pixel-agents-secure')).toBe('pixel-agents-secure');
    expect(
      projectNameFromCwd('/home/u/repos/pixel-agents-secure/.claude/worktrees/other-forks-22eff9'),
    ).toBe('pixel-agents-secure');
    expect(
      projectNameFromCwd('/home/u/repos/app/.claude/worktrees/feature-x/packages/api'),
    ).toBe('app');
    expect(projectNameFromCwd('C:\\Users\\someone\\code\\erp\\.claude\\worktrees\\fix-1')).toBe('erp');
    expect(projectNameFromCwd('C:\\Users\\someone\\code\\erp')).toBe('erp');
    expect(projectNameFromCwd('C:\\')).toBeUndefined();
    expect(projectNameFromCwd(undefined)).toBeUndefined();
    expect(projectDirOfCwd('/a/b')).toBe('/a/b');
  });

  it('reads the cwd from the head of a transcript', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-project-'));
    try {
      const f = path.join(dir, 's.jsonl');
      fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd: '/home/u/repos/app' }) + '\n');
      expect(cwdOfTranscript(f)).toBe('/home/u/repos/app');
      fs.writeFileSync(f, JSON.stringify({ type: 'user' }) + '\n');
      expect(cwdOfTranscript(f)).toBeUndefined();
      expect(cwdOfTranscript(path.join(dir, 'missing.jsonl'))).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
