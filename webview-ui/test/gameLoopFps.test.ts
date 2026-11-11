import { describe, expect, it } from 'vitest';

import { skipFrame } from '../src/office/engine/frameRate.js';

/** Frames drawn in one second of 60 Hz animation frames at the wanted rate. */
function drawnPerSecond(fps: number | undefined): { drawn: number; advanced: number } {
  let last = 0;
  let drawn = 0;
  let advanced = 0;
  for (let i = 1; i <= 60; i++) {
    const t = (i * 1000) / 60;
    if (skipFrame(t, last, fps)) continue;
    if (last !== 0) advanced += t - last;
    last = t;
    drawn++;
  }
  return { drawn, advanced };
}

describe('skipFrame: frames skipped down to the wanted rate', () => {
  it('draws every frame when no rate is asked', () => {
    expect(drawnPerSecond(undefined).drawn).toBe(60);
    expect(drawnPerSecond(0).drawn).toBe(60);
  });

  it('about 10 a second at rest and 30 when moving, the elapsed time still covered', () => {
    const idle = drawnPerSecond(10);
    expect(idle.drawn).toBeGreaterThanOrEqual(9);
    expect(idle.drawn).toBeLessThanOrEqual(11);
    expect(idle.advanced).toBeGreaterThan(850);
    const moving = drawnPerSecond(30);
    expect(moving.drawn).toBeGreaterThanOrEqual(29);
    expect(moving.drawn).toBeLessThanOrEqual(31);
  });
});
