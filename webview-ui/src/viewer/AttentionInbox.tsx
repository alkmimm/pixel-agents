/**
 * pixel-agents-secure (local): "Precisa de você" — the agents waiting on the
 * user (asking for approval, or done and waiting for the next message), the
 * longest-waiting first. Clicking one centers the office on it and opens its
 * details. Observation only: nothing here is sent to the server.
 *
 * Opt-in (Opções → Novidades → Caixa "Precisa de você").
 */
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { timeAgo, useAgentActivity, useNow } from './agentActivity.js';
import {
  BADGE_COLOR,
  sessionTitle,
  signalBadges,
  useAllSignals,
  type ViewerFeatures,
} from './agentSignals.js';
import { agentStatusView, agentTitle, TONE_COLOR } from './agentStatus.js';

const MAX_ROWS = 8;

interface Props {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  features: ViewerFeatures;
  onOpen: (id: number) => void;
}

export function AttentionInbox({ officeState, agents, agentTools, features, onOpen }: Props) {
  const now = useNow(10_000);
  const signals = useAllSignals();
  // Subscribes to the history, so a state change re-renders the list.
  useAgentActivity(null);

  const rows = agents
    .map((id) => {
      const status = agentStatusView(officeState, id, agentTools);
      const alerts = signalBadges(signals.get(id), status, undefined, features, now).filter(
        (b) => b.tone === 'alert' && b.key !== 'mode',
      );
      const waiting = status.tone === 'permission' || status.tone === 'input';
      return { id, status, alerts, waiting };
    })
    .filter((r) => r.waiting || r.alerts.length > 0)
    // Approval first, then the longest waiting.
    .sort(
      (a, b) =>
        Number(b.status.tone === 'permission') - Number(a.status.tone === 'permission') ||
        (a.status.since ?? now) - (b.status.since ?? now),
    );

  return (
    <div
      // Right of the zoom buttons (top-left column).
      // Under the bar's options (z 20), which open over this corner.
      className="absolute pixel-panel flex flex-col gap-2 px-8 py-6 overflow-y-auto"
      // Never wider or taller than the window leaves room for.
      style={{
        left: 64,
        top: 8,
        width: 'min(260px, calc(100% - 72px))',
        maxHeight: 'calc(100% - 72px)',
        zIndex: 15,
      }}
      data-testid="attention-inbox"
    >
      <span className="text-xs text-text">
        Precisa de você{rows.length > 0 ? ` (${rows.length})` : ''}
      </span>
      {rows.length === 0 && <span className="text-2xs text-text-muted">Ninguém esperando.</span>}
      {rows.slice(0, MAX_ROWS).map(({ id, status, alerts }) => {
        const title = sessionTitle(signals.get(id), features);
        return (
          <button
            key={id}
            type="button"
            className="flex flex-col items-start text-left bg-transparent border-0 p-2 cursor-pointer hover:bg-btn-hover"
            onClick={() => onOpen(id)}
            title="Centralizar e ver detalhes"
          >
            <span className="flex items-center gap-6 w-full">
              <span
                className="w-6 h-6 rounded-full shrink-0"
                style={{ background: TONE_COLOR[status.tone] }}
              />
              <span className="text-2xs text-text truncate">
                {title ?? agentTitle(officeState, id)}
              </span>
              {status.since !== undefined && (
                <span className="text-2xs text-text-muted ml-auto shrink-0">
                  {timeAgo(status.since, now)}
                </span>
              )}
            </span>
            <span className="text-2xs text-text-muted truncate w-full">
              {status.tone === 'permission' || status.tone === 'input' ? status.text : ''}
              {alerts.map((b) => (
                <span key={b.key} style={{ color: BADGE_COLOR[b.tone] }}>
                  {' '}
                  · {b.text}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
