/**
 * pixel-agents-secure (local): the office's director (viewer/officeDirector.ts)
 * run with no screen: two agents doing something together. One asks the other
 * along, they greet, and go for a coffee or a game as a pair, each in its own
 * place.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';
import { ALL_PARTS, LOOK_MS, OfficeDirector } from '../src/viewer/officeDirector.js';

type Entry = LoadedAssetData['catalog'][number];
const entry = (id: string, category: string, w = 1, h = 1): Entry => ({
  id,
  label: id,
  category,
  width: 16 * w,
  height: 16 * h,
  footprintW: w,
  footprintH: h,
  isDesk: false,
});

beforeAll(() => {
  const catalog = [
    entry('TEST_CHAIR', 'chairs'),
    entry('POUF', 'chairs'),
    entry('COFFEE_MACHINE', 'misc', 1, 2),
    entry('COFFEE_TABLE', 'misc', 2, 2),
    entry('VIDEO_GAME', 'misc', 1, 2),
    entry('BIN', 'misc'),
  ];
  const sprites = Object.fromEntries(catalog.map((c) => [c.id, [['x']]]));
  assert.ok(buildDynamicCatalog({ catalog, sprites }));
});

/** A room with a coffee corner (machine, table, four seats around it) and a game corner (two poufs). */
function office() {
  const cols = 12;
  const rows = 9;
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'desk-1', type: 'TEST_CHAIR', col: 0, row: 0 },
      { uid: 'desk-2', type: 'TEST_CHAIR', col: 11, row: 0 },
      { uid: 'machine', type: 'COFFEE_MACHINE', col: 5, row: 0 },
      { uid: 'table', type: 'COFFEE_TABLE', col: 2, row: 4 },
      { uid: 'sofa-1', type: 'TEST_CHAIR', col: 1, row: 4 },
      { uid: 'sofa-2', type: 'TEST_CHAIR', col: 1, row: 5 },
      { uid: 'sofa-3', type: 'TEST_CHAIR', col: 4, row: 4 },
      { uid: 'sofa-4', type: 'TEST_CHAIR', col: 4, row: 5 },
      { uid: 'tv', type: 'VIDEO_GAME', col: 9, row: 4 },
      { uid: 'pouf-1', type: 'POUF', col: 8, row: 7 },
      { uid: 'pouf-2', type: 'POUF', col: 9, row: 7 },
      { uid: 'bin', type: 'BIN', col: 0, row: 8 },
    ],
  };
  const os = new OfficeState(layout);
  // Each has its own chair: the sofas and the poufs are nobody's.
  restoreAgent(os, { id: 1, seatId: 'desk-1' });
  restoreAgent(os, { id: 2, seatId: 'desk-2' });
  let now = 1_000_000;
  // rand 0.99: nothing starts by chance; only what the test asks for happens.
  const director = new OfficeDirector(() => os, () => ({ tone: 'idle' as const }), now, () => 0.99);
  /** One second of the office, then one look of the director. */
  const parts = { ...ALL_PARTS, robot: false, pet: false, chat: false };
  const ids = [1, 2];
  const second = () => {
    for (let i = 0; i < 15; i++) os.update(1 / 15);
    now += LOOK_MS;
    director.look(now, ids, {}, parts);
  };
  return { os, director, second, parts, ids, a: os.characters.get(1)!, b: os.characters.get(2)! };
}

test('a coffee for two: one asks, they greet, each fills a cup in turn, they sit apart and leave two cups', () => {
  const { os, director, second, a, b } = office();
  director.pairUp(1, 2, 'coffee');
  const seen = new Set<string>();
  let together = 0;
  let sameSeat = false;
  for (let s = 0; s < 240 && !(seen.has('sip') && director.activityOf(1) === undefined && director.activityOf(2) === undefined); s++) {
    second();
    for (const id of [1, 2]) seen.add(director.activityOf(id) ?? 'none');
    const at = [director.activityOf(1), director.activityOf(2)];
    // Never both at the machine at once: one waits its turn.
    assert.ok(!(at[0] === 'pour' && at[1] === 'pour'), 'both filling a cup at once');
    if (at[0] === 'sip' && at[1] === 'sip') {
      together++;
      sameSeat ||= a.guestSeat !== null && a.guestSeat.uid === b.guestSeat?.uid;
    }
  }
  for (const stage of ['invite', 'invited', 'greet', 'machine', 'pour', 'sip']) {
    assert.ok(seen.has(stage), `no ${stage} stage seen (${[...seen].join(', ')})`);
  }
  assert.ok(together >= 5, `they sat together for only ${together}s`);
  assert.ok(!sameSeat, 'the two in the same seat');
  assert.equal(os.cups.length, 2);
  assert.equal(a.carrying || b.carrying, false);
});

test('a game for two: each on its own pouf, playing at the same time', () => {
  const { director, second, a, b } = office();
  director.pairUp(2, 1, 'game');
  let together = 0;
  for (let s = 0; s < 120; s++) {
    second();
    if (director.activityOf(1) === 'play' && director.activityOf(2) === 'play') {
      together++;
      assert.ok(a.guestSeat && b.guestSeat, 'playing without a pouf');
      assert.notEqual(a.guestSeat.uid, b.guestSeat.uid);
      assert.ok(a.guestSeat.uid.startsWith('pouf') && b.guestSeat.uid.startsWith('pouf'));
    }
  }
  assert.ok(together >= 10, `they played together for only ${together}s`);
  assert.equal(director.activityOf(1), undefined);
  assert.equal(director.activityOf(2), undefined);
});

test('a mate called back to work frees the other at once', () => {
  const { os, director, second } = office();
  director.pairUp(1, 2, 'coffee');
  second();
  assert.equal(director.activityOf(1), 'invite');
  assert.equal(director.activityOf(2), 'invited');
  os.setAgentActive(2, true);
  second();
  second();
  assert.equal(director.activityOf(1), undefined);
  assert.equal(director.activityOf(2), undefined);
});

test('the director walks an idle agent: it leaves its chair, stops at a few places and comes back', () => {
  const { os, second, a } = office();
  second();
  assert.equal(os.directed, true);
  const stops = new Set<string>();
  let cameBack = false;
  for (let s = 0; s < 900 && !cameBack; s++) {
    second();
    if (a.state === CharacterState.IDLE) stops.add(`${a.tileCol},${a.tileRow}`);
    cameBack = stops.size > 0 && a.state === CharacterState.TYPE;
  }
  assert.ok(stops.size >= 3, `it stopped at only ${stops.size} places`);
  assert.ok(cameBack, 'it never went back to its chair');
});

test('the robot takes the cups left on the table', () => {
  const { os, second, parts } = office();
  parts.robot = true;
  second();
  assert.ok(os.placeCup({ col: 2, row: 4 }));
  assert.ok(os.placeCup({ col: 2, row: 4 }));
  let left = os.cups.length;
  for (let s = 0; s < 240 && left > 0; s++) {
    second();
    left = os.cups.length;
  }
  assert.equal(left, 0, 'the cups are still on the table');
});
