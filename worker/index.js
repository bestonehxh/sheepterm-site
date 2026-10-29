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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/download-stats") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
      const cacheKey = new Request(url.origin + "/api/download-stats?days=" + days);
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;
      try {
        const result = await counter(env).fetch("https://counter/stats?days=" + days);
        const response = new Response(result.body, result);
        if (response.ok) {
          response.headers.set("Cache-Control", "public, max-age=60");
          ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
        }
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
    this.sql.exec("INSERT OR IGNORE INTO metadata VALUES ('started_at', ?)", new Date().toISOString());
  }
  async fetch(request) {
    const url = new URL(request.url);
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
