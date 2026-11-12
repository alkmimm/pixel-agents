/**
 * pixel-agents-secure (local): small things that make the office less still,
 * each saying something true or harmless about its agents. All of it is drawn
 * on the canvas, from what the office already knows; nothing is sent anywhere.
 *
 * With "Nível por modelo" (`gearFx`), a character at work now and then shows
 * its class's effect: sparks over the mage's hat, a gleam across the knight's
 * helm, an arrow from the archer's quiver. The squire has none. Rare on
 * purpose: about one in GEAR_FX_EVERY_SEC of work, per character.
 *
 * With "Vida no escritório" (`greet`, `helpers`; each has its own option):
 * - two agents that walk past each other sometimes greet (a note over each);
 * - a helper (sub-agent) that finishes its task hops once;
 * - helpers standing idle side by side sometimes turn to each other for a
 *   word, or just look around, instead of standing in a stiff row.
 *
 * Pure but for the characters it changes: `rand` is injected for the tests.
 */
import { gearParts } from '../../viewer/modelLevel.js';
import { CharacterState, Direction } from '../types.js';

export type FxKind = 'sparks' | 'gleam' | 'arrow' | 'note' | 'dots';

/** How long each effect plays. */
export const FX_SEC: Record<FxKind, number> = {
  sparks: 1.6,
  gleam: 0.7,
  arrow: 0.7,
  note: 1.6,
  dots: 3,
};
/** A character at work shows its class's effect about once in this long. */
export const GEAR_FX_EVERY_SEC = 30;
/** After meeting someone, a character greets no one else for this long. */
export const GREET_COOLDOWN_SEC = 45;
/** Walking past someone without greeting: not asked again for this long. */
const GREET_PASS_SEC = 4;
/** Two walkers this close (in steps) are passing each other. */
const GREET_REACH_TILES = 1;
/** Half the meetings end in a greeting. */
const GREET_CHANCE = 0.5;
export const HOP_SEC = 0.45;
const HOP_HEIGHT_PX = 4;
/** An idle helper fidgets about once in this long. */
export const FIDGET_EVERY_SEC = 14;
const FIDGET_COOLDOWN_SEC = 8;
/** Helpers this close (in steps) can turn to each other. */
const WORD_REACH_TILES = 2;
/** With a neighbour at hand, this share of the fidgets is a word with it. */
const WORD_CHANCE = 0.6;
const WORD_SEC = FX_SEC.dots;
const LOOK_AROUND_SEC = 1.5;

/** What liveliness keeps on each character. */
export interface Liveliness {
  /** The effect playing over it, and for how long it has. */
  fx: { kind: FxKind; age: number } | null;
  /** Time left of a hop. */
  hopSec: number;
  /** While positive, an idle helper faces `glanceDir` instead of its lead's way. */
  glanceSec: number;
  glanceDir: Direction;
  /** Time until it may greet or fidget again. */
  socialCoolSec: number;
  /** Whether it was working at the last tick (to see a helper finish). */
  wasActive: boolean;
  /** A cup in its hand, on the way from the coffee machine (viewer/useOfficeLife.ts). */
  carrying: boolean;
  /** A seat that is not its own, where it sits a while (a sofa with its coffee, a pouf at
   *  the video game): walking to it until `seated`, then sat for `sec` (officeState.ts). */
  guestSeat: { uid: string; sec: number; seated: boolean; facing: Direction | null } | null;
}

export function startLiveliness(): Liveliness {
  return {
    fx: null,
    hopSec: 0,
    glanceSec: 0,
    glanceDir: Direction.DOWN,
    socialCoolSec: 0,
    wasActive: false,
    carrying: false,
    guestSeat: null,
  };
}

/** Which of it is on (App.tsx, from the viewer's options). */
export interface LivelinessOptions {
  /** Class effects at work. */
  gearFx: boolean;
  /** Greetings between agents walking past each other. */
  greet: boolean;
  /** Helpers that hop when done, talk and look around. */
  helpers: boolean;
}

export const NO_LIVELINESS: LivelinessOptions = { gearFx: false, greet: false, helpers: false };

/** What liveliness reads and writes of a character. */
export interface Lively extends Liveliness {
  id: number;
  state: CharacterState;
  dir: Direction;
  tileCol: number;
  tileRow: number;
  isActive: boolean;
  isSubagent: boolean;
  parentAgentId: number | null;
  gear: number;
  matrixEffect: 'spawn' | 'despawn' | null;
}

const CLASS_FX: Record<string, FxKind | undefined> = {
  fable: 'sparks',
  opus: 'gleam',
  sonnet: 'arrow',
};

/** The effect a gear's class shows at work, if it has one. */
export function gearFxKind(gear: number): FxKind | undefined {
  const tier = gearParts(gear)?.tier;
  return tier ? CLASS_FX[tier] : undefined;
}

const steps = (a: Lively, b: Lively) =>
  Math.abs(a.tileCol - b.tileCol) + Math.abs(a.tileRow - b.tileRow);

/** The way `from` turns to face `to`. */
export function facing(from: Lively, to: Lively): Direction {
  const dc = to.tileCol - from.tileCol;
  const dr = to.tileRow - from.tileRow;
  if (Math.abs(dc) >= Math.abs(dr) && dc !== 0) return dc > 0 ? Direction.RIGHT : Direction.LEFT;
  return dr < 0 ? Direction.UP : Direction.DOWN;
}

const play = (ch: Lively, kind: FxKind) => {
  ch.fx = { kind, age: 0 };
};

/** One frame of liveliness for every character. */
export function tickLiveliness(
  characters: Iterable<Lively>,
  dt: number,
  options: LivelinessOptions,
  rand: () => number = Math.random,
): void {
  const all = [...characters].filter((ch) => !ch.matrixEffect);
  for (const ch of all) {
    if (ch.fx) {
      ch.fx.age += dt;
      if (ch.fx.age >= FX_SEC[ch.fx.kind]) ch.fx = null;
    }
    ch.hopSec = Math.max(0, ch.hopSec - dt);
    ch.glanceSec = Math.max(0, ch.glanceSec - dt);
    ch.socialCoolSec = Math.max(0, ch.socialCoolSec - dt);
  }

  if (options.gearFx) {
    for (const ch of all) {
      const kind = gearFxKind(ch.gear);
      const atWork = ch.isActive && ch.state === CharacterState.TYPE;
      if (kind && atWork && !ch.fx && rand() < dt / GEAR_FX_EVERY_SEC) play(ch, kind);
    }
  }

  if (options.greet) greetInPassing(all, rand);
  if (options.helpers) {
    for (const ch of all) {
      if (!ch.isSubagent) continue;
      if (ch.wasActive && !ch.isActive) ch.hopSec = HOP_SEC;
      if (ch.state !== CharacterState.IDLE || ch.socialCoolSec > 0) continue;
      if (rand() < dt / FIDGET_EVERY_SEC) fidget(ch, all, rand);
    }
  }
  for (const ch of all) ch.wasActive = ch.isActive;
}

/** Two agents walking past each other: sometimes a note over each. */
function greetInPassing(all: Lively[], rand: () => number): void {
  const walkers = all.filter(
    (ch) => !ch.isSubagent && ch.state === CharacterState.WALK && ch.socialCoolSec <= 0,
  );
  for (let i = 0; i < walkers.length; i++) {
    const a = walkers[i];
    if (a.socialCoolSec > 0) continue;
    const b = walkers.find(
      (o, j) => j > i && o.socialCoolSec <= 0 && steps(a, o) <= GREET_REACH_TILES,
    );
    if (!b) continue;
    // Decided once per meeting, not once per frame of it.
    const greet = rand() < GREET_CHANCE;
    for (const ch of [a, b]) {
      ch.socialCoolSec = greet ? GREET_COOLDOWN_SEC : GREET_PASS_SEC;
      if (greet) play(ch, 'note');
    }
  }
}

/** An idle helper: a word with a neighbour of its own team, or a look around. */
function fidget(ch: Lively, all: Lively[], rand: () => number): void {
  ch.socialCoolSec = FIDGET_COOLDOWN_SEC;
  const neighbour = all.find(
    (o) =>
      o !== ch &&
      o.isSubagent &&
      o.parentAgentId === ch.parentAgentId &&
      o.state === CharacterState.IDLE &&
      o.socialCoolSec <= 0 &&
      steps(ch, o) >= 1 &&
      steps(ch, o) <= WORD_REACH_TILES,
  );
  if (neighbour && rand() < WORD_CHANCE) {
    for (const [one, other] of [
      [ch, neighbour],
      [neighbour, ch],
    ] as const) {
      one.glanceSec = WORD_SEC;
      one.glanceDir = facing(one, other);
      one.socialCoolSec = WORD_SEC + FIDGET_COOLDOWN_SEC;
      play(one, 'dots');
    }
    return;
  }
  const ways = [Direction.DOWN, Direction.LEFT, Direction.RIGHT].filter((d) => d !== ch.dir);
  ch.glanceSec = LOOK_AROUND_SEC;
  ch.glanceDir = ways[Math.floor(rand() * ways.length)] ?? Direction.DOWN;
}

/** How far up (sprite pixels) a hop lifts a character right now. */
export function hopLift(hopSec: number): number {
  if (hopSec <= 0) return 0;
  const p = 1 - hopSec / HOP_SEC;
  return Math.round(4 * p * (1 - p) * HOP_HEIGHT_PX);
}

/** Whether anything here is moving (the office draws at its full rate then). */
export function isLively(ch: Liveliness): boolean {
  return ch.fx !== null || ch.hopSec > 0;
}

// ── Drawing ─────────────────────────────────────────────────────

export interface FxPixel {
  /** Sprite pixels from the character's cell (16 wide; y may be above it). */
  x: number;
  y: number;
  color: string;
}

const CYAN = '#7fe9ff';
const WHITE = '#ffffff';
const WOOD = '#c9965a';
const RED = '#d23a3a';
const NOTE = '#fff2a8';
const NOTE_ROWS = ['..##.', '..#.#', '..#..', '.##..', '###..', '.#...'];

/** Where the head starts in the character's cell, for its pose. */
export function headTop(state: CharacterState, dir: Direction): number {
  if (dir === Direction.LEFT || dir === Direction.RIGHT) return 5;
  // Seated, a character facing the viewer sits lower in its cell.
  return state === CharacterState.TYPE && dir === Direction.DOWN ? 7 : 2;
}

const CUP = '#f4f4f4';
const COFFEE = '#6b3f1d';
/** The cup a character carries, at its hand, for a head starting at row `top`. */
export function carriedCupPixels(top: number, dir: Direction): FxPixel[] {
  const side = dir === Direction.LEFT || dir === Direction.RIGHT;
  // In front of the body, at the height of the hands.
  const x = side ? 10 : 7;
  const y = top + (side ? 13 : 16);
  return [
    { x, y, color: CUP },
    { x: x + 1, y, color: COFFEE },
    { x: x + 2, y, color: CUP },
    { x, y: y + 1, color: CUP },
    { x: x + 1, y: y + 1, color: CUP },
    { x: x + 2, y: y + 1, color: CUP },
  ];
}

/** An effect's pixels at `age` seconds, for a head starting at row `top`. */
export function fxPixels(kind: FxKind, age: number, top: number): FxPixel[] {
  const p = Math.min(1, Math.max(0, age / FX_SEC[kind]));
  switch (kind) {
    case 'sparks': {
      // Three sparks rising past the hat, each a little after the other.
      const out: FxPixel[] = [];
      [4, 11, 7].forEach((x, i) => {
        const own = p * 1.4 - i * 0.2;
        if (own <= 0 || own >= 1) return;
        const y = top + 2 - Math.round(own * 8);
        out.push({ x, y, color: own < 0.5 ? WHITE : CYAN });
        if (own > 0.25) out.push({ x, y: y + 1, color: CYAN });
      });
      return out;
    }
    case 'gleam': {
      // A streak of light crossing the helm.
      const x = 3 + Math.round(p * 10);
      return [0, 1, 2]
        .map((i) => ({ x: x - i, y: top + 2 + i, color: WHITE }))
        .filter((px) => px.x >= 3 && px.x <= 12);
    }
    case 'arrow': {
      // An arrow leaving the quiver, straight up.
      const y = top + 7 - Math.round(p * 14);
      return [
        { x: 13, y, color: WHITE },
        { x: 13, y: y + 1, color: WOOD },
        { x: 13, y: y + 2, color: WOOD },
        { x: 13, y: y + 3, color: RED },
      ];
    }
    case 'note': {
      // A note over the head, rising a little as it goes.
      const y0 = top - 8 - Math.round(p * 2);
      const out: FxPixel[] = [];
      NOTE_ROWS.forEach((row, y) => {
        [...row].forEach((c, x) => {
          if (c === '#') out.push({ x: 6 + x, y: y0 + y, color: NOTE });
        });
      });
      return out;
    }
    case 'dots': {
      // "…", one dot after the other, each two pixels a side.
      const shown = Math.min(3, 1 + Math.floor(p * 4));
      return [4, 7, 10].slice(0, shown).flatMap((x) =>
        [0, 1].flatMap((dx) => [0, 1].map((dy) => ({ x: x + dx, y: top - 5 + dy, color: WHITE }))),
      );
    }
  }
}
