/**
 * pixel-agents-secure (H4): what of a Bash command the office may show.
 *
 * The status line is broadcast to every client (the VS Code panel, the
 * browser viewer, its activity history) and a command's arguments routinely
 * carry tokens, passwords, hosts and paths: `curl -H "Authorization: …"`,
 * `PGPASSWORD=… psql`, `export API_KEY=…`. Masking what looks like a secret
 * only catches what looks like one. So only the program leaves, plus, for a
 * short list of CLIs whose next word is a verb, that verb (`git commit`,
 * `npm run test`, `make office-status`). A word that is not a plain lowercase
 * word -- a flag, a path, a URL, a value -- never qualifies.
 *
 * Runs in the hook script (on the full command, before anything leaves the
 * hook process) and again in formatToolStatus (on whatever arrived, and on
 * transcript records). Idempotent: the label of a label is the label.
 * Pure and dependency-free: bundled into dist/hooks/claude-hook.js.
 */

/** Programs whose first plain word is a verb, not data. */
const SUBCOMMAND_CLIS = new Set([
  'apt',
  'apt-get',
  'aws',
  'az',
  'brew',
  'bun',
  'cargo',
  'dart',
  'docker',
  'dotnet',
  'flutter',
  'gcloud',
  'gh',
  'git',
  'go',
  'gradle',
  'helm',
  'kubectl',
  'make',
  'melos',
  'npm',
  'pip',
  'pip3',
  'pnpm',
  'podman',
  'poetry',
  'systemctl',
  'terraform',
  'uv',
  'yarn',
]);

/** Package managers whose `run <script>` names the work. */
const RUN_SCRIPT_CLIS = new Set(['bun', 'npm', 'pnpm', 'yarn']);

/** Programs that set the scene for the command that follows. */
const SCENERY = new Set(['.', ':', 'cd', 'export', 'popd', 'pushd', 'set', 'source', 'true', 'unset']);

/** Wrappers whose next word is the real program. */
const WRAPPERS = new Set(['command', 'env', 'exec', 'nice', 'nohup', 'sudo', 'time']);

/** A program name, after its directory is dropped. */
const PROGRAM = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
/** A subcommand or script name: a short plain lowercase word. */
const VERB = /^[a-z][a-z0-9-]{0,23}$/;
/** A leading `NAME=value` environment assignment. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Longest label: program, verb and script name with their spaces. */
export const BASH_LABEL_MAX_LENGTH = 32 + 1 + 24 + 1 + 24;

function stageLabel(stage: string): { program: string; label: string } | null {
  const words = stage.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && (ASSIGNMENT.test(words[i]) || WRAPPERS.has(words[i]))) i++;
  const first = words[i];
  if (first === undefined) return null;
  // Only the last path segment: `./scripts/build-vsix.sh` -> `build-vsix.sh`.
  const program = first.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? '';
  if (!PROGRAM.test(program)) return null;
  let label = program;
  const verb = words[i + 1];
  if (SUBCOMMAND_CLIS.has(program) && verb !== undefined && VERB.test(verb)) {
    label += ` ${verb}`;
    const script = words[i + 2];
    if (RUN_SCRIPT_CLIS.has(program) && verb === 'run' && script !== undefined && VERB.test(script)) {
      label += ` ${script}`;
    }
  }
  return { program, label };
}

/** The program (and, for a known CLI, its verb) a shell command runs, or ''
 *  when no word of it qualifies. Never any other word of the command. */
export function bashCommandLabel(command: unknown): string {
  if (typeof command !== 'string') return '';
  // Top-level separators, then pipe stages. Quotes are not parsed: a quoted
  // separator can only make the label name another plain program word.
  let fallback = '';
  for (const segment of command.slice(0, 4096).split(/&&|\|\||[;\n]/)) {
    for (const stage of segment.split('|')) {
      const found = stageLabel(stage);
      if (!found) continue;
      if (!SCENERY.has(found.program)) return found.label;
      fallback = found.program;
      break; // the rest of a scenery segment's pipe is not the work either
    }
  }
  return fallback;
}
