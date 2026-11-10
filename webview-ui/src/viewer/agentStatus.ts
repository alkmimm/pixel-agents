/**
 * pixel-agents-secure (local): one agent's state in words, for the viewer's
 * hover card and details panel. Read from what the office already holds.
 */
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';

export type StatusTone = 'permission' | 'input' | 'active' | 'done' | 'idle';

export interface AgentStatusView {
  tone: StatusTone;
  text: string;
  /** The tool running now, as the office labels it. */
  tool?: string;
}

export const TONE_COLOR: Record<StatusTone, string> = {
  permission: 'var(--color-status-permission)',
  input: 'var(--color-status-permission)',
  active: 'var(--color-status-active)',
  done: 'var(--color-status-success)',
  idle: 'var(--color-text-muted)',
};

export function agentStatusView(
  officeState: OfficeState,
  id: number,
  agentTools: Record<number, ToolActivity[]>,
): AgentStatusView {
  const ch = officeState.characters.get(id);
  const tools = agentTools[id] ?? [];
  const running = [...tools].reverse().find((t) => !t.done);
  if (ch?.bubbleType === 'permission' || running?.permissionWait) {
    return { tone: 'permission', text: 'Pedindo aprovação', tool: running?.status };
  }
  if (ch?.bubbleType === 'waiting') {
    return ch.waitingAwaitingInput
      ? { tone: 'input', text: 'Esperando você' }
      : { tone: 'done', text: 'Terminou' };
  }
  if (running) return { tone: 'active', text: 'Trabalhando', tool: running.status };
  // Mid-turn between tools, as the label over the character says it (an
  // active agent with no tool yet reads "Idle" there too).
  const last = tools[tools.length - 1];
  if (ch?.isActive && last) return { tone: 'active', text: 'Trabalhando', tool: last.status };
  return { tone: 'idle', text: 'Ocioso' };
}

/** "Agente 3", or the teammate's name; with "(líder)" for a team lead. */
export function agentTitle(officeState: OfficeState, id: number): string {
  const ch = officeState.characters.get(id);
  const name = ch?.agentName || `Agente ${id}`;
  return ch?.isTeamLead ? `${name} (líder)` : name;
}
