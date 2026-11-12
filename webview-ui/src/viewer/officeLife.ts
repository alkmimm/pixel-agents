/**
 * pixel-agents-secure (local): "Vida no escritório" — small things the
 * characters do that say something true about their agents:
 *
 *   ☕   an idle agent walks to the coffee, stays a moment and goes back
 *   Zzz  an agent that finished long ago dozes in its chair
 *   🎉   an agent that just finished a long turn celebrates
 *   …    two idle agents that meet stop for a word
 *   ♥    a pet goes to whoever has waited on you the longest
 *
 * The rules are here, free of React and the DOM (tested directly);
 * useOfficeLife.ts applies them to the office once a second. Everything is
 * drawn from what the viewer already knows; nothing is sent to the server.
 */
// The tone's type from signalText.ts, not agentStatus.ts: that one reaches the
// DOM, and this file is compiled for the tests without it.
import type { StatusLike } from './signalText.js';

type StatusTone = StatusLike['tone'];

/** A turn at least this long is worth celebrating. */
export const CELEBRATE_MIN_MS = 5 * 60_000;
/** Nothing to do for this long: asleep. */
export const SLEEP_AFTER_MS = 20 * 60_000;
/** An idle agent goes for a coffee about once in this long. */
export const COFFEE_EVERY_MS = 12 * 60_000;
export const COFFEE_SIP_SEC = 8;
export const CHAT_SEC = 4;
/** How close (in steps) two idle agents stand to start talking. */
export const CHAT_REACH_TILES = 2;
/** The longest time one look stands for. */
export const MAX_LOOK_MS = 5_000;
/** Where there is coffee: the cup on a table, and the machine. */
const COFFEE_TYPES: ReadonlySet<string> = new Set(['COFFEE', 'COFFEE_MACHINE']);
/** How far from the coffee (in steps) still counts as "at the coffee". */
const COFFEE_REACH_TILES = 3;

export const MOOD = {
  coffee: '☕',
  sleep: 'Zzz',
  party: '🎉',
  chat: '…',
} as const;

type Tile = { col: number; row: number };

function isWorking(tone: StatusTone): boolean {
  return tone === 'active' || tone === 'permission';
}

/** What is remembered of an agent between two looks. */
export interface TurnMemo {
  working: boolean;
  /** When the turn it is in began (ms), while working. */
  since: number;
}

/**
 * Follow an agent's turns. `celebrate` is true on the look that finds a long
 * turn just finished ("done"; a turn that ended asking something is not).
 */
export function followTurn(
  memo: TurnMemo | undefined,
  tone: StatusTone,
  now: number,
): { memo: TurnMemo; celebrate: boolean } {
  const working = isWorking(tone);
  if (!memo) return { memo: { working, since: now }, celebrate: false };
  if (working) {
    return { memo: memo.working ? memo : { working: true, since: now }, celebrate: false };
  }
  const celebrate = memo.working && tone === 'done' && now - memo.since >= CELEBRATE_MIN_MS;
  return { memo: { working: false, since: now }, celebrate };
}

/** Whether an agent has had nothing to do for long enough to doze off. One
 *  that waits on you is not asleep: it is waiting. */
export function isSleepy(tone: StatusTone, since: number | undefined, now: number): boolean {
  const nothingToDo = tone === 'done' || tone === 'idle';
  return nothingToDo && since !== undefined && now - since >= SLEEP_AFTER_MS;
}

/** The chance, in one look `elapsedMs` after the last, of going for a coffee. */
export function coffeeChance(elapsedMs: number): number {
  // A look that comes late (a hidden tab, a sleeping machine) counts as one
  // look, or everyone would leave for coffee together.
  return Math.max(0, Math.min(elapsedMs, MAX_LOOK_MS)) / COFFEE_EVERY_MS;
}

/**
 * Where one stands to have a coffee: for each coffee in the office, the
 * walkable tiles closest to it (a coffee sits on a table, among sofas).
 */
export function coffeeSpots(
  furniture: ReadonlyArray<{ type: string; col: number; row: number }>,
  walkable: readonly Tile[],
): Tile[] {
  const spots = new Map<string, Tile>();
  for (const item of furniture) {
    if (!COFFEE_TYPES.has(item.type.split(':')[0])) continue;
    const steps = (t: Tile) => Math.abs(t.col - item.col) + Math.abs(t.row - item.row);
    const near = walkable.filter((t) => steps(t) <= COFFEE_REACH_TILES);
    if (near.length === 0) continue;
    const closest = Math.min(...near.map(steps));
    for (const t of near) if (steps(t) === closest) spots.set(`${t.col},${t.row}`, t);
  }
  return [...spots.values()];
}

/** Pairs of idle agents standing close enough to talk; each agent at most once. */
export function chatPairs(
  standing: ReadonlyArray<{ id: number; col: number; row: number }>,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const taken = new Set<number>();
  for (let i = 0; i < standing.length; i++) {
    const a = standing[i];
    if (taken.has(a.id)) continue;
    for (let j = i + 1; j < standing.length; j++) {
      const b = standing[j];
      if (taken.has(b.id)) continue;
      const steps = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      if (steps === 0 || steps > CHAT_REACH_TILES) continue;
      pairs.push([a.id, b.id]);
      taken.add(a.id);
      taken.add(b.id);
      break;
    }
  }
  return pairs;
}
