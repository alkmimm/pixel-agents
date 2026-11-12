/**
 * pixel-agents-secure (local): the read-only office's own controls.
 *
 * A read-only office has no toolbar: every setting would be refused by the
 * server. These are the controls that change nothing but what THIS browser
 * shows: fit the office to the window, float it (picture-in-picture) and a few
 * display preferences. The preferences live in this browser's localStorage and
 * are never sent to the server.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';

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
  // What each of "Vida no escritório" and "Nível por modelo" includes: on by
  // default, and only in effect while its option is on (SUB_OPTIONS).
  lifeCoffee: boolean;
  lifeSleep: boolean;
  lifeParty: boolean;
  lifeChat: boolean;
  lifeGreet: boolean;
  lifeHelpers: boolean;
  lifePet: boolean;
  lifeRobot: boolean;
  lifeGame: boolean;
  lifeRoam: boolean;
  gearLevelText: boolean;
  gearPortrait: boolean;
  gearFx: boolean;
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
  lifeCoffee: true,
  lifeSleep: true,
  lifeParty: true,
  lifeChat: true,
  lifeGreet: true,
  lifeHelpers: true,
  lifePet: true,
  lifeRobot: true,
  lifeGame: true,
  lifeRoam: true,
  gearLevelText: true,
  gearPortrait: true,
  gearFx: true,
  // Novidades: off until this browser turns them on.
  sessionTitle: false,
  idleTime: false,
  signals: false,
  permissionMode: false,
  inbox: false,
  modelLevel: false,
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
    key: 'modelLevel',
    label: 'Nível por modelo',
    title:
      'Cada personagem ganha a classe do modelo da sessão (Haiku: escudeiro; Sonnet: arqueiro; Opus: cavaleiro; Fable: mago), um enfeite na cabeça no esforço alto e também uma capa no máximo. Quem está trabalhando mostra de vez em quando o efeito da classe. O nível aparece no cartão e na lista',
  },
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
      'Pausa para o café, cochilo de quem está parado há 20 min, comemoração depois de um turno longo, conversa de corredor, cumprimento de quem se cruza andando, subagentes que conversam e olham em volta, e o bicho visitando quem espera você',
  },
];

type SubOption = { key: ViewerToggle; label: string; title: string };
/** What an option includes, each part with its own switch, shown under it while it is on. */
export const SUB_OPTIONS: Partial<Record<ViewerToggle, SubOption[]>> = {
  modelLevel: [
    { key: 'gearLevelText', label: 'Nível no cartão e na lista', title: 'O "Lv." com o modelo e o esforço' },
    { key: 'gearPortrait', label: 'Equipamento nos retratos', title: 'O cartão do agente e o painel de detalhes' },
    { key: 'gearFx', label: 'Efeitos de classe', title: 'Faíscas, reflexo e flecha, de vez em quando, em quem está trabalhando' },
  ],
  life: [
    {
      key: 'lifeCoffee',
      label: 'Pausa para o café',
      title:
        'Quem está parado vai tomar um café de vez em quando. Com a máquina de café no escritório: enche a xícara nela, senta num sofá da mesa de centro e, ao levantar, deixa a xícara na mesa',
    },
    { key: 'lifeSleep', label: 'Cochilo', title: 'Quem está parado há 20 min dorme na cadeira' },
    { key: 'lifeParty', label: 'Comemoração', title: 'Depois de um turno de 5 min ou mais' },
    { key: 'lifeChat', label: 'Conversa de corredor', title: 'Dois agentes parados perto um do outro' },
    { key: 'lifeGreet', label: 'Cumprimento ao cruzar', title: 'Dois agentes que passam um pelo outro andando' },
    { key: 'lifeHelpers', label: 'Subagentes inquietos', title: 'Pulam ao terminar, conversam com o vizinho e olham em volta' },
    { key: 'lifePet', label: 'Bicho visita quem espera', title: 'Vai até quem espera você há mais tempo' },
    {
      key: 'lifeRobot',
      label: 'Robô da limpeza',
      title:
        'Fica ao lado da lixeira e faz uma ronda a cada 5 min, ou assim que a mesa junta 4 xícaras: passa na mesa, estica os braços, recolhe as xícaras uma a uma e volta',
    },
    {
      key: 'lifeGame',
      label: 'Videogame nos pufes',
      title: 'Quem está parado às vezes senta num pufe e joga um pouco (precisa do videogame e de um pufe por perto)',
    },
    {
      key: 'lifeRoam',
      label: 'Ociosos circulam mais',
      title: 'Quem está parado descansa menos tempo na cadeira, anda mais e sai mais da própria sala',
    },
  ],
};
const SUB_KEYS = Object.values(SUB_OPTIONS).flatMap((subs) => subs.map((s) => s.key));

/** Whether a part of an option is in effect: its own switch, and its option's. */
export function partOn(prefs: ViewerPrefs, option: ViewerToggle, part: ViewerToggle): boolean {
  return prefs[option] && prefs[part];
}

/** The agents whose hooks the panel can install (server: providers/hook/others/).
 *  One shows only when the server says the agent is on this machine. */
const OTHER_AGENTS: Array<{ id: string; label: string; writes: string; undo: string }> = [
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    writes:
      'Grava um arquivo, ~/.copilot/hooks/pixel-agents.json, e nada mais do Copilot. Ele passa a rodar o hook do Pixel Agents no início e fim de sessão, no uso de ferramenta e no fim do turno.',
    undo: 'Desligar apaga o arquivo.',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    writes:
      'Acrescenta entradas de hook em ~/.gemini/settings.json (antes, guarda uma cópia do arquivo ao lado) e não muda mais nada nele. O Gemini passa a rodar o hook do Pixel Agents no início e fim de sessão, no uso de ferramenta, no fim do turno e no pedido de aprovação.',
    undo: 'Desligar remove exatamente essas entradas.',
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
    for (const key of [...OPTIONS, ...FEATURE_OPTIONS]
      .map((o) => o.key)
      .concat(HIDDEN_TOGGLES, SUB_KEYS)) {
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
  agentHooks,
  onAgentHooks,
}: {
  prefs: ViewerPrefs;
  onToggle: (key: ViewerToggle) => void;
  onLabelMode: (mode: LabelMode) => void;
  onRoomNames: (mode: RoomNameMode) => void;
  /** Inside the VS Code panel: over its toolbar, and only with what the
   *  panel's own Settings do not already have (and without the project rooms,
   *  which redraw the layout the panel edits and saves). */
  embedded?: boolean;
  /** Whether each other agent found on this machine has its hooks in
   *  (`hooksStatus` by provider id). Only the VS Code panel can change it. */
  agentHooks?: Record<string, boolean>;
  onAgentHooks?: (agent: string, enabled: boolean) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** The agent whose terms are on screen, waiting for "Instalar". */
  const [asking, setAsking] = useState<string | null>(null);
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
            <Fragment key={key}>
              <span title={title}>
                <Checkbox label={label} checked={prefs[key]} onChange={() => onToggle(key)} />
              </span>
              {prefs[key] &&
                SUB_OPTIONS[key]?.map((sub) => (
                  <span
                    key={sub.key}
                    title={sub.title}
                    className="pl-12"
                    data-testid={`viewer-sub-option-${sub.key}`}
                  >
                    <Checkbox
                      label={sub.label}
                      checked={prefs[sub.key]}
                      onChange={() => onToggle(sub.key)}
                    />
                  </span>
                ))}
            </Fragment>
          ))}
        <span className="text-2xs text-text-muted mt-4">Outros agentes</span>
          <span
            className="text-2xs text-text-muted"
            title="O Cursor executa por conta própria os hooks do Claude Code (Third-Party Imports, ligado por padrão no Cursor). Não há o que ligar aqui."
          >
            Cursor: aparece sozinho, com o nome “Cursor”.
          </span>
          {onAgentHooks &&
            OTHER_AGENTS.filter(({ id }) => agentHooks?.[id] !== undefined).map(
              ({ id, label, writes, undo }) => (
                <div key={id} className="flex flex-col gap-4" data-testid={`agent-hooks-${id}`}>
                  <span title={`${writes} ${undo}`}>
                    <Checkbox
                      label={label}
                      checked={agentHooks?.[id] === true}
                      onChange={() => {
                        // Turning on shows what will be written first; off is immediate.
                        if (agentHooks?.[id] === true) onAgentHooks(id, false);
                        else setAsking((current) => (current === id ? null : id));
                      }}
                    />
                  </span>
                  {asking === id && agentHooks?.[id] !== true && (
                    <div className="flex flex-col gap-4 text-2xs text-text-muted" style={{ maxWidth: 260 }}>
                      <span>{writes}</span>
                      <span>
                        Do hook só saem id da sessão, pasta, nome da ferramenta, nome do arquivo e o
                        programa de um comando; nunca prompts, respostas ou saída de ferramenta.
                      </span>
                      <span>{undo}</span>
                      <div className="flex gap-4">
                        <Button
                          size="sm"
                          onClick={() => {
                            setAsking(null);
                            onAgentHooks(id, true);
                          }}
                        >
                          Instalar
                        </Button>
                        <Button size="sm" onClick={() => setAsking(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ),
            )}
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
