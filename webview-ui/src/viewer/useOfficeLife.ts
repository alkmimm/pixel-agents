/**
 * pixel-agents-secure (local): applies officeLife.ts to the office, once a
 * second, while "Vida no escritório" is on. Returns the mood to draw over each
 * head (ToolOverlay's `emote`).
 */
import { useCallback, useEffect, useRef } from 'react';

import { createRobot, robotIsOut, sendRobot } from '../office/engine/coffeeCorner.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { CharacterState, Direction, TILE_SIZE } from '../office/types.js';
import { isWaiting } from './agentGroups.js';
import { agentStatusView } from './agentStatus.js';
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
  ROBOT_CUPS_FULL,
  ROBOT_EVERY_MS,
  robotRound,
  seatAtTable,
  type TurnMemo,
  wayTo,
} from './officeLife.js';

const LOOK_MS = 1_000;
const PARTY_MS = 5_000;
/** Two idle agents standing close talk about once in this many looks. */
const CHAT_ONE_IN = 20;
/** A pet sets off to whoever waits about once in this many looks. */
const PET_VISIT_ONE_IN = 45;
const PET_VISIT_MAX_SEC = 40;
/** The cleaning robot's first round after the option is turned on. */
const ROBOT_FIRST_MS = 60_000;
const POUR_HOLD_SLACK_SEC = 3;
const FACING = {
  up: Direction.UP,
  down: Direction.DOWN,
  left: Direction.LEFT,
  right: Direction.RIGHT,
} as const;

type Tile = { col: number; row: number };

/** A coffee trip: to the machine, a cup filled, to the table, a sip. Without a
 *  machine it starts at 'walk': straight to where one drinks. */
interface Trip {
  spot: Tile;
  stage: 'machine' | 'pour' | 'walk' | 'sip' | 'to-game' | 'play';
  /** It goes to (or is in) a seat for this, not a place to stand. */
  seated?: boolean;
  /** When the pour or the sip ends (ms). */
  until?: number;
  /** The table the cup is left on, when it is drunk at one. */
  table?: Tile;
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
}
const ALL_PARTS: LifeParts = {
  coffee: true,
  sleep: true,
  party: true,
  chat: true,
  pet: true,
  robot: true,
  game: true,
  roam: true,
};

export function useOfficeLife(
  enabled: boolean,
  getOfficeState: () => OfficeState,
  agents: number[],
  agentTools: Record<number, ToolActivity[]>,
  parts: LifeParts = ALL_PARTS,
): (id: number) => string | undefined {
  const moods = useRef(new Map<number, { text: string; until: number }>());
  const latest = useRef({ agents, agentTools, parts });
  latest.current = { agents, agentTools, parts };

  useEffect(() => {
    if (!enabled) {
      moods.current.clear();
      return;
    }
    // What this leaves in the office goes with it.
    const clearOffice = () => {
      const os = getOfficeState();
      os.cups = [];
      os.robot = null;
      os.roam = false;
      for (const ch of os.characters.values()) {
        ch.carrying = false;
        ch.guestSeat = null;
      }
    };
    const memos = new Map<number, TurnMemo>();
    const trips = new Map<number, Trip>();
    const petVisits = new Map<string, number>();
    let corner: CoffeeCorner = { machine: [], table: null, sip: [], dock: null, game: null };
    let spotsOf: OfficeLayout | null = null;
    let lastLook = Date.now();
    // The first round comes soon, so the robot is seen at work.
    let nextRound = Date.now() + ROBOT_FIRST_MS;
    // A full table calls it at once, but not again right after a round (one
    // that could not reach the table would otherwise never stop).
    let fullRoundAfter = 0;
    const pick = <T>(items: readonly T[]): T | undefined =>
      items[Math.floor(Math.random() * items.length)];

    const look = () => {
      const os = getOfficeState();
      const { agents: ids, agentTools: tools, parts: on } = latest.current;
      const now = Date.now();
      const elapsed = now - lastLook;
      lastLook = now;
      const mood = (id: number, text: string, ms: number) =>
        moods.current.set(id, { text, until: now + ms });
      const hasMood = (id: number) => (moods.current.get(id)?.until ?? 0) > now;

      if (os.getLayout() !== spotsOf) {
        spotsOf = os.getLayout();
        corner = coffeeCorner(spotsOf.furniture, os.walkableTiles);
        trips.clear();
        clearOffice();
      }

      os.roam = on.roam;

      const alive = new Set(ids);
      for (const id of [...memos.keys()]) if (!alive.has(id)) memos.delete(id);
      for (const id of [...moods.current.keys()]) if (!alive.has(id)) moods.current.delete(id);

      const standing: Array<{ id: number; col: number; row: number }> = [];
      let longestWaiting: { id: number; since: number } | null = null;

      for (const id of ids) {
        const ch = os.characters.get(id);
        if (!ch || ch.isSubagent || ch.matrixEffect) continue;
        const status = agentStatusView(os, id, tools);

        const turn = followTurn(memos.get(id), status.tone, now);
        memos.set(id, turn.memo);
        if (turn.celebrate && on.party) mood(id, MOOD.party, PARTY_MS);

        if (isWaiting(status.tone)) {
          const since = status.since ?? now;
          if (!longestWaiting || since < longestWaiting.since) longestWaiting = { id, since };
        }

        // A coffee trip under way.
        const trip = trips.get(id);
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
          const sip = () => {
            trip.stage = 'sip';
            // Seated, it drinks until just before it gets up by itself.
            const sec = trip.seated ? COFFEE_SIT_SEC - 1 : COFFEE_SIP_SEC;
            trip.until = now + sec * 1000;
            if (!trip.seated) os.holdStill(id, COFFEE_SIP_SEC, true);
            mood(id, MOOD.coffee, sec * 1000);
          };
          if (ch.isActive) {
            // Called back to work: the cup is forgotten.
            end();
            moods.current.delete(id);
          } else if (trip.stage === 'play') {
            if (now >= (trip.until ?? 0) || ch.guestSeat === null) end();
          } else if (trip.stage === 'sip') {
            if (now >= (trip.until ?? 0) || lostSeat) {
              // Getting up, the cup stays on the table.
              if (ch.carrying && trip.table) os.placeCup(trip.table);
              end();
            }
          } else if (trip.stage === 'pour') {
            if (now >= (trip.until ?? 0)) {
              ch.carrying = true;
              // A free sofa seat at the table, to sit with the cup.
              const table = corner.table?.at;
              const seat = table
                ? pick(os.freeSeats().filter((s) => seatAtTable(s, table)))
                : undefined;
              const to = pick(drinkingSpots(corner));
              if (seat && table && os.sitAsGuest(id, seat.uid, COFFEE_SIT_SEC)) {
                trip.spot = { col: seat.col, row: seat.row };
                trip.stage = 'walk';
                trip.seated = true;
                trip.table = table;
              } else if (to && os.sendOnErrand(id, to.col, to.row)) {
                trip.spot = to;
                trip.stage = 'walk';
                trip.table = corner.table?.at;
              } else {
                sip(); // nowhere to take it: drunk at the machine
              }
            }
          } else if (lostSeat) {
            end();
          } else if (arrived) {
            if (trip.stage === 'to-game') {
              trip.stage = 'play';
              trip.until = now + (GAME_SEC - 1) * 1000;
              mood(id, MOOD.game, (GAME_SEC - 1) * 1000);
            } else if (trip.stage === 'machine') {
              trip.stage = 'pour';
              trip.until = now + POUR_SEC * 1000;
              // Held past the pour, so it is still here when the cup is full.
              os.holdStill(id, POUR_SEC + POUR_HOLD_SLACK_SEC, false);
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
        if (
          on.coffee &&
          ch.state !== CharacterState.WALK &&
          Math.random() < coffeeChance(elapsed)
        ) {
          const atMachine = corner.machine.length > 0;
          const spot = pick(atMachine ? corner.machine : drinkingSpots(corner));
          if (spot && os.sendOnErrand(id, spot.col, spot.row)) {
            trips.set(id, { spot, stage: atMachine ? 'machine' : 'walk' });
          }
        } else if (
          on.game &&
          corner.game &&
          ch.state !== CharacterState.WALK &&
          Math.random() < gameChance(elapsed)
        ) {
          // A free pouf by the video game: sit facing the screen and play a while.
          const game = corner.game;
          const pouf = pick(
            os.freeSeats().filter((s) => game.poufs.some((p) => p.col === s.col && p.row === s.row)),
          );
          if (pouf && os.sitAsGuest(id, pouf.uid, GAME_SEC, FACING[wayTo(pouf, game.at)])) {
            trips.set(id, { spot: { col: pouf.col, row: pouf.row }, stage: 'to-game', seated: true });
          }
        }
      }

      for (const [a, b] of chatPairs(standing)) {
        if (!on.chat || trips.has(a) || trips.has(b) || Math.random() >= 1 / CHAT_ONE_IN) continue;
        for (const id of [a, b]) {
          os.holdStill(id, CHAT_SEC, false);
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
        const due =
          now >= nextRound || (os.cups.length >= ROBOT_CUPS_FULL && now >= fullRoundAfter);
        if (due && !robotIsOut(os.robot)) {
          const round = robotRound(corner, os.walkableTiles);
          // Its arms reach for the middle of the table (two tiles a side).
          const table = corner.table?.at;
          const reachTo = table
            ? { x: (table.col + 1) * TILE_SIZE, y: (table.row + 1) * TILE_SIZE }
            : null;
          if (sendRobot(os.robot, round.stops, round.cleanAt, reachTo)) {
            nextRound = now + ROBOT_EVERY_MS;
            fullRoundAfter = now + ROBOT_FIRST_MS;
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
        Math.random() < 1 / PET_VISIT_ONE_IN
      ) {
        const petId = os.sendPetTo(longestWaiting.id, PET_VISIT_MAX_SEC);
        if (petId) petVisits.set(petId, longestWaiting.id);
      }
    };

    const timer = setInterval(look, LOOK_MS);
    return () => {
      clearInterval(timer);
      clearOffice();
    };
  }, [enabled, getOfficeState]);

  return useCallback((id: number) => {
    const mood = moods.current.get(id);
    return mood && mood.until > Date.now() ? mood.text : undefined;
  }, []);
}
