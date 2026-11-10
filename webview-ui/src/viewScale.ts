/**
 * pixel-agents-secure (local): zoom in steps of 0.2.
 *
 * The office engine draws at an INTEGER zoom (device pixels per sprite pixel):
 * its sprite cache and tile grid have no fractional positions. A fine zoom is
 * obtained without touching it: the engine draws at the next integer zoom up,
 * on a canvas whose backing store is proportionally larger than the screen
 * area it covers, and the browser scales the canvas down. Everything that
 * converts between canvas pixels and CSS pixels asks `canvasDpr()` instead of
 * `window.devicePixelRatio`, so hit-testing, panning and the DOM overlay stay
 * aligned. At a whole zoom the scale is 1 and nothing changes.
 */
import { useSyncExternalStore } from 'react';

import { ZOOM_MAX, ZOOM_MIN } from './constants.js';
import { useDevicePixelRatio } from './hooks/useDevicePixelRatio.js';

export const ZOOM_STEP = 0.2;
/** Below 1: the whole office in a small floating window. */
export const FINE_ZOOM_MIN = 0.4;
export const VIEW_SCALE_EVENT = 'pixel-agents:view-scale';

let scale = 1;

/** Canvas pixels per CSS pixel. */
export function canvasDpr(): number {
  return (window.devicePixelRatio || 1) * scale;
}

/** A zoom on the 0.2 grid, inside the allowed range. */
export function clampFineZoom(value: number): number {
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.round(Math.max(FINE_ZOOM_MIN, Math.min(ZOOM_MAX, stepped)) * 10) / 10;
}

/** The largest zoom on the grid that does not exceed `value`. */
export function floorFineZoom(value: number): number {
  return clampFineZoom(Math.floor(value / ZOOM_STEP + 1e-6) * ZOOM_STEP);
}

/** The integer zoom the engine draws at for a fine zoom. */
export function engineZoom(fine: number): number {
  return Math.max(ZOOM_MIN, Math.ceil(fine - 1e-6));
}

/** Apply the canvas scale a fine zoom needs. Returns old and new scale. */
export function applyFineZoom(fine: number): { previous: number; current: number } {
  const previous = scale;
  const next = engineZoom(fine) / fine;
  if (Math.abs(next - scale) > 1e-9) {
    scale = next;
    window.dispatchEvent(new Event(VIEW_SCALE_EVENT));
  }
  return { previous, current: scale };
}

function subscribeScale(onChange: () => void): () => void {
  window.addEventListener(VIEW_SCALE_EVENT, onChange);
  return () => window.removeEventListener(VIEW_SCALE_EVENT, onChange);
}

/** `canvasDpr()`, re-rendering when the screen's ratio or the scale changes. */
export function useCanvasDpr(): number {
  const dpr = useDevicePixelRatio();
  const current = useSyncExternalStore(
    subscribeScale,
    () => scale,
    () => 1,
  );
  return dpr * current;
}
