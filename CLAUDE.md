# iNat Browser

A static, no-build, three-page site for browsing iNaturalist observations. No package.json,
no bundler — every file is served as-is. Open `index.html` / `species.html` / `gallery.html`
directly (or via `.claude/launch.json`'s static server) to run it.

## Pages

- **index.html / index.css / index.js** — the map view. Leaflet map of iNaturalist
  observations, filter sheet, location-accuracy legend. Entry point for the app.
- **species.html / species.css / species.js** — the species report, reached from the map and
  returning to it by the "Back to Map" link. Two tabs over the same rows: `tier` (one user's
  species banded by tier tag) and `place` (every species in an area, ticked off against a
  user). Fully addressed via query string (see the comment block at the top of `species.js`)
  so any state is bookmarkable.
  - Category ordering is: Untagged (green tick), audio, tiers for tier page; and audio, observed (green tick), tiers for species page
  - `View: List / Grid` (`layout=grid`) hangs the same rows as tiles. It is one class on
    `#main`, not a second rendering, so sort, threshold, family bands and the hide-cascade
    keep working on the same `<li>`s — don't grow a separate grid renderer.
- **gallery.html / gallery.css / gallery.js** — the photo wall, reached from the species
  page's "Gallery" link, which carries the username across. Every photo on one user's tagged
  observations in a three-up grid, with a full-screen viewer behind each tile (tap the halves,
  arrow keys or swipe to step; swipe down or Escape to close). Addressed by query string the
  same way — read the comment block at the top of `gallery.js` before changing param names.
  With no username in the address it asks for one rather than guessing.
  - `Show: Unseen / All` filters against what has already been seen; see the localStorage
    note under Conventions.

Each page is a plain `<link rel="stylesheet">` + `<script src>` pair — no modules, no
imports, everything in one script file per page. Keep it that way; don't introduce a build
step or split further unless a file becomes unwieldy again.

## External dependencies

- Leaflet 1.9.4 via unpkg (index page only).
- Google Fonts: Archivo Narrow (UI) and Newsreader (italic/serif, `--lit`) — map and species
  pages. The gallery loads no fonts at all and sets its type in the system serif and sans, so
  a wall of photographs has nothing to wait for.
- iNaturalist API v1 (`https://api.inaturalist.org/v1`) for all data — species counts,
  taxa, place autocomplete. No API key; all requests are unauthenticated GETs.

## Conventions

- CSS custom properties for the whole palette (`--ink`, `--raise`, `--rule`, `--text`,
  `--mute`, `--mark`, `--verified`) — reuse these rather than hardcoding colors. The gallery
  is deliberately a darker room and keeps its own set (`--ink`, `--ink-deep`, `--paper`,
  `--chrome`, `--chrome-dim`, `--hair`) at the top of `gallery.css`; the same rule holds
  inside it.
- No frameworks — vanilla DOM (`document.createElement`, template strings via `innerHTML`,
  `esc()` helper for escaping into HTML).
- Page state lives in the URL query string / hash, not in memory-only JS state, so views are
  shareable and reload-safe. `species.js` and `gallery.js` in particular treat the query
  string as the API — read their top-of-file comments before changing param names.
- The exception is state that belongs to this reader and this browser rather than to the
  link, which goes in localStorage: the gallery's record of seen photos, under
  `inat.gallery.seen.<user>`, keyed by iNaturalist photo id. A photo counts as seen once it
  has scrolled halfway into the grid or been opened full-screen. The filter reads a snapshot
  taken at load rather than the live set, so tiles are never pulled out from under a scroll —
  what is seen now drops out next time the page is opened. Every read and write is wrapped:
  with no storage the gallery works and simply forgets.
- iNaturalist's `verifiable=true` (research + needs-ID, casual excluded) is the default
  filter on every query; don't drop it without a reason.
