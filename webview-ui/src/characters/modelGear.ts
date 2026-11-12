/**
 * pixel-agents-secure (local): the gear a character wears for the model its
 * agent runs on (viewer/modelLevel.ts). Each model family is a class with its
 * own outline, and the effort adds to it:
 *
 *   haiku   squire: a sword on the back            high: headband   top: + cape
 *   sonnet  archer: hood, tunic, bow and quiver    high: feather    top: + cape
 *   opus    knight: helm, plate, shield and sword  high: plume      top: + cape
 *   fable   mage: pointed hat, robe and staff      high: hat star   top: + cape
 *   codexmini  guardian: teal tunic, round shield  high: headband   top: + cape
 *   codex      ninja: hood, mask, suit, katana     high: forehead plate  top: + cape
 *
 * Like a repeat's clothes (repeatClothes.ts), it is a copy of the profile made
 * for drawing: the saved cast is never changed, and the character keeps its
 * body, face and clothes; its hair shows wherever the headgear leaves it. The
 * gear is one sheet per class and step (art/gear/, drawn by
 * scripts/gear-art.py), laid over the finished character.
 */

import type { CharacterProfile } from '../../../core/src/characterProfiles.js';
import { gearParts } from '../viewer/modelLevel.js';
import type { RenderProfile } from './slots.js';
import { gearHideArt, gearSheetArt } from './wardrobe.js';

/** The profile in its gear (gear 0 or unknown = unchanged). */
export function withModelGear(p: CharacterProfile, gear: number): RenderProfile {
  return gearParts(gear) ? { ...p, gear } : p;
}

/** The pieces of the character a headgear covers (hidden where its `hide` sheet says). */
export const UNDER_HEADGEAR: ReadonlySet<string> = new Set(['hair', 'hat', 'hairshades']);

/** A gear's art: the sheet laid over the character, and where hair and hat are hidden. */
export function gearArt(gear: number | undefined): { sheet: string; hide?: string } | undefined {
  const parts = gear ? gearParts(gear) : undefined;
  if (!parts) return undefined;
  return { sheet: gearSheetArt(parts.tier, parts.additions), hide: gearHideArt(parts.tier) };
}
