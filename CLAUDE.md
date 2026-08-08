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
  - `Recorded · Anywhere / Here` (`seen=here`) reads the reader's own ticks and tier badges
    against the area instead of against the world, and is the place tab's third asking control —
    it sits with the season, above it, so the pair reads as recorded *where* then recorded
    *when*. It is one control for both signals because they are one badge column and one lookup.
    Everything hangs off one line: `userScope` spreads the ground, which reaches the three tag
    searches, the audio pair and all six of `sspStanding`'s questions at once, so the subspecies
    path needs nothing of its own. The tick is the exception and the awkward half —
    `unobserved_by_user_id` is iNaturalist's *global* test, so the place params already in
    `unseenHere` only pick candidates and the answer per species stays global whatever is sent.
    `here` is therefore not that question narrowed but the opposite one asked positively
    (`recordedHere`); `alreadyHas` chooses and hands back a predicate, so the renderer sees one
    polarity. Both of those gate the tag searches, which reach into casual records, so both pass
    `verifiable=any` — a gate narrower than what it gates costs a species not just its tier but
    its tick, and read against one area, where a species is often held on a single record, that
    stops being academic. `sspStanding`'s first pass carries it for the same reason.
    It takes the ground and never the season: `hereOnly` returns `areaWhere`, which is
    `areaScope` with the taxon, the group and the month left off — that split is the whole
    mechanism, so don't collapse it back. Place tab only, and only with both an area and a
    username (`canReadHere`, which the control's own gate and the scopes share so what is drawn
    and what is asked cannot come apart); on the tier tab the key rides along unread, like a pin,
    since that list is a person's whole holding and stays one. Anywhere is the default and writes
    no key. The blurb, the tally, the badge titles, the note, the loading state, `View my` and
    the CSV all name which way it is set — a tick that quietly means something narrower than it
    did is the one thing on this tab that must not go unsaid. Two honest costs, both
    iNaturalist's: a record with no usable location and one with obscured coordinates (every
    threatened species) cannot count as here. See the "where the badges are read" block in
    `species.js`.
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
  `userScope` is the near-miss that stays out, and it has since stopped being a near-miss: the
  two were once the same five lines over different ground (the map projects `state`, the report
  projects `view`), and handing the state in at every call site to save five lines made both
  pages read worse than the duplication did. The report's has since grown a branch the map has
  no counterpart for — the ground `seen=here` puts in — so the code now makes the case the
  argument made first.
  The gallery does not load it and should not be made to — it asks iNaturalist in a shape of
  its own and is deliberately the page with nothing to wait for on load, so it keeps its own
  `esc` and `ICONIC`. Those copies are kept in step with common.js's by hand; the `esc` in
  particular must stay the five-character, null-safe one, or the three pages stop agreeing
  about what is safe to write into a page.

- **manifest.json / sw.js / icon.svg / icon-192.png / icon-512.png** — not a page, and between
  them the whole of what makes this an app you can install and open with no signal. All three
  pages link the manifest and register the worker; neither changes anything about a page opened
  in an ordinary browser tab with a connection. See **Installed, and offline** below.

Each page is a plain `<link rel="stylesheet">` + `<script src>` pair, with `common.js` as a
second plain `<script src>` **before** the page script on the map, the species report and
`test.html` — no modules, no imports, no build step, and everything still a global, which is
why load order is the whole of the arrangement. Two scripts is the ceiling: keep it that way;
don't introduce a build step or split further unless a file becomes unwieldy again. The one
thing in a page's tail that is not a `<script src>` is the six-line worker registration, and it
is inline in all three for exactly that reason: a file would be a third script, and the same
lines living inside `index.js` or `species.js` would install a worker every time `test.html`
loaded those scripts to assert against them.

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

## Installed, and offline

The app was already built for a phone in a field and already behaved as an installed one —
chromeless metas, links that navigate rather than open a tab, a request gate that retries a
dropped connection — without ever having been declared an app or being able to open without a
signal. `manifest.json` and `sw.js` are that declaration and that opening.

**The manifest is the map's.** `start_url` comes back to `index.html` from whichever page it was
installed from, `short_name` is the "Field" the `apple-mobile-web-app-title` already said, and
the colours are the map's `#0D1714` and not the gallery's `#17181c`: what gets installed is the
app, and the app is the map. The gallery is a darker room inside it and its own `theme-color`
still wins while that page is open — the manifest's colour only ever paints the splash screen and
the launcher, which belong to the thing that was installed. A report or a wall of photographs is
a view of a scope, not something to keep an icon for, so installing from either lands on the map.

**The icons are the app's own mark**: the hollow diamond the label bar and the report's heading
wear (`.lozenge`), `--mark` on `--ink`. `icon.svg` is the drawing — legible source, like
everything else here, and the favicon browsers use — and the two PNGs are the same geometry
rasterised, because iOS will not take an SVG for a home-screen icon. They are 693 bytes and
2.3KB: flat colour compresses to almost nothing, which is how a repo with no pipeline can afford
real PNGs rather than a generated letter. The diamond spans 43% of the canvas, well inside the
maskable safe zone, so one drawing serves `any` and `maskable` both. To change it, edit the SVG
and re-render the two — the geometry is written down at the top of the file.

**The worker caches the shell and nothing else.** Fourteen of the app's own files — the three
HTML, the three CSS, the four JS (`common.js` is the one a count of "nine" forgets, and a shell
without it is two pages that open to an exception), the manifest and the icons — plus Leaflet's
CSS and JS. Cache-first for those; everything else goes to the network untouched. That is an
allowlist and not a filter, which is the important part: the worker answers only what is in
`SHELL`, so `api.inaturalist.org`, `query.wikidata.org`, every map tile and every photograph on
the gallery wall are network-only *by construction* rather than by a rule someone has to remember
to keep exempting.

**No API response is cached, ever**, in any store, under any TTL — a species tally is a thing
that moves all day, and served back out of a cache it would be a photograph of an earlier day
wearing today's face, with no line on any page to say so. Response caching is a separate decision
and belongs to whatever makes it. Tiles are the near-miss and stay out for a second reason as
well: a cache of the tiles you happened to look at is an app that is a map in four places and a
grey field everywhere else, and it fills a phone to do it.

**Leaflet is in the shell and the fonts are not.** Without Leaflet the map page is not furniture
but a blank page, since `index.js` reaches for `L` on the way up; so its CSS and JS are cached,
fetched in cors mode rather than no-cors so that a real status comes back and a 404 or a captive
portal's sign-in page is never stored as if it were the library. The fonts stay out: their URLs
vary by browser across two hosts, and both stylesheets ask with `display=swap`, so with no
connection the type simply renders in the fallback stack the CSS already names and nothing waits.
The gallery, which loads no fonts at all, survives this best of the three.

**A new worker waits rather than taking over** — no `skipWaiting`, no `clients.claim`. A field
session stays open for hours, and swapping `species.js` under an HTML page that loaded an hour
ago is how you get a version mismatch only one person can reproduce. The cost is that a change
lands on the next cold start rather than the next reload; in Chrome that means genuinely leaving
the origin or closing the app, not two reloads in the same tab. Which makes the rule: **bump
`VERSION` in `sw.js` whenever a shell file changes**, because nothing else will tell a browser
there is a new shell to fetch. Working on the app with the worker installed, the same trap is
yours — bump it, tick "Bypass for network" in DevTools, or work with it unregistered. `test.html`
registers no worker at all and asks for `common.js` and `species.js` with a `?test` query, which
`shellKey` treats as a deliberate way round the cache: a green tally read off yesterday's
`species.js` would be worse than no tally.

**Offline, each page says what is true.** The map opens to its own furniture with grey tiles and
a strip across the top — the app is cached, the observations aren't — and the label bar moves
down by the strip's own measured height so a wrapped sentence is never covered by it. The
species report's `failed` reads the reason off the browser rather than guessing at rate-limiting,
and the gallery's loader does the same. All three say the same thing in their own voice: the page
is kept, the data is not, and it will be there when the signal is.

**The bargain is the storage bargain.** No worker — a private window, a policy, an old browser,
or the `file://` path that is still a supported way to run this — and all three pages work as
they always did. Registration is guarded on the protocol (a worker needs an origin and `file://`
has none, and asking anyway costs a red console line the `catch` cannot swallow), then wrapped
twice more for everything that is a refusal rather than an address.

**There is a way out, and it is written in `sw.js`**: the two console lines that unregister the
worker and delete every cache, where to find the same thing in DevTools and on iOS, and — for a
bad worker already out on phones you cannot reach — the four-line replacement file that defuses
itself on the next check-in. A service worker is sticky, and a bad one shipped to a home screen
is the one bug in this repo that cannot be fixed by editing a file.

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
  that shortens the years is out, a filter that slices them is in, and anything new about *when*
  has to be argued on that line. The tab has a second axis now — `seen=here` asks *where* the
  reader's own records were made — and it is not on that line at all, having nothing to do with
  dates. The two stay orthogonal on purpose: `seen=here` takes the ground and never the season,
  so neither control can quietly answer the other's question.

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

The two script tags carry a `?test` query and the page registers no service worker, both for the
same reason: `sw.js` caches `common.js` and `species.js` and serves them cache-first, so a run
made after an edit but before the worker's next version would tick every claim while reading the
old file. A query is how a request says it wants what is on disk (see `shellKey` in `sw.js`), and
a green tally that means nothing is worse than no tally. Keep both if you touch this page's tail.

What is covered, in the order it earns its place: `sspWaves`, whose invariant — no wave holding
two subspecies of one parent — fails silently rather than loudly, two asked together coming back
merged; `comparator` and `sortRows`, where reversing turns over only what the order is asking
and never the tie-break inside it, so no reversed list is a plain mirror of its forward self;
the CSV export, whose two silent failures are a row inside a hidden `<section>` — which the tier
tab's cascade produces and a row-level `:not([hidden])` walks straight past — and a standing read
off a heading three of the five sections share; `areaWhere`/`userScope`, where `seen=here`'s
three silent failures live — a season leaking into a badge would re-mean every one of them, the
ground leaking onto the tier tab would turn a person's whole holding into an area's list under a
heading still claiming the first, and the ground leaking in unasked would do both to a reader who
never touched the switch; `idBatches`; `taxoKey`; then `standingRank`/`tierRank`, `fmtRadius`,
`esc` and `isSpeciesRow`.
That group is reachable at all only because `areaWhere` reads `view` as it stands rather than the
consts settled at load (`pinSet` beside `hasPin`) — the switch moves without a navigation, so it
had to; collapsing the two back takes the pin claims with it. `withView` is the harness's way in,
saving and restoring whatever keys a claim needs, and `withRev` is now one line of it.
`comparator` is exercised against real `<li>` elements carrying the attributes `rowHtml` writes,
since it compares `dataset` — running it against the real thing in a real browser is the point
of a harness that lives in one, so don't refactor it to take plain objects. The export's fixtures
go further and are painted into the real `#main` by calling `rowHtml` itself rather than by
writing that markup out a second time, `#main` being put back afterwards — so a change to what a
row carries fails a test rather than quietly costing the file a column. Test names are
claims, so a failure reads as the sentence that stopped being true, and where a comment in
`species.js` states a behaviour the test encodes that sentence rather than whatever the code
happens to do.
