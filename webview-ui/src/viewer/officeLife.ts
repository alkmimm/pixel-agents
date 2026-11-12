/**
 * pixel-agents-secure (local): "Vida no escritório" — small things the
 * characters do that say something true about their agents:
 *
 *   ☕   an idle agent goes for a coffee: with a coffee machine in the office,
 *        it fills a cup there, sits with it on a sofa at the coffee table,
 *        and leaves the cup on the table when it gets up; without one, it just stands by the coffee a moment
 *   🤖   a cleaning robot does its round now and then, and takes the cups
 *        with its arms, one at a time
 *   🎮   an idle agent sits on a pouf and plays the video game a while
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
/** How far from the coffee (in steps) still counts as "at the coffee". */
const COFFEE_REACH_TILES = 3;

export const MOOD = {
  coffee: '☕',
  sleep: 'Zzz',
  party: '🎉',
  chat: '…',
  game: '🎮',
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
  return spotsNear(furniture, walkable, 'COFFEE');
}

/** Where one stands to use the furniture of a kind (the coffee machine, the
 *  coffee table): for each, the walkable tiles closest to it. */
export function spotsNear(
  furniture: ReadonlyArray<{ type: string; col: number; row: number }>,
  walkable: readonly Tile[],
  kind: string,
): Tile[] {
  const spots = new Map<string, Tile>();
  for (const item of furniture) {
    if (item.type.split(':')[0] !== kind) continue;
    const steps = (t: Tile) => Math.abs(t.col - item.col) + Math.abs(t.row - item.row);
    const near = walkable.filter((t) => steps(t) <= COFFEE_REACH_TILES);
    if (near.length === 0) continue;
    const closest = Math.min(...near.map(steps));
    for (const t of near) if (steps(t) === closest) spots.set(`${t.col},${t.row}`, t);
  }
  return [...spots.values()];
}

/** At the machine, a cup takes this long to fill. */
export const POUR_SEC = 2;
/** The cleaning robot does its round about this often... */
export const ROBOT_EVERY_MS = 5 * 60_000;
/** ...and at once when this many cups wait on the table. */
export const ROBOT_CUPS_FULL = 4;
/** How far (in steps) around the table, or its dock, the robot goes over the floor. */
const ROBOT_REACH_TILES = 4;
/** The floor stops of a round, besides the table. */
const ROBOT_FLOOR_STOPS = 2;

/** What the office has of a coffee corner, and where one stands for each part. */
export interface CoffeeCorner {
  /** In front of the coffee machine: where a cup is filled. Empty without a machine. */
  machine: Tile[];
  /** The coffee table cups are left on (its sprite's tile), and where one stands at it. */
  table: { at: Tile; spots: Tile[] } | null;
  /** By the coffee that is furniture (a mug on a table): where one drinks without a table. */
  sip: Tile[];
  /** Where the cleaning robot rests: by the bin, else by the machine. */
  dock: Tile | null;
  /** The video game, and the poufs close enough to play from. Null without both. */
  game: { at: Tile; poufs: Tile[] } | null;
}

/** With a cup, one sits this long at the table before getting up and leaving it there. */
export const COFFEE_SIT_SEC = 20;
/** An idle agent plays about once in this long, when there is a game and a free pouf... */
export const GAME_EVERY_MS = 10 * 60_000;
/** ...for this long. */
export const GAME_SEC = 25;
/** A pouf this close (in steps) to the game is one to play from. */
const GAME_REACH_TILES = 4;

/** The chance, in one look `elapsedMs` after the last, of going to play. */
export function gameChance(elapsedMs: number): number {
  return Math.max(0, Math.min(elapsedMs, MAX_LOOK_MS)) / GAME_EVERY_MS;
}

/** Whether a seat's tile touches the coffee table (2x2 tiles from `table`): a sofa around it. */
export function seatAtTable(seat: Tile, table: Tile): boolean {
  const dc = seat.col < table.col ? table.col - seat.col : Math.max(0, seat.col - table.col - 1);
  const dr = seat.row < table.row ? table.row - seat.row : Math.max(0, seat.row - table.row - 1);
  return dc + dr === 1;
}

/** The way one faces from `from` to look at `to`: 'up' | 'down' | 'left' | 'right'. */
export function wayTo(from: Tile, to: Tile): 'up' | 'down' | 'left' | 'right' {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dr) >= Math.abs(dc) && dr !== 0) return dr < 0 ? 'up' : 'down';
  return dc < 0 ? 'left' : 'right';
}

const stepsBetween = (a: Tile, b: Tile) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

export function coffeeCorner(
  furniture: ReadonlyArray<{ type: string; col: number; row: number }>,
  walkable: readonly Tile[],
): CoffeeCorner {
  const of = (kind: string) => furniture.filter((f) => f.type.split(':')[0] === kind);
  const machine = spotsNear(furniture, walkable, 'COFFEE_MACHINE');
  // The table closest to the machine (any table, without one).
  const from = of('COFFEE_MACHINE')[0];
  const tables = of('COFFEE_TABLE')
    .map((t) => ({ at: { col: t.col, row: t.row }, spots: spotsNear([t], walkable, 'COFFEE_TABLE') }))
    .filter((t) => t.spots.length > 0)
    .sort((a, b) => (from ? stepsBetween(a.at, from) - stepsBetween(b.at, from) : 0));
  const dock = spotsNear(furniture, walkable, 'BIN')[0] ?? machine[0] ?? null;
  // The game's cabinet is its lower row (the TV above it is only picture).
  const tv = of('VIDEO_GAME')[0];
  const screen = tv ? { col: tv.col, row: tv.row + 1 } : null;
  const poufs = screen
    ? of('POUF')
        .map((p) => ({ col: p.col, row: p.row }))
        .filter((p) => stepsBetween(p, screen) <= GAME_REACH_TILES)
    : [];
  const game = screen && poufs.length > 0 ? { at: screen, poufs } : null;
  return { machine, table: tables[0] ?? null, sip: coffeeSpots(furniture, walkable), dock, game };
}

/** Where one drinks: at the table when there is one, else by the coffee on a table. */
export function drinkingSpots(corner: CoffeeCorner): Tile[] {
  return corner.table?.spots ?? corner.sip;
}

/**
 * A round of the cleaning robot: the table first (where it takes the cups),
 * then a couple of places on the floor around it. It goes back to its dock by itself.
 */
export function robotRound(
  corner: CoffeeCorner,
  walkable: readonly Tile[],
  rand: () => number = Math.random,
): { stops: Tile[]; cleanAt: Tile | null } {
  const cleanAt = corner.table?.spots[0] ?? null;
  const around = cleanAt ?? corner.dock;
  const floor = around
    ? walkable.filter((t) => {
        const d = stepsBetween(t, around);
        return d > 0 && d <= ROBOT_REACH_TILES;
      })
    : [];
  const stops: Tile[] = cleanAt ? [cleanAt] : [];
  for (let i = 0; i < ROBOT_FLOOR_STOPS && floor.length > 0; i++) {
    stops.push(floor.splice(Math.floor(rand() * floor.length), 1)[0]);
  }
  return { stops, cleanAt };
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
