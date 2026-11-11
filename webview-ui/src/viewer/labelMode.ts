/**
 * pixel-agents-secure (local): when the label over a character shows.
 *
 *   hover   only under the mouse or selected (the upstream default)
 *   smart   also by itself, but only when it matters: the agent is waiting on
 *           you, or its activity has just changed (for LABEL_FLASH_MS)
 *   always  every label, all the time
 *
 * Free of React and the DOM, so it is tested directly.
 */
export type LabelMode = 'hover' | 'smart' | 'always';

export const LABEL_MODES: ReadonlyArray<{ mode: LabelMode; label: string; title: string }> = [
  { mode: 'hover', label: 'Mouse', title: 'Só ao passar o mouse ou selecionar' },
  {
    mode: 'smart',
    label: 'Quando importa',
    title: 'Quem espera você, e por alguns segundos quando a atividade muda',
  },
  { mode: 'always', label: 'Sempre', title: 'Todos os rótulos, o tempo todo' },
];

/** How long a label stays up after its agent's activity changed. */
export const LABEL_FLASH_MS = 4_000;

/** The text of an agent doing nothing: turning idle is not news. */
const IDLE_TEXT = 'Idle';

/** The saved mode; before it existed there was only "always visible" or not. */
export function parseLabelMode(saved: unknown, legacyAlways: unknown): LabelMode {
  if (saved === 'hover' || saved === 'smart' || saved === 'always') return saved;
  return legacyAlways === true ? 'always' : 'hover';
}

/** Remembers each agent's activity text and tells whether it changed just now. */
export class ActivityFlash {
  private readonly seen = new Map<number, { text: string; at: number }>();

  /** Record `text` for agent `id`; true while a change is still fresh. The
   *  first text seen is not a change (a page load would flash everyone). */
  note(id: number, text: string, now: number): boolean {
    const last = this.seen.get(id);
    if (!last) {
      this.seen.set(id, { text, at: -Infinity });
      return false;
    }
    if (last.text !== text) {
      last.text = text;
      last.at = text === IDLE_TEXT ? -Infinity : now;
    }
    return now - last.at < LABEL_FLASH_MS;
  }

  /** Drop the agents that left. */
  keep(ids: Iterable<number>): void {
    const alive = new Set(ids);
    for (const id of this.seen.keys()) if (!alive.has(id)) this.seen.delete(id);
  }
}
