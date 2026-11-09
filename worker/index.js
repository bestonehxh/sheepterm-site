import dashboard from './dashboard.js';
import reportsPage from './reports.js';
const TARGETS = {
  mac: { repo: "SheepTerm", pattern: /\.dmg$/i },
  windows: { repo: "SheepTerm-Windows", pattern: /\.zip$/i },
  linux: { repo: "SheepTerm-Linux", pattern: /linux-x86_64\.(?:AppImage|tar\.gz)$/i },
  "linux-arm64": { repo: "SheepTerm-Linux", pattern: /linux-aarch64\.(?:AppImage|tar\.gz)$/i },
  "linux-appimage": { repo: "SheepTerm-Linux", pattern: /linux-x86_64\.AppImage$/i },
  "linux-arm64-appimage": { repo: "SheepTerm-Linux", pattern: /linux-aarch64\.AppImage$/i },
  "linux-deb": { repo: "SheepTerm-Linux", pattern: /linux-amd64\.deb$/i },
  "linux-arm64-deb": { repo: "SheepTerm-Linux", pattern: /linux-arm64\.deb$/i },
  "linux-rpm": { repo: "SheepTerm-Linux", pattern: /linux-x86_64\.rpm$/i },
  "linux-arm64-rpm": { repo: "SheepTerm-Linux", pattern: /linux-aarch64\.rpm$/i },
  "linux-tar": { repo: "SheepTerm-Linux", pattern: /linux-x86_64\.tar\.gz$/i },
  "linux-arm64-tar": { repo: "SheepTerm-Linux", pattern: /linux-aarch64\.tar\.gz$/i }
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

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x => x.toString(16).padStart(2, '0')).join('');
function cookieValue(request, name) { return (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || ''; }
async function communityUser(request, env) {
  const token = cookieValue(request, '__Host-sheepterm_community');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  try { const r = await counter(env).fetch('https://counter/community-session/' + await hash(token)); return r.ok ? await r.json() : null; } catch { return null; }
}
const communityCookie = (name, value, age, sameSite = 'Lax') => `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=${sameSite}`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/auth/google' && request.method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response('Google sign-in is not configured yet.', { status: 503, headers: privateHeaders() });
      const state = randomToken(), verifier = randomToken();
      const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      google.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + '/auth/google/callback', response_type: 'code', scope: 'openid', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
      return new Response(null, { status: 302, headers: { ...privateHeaders(), Location: google.toString(), 'Set-Cookie': communityCookie('__Host-sheepterm_oauth', state + '.' + verifier, 600) } });
    }
    if (url.pathname === '/auth/google/callback' && request.method === 'GET') {
      const [state, verifier] = cookieValue(request, '__Host-sheepterm_oauth').split('.');
      const code = url.searchParams.get('code');
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !/^[a-f0-9]{64}$/.test(state || '') || !/^[a-f0-9]{64}$/.test(verifier || '') || state !== url.searchParams.get('state') || !code) return new Response('Sign-in failed. Please try again.', { status: 400, headers: privateHeaders() });
      try {
        const tokenResult = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: verifier }) });
        if (!tokenResult.ok) throw Error('token');
        const tokenData = await tokenResult.json();
        if (!tokenData.access_token) throw Error('token');
        const profileResult = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tokenData.access_token } });
        if (!profileResult.ok) throw Error('profile');
        const profile = await profileResult.json();
        if (typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255) throw Error('profile');
        const session = randomToken(), user = await hash('google:' + profile.sub);
        const saved = await counter(env).fetch('https://counter/community-session/' + await hash(session), { method: 'POST', body: JSON.stringify({ user }) });
        if (!saved.ok) throw Error('session');
        const headers = new Headers({ ...privateHeaders(), Location: '/report/' });
        headers.append('Set-Cookie', communityCookie('__Host-sheepterm_community', session, 604800));
        headers.append('Set-Cookie', communityCookie('__Host-sheepterm_oauth', '', 0));
        return new Response(null, { status: 303, headers });
      } catch { return new Response('Sign-in is temporarily unavailable. Please try again.', { status: 503, headers: privateHeaders() }); }
    }
    if (url.pathname === '/api/community-session' && request.method === 'GET') return json({ signedIn: Boolean(await communityUser(request, env)) });
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403);
      const token = cookieValue(request, '__Host-sheepterm_community');
      if (/^[a-f0-9]{64}$/.test(token)) await counter(env).fetch('https://counter/community-session/' + await hash(token), { method: 'DELETE' });
      return new Response(null, { status: 303, headers: { ...privateHeaders(), Location: '/report/', 'Set-Cookie': communityCookie('__Host-sheepterm_community', '', 0, 'Strict') } });
    }
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
    if (url.pathname === '/api/feedback-vote') {
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return json({ error: 'Forbidden' }, 403);
      const user = await communityUser(request, env);
      if (!user) return json({ error: 'Sign in with Google to vote.' }, 401);
      try {
        if (Number(request.headers.get('Content-Length') || 0) > 1024) return json({ error: 'Request too large' }, 413);
        const input = await request.json();
        const ip = request.headers.get('CF-Connecting-IP');
        if (!ip) return json({ error: 'Voting temporarily unavailable' }, 503);
        input.key = await hash('vote:' + ip + ':' + new Date().toISOString().slice(0, 10));
        input.voter = user.user;
        if (!Number.isSafeInteger(input.id) || input.id < 1 || !/^[a-f0-9]{64}$/.test(input.voter || '')) return json({ error: 'Invalid vote' }, 400);
        return await counter(env).fetch('https://counter/vote', { method: 'POST', body: JSON.stringify(input) });
      } catch { return json({ error: 'Unable to vote' }, 400); }
    }
    if (url.pathname === '/api/feedback-edit') {
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin || !await authorized(request, env)) return json({ error: 'Forbidden' }, 403);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Invalid content type' }, 415);
      try {
        const input = await request.json();
        if (!Number.isSafeInteger(input.id) || input.id < 1 || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 3000 || typeof input.reply !== 'string' || input.reply.length > 3000) return json({ error: 'Invalid feedback' }, 400);
        return await counter(env).fetch('https://counter/feedback-edit', { method: 'POST', body: JSON.stringify({ id: input.id, message: input.message.trim(), reply: input.reply.trim() }) });
      } catch { return json({ error: 'Unable to save changes' }, 400); }
    }
    if (url.pathname === '/api/feedback-status') {
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin || !await authorized(request, env)) return json({ error: 'Forbidden' }, 403);
      try {
        const input = await request.json();
        if (!Number.isSafeInteger(input.id) || !['open', 'under-review', 'planned', 'in-progress', 'completed', 'closed'].includes(input.status)) return json({ error: 'Invalid status' }, 400);
        return await counter(env).fetch('https://counter/status', { method: 'POST', body: JSON.stringify(input) });
      } catch { return json({ error: 'Unable to update status' }, 400); }
    }
    if (url.pathname === '/api/public-reports') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      try { const user = await communityUser(request, env); return await counter(env).fetch('https://counter/public-reports' + (user ? '?voter=' + user.user : '')); }
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
      if (!await communityUser(request, env)) return json({ error: 'Sign in with Google to post.' }, 401);
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
        return await counter(env).fetch('https://counter/reports', { method: 'POST', body: JSON.stringify({ message, key, type: input.type === 'feature' ? 'feature' : 'bug' }) });
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
    this.sql.exec("CREATE TABLE IF NOT EXISTS community_sessions (hash TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, message TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS public_reports (report_id INTEGER PRIMARY KEY)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS feedback_details (report_id INTEGER PRIMARY KEY, type TEXT NOT NULL DEFAULT 'bug', status TEXT NOT NULL DEFAULT 'open')");
    this.sql.exec("CREATE TABLE IF NOT EXISTS feedback_replies (report_id INTEGER PRIMARY KEY, message TEXT NOT NULL, updated_at TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS feedback_votes (report_id INTEGER NOT NULL, voter TEXT NOT NULL, PRIMARY KEY(report_id, voter))");
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
    if (url.pathname.startsWith('/community-session/')) {
      const tokenHash = url.pathname.slice('/community-session/'.length);
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) return json({ error: 'invalid session' }, 400);
      this.sql.exec('DELETE FROM community_sessions WHERE expires < ?', Date.now());
      if (request.method === 'POST') { const { user } = await request.json(); if (!/^[a-f0-9]{64}$/.test(user || '')) return json({ error: 'invalid user' }, 400); this.sql.exec('INSERT OR REPLACE INTO community_sessions VALUES (?, ?, ?)', tokenHash, user, Date.now() + 604800000); return json({ ok: true }); }
      if (request.method === 'DELETE') { this.sql.exec('DELETE FROM community_sessions WHERE hash = ?', tokenHash); return json({ ok: true }); }
      const row = this.sql.exec('SELECT user FROM community_sessions WHERE hash = ? AND expires > ?', tokenHash, Date.now()).toArray()[0];
      return row ? json(row) : json({ error: 'expired' }, 401);
    }
    if (url.pathname.startsWith('/session/')) {
      const tokenHash = url.pathname.slice('/session/'.length);
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) return json({ error: 'invalid session' }, 400);
      const now = Date.now();
      this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
      if (request.method === 'POST') { this.sql.exec('INSERT OR REPLACE INTO sessions VALUES (?, ?)', tokenHash, now + 86400000); return json({ ok: true }); }
      return this.sql.exec('SELECT hash FROM sessions WHERE hash = ? AND expires > ?', tokenHash, now).toArray().length ? json({ ok: true }) : json({ error: 'expired' }, 401);
    }
    if (url.pathname === '/public-reports' && request.method === 'GET') {
      const voter = url.searchParams.get('voter') || '';
      return json({ reports: this.sql.exec(`SELECT reports.id, created_at, message, COALESCE(feedback_details.type, 'bug') AS type, COALESCE(feedback_details.status, 'open') AS status, (SELECT COUNT(*) FROM feedback_votes WHERE report_id = reports.id) AS votes, COALESCE((SELECT message FROM feedback_replies WHERE report_id = reports.id), '') AS reply, EXISTS(SELECT 1 FROM feedback_votes WHERE report_id = reports.id AND voter = ?) AS voted FROM reports JOIN public_reports ON reports.id = public_reports.report_id LEFT JOIN feedback_details ON reports.id = feedback_details.report_id ORDER BY reports.id DESC`, voter).toArray() });
    }
    if (url.pathname === '/reports' && request.method === 'GET') return json({ reports: this.sql.exec(`SELECT reports.id, created_at, message, COALESCE(feedback_details.type, 'bug') AS type, COALESCE(feedback_details.status, 'open') AS status, COALESCE((SELECT message FROM feedback_replies WHERE report_id = reports.id), '') AS reply FROM reports LEFT JOIN feedback_details ON reports.id = feedback_details.report_id ORDER BY reports.id DESC LIMIT 500`).toArray() });
    if (url.pathname === '/reports' && request.method === 'POST') {
      const { message, key, type } = await request.json(); const now = Date.now();
      this.sql.exec('DELETE FROM report_limits WHERE expires < ?', now);
      const current = this.sql.exec('SELECT count FROM report_limits WHERE key = ?', key).toArray()[0];
      if (current && current.count >= 10) return json({ error: 'Too many reports. Please try again tomorrow.' }, 429);
      this.sql.exec('INSERT INTO report_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1', key, now + 86400000);
      this.sql.exec('INSERT INTO reports (created_at, message) VALUES (?, ?)', new Date().toISOString(), message);
      const id = this.sql.exec('SELECT last_insert_rowid() AS id').one().id;
      this.sql.exec('INSERT INTO public_reports (report_id) VALUES (?)', id);
      this.sql.exec('INSERT INTO feedback_details (report_id, type) VALUES (?, ?)', id, type === 'feature' ? 'feature' : 'bug');
      return json({ ok: true });
    }
    if (url.pathname === '/vote' && request.method === 'POST') {
      const { id, voter, key } = await request.json();
      const now = Date.now();
      this.sql.exec('DELETE FROM report_limits WHERE expires < ?', now);
      const current = this.sql.exec('SELECT count FROM report_limits WHERE key = ?', key).toArray()[0];
      if (current && current.count >= 60) return json({ error: 'Too many votes. Please try again tomorrow.' }, 429);
      this.sql.exec('INSERT INTO report_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1', key, now + 86400000);
      if (!this.sql.exec('SELECT report_id FROM public_reports WHERE report_id = ?', id).toArray().length) return json({ error: 'Not found' }, 404);
      const exists = this.sql.exec('SELECT 1 FROM feedback_votes WHERE report_id = ? AND voter = ?', id, voter).toArray().length;
      if (exists) this.sql.exec('DELETE FROM feedback_votes WHERE report_id = ? AND voter = ?', id, voter);
      else this.sql.exec('INSERT INTO feedback_votes (report_id, voter) VALUES (?, ?)', id, voter);
      const votes = this.sql.exec('SELECT COUNT(*) AS count FROM feedback_votes WHERE report_id = ?', id).one().count;
      if (votes > 20) this.sql.exec("UPDATE feedback_details SET status = 'under-review' WHERE report_id = ? AND type = 'feature' AND status = 'open'", id);
      const status = this.sql.exec("SELECT COALESCE((SELECT status FROM feedback_details WHERE report_id = ?), 'open') AS status", id).one().status;
      return json({ votes, voted: !exists, status });
    }
    if (url.pathname === '/feedback-edit' && request.method === 'POST') {
      const { id, message, reply } = await request.json();
      if (!this.sql.exec('SELECT id FROM reports WHERE id = ?', id).toArray().length) return json({ error: 'Not found' }, 404);
      this.sql.exec('UPDATE reports SET message = ? WHERE id = ?', message, id);
      if (reply) this.sql.exec('INSERT INTO feedback_replies (report_id, message, updated_at) VALUES (?, ?, ?) ON CONFLICT(report_id) DO UPDATE SET message = excluded.message, updated_at = excluded.updated_at', id, reply, new Date().toISOString());
      else this.sql.exec('DELETE FROM feedback_replies WHERE report_id = ?', id);
      return json({ ok: true });
    }
    if (url.pathname === '/status' && request.method === 'POST') {
      const { id, status } = await request.json();
      if (!this.sql.exec('SELECT id FROM reports WHERE id = ?', id).toArray().length) return json({ error: 'Not found' }, 404);
      this.sql.exec("INSERT INTO feedback_details (report_id, status) VALUES (?, ?) ON CONFLICT(report_id) DO UPDATE SET status = excluded.status", id, status);
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
