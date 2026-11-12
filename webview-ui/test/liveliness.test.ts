import { describe, expect, it } from 'vitest';

import {
  facing,
  FIDGET_EVERY_SEC,
  FX_SEC,
  fxPixels,
  GEAR_FX_EVERY_SEC,
  gearFxKind,
  GREET_COOLDOWN_SEC,
  headTop,
  HOP_SEC,
  hopLift,
  isLively,
  type Lively,
  startLiveliness,
  tickLiveliness,
} from '../src/office/engine/liveliness.js';
import { CharacterState, Direction } from '../src/office/types.js';
import { modelGear } from '../src/viewer/modelLevel.js';

let nextId = 1;
const char = (over: Partial<Lively> = {}): Lively => ({
  id: nextId++,
  state: CharacterState.IDLE,
  dir: Direction.DOWN,
  tileCol: 0,
  tileRow: 0,
  isActive: false,
  isSubagent: false,
  parentAgentId: null,
  gear: 0,
  matrixEffect: null,
  ...startLiveliness(),
  ...over,
});
const ALL = { gearFx: true, greet: true, helpers: true };
const OFF = { gearFx: false, greet: false, helpers: false };
const always = () => 0;
const never = () => 0.999999;
const FABLE = modelGear('claude-fable-5-2', 'xhigh');
const OPUS = modelGear('claude-opus-5-5');
const SONNET = modelGear('claude-sonnet-5-5');
const HAIKU = modelGear('claude-haiku-5-5');

describe('class effects at work', () => {
  it('each class has its own, and the squire none', () => {
    expect([FABLE, OPUS, SONNET, HAIKU, 0].map(gearFxKind)).toEqual([
      'sparks',
      'gleam',
      'arrow',
      undefined,
      undefined,
    ]);
  });

  it('only a character at work shows it, and only with the option on', () => {
    const working = char({ gear: FABLE, isActive: true, state: CharacterState.TYPE });
    const resting = char({ gear: FABLE, isActive: false, state: CharacterState.TYPE });
    const walking = char({ gear: FABLE, isActive: true, state: CharacterState.WALK });
    const squire = char({ gear: HAIKU, isActive: true, state: CharacterState.TYPE });
    tickLiveliness([working, resting, walking, squire], 0.1, OFF, always);
    expect(working.fx).toBeNull();
    tickLiveliness([working, resting, walking, squire], 0.1, ALL, always);
    expect(working.fx?.kind).toBe('sparks');
    expect([resting.fx, walking.fx, squire.fx]).toEqual([null, null, null]);
  });

  it('is rare: about once in GEAR_FX_EVERY_SEC of work', () => {
    const ch = char({ gear: OPUS, isActive: true, state: CharacterState.TYPE });
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let started = 0;
    const dt = 0.1;
    for (let t = 0; t < 3600; t += dt) {
      const before = ch.fx;
      tickLiveliness([ch], dt, ALL, rand);
      if (!before && ch.fx) started++;
    }
    const expected = 3600 / GEAR_FX_EVERY_SEC;
    expect(started).toBeGreaterThan(expected * 0.6);
    expect(started).toBeLessThan(expected * 1.4);
  });

  it('an effect ends after its time', () => {
    const ch = char({ gear: OPUS, isActive: true, state: CharacterState.TYPE });
    tickLiveliness([ch], 0.1, ALL, always);
    expect(isLively(ch)).toBe(true);
    tickLiveliness([ch], FX_SEC.gleam, ALL, never);
    expect(ch.fx).toBeNull();
    expect(isLively(ch)).toBe(false);
  });
});

describe('greeting in passing', () => {
  const walker = (col: number, over: Partial<Lively> = {}) =>
    char({ state: CharacterState.WALK, tileCol: col, ...over });

  it('two agents walking past each other greet, once per meeting', () => {
    const a = walker(3);
    const b = walker(4);
    const far = walker(9);
    tickLiveliness([a, b, far], 0.1, ALL, always);
    expect([a.fx?.kind, b.fx?.kind, far.fx]).toEqual(['note', 'note', null]);
    expect(a.socialCoolSec).toBe(GREET_COOLDOWN_SEC);
    a.fx = null;
    b.fx = null;
    tickLiveliness([a, b, far], 0.1, ALL, always);
    expect([a.fx, b.fx]).toEqual([null, null]);
  });

  it('a meeting that passes without a greeting is not asked again every frame', () => {
    const a = walker(3);
    const b = walker(4);
    tickLiveliness([a, b], 0.1, ALL, never);
    expect([a.fx, b.fx]).toEqual([null, null]);
    tickLiveliness([a, b], 0.1, ALL, always);
    expect([a.fx, b.fx]).toEqual([null, null]);
  });

  it('not for someone standing, a helper, or with the option off', () => {
    const a = walker(3);
    const standing = char({ tileCol: 4 });
    const helper = walker(3, { isSubagent: true, parentAgentId: 1, tileRow: 1 });
    tickLiveliness([a, standing, helper], 0.1, ALL, always);
    expect(a.fx).toBeNull();
    const b = walker(4);
    tickLiveliness([a, b], 0.1, { ...ALL, greet: false }, always);
    expect([a.fx, b.fx]).toEqual([null, null]);
  });
});

describe('helpers', () => {
  const helper = (col: number, over: Partial<Lively> = {}) =>
    char({ isSubagent: true, parentAgentId: 7, tileCol: col, ...over });

  it('one that finishes its task hops once', () => {
    const h = helper(0, { isActive: true, state: CharacterState.TYPE });
    tickLiveliness([h], 0.1, ALL, never);
    expect(h.hopSec).toBe(0);
    h.isActive = false;
    tickLiveliness([h], 0.1, ALL, never);
    expect(h.hopSec).toBe(HOP_SEC);
    expect(isLively(h)).toBe(true);
    tickLiveliness([h], 0.1, ALL, never);
    expect(h.hopSec).toBeLessThan(HOP_SEC);
    expect(hopLift(HOP_SEC / 2)).toBeGreaterThan(0);
    expect([hopLift(0), hopLift(HOP_SEC)]).toEqual([0, 0]);
  });

  it('two standing side by side turn to each other for a word', () => {
    const a = helper(2);
    const b = helper(3);
    tickLiveliness([a, b], 0.1, ALL, always);
    expect([a.fx?.kind, b.fx?.kind]).toEqual(['dots', 'dots']);
    expect([a.glanceDir, b.glanceDir]).toEqual([Direction.RIGHT, Direction.LEFT]);
    expect(a.glanceSec).toBeGreaterThan(0);
    // And are left alone for a while after.
    a.fx = null;
    b.fx = null;
    tickLiveliness([a, b], 0.1, ALL, always);
    expect([a.fx, b.fx]).toEqual([null, null]);
  });

  it('one alone, or beside another team, just looks around', () => {
    const a = helper(2);
    const other = helper(3, { parentAgentId: 8, socialCoolSec: 99 });
    tickLiveliness([a, other], 0.1, ALL, always);
    expect(a.fx).toBeNull();
    expect(a.glanceSec).toBeGreaterThan(0);
    expect(a.glanceDir).not.toBe(Direction.DOWN);
    expect(other.glanceSec).toBe(0);
  });

  it('with their option off they stay as they were, whatever else is on', () => {
    const done = helper(0, { wasActive: true });
    const a = helper(2);
    const b = helper(3);
    tickLiveliness([done, a, b], 0.1, { ...ALL, helpers: false }, always);
    expect([done.hopSec, a.glanceSec, b.glanceSec]).toEqual([0, 0, 0]);
    expect([a.fx, b.fx]).toEqual([null, null]);
  });

  it('a working helper does not fidget, and fidgeting is occasional', () => {
    const busy = helper(2, { isActive: true, state: CharacterState.TYPE });
    tickLiveliness([busy], 0.1, ALL, always);
    expect(busy.glanceSec).toBe(0);
    const idle = helper(5);
    const justOver = () => (0.1 / FIDGET_EVERY_SEC) * 1.01;
    tickLiveliness([idle], 0.1, ALL, justOver);
    expect(idle.glanceSec).toBe(0);
  });

  it('faces the way the other is', () => {
    const at = (tileCol: number, tileRow: number) => char({ tileCol, tileRow });
    expect(facing(at(0, 0), at(2, 1))).toBe(Direction.RIGHT);
    expect(facing(at(2, 0), at(0, 0))).toBe(Direction.LEFT);
    expect(facing(at(0, 2), at(0, 0))).toBe(Direction.UP);
    expect(facing(at(0, 0), at(1, 3))).toBe(Direction.DOWN);
  });
});

describe('drawing', () => {
  it('every effect draws something through its time, near the head', () => {
    for (const kind of Object.keys(FX_SEC) as Array<keyof typeof FX_SEC>) {
      for (const top of [2, 5, 7]) {
        let drawn = 0;
        for (let age = 0.05; age < FX_SEC[kind]; age += 0.1) {
          const pixels = fxPixels(kind, age, top);
          drawn += pixels.length;
          for (const px of pixels) {
            expect(px.x, kind).toBeGreaterThanOrEqual(0);
            expect(px.x, kind).toBeLessThan(16);
            expect(px.y, kind).toBeGreaterThan(top - 16);
            expect(px.y, kind).toBeLessThan(top + 12);
          }
        }
        expect(drawn, kind).toBeGreaterThan(0);
      }
    }
  });

  it('the head starts lower for a seated character facing the viewer, and on the side view', () => {
    expect(headTop(CharacterState.WALK, Direction.DOWN)).toBe(2);
    expect(headTop(CharacterState.TYPE, Direction.DOWN)).toBe(7);
    expect(headTop(CharacterState.TYPE, Direction.UP)).toBe(2);
    expect(headTop(CharacterState.IDLE, Direction.LEFT)).toBe(5);
  });
});
