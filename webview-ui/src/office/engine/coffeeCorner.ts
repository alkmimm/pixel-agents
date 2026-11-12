/**
 * pixel-agents-secure (local): what the coffee corner leaves in the office:
 * the cups agents put on the coffee table, and the cleaning robot that comes
 * for them. Rules of who goes for coffee, and when the robot sets off, are in
 * viewer/useOfficeLife.ts ("Vida no escritório"); here is only what moves and
 * what is drawn. Nothing is saved or sent: reloading the page clears the table.
 */
import { CUP_COLORS } from '../cupColors.js';
import { findPath } from '../layout/tileMap.js';
import type { SpriteData, TileType } from '../types.js';
import { TILE_SIZE } from '../types.js';

type Tile = { col: number; row: number };

/** Something drawn in the scene besides furniture, characters and pets (world pixels). */
export interface SceneExtra {
  sprite: SpriteData;
  x: number;
  y: number;
  zY: number;
}

// ── Cups ────────────────────────────────────────────────────────

const _ = '';
const W = CUP_COLORS.cup;
const S = '#b9c0c8';
const C = CUP_COLORS.coffee;
/** A cup seen from above, as it stands on the table or is carried. */
export const CUP_SPRITE: SpriteData = [
  [_, W, W, _],
  [W, C, C, W],
  [W, C, C, S],
  [_, S, S, _],
];
/** Where cups go on a coffee table (pixels from its sprite's corner), in the order they
 *  arrive. The table's top is 28x22 from (2, 6); the mug that is furniture sits lower left. */
const CUP_PLACES: ReadonlyArray<readonly [number, number]> = [
  [22, 9],
  [5, 8],
  [14, 11],
  [23, 18],
  [3, 14],
];
/** A table holds this many cups; one more is not put down. */
export const MAX_CUPS = CUP_PLACES.length;

export interface Cup {
  x: number;
  y: number;
  zY: number;
}

/** The nth cup on the table whose sprite starts at tile (col, row). */
export function cupOnTable(table: Tile, index: number): Cup {
  const [dx, dy] = CUP_PLACES[index % CUP_PLACES.length];
  return {
    x: table.col * TILE_SIZE + dx,
    y: table.row * TILE_SIZE + dy,
    // Over the table (two tiles deep) and whatever stands on it.
    zY: (table.row + 2) * TILE_SIZE + 1,
  };
}

// ── The cleaning robot ──────────────────────────────────────────

/** Slower than someone walking (48). */
export const ROBOT_SPEED_PX_PER_SEC = 26;
/** It works a moment at each stop. */
export const ROBOT_STOP_SEC = 1.4;
const ROBOT_BRUSH_SEC = 0.2;
/** Its arms go out and come back with a cup in this long. */
export const ROBOT_PICK_SEC = 0.9;
/** How far its arms stretch at most (pixels). */
const ARM_REACH_PX = 7;

const K = '#23262d';
const G = '#5b6472';
const L = '#8c97a6';
const H = '#c9d2dc';
const N = '#5dff7a';
const B = '#3a3f4a';
/** A round robot vacuum seen from above: its body, a light on top. */
function robotSprite(brushOut: boolean): SpriteData {
  const b = brushOut ? B : _;
  return [
    [_, _, _, K, K, K, K, K, K, _, _, _],
    [_, _, K, L, L, H, H, L, L, K, _, _],
    [b, K, L, L, L, L, L, L, L, L, K, b],
    [_, K, L, L, G, N, N, G, L, L, K, _],
    [_, K, G, L, G, G, G, G, L, G, K, _],
    [b, K, G, G, L, L, L, L, G, G, K, b],
    [_, _, K, G, G, G, G, G, G, K, _, _],
    [_, _, _, K, K, K, K, K, K, _, _, _],
  ];
}
export const ROBOT_SPRITES: readonly [SpriteData, SpriteData] = [
  robotSprite(false),
  robotSprite(true),
];

export interface Robot {
  /** Its centre, in world pixels. */
  x: number;
  y: number;
  tileCol: number;
  tileRow: number;
  /** Where it rests between rounds. */
  dock: Tile;
  /** The tiles left of the way to its next stop. */
  path: Tile[];
  moveProgress: number;
  /** The stops still to make on this round, in order. */
  stops: Tile[];
  /** The stop where it clears the table, if this round has one. */
  cleanAt: Tile | null;
  /** Where the table is from there (world pixels): the way its arms reach. */
  reachTo: { x: number; y: number } | null;
  /** While it takes cups: time since its arms last came back with one. */
  pickClock: number;
  /** Its arms are out, picking. */
  reaching: boolean;
  /** Time left working at the stop it is on. */
  waitSec: number;
  /** Runs while it is out, for its brushes. */
  clock: number;
}

const centre = (t: Tile) => ({
  x: t.col * TILE_SIZE + TILE_SIZE / 2,
  y: t.row * TILE_SIZE + TILE_SIZE / 2,
});
const same = (a: Tile, b: Tile) => a.col === b.col && a.row === b.row;

export function createRobot(dock: Tile): Robot {
  return {
    ...centre(dock),
    tileCol: dock.col,
    tileRow: dock.row,
    dock,
    path: [],
    moveProgress: 0,
    stops: [],
    cleanAt: null,
    reachTo: null,
    pickClock: 0,
    reaching: false,
    waitSec: 0,
    clock: 0,
  };
}

/** Whether it is out on a round (not resting at its dock). */
export function robotIsOut(robot: Robot): boolean {
  return robot.stops.length > 0 || robot.path.length > 0 || robot.waitSec > 0;
}

/**
 * Send it on a round: these stops, then back to its dock. Not while it is out.
 * `cleanAt` is the stop by the coffee table, and `reachTo` the table itself
 * (world pixels), which its arms stretch to.
 */
export function sendRobot(
  robot: Robot,
  stops: readonly Tile[],
  cleanAt: Tile | null,
  reachTo: { x: number; y: number } | null = null,
): boolean {
  if (robotIsOut(robot)) return false;
  robot.stops = [...stops, robot.dock];
  robot.cleanAt = cleanAt;
  robot.reachTo = reachTo;
  return true;
}

/**
 * One frame of the robot. At the table it stretches its arms and takes the
 * cups one at a time: returns true on each frame a cup comes off the table
 * (`cupsLeft` is how many are still on it).
 */
export function updateRobot(
  robot: Robot,
  dt: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
  cupsLeft = 0,
): boolean {
  if (!robotIsOut(robot)) return false;
  robot.clock += dt;

  if (robot.waitSec > 0) {
    const here = { col: robot.tileCol, row: robot.tileRow };
    if (robot.cleanAt !== null && same(here, robot.cleanAt)) {
      if (cupsLeft > 0) {
        // Arms out and back, a cup each time; it stays for as long as it takes.
        robot.reaching = true;
        robot.pickClock += dt;
        if (robot.pickClock < ROBOT_PICK_SEC) return false;
        robot.pickClock = 0;
        return true;
      }
      robot.reaching = false;
      robot.pickClock = 0;
    }
    robot.waitSec = Math.max(0, robot.waitSec - dt);
    if (robot.waitSec === 0 && robot.cleanAt !== null && same(here, robot.cleanAt)) {
      robot.cleanAt = null;
    }
    return false;
  }

  if (robot.path.length === 0) {
    const next = robot.stops.shift();
    if (!next) return false;
    const here = { col: robot.tileCol, row: robot.tileRow };
    if (same(here, next)) {
      // Already there (the dock at the end of a round needs no work).
      if (robot.stops.length > 0) robot.waitSec = ROBOT_STOP_SEC;
      return false;
    }
    // A stop it cannot reach is skipped.
    robot.path = findPath(here.col, here.row, next.col, next.row, tileMap, blockedTiles);
    robot.moveProgress = 0;
    if (robot.path.length === 0) return false;
  }

  const to = robot.path[0];
  robot.moveProgress += (ROBOT_SPEED_PX_PER_SEC / TILE_SIZE) * dt;
  const a = centre({ col: robot.tileCol, row: robot.tileRow });
  const b = centre(to);
  const t = Math.min(robot.moveProgress, 1);
  robot.x = a.x + (b.x - a.x) * t;
  robot.y = a.y + (b.y - a.y) * t;
  if (robot.moveProgress >= 1) {
    robot.tileCol = to.col;
    robot.tileRow = to.row;
    robot.path.shift();
    robot.moveProgress = 0;
    // The end of the way to a stop: work there, unless it is home.
    if (robot.path.length === 0 && robot.stops.length > 0) robot.waitSec = ROBOT_STOP_SEC;
  }
  return false;
}

const ARM = '#8c97a6';
const CLAW = '#23262d';
const armSprites = new Map<string, SpriteData>();
/** Two arms `length` pixels long with a claw at the far end: `vertical` up from the
 *  body, else out to the right; `flip` turns them the other way. */
function armSprite(length: number, vertical: boolean, flip: boolean): SpriteData {
  const key = `${length}:${vertical}:${flip}`;
  let sprite = armSprites.get(key);
  if (!sprite) {
    // Drawn pointing right, 6 pixels across the body: arms on rows 1 and 4.
    const rows: string[][] = Array.from({ length: 6 }, (_row, y) =>
      Array.from({ length }, (_cell, x): string => {
        const tip = x === length - 1;
        // The claw is the whole far end; the arms are rows 1 and 4.
        if (y !== 1 && y !== 4) return tip ? CLAW : _;
        return tip ? CLAW : ARM;
      }),
    );
    let out = flip ? rows.map((row) => [...row].reverse()) : rows;
    if (vertical) {
      // Columns become rows: pointing down, or up when flipped.
      const across = out;
      out = Array.from({ length }, (_row, y): string[] => across.map((row) => row[y]));
    }
    sprite = out;
    armSprites.set(key, sprite);
  }
  return sprite;
}

/** The robot's arms while it takes a cup: out toward the table and back. */
function armExtra(robot: Robot): SceneExtra | null {
  if (!robot.reaching || !robot.reachTo) return null;
  const phase = robot.pickClock / ROBOT_PICK_SEC;
  const length = Math.max(2, Math.round(ARM_REACH_PX * (1 - Math.abs(2 * phase - 1))));
  const dx = robot.reachTo.x - robot.x;
  const dy = robot.reachTo.y - robot.y;
  const vertical = Math.abs(dy) > Math.abs(dx);
  const back = vertical ? dy < 0 : dx < 0;
  const sprite = armSprite(length, vertical, back);
  const half = ROBOT_SPRITES[0][0].length / 2;
  const x = vertical ? robot.x - 3 : back ? robot.x - half - length + 1 : robot.x + half - 1;
  const y = vertical ? (back ? robot.y - 4 - length + 1 : robot.y + 3) : robot.y - 3;
  // Over the table it reaches across.
  return { sprite, x: Math.round(x), y: Math.round(y), zY: Math.max(robot.y, robot.reachTo.y) + TILE_SIZE * 2 };
}

/** The cups and the robot, as the scene draws them. */
export function coffeeCornerExtras(cups: readonly Cup[], robot: Robot | null): SceneExtra[] {
  const extras: SceneExtra[] = cups.map((cup) => ({ sprite: CUP_SPRITE, ...cup }));
  if (robot) {
    const out = robotIsOut(robot);
    const sprite = ROBOT_SPRITES[out ? Math.floor(robot.clock / ROBOT_BRUSH_SEC) % 2 : 0];
    extras.push({
      sprite,
      x: Math.round(robot.x - sprite[0].length / 2),
      y: Math.round(robot.y - sprite.length / 2),
      // On the floor: under anyone standing on its tile.
      zY: robot.y + TILE_SIZE / 2 - 1,
    });
    const arms = armExtra(robot);
    if (arms) extras.push(arms);
  }
  return extras;
}
