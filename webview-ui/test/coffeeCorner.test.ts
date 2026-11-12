import { describe, expect, it } from 'vitest';

import {
  coffeeCornerExtras,
  createRobot,
  CUP_SPRITE,
  cupOnTable,
  MAX_CUPS,
  ROBOT_PICK_SEC,
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

/** Run the robot until it rests, with `cups` on the table; counts the cups it takes. */
function run(robot: ReturnType<typeof createRobot>, blocked = none, cups = 0, maxSec = 120) {
  let taken = 0;
  let sec = 0;
  let reached = false;
  const seen: string[] = [];
  while (robotIsOut(robot) && sec < maxSec) {
    if (updateRobot(robot, 0.1, tileMap, blocked, cups - taken)) taken++;
    if (robot.reaching) reached = true;
    sec += 0.1;
    const at = `${robot.tileCol},${robot.tileRow}`;
    if (seen[seen.length - 1] !== at) seen.push(at);
  }
  return { taken, sec, seen, reached };
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

  it('does its round and comes back; with no cup on the table its arms stay in', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const table = { col: 3, row: 1 };
    expect(sendRobot(robot, [table, { col: 5, row: 0 }], table)).toBe(true);
    // Not sent again while it is out.
    expect(sendRobot(robot, [{ col: 1, row: 1 }], null)).toBe(false);
    const { taken, sec, seen, reached } = run(robot);
    expect([taken, reached]).toEqual([0, false]);
    expect(seen).toContain('3,1');
    expect(seen).toContain('5,0');
    expect([robot.tileCol, robot.tileRow]).toEqual([0, 1]);
    expect(robotIsOut(robot)).toBe(false);
    // 3 + 3 + 6 tiles at its speed, and a stop's work at each of the two stops.
    const expected = (12 * TILE_SIZE) / ROBOT_SPEED_PX_PER_SEC + 2 * ROBOT_STOP_SEC;
    expect(sec).toBeGreaterThan(expected * 0.9);
    expect(sec).toBeLessThan(expected * 1.2);
  });

  it('at the table it takes the cups one at a time, arms out, and stays until none is left', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const table = { col: 2, row: 1 };
    sendRobot(robot, [table], table, { x: 2.5 * TILE_SIZE, y: 0 });
    const withCups = run(robot, none, 3);
    expect(withCups.taken).toBe(3);
    expect(withCups.reached).toBe(true);
    expect(robot.reaching).toBe(false);
    // Three picks longer than the same round with nothing to take.
    const again = createRobot({ col: 0, row: 1 });
    sendRobot(again, [table], table);
    const without = run(again);
    expect(withCups.sec - without.sec).toBeGreaterThan(3 * ROBOT_PICK_SEC * 0.9);
    expect(withCups.sec - without.sec).toBeLessThan(3 * ROBOT_PICK_SEC * 1.3);
  });

  it('its arms are drawn only while it takes a cup, on the table\'s side', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const table = { col: 2, row: 1 };
    // The table is above the stop: the arms go up.
    sendRobot(robot, [table], table, { x: 2.5 * TILE_SIZE, y: 0 });
    expect(coffeeCornerExtras([], robot)).toHaveLength(1);
    let withArms = 0;
    for (let sec = 0; sec < 20 && robotIsOut(robot); sec += 0.1) {
      updateRobot(robot, 0.1, tileMap, none, robot.reaching || sec > 0 ? 1 : 0);
      const extras = coffeeCornerExtras([], robot);
      if (extras.length === 2) {
        withArms++;
        const [body, arms] = extras;
        expect(arms.y + arms.sprite.length).toBeLessThanOrEqual(body.y + 2);
        expect(arms.sprite.length).toBeGreaterThanOrEqual(2);
        expect(arms.sprite.length).toBeLessThanOrEqual(7);
      }
      if (withArms > 15) break;
    }
    expect(withArms).toBeGreaterThan(5);
  });

  it('skips a stop it cannot reach, and still goes home', () => {
    const robot = createRobot({ col: 0, row: 1 });
    const walled = new Set(['4,0', '4,1', '4,2']);
    sendRobot(robot, [{ col: 5, row: 1 }, { col: 2, row: 0 }], { col: 5, row: 1 });
    const { taken, seen } = run(robot, walled, 2);
    expect(taken).toBe(0);
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
