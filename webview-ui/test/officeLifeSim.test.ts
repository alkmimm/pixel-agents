/**
 * pixel-agents-secure (local): diagnóstico de "Vida no escritório" no
 * escritório compacto real (composeOffice com "Área comum compacta" e o
 * catálogo real de public/assets/furniture), com vários agentes, alguns
 * minutos simulados e as salas recompostas no meio, como useProjectRooms faz.
 *
 * Só mede e imprime (console.log, no log da suíte); não reprova por
 * comportamento. Lê o estado privado do diretor (`trips`) para classificar
 * por que cada atividade terminou.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, test, vi } from 'vitest';

import {
  type FurnitureAsset,
  type FurnitureManifest,
  flattenManifest,
  type InheritedProps,
} from '../../core/src/assets/manifestUtils.js';
import { robotIsOut } from '../src/office/engine/coffeeCorner.js';
import { restoreAgent } from '../src/office/engine/existingAgents.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { getBlockedTiles } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';
import { ALL_PARTS, LOOK_MS, OfficeDirector } from '../src/viewer/officeDirector.js';
import { coffeeCorner, QUEUE_MAX_MS, queueSpots, robotRound } from '../src/viewer/officeLife.js';
import { composeOffice, planRooms, type RoomState, sameRooms } from '../src/viewer/projectRooms.js';

const FURNITURE = fileURLToPath(new URL('../public/assets/furniture', import.meta.url));

/** The real catalog, as the server's assetLoader flattens it; sprites are blanks of the right size. */
beforeAll(() => {
  const catalog: FurnitureAsset[] = [];
  for (const dir of fs.readdirSync(FURNITURE, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(FURNITURE, dir.name, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf-8')) as FurnitureManifest;
    const inherited: InheritedProps = {
      groupId: m.id,
      name: m.name,
      category: m.category,
      canPlaceOnWalls: m.canPlaceOnWalls,
      canPlaceOnSurfaces: m.canPlaceOnSurfaces,
      backgroundTiles: m.backgroundTiles,
    };
    if (m.type === 'asset') {
      catalog.push({
        id: m.id,
        name: m.name,
        label: m.name,
        category: m.category,
        file: m.file ?? `${m.id}.png`,
        width: m.width!,
        height: m.height!,
        footprintW: m.footprintW!,
        footprintH: m.footprintH!,
        isDesk: m.category === 'desks',
        canPlaceOnWalls: m.canPlaceOnWalls,
        canPlaceOnSurfaces: m.canPlaceOnSurfaces,
        backgroundTiles: m.backgroundTiles,
        groupId: m.id,
      });
    } else {
      if (m.rotationScheme) inherited.rotationScheme = m.rotationScheme;
      catalog.push(
        ...flattenManifest(
          {
            type: 'group',
            groupType: m.groupType as 'rotation' | 'state' | 'animation',
            rotationScheme: m.rotationScheme,
            members: m.members!,
          },
          inherited,
        ),
      );
    }
  }
  const sprites: LoadedAssetData['sprites'] = {};
  for (const a of catalog) {
    sprites[a.id] = Array.from({ length: a.height }, () => new Array<string>(a.width).fill(''));
  }
  const ok = buildDynamicCatalog({ catalog, sprites });
  if (!ok) throw new Error('catálogo real não carregou');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tile = { col: number; row: number };
/** The director's private trip, as far as this test reads it. */
interface TripLike {
  spot: Tile;
  stage: string;
  seated?: boolean;
  until?: number;
  queuedAt?: number;
  table?: Tile;
  mate?: number;
  plan?: string;
  pair?: boolean;
}
interface TripRec {
  id: number;
  kind: 'coffee' | 'game' | 'invite' | 'invited';
  pair: boolean;
  stages: Set<string>;
  end?: string;
}
interface PairRec {
  a: number;
  b: number;
  plan: string;
  at: number;
  set: Set<number>;
  reached: Set<number>;
  together: boolean;
}

/** useProjectRooms without React: replan, compose (compact) and apply. */
class Rooms {
  plan: RoomState[] = [];
  origin = { col: 0, row: 0 };
  first = true;
  readonly base: OfficeLayout;
  readonly os: OfficeState;
  recompositions = 0;
  constructor(os: OfficeState, base: OfficeLayout) {
    this.os = os;
    this.base = base;
  }
  /** Returns true when the office was recomposed. */
  tick(now: number): boolean {
    const counts = new Map<string, number>();
    for (const ch of this.os.characters.values()) {
      if (ch.isSubagent || ch.matrixEffect === 'despawn' || !ch.directoryName) continue;
      counts.set(ch.directoryName, (counts.get(ch.directoryName) ?? 0) + 1);
    }
    const plan = planRooms(this.plan, counts, now);
    if (!this.first && sameRooms(plan, this.plan)) {
      this.plan = plan;
      if (plan.length > 0) this.os.moveIntoRooms(false);
      return false;
    }
    this.plan = plan;
    const composed = composeOffice(this.base, plan, getBlockedTiles(this.base.furniture), true);
    const roomAreas: Record<string, string[]> = {};
    for (const room of composed.rooms) roomAreas[room.project] = [room.label];
    const shift = this.first
      ? { col: 0, row: 0 }
      : { col: composed.origin.col - this.origin.col, row: composed.origin.row - this.origin.row };
    this.origin = composed.origin;
    this.os.applyRooms(
      composed.layout,
      roomAreas,
      composed.roomTiles,
      this.first || !composed.connected,
      shift,
    );
    this.first = false;
    this.recompositions++;
    return true;
  }
}

/** The lounge as the director sees it, with what it uses marked. */
function lounge(os: OfficeState): string {
  const layout = os.getLayout();
  const corner = coffeeCorner(layout.furniture, os.walkableTiles);
  const walk = new Set(os.walkableTiles.map((t) => `${t.col},${t.row}`));
  const mark = new Map<string, string>();
  const put = (t: Tile | null | undefined, c: string) => {
    if (t) mark.set(`${t.col},${t.row}`, c);
  };
  const front = corner.machine[0];
  if (front) for (const q of queueSpots(front, os.walkableTiles)) put(q, 'q');
  for (const t of corner.table?.spots ?? []) put(t, 't');
  for (const s of os.freeSeats()) put({ col: s.col, row: s.row }, 's');
  put(front, 'F');
  put(corner.dock, 'D');
  put(robotRound(corner, os.walkableTiles, () => 0).cleanAt, 'C');
  const lines: string[] = [];
  for (let r = 0; r < Math.min(layout.rows, 16); r++) {
    let line = `${String(r).padStart(2)} `;
    for (let c = 0; c < Math.min(layout.cols, 12); c++) {
      const k = `${c},${r}`;
      const tile = layout.tiles[r * layout.cols + c];
      line +=
        mark.get(k) ??
        (walk.has(k) ? '.' : tile === TileType.WALL ? '#' : tile === TileType.VOID ? ' ' : 'x');
    }
    lines.push(line);
  }
  return [
    `front=${JSON.stringify(front)} queue=${JSON.stringify(front ? queueSpots(front, os.walkableTiles) : [])}`,
    `table=${JSON.stringify(corner.table)} dock=${JSON.stringify(corner.dock)} game=${JSON.stringify(corner.game)}`,
    'F frente da máquina, q fila, t lugar em pé da mesa, s assento livre, D doca, C onde o robô limpa, x mobília',
    ...lines,
  ].join('\n');
}

interface Scenario {
  name: string;
  seed: number;
  /** When agents arrive: [second, id, project]. */
  arrivals: Array<[number, number, string]>;
  minutes: number;
}

function run(sc: Scenario): { summary: Record<string, unknown>; map: string } {
  const rng = mulberry32(sc.seed);
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(sc.seed + 1000));
  const cols = 10;
  const rows = 10;
  const base: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
  const os = new OfficeState(base);
  const rooms = new Rooms(os, base);
  let now = 1_000_000;
  const t0 = now;
  const active = new Map<number, number>(); // id -> until (ms)
  const idleSince = new Map<number, number>();
  const director = new OfficeDirector(
    () => os,
    (_o, id) => (active.has(id) ? { tone: 'active' } : { tone: 'done', since: idleSince.get(id) }),
    now,
    rng,
  );
  const trips = (director as unknown as { trips: Map<number, TripLike> }).trips;
  const counts = new Map<string, number>();
  const bump = (key: string, n = 1) => counts.set(key, (counts.get(key) ?? 0) + n);
  const samples: string[] = [];
  const sample = (s: string) => {
    if (samples.length < 40) samples.push(`t=${(now - t0) / 1000}s ${s}`);
  };
  const recs = new WeakMap<TripLike, TripRec>();
  const allRecs: TripRec[] = [];
  const pairs: PairRec[] = [];
  const ids: number[] = [];
  let map = '';

  const addAgents = (sec: number): boolean => {
    let added = false;
    for (const [at, id, project] of sc.arrivals) {
      if (at !== sec) continue;
      restoreAgent(os, { id, directoryName: project });
      os.setAgentActive(id, false);
      idleSince.set(id, now);
      ids.push(id);
      added = true;
    }
    return added;
  };

  /** One frame; whoever was walking and stops short of where it was going is counted. */
  const frame = (dt: number) => {
    const dest = new Map<number, Tile>();
    for (const ch of os.characters.values()) {
      const last = ch.path[ch.path.length - 1];
      if (ch.state === CharacterState.WALK && last) dest.set(ch.id, { ...last });
    }
    const cupsBefore = os.cups.length;
    const robotOut = os.robot ? robotIsOut(os.robot) : false;
    os.update(dt);
    if (os.cups.length < cupsBefore) bump('robô: xícaras recolhidas', cupsBefore - os.cups.length);
    if (os.robot && !robotOut && robotIsOut(os.robot)) bump('robô: saídas');
    for (const ch of os.characters.values()) {
      const d = dest.get(ch.id);
      if (!d || ch.state === CharacterState.WALK) continue;
      if (ch.tileCol !== d.col || ch.tileRow !== d.row) {
        bump('motor: parou antes do destino (num quadro comum)');
        sample(`#${ch.id} parou em ${ch.tileCol},${ch.tileRow}, ia para ${d.col},${d.row} (motor)`);
      }
    }
  };

  let lastLayout = os.getLayout();
  for (let sec = 0; sec < sc.minutes * 60; sec++) {
    // Agents arriving (and the rooms that follow them), and the replan every 5 s.
    let recomposed = false;
    if (addAgents(sec) || sec % 5 === 0) {
      const chars = [...os.characters.values()];
      const walkers = chars.filter((c) => c.state === CharacterState.WALK).length;
      const guests = chars.filter((c) => c.guestSeat).length;
      const tripsBefore = trips.size;
      const cups = os.cups.length;
      if (rooms.tick(now)) {
        recomposed = true;
        if (sec > 0) {
          bump('recomposições');
          bump('recomposição: andando (caminho apagado)', walkers);
          bump('recomposição: em assento de visita', guests);
          bump('recomposição: atividades em curso', tripsBefore);
          bump('recomposição: xícaras na mesa', cups);
        }
        if (!map) map = lounge(os);
      }
    }
    // Work: an idle agent is called to work now and then, for a while.
    for (const id of ids) {
      const until = active.get(id);
      if (until !== undefined && now >= until) {
        active.delete(id);
        idleSince.set(id, now);
        if (os.characters.get(id)?.state === CharacterState.WALK) {
          bump('motor: fim do turno apagou uma caminhada');
        }
        os.setAgentActive(id, false);
      } else if (until === undefined && rng() < 1 / 300) {
        active.set(id, now + (30 + rng() * 90) * 1000);
        os.setAgentActive(id, true);
      }
    }
    for (let i = 0; i < 15; i++) {
      if (recomposed && i === 0) {
        // Walkers whose way applyRooms just erased stop on this frame.
        const cut = [...os.characters.values()].filter(
          (ch) => ch.state === CharacterState.WALK && ch.path.length === 0,
        ).length;
        os.update(1 / 15);
        if (cut > 0) bump('motor: parou onde estava (caminho apagado pela recomposição)', cut);
        continue;
      }
      frame(1 / 15);
    }
    now += LOOK_MS;

    // One look, and what it did to each trip.
    const before = new Map<number, { ref: TripLike; snap: TripLike; carrying: boolean }>();
    for (const [id, t] of trips) {
      before.set(id, {
        ref: t,
        snap: { ...t, spot: { ...t.spot } },
        carrying: os.characters.get(id)?.carrying ?? false,
      });
    }
    const cupsBefore = os.cups.length;
    const relayout = os.getLayout() !== lastLayout;
    lastLayout = os.getLayout();
    director.look(now, ids, {}, ALL_PARTS);
    const cupDelta = os.cups.length - cupsBefore;
    if (cupDelta > 0) bump('xícaras deixadas na mesa', cupDelta);
    if (cupDelta < 0) bump('xícaras apagadas pela recomposição', -cupDelta);

    for (const [id, { ref, snap, carrying }] of before) {
      const nowTrip = trips.get(id);
      if (nowTrip === ref) continue;
      const ch = os.characters.get(id);
      let why: string;
      if (relayout) why = 'recomposição das salas (o diretor limpa tudo)';
      else if (snap.stage === 'greet') {
        why = nowTrip ? 'saiu em dupla' : `dupla: o ${snap.plan} deste não começou`;
        if (!nowTrip) {
          const mate = snap.mate === undefined ? undefined : trips.get(snap.mate);
          sample(
            `#${id} desistiu após cumprimentar (${snap.plan}); parceiro #${snap.mate} ${mate ? `seguiu (${mate.stage})` : 'também não'}; em ${ch?.tileCol},${ch?.tileRow}`,
          );
        }
      } else if (snap.stage === 'sip') {
        why = carrying ? 'terminou o café (com xícara)' : 'terminou o café (sem xícara)';
      } else if (snap.stage === 'play') why = 'terminou o jogo';
      else if (ch?.isActive) why = 'chamado ao trabalho';
      else if (snap.stage === 'invite' || snap.stage === 'invited') {
        const other = snap.mate === undefined ? undefined : trips.get(snap.mate);
        if (!other || other.mate !== id) why = 'convite: o outro desistiu';
        else if (snap.stage === 'invited' && now >= (snap.until ?? 0)) why = 'convite: expirou';
        else why = 'convite: parou longe do parceiro';
      } else if (snap.stage === 'queue') {
        why =
          now - (snap.queuedAt ?? now) > QUEUE_MAX_MS
            ? 'fila: cansou de esperar'
            : 'fila: parou fora do lugar';
      } else if (snap.seated && ch?.guestSeat === null) why = `perdeu o assento (${snap.stage})`;
      else {
        why = `parou no caminho (${snap.stage})`;
        sample(
          `#${id} ${snap.stage}: parou em ${ch?.tileCol},${ch?.tileRow}, ia para ${snap.spot.col},${snap.spot.row}`,
        );
      }
      bump(`fim: ${why}`);
      const rec = recs.get(ref);
      if (rec) rec.end = why;
    }
    for (const [id, t] of trips) {
      let rec = recs.get(t);
      if (!rec) {
        const kind =
          t.stage === 'to-game'
            ? 'game'
            : t.stage === 'invite'
              ? 'invite'
              : t.stage === 'invited'
                ? 'invited'
                : 'coffee';
        rec = { id, kind, pair: t.pair === true, stages: new Set() };
        recs.set(t, rec);
        allRecs.push(rec);
      }
      rec.stages.add(t.stage);
    }
    // Pairs: from the greeting on.
    for (const [id, { snap }] of before) {
      const t = trips.get(id);
      if (snap.stage === 'invite' && t?.stage === 'greet' && t.mate !== undefined) {
        pairs.push({
          a: id,
          b: t.mate,
          plan: t.plan ?? '?',
          at: now,
          set: new Set(),
          reached: new Set(),
          together: false,
        });
      }
    }
    for (const p of pairs) {
      if (now - p.at > 180_000) continue;
      const goal = p.plan === 'coffee' ? 'sip' : 'play';
      let there = 0;
      for (const [me, other] of [
        [p.a, p.b],
        [p.b, p.a],
      ]) {
        const t = trips.get(me);
        if (!t?.pair || t.mate !== other) continue;
        p.set.add(me);
        if (t.stage === goal) {
          p.reached.add(me);
          there++;
        }
      }
      if (there === 2) p.together = true;
    }
  }

  const coffees = allRecs.filter((r) => r.kind === 'coffee');
  const games = allRecs.filter((r) => r.kind === 'game');
  const summary = {
    cenario: sc.name,
    seed: sc.seed,
    minutos: sc.minutes,
    agentes: ids.length,
    recomposicoes_depois_do_inicio: rooms.recompositions - 1,
    cafe: {
      idas: coffees.length,
      em_dupla: coffees.filter((r) => r.pair).length,
      chegaram_a_maquina: coffees.filter((r) => r.stages.has('pour')).length,
      chegaram_ao_lugar_do_cafe: coffees.filter((r) => r.stages.has('sip')).length,
      terminaram_com_xicara: coffees.filter((r) => r.end === 'terminou o café (com xícara)').length,
      ainda_em_curso: coffees.filter((r) => r.end === undefined).length,
    },
    jogo: {
      idas: games.length,
      em_dupla: games.filter((r) => r.pair).length,
      jogaram: games.filter((r) => r.stages.has('play')).length,
    },
    duplas: {
      cumprimentos: pairs.length,
      os_dois_sairam: pairs.filter((p) => p.set.size === 2).length,
      so_um_saiu: pairs.filter((p) => p.set.size === 1).length,
      os_dois_chegaram: pairs.filter((p) => p.reached.size === 2).length,
      so_um_chegou: pairs.filter((p) => p.reached.size === 1).length,
      juntos_ao_mesmo_tempo: pairs.filter((p) => p.together).length,
      por_plano: Object.fromEntries(
        ['coffee', 'game'].map((plan) => {
          const of = pairs.filter((p) => p.plan === plan);
          return [
            plan,
            {
              cumprimentos: of.length,
              so_um_saiu: of.filter((p) => p.set.size === 1).length,
              juntos: of.filter((p) => p.together).length,
            },
          ];
        }),
      ),
    },
    contagens: Object.fromEntries([...counts.entries()].sort()),
    xicaras_na_mesa_no_fim: os.cups.length,
    amostras: samples,
  };
  return { summary, map };
}

const SECONDS = (min: number) => min * 60;

test('diagnóstico: vida no escritório compacto, com e sem recomposição das salas', () => {
  const everyoneFromStart: Array<[number, number, string]> = [
    [0, 1, 'alpha'],
    [0, 2, 'alpha'],
    [0, 3, 'alpha'],
    [0, 4, 'beta'],
    [0, 5, 'beta'],
    [0, 6, 'gamma'],
    [0, 7, 'beta'],
    [0, 8, 'delta'],
  ];
  // The same agents, some arriving later: a new room under the corridor (4 min),
  // beta growing a second row of desks over the corridor (8 min: everything moves
  // down 4 rows), a new room (11 min).
  const arriving: Array<[number, number, string]> = [
    [0, 1, 'alpha'],
    [0, 2, 'alpha'],
    [0, 3, 'alpha'],
    [0, 4, 'beta'],
    [0, 5, 'beta'],
    [SECONDS(4), 6, 'gamma'],
    [SECONDS(8), 7, 'beta'],
    [SECONDS(11), 8, 'delta'],
  ];
  let printedMap = false;
  for (const seed of [1, 2, 3]) {
    for (const sc of [
      { name: 'salas fixas', seed, arrivals: everyoneFromStart, minutes: 15 },
      { name: 'salas recompostas (4, 8 e 11 min)', seed, arrivals: arriving, minutes: 15 },
    ]) {
      try {
        const { summary, map } = run(sc);
        if (!printedMap && map) {
          console.log(`[officeLifeSim] mapa do lounge:\n${map}`);
          printedMap = true;
        }
        console.log(`[officeLifeSim] ${JSON.stringify(summary, null, 1)}`);
      } catch (err) {
        console.log(
          `[officeLifeSim] ${sc.name} seed ${seed}: ERRO ${err instanceof Error ? err.stack : String(err)}`,
        );
      }
      vi.restoreAllMocks();
    }
  }
}, 300_000);
