/**
 * pixel-agents-secure (local): each agent's recent activity, for the office
 * viewer's details panel ("Atividade").
 *
 * It records ONLY what the office already broadcasts -- the short tool labels
 * built by formatToolStatus (file basename, a cut Bash command, a subtask
 * title) and the turn/permission state -- so a viewer that connects late sees
 * the last few minutes instead of an empty list. Nothing is read from the
 * transcript except, once per agent, the session's working directory, of
 * which only the last path segment (the project folder's name) is kept.
 *
 * Viewer-only: created by viewer.ts, never by the VS Code extension.
 */
import * as fs from 'node:fs';

import type { AgentStateStore } from './agentStateStore.js';
import type { AgentState } from './types.js';

/** Entries kept per agent: about an hour of steady tool use. */
export const ACTIVITY_MAX_ENTRIES = 300;
/** How much of the transcript's head is searched for the working directory. */
const PROJECT_HEAD_BYTES = 64 * 1024;
/** A transcript whose head names no directory yet is asked again after this. */
const PROJECT_RETRY_MS = 30_000;
/** Two identical tool labels this close together are one tool seen twice (hook
 *  and transcript both report it, under different ids). */
const DUPLICATE_WINDOW_MS = 2_000;
const MAX_LABEL_LENGTH = 200;

export type ActivityKind =
  | 'joined' // the agent appeared in the office
  | 'turn' // started working
  | 'tool' // a tool started (label = the office's own label for it)
  | 'subtool' // a subagent's tool started
  | 'permission' // waiting for the user's approval
  | 'done' // the turn finished
  | 'input'; // waiting for the user's next message

export interface ActivityEntry {
  /** Server clock, ms since epoch. */
  t: number;
  k: ActivityKind;
  label?: string;
  toolId?: string;
}

export interface AgentActivity {
  id: number;
  project?: string;
  entries: ActivityEntry[];
}

interface Track {
  entries: ActivityEntry[];
  /** Last turn state recorded, so a stream of 'active' records is one entry. */
  state?: 'turn' | 'done' | 'input';
  project?: string;
  projectAskedAt?: number;
  projectPending?: boolean;
}

function label(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length > MAX_LABEL_LENGTH ? value.slice(0, MAX_LABEL_LENGTH) + '…' : value;
}

/** The last segment of a POSIX or Windows path. */
export function folderName(dir: string): string | undefined {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? label(last) : undefined;
}

/** The working directory a transcript's first records carry, if any. */
export function cwdFromTranscriptHead(head: string): string | undefined {
  const match = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(head);
  if (!match) return undefined;
  try {
    const cwd = JSON.parse(match[1]) as unknown;
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
  } catch {
    return undefined;
  }
}

async function readHead(file: string): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(PROJECT_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, PROJECT_HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export class ActivityLog {
  private readonly tracks = new Map<number, Track>();
  private readonly now: () => number;
  private readonly max: number;
  private readonly onBroadcast = (message: Record<string, unknown>) => this.record(message);
  private readonly onAgentAdded = (id: number, agent: AgentState) => {
    this.push(id, { k: 'joined' });
    this.lookUpProject(id, agent);
  };
  private readonly onAgentRemoved = (id: number) => {
    this.tracks.delete(id);
  };

  constructor(
    private readonly store: AgentStateStore,
    options: { now?: () => number; max?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.max = options.max ?? ACTIVITY_MAX_ENTRIES;
    store.on('broadcast', this.onBroadcast);
    store.on('agentAdded', this.onAgentAdded);
    store.on('agentRemoved', this.onAgentRemoved);
  }

  dispose(): void {
    this.store.off('broadcast', this.onBroadcast);
    this.store.off('agentAdded', this.onAgentAdded);
    this.store.off('agentRemoved', this.onAgentRemoved);
    this.tracks.clear();
  }

  /** Every live agent's history, for a client that just connected. */
  snapshot(): AgentActivity[] {
    const out: AgentActivity[] = [];
    for (const [id, agent] of this.store) {
      this.lookUpProject(id, agent);
      const track = this.track(id);
      out.push({
        id,
        ...(track.project ? { project: track.project } : {}),
        entries: [...track.entries],
      });
    }
    return out;
  }

  private track(id: number): Track {
    let track = this.tracks.get(id);
    if (!track) {
      track = { entries: [] };
      this.tracks.set(id, track);
    }
    return track;
  }

  private push(id: number, entry: Omit<ActivityEntry, 't'>): void {
    if (!this.store.has(id)) return;
    const track = this.track(id);
    const full: ActivityEntry = { t: this.now(), ...entry };
    if (entry.k === 'tool' || entry.k === 'subtool') {
      const last = track.entries[track.entries.length - 1];
      if (
        last &&
        last.k === entry.k &&
        last.label === entry.label &&
        full.t - last.t < DUPLICATE_WINDOW_MS
      ) {
        return;
      }
    }
    track.entries.push(full);
    if (track.entries.length > this.max) track.entries.splice(0, track.entries.length - this.max);
    this.store.broadcast({ type: 'agentActivity', id, entry: full });
  }

  private state(id: number, state: 'turn' | 'done' | 'input'): void {
    if (!this.store.has(id)) return;
    const track = this.track(id);
    if (track.state === state) return;
    track.state = state;
    this.push(id, { k: state });
  }

  private record(message: Record<string, unknown>): void {
    const id = message.id;
    if (typeof id !== 'number') return;
    switch (message.type) {
      case 'agentStatus':
        if (message.status === 'active') this.state(id, 'turn');
        else if (message.status === 'waiting')
          this.state(id, message.awaitingInput === true ? 'input' : 'done');
        return;
      case 'agentToolStart':
        // A tool also means a turn, even when no 'active' status came first.
        this.state(id, 'turn');
        this.push(id, {
          k: 'tool',
          label: label(message.status) ?? 'Tool',
          toolId: typeof message.toolId === 'string' ? message.toolId : undefined,
        });
        return;
      case 'subagentToolStart':
        this.push(id, {
          k: 'subtool',
          label: label(message.status) ?? 'Subagent tool',
          toolId: typeof message.toolId === 'string' ? message.toolId : undefined,
        });
        return;
      case 'agentToolPermission':
      case 'subagentToolPermission':
        this.push(id, { k: 'permission' });
        return;
      default:
        return;
    }
  }

  /** The project folder's name, from the transcript's head. Asynchronous and
   *  best effort: a failure only leaves the name out. */
  private lookUpProject(id: number, agent: AgentState): void {
    const track = this.track(id);
    const now = this.now();
    if (track.project || track.projectPending || !agent.jsonlFile) return;
    if (track.projectAskedAt !== undefined && now - track.projectAskedAt < PROJECT_RETRY_MS) return;
    track.projectAskedAt = now;
    track.projectPending = true;
    readHead(agent.jsonlFile)
      .then((head) => {
        const cwd = cwdFromTranscriptHead(head);
        const project = cwd ? folderName(cwd) : undefined;
        const current = this.tracks.get(id);
        if (!project || !current || !this.store.has(id)) return;
        current.project = project;
        this.store.broadcast({ type: 'agentActivity', id, project });
      })
      .catch(() => {
        // Unreadable or gone: no name.
      })
      .finally(() => {
        const current = this.tracks.get(id);
        if (current) current.projectPending = false;
      });
  }
}
