/**
 * pixel-agents-secure (local): the read-only office's own controls.
 *
 * A read-only office has no toolbar: every setting would be refused by the
 * server. These are the controls that change nothing but what THIS browser
 * shows: fit the office to the window, float it (picture-in-picture) and a few
 * display preferences. The preferences live in this browser's localStorage and
 * are never sent to the server.
 */
import { useCallback, useEffect, useState } from 'react';

import { Button } from './components/ui/Button.js';
import { Checkbox } from './components/ui/Checkbox.js';
import { canPictureInPicture, fitOffice, openPictureInPicture } from './pictureInPicture.js';
import type { ViewerFeatures } from './viewer/agentSignals.js';
import { LABEL_MODES, type LabelMode, parseLabelMode } from './viewer/labelMode.js';
import { parseRoomNameMode, ROOM_NAME_MODES, type RoomNameMode } from './viewer/roomNames.js';

export interface ViewerPrefs extends ViewerFeatures {
  /** When the name and activity above a character show (viewer/labelMode.ts). */
  labelMode: LabelMode;
  /** What is written for a project's room: name, alias or nothing (viewer/roomNames.ts). */
  roomNames: RoomNameMode;
  /** Bubbles and labels over the characters at all. */
  overlay: boolean;
  areas: boolean;
  ghosts: boolean;
  music: boolean;
  /** The notification sound when an agent finishes or asks for approval. */
  sound: boolean;
  /** The agents list beside the office (viewer/AgentsPanel.tsx). */
  agentsPanel: boolean;
  /** One room per project, opened and closed by who is in (viewer/projectRooms.ts). */
  rooms: boolean;
  /** With rooms: a small lounge and a corridor instead of the server's office. */
  compactOffice: boolean;
  /** Coffee breaks, naps and the like (viewer/officeLife.ts). */
  life: boolean;
}

/** The on/off preferences (everything but the label mode). */
export type ViewerToggle = Exclude<keyof ViewerPrefs, 'labelMode' | 'roomNames'>;

const DEFAULT_PREFS: ViewerPrefs = {
  labelMode: 'hover',
  roomNames: 'name',
  overlay: true,
  areas: false,
  ghosts: false,
  music: true,
  sound: true,
  agentsPanel: false,
  rooms: false,
  compactOffice: true,
  life: false,
  // Novidades: off until this browser turns them on.
  sessionTitle: false,
  idleTime: false,
  signals: false,
  permissionMode: false,
  inbox: false,
};
const STORAGE_KEY = 'pixel-agents-secure.viewer-prefs';

const OPTIONS: Array<{ key: ViewerToggle; label: string }> = [
  { key: 'overlay', label: 'Balões e rótulos' },
  { key: 'areas', label: 'Áreas' },
  { key: 'ghosts', label: 'Fantasmas (headless)' },
  { key: 'music', label: 'Player de música' },
  { key: 'sound', label: 'Som de aviso' },
];

/** pixel-agents-secure (local): opt-in features (agentSignals.ts). */
const FEATURE_OPTIONS: Array<{ key: ViewerToggle; label: string; title: string }> = [
  {
    key: 'sessionTitle',
    label: 'Título da sessão',
    title: 'O nome dado com /rename (o título automático só com a aba Conversa ligada)',
  },
  { key: 'idleTime', label: 'Tempo parado', title: 'Há quanto tempo cada agente está sem atividade' },
  {
    key: 'signals',
    label: 'Sinais de problema',
    title: 'Erros seguidos, a mesma chamada repetida, sem novidade há 10 min, sem cota',
  },
  { key: 'permissionMode', label: 'Modo de permissão', title: 'Destaca sessões em bypass ou dontAsk' },
  { key: 'inbox', label: 'Caixa “Precisa de você”', title: 'Lista quem espera você; clique centraliza' },
  {
    key: 'rooms',
    label: 'Salas por projeto',
    title:
      'Cada projeto (com seus worktrees) ganha uma sala, que abre com o primeiro agente e fecha 10 min depois do último sair',
  },
  {
    key: 'compactOffice',
    label: 'Área comum compacta',
    title:
      'Com as salas ligadas: um lounge pequeno e um corredor com salas dos dois lados, no lugar do escritório do servidor (que fica com as mesas vazias). Cabe melhor numa janela pequena',
  },
  {
    key: 'life',
    label: 'Vida no escritório',
    title:
      'Pausa para o café, cochilo de quem está parado há 20 min, comemoração depois de um turno longo, conversa de corredor e o bicho visitando quem espera você',
  },
];

/** Not offered inside the VS Code panel (see `embedded`). */
const VIEWER_ONLY: ViewerToggle[] = ['rooms', 'compactOffice'];
/** Where the bar sits inside the VS Code panel: over the panel's toolbar. */
// (Seen on screen at 66: the bar's lower edge sat under the toolbar's top.)
const EMBEDDED_BOTTOM_PX = 78;

/** Saved like the others, but switched by a button of the bar, not a checkbox. */
const HIDDEN_TOGGLES: ViewerToggle[] = ['agentsPanel'];

function loadPrefs(): ViewerPrefs {
  const prefs = { ...DEFAULT_PREFS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const key of [...OPTIONS, ...FEATURE_OPTIONS].map((o) => o.key).concat(HIDDEN_TOGGLES)) {
      if (typeof saved[key] === 'boolean') prefs[key] = saved[key];
    }
    // "labels" was the old "always visible" checkbox.
    prefs.labelMode = parseLabelMode(saved.labelMode, saved.labels);
    prefs.roomNames = parseRoomNameMode(saved.roomNames);
  } catch {
    // No storage, or not ours: the defaults.
  }
  return prefs;
}

export function useViewerPrefs(): [
  ViewerPrefs,
  (key: ViewerToggle) => void,
  (mode: LabelMode) => void,
  (mode: RoomNameMode) => void,
] {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Private window or storage disabled: the choice lasts for this visit.
    }
  }, [prefs]);
  const toggle = useCallback((key: ViewerToggle) => {
    setPrefs((current) => ({ ...current, [key]: !current[key] }));
  }, []);
  const setLabelMode = useCallback((labelMode: LabelMode) => {
    setPrefs((current) => ({ ...current, labelMode }));
  }, []);
  const setRoomNames = useCallback((roomNames: RoomNameMode) => {
    setPrefs((current) => ({ ...current, roomNames }));
  }, []);
  return [prefs, toggle, setLabelMode, setRoomNames];
}

export function ViewerBar({
  prefs,
  onToggle,
  onLabelMode,
  onRoomNames,
  embedded = false,
}: {
  prefs: ViewerPrefs;
  onToggle: (key: ViewerToggle) => void;
  onLabelMode: (mode: LabelMode) => void;
  onRoomNames: (mode: RoomNameMode) => void;
  /** Inside the VS Code panel: over its toolbar, and only with what the
   *  panel's own Settings do not already have (and without the project rooms,
   *  which redraw the layout the panel edits and saves). */
  embedded?: boolean;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [floating, setFloating] = useState(false);

  const float = useCallback(() => {
    setFloating(true);
    void openPictureInPicture(() => setFloating(false)).catch((err: unknown) => {
      setFloating(false);
      console.error('[Pixel Agents] picture-in-picture failed:', err);
    });
  }, []);

  return (
    // As tall as the window allows and no taller: in a short window the options
    // scroll inside their panel instead of running off the top, and in a
    // narrow one the buttons wrap. The box itself lets clicks through.
    <div
      // Over the agents list and the "Precisa de você" box (z 15), which sit
      // where the options open.
      className="absolute left-10 top-10 bottom-10 z-20 flex flex-col items-start justify-end gap-4 pointer-events-none"
      style={{ maxWidth: 'calc(100% - 20px)', ...(embedded ? { bottom: EMBEDDED_BOTTOM_PX } : {}) }}
    >
      {optionsOpen && (
        <div
          className="pixel-panel p-8 flex flex-col gap-4 min-h-0 max-w-full overflow-y-auto pointer-events-auto"
          data-testid="viewer-options"
          onWheel={(e) => e.stopPropagation()}
        >
          {(embedded ? [] : OPTIONS).map(({ key, label }) => (
            <Checkbox
              key={key}
              label={label}
              checked={prefs[key]}
              onChange={() => onToggle(key)}
            />
          ))}
          <span className="text-2xs text-text-muted mt-4">Rótulos aparecem</span>
          <div className="flex flex-wrap gap-4 shrink-0" data-testid="viewer-label-mode">
            {LABEL_MODES.filter(({ mode }) => !embedded || mode !== 'always').map(({ mode, label, title }) => (
              <Button
                key={mode}
                size="sm"
                variant={prefs.labelMode === mode ? 'active' : 'default'}
                title={title}
                onClick={() => onLabelMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
          {!embedded && (
            <>
              <span className="text-2xs text-text-muted mt-4">Nome das salas</span>
              <div className="flex flex-wrap gap-4 shrink-0" data-testid="viewer-room-names">
                {ROOM_NAME_MODES.map(({ mode, label, title }) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={prefs.roomNames === mode ? 'active' : 'default'}
                    title={title}
                    onClick={() => onRoomNames(mode)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </>
          )}
          <span className="text-2xs text-text-muted mt-4">Novidades</span>
          {FEATURE_OPTIONS.filter(({ key }) => !embedded || !VIEWER_ONLY.includes(key)).map(({ key, label, title }) => (
            <span key={key} title={title}>
              <Checkbox label={label} checked={prefs[key]} onChange={() => onToggle(key)} />
            </span>
          ))}
        <span className="text-2xs text-text-muted mt-4">Outros agentes</span>
          <span
            className="text-2xs text-text-muted"
            title="O Cursor executa por conta própria os hooks do Claude Code (Third-Party Imports, ligado por padrão no Cursor). Não há o que ligar aqui."
          >
            Cursor: aparece sozinho, com o nome “Cursor”.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-4 shrink-0 pointer-events-auto">
        <Button
          size="sm"
          variant={prefs.agentsPanel ? 'active' : 'default'}
          className="border-border! shadow-pixel"
          title="Lista de todos os agentes; clicar leva até o boneco"
          onClick={() => onToggle('agentsPanel')}
        >
          Agentes
        </Button>
        <Button
          size="sm"
          className="border-border! shadow-pixel"
          title="Ajustar o zoom e centralizar o escritório inteiro"
          onClick={() => fitOffice()}
        >
          Enquadrar
        </Button>
        {canPictureInPicture() && !floating && (
          <Button
            size="sm"
            className="border-border! shadow-pixel"
            title="Abrir o escritório numa janela flutuante, sempre por cima"
            onClick={float}
          >
            PiP
          </Button>
        )}
        <Button
          size="sm"
          variant={optionsOpen ? 'active' : 'default'}
          className="border-border! shadow-pixel"
          title="Opções de exibição deste navegador"
          onClick={() => setOptionsOpen((open) => !open)}
        >
          Opções
        </Button>
      </div>
    </div>
  );
}
