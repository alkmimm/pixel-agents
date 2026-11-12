/**
 * pixel-agents-secure (local): an agent at leisure sitting a while in a seat
 * that is not its own (a sofa with its coffee, a pouf at the video game), and
 * idle agents leaving their desks more ("Ociosos circulam mais").
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { restInChair } from '../src/office/engine/characters.js';
import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

beforeAll(() => {
  const chair: LoadedAssetData['catalog'][number] = {
    id: 'TEST_CHAIR',
    label: 'chair',
    category: 'chairs',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  };
  assert.ok(buildDynamicCatalog({ catalog: [chair], sprites: { TEST_CHAIR: [['c']] } }));
});

/** A room with the agent's own chair ('own') and two more: 'sofa' and 'pouf'. */
function layout(): OfficeLayout {
  const cols = 8;
  const rows = 6;
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'own', type: 'TEST_CHAIR', col: 1, row: 1 },
      { uid: 'sofa', type: 'TEST_CHAIR', col: 5, row: 3 },
      { uid: 'pouf', type: 'TEST_CHAIR', col: 6, row: 4 },
    ],
  };
}

function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) os.update(1 / 30);
}

function office() {
  const os = new OfficeState(layout());
  restoreAgent(os, { id: 1, seatId: 'own' });
  const ch = os.characters.get(1)!;
  return { os, ch };
}

test('the seats nobody has are free; a guest seat is taken while it is used', () => {
  const { os } = office();
  assert.deepEqual(
    os.freeSeats().map((s) => s.uid).sort(),
    ['pouf', 'sofa'],
  );
  assert.equal(os.sitAsGuest(1, 'sofa', 10), true);
  assert.deepEqual(os.freeSeats().map((s) => s.uid), ['pouf']);
  // Not its own chair, not a seat that does not exist, not one in use.
  restoreAgent(os, { id: 2 });
  assert.equal(os.sitAsGuest(2, 'sofa', 10), false);
  assert.equal(os.sitAsGuest(2, 'own', 10), false);
  assert.equal(os.sitAsGuest(2, 'nowhere', 10), false);
});

test('it walks to the seat, sits facing the way asked, and gets up by itself', () => {
  const { os, ch } = office();
  assert.equal(os.sitAsGuest(1, 'pouf', 4, Direction.UP), true);
  assert.equal(ch.state, CharacterState.WALK);
  run(os, 6);
  assert.equal(ch.guestSeat?.seated, true);
  assert.equal(ch.state, CharacterState.TYPE);
  assert.deepEqual([ch.tileCol, ch.tileRow, ch.dir], [6, 4, Direction.UP]);
  // Its own chair is still its own.
  assert.equal(ch.seatId, 'own');
  run(os, 5);
  assert.equal(ch.guestSeat, null);
  assert.notEqual(ch.state, CharacterState.TYPE);
  assert.deepEqual(
    os.freeSeats().map((s) => s.uid).sort(),
    ['pouf', 'sofa'],
  );
});

test('called to work, it leaves the seat at once and goes to its own chair', () => {
  const { os, ch } = office();
  os.sitAsGuest(1, 'sofa', 600);
  run(os, 6);
  assert.equal(ch.guestSeat?.seated, true);
  os.setAgentActive(1, true);
  run(os, 0.1);
  assert.equal(ch.guestSeat, null);
  run(os, 8);
  assert.equal(ch.state, CharacterState.TYPE);
  assert.deepEqual([ch.tileCol, ch.tileRow], [1, 1]);
});

test('called to work on the way, it never sits there', () => {
  const { os, ch } = office();
  os.sitAsGuest(1, 'sofa', 600);
  run(os, 0.2);
  os.setAgentActive(1, true);
  run(os, 8);
  assert.equal(ch.guestSeat, null);
  assert.deepEqual([ch.tileCol, ch.tileRow], [1, 1]);
});

test('an agent at work is not sent to sit', () => {
  const { os } = office();
  os.setAgentActive(1, true);
  assert.equal(os.sitAsGuest(1, 'sofa', 10), false);
});

test('with roam, a rest in the chair is shorter', () => {
  const { ch } = office();
  let usual = 0;
  let roaming = 0;
  for (let i = 0; i < 200; i++) {
    restInChair(ch);
    usual += ch.seatTimer;
    restInChair(ch, 0.35);
    roaming += ch.seatTimer;
  }
  assert.ok(roaming < usual * 0.5);
  assert.ok(roaming > usual * 0.2);
});

test('a sofa or a pouf is never given as an agent\'s own seat, and stays free for a break', () => {
  const entry = (id: string): LoadedAssetData['catalog'][number] => ({
    id,
    label: id,
    category: 'chairs',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  });
  const catalog = [entry('TEST_CHAIR'), entry('POUF'), entry('SOFA_SIDE')];
  assert.ok(
    buildDynamicCatalog({ catalog, sprites: Object.fromEntries(catalog.map((c) => [c.id, [['c']]])) }),
  );
  const cols = 8;
  const rows = 6;
  const os = new OfficeState({
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'desk', type: 'TEST_CHAIR', col: 6, row: 5 },
      { uid: 'pouf', type: 'POUF', col: 1, row: 1 },
      { uid: 'sofa', type: 'SOFA_SIDE', col: 2, row: 1 },
    ],
  });
  // Three agents, one chair: the first gets it; the others get no seat rather than a sofa.
  for (const id of [1, 2, 3]) restoreAgent(os, { id });
  const seats = [1, 2, 3].map((id) => os.characters.get(id)!.seatId);
  assert.deepEqual(seats.filter((s) => s !== null && s !== undefined), ['desk']);
  assert.deepEqual(
    os.freeSeats().map((s) => s.uid).sort(),
    ['pouf', 'sofa'],
  );
  // And they can still sit there a while.
  const guest = [1, 2, 3].find((id) => !os.characters.get(id)!.seatId)!;
  assert.ok(os.sitAsGuest(guest, 'pouf', 5));
});
