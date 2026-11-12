/**
 * pixel-agents-secure (local): runs the office's director (officeDirector.ts)
 * once a second while "Vida no escritório" is on. Returns the mood to draw
 * over each head (ToolOverlay's `emote`).
 */
import { useCallback, useEffect, useRef } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { agentStatusView } from './agentStatus.js';
import { ALL_PARTS, type LifeParts, LOOK_MS, OfficeDirector } from './officeDirector.js';

export type { LifeParts } from './officeDirector.js';

export function useOfficeLife(
  enabled: boolean,
  getOfficeState: () => OfficeState,
  agents: number[],
  agentTools: Record<number, ToolActivity[]>,
  parts: LifeParts = ALL_PARTS,
): (id: number) => string | undefined {
  const director = useRef<OfficeDirector | null>(null);
  const latest = useRef({ agents, agentTools, parts });
  latest.current = { agents, agentTools, parts };

  useEffect(() => {
    if (!enabled) return;
    const own = new OfficeDirector(getOfficeState, agentStatusView);
    director.current = own;
    const timer = setInterval(() => {
      const { agents: ids, agentTools: tools, parts: on } = latest.current;
      own.look(Date.now(), ids, tools, on);
    }, LOOK_MS);
    return () => {
      clearInterval(timer);
      own.clearOffice();
      director.current = null;
    };
  }, [enabled, getOfficeState]);

  return useCallback((id: number) => director.current?.moodOf(id, Date.now()), []);
}
