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
  /** The compact office (a lounge and a corridor) instead of the base. */
  compact: boolean,
  /** The office grew or shrank by `d` tiles, and what was already in it moved
   *  by `shift` tiles: keep what was on screen where it was. */
  onResize: (dCols: number, dRows: number, shiftCols: number, shiftRows: number) => void,
): PlacedRoom[] {
  const baseRef = useRef<OfficeLayout | null>(null);
  /** The server sent a layout: what is on screen now is the new base. */
  const baseStaleRef = useRef(true);
  /** The layout this hook last drew, which is never a base. */
  const composedLayoutRef = useRef<OfficeLayout | null>(null);
  /** The office size the view is lined up with (null: not yet with rooms). */
  const viewSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  /** The fixed point of the office on screen (ComposedOffice.origin). */
  const originRef = useRef({ col: 0, row: 0 });
  const drawnCompactRef = useRef(false);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const planRef = useRef<RoomState[]>([]);
  /** Whether the office is drawn from the base as it is now. */
  const freshBaseRef = useRef(true);
  const composedRef = useRef(false);
  const [placed, setPlaced] = useState<PlacedRoom[]>([]);
  const [beat, setBeat] = useState(0);

  // The base layout: whatever the server last sent. Only a flag is raised
  // here; the effect below reads the layout, and it cannot run before the main
  // handler has drawn it (effects never run inside the message's own task).
  // A message with no layout draws nothing, so it brings no new base.
  useEffect(() => {
    return transport.onMessage((msg) => {
      if (msg.type !== 'layoutLoaded') return;
      const sent = msg.layout as { version?: unknown } | null | undefined;
      if (sent?.version !== 1) return;
      baseStaleRef.current = true;
      setBeat((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setBeat((n) => n + 1), REPLAN_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!layoutReady) return;
    const os = getOfficeState();
    if (baseStaleRef.current || !baseRef.current) {
      baseStaleRef.current = false;
      const shown = os.getLayout();
      // What this hook drew is never a base (it would grow a second wing).
      if (shown !== composedLayoutRef.current) {
        baseRef.current = shown;
        freshBaseRef.current = true;
        composedRef.current = false;
      }
    }
    const base = baseRef.current;
    if (!base) return;

    if (!enabled) {
      if (composedRef.current) {
        os.applyRooms(base, {}, [], false);
        composedRef.current = false;
        composedLayoutRef.current = null;
        viewSizeRef.current = null;
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
    // The compact office is only drawn while there is a room.
    const drawCompact = compact && plan.length > 0;
    if (drawnCompactRef.current !== drawCompact) {
      // Another office altogether: put everyone in place and show it whole.
      drawnCompactRef.current = drawCompact;
      freshBaseRef.current = true;
      viewSizeRef.current = null;
    }
    const unchanged = sameRooms(plan, planRef.current) && !freshBaseRef.current;
    planRef.current = plan;
    if (unchanged) {
      // Same rooms; someone may have arrived seated outside its own.
      if (plan.length > 0) os.moveIntoRooms(false);
      return;
    }

    const composed = composeOffice(base, plan, getBlockedTiles(base.furniture), compact);
    const roomAreas: Record<string, string[]> = {};
    for (const room of composed.rooms) roomAreas[room.project] = [room.label];
    // On a fresh base everyone is put in place at once; later, they walk.
    // Rooms opening over the corridor push the rest down: everyone moves along.
    const fresh = freshBaseRef.current;
    const shift = fresh
      ? { col: 0, row: 0 }
      : {
          col: composed.origin.col - originRef.current.col,
          row: composed.origin.row - originRef.current.row,
        };
    originRef.current = composed.origin;
    os.applyRooms(composed.layout, roomAreas, composed.roomTiles, fresh || !composed.connected, shift);
    freshBaseRef.current = false;
    composedRef.current = composed.rooms.length > 0;
    composedLayoutRef.current = composedRef.current ? composed.layout : null;
    setPlaced(composed.rooms);
    // The first office with rooms is shown whole; after that a room opening or
    // closing leaves the zoom alone and what was on screen where it was. (A
    // reconnect redraws the same office: nothing moves.)
    const size = { cols: composed.layout.cols, rows: composed.layout.rows };
    const was = viewSizeRef.current;
    viewSizeRef.current = size;
    if (!was) {
      if (composed.layout !== base) setTimeout(() => fitOffice(), 0);
    } else if (was.cols !== size.cols || was.rows !== size.rows || shift.col || shift.row) {
      onResizeRef.current(size.cols - was.cols, size.rows - was.rows, shift.col, shift.row);
    }
  }, [enabled, layoutReady, agents, beat, compact, getOfficeState]);

  return placed;
}
