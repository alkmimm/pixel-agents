/**
 * Provider registry: re-exports all bundled providers.
 *
 * Adding a new CLI provider:
 *   1. Create `server/src/providers/hook/<cli>/<cli>.ts` implementing HookProvider.
 *      (File-based and stream-based provider types will land when the first such
 *       provider ships.)
 *   2. Add an export line below.
 *
 * The adapter (VS Code extension, standalone CLI, etc.) imports from here rather
 * than reaching into each provider directory directly.
 */

import type { HookProvider } from '../../../core/src/provider.js';
import { claudeProvider } from './hook/claude/claude.js';

export { claudeProvider };
import { otherAgentProviders } from './hook/others/otherAgents.js';

export { otherAgentProviders } from './hook/others/otherAgents.js';
export { copyHookScript } from './hook/claude/claudeHookInstaller.js';

/** Every bundled hook provider, in registration order. The consent gate loops
 *  over this at the webviewReady handshake (one ask per provider that needs
 *  one) and `hooksConsentResponse` resolves its provider id against it. */
export const hookProviders: readonly HookProvider[] = [claudeProvider];

/** Resolve a wire-supplied provider id, or undefined for an unknown one —
 *  the caller writes nothing on undefined (fail-closed, like a junk choice). */
export function hookProviderById(id: unknown): HookProvider | undefined {
  if (typeof id !== 'string') return undefined;
  // pixel-agents-secure (local): the agents the user may turn on in the panel
  // (others/otherAgents.ts) answer by id too: for the hook route's filter and
  // for the Settings toggle. They are not in `hookProviders`, so the first-run
  // consent never asks about them.
  return hookProviders.find((p) => p.id === id) ?? otherAgentProviders.find((p) => p.id === id);
}
