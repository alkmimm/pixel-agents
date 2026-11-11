/**
 * pixel-agents-secure (local): one room per project, opened and closed by who
 * is in the office.
 *
 * The layout the server sends (the "base") is never changed or saved. The
 * viewer draws a composed office instead: the base, a corridor under it and,
 * under the corridor, a wing with one room per project that has agents now.
 * A room opens with the project's first agent, grows a row of desks when the
 * project needs more seats, and closes some time after its last agent left.
 *
 * Each room keeps its slot (its place in the wing) for as long as it lives, so
 * a room closing never moves the others. A room is an Area of the layout
 * (label `sala:<project>`), which is what seats a project's agents in it
 * (OfficeState.roomAreas).
 *
 * Free of React and the DOM, so it is tested directly.
 */
import type { ColorValue } from '../components/ui/types.js';
import type {
  AreaDefinition,
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
/** Rooms side by side; past this, new projects stay in the base office. */
export const MAX_ROOMS = 7;
/** An empty room stays this long, so a session reopened soon finds it. */
export const ROOM_LINGER_MS = 10 * 60_000;

const ROOM_LABEL_PREFIX = 'sala:';
const ROOM_FLOOR: TileTypeVal = TileType.FLOOR_7;
const DESK = 'DESK_FRONT';
const PC = 'PC_FRONT_OFF';
const CHAIR = 'CUSHIONED_BENCH';
const PLANT = 'PLANT';

export interface RoomState {
  project: string;
  slot: number;
  stationRows: number;
  /** When its last agent left (ms), or null while someone is in it. */
  emptySince: number | null;
}

export interface PlacedRoom {
  project: string;
  /** The room's Area label. */
  label: string;
  /** Top-left tile of the room, walls included. */
  col: number;
  row: number;
  width: number;
  height: number;
  seats: number;
  /** Hex colour of the room (its Area colour, its name's colour). */
  color: string;
}

export interface ComposedOffice {
  layout: OfficeLayout;
  rooms: PlacedRoom[];
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
 * dropped ROOM_LINGER_MS after it emptied; a new project takes the lowest
 * free slot, if there is one.
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
    if (slot >= MAX_ROOMS) break;
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

/**
 * The base office with the rooms' wing under it. `blocked` holds the base's
 * furniture-blocked tiles as `col,row` keys (the way down must not start
 * under a desk). With no rooms, the base itself is returned.
 */
export function composeOffice(
  base: OfficeLayout,
  specs: readonly RoomState[],
  blocked: ReadonlySet<string>,
): ComposedOffice {
  if (specs.length === 0) return { layout: base, rooms: [], connected: true };

  const slots = Math.max(...specs.map((s) => s.slot)) + 1;
  const cols = Math.max(base.cols, slots * ROOM_PITCH + 1);
  const corridorRow = base.rows;
  const wallRow = base.rows + 1;
  const deepest = Math.max(...specs.map((s) => s.stationRows)) * STATION_ROWS;
  const rows = wallRow + deepest + 2;
  const size = cols * rows;

  const tiles: TileTypeVal[] = new Array<TileTypeVal>(size).fill(TileType.VOID);
  const tileColors: Array<ColorValue | null> = new Array<ColorValue | null>(size).fill(null);
  const carpetTiles: Array<CarpetTile | null> | undefined = base.carpetTiles
    ? new Array<CarpetTile | null>(size).fill(null)
    : undefined;
  const areaTiles: Array<string | null> = new Array<string | null>(size).fill(null);
  for (let r = 0; r < base.rows; r++) {
    for (let c = 0; c < base.cols; c++) {
      const from = r * base.cols + c;
      const to = r * cols + c;
      tiles[to] = base.tiles[from];
      tileColors[to] = base.tileColors?.[from] ?? null;
      if (carpetTiles) carpetTiles[to] = base.carpetTiles?.[from] ?? null;
      areaTiles[to] = base.areaTiles?.[from] ?? null;
    }
  }

  const at = (c: number, r: number) => r * cols + c;
  const baseTile = (c: number, r: number): TileTypeVal | undefined =>
    c >= 0 && c < base.cols && r >= 0 && r < base.rows ? base.tiles[r * base.cols + c] : undefined;
  const wallIndex = base.tiles.indexOf(TileType.WALL);
  const wallColor = wallIndex >= 0 ? (base.tileColors?.[wallIndex] ?? null) : null;
  const put = (c: number, r: number, tile: TileTypeVal, color: ColorValue | null) => {
    tiles[at(c, r)] = tile;
    tileColors[at(c, r)] = color ? { ...color } : null;
  };
  const wall = (c: number, r: number) => put(c, r, TileType.WALL, wallColor);

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
      put(way.col, r, corridorFloor, corridorColor);
      opened.push({ c: way.col, r });
    }
  }

  // ── The corridor, and the wall under it (the rooms' top wall).
  for (let c = 0; c < cols; c++) {
    if (c === 0 || c === cols - 1) wall(c, corridorRow);
    else {
      put(c, corridorRow, corridorFloor, corridorColor);
      opened.push({ c, r: corridorRow });
    }
    wall(c, wallRow);
  }
  // Close what the corridor and the way down opened onto nothing.
  for (const { c, r } of opened) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        if (tiles[at(nc, nr)] === TileType.VOID) wall(nc, nr);
      }
    }
  }

  // ── The rooms.
  const furniture: PlacedFurniture[] = [...base.furniture];
  const areas: AreaDefinition[] = [...(base.areas ?? [])];
  const rooms: PlacedRoom[] = [];
  for (const spec of [...specs].sort((a, b) => a.slot - b.slot)) {
    const label = roomLabel(spec.project);
    const hue = projectHue(spec.project);
    const color = hueToHex(hue);
    const floorColor: ColorValue = { h: hue, s: 40, b: -42, c: -85 };
    const x0 = spec.slot * ROOM_PITCH;
    const depth = spec.stationRows * STATION_ROWS;
    const bottom = wallRow + depth + 1;
    for (let r = wallRow; r <= bottom; r++) {
      wall(x0, r);
      wall(x0 + ROOM_PITCH, r);
    }
    for (let c = x0; c <= x0 + ROOM_PITCH; c++) wall(c, bottom);
    for (let r = wallRow + 1; r < bottom; r++) {
      for (let c = x0 + 1; c < x0 + ROOM_PITCH; c++) {
        put(c, r, ROOM_FLOOR, floorColor);
        areaTiles[at(c, r)] = label;
      }
    }
    // The door, on the free column between the two desks.
    put(x0 + 4, wallRow, ROOM_FLOOR, floorColor);
    areaTiles[at(x0 + 4, wallRow)] = label;

    for (let k = 0; k < spec.stationRows; k++) {
      const top = wallRow + 1 + k * STATION_ROWS;
      for (let j = 0; j < SEATS_PER_STATION_ROW; j++) {
        const deskCol = x0 + 1 + j * 4;
        const uid = `${label}:${k}:${j}`;
        furniture.push({ uid: `${uid}:mesa`, type: DESK, col: deskCol, row: top });
        furniture.push({ uid: `${uid}:pc`, type: PC, col: deskCol + 1, row: top });
        furniture.push({ uid: `${uid}:assento`, type: CHAIR, col: deskCol + 1, row: top + 2 });
      }
    }
    // Two tiles tall (its top is walkable background): it stands on the last row.
    furniture.push({ uid: `${label}:planta`, type: PLANT, col: x0 + 1, row: bottom - 2 });

    areas.push({ label, color });
    rooms.push({
      project: spec.project,
      label,
      col: x0,
      row: wallRow,
      width: ROOM_WIDTH,
      height: depth + 2,
      seats: spec.stationRows * SEATS_PER_STATION_ROW,
      color,
    });
  }

  const layout: OfficeLayout = {
    ...base,
    cols,
    rows,
    tiles,
    tileColors,
    furniture,
    areas,
    areaTiles,
    ...(carpetTiles ? { carpetTiles } : {}),
    ...(base.pets ? { pets: base.pets.map((p) => ({ ...p })) } : {}),
  };
  return { layout, rooms, connected: way !== null };
}
