/**
 * pixel-agents-secure (local): "Agentes" — every agent in the office as a
 * list beside it: who waits on you first, then one group per project, each
 * with its state, what it is doing and for how long. Clicking a row centers
 * the office on that character and opens its details. Observation only:
 * nothing here is sent to the server.
 *
 * Opened from the viewer's bar ("Agentes"); it takes the place of the
 * "Precisa de você" box while open (its first section is that box).
 */
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { timeAgo, useAgentActivity, useNow } from './agentActivity.js';
import { groupAgents } from './agentGroups.js';
import {
  BADGE_COLOR,
  sessionTitle,
  signalBadges,
  useAllSignals,
  type ViewerFeatures,
} from './agentSignals.js';
import { agentStatusView, agentTitle, TONE_COLOR } from './agentStatus.js';
import { modelLevel } from './modelLevel.js';

interface Props {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  features: ViewerFeatures;
  /** The agent whose details are open, highlighted in the list. */
  openAgentId: number | null;
  /** What to write for a project (its name, or an alias: viewer/roomNames.ts). */
  projectName: (project: string) => string;
  onOpen: (id: number) => void;
  onClose: () => void;
}

export function AgentsPanel({
  officeState,
  agents,
  agentTools,
  features,
  openAgentId,
  projectName,
  onOpen,
  onClose,
}: Props) {
  const now = useNow(5_000);
  const signals = useAllSignals();
  // Subscribes to the history, so a state change re-renders the list.
  useAgentActivity(null);

  const rows = agents.map((id) => {
    const status = agentStatusView(officeState, id, agentTools);
    const s = signals.get(id);
    return {
      id,
      tone: status.tone,
      since: status.since,
      project: officeState.characters.get(id)?.directoryName,
      status,
      title: sessionTitle(s, features) ?? agentTitle(officeState, id),
      level: features.modelLevel ? modelLevel(s?.model, s?.effort) : undefined,
      alerts: signalBadges(s, status, undefined, features, now).filter(
        (b) => b.tone === 'alert' && b.key !== 'mode',
      ),
    };
  });
  const { waiting, projects } = groupAgents(rows, now);

  const renderRow = (row: (typeof rows)[number]) => (
    <button
      key={row.id}
      type="button"
      className={`flex flex-col items-start text-left border-0 p-2 cursor-pointer hover:bg-btn-hover ${
        row.id === openAgentId ? 'bg-btn-hover' : 'bg-transparent'
      }`}
      onClick={() => onOpen(row.id)}
      title="Centralizar e ver detalhes"
      data-testid="agents-panel-row"
      data-agent-id={row.id}
    >
      <span className="flex items-center gap-6 w-full">
        <span
          className="w-6 h-6 rounded-full shrink-0"
          style={{ background: TONE_COLOR[row.tone] }}
        />
        <span className="text-2xs text-text truncate">{row.title}</span>
        {row.level !== undefined && (
          <span className="text-2xs text-text-muted shrink-0" title="Nível pelo modelo e esforço">
            Lv. {row.level}
          </span>
        )}
        {row.since !== undefined && (
          <span className="text-2xs text-text-muted ml-auto shrink-0">
            {timeAgo(row.since, now)}
          </span>
        )}
      </span>
      <span className="text-2xs text-text-muted truncate w-full">
        {row.status.tool ?? row.status.text}
        {row.alerts.map((b) => (
          <span key={b.key} style={{ color: BADGE_COLOR[b.tone] }}>
            {' '}
            · {b.text}
          </span>
        ))}
      </span>
    </button>
  );

  return (
    <div
      // Right of the zoom buttons (top-left column), down to above the bar.
      // Under the bar's options (z 20), which open over its lower part.
      className="absolute pixel-panel flex flex-col gap-2 px-8 py-6 overflow-y-auto pointer-events-auto"
      style={{
        left: 64,
        top: 8,
        // Never wider or taller than the window leaves room for.
        width: 'min(280px, calc(100% - 72px))',
        maxHeight: 'calc(100% - 72px)',
        zIndex: 15,
      }}
      data-testid="agents-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <span className="flex items-center text-xs text-text">
        Agentes ({agents.length})
        <button
          type="button"
          className="ml-auto bg-transparent border-0 text-text-muted cursor-pointer hover:text-text"
          onClick={onClose}
          title="Fechar a lista"
        >
          ×
        </button>
      </span>
      {agents.length === 0 && <span className="text-2xs text-text-muted">Ninguém no escritório.</span>}
      {waiting.length > 0 && (
        <>
          <span className="text-2xs mt-4" style={{ color: TONE_COLOR.permission }}>
            Precisa de você ({waiting.length})
          </span>
          {waiting.map(renderRow)}
        </>
      )}
      {projects.map(({ project, rows: list }) => (
        <div key={project ?? ''} className="flex flex-col gap-2">
          <span className="text-2xs text-text-muted mt-4 truncate">
            {project === null ? 'Sem projeto' : projectName(project)} ({list.length})
          </span>
          {list.map(renderRow)}
        </div>
      ))}
    </div>
  );
}
