import { describe, expect, it } from 'vitest';

import {
  type AgentSignals,
  idleText,
  NO_FEATURES,
  sessionTitle,
  signalBadges,
  STALLED_AFTER_MS,
  type ViewerFeatures,
} from '../src/viewer/signalText.js';

const ALL: ViewerFeatures = {
  sessionTitle: true,
  idleTime: true,
  signals: true,
  permissionMode: true,
  inbox: true,
  modelLevel: true,
};
const quiet: AgentSignals = { errorStreak: 0, rateLimited: false, repeats: 0 };
const NOW = 1_800_000_000_000;

describe('viewer signal texts', () => {
  it('nothing is shown while the options are off', () => {
    const loud: AgentSignals = {
      ...quiet,
      title: 'Deploy',
      permissionMode: 'bypassPermissions',
      errorStreak: 4,
      rateLimited: true,
      repeats: 5,
    };
    expect(sessionTitle(loud, NO_FEATURES)).toBeUndefined();
    expect(signalBadges(loud, { tone: 'active' }, { t: 0 }, NO_FEATURES, NOW)).toEqual([]);
    expect(idleText({ tone: 'idle' }, { t: 0 }, NO_FEATURES, NOW)).toBeUndefined();
  });

  it('the /rename title wins over the generated one', () => {
    expect(sessionTitle({ ...quiet, title: 'Mine', aiTitle: 'Generated' }, ALL)).toBe('Mine');
    expect(sessionTitle({ ...quiet, aiTitle: 'Generated' }, ALL)).toBe('Generated');
    expect(sessionTitle(quiet, ALL)).toBeUndefined();
  });

  it('flags limits, error streaks, loops, stalls and risky modes', () => {
    const s: AgentSignals = {
      ...quiet,
      rateLimited: true,
      quotaUntil: NOW + 3_600_000,
      errorStreak: 3,
      repeats: 4,
      permissionMode: 'bypassPermissions',
    };
    const badges = signalBadges(s, { tone: 'active' }, { t: NOW - STALLED_AFTER_MS - 60_000 }, ALL, NOW);
    expect(badges.map((b) => b.key)).toEqual(['quota', 'errors', 'loop', 'stalled', 'mode']);
    expect(badges.find((b) => b.key === 'mode')?.tone).toBe('alert');
    expect(badges[0].text).toMatch(/^Sem cota até \d\d:\d\d$/);
    // A safe mode is information, not an alert; no stall when not working.
    const calm = signalBadges({ ...quiet, permissionMode: 'acceptEdits' }, { tone: 'idle' }, { t: 0 }, ALL, NOW);
    expect(calm).toEqual([{ key: 'mode', tone: 'info', text: 'Modo: aceita edições' }]);
  });

  it('idle time only for an agent with nothing running', () => {
    expect(idleText({ tone: 'idle' }, { t: NOW - 12 * 60_000 }, ALL, NOW)).toBe('parado há 12 min');
    expect(idleText({ tone: 'done' }, { t: NOW - 135 * 60_000 }, ALL, NOW)).toBe('parado há 2 h 15 min');
    expect(idleText({ tone: 'active' }, { t: 0 }, ALL, NOW)).toBeUndefined();
    expect(idleText({ tone: 'idle' }, { t: NOW - 30_000 }, ALL, NOW)).toBeUndefined();
  });
});
