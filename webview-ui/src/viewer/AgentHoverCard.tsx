/**
 * pixel-agents-secure (local): what an agent is doing, shown while the mouse
 * is over its character in the read-only office. Shown with or without the
 * bubbles and labels (Opções → "Balões e rótulos").
 *
 * Only what this page already holds: the character's state, the tool labels
 * the office shows, its context gauge and the activity history.
 */
import { useEffect, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { overlayProjection } from '../office/projection.js';
import type { ToolActivity } from '../office/types.js';
import { canvasDpr } from '../viewScale.js';
import { entryText, timeAgo, useAgentActivity } from './agentActivity.js';
import { agentStatusView, agentTitle, TONE_COLOR } from './agentStatus.js';

const CARD_WIDTH = 280;
const GAP = 14;
const RECENT_TOOLS = 3;

interface Props {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  agentTools: Record<number, ToolActivity[]>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  /** The agent whose details panel is open: no card over it. */
  detailsAgentId: number | null;
}

/** Re-renders every frame while something is hovered, so the card follows
 *  a walking character; idles otherwise. */
function useHoveredId(officeState: OfficeState): number | null {
  const [, setFrame] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const tick = () => {
      const hovered = officeState.hoveredAgentId;
      if (hovered !== null || last !== null) setFrame((n) => n + 1);
      last = hovered;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [officeState]);
  return officeState.hoveredAgentId;
}

export function AgentHoverCard({
  officeState,
  containerRef,
  zoom,
  panRef,
  agentTools,
  subagentTools,
  subagentCharacters,
  detailsAgentId,
}: Props) {
  const hoveredId = useHoveredId(officeState);
  const sub = hoveredId !== null ? subagentCharacters.find((s) => s.id === hoveredId) : undefined;
  // A sub-agent's card talks about its lead, whose history it is.
  const agentId = sub ? sub.parentAgentId : hoveredId;
  const activity = useAgentActivity(agentId);
  const now = Date.now();

  const el = containerRef.current;
  const ch = hoveredId !== null ? officeState.characters.get(hoveredId) : undefined;
  if (!el || hoveredId === null || agentId === null || !ch) return null;
  if (!sub && agentId === detailsAgentId) return null;

  const rect = el.getBoundingClientRect();
  const project = overlayProjection(
    officeState.getLayout(),
    rect,
    zoom,
    panRef.current,
    canvasDpr(),
  );
  const x = project.toScreenX(ch.x);
  const y = project.toScreenY(ch.y - 16);
  const halfWidth = project.toScreenX(ch.x + 8) - x;
  const onRight = x + halfWidth + GAP + CARD_WIDTH < rect.width - 8;
  const left = onRight ? x + halfWidth + GAP : Math.max(8, x - halfWidth - GAP - CARD_WIDTH);
  const top = Math.min(Math.max(8, y - 20), Math.max(8, rect.height - 240));

  const status = agentStatusView(officeState, agentId, agentTools);
  const entries = activity?.entries ?? [];
  const last = entries[entries.length - 1];
  const turnStart = [...entries].reverse().find((e) => e.k === 'turn');
  // The tools before the one running now (that one is shown above them).
  const tools = entries.filter((e) => e.k === 'tool');
  if (status.tool && tools[tools.length - 1]?.label === status.tool) tools.pop();
  const recent = tools.slice(-RECENT_TOOLS).reverse();
  const subRows = sub ? subagentTools[sub.parentAgentId]?.[sub.parentToolId] : undefined;
  const subRunning = subRows ? [...subRows].reverse().find((t) => !t.done) : undefined;
  const lead = officeState.characters.get(agentId);
  const contextUsed =
    lead && lead.contextReported ? Math.round((lead.contextTokens / lead.maxContextTokens) * 100) : null;
  const subagents = subagentCharacters.filter((s) => s.parentAgentId === agentId).length;

  return (
    <div
      className="absolute pixel-panel pointer-events-none select-none flex flex-col gap-4 px-10 py-8"
      style={{ left, top, width: CARD_WIDTH, zIndex: 25 }}
      data-testid="agent-hover-card"
      data-agent-id={hoveredId}
    >
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-sm text-text truncate">
          {sub ? 'Subagente' : agentTitle(officeState, agentId)}
        </span>
        {activity?.project && (
          <span className="text-2xs text-text-muted truncate" title={activity.project}>
            {activity.project}
          </span>
        )}
      </div>

      {sub ? (
        <>
          <span className="text-xs text-text">{sub.label || 'Subtarefa'}</span>
          {subRunning && <span className="text-2xs text-text-muted truncate">{subRunning.status}</span>}
          <span className="text-2xs text-text-muted">de {agentTitle(officeState, agentId)}</span>
        </>
      ) : (
        <>
          <div className="flex items-center gap-6">
            <span
              className={`w-6 h-6 rounded-full shrink-0 ${status.tone === 'active' ? 'pixel-pulse' : ''}`}
              style={{ background: TONE_COLOR[status.tone] }}
            />
            <span className="text-xs text-text">{status.text}</span>
            {status.tone === 'active' && turnStart && (
              <span className="text-2xs text-text-muted">{timeAgo(turnStart.t, now)}</span>
            )}
          </div>
          {status.tool && <span className="text-xs text-text break-words">{status.tool}</span>}
          {recent.length > 0 && (
            <div className="flex flex-col">
              {recent.map((e) => (
                <span key={`${e.t}-${e.toolId ?? ''}`} className="text-2xs text-text-muted truncate">
                  · {entryText(e)}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-10 text-2xs text-text-muted">
            {contextUsed !== null && <span>Contexto {contextUsed}%</span>}
            {subagents > 0 && <span>{subagents} subagente{subagents > 1 ? 's' : ''}</span>}
            {lead?.teamName && <span>Equipe {lead.teamName}</span>}
            {last && <span>Última atividade {timeAgo(last.t, now)}</span>}
          </div>
        </>
      )}
      <span className="text-2xs text-accent-bright">Clique para ver detalhes</span>
    </div>
  );
}
