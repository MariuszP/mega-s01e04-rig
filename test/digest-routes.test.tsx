import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const temporaryDirs: string[] = [];

function makeRunsDir(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  temporaryDirs.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
}

function event(at: string, job: string, owner: string | null, status: 'ok' | 'retry' | 'fail', error?: string) {
  return JSON.stringify({ at, job, owner, status, ...(error === undefined ? {} : { error }) });
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('renders and returns the same sorted rows, including warnings and null owners', async () => {
    const runsDir = makeRunsDir([
      '{bad json',
      event('2026-10-29T01:00:00+01:00', 'gamma', 'rook', 'fail', 'quota exceeded'),
      event('2026-10-29T01:00:00+01:00', 'beta', 'rook', 'retry', 'upstream 503'),
      event('2026-10-29T01:01:00+01:00', 'alpha', null, 'ok'),
      event('2026-10-29T01:02:00+01:00', 'beta', 'rook', 'retry'),
      event('2026-10-29T01:03:00+01:00', 'beta', 'rook', 'retry'),
      event('2026-10-29T01:04:00+01:00', 'beta', 'rook', 'ok'),
    ].join('\n'));
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

    const [page, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const rows: unknown = await json.json();

    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(rows).toEqual([
      {
        job: 'alpha', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T01:01:00+01:00', lastAt: '2026-10-29T01:01:00+01:00',
      },
      {
        job: 'beta', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T01:04:00+01:00',
      },
      {
        job: 'gamma', owner: 'rook', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T01:00:00+01:00',
      },
    ]);
    expect(Array.isArray(rows)).toBe(true);
    expect(html).toContain(`<h1>digest · ${night}</h1>`);
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('<td>—</td>');
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>beta</td>'));
    expect(html.indexOf('<td>beta</td>')).toBeLessThan(html.indexOf('<td>gamma</td>'));
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');
    expect(html).toContain('<style>');
    expect(html).toContain('<header>');
    expect(html).not.toMatch(/<script\b/i);
  });

  it('renders an empty existing night and returns an empty row array', async () => {
    const runsDir = makeRunsDir('');
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

    const [page, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual([]);
  });

  it('returns 404 for a missing file and an invalid night identifier on both routes', async () => {
    const runsDir = makeRunsDir();
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

    for (const path of ['/digest/2026-12-31', '/api/digest/2026-12-31', '/digest/not-a-night', '/api/digest/not-a-night']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});
