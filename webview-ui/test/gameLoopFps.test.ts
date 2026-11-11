import { afterEach, describe, expect, it, vi } from 'vitest';

import { startGameLoop } from '../src/office/engine/gameLoop.js';

describe('gameLoop: frames skipped down to the wanted rate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function drive(fps: (() => number) | undefined, frames: number, frameMs: number) {
    let pending: ((t: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      pending = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const canvas = { getContext: () => ({ imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement;
    const dts: number[] = [];
    let renders = 0;
    const loop = startGameLoop(canvas, {
      update: (dt) => dts.push(dt),
      render: () => renders++,
      ...(fps ? { fps } : {}),
    });
    for (let i = 1; i <= frames; i++) pending!(i * frameMs);
    loop.stop();
    return { renders, dts };
  }

  it('draws every animation frame when no rate is asked', () => {
    expect(drive(undefined, 60, 1000 / 60).renders).toBe(60);
  });

  it('about 10 frames a second at rest, 30 when moving, with dt covering the gap', () => {
    const idle = drive(() => 10, 60, 1000 / 60);
    expect(idle.renders).toBeGreaterThanOrEqual(9);
    expect(idle.renders).toBeLessThanOrEqual(11);
    // Animations keep their speed: the time advanced adds up to the time elapsed.
    const advanced = idle.dts.reduce((a, b) => a + b, 0);
    expect(advanced).toBeGreaterThan(0.85);
    const moving = drive(() => 30, 60, 1000 / 60);
    expect(moving.renders).toBeGreaterThanOrEqual(29);
    expect(moving.renders).toBeLessThanOrEqual(31);
  });
});
