import { describe, expect, it } from 'vitest';

import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import {
  composeOffice,
  MAX_ROOMS,
  MAX_STATION_ROWS,
  planRooms,
  ROOM_LINGER_MS,
  ROOM_PITCH,
  roomLabel,
  type RoomState,
  sameRooms,
} from '../src/viewer/projectRooms.js';

const W = TileType.WALL;
const F = TileType.FLOOR_1;
const V = TileType.VOID;
const NOW = 1_800_000_000_000;

/** A walled 6x5 office; `open` leaves the bottom wall out (floor to the edge). */
function baseOffice(open: boolean): OfficeLayout {
  const rows = [
    [V, V, V, V, V, V],
    [W, W, W, W, W, W],
    [W, F, F, F, F, W],
    [W, F, F, F, F, W],
    open ? [W, F, F, F, F, W] : [W, W, W, W, W, W],
  ];
  return {
    version: 1,
    cols: 6,
    rows: rows.length,
    tiles: rows.flat(),
    furniture: [{ uid: 'base-desk', type: 'DESK_FRONT', col: 1, row: 2 }],
    pets: [{ id: 'cat', petType: 0 }],
  };
}

const counts = (by: Record<string, number>) => new Map(Object.entries(by));

const room = (project: string, slot: number, stationRows = 1): RoomState => ({
  project,
  slot,
  stationRows,
  emptySince: null,
});

/** Tiles reachable on foot from (col,row), furniture ignored. */
function reachable(layout: OfficeLayout, col: number, row: number): Set<string> {
  const seen = new Set<string>([`${col},${row}`]);
  const queue = [{ col, row }];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = at.col + dc;
      const r = at.row + dr;
      if (c < 0 || c >= layout.cols || r < 0 || r >= layout.rows) continue;
      const tile = layout.tiles[r * layout.cols + c];
      if (tile === W || tile === V || seen.has(`${c},${r}`)) continue;
      seen.add(`${c},${r}`);
      queue.push({ col: c, row: r });
    }
  }
  return seen;
}

describe('project rooms: the plan', () => {
  it("a room opens with a project's first agent, in the lowest free slot", () => {
    const plan = planRooms([], counts({ beta: 1, alfa: 3 }), NOW);
    expect(plan).toEqual([room('alfa', 0, 2), room('beta', 1, 1)]);
  });

  it('a room keeps its slot when another closes, and the slot is reused', () => {
    const before = [room('alfa', 0), room('beta', 1)];
    const later = NOW + ROOM_LINGER_MS;
    const emptied = planRooms(before, counts({ beta: 1 }), NOW);
    expect(emptied.find((r) => r.project === 'alfa')?.emptySince).toBe(NOW);
    const closed = planRooms(emptied, counts({ beta: 1, gama: 1 }), later);
    expect(closed).toEqual([room('beta', 1), room('gama', 0)]);
  });

  it('an empty room lingers, and stays if its project comes back', () => {
    const emptied = planRooms([room('alfa', 0)], new Map(), NOW);
    expect(emptied).toHaveLength(1);
    const back = planRooms(emptied, counts({ alfa: 1 }), NOW + ROOM_LINGER_MS - 1);
    expect(back).toEqual([room('alfa', 0)]);
    expect(planRooms(emptied, new Map(), NOW + ROOM_LINGER_MS)).toEqual([]);
  });

  it('a room grows with its project and never shrinks while open', () => {
    const grown = planRooms([room('alfa', 0)], counts({ alfa: 5 }), NOW);
    expect(grown[0].stationRows).toBe(3);
    expect(planRooms(grown, counts({ alfa: 1 }), NOW)[0].stationRows).toBe(3);
    expect(planRooms([], counts({ alfa: 99 }), NOW)[0].stationRows).toBe(MAX_STATION_ROWS);
  });

  it('past the last slot, new projects get no room', () => {
    const many = new Map<string, number>();
    for (let i = 0; i < MAX_ROOMS + 2; i++) many.set(`p${i}`, 1);
    const plan = planRooms([], many, NOW);
    expect(plan).toHaveLength(MAX_ROOMS);
    expect(new Set(plan.map((r) => r.slot)).size).toBe(MAX_ROOMS);
  });

  it('only what is drawn makes two plans differ', () => {
    expect(sameRooms([room('a', 0)], [{ ...room('a', 0), emptySince: NOW }])).toBe(true);
    expect(sameRooms([room('a', 0)], [room('a', 0, 2)])).toBe(false);
    expect(sameRooms([room('a', 0)], [room('a', 1)])).toBe(false);
    expect(sameRooms([room('a', 0)], [])).toBe(false);
  });
});

describe('project rooms: the composed office', () => {
  it('with no rooms the base is drawn as it is', () => {
    const base = baseOffice(true);
    expect(composeOffice(base, [], new Set()).layout).toBe(base);
  });

  it('the base is kept, untouched, at the top-left', () => {
    const base = baseOffice(true);
    const snapshot = JSON.stringify(base);
    const { layout } = composeOffice(base, [room('alfa', 0)], new Set());
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(layout.cols).toBe(ROOM_PITCH + 1);
    expect(layout.tiles).toHaveLength(layout.cols * layout.rows);
    expect(layout.tileColors).toHaveLength(layout.tiles.length);
    expect(layout.areaTiles).toHaveLength(layout.tiles.length);
    for (let r = 0; r < base.rows; r++) {
      for (let c = 0; c < base.cols; c++) {
        expect(layout.tiles[r * layout.cols + c]).toBe(base.tiles[r * base.cols + c]);
      }
    }
    expect(layout.furniture[0]).toEqual(base.furniture[0]);
    expect(layout.pets).toEqual(base.pets);
  });

  it.each([
    ['open at the bottom', true],
    ['walled at the bottom (a door is cut)', false],
  ])('every seat of every room is reachable from the base: %s', (_name, open) => {
    const base = baseOffice(open);
    const { layout, rooms, connected } = composeOffice(
      base,
      [room('alfa', 0, 2), room('beta', 2, 1)],
      new Set(),
    );
    expect(connected).toBe(true);
    expect(rooms.map((r) => [r.project, r.seats])).toEqual([
      ['alfa', 4],
      ['beta', 2],
    ]);
    const walk = reachable(layout, 1, 2);
    const seats = layout.furniture.filter((f) => f.uid.endsWith(':assento'));
    expect(seats).toHaveLength(6);
    for (const seat of seats) {
      expect(walk.has(`${seat.col},${seat.row}`)).toBe(true);
      const project = seat.uid.startsWith(roomLabel('alfa')) ? 'alfa' : 'beta';
      expect(layout.areaTiles?.[seat.row * layout.cols + seat.col]).toBe(roomLabel(project));
    }
    expect(layout.areas?.map((a) => a.label)).toEqual([roomLabel('alfa'), roomLabel('beta')]);
  });

  it('the way down does not start under furniture', () => {
    const base = baseOffice(false);
    // Furniture stands against the bottom wall everywhere but on column 1.
    const blocked = new Set(['2,3', '3,3', '4,3']);
    const { layout, connected } = composeOffice(base, [room('alfa', 0)], blocked);
    expect(connected).toBe(true);
    const bottomWall = (c: number) => layout.tiles[(base.rows - 1) * layout.cols + c];
    expect(bottomWall(1)).toBe(F);
    expect([2, 3, 4].map(bottomWall)).toEqual([W, W, W]);
  });

  it('an office with no way out still gets its rooms, flagged as apart', () => {
    const sealed: OfficeLayout = {
      version: 1,
      cols: 3,
      rows: 3,
      tiles: [W, W, W, W, F, W, W, W, W],
      furniture: [],
    };
    // The only floor tile is blocked, so no door can be cut under it.
    const { rooms, connected } = composeOffice(sealed, [room('alfa', 0)], new Set(['1,1']));
    expect(connected).toBe(false);
    expect(rooms).toHaveLength(1);
  });

  it('a second room does not move the first', () => {
    const base = baseOffice(true);
    const one = composeOffice(base, [room('alfa', 1)], new Set());
    const two = composeOffice(base, [room('alfa', 1), room('beta', 0, 3)], new Set());
    const mine = (f: { uid: string }) => f.uid.startsWith(roomLabel('alfa'));
    expect(two.layout.furniture.filter(mine)).toEqual(one.layout.furniture.filter(mine));
    expect(two.rooms.find((r) => r.project === 'alfa')).toEqual(one.rooms[0]);
  });

  it('nothing walkable is left open onto the void', () => {
    const base = baseOffice(false);
    const { layout } = composeOffice(base, [room('alfa', 0), room('beta', 1, 2)], new Set());
    for (let r = base.rows; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const tile = layout.tiles[r * layout.cols + c];
        if (tile === W || tile === V) continue;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nc = c + dc;
          const nr = r + dr;
          const inside = nc >= 0 && nc < layout.cols && nr >= 0 && nr < layout.rows;
          expect(inside && layout.tiles[nr * layout.cols + nc] !== V).toBe(true);
        }
      }
    }
  });
});
