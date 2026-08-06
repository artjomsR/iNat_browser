/* ---------------- page address ----------------

   The report is its own page, so its whole input lives in the query string and it can be
   bookmarked, shared, and reloaded on its own:

     species.html?u=USER&taxon=ID&tname=NAME&iconic=Aves,Insecta&sort=name#tier-3
     species.html?tab=place&place_id=7122&pname=Portugal&u=USER&sort=taxo&layout=grid
     species.html?tab=place&lat=38.72&lng=-9.14&radius=12&u=USER

   Two tabs over the same rows. `tier` is about one person: their species banded by the tier
   tag they carry. `place` is about one patch of ground: every species recorded there, with
   the ones that person has already recorded ticked off. Both are addresses, so either can
   be bookmarked and the tab strip is just two links.

   `tname` is only a label — the taxon id is what scopes the query — so a stale or missing
   name costs nothing but a prettier heading. `pname` is the same for a place.

   `taxon` and `iconic` are one filter with two ways of setting it, so setting either here
   drops the other and the address carries at most one of them. An older link holding both
   still reads: the query narrows to their intersection and the scope line names the taxon.

   `layout=grid` hangs the rows as tiles instead of listing them. It is the same rows either
   way — a class on the list, not a second rendering — so the sort, the threshold and the
   hide-cascade all still apply, and switching costs no refetch.

   `ssp=only` splits the list into subspecies: every species carrying an infraspecific
   identification, broken into the subspecies actually recorded, each row named, counted and
   linked as itself. Unlike the sort, the layout and the threshold it is a different question
   rather than a different reading of the same rows, so it refetches — and it cannot simply be
   asked for either. See the subspecies block for how it is built.

   The spelling is the map's, deliberately: over there `ssp` takes "1" for "include
   subspecies" as well, which drops a floor this page has no way to stand on — iNaturalist
   folds a subspecies into its species here whatever is asked. So "1" reads as off rather than
   as a second meaning for the same word on a neighbouring page.

   `sort=tier` is the place tab's own order: the rows banded by what the named user already
   holds on them — never recorded first, then audio, the plain tick, C, B, S — and heaviest
   first inside each band. It needs a standing on every row to read, which only the place tab
   with a username has, so anywhere else the address falls back to the default.

   `rev=1` runs the chosen order backwards: `count` leads with the fewest, `name` becomes Z–A,
   `tier` leads with the strongest standing instead of the weakest. `taxo` is the one order it
   does not take — the tree has an order of its own — and under it the key is dropped rather
   than kept as something nothing reads. It stands alone in the address, since `count` is the
   default and writes no `sort`: `?rev=1` is the fewest-observed list. Like the sort and the
   threshold it is a different reading of rows already on the page, so it costs no refetch.
   See REVERSIBLE.

   `back` holds the map's own hash, added by the map when it opens this page. It is never
   read here, only handed straight back to the Map link, so the reader returns to the
   filters and viewport they left rather than to a fresh map. */

const API = "https://api.inaturalist.org/v1";
const LEVELS = ["s","b","c"];
const ICONIC = [
  ["Plantae","Plants"],["Aves","Birds"],["Insecta","Insects"],["Fungi","Fungi"],
  ["Arachnida","Arachnids"],["Mammalia","Mammals"],["Reptilia","Reptiles"],
  ["Amphibia","Amphibians"],["Actinopterygii","Fish"],["Mollusca","Molluscs"]
];

/* ---------------- asking iNaturalist ----------------

   One door for every request to iNaturalist, because this page asks in bursts rather than one
   at a time. A place-tab load fans out to eight paged chains at once — runPlace starts three,
   one of them standingLookup, which starts four more, one of THOSE audioOnlySpeciesIds, which
   starts two — and each chain is good for twenty pages. Fired flat out that is well past what
   a free, shared, unauthenticated API will answer, and the page had no reply to a refusal:
   every call site threw on the first non-ok status, so one 429 in the middle of a life list
   took the whole report down with it.

   So the bursts are metered rather than thinned. Callers still ask for everything they need,
   in whatever parallel shape reads best; this decides when each request actually leaves.

   Two limits doing different jobs. MAX_INFLIGHT caps how many are open at once, so one slow
   answer cannot pile the rest up behind it. `gap` is the pace-setter: iNaturalist asks for
   under a hundred requests a minute, and 350ms between departures sits inside that in
   practice, since a chain cannot ask for its next page until the last one has landed.

   `gap` is a floor that only ever rises. A 429 is iNaturalist saying the pace was wrong, so
   the pace changes for the rest of the session rather than only for the retry — otherwise a
   burst that earns one refusal earns another the moment it resumes. It never decays: a page
   that has been told off once is in no hurry, and the reader gets their list either way.

   Retried: the statuses that mean "later", and a connection that dropped — on a phone in a
   field that is the ordinary case rather than the exotic one. Everything else throws where it
   always did, a 404 being an answer rather than a refusal. Retry-After is honoured where it is
   sent, that being iNaturalist's own number rather than a guess.

   The Wikidata lookup behind the eBird links does not come through here. It is a different
   service with a different temper and a retry of its own (see ebirdCodesRetrying), and putting
   the two in one queue would only let a long species list hold up the links, or the reverse. */

const MAX_INFLIGHT = 3;
const RETRIES = 3;
const RETRY_ON = new Set([429, 502, 503, 504]);

const pause = ms => new Promise(done => setTimeout(done, ms));

let gap = 350;        // ms between departures — raised by a 429, never lowered
let nextStart = 0;    // when the next request may leave
let inflight = 0;
const waiting = [];

function acquire(){
  if(inflight < MAX_INFLIGHT){ inflight++; return Promise.resolve(); }
  return new Promise(go => waiting.push(go));
}

// The slot is handed straight to whoever is next rather than released and re-taken, so a
// request arriving between the two cannot jump the queue.
function release(){
  const next = waiting.shift();
  if(next) next(); else inflight--;
}

// Claim the next departure and say how long to wait for it. Synchronous on purpose: the read
// and the write have to happen with no await between them, or two callers waking together read
// the same slot and leave side by side.
function reserve(){
  const now = Date.now();
  const at = Math.max(now, nextStart);
  nextStart = at + gap;
  return at - now;
}

// Seconds, or an HTTP date — only the first is worth reading, and only within reason. A long
// wait is better spent failing, so the reader can ask again themselves.
function retryAfter(res){
  const secs = +res.headers.get("Retry-After");
  return isFinite(secs) && secs > 0 ? Math.min(secs * 1000, 10000) : 0;
}

function backoff(attempt){ return 800 * 2 ** attempt; }

async function apiGet(url, opts){
  await acquire();
  try{
    for(let attempt = 0; ; attempt++){
      await pause(reserve());
      let res;
      try{
        res = await fetch(url, opts);
      }catch(err){
        // No response at all, so no status to read: the connection went. Asking again is the
        // only way to tell a blip from a dead line.
        if(attempt >= RETRIES) throw err;
        await pause(backoff(attempt));
        continue;
      }
      // Awaited rather than handed back: a large page is still arriving when its headers land,
      // and the slot is not free until the body is in.
      if(res.ok) return await res.json();
      if(res.status === 429) gap = Math.min(gap * 2, 2000);
      if(!RETRY_ON.has(res.status) || attempt >= RETRIES) throw new Error(res.status);
      await pause(retryAfter(res) || backoff(attempt));
    }
  }finally{
    release();
  }
}

const q = new URLSearchParams(location.search);
const tab = q.get("tab") === "place" ? "place" : "tier";

// The threshold's default has to follow what the counts mean, and the two tabs count
// different things. On the place tab a count is iNaturalist's area-wide total for that
// species — hundreds or thousands — so trimming under 20 drops only the long tail. On the
// tier tab it is this one user's own observations of it, which is a handful even for a
// species they photograph often, so any threshold at all empties the page. What it reaches
// differs by tab too, not only what it defaults to: on the place tab it passes over anything
// the reader has already recorded — see underMin.
const DEFAULT_MIN = tab === "place" ? 20 : 0;

// The orders that turn over, and so the ones that carry an arrow: the count runs up as
// readily as down, A–Z becomes Z–A, and the tier bands lead with the strongest standing
// instead of the weakest. Taxonomic is the one left out — the tree's order is not a
// preference to be flipped. Each keeps its own tie-breakers whichever way it runs: the arrow
// turns over the question the order is asking, not what settles a draw inside it.
//
// This is why the count's button names a measure rather than a direction: "Most observed"
// over a list that can lead with the fewest is a label that lies. The tier button still says
// "Most observed" and still means it — that half of it is the tie-break inside a band, which
// the arrow does not touch.
const REVERSIBLE = ["count", "name", "tier"];

const view = {
  tab,
  user:   (q.get("u") || "").trim(),
  taxon:  q.get("taxon") || "",
  tname:  q.get("tname") || "",
  iconic: (q.get("iconic") || "").split(",").filter(Boolean),
  sort:   ["name","taxo","tier"].includes(q.get("sort")) ? q.get("sort") : "count",
  // Which way that order runs, not a fifth order — see REVERSIBLE for the ones that offer it.
  rev:    q.get("rev") === "1",
  // The shape the rows are read in, not what they hold — see the note up top.
  layout: q.get("layout") === "grid" ? "grid" : "list",
  // Only what has been taken below species rank — a narrower question, not a narrower
  // reading of the same rows. Boolean here, "only" on the wire, matching the map. See sspOnly.
  ssp:    q.get("ssp") === "only",
  // `min=0` in the address is an explicit "show me everything" and survives a reload.
  min:    q.has("min") ? Math.max(0, Math.floor(+q.get("min") || 0)) : DEFAULT_MIN,
  back:   q.get("back") || "",
  place:  q.get("place_id") || "",
  pname:  q.get("pname") || "",
  lat:    q.get("lat") || "",
  lng:    q.get("lng") || "",
  radius: q.get("radius") || "",
  // The hide-cascade's cutoff: null shows everything, N hides standing N and above (see
  // STANDING_ORDER, defined once TIERS exists further down). Bounds are checked there too,
  // not here — an out-of-range value just matches nothing, which is harmless.
  hide:   q.has("hide") && /^\d+$/.test(q.get("hide")) ? +q.get("hide") : null
};
// A pin needs both halves to mean anything; a bare lat with no lng is no location at all.
const hasPin = !!(view.lat && view.lng && view.radius);
const hasArea = !!view.place || hasPin;
// Something narrowing the tree. Without it an area query is unbounded, so the place tab
// declines to run one.
const hasTaxa = !!(view.taxon || view.iconic.length);
// Tier order needs a standing on every row, and only the place tab with a username has one —
// on the tier tab the sections already ARE the tiers, so there is nothing left for it to
// band. An address carrying it anywhere else drops back to the default rather than offering
// a button that would shuffle nothing.
const canTier = tab === "place" && !!view.user;
if(view.sort === "tier" && !canTier) view.sort = "count";
// After that fallback rather than before it, so this reads the order that will actually run.
// Direction survives a fallback where it can: tier order dropping to the count keeps its
// arrow, since the count is reversible too — only taxonomic has nothing to do with one.
if(!REVERSIBLE.includes(view.sort)) view.rev = false;

// Rebuild this page's address with a few keys changed — how the tabs, the place picker and
// the sort control all move around without losing the rest of the scope.
function selfUrl(over){
  const p = new URLSearchParams(location.search);
  Object.entries(over).forEach(([k, v]) => { if(v === null || v === "") p.delete(k); else p.set(k, v); });
  return "species.html?" + p.toString();
}

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// Reached from the map's home-screen app, this page runs with no tab bar and no back
// button, where a `_blank` link has nowhere to open but a chromeless view on top of this
// one — and iNaturalist's own addresses then hand off to their native app, abandoning that
// view as a white page with no way out. The rows stay ordinary links, opening ordinary tabs
// in an ordinary browser; only on the home screen does the target come off, so the hand-off
// happens from this view and leaves nothing behind. The Map link goes back afterwards.
if(window.navigator.standalone === true ||
   (window.matchMedia && matchMedia("(display-mode: standalone)").matches)){
  addEventListener("click", e => {
    const a = e.target.closest && e.target.closest('a[target="_blank"]');
    if(!a) return;
    e.preventDefault();
    location.href = a.href;
  });
}

// Sort and threshold belong in the address too, so a link carries the list as it was read.
// replaceState, not a reload — the rows are already in the DOM and only get reordered or
// hidden.
function writeState(over){
  const p = new URLSearchParams(location.search);
  Object.entries(over).forEach(([k, v]) => { if(!v) p.delete(k); else p.set(k, v); });
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
}

/* ---------------- queries ---------------- */

function taxonObsUrl(taxonId, user){
  return "https://www.inaturalist.org/observations?taxon_id=" + encodeURIComponent(taxonId)
       + "&user_id=" + encodeURIComponent(user) + "&verifiable=any";
}

// One species inside the area, on iNat — where a place-tab row points.
function taxonAreaUrl(taxonId){
  const p = new URLSearchParams({ taxon_id: taxonId, verifiable: "any" });
  if(view.place) p.set("place_id", view.place);
  else if(hasPin){ p.set("lat", view.lat); p.set("lng", view.lng); p.set("radius", view.radius); }
  return "https://www.inaturalist.org/observations?" + p.toString();
}

// The whole area on iNat's own species view — the page this tab is modelled on.
function areaSpeciesUrl(){
  const p = new URLSearchParams({ view: "species", verifiable: "any" });
  if(view.place) p.set("place_id", view.place);
  else if(hasPin){ p.set("lat", view.lat); p.set("lng", view.lng); p.set("radius", view.radius); }
  if(view.taxon) p.set("taxon_id", view.taxon);
  if(view.iconic.length) p.set("iconic_taxa", view.iconic.join(","));
  return "https://www.inaturalist.org/observations?" + p.toString();
}

// Where a tier heading points on iNat: the sound-only band opens this user's audio-only
// records, every other band opens their observations carrying that tier tag.
function tierUrl(tag, user){
  if(tag === "audio"){
    return "https://www.inaturalist.org/observations?sounds=true&photos=false&verifiable=any"
         + "&user_id=" + encodeURIComponent(user);
  }
  return "https://www.inaturalist.org/observations?q=" + encodeURIComponent(tag)
       + "&search_on=tags&verifiable=any&user_id=" + encodeURIComponent(user);
}

function scopeLabel(){
  if(view.taxon) return view.tname || ("taxon " + view.taxon);
  if(view.iconic.length) return view.iconic.map(v => {
    const hit = ICONIC.find(i => i[0] === v);
    return hit ? hit[1] : v;
  }).join(" + ");
  return "all taxa";
}

// Scope a species_counts query to one user plus the taxon / quick-group filters the map
// was holding when the link was made.
function userScope(user){
  const o = { user_id: user };
  if(view.taxon) o.taxon_id = view.taxon;
  if(view.iconic.length) o.iconic_taxa = view.iconic.join(",");
  return o;
}

// Page through species_counts and return the raw {taxon, count} rows.
//
// Casual records are dropped by default, on every query that doesn't say otherwise: captive
// and cultivated plants, undated and unplaced records. A species known here only from those
// leaves the list entirely rather than sitting in it with a count of one. `verifiable` is
// iNat's own shorthand for research plus needs-ID, and is what their species view applies.
// A caller can pass `verifiable` itself to override that — see speciesIdsWithTag.
async function speciesCounts(params){
  const out = [];
  for(let page = 1; page <= 20; page++){
    const p = new URLSearchParams(params);
    if(!p.has("verifiable")) p.set("verifiable", "true");
    p.set("per_page", "500");
    p.set("page", String(page));
    const d = await apiGet(`${API}/observations/species_counts?${p.toString()}`);
    (d.results || []).forEach(x => { if(x.taxon && x.taxon.id) out.push(x); });
    if(page * 500 >= (d.total_results || 0)) break;
  }
  return out;
}

// The species carrying one tier's tag. One request per tag: the tags index matches a
// single term, so "s b" ORs nothing.
//
// The one query on this page that reaches into casual records. A tier tag is a judgement
// the user made about their own photograph, and it stands wherever that photograph sits —
// a captive plant or an undated shot still carries the tag, and dropping it would band the
// species as Untagged while the tag is plainly there. Widening the tag lookup alone is
// safe: the species lists it is matched against are still verifiable-only, so a species
// known solely from a casual record is not dragged onto the page by its tag.
async function speciesIdsWithTag(user, tag){
  const rows = await speciesCounts({ ...userScope(user), search_on:"tags", q:tag, verifiable:"any" });
  return new Set(rows.map(x => x.taxon.id));
}

/* ---------------- place scope ----------------

   The place tab reads a patch of ground, either an iNat place or the map's own pin and
   radius. Deliberately unfiltered by date or quality grade: the question is what has been
   recorded here, ever, and the map's default three-month window would quietly answer a
   much smaller one. Taxon and quick-group scope still apply — those are the reader's. */

function areaScope(){
  const o = {};
  if(view.place) o.place_id = view.place;
  else if(hasPin){ o.lat = view.lat; o.lng = view.lng; o.radius = view.radius; }
  if(view.taxon) o.taxon_id = view.taxon;
  if(view.iconic.length) o.iconic_taxa = view.iconic.join(",");
  return o;
}

// A pin dropped at deep zoom carries a radius of metres, not kilometres, so the label
// switches units rather than rounding the whole area away to "0.0 km".
function fmtRadius(km){
  const m = Math.round(km * 1000);
  if(m >= 1000) return (m / 1000).toFixed(1) + " km";
  return Math.max(1, m) + " m";
}

function areaLabel(){
  if(view.place) return view.pname || ("place " + view.place);
  if(hasPin) return `${fmtRadius(+view.radius)} around ${(+view.lat).toFixed(3)}, ${(+view.lng).toFixed(3)}`;
  return "nowhere yet";
}

// Every species recorded in the area, heaviest first — the same count iNat's own species
// view leads with.
async function speciesHere(){
  const rows = (await speciesCounts({ ...areaScope(), ...sspOnly() })).filter(isSpeciesRow);
  // Already heaviest-first out of the split, and by the subspecies' own counts.
  if(view.ssp) return splitIntoSubspecies(rows, areaScope());
  rows.sort((a, b) => b.count - a.count || sortName(a.taxon).localeCompare(sortName(b.taxon)));
  return rows;
}

// Which of the area's species this user has never recorded — asked of iNat the way round
// that keeps the answer small. Reading their species list instead would mean paging an
// entire life list (11k species, two dozen requests) to tick off a few hundred rows; this
// is one area-sized query however much the user has seen. "Unobserved" is iNat's own and
// means anywhere, not just here, so the tick reads as "I have this species".
async function unseenHere(user){
  const rows = await speciesCounts({ ...areaScope(), unobserved_by_user_id: user });
  return new Set(rows.map(x => x.taxon.id));
}

// iNat's taxon search, the same index behind the map's species field — so a name typed here
// and a name typed there land on the same taxon.
async function findTaxa(text){
  const p = new URLSearchParams({ q: text, per_page: "8" });
  const d = await apiGet(`${API}/taxa/autocomplete?${p}`);
  return (d.results || []).map(t => ({
    id: t.id,
    // The scientific name is what rides in the address as `tname`, matching the map, so a
    // link made on either page reads the same when it lands on the other.
    name: t.name,
    common: t.preferred_common_name || "",
    rank: t.rank || "",
    thumb: (t.default_photo && t.default_photo.square_url) || ""
  }));
}

// iNat's own place search, the one behind the place field on their observation pages.
async function findPlaces(text){
  const p = new URLSearchParams({ q: text, per_page: "8" });
  const d = await apiGet(`${API}/places/autocomplete?${p}`);
  return (d.results || []).map(x => ({
    id: x.id,
    name: x.display_name || x.name,
    kind: [x.place_type_name, x.bbox_area ? null : "point"].filter(Boolean).join(" · ")
  }));
}

// species_counts groups by leaf taxon, so an observation left at genus or family lands
// here as its own row — drop anything coarser than species so the list reads as species.
// rank_level: species and hybrid 10, subspecies 5. Absent rank_level fails open.
function isSpeciesRow(x){ return !(x.taxon.rank_level > 10); }

/* ---------------- subspecies ----------------

   species_counts will not report a taxon below species rank, ever. An observation identified
   to subspecies is counted under its species — ask for one subspecies by id (33603, Tarentola
   mauritanica mauritanica) and the answer comes back as Tarentola mauritanica. Tested against
   the live API; nothing changes the grouping (`leaf`, `rank_level`, `lrank` and `rank` all
   leave it alone, and identifications/species_counts rolls up as well and ignores the scope).
   So a subspecies list cannot be asked for. It has to be built.

   Two behaviours of that same roll-up are what make it buildable:

     - `hrank=subspecies` filters which OBSERVATIONS are counted — those identified at
       subspecies or below — while still reporting them under their species. One query, and
       every species carrying infraspecific records is named with the size of them.
     - a query scoped to a subspecies by id counts THAT subspecies, and only the name it
       answers under is rolled up. So a count per subspecies is one id away.

   The catch is that two subspecies of the same species asked together come back merged under
   the one species, indistinguishable. So the asking goes in rounds: each round takes at most
   one candidate per species, which makes every row in the answer traceable to the id that
   earned it. A species drops out of the rounds as soon as the counts found for it add up to
   the `hrank` total it started with — which is why this converges instead of walking a
   taxonomy. Portugal's reptiles: 21 species, 30 subspecies, four rounds, six requests, every
   parent adding up exactly.

   Candidates come from the taxonomy (`/taxa?parent_id=`, which takes a comma list) minus
   everything with no observations anywhere, since a subspecies unrecorded worldwide cannot be
   recorded here. That prune is what keeps the rounds shallow — Podarcis siculus carries 52
   named subspecies of which 11 have ever been seen — and ordering what survives by world
   count puts the likely one in the first round.

   What a split row is: a real taxon from the taxonomy, so it sorts, bands by family, carries
   its own photograph and points its own links at itself. It also carries `parent`, which is
   what the asking is organised around — see the block below on reading a reader's own records
   at this rank. */

// What a row is, for the tallies that count them. Both singular and plural in English, which
// is convenient, since these read "30 subspecies" and "1 / 30 subspecies observed" alike.
function rowNoun(){ return view.ssp ? "subspecies" : "species"; }

const SSP_RANKS = "subspecies,variety,form";
// A backstop, not a working limit: the rounds normally end themselves within four. It bounds
// the damage if a species' counts can never add up — a variety filed under a subspecies rather
// than under the species would leave a remainder no candidate can settle.
const SSP_ROUNDS = 12;

function sspOnly(){ return view.ssp ? { hrank: "subspecies" } : {}; }

/* ---------------- what the reader holds, per subspecies ----------------

   Every user-level query on this page comes back keyed by species: the tag searches, the
   audio pair, `unobserved_by_user_id`. Left there, a tick on a split row could only answer
   for the parent species — the reader has THIS BIRD, not this race of it.

   The way through is the same one the split itself uses: a query scoped to a subspecies by id
   counts that subspecies, and only the name it answers under is rolled up. So the five
   questions standingLookup asks of species can be asked of subspecies, one id at a time.

   And it carries the same lock: two subspecies of one species asked together come back merged
   under it. So the rows are dealt into waves holding at most one subspecies per parent, and
   each question is put to a whole wave at once. Waves are shallow — a species contributes one
   only for each of its races on the list — so this is a handful of requests, not one per row. */

function parentOf(x){ return x.parent || x.taxon.id; }

function sspWaves(rows){
  const out = [];
  const depth = new Map();
  rows.forEach(x => {
    const parent = parentOf(x);
    const n = depth.get(parent) || 0;
    depth.set(parent, n + 1);
    (out[n] = out[n] || []).push(x);
  });
  return out;
}

// One question put to one wave: which of its subspecies the answer names. The reply is rolled
// up to species as always, but a wave holds at most one subspecies per species, so a row
// coming back under a species can only be about the id asked for it.
async function sspAsk(wave, scope, params){
  const asked = new Map(wave.map(x => [parentOf(x), x.taxon.id]));
  const hits = new Set();
  for(const batch of idBatches(wave.map(x => x.taxon.id), 6000)){
    (await speciesCounts({ ...scope, ...params, taxon_id: batch.join(",") }))
      .forEach(r => { const id = asked.get(r.taxon.id); if(id != null) hits.add(id); });
  }
  return hits;
}

// standingLookup's questions, asked of subspecies. Same vocabulary and the same order of
// precedence, so a badge cannot mean one thing on a split list and another on a whole one.
//
// The first pass is skipped where every row is already known to be the reader's own — the
// tier tab, whose rows came out of a query scoped to them to begin with. Everywhere else it
// earns its place twice over: it says which rows get a tick, and it spares the other five
// questions every subspecies the reader has never recorded.
async function sspStanding(rows, user, allRecorded){
  const scope = userScope(user);
  const recorded = new Set();
  if(allRecorded) rows.forEach(x => recorded.add(x.taxon.id));
  else for(const wave of sspWaves(rows))
    (await sspAsk(wave, scope, {})).forEach(id => recorded.add(id));

  const mine = rows.filter(x => recorded.has(x.taxon.id));
  const tag = { s: new Set(), b: new Set(), c: new Set() };
  const heard = new Set(), shot = new Set();
  for(const wave of sspWaves(mine)){
    // Tags reach into casual records and the audio pair does not — the same split
    // speciesIdsWithTag and audioOnlySpeciesIds make, and for the reasons written there.
    const [s, b, c, h, p] = await Promise.all([
      sspAsk(wave, scope, { search_on: "tags", q: "s", verifiable: "any" }),
      sspAsk(wave, scope, { search_on: "tags", q: "b", verifiable: "any" }),
      sspAsk(wave, scope, { search_on: "tags", q: "c", verifiable: "any" }),
      sspAsk(wave, scope, { sounds: "true", photos: "false" }),
      sspAsk(wave, scope, { photos: "true" })
    ]);
    s.forEach(id => tag.s.add(id));
    b.forEach(id => tag.b.add(id));
    c.forEach(id => tag.c.add(id));
    h.forEach(id => heard.add(id));
    p.forEach(id => shot.add(id));
  }
  // Heard and never photographed, asked of the race rather than the species — so a bird
  // photographed as one subspecies and only recorded singing as another reads honestly on
  // both rows.
  return id => !recorded.has(id) ? ""
             : tag.s.has(id) ? "s"
             : tag.b.has(id) ? "b"
             : tag.c.has(id) ? "c"
             : heard.has(id) && !shot.has(id) ? "audio"
             : "seen";
}

async function taxaPaged(params){
  const out = [];
  for(let page = 1; page <= 20; page++){
    const p = new URLSearchParams(params);
    p.set("per_page", "500");
    p.set("page", String(page));
    const d = await apiGet(`${API}/taxa?${p}`);
    (d.results || []).forEach(t => out.push(t));
    if(page * 500 >= (d.total_results || 0)) break;
  }
  return out;
}

// Every named subspecies of these species that has ever been recorded, filed under the
// species it belongs to and heaviest-in-the-world first. Batched by URL length like the
// family lookup, and for the same reason — see idBatches.
async function sspCandidates(parentIds){
  const parents = new Set(parentIds);
  const byParent = new Map();
  for(const batch of idBatches(parentIds, 6000)){
    const kids = await taxaPaged({ parent_id: batch.join(","), rank: SSP_RANKS });
    kids.forEach(t => {
      if(!t.observations_count) return;
      // The deepest of its ancestors that is one of the species asked about — a variety filed
      // under a subspecies still belongs to the species both sit in.
      const parent = (t.ancestor_ids || []).filter(id => parents.has(id)).pop();
      if(parent == null) return;
      if(!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(t);
    });
  }
  byParent.forEach(list => list.sort((a, b) => b.observations_count - a.observations_count));
  return byParent;
}

// The rounds. `parentRows` is the hrank query's answer — one row per species, counting its
// infraspecific records — and what comes back is those counts spent on the subspecies that
// earned them, shaped like the species_counts rows the rest of the page reads.
async function splitIntoSubspecies(parentRows, scope){
  const byParent = await sspCandidates(parentRows.map(x => x.taxon.id));
  const owed = new Map(parentRows.map(x => [x.taxon.id, { name: x.taxon.name, left: x.count }]));
  const out = [];
  for(let round = 0; round < SSP_ROUNDS; round++){
    const asking = [];
    owed.forEach((p, id) => {
      const queue = byParent.get(id);
      if(p.left > 0 && queue && queue.length) asking.push([id, queue.shift()]);
    });
    if(!asking.length) break;
    // One id per species this round, so every row in the answer belongs to exactly one of
    // them however the batches fall.
    const found = new Map();
    for(const batch of idBatches(asking.map(([, t]) => t.id), 6000)){
      (await speciesCounts({ ...scope, taxon_id: batch.join(",") }))
        .forEach(x => found.set(x.taxon.id, x.count));
    }
    asking.forEach(([id, t]) => {
      const n = found.get(id);
      if(!n) return;             // named in the taxonomy, not recorded in this scope
      const p = owed.get(id);
      out.push({ taxon: t, count: n, parent: id, parentName: p.name });
      p.left -= n;
    });
  }
  out.sort((a, b) => b.count - a.count || sortName(a.taxon).localeCompare(sortName(b.taxon)));
  return out;
}

// The name the list sorts and labels by — common where iNat has one, binomial otherwise.
function sortName(t){ return (t.preferred_common_name || t.name || "").toLowerCase(); }

// Aves' own taxon id, for the eBird links further down. Read off the ancestry rather than
// `iconic_taxon_name`, which says the same thing but only where it is set — the ancestry is
// already what the taxonomic sort leans on being on every row.
const AVES = 3;
function isBird(t){ return (t.ancestor_ids || []).includes(AVES); }

/* ---------------- taxonomic order ----------------

   Every row arrives with `ancestor_ids`, its path down iNat's tree, so the tree order is
   already in hand — no extra request to sort by. Comparing those paths sorts the list the
   way a field guide runs: classes, then orders, then families, genera together at the end.
   Each id is zero-padded so a plain string compare stays numeric per level.

   Within a family the sequence is by taxon id rather than any published checklist order —
   iNat exposes no ordering key of its own — so read it as "grouped taxonomically", not as
   a Clements or IOC sequence. */

function ancestorsOf(t){ return (t.ancestor_ids || []).filter(id => id !== t.id); }
function taxoKey(t){ return ancestorsOf(t).map(n => String(n).padStart(9, "0")).join("."); }

// Family names for the headings. Ranks aren't in the species rows, only bare ancestor ids,
// so every distinct ancestor across the list has to be looked up to find which ones are
// families. `rank=family` filters that server-side, so the response is only the families
// among the ids asked for — the bulk of a big fauna is genus- and subgenus-level ids that
// never come back, so the id list is the only cost, not the payload.
//
// Batches are sized by the encoded URL length rather than a fixed id count: iNat's API
// accepts a request up to somewhere around 8,000 characters of query string before the
// connection is simply refused (tested empirically, no documented limit), and taxon ids
// vary from 3 to 8 digits, so a fixed count either wastes requests or risks tipping over
// that line. 6,000 characters of id list leaves headroom for the other params and for
// wider ids than the ones tested against.
//
// A dense scope like Insecta over a whole country still runs a few thousand ids through
// this — a country's insects can have more distinct ancestor ids than there are species,
// since most of them are the fine ranks (subgenus, tribe) that are near-unique per
// species. That's a real handful of requests, not a runaway one: everything here fails
// soft regardless, so a slow or failed pass costs headings, not the list itself.
const familyOf = new Map();     // species taxon id -> {name, common}
let familiesReady = null;

function idBatches(ids, maxCharsPerBatch){
  const batches = [];
  let cur = [], len = 0;
  ids.forEach(id => {
    const piece = String(id).length + 1;      // + the joining comma
    if(cur.length && len + piece > maxCharsPerBatch){ batches.push(cur); cur = []; len = 0; }
    cur.push(id);
    len += piece;
  });
  if(cur.length) batches.push(cur);
  return batches;
}

async function loadFamilies(buckets){
  const rows = buckets.flat();
  const ids = new Set();
  rows.forEach(x => ancestorsOf(x.taxon).forEach(id => ids.add(id)));
  if(!ids.size) return;
  const families = new Map();       // family taxon id -> {name, common}
  for(const batch of idBatches([...ids], 6000)){
    const p = new URLSearchParams({ id: batch.join(","), rank: "family", per_page: "500" });
    const d = await apiGet(`${API}/taxa?${p}`);
    (d.results || []).forEach(t => families.set(t.id, { id: t.id, name: t.name, common: t.preferred_common_name || "" }));
  }
  rows.forEach(x => {
    const fam = ancestorsOf(x.taxon).map(id => families.get(id)).find(Boolean);
    if(fam) familyOf.set(x.taxon.id, fam);
  });
}

/* ---------------- eBird ----------------

   Bird rows carry one more link, out to the same species on eBird. eBird addresses a species
   by its own six-letter code — `brnowl`, not `Tyto alba` — and offers no key-free way to look
   one up: their taxonomy endpoint answers 403 without an API key, and iNaturalist holds no
   eBird identifier to hand over. Wikidata has both sides of that join and answers
   unauthenticated with CORS open, so the code comes from there: match the scientific name
   (P225), read off the eBird taxon id (P3444).

   Names are asked about in batches rather than a row at a time, batched by URL length the same
   way the family lookup is — see loadEbirdLinks for why the batches are small and sequential.
   Roughly one species in fifteen comes back empty — recent splits and renames iNaturalist has
   taken up and Wikidata has not, and hybrids, which eBird has no page for anyway — and those
   keep no link at all rather than being given a broken one.

   A code never changes once minted, so what comes back is kept in localStorage and only names
   never seen before are ever asked about. Misses are written too, as "", so a species Wikidata
   cannot place is asked about once rather than on every visit. Wrapped like the gallery's
   record of seen photos: with no storage the links still appear, the page just re-asks. */

const WDQS = "https://query.wikidata.org/sparql";
const EBIRD_STORE = "inat.ebird.codes";

function readEbirdCodes(){
  try{ return JSON.parse(localStorage.getItem(EBIRD_STORE)) || {}; }
  catch(e){ return {}; }      // private mode, or somebody else's JSON: start clean
}

const ebirdCode = readEbirdCodes();

function writeEbirdCodes(){
  try{ localStorage.setItem(EBIRD_STORE, JSON.stringify(ebirdCode)); }
  catch(e){ /* No room, or no storage at all. The links still work, they just aren't free. */ }
}

// A name into a SPARQL string literal. Scientific names are letters, spaces and the odd
// hybrid ×, but a quote or a backslash arriving from the API must not be able to close the
// literal and go on to write a query of its own.
function sparqlStr(s){ return '"' + String(s).replace(/[\\"]/g, c => "\\" + c) + '"'; }

async function ebirdCodesFor(names){
  const q = `SELECT ?name ?code WHERE {
    VALUES ?name { ${names.map(sparqlStr).join(" ")} }
    ?taxon wdt:P225 ?name; wdt:P3444 ?code. }`;
  const r = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`,
    { headers: { Accept: "application/sparql-results+json" } });
  if(!r.ok) throw new Error(r.status);
  const d = await r.json();
  return ((d.results && d.results.bindings) || []).map(b => [b.name.value, b.code.value]);
}

// Hang the links on whatever is currently rendered. The anchor is already in the row, empty
// and hidden, so this is one pass over the rendered rows rather than a repaint — it costs the
// sort, the threshold, the family bands and the hide-cascade nothing.
function showEbirdLinks(){
  document.querySelectorAll("#main li[data-sci]").forEach(li => {
    const a = li.querySelector("a.ebird");
    const code = ebirdCode[li.dataset.sci];
    if(!a || !code) return;
    a.href = "https://ebird.org/map/" + encodeURIComponent(code);
    a.hidden = false;
  });
}

// The query service sheds load by refusing a request outright rather than queuing it, and a
// refused batch is almost always fine a moment later. Worth one wait-and-ask-again: without it
// a single refusal mid-list costs that batch its links until the page is next opened, and
// refusals are common enough to see on an ordinary load. `pause` is the one defined up in the
// request gate — the only thing this shares with it, the two services being asked separately.
async function ebirdCodesRetrying(batch){
  try{ return await ebirdCodesFor(batch); }
  catch(e){
    await pause(1500);
    return ebirdCodesFor(batch);
  }
}

// Small batches, one at a time. The query service is a shared public endpoint and has to be
// asked accordingly: a long VALUES list can take it tens of seconds where fifty names come
// back in under one, and asking in parallel earns a refusal rather than a faster answer. So the
// names go up in short runs, sequentially, and the links appear a batch at a time instead of
// all at the end. 900 characters is roughly fifty species — a whole life list is a dozen or so
// quick requests, once, and never again on that browser.
//
// A batch that fails twice is left entirely alone rather than written off as a batch of misses:
// no code is cached for those names, so the next visit asks again. Failing soft per batch and
// not per pass matters here, since one refusal in the middle of a life list would otherwise
// cost every name after it too.
async function loadEbirdLinks(buckets){
  // The same name the rows carry in `data-sci`, which on a split row is the parent species —
  // the two have to agree or the codes land under keys no row ever asks for.
  const names = [...new Set(buckets.flat().filter(x => isBird(x.taxon))
    .map(x => x.parentName || x.taxon.name))];
  if(!names.length) return;
  showEbirdLinks();                       // whatever storage already knows, before asking anything
  const fresh = names.filter(n => !(n in ebirdCode));
  if(!fresh.length) return;
  for(const batch of idBatches(fresh, 900)){
    let hits;
    try{ hits = await ebirdCodesRetrying(batch); }
    catch(e){ continue; }
    // Every name in a batch that came back is answered, hit or miss — see the note on "" above.
    batch.forEach(n => { ebirdCode[n] = ""; });
    hits.forEach(([name, code]) => { ebirdCode[name] = code; });
    writeEbirdCodes();
    showEbirdLinks();
  }
}

// Species this user has only ever recorded by sound: at least one audio-only observation,
// and no photograph of that species anywhere. The second half is what makes the band
// meaningful — a species with forty photos and one incidental sound recording still has
// frames to tag, and belongs with the rest. Only a bird heard and never seen has nothing
// a tier tag could ever be applied to.
//
// Two queries, because iNat filters observations by their media while this is a question
// about the species: "no photo of it at all" can only be answered by subtracting the
// photographed set.
async function audioOnlySpeciesIds(user){
  const scope = userScope(user);
  const [heard, shot] = await Promise.all([
    speciesCounts({ ...scope, sounds: "true", photos: "false" }),
    speciesCounts({ ...scope, photos: "true" })
  ]);
  const photographed = new Set(shot.map(x => x.taxon.id));
  return new Set(heard.map(x => x.taxon.id).filter(id => !photographed.has(id)));
}

// Where this user stands on every species they have recorded: the best tier tag it carries,
// "audio" for the ones heard and never photographed, "seen" for recorded but ungraded.
// Same order of precedence as the tier tab's bands — this is that question asked from the
// other side, so a species must never read as C here and B there.
//
// Scoped by taxon/quick-group like everything else on the page, not by the area: the badge
// answers "what have I got on this bird", which does not change with where you are standing.
async function standingLookup(user){
  const [s, b, c, audio] = await Promise.all([
    speciesIdsWithTag(user, "s"),
    speciesIdsWithTag(user, "b"),
    speciesIdsWithTag(user, "c"),
    audioOnlySpeciesIds(user)
  ]);
  return id => s.has(id) ? "s"
             : b.has(id) ? "b"
             : c.has(id) ? "c"
             : audio.has(id) ? "audio"
             : "seen";
}

// The report's sections, weakest first. A species sits at the best tag it carries, so
// these read as where it stands rather than what it lacks.
// Third field does double duty: what the heading links to on iNat — a tier tag search,
// "audio" for the sound-only band, or "" for Untagged, which has nothing to point at — and,
// via `tag || "seen"`, which badge heads the section. Both vocabularies are the same one
// standingLookup speaks, so a band and a badge can never drift apart.
// Display order — this is the order the sections and the rail appear in, and it's yours to
// arrange; nothing below reads position in this array as meaning anything beyond "where it
// sits on the page."
const TIERS = [
  ["Untagged",   "Not one observation carries a tier tag.",          ""],
  ["Audio only", "Recorded by sound alone — no photograph to tag.",  "audio"],
  ["Tier",     "C is the best tag on it — nothing tagged B or S.", "c"],
  ["Tier",     "B is the best tag on it — nothing tagged S.",      "b"],
  ["Tier",     "Carries an S tag, the top tier.",                  "s"],
];

// Hide-cascade rank — weakest standing first, and deliberately NOT the same array as TIERS:
// the two pages show these in different orders on purpose (Untagged first on the tier tab,
// audio first on the place tab), so display order and rank have to be free to disagree.
// Rearranging TIERS must never change what a click hides.
//
// Audio sits at the floor: clicking it hides every standing, since a species heard and never
// photographed is the least you can have — on the place tab that leaves only the species you
// have never recorded at all. The green tick one rung up hides Untagged/C/B/S but leaves
// audio-only be. This is also the order the place tab's legend is painted in.
const STANDING_ORDER = ["audio", "seen", "c", "b", "s"];
function standingRank(mark){ return STANDING_ORDER.indexOf(mark || "seen"); }

// The same run of standings read as a sort key rather than a cutoff, with the species you
// have never recorded sitting below the floor of it. Deliberately not standingRank, which
// folds a blank into "seen" because a blank there is a tier-tab row wearing the plain tick.
// A blank here is the opposite — a species you have nothing at all on — and this order leads
// with those, which is what the place tab is read for.
function tierRank(mark){ return mark ? STANDING_ORDER.indexOf(mark) + 1 : 0; }

// Band every species the user has recorded by its best tag. Nothing drops out — the five
// tiers together are everything recorded in scope. This fallback order (a tag always beats
// a sound recording, a sound recording always beats nothing) is independent of both TIERS'
// display order and STANDING_ORDER's hide rank — three separate orderings over the same
// five names, each answering a different question.
async function speciesByTier(user){
  // The one list-defining query on this tab, so the one the subspecies filter narrows and
  // then splits.
  let all = (await speciesCounts({ ...userScope(user), ...sspOnly() })).filter(isSpeciesRow);
  // Split rows band by their own tags, read one race at a time — so a bird tagged S on one
  // subspecies and never tagged on another sits in two different tiers, which is the whole
  // point of asking for the races. Every row here is already the reader's own, the list
  // being theirs by definition, so the "have you recorded it" pass is skipped.
  if(view.ssp){
    all = await splitIntoSubspecies(all, userScope(user));
    const standing = await sspStanding(all, user, true);
    const buckets = TIERS.map(() => []);
    all.forEach(x => {
      const mark = standing(x.taxon.id);
      // "seen" is this tab's Untagged — the plain tick, nothing tagged. The other four names
      // are TIERS' own, so they index it directly.
      const tag = mark === "seen" ? "" : mark;
      buckets[TIERS.findIndex(t => t[2] === tag)].push(x);
    });
    return sortWithinTiers(buckets);
  }
  const have = {};
  for(const tag of LEVELS) have[tag] = await speciesIdsWithTag(user, tag);
  const audio = await audioOnlySpeciesIds(user);
  const buckets = TIERS.map(() => []);
  for(const x of all){
    const has = tag => have[tag].has(x.taxon.id);
    // Index by each tier's position in TIERS (its tag), not by a hardcoded slot — so this
    // keeps working whatever order the sections are arranged in.
    const tag2 = has("s") ? "s" : has("b") ? "b" : has("c") ? "c" : audio.has(x.taxon.id) ? "audio" : "";
    buckets[TIERS.findIndex(t => t[2] === tag2)].push(x);
  }
  return sortWithinTiers(buckets);
}

// Heaviest-recorded first inside each tier: the species you already have the most shots
// of are the ones most likely to hold a taggable frame. The page can flip to A–Z
// without a refetch.
function sortWithinTiers(buckets){
  buckets.forEach(rows => rows.sort((a, b) =>
    b.count - a.count || sortName(a.taxon).localeCompare(sortName(b.taxon))));
  return buckets;
}

/* ---------------- painting ---------------- */

const main = document.getElementById("main");
const countEl = document.getElementById("count");

// A speaker, for the species heard and never seen. Same drawing as the map's audio pins,
// flattened to one colour since it sits on a filled disc here.
const SPEAKER_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3.5 9.5H6.7L11.5 6V18L6.7 14.5H3.5Z"
        fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M14.6 9.6a4.2 4.2 0 010 4.8M17.6 7.6a8 8 0 010 8.8"
        fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

// The two shapes the list can take, drawn rather than only named: rows of thumbnail beside
// text, and a wall of tiles. Each is a small picture of what it does, so the pair can be told
// apart without reading either label. currentColor throughout, like the speaker above, so
// they follow the button through hover and selected rather than needing a second drawing.
const LAYOUT_ICON = {
  list: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="1" y="2" width="4.6" height="4.6" rx="1"/><rect x="7.6" y="3.3" width="7.4" height="2" rx="1"/>
    <rect x="1" y="9.4" width="4.6" height="4.6" rx="1"/><rect x="7.6" y="10.7" width="7.4" height="2" rx="1"/>
  </svg>`,
  grid: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="1" y="1" width="6" height="6" rx="1.2"/><rect x="9" y="1" width="6" height="6" rx="1.2"/>
    <rect x="1" y="9" width="6" height="6" rx="1.2"/><rect x="9" y="9" width="6" height="6" rx="1.2"/>
  </svg>`
};

// The arrow every reversible order wears, drawn once pointing the way the button's own
// label reads and turned over in CSS when the order is (see `.sortbar button.rev`) — the
// reverse of an arrow is the same arrow upside down, so a second drawing would only be the
// first one again. currentColor like the icons above, so it follows the button through hover
// and selected.
const SORT_ARROW = `<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M8 2.8v10.4M3.9 9.1L8 13.2l4.1-4.1"
        fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// What the badge says, per standing. The glyph carries the tier and the colour ramps with
// it — bronze, silver, gold for C, B, S — so a column of these can be read at a glance
// without stopping on each letter.
const BADGE = {
  seen:  ["&#10003;",   "recorded, but nothing tagged"],
  audio: [SPEAKER_SVG,  "recorded by sound alone"],
  c:     ["C",          "best tag: tier C"],
  b:     ["B",          "best tag: tier B"],
  s:     ["S",          "best tag: tier S"]
};

// Every badge doubles as a hide-cascade trigger: click one and it, along with everything
// ranked at or above it (see STANDING_ORDER), drops out of view — a click again on the
// same rank brings it all back. `data-rank` is what wireHideToggle reads; the row badges
// carry a title of their own already, so only the parts particular to each caller differ.
function badgeHtml(mark, user){
  const hit = BADGE[mark] || BADGE.seen;
  return ` <span class="tick tick-${esc(mark)}" data-rank="${standingRank(mark)}"
      role="button" tabindex="0"
      title="@${esc(user)} &mdash; ${hit[1]}. Click to hide this and every better standing."
      aria-label="${hit[1]}">${hit[0]}</span>`;
}

// The same badge standing in for a whole band, on the tier tab's headings and rail. Takes a
// TIERS tag, where "" means Untagged and maps to the plain tick — `data-rank` comes from
// STANDING_ORDER, not this tier's position in TIERS, so the hide-cascade stays correct
// however the sections are arranged. No longer purely decorative — aria-hidden is dropped
// in favour of a real label, since it now does something.
function tierBadge(tag){
  const mark = tag || "seen";
  return `<span class="tick tick-${esc(mark)}" data-rank="${standingRank(mark)}" role="button" tabindex="0"
      title="Hide ${esc(BADGE[mark][1])} and above"
      aria-label="Hide ${esc(BADGE[mark][1])} and above">${BADGE[mark][0]}</span>`;
}

// `mark` is the place tab's badge: null on the tier tab, where every row is the user's own
// by definition, and on the place tab either "" for a species they have never recorded or
// their standing on it ("seen" | "audio" | "c" | "b" | "s").
function rowHtml(x, i, user, mark){
  const t = x.taxon;
  // On the place tab the link has to show the species in the area, not this user's takes
  // on it — the whole point is the ones they have never recorded.
  // `t.id` throughout, which on a split row is the subspecies — so every link a row owns
  // points at the subspecies it names rather than at the species it was carved out of.
  const url = mark == null ? taxonObsUrl(t.id, user) : taxonAreaUrl(t.id);
  // "View my" points at the row's own taxon too, badge and link agreeing: the tick beside it
  // is now read one race at a time, so a green tick on a subspecies means this reader has
  // that subspecies and the link cannot come back empty under it.
  const photo = t.default_photo && (t.default_photo.medium_url || t.default_photo.square_url);
  // Plenty of taxa have no English name; those lead with the binomial instead of
  // printing it twice, set in the same italic serif the second line would have used.
  const common = t.preferred_common_name || "";
  const tick = mark ? badgeHtml(mark, user) : "";
  // Place tab only, and only where a tick is already drawn: a species with no standing has
  // nothing of the user's to view. It rides on the meta line, parted from the area's own count
  // by a dot, so the two counts of the same species read as the one thought — what is here,
  // and what of it is mine. The dot belongs to the link, not to the line: on the tier tab
  // there is no `View my` and the count must not trail a separator with nothing after it.
  const viewMy = mark
    ? ` <span class="sep">&middot;</span><a class="viewMy" href="${esc(taxonObsUrl(t.id, user))}"
          target="_blank" rel="noopener"
          title="${esc(user)}&#39;s own records of this ${rowNoun()}, everywhere">View my</a>`
    : "";
  // Birds only, and painted empty and hidden: the code eBird needs is looked up behind the
  // finished list, the same way family names are, and the link appears if and when one lands.
  // No href until then, so a row never holds a link that goes nowhere. `data-sci` rides along
  // as what the lookup is keyed by, and is on the bird rows for the same reason.
  const bird = isBird(t);
  const ebird = bird
    ? ` <a class="ebird" target="_blank" rel="noopener" hidden
          title="${esc(common || t.name)} on eBird">eBird</a>`
    : "";
  // Wikidata is asked about the species even on a split row: it matches on scientific name,
  // and a trinomial mostly finds nothing there, which would quietly cost every bird its eBird
  // link the moment the checkbox went on. The link lands on the species' map — eBird codes
  // subspecies separately and Wikidata does not hold that side of the join.
  const sci = x.parentName || t.name;
  return `<li class="${mark ? "seen" : ""}" data-count="${x.count}" data-name="${esc(sortName(t))}"
      data-taxo="${esc(taxoKey(t))}" data-taxon="${t.id}" data-seen="${mark ? 1 : 0}"
      data-standing="${esc(mark || "")}"${bird ? ` data-sci="${esc(sci)}"` : ""}>
    <span class="num">${i + 1}</span>
    <a class="shot" href="${esc(url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${
      photo ? `<img src="${esc(photo)}" alt="" loading="lazy">`
            : `<span class="nophoto">&#9673;</span>`}</a>
    <span class="body">
      <span class="common${common ? "" : " as-sci"}"><a href="${esc(url)}" target="_blank" rel="noopener">${
        esc(common || t.name || "Unnamed")}</a>${tick}${ebird}</span>
      ${common && t.name ? `<span class="sci">${esc(t.name)}</span>` : ""}
      <span class="meta">${x.count} observations${viewMy}</span>
      <span class="url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></span>
    </span>
  </li>`;
}

const SSP_HINT = "Split every species into the subspecies recorded in this scope. Each row is "
  + "counted, linked, ticked and tiered as itself — a race you have not recorded stays unticked "
  + "under one you have.";

// What each reversible order is actually doing, both ways round: the arrow shows that a
// button flips, this says what the flip did. Plain text with real dashes rather than
// entities, since wireSort assigns it straight to `title` on a flip as well as printing it
// into the markup here.
const SORT_TITLE = {
  count: ["Most observed first", "Fewest observed first"],
  name: ["A to Z", "Z to A"],
  tier: ["Weakest standing first — never recorded, then audio, the tick, C, B, S — and heaviest first inside each",
         "Strongest standing first — S, B, C, the tick, audio, then never recorded — and heaviest first inside each"]
};

// One sortbar per list, shared by both tabs: it re-sorts what is already rendered, so
// flipping order never costs a refetch. On the tier tab it drives every tier at once. The
// list/grid switch rides the same row for the same reason — it shuffles nothing and refetches
// nothing either. Refresh is the exception: only the tier tab passes `withRefresh`, since the
// place tab's answer is a place's, not a person's, and has no per-user refetch to offer.
function sortbarHtml(sortBy, withRefresh){
  // The chosen order carries `rev` beside `on` when it is running backwards. That class is the
  // whole of the arrow's direction, so flipping one is the same line that moves `on` — and
  // only a reversible order can be reversed at all, so `count` and `taxo` never see it.
  const on = by => sortBy === by ? ` class="on${view.rev ? " rev" : ""}"` : "";
  // Which way round each reversible order is described. Only the chosen one can be running
  // backwards, so the other's arrow and title both read as the label does.
  const dir = by => ` title="${esc(SORT_TITLE[by][sortBy === by && view.rev ? 1 : 0])}"`;
  const laid = kind => view.layout === kind ? ` class="on"` : "";
  // The threshold reaches a different set on each tab (see underMin), so it wears a different
  // label: on the place tab it trims only the species the reader has never recorded, which is
  // worth saying out loud, since a ticked row staying put under any number looks like a bug
  // otherwise. Too long to print in the bar, so it rides as a tooltip beside the short label.
  const threshHint = tab === "place"
    ? "Only species you have not recorded &mdash; a ticked one stays however few observations it has"
    : "";
  return `<div class="sortbar">Sort
    <button type="button" data-by="count"${on("count")}${dir("count")}
      >No. of observations${SORT_ARROW}</button>
    ${canTier ? `<button type="button" data-by="tier"${on("tier")}${dir("tier")}
      >Most observed / Tier${SORT_ARROW}</button>` : ""}
    <button type="button" data-by="name"${on("name")}${dir("name")}>A&ndash;Z${SORT_ARROW}</button>
    <button type="button" data-by="taxo"${on("taxo")}>Taxonomic</button>
    <span class="thresh"${threshHint ? ` title="${threshHint}"` : ""}>Hide under
      <span class="minWrap">
        <input type="number" class="minObs" min="0" step="1" value="${view.min || ""}"
               placeholder="0" inputmode="numeric" aria-label="${
                 tab === "place" ? "Hide species you have not recorded under this many observations"
                                 : "Hide species under this many observations"}">
        <button type="button" class="minClear" title="Show every species"
                aria-label="Clear the threshold"${view.min ? "" : " hidden"}>&times;</button>
      </span> obs</span>
    ${withRefresh ? `<button type="button" id="refresh">Refresh</button>` : ""}
    <span class="layout">View
      <button type="button" data-layout="list"${laid("list")}>${LAYOUT_ICON.list}List</button>
      <button type="button" data-layout="grid"${laid("grid")}>${LAYOUT_ICON.grid}Grid</button>
    </span>
  </div>`;
}

// Order the rows for the first paint. Afterwards the sortbar shuffles the DOM instead.
// `standing` is the place tab's id-to-badge lookup, which only the tier order needs — and
// without it that order has nothing to band by, so it falls through to the count the rows
// already arrive in.
function sortRows(rows, sortBy, standing){
  // Direction comes off `view` rather than riding in beside `sortBy`, the same way the layout
  // does in the sortbar: it is a second reading of one order, not a fifth order to thread
  // through both callers.
  const rev = view.rev;
  if(sortBy === "tier" && standing) return rows.slice().sort((a, b) =>
    (rev ? tierRank(standing(b)) - tierRank(standing(a))
         : tierRank(standing(a)) - tierRank(standing(b))) ||
    b.count - a.count || sortName(a.taxon).localeCompare(sortName(b.taxon)));
  if(sortBy === "taxo") return rows.slice().sort((a, b) =>
    taxoKey(a.taxon).localeCompare(taxoKey(b.taxon)) ||
    sortName(a.taxon).localeCompare(sortName(b.taxon)));
  if(sortBy === "name") return rows.slice().sort(rev
    ? (a, b) => sortName(b.taxon).localeCompare(sortName(a.taxon))
    : (a, b) => sortName(a.taxon).localeCompare(sortName(b.taxon)));
  // The count — and the tier order with nothing to band by, which falls back to it. The rows
  // arrive heaviest-first, so read forwards this is the order they are already in and costs
  // nothing; read backwards it has to be sorted, and by count rather than simply turned over,
  // so that names still run A–Z where two species are level.
  return rev
    ? rows.slice().sort((a, b) => a.count - b.count || sortName(a.taxon).localeCompare(sortName(b.taxon)))
    : rows;
}

// An empty list is painted without a sortbar, and with it goes the checkbox that emptied it —
// so where the subspecies filter is what came back with nothing, the way back out has to be
// in the state itself. A link, not an instruction: the filter is in the address, so taking it
// off is an address too.
function sspWayOut(lede){
  return `${esc(lede)} <a href="${esc(selfUrl({ ssp: null }))}">Show every species.</a>`;
}

// The badges, spelled out — the glyphs are only obvious once, and a phone has no hover to
// fall back on. Doubles as the persistent hide-cascade control here: rows vanish once
// hidden, so this is the one thing on the place tab that stays put to bring them back.
// Painted in STANDING_ORDER — audio, tick, C, B, S — which is the place tab's own order and
// deliberately not the tier tab's; here it doubles as the rank each badge carries.
function legendHtml(){
  return `<p class="legend">${STANDING_ORDER.map((m, i) =>
    `<span class="legend-item"><span class="tick tick-${m}" data-rank="${i}" role="button" tabindex="0"
        title="Hide ${esc(BADGE[m][1])} and above">${BADGE[m][0]}</span>${
      esc(BADGE[m][1].replace("best tag: ", ""))}</span>`).join("")}</p>`;
}

// The place tab: one flat list, every species recorded in the area, badged where the
// reader has already recorded it themselves — with what they have on it, not merely that
// they have it.
function placeListHtml(rows, standing, sortBy){
  if(!rows.length){
    return `<div class="state">
      <div class="state-lede">Nothing recorded here.</div>
      <div class="state-hint">${view.ssp ? sspWayOut("Nothing inside this area has been identified below species rank.")
        : `No species inside this area under the current scope.
           Try a wider place, or drop the quick-group filter.`}</div>
    </div>`;
  }
  const tally = standing
    ? `<p class="blurb">Click the tiers below to hide them.</p>${legendHtml()}`
    : `<p class="blurb">Add a username to tick off the ones you have already recorded.</p>`;
  // The count sits on the list rather than up in the header, because it is a count of what is
  // actually listed and has to move as the threshold and the cascade take rows out — see
  // retally, which rewrites it. With a username every row carries a standing to read, so it
  // reads as a pair: how many of the species showing are already recorded.
  const held = standing ? rows.filter(x => standing(x)).length : 0;
  // The username reads here now too, beside the count it explains, rather than alone atop
  // the page — standing is only ever set once view.user is (see runPlace), so the two always
  // travel together. A `|` ahead of each marks it as its own item on the line rather than a
  // continuation of the one before, so it still reads as three things even in one colour.
  const sep = `<span class="sep">|</span>`;
  const badge = standing
    ? `${sep}<span class="who">@${esc(view.user)}</span>${sep}<span class="n have" title="Already recorded, of the species showing">${held} / ${rows.length} observed</span>`
    : `${sep}<span class="n">${rows.length}</span>`;
  return `<section class="tier" id="here">
    <h2><a href="${esc(areaSpeciesUrl())}" target="_blank" rel="noopener"
          title="The same area on iNaturalist">${esc(areaLabel())}</a>${badge}</h2>
    ${tally}
    ${sortbarHtml(sortBy)}
    <label class="onlySub" title="${esc(SSP_HINT)}">
      <input type="checkbox"${view.ssp ? " checked" : ""}>Show only subspecies?</label>
    <ul>${sortRows(rows, sortBy, standing).map((x, n) =>
      rowHtml(x, n, view.user, standing ? standing(x) : "")).join("")}</ul>
  </section>`;
}

function listHtml(buckets, user, sortBy){
  if(!buckets.some(rows => rows.length)){
    return `<div class="state">
      <div class="state-lede">Nothing to show.</div>
      <div class="state-hint">${view.ssp ? sspWayOut("Nothing this user has recorded in this scope is identified below species rank.")
        : "This user has no species recorded in this scope."}</div>
    </div>`;
  }
  const sortbar = sortbarHtml(sortBy, true);
  // The rail carries the same badges as the headings it jumps to, so the two read as one
  // set rather than as a list of names beside a list of icons.
  const index = `<nav class="index">` + TIERS.map(([title, , tag], i) =>
    `<a href="#tier-${i}"><span class="ix-name">${tierBadge(tag)}${esc(title)}</span>
       <span class="n">${buckets[i].length}</span></a>`
  ).join("") + `</nav>`;
  const sections = TIERS.map(([title, blurb, tag], i) => {
    const rows = sortRows(buckets[i], sortBy);
    // Every tier but Untagged heads out to the matching search on iNat, which has no
    // "carries no tag at all" query to point at.
    const head = tag
      ? `<a href="${esc(tierUrl(tag, user))}" target="_blank" rel="noopener"
            title="Every ${esc(title)} observation on iNaturalist">${esc(title)}</a>`
      : esc(title);
    return `<section class="tier" id="tier-${i}">
      <h2>${tierBadge(tag)}${head}<span class="n">${rows.length}</span></h2>
      <p class="blurb">${esc(blurb)}</p>
      ${rows.length ? "<ul>" + rows.map((x, n) => rowHtml(x, n, user)).join("") + "</ul>"
                    : `<p class="clear">All clear.</p>`}
    </section>`;
  }).join("");
  return `<div class="cols">${index}<div class="tiers">${sortbar}${sections}</div></div>`;
}

// Re-sorts by shuffling the rendered rows, so flipping order costs no refetch and needs
// no second copy of the row markup. The one sortbar drives every tier, each sorted and
// renumbered within itself.
function comparator(by, rev){
  // Reversed, the count leads with the fewest — but the name still runs A–Z where two rows are
  // level, so the list is not a plain mirror of itself. Same rule as the tier order below.
  if(by === "count") return rev
    ? (p, r) => (+p.dataset.count) - (+r.dataset.count) || p.dataset.name.localeCompare(r.dataset.name)
    : (p, r) => (+r.dataset.count) - (+p.dataset.count) || p.dataset.name.localeCompare(r.dataset.name);
  // Count again, but banded: the standing each row already carries in `data-standing` decides
  // the band, the count orders within it. Nothing extra had to be written onto the row for
  // this — the badge the place tab draws is the same fact the order reads. Reversed, the bands
  // turn over and nothing else: the count is the tie-breaker either way, so the heaviest still
  // leads inside a band rather than the list becoming a plain mirror of itself.
  if(by === "tier") return (p, r) =>
    (rev ? tierRank(r.dataset.standing) - tierRank(p.dataset.standing)
         : tierRank(p.dataset.standing) - tierRank(r.dataset.standing)) ||
    (+r.dataset.count) - (+p.dataset.count) || p.dataset.name.localeCompare(r.dataset.name);
  if(by === "taxo") return (p, r) =>
    p.dataset.taxo.localeCompare(r.dataset.taxo) || p.dataset.name.localeCompare(r.dataset.name);
  return rev ? (p, r) => r.dataset.name.localeCompare(p.dataset.name)
             : (p, r) => p.dataset.name.localeCompare(r.dataset.name);
}

// Family bands, drawn only for the taxonomic order — under the other two the rows would
// jump between families and a heading every second row says nothing. Hidden rows are
// skipped, so a threshold that empties a family takes its band with it.
function drawFamilies(ul, on){
  [...ul.querySelectorAll("li.fam")].forEach(li => li.remove());
  if(!on || !familyOf.size) return;
  let last = null;
  [...ul.children].forEach(li => {
    if(li.hidden) return;
    const fam = familyOf.get(+li.dataset.taxon);
    const key = fam ? fam.name : "";
    if(key === last) return;
    last = key;
    const head = document.createElement("li");
    head.className = "fam";
    // The name opens this family within the current region — same place/pin scope as every
    // row's own link. "View my" is unscoped by area on purpose: it is the one place on this
    // page that answers "everywhere I've ever seen this family", not just here.
    head.innerHTML = fam
      ? `<a class="famName" href="${esc(taxonAreaUrl(fam.id))}" target="_blank" rel="noopener"
            title="This family's species here, on iNaturalist">
          <b>${esc(fam.name)}</b>${fam.common ? ` <span class="famCommon">${esc(fam.common)}</span>` : ""}
        </a>${view.user
          ? `<a class="viewMy" href="${esc(taxonObsUrl(fam.id, view.user))}" target="_blank" rel="noopener"
                title="${esc(view.user)}'s own records of this family, everywhere">View my</a>`
          : ""}`
      : `<b>Family not recorded</b>`;
    ul.insertBefore(head, li);
  });
}

// Every count on the page follows what is actually listed, so a threshold doesn't leave a
// heading claiming 925 above a list of 40.
function retally(ul, shown, held){
  const sec = ul.closest("section");
  if(!sec) return;
  const n = sec.querySelector("h2 .n");
  // A pair where the rows carry standings to count — the place tab with a username — and a
  // single number everywhere else. Both halves follow the visible rows: the threshold only
  // ever trims a species the reader has nothing on, so it moves the total alone, while the
  // rank cascade hides recorded ones and moves both.
  if(n) n.textContent = n.classList.contains("have") ? `${held} / ${shown} observed` : shown;
  const rail = document.querySelector(`.index a[href="#${sec.id}"] .n`);
  if(rail) rail.textContent = shown;
}

// A row's own standing, ranked against the cutoff — only meaningful on the place tab, where
// each row carries its badge in `data-standing`. Empty (never recorded, no badge) never
// matches: the cascade only ever touches species that have a standing to rank, so the ones
// you have never recorded survive every cutoff — which is the point of the place tab.
function rankHidden(li){
  const standing = li.dataset.standing;
  return !!standing && view.hide != null && standingRank(standing) >= view.hide;
}

// The threshold, and the exact mirror of the cutoff above: it only ever trims a species the
// reader has nothing on. A badge means they have already recorded it, and a species you hold
// is worth seeing however thin the area's count is — the long tail the threshold is for is
// the tail of species still to find. Between them the two controls split the list cleanly,
// one trimming what you have, the other what you don't, and neither can take a row the other
// is responsible for.
// On the tier tab no row carries a badge, so there this still weighs every row — its count
// is the reader's own tally of a species that is theirs by definition, which is a different
// question from an area's total and the one the threshold answers on that tab.
function underMin(li){
  return !li.dataset.standing && (+li.dataset.count) < view.min;
}

// One pass over the rendered rows: order, threshold, rank cutoff, renumber, band. Every
// control that touches visibility goes through here, so none of them can disagree about
// the list. The subspecies checkbox is deliberately not among them — it changes which rows
// exist, not which of them show, so it refetches instead.
function relist(){
  const cmp = comparator(view.sort, view.rev);
  document.querySelectorAll("#main ul").forEach(ul => {
    [...ul.querySelectorAll("li.fam")].forEach(li => li.remove());
    let shown = 0, held = 0;
    [...ul.children].sort(cmp).forEach(li => {
      ul.appendChild(li);                          // moves, does not clone
      li.hidden = underMin(li) || rankHidden(li);
      if(li.hidden) return;
      li.firstElementChild.textContent = ++shown;                  // .num
      if(li.dataset.standing) held++;
    });
    retally(ul, shown, held);
    drawFamilies(ul, view.sort === "taxo");
  });
}

// The tier tab's half of the cascade: whole `<section>`s disappear rather than individual
// rows, since a tier there IS a standing — hiding "C and above" means hiding those three
// sections outright.
//
// Only the tier tab's `tier-N` sections are eligible. The place tab's one section is
// `id="here"`, and it must never be hidden as a block: its rows carry their own standings
// and `relist` filters them individually, leaving the never-recorded species behind. (This
// is where the bug lived — `+"here".slice(5)` is `+""`, which is 0, not NaN, so that section
// was read as TIERS[0] and the whole list vanished on the two lowest cutoffs.) Matching the
// id explicitly means a section has to name a tier to be touched at all.
//
// The badge that triggered a hide can vanish with its section; the rail's copy of the same
// badge does not, which is what makes it the one control that can always undo this.
function applyHideFrom(){
  document.querySelectorAll(".tier").forEach(sec => {
    const m = /^tier-(\d+)$/.exec(sec.id);
    const tier = m && TIERS[+m[1]];
    sec.hidden = !!tier && view.hide != null && standingRank(tier[2]) >= view.hide;
  });
  document.querySelectorAll(".tick[data-rank]").forEach(t => {
    const cut = view.hide != null && +t.dataset.rank >= view.hide;
    t.setAttribute("aria-pressed", cut);
    const rail = t.closest(".index a");
    if(rail) rail.classList.toggle("hidden-from", cut);
  });
}

function toggleHideFrom(i){
  view.hide = view.hide === i ? null : i;
  writeState({ hide: view.hide == null ? "" : String(view.hide) });
  applyHideFrom();     // sections, on the tier tab
  relist();             // rows, on the place tab (also re-applies sort/threshold, which is a no-op if neither changed)
}

// One delegated listener catches every badge on the page — section headings, the rail, the
// place tab's own rows, and its legend — rather than binding each kind separately.
function wireHideToggle(){
  document.addEventListener("click", e => {
    const t = e.target.closest(".tick[data-rank]");
    if(!t) return;
    e.preventDefault();
    e.stopPropagation();   // the rail badge sits inside its <a> — this keeps that from also firing
    toggleHideFrom(+t.dataset.rank);
  });
  document.addEventListener("keydown", e => {
    if(e.key !== "Enter" && e.key !== " ") return;
    const t = e.target.closest && e.target.closest(".tick[data-rank]");
    if(!t) return;
    e.preventDefault();
    toggleHideFrom(+t.dataset.rank);
  });
}

function wireSort(){
  // Rebound every paint, same as the sort buttons below — the button is destroyed and
  // recreated with the rest of the sortbar, so a listener from a previous paint is gone
  // along with it. Only the tier tab's sortbar renders it at all.
  const refresh = document.querySelector(".sortbar #refresh");
  if(refresh) refresh.addEventListener("click", runTier);

  // `[data-by]` matters: the threshold's clear button lives in the same bar, and must not
  // be mistaken for a sort choice.
  const btns = [...document.querySelectorAll(".sortbar button[data-by]")];
  const nums = [...document.querySelectorAll(".sortbar .minObs")];
  if(!btns.length) return;

  btns.forEach(b => b.addEventListener("click", async () => {
    // A second click on the order already running turns it over rather than re-applying it;
    // moving to a different order starts it the way its own label reads, so direction belongs
    // to the order chosen and never follows the reader from one button to the next. Taxonomic
    // is the one that cannot flip, so there alone a repeat click still does nothing.
    const by = b.dataset.by;
    view.rev = view.sort === by && REVERSIBLE.includes(by) ? !view.rev : false;
    view.sort = by;
    btns.forEach(x => {
      const chosen = x === b;
      x.className = chosen ? (view.rev ? "on rev" : "on") : "";
      // The arrow turns with that class; the title is the one thing on a button that can't.
      if(SORT_TITLE[x.dataset.by]) x.title = SORT_TITLE[x.dataset.by][chosen && view.rev ? 1 : 0];
    });
    writeState({ sort: view.sort === "count" ? "" : view.sort, rev: view.rev ? "1" : "" });
    relist();
    scrollTo(0, 0);
    // Headings may still be in flight on the first taxonomic click; redraw when they land.
    if(view.sort === "taxo" && familiesReady){
      await familiesReady;
      if(view.sort === "taxo") document.querySelectorAll("#main ul").forEach(ul => drawFamilies(ul, true));
    }
  }));

  const clears = [...document.querySelectorAll(".sortbar .minClear")];
  const applyMin = n => {
    view.min = Math.max(0, Math.floor(n || 0));
    nums.forEach(i => { if(+i.value !== view.min) i.value = view.min || ""; });
    clears.forEach(c => { c.hidden = !view.min; });
    // Written even when zero: an empty field is a deliberate "show everything", and
    // dropping the key would hand the reader the default 20 back on reload.
    writeState({ min: String(view.min) });
    relist();
  };

  // Typed, not submitted — the list narrows as the number is entered.
  let timer = null;
  nums.forEach(input => input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => applyMin(+input.value), 250);
  }));

  clears.forEach(c => c.addEventListener("click", () => {
    clearTimeout(timer);      // a pending keystroke must not put the threshold back
    applyMin(0);
  }));
}

// The one control on the page that asks iNaturalist something new, so the one that runs the
// tab's query again — the rows it wants are not on the page to be sorted or hidden into view.
// Re-run rather than reload: the address is rewritten first, so a reload from here would land
// on exactly this list anyway, only having thrown away the header and the scroll to get there.
// Whichever tab is on screen is the tab that painted the checkbox.
//
// Found by its own class rather than through the sortbar it used to sit in, so moving it
// around the list costs nothing here.
function wireOnlySub(){
  const boxes = [...document.querySelectorAll(".onlySub input")];
  boxes.forEach(box => box.addEventListener("change", () => {
    view.ssp = box.checked;
    boxes.forEach(other => { other.checked = view.ssp; });
    // Off is the default, so it leaves no key behind — same as sort's "count".
    writeState({ ssp: view.ssp ? "only" : "" });
    if(view.tab === "place") runPlace(); else runTier();
  }));
}

// List or grid. Both are the same rows in the same order — the switch is one class on #main
// and nothing else — so this touches neither the sort, the threshold, the family bands nor
// the hide-cascade, and never refetches. Scroll position is left alone: the page changes
// height enough that jumping to the top would be its own surprise.
function wireLayout(){
  const btns = [...document.querySelectorAll(".sortbar button[data-layout]")];
  btns.forEach(b => b.addEventListener("click", () => {
    view.layout = b.dataset.layout;
    btns.forEach(x => x.classList.toggle("on", x === b));
    // List is the default, so it leaves no key behind — same as sort's "count".
    writeState({ layout: view.layout === "list" ? "" : view.layout });
    main.classList.toggle("grid", view.layout === "grid");
  }));
}

// Index rail: real fragment links now that the page has an address, so a tier can be
// linked to directly. The highlight follows whichever heading last passed the top.
function wireIndex(){
  const links = [...document.querySelectorAll(".index a")];
  if(!links.length) return;
  const tiers = links.map(a => document.getElementById(a.getAttribute("href").slice(1)));
  const mark = () => {
    let at = 0;
    tiers.forEach((sec, i) => { if(sec && sec.getBoundingClientRect().top <= 90) at = i; });
    links.forEach((a, i) => { a.className = i === at ? "on" : ""; });
  };
  addEventListener("scroll", mark, { passive:true });
  mark();
  // A fragment in the address at load time only resolves once the rows exist.
  if(location.hash){
    const target = document.getElementById(location.hash.slice(1));
    if(target) target.scrollIntoView();
  }
}

function paint(html, sub, busy){
  main.innerHTML = html;
  // The rows are the same in either shape, so grid is one class re-asserted with each paint
  // rather than anything baked into the markup.
  main.classList.toggle("grid", view.layout === "grid");
  countEl.innerHTML = sub;
  // Nothing to say up here on the place tab once its list is on screen — who and count both
  // moved onto it. The line still carries the tier tab's own who, and the place tab's own
  // loading and empty states, so it hides only once both halves are empty, not by tab.
  document.querySelector(".sub").hidden = !document.getElementById("who").textContent && !sub;
  // Only present once the tier tab's sortbar is on screen — absent while loading or after
  // a failed fetch, when there is no sortbar at all to carry it.
  const refreshBtn = document.getElementById("refresh");
  if(refreshBtn){
    refreshBtn.disabled = !!busy;
    refreshBtn.innerHTML = busy ? "Reading&hellip;" : "Refresh";
  }
}

function failed(hint){
  paint(`<div class="state">
    <div class="state-lede">The list didn't come back.</div>
    <div class="state-hint">${hint}</div>
  </div>`, "failed");
}

// Family names and eBird codes both cost their own requests, so they are fetched behind the
// finished list rather than in front of it. The headings and the links appear when they land,
// and a failure on either side costs only itself — the list is already on screen.
function afterPaint(buckets){
  wireSort();
  wireLayout();
  wireOnlySub();
  applyHideFrom();              // tier tab's sections; a no-op if nothing is cut and place-tab-safe
  if(view.min || view.hide != null) relist();   // a threshold or cutoff in the address applies to first paint
  familiesReady = loadFamilies(buckets).catch(() => {});
  familiesReady.then(() => {
    if(view.sort === "taxo") document.querySelectorAll("#main ul").forEach(ul => drawFamilies(ul, true));
  });
  loadEbirdLinks(buckets).catch(() => {});   // no code, no link — never a broken one
}

async function runTier(){
  paint(`<div class="state">
    <div class="state-lede">Compiling the list&hellip;</div>
    <div class="state-hint">Reading every species @${esc(view.user)} has recorded, then sorting them by the tags they carry.${
      view.ssp ? " Splitting each into its subspecies takes a few more passes." : ""}</div>
  </div>`, "", true);
  try{
    const buckets = await speciesByTier(view.user);
    const total = buckets.reduce((n, rows) => n + rows.length, 0);
    paint(listHtml(buckets, view.user, view.sort), `${total} ${rowNoun()}`);
    afterPaint(buckets);
    wireIndex();
  }catch(e){
    failed("iNaturalist may be rate-limiting, or that username may not exist.");
  }
}

async function runPlace(){
  paint(`<div class="state">
    <div class="state-lede">Reading the area&hellip;</div>
    <div class="state-hint">Every species recorded in ${esc(areaLabel())}${
      view.user ? `, then checking them against @${esc(view.user)}'s own species` : ""}.${
      view.ssp ? " Splitting each into its subspecies takes a few more passes." : ""}</div>
  </div>`, "", true);
  try{
    // Whole species can be asked about all at once, none of the three depending on another:
    // `unseen` answers which of the area's species this user is missing, `bestOf` what they
    // hold on the ones they do have. Subspecies cannot — the questions are asked by id, so
    // the list has to exist first — and they replace both, so neither is fetched then.
    const split = view.ssp && !!view.user;
    const [rows, unseen, bestOf] = await Promise.all([
      speciesHere(),
      view.user && !split ? unseenHere(view.user) : Promise.resolve(null),
      view.user && !split ? standingLookup(view.user) : Promise.resolve(null)
    ]);
    // One lookup for the renderer, taking a row rather than an id so that each list can
    // answer at its own rank: "" for something they have never recorded, otherwise their
    // standing on it. Missing beats standing — a taxon absent from their list has no tags to
    // rank, whatever a stale tag search might say.
    let standing = null;
    if(split){
      const bySsp = await sspStanding(rows, view.user, false);
      standing = x => bySsp(x.taxon.id);
    }else if(unseen){
      standing = x => unseen.has(x.taxon.id) ? "" : (bestOf ? bestOf(x.taxon.id) : "seen");
    }
    // No tally in the header: this tab is one list, and its count belongs on it, where it can
    // follow what the threshold and the cascade leave showing. The tier tab keeps its own —
    // five sections have no single heading to carry a total.
    paint(placeListHtml(rows, standing, view.sort), "");
    afterPaint([rows]);
  }catch(e){
    failed("iNaturalist may be rate-limiting, or that place may be too large to tally.");
  }
}

/* ---------------- finders ----------------

   Two search fields, one mechanism: type, wait, ask iNaturalist, pick a hit. All that differs
   between them is the index searched, how a hit is drawn and what picking one means for the
   address — so they share the debounce, the stale-response guard and the click-away close
   rather than keeping two copies of them.

   Picking is a navigation, not a state change: the choice lands in the query string, so the
   list it produces can be linked to like any other. */

function wireFinder({ input, hits, find, row, pick }){
  const box = input.closest(".finder");
  let timer = null, seq = 0;

  const close = () => { hits.hidden = true; hits.innerHTML = ""; };

  const show = list => {
    if(!list.length){ close(); return; }
    hits.innerHTML = list.map(row).join("");
    hits.hidden = false;
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if(text.length < 2){ close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try{
        const list = await find(text);
        if(mine === seq) show(list);
      }catch(e){ close(); }
    }, 300);
  });

  hits.addEventListener("click", e => {
    const b = e.target.closest("button[data-id]");
    if(b) pick(b);
  });

  // Against this finder's own box, not `.finder` at large: a click in the other field is
  // outside this one and has to close it, or both lists sit open over the page at once.
  document.addEventListener("click", e => { if(!box.contains(e.target)) close(); });
}

// What a finder is already filtering by, shown in the field itself: the value, and the clear
// beside it. Nothing but how the field reads — the filter is the address, as it was.
function markSet(input, label){
  input.value = label;
  input.closest(".finder").classList.add("set");
}

function wirePlaceFinder(){
  const input = document.getElementById("placeInput");
  // Whatever area is in force, however it arrived: a named place, or the map's pin and
  // radius — which is not something anyone would type, but is still what this list is of.
  if(hasArea) markSet(input, areaLabel());
  // Taking the area off leaves the tab asking which place, the same state a bare link opens
  // in — so the pin the map handed over can be put down here rather than only replaced.
  document.getElementById("placeClear").addEventListener("click", () => {
    location.href = selfUrl({ place_id: null, pname: null, lat: null, lng: null, radius: null });
  });

  wireFinder({
    input,
    hits:  document.getElementById("placeHits"),
    find:  findPlaces,
    row: p => `<button type="button" data-id="${p.id}" data-name="${esc(p.name)}">${esc(p.name)}${
      p.kind ? `<span>${esc(p.kind)}</span>` : ""}</button>`,
    // A named place replaces any pin the map handed over — one area at a time.
    pick: b => { location.href = selfUrl({
      tab: "place", place_id: b.dataset.id, pname: b.dataset.name,
      lat: null, lng: null, radius: null
    }); }
  });
}

// The taxon filter the map hands over, now settable here too — on both tabs, since the taxon
// scopes the tier tab's user query and the place tab's area query alike.
function wireTaxonFinder(){
  const input = document.getElementById("taxonInput");
  // Whatever the tree is narrowed to, at whichever grain: a named taxon, or the quick groups
  // standing in for one. scopeLabel() already chooses between them, so the field says exactly
  // what the scope line says.
  if(hasTaxa) markSet(input, scopeLabel());
  // The scope line names it as well, but only this can take it back off — and it takes the
  // whole filter, groups included, the two being one filter with two ways of setting it. A
  // group can still be dropped on its own from its own button.
  document.getElementById("taxonClear").addEventListener("click", () => {
    location.href = selfUrl({ taxon: null, tname: null, iconic: null });
  });

  wireFinder({
    input,
    hits:  document.getElementById("taxonHits"),
    find:  findTaxa,
    // Plenty of taxa have no English name, and those lead with the binomial rather than
    // printing it on both lines — the same trade the rows below make.
    row: t => `<button type="button" data-id="${t.id}" data-name="${esc(t.name)}">
      ${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy">`
                : `<span class="t-nophoto"></span>`}
      <span class="t-name"><span class="t-common">${esc(t.common || t.name)}</span>${
        t.common ? `<span class="t-sci">${esc(t.name)}</span>` : ""}</span>
      <span class="t-rank">${esc(t.rank)}</span>
    </button>`,
    // A taxon and a quick group are one filter with two ways of setting it: the query would
    // simply AND them and the scope line shows the taxon alone, so picking either drops the
    // other, the same trade the map's filter sheet makes.
    pick: b => { location.href = selfUrl({
      taxon: b.dataset.id, tname: b.dataset.name, iconic: null
    }); }
  });
}

/* ---------------- boot ---------------- */

const NOTES = {
  tier: `Every species this user has recorded, banded by the best tier tag it carries
     and listed weakest first. The tiers override downwards &mdash; S beats B beats C &mdash; so a
     species tagged S counts as tier S whatever else sits on it, and appears once. IDs left
     coarser than species are not counted. Each link opens their observations of that species,
     casual ones included.`,
  place: `Every species recorded inside this area, with the ones the named user has already
     recorded &mdash; anywhere, not just here &mdash; ticked off. Counts are iNaturalist's own
     observation totals for the area, so the default order is the same one their species view
     leads with. Casual records are not counted; dates are not filtered, so this answers what
     has been found in this place, ever.`
};

(function init(){
  // Delegated on the document, so it covers every badge this page ever paints without
  // needing to be re-bound after each render — wired once, here, rather than per paint.
  wireHideToggle();

  // The tabs are two addresses over one scope, so switching carries the scope across and
  // drops only what cannot apply.
  document.querySelectorAll("#tabs a").forEach(a => {
    const tab = a.dataset.tab;
    a.href = selfUrl({ tab: tab === "tier" ? null : tab });
    if(tab === view.tab) a.className = "on";
  });

  // Straight back to the map the reader came from. Bookmarked or shared links carry no
  // `back`, so those rebuild what this page does know — the username and the scope.
  let back = view.back;
  if(!back){
    const p = new URLSearchParams();
    if(view.user) p.set("unobs", view.user);
    if(view.taxon){
      p.set("taxon", view.taxon);
      if(view.tname) p.set("tname", view.tname);
    }
    if(view.iconic.length) p.set("iconic", view.iconic.join(","));
    back = p.toString();
  }
  document.getElementById("backLink").href = "index.html" + (back ? "#" + back : "");
  // The gallery is one person's photos, so it needs the same username this page is reading.
  // Without it the gallery falls back to its own default and quietly shows someone else's.
  document.getElementById("galleryLink").href =
    "gallery.html" + (view.user ? "?u=" + encodeURIComponent(view.user) : "");
  document.getElementById("note").innerHTML = NOTES[view.tab];
  // Named here only on the tier tab, where it is the whole subject of the page. The place
  // tab folds it into the list heading instead, beside the count it explains — see
  // placeListHtml — so this has nothing to add there, and paint() hides the line when empty.
  document.getElementById("who").textContent =
    view.tab === "tier" ? (view.user ? "@" + view.user : "no user") : "";

  // The taxon field and the quick groups sit together because they are the same filter at two
  // grains — one named taxon, or a handful of broad ones. Both stand on both tabs.
  wireTaxonFinder();

  // Quick groups stay put rather than only appearing when the scope is empty: they are the
  // filter, so changing group is one tap wherever the reader is. Toggling, not choosing — the
  // map allows several at once and so does this. The scope is the same key on either tab, so
  // a group survives switching between them.
  const picks = document.getElementById("groupPicks");
  picks.innerHTML = ICONIC.map(([v, l]) =>
    `<button type="button" data-iconic="${v}"${
      view.iconic.includes(v) ? ` class="on"` : ""}>${esc(l)}</button>`).join("");
  picks.addEventListener("click", e => {
    const b = e.target.closest("button[data-iconic]");
    if(!b) return;
    const v = b.dataset.iconic;
    const next = view.iconic.includes(v)
      ? view.iconic.filter(x => x !== v)
      : view.iconic.concat(v);
    // The other half of the trade the taxon field makes: turning a group on drops the taxon
    // rather than quietly narrowing to both. Turning the last one off leaves the taxon be —
    // there is nothing to fight over then, and it may be what the reader arrived with.
    const over = { iconic: next.join(",") };
    if(next.length){ over.taxon = null; over.tname = null; }
    location.href = selfUrl(over);
  });

  // A username input, used by whichever tab is missing one. On the tier tab it is the whole
  // question; on the place tab it only decides whether the ticks can be drawn.
  const askUser = (lede, hint, sub) => {
    paint(`<div class="state">
      <div class="state-lede">${lede}</div>
      <div class="state-hint">${hint}
        <br><input id="userInput" type="text" placeholder="iNaturalist username"
             value="${esc(view.user)}" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
    </div>`, sub);
    const input = document.getElementById("userInput");
    input.focus();
    input.addEventListener("keydown", e => {
      if(e.key !== "Enter" || !input.value.trim()) return;
      location.href = selfUrl({ u: input.value.trim() });
    });
  };

  if(view.tab === "place"){
    document.title = hasArea ? "Species — " + areaLabel() : "Species here";
    document.getElementById("placebar").hidden = false;
    wirePlaceFinder();

    // No username, no ticks — so offer the field rather than silently dropping the column.
    if(!view.user){
      document.getElementById("userBar").hidden = false;
      const uq = document.getElementById("userQuick");
      const uqGo = document.getElementById("userQuickGo");
      const accept = () => {
        if(!uq.value.trim()) return;
        location.href = selfUrl({ u: uq.value.trim() });
      };
      // The arrow only shows once there is something to accept, the same rule the finders'
      // own clear follows — an empty field has nothing for it to confirm.
      uq.addEventListener("input", () => {
        uq.closest(".finder").classList.toggle("filled", !!uq.value.trim());
      });
      uq.addEventListener("keydown", e => { if(e.key === "Enter") accept(); });
      uqGo.addEventListener("click", accept);
    }

    if(!hasArea){
      paint(`<div class="state">
        <div class="state-lede">Which place?</div>
        <div class="state-hint">Search a place above &mdash; a country, a city, a park &mdash;
          or tap the map and open a pin's species list from there.</div>
      </div>`, "nothing to read yet");
      document.getElementById("placeInput").focus();
      return;
    }

    // An area with no taxon or quick-group behind it is not a list anyone can read: a
    // country holds tens of thousands of species, past the point where paging them is
    // either quick or complete. Ask for a group rather than starting a request that will
    // hang and then truncate.
    if(!hasTaxa){
      paint(`<div class="state">
        <div class="state-lede">Which group?</div>
        <div class="state-hint">${esc(areaLabel())} holds far too many species to list at once.
          Search a taxon above, or pick a group.</div>
      </div>`, "pick a group");
      return;
    }
    runPlace();
    return;
  }

  document.title = view.user ? "Tier tags — @" + view.user : "Species by tier tag";

  if(!view.user){
    askUser("Which user?",
      "This tab reports one iNaturalist account's species by tier tag.",
      "nothing to read yet");
    return;
  }

  runTier();
})();
