import { describe, expect, it } from 'vitest';

import { ActivityFlash, LABEL_FLASH_MS, parseLabelMode } from '../src/viewer/labelMode.js';

describe('viewer label mode', () => {
  it('reads the saved mode, and the old checkbox when there is none', () => {
    expect(parseLabelMode('smart', true)).toBe('smart');
    expect(parseLabelMode(undefined, true)).toBe('always');
    expect(parseLabelMode(undefined, false)).toBe('hover');
    expect(parseLabelMode('nonsense', undefined)).toBe('hover');
  });

  it('the first activity seen is not a change', () => {
    const flash = new ActivityFlash();
    expect(flash.note(1, 'Reading file', 1_000)).toBe(false);
    expect(flash.note(1, 'Reading file', 2_000)).toBe(false);
  });

  it('a change shows for a few seconds, then goes away', () => {
    const flash = new ActivityFlash();
    flash.note(1, 'Reading file', 1_000);
    expect(flash.note(1, 'Running: npm test', 2_000)).toBe(true);
    expect(flash.note(1, 'Running: npm test', 2_000 + LABEL_FLASH_MS - 1)).toBe(true);
    expect(flash.note(1, 'Running: npm test', 2_000 + LABEL_FLASH_MS)).toBe(false);
  });

  it('turning idle is not news', () => {
    const flash = new ActivityFlash();
    flash.note(1, 'Reading file', 1_000);
    expect(flash.note(1, 'Idle', 2_000)).toBe(false);
  });

  it('forgets the agents that left', () => {
    const flash = new ActivityFlash();
    flash.note(1, 'Reading file', 1_000);
    flash.keep([2]);
    // Back as a stranger: its first text is not a change.
    expect(flash.note(1, 'Running: npm test', 2_000)).toBe(false);
  });
});
