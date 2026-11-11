import { describe, expect, it } from 'vitest';

import {
  CELEBRATE_MIN_MS,
  chatPairs,
  COFFEE_EVERY_MS,
  coffeeChance,
  coffeeSpots,
  followTurn,
  isSleepy,
  MAX_LOOK_MS,
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
