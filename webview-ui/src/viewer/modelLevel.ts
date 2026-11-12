/**
 * pixel-agents-secure (local): an agent's level, from the model its session
 * runs on and the effort it reasons with (server/src/sessionSignals.ts), and
 * the gear the office dresses its character in (characters/modelGear.ts).
 * Opt-in: Opções → Novidades → "Nível por modelo". Pure.
 */

/** The model families the office tells apart: Claude's, weakest first, then Codex's
 *  (classes of their own, so a Codex agent is told from a Claude one at a glance).
 *  The order is kept: a gear number is a tier's place here (modelGear). */
export const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'fable', 'codexmini', 'codex'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** A tier's level before the effort's bonus. */
const BASE_LEVEL: Record<ModelTier, number> = {
  haiku: 20,
  sonnet: 40,
  opus: 60,
  fable: 90,
  codexmini: 30,
  codex: 70,
};
/** A Codex model id: OpenAI's families and Codex's own ("gpt-6.1-sol", "codex-auto-review"). */
const CODEX_MODEL = /^(gpt|codex|o\d)/;
/** Its small ones, and the one that reviews approvals by itself. */
const CODEX_SMALL = /mini|nano|review/;
/** What each effort adds; one the office does not know adds nothing. */
const EFFORT_BONUS: ReadonlyMap<string, number> = new Map([
  ['low', 0],
  ['medium', 3],
  ['high', 6],
  ['xhigh', 10],
  ['max', 10],
]);
const TOP_BONUS = 10;
const HIGH_BONUS = 6;

/** The family in a model id ("claude-opus-5-5" → opus), if it is one of ours. */
export function modelTier(model: string | undefined): ModelTier | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  // Mythos is the same model as Fable.
  if (id.includes('fable') || id.includes('mythos')) return 'fable';
  if (CODEX_MODEL.test(id)) return CODEX_SMALL.test(id) ? 'codexmini' : 'codex';
  return MODEL_TIERS.find((tier) => id.includes(tier));
}

const bonusOf = (effort: string | undefined): number =>
  (effort !== undefined && EFFORT_BONUS.get(effort)) || 0;

/** The level (20-100), or undefined for a model the office does not know. */
// Codex's levels are the office's own guess: 70 for its main models, 30 for the small ones.
export function modelLevel(model: string | undefined, effort?: string): number | undefined {
  const tier = modelTier(model);
  return tier ? BASE_LEVEL[tier] + bonusOf(effort) : undefined;
}

/** What the effort adds to a class's gear: nothing, a head piece (high), and a cape too (top). */
export type GearAdditions = 0 | 1 | 2;
const additionsOf = (effort: string | undefined): GearAdditions => {
  const bonus = bonusOf(effort);
  return bonus >= TOP_BONUS ? 2 : bonus >= HIGH_BONUS ? 1 : 0;
};

/**
 * The gear a character wears, as one number (it keys the sprite cache): 0 for
 * none, else the tier (1-4) times three, plus the effort's additions.
 */
export function modelGear(model: string | undefined, effort?: string): number {
  const tier = modelTier(model);
  if (!tier) return 0;
  return (MODEL_TIERS.indexOf(tier) + 1) * 3 + additionsOf(effort);
}

/** A gear number back into its tier and the effort's additions. */
export function gearParts(gear: number): { tier: ModelTier; additions: GearAdditions } | undefined {
  if (!Number.isInteger(gear) || gear <= 0) return undefined;
  const tier = MODEL_TIERS[Math.floor(gear / 3) - 1];
  return tier ? { tier, additions: (gear % 3) as GearAdditions } : undefined;
}

/** "Lv. 100 · fable-5-2 · xhigh" for a card, or undefined when there is no level. */
export function levelText(model: string | undefined, effort?: string): string | undefined {
  const level = modelLevel(model, effort);
  if (level === undefined || !model) return undefined;
  const name = model.replace(/^claude-/i, '');
  return `Lv. ${level} · ${name}${effort ? ` · ${effort}` : ''}`;
}

type ModelAndEffort = { model?: string; effort?: string };

/**
 * Put each character in its agent's gear, or take all gear off when the option
 * is off. A sub-agent wears the gear of its own model (`own`, by character id:
 * a smaller model opened by a larger one is its own class), and its lead's
 * until its own model is known.
 */
export function dressCharacters(
  characters: Iterable<{ id: number; parentAgentId: number | null; gear: number }>,
  signals: ReadonlyMap<number, ModelAndEffort>,
  on: boolean,
  own: ReadonlyMap<number, ModelAndEffort> = new Map(),
): void {
  for (const ch of characters) {
    const mine = own.get(ch.id);
    const s = !on ? undefined : mine?.model ? mine : signals.get(ch.parentAgentId ?? ch.id);
    ch.gear = modelGear(s?.model, s?.effort);
  }
}
