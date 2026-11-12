/**
 * pixel-agents-secure (local): each agent's session signals, as the server
 * reads them from transcript metadata (server/src/sessionSignals.ts), and the
 * words the viewer shows for them. Every one of them is opt-in (Opções →
 * Novidades, ViewerBar.tsx).
 */
import { useSyncExternalStore } from 'react';

import { transport } from '../transport/index.js';
import { modelGear } from './modelLevel.js';
import type { AgentSignals } from './signalText.js';

export * from './signalText.js';

let signals = new Map<number, AgentSignals>();
/** A sub-agent's own model and effort, by its lead and the tool that spawned it. */
export interface SubagentSignals {
  model?: string;
  effort?: string;
}
let subSignals = new Map<string, SubagentSignals>();
export const subKey = (leadId: number, parentToolId: string): string => `${leadId}:${parentToolId}`;
let version = 0;
const listeners = new Set<() => void>();
let subscribed = false;
/** Whether characters wear their model's gear (Opções → Novidades → "Nível por modelo"). */
let gearOn = false;

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
  } else if (
    msg.type === 'subagentSignals' &&
    typeof msg.id === 'number' &&
    typeof msg.parentToolId === 'string'
  ) {
    subSignals = new Map(subSignals).set(subKey(msg.id, msg.parentToolId), {
      model: str(msg.model, 64),
      effort: str(msg.effort, 16),
    });
  } else if (
    msg.type === 'subagentClear' &&
    typeof msg.id === 'number' &&
    typeof msg.parentToolId === 'string' &&
    subSignals.has(subKey(msg.id, msg.parentToolId))
  ) {
    subSignals = new Map(subSignals);
    subSignals.delete(subKey(msg.id, msg.parentToolId));
  } else if (msg.type === 'agentClosed' && typeof msg.id === 'number') {
    const prefix = `${msg.id}:`;
    const subs = [...subSignals.keys()].filter((k) => k.startsWith(prefix));
    if (!signals.has(msg.id) && subs.length === 0) return;
    signals = new Map(signals);
    signals.delete(msg.id);
    subSignals = new Map(subSignals);
    for (const k of subs) subSignals.delete(k);
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

/** Turn the model gear on or off for every portrait (App.tsx, from the option). */
export function setModelGearOn(on: boolean): void {
  if (on === gearOn) return;
  gearOn = on;
  version++;
  for (const listener of listeners) listener();
}

/** The gear an agent's portrait wears (viewer/modelLevel.ts); 0 with the option off. */
export function useAgentGear(id: number | null): number {
  const s = useAgentSignals(id);
  return gearOn ? modelGear(s?.model, s?.effort) : 0;
}

/** Every sub-agent's own model and effort, by subKey (re-renders on any change). */
export function useSubagentSignals(): ReadonlyMap<string, SubagentSignals> {
  useSyncExternalStore(subscribe, () => version);
  return subSignals;
}

/** Every agent's signals (re-renders on any change). */
export function useAllSignals(): ReadonlyMap<number, AgentSignals> {
  useSyncExternalStore(subscribe, () => version);
  return signals;
}

