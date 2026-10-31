import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string'
    && Number.isFinite(Date.parse(event.at))
    && typeof event.job === 'string'
    && event.job.trim().length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (event.owner === null || typeof event.owner === 'string')
    && (!('error' in event) || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  let badLines = 0;
  const events: RunEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (isRunEvent(value)) events.push(value);
    else badLines++;
  }

  // Stable sorting keeps file order for events with the same timestamp.
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const jobs = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const event of events) {
    counts[event.status]++;
    const row = jobs.get(event.job) ?? {
      job: event.job,
      owner: event.owner,
      runs: 0,
      retries: 0,
      lastStatus: event.status,
      lastError: null,
      firstAt: event.at,
      lastAt: event.at,
    };
    row.owner = event.owner;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
    jobs.set(event.job, row);
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
