/**
 * pixel-agents-secure (local): a session's project name, from its working
 * directory.
 *
 * Without a cwd the office guessed the name from the transcript folder
 * (`-home-u-repos-pixel-agents-secure`), keeping what followed the last dash:
 * "secure". A session in a git worktree created by Claude Code
 * (`<repo>/.claude/worktrees/<slug>`) was named after the slug, apart from its
 * repository. Here the name is the repository's folder name, for Linux and
 * Windows paths alike (sessions read from WSL, H16).
 */
import * as fs from 'fs';

/** How much of a transcript's head is searched for the working directory. */
const HEAD_BYTES = 64 * 1024;

/** The directory that names the project: a worktree's repository, else the cwd itself. */
export function projectDirOfCwd(cwd: string): string {
  const match = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/.exec(cwd);
  return match && match[1] ? match[1] : cwd;
}

/** The project's folder name for a working directory, or undefined. */
export function projectNameFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = projectDirOfCwd(cwd).split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last && !/^[A-Za-z]:$/.test(last) ? last : undefined;
}

/** The working directory named by the first records of a transcript. */
export function cwdOfTranscript(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    const match = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(buf.subarray(0, read).toString('utf-8'));
    if (!match) return undefined;
    const cwd = JSON.parse(match[1]) as unknown;
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
