# iNat Browser

A static, no-build, three-page site for browsing iNaturalist observations. No package.json,
no bundler — every file is served as-is. Open `index.html` / `species.html` / `gallery.html`
directly (or via `.claude/launch.json`'s static server) to run it.

## Pages

- **index.html / index.css / index.js** — the map view. Leaflet map of iNaturalist
  observations, filter sheet, location-accuracy legend. Entry point for the app.
  - `Months of the year` (`m=6,7,8`) sits under `Observed between` because the two are one
    question asked two ways: the window is a stretch of time — asked for on purpose or not at
    all, since `d1` carries no default — and the months are a season read across every year,
    defaulting to the current and previous month (`defaultMonths`). A date typed into either
    field, or carried in on a link, is a deliberate one and stands (`windowD1`); with no
    default date to intersect against a chosen season, the two only collide when a date was
    actually asked for. Telling an asked-for date apart from the still-empty default is what
    `state.d1auto` is for, and it is why an untouched `d1` never rides in the hash: the address
    carries a date only when a date was meant. Both filters are named
    in the specimen label, since where both are in force the map is showing their
    intersection and an empty one has to be readable as such. The label reads a season rather
    than a list — `Aug`, `Jun–Aug`, or `3 months` with the months on the tooltip — and a run
    may wrap the year, `Nov–Feb` being `11,12,1,2`. Months ride along to the species page on
    both links out, as the pin does.
  - `Saved views` sits at the top of the filter sheet, that being the one panel already about
    *what am I looking at*. A saved view is nothing but a hash string kept under a name — the
    whole state is already one, so there is no second format to keep in step and no way for a
    saved view to drift from a shared link. It holds the hash verbatim, viewport and all: a
    standing question is a place as much as a filter, and taking the string apart to store the
    filters alone is the one thing that could make the two disagree. Restoring sets the hash
    and reloads, which *is* the pasted-link path, so a restored view lands exactly where that
    address lands and leaves no trace of having been saved. The name is offered from what
    `renderLabel` composes (`labelBits`), typed over in an inline field rather than a
    `prompt()`; rename and delete live behind the row's pencil, and delete arms before it
    fires, so it can never be the tap that was meant for the row above. See the saved-views
    block in `index.js` and the storage note under **Conventions**.
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
  - `Months of the year` (`m=6,7,8`, the map's key and the map's spelling) is the place tab's
    second asking control, and sits with `Only subspecies` rather than in the sortbar because
    it refetches. It slices the calendar without shortening the years, which is the only
    reason it is allowed on a tab whose premise is "ever" — see the "deliberately unfiltered
    by date" note under **Conventions**. It reaches `areaScope` and nothing else: not
    `userScope`, so a tick and a tier badge still say what the reader holds on a species
    rather than what they happened to record that month; not the tier tab, whose bands are
    about tags on photographs and have no season. On the tier tab the key rides along unread,
    like a pin, so crossing to the place tab keeps it. The heading, the page title and the
    loading state all name it — a list narrowed to a season must never look like the whole
    year's. Taps are debounced and only the newest run may paint (`placeRun`), since picking
    a summer is three taps and each is an area query.
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
  - `Export CSV` writes the list as it is currently showing to a downloaded file — last in the
    sortbar, and the one control there that produces something rather than changing what is read.
    It takes the **rendered rows, not the fetched ones**, and that is the fact a change here is
    likeliest to break: `relist` has already applied the order, the threshold, the rank cascade
    and the subspecies split, so the rows on screen are the single representation holding all of
    it at once, and recomputing any of it from the arrays would be a second opinion that drifts
    the first time either side moves. Two rules do the work. A row is out if it *or anything
    holding it* carries `hidden` — the tier tab's cascade hides whole `<section>`s and leaves
    their rows unhidden, so a row-level `:not([hidden])` alone would export a band nobody can
    see. And `li.fam` headings are dropped, the family riding on every row as a column instead,
    a CSV being one table with one shape. The tier tab's banding survives as that same
    `Standing` column, spelled as a word (`recorded, untagged`, `audio only`, `tier C`) and read
    from the row's badge on the place tab but from the section's *id* on the tier tab — the id
    and not the heading, three of the five sections being titled `Tier` and told apart only by
    the badge beside it. Above the table sits a key/value block: the area, the season, the
    scope, the user, the counts as shown, what is filtered out, the date — and the page's own
    address, which is the state, so that one line rebuilds the list the file came from.
    Downloaded and never copied: `navigator.clipboard` wants a secure context, and this page is
    read off a LAN address on a phone, where there is none. See the "taking the list away" block
    in `species.js`.
- **gallery.html / gallery.css / gallery.js** — the photo wall, reached from the species
  page's "Gallery" link, which carries the username across. Every photo on one user's tagged
  observations in a three-up grid, with a full-screen viewer behind each tile (tap the halves,
  arrow keys or swipe to step; swipe down or Escape to close). Addressed by query string the
  same way — read the comment block at the top of `gallery.js` before changing param names.
  With no username in the address it asks for one rather than guessing.
  - `Show: Unseen / All` filters against what has already been seen; see the localStorage
    note under Conventions.

- **common.js** — the one file the map and the species report both load, ahead of their own.
  It holds what those two genuinely share: the API's address, the request gate every call to
  it goes through (`apiGet`), `esc`, `ICONIC`, `MONTH_NAMES`, and the `species_counts` paging
  loop. Nothing in it reads a page's own state — it knows about iNaturalist and about HTML and
  nothing about a map or a report, and that is the line that keeps it from becoming a drawer.
  `userScope` is the near-miss that stays out: the two copies are the same five lines over
  different ground (the map projects `state`, the report projects `view`), and handing the
  state in at all six call sites to save five lines makes both pages read worse than the
  duplication does.
  The gallery does not load it and should not be made to — it asks iNaturalist in a shape of
  its own and is deliberately the page with nothing to wait for on load, so it keeps its own
  `esc` and `ICONIC`. Those copies are kept in step with common.js's by hand; the `esc` in
  particular must stay the five-character, null-safe one, or the three pages stop agreeing
  about what is safe to write into a page.

Each page is a plain `<link rel="stylesheet">` + `<script src>` pair, with `common.js` as a
second plain `<script src>` **before** the page script on the map, the species report and
`test.html` — no modules, no imports, no build step, and everything still a global, which is
why load order is the whole of the arrangement. Two scripts is the ceiling: keep it that way;
don't introduce a build step or split further unless a file becomes unwieldy again.

## External dependencies

- Leaflet 1.9.4 via unpkg (index page only).
- Google Fonts: Archivo Narrow (UI) and Newsreader (italic/serif, `--lit`) — map and species
  pages. The gallery loads no fonts at all and sets its type in the system serif and sans, so
  a wall of photographs has nothing to wait for.
- iNaturalist API v1 (`https://api.inaturalist.org/v1`) for all data — species counts,
  taxa, place autocomplete. No API key; all requests are unauthenticated GETs.
  Every one of those GETs on the map and the species page goes through `apiGet` in common.js —
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
  `apiGet` lives in common.js, with `esc`, `ICONIC` and the `species_counts` paging loop; the
  counters it keeps are one document's, the two page scripts never being in the same document,
  so sharing the file shares the code and not the queue.
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
  The map's saved views go under `inat.map.views`, a list of `{ name, hash, saved }` — the
  reader's own name for a view, the hash exactly as `writeHash` wrote it, and when they kept
  it. A different lifetime from `inat.map.last`, which is one hash the app overwrites for
  itself: these are named on purpose and only the reader adds to or takes from them, which is
  also why the list refuses a save at its cap rather than dropping the oldest to make room.
  Capped at 24 and at 32KB, and the write says whether it landed — a save is a button that was
  pressed, so a refusal is told to the reader in the sheet rather than swallowed. Wrapped like
  the rest, and where storage refuses outright the block is not drawn at all: with no storage
  the map is exactly the map it was before the feature existed. See the saved-views block in
  `index.js`.
  The species page also keeps its answers, under `inat.query.v1.<question>` — but in
  sessionStorage, and for five minutes. The difference in store is the difference in what is
  held: an eBird code is minted once and never changes, while every one of these is a count or
  a set derived from counts, and counts move all day. Kept across sessions they would quietly
  turn the report into a photograph of an earlier day; a tab's life and five minutes inside it
  covers a reload, a back, and a reader working the toolbar, and nothing further. It needs no
  purge — sessionStorage goes when the tab does. What is stored is the answer rather than the
  payload: a species_counts page is around 1.3KB a row against roughly 5MB for the origin, but
  most of these chains reduce on landing to a set of taxon ids, which costs kilobytes. The two
  that are rows — the area's list and the user's own — are kept whole under a size cap, so an
  ordinary scope is instant and an enormous one is simply not kept. Each key is the derivation
  plus every parameter that shaped it, so two questions cannot collide; the `v1` is there to be
  bumped if what is stored ever changes shape. Anything uncertain — malformed, expired, from an
  older version — is a miss, and a refusal is never written, so a 429 can never be served back
  as an answer. Wrapped like the others: with no storage the page works, it just asks again.
  The autocompletes are deliberately out of it, being cheap, already debounced, and stale in a
  way a reader would see. See the "keeping the answers" block in `species.js`.
- iNaturalist's `verifiable=true` (research + needs-ID, casual excluded) is the default
  filter on every query; don't drop it without a reason. `speciesCounts` in common.js applies
  it, and takes three answers rather than two: say nothing and it is set; pass `verifiable`
  yourself and that value is sent — the species report's tag lookup passes `"any"`, because a
  tier tag is a judgement about a photograph and stands wherever that photograph sits; pass it
  empty and none is sent at all. The empty one has exactly one caller, the map's own tag
  lookup, which has never sent a `verifiable` and is deliberately still not sending one. That
  the two pages answer the same question differently is a real inconsistency, recorded here
  rather than quietly resolved: settling it changes which species the map calls done, which is
  a decision about the map and not a tidy-up.
- The species page's place tab is deliberately unfiltered by date: the question is what has
  been recorded here, ever, and a date range would quietly answer a much smaller one. That
  still stands, with one qualifier — a *month* is not a date range. `m=6,7,8`
  narrows every year at once and leaves the "ever" intact, which is why the place tab takes it
  and would still refuse `d1`/`d2`. The distinction is the whole of the reasoning: a filter
  that shortens the years is out, a filter that slices them is in, and anything new here has
  to be argued on that line.

## Tests

`test.html` + `test.js` at the repo root, opened over the same static server as everything else
(`python -m http.server 8731`, then `localhost:8731/test.html`). A green tally means every claim
held. Hand-rolled assert harness, no runner, no dependency, no build step — a test that needed
one would break the only constraint the project has.

**Run it after every change to `species.js`, and again before calling that change done.** There
is no CI and nothing else will catch a broken tie-break — a wrong sort order paints happily and
looks almost right, which is the failure mode the whole file exists for. A reload is the whole
ritual; there is nothing to install and no reason to skip it. If a claim fails, the fix is
either the code or the claim — but say which, because a test edited to match new behaviour is a
decision about what the page means, not a formality. It covers the pure logic in `species.js`
and nothing else: DOM wiring, the request gate and anything that talks to iNaturalist want a
live API rather than assertions, and are deliberately left out. It is a dev tool, not a fourth
page — nothing links to it, it loads no fonts and no stylesheet, and it stays out of the
three-page navigation.

How it reaches the code without a module, and without touching production code: `test.html`
reproduces `species.html`'s body skeleton so every `getElementById` in `species.js` finds its
element, then loads `common.js` and `species.js` unmodified, in that order and with an empty
query string — the page's own load order, kept, since `species.js` expects common.js's globals
to be there already and `test.js` reaches for both (`esc` is common.js's now). That resolves to
the place tab with no place and short-circuits into the prompt before a single request leaves,
so the scripts settle harmlessly with all of their top-level functions in scope for `test.js`,
loaded after them. The "asked nothing" half is asserted rather than assumed —
`test.html` wraps `fetch` and `XMLHttpRequest` ahead of the boot and the first test reads the
count back.

What is covered, in the order it earns its place: `sspWaves`, whose invariant — no wave holding
two subspecies of one parent — fails silently rather than loudly, two asked together coming back
merged; `comparator` and `sortRows`, where reversing turns over only what the order is asking
and never the tie-break inside it, so no reversed list is a plain mirror of its forward self;
the CSV export, whose two silent failures are a row inside a hidden `<section>` — which the tier
tab's cascade produces and a row-level `:not([hidden])` walks straight past — and a standing read
off a heading three of the five sections share; `idBatches`; `taxoKey`; then
`standingRank`/`tierRank`, `fmtRadius`, `esc` and `isSpeciesRow`.
`comparator` is exercised against real `<li>` elements carrying the attributes `rowHtml` writes,
since it compares `dataset` — running it against the real thing in a real browser is the point
of a harness that lives in one, so don't refactor it to take plain objects. The export's fixtures
go further and are painted into the real `#main` by calling `rowHtml` itself rather than by
writing that markup out a second time, `#main` being put back afterwards — so a change to what a
row carries fails a test rather than quietly costing the file a column. Test names are
claims, so a failure reads as the sentence that stopped being true, and where a comment in
`species.js` states a behaviour the test encodes that sentence rather than whatever the code
happens to do.
