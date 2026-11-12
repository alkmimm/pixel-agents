/**
 * pixel-agents-secure (local): the office's director. One place that knows
 * where every agent is and what it is in the middle of, and decides what the
 * idle ones do: a coffee, the video game, a nap, a word in the corridor, and
 * things two of them do together (one asks the other along, they greet, and
 * go for a coffee or a game as a pair). The cleaning robot and the pet's
 * visits are its too.
 *
 * It is the office's side of "Vida no escritório": the rules that say when
 * are in officeLife.ts (pure), what moves and is drawn is in office/engine/.
 * Nothing here is React: useOfficeLife.ts only calls `look` once a second.
 * `now` and `rand` are given, so that it runs in a test with no screen.
 * Nothing is saved or sent anywhere.
 */
import { createRobot, robotIsOut, sendRobot } from '../office/engine/coffeeCorner.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { CharacterState, Direction, TILE_SIZE } from '../office/types.js';
import { isWaiting } from './agentGroups.js';
import {
  CHAT_SEC,
  chatPairs,
  COFFEE_SIP_SEC,
  COFFEE_SIT_SEC,
  coffeeChance,
  type CoffeeCorner,
  coffeeCorner,
  drinkingSpots,
  followTurn,
  GAME_SEC,
  gameChance,
  isSleepy,
  MOOD,
  POUR_SEC,
  QUEUE_MAX_MS,
  queueSpots,
  ROBOT_CUP_WAIT_MS,
  ROBOT_CUPS_FULL,
  ROBOT_EVERY_MS,
  robotRound,
  seatAtTable,
  type TurnMemo,
  wayTo,
} from './officeLife.js';
import type { StatusLike } from './signalText.js';

/** How often the director looks at the office. */
export const LOOK_MS = 1_000;
const PARTY_MS = 5_000;
/** Two idle agents standing close talk about once in this many looks. */
const CHAT_ONE_IN = 20;
/** A pet sets off to whoever waits about once in this many looks. */
const PET_VISIT_ONE_IN = 45;
const PET_VISIT_MAX_SEC = 40;
/** The cleaning robot's first round after the option is turned on. */
const ROBOT_FIRST_MS = 60_000;
const POUR_HOLD_SLACK_SEC = 3;
/** While one waits its turn at the machine, it is held this long at each look. */
const QUEUE_HOLD_SEC = 3;
/** This share of the coffees and games is with someone asked along, when someone is free. */
export const PAIR_CHANCE = 0.5;
/** The inviter stops this close (in steps) to whom it asks. */
const PAIR_REACH_TILES = 2;
/** Whoever is asked stays put this long at each look, while its mate walks up... */
const PAIR_HOLD_SEC = 5;
/** ...and no longer than this in all. */
const INVITE_MAX_MS = 45_000;
/** The word between the two before they go. */
export const GREET_MS = 2_500;
/** A pair sits longer over its coffee (the second comes after the first), and plays longer. */
export const PAIR_SIT_SEC = 40;
export const PAIR_GAME_SEC = 40;
/** Over their coffee, the word passes from one to the other this often. */
const PAIR_TALK_MS = 3_000;
const FACING = {
  up: Direction.UP,
  down: Direction.DOWN,
  left: Direction.LEFT,
  right: Direction.RIGHT,
} as const;

type Tile = { col: number; row: number };
/** An agent's state, as far as the director reads it. */
export type StatusOf = (
  office: OfficeState,
  id: number,
  tools: Record<number, ToolActivity[]>,
) => { tone: StatusLike['tone']; since?: number };
/** What two agents can do together. */
export type Plan = 'coffee' | 'game';
type Stage =
  | 'invite'
  | 'invited'
  | 'greet'
  | 'queue'
  | 'machine'
  | 'pour'
  | 'walk'
  | 'sip'
  | 'to-game'
  | 'play';
/** The stages in which a pair is still getting together. */
const PAIRING: ReadonlySet<Stage> = new Set(['invite', 'invited', 'greet']);

/** What an agent is in the middle of. A coffee: to the machine (or its line), a
 *  cup filled, to the table, a sip; without a machine it starts at 'walk'. */
interface Trip {
  spot: Tile;
  stage: Stage;
  /** Waiting for the machine: its turn (lower goes first) and since when (ms). */
  turn?: number;
  queuedAt?: number;
  /** It goes to (or is in) a seat for this, not a place to stand. */
  seated?: boolean;
  /** When this stage ends (ms). */
  until?: number;
  /** The table the cup is left on, when it is drunk at one. */
  table?: Tile;
  /** Who it does this with, and (while they get together) what they are going to do. */
  mate?: number;
  plan?: Plan;
  /** It set off as one of a pair. */
  pair?: boolean;
}

/** Which of it is on (Opções → Novidades → Vida no escritório, each part its own switch). */
export interface LifeParts {
  coffee: boolean;
  sleep: boolean;
  party: boolean;
  chat: boolean;
  pet: boolean;
  /** The cleaning robot. */
  robot: boolean;
  /** The video game, from a pouf. */
  game: boolean;
  /** Idle agents leave their desks more. */
  roam: boolean;
  /** Two agents going for a coffee or a game together. */
  pairs: boolean;
}
export const ALL_PARTS: LifeParts = {
  coffee: true,
  sleep: true,
  party: true,
  chat: true,
  pet: true,
  robot: true,
  game: true,
  roam: true,
  pairs: true,
};

export class OfficeDirector {
  /** The mood drawn over each head, and until when (ms). */
  readonly moods = new Map<number, { text: string; until: number }>();
  private readonly memos = new Map<number, TurnMemo>();
  private readonly trips = new Map<number, Trip>();
  private readonly petVisits = new Map<string, number>();
  private corner: CoffeeCorner = { machine: [], table: null, sip: [], dock: null, game: null };
  private spotsOf: OfficeLayout | null = null;
  /** The machine's own tile, to face it. */
  private machineAt: Tile | null = null;
  private nextTurn = 0;
  private lastLook: number;
  private nextRound: number;
  /** A full table calls the robot at once, but not again right after a round (one
   *  that could not reach the table would otherwise never stop). */
  private fullRoundAfter = 0;
  private wish: { a: number; b: number; plan: Plan } | null = null;
  /** Since when there are cups on the table (ms), for the robot. */
  private cupsSince: number | null = null;
  /** Each idle agent's stroll: since when it stands (ms), how long it stays, and how many
   *  walks it has left before going back to its chair. */
  private readonly strolls = new Map<number, { idleSince?: number; pauseMs: number; left: number }>();
  /** Until when an agent was told to stay where it is (ms). */
  private readonly heldUntil = new Map<number, number>();

  private readonly office: () => OfficeState;
  private readonly statusOf: StatusOf;
  private readonly rand: () => number;

  /**
   * @param statusOf An agent's state as the office shows it (agentStatus.ts); given, not
   *   imported, so that the director needs nothing of the browser.
   */
  constructor(
    office: () => OfficeState,
    statusOf: StatusOf,
    now: number = Date.now(),
    rand: () => number = Math.random,
  ) {
    this.office = office;
    this.statusOf = statusOf;
    this.rand = rand;
    this.lastLook = now;
    // The first round comes soon, so the robot is seen at work.
    this.nextRound = now + ROBOT_FIRST_MS;
  }

  private readonly pick = <T>(items: readonly T[]): T | undefined =>
    items[Math.floor(this.rand() * items.length)];

  /** What this leaves in the office goes with it. */
  clearOffice(): void {
    const os = this.office();
    os.cups = [];
    os.robot = null;
    os.roam = false;
    os.directed = false;
    for (const ch of os.characters.values()) {
      ch.carrying = false;
      ch.guestSeat = null;
    }
  }

  private strollOf(id: number): { idleSince?: number; pauseMs: number; left: number } {
    let stroll = this.strolls.get(id);
    if (!stroll) {
      stroll = { pauseMs: 0, left: 0 };
      this.strolls.set(id, stroll);
    }
    return stroll;
  }

  /**
   * An idle agent's stroll, one look of it. Resting in its chair, nothing: the
   * engine stands it up when the rest is over. Standing, it stays a while where
   * it is, then walks to somewhere that makes sense (officeState.strollSpot)
   * that nobody else has; after a few walks, back to its chair.
   */
  private stroll(os: OfficeState, id: number, now: number, free: (tile: Tile) => boolean): void {
    const ch = os.characters.get(id);
    if (!ch) return;
    const stroll = this.strollOf(id);
    const pace = os.strollPace();
    const between = (min: number, max: number) => min + this.rand() * (max - min);
    if (ch.state !== CharacterState.IDLE) {
      stroll.idleSince = undefined;
      if (ch.state === CharacterState.TYPE) {
        stroll.left = Math.round(between(pace.movesMin, pace.movesMax));
      }
      return;
    }
    if (stroll.idleSince === undefined) {
      stroll.idleSince = now;
      stroll.pauseMs = between(pace.pauseMinSec, pace.pauseMaxSec) * 1000;
    }
    if (now < (this.heldUntil.get(id) ?? 0) || now - stroll.idleSince < stroll.pauseMs) return;
    if (stroll.left <= 0 && ch.seatId && os.sendHome(id)) {
      stroll.idleSince = undefined;
      return;
    }
    const spot = os.strollSpot(id, free, this.rand);
    if (spot && os.sendOnErrand(id, spot.col, spot.row)) {
      stroll.left--;
      stroll.idleSince = undefined;
    } else {
      stroll.idleSince = now; // nowhere to go just now: asked again after another pause
    }
  }

  /** The mood over an agent's head now, if any. */
  moodOf(id: number, now: number): string | undefined {
    const mood = this.moods.get(id);
    return mood && mood.until > now ? mood.text : undefined;
  }

  /** What an agent is in the middle of (a stage of a trip), if anything. */
  activityOf(id: number): string | undefined {
    return this.trips.get(id)?.stage;
  }

  /** Ask for `a` to invite `b` along, at the next look. */
  pairUp(a: number, b: number, plan: Plan): void {
    this.wish = { a, b, plan };
  }

  /** One look at the office: move every trip on, and start what is due. */
  look(now: number, ids: readonly number[], tools: Record<number, ToolActivity[]>, on: LifeParts): void {
    const os = this.office();
    const elapsed = now - this.lastLook;
    this.lastLook = now;
    const { trips, memos, petVisits } = this;

    const pick = this.pick;
    const mood = (id: number, text: string, ms: number) =>
      this.moods.set(id, { text, until: now + ms });
    const hasMood = (id: number) => (this.moods.get(id)?.until ?? 0) > now;

    if (os.getLayout() !== this.spotsOf) {
      const was = this.spotsOf
        ? { machine: this.machineAt, table: this.corner.table?.at ?? null }
        : null;
      this.spotsOf = os.getLayout();
      // Only where one can walk to: floor closed off by furniture is no place to stand.
      this.corner = coffeeCorner(this.spotsOf.furniture, os.reachableTiles);
      const m = this.spotsOf.furniture.find((f) => f.type.split(':')[0] === 'COFFEE_MACHINE');
      this.machineAt = m ? { col: m.col, row: m.row } : null;
      // Rooms opened or closed and the rest moved along (officeState.applyRooms): the
      // same coffee corner, moved, and what is under way goes on. Anything else is
      // a new office, and what the director left in the old one goes with it.
      const shift = os.carriedShift(this.spotsOf);
      const moved = (t: Tile): Tile =>
        shift ? { col: t.col + shift.col, row: t.row + shift.row } : t;
      const same = (a: Tile | null, b: Tile | null): boolean =>
        a === null || b === null ? a === b : moved(a).col === b.col && moved(a).row === b.row;
      if (
        shift !== null &&
        was !== null &&
        same(was.machine, this.machineAt) &&
        same(was.table, this.corner.table?.at ?? null)
      ) {
        for (const trip of trips.values()) {
          trip.spot = moved(trip.spot);
          if (trip.table) trip.table = moved(trip.table);
        }
      } else {
        trips.clear();
        this.clearOffice();
      }
    }
    const corner = this.corner;
    // The director is in charge of who strolls where: the engine's own stroll is off
    // (after the layout check: a new layout clears what the director left).
    os.directed = true;
    const machineAt = this.machineAt;

    os.roam = on.roam;

    const alive = new Set(ids);
    for (const id of [...memos.keys()]) if (!alive.has(id)) memos.delete(id);
    for (const id of [...this.moods.keys()]) if (!alive.has(id)) this.moods.delete(id);

    const standing: Array<{ id: number; col: number; row: number }> = [];
    // Conflicts: who else is at, or on the way to, a place.
    const at = (t: Tile, col: number, row: number) => t.col === col && t.row === row;
    /** Someone else's trip ends at this tile, or someone else stands on it. */
    const claimed = (tile: Tile, self: number): boolean => {
      for (const [other, t] of trips) {
        if (other !== self && at(tile, t.spot.col, t.spot.row)) return true;
      }
      for (const other of os.characters.values()) {
        if (other.id === self || other.state === CharacterState.WALK) continue;
        if (at(tile, other.tileCol, other.tileRow)) return true;
      }
      return false;
    };
    /** Someone else is at the machine, or on the way to it for a cup. */
    const machineBusy = (self: number): boolean => {
      for (const [other, t] of trips) {
        if (other !== self && (t.stage === 'machine' || t.stage === 'pour')) return true;
      }
      return corner.machine.some((front) => claimed(front, self));
    };
    const faceMachine = (from: Tile) =>
      machineAt ? FACING[wayTo(from, machineAt)] : Direction.UP;
    const shuffled = <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    let longestWaiting: { id: number; since: number } | null = null;
    const steps = (a: Tile, b: Tile) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
    /** Keep a standing agent where it is: the director's own strolls wait for it too. */
    const holdStill = (id: number, sec: number, thenHome: boolean) => {
      os.holdStill(id, sec, thenHome);
      this.heldUntil.set(id, now + sec * 1000);
      if (thenHome) this.strollOf(id).left = 0;
    };
    const tileOf = (ch: { tileCol: number; tileRow: number }): Tile => ({
      col: ch.tileCol,
      row: ch.tileRow,
    });
    const freePoufs = () => {
      const game = corner.game;
      if (!game) return [];
      return os
        .freeSeats()
        .filter(
          (s) =>
            game.poufs.some((p) => p.col === s.col && p.row === s.row) && os.seatReachable(s.uid),
        );
    };
    /** Walk an agent to a tile; one already standing there needs no walk. */
    const goTo = (id: number, tile: Tile): boolean => {
      const ch = os.characters.get(id);
      if (
        ch &&
        ch.state === CharacterState.IDLE &&
        ch.tileCol === tile.col &&
        ch.tileRow === tile.row
      ) {
        return true;
      }
      return os.sendOnErrand(id, tile.col, tile.row);
    };

    /** Set an agent off for a coffee: to the machine, or to its line when someone is there. */
    const startCoffee = (id: number, mate?: number): boolean => {
      const with_ = mate === undefined ? {} : { mate, pair: true };
      const atMachine = corner.machine.length > 0;
      if (atMachine && machineBusy(id)) {
        // Someone is at the machine: wait by it, when there is room to (every free
        // place is tried: the way to one may be shut).
        const spot = queueSpots(corner.machine[0], os.reachableTiles)
          .filter((q) => !claimed(q, id))
          .find((q) => goTo(id, q));
        if (!spot) return false;
        trips.set(id, { spot, stage: 'queue', turn: this.nextTurn++, queuedAt: now, ...with_ });
        return true;
      }
      const spot = pick(atMachine ? corner.machine : drinkingSpots(corner));
      if (!spot || !goTo(id, spot)) return false;
      trips.set(id, { spot, stage: atMachine ? 'machine' : 'walk', ...with_ });
      return true;
    };
    /** Sit an agent on a free pouf by the video game, facing the screen. */
    const startGame = (id: number, mate?: number): boolean => {
      const game = corner.game;
      if (!game) return false;
      const sec = mate === undefined ? GAME_SEC : PAIR_GAME_SEC;
      const pouf = shuffled(freePoufs()).find((s) =>
        os.sitAsGuest(id, s.uid, sec, FACING[wayTo(s, game.at)]),
      );
      if (!pouf) return false;
      const with_ = mate === undefined ? {} : { mate, pair: true };
      trips.set(id, { spot: { col: pouf.col, row: pouf.row }, stage: 'to-game', seated: true, ...with_ });
      return true;
    };
    const start = (id: number, plan: Plan, mate?: number): boolean =>
      plan === 'coffee' ? startCoffee(id, mate) : startGame(id, mate);

    /** Whether an agent is free to be asked along: idle, not asleep, with nothing under way. */
    const freeFor = (other: number): boolean => {
      const o = os.characters.get(other);
      if (!o || o.isSubagent || o.matrixEffect || o.isActive) return false;
      if (o.state === CharacterState.WALK || o.guestSeat || trips.has(other) || hasMood(other)) {
        return false;
      }
      const status = this.statusOf(os, other, tools);
      return !isSleepy(status.tone, status.since, now);
    };
    /** The nearest agent free to come along. */
    const findMate = (id: number): number | undefined => {
      const me = os.characters.get(id);
      if (!me) return undefined;
      let best: number | undefined;
      let bestSteps = Infinity;
      for (const other of ids) {
        if (other === id || !freeFor(other)) continue;
        const d = steps(tileOf(me), tileOf(os.characters.get(other)!));
        if (d < bestSteps) {
          best = other;
          bestSteps = d;
        }
      }
      return best;
    };
    /** Hold an agent where it is (in its chair, or standing) a little longer. */
    const stay = (id: number, sec: number) => {
      if (!os.holdSeat(id, sec)) holdStill(id, sec, false);
    };
    /**
     * `a` asks `b` along: `a` walks up to `b`, who stays; they greet, and then
     * each sets off for the plan, as a pair.
     */
    const invite = (a: number, b: number, plan: Plan): boolean => {
      const A = os.characters.get(a);
      const B = os.characters.get(b);
      if (!A || !B || a === b || trips.has(a) || !freeFor(b)) return false;
      if (A.isActive || A.state === CharacterState.WALK) return false;
      if (plan === 'game' && freePoufs().length < 2) return false;
      if (plan === 'coffee' && corner.machine.length === 0 && drinkingSpots(corner).length === 0) {
        return false;
      }
      const here = tileOf(A);
      const there = tileOf(B);
      let spot: Tile | undefined;
      if (A.state === CharacterState.IDLE && steps(here, there) >= 1 && steps(here, there) <= PAIR_REACH_TILES) {
        spot = here; // already beside it
      holdStill(a, PAIR_HOLD_SEC, false);
      } else {
        spot = os.reachableTiles
          .filter((t) => {
            const d = steps(t, there);
            return d >= 1 && d <= PAIR_REACH_TILES && !claimed(t, a);
          })
          .sort((x, y) => steps(x, there) - steps(y, there) || steps(x, here) - steps(y, here))
          .find((t) => os.sendOnErrand(a, t.col, t.row));
      }
      if (!spot) return false;
      trips.set(a, { spot: { col: spot.col, row: spot.row }, stage: 'invite', mate: b, plan });
      trips.set(b, { spot: there, stage: 'invited', mate: a, plan, until: now + INVITE_MAX_MS });
      stay(b, PAIR_HOLD_SEC);
      return true;
    };
    /** Whether a pairing trip still has its other half. */
    const paired = (id: number, trip: Trip): boolean => {
      const other = trip.mate === undefined ? undefined : trips.get(trip.mate);
      return other !== undefined && other.mate === id && PAIRING.has(other.stage);
    };
    /** The inviter reached its mate: a word between the two before they go. */
    const greet = (id: number, trip: Trip): void => {
      const mate = trip.mate;
      const other = mate === undefined ? undefined : trips.get(mate);
      const A = os.characters.get(id);
      const B = mate === undefined ? undefined : os.characters.get(mate);
      if (mate === undefined || !other || !A || !B) return;
      for (const t of [trip, other]) {
        t.stage = 'greet';
        t.until = now + GREET_MS;
      }
      holdStill(id, GREET_MS / 1000 + 1, false);
      os.turnTo(id, FACING[wayTo(tileOf(A), tileOf(B))]);
      stay(mate, GREET_MS / 1000 + 1);
      os.turnTo(mate, FACING[wayTo(tileOf(B), tileOf(A))]);
      mood(id, `${trip.plan === 'game' ? MOOD.game : MOOD.coffee}?`, GREET_MS);
      mood(mate, MOOD.yes, GREET_MS);
    };
    // A pair asked for from outside (a test, or a later way to ask).
    if (this.wish) {
      const { a, b, plan } = this.wish;
      this.wish = null;
      invite(a, b, plan);
    }

    for (const id of ids) {
      const ch = os.characters.get(id);
      if (!ch || ch.isSubagent || ch.matrixEffect) continue;
      const status = this.statusOf(os, id, tools);

      const turn = followTurn(memos.get(id), status.tone, now);
      memos.set(id, turn.memo);
      if (turn.celebrate && on.party) mood(id, MOOD.party, PARTY_MS);

      if (isWaiting(status.tone)) {
        const since = status.since ?? now;
        if (!longestWaiting || since < longestWaiting.since) longestWaiting = { id, since };
      }

      // A coffee trip under way.
      const trip = trips.get(id);
      // On an errand it is let through; with a cup in its hand, more so.
      ch.rightOfWay = trip ? (ch.carrying ? 2 : 1) : 0;
      if (trip) {
        // At a seat: sat down in it. At a place to stand: standing there.
        const arrived = trip.seated
          ? ch.guestSeat?.seated === true
          : ch.tileCol === trip.spot.col &&
            ch.tileRow === trip.spot.row &&
            ch.state === CharacterState.IDLE;
        // On the way to a seat it gave up on (taken, or no way there).
        const lostSeat = trip.seated === true && ch.guestSeat === null;
        const end = () => {
          trips.delete(id);
          ch.carrying = false;
        };
        const sitSec = trip.pair ? PAIR_SIT_SEC : COFFEE_SIT_SEC;
        const sip = () => {
          trip.stage = 'sip';
          // Seated, it drinks until just before it gets up by itself.
          const sec = trip.seated ? sitSec - 1 : COFFEE_SIP_SEC;
          trip.until = now + sec * 1000;
          if (!trip.seated) holdStill(id, COFFEE_SIP_SEC, true);
          mood(id, MOOD.coffee, sec * 1000);
        };
        if (ch.isActive) {
          // Called back to work: the cup is forgotten.
          end();
          this.moods.delete(id);
        } else if ((trip.stage === 'invite' || trip.stage === 'invited') && !paired(id, trip)) {
          end(); // its mate was called back to work, or gave up
          this.moods.delete(id);
        } else if (trip.stage === 'invited') {
          // Stays where it is while its mate walks up.
          if (now >= (trip.until ?? 0)) end();
          else stay(id, PAIR_HOLD_SEC);
        } else if (trip.stage === 'invite') {
          if (ch.state === CharacterState.WALK) {
            // on its way to its mate
          } else if (arrived) {
            greet(id, trip);
          } else {
            end(); // stopped somewhere else
          }
        } else if (trip.stage === 'greet') {
          if (now >= (trip.until ?? 0)) {
            // Each sets off, as a pair. One that cannot (no room left) goes back to its
            // day, and its mate goes on alone: it does not wait for it, or talk to nobody
            // (when the mate has not set off yet, it sets off alone).
            trips.delete(id);
            const mate = trip.mate;
            const went = trip.plan !== undefined && start(id, trip.plan, mate);
            const other = mate === undefined ? undefined : trips.get(mate);
            if (!went && other?.mate === id) other.mate = undefined;
          }
        } else if (trip.stage === 'play') {
          if (now >= (trip.until ?? 0) || ch.guestSeat === null) end();
        } else if (trip.stage === 'sip') {
          if (now >= (trip.until ?? 0) || lostSeat) {
            // Getting up, the cup stays on the table.
            if (ch.carrying && trip.table) os.placeCup(trip.table);
            end();
          } else if (trip.pair && trip.mate !== undefined && trips.get(trip.mate)?.stage === 'sip') {
            // The two of them over their coffee: a word from one, then the other.
            const mine = (Math.floor(now / PAIR_TALK_MS) + (id < trip.mate ? 0 : 1)) % 2 === 0;
            mood(id, mine ? MOOD.chat : MOOD.coffee, LOOK_MS * 2);
          }
        } else if (trip.stage === 'pour') {
          if (now >= (trip.until ?? 0)) {
            ch.carrying = true;
            // A free sofa seat at the table, to sit with the cup.
            const table = corner.table?.at;
            // Every free one is tried: the way to one may be shut.
            const seat = table
              ? shuffled(os.freeSeats().filter((s) => seatAtTable(s, table))).find((s) =>
                  os.sitAsGuest(id, s.uid, sitSec),
                )
              : undefined;
            // Standing, a place nobody else has or is going to, when there is one.
            const spots = drinkingSpots(corner);
            const to = pick(spots.filter((s) => !claimed(s, id))) ?? pick(spots);
            if (seat && table) {
              trip.spot = { col: seat.col, row: seat.row };
              trip.stage = 'walk';
              trip.seated = true;
              trip.table = table;
            } else if (to && goTo(id, to)) {
              trip.spot = to;
              trip.stage = 'walk';
              trip.table = corner.table?.at;
            } else {
              sip(); // nowhere to take it: drunk at the machine
            }
          }
        } else if (trip.stage === 'queue') {
          // Waiting its turn by the machine: the first to have come goes
          // to its front when nobody is there.
          const front = corner.machine[0];
          const first = ![...trips.values()].some(
            (t) => t.stage === 'queue' && (t.turn ?? 0) < (trip.turn ?? 0),
          );
          if (ch.state === CharacterState.WALK) {
            // on the way to its place in the line
          } else if (!arrived || now - (trip.queuedAt ?? now) > QUEUE_MAX_MS) {
            end(); // stopped somewhere else, or tired of waiting
          } else if (
            first &&
            front &&
            !machineBusy(id) &&
            goTo(id, front)
          ) {
            trip.spot = front;
            trip.stage = 'machine';
          } else {
            holdStill(id, QUEUE_HOLD_SEC, false);
            os.turnTo(id, faceMachine(trip.spot));
          }
        } else if (lostSeat) {
          end();
        } else if (arrived) {
          if (trip.stage === 'to-game') {
            trip.stage = 'play';
            const playSec = trip.pair ? PAIR_GAME_SEC : GAME_SEC;
            trip.until = now + (playSec - 1) * 1000;
            mood(id, MOOD.game, (playSec - 1) * 1000);
          } else if (trip.stage === 'machine') {
            trip.stage = 'pour';
            trip.until = now + POUR_SEC * 1000;
            // Held past the pour, so it is still here when the cup is full.
            holdStill(id, POUR_SEC + POUR_HOLD_SLACK_SEC, false);
            os.turnTo(id, faceMachine(trip.spot));
          } else {
            sip();
          }
        } else if (ch.state !== CharacterState.WALK && !trip.seated) {
          end(); // stopped on the way
        }
        continue;
      }
      if (ch.isActive || hasMood(id)) continue;

      if (on.sleep && isSleepy(status.tone, status.since, now)) {
        // Asleep: stays in its chair, once it is back in it.
        if (os.holdSeat(id, 5)) mood(id, MOOD.sleep, LOOK_MS * 2);
        continue;
      }
      if (ch.state === CharacterState.IDLE) {
        standing.push({ id, col: ch.tileCol, row: ch.tileRow });
      }
      const idle = ch.state !== CharacterState.WALK;
      const wantsCoffee = on.coffee && idle && this.rand() < coffeeChance(elapsed);
      const wantsGame =
        !wantsCoffee && on.game && corner.game !== null && idle && this.rand() < gameChance(elapsed);
      if (wantsCoffee || wantsGame) {
        const plan: Plan = wantsCoffee ? 'coffee' : 'game';
        // Sometimes it asks someone along instead of going alone.
        const mate = on.pairs && this.rand() < PAIR_CHANCE ? findMate(id) : undefined;
        if (mate === undefined || !invite(id, mate, plan)) start(id, plan);
      }
      // With nothing else to do, a stroll now and then, and back to its chair.
      if (!trips.has(id)) this.stroll(os, id, now, (t) => !claimed(t, id));
    }

    for (const [a, b] of chatPairs(standing)) {
      if (!on.chat || trips.has(a) || trips.has(b) || this.rand() >= 1 / CHAT_ONE_IN) continue;
      for (const id of [a, b]) {
        holdStill(id, CHAT_SEC, false);
        mood(id, MOOD.chat, CHAT_SEC * 1000);
      }
    }

    // The cleaning robot: at its dock, and out on a round now and then, or
    // at once when the table is full of cups.
    if (on.robot && corner.dock) {
      const dock = corner.dock;
      if (!os.robot || os.robot.dock.col !== dock.col || os.robot.dock.row !== dock.row) {
        os.robot = createRobot(dock);
      }
      // Cups on the table call it: at once when they are a few, and soon when
      // it is one alone.
      if (os.cups.length === 0) this.cupsSince = null;
      else this.cupsSince ??= now;
      const cupsWait =
        os.cups.length >= ROBOT_CUPS_FULL ||
        (this.cupsSince !== null && now - this.cupsSince >= ROBOT_CUP_WAIT_MS);
      const due = now >= this.nextRound || (cupsWait && now >= this.fullRoundAfter);
      if (due && !robotIsOut(os.robot)) {
        const round = robotRound(corner, os.reachableTiles);
        // Its arms reach for the middle of the table (two tiles a side).
        const table = corner.table?.at;
        const reachTo = table
          ? { x: (table.col + 1) * TILE_SIZE, y: (table.row + 1) * TILE_SIZE }
          : null;
        if (sendRobot(os.robot, round.stops, round.cleanAt, reachTo)) {
          this.nextRound = now + ROBOT_EVERY_MS;
          this.fullRoundAfter = now + ROBOT_FIRST_MS;
        }
      }
    } else if (os.robot) {
      os.robot = null;
    }

    // A pet that reached whoever it went to see shows its heart.
    for (const [petId, agentId] of [...petVisits]) {
      const pet = os.pets.find((p) => p.id === petId);
      const ch = os.characters.get(agentId);
      if (pet && pet.followTargetId === agentId) continue; // on its way
      if (pet && ch) {
        const steps = Math.abs(pet.tileCol - ch.tileCol) + Math.abs(pet.tileRow - ch.tileRow);
        if (steps <= 1) os.showPetBubble(petId);
      }
      petVisits.delete(petId);
    }
    if (
      on.pet &&
      longestWaiting &&
      petVisits.size === 0 &&
      this.rand() < 1 / PET_VISIT_ONE_IN
    ) {
      const petId = os.sendPetTo(longestWaiting.id, PET_VISIT_MAX_SEC);
      if (petId) petVisits.set(petId, longestWaiting.id);
    }
  }
}
