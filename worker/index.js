import dashboard from './dashboard.js';
import reportsPage from './reports.js';
const TARGETS = {
  mac: { repo: "SheepTerm", pattern: /\.dmg$/i },
  windows: { repo: "SheepTerm-Windows", pattern: /\.zip$/i },
  linux: { repo: "SheepTerm-Linux", pattern: /linux-x86_64\.(?:AppImage|tar\.gz)$/i },
  "linux-arm64": { repo: "SheepTerm-Linux", pattern: /linux-aarch64\.(?:AppImage|tar\.gz)$/i }
};
const clean = (value, fallback = "unknown") => /^[a-z0-9_.-]{1,64}$/i.test(value || "") ? value.toLowerCase() : fallback;
function refHost(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, "").slice(0, 100); } catch { return "direct"; }
}
function source(value, host) {
  const name = clean(value, "");
  if (["reddit", "facebook", "google", "github", "youtube", "linkedin", "x", "twitter", "app_update", "test"].includes(name)) return name;
  if (name) return "other";
  for (const [domain, label] of [["reddit.com", "reddit"], ["facebook.com", "facebook"], ["google.com", "google"], ["github.com", "github"], ["youtube.com", "youtube"], ["linkedin.com", "linkedin"], ["t.co", "x"]]) {
    if (host === domain || host.endsWith("." + domain)) return label;
  }
  return host === "direct" ? "direct" : host === "sheepterm.com" ? "website" : "other";
}
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function counter(env) { return env.DOWNLOADS.get(env.DOWNLOADS.idFromName("sheepterm-downloads-v1")); }
// GitHub's own counters: every download of a release asset (site links, in-app updates, direct). No dates, no people.
const GH_REPOS = { mac: "SheepTerm", windows: "SheepTerm-Windows", linux: "SheepTerm-Linux" };
async function githubCounts() {
  const out = {};
  await Promise.all(Object.entries(GH_REPOS).map(async ([platform, repo]) => {
    try {
      const r = await fetch("https://api.github.com/repos/bestonehxh/" + repo + "/releases?per_page=100", {
        headers: { "Accept": "application/vnd.github+json", "User-Agent": "SheepTerm-Downloads" }, cf: { cacheTtl: 300, cacheEverything: true }
      });
      if (!r.ok) throw new Error("github");
      const releases = (await r.json()).map(rel => ({
        tag: String(rel.tag_name || ""), published: String(rel.published_at || "").slice(0, 10),
        count: (rel.assets || []).reduce((n, a) => n + (Number(a.download_count) || 0), 0)
      }));
      out[platform] = { total: releases.reduce((n, r) => n + r.count, 0), releases };
    } catch { out[platform] = null; }
  }));
  return out;
}
async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join(''); }
// HTML form POSTs under no-referrer send Origin: null, which conflicts with
// the strict same-origin CSRF check. Keep referrers within our own origin.
function privateHeaders() { return { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'; form-action 'self'; base-uri 'self'" }; }
function loginPage(failed = false) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private statistics — SheepTerm</title><style>body{font:17px system-ui;background:#15171c;color:#eee;max-width:420px;margin:12vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border-radius:8px}a{color:#8abcf0}</style><h1>Private statistics</h1><p>Sign in with your private access password.</p>${failed ? '<p role="alert">Incorrect password. Please try again.</p>' : ''}<form method="post" action="/download-stats/login"><label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label><button type="submit">Sign in</button></form><a href="/">← SheepTerm</a></html>`, { status: failed ? 401 : 200, headers: { ...privateHeaders(), 'Content-Type': 'text/html;charset=UTF-8' } });
}
async function authorized(request, env) {
  const token = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith('__Host-sheepterm_stats='))?.split('=')[1];
  if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
  try { return (await counter(env).fetch('https://counter/session/' + await hash(token))).ok; } catch { return false; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/download-stats/login' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin || Number(request.headers.get('Content-Length') || 0) > 2048) return new Response('Forbidden', { status: 403 });
      const form = await request.formData();
      const password = form.get('password');
      if (typeof password !== 'string' || password.length > 128 || !env.STATS_PASSWORD_SHA256 || await hash(password) !== env.STATS_PASSWORD_SHA256) return loginPage(true);
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, '0')).join('');
      const saved = await counter(env).fetch('https://counter/session/' + await hash(token), { method: 'POST' });
      if (!saved.ok) return new Response('Sign in temporarily unavailable', { status: 503 });
      return new Response(null, { status: 303, headers: { ...privateHeaders(), Location: '/download-stats/', 'Set-Cookie': '__Host-sheepterm_stats=' + token + '; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Strict' } });
    }
    if (url.pathname === '/download-stats/logout' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
      return new Response(null, { status: 303, headers: { ...privateHeaders(), Location: '/download-stats/', 'Set-Cookie': '__Host-sheepterm_stats=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' } });
    }
    if (url.pathname === '/download-stats' || url.pathname.startsWith('/download-stats/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      if (!await authorized(request, env)) return loginPage();
      return new Response(request.method === 'HEAD' ? null : dashboard, { headers: { ...privateHeaders(), 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    if (url.pathname === '/reports' || url.pathname === '/reports/') {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!await authorized(request, env)) return new Response(null, { status: 303, headers: { ...privateHeaders(), Location: '/download-stats/' } });
      return new Response(reportsPage, { headers: { ...privateHeaders(), 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    if (url.pathname === '/api/public-reports') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      try { return await counter(env).fetch('https://counter/public-reports'); }
      catch { return json({ error: 'Reports unavailable' }, 503); }
    }
    if (url.pathname === '/api/reports') {
      if (request.method === 'GET') {
        if (!await authorized(request, env)) return json({ error: 'Sign in required' }, 401);
        try { const response = await counter(env).fetch('https://counter/reports'); return new Response(response.body, { status: response.status, headers: privateHeaders() }); }
        catch { return json({ error: 'Reports unavailable' }, 503); }
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Invalid content type' }, 415);
      try {
        const reader = request.body.getReader(); let bytes = 0, chunks = [];
        while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 8192) { await reader.cancel(); return json({ error: 'Report too long' }, 413); } chunks.push(part.value); }
        const input = JSON.parse(new TextDecoder().decode(Uint8Array.from(chunks.flatMap(c => Array.from(c)))));
        const message = typeof input.message === 'string' ? input.message.trim() : '';
        if (!message || message.length > 3000) return json({ error: 'Enter a message of up to 3000 characters' }, 400);
        const ip = request.headers.get('CF-Connecting-IP');
        if (!ip) return json({ error: 'Reports temporarily unavailable' }, 503);
        const key = await hash(ip + ':' + new Date().toISOString().slice(0, 10));
        return await counter(env).fetch('https://counter/reports', { method: 'POST', body: JSON.stringify({ message, key }) });
      } catch { return json({ error: 'Unable to submit report' }, 503); }
    }
    if (url.pathname === "/api/download-stats") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (!await authorized(request, env)) return json({ error: 'Sign in required' }, 401);
      const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
      try {
        const github = await githubCounts();
        const snapshot = Object.fromEntries(Object.entries(github).filter(([, v]) => v).map(([k, v]) => [k, v.total]));
        await counter(env).fetch("https://counter/github", { method: "POST", body: JSON.stringify(snapshot) });
        const report = await (await counter(env).fetch("https://counter/stats?days=" + days)).json();
        report.github = github;
        const response = json(report);
        for (const [key, value] of Object.entries(privateHeaders())) response.headers.set(key, value);
        return response;
      } catch { return json({ error: "Download statistics are temporarily unavailable." }, 503); }
    }
    if (!url.pathname.startsWith("/download/")) return env.ASSETS.fetch(request);
    const platform = url.pathname.slice("/download/".length).replace(/\/$/, "");
    const target = TARGETS[platform];
    if (!target) return new Response("Unknown platform", { status: 404 });
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
    const base = "https://github.com/bestonehxh/" + target.repo;
    let location = base + "/releases/latest", version = "", asset = null;
    try {
      const tag = url.searchParams.get("version");
      const suffix = /^v?\d+(?:\.\d+)*-\d+$/.test(tag || "") ? "tags/" + encodeURIComponent(tag) : "latest";
      const response = await fetch("https://api.github.com/repos/bestonehxh/" + target.repo + "/releases/" + suffix, {
        headers: { "Accept": "application/vnd.github+json", "User-Agent": "SheepTerm-Downloads" }, cf: { cacheTtl: 300, cacheEverything: true }
      });
      if (!response.ok) throw new Error("release unavailable");
      const release = await response.json();
      const matches = (release.assets || []).filter(a => target.pattern.test(a.name));
      asset = matches.find(a => /\.AppImage$/i.test(a.name)) || matches[0];
      if (!asset && platform === "mac") asset = (release.assets || []).find(a => /\.zip$/i.test(a.name));
      if (asset && asset.browser_download_url.startsWith(base + "/releases/download/")) {
        location = asset.browser_download_url;
        version = release.tag_name;
      } else { asset = null; }
    } catch { /* A GitHub/API outage must not strand a download button. */ }
    const isBot = /bot|crawler|spider|headless|curl|wget|python|preview|facebookexternalhit/i.test(request.headers.get("User-Agent") || "") || request.cf?.botManagement?.verifiedBot;
    const prefetch = /prefetch|prerender/i.test((request.headers.get("Purpose") || "") + (request.headers.get("Sec-Purpose") || ""));
    const privacyOptOut = request.headers.get("Sec-GPC") === "1" || request.headers.get("DNT") === "1";
    const tracked = !!asset && request.method === "GET" && !isBot && !prefetch && !privacyOptOut;
    if (tracked) {
      const referrer = refHost(url.searchParams.get("ref") || request.headers.get("Referer"));
      const event = {
        platform, version, source: source(url.searchParams.get("utm_source"), referrer),
        medium: clean(url.searchParams.get("utm_medium"), "none"), campaign: clean(url.searchParams.get("utm_campaign"), "none"),
        placement: clean(url.searchParams.get("placement"), "link"),
        country: /^[A-Z]{2}$/.test(request.cf?.country || "") ? request.cf.country : "XX",
        test: url.searchParams.get("utm_source") === "test",
        // One-way digest of address + browser, never stored: the counter re-keys it with a secret that changes every 30 days.
        fp: await hash((request.headers.get("CF-Connecting-IP") || "") + "\n" + (request.headers.get("User-Agent") || ""))
      };
      // Do not log URLs, IPs or full referrers. Storage keeps the aggregates, plus per-download rows with a 30-day visitor code.
      ctx.waitUntil(counter(env).fetch("https://counter/record", { method: "POST", body: JSON.stringify(event) }).then(r => {
        if (!r.ok) throw new Error("counter unavailable");
      }).catch(() => console.error("download_counter_write_failed")));
    }
    return new Response(null, { status: 302, headers: {
      "Location": location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex", "X-Download-Tracking": tracked ? "eligible" : "excluded"
    } });
  }
};

export class DownloadCounter {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS counts (
      day TEXT, platform TEXT, version TEXT, source TEXT, medium TEXT, campaign TEXT,
      placement TEXT, country TEXT, test INTEGER, count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, platform, version, source, medium, campaign, placement, country, test)
    )`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, message TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS public_reports (report_id INTEGER PRIMARY KEY)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS report_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)");
    this.sql.exec("INSERT OR IGNORE INTO metadata VALUES ('started_at', ?)", new Date().toISOString());
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL,
      platform TEXT, version TEXT, source TEXT, placement TEXT, country TEXT, visitor TEXT, test INTEGER)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS events_day ON events(day)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS github_daily (day TEXT, platform TEXT, total INTEGER NOT NULL, PRIMARY KEY(day, platform))");
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, "0")).join("");
    this.sql.exec("INSERT OR IGNORE INTO metadata VALUES ('visitor_secret', ?)", secret);
  }
  // Visitor code: HMAC(secret + 30-day period, fingerprint digest), 10 hex chars. The same browser on the same address
  // gets the same code inside one 30-day period; a new period gives every visitor a new code.
  async visitor(fp, now = Date.now()) {
    if (!/^[a-f0-9]{64}$/.test(fp || "")) return null;
    const secret = this.sql.exec("SELECT value FROM metadata WHERE key = 'visitor_secret'").one().value;
    const period = Math.floor(now / 86400000 / 30);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret + ":" + period), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(fp)));
    return Array.from(mac.slice(0, 5)).map(x => x.toString(16).padStart(2, "0")).join("");
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/github" && request.method === "POST") {
      const totals = await request.json();
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      for (const [platform, total] of Object.entries(totals || {})) {
        if (!(platform in GH_REPOS) || !Number.isFinite(total)) continue;
        this.sql.exec("INSERT INTO github_daily VALUES (?, ?, ?) ON CONFLICT(day, platform) DO UPDATE SET total = MAX(total, excluded.total)", day, platform, Math.floor(total));
      }
      this.sql.exec("DELETE FROM github_daily WHERE day < date(?, '-89 days')", day);
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/session/')) {
      const tokenHash = url.pathname.slice('/session/'.length);
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) return json({ error: 'invalid session' }, 400);
      const now = Date.now();
      this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
      if (request.method === 'POST') { this.sql.exec('INSERT OR REPLACE INTO sessions VALUES (?, ?)', tokenHash, now + 86400000); return json({ ok: true }); }
      return this.sql.exec('SELECT hash FROM sessions WHERE hash = ? AND expires > ?', tokenHash, now).toArray().length ? json({ ok: true }) : json({ error: 'expired' }, 401);
    }
    if (url.pathname === '/public-reports' && request.method === 'GET') return json({ reports: this.sql.exec('SELECT reports.id, created_at, message FROM reports JOIN public_reports ON reports.id = public_reports.report_id ORDER BY reports.id DESC LIMIT 100').toArray() });
    if (url.pathname === '/reports' && request.method === 'GET') return json({ reports: this.sql.exec('SELECT id, created_at, message FROM reports ORDER BY id DESC LIMIT 500').toArray() });
    if (url.pathname === '/reports' && request.method === 'POST') {
      const { message, key } = await request.json(); const now = Date.now();
      this.sql.exec('DELETE FROM report_limits WHERE expires < ?', now);
      const current = this.sql.exec('SELECT count FROM report_limits WHERE key = ?', key).toArray()[0];
      if (current && current.count >= 10) return json({ error: 'Too many reports. Please try again tomorrow.' }, 429);
      this.sql.exec('INSERT INTO report_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1', key, now + 86400000);
      this.sql.exec('INSERT INTO reports (created_at, message) VALUES (?, ?)', new Date().toISOString(), message);
      this.sql.exec('INSERT INTO public_reports (report_id) VALUES (last_insert_rowid())');
      return json({ ok: true });
    }
    if (url.pathname === "/record" && request.method === "POST") {
      const e = await request.json();
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      this.sql.exec(`INSERT INTO counts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(day, platform, version, source, medium, campaign, placement, country, test)
        DO UPDATE SET count = count + 1`, day, e.platform, e.version, e.source, e.medium, e.campaign, e.placement, e.country, e.test ? 1 : 0);
      this.sql.exec("INSERT INTO events (ts, day, platform, version, source, placement, country, visitor, test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        new Date().toISOString(), day, e.platform, e.version, e.source, e.placement, e.country, await this.visitor(e.fp), e.test ? 1 : 0);
      // Bound storage to 90 calendar days. No address, browser string or digest of them is stored, only the visitor code.
      this.sql.exec("DELETE FROM counts WHERE day < date(?, '-89 days')", day);
      this.sql.exec("DELETE FROM events WHERE day < date(?, '-89 days')", day);
      return json({ ok: true });
    }
    if (url.pathname !== "/stats") return new Response("Not found", { status: 404 });
    const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    const where = "WHERE test = 0 AND day >= date(?, ?)";
    const args = [today, "-" + (days - 1) + " days"];
    const group = (columns) => this.sql.exec(`SELECT ${columns}, SUM(count) AS count FROM counts ${where} GROUP BY ${columns} ORDER BY count DESC LIMIT 100`, ...args).toArray();
    return json({
      started_at: this.sql.exec("SELECT value FROM metadata WHERE key = 'started_at'").one().value,
      days, timezone: "Asia/Bangkok", generated_at: new Date().toISOString(),
      total: this.sql.exec(`SELECT COALESCE(SUM(count), 0) AS total FROM counts ${where}`, ...args).one().total,
      test_requests: this.sql.exec("SELECT COALESCE(SUM(count), 0) AS total FROM counts WHERE test = 1").one().total,
      platforms: group("platform"), versions: group("platform, version"), sources: group("source"),
      countries: group("country"), campaigns: group("source, medium, campaign"), placements: group("placement"),
      // newest day first; visitors = distinct visitor codes that day (rows recorded before codes existed have none)
      daily: this.sql.exec(`SELECT c.day, SUM(c.count) AS count, (SELECT COUNT(DISTINCT visitor) FROM events e WHERE e.day = c.day AND e.test = 0) AS visitors
        FROM counts c ${where.replace("WHERE test", "WHERE c.test").replace("AND day", "AND c.day")} GROUP BY c.day ORDER BY c.day DESC`, ...args).toArray(),
      visitors: this.sql.exec(`SELECT COUNT(DISTINCT visitor) AS n FROM events ${where}`, ...args).one().n,
      events_since: this.sql.exec("SELECT MIN(ts) AS ts FROM events").one().ts,
      recent: this.sql.exec(`SELECT ts, platform, version, country, source, placement, visitor,
        (SELECT COUNT(*) FROM events b WHERE b.visitor = a.visitor AND b.test = 0 AND b.day >= date(?, ?)) AS times
        FROM events a ${where} ORDER BY id DESC LIMIT 300`, ...args, ...args).toArray(),
      github_daily: this.sql.exec("SELECT day, platform, total FROM github_daily ORDER BY day DESC, platform").toArray()
    });
  }
}
