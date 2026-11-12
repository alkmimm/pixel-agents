import { describe, expect, it } from 'vitest';

import {
  CELEBRATE_MIN_MS,
  chatPairs,
  COFFEE_EVERY_MS,
  coffeeChance,
  coffeeCorner,
  machineFront,
  QUEUE_SPOTS,
  queueSpots,
  coffeeSpots,
  drinkingSpots,
  followTurn,
  GAME_EVERY_MS,
  gameChance,
  isSleepy,
  MAX_LOOK_MS,
  robotRound,
  seatAtTable,
  wayTo,
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

  it('a cup is filled from the front of the machine, and the others wait by it, not beside the machine', () => {
    const machine = { type: 'COFFEE_MACHINE', col: 5, row: 0 };
    // The machine is two tiles tall: (5,1) is its counter; its front is (5,2).
    const walkable = [
      { col: 4, row: 1 },
      { col: 6, row: 1 },
      { col: 4, row: 2 },
      { col: 5, row: 2 },
      { col: 6, row: 2 },
      { col: 4, row: 3 },
      { col: 6, row: 3 },
      { col: 9, row: 9 },
    ];
    expect(machineFront([machine], walkable)).toEqual({ col: 5, row: 2 });
    expect(coffeeCorner([machine], walkable).machine).toEqual([{ col: 5, row: 2 }]);
    const line = queueSpots({ col: 5, row: 2 }, walkable);
    expect(line).toEqual([
      { col: 4, row: 2 },
      { col: 6, row: 2 },
      { col: 4, row: 3 },
    ]);
    // Never the front itself, nor the tiles at the machine's sides.
    expect(line.some((t) => t.row < 2 || (t.col === 5 && t.row === 2))).toBe(false);
    expect(line.length).toBeLessThanOrEqual(QUEUE_SPOTS);
    // A front with one way in: the line leaves that way free.
    const boxed = [
      { col: 5, row: 2 },
      { col: 6, row: 2 },
      { col: 7, row: 2 },
      { col: 6, row: 3 },
    ];
    expect(queueSpots({ col: 5, row: 2 }, boxed)).toEqual([
      { col: 7, row: 2 },
      { col: 6, row: 3 },
    ]);
    // No machine, or one with nothing walkable below it: no front.
    expect(machineFront([], walkable)).toBeNull();
    expect(machineFront([machine], [{ col: 4, row: 1 }])).toBeNull();
  });

  it('an office with no machine, table or bin has none of it, and the old coffee still works', () => {
    const corner = coffeeCorner([{ type: 'COFFEE', col: 1, row: 1 }], [{ col: 1, row: 2 }]);
    expect(corner).toEqual({
      machine: [],
      table: null,
      sip: [{ col: 1, row: 2 }],
      dock: null,
      game: null,
    });
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
      game: null,
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

  it('the sofa seats around the coffee table, and no other, are at the table', () => {
    const table = { col: 3, row: 4 }; // its tiles: (3..4, 4..5)
    for (const [col, row] of [
      [3, 3], [4, 3], [3, 6], [4, 6], [2, 4], [2, 5], [5, 4], [5, 5],
    ]) {
      expect(seatAtTable({ col, row }, table), `${col},${row}`).toBe(true);
    }
    for (const [col, row] of [
      [3, 4], [4, 5], [2, 3], [5, 6], [3, 2], [6, 4], [1, 4], [3, 7],
    ]) {
      expect(seatAtTable({ col, row }, table), `${col},${row}`).toBe(false);
    }
  });

  it('a game corner needs the video game and a pouf near it; one faces the screen', () => {
    const tv = { type: 'VIDEO_GAME', col: 6, row: 5 }; // its cabinet: row 6
    const near = { type: 'POUF', col: 6, row: 7 };
    const far = { type: 'POUF', col: 0, row: 0 };
    expect(coffeeCorner([tv, near, far], []).game).toEqual({
      at: { col: 6, row: 6 },
      poufs: [{ col: 6, row: 7 }],
    });
    expect(coffeeCorner([tv, far], []).game).toBeNull();
    expect(coffeeCorner([near], []).game).toBeNull();
    expect(wayTo({ col: 6, row: 7 }, { col: 6, row: 6 })).toBe('up');
    expect(wayTo({ col: 7, row: 7 }, { col: 6, row: 6 })).toBe('up');
    expect(wayTo({ col: 3, row: 6 }, { col: 6, row: 6 })).toBe('right');
    expect(wayTo({ col: 9, row: 6 }, { col: 6, row: 6 })).toBe('left');
    expect(wayTo({ col: 6, row: 2 }, { col: 6, row: 6 })).toBe('down');
    expect(gameChance(1000)).toBeCloseTo(1000 / GAME_EVERY_MS);
    expect(gameChance(10 * 60_000)).toBe(gameChance(MAX_LOOK_MS));
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
