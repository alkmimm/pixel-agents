/**
 * pixel-agents-secure (local): one room per project, opened and closed by who
 * is in the office.
 *
 * The layout the server sends (the "base") is never changed or saved. The
 * viewer draws a composed office instead, with one room per project that has
 * agents now. A room opens with the project's first agent, grows a row of
 * desks when the project needs more seats, and closes some time after its
 * last agent left. Two shapes:
 *
 *   compact   a small lounge (sofas, the coffee) at the left end of a
 *             corridor, with the rooms on both sides of the corridor. The
 *             base office is not drawn: with a room per project its rows of
 *             desks would stand empty. This keeps the office short and
 *             close to a window's shape, so it still reads in a small one.
 *   under     the base office as it is, a corridor under it and one row of
 *             rooms under the corridor.
 *
 * Walls: a wall is drawn taller than its tile and hides whoever stands on
 * the row over it. So there is no wall under anything walkable: rooms are
 * open on the corridor's side and at the bottom (the void is not walkable,
 * it needs no wall), and only closed at the top and the sides.
 *
 * Each room keeps its slot (its place) for as long as it lives, so a room
 * closing never moves the others. Which tiles belong to which room is
 * returned beside the layout (`roomTiles`), not written into it as Areas:
 * that is what seats a project's agents in their room (OfficeState.roomAreas).
 *
 * Free of React and the DOM, so it is tested directly.
 */
import type { ColorValue } from '../components/ui/types.js';
import type {
  CarpetTile,
  OfficeLayout,
  PlacedFurniture,
  TileType as TileTypeVal,
} from '../office/types.js';
import { TileType } from '../office/types.js';

/** Columns from one room to the next: neighbours share a wall. */
export const ROOM_PITCH = 8;
/** A room's width, both walls included. */
export const ROOM_WIDTH = ROOM_PITCH + 1;
/** Rows one row of desks takes: the desk (2), the chairs, a free row. */
const STATION_ROWS = 4;
const SEATS_PER_STATION_ROW = 2;
export const MAX_STATION_ROWS = 3;
/** Rooms at most; past this, new projects stay in the common office. */
export const MAX_ROOMS = 8;
/** An empty room stays this long, so a session reopened soon finds it. */
export const ROOM_LINGER_MS = 10 * 60_000;

const ROOM_LABEL_PREFIX = 'sala:';
const ROOM_FLOOR: TileTypeVal = TileType.FLOOR_7;
const DESK = 'DESK_FRONT';
const PC = 'PC_FRONT_OFF';
const CHAIR = 'CUSHIONED_BENCH';
const PLANT = 'PLANT';

/** The neon sign over the lounge's sofas, hung on the wall. */
export const NEON_SIGN = 'NEON_COFFEE';
/** The coffee machine beside it, standing against the wall. */
export const COFFEE_MACHINE = 'COFFEE_MACHINE';
/** The furniture of the compact office that is on a wall tile, on purpose. */
export const ON_LOUNGE_WALL: ReadonlySet<string> = new Set([NEON_SIGN, COFFEE_MACHINE]);
/** The lounge of the compact office: 7x7 inside, centred on the corridor. */
const LOUNGE_HALF = 3;
const WALL_COLOR: ColorValue = { h: 222, s: 28, b: -100, c: -55 };
const LOUNGE_FLOOR: TileTypeVal = TileType.FLOOR_1;
const LOUNGE_COLOR: ColorValue = { h: 262, s: 34, b: -30, c: -80 };
const CORRIDOR_FLOOR: TileTypeVal = TileType.FLOOR_9;
const CORRIDOR_COLOR: ColorValue = { h: 222, s: 8, b: -22, c: -10 };

export interface RoomState {
  project: string;
  slot: number;
  stationRows: number;
  /** When its last agent left (ms), or null while someone is in it. */
  emptySince: number | null;
}

export interface PlacedRoom {
  project: string;
  /** The room's label in `roomTiles`. */
  label: string;
  slot: number;
  /** Top-left tile of the room, walls included; its size, walls included. */
  col: number;
  row: number;
  width: number;
  height: number;
  seats: number;
  /** Hex colour of the room's name. */
  color: string;
  /** Where the room's name is written: the middle of its top wall, or (a
   *  room under the corridor has none) of the row under it. */
  signCol: number;
  signRow: number;
}

export interface ComposedOffice {
  layout: OfficeLayout;
  rooms: PlacedRoom[];
  /** Per tile of `layout`, the label of the room it is in (null: none). */
  roomTiles: Array<string | null>;
  /** A fixed point of the office (the corridor's start, in the compact one):
   *  when rooms open over it everything else moves down, and this tells by
   *  how much. */
  origin: { col: number; row: number };
  /** Whether a way from the base office to the corridor was found. */
  connected: boolean;
}

export function roomLabel(project: string): string {
  return ROOM_LABEL_PREFIX + project;
}

function stationRowsFor(agents: number): number {
  return Math.min(MAX_STATION_ROWS, Math.max(1, Math.ceil(agents / SEATS_PER_STATION_ROW)));
}

/**
 * The rooms for the agents in the office now: `counts` is how many agents
 * each project has. Rooms keep their slot; a room only grows; an empty room is
 * dropped ROOM_LINGER_MS after it emptied (sooner if a new project needs its
 * slot); a new project takes the lowest free slot, if there is one.
 */
export function planRooms(
  prev: readonly RoomState[],
  counts: ReadonlyMap<string, number>,
  now: number,
): RoomState[] {
  const next: RoomState[] = [];
  for (const room of prev) {
    const count = counts.get(room.project) ?? 0;
    if (count > 0) {
      next.push({
        ...room,
        stationRows: Math.max(room.stationRows, stationRowsFor(count)),
        emptySince: null,
      });
    } else {
      const emptySince = room.emptySince ?? now;
      if (now - emptySince < ROOM_LINGER_MS) next.push({ ...room, emptySince });
    }
  }
  const taken = new Set(next.map((r) => r.slot));
  const known = new Set(next.map((r) => r.project));
  const arrivals = [...counts.entries()]
    .filter(([project, count]) => count > 0 && !known.has(project))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [project, count] of arrivals) {
    let slot = 0;
    while (taken.has(slot)) slot++;
    if (slot >= MAX_ROOMS) {
      // No slot left: the room that has been empty the longest gives its up.
      const empty = next
        .filter((r) => r.emptySince !== null)
        .sort((a, b) => (a.emptySince ?? 0) - (b.emptySince ?? 0))[0];
      if (!empty) break;
      next.splice(next.indexOf(empty), 1);
      slot = empty.slot;
    }
    taken.add(slot);
    next.push({ project, slot, stationRows: stationRowsFor(count), emptySince: null });
  }
  return next;
}

/** Whether two plans draw the same office (emptySince does not show). */
export function sameRooms(a: readonly RoomState[], b: readonly RoomState[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: RoomState) => `${r.slot}|${r.stationRows}|${r.project}`;
  const keys = new Set(a.map(key));
  return b.every((r) => keys.has(key(r)));
}

/** A stable hue (0-359) from a project's name. */
function projectHue(project: string): number {
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function hueToHex(hue: number): string {
  // HSL(hue, 60%, 68%): light enough to read over the dark walls.
  const s = 0.6;
  const l = 0.68;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function isFloor(tile: TileTypeVal | undefined): boolean {
  return tile !== undefined && tile !== TileType.WALL && tile !== TileType.VOID;
}

/** The office being drawn: its tiles, their colours and their rooms. */
class Plan {
  readonly tiles: TileTypeVal[];
  readonly tileColors: Array<ColorValue | null>;
  readonly roomTiles: Array<string | null>;
  readonly furniture: PlacedFurniture[] = [];
  readonly rooms: PlacedRoom[] = [];
  readonly cols: number;
  readonly rows: number;
  private readonly wallColor: ColorValue | null;

  constructor(cols: number, rows: number, wallColor: ColorValue | null) {
    this.cols = cols;
    this.rows = rows;
    this.wallColor = wallColor;
    const size = cols * rows;
    this.tiles = new Array<TileTypeVal>(size).fill(TileType.VOID);
    this.tileColors = new Array<ColorValue | null>(size).fill(null);
    this.roomTiles = new Array<string | null>(size).fill(null);
  }

  at(c: number, r: number): number {
    return r * this.cols + c;
  }

  put(c: number, r: number, tile: TileTypeVal, color: ColorValue | null): void {
    this.tiles[this.at(c, r)] = tile;
    this.tileColors[this.at(c, r)] = color ? { ...color } : null;
  }

  wall(c: number, r: number): void {
    this.put(c, r, TileType.WALL, this.wallColor);
  }

  /** Wall the void tiles beside and over (c,r); never under it (see "Walls"
   *  at the top of this file). */
  enclose(c: number, r: number): void {
    for (let dr = -1; dr <= 0; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
        if (this.tiles[this.at(nc, nr)] === TileType.VOID) this.wall(nc, nr);
      }
    }
  }

  /**
   * One project's room: its left wall on column `x0`, its floor from row
   * `top` down. It is open on the corridor's side and at the bottom (see
   * "Walls" at the top of this file); `wallOnTop` closes it at the top, for a
   * room over the corridor. Its name goes on that wall, or under the room.
   */
  room(spec: RoomState, x0: number, top: number, wallOnTop: boolean): void {
    const label = roomLabel(spec.project);
    const hue = projectHue(spec.project);
    const floorColor: ColorValue = { h: hue, s: 40, b: -42, c: -85 };
    const depth = spec.stationRows * STATION_ROWS;
    const last = top + depth - 1;
    const firstWall = wallOnTop ? top - 1 : top;
    for (let r = firstWall; r <= last; r++) {
      this.wall(x0, r);
      this.wall(x0 + ROOM_PITCH, r);
    }
    if (wallOnTop) for (let c = x0; c <= x0 + ROOM_PITCH; c++) this.wall(c, top - 1);
    for (let r = top; r <= last; r++) {
      for (let c = x0 + 1; c < x0 + ROOM_PITCH; c++) {
        this.put(c, r, ROOM_FLOOR, floorColor);
        this.roomTiles[this.at(c, r)] = label;
      }
    }

    // Rows of desks from the top; each ends in a free row.
    for (let k = 0; k < spec.stationRows; k++) {
      const deskRow = top + k * STATION_ROWS;
      for (let j = 0; j < SEATS_PER_STATION_ROW; j++) {
        const deskCol = x0 + 1 + j * 4;
        const uid = `${label}:${k}:${j}`;
        this.furniture.push({ uid: `${uid}:mesa`, type: DESK, col: deskCol, row: deskRow });
        this.furniture.push({ uid: `${uid}:pc`, type: PC, col: deskCol + 1, row: deskRow });
        this.furniture.push({
          uid: `${uid}:assento`,
          type: CHAIR,
          col: deskCol + 1,
          row: deskRow + 2,
        });
      }
    }
    // Two tiles tall (its top is walkable background): it stands on the last row.
    this.furniture.push({ uid: `${label}:planta`, type: PLANT, col: x0 + 1, row: last - 1 });

    this.rooms.push({
      project: spec.project,
      label,
      slot: spec.slot,
      col: x0,
      row: firstWall,
      width: ROOM_WIDTH,
      height: last - firstWall + 1,
      seats: spec.stationRows * SEATS_PER_STATION_ROW,
      color: hueToHex(hue),
      signCol: x0 + ROOM_PITCH / 2,
      signRow: wallOnTop ? top - 1 : last + 1,
    });
  }
}

/**
 * The office to draw for these rooms. `compact`: the lounge-and-corridor
 * office (see the top of this file); else the base with the rooms under it.
 * `blocked` holds the base's furniture-blocked tiles as `col,row` keys (the
 * way down must not start under a desk). With no rooms, the base itself.
 */
export function composeOffice(
  base: OfficeLayout,
  specs: readonly RoomState[],
  blocked: ReadonlySet<string>,
  compact = false,
): ComposedOffice {
  if (specs.length === 0) {
    return { layout: base, rooms: [], roomTiles: [], origin: { col: 0, row: 0 }, connected: true };
  }
  const bySlot = [...specs].sort((a, b) => a.slot - b.slot);
  return compact ? composeCompact(base, bySlot) : composeUnder(base, bySlot, blocked);
}

/** Slots alternate sides of the corridor: 0 under it, 1 over it, 2 under... */
function composeCompact(base: OfficeLayout, specs: readonly RoomState[]): ComposedOffice {
  const over = specs.filter((s) => s.slot % 2 === 1);
  const under = specs.filter((s) => s.slot % 2 === 0);
  const deepest = (list: readonly RoomState[]) =>
    list.length > 0 ? Math.max(...list.map((s) => s.stationRows)) * STATION_ROWS : 0;
  // Rows over the corridor: the lounge's half or the deepest room, and the
  // wall on top of it. Under it: the same, and a row for the rooms' names.
  const above = Math.max(LOUNGE_HALF, deepest(over)) + 1;
  const below = Math.max(LOUNGE_HALF, deepest(under)) + 1;
  // Row 0 stays empty: the top walls are drawn taller than their tile.
  const corridorRow = 1 + above;
  const columns = Math.floor(Math.max(...specs.map((s) => s.slot)) / 2) + 1;
  const plan = new Plan(ROOM_WIDTH + columns * ROOM_PITCH, corridorRow + below + 1, WALL_COLOR);

  // ── The lounge: columns 0-8, centred on the corridor and open to it.
  const loungeTop = corridorRow - LOUNGE_HALF;
  const loungeBottom = corridorRow + LOUNGE_HALF;
  for (let c = 0; c <= ROOM_PITCH; c++) plan.wall(c, loungeTop - 1);
  for (let r = loungeTop; r <= loungeBottom; r++) {
    plan.wall(0, r);
    plan.wall(ROOM_PITCH, r);
    for (let c = 1; c < ROOM_PITCH; c++) plan.put(c, r, LOUNGE_FLOOR, LOUNGE_COLOR);
  }
  const add = (name: string, type: string, col: number, row: number) =>
    plan.furniture.push({ uid: `comum:${name}`, type, col, row });
  // Sofas around the coffee table.
  const tableCol = 3;
  const tableRow = corridorRow - 1;
  add('mesa', 'COFFEE_TABLE', tableCol, tableRow);
  add('sofa-cima', 'SOFA_FRONT', tableCol, tableRow - 1);
  add('sofa-baixo', 'SOFA_BACK', tableCol, tableRow + 2);
  add('sofa-esq', 'SOFA_SIDE', tableCol - 1, tableRow);
  add('sofa-dir', 'SOFA_SIDE:left', tableCol + 2, tableRow);
  // No mug on the table that is furniture: the cups on it are the ones the
  // agents leave, and the robot takes (office/engine/coffeeCorner.ts).
  // The coffee corner (scripts/coffee-corner-art.py): the neon sign hung on
  // the wall over the sofas and, right beside it, the machine standing against
  // the wall (its upper half over the wall, its counter on the lounge's first
  // row). These two are the only furniture on a wall (ON_LOUNGE_WALL).
  add('neon-cafe', NEON_SIGN, tableCol, loungeTop - 2);
  add('maquina-cafe', COFFEE_MACHINE, tableCol + 2, loungeTop - 1);
  // The game corner, at the foot of the lounge: the TV on its cabinet (its
  // upper tile is only picture: one walks behind it) and two poufs facing it,
  // down and to its left. Not right under it: with the wall on one side and
  // the lounge's edge below, a pouf there could only be reached over the other.
  add('videogame', 'VIDEO_GAME', ROOM_PITCH - 2, loungeBottom - 2);
  add('pufe-1', 'POUF', ROOM_PITCH - 4, loungeBottom);
  add('pufe-2', 'POUF', ROOM_PITCH - 3, loungeBottom);
  // Not in the corner: there it would close off the floor behind the sofa
  // (and the table's back, where the robot takes the cups).
  add('planta-1', PLANT, 2, loungeTop);
  add('planta-2', 'PLANT_2', ROOM_PITCH - 1, loungeTop);
  add('lixeira', 'BIN', 1, loungeBottom);

  // ── The corridor, from the lounge to the last room, with a wall over it
  // wherever no room is.
  for (let c = ROOM_PITCH; c < plan.cols; c++) {
    plan.wall(c, corridorRow - 1);
    if (c === plan.cols - 1) plan.wall(c, corridorRow);
    else plan.put(c, corridorRow, CORRIDOR_FLOOR, CORRIDOR_COLOR);
  }

  for (const spec of specs) {
    const x0 = ROOM_PITCH + Math.floor(spec.slot / 2) * ROOM_PITCH;
    const depth = spec.stationRows * STATION_ROWS;
    if (spec.slot % 2 === 0) plan.room(spec, x0, corridorRow + 1, false);
    else plan.room(spec, x0, corridorRow - depth, true);
  }

  const layout: OfficeLayout = {
    version: 1,
    cols: plan.cols,
    rows: plan.rows,
    tiles: plan.tiles,
    tileColors: plan.tileColors,
    furniture: plan.furniture,
    ...(base.layoutRevision !== undefined ? { layoutRevision: base.layoutRevision } : {}),
    ...(base.pets ? { pets: base.pets.map((p) => ({ ...p })) } : {}),
  };
  return {
    layout,
    rooms: plan.rooms,
    roomTiles: plan.roomTiles,
    origin: { col: 0, row: corridorRow },
    connected: true,
  };
}

function composeUnder(
  base: OfficeLayout,
  specs: readonly RoomState[],
  blocked: ReadonlySet<string>,
): ComposedOffice {
  const slots = Math.max(...specs.map((s) => s.slot)) + 1;
  const corridorRow = base.rows;
  const deepest = Math.max(...specs.map((s) => s.stationRows)) * STATION_ROWS;
  const wallIndex = base.tiles.indexOf(TileType.WALL);
  const plan = new Plan(
    Math.max(base.cols, slots * ROOM_PITCH + 1),
    // The corridor, the rooms and a row for their names.
    corridorRow + deepest + 2,
    wallIndex >= 0 ? (base.tileColors?.[wallIndex] ?? null) : null,
  );
  const { cols } = plan;
  const size = cols * plan.rows;
  const carpetTiles: Array<CarpetTile | null> | undefined = base.carpetTiles
    ? new Array<CarpetTile | null>(size).fill(null)
    : undefined;
  const areaTiles: Array<string | null> | undefined = base.areaTiles
    ? new Array<string | null>(size).fill(null)
    : undefined;
  for (let r = 0; r < base.rows; r++) {
    for (let c = 0; c < base.cols; c++) {
      const from = r * base.cols + c;
      const to = plan.at(c, r);
      plan.tiles[to] = base.tiles[from];
      plan.tileColors[to] = base.tileColors?.[from] ?? null;
      if (carpetTiles) carpetTiles[to] = base.carpetTiles?.[from] ?? null;
      if (areaTiles) areaTiles[to] = base.areaTiles?.[from] ?? null;
    }
  }
  plan.furniture.push(...base.furniture);

  const baseTile = (c: number, r: number): TileTypeVal | undefined =>
    c >= 0 && c < base.cols && r >= 0 && r < base.rows ? base.tiles[r * base.cols + c] : undefined;

  // ── The way down: the column where the base's lowest tile is open floor,
  // or a wall with open floor right above it (a door is cut there). The
  // closest to the bottom wins, then the closest to the wing's middle.
  const middle = (slots * ROOM_PITCH) / 2;
  let way: { col: number; fromRow: number; doorRow: number | null; score: number } | null = null;
  for (let c = 1; c < Math.min(base.cols, cols - 1); c++) {
    let r = base.rows - 1;
    while (r >= 0 && baseTile(c, r) === TileType.VOID) r--;
    if (r < 0) continue;
    let fromRow: number;
    let doorRow: number | null = null;
    if (isFloor(baseTile(c, r)) && !blocked.has(`${c},${r}`)) {
      fromRow = r;
    } else if (
      baseTile(c, r) === TileType.WALL &&
      !blocked.has(`${c},${r}`) &&
      isFloor(baseTile(c, r - 1)) &&
      !blocked.has(`${c},${r - 1}`)
    ) {
      fromRow = r - 1;
      doorRow = r;
    } else {
      continue;
    }
    const gap = base.rows - 1 - r;
    const score = gap * 1000 + (doorRow === null ? 0 : 500) + Math.abs(c - middle);
    if (!way || score < way.score) way = { col: c, fromRow, doorRow, score };
  }

  const corridorFloor: TileTypeVal = way
    ? (baseTile(way.col, way.fromRow) as TileTypeVal)
    : TileType.FLOOR_1;
  const corridorColor = way
    ? (base.tileColors?.[way.fromRow * base.cols + way.col] ?? null)
    : null;
  const opened: Array<{ c: number; r: number }> = [];
  if (way) {
    for (let r = way.doorRow ?? way.fromRow + 1; r < base.rows; r++) {
      plan.put(way.col, r, corridorFloor, corridorColor);
      opened.push({ c: way.col, r });
    }
  }

  // ── The corridor, the rooms opening onto it from under.
  for (let c = 0; c < cols; c++) {
    if (c === 0 || c === cols - 1) plan.wall(c, corridorRow);
    else {
      plan.put(c, corridorRow, corridorFloor, corridorColor);
      opened.push({ c, r: corridorRow });
    }
  }
  // Close what the corridor and the way down opened onto nothing, beside
  // and over them.
  for (const { c, r } of opened) plan.enclose(c, r);

  for (const spec of specs) plan.room(spec, spec.slot * ROOM_PITCH, corridorRow + 1, false);

  const layout: OfficeLayout = {
    ...base,
    cols,
    rows: plan.rows,
    tiles: plan.tiles,
    tileColors: plan.tileColors,
    furniture: plan.furniture,
    ...(carpetTiles ? { carpetTiles } : {}),
    ...(areaTiles ? { areaTiles } : {}),
    ...(base.pets ? { pets: base.pets.map((p) => ({ ...p })) } : {}),
  };
  return {
    layout,
    rooms: plan.rooms,
    roomTiles: plan.roomTiles,
    origin: { col: 0, row: 0 },
    connected: way !== null,
  };
}
