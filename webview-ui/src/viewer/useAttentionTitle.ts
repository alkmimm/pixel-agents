/**
 * pixel-agents-secure (local): the read-only office's tab (or app window)
 * title counts the agents waiting on you, e.g. "(2) Pixel Agents", so a
 * minimized or background viewer still says when someone needs an answer.
 *
 * Waiting on you: asking for approval, waiting for your input, or a turn that
 * finished in the last DONE_COUNTS_MS (an old finished session no longer
 * counts, or an abandoned one would hold the count forever). Read from the
 * activity history, not from the bubbles, which fade after two seconds.
 */
import { useEffect } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { lastTurnState } from './agentActivity.js';

const CHECK_MS = 1_000;
const DONE_COUNTS_MS = 30 * 60_000;

export function needsYou(officeState: OfficeState, id: number, now: number): boolean {
  if (officeState.characters.get(id)?.bubbleType === 'permission') return true;
  const state = lastTurnState(id);
  if (state?.k === 'input') return true;
  return state?.k === 'done' && now - state.t < DONE_COUNTS_MS;
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
      const now = Date.now();
      const count = agents.filter((id) => needsYou(officeState, id, now)).length;
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
