/**
 * pixel-agents-secure (local): what is written for a project's room, and for
 * a project in the agents list: its name, an alias or nothing. For a screen
 * that others see (a shared window, a recording), where the names of the
 * projects are not theirs to read.
 *
 * An alias is a tree's name, the same for a project every time (it comes
 * from the project's name). It hides the name from a glance; it is not
 * secrecy: whoever knows the projects can work out which is which.
 *
 * Free of React and the DOM, so it is tested directly.
 */
export type RoomNameMode = 'name' | 'alias' | 'hidden';

export const ROOM_NAME_MODES: ReadonlyArray<{ mode: RoomNameMode; label: string; title: string }> =
  [
    { mode: 'name', label: 'Projeto', title: 'O nome do projeto' },
    {
      mode: 'alias',
      label: 'Apelido',
      title: 'Um apelido fixo por projeto (nome de árvore), no lugar do nome',
    },
    { mode: 'hidden', label: 'Oculto', title: 'Nada escrito nas salas; apelido na lista de agentes' },
  ];

export function parseRoomNameMode(saved: unknown): RoomNameMode {
  return saved === 'alias' || saved === 'hidden' ? saved : 'name';
}

const TREES = [
  'Ipê',
  'Jatobá',
  'Aroeira',
  'Cedro',
  'Peroba',
  'Angico',
  'Jacarandá',
  'Sucupira',
  'Imbuia',
  'Canela',
  'Araucária',
  'Buriti',
  'Carnaúba',
  'Embaúba',
  'Figueira',
  'Guapuruvu',
  'Jequitibá',
  'Mogno',
  'Pitanga',
  'Sapucaia',
  'Tarumã',
  'Umbu',
  'Baru',
  'Copaíba',
  'Louro',
  'Mangaba',
  'Oiti',
  'Pequi',
  'Babaçu',
  'Cajá',
  'Jenipapo',
  'Cambuci',
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * An alias for each project, no two alike (while there are trees enough).
 * `projects` in a stable order: an earlier one keeps its alias whoever comes
 * after it.
 */
export function projectAliases(projects: readonly string[]): Map<string, string> {
  const aliases = new Map<string, string>();
  const taken = new Set<number>();
  for (const project of projects) {
    if (aliases.has(project)) continue;
    let index = hash(project) % TREES.length;
    if (taken.size < TREES.length) while (taken.has(index)) index = (index + 1) % TREES.length;
    taken.add(index);
    aliases.set(project, TREES[index]);
  }
  return aliases;
}

/** What to write for a project; undefined: nothing. */
export function shownProjectName(
  project: string,
  mode: RoomNameMode,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  if (mode === 'name') return project;
  if (mode === 'hidden') return undefined;
  return aliases.get(project) ?? projectAliases([project]).get(project);
}
