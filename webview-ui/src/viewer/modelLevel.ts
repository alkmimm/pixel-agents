/**
 * pixel-agents-secure (local): an agent's level, from the model its session
 * runs on and the effort it reasons with (server/src/sessionSignals.ts), and
 * the gear the office dresses its character in (characters/modelGear.ts).
 * Opt-in: Opções → Novidades → "Nível por modelo". Pure.
 */

/** The model families the office tells apart, weakest first. */
export const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/** A tier's level before the effort's bonus. */
const BASE_LEVEL: Record<ModelTier, number> = { haiku: 20, sonnet: 40, opus: 60, fable: 90 };
/** What each effort adds; one the office does not know adds nothing. */
const EFFORT_BONUS: Record<string, number> = { low: 0, medium: 3, high: 6, xhigh: 10, max: 10 };
const TOP_BONUS = 10;

/** The family in a model id ("claude-opus-5-5" → opus), if it is one of ours. */
export function modelTier(model: string | undefined): ModelTier | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  // Mythos is the same model as Fable.
  if (id.includes('fable') || id.includes('mythos')) return 'fable';
  return MODEL_TIERS.find((tier) => id.includes(tier));
}

const bonusOf = (effort: string | undefined): number => (effort && EFFORT_BONUS[effort]) || 0;

/** The level (20-100), or undefined for a model the office does not know. */
export function modelLevel(model: string | undefined, effort?: string): number | undefined {
  const tier = modelTier(model);
  return tier ? BASE_LEVEL[tier] + bonusOf(effort) : undefined;
}

/**
 * The gear a character wears, as one number (it keys the sprite cache): 0 for
 * none, else the tier (1-4) doubled, plus one at the top effort.
 */
export function modelGear(model: string | undefined, effort?: string): number {
  const tier = modelTier(model);
  if (!tier) return 0;
  return (MODEL_TIERS.indexOf(tier) + 1) * 2 + (bonusOf(effort) >= TOP_BONUS ? 1 : 0);
}

/** A gear number back into its tier and whether it is the top effort's. */
export function gearParts(gear: number): { tier: ModelTier; top: boolean } | undefined {
  const tier = MODEL_TIERS[(gear >> 1) - 1];
  return gear > 0 && tier ? { tier, top: (gear & 1) === 1 } : undefined;
}

/** "Lv. 100 · fable-5-2 · xhigh" for a card, or undefined when there is no level. */
export function levelText(model: string | undefined, effort?: string): string | undefined {
  const level = modelLevel(model, effort);
  if (level === undefined || !model) return undefined;
  const name = model.replace(/^claude-/i, '');
  return `Lv. ${level} · ${name}${effort ? ` · ${effort}` : ''}`;
}

/**
 * Put each character in its agent's gear (a sub-agent wears its lead's), or
 * take all gear off when the option is off.
 */
export function dressCharacters(
  characters: Iterable<{ id: number; parentAgentId: number | null; gear: number }>,
  signals: ReadonlyMap<number, { model?: string; effort?: string }>,
  on: boolean,
): void {
  for (const ch of characters) {
    const s = on ? signals.get(ch.parentAgentId ?? ch.id) : undefined;
    ch.gear = modelGear(s?.model, s?.effort);
  }
}
