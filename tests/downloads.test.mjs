import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { DownloadCounter } from '../worker/index.js';

function sqlStore() {
  const db = new DatabaseSync(':memory:');
  return { exec(query, ...args) {
    const stmt = db.prepare(query);
    const rows = stmt.columns().length ? stmt.all(...args).map(r => ({ ...r })) : (stmt.run(...args), []);
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } };
  } };
}
test('counter persists atomic aggregates and excludes test campaigns from every report', async () => {
  const counter = new DownloadCounter({ storage: { sql: sqlStore() } });
  const event = { platform: 'mac', version: 'v6.0-13', source: 'reddit', medium: 'social', campaign: 'launch', placement: 'hero', country: 'BR', test: false };
  for (let i = 0; i < 3; i++) await counter.fetch(new Request('https://counter/record', { method: 'POST', body: JSON.stringify(event) }));
  await counter.fetch(new Request('https://counter/record', { method: 'POST', body: JSON.stringify({ ...event, test: true }) }));
  const report = await (await counter.fetch(new Request('https://counter/stats?days=30'))).json();
  assert.equal(report.total, 3);
  assert.equal(report.test_requests, 1);
  assert.deepEqual(report.countries, [{ country: 'BR', count: 3 }]);
  assert.equal(report.campaigns[0].source, 'reddit');
  assert.equal(report.versions[0].version, 'v6.0-13');
  const restarted = new DownloadCounter({ storage: { sql: counter.sql } });
  assert.equal((await (await restarted.fetch(new Request('https://counter/stats'))).json()).total, 3);
});
test('redirects validate targets, preserve attribution, and exclude non-download requests', async () => {
  const realFetch = globalThis.fetch;
  const recorded = [], pending = [];
  const env = { DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: async (url, init) => { recorded.push(JSON.parse(init.body)); return Response.json({ ok: true }); } }) } };
  const ctx = { waitUntil: p => pending.push(p) };
  globalThis.fetch = async () => Response.json({ tag_name: 'v6.0-13', assets: [{ name: 'SheepTerm.dmg', browser_download_url: 'https://github.com/bestonehxh/SheepTerm/releases/download/v6.0-13/SheepTerm.dmg' }] });
  const make = (path, method = 'GET', extra = {}) => {
    const req = new Request('https://sheepterm.com' + path, { method, headers: { 'User-Agent': 'Mozilla/5.0 Safari', ...extra } });
    Object.defineProperty(req, 'cf', { value: { country: 'BR' } }); return req;
  };
  try {
    const response = await worker.fetch(make('/download/mac?utm_source=reddit&utm_medium=social&utm_campaign=launch&placement=hero&url=https://evil.example'), env, ctx);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), 'https://github.com/bestonehxh/SheepTerm/releases/download/v6.0-13/SheepTerm.dmg');
    await Promise.all(pending);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].source, 'reddit'); assert.equal(recorded[0].country, 'BR');
    assert.equal('ip' in recorded[0], false);
    for (const [method, headers] of [['HEAD', {}], ['GET', { 'DNT': '1' }], ['GET', { 'Sec-GPC': '1' }], ['GET', { 'Purpose': 'prefetch' }], ['GET', { 'User-Agent': 'curl/8' }]]) {
      const result = await worker.fetch(make('/download/mac', method, headers), env, ctx);
      assert.equal(result.status, 302); assert.equal(result.headers.get('X-Download-Tracking'), 'excluded');
    }
    assert.equal(recorded.length, 1);
    assert.equal((await worker.fetch(make('/download/evil'), env, ctx)).status, 404);
    assert.equal((await worker.fetch(make('/download/mac', 'POST'), env, ctx)).status, 405);
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    const fallback = await worker.fetch(make('/download/mac'), env, ctx);
    assert.equal(fallback.headers.get('Location'), 'https://github.com/bestonehxh/SheepTerm/releases/latest');
    assert.equal(recorded.length, 1);
  } finally { globalThis.fetch = realFetch; }
});
