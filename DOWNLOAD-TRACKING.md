# Download attribution

Private owner report: https://sheepterm.com/download-stats/ . Counts begin at activation, not at the first GitHub release. Reports cover 7, 30 or 90 Bangkok calendar days and refresh every 15 seconds without shared caching. They are redirect requests, not unique people or completed installs.

Promote with a landing-page URL, for example `https://sheepterm.com/?utm_source=reddit&utm_medium=social&utm_campaign=launch`. Source labels: reddit, facebook, google, github, youtube, linkedin, x, twitter. Other explicit sources are grouped as other. Use short campaign slugs without personal data. Attribution persists within a browser tab via sessionStorage. With storage blocked or JavaScript disabled, direct download links still work, but original campaign attribution may be unavailable.

Download endpoints: `/download/mac`, `/download/windows`, `/download/linux`, `/download/linux-arm64`. Optional version selects a validated release tag; targets are resolved from the fixed repository's release assets, never from a supplied redirect URL. GitHub API failures fall back to its release page without increasing the counter. Website tracking does not modify updater behavior in either app. Existing updater traffic remains visible only in GitHub asset counters.

Cloudflare SQLite Durable Object `DownloadCounter` stores aggregate dimensional counts atomically. No raw IPs, full referrer URLs, visitor IDs or per-person event records are stored in this database. Platform, version, source, medium, campaign, placement and country aggregates require owner sign-in. Retention is 90 days. Known bots, prefetches, HEAD, DNT and GPC are excluded; undetected automation and repeat clicks cannot be fully removed.

Verification: use HEAD to inspect redirects without counting or GET with `utm_source=test` for a real browser redirect; test campaigns are excluded from public reports. Never follow a live asset redirect as part of automated checks, to avoid raising GitHub asset counters. No historical GitHub totals are imported.

Deployment uses the existing GitHub → Cloudflare Workers build. Wrangler defines assets and the SQLite Durable Object migration. Keep `_redirects` and static pages. `.assetsignore` excludes backend source/config from public static assets.
