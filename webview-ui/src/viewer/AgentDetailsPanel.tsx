/**
 * pixel-agents-secure (local): an agent's details in the read-only office,
 * opened by clicking its character or its card: its state and its activity
 * history (tool labels and turn changes), the same labels the office shows
 * over the character.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CharacterMugShot } from '../components/CharacterMugShot.js';
import { Button } from '../components/ui/Button.js';
import { PixelIcon } from '../components/ui/PixelIcon.js';
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import type { ActivityEntry } from './agentActivity.js';
import { clockTime, entryText, timeAgo, useAgentActivity, useNow } from './agentActivity.js';
import { agentStatusView, agentTitle, TONE_COLOR } from './agentStatus.js';

const BODY_FONT: React.CSSProperties = {
  fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", sans-serif',
  fontSize: 13,
  lineHeight: 1.45,
};

const KIND_COLOR: Partial<Record<ActivityEntry['k'], string>> = {
  turn: 'var(--color-status-active)',
  permission: 'var(--color-status-permission)',
  input: 'var(--color-status-permission)',
  done: 'var(--color-status-success)',
  joined: 'var(--color-accent-bright)',
};

/** Keeps a scroll box pinned to its bottom while it was at the bottom. */
function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  return { ref, onScroll };
}

function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  const { ref, onScroll } = useStickToBottom(entries.length);
  if (entries.length === 0) {
    return (
      <p className="text-xs text-text-muted px-4">
        Nada registrado ainda. A atividade aparece aqui conforme o agente trabalha.
      </p>
    );
  }
  return (
    <div ref={ref} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto pr-4" data-testid="activity-list">
      {entries.map((e, i) => {
        const marker = KIND_COLOR[e.k];
        const isTool = e.k === 'tool' || e.k === 'subtool';
        return (
          <div
            key={`${e.t}-${i}`}
            className={`flex gap-8 py-2 ${marker ? 'mt-4' : ''}`}
            style={BODY_FONT}
          >
            <span className="text-text-muted shrink-0 tabular-nums">{clockTime(e.t)}</span>
            <span
              className="min-w-0 break-words"
              style={{
                color: marker ?? 'var(--color-text)',
                paddingLeft: e.k === 'subtool' ? 12 : 0,
                opacity: isTool ? 0.95 : 1,
              }}
            >
              {e.k === 'subtool' ? '↳ ' : ''}
              {entryText(e)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  agentId: number;
  officeState: OfficeState;
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  onClose: () => void;
}

export function AgentDetailsPanel({ agentId, officeState, agentTools, subagentCharacters, onClose }: Props) {
  const activity = useAgentActivity(agentId);
  const now = useNow(5_000);
  // Re-read the character's live state (it is mutable, not React state).
  const [, setBeat] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setBeat((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ch = officeState.characters.get(agentId);
  const status = agentStatusView(officeState, agentId, agentTools);
  const entries = activity?.entries ?? [];
  const turnStart = [...entries].reverse().find((e) => e.k === 'turn');
  const toolCount = entries.filter((e) => e.k === 'tool').length;
  const contextUsed =
    ch && ch.contextReported ? Math.round((ch.contextTokens / ch.maxContextTokens) * 100) : null;
  const subagents = subagentCharacters.filter((s) => s.parentAgentId === agentId);

  return (
    <div
      className="absolute right-8 top-8 bottom-8 pixel-panel flex flex-col gap-6 p-10 pointer-events-auto"
      style={{ width: 'min(400px, calc(100% - 16px))', zIndex: 25 }}
      data-testid="agent-details"
      data-agent-id={agentId}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-8">
        {ch && <CharacterMugShot palette={ch.palette} repeat={ch.repeat} />}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-base text-text truncate">{agentTitle(officeState, agentId)}</span>
          {activity?.project && (
            <span className="text-xs text-text-muted truncate" title={activity.project}>
              {activity.project}
            </span>
          )}
          <div className="flex items-center gap-6 pt-2">
            <span
              className={`w-6 h-6 rounded-full shrink-0 ${status.tone === 'active' ? 'pixel-pulse' : ''}`}
              style={{ background: TONE_COLOR[status.tone] }}
            />
            <span className="text-xs text-text">{status.text}</span>
            {status.tone === 'active' && turnStart && (
              <span className="text-2xs text-text-muted">desde {timeAgo(turnStart.t, now)}</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar">
          <PixelIcon name="close" />
        </Button>
      </div>

      {status.tool && (
        <div className="text-text break-words" style={BODY_FONT}>
          {status.tool}
        </div>
      )}

      <div className="flex flex-wrap gap-x-12 text-2xs text-text-muted">
        {contextUsed !== null && <span>Contexto usado {contextUsed}%</span>}
        <span>{toolCount} ferramenta{toolCount === 1 ? '' : 's'} no histórico</span>
        {subagents.length > 0 && (
          <span>
            {subagents.length} subagente{subagents.length > 1 ? 's' : ''}:{' '}
            {subagents.map((s) => s.label || 'subtarefa').join(', ')}
          </span>
        )}
        {ch?.teamName && <span>Equipe {ch.teamName}</span>}
      </div>

      <div className="text-xs text-text-muted border-b-2 border-border pb-4">Atividade</div>

      <ActivityList entries={entries} />
    </div>
  );
}
