import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { expect, it } from 'vitest';

import type { CharacterProfile } from '../../core/src/characterProfiles.js';
import { DEFAULT_CHARACTER_PROFILES } from '../../core/src/defaultCharacterProfiles.js';
import { withModelGear } from '../src/characters/modelGear.js';
import { startOfficeSync } from '../src/characters/officeSprites.js';
import { CharacterRenderer } from '../src/characters/renderer.js';
import { EYE_FOLDERS } from '../src/characters/slots.js';
import { decodeWardrobe, parseWardrobeManifest, type Rgba } from '../src/characters/wardrobe.js';
import { getCharacterSprites } from '../src/office/sprites/spriteData.js';
import { Direction } from '../src/office/types.js';
import { modelGear } from '../src/viewer/modelLevel.js';

const art = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/characters/art');
const files = new Map<string, Rgba>(
  fs
    .readdirSync(art, { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.png'))
    .map((f) => {
      const img = PNG.sync.read(fs.readFileSync(path.join(art, f)));
      const key = f
        .split(path.sep)
        .join('/')
        .replace(/\.png$/, '');
      return [key, { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }];
    }),
);
const manifest = parseWardrobeManifest(
  JSON.parse(fs.readFileSync(path.join(art, 'wardrobe.json'), 'utf-8')),
);
const renderer = new CharacterRenderer(decodeWardrobe(manifest, files, EYE_FOLDERS));

function sync(profiles: readonly CharacterProfile[]): () => void {
  const state = { renderer, profiles };
  return startOfficeSync({ subscribe: () => () => {}, getState: () => state as never });
}

const front = (palette: number, repeat: number, gear: number) =>
  JSON.stringify(getCharacterSprites(palette, repeat, false, gear).walk[Direction.DOWN][0]);

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'];
const GEARS = MODELS.flatMap((m) => [modelGear(m, 'medium'), modelGear(m, 'xhigh')]);

it('every gear part exists in the wardrobe', () => {
  const ids = new Map(Object.entries(manifest.parts).map(([slot, parts]) => [slot, parts.map((p) => p.id)]));
  const bare: CharacterProfile = { ...DEFAULT_CHARACTER_PROFILES[0] };
  for (const gear of GEARS) {
    const worn = withModelGear(bare, gear) as unknown as Record<string, unknown>;
    const before = bare as unknown as Record<string, unknown>;
    for (const slot of ['full', 'jacket', 'hat', 'shades', 'watch', 'lanyard', 'necklace']) {
      if (worn[slot] === before[slot] || worn[slot] === undefined) continue;
      expect(ids.get(slot), `${slot} of gear ${gear}`).toContain(worn[slot]);
    }
  }
});

it('each model dresses every character differently', () => {
  const stop = sync(DEFAULT_CHARACTER_PROFILES);
  DEFAULT_CHARACTER_PROFILES.forEach((_, i) => {
    const looks = GEARS.map((gear) => front(i, 0, gear));
    expect(new Set(looks).size, `character ${i}`).toBe(looks.length);
    expect(getCharacterSprites(i, 0, false, 0)).toBe(getCharacterSprites(i, 0));
  });
  // A character wearing none of the pieces changes with every gear (one that
  // already wears a tier's piece, like the default cast's vest, may not).
  const plain = front(0, 0, 0);
  for (const gear of GEARS) expect(front(0, 0, gear), `gear ${gear}`).not.toBe(plain);
  stop();
});

it('gear keeps who the character is: two characters in the same gear still differ', () => {
  const stop = sync(DEFAULT_CHARACTER_PROFILES);
  for (const gear of GEARS) {
    const looks = DEFAULT_CHARACTER_PROFILES.map((_, i) => front(i, 0, gear));
    expect(new Set(looks).size, `gear ${gear}`).toBe(looks.length);
  }
  stop();
});

it('the saved profile is never changed', () => {
  const profile = DEFAULT_CHARACTER_PROFILES[0];
  const before = JSON.stringify(profile);
  for (const gear of GEARS) expect(withModelGear(profile, gear)).not.toBe(profile);
  expect(withModelGear(profile, 0)).toBe(profile);
  expect(JSON.stringify(profile)).toBe(before);
});

it('a gear blinks in its gear', () => {
  const stop = sync(DEFAULT_CHARACTER_PROFILES);
  const gear = modelGear('claude-sonnet-5-5', 'medium');
  const open = getCharacterSprites(0, 0, false, gear);
  const shut = getCharacterSprites(0, 0, true, gear);
  const plainShut = getCharacterSprites(0, 0, true, 0);
  expect(JSON.stringify(shut)).not.toBe(JSON.stringify(open));
  expect(JSON.stringify(shut)).not.toBe(JSON.stringify(plainShut));
  stop();
});
