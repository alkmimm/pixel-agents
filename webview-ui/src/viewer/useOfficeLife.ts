/**
 * pixel-agents-secure (local): applies officeLife.ts to the office, once a
 * second, while "Vida no escritório" is on. Returns the mood to draw over each
 * head (ToolOverlay's `emote`).
 */
import { useCallback, useEffect, useRef } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { CharacterState } from '../office/types.js';
import { isWaiting } from './agentGroups.js';
import { agentStatusView } from './agentStatus.js';
import {
  CHAT_SEC,
  chatPairs,
  COFFEE_SIP_SEC,
  coffeeChance,
  coffeeSpots,
  followTurn,
  isSleepy,
  MOOD,
  type TurnMemo,
} from './officeLife.js';

const LOOK_MS = 1_000;
const PARTY_MS = 5_000;
/** Two idle agents standing close talk about once in this many looks. */
const CHAT_ONE_IN = 20;
/** A pet sets off to whoever waits about once in this many looks. */
const PET_VISIT_ONE_IN = 45;
const PET_VISIT_MAX_SEC = 40;

type Tile = { col: number; row: number };

interface Trip {
  spot: Tile;
  /** Set once at the coffee: when the sip ends (ms). */
  sipUntil?: number;
}

export function useOfficeLife(
  enabled: boolean,
  getOfficeState: () => OfficeState,
  agents: number[],
  agentTools: Record<number, ToolActivity[]>,
): (id: number) => string | undefined {
  const moods = useRef(new Map<number, { text: string; until: number }>());
  const latest = useRef({ agents, agentTools });
  latest.current = { agents, agentTools };

  useEffect(() => {
    if (!enabled) {
      moods.current.clear();
      return;
    }
    const memos = new Map<number, TurnMemo>();
    const trips = new Map<number, Trip>();
    const petVisits = new Map<string, number>();
    let spots: Tile[] = [];
    let spotsOf: OfficeLayout | null = null;
    let lastLook = Date.now();

    const look = () => {
      const os = getOfficeState();
      const { agents: ids, agentTools: tools } = latest.current;
      const now = Date.now();
      const elapsed = now - lastLook;
      lastLook = now;
      const mood = (id: number, text: string, ms: number) =>
        moods.current.set(id, { text, until: now + ms });
      const hasMood = (id: number) => (moods.current.get(id)?.until ?? 0) > now;

      if (os.getLayout() !== spotsOf) {
        spotsOf = os.getLayout();
        spots = coffeeSpots(spotsOf.furniture, os.walkableTiles);
        trips.clear();
      }

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
        if (turn.celebrate) mood(id, MOOD.party, PARTY_MS);

        if (isWaiting(status.tone)) {
          const since = status.since ?? now;
          if (!longestWaiting || since < longestWaiting.since) longestWaiting = { id, since };
        }

        // A coffee trip under way.
        const trip = trips.get(id);
        if (trip) {
          const there = ch.tileCol === trip.spot.col && ch.tileRow === trip.spot.row;
          if (ch.isActive) {
            trips.delete(id);
            moods.current.delete(id);
          } else if (trip.sipUntil !== undefined) {
            if (now >= trip.sipUntil) trips.delete(id);
          } else if (there && ch.state === CharacterState.IDLE) {
            trip.sipUntil = now + COFFEE_SIP_SEC * 1000;
            os.holdStill(id, COFFEE_SIP_SEC, true);
            mood(id, MOOD.coffee, COFFEE_SIP_SEC * 1000);
          } else if (ch.state !== CharacterState.WALK) {
            trips.delete(id); // stopped on the way
          }
          continue;
        }
        if (ch.isActive || hasMood(id)) continue;

        if (isSleepy(status.tone, status.since, now)) {
          // Asleep: stays in its chair, once it is back in it.
          if (os.holdSeat(id, 5)) mood(id, MOOD.sleep, LOOK_MS * 2);
          continue;
        }
        if (ch.state === CharacterState.IDLE) {
          standing.push({ id, col: ch.tileCol, row: ch.tileRow });
        }
        if (
          spots.length > 0 &&
          ch.state !== CharacterState.WALK &&
          Math.random() < coffeeChance(elapsed)
        ) {
          const spot = spots[Math.floor(Math.random() * spots.length)];
          if (os.sendOnErrand(id, spot.col, spot.row)) trips.set(id, { spot });
        }
      }

      for (const [a, b] of chatPairs(standing)) {
        if (trips.has(a) || trips.has(b) || Math.random() >= 1 / CHAT_ONE_IN) continue;
        for (const id of [a, b]) {
          os.holdStill(id, CHAT_SEC, false);
          mood(id, MOOD.chat, CHAT_SEC * 1000);
        }
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
      if (longestWaiting && petVisits.size === 0 && Math.random() < 1 / PET_VISIT_ONE_IN) {
        const petId = os.sendPetTo(longestWaiting.id, PET_VISIT_MAX_SEC);
        if (petId) petVisits.set(petId, longestWaiting.id);
      }
    };

    const timer = setInterval(look, LOOK_MS);
    return () => clearInterval(timer);
  }, [enabled, getOfficeState]);

  return useCallback((id: number) => {
    const mood = moods.current.get(id);
    return mood && mood.until > Date.now() ? mood.text : undefined;
  }, []);
}
