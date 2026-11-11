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

export interface ViewerPrefs extends ViewerFeatures {
  /** When the name and activity above a character show (viewer/labelMode.ts). */
  labelMode: LabelMode;
  /** Bubbles and labels over the characters at all. */
  overlay: boolean;
  areas: boolean;
  ghosts: boolean;
  music: boolean;
  /** The notification sound when an agent finishes or asks for approval. */
  sound: boolean;
  /** The agents list beside the office (viewer/AgentsPanel.tsx). */
  agentsPanel: boolean;
}

/** The on/off preferences (everything but the label mode). */
export type ViewerToggle = Exclude<keyof ViewerPrefs, 'labelMode'>;

const DEFAULT_PREFS: ViewerPrefs = {
  labelMode: 'hover',
  overlay: true,
  areas: false,
  ghosts: false,
  music: true,
  sound: true,
  agentsPanel: false,
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
];

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
  } catch {
    // No storage, or not ours: the defaults.
  }
  return prefs;
}

export function useViewerPrefs(): [
  ViewerPrefs,
  (key: ViewerToggle) => void,
  (mode: LabelMode) => void,
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
  return [prefs, toggle, setLabelMode];
}

export function ViewerBar({
  prefs,
  onToggle,
  onLabelMode,
}: {
  prefs: ViewerPrefs;
  onToggle: (key: ViewerToggle) => void;
  onLabelMode: (mode: LabelMode) => void;
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
    <div className="absolute left-10 bottom-10 z-20 flex flex-col items-start gap-4">
      {optionsOpen && (
        <div className="pixel-panel p-8 flex flex-col gap-4" data-testid="viewer-options">
          {OPTIONS.map(({ key, label }) => (
            <Checkbox
              key={key}
              label={label}
              checked={prefs[key]}
              onChange={() => onToggle(key)}
            />
          ))}
          <span className="text-2xs text-text-muted mt-4">Rótulos aparecem</span>
          <div className="flex gap-4" data-testid="viewer-label-mode">
            {LABEL_MODES.map(({ mode, label, title }) => (
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
          <span className="text-2xs text-text-muted mt-4">Novidades</span>
          {FEATURE_OPTIONS.map(({ key, label, title }) => (
            <span key={key} title={title}>
              <Checkbox label={label} checked={prefs[key]} onChange={() => onToggle(key)} />
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-4">
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
