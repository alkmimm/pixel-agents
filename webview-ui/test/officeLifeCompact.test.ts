/**
 * pixel-agents-secure (local): "Vida no escritório" in the compact office as
 * it is drawn (composeOffice + the real catalog), not a room made for the test.
 * What a test room missed: floor closed off by furniture (the robot's place at
 * the table, a pouf only reachable over the other), a pair where only one could
 * set off, and rooms opening over the corridor while someone walks.
 */
import assert from 'node:assert/strict';

import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';

import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { CharacterState } from '../src/office/types.js';
import { ALL_PARTS, type LifeParts, LOOK_MS, OfficeDirector } from '../src/viewer/officeDirector.js';
import { coffeeCorner, queueSpots, robotRound } from '../src/viewer/officeLife.js';
import { loadRealCatalog, plainBase, Rooms } from './compactOffice.js';

beforeAll(loadRealCatalog);

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(seeded(7));
});
afterEach(() => {
  vi.restoreAllMocks();
});

interface TripLike {
  spot: { col: number; row: number };
  stage: string;
  mate?: number;
}

/** The compact office with `agents` ([id, project]); the director starts nothing by chance. */
function compact(
  agents: Array<[number, string]>,
  parts: Partial<LifeParts> = {},
  rand: () => number = () => 0.99,
) {
  const base = plainBase();
  const os = new OfficeState(base);
  for (const [id, project] of agents) {
    restoreAgent(os, { id, directoryName: project });
    os.setAgentActive(id, false);
  }
  const rooms = new Rooms(os, base);
  let now = 1_000_000;
  rooms.tick(now);
  const director = new OfficeDirector(() => os, () => ({ tone: 'idle' as const }), now, rand);
  const on: LifeParts = { ...ALL_PARTS, robot: false, pet: false, chat: false, ...parts };
  const ids = agents.map(([id]) => id);
  const second = () => {
    for (let i = 0; i < 15; i++) os.update(1 / 15);
    now += LOOK_MS;
    director.look(now, ids, {}, on);
  };
  const trips = (director as unknown as { trips: Map<number, TripLike> }).trips;
  const add = (id: number, project: string) => {
    restoreAgent(os, { id, directoryName: project });
    os.setAgentActive(id, false);
    ids.push(id);
    return rooms.tick(now);
  };
  return { os, rooms, director, second, trips, add };
}

test('compact office: everything the director uses can be walked to', () => {
  const { os } = compact([
    [1, 'alpha'],
    [2, 'beta'],
  ]);
  const corner = coffeeCorner(os.getLayout().furniture, os.reachableTiles);
  const front = corner.machine[0];
  assert.ok(front && os.canReach(front), 'the machine has no front one can reach');
  for (const q of queueSpots(front, os.reachableTiles)) assert.ok(os.canReach(q));
  assert.ok(corner.table, 'no coffee table');
  for (const t of corner.table.spots) assert.ok(os.canReach(t), `table spot ${t.col},${t.row}`);
  assert.ok(corner.dock && os.canReach(corner.dock), 'the robot dock');
  const cleanAt = robotRound(corner, os.reachableTiles).cleanAt;
  assert.ok(cleanAt && os.canReach(cleanAt), 'where the robot takes the cups');
  // Every seat of the lounge (sofas, poufs) can be walked up to.
  const lounge = [...os.seats.keys()].filter((uid) => uid.startsWith('comum:'));
  assert.ok(lounge.length >= 10, `only ${lounge.length} lounge seats`);
  for (const uid of lounge) assert.ok(os.seatReachable(uid), `seat ${uid} cannot be reached`);
  assert.equal(corner.game?.poufs.length, 2);
});

test('compact office: the robot takes the cups off the table', () => {
  const { os, second } = compact([[1, 'alpha']], { robot: true });
  second();
  const table = coffeeCorner(os.getLayout().furniture, os.reachableTiles).table!.at;
  assert.ok(os.placeCup(table));
  assert.ok(os.placeCup(table));
  for (let s = 0; s < 240 && os.cups.length > 0; s++) second();
  assert.equal(os.cups.length, 0, 'the cups are still on the table');
});

test('compact office: a game for two, both playing at once', () => {
  const { director, second } = compact([
    [1, 'alpha'],
    [2, 'alpha'],
  ]);
  director.pairUp(1, 2, 'game');
  let together = 0;
  for (let s = 0; s < 150; s++) {
    second();
    if (director.activityOf(1) === 'play' && director.activityOf(2) === 'play') together++;
  }
  assert.ok(together >= 10, `they played together for only ${together}s`);
});

test('compact office: the pouf by the wall is got to over the other, and left the same way', () => {
  const { os, director, second } = compact([
    [1, 'alpha'],
    [2, 'alpha'],
  ]);
  // The poufs are right in front of the video game; one has the wall beside it.
  const poufs = os.getLayout().furniture.filter((f) => f.type === 'POUF');
  const tv = os.getLayout().furniture.find((f) => f.type === 'VIDEO_GAME')!;
  assert.deepEqual(poufs.map((p) => p.col - tv.col).sort(), [0, 1]);
  director.pairUp(1, 2, 'game');
  const sat = new Set<string>();
  for (let s = 0; s < 150; s++) {
    second();
    for (const id of [1, 2]) {
      const guest = os.characters.get(id)!.guestSeat;
      if (guest?.seated) sat.add(guest.uid);
    }
  }
  assert.equal(sat.size, 2, `only ${[...sat].join(', ')} was sat on`);
  // Afterwards each walks away: nobody is left on a pouf, with no way out.
  let away = false;
  for (let s = 0; s < 300 && !away; s++) {
    second();
    away = [1, 2].every((id) => {
      const ch = os.characters.get(id)!;
      return !poufs.some((p) => p.col === ch.tileCol && p.row === ch.tileRow);
    });
  }
  assert.ok(away, 'someone never left its pouf');
});

test('after the greeting, one that cannot set off frees its mate, who goes alone', () => {
  const { os, director, second, trips } = compact([
    [1, 'alpha'],
    [2, 'alpha'],
    [3, 'beta'],
  ]);
  director.pairUp(1, 2, 'game');
  second();
  assert.equal(director.activityOf(1), 'invite');
  // While the inviter walks up, someone else takes a pouf: one is left for two.
  let taken = false;
  for (let s = 0; s < 30 && !taken; s++) {
    taken = os.sitAsGuest(3, 'comum:pufe-1', 60);
    if (!taken) second();
  }
  assert.ok(taken, 'agent 3 never sat on the pouf');
  for (let s = 0; s < 60 && [1, 2].some((id) => director.activityOf(id) !== 'to-game' && director.activityOf(id) !== 'play' && director.activityOf(id) !== undefined); s++) {
    second();
  }
  const going = [1, 2].filter((id) => trips.has(id));
  assert.equal(going.length, 1, `going: ${going.join(',')}`);
  assert.equal(trips.get(going[0])?.mate, undefined, 'it still waits for a mate that did not come');
});

test('rooms opening over the corridor move everyone along: walks, trips and cups go on', () => {
  const { os, rooms, director, second, add } = compact([
    [1, 'alpha'],
    [2, 'alpha'],
    [3, 'beta'],
  ]);
  second();
  const table = coffeeCorner(os.getLayout().furniture, os.reachableTiles).table!.at;
  assert.ok(os.placeCup(table));
  const cupY = os.cups[0].y;
  director.pairUp(1, 2, 'coffee');
  // On its way to its mate: the moment the old office dropped everything.
  for (let s = 0; s < 20 && os.characters.get(1)?.state !== CharacterState.WALK; s++) second();
  assert.equal(director.activityOf(1), 'invite');
  assert.equal(os.characters.get(1)?.state, CharacterState.WALK);
  // Beta grows a second row of desks over the corridor: everything moves down.
  add(4, 'beta');
  assert.ok(add(5, 'beta'), 'no recomposition');
  assert.ok(rooms.lastShift.row > 0, 'nothing moved');
  assert.ok((os.characters.get(1)?.path.length ?? 0) > 0, 'the walk stopped');
  assert.equal(os.cups.length, 1, 'the cup went with the old office');
  assert.equal(os.cups[0].y, cupY + rooms.lastShift.row * 16);
  second();
  assert.ok(['invite', 'greet'].includes(director.activityOf(1) ?? ''), 'the trip was dropped');
  const seen = new Set<string>();
  for (let s = 0; s < 240 && !(seen.has('sip') && !director.activityOf(1) && !director.activityOf(2)); s++) {
    second();
    for (const id of [1, 2]) seen.add(director.activityOf(id) ?? 'none');
  }
  assert.ok(seen.has('greet') && seen.has('sip'), [...seen].join(', '));
  assert.equal(os.cups.length, 3);
});

test('compact office: nobody ends up standing on floor that leads nowhere', () => {
  // A busy office left to itself for a while: strolls, coffees, games, pairs,
  // and rooms opening as agents arrive.
  const { os, second, trips, add } = compact(
    [
      [1, 'alpha'],
      [2, 'alpha'],
      [3, 'beta'],
      [4, 'beta'],
      [5, 'gamma'],
      [6, 'gamma'],
    ],
    {},
    seeded(11),
  );
  const last = new Map<number, string>();
  for (let s = 0; s < 900; s++) {
    if (s === 200) add(7, 'delta');
    if (s === 500) add(8, 'alpha');
    second();
    for (const ch of os.characters.values()) {
      if (ch.isSubagent) continue;
      const seat = ch.seatId ? os.seats.get(ch.seatId) : undefined;
      const onOwnSeat = seat !== undefined && seat.seatCol === ch.tileCol && seat.seatRow === ch.tileRow;
      // On a seat it just got up from (a sofa, a pouf): furniture, left at its next walk.
      const onASeat = [...os.seats.values()].some(
        (st) => st.seatCol === ch.tileCol && st.seatRow === ch.tileRow,
      );
      const here = `${ch.tileCol},${ch.tileRow}`;
      if (ch.state !== CharacterState.WALK && !onOwnSeat && !onASeat) {
        assert.ok(
          os.canReach({ col: ch.tileCol, row: ch.tileRow }),
          `t=${s}s agent ${ch.id} stands at ${here}, which leads nowhere ` +
            `(before: ${last.get(ch.id)}; trip: ${trips.get(ch.id)?.stage ?? 'none'})`,
        );
      }
      last.set(ch.id, `${ch.state}@${here}`);
    }
  }
});

test('compact office: a room growing over the corridor leaves everyone on their seats, and walkers get home', () => {
  // beta's room is over the corridor: when it grows, the office moves down and it stays.
  const { os, rooms, second, add } = compact([
    [1, 'alpha'],
    [2, 'beta'],
    [3, 'beta'],
  ]);
  second();
  const onOwnSeat = (id: number) => {
    const ch = os.characters.get(id)!;
    const seat = ch.seatId ? os.seats.get(ch.seatId) : undefined;
    return (
      seat !== undefined &&
      seat.seatCol === ch.tileCol &&
      seat.seatRow === ch.tileRow &&
      ch.x === seat.seatCol * 16 + 8 &&
      ch.y === seat.seatRow * 16 + 8
    );
  };
  for (const id of [1, 2, 3]) assert.ok(onOwnSeat(id), `agent ${id} does not start on its seat`);
  // Agent 3 is out for a walk and on its way back when the room grows.
  const c = os.characters.get(3)!;
  assert.ok(os.sendOnErrand(3, 4, c.tileRow > 8 ? 12 : 8) || os.sendOnErrand(3, 6, 11));
  for (let s = 0; s < 30 && c.state === CharacterState.WALK; s++) second();
  assert.ok(os.sendHome(3), 'agent 3 cannot walk home');
  second();
  assert.equal(c.state, CharacterState.WALK);
  const b = os.characters.get(2)!;
  const sat = { col: b.tileCol, row: b.tileRow };
  let moved = false;
  for (let id = 10; id < 22 && !moved; id++) {
    add(id, 'beta');
    moved = rooms.lastShift.row !== 0;
  }
  assert.ok(moved, 'the office never moved down');
  // The case this is about: beta's seats did not move with the rest of the office,
  // so moving its people by the same amount would take them off their chairs.
  const seat = os.seats.get(b.seatId!)!;
  assert.notDeepEqual(
    [seat.seatCol, seat.seatRow],
    [sat.col + rooms.lastShift.col, sat.row + rooms.lastShift.row],
  );
  // Whoever sat stays on its seat, wherever that is now.
  for (const id of [1, 2]) assert.ok(onOwnSeat(id), `agent ${id} is off its seat after the room grew`);
  // And the one walking home gets there.
  for (let s = 0; s < 60 && c.state === CharacterState.WALK; s++) second();
  assert.ok(onOwnSeat(3), `agent 3 ended at ${c.tileCol},${c.tileRow}, not on its seat`);
});
