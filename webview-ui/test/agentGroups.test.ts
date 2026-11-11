import { describe, expect, it } from 'vitest';

import { groupAgents } from '../src/viewer/agentGroups.js';

const NOW = 1_800_000_000_000;

describe('agents list order', () => {
  it('who waits on you comes first: approval, then the longest waiting', () => {
    const { waiting, projects } = groupAgents(
      [
        { id: 1, tone: 'input', since: NOW - 60_000, project: 'a' },
        { id: 2, tone: 'input', since: NOW - 600_000, project: 'b' },
        { id: 3, tone: 'permission', project: 'a' },
        { id: 4, tone: 'active', project: 'a' },
      ],
      NOW,
    );
    expect(waiting.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(projects).toEqual([{ project: 'a', rows: [{ id: 4, tone: 'active', project: 'a' }] }]);
  });

  it('the rest is grouped by project, working agents first, no project last', () => {
    const { waiting, projects } = groupAgents(
      [
        { id: 1, tone: 'idle', project: 'zeta' },
        { id: 2, tone: 'done' },
        { id: 3, tone: 'active', project: 'zeta' },
        { id: 4, tone: 'done', project: 'alfa' },
      ],
      NOW,
    );
    expect(waiting).toEqual([]);
    expect(projects.map((g) => [g.project, g.rows.map((r) => r.id)])).toEqual([
      ['alfa', [4]],
      ['zeta', [3, 1]],
      [null, [2]],
    ]);
  });
});
