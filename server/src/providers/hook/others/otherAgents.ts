/**
 * pixel-agents-secure (local): GitHub Copilot and Gemini CLI as agents whose
 * hooks the user can turn on (Opções → Outros agentes, in the VS Code panel).
 *
 * Each is a HookProvider only as far as installing goes: what is written, what
 * is removed, whether it is there. Their events are not normalised by a
 * provider of their own: the hook script rewrites them as Claude-shaped events
 * (hooks/foreignPayload.ts), the route filters them with the same H4 allowlist,
 * and the runtime, which knows one provider, handles them as one more session.
 *
 * They are NOT in `hookProviders`: nobody is asked about them on first run.
 * Turning one on in the panel is the consent, and the panel shows what will be
 * written before it is.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { HookProvider } from '../../../../../core/src/provider.js';
import { bundledScriptPath } from '../claude/bundledScripts.js';
import { claudeProvider } from '../claude/claude.js';
import { CLAUDE_HOOK_SCRIPT_NAME } from '../claude/constants.js';
import { filterHookPayload } from '../claude/hooks/hookPayloadFilter.js';
import {
  copilotHooksFile,
  hasGeminiHooks,
  isOurCopilotHooksFile,
  withGeminiHooks,
  withoutGeminiHooks,
} from './agentHookEntries.js';

/** A HookProvider whose agent may not be on this machine at all. */
export interface OtherAgentProvider extends HookProvider {
  /** Whether the agent's own folder exists: with none, there is nothing to
   *  offer and nothing is ever written. */
  isPresent(): boolean;
}

function readJson(file: string): Record<string, unknown> | undefined {
  let textOfFile: string;
  try {
    textOfFile = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  const parsed: unknown = JSON.parse(textOfFile);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Write next to the file and rename over it, keeping the file's own mode. */
function writeJsonAtomic(file: string, value: unknown): void {
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // New file: private.
  }
  const tmp = `${file}.pixel-agents.tmp`;
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode });
  fs.renameSync(tmp, file);
}

const scriptPath = (): string => bundledScriptPath(CLAUDE_HOOK_SCRIPT_NAME);

/** What only installing needs; the rest is never asked of these providers. */
function installerOnly(
  id: string,
  displayName: string,
  parts: Pick<
    OtherAgentProvider,
    'isPresent' | 'installHooks' | 'uninstallHooks' | 'areHooksInstalled' | 'consentDisclosure'
  >,
): OtherAgentProvider {
  return {
    ...claudeProvider,
    id,
    displayName,
    // The route's filter (H4): the same allowlist, whatever agent posted.
    sanitizeHookPayload: filterHookPayload,
    // Nothing of Claude Code's that writes or launches belongs to these.
    usageBridge: undefined,
    team: undefined,
    buildLaunchCommand: undefined,
    ...parts,
  };
}

// ── GitHub Copilot ──────────────────────────────────────────────────────────

const copilotHome = (): string => process.env['COPILOT_HOME'] || path.join(os.homedir(), '.copilot');
const copilotFile = (): string => path.join(copilotHome(), 'hooks', 'pixel-agents.json');

export const copilotProvider: OtherAgentProvider = installerOnly('copilot', 'GitHub Copilot', {
  isPresent: () => fs.existsSync(copilotHome()),
  async installHooks() {
    const file = copilotFile();
    const existing = readJson(file);
    if (existing && !isOurCopilotHooksFile(existing)) {
      throw new Error(`${file} exists and was not written by Pixel Agents; it was left as it is`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, copilotHooksFile(scriptPath()));
  },
  async uninstallHooks() {
    const file = copilotFile();
    const existing = readJson(file);
    if (existing && isOurCopilotHooksFile(existing)) fs.rmSync(file, { force: true });
  },
  async areHooksInstalled() {
    try {
      const existing = readJson(copilotFile());
      return existing !== undefined && isOurCopilotHooksFile(existing);
    } catch {
      return false;
    }
  },
  consentDisclosure: () => ({
    headline: 'Show GitHub Copilot sessions in the office?',
    disclosure:
      'Writes one file, ~/.copilot/hooks/pixel-agents.json, and nothing else of Copilot’s. ' +
      'Copilot then runs the Pixel Agents hook on session start and end, tool use, turn end and helpers. ' +
      'Only session id, folder, tool name, file name and the program of a shell command leave the hook; ' +
      'never prompts, answers or tool output. Turning it off deletes the file.',
  }),
});

// ── Gemini CLI ──────────────────────────────────────────────────────────────

const geminiHome = (): string => path.join(os.homedir(), '.gemini');
const geminiFile = (): string => path.join(geminiHome(), 'settings.json');

export const geminiProvider: OtherAgentProvider = installerOnly('gemini', 'Gemini CLI', {
  isPresent: () => fs.existsSync(geminiHome()),
  async installHooks() {
    const file = geminiFile();
    // Unreadable or not plain JSON (comments): throws, and nothing is written.
    const settings = readJson(file) ?? {};
    const backup = `${file}.pixel-agents.backup`;
    if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
    writeJsonAtomic(file, withGeminiHooks(settings, scriptPath()));
  },
  async uninstallHooks() {
    const file = geminiFile();
    const settings = readJson(file);
    if (!settings) return;
    const next = withoutGeminiHooks(settings);
    if (JSON.stringify(next) !== JSON.stringify(settings)) writeJsonAtomic(file, next);
  },
  async areHooksInstalled() {
    try {
      const settings = readJson(geminiFile());
      return settings !== undefined && hasGeminiHooks(settings);
    } catch {
      return false;
    }
  },
  consentDisclosure: () => ({
    headline: 'Show Gemini CLI sessions in the office?',
    disclosure:
      'Adds hook entries to ~/.gemini/settings.json (a copy of the file is kept beside it first) and changes nothing else in it. ' +
      'Gemini then runs the Pixel Agents hook on session start and end, tool use, turn end and permission prompts. ' +
      'Only session id, folder, tool name, file name and the program of a shell command leave the hook; ' +
      'never prompts, answers or tool output. Turning it off removes exactly those entries.',
  }),
});

/** Every agent beyond Claude Code whose hooks this build can install. */
export const otherAgentProviders: readonly OtherAgentProvider[] = [copilotProvider, geminiProvider];
