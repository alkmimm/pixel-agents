/**
 * pixel-agents-secure (local): where an idle agent's stroll ends. Never in a
 * passage (a doorway, a corridor one tile wide), and never left facing a wall:
 * it faces what it stands beside, or open floor.
 */
import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

beforeAll(() => {
  const plant: LoadedAssetData['catalog'][number] = {
    id: 'TEST_PLANT',
    label: 'plant',
    category: 'decor',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
  };
  assert.ok(buildDynamicCatalog({ catalog: [plant], sprites: { TEST_PLANT: [['p']] } }));
});

const COLS = 11;
const ROWS = 5;
const DOOR = { col: 5, row: 2 };
const PLANT = { col: 8, row: 2 };

/** Two rooms side by side, joined by a door one tile wide; a plant in the right one. */
function office() {
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  for (let r = 0; r < ROWS; r++) {
    if (r !== DOOR.row) tiles[r * COLS + DOOR.col] = TileType.WALL;
  }
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture: [{ uid: 'plant', type: 'TEST_PLANT', ...PLANT }],
  };
  const os = new OfficeState(layout);
  restoreAgent(os, { id: 1 });
  restoreAgent(os, { id: 2 });
  return os;
}

const STEP: Record<number, [number, number]> = {
  [Direction.UP]: [0, -1],
  [Direction.DOWN]: [0, 1],
  [Direction.LEFT]: [-1, 0],
  [Direction.RIGHT]: [1, 0],
};

test('a stroll never ends in the doorway, and nobody is left facing a wall', () => {
  const os = office();
  const wall = (col: number, row: number) =>
    col < 0 || row < 0 || col >= COLS || row >= ROWS || (col === DOOR.col && row !== DOOR.row);
  let stops = 0;
  const idleFor = new Map<number, number>();
  for (let t = 0; t < 600; t += 1 / 15) {
    os.update(1 / 15);
    for (const ch of os.characters.values()) {
      if (ch.state !== CharacterState.IDLE) {
        idleFor.set(ch.id, 0);
        continue;
      }
      const frames = (idleFor.get(ch.id) ?? 0) + 1;
      idleFor.set(ch.id, frames);
      // Settled: the frame after it stopped.
      if (frames !== 2) continue;
      stops++;
      assert.ok(
        !(ch.tileCol === DOOR.col && ch.tileRow === DOOR.row),
        'stopped in the doorway',
      );
      const [dc, dr] = STEP[ch.dir];
      assert.ok(
        !wall(ch.tileCol + dc, ch.tileRow + dr),
        `facing a wall at ${ch.tileCol},${ch.tileRow}`,
      );
      // Beside the plant, it looks at the plant.
      const beside = Math.abs(ch.tileCol - PLANT.col) + Math.abs(ch.tileRow - PLANT.row) === 1;
      if (beside) {
        assert.deepEqual([ch.tileCol + dc, ch.tileRow + dr], [PLANT.col, PLANT.row]);
      }
    }
  }
  assert.ok(stops > 10, `only ${stops} stops seen`);
});
