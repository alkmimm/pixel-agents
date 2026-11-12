/**
 * pixel-agents-secure (local): the gear a character wears for the model its
 * agent runs on (viewer/modelLevel.ts): a sword on the back for Haiku, plus
 * leather armour for Sonnet, steel armour, helm and shield for Opus, the same
 * in gold with a plume for Fable, and a star over the head at the top effort.
 *
 * Like a repeat's clothes (repeatClothes.ts), it is a copy of the profile made
 * for drawing: the saved cast is never changed, and the character keeps its
 * body, face, hair and clothes. The gear is one sheet per tier
 * (art/gear/, drawn by scripts/gear-art.py), laid over the finished character.
 */

import type { CharacterProfile } from '../../../core/src/characterProfiles.js';
import { gearParts } from '../viewer/modelLevel.js';
import type { RenderProfile } from './slots.js';
import { GEAR_ART } from './wardrobe.js';

/** The profile in its gear (gear 0 or unknown = unchanged). */
export function withModelGear(p: CharacterProfile, gear: number): RenderProfile {
  return gearParts(gear) ? { ...p, gear } : p;
}

/** The art sheets a gear lays over the character, bottom first. */
export function gearArt(gear: number | undefined): string[] {
  const parts = gear ? gearParts(gear) : undefined;
  if (!parts) return [];
  return parts.top ? [GEAR_ART[parts.tier], GEAR_ART.star] : [GEAR_ART[parts.tier]];
}
