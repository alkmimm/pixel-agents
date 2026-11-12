import { describe, expect, it } from 'vitest';

import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import {
  COFFEE_MACHINE,
  composeOffice,
  MAX_ROOMS,
  MAX_STATION_ROWS,
  NEON_SIGN,
  ON_LOUNGE_WALL,
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

  it('with no slot left, the room empty the longest gives its up', () => {
    const full: RoomState[] = [];
    for (let i = 0; i < MAX_ROOMS; i++) full.push(room(`p${i}`, i));
    full[2] = { ...full[2], emptySince: NOW - 2_000 };
    full[5] = { ...full[5], emptySince: NOW - 1_000 };
    const live = new Map<string, number>([['novo', 1]]);
    for (const r of full) if (r.emptySince === null) live.set(r.project, 1);
    const plan = planRooms(full, live, NOW);
    expect(plan).toHaveLength(MAX_ROOMS);
    expect(plan.find((r) => r.project === 'novo')?.slot).toBe(2);
    expect(plan.some((r) => r.project === 'p2')).toBe(false);
    expect(plan.some((r) => r.project === 'p5')).toBe(true);
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
    // A room is not an Area: nothing is added to the layout's own.
    expect(layout.areas).toBeUndefined();
    expect(layout.areaTiles).toBeUndefined();
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
    const { layout, rooms, roomTiles, connected } = composeOffice(
      base,
      [room('alfa', 0, 2), room('beta', 2, 1)],
      new Set(),
    );
    expect(roomTiles).toHaveLength(layout.tiles.length);
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
      expect(roomTiles[seat.row * layout.cols + seat.col]).toBe(roomLabel(project));
    }
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

  it('nothing walkable is left open onto the void, beside or over it', () => {
    const base = baseOffice(false);
    const { layout } = composeOffice(base, [room('alfa', 0), room('beta', 1, 2)], new Set());
    for (let r = base.rows; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const tile = layout.tiles[r * layout.cols + c];
        if (tile === W || tile === V) continue;
        // Beside and over it; under it the void needs no wall (a wall there
        // would be drawn over whoever stands on this row).
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
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

describe('project rooms: the compact office', () => {
  const compact = (specs: RoomState[]) => composeOffice(baseOffice(true), specs, new Set(), true);
  const seatsOf = (layout: OfficeLayout) =>
    layout.furniture.filter((f) => f.uid.endsWith(':assento'));

  it('the base office is not drawn; its pets move in', () => {
    const { layout, connected } = compact([room('alfa', 0)]);
    expect(connected).toBe(true);
    expect(layout.furniture.some((f) => f.uid === 'base-desk')).toBe(false);
    expect(layout.furniture.some((f) => f.type === 'COFFEE')).toBe(true);
    // The coffee corner: the machine and its neon sign, inside the plan.
    for (const type of ['COFFEE_MACHINE', 'NEON_COFFEE']) {
      const item = layout.furniture.find((f) => f.type === type)!;
      expect(item, type).toBeDefined();
      expect(item.row, type).toBeGreaterThanOrEqual(0);
      expect(item.col, type).toBeGreaterThan(0);
      expect(item.col + 1, type).toBeLessThan(layout.cols);
    }
    // The game corner: the video game and two poufs facing it from below.
    const tv = layout.furniture.find((f) => f.type === 'VIDEO_GAME')!;
    const poufs = layout.furniture.filter((f) => f.type === 'POUF');
    expect(poufs).toHaveLength(2);
    for (const pouf of poufs) {
      expect(pouf.row).toBe(tv.row + 2);
      expect(pouf.col - tv.col).toBeGreaterThanOrEqual(0);
      expect(pouf.col - tv.col).toBeLessThanOrEqual(1);
    }
    expect(layout.pets).toEqual([{ id: 'cat', petType: 0 }]);
    expect(layout.tiles).toHaveLength(layout.cols * layout.rows);
    expect(layout.tileColors).toHaveLength(layout.tiles.length);
  });

  it('rooms take both sides of the corridor, so four rooms are two columns wide', () => {
    const { layout, rooms } = compact([
      room('a', 0),
      room('b', 1),
      room('c', 2, 2),
      room('d', 3, 3),
    ]);
    expect(layout.cols).toBe(ROOM_PITCH + 1 + 2 * ROOM_PITCH);
    const byProject = new Map(rooms.map((r) => [r.project, r]));
    // Same column, one over the other.
    expect(byProject.get('a')?.col).toBe(byProject.get('b')?.col);
    expect(byProject.get('c')?.col).toBe(byProject.get('d')?.col);
    expect(byProject.get('b')!.row).toBeLessThan(byProject.get('a')!.row);
    expect(rooms.map((r) => r.seats).sort()).toEqual([2, 2, 4, 6]);
  });

  it('every seat is reachable from the lounge, and sits in its own room', () => {
    const { layout, roomTiles } = compact([
      room('a', 0, 2),
      room('b', 1, 3),
      room('c', 2),
      room('d', 5, 2),
    ]);
    const coffee = layout.furniture.find((f) => f.type === 'COFFEE')!;
    // The tile right of the sofas, on the lounge's middle row.
    const walk = reachable(layout, 6, coffee.row);
    const seats = seatsOf(layout);
    expect(seats).toHaveLength(4 + 6 + 2 + 4);
    for (const seat of seats) {
      expect(walk.has(`${seat.col},${seat.row}`)).toBe(true);
      const label = roomTiles[seat.row * layout.cols + seat.col];
      expect(label).not.toBeNull();
      expect(seat.uid.startsWith(`${label}:`)).toBe(true);
    }
  });

  it('nothing walkable opens onto the void beside or over it, and row 0 is empty', () => {
    const { layout } = compact([room('a', 0), room('b', 1, 3), room('c', 4, 2)]);
    for (let c = 0; c < layout.cols; c++) expect(layout.tiles[c]).toBe(V);
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const tile = layout.tiles[r * layout.cols + c];
        if (tile === W || tile === V) continue;
        // Beside and over it; under it the void needs no wall (a wall there
        // would be drawn over whoever stands on this row).
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
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

  it('no furniture stands on a wall or outside its room', () => {
    const { layout } = compact([room('a', 0, 3), room('b', 1, 2)]);
    for (const item of layout.furniture) {
      if (ON_LOUNGE_WALL.has(item.type)) continue;
      const tile = layout.tiles[item.row * layout.cols + item.col];
      expect(tile !== W && tile !== V, item.uid).toBe(true);
    }
    // The coffee corner is the exception. The neon sign hangs on the lounge's
    // top wall (two tiles wide, its lower row on the wall), inside the plan.
    const tile = (col: number, row: number) => layout.tiles[row * layout.cols + col];
    const sign = layout.furniture.find((f) => f.type === NEON_SIGN)!;
    expect(sign.row).toBeGreaterThanOrEqual(0);
    for (const dc of [0, 1]) {
      expect(tile(sign.col + dc, sign.row + 1)).toBe(W);
      expect(tile(sign.col + dc, sign.row + 2)).not.toBe(W);
    }
    // The machine stands against that wall, right beside the sign: its upper
    // half over the wall, its counter on the floor.
    const machine = layout.furniture.find((f) => f.type === COFFEE_MACHINE)!;
    expect([machine.col, machine.row]).toEqual([sign.col + 2, sign.row + 1]);
    expect(tile(machine.col, machine.row)).toBe(W);
    expect(tile(machine.col, machine.row + 1)).not.toBe(W);
    expect(tile(machine.col, machine.row + 1)).not.toBe(V);
    expect(layout.furniture.filter((f) => ON_LOUNGE_WALL.has(f.type))).toHaveLength(2);
  });

  it('a room opening on the other side moves no room already there', () => {
    const one = compact([room('a', 0), room('c', 2)]);
    const two = compact([room('a', 0), room('c', 2), room('e', 4)]);
    for (const project of ['a', 'c']) {
      const before = one.rooms.find((r) => r.project === project);
      expect(two.rooms.find((r) => r.project === project)).toEqual(before);
    }
  });

  it('no stretch of wall stands right under a walkable tile', () => {
    for (const compactOffice of [true, false]) {
      const { layout } = composeOffice(
        baseOffice(true),
        [room('a', 0), room('b', 1, 2), room('c', 2, 3)],
        new Set(),
        compactOffice,
      );
      // From the corridor down (the base office over it is drawn as it came).
      const from = compactOffice ? 0 : baseOffice(true).rows;
      for (let r = Math.max(1, from); r < layout.rows; r++) {
        for (let c = 0; c < layout.cols; c++) {
          const tile = (col: number, row: number) =>
            col >= 0 && col < layout.cols ? layout.tiles[row * layout.cols + col] : V;
          if (tile(c, r) !== W) continue;
          // The end of a wall between two rooms may meet the corridor (one
          // tile wide); a stretch of wall along it may not.
          if (tile(c - 1, r) !== W && tile(c + 1, r) !== W) continue;
          const over = tile(c, r - 1);
          expect(over === W || over === V).toBe(true);
        }
      }
    }
  });

  it("a room's name goes on its top wall, or under a room that has none", () => {
    const { layout, rooms } = compact([room('a', 0), room('b', 1)]);
    const tile = (c: number, r: number) => layout.tiles[r * layout.cols + c];
    const under = rooms.find((r) => r.project === 'a')!;
    const over = rooms.find((r) => r.project === 'b')!;
    expect(tile(over.signCol, over.signRow)).toBe(W);
    expect(tile(under.signCol, under.signRow)).toBe(V);
    expect(tile(under.signCol, under.signRow - 1)).not.toBe(V);
  });
});
