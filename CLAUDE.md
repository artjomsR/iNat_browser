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
  - Every order but `Taxonomic` reads both ways (`REVERSIBLE`, `rev=1`) and wears an arrow
    saying which way it is running: clicking the order already chosen turns it over, clicking
    a different one starts it forwards. `Taxonomic` takes no arrow and drops `rev` from the
    address — the tree's order is not a preference. Reversing flips only what the order is
    asking: the tier bands turn over but the count still settles a draw inside one, and the
    count turned over still runs names A–Z where two rows are level, so no list is a plain
    mirror of itself. The count's button is named for the measure (`Number of observations`)
    rather than a direction, since it can lead with either end; the tier button still says
    `Most observed / Tier` and still means it, that half being the tie-break the arrow leaves
    alone. The arrow is one drawing rotated by `.sortbar button.rev`, so a flip is the same
    line of JS that moves the `on` state; don't add a second glyph.
  - `View: List / Grid` (`layout=grid`) hangs the same rows as tiles. It is one class on
    `#main`, not a second rendering, so sort, threshold, family bands and the hide-cascade
    keep working on the same `<li>`s — don't grow a separate grid renderer.
  - Bird rows carry an `eBird` link out to that species on eBird. The code eBird needs comes
    from Wikidata (see External dependencies) behind the finished list, so the link appears
    when it lands and is simply absent where no code is found — never broken.
  - `Only subspecies` (`ssp=only`) splits the list into subspecies — each row named, counted
    and linked as itself. It is the one sortbar control that refetches, and the only list on
    the page that is built rather than asked for: `species_counts` will not report below
    species rank, so a subspecies list has to be assembled from `hrank=subspecies` (which
    species have infraspecific records, and how many) plus per-subspecies counts gathered in
    rounds of at most one candidate per species, since two subspecies of one species asked
    together come back merged. Read the subspecies block in `species.js` before touching any
    of it. Ticks and tier bands are read one race at a time by the same trick — the reader's
    own records asked for by subspecies id, in waves holding at most one race per species — so
    a race they have not recorded stays unticked under one they have, and a bird tagged S on
    one race and untagged on another sits in two tiers. Rows still carry `parent`, but only to
    organise that asking (`parentOf`) and to key the eBird lookup, which matches on the
    species' scientific name.
    `ssp` is the map's key and keeps the map's spelling — the map's `ssp=1` ("include
    subspecies") has no meaning here and reads as off.
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
  Every one of those GETs on the map and the species page goes through that page's `apiGet` —
  a request gate holding the pace to one departure per 350ms and at most three open at once,
  retrying the statuses that mean "later" and a connection that dropped, and throwing on
  everything else as the raw `fetch` calls always did. It hands back parsed JSON, so a caller
  is one `await` rather than three lines. It exists because these pages ask in bursts: a
  place-tab load fans out to eight paged chains at once, which flat out is past what a free
  shared API will answer, and before the gate a single 429 mid-list took the whole report
  down. The pace only ever slows — a 429 doubles the gap for the rest of the session and it
  never decays. Don't call `fetch` directly on these two pages; the gate is only worth having
  if everything goes through it.
  The gallery keeps its own arrangement — it pages one shelf sequentially and already slept
  between pages and handled a 429 before any of this — and the Wikidata lookup stays outside
  the gate deliberately, being a different service with its own temper and its own retry.
  `apiGet` is duplicated per page, as `esc` and `ICONIC` are, to keep one script file per
  page; if that ever changes it is the first thing that should move.
- Wikidata Query Service (`https://query.wikidata.org/sparql`, species page only) for one
  thing: the eBird species code behind a bird row's `eBird` link. eBird addresses a species by
  its own six-letter code and publishes no key-free way to look one up — their taxonomy
  endpoint is 403 without an API key, and iNaturalist carries no eBird identifier — so the
  join goes through Wikidata, which holds both sides and answers unauthenticated with CORS
  open: scientific name (P225) in, eBird taxon id (P3444) out. It is a shared public endpoint
  and has to be asked in small sequential batches; asking in parallel earns a 429. See the
  eBird block in `species.js` before changing any of that.

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
  The species page keeps eBird codes the same way, under `inat.ebird.codes`, keyed by
  scientific name — a lookup cache rather than a reader's own record, but the same bargain: a
  code never changes once minted, so a name is only ever asked about once per browser, and
  with no storage the links still appear, the page just re-asks.
  The map keeps its last hash under `inat.map.last`, but only when running from an iOS home
  screen shortcut, which launches the URL it was made from every time and so would otherwise
  hand back the filters of the day the icon was made. A cold launch — told from a page opened
  inside the app by an empty `inat.map.session` in sessionStorage — starts from that copy
  instead. In a browser tab none of it runs and the address is still the only state there is.
- iNaturalist's `verifiable=true` (research + needs-ID, casual excluded) is the default
  filter on every query; don't drop it without a reason.
