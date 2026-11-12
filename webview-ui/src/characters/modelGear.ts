/**
 * pixel-agents-secure (local): the gear a character wears for the model its
 * agent runs on (viewer/modelLevel.ts). Like a repeat's clothes
 * (repeatClothes.ts), it is a copy of the profile made for drawing: the saved
 * cast is never changed. The character keeps its body, face, hair and whatever
 * the gear does not replace.
 */

import type { CharacterColor, CharacterProfile } from '../../../core/src/characterProfiles.js';
import { gearParts, type ModelTier } from '../viewer/modelLevel.js';
import type { SlotKey } from './slots.js';

type GearSlot = Exclude<SlotKey, 'body'>;
/** A part worn, and its colourway when the part ships gray (wardrobe.json `neutral`). */
type GearPiece = { id: string; palette?: string } | null;

/** Each tier's pieces; null takes a piece off (a jacket over the suit). */
const TIER_GEAR: Record<ModelTier, Partial<Record<GearSlot, GearPiece>>> = {
  fable: { full: { id: 'suit_and_tie' }, jacket: null, shades: { id: 'shades' } },
  opus: { jacket: { id: 'blazer', palette: 'Original' }, watch: { id: 'watch' } },
  sonnet: { jacket: { id: 'vest', palette: 'Original' } },
  haiku: {
    hat: { id: 'badge_cap', palette: 'Original' },
    lanyard: { id: 'lanyard', palette: 'Original' },
  },
};
/** What the top effort adds, on any tier. */
const TOP_GEAR: Partial<Record<GearSlot, GearPiece>> = { necklace: { id: 'necklace_chain' } };

const PLAIN: CharacterColor = { h: 0, s: 0, b: 0, c: 0 };

/**
 * The profile in its gear (gear 0 or unknown = unchanged). Gear comes in its
 * own colours, whatever the character's or its repeat's are: that is what
 * tells the tiers apart.
 */
export function withModelGear(p: CharacterProfile, gear: number): CharacterProfile {
  const parts = gearParts(gear);
  if (!parts) return p;
  const colors: NonNullable<CharacterProfile['colors']> = { ...p.colors };
  const worn: CharacterProfile = { ...p, colors };
  const pieces = { ...TIER_GEAR[parts.tier], ...(parts.top ? TOP_GEAR : {}) };
  for (const [slot, piece] of Object.entries(pieces) as Array<[GearSlot, GearPiece]>) {
    if (piece) {
      worn[slot] = piece.id;
      colors[slot] = piece.palette ? { ...PLAIN, palette: piece.palette } : PLAIN;
    } else {
      delete worn[slot];
    }
  }
  // The suit's tie in its own colour too.
  if (pieces.full) delete colors.tie;
  return worn;
}
