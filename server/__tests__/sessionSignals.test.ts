import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  broadcastSignalsIfChanged,
  ERROR_STREAK_THRESHOLD,
  observeRecord,
  permissionExemptFor,
  REPEAT_THRESHOLD,
  seedSignals,
  signalsMessage,
} from '../src/sessionSignals.js';
import type { AgentState } from '../src/types.js';

const agentOf = (extra: Partial<AgentState> = {}) =>
  ({ id: 7, jsonlFile: '', ...extra }) as unknown as AgentState;

const toolUse = (name: string, input: unknown) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't', name, input }] },
});
const toolResult = (isError: boolean) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: isError, content: 'SECRET OUTPUT' }] },
});

describe('observeRecord', () => {
  it('reads the permission mode and both titles, masked and capped', () => {
    const a = agentOf();
    observeRecord(a, { type: 'user', permissionMode: 'acceptEdits', message: { content: 'x' } });
    observeRecord(a, { type: 'custom-title', customTitle: 'deploy  da API\n token=abcd1234efgh5678' });
    observeRecord(a, { type: 'ai-title', aiTitle: 'x'.repeat(500) });
    const m = signalsMessage(a);
    expect(m.permissionMode).toBe('acceptEdits');
    expect(m.title).toBe('deploy da API token=<redacted>');
    expect(String(m.aiTitle).length).toBeLessThanOrEqual(81);
    // A mode that is not a plain word is ignored.
    observeRecord(a, { type: 'user', permissionMode: 'x y<script>' });
    expect(signalsMessage(a).permissionMode).toBe('acceptEdits');
  });

  it('counts failed results in a row, reports them from the threshold, never their text', () => {
    const a = agentOf();
    for (let i = 0; i < ERROR_STREAK_THRESHOLD - 1; i++) observeRecord(a, toolResult(true));
    expect(signalsMessage(a).errorStreak).toBe(0);
    observeRecord(a, toolResult(true));
    expect(signalsMessage(a).errorStreak).toBe(ERROR_STREAK_THRESHOLD);
    expect(JSON.stringify(signalsMessage(a))).not.toContain('SECRET');
    observeRecord(a, toolResult(false));
    expect(signalsMessage(a).errorStreak).toBe(0);
  });

  it('flags the same call repeated, by hash only', () => {
    const a = agentOf();
    for (let i = 0; i < REPEAT_THRESHOLD; i++) observeRecord(a, toolUse('Bash', { command: 'cat /etc/secret' }));
    expect(signalsMessage(a).repeats).toBe(REPEAT_THRESHOLD);
    expect(JSON.stringify(a.signals)).not.toContain('/etc/secret');
    observeRecord(a, toolUse('Bash', { command: 'ls' }));
    expect(signalsMessage(a).repeats).toBe(0);
    // A user prompt starts over.
    for (let i = 0; i < REPEAT_THRESHOLD; i++) observeRecord(a, toolUse('Read', { file_path: 'a' }));
    observeRecord(a, { type: 'user', message: { content: 'try another way' } });
    expect(signalsMessage(a).repeats).toBe(0);
  });

  it('a rate limit sleeps until resetsAt, and a real reply wakes', () => {
    const a = agentOf();
    observeRecord(a, {
      type: 'assistant',
      error: 'rate_limit',
      isApiErrorMessage: true,
      quotaLimits: { status: 'rejected', resetsAt: 1_900_000_000 },
    });
    expect(signalsMessage(a)).toMatchObject({ rateLimited: true, quotaUntil: 1_900_000_000_000 });
    observeRecord(a, { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } });
    expect(signalsMessage(a)).toMatchObject({ rateLimited: false, quotaUntil: undefined });
  });

  it('reads the model and effort of the session itself, well-formed only', () => {
    const a = agentOf();
    const reply = (model: unknown, extra: Record<string, unknown> = {}) => ({
      type: 'assistant',
      message: { model, content: [] },
      ...extra,
    });
    observeRecord(a, reply('claude-opus-5-5', { effort: 'high', perTurnEffort: 'xhigh' }));
    expect(signalsMessage(a)).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' });
    // A sub-agent's reply, a synthetic one and a malformed id change nothing.
    observeRecord(a, reply('claude-haiku-5-5', { isSidechain: true, effort: 'low' }));
    observeRecord(a, reply('<synthetic>'));
    observeRecord(a, reply('x'.repeat(65)));
    observeRecord(a, reply('claude opus; rm -rf'));
    observeRecord(a, reply(42));
    expect(signalsMessage(a)).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' });
    // A new model takes over, with its own effort (none recorded: none kept).
    observeRecord(a, reply('claude-fable-5-2[1m]', { effort: 'NOT AN EFFORT' }));
    expect(signalsMessage(a)).toMatchObject({ model: 'claude-fable-5-2[1m]', effort: undefined });
    // A user record never names the model.
    observeRecord(a, { type: 'user', message: { model: 'claude-sonnet-5-5', content: 'x' } });
    expect(signalsMessage(a).model).toBe('claude-fable-5-2[1m]');
  });
});

describe('broadcastSignalsIfChanged', () => {
  it('sends nothing for an agent with nothing to show, then only changes', () => {
    const store = new AgentStateStore();
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));
    const a = agentOf();
    observeRecord(a, toolUse('Read', { file_path: 'a' }));
    broadcastSignalsIfChanged(a, store);
    expect(sent).toHaveLength(0);
    observeRecord(a, { type: 'user', permissionMode: 'auto', message: { content: 'x' } });
    broadcastSignalsIfChanged(a, store);
    broadcastSignalsIfChanged(a, store);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agentSignals', id: 7, permissionMode: 'auto' });
  });
});

describe('permissionExemptFor', () => {
  const base = new Set(['Task']);
  it('no timed approval in modes that do not ask; edits exempt under acceptEdits', () => {
    for (const mode of ['auto', 'bypassPermissions', 'dontAsk']) {
      const a = agentOf();
      observeRecord(a, { type: 'user', permissionMode: mode });
      expect(permissionExemptFor(a, base)).toBeNull();
    }
    const a = agentOf();
    observeRecord(a, { type: 'user', permissionMode: 'acceptEdits' });
    expect([...permissionExemptFor(a, base)!]).toEqual(expect.arrayContaining(['Task', 'Edit', 'Write']));
    expect(permissionExemptFor(agentOf(), base)).toBe(base);
    expect(permissionExemptFor(undefined, base)).toBe(base);
  });
});

describe('seedSignals', () => {
  it('takes the mode and titles from the end of a transcript, once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-signals-'));
    try {
      const f = path.join(dir, 's.jsonl');
      const line = (o: unknown) => JSON.stringify(o) + '\n';
      fs.writeFileSync(
        f,
        line({ type: 'custom-title', customTitle: 'Revisão' }) +
          line({ type: 'user', permissionMode: 'plan', message: { content: 'x' } }) +
          line({ type: 'user', permissionMode: 'auto', message: { content: 'y' } }) +
          line({ type: 'assistant', effort: 'medium', message: { model: 'claude-sonnet-5-5' } }),
      );
      const a = agentOf({ jsonlFile: f });
      seedSignals(a);
      expect(signalsMessage(a)).toMatchObject({ permissionMode: 'auto', title: 'Revisão' });
      expect(signalsMessage(a)).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
      fs.appendFileSync(f, line({ type: 'custom-title', customTitle: 'Outro' }));
      seedSignals(a);
      expect(signalsMessage(a).title).toBe('Revisão');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
