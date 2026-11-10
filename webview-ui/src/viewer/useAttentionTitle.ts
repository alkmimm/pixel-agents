/**
 * pixel-agents-secure (local): the read-only office's tab (or app window)
 * title counts the agents waiting on you, e.g. "(2) Pixel Agents", so a
 * minimized or background viewer still says when someone needs an answer.
 */
import { useEffect } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';

const CHECK_MS = 1_000;

export function needsYou(officeState: OfficeState, id: number): boolean {
  const ch = officeState.characters.get(id);
  if (!ch) return false;
  return ch.bubbleType === 'permission' || (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput === true);
}

export function useAttentionTitle(
  enabled: boolean,
  agents: number[],
  getOfficeState: () => OfficeState,
): void {
  useEffect(() => {
    if (!enabled) return;
    const base = document.title.replace(/^\(\d+\)\s*/, '') || 'Pixel Agents';
    const update = () => {
      const officeState = getOfficeState();
      const count = agents.filter((id) => needsYou(officeState, id)).length;
      const next = count > 0 ? `(${count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    update();
    const timer = setInterval(update, CHECK_MS);
    return () => {
      clearInterval(timer);
      document.title = base;
    };
  }, [enabled, agents, getOfficeState]);
}
