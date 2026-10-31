import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const temporaryDirs: string[] = [];

function writeNight(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  temporaryDirs.push(dir);
  writeFileSync(join(dir, `${night}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n'));
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real night without dropping null owners or the error before recovery', () => {
    const digest = readNight('runs', night);
    expect(digest).toMatchObject({ night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1, lastError: null });
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('orders by instants, preserves offsets, and uses file order for ties', () => {
    const dir = writeNight([
      { at: '2026-10-29T03:00:00+03:00', job: 'job', owner: 'later', status: 'ok' },
      { at: '2026-10-29T01:30:00+02:00', job: 'job', owner: 'middle', status: 'retry', error: 'latest error' },
      { at: '2026-10-29T02:00:00+03:00', job: 'job', owner: 'first', status: 'fail', error: 'older error' },
      { at: '2026-10-29T01:00:00+01:00', job: 'job', owner: null, status: 'ok' },
    ]);
    expect(readNight(dir, night)).toEqual({
      night, badLines: 0, counts: { ok: 2, retry: 1, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 4, retries: 1, lastStatus: 'ok', lastError: 'latest error',
        firstAt: '2026-10-29T02:00:00+03:00', lastAt: '2026-10-29T01:00:00+01:00',
      }],
    });
  });

  it('counts invalid nonblank JSON and shapes while ignoring blank lines', () => {
    const valid = { at: '2026-10-29T01:00:00+01:00', job: 'job', owner: null, status: 'ok' };
    const invalid = [
      null, [], 1, {}, { ...valid, at: 'invalid' }, { ...valid, at: 0 },
      { ...valid, job: '' }, { ...valid, job: 1 }, { ...valid, status: 'unknown' },
      { ...valid, owner: undefined }, { ...valid, owner: 1 }, { ...valid, error: null },
    ];
    const dir = writeNight([]);
    writeFileSync(join(dir, `${night}.jsonl`), [
      '', '  ', '\r', '{bad json', ...invalid.map(value => JSON.stringify(value)), JSON.stringify(valid), '',
    ].join('\n'));
    expect(readNight(dir, night)).toMatchObject({ badLines: invalid.length + 1, counts: { ok: 1, retry: 0, fail: 0 } });
    expect(readNight(dir, night)?.rows).toHaveLength(1);
  });

  it('uses code-unit job order and permits an explicitly empty error', () => {
    const dir = writeNight(['z', 'a', 'Z', 'A'].map(job => ({
      at: '2026-10-29T01:00:00+01:00', job, owner: null, status: 'fail', error: '',
    })));
    expect(readNight(dir, night)?.rows.map(row => [row.job, row.lastError])).toEqual([
      ['A', ''], ['Z', ''], ['a', ''], ['z', ''],
    ]);
  });

  it('distinguishes an empty night from a missing file and rejects unsafe identifiers', () => {
    const dir = writeNight([]);
    expect(readNight(dir, night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-27')).toBeNull();
    for (const identifier of ['', '../2026-10-28', '2026-10-28/../../other', '2026-1-2', '2026-10-28\n']) {
      expect(readNight(dir, identifier)).toBeNull();
    }
  });

  it('propagates filesystem failures other than a missing file', () => {
    const dir = writeNight([]);
    rmSync(join(dir, `${night}.jsonl`));
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
