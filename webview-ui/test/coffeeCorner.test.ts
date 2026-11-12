import { describe, expect, it } from 'vitest';

import {
  coffeeCornerExtras,
  createRobot,
  CUP_SPRITE,
  cupOnTable,
  MAX_CUPS,
  ROBOT_SPEED_PX_PER_SEC,
  ROBOT_SPRITES,
  ROBOT_STOP_SEC,
  robotIsOut,
  sendRobot,
  updateRobot,
} from '../src/office/engine/coffeeCorner.js';
import { carriedCupPixels, headTop } from '../src/office/engine/liveliness.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

const F = TileType.FLOOR_1;
/** A 6x3 room of floor, nothing in it. */
const tileMap = Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => F));
const none = new Set<string>();

/** Run the robot until it rests, counting the frames it reports the table cleaned. */
function run(robot: ReturnType<typeof createRobot>, blocked = none, maxSec = 120) {
  let cleaned = 0;
  let sec = 0;
  const seen: string[] = [];
  while (robotIsOut(robot) && sec < maxSec) {
    if (updateRobot(robot, 0.1, tileMap, blocked)) cleaned++;
    sec += 0.1;
    const at = `${robot.tileCol},${robot.tileRow}`;
    if (seen[seen.length - 1] !== at) seen.push(at);
  }
  return { cleaned, sec, seen };
}

describe('cups on the coffee table', () => {
  it('each cup has its own place on the table top, drawn over the table', () => {
    const table = { col: 3, row: 4 };
    const cups = Array.from({ length: MAX_CUPS }, (_, i) => cupOnTable(table, i));
    expect(new Set(cups.map((c) => `${c.x},${c.y}`)).size).toBe(MAX_CUPS);
    for (const cup of cups) {
      // The table's top: 28x22 from (2, 6) of its 32x32 sprite.
      expect(cup.x - table.col * TILE_SIZE).toBeGreaterThanOrEqual(2);
      expect(cup.x - table.col * TILE_SIZE + CUP_SPRITE[0].length).toBeLessThanOrEqual(30);
      expect(cup.y - table.row * TILE_SIZE).toBeGreaterThanOrEqual(6);
      expect(cup.y - table.row * TILE_SIZE + CUP_SPRITE.length).toBeLessThanOrEqual(28);
      expect(cup.zY).toBeGreaterThan((table.row + 2) * TILE_SIZE);
    }
  });

  it('the office keeps them until the table is full', () => {
    const os = new OfficeState();
    expect(os.sceneExtras()).toEqual([]);
    for (let i = 0; i < MAX_CUPS; i++) expect(os.placeCup({ col: 1, row: 1 })).toBe(true);
    expect(os.placeCup({ col: 1, row: 1 })).toBe(false);
    expect(os.sceneExtras()).toHaveLength(MAX_CUPS);
  });

  it('a carried cup is drawn at the hands, inside the character', () => {
    for (const dir of [Direction.DOWN, Direction.UP, Direction.LEFT, Direction.RIGHT]) {
      const top = headTop(CharacterState.WALK, dir);
      const pixels = carriedCupPixels(top, dir);
      expect(pixels.length).toBeGreaterThan(0);
      for (const px of pixels) {
        expect(px.x).toBeGreaterThanOrEqual(2);
        expect(px.x).toBeLessThan(14);
        expect(px.y).toBeGreaterThan(top + 10);
        expect(px.y).toBeLessThan(28);
      }
    }
  });
});

describe('the cleaning robot', () => {
  it('rests at its dock until sent, and is drawn there', () => {
    const robot = createRobot({ col: 0, row: 1 });
    expect(robotIsOut(robot)).toBe(false);
    expect(updateRobot(robot, 1, tileMap, none)).toBe(false);
    const [extra] = coffeeCornerExtras([], robot);
    expect(extra.sprite).toBe(ROBOT_SPRITES[0]);
    expect(extra.x + extra.sprite[0].length / 2).toBe(TILE_SIZE / 2);
    expect(coffeeCornerExtras([], null)).toEqual([]);
  });

  it('does its round and comes back, reporting the table cleaned once, there', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const table = { col: 3, row: 1 };
    expect(sendRobot(robot, [table, { col: 5, row: 0 }], table)).toBe(true);
    // Not sent again while it is out.
    expect(sendRobot(robot, [{ col: 1, row: 1 }], null)).toBe(false);
    const { cleaned, sec, seen } = run(robot);
    expect(cleaned).toBe(1);
    expect(seen).toContain('3,1');
    expect(seen).toContain('5,0');
    expect([robot.tileCol, robot.tileRow]).toEqual([0, 1]);
    expect(robotIsOut(robot)).toBe(false);
    // 3 + 3 + 6 tiles at its speed, and a stop's work at each of the two stops.
    const expected = (12 * TILE_SIZE) / ROBOT_SPEED_PX_PER_SEC + 2 * ROBOT_STOP_SEC;
    expect(sec).toBeGreaterThan(expected * 0.9);
    expect(sec).toBeLessThan(expected * 1.2);
  });

  it('the cups are still there until it has worked at the table', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const table = { col: 2, row: 1 };
    sendRobot(robot, [table], table);
    let cleanedAt: number | null = null;
    for (let sec = 0; sec < 60 && cleanedAt === null; sec += 0.1) {
      if (updateRobot(robot, 0.1, tileMap, none)) cleanedAt = sec;
    }
    const walk = (2 * TILE_SIZE) / ROBOT_SPEED_PX_PER_SEC;
    expect(cleanedAt).toBeGreaterThan(walk + ROBOT_STOP_SEC * 0.8);
    expect([robot.tileCol, robot.tileRow]).toEqual([2, 1]);
  });

  it('skips a stop it cannot reach, and still goes home', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const walled = new Set(['4,0', '4,1', '4,2']);
    sendRobot(robot, [{ col: 5, row: 1 }, { col: 2, row: 0 }], { col: 5, row: 1 });
    const { cleaned, seen } = run(robot, walled);
    expect(cleaned).toBe(0);
    expect(seen).toContain('2,0');
    expect(seen.some((at) => at.startsWith('5,'))).toBe(false);
    expect([robot.tileCol, robot.tileRow]).toEqual([0, 1]);
  });

  it('its brushes move while it is out', () => {
    const robot = createRobot({ col: 0, row: 1 });
    sendRobot(robot, [{ col: 5, row: 1 }], null);
    const sprites = new Set();
    for (let i = 0; i < 20; i++) {
      updateRobot(robot, 0.1, tileMap, none);
      sprites.add(coffeeCornerExtras([], robot)[0].sprite);
    }
    expect(sprites.size).toBe(2);
  });
});
