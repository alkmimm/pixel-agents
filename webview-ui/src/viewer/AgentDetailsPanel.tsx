/**
 * pixel-agents-secure (local): an agent's details in the read-only office,
 * opened by clicking its character or its card.
 *
 * - "Atividade": the activity history (tool labels and turn changes), the
 *   same labels the office shows over the character.
 * - "Conversa" (H17): the agent's prompts and replies as plain text, only
 *   when the viewer's operator turned it on. Rendered as text, never as HTML
 *   or markdown.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CharacterMugShot } from '../components/CharacterMugShot.js';
import { TERMINAL_SIDEBAR_WIDTH_PX } from '../constants.js';
import { Button } from '../components/ui/Button.js';
import { PixelIcon } from '../components/ui/PixelIcon.js';
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import type { ActivityEntry, ConversationEntry } from './agentActivity.js';
import {
  clockTime,
  entryText,
  timeAgo,
  useAgentActivity,
  useAgentConversation,
  useConversationOffered,
  useNow,
} from './agentActivity.js';
import { agentStatusView, agentTitle, TONE_COLOR } from './agentStatus.js';

type Tab = 'activity' | 'conversation';

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
  // The newest entry, not the count: at the cap the count stops changing.
  const newest = entries[entries.length - 1];
  const { ref, onScroll } = useStickToBottom(newest ? (newest.n ?? newest.t) : 0);
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
            key={e.n ?? `${e.t}-${i}`}
            className={`flex gap-8 py-2 ${marker ? 'mt-4' : ''}`}
            style={BODY_FONT}
          >
            {/* The font on each span: the global pixel-font rule beats inheritance. */}
            <span className="text-text-muted shrink-0 tabular-nums" style={BODY_FONT}>
              {clockTime(e.t)}
            </span>
            <span
              className="min-w-0 break-words"
              style={{
                ...BODY_FONT,
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

const ROLE_LABEL: Record<ConversationEntry['role'], string> = {
  user: 'Você',
  assistant: 'Claude',
  tool: '',
};

function ConversationList({ agentId }: { agentId: number }) {
  const conversation = useAgentConversation(agentId, true);
  const { ref, onScroll } = useStickToBottom(conversation?.receivedAt);
  if (!conversation) return <p className="text-xs text-text-muted px-4">Carregando…</p>;
  if (!conversation.enabled) {
    return (
      <p className="text-xs text-text-muted px-4">A conversa está desligada neste visualizador.</p>
    );
  }
  if (conversation.unreadable) {
    return <p className="text-xs text-text-muted px-4">Não foi possível ler a transcrição.</p>;
  }
  if (conversation.entries.length === 0) {
    return <p className="text-xs text-text-muted px-4">Nenhuma mensagem ainda.</p>;
  }
  return (
    <div ref={ref} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto pr-4" data-testid="conversation-list">
      {conversation.truncated && (
        <p className="text-2xs text-text-muted pb-6">Mostrando só o final da conversa.</p>
      )}
      {conversation.entries.map((e, i) =>
        e.role === 'tool' ? (
          <div
            key={i}
            className="text-text-muted break-words py-1 pl-12"
            style={{ ...BODY_FONT, fontSize: 12 }}
          >
            ↳ {e.text}
          </div>
        ) : (
          <div
            key={i}
            className="my-6 px-8 py-6 border-l-4"
            style={{
              borderColor:
                e.role === 'user' ? 'var(--color-accent-bright)' : 'var(--color-status-success)',
              background: e.role === 'user' ? 'var(--color-active-bg)' : 'var(--color-bg-dark)',
            }}
          >
            <div className="flex justify-between text-2xs text-text-muted pb-2">
              <span>{ROLE_LABEL[e.role]}</span>
              {e.t !== undefined && <span>{clockTime(e.t)}</span>}
            </div>
            <div className="text-text whitespace-pre-wrap break-words" style={BODY_FONT}>
              {e.text}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

interface Props {
  agentId: number;
  officeState: OfficeState;
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  /** The agent cards are a column over the office's right edge (desktop),
   *  not a bar below it (narrow window). */
  besideCards: boolean;
  onClose: () => void;
}

export function AgentDetailsPanel({
  agentId,
  officeState,
  agentTools,
  subagentCharacters,
  besideCards,
  onClose,
}: Props) {
  const rightGap = besideCards ? TERMINAL_SIDEBAR_WIDTH_PX + 8 : 8;
  const [tab, setTab] = useState<Tab>('activity');
  const activity = useAgentActivity(agentId);
  const offered = useConversationOffered();
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
  const toolCount = entries.filter((e) => e.k === 'tool').length;
  const contextUsed =
    ch && ch.contextReported ? Math.round((ch.contextTokens / ch.maxContextTokens) * 100) : null;
  const subagents = subagentCharacters.filter((s) => s.parentAgentId === agentId);

  return (
    <div
      className="absolute top-8 bottom-8 pixel-panel flex flex-col gap-6 p-10 pointer-events-auto"
      // Left of the agent cards, which overlap the office's right edge
      // (AgentCardBar's negative margin).
      style={{
        right: rightGap,
        width: `min(400px, calc(100% - ${rightGap + 8}px))`,
        // Over the music player (z 30) while open; under the modals (z 50).
        zIndex: 35,
      }}
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
            {status.since !== undefined && (
              <span className="text-2xs text-text-muted">desde {timeAgo(status.since, now)}</span>
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

      <div className="flex gap-4 border-b-2 border-border pb-6">
        <Button
          size="sm"
          variant={tab === 'activity' ? 'active' : 'default'}
          onClick={() => setTab('activity')}
        >
          Atividade
        </Button>
        <Button
          size="sm"
          variant={tab === 'conversation' ? 'active' : 'default'}
          onClick={() => setTab('conversation')}
          title={
            offered
              ? 'Prompts e respostas em texto (sem saída de ferramentas)'
              : 'Desligada neste visualizador'
          }
        >
          Conversa{offered ? '' : ' (desligada)'}
        </Button>
      </div>

      {tab === 'activity' ? (
        <ActivityList entries={entries} />
      ) : offered ? (
        <ConversationList agentId={agentId} />
      ) : (
        <p className="text-xs text-text-muted px-4">
          A conversa está desligada neste visualizador. Quem administra o serviço liga com{' '}
          <code>make office-conversa-on</code>.
        </p>
      )}
    </div>
  );
}
