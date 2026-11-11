/**
 * pixel-agents-secure (local): keeps the office drawn with one room per
 * project (projectRooms.ts) while that option is on. Only in the read-only
 * viewer: the composed layout lives in this browser's memory, is never sent
 * to the server and never saved.
 */
import { useEffect, useRef, useState } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { getBlockedTiles } from '../office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../office/types.js';
import { fitOffice } from '../pictureInPicture.js';
import { transport } from '../transport/index.js';
import {
  composeOffice,
  planRooms,
  type PlacedRoom,
  type RoomState,
  sameRooms,
} from './projectRooms.js';

/** How often the plan is looked at again (an empty room's time runs out). */
const REPLAN_MS = 5_000;

export function useProjectRooms(
  enabled: boolean,
  getOfficeState: () => OfficeState,
  agents: number[],
  layoutReady: boolean,
): PlacedRoom[] {
  const baseRef = useRef<OfficeLayout | null>(null);
  const planRef = useRef<RoomState[]>([]);
  /** Whether the office is drawn from the base as it is now. */
  const freshBaseRef = useRef(true);
  const composedRef = useRef(false);
  const [placed, setPlaced] = useState<PlacedRoom[]>([]);
  const [beat, setBeat] = useState(0);

  // The base layout: whatever the server last sent. The main handler has
  // drawn it by the time the timeout runs (a message with no layout draws
  // nothing, so what is on screen then is not a new base).
  useEffect(() => {
    return transport.onMessage((msg) => {
      if (msg.type !== 'layoutLoaded') return;
      const sent = msg.layout as { version?: unknown } | null | undefined;
      if (baseRef.current && sent?.version !== 1) return;
      setTimeout(() => {
        baseRef.current = getOfficeState().getLayout();
        freshBaseRef.current = true;
        composedRef.current = false;
        setBeat((n) => n + 1);
      }, 0);
    });
  }, [getOfficeState]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setBeat((n) => n + 1), REPLAN_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!layoutReady) return;
    const os = getOfficeState();
    // Loaded before this hook listened: the layout on screen is the base.
    baseRef.current ??= os.getLayout();
    const base = baseRef.current;

    if (!enabled) {
      if (composedRef.current) {
        os.applyRooms(base, {}, false);
        composedRef.current = false;
        freshBaseRef.current = true;
        setTimeout(() => fitOffice(), 0);
      }
      planRef.current = [];
      setPlaced((rooms) => (rooms.length > 0 ? [] : rooms));
      return;
    }

    const counts = new Map<string, number>();
    for (const id of agents) {
      const ch = os.characters.get(id);
      if (!ch || ch.isSubagent || ch.matrixEffect === 'despawn' || !ch.directoryName) continue;
      counts.set(ch.directoryName, (counts.get(ch.directoryName) ?? 0) + 1);
    }
    const plan = planRooms(planRef.current, counts, Date.now());
    const unchanged = sameRooms(plan, planRef.current) && !freshBaseRef.current;
    planRef.current = plan;
    if (unchanged) return;

    const shown = os.getLayout();
    const composed = composeOffice(base, plan, getBlockedTiles(base.furniture));
    const roomAreas: Record<string, string[]> = {};
    for (const room of composed.rooms) roomAreas[room.project] = [room.label];
    // On a fresh base everyone is put in place at once; later, they walk.
    os.applyRooms(composed.layout, roomAreas, freshBaseRef.current || !composed.connected);
    freshBaseRef.current = false;
    composedRef.current = composed.rooms.length > 0;
    setPlaced(composed.rooms);
    // The office changed size: show all of it again.
    if (composed.layout.cols !== shown.cols || composed.layout.rows !== shown.rows) {
      setTimeout(() => fitOffice(), 0);
    }
  }, [enabled, layoutReady, agents, beat, getOfficeState]);

  return placed;
}
