import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { expect, it } from 'vitest';

import type { CharacterProfile } from '../../core/src/characterProfiles.js';
import { DEFAULT_CHARACTER_PROFILES } from '../../core/src/defaultCharacterProfiles.js';
import { gearArt, withModelGear } from '../src/characters/modelGear.js';
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
const EFFORTS = ['medium', 'high', 'xhigh'];
const GEARS = MODELS.flatMap((m) => EFFORTS.map((e) => modelGear(m, e)));

it('every gear has its own sheet in the wardrobe, and a headgear its hair mask', () => {
  expect(gearArt(0)).toBeUndefined();
  expect(gearArt(undefined)).toBeUndefined();
  expect(gearArt(99)).toBeUndefined();
  const sheets = GEARS.map((gear) => gearArt(gear)!.sheet);
  expect(new Set(sheets).size).toBe(GEARS.length);
  for (const gear of GEARS) {
    const { sheet, hide } = gearArt(gear)!;
    expect(files.has(sheet), sheet).toBe(true);
    if (hide) expect(files.has(hide), hide).toBe(true);
  }
  // The squire is bare-headed; the others cover the hair.
  expect(MODELS.map((m) => gearArt(modelGear(m))!.hide !== undefined)).toEqual([false, true, true, true]);
  // No gear art is left over: the wardrobe refuses a PNG it does not expect.
  const expected = new Set(
    GEARS.flatMap((g) => Object.values(gearArt(g)!)).filter((art) => art !== undefined),
  );
  expect([...files.keys()].filter((f) => f.startsWith('gear/')).sort()).toEqual([...expected].sort());
});

it('every class shows in every frame of every view, so it is told apart seated or walking', () => {
  for (const model of MODELS) {
    const img = files.get(gearArt(modelGear(model))!.sheet)!;
    for (let row = 0; row < 3; row++) {
      for (let frame = 0; frame < 8; frame++) {
        let opaque = 0;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 16; x++) {
            if (img.data[((row * 32 + y) * img.width + frame * 16 + x) * 4 + 3] > 0) opaque++;
          }
        }
        expect(opaque, `${model} row ${row} frame ${frame}`).toBeGreaterThanOrEqual(8);
      }
    }
  }
});

it('hair is not drawn under a headgear, and is left alone without one', () => {
  const hairy: CharacterProfile = { ...DEFAULT_CHARACTER_PROFILES[0], hair: 'long' };
  const bald: CharacterProfile = { ...hairy, hair: undefined };
  const sheet = (p: CharacterProfile, model: string) =>
    JSON.stringify([...renderer.sheet(withModelGear(p, modelGear(model)))]);
  // The top rows of the first front frame: under a helm they are the helm's, hair or no hair.
  const top = (p: CharacterProfile, model: string) => {
    const data = renderer.sheet(withModelGear(p, modelGear(model)));
    return JSON.stringify([...data.subarray(0, 128 * 4 * 7)].filter((_, i) => Math.floor(i / 4) % 128 < 16));
  };
  expect(top(hairy, 'claude-opus-5-5')).toBe(top(bald, 'claude-opus-5-5'));
  expect(top(hairy, 'claude-haiku-5-5')).not.toBe(top(bald, 'claude-haiku-5-5'));
  // Long hair still shows below the helm.
  expect(sheet(hairy, 'claude-opus-5-5')).not.toBe(sheet(bald, 'claude-opus-5-5'));
});

it('each model dresses every character differently', () => {
  const stop = sync(DEFAULT_CHARACTER_PROFILES);
  DEFAULT_CHARACTER_PROFILES.forEach((_, i) => {
    const looks = GEARS.map((gear) => front(i, 0, gear));
    expect(new Set(looks).size, `character ${i}`).toBe(looks.length);
    expect(getCharacterSprites(i, 0, false, 0)).toBe(getCharacterSprites(i, 0));
    const plain = front(i, 0, 0);
    for (const gear of GEARS) expect(front(i, 0, gear), `gear ${gear}`).not.toBe(plain);
  });
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
