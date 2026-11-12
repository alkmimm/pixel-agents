/**
 * pixel-agents-secure (local): the other coding agents whose sessions the
 * office shows beside Claude Code's (cursorPayload.ts, foreignPayload.ts).
 *
 * Each of their events leaves the hook process marked with its kind
 * (`agent_kind`) and with the kind in front of its session id, so one agent's
 * session can never be taken for another's, nor for a Claude Code one.
 *
 * Pure and dependency-free: bundled into dist/hooks/claude-hook.js.
 */
export const AGENT_KINDS = ['cursor', 'copilot', 'gemini', 'codex'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** The name written over a character of each kind. */
export const AGENT_KIND_NAMES: Record<AgentKind, string> = {
  cursor: 'Cursor',
  copilot: 'Copilot',
  gemini: 'Gemini',
  // Not from a hook: read from Codex's own session files (codexSessions.ts, H18).
  codex: 'Codex',
};

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value);
}

const MAX_ID = 128;

/** A session id of `kind`: the agent's own id behind the kind's prefix. */
export function kindSessionId(kind: AgentKind, id: string): string {
  const prefix = `${kind}-`;
  return id.startsWith(prefix) ? id.slice(0, MAX_ID + prefix.length) : prefix + id.slice(0, MAX_ID);
}

/** The kind a session id belongs to, or undefined for a Claude Code session. */
export function kindOfSession(sessionId: string): AgentKind | undefined {
  return AGENT_KINDS.find((kind) => sessionId.startsWith(`${kind}-`));
}
