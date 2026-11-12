import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  ACTIVE_WINDOW_MS,
  APPEND_MAX_BYTES,
  REVIEW_LINGER_MS,
  type CodexEvent,
  CodexSessions,
  codexSessionRoots,
  eventsOfRecord,
  headerOf,
  TURN_WINDOW_MS,
} from '../src/codexSessions.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { filterHookPayload } from '../src/providers/hook/claude/hooks/hookPayloadFilter.js';

const SECRET = 'CANARY-NEVER-LEAVES';
const ID = '019a1b2c-3d4e-7f50-8a9b-0c1d2e3f4a5b';
const line = (o: unknown) => JSON.stringify(o) + '\n';

const header = (threadSource = 'user', extra: Record<string, unknown> = {}) =>
  line({
    timestamp: '2026-11-12T10:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: ID,
      cwd: '/home/dev/repos/app',
      thread_source: threadSource,
      originator: 'codex-tui',
      base_instructions: { text: SECRET },
      creator_user_id: SECRET,
      creator_account_id: SECRET,
      git: { branch: SECRET },
      ...extra,
    },
  });
const started = () => line({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } });
const complete = () =>
  line({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: SECRET } });
const exec = (command: string) =>
  line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'c1', input: command } });
const execDone = () =>
  line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: SECRET } });
const noise = () =>
  line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: SECRET }] } }) +
  line({ type: 'response_item', payload: { type: 'reasoning', summary: [{ text: SECRET }] } }) +
  line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', text: SECRET } } }) +
  line({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { plan: SECRET } } }) +
  line({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', summary: SECRET } }) +
  line({ type: 'made_up_tomorrow', payload: { text: SECRET } });

describe('H18: Codex session roots', () => {
  it('only absolute paths that end in .codex/sessions, at most four', () => {
    const env = (value: string) => ({ PIXEL_AGENTS_CODEX_SESSION_ROOTS: value });
    expect(codexSessionRoots({})).toEqual([]);
    expect(codexSessionRoots(env(''))).toEqual([]);
    const good = '/home/a/.codex/sessions';
    const windows = '/mnt/c/Users/a/.codex/sessions';
    expect(codexSessionRoots(env([good, windows, good].join(path.delimiter)))).toEqual([good, windows]);
    for (const bad of [
      '/home/a/.codex',
      '/home/a/.codex/sessions/2026',
      '/home/a/.claude/projects',
      '/home/a/sessions',
      '.codex/sessions',
      '/home/a/.codex/sessions/../../.ssh',
      '/',
    ]) {
      expect(codexSessionRoots(env(bad)), bad).toEqual([]);
    }
    const many = Array.from({ length: 9 }, (_, i) => `/h${i}/.codex/sessions`);
    expect(codexSessionRoots(env(many.join(path.delimiter)))).toHaveLength(4);
  });
});

describe('H18: what is read of a Codex record', () => {
  it('the header gives id, folder and who started it, and nothing else', () => {
    const h = headerOf(header().trim());
    expect(h).toEqual({ id: ID, cwd: '/home/dev/repos/app', threadSource: 'user' });
    expect(JSON.stringify(h)).not.toContain(SECRET);
    expect(headerOf(header('guardian_review').trim())?.threadSource).toBe('guardian_review');
    expect(headerOf(started().trim())).toBeUndefined();
    expect(headerOf('not json')).toBeUndefined();
    expect(headerOf(header('user', { id: '../../etc/passwd' }).trim())).toBeUndefined();
    expect(headerOf(header('user', { cwd: 42 }).trim())).toBeUndefined();
  });

  it('a turn: its tools start and end, its end is a Stop; text-bearing records are nothing', () => {
    const turn = { open: false, calls: 0 };
    const of = (text: string) => eventsOfRecord(JSON.parse(text) as Record<string, unknown>, turn);
    expect(of(started())).toEqual([]);
    expect(turn.open).toBe(true);
    const [pre] = of(exec('git push origin main --force'));
    expect(pre).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    expect(turn.calls).toBe(1);
    expect(of(execDone())).toEqual([{ hook_event_name: 'PostToolUse' }]);
    for (const text of noise().trim().split('\n')) expect(of(text)).toEqual([]);
    expect(of(complete())).toEqual([{ hook_event_name: 'Stop' }]);
    // Of a turn's context only the model and the effort are kept.
    expect(turn).toEqual({ open: false, calls: 0, model: 'gpt-6.1-sol' });
    expect(JSON.stringify(turn)).not.toContain(SECRET);
  });

  it('a turn context gives a well-formed model and effort, and nothing else', () => {
    const turn: { open: boolean; calls: number; model?: string; effort?: string } = { open: false, calls: 0 };
    const context = (payload: Record<string, unknown>) =>
      eventsOfRecord({ type: 'turn_context', payload: { summary: SECRET, cwd: SECRET, ...payload } }, turn);
    expect(context({ model: 'gpt-6.1-sol', effort: 'xhigh' })).toEqual([]);
    expect(turn).toMatchObject({ model: 'gpt-6.1-sol', effort: 'xhigh' });
    // A model that is not an id is not taken, and leaves what was known.
    context({ model: `x ${SECRET}`, effort: 'low' });
    context({ model: 42 });
    expect(turn).toMatchObject({ model: 'gpt-6.1-sol', effort: 'xhigh' });
    // An effort that is not one is dropped with the model that came with it.
    context({ model: 'codex-auto-review', effort: SECRET });
    expect(turn.model).toBe('codex-auto-review');
    expect(turn.effort).toBeUndefined();
    expect(JSON.stringify(turn)).not.toContain(SECRET);
    // The header names a reviewer's parent only when it is a well-formed id.
    expect(headerOf(header('guardian_review', { parent_thread_id: ID }).trim())?.parentId).toBe(ID);
    expect(headerOf(header('guardian_review', { parent_thread_id: '../x' }).trim())?.parentId).toBeUndefined();
  });

  it('waiting tools show nothing, and another tool only its name', () => {
    const turn = { open: true, calls: 0 };
    const call = (name: string, extra: Record<string, unknown> = {}) =>
      eventsOfRecord(
        { type: 'response_item', payload: { type: 'function_call', name, arguments: SECRET, ...extra } },
        turn,
      );
    for (const quiet of ['sleep', 'wait', 'request_user_input_async']) expect(call(quiet)).toEqual([]);
    expect(
      eventsOfRecord({ type: 'response_item', payload: { type: 'function_call_output' } }, turn),
    ).toEqual([]);
    expect(call('apply_patch')).toEqual([
      { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: {} },
    ]);
  });
});

describe('H18: following Codex sessions', () => {
  let home: string;
  let root: string;
  let day: string;
  let events: CodexEvent[];
  let now: number;
  let sessions: CodexSessions;
  const file = (name = `rollout-2026-11-12T10-00-00-${ID}.jsonl`) => path.join(day, name);

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-codex-'));
    root = path.join(home, '.codex', 'sessions');
    day = path.join(root, '2026', '11', '12');
    fs.mkdirSync(day, { recursive: true });
    events = [];
    now = Date.now();
    // What leaves is what the runtime gets: every event through the H4 filter.
    sessions = new CodexSessions([root], (event) => events.push(filterHookPayload(event)), {
      now: () => now,
    });
  });
  afterEach(() => {
    sessions.stop();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('a session is followed from its end, and only what it does leaves, filtered', async () => {
    fs.writeFileSync(file(), header() + started() + exec('rm -rf old') + execDone() + complete());
    await sessions.tick(true);
    // Nothing of its past is replayed: it comes in idle.
    expect(events).toEqual([
      { hook_event_name: 'Stop', session_id: `codex-${ID}`, cwd: '/home/dev/repos/app', agent_kind: 'codex' },
    ]);
    events.length = 0;

    fs.appendFileSync(file(), started() + noise() + exec(`curl -H "Authorization: ${SECRET}" https://x.test/api`));
    await sessions.tick(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      session_id: `codex-${ID}`,
      agent_kind: 'codex',
    });
    // H4: of the command only the program is left.
    expect((events[0].tool_input as { command: string }).command).toBe('curl');

    fs.appendFileSync(file(), execDone() + complete());
    await sessions.tick(false);
    expect(events.map((e) => e.hook_event_name)).toEqual(['PreToolUse', 'PostToolUse', 'Stop']);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(
        Object.keys(event)
          .filter((k) => ['agent_kind', 'cwd', 'hook_event_name', 'session_id', 'tool_input', 'tool_name'].includes(k))
          .sort(),
      );
    }
  });

  it('a session found mid-turn comes in working on its last command', async () => {
    fs.writeFileSync(file(), header() + started() + exec('npm run build'));
    await sessions.tick(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  });

  it("sessions Codex opened by itself, old ones and other files are not followed", async () => {
    fs.writeFileSync(file(), header('guardian_review') + started());
    const old = file('rollout-2026-10-01T10-00-00-old.jsonl');
    fs.writeFileSync(old, header() + started());
    const longAgo = (now - ACTIVE_WINDOW_MS - 60_000) / 1000;
    fs.utimesSync(old, longAgo, longAgo);
    // Not session files: never opened, whatever is in them.
    fs.writeFileSync(path.join(day, 'notes.jsonl'), header());
    fs.writeFileSync(path.join(root, 'rollout-loose.jsonl'), header());
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), header());
    fs.writeFileSync(path.join(home, '.codex', 'history.jsonl'), header());
    await sessions.tick(true);
    expect(events).toEqual([]);
    expect(sessions.size).toBe(0);
  });

  it('a link to a file elsewhere is not followed', async () => {
    const outside = path.join(home, 'outside.jsonl');
    fs.writeFileSync(outside, header() + started());
    fs.symlinkSync(outside, file());
    await sessions.tick(true);
    expect(events).toEqual([]);
  });

  it('a session left alone ends; one in a long turn is kept longer', async () => {
    fs.writeFileSync(file(), header() + started() + exec('sleep 3000'));
    await sessions.tick(true);
    events.length = 0;
    now += ACTIVE_WINDOW_MS + 60_000;
    await sessions.tick(false);
    expect(events).toEqual([]); // the turn is open: still here
    now += TURN_WINDOW_MS;
    await sessions.tick(false);
    expect(events.map((e) => [e.hook_event_name, e.reason])).toEqual([['SessionEnd', 'exit']]);
    expect(sessions.size).toBe(0);
  });

  it('stopping ends every followed session', async () => {
    fs.writeFileSync(file(), header() + started() + complete());
    await sessions.tick(true);
    events.length = 0;
    sessions.stop();
    expect(events.map((e) => e.hook_event_name)).toEqual(['SessionEnd']);
  });

  it('a burst larger than the read limit is skipped to its end, not read whole', async () => {
    fs.writeFileSync(file(), header() + started() + complete());
    await sessions.tick(true);
    events.length = 0;
    const filler = line({ type: 'response_item', payload: { type: 'message', content: 'x'.repeat(4000) } });
    const burst = started() + exec('early command') + filler.repeat(Math.ceil((APPEND_MAX_BYTES * 1.5) / filler.length));
    fs.appendFileSync(file(), burst + exec('late command'));
    await sessions.tick(false);
    expect(events).toHaveLength(1);
    expect((events[0].tool_input as { command: string }).command).toBe('late');
  });

  it('stage 2: the model and effort are told apart from the events, again until the office takes them', async () => {
    const told: Array<[string, string, string | undefined]> = [];
    let taken = false;
    const own = new CodexSessions([root], (event) => events.push(filterHookPayload(event)), {
      now: () => now,
      onSignals: (sessionId, model, effort) => {
        told.push([sessionId, model, effort]);
        return taken;
      },
    });
    const context = line({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'xhigh', summary: SECRET } });
    fs.writeFileSync(file(), header() + context + started());
    await own.tick(true);
    const first = told.length;
    await own.tick(false);
    expect(told.length).toBe(first + 1); // not taken: told again at the next pass
    taken = true;
    await own.tick(false);
    await own.tick(false);
    expect(told.length).toBe(first + 2); // taken: not told again
    expect(told[told.length - 1]).toEqual([`codex-${ID}`, 'gpt-6.1-sol', 'xhigh']);
    expect(JSON.stringify([told, events])).not.toContain(SECRET);
    // No event carries the model: it reaches the office only as a signal.
    expect(JSON.stringify(events)).not.toContain('gpt-6.1-sol');
    own.stop();
  });

  it('stage 2: a reviewer is no agent; it is reported as its parent\'s helper while it has a turn', async () => {
    const PARENT = '019a1b2c-3d4e-7f50-8a9b-ffffffffffff';
    const reviews: Array<Record<string, unknown>> = [];
    const own = new CodexSessions([root], (event) => events.push(filterHookPayload(event)), {
      now: () => now,
      onReviewer: (review) => {
        reviews.push({ ...review });
        return true;
      },
    });
    const context = line({ type: 'turn_context', payload: { model: 'codex-auto-review', effort: 'low' } });
    fs.writeFileSync(file(), header('guardian_review', { parent_thread_id: PARENT }) + complete());
    await own.tick(true);
    expect(own.size).toBe(1);
    expect(reviews).toEqual([]); // followed, with no turn under way: nothing to show
    // A whole turn within one pass still shows, and stays a moment.
    fs.appendFileSync(file(), context + started() + exec('cat secret.txt') + execDone() + complete());
    await own.tick(false);
    expect(reviews).toEqual([
      { parent: `codex-${PARENT}`, reviewer: ID, active: true, model: 'codex-auto-review', effort: 'low' },
    ]);
    now += REVIEW_LINGER_MS + 1;
    await own.tick(false);
    expect(reviews[1]).toMatchObject({ reviewer: ID, active: false });
    // An open turn shows until it ends, and its helper leaves with the session.
    fs.appendFileSync(file(), started());
    await own.tick(false);
    expect(reviews[2]).toMatchObject({ active: true });
    own.stop();
    expect(reviews[3]).toMatchObject({ active: false });
    // A reviewer posts no hook event at all.
    expect(events).toEqual([]);
    expect(JSON.stringify(reviews)).not.toContain(SECRET);
  });

  it('with no roots it never starts', () => {
    const none = new CodexSessions([], () => events.push({}));
    none.start();
    none.stop();
    expect(events).toEqual([]);
  });
});

describe('H18: a Codex session in the office, end to end', () => {
  it('comes in as "Codex", shows only the program of its command, and leaves when it ends', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-codex-e2e-'));
    const root = path.join(home, '.codex', 'sessions');
    const day = path.join(root, '2026', '11', '12');
    fs.mkdirSync(day, { recursive: true });
    const file = path.join(day, `rollout-2026-11-12T10-00-00-${ID}.jsonl`);
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    runtime.watchAllSessions.current = true;
    const sent: Array<Record<string, unknown>> = [];
    store.on('broadcast', (m) => sent.push(m as Record<string, unknown>));
    let now = Date.now();
    const sessions = new CodexSessions(
      [root],
      (event) => runtime.handleHookEvent('codex', filterHookPayload(event)),
      { now: () => now },
    );
    try {
      fs.writeFileSync(file, header() + started() + complete());
      await sessions.tick(true);
      expect(store.size).toBe(1);
      const agent = [...store.values()][0];
      expect(agent).toMatchObject({
        agentName: 'Codex',
        hooksOnly: true,
        isExternal: true,
        jsonlFile: '',
        directoryName: 'app',
        sessionId: `codex-${ID}`,
      });

      fs.appendFileSync(file, started() + noise() + exec(`psql "postgres://u:${SECRET}@db/x" -c "select 1"`));
      await sessions.tick(false);
      const tool = sent.find((m) => m.type === 'agentToolStart');
      expect(tool).toBeDefined();
      expect(String(tool!.status)).toContain('psql');
      expect(JSON.stringify(sent)).not.toContain(SECRET);

      fs.appendFileSync(file, execDone() + complete());
      await sessions.tick(false);
      now += ACTIVE_WINDOW_MS + 60_000;
      await sessions.tick(false);
      expect(store.size).toBe(0);
      expect(JSON.stringify(sent)).not.toContain(SECRET);
    } finally {
      sessions.stop();
      runtime.dispose();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
