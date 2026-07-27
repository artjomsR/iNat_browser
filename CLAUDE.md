# iNat Browser

A static, no-build, two-page site for browsing iNaturalist observations. No package.json,
no bundler — every file is served as-is. Open `index.html` / `species.html` directly (or
via `.claude/launch.json`'s static server) to run it.

## Pages

- **index.html / index.css / index.js** — the map view. Leaflet map of iNaturalist
  observations, filter sheet, location-accuracy legend. Entry point for the app.
- **species.html / species.css / species.js** — the species report, reached from the map's
  "Map" link. Two tabs over the same rows: `tier` (one user's species banded by tier tag) and
  `place` (every species in an area, ticked off against a user). Fully addressed via query
  string (see the comment block at the top of `species.js`) so any state is bookmarkable.
  - Category ordering is: Untagged (green tick), audio, tiers for tier page; and audio, observed (green tick), tiers for species page

Each page is a plain `<link rel="stylesheet">` + `<script src>` pair — no modules, no
imports, everything in one script file per page. Keep it that way; don't introduce a build
step or split further unless a file becomes unwieldy again.

## External dependencies

- Leaflet 1.9.4 via unpkg (index page only).
- Google Fonts: Archivo Narrow (UI) and Newsreader (italic/serif, `--lit`).
- iNaturalist API v1 (`https://api.inaturalist.org/v1`) for all data — species counts,
  taxa, place autocomplete. No API key; all requests are unauthenticated GETs.

## Conventions

- CSS custom properties for the whole palette (`--ink`, `--raise`, `--rule`, `--text`,
  `--mute`, `--mark`, `--verified`) — reuse these rather than hardcoding colors.
- No frameworks — vanilla DOM (`document.createElement`, template strings via `innerHTML`,
  `esc()` helper for escaping into HTML).
- Page state lives in the URL query string / hash, not in memory-only JS state, so views are
  shareable and reload-safe. `species.js` in particular treats the query string as the API —
  read its top-of-file comment before changing param names.
- iNaturalist's `verifiable=true` (research + needs-ID, casual excluded) is the default
  filter on every query; don't drop it without a reason.
