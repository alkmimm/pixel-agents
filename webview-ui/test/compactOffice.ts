/**
 * pixel-agents-secure (local): for the tests, the real furniture catalog (as
 * the server's assetLoader flattens public/assets/furniture) and the compact
 * office with project rooms, recomposed as useProjectRooms does (without React).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type FurnitureAsset,
  type FurnitureManifest,
  flattenManifest,
  type InheritedProps,
} from '../../core/src/assets/manifestUtils.js';
import type { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { getBlockedTiles } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { composeOffice, planRooms, type RoomState, sameRooms } from '../src/viewer/projectRooms.js';

const FURNITURE = fileURLToPath(new URL('../public/assets/furniture', import.meta.url));

/** Load the real catalog; sprites are blanks of the right size. */
export function loadRealCatalog(): void {
  const catalog: FurnitureAsset[] = [];
  for (const dir of fs.readdirSync(FURNITURE, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(FURNITURE, dir.name, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf-8')) as FurnitureManifest;
    const inherited: InheritedProps = {
      groupId: m.id,
      name: m.name,
      category: m.category,
      canPlaceOnWalls: m.canPlaceOnWalls,
      canPlaceOnSurfaces: m.canPlaceOnSurfaces,
      backgroundTiles: m.backgroundTiles,
    };
    if (m.type === 'asset') {
      catalog.push({
        id: m.id,
        name: m.name,
        label: m.name,
        category: m.category,
        file: m.file ?? `${m.id}.png`,
        width: m.width!,
        height: m.height!,
        footprintW: m.footprintW!,
        footprintH: m.footprintH!,
        isDesk: m.category === 'desks',
        canPlaceOnWalls: m.canPlaceOnWalls,
        canPlaceOnSurfaces: m.canPlaceOnSurfaces,
        backgroundTiles: m.backgroundTiles,
        groupId: m.id,
      });
    } else {
      if (m.rotationScheme) inherited.rotationScheme = m.rotationScheme;
      catalog.push(
        ...flattenManifest(
          {
            type: 'group',
            groupType: m.groupType as 'rotation' | 'state' | 'animation',
            rotationScheme: m.rotationScheme,
            members: m.members!,
          },
          inherited,
        ),
      );
    }
  }
  const sprites: LoadedAssetData['sprites'] = {};
  for (const a of catalog) {
    sprites[a.id] = Array.from({ length: a.height }, () => new Array<string>(a.width).fill(''));
  }
  if (!buildDynamicCatalog({ catalog, sprites })) throw new Error('the real catalog did not load');
}

/** A plain floor: the compact office draws none of the base but its pets. */
export function plainBase(): OfficeLayout {
  const cols = 10;
  const rows = 10;
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

/** useProjectRooms without React: replan, compose (compact) and apply. */
export class Rooms {
  plan: RoomState[] = [];
  origin = { col: 0, row: 0 };
  first = true;
  recompositions = 0;
  /** By how much the last recomposition moved everything. */
  lastShift = { col: 0, row: 0 };
  readonly os: OfficeState;
  readonly base: OfficeLayout;

  constructor(os: OfficeState, base: OfficeLayout) {
    this.os = os;
    this.base = base;
  }

  /** True when the office was recomposed. */
  tick(now: number): boolean {
    const counts = new Map<string, number>();
    for (const ch of this.os.characters.values()) {
      if (ch.isSubagent || ch.matrixEffect === 'despawn' || !ch.directoryName) continue;
      counts.set(ch.directoryName, (counts.get(ch.directoryName) ?? 0) + 1);
    }
    const plan = planRooms(this.plan, counts, now);
    if (!this.first && sameRooms(plan, this.plan)) {
      this.plan = plan;
      if (plan.length > 0) this.os.moveIntoRooms(false);
      return false;
    }
    this.plan = plan;
    const composed = composeOffice(this.base, plan, getBlockedTiles(this.base.furniture), true);
    const roomAreas: Record<string, string[]> = {};
    for (const room of composed.rooms) roomAreas[room.project] = [room.label];
    const shift = this.first
      ? { col: 0, row: 0 }
      : { col: composed.origin.col - this.origin.col, row: composed.origin.row - this.origin.row };
    this.origin = composed.origin;
    this.lastShift = shift;
    this.os.applyRooms(
      composed.layout,
      roomAreas,
      composed.roomTiles,
      this.first || !composed.connected,
      shift,
    );
    this.first = false;
    this.recompositions++;
    return true;
  }
}
