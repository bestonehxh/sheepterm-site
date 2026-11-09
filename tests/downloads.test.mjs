import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
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
test('private dashboard and API require a valid, unexpired owner session', async () => {
  const count = new DownloadCounter({ storage: { sql: sqlStore() } });
  const env = {
    STATS_PASSWORD_SHA256: createHash('sha256').update('test-private-password').digest('hex'),
    DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: (url, options) => count.fetch(new Request(url, options)) }) },
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) }
  };
  const ctx = { waitUntil() {} };
  const req = (path, options) => new Request('https://sheepterm.com' + path, options);
  const publicPage = await worker.fetch(req('/download-stats/'), env, ctx);
  assert.equal(publicPage.headers.get('Referrer-Policy'), 'same-origin');
  assert.match(await publicPage.text(), /Private statistics/);
  assert.equal((await worker.fetch(req('/api/download-stats'), env, ctx)).status, 401);
  const login = password => worker.fetch(req('/download-stats/login', { method: 'POST', headers: { Origin: 'https://sheepterm.com', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) }), env, ctx);
  assert.equal((await login('wrong')).status, 401);
  const crossOrigin = await worker.fetch(req('/download-stats/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=test-private-password' }), env, ctx);
  assert.equal(crossOrigin.status, 403);
  const good = await login('test-private-password');
  assert.equal(good.status, 303);
  assert.match(good.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const cookie = good.headers.get('Set-Cookie').split(';')[0];
  const page = await worker.fetch(req('/download-stats/', { headers: { Cookie: cookie } }), env, ctx);
  assert.match(await page.text(), /<h1>Downloads<\/h1>/);
  assert.match(page.headers.get('Cache-Control'), /no-store/);
  const stats = await worker.fetch(req('/api/download-stats', { headers: { Cookie: cookie } }), env, ctx);
  assert.equal(stats.status, 200);assert.match(stats.headers.get('Cache-Control'), /no-store/);
  assert.equal((await stats.json()).total, 0);
  assert.equal((await worker.fetch(req('/worker/dashboard.js'), env, ctx)).status, 404);
  count.sql.exec('UPDATE sessions SET expires = 0');
  assert.equal((await worker.fetch(req('/api/download-stats', { headers: { Cookie: cookie } }), env, ctx)).status, 401);
});
test('problem reports accept messages and are visible only to signed-in owner', async () => {
  const count = new DownloadCounter({ storage: { sql: sqlStore() } });
  const env = { STATS_PASSWORD_SHA256: createHash('sha256').update('secret').digest('hex'), DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: (url, options) => count.fetch(new Request(url, options)) }) }, ASSETS: { fetch: async () => new Response('asset') } };
  const ctx = { waitUntil() {} }, req = (path, options) => new Request('https://sheepterm.com' + path, options);
  const send = (message, origin = 'https://sheepterm.com') => worker.fetch(req('/api/reports', {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json', 'CF-Connecting-IP':'192.0.2.1'}, body:JSON.stringify({message})}), env, ctx);
  assert.equal((await send('Problem on Linux', 'https://evil.example')).status, 403);
  assert.equal((await send('  ')).status, 400);
  count.sql.exec("INSERT INTO reports (created_at, message) VALUES ('2026-01-01', 'Old private report')");
  assert.equal((await send('Problem on Linux')).status, 200);
  const publicReports = await (await worker.fetch(req('/api/public-reports'), env, ctx)).json();
  assert.deepEqual(publicReports.reports.map(r => r.message), ['Problem on Linux']);
  assert.equal((await worker.fetch(req('/api/reports'), env, ctx)).status, 401);
  const login = await worker.fetch(req('/download-stats/login', {method:'POST', headers:{Origin:'https://sheepterm.com', 'Content-Type':'application/x-www-form-urlencoded'}, body:'password=secret'}), env, ctx);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const reports = await worker.fetch(req('/api/reports', {headers:{Cookie:cookie}}), env, ctx);
  assert.equal((await reports.json()).reports[0].message, 'Problem on Linux');
  for (let i = 0; i < 9; i++) assert.equal((await send('Another report')).status, 200);
  assert.equal((await send('Too many')).status, 429);
});

test('Linux downloads select the requested architecture and prefer a single-file AppImage', async () => {
  const realFetch = globalThis.fetch;
  const repo = 'https://github.com/bestonehxh/SheepTerm-Linux/releases/download/v0.1-5/';
  const names = ['SheepTerm-0.1-5-linux-x86_64.tar.gz', 'SheepTerm-0.1-5-linux-aarch64.tar.gz', 'SheepTerm-0.1-5-linux-x86_64.AppImage', 'SheepTerm-0.1-5-linux-aarch64.AppImage'];
  globalThis.fetch = async () => Response.json({ tag_name: 'v0.1-5', assets: names.map(name => ({ name, browser_download_url: repo + name })) });
  const env = { DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
  const ctx = { waitUntil() {} };
  try {
    for (const [route, name] of [['linux', names[2]], ['linux-arm64', names[3]]]) {
      const res = await worker.fetch(new Request('https://sheepterm.com/download/' + route), env, ctx);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), repo + name);
    }
  } finally { globalThis.fetch = realFetch; }
});

test('Linux downloads support all package formats for x86_64 and ARM64', async () => {
  const realFetch = globalThis.fetch;
  const repo = 'https://github.com/bestonehxh/SheepTerm-Linux/releases/download/v0.1-5/';
  const assets = [
    'SheepTerm-0.1-5-linux-amd64.deb',
    'SheepTerm-0.1-5-linux-arm64.deb',
    'SheepTerm-0.1-5-linux-x86_64.rpm',
    'SheepTerm-0.1-5-linux-aarch64.rpm',
    'SheepTerm-0.1-5-linux-x86_64.AppImage',
    'SheepTerm-0.1-5-linux-aarch64.AppImage',
    'SheepTerm-0.1-5-linux-x86_64.tar.gz',
    'SheepTerm-0.1-5-linux-aarch64.tar.gz'
  ];
  globalThis.fetch = async () => Response.json({ tag_name: 'v0.1-5', assets: assets.map(name => ({ name, browser_download_url: repo + name })) });
  const env = { DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
  const ctx = { waitUntil() {} };
  const expected = [
    ['linux', 'SheepTerm-0.1-5-linux-x86_64.AppImage'],
    ['linux-arm64', 'SheepTerm-0.1-5-linux-aarch64.AppImage'],
    ['linux-appimage', 'SheepTerm-0.1-5-linux-x86_64.AppImage'],
    ['linux-arm64-appimage', 'SheepTerm-0.1-5-linux-aarch64.AppImage'],
    ['linux-deb', 'SheepTerm-0.1-5-linux-amd64.deb'],
    ['linux-arm64-deb', 'SheepTerm-0.1-5-linux-arm64.deb'],
    ['linux-rpm', 'SheepTerm-0.1-5-linux-x86_64.rpm'],
    ['linux-arm64-rpm', 'SheepTerm-0.1-5-linux-aarch64.rpm'],
    ['linux-tar', 'SheepTerm-0.1-5-linux-x86_64.tar.gz'],
    ['linux-arm64-tar', 'SheepTerm-0.1-5-linux-aarch64.tar.gz']
  ];
  try {
    for (const [route, expectedName] of expected) {
      const res = await worker.fetch(new Request('https://sheepterm.com/download/' + route), env, ctx);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), repo + expectedName);
    }
  } finally { globalThis.fetch = realFetch; }
});

test('each counted download keeps its time and a 30-day visitor code, never the address', async () => {
  const counter = new DownloadCounter({ storage: { sql: sqlStore() } });
  const ip = '198.51.100.23', ua = 'Mozilla/5.0 Safari';
  const fp = v => createHash('sha256').update(v).digest('hex');
  const record = (e) => counter.fetch(new Request('https://counter/record', { method: 'POST', body: JSON.stringify(e) }));
  const base = { platform: 'mac', version: 'v6.0-18', source: 'direct', medium: 'none', campaign: 'none', placement: 'hero', country: 'TH', test: false };
  await record({ ...base, fp: fp(ip + '\n' + ua) });
  await record({ ...base, fp: fp(ip + '\n' + ua), platform: 'windows' });
  await record({ ...base, fp: fp('203.0.113.9\n' + ua) });
  await record({ ...base, fp: 'not-a-digest' });
  await record({ ...base, fp: fp(ip + '\n' + ua), test: true });
  const report = await (await counter.fetch(new Request('https://counter/stats?days=7'))).json();
  assert.equal(report.total, 4);
  assert.equal(report.visitors, 2);                       // the bad digest has no code; test rows are left out
  assert.equal(report.recent.length, 4);
  assert.match(report.recent[0].ts, /^\d{4}-\d\d-\d\dT/);
  const codes = report.recent.map(r => r.visitor);
  assert.equal(codes[3], codes[2]);                        // same browser + address = same code
  assert.notEqual(codes[1], codes[2]);
  assert.equal(codes[0], null);
  assert.match(codes[2], /^[a-f0-9]{10}$/);
  assert.deepEqual(report.recent.map(r => r.times), [0, 1, 2, 2]);
  assert.deepEqual(report.daily.map(d => [d.count, d.visitors]), [[4, 2]]);
  // nothing in storage holds the address, the browser string or the digest
  const dump = JSON.stringify(['events', 'counts', 'metadata'].map(t => counter.sql.exec('SELECT * FROM ' + t).toArray()));
  for (const secret of [ip, ua, fp(ip + '\n' + ua)]) assert.equal(dump.includes(secret), false, secret);
  // a new 30-day period gives the same browser a new code
  const now = Date.now(), period = 30 * 86400000;
  const a = await counter.visitor(fp(ip + '\n' + ua), now), b = await counter.visitor(fp(ip + '\n' + ua), now + period);
  assert.equal(a, codes[2]); assert.notEqual(a, b);
  // the secret survives a restart: codes stay the same inside the period
  const restarted = new DownloadCounter({ storage: { sql: counter.sql } });
  assert.equal(await restarted.visitor(fp(ip + '\n' + ua), now), a);
});

test('daily rows come newest first and rows older than 90 days are removed', async () => {
  const counter = new DownloadCounter({ storage: { sql: sqlStore() } });
  for (const day of ['2026-01-01', '2099-01-03', '2099-01-02']) {
    counter.sql.exec("INSERT INTO counts VALUES (?, 'mac', 'v', 'direct', 'none', 'none', 'hero', 'TH', 0, 2)", day);
    counter.sql.exec("INSERT INTO events (ts, day, platform, visitor, test) VALUES ('x', ?, 'mac', 'aaaaaaaaaa', 0)", day);
  }
  const all = counter.sql.exec("SELECT day FROM counts WHERE day >= '2099-01-01' ORDER BY day DESC").toArray().map(r => r.day);
  assert.deepEqual(all, ['2099-01-03', '2099-01-02']);
  await counter.fetch(new Request('https://counter/record', { method: 'POST', body: JSON.stringify({ platform: 'mac', version: 'v', source: 'direct', medium: 'none', campaign: 'none', placement: 'hero', country: 'TH', test: false }) }));
  assert.equal(counter.sql.exec("SELECT COUNT(*) AS n FROM events WHERE day = '2026-01-01'").one().n, 0);
  assert.equal(counter.sql.exec("SELECT COUNT(*) AS n FROM counts WHERE day = '2026-01-01'").one().n, 0);
});

test('the stats API adds GitHub release counters and keeps one running total per platform per day', async () => {
  const realFetch = globalThis.fetch;
  const count = new DownloadCounter({ storage: { sql: sqlStore() } });
  const env = { STATS_PASSWORD_SHA256: createHash('sha256').update('pw').digest('hex'), DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: (url, options) => count.fetch(new Request(url, options)) }) }, ASSETS: { fetch: async () => new Response('asset') } };
  const ctx = { waitUntil() {} }, req = (path, options) => new Request('https://sheepterm.com' + path, options);
  let macCount = 10;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/SheepTerm-Linux/')) return new Response('down', { status: 503 });
    if (String(url).includes('/SheepTerm-Windows/')) return Response.json([{ tag_name: 'v2.0-1', published_at: '2026-11-01T00:00:00Z', assets: [{ download_count: 7 }] }]);
    return Response.json([{ tag_name: 'v6.0-18', published_at: '2026-11-02T00:00:00Z', assets: [{ download_count: macCount }, { download_count: 1 }] }, { tag_name: 'v6.0-17', published_at: '2026-10-30T00:00:00Z', assets: [{ download_count: 5 }] }]);
  };
  try {
    const login = await worker.fetch(req('/download-stats/login', { method: 'POST', headers: { Origin: 'https://sheepterm.com', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=pw' }), env, ctx);
    const cookie = login.headers.get('Set-Cookie').split(';')[0];
    const get = async () => (await worker.fetch(req('/api/download-stats', { headers: { Cookie: cookie } }), env, ctx)).json();
    let data = await get();
    assert.equal(data.github.mac.total, 16);
    assert.deepEqual(data.github.mac.releases[0], { tag: 'v6.0-18', published: '2026-11-02', count: 11 });
    assert.equal(data.github.windows.total, 7);
    assert.equal(data.github.linux, null);                  // GitHub down for one repo: the rest still shows
    macCount = 20; data = await get();
    assert.deepEqual(data.github_daily.map(r => [r.platform, r.total]), [['mac', 26], ['windows', 7]]);
    macCount = 3; data = await get();                       // a counter never goes back down within a day
    assert.equal(data.github_daily.find(r => r.platform === 'mac').total, 26);
  } finally { globalThis.fetch = realFetch; }
});

test('community feedback supports votes and owner-only status updates', async () => {
  const count = new DownloadCounter({ storage: { sql: sqlStore() } });
  const env = { STATS_PASSWORD_SHA256: createHash('sha256').update('secret').digest('hex'), DOWNLOADS: { idFromName: x => x, get: () => ({ fetch: (url, options) => count.fetch(new Request(url, options)) }) } };
  const ctx = { waitUntil() {} }, req = (path, options) => new Request('https://sheepterm.com' + path, options);
  const post = (path, body, cookie = '') => worker.fetch(req(path, { method: 'POST', headers: { Origin: 'https://sheepterm.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', Cookie: cookie }, body: JSON.stringify(body) }), env, ctx);
  assert.equal((await post('/api/reports', { message: 'Add RDP', type: 'feature' })).status, 200);
  let board = (await (await worker.fetch(req('/api/public-reports'), env, ctx)).json()).reports;
  assert.equal(board[0].type, 'feature'); assert.equal(board[0].status, 'open');
  const id = board[0].id, voter = 'a'.repeat(64);
  assert.equal((await (await post('/api/feedback-vote', { id, voter })).json()).votes, 1);
  assert.equal((await (await post('/api/feedback-vote', { id, voter })).json()).votes, 0);
  assert.equal((await post('/api/feedback-status', { id, status: 'planned' })).status, 403);
  const login = await worker.fetch(req('/download-stats/login', { method:'POST', headers:{Origin:'https://sheepterm.com', 'Content-Type':'application/x-www-form-urlencoded'}, body:'password=secret' }), env, ctx);
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await post('/api/feedback-status', { id, status: 'in-progress' }, cookie)).status, 200);
  board = (await (await worker.fetch(req('/api/public-reports'), env, ctx)).json()).reports;
  assert.equal(board[0].status, 'in-progress'); assert.equal(board[0].votes, 0);
  assert.equal((await post('/api/feedback-status', { id, status: 'fake' }, cookie)).status, 400);
  for (let i = 0; i < 58; i++) assert.equal((await post('/api/feedback-vote', { id, voter })).status, 200);
  assert.equal((await post('/api/feedback-vote', { id, voter })).status, 429);
});
