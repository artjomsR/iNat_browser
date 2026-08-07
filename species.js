/* ---------------- page address ----------------

   The report is its own page, so its whole input lives in the query string and it can be
   bookmarked, shared, and reloaded on its own:

     species.html?tab=tier&u=USER&taxon=ID&tname=NAME&iconic=Aves,Insecta&sort=name#tier-3
     species.html?place_id=7122&pname=Portugal&u=USER&sort=taxo&layout=grid
     species.html?lat=38.72&lng=-9.14&radius=12&u=USER

   Two tabs over the same rows. `tier` is about one person: their species banded by the tier
   tag they carry. `place` is about one patch of ground: every species recorded there, with
   the ones that person has already recorded ticked off. Both are addresses, so either can
   be bookmarked and the tab strip is just two links. `place` is the default tab, so it is
   the one tab that never needs `tab=` written out; `tier` always does.

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

   `m=6,7,8` is months of the year, 1–12, and the map's key again for the same reason. It cuts
   the calendar rather than the years: "what has been recorded here in summer, ever" is a
   question the tab's own premise allows, where a date range would not. Only the place tab
   reads it — the tier tab is about the tags on a person's photographs, and those do not
   belong to a season — but it rides along there unread, like a pin, so that crossing to the
   place tab keeps the season the map was set to. Empty means every month and writes nothing;
   junk is dropped on the way in and the order is normalised, so one selection is one address.
   Like the subspecies split it is a different question rather than a different reading of the
   same rows, so it refetches.

   `seen=here` reads the reader's own ticks and tier badges against the area instead of against
   the world. Without it a green tick means "I have this species, somewhere on earth" and a badge
   means the best tag on a photograph taken anywhere — both true, and on a list of one park often
   not the question being asked. It takes the ground and pointedly not the season: with months
   also set, `here` still means "recorded here, ever", so the two controls stay one question
   each. Only the place tab reads it, and only with an area to be in and a username to be it
   about; anywhere else it rides along unread, like the season and the pin, so crossing to the
   tier tab and back keeps it — the tier tab's list is a person's whole holding and stays that
   way. Anywhere is the default and writes nothing. Like the season it is a different question
   rather than a different reading of the same rows, so it refetches.

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

const LEVELS = ["s","b","c"];

/* The API's address, the request gate every call to it goes through, `esc`, `ICONIC`,
   `MONTH_NAMES` and the species_counts paging loop are in common.js, which the page loads
   ahead of this one. They are globals by the time anything here runs. */

/* ---------------- keeping the answers ----------------

   The gate in common.js decides when a request leaves. This decides whether it has to leave at
   all.

   The same questions get asked over and over on this page. A reload, the back button off a
   species' page on iNaturalist, the subspecies checkbox, a month added to the row: every one of
   them puts the whole fan-out up again from cold, and at 350ms a departure a place-tab load
   with a username is a dozen or more requests before a single row is painted. Nothing about
   those answers changed in the twenty seconds since they were last given.

   So an answer is kept for five minutes, in sessionStorage, under the question that earned it.

   Why sessionStorage, where the eBird codes are in localStorage: an eBird code is minted once
   and never changes, so it is worth keeping forever. Everything here is a count, or a set
   derived from counts, and counts move all day — a life list grows, a tag is added, a species
   is recorded in the area for the first time. Kept across sessions these would quietly turn the
   report into a photograph of some earlier day. A tab's life, and five minutes inside it, is
   the most that can be claimed honestly: long enough for a reload, a back, and a reader working
   the toolbar, short enough that a list left open over lunch is asked again. It also means
   there is no purge to write — sessionStorage goes when the tab does, and five minutes is
   checked on the way out of the store rather than swept up on a timer.

   What is kept is the ANSWER, not the payload, and that is the whole shape of this. A
   species_counts page is 500 rows of full taxon objects — measured at about 1.3KB a row, so
   650KB for one page, against roughly 5MB for the entire origin — and a place-tab load fans out
   to eight of those chains at once. Kept raw, one country-sized list would spend the budget on
   its own and then evict itself on the next load. But most of those chains are never read as
   rows: the three tag searches, the audio pair and the unobserved list are each reduced, the
   moment they land, to a set of taxon ids. Stored as ids, a chain that cost 650KB on the wire
   costs a few kilobytes here. So this sits at the callers, on what they made of the answer,
   rather than at apiGet on what came back — a few more lines than one hook in the gate, and
   worth them twice over: a hit hands back the same thing the caller would have built, and the
   autocompletes, which must never be cached, are left out by construction rather than by an
   exception list somebody has to remember to maintain.

   The two exceptions are the lists themselves — the area's species, and the user's own — which
   ARE rows, and are also the slowest single thing on their tab. Those are kept whole, under a
   size cap: an ordinary scope fits and comes back instantly, and a scope big enough to eat the
   budget is simply not kept. Nothing is ever correct only because it fit; the cap costs speed
   and never an answer.

   Two questions must never share a key, so a key is the derivation's name plus every parameter
   that shapes it, sorted. Paging is left out, the answer being the whole chain rather than a
   page of it. The version sits in the prefix: if what is stored ever changes shape, bump it and
   every old entry stops being found instead of being read as something it isn't.

   Anything uncertain is a miss — unparseable JSON, a half-written entry, one past its five
   minutes. And a refusal is never an answer: the write only happens where the ask resolved, so
   a 429 or a 500 leaves nothing behind to be served later as fact. Wrapped throughout, like the
   gallery's record of seen photos and the eBird codes: with no storage at all this page works
   exactly as it did, it just asks again. */

const CACHE = "inat.query.v1.";
const CACHE_TTL = 5 * 60 * 1000;
// Roughly a fifth of the origin's ~5MB, counted in characters as the browser counts it — about
// 760 species rows. Enough for both list entries at an ordinary scope with room to spare.
const CACHE_MAX = 1e6;

function cacheRead(key){
  try{
    const raw = sessionStorage.getItem(CACHE + key);
    if(!raw) return null;
    const entry = JSON.parse(raw);
    // Half an entry is a miss, not half an answer.
    if(!entry || typeof entry.at !== "number" || !("v" in entry)) return null;
    if(Date.now() - entry.at > CACHE_TTL){ sessionStorage.removeItem(CACHE + key); return null; }
    return entry;
  }catch(e){ return null; }      // private mode, or somebody else's JSON: ask again
}

function cacheDrop(){
  try{
    // Object.keys hands back a snapshot, so removing as we go is safe.
    Object.keys(sessionStorage).forEach(k => { if(k.startsWith(CACHE)) sessionStorage.removeItem(k); });
  }catch(e){ /* nothing to drop, or nowhere to drop it from */ }
}

function cacheWrite(key, value){
  let body;
  try{ body = JSON.stringify({ at: Date.now(), v: value }); }
  catch(e){ return; }
  if(body.length > CACHE_MAX) return;
  try{ sessionStorage.setItem(CACHE + key, body); }
  catch(e){
    // Full. Ours is the only thing in here that may be dropped, and dropping all of it beats
    // picking a victim — every entry is worth a few hundred milliseconds, not a record.
    cacheDrop();
    try{ sessionStorage.setItem(CACHE + key, body); }catch(e2){ /* still no room: ask again */ }
  }
}

// A question's name in the store: what was derived, then every parameter that shaped it, in a
// fixed order so the same question spells the same way whichever order it was built in.
function askKey(kind, params){
  const p = new URLSearchParams(params);
  p.sort();
  return kind + "." + p.toString();
}

// Ask, and keep what comes back. Stored as JSON and handed back re-parsed, so a hit and a miss
// return equal objects and never a shared one — nothing downstream can hold on to a row and
// find someone else's edit in it.
async function cachedAsk(kind, params, ask){
  const key = askKey(kind, params);
  const hit = cacheRead(key);
  if(hit) return hit.v;
  const answer = await ask();
  cacheWrite(key, answer);
  return answer;
}

// The same, for the questions whose answer is a set of taxon ids — which is most of them. The
// Set travels as a plain array and is rebuilt on the way out.
async function cachedIds(kind, params, ask){
  const key = askKey(kind, params);
  const hit = cacheRead(key);
  if(hit && Array.isArray(hit.v)) return new Set(hit.v);
  const ids = await ask();
  cacheWrite(key, [...ids]);
  return ids;
}

const q = new URLSearchParams(location.search);
const tab = q.get("tab") === "tier" ? "tier" : "place";

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

// Months of the year, 1–12 — the map's own reader, and validated here the same way: anything
// that is not a month is dropped rather than sent, and what is left is sorted and
// de-duplicated so "8,3,3" and "3,8" are one address.
function readMonths(raw){
  const seen = new Set();
  String(raw == null ? "" : raw).split(",").forEach(v => {
    if(!/^\d{1,2}$/.test(v)) return;
    const n = +v;
    if(n >= 1 && n <= 12) seen.add(n);
  });
  return [...seen].sort((a, b) => a - b);
}

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
  // The season, empty for every month. Read on both tabs so it survives the crossing, applied
  // only by the place tab's own scope — see areaScope.
  months: readMonths(q.get("m")),
  // Where the reader's own ticks and tier badges are read: "here" against the area, empty
  // against the world. Carried on both tabs for the same reason the season is, and honoured
  // only where it could mean something — see readingHere.
  seen:   q.get("seen") === "here" ? "here" : "",
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
// A function as well as the const, and read as one by areaWhere: the boot decisions below want
// the answer the address arrived with, but the scopes want a reading of `view` as it stands, so
// that a control changing it in place is not answered by what was true at load.
function pinSet(){ return !!(view.lat && view.lng && view.radius); }
const hasPin = pinSet();
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

// One user's own records of one species, on iNat — where a tier-tab row points, and where the
// place tab's "View my" goes. That second use is what decides its shape: the link is there to
// let a reader check the badge beside it, so it asks the badge's own question. The ground comes
// along under `here` and stays off otherwise, and the season comes along under neither, the
// badge not being read by season either way.
function taxonObsUrl(taxonId, user){
  const p = new URLSearchParams({ taxon_id: taxonId, user_id: user, verifiable: "any" });
  Object.entries(hereOnly()).forEach(([k, v]) => p.set(k, v));
  return "https://www.inaturalist.org/observations?" + p.toString();
}

// One species inside the area, on iNat — where a place-tab row points. The season goes with
// it, as it does on every link out of this tab: the row is showing a month's count, and a
// link that opened the year's would make a liar of the number beside it.
function taxonAreaUrl(taxonId){
  const p = new URLSearchParams({ taxon_id: taxonId, verifiable: "any" });
  if(view.place) p.set("place_id", view.place);
  else if(hasPin){ p.set("lat", view.lat); p.set("lng", view.lng); p.set("radius", view.radius); }
  if(view.months.length) p.set("month", view.months.join(","));
  return "https://www.inaturalist.org/observations?" + p.toString();
}

// The whole area on iNat's own species view — the page this tab is modelled on.
function areaSpeciesUrl(){
  const p = new URLSearchParams({ view: "species", verifiable: "any" });
  if(view.place) p.set("place_id", view.place);
  else if(hasPin){ p.set("lat", view.lat); p.set("lng", view.lng); p.set("radius", view.radius); }
  if(view.taxon) p.set("taxon_id", view.taxon);
  if(view.iconic.length) p.set("iconic_taxa", view.iconic.join(","));
  if(view.months.length) p.set("month", view.months.join(","));
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

/* ---------------- where the badges are read ----------------

   Empty is the world, which is what this page has always answered: a green tick means "I have
   this species, somewhere", and a tier badge the best tag on a photograph of it taken anywhere.
   `here` reads both against the area the list is of instead — the question a reader looking at
   one park is usually asking.

   It takes the ground and only the ground; the season stays out, for the reasons under
   userScope. So the two asking controls answer one question each: this one says where a record
   has to have been made to count, and the month row says nothing about the reader at all.

   Honoured only where it could mean something — the place tab, with an area to be in and a
   username to be it about — and read off `view` rather than off a const settled at load,
   because unlike the area and the username this one moves without a navigation. Nothing is
   folded back into `view` the way the tier order is: an address carrying `seen=here` across to
   the tier tab keeps it, unread, exactly as the season and the pin do.

   The known cost of asking honestly: a record iNaturalist holds no usable location for cannot
   match a place, and the tag searches reach into casual records, which is where most of those
   sit. So a tag on an unlocated observation drops out under `here`. That is the true answer to
   "tagged here" rather than a gap to be papered over — see HERE_HINT, which says so. */

// Whether the switch could mean anything at all: somewhere to be, someone to be it about, and
// the tab whose question it is. One condition in one place, because the control's own gate reads
// this too — what is drawn and what is asked must never be able to come apart.
function canReadHere(){
  return view.tab === "place" && !!view.user && !!Object.keys(areaWhere()).length;
}

function readingHere(){ return view.seen === "here" && canReadHere(); }

// Params, like sspOnly, so it spreads into a scope rather than being asked about at every site.
function hereOnly(){ return readingHere() ? areaWhere() : {}; }

// Scope a species_counts query to one user plus the taxon / quick-group filters the map was
// holding when the link was made — and, where the reader asked for it, the ground the list is
// standing on (see hereOnly).
//
// Pointedly not scoped by month, wherever it is asked, and load-bearing now rather than merely
// true: the ground goes in and the season still does not. Everything built on this is a question
// about a person rather than about a time — which species they hold, which tier tag is on each,
// which they have only ever heard — and a place narrows the first of those honestly where a
// season cannot. Narrowed to August, a bird tagged S in July would come back untagged and a bird
// photographed in June would lose its tick: the badge would stop meaning "what I have on this
// species" and start meaning "what I happened to record in August", which is not what any of it
// claims. Narrowed to a park, a bird tagged S in that park is precisely what the badge is then
// claiming to say. The place tab's own list is where the season applies; see areaScope.
function userScope(user){
  const o = { user_id: user, ...hereOnly() };
  if(view.taxon) o.taxon_id = view.taxon;
  if(view.iconic.length) o.iconic_taxa = view.iconic.join(",");
  return o;
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
//
// The params are built once and used twice — as the question asked and as the key it is kept
// under — so the two cannot drift apart. Every cached ask on this page is written that way.
async function speciesIdsWithTag(user, tag){
  const params = { ...userScope(user), search_on:"tags", q:tag, verifiable:"any" };
  return cachedIds("tagged", params, async () =>
    new Set((await speciesCounts(params)).map(x => x.taxon.id)));
}

/* ---------------- place scope ----------------

   The place tab reads a patch of ground, either an iNat place or the map's own pin and
   radius. Deliberately unfiltered by date or quality grade: the question is what has been
   recorded here, ever, and a date range would quietly answer a much smaller one. Taxon and
   quick-group scope still apply — those are the reader's.

   The month row is the one exception, and it does not overturn any of that. A date range
   shortens the years; a month slices every one of them at once and leaves the "ever" intact,
   so "what has been recorded here in August, ever" is still the question this tab is for —
   the question anyone actually asks before a trip. It applies to the area's own list and to
   nothing else on the page: not to the ticks, not to the tier badges, not to the tier tab.
   See userScope for why — and areaWhere, which is what lets the ground go somewhere the season
   is not allowed to follow. */

// Just the ground: a named place, or the map's pin and radius, and nothing else. Split out of
// areaScope so the user-side questions can take the place without taking the season with it,
// which is the whole of what `seen=here` is (see hereOnly). A named place still wins over a pin,
// one area at a time, exactly as it did when this was one function.
function areaWhere(){
  if(view.place) return { place_id: view.place };
  if(pinSet()) return { lat: view.lat, lng: view.lng, radius: view.radius };
  return {};
}

function areaScope(){
  const o = { ...areaWhere() };
  if(view.taxon) o.taxon_id = view.taxon;
  if(view.iconic.length) o.iconic_taxa = view.iconic.join(",");
  if(view.months.length) o.month = view.months.join(",");
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

// Where a selection of months begins, when it is one unbroken run — the month whose
// predecessor is not also chosen. Exactly one such month means a run; two or more mean a
// scatter. December is January's predecessor, so a run reads across the year end and Nov–Feb
// (11,12,1,2) is one season rather than two. The map's own reading, kept word for word.
function monthRunStart(months){
  const starts = months.filter(m => !months.includes(m === 1 ? 12 : m - 1));
  return starts.length === 1 ? starts[0] : null;
}

// The season as a heading says it: one month by name, an unbroken run as a span, anything
// else as a count. Kept short because it hangs off the area's own name, which is already the
// longer half — the months themselves ride on the tooltip wherever this is printed.
function monthsLabel(months){
  const name = m => MONTH_NAMES[m - 1];
  if(!months.length) return "";
  if(months.length === 12) return "every month";
  if(months.length === 1) return name(months[0]);
  const start = monthRunStart(months);
  if(start == null) return `${months.length} months`;
  let end = start;
  while(months.includes(end === 12 ? 1 : end + 1)) end = end === 12 ? 1 : end + 1;
  return `${name(start)}–${name(end)}`;
}

// The place tab's premise is "ever", so a list narrowed to a season has to say so wherever it
// claims to be showing an area — the heading, the page title, the state that says what is
// being read. Silence here would leave a list that is quietly a fraction of what it looks.
function seasonLabel(){
  return view.months.length ? "in " + monthsLabel(view.months) : "";
}

// The page's own name, rebuilt rather than written once: the month row changes what the list
// is without reloading the page, and a tab still bearing the whole year's name would be the
// last thing on screen still claiming it. Also what a bookmark of an August list is called.
function placeTitle(){
  if(!hasArea) return "Species here";
  return "Species — " + areaLabel() + (view.months.length ? " " + seasonLabel() : "");
}

// Every species recorded in the area, heaviest first — the same count iNat's own species
// view leads with.
//
// One of the two answers kept as rows rather than as ids, and the tab's slowest — see the note
// on the size cap where the store is defined. What is kept is the list as it will be read,
// split and sorted, since the split is the expensive half and `hrank` in the key is already
// what tells a split list from a whole one.
async function speciesHere(){
  const params = { ...areaScope(), ...sspOnly() };
  return cachedAsk("here", params, async () => {
    const rows = (await speciesCounts(params)).filter(isSpeciesRow);
    // Already heaviest-first out of the split, and by the subspecies' own counts.
    if(view.ssp) return splitIntoSubspecies(rows, areaScope());
    rows.sort((a, b) => b.count - a.count || sortName(a.taxon).localeCompare(sortName(b.taxon)));
    return rows;
  });
}

// Which of the area's species this user has never recorded — asked of iNat the way round
// that keeps the answer small. Reading their species list instead would mean paging an
// entire life list (11k species, two dozen requests) to tick off a few hundred rows; this
// is one area-sized query however much the user has seen. "Unobserved" is iNat's own and
// means anywhere, not just here, so the tick reads as "I have this species".
//
// Which is also why it cannot simply be narrowed. The place params already in this query only
// pick the candidates; iNaturalist still answers each of them globally. `here` is not this
// question with a place bolted onto it, it is the other question — see recordedHere.
async function unseenHere(user){
  const params = { ...areaScope(), unobserved_by_user_id: user };
  return cachedIds("unseen", params, async () =>
    new Set((await speciesCounts(params)).map(x => x.taxon.id)));
}

// The same tick under `here`, asked positively: which species the reader has records of inside
// the area. `userScope` is exactly the scope wanted, and not by coincidence — the ground rides
// in it under `here` and the season never does, so the tick and the tier badges beside it are
// read on one scope and cannot come to disagree about what "here" was. Small, too: a person's
// records in one area are a fraction of that area's list, where their life list is a multiple
// of it, which is the whole reason the question has to be turned round in the first place.
//
// `verifiable:"any"` because this is a gate, and a gate has to be at least as wide as what it
// gates. The tag searches it stands in front of deliberately reach into casual records (see
// speciesIdsWithTag); left at the default this would find the tag and then throw the row away,
// costing a species tagged S on a casual record here not just its tier but its tick. Widening
// it cannot add a row: it is only ever consulted about species already on the list, and that
// list is verifiable-only — the same trade, and the same reasoning, as the tag lookup's own.
async function recordedHere(user){
  const params = { ...userScope(user), verifiable: "any" };
  return cachedIds("recordedHere", params, async () =>
    new Set((await speciesCounts(params)).map(x => x.taxon.id)));
}

// Has this reader already recorded it — the one thing the badge column needs, and the one thing
// both questions above can answer. They are opposite in sense and opposite in polarity, so the
// choosing is done here and the renderer is handed a single predicate rather than two branches
// it would have to keep the right way up.
async function alreadyHas(user){
  if(readingHere()){
    const mine = await recordedHere(user);
    return id => mine.has(id);
  }
  const missing = await unseenHere(user);
  return id => !missing.has(id);
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
//
// Kept under the whole wave rather than under each batch of it: the batches are a limit of the
// URL, not a division of the question, and the wave is what has to come back the same on a
// second reading. That makes for a long key where a wave is long — exact, which is what a key
// has to be, and short beside the answer it stands for.
async function sspAsk(wave, scope, params){
  const ids = wave.map(x => x.taxon.id);
  return cachedIds("sspAsk", { ...scope, ...params, taxon_id: ids.join(",") }, async () => {
    const asked = new Map(wave.map(x => [parentOf(x), x.taxon.id]));
    const hits = new Set();
    for(const batch of idBatches(ids, 6000)){
      (await speciesCounts({ ...scope, ...params, taxon_id: batch.join(",") }))
        .forEach(r => { const id = asked.get(r.taxon.id); if(id != null) hits.add(id); });
    }
    return hits;
  });
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
  // `verifiable:"any"`, for recordedHere's reason and not a second one: this is the gate the
  // five questions below stand behind, three of them reach into casual records on purpose, and a
  // gate narrower than what it gates costs a race tagged S on a casual record not just its tier
  // but its tick. It only ever narrows rows that are on the list already, and that list is
  // verifiable-only, so widening it can add no row. Read against one area the difference stops
  // being academic — a race is often held on a single record there, and a single casual record
  // was the whole answer.
  else for(const wave of sspWaves(rows))
    (await sspAsk(wave, scope, { verifiable: "any" })).forEach(id => recorded.add(id));

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
//
// Two queries and one answer, so what is kept is the subtraction rather than either half of it,
// and the scope they share is the whole of the question.
async function audioOnlySpeciesIds(user){
  const scope = userScope(user);
  return cachedIds("audioOnly", scope, async () => {
    const [heard, shot] = await Promise.all([
      speciesCounts({ ...scope, sounds: "true", photos: "false" }),
      speciesCounts({ ...scope, photos: "true" })
    ]);
    const photographed = new Set(shot.map(x => x.taxon.id));
    return new Set(heard.map(x => x.taxon.id).filter(id => !photographed.has(id)));
  });
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

// The one list-defining query on this tab, so the one the subspecies filter narrows and then
// splits — and the tab's slowest, a life list being twenty pages for a long-standing user. The
// other of the two answers kept as rows, and kept the same way the area's list is: the list as
// it will be read, split included, with `hrank` in the key telling the two apart.
async function tierRows(user){
  const params = { ...userScope(user), ...sspOnly() };
  return cachedAsk("mine", params, async () => {
    const rows = (await speciesCounts(params)).filter(isSpeciesRow);
    return view.ssp ? splitIntoSubspecies(rows, userScope(user)) : rows;
  });
}

// Band every species the user has recorded by its best tag. Nothing drops out — the five
// tiers together are everything recorded in scope. This fallback order (a tag always beats
// a sound recording, a sound recording always beats nothing) is independent of both TIERS'
// display order and STANDING_ORDER's hide rank — three separate orderings over the same
// five names, each answering a different question.
async function speciesByTier(user){
  const all = await tierRows(user);
  // Split rows band by their own tags, read one race at a time — so a bird tagged S on one
  // subspecies and never tagged on another sits in two different tiers, which is the whole
  // point of asking for the races. Every row here is already the reader's own, the list
  // being theirs by definition, so the "have you recorded it" pass is skipped.
  if(view.ssp){
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

// The export's own glyph: the same arrow as above, dropping into a tray. Deliberately built
// out of the sort arrow's line rather than a fresh drawing — the two sit inches apart in the
// same bar, and an arrow that means "down" beside an arrow that means "out of the page" would
// only read as two directions. currentColor, like every other icon here.
const EXPORT_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true">
  <path d="M8 1.6v8.2M4.4 6.2L8 9.8l3.6-3.6M2 11.4v2.2h12v-2.2"
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
//
// Under `here` the standing is qualified rather than reworded. BADGE's five descriptions are
// shared with the legend and with the tier tab's own headings, and rewriting them at the source
// would have a band on a page that has no area claiming something about one.
function badgeHtml(mark, user){
  const hit = BADGE[mark] || BADGE.seen;
  const said = hit[1] + (readingHere() ? " (in this area)" : "");
  return ` <span class="tick tick-${esc(mark)}" data-rank="${standingRank(mark)}"
      role="button" tabindex="0"
      title="@${esc(user)} &mdash; ${said}. Click to hide this and every better standing."
      aria-label="${said}">${hit[0]}</span>`;
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
          title="${esc(user)}&#39;s own records of this ${rowNoun()}, ${
            readingHere() ? "inside this area" : "everywhere"}">View my</a>`
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

const MONTH_HINT = "Only records made in these months, in any year — the years are never "
  + "shortened, so this is still what the area holds ever, read one season at a time. Your own "
  + "ticks and tier badges are never filtered by season: they say what you have on a species, "
  + "not when. Where they are read is the Recorded switch's own question, not this one's.";

const HERE_HINT = "Read your own ticks and tier badges against this area alone. A green tick "
  + "then means you have recorded the species here, and a tier badge your best tag on a "
  + "photograph taken here. The season never narrows them, either way round. Two kinds of "
  + "record cannot count as here, and both are iNaturalist's doing rather than this page's: "
  + "one it holds no usable location for, and one whose coordinates are obscured — which is "
  + "every record of a threatened species. Anywhere has neither problem.";

// Where the reader's own records are read, and the third of the place tab's asking controls: it
// changes what iNaturalist is asked about them rather than how the rows already on the page are
// read, so it sits with the season and the split rather than in the sortbar. Drawn only where it
// could mean something — an area to be in, and a username to be it about. Anywhere is the
// default and lights the left button, so an address that never mentions it reads exactly as this
// page always has. `data-where` rather than `data-seen`, which a row already carries meaning
// something else entirely.
function heldRowHtml(){
  if(!canReadHere()) return "";
  const on = w => ` aria-pressed="${(view.seen === "here") === (w === "here")}"`;
  return `<div class="heldbar" role="group" aria-label="Where your own records are read"
        title="${esc(HERE_HINT)}">
    <span class="hb-label">Recorded</span>
    <button type="button" data-where="anywhere"${on("anywhere")}>Anywhere</button>
    <button type="button" data-where="here"${on("here")}>Here</button>
  </div>`;
}

// The season control, and the place tab's second asking control. Deliberately not in the
// sortbar: that bar holds only what re-reads rows already on the page, and a month is a
// different question to iNaturalist. So it sits with the subspecies checkbox above the list
// the two of them rebuild. Empty is every month and lights nothing, which is why the clear
// only appears once there is something to clear — the same rule the threshold's × follows.
function monthRowHtml(){
  const on = m => view.months.includes(m);
  return `<div class="monthbar" role="group" aria-label="Months of the year" title="${esc(MONTH_HINT)}">
    <span class="mb-label">Months</span>
    ${MONTH_NAMES.map((l, i) =>
      `<button type="button" data-month="${i+1}" aria-pressed="${on(i+1)}">${l}</button>`).join("")}
    <button type="button" class="mbClear"${view.months.length ? "" : " hidden"}
            title="Read the whole year again" aria-label="Clear months">&times;</button>
  </div>`;
}

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
    <button type="button" class="exportCsv" title="${esc(EXPORT_HINT)}"
      >${EXPORT_ICON}${EXPORT_LABEL}</button>
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

// The tier tab paints an empty list bare — no sortbar, and with it none of the controls that
// could have emptied it. So where one of them is what came back with nothing, the way back out
// has to be in the state itself. A link, not an instruction: the filter is in the address, so
// taking it off is an address too. Each names the one filter it is offering to drop rather
// than resetting the lot. The place tab wears its toolbar under every state now (see
// placeShellHtml), so there this reads as a shortcut rather than as the only way back.
function wayOut(lede, over, call){
  return `${esc(lede)} <a href="${esc(selfUrl(over))}">${esc(call)}</a>`;
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

// The count line: what the area holds, how much of it is already the reader's, and the way
// through to the same area on iNaturalist. It sits at the foot of the toolbar, directly above
// the rows it counts, because that is what it counts — not the area's total but what is
// actually listed, which has to move as the threshold and the cascade take rows out. See
// retally, which rewrites it and finds it by `h2 .n`.
//
// With a username every row carries a standing to read, so it reads as a pair: how many of the
// species showing are already recorded. The username reads beside the count it explains, since
// a standing is only ever there when view.user is (see runPlace) — which is also why this asks
// `view.user` rather than waiting to be handed the lookup. A `|` ahead of each marks it as its
// own item on the line rather than a continuation of the one before, so it still reads as
// three things even in one colour.
//
// `counts` is missing while a fetch is out, when the numbers are simply not known yet: the
// line keeps its shape and shows an em dash for each — the same mark the page header uses for
// a username it has not been given — so nothing shifts when the real numbers land.
// What the pair on that line is called, which the Recorded switch changes — kept in one place
// because retally rewrites the line as rows drop out, and would otherwise put "observed" back
// the first time the threshold moved.
function tallyWord(){ return readingHere() ? "recorded here" : "observed"; }

function placeTallyHtml(counts){
  const sep = `<span class="sep">|</span>`;
  const held = counts ? counts.held : "&mdash;";
  const total = counts ? counts.total : "&mdash;";
  const badge = view.user
    ? `<span class="who">@${esc(view.user)}</span>${sep}<span class="n have" title="Already recorded${
        readingHere() ? " inside this area" : ", anywhere"}, of the species showing">${
        held} / ${total} ${tallyWord()}</span>`
    : `<span class="n">${total}</span>`;
  return `<h2><a href="${esc(areaSpeciesUrl())}" target="_blank" rel="noopener"
        title="The same area on iNaturalist"></a>${badge}</h2>`;
}

// The place tab's controls, apart from the rows they act on: the legend, sort, the subspecies
// split, where the ticks are read, months and the count line. Every one of them reads off
// `view`, never off a fetch's rows, so the whole block can be drawn — and answer clicks —
// before that fetch has landed.
function placeToolbarHtml(sortBy, counts){
  // The legend names the badges; under `here` something also has to name what they are being
  // read against, and it belongs directly above them rather than only on the switch's tooltip.
  // A phone has no hover to fall back on, and a tick quietly meaning something narrower than it
  // did is the one thing on this tab that must not go unsaid.
  const lede = view.user
    ? `<p class="blurb">${readingHere()
        ? `Read against <b>${esc(areaLabel())}</b> alone &mdash; a tick means you have recorded
           it here. ` : ""}Click the tiers below to hide them.</p>${legendHtml()}`
    : `<p class="blurb">Add a username to tick off the ones you have already recorded.</p>`;
  return `${lede}
    ${sortbarHtml(sortBy)}
    ${heldRowHtml()}
    ${monthRowHtml()}
    <label class="onlySub" title="${esc(SSP_HINT)}">
    <input type="checkbox"${view.ssp ? " checked" : ""}>Show only subspecies?</label>
    ${placeTallyHtml(counts)}`;
}

// Every state this tab paints wears the same shell: the toolbar, then whatever goes under it —
// the list, a loading note, an empty one, a failure. So a month tap or the subspecies checkbox
// never costs the reader the control they just used, whether the answer is still out, comes
// back empty, or doesn't come back at all.
function placeShellHtml(body, counts){
  return `<section class="tier" id="here">${placeToolbarHtml(view.sort, counts)}${body}</section>`;
}

// The place tab: one flat list, every species recorded in the area, badged where the
// reader has already recorded it themselves — with what they have on it, not merely that
// they have it.
function placeListHtml(rows, standing, sortBy){
  if(!rows.length){
    // Whichever of the two asking controls is in force gets named first — the split is the
    // narrower question of the two, so where both are on it is the likelier culprit.
    const hint = view.ssp
      ? wayOut("Nothing inside this area has been identified below species rank.",
               { ssp: null }, "Show every species.")
      : view.months.length
        ? wayOut(`Nothing inside this area has been recorded ${seasonLabel()}.`,
                 { m: null }, "Show every month.")
        : `No species inside this area under the current scope.
           Try a wider place, or drop the quick-group filter.`;
    return placeShellHtml(`<div class="state">
      <div class="state-lede">Nothing recorded here.</div>
      <div class="state-hint">${hint}</div>
    </div>`, { held: 0, total: 0 });
  }
  const held = standing ? rows.filter(x => standing(x)).length : 0;
  return placeShellHtml(`<ul>${sortRows(rows, sortBy, standing).map((x, n) =>
    rowHtml(x, n, view.user, standing ? standing(x) : "")).join("")}</ul>`,
    { held, total: rows.length });
}

function listHtml(buckets, user, sortBy){
  if(!buckets.some(rows => rows.length)){
    return `<div class="state">
      <div class="state-lede">Nothing to show.</div>
      <div class="state-hint">${view.ssp
        ? wayOut("Nothing this user has recorded in this scope is identified below species rank.",
                 { ssp: null }, "Show every species.")
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
    // row's own link. "View my" follows the rows' own, which means it follows the Recorded
    // switch: everywhere by default, this area under `here`. It used to be unscoped on purpose,
    // as the one link answering "everywhere I have ever seen this family" — but a band sitting
    // over rows badged against one area cannot be the page's one exception to that, or the
    // heading and the rows under it read as two different questions.
    head.innerHTML = fam
      ? `<a class="famName" href="${esc(taxonAreaUrl(fam.id))}" target="_blank" rel="noopener"
            title="This family's species here, on iNaturalist">
          <b>${esc(fam.name)}</b>${fam.common ? ` <span class="famCommon">${esc(fam.common)}</span>` : ""}
        </a>${view.user
          ? `<a class="viewMy" href="${esc(taxonObsUrl(fam.id, view.user))}" target="_blank" rel="noopener"
                title="${esc(view.user)}'s own records of this family, ${
                  readingHere() ? "inside this area" : "everywhere"}">View my</a>`
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
  if(n) n.textContent = n.classList.contains("have") ? `${held} / ${shown} ${tallyWord()}` : shown;
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

/* ---------------- taking the list away ----------------

   The place tab builds a target list — every species in an area, ticked against one reader,
   banded, sorted, thinned by the threshold and by the cascade — and until now it lasted exactly
   as long as the tab was open. This writes it to a file: a spreadsheet to sort further, or a
   sheet of paper to tick off somewhere with no signal, which is where the list is actually read.

   It reads the RENDERED ROWS, and that is the whole of its correctness. `relist` has already
   applied the order, the threshold, the rank cascade, the subspecies split and the family bands;
   the rows on screen are the one representation that holds all of it at once. Rebuilding any of
   that from the fetched arrays would be a second opinion about what is showing, and the two would
   disagree the first time either side changed. So nothing here recomputes anything — it copies
   out what the reader can see, and if the list is wrong on screen the file is wrong the same way.

   Downloaded, never copied. A clipboard write needs a secure context, and this page's whole
   reason for existing on a phone is being opened from a LAN address — `http://192.168.x.x:8731`
   is not secure, so `navigator.clipboard` is simply absent there. A Blob and an `<a download>`
   work over plain HTTP, survive a reboot, and open in a spreadsheet.

   CSV rather than plain text because the columns are worth keeping apart: a count to sort on, a
   standing to filter by, a family to group by. RFC 4180 throughout — CRLF, and a cell quoted only
   where it has to be, so numbers stay numbers to whatever opens it. */

const EXPORT_LABEL = "Export CSV";
const EXPORT_HINT = "Save what is showing — in this order, with this threshold and these tiers "
  + "hidden — as a CSV. The file names the area, the scope and this page's own address, so the "
  + "list can be rebuilt from it.";

// What each standing is called in a file, where a glyph is no use and a colour ramp is no use
// either. Same five marks the badges speak (see BADGE), plus the empty one — the place tab's
// species with nothing on them at all, which is the row the whole tab is read for and so the one
// that must not export as a blank cell.
const STANDING_WORD = {
  "":      "not recorded",
  seen:    "recorded, untagged",
  audio:   "audio only",
  c:       "tier C",
  b:       "tier B",
  s:       "tier S"
};

// A row's standing, whichever tab painted it. The place tab writes it onto the row; the tier tab
// has no per-row badge because the section IS the standing there, so it is read off the section's
// id — `tier-N` into TIERS, then that tier's tag through the same `tag || "seen"` rule tierBadge
// uses, so Untagged lands on the plain tick rather than on the empty mark.
//
// The id and not the heading: three of the five sections are titled "Tier" and are told apart on
// screen only by the badge beside the word, so the text of the `<h2>` cannot say which band this
// is. Reading the id also keeps the file right if the sections are ever rearranged, TIERS' order
// being explicitly free to change.
function standingOf(li){
  if(li.dataset.standing) return li.dataset.standing;
  const sec = li.closest("section");
  const m = sec && /^tier-(\d+)$/.exec(sec.id);
  const tier = m && TIERS[+m[1]];
  return tier ? (tier[2] || "seen") : "";
}

// Every row the reader can actually see, in the order they are seen in.
//
// Not `li:not([hidden])`, which is only half the rule: the cascade hides individual rows on the
// place tab but whole `<section>`s on the tier tab (see applyHideFrom), and a hidden section's
// rows are not themselves hidden. `closest("[hidden]")` starts at the element itself, so one test
// covers both — a row is out if it is hidden or if anything holding it is.
//
// `li.fam` is dropped rather than exported as a heading row: a CSV is one table with one shape,
// and a family band is how the taxonomic order reads on screen, not a species. The family itself
// is not lost — it rides on every row as a column instead, which is how a spreadsheet groups.
function visibleRows(){
  return [...main.querySelectorAll("ul li")]
    .filter(li => !li.classList.contains("fam") && !li.closest("[hidden]"));
}

const CSV_COLUMNS = ["#", "Common name", "Scientific name", "Observations", "Standing",
                     "Family", "Taxon id"];

// One row, read off itself. The number comes from `.num` because that is the number the reader
// sees — `relist` renumbers it as rows drop out, so it counts the list rather than the fetch.
//
// A row with no English name prints its binomial in the common slot and carries no `.sci` line at
// all (see rowHtml). Here that name moves to the scientific column and the common one is left
// empty, so a column of binomials never masquerades as a column of common names.
//
// The family is `familyOf`'s, the same lookup drawFamilies reads, so the column and the bands can
// never name different families. It is fetched behind the finished list, so an export taken in the
// first second or two of a paint has the column empty — absent, never wrong, which is the same
// bargain the eBird links make.
function rowCells(li){
  const text = el => el ? el.textContent.trim() : "";
  const nameEl = li.querySelector(".common");
  const name = text(nameEl && nameEl.querySelector("a"));
  const asSci = !!nameEl && nameEl.classList.contains("as-sci");
  const fam = familyOf.get(+li.dataset.taxon);
  return [
    text(li.querySelector(".num")),
    asSci ? "" : name,
    asSci ? name : text(li.querySelector(".sci")),
    li.dataset.count,
    STANDING_WORD[standingOf(li)],
    fam ? fam.name : "",
    li.dataset.taxon
  ];
}

// RFC 4180: a cell is quoted only where it has to be — a comma, a quote, a line break, or space at
// either end that a reader would otherwise lose. Inner quotes double. Everything else goes bare,
// so a count arrives in a spreadsheet as a number rather than as text that looks like one.
//
// `esc` is the wrong tool here and deliberately not used: these strings are going into a file, not
// into `innerHTML`, and `&amp;` in a printed checklist is a bug. Common names hold commas often
// enough ("Sparrow, House" style inversions, "Tit, Great") that this is not theoretical; nothing
// on iNaturalist is known to hold a quote or a newline, which is exactly why the code must not
// assume it.
function csvCell(v){
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(cells){ return cells.map(csvCell).join(","); }

// Local, not UTC: the reader took this list at their own clock, and an ISO string would say
// something else by an hour or two. Minutes are enough — two exports the same afternoon want
// telling apart, two the same minute do not.
function stampNow(d){
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// What this list is, so a file found in six months still means something — and so it can be had
// again. Key and value, a pair per line, ahead of a blank line and the table proper: a spreadsheet
// shows it as a small block above the columns, and a stricter parser is told to skip it.
//
// The URL earns its place over all the rest. The address IS the state on this page — scope, tab,
// months, sort, direction, threshold, cascade and layout are all written into it as they change —
// so that one line rebuilds this exact list, which is a thing no other export format gives away
// for free.
//
// The counts are taken from the exported rows rather than read back off the heading, so the pair
// in the file and the pair on screen cannot drift; they are the same rows counted the same way
// retally counts them.
function csvHeadLines(rows){
  const out = [["List", view.tab === "tier" ? "By tier tag" : "Species here"]];
  if(view.tab === "place"){
    out.push(["Area", areaLabel()]);
    if(view.months.length) out.push(["Season", monthsLabel(view.months)]);
  }
  out.push(["Scope", scopeLabel()]);
  if(view.user) out.push(["User", view.user]);
  // Capitalised through rowNoun so the key reads as what the rows are — "Subspecies,412" under
  // the split, "Species,412" otherwise.
  const noun = rowNoun();
  out.push([noun[0].toUpperCase() + noun.slice(1), rows.length]);
  // Only where a standing means something: on the tier tab every row is the reader's own by
  // definition, so "412 of 412" there would be a line that says nothing.
  //
  // What "recorded" meant goes directly above the number it qualifies, and is printed either way
  // round rather than only under `here`. A default that writes nothing is right for an address,
  // which is always read beside the page it opens; this is a file, opened months later with
  // nothing beside it at all, and "144 of 332" with no word on which question was asked is the
  // exact ambiguity the switch exists to end. Named for the column it also explains.
  if(view.tab === "place" && view.user){
    const held = rows.filter(li => li.dataset.standing).length;
    out.push(["Standing", readingHere() ? "read against this area alone"
                                        : "read against everywhere"]);
    out.push(["Recorded", `${held} of ${rows.length}`]);
  }
  // Both of these are in the URL below, but a printed sheet is read without following it, and a
  // reader holding 40 rows of a 900-species area has to be told that is what they are holding.
  const cut = [];
  if(view.min) cut.push(`hidden under ${view.min} observations`);
  if(view.hide != null && STANDING_ORDER[view.hide]) {
    cut.push(`${STANDING_WORD[STANDING_ORDER[view.hide]]} and above hidden`);
  }
  if(cut.length) out.push(["Filters", cut.join("; ")]);
  out.push(["Taken", stampNow(new Date())]);
  out.push(["URL", location.href]);
  return out.map(csvLine);
}

// The whole file, or null where there is nothing to write — the place tab keeps its toolbar up
// through loading, empty and failed states (see placeShellHtml), so the button is on screen at
// moments when the list is not.
function csvText(){
  const rows = visibleRows();
  if(!rows.length) return null;
  return [...csvHeadLines(rows), "", csvLine(CSV_COLUMNS), ...rows.map(li => csvLine(rowCells(li)))]
    .join("\r\n") + "\r\n";
}

// A name that says what the file is without being opened, and that sorts with its siblings by
// date. Anything that is not a letter or a digit becomes a hyphen — this lands on a filesystem,
// and a place called "Faro, Portugal" or a pin labelled "5.0 km around 38.720, -9.140" must not
// arrive as a name Windows refuses.
function csvName(){
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "").slice(0, 40);
  const who = view.tab === "tier" ? view.user + "-tier-tags" : areaLabel();
  return ["inat", slug(who), slug(scopeLabel()), stampNow(new Date()).slice(0, 10)]
    .filter(Boolean).join("-") + ".csv";
}

// A Blob, an object URL, an anchor clicked and dropped, and the URL revoked behind it. The
// timeout is what the revoke needs: a click is queued, not performed, and pulling the URL out
// from under it in the same tick loses the file on some browsers.
//
// The BOM is not decoration. Without it Excel on Windows reads a .csv as the system codepage and
// every name holding an accent or an en dash arrives mangled — and this list is full of both.
// Named, and written as its escape rather than as the character: a bare U+FEFF in the source is
// invisible in every editor, and the first tool to tidy this file would take it away silently
// with nothing left to see.
//
// No `target` on the anchor, deliberately: the home-screen standalone build intercepts clicks on
// `a[target="_blank"]` and turns them into navigations (see the top of this file), which would
// send the reader to a blob URL instead of saving one.
const BOM = "\uFEFF";

function saveCsv(text, name){
  const url = URL.createObjectURL(new Blob([BOM + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Delegated from the document, like the badges: the sortbar is destroyed and rebuilt on every
// paint, on both tabs, and a listener bound to the button would go with it — so this is wired
// once and survives every repaint there will ever be.
//
// Feedback is the gallery's: swap the label, put it back after a beat, no alert and no toast. The
// label is restored from the constant rather than from what the button was reading when it was
// clicked, so a second click inside that beat cannot leave a button permanently saying "Saved".
function wireExport(){
  let timer = null;
  document.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest(".exportCsv");
    if(!btn) return;
    const say = word => {
      btn.textContent = word;
      clearTimeout(timer);
      timer = setTimeout(() => { btn.innerHTML = EXPORT_ICON + EXPORT_LABEL; }, 1200);
    };
    let text;
    try{ text = csvText(); }catch(err){ say("Couldn't save"); return; }
    if(!text){ say("Nothing to save"); return; }
    // A refusal here is the browser's — no room, no permission, an old one with no `download` at
    // all. Said out loud rather than swallowed: this is a list someone is trying to take into the
    // field, and a button that silently does nothing is worse than one that admits it.
    try{ saveCsv(text, csvName()); say("Saved"); }
    catch(err){ say("Couldn't save"); }
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

// The third control that asks iNaturalist something new, and the plainest of them: one tap, with
// no run of taps to wait out, so no debounce — the month row's half-second below exists because
// a summer is three of them and this is never more than one. A tap on the button already lit is
// not a change and must not cost a query.
//
// Found by its own class, like the subspecies checkbox, so moving it around the toolbar costs
// nothing here. The list is repainted from the tab's own query, so the row goes with it and comes
// back showing the side it was put on.
function wireHeld(){
  document.querySelectorAll(".heldbar").forEach(row => row.addEventListener("click", e => {
    const b = e.target.closest("button[data-where]");
    if(!b) return;
    const want = b.dataset.where === "here" ? "here" : "";
    if(want === view.seen) return;
    view.seen = want;
    // Anywhere is the default, so it leaves no key behind — same as sort's "count".
    writeState({ seen: view.seen });
    runPlace();
  }));
}

// The other control that asks iNaturalist something new — and the only one worked in several
// taps, a summer being three of them. Firing on the tap would spend an area query on each, and
// throw away the first two before they landed, so the row lights and the address is rewritten
// at once (both free) and the refetch waits for the reader to stop. Half a second is long
// enough to pick a run of months and short enough not to read as a control that ignored you.
//
// The list is repainted from the tab's own query, so the row goes with it and comes back
// showing the same months — nothing here has to survive the paint but the timer.
function wireMonths(){
  const rows = [...document.querySelectorAll(".monthbar")];
  if(!rows.length) return;
  let timer = null;
  const apply = () => {
    rows.forEach(row => {
      row.querySelectorAll("button[data-month]").forEach(b =>
        b.setAttribute("aria-pressed", view.months.includes(+b.dataset.month)));
      row.querySelector(".mbClear").hidden = !view.months.length;
    });
    // Every month is the default, so it leaves no key behind — same as sort's "count".
    writeState({ m: view.months.join(",") });
    clearTimeout(timer);
    timer = setTimeout(runPlace, 500);
  };
  rows.forEach(row => row.addEventListener("click", e => {
    const b = e.target.closest("button[data-month]");
    if(b){
      const m = +b.dataset.month;
      view.months = view.months.includes(m)
        ? view.months.filter(x => x !== m)
        : [...view.months, m].sort((a, x) => a - x);
      apply();
      return;
    }
    if(e.target.closest(".mbClear") && view.months.length){ view.months = []; apply(); }
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

// The five controls that mean something on `view` alone, with no rows required to answer a
// click — sort, layout, the subspecies split, where the ticks are read, and months. Bound after
// any paint that can grow one of them into the page, including the place tab's own loading state
// (see runPlace), since the buttons a reader just used are still live even while their fetch is
// out.
function wireToolbar(){
  wireSort();
  wireLayout();
  wireOnlySub();
  wireHeld();                   // place tab only, and only with an area and a username to read
  wireMonths();                 // place tab only — no month row is painted anywhere else
}

// A shell painted with no rows under it still has to answer clicks, and its legend still has
// to show whatever cutoff is already in force — the same two steps afterPaint takes once the
// rows do land. The badges themselves need no binding: one delegated listener on the document
// catches every one of them (see wireHideToggle), however many times they are repainted.
function wirePlaceShell(){
  wireToolbar();
  applyHideFrom();
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

// `wrap` lets a tab keep whatever shell was already on screen around the message — the place
// tab uses it to hold its toolbar in place through a failed refetch (see runPlace); the tier
// tab has no such shell to offer, so it takes the default and paints the message bare.
function failed(hint, wrap = html => html){
  paint(wrap(`<div class="state">
    <div class="state-lede">The list didn't come back.</div>
    <div class="state-hint">${hint}</div>
  </div>`), "failed");
}

// Family names and eBird codes both cost their own requests, so they are fetched behind the
// finished list rather than in front of it. The headings and the links appear when they land,
// and a failure on either side costs only itself — the list is already on screen.
function afterPaint(buckets){
  wireToolbar();
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

// The month row can be worked again while a run is still out — a place query takes seconds,
// and a reader picking a season will not always wait for one to land before adding the next
// month. So each run carries a number and only the newest may paint; an overtaken one drops
// its answer on the floor rather than putting a stale list up after the current one.
let placeRun = 0;

async function runPlace(){
  const mine = ++placeRun;
  document.title = placeTitle();
  // The note is rebuilt here for the same reason the title is: the month row and the Recorded
  // switch change what this list is without reloading the page, and a note still describing the
  // old one would be the last thing on screen still claiming it.
  document.getElementById("note").innerHTML = NOTES.place();
  paint(placeShellHtml(`<div class="state">
    <div class="state-lede">Reading the area&hellip;</div>
    <div class="state-hint">Every species recorded in ${esc(areaLabel())}${
      view.months.length ? " " + esc(seasonLabel()) : ""}${
      view.user ? (readingHere()
        ? `, then checking them against what @${esc(view.user)} has recorded here`
        : `, then checking them against @${esc(view.user)}'s own species`) : ""}.${
      view.ssp ? " Splitting each into its subspecies takes a few more passes." : ""}</div>
  </div>`), "", true);
  wirePlaceShell();
  try{
    // Whole species can be asked about all at once, none of the three depending on another:
    // `has` answers which of the area's species this user already holds, `bestOf` what they
    // hold on them. Subspecies cannot — the questions are asked by id, so the list has to
    // exist first — and they replace both, so neither is fetched then.
    const split = view.ssp && !!view.user;
    const [rows, has, bestOf] = await Promise.all([
      speciesHere(),
      view.user && !split ? alreadyHas(view.user) : Promise.resolve(null),
      view.user && !split ? standingLookup(view.user) : Promise.resolve(null)
    ]);
    // One lookup for the renderer, taking a row rather than an id so that each list can
    // answer at its own rank: "" for something they have never recorded, otherwise their
    // standing on it. Missing beats standing — a taxon absent from their list has no tags to
    // rank, whatever a stale tag search might say. One reading of it whichever way round
    // `alreadyHas` had to ask, which is the whole reason it hands back a predicate.
    let standing = null;
    if(split){
      const bySsp = await sspStanding(rows, view.user, false);
      standing = x => bySsp(x.taxon.id);
    }else if(has){
      standing = x => has(x.taxon.id) ? (bestOf ? bestOf(x.taxon.id) : "seen") : "";
    }
    if(mine !== placeRun) return;              // a later selection is already being read
    // No tally in the header: this tab is one list, and its count belongs on it, where it can
    // follow what the threshold and the cascade leave showing. The tier tab keeps its own —
    // five sections have no single heading to carry a total.
    paint(placeListHtml(rows, standing, view.sort), "");
    afterPaint([rows]);
  }catch(e){
    // An overtaken run's failure is not this list's failure — the newer one is still out, and
    // its own loading state is what should be on screen.
    if(mine !== placeRun) return;
    failed("iNaturalist may be rate-limiting, or that place may be too large to tally.", placeShellHtml);
    wirePlaceShell();
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
  let timer = null, seq = 0, active = -1;

  const close = () => { hits.hidden = true; hits.innerHTML = ""; active = -1; };

  // Keeps the highlighted row in sync with `active`, whether it moved by arrow key or the
  // list just repainted — a single place so the two never fall out of step.
  const highlight = () => {
    [...hits.children].forEach((el, i) => el.classList.toggle("hi", i === active));
    if(active >= 0) hits.children[active].scrollIntoView({ block: "nearest" });
  };

  const show = list => {
    if(!list.length){ close(); return; }
    active = -1;
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

  // Arrow keys move the highlight, Enter picks it — defaulting to the top row when nothing's
  // been arrowed to yet, so Enter after typing acts on the best match without an extra tap.
  input.addEventListener("keydown", e => {
    if(hits.hidden || !hits.children.length) return;
    if(e.key === "ArrowDown"){
      e.preventDefault();
      active = Math.min(active + 1, hits.children.length - 1);
      highlight();
    }else if(e.key === "ArrowUp"){
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
    }else if(e.key === "Enter"){
      e.preventDefault();
      pick(hits.children[active < 0 ? 0 : active]);
    }else if(e.key === "Escape"){
      close();
    }
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

// Functions rather than strings, for the place tab's sake: its note has to say which way the
// ticks are being read, and the Recorded switch changes that without reloading the page. So it
// is rebuilt on every run, beside the title — see runPlace.
const NOTES = {
  tier: () => `Every species this user has recorded, banded by the best tier tag it carries
     and listed weakest first. The tiers override downwards &mdash; S beats B beats C &mdash; so a
     species tagged S counts as tier S whatever else sits on it, and appears once. IDs left
     coarser than species are not counted. Each link opens their observations of that species,
     casual ones included.`,
  place: () => `Every species recorded inside this area, with the ones the named user has already
     recorded ${readingHere() ? "&mdash; here, inside this area &mdash;"
                              : "&mdash; anywhere, not just here &mdash;"} ticked off. Counts are
     iNaturalist's own observation totals for the area, so the default order is the same one their
     species view leads with. Casual records are not counted; the years are never shortened, so
     this answers what has been found in this place, ever &mdash; and the month row cuts that by
     season without cutting it short.`
};

(function init(){
  // Delegated on the document, so it covers every badge this page ever paints without
  // needing to be re-bound after each render — wired once, here, rather than per paint.
  wireHideToggle();
  // The same arrangement, and for the same reason: the export sits in the sortbar, which is
  // thrown away and rebuilt on every paint on both tabs.
  wireExport();

  // The tabs are two addresses over one scope, so switching carries the scope across and
  // drops only what cannot apply.
  document.querySelectorAll("#tabs a").forEach(a => {
    const tab = a.dataset.tab;
    a.href = selfUrl({ tab: tab === "place" ? null : tab });
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
  document.getElementById("note").innerHTML = NOTES[view.tab]();
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
    document.title = placeTitle();
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
      // The place field has just been filled in for the reader, so the cursor belongs one
      // question further along — the same rule the empty-place state above follows, moved on
      // by the answer that arrived with the link. Only where a question is still outstanding:
      // with both halves set the page is a list to be read, and a field taking focus there
      // would open a keyboard over it.
      document.getElementById("taxonInput").focus();
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
