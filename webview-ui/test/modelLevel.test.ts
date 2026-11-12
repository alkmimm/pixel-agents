import { describe, expect, it } from 'vitest';

import {
  dressCharacters,
  gearParts,
  levelText,
  modelGear,
  modelLevel,
  modelTier,
} from '../src/viewer/modelLevel.js';

describe('model level', () => {
  it('reads the family from the model id', () => {
    expect(modelTier('claude-fable-5-2')).toBe('fable');
    expect(modelTier('claude-mythos-5-2')).toBe('fable');
    expect(modelTier('claude-opus-5-5[1m]')).toBe('opus');
    expect(modelTier('us.anthropic.claude-sonnet-5-5-v1:0')).toBe('sonnet');
    expect(modelTier('claude-haiku-5-5')).toBe('haiku');
    expect(modelTier('llama-9')).toBeUndefined();
    expect(modelTier(undefined)).toBeUndefined();
    // Codex's models are classes of their own; its small ones and its reviewer, the lesser.
    expect(modelTier('gpt-6.1-sol')).toBe('codex');
    expect(modelTier('gpt-6.1-codex-mini')).toBe('codexmini');
    expect(modelTier('codex-auto-review')).toBe('codexmini');
    expect(modelLevel('gpt-6.1-sol', 'xhigh')).toBe(80);
    expect(modelLevel('codex-auto-review', 'low')).toBe(30);
    expect(gearParts(modelGear('gpt-6.1-sol', 'xhigh'))).toEqual({ tier: 'codex', additions: 2 });
    // A Claude gear number is what it was before Codex's classes came.
    expect(modelGear('claude-fable-5-2', 'xhigh')).toBe(14);
  });

  it('is the model base plus the effort bonus', () => {
    expect(modelLevel('claude-fable-5-2', 'xhigh')).toBe(100);
    expect(modelLevel('claude-fable-5-2', 'low')).toBe(90);
    expect(modelLevel('claude-fable-5-2')).toBe(90);
    expect(modelLevel('claude-opus-5-5', 'xhigh')).toBe(70);
    expect(modelLevel('claude-sonnet-5-5', 'max')).toBe(50);
    expect(modelLevel('claude-sonnet-5-5', 'medium')).toBe(43);
    expect(modelLevel('claude-haiku-5-5', 'high')).toBe(26);
    // An effort the office does not know adds nothing; an unknown model has no level.
    expect(modelLevel('claude-opus-5-5', 'constructor')).toBe(60);
    expect(modelLevel('gemini-3', 'xhigh')).toBeUndefined();
  });

  it('gear is one number per tier and effort step, and reads back', () => {
    expect(modelGear(undefined)).toBe(0);
    expect(modelGear('llama-9', 'xhigh')).toBe(0);
    for (const none of [0, 1, 2, -3, 3.5, 15, 99, NaN]) expect(gearParts(none)).toBeUndefined();
    const seen = new Set<number>();
    for (const [model, tier] of [
      ['claude-haiku-5-5', 'haiku'],
      ['claude-sonnet-5-5', 'sonnet'],
      ['claude-opus-5-5', 'opus'],
      ['claude-fable-5-2', 'fable'],
    ] as const) {
      for (const [effort, additions] of [
        [undefined, 0],
        ['low', 0],
        ['medium', 0],
        ['high', 1],
        ['xhigh', 2],
        ['max', 2],
      ] as const) {
        const gear = modelGear(model, effort);
        expect(gearParts(gear)).toEqual({ tier, additions });
        seen.add(gear);
      }
    }
    expect(seen.size).toBe(12);
  });

  it('writes the level for a card', () => {
    expect(levelText('claude-fable-5-2', 'xhigh')).toBe('Lv. 100 · fable-5-2 · xhigh');
    expect(levelText('claude-opus-5-5')).toBe('Lv. 60 · opus-5-5');
    expect(levelText('llama-9', 'high')).toBeUndefined();
    expect(levelText(undefined)).toBeUndefined();
  });

  it('dresses each character by its agent, a sub-agent by its lead, and undresses when off', () => {
    const lead = { id: 1, parentAgentId: null, gear: 0 };
    const helper = { id: -1, parentAgentId: 1, gear: 0 };
    const other = { id: 2, parentAgentId: null, gear: 5 };
    const signals = new Map([[1, { model: 'claude-opus-5-5', effort: 'xhigh' }]]);
    dressCharacters([lead, helper, other], signals, true);
    expect(lead.gear).toBe(modelGear('claude-opus-5-5', 'xhigh'));
    expect(helper.gear).toBe(lead.gear);
    expect(other.gear).toBe(0);
    // A helper whose own model is known wears its own class, at its own effort.
    const own = new Map([[-1, { model: 'claude-sonnet-5-5', effort: 'medium' }]]);
    dressCharacters([lead, helper, other], signals, true, own);
    expect(helper.gear).toBe(modelGear('claude-sonnet-5-5', 'medium'));
    expect(lead.gear).toBe(modelGear('claude-opus-5-5', 'xhigh'));
    // One whose transcript named no model yet keeps its lead's.
    dressCharacters([lead, helper, other], signals, true, new Map([[-1, {}]]));
    expect(helper.gear).toBe(lead.gear);
    dressCharacters([lead, helper, other], signals, false, own);
    expect([lead.gear, helper.gear, other.gear]).toEqual([0, 0, 0]);
    dressCharacters([lead, helper, other], signals, false);
    expect([lead.gear, helper.gear, other.gear]).toEqual([0, 0, 0]);
  });
});
