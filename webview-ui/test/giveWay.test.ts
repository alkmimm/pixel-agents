/**
 * pixel-agents-secure (local): agents do not walk through each other. A walker
 * with someone in its way waits, goes around when it can, and only in a place
 * with no way around walks through, so that nobody is ever stuck.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TILE_SIZE, TileType } from '../src/office/types.js';

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

/** A room `rows` deep with a chair at each end of row `row`. */
function office(rows: number, row: number) {
  const cols = 9;
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [
      { uid: 'left', type: 'TEST_CHAIR', col: 0, row },
      { uid: 'right', type: 'TEST_CHAIR', col: cols - 1, row },
    ],
  };
  const os = new OfficeState(layout);
  restoreAgent(os, { id: 1, seatId: 'left' });
  restoreAgent(os, { id: 2, seatId: 'right' });
  return { os, a: os.characters.get(1)!, b: os.characters.get(2)!, cols };
}

/** Send the two past each other along `row`; the closest they came (pixels), and whether both arrived. */
function cross(rows: number, row: number) {
  const { os, a, b, cols } = office(rows, row);
  assert.ok(os.sendOnErrand(1, cols - 2, row));
  assert.ok(os.sendOnErrand(2, 1, row));
  let closest = Infinity;
  let aThere = false;
  let bThere = false;
  for (let t = 0; t < 40 && !(aThere && bThere); t += 1 / 30) {
    os.update(1 / 30);
    aThere ||= a.tileCol === cols - 2 && a.tileRow === row;
    bThere ||= b.tileCol === 1 && b.tileRow === row;
    if (!aThere && !bThere) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return { closest, arrived: aThere && bThere };
}

test('two agents walking toward each other go around: neither walks through the other', () => {
  const { closest, arrived } = cross(3, 1);
  assert.ok(arrived, 'both get where they were going');
  assert.ok(closest >= TILE_SIZE - 1, `they came within ${closest}px of each other`);
});

test('with no way around (a corridor one tile wide) they still get through, after waiting', () => {
  const { arrived } = cross(1, 0);
  assert.ok(arrived, 'nobody is left stuck');
});
