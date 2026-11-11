/**
 * pixel-agents-secure (local): the agents list's order (AgentsPanel.tsx).
 * Those waiting on you first, then one group per project. Free of React and
 * the DOM, so it is tested directly.
 */
// The tone's type from signalText.ts, not agentStatus.ts: that one reaches the
// DOM, and this file is compiled for the tests without it.
import type { StatusLike } from './signalText.js';

type StatusTone = StatusLike['tone'];

export interface AgentRowLike {
  id: number;
  tone: StatusTone;
  /** When the agent entered its state (ms), when known. */
  since?: number;
  project?: string;
}

export interface AgentGroups<T> {
  /** Asking for approval first, then the longest waiting. */
  waiting: T[];
  /** Everyone else, by project name; agents with no project come last. */
  projects: Array<{ project: string | null; rows: T[] }>;
}

/** Working agents above finished ones above idle ones. */
const TONE_ORDER: Record<StatusTone, number> = {
  permission: 0,
  input: 1,
  active: 2,
  done: 3,
  idle: 4,
};

export function isWaiting(tone: StatusTone): boolean {
  return tone === 'permission' || tone === 'input';
}

export function groupAgents<T extends AgentRowLike>(rows: readonly T[], now: number): AgentGroups<T> {
  const waiting = rows
    .filter((r) => isWaiting(r.tone))
    .sort(
      (a, b) =>
        TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (a.since ?? now) - (b.since ?? now) || a.id - b.id,
    );

  const byProject = new Map<string | null, T[]>();
  for (const row of rows) {
    if (isWaiting(row.tone)) continue;
    const key = row.project || null;
    const list = byProject.get(key);
    if (list) list.push(row);
    else byProject.set(key, [row]);
  }
  const projects = [...byProject.entries()]
    .map(([project, list]) => ({
      project,
      rows: list.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.id - b.id),
    }))
    .sort((a, b) => {
      if (a.project === null) return 1;
      if (b.project === null) return -1;
      return a.project.localeCompare(b.project);
    });
  return { waiting, projects };
}
