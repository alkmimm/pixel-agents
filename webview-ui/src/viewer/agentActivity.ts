/**
 * pixel-agents-secure (local): the office viewer's own messages.
 *
 * - agentActivityHistory / agentActivity: each agent's recent activity, as the
 *   server's ActivityLog records it (server/src/activityLog.ts) -- only the
 *   labels the office already shows.
 *
 * Kept out of the generated protocol (core/asyncapi.yaml): it is this fork's
 * viewer-only extension, and a regenerated upstream contract must not drop it.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import { transport } from '../transport/index.js';

export type ActivityKind = 'joined' | 'turn' | 'tool' | 'subtool' | 'permission' | 'done' | 'input';

export interface ActivityEntry {
  t: number;
  k: ActivityKind;
  label?: string;
  toolId?: string;
}

export interface AgentActivity {
  project?: string;
  entries: ActivityEntry[];
}

const MAX_ENTRIES = 300;

// ── Store ──────────────────────────────────────────────────────

let activities = new Map<number, AgentActivity>();
let version = 0;
const listeners = new Set<() => void>();
let subscribed = false;

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

function isEntry(value: unknown): value is ActivityEntry {
  const e = value as ActivityEntry;
  return !!e && typeof e === 'object' && typeof e.t === 'number' && typeof e.k === 'string';
}

function onServerMessage(raw: unknown): void {
  const msg = raw as Record<string, unknown>;
  switch (msg.type) {
    case 'agentActivityHistory': {
      const next = new Map<number, AgentActivity>();
      for (const agent of (msg.agents as Array<Record<string, unknown>>) ?? []) {
        if (typeof agent.id !== 'number') continue;
        next.set(agent.id, {
          project: typeof agent.project === 'string' ? agent.project : undefined,
          entries: Array.isArray(agent.entries) ? agent.entries.filter(isEntry) : [],
        });
      }
      activities = next;
      changed();
      return;
    }
    case 'agentActivity': {
      if (typeof msg.id !== 'number') return;
      const current = activities.get(msg.id) ?? { entries: [] };
      const next: AgentActivity = { ...current };
      if (typeof msg.project === 'string') next.project = msg.project;
      if (isEntry(msg.entry)) {
        next.entries = [...current.entries, msg.entry].slice(-MAX_ENTRIES);
      }
      activities = new Map(activities).set(msg.id, next);
      changed();
      return;
    }
    case 'agentClosed': {
      if (typeof msg.id !== 'number' || !activities.has(msg.id)) return;
      activities = new Map(activities);
      activities.delete(msg.id);
      changed();
      return;
    }
    default:
      return;
  }
}

function subscribe(listener: () => void): () => void {
  if (!subscribed) {
    subscribed = true;
    // Lives as long as the page: the history must not miss messages between
    // two panels opening.
    transport.onMessage(onServerMessage);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Start listening now, before any component asks (call once at startup). */
export function startActivityFeed(): void {
  subscribe(() => {});
}

export function useAgentActivity(id: number | null): AgentActivity | undefined {
  useSyncExternalStore(subscribe, () => version);
  return id === null ? undefined : activities.get(id);
}

/** Ticks every `ms` so "há 3 min" stays true. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

// ── Formatting ─────────────────────────────────────────────────

export function timeAgo(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `há ${Math.floor(h / 24)} d`;
}

export function clockTime(t: number): string {
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min ${s % 60}s`;
}

const KIND_TEXT: Record<ActivityKind, string> = {
  joined: 'Entrou no escritório',
  turn: 'Começou a trabalhar',
  tool: '',
  subtool: '',
  permission: 'Pediu aprovação',
  done: 'Terminou a vez',
  input: 'Esperando você',
};

export function entryText(entry: ActivityEntry): string {
  if (entry.k === 'tool' || entry.k === 'subtool') return entry.label ?? 'Ferramenta';
  return KIND_TEXT[entry.k] ?? entry.k;
}
