import * as fs from 'fs';
import * as path from 'path';

/**
 * pixel-agents-secure (H5): files that carry the server's auth token
 * (`~/.pixel-agents/server.json`, `servers/<pid>-<port>.json`) are written
 * owner-only, whatever was on disk before.
 *
 * `writeFileSync(..., { mode })` applies the mode only when it CREATES the
 * file, and `mkdirSync(..., { mode })` never tightens an existing directory.
 * So a leftover `.tmp` from a crash, or a `~/.pixel-agents` first created by
 * config/layout persistence with the default umask, kept looser permissions.
 * Here the directory is chmod'ed to 0700 on every write, the temp file is
 * removed and recreated, chmod'ed to 0600, and only then renamed into place.
 *
 * On Windows the POSIX modes are not enforced by Node; protection there comes
 * from the user profile's ACLs.
 */
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

const posix = process.platform !== 'win32';

/** Create `dir` (and parents) if needed and make it owner-only. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (posix) fs.chmodSync(dir, PRIVATE_DIR_MODE);
}

/** Atomically write `contents` to `filePath` as an owner-only file. Throws on failure. */
export function writePrivateFileAtomic(filePath: string, contents: string): void {
  ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  fs.rmSync(tmpPath, { force: true });
  fs.writeFileSync(tmpPath, contents, { encoding: 'utf-8', mode: PRIVATE_FILE_MODE });
  if (posix) fs.chmodSync(tmpPath, PRIVATE_FILE_MODE);
  fs.renameSync(tmpPath, filePath);
}
