/**
 * pixel-agents-secure (local): what the coffee corner leaves in the office:
 * the cups agents put on the coffee table, and the cleaning robot that comes
 * for them. Rules of who goes for coffee, and when the robot sets off, are in
 * viewer/useOfficeLife.ts ("Vida no escritório"); here is only what moves and
 * what is drawn. Nothing is saved or sent: reloading the page clears the table.
 */
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
const W = '#f4f4f4';
const S = '#b9c0c8';
const C = '#6b3f1d';
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
    waitSec: 0,
    clock: 0,
  };
}

/** Whether it is out on a round (not resting at its dock). */
export function robotIsOut(robot: Robot): boolean {
  return robot.stops.length > 0 || robot.path.length > 0 || robot.waitSec > 0;
}

/** Send it on a round: these stops, then back to its dock. Not while it is out. */
export function sendRobot(robot: Robot, stops: readonly Tile[], cleanAt: Tile | null): boolean {
  if (robotIsOut(robot)) return false;
  robot.stops = [...stops, robot.dock];
  robot.cleanAt = cleanAt;
  return true;
}

/**
 * One frame of the robot. Returns true on the frame it finishes working at the
 * stop where it clears the table.
 */
export function updateRobot(
  robot: Robot,
  dt: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): boolean {
  if (!robotIsOut(robot)) return false;
  robot.clock += dt;

  if (robot.waitSec > 0) {
    robot.waitSec = Math.max(0, robot.waitSec - dt);
    if (robot.waitSec > 0) return false;
    const here = { col: robot.tileCol, row: robot.tileRow };
    const cleaned = robot.cleanAt !== null && same(here, robot.cleanAt);
    if (cleaned) robot.cleanAt = null;
    return cleaned;
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
  }
  return extras;
}
