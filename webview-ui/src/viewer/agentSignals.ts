/**
 * pixel-agents-secure (local): each agent's session signals, as the server
 * reads them from transcript metadata (server/src/sessionSignals.ts), and the
 * words the viewer shows for them. Every one of them is opt-in (Opções →
 * Novidades, ViewerBar.tsx).
 */
import { useSyncExternalStore } from 'react';

import { transport } from '../transport/index.js';
import type { AgentSignals } from './signalText.js';

export * from './signalText.js';

let signals = new Map<number, AgentSignals>();
let version = 0;
const listeners = new Set<() => void>();
let subscribed = false;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

function onServerMessage(raw: unknown): void {
  const msg = raw as Record<string, unknown>;
  if (msg.type === 'agentSignals' && typeof msg.id === 'number') {
    const quota = num(msg.quotaUntil, NaN);
    signals = new Map(signals).set(msg.id, {
      permissionMode: str(msg.permissionMode, 32),
      title: str(msg.title, 120),
      aiTitle: str(msg.aiTitle, 120),
      errorStreak: num(msg.errorStreak),
      rateLimited: msg.rateLimited === true,
      quotaUntil: Number.isFinite(quota) ? quota : undefined,
      repeats: num(msg.repeats),
      model: str(msg.model, 64),
      effort: str(msg.effort, 16),
    });
  } else if (msg.type === 'agentClosed' && typeof msg.id === 'number' && signals.has(msg.id)) {
    signals = new Map(signals);
    signals.delete(msg.id);
  } else {
    return;
  }
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (!subscribed) {
    subscribed = true;
    transport.onMessage(onServerMessage);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Start listening now, before any component asks (call once at startup). */
export function startSignalsFeed(): void {
  subscribe(() => {});
}

export function useAgentSignals(id: number | null): AgentSignals | undefined {
  useSyncExternalStore(subscribe, () => version);
  return id === null ? undefined : signals.get(id);
}

/** Every agent's signals (re-renders on any change). */
export function useAllSignals(): ReadonlyMap<number, AgentSignals> {
  useSyncExternalStore(subscribe, () => version);
  return signals;
}

