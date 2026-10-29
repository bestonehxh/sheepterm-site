import dashboard from './dashboard.js';
const TARGETS = {
  mac: { repo: "SheepTerm", pattern: /\.dmg$/i },
  windows: { repo: "SheepTerm-Windows", pattern: /\.zip$/i },
  linux: { repo: "SheepTerm-Linux", pattern: /linux-x86_64\.tar\.gz$/i },
  "linux-arm64": { repo: "SheepTerm-Linux", pattern: /linux-aarch64\.tar\.gz$/i }
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
async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join(''); }
function privateHeaders() { return { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'; form-action 'self'; base-uri 'self'" }; }
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
    if (url.pathname === "/api/download-stats") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (!await authorized(request, env)) return json({ error: 'Sign in required' }, 401);
      const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
      try {
        const result = await counter(env).fetch("https://counter/stats?days=" + days);
        const response = new Response(result.body, result);
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
      asset = (release.assets || []).find(a => target.pattern.test(a.name));
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
        test: url.searchParams.get("utm_source") === "test"
      };
      // Do not log URLs, IPs or full referrers. Only aggregate dimensions enter storage.
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
    this.sql.exec("INSERT OR IGNORE INTO metadata VALUES ('started_at', ?)", new Date().toISOString());
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/session/')) {
      const tokenHash = url.pathname.slice('/session/'.length);
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) return json({ error: 'invalid session' }, 400);
      const now = Date.now();
      this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
      if (request.method === 'POST') { this.sql.exec('INSERT OR REPLACE INTO sessions VALUES (?, ?)', tokenHash, now + 86400000); return json({ ok: true }); }
      return this.sql.exec('SELECT hash FROM sessions WHERE hash = ? AND expires > ?', tokenHash, now).toArray().length ? json({ ok: true }) : json({ error: 'expired' }, 401);
    }
    if (url.pathname === "/record" && request.method === "POST") {
      const e = await request.json();
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      this.sql.exec(`INSERT INTO counts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(day, platform, version, source, medium, campaign, placement, country, test)
        DO UPDATE SET count = count + 1`, day, e.platform, e.version, e.source, e.medium, e.campaign, e.placement, e.country, e.test ? 1 : 0);
      // Bound storage to 90 calendar days; no per-person event records are retained.
      this.sql.exec("DELETE FROM counts WHERE day < date(?, '-89 days')", day);
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
      countries: group("country"), campaigns: group("source, medium, campaign"), placements: group("placement"), daily: group("day")
    });
  }
}
