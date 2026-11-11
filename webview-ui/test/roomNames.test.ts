import { describe, expect, it } from 'vitest';

import { parseRoomNameMode, projectAliases, shownProjectName } from '../src/viewer/roomNames.js';

describe('room names', () => {
  it('reads the saved mode; anything else shows the name', () => {
    expect(parseRoomNameMode('alias')).toBe('alias');
    expect(parseRoomNameMode('hidden')).toBe('hidden');
    expect(parseRoomNameMode(undefined)).toBe('name');
    expect(parseRoomNameMode(true)).toBe('name');
  });

  it('an alias never contains the name and is the same every time', () => {
    const first = projectAliases(['tecsul', 'DOC-V2']);
    const again = projectAliases(['tecsul', 'DOC-V2']);
    expect(first).toEqual(again);
    for (const [project, alias] of first) {
      expect(alias.toLowerCase()).not.toContain(project.toLowerCase());
      expect(alias.length).toBeGreaterThan(0);
    }
  });

  it('no two projects share an alias, and the earlier one keeps its own', () => {
    const projects = Array.from({ length: 20 }, (_, i) => `projeto-${i}`);
    const aliases = projectAliases(projects);
    expect(new Set(aliases.values()).size).toBe(projects.length);
    const fewer = projectAliases(projects.slice(0, 5));
    for (const [project, alias] of fewer) expect(aliases.get(project)).toBe(alias);
  });

  it('more projects than aliases still get one each', () => {
    const projects = Array.from({ length: 60 }, (_, i) => `p${i}`);
    expect(projectAliases(projects).size).toBe(60);
  });

  it('writes the name, the alias or nothing', () => {
    const aliases = projectAliases(['tecsul']);
    expect(shownProjectName('tecsul', 'name', aliases)).toBe('tecsul');
    expect(shownProjectName('tecsul', 'alias', aliases)).toBe(aliases.get('tecsul'));
    expect(shownProjectName('tecsul', 'hidden', aliases)).toBeUndefined();
    // A project with no room has an alias all the same.
    expect(shownProjectName('outro', 'alias', aliases)).toBeTruthy();
  });
});
