import { describe, expect, it } from 'vitest';

import {
  CELEBRATE_MIN_MS,
  chatPairs,
  COFFEE_EVERY_MS,
  coffeeChance,
  coffeeCorner,
  coffeeSpots,
  drinkingSpots,
  followTurn,
  isSleepy,
  MAX_LOOK_MS,
  robotRound,
  SLEEP_AFTER_MS,
} from '../src/viewer/officeLife.js';

const NOW = 1_800_000_000_000;

describe('office life', () => {
  it('a long turn that finishes is celebrated, once', () => {
    let step = followTurn(undefined, 'active', NOW);
    expect(step.celebrate).toBe(false);
    step = followTurn(step.memo, 'permission', NOW + 60_000);
    expect(step.memo.since).toBe(NOW);
    step = followTurn(step.memo, 'done', NOW + CELEBRATE_MIN_MS);
    expect(step.celebrate).toBe(true);
    expect(followTurn(step.memo, 'done', NOW + CELEBRATE_MIN_MS + 1_000).celebrate).toBe(false);
  });

  it('a short turn, or one that ends asking something, is not', () => {
    const working = followTurn(undefined, 'active', NOW).memo;
    expect(followTurn(working, 'done', NOW + CELEBRATE_MIN_MS - 1).celebrate).toBe(false);
    expect(followTurn(working, 'input', NOW + CELEBRATE_MIN_MS).celebrate).toBe(false);
  });

  it('an agent found already idle has nothing to celebrate', () => {
    const idle = followTurn(undefined, 'done', NOW).memo;
    expect(followTurn(idle, 'done', NOW + CELEBRATE_MIN_MS * 2).celebrate).toBe(false);
  });

  it('only an agent with nothing to do for long dozes off', () => {
    expect(isSleepy('done', NOW - SLEEP_AFTER_MS, NOW)).toBe(true);
    // Waiting on you is not sleeping.
    expect(isSleepy('input', NOW - SLEEP_AFTER_MS, NOW)).toBe(false);
    expect(isSleepy('done', NOW - SLEEP_AFTER_MS + 1, NOW)).toBe(false);
    expect(isSleepy('active', NOW - SLEEP_AFTER_MS, NOW)).toBe(false);
    expect(isSleepy('idle', undefined, NOW)).toBe(false);
  });

  it('the coffee chance follows the time between looks, up to one look', () => {
    expect(coffeeChance(0)).toBe(0);
    expect(coffeeChance(1_000)).toBeCloseTo(1_000 / COFFEE_EVERY_MS);
    // A late look is one look: not everyone leaves for coffee at once.
    expect(coffeeChance(COFFEE_EVERY_MS * 3)).toBeCloseTo(MAX_LOOK_MS / COFFEE_EVERY_MS);
  });

  it('one has a coffee on the walkable tiles closest to it', () => {
    const walkable = [
      { col: 0, row: 0 },
      { col: 3, row: 1 },
      { col: 1, row: 3 },
      { col: 9, row: 9 },
    ];
    const furniture = [
      { type: 'COFFEE', col: 1, row: 1 },
      { type: 'COFFEE_TABLE', col: 9, row: 8 },
      { type: 'DESK_FRONT', col: 0, row: 0 },
    ];
    // (0,0), (3,1) and (1,3) are all 2 steps away; the table is not a coffee.
    expect(coffeeSpots(furniture, walkable)).toEqual(walkable.slice(0, 3));
    expect(coffeeSpots(furniture, [{ col: 9, row: 9 }])).toEqual([]);
  });

  it('a coffee corner: the machine to fill a cup at, the table to leave it on, the robot by the bin', () => {
    const furniture = [
      { type: 'COFFEE_MACHINE', col: 5, row: 0 },
      { type: 'COFFEE_TABLE', col: 3, row: 3 },
      { type: 'COFFEE_TABLE', col: 20, row: 3 },
      { type: 'COFFEE', col: 3, row: 4 },
      { type: 'NEON_COFFEE', col: 3, row: 0 },
      { type: 'BIN', col: 1, row: 7 },
    ];
    const walkable = [
      { col: 4, row: 1 },
      { col: 6, row: 1 },
      { col: 2, row: 2 },
      { col: 2, row: 7 },
      { col: 19, row: 2 },
    ];
    const corner = coffeeCorner(furniture, walkable);
    expect(corner.machine).toEqual([
      { col: 4, row: 1 },
      { col: 6, row: 1 },
    ]);
    // The table nearest the machine, not the one across the office.
    expect(corner.table).toEqual({ at: { col: 3, row: 3 }, spots: [{ col: 2, row: 2 }] });
    expect(corner.dock).toEqual({ col: 2, row: 7 });
    expect(drinkingSpots(corner)).toEqual([{ col: 2, row: 2 }]);
    // The machine is not where one drinks, nor is the sign anything.
    expect(coffeeSpots([furniture[0], furniture[4]], walkable)).toEqual([]);
  });

  it('an office with no machine, table or bin has none of it, and the old coffee still works', () => {
    const corner = coffeeCorner([{ type: 'COFFEE', col: 1, row: 1 }], [{ col: 1, row: 2 }]);
    expect(corner).toEqual({ machine: [], table: null, sip: [{ col: 1, row: 2 }], dock: null });
    expect(drinkingSpots(corner)).toEqual([{ col: 1, row: 2 }]);
    expect(robotRound(corner, [{ col: 1, row: 2 }])).toEqual({ stops: [], cleanAt: null });
  });

  it('the robot goes to the table first, then over the floor around it', () => {
    const walkable = [];
    for (let col = 0; col < 12; col++) walkable.push({ col, row: 5 });
    const corner = {
      machine: [],
      table: { at: { col: 3, row: 3 }, spots: [{ col: 3, row: 5 }] },
      sip: [],
      dock: { col: 0, row: 5 },
    };
    const round = robotRound(corner, walkable, () => 0);
    expect(round.cleanAt).toEqual({ col: 3, row: 5 });
    expect(round.stops[0]).toEqual({ col: 3, row: 5 });
    expect(round.stops).toHaveLength(3);
    for (const stop of round.stops.slice(1)) {
      expect(Math.abs(stop.col - 3)).toBeGreaterThan(0);
      expect(Math.abs(stop.col - 3)).toBeLessThanOrEqual(4);
    }
    expect(new Set(round.stops.map((t) => t.col)).size).toBe(3);
  });

  it('idle agents standing close pair up, each in one pair', () => {
    const pairs = chatPairs([
      { id: 1, col: 0, row: 0 },
      { id: 2, col: 1, row: 1 },
      { id: 3, col: 2, row: 1 },
      { id: 4, col: 9, row: 9 },
      { id: 5, col: 9, row: 9 },
    ]);
    // 4 and 5 share a tile (one is passing through the other): no talk.
    expect(pairs).toEqual([[1, 2]]);
  });
});
