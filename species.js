/* ---------------- page address ----------------

   The report is its own page, so its whole input lives in the query string and it can be
   bookmarked, shared, and reloaded on its own:

     species.html?u=USER&taxon=ID&tname=NAME&iconic=Aves,Insecta&sort=name#tier-3
     species.html?tab=place&place_id=7122&pname=Portugal&u=USER&sort=taxo
     species.html?tab=place&lat=38.72&lng=-9.14&radius=12&u=USER

   Two tabs over the same rows. `tier` is about one person: their species banded by the tier
   tag they carry. `place` is about one patch of ground: every species recorded there, with
   the ones that person has already recorded ticked off. Both are addresses, so either can
   be bookmarked and the tab strip is just two links.

   `tname` is only a label — the taxon id is what scopes the query — so a stale or missing
   name costs nothing but a prettier heading. `pname` is the same for a place.

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

const q = new URLSearchParams(location.search);
const tab = q.get("tab") === "place" ? "place" : "tier";

// The threshold's default has to follow what the counts mean, and the two tabs count
// different things. On the place tab a count is iNaturalist's area-wide total for that
// species — hundreds or thousands — so trimming under 20 drops only the long tail. On the
// tier tab it is this one user's own observations of it, which is a handful even for a
// species they photograph often, so any threshold at all empties the page.
const DEFAULT_MIN = tab === "place" ? 20 : 0;

const view = {
  tab,
  user:   (q.get("u") || "").trim(),
  taxon:  q.get("taxon") || "",
  tname:  q.get("tname") || "",
  iconic: (q.get("iconic") || "").split(",").filter(Boolean),
  sort:   ["name","taxo"].includes(q.get("sort")) ? q.get("sort") : "count",
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
       + "&search_on=tags&user_id=" + encodeURIComponent(user);
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
// Casual records are dropped at the source, on every query this page makes: captive and
// cultivated plants, undated and unplaced records. A species known here only from those
// leaves the list entirely rather than sitting in it with a count of one. `verifiable` is
// iNat's own shorthand for research plus needs-ID, and is what their species view applies.
async function speciesCounts(params){
  const out = [];
  for(let page = 1; page <= 20; page++){
    const p = new URLSearchParams(params);
    p.set("verifiable", "true");
    p.set("per_page", "500");
    p.set("page", String(page));
    const r = await fetch(`${API}/observations/species_counts?${p.toString()}`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    (d.results || []).forEach(x => { if(x.taxon && x.taxon.id) out.push(x); });
    if(page * 500 >= (d.total_results || 0)) break;
  }
  return out;
}

// The species carrying one tier's tag. One request per tag: the tags index matches a
// single term, so "s b" ORs nothing.
async function speciesIdsWithTag(user, tag){
  const rows = await speciesCounts({ ...userScope(user), search_on:"tags", q:tag });
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
  const rows = (await speciesCounts(areaScope())).filter(isSpeciesRow);
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

// iNat's own place search, the one behind the place field on their observation pages.
async function findPlaces(text){
  const p = new URLSearchParams({ q: text, per_page: "8" });
  const r = await fetch(`${API}/places/autocomplete?${p}`);
  if(!r.ok) throw new Error(r.status);
  const d = await r.json();
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

// The name the list sorts and labels by — common where iNat has one, binomial otherwise.
function sortName(t){ return (t.preferred_common_name || t.name || "").toLowerCase(); }

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
    const r = await fetch(`${API}/taxa?${p}`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    (d.results || []).forEach(t => families.set(t.id, { id: t.id, name: t.name, common: t.preferred_common_name || "" }));
  }
  rows.forEach(x => {
    const fam = ancestorsOf(x.taxon).map(id => families.get(id)).find(Boolean);
    if(fam) familyOf.set(x.taxon.id, fam);
  });
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

// Band every species the user has recorded by its best tag. Nothing drops out — the five
// tiers together are everything recorded in scope. This fallback order (a tag always beats
// a sound recording, a sound recording always beats nothing) is independent of both TIERS'
// display order and STANDING_ORDER's hide rank — three separate orderings over the same
// five names, each answering a different question.
async function speciesByTier(user){
  const have = {};
  for(const tag of LEVELS) have[tag] = await speciesIdsWithTag(user, tag);
  const audio = await audioOnlySpeciesIds(user);
  const all = await speciesCounts(userScope(user));
  const buckets = TIERS.map(() => []);
  for(const x of all){
    if(!isSpeciesRow(x)) continue;
    const has = tag => have[tag].has(x.taxon.id);
    // Index by each tier's position in TIERS (its tag), not by a hardcoded slot — so this
    // keeps working whatever order the sections are arranged in.
    const tag2 = has("s") ? "s" : has("b") ? "b" : has("c") ? "c" : audio.has(x.taxon.id) ? "audio" : "";
    buckets[TIERS.findIndex(t => t[2] === tag2)].push(x);
  }
  // Heaviest-recorded first inside each tier: the species you already have the most shots
  // of are the ones most likely to hold a taggable frame. The page can flip to A–Z
  // without a refetch.
  buckets.forEach(rows => rows.sort((a,b) =>
    b.count - a.count || sortName(a.taxon).localeCompare(sortName(b.taxon))));
  return buckets;
}

/* ---------------- painting ---------------- */

const main = document.getElementById("main");
const refreshBtn = document.getElementById("refresh");
const countEl = document.getElementById("count");

// A speaker, for the species heard and never seen. Same drawing as the map's audio pins,
// flattened to one colour since it sits on a filled disc here.
const SPEAKER_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3.5 9.5H6.7L11.5 6V18L6.7 14.5H3.5Z"
        fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M14.6 9.6a4.2 4.2 0 010 4.8M17.6 7.6a8 8 0 010 8.8"
        fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
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
  const url = mark == null ? taxonObsUrl(t.id, user) : taxonAreaUrl(t.id);
  const photo = t.default_photo && (t.default_photo.medium_url || t.default_photo.square_url);
  // Plenty of taxa have no English name; those lead with the binomial instead of
  // printing it twice, set in the same italic serif the second line would have used.
  const common = t.preferred_common_name || "";
  const tick = mark ? badgeHtml(mark, user) : "";
  // Place tab only, and only where a tick is already drawn: a species with no standing has
  // nothing of the user's to view, so the link rides beside the badge rather than floating
  // off on its own — one more thing to read only where there's already something to read.
  const viewMy = mark
    ? ` <a class="viewMy" href="${esc(taxonObsUrl(t.id, user))}" target="_blank" rel="noopener"
          title="${esc(user)}&#39;s own records of this species, everywhere">View my</a>`
    : "";
  return `<li class="${mark ? "seen" : ""}" data-count="${x.count}" data-name="${esc(sortName(t))}"
      data-taxo="${esc(taxoKey(t))}" data-taxon="${t.id}" data-seen="${mark ? 1 : 0}"
      data-standing="${esc(mark || "")}">
    <span class="num">${i + 1}</span>
    <a class="shot" href="${esc(url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${
      photo ? `<img src="${esc(photo)}" alt="" loading="lazy">`
            : `<span class="nophoto">&#9673;</span>`}</a>
    <span class="body">
      <span class="common${common ? "" : " as-sci"}"><a href="${esc(url)}" target="_blank" rel="noopener">${
        esc(common || t.name || "Unnamed")}</a>${tick}${viewMy}</span>
      ${common && t.name ? `<span class="sci">${esc(t.name)}</span>` : ""}
      <span class="meta">${x.count} observation${x.count === 1 ? "" : "s"}${
        t.rank ? " &middot; " + esc(t.rank) : ""}</span>
      <span class="url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></span>
    </span>
  </li>`;
}

// One sortbar per list, shared by both tabs: it re-sorts what is already rendered, so
// flipping order never costs a refetch. On the tier tab it drives every tier at once.
function sortbarHtml(sortBy){
  const on = by => sortBy === by ? ` class="on"` : "";
  return `<div class="sortbar">Sort
    <button type="button" data-by="count"${on("count")}>Most observed</button>
    <button type="button" data-by="name"${on("name")}>A&ndash;Z</button>
    <button type="button" data-by="taxo"${on("taxo")}>Taxonomic</button>
    <span class="thresh">Hide under
      <span class="minWrap">
        <input type="number" class="minObs" min="0" step="1" value="${view.min || ""}"
               placeholder="0" inputmode="numeric" aria-label="Hide species under this many observations">
        <button type="button" class="minClear" title="Show every species"
                aria-label="Clear the threshold"${view.min ? "" : " hidden"}>&times;</button>
      </span> obs</span>
  </div>`;
}

// Order the rows for the first paint. Afterwards the sortbar shuffles the DOM instead.
function sortRows(rows, sortBy){
  if(sortBy === "count") return rows;
  return rows.slice().sort(sortBy === "taxo"
    ? (a, b) => taxoKey(a.taxon).localeCompare(taxoKey(b.taxon)) ||
                sortName(a.taxon).localeCompare(sortName(b.taxon))
    : (a, b) => sortName(a.taxon).localeCompare(sortName(b.taxon)));
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
      <div class="state-hint">No species inside this area under the current scope.
        Try a wider place, or drop the quick-group filter.</div>
    </div>`;
  }
  const tally = standing
    ? `<p class="blurb">Click the tiers below to hide them.</p>${legendHtml()}`
    : `<p class="blurb">Add a username to tick off the ones you have already recorded.</p>`;
  return `<section class="tier" id="here">
    <h2><a href="${esc(areaSpeciesUrl())}" target="_blank" rel="noopener"
          title="The same area on iNaturalist">${esc(areaLabel())}</a><span class="n">${rows.length}</span></h2>
    ${tally}
    ${sortbarHtml(sortBy)}
    <ul>${sortRows(rows, sortBy).map((x, n) =>
      rowHtml(x, n, view.user, standing ? standing(x.taxon.id) : "")).join("")}</ul>
  </section>`;
}

function listHtml(buckets, user, sortBy){
  if(!buckets.some(rows => rows.length)){
    return `<div class="state">
      <div class="state-lede">Nothing to show.</div>
      <div class="state-hint">This user has no species recorded in this scope.</div>
    </div>`;
  }
  const sortbar = sortbarHtml(sortBy);
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
function comparator(by){
  if(by === "count") return (p, r) =>
    (+r.dataset.count) - (+p.dataset.count) || p.dataset.name.localeCompare(r.dataset.name);
  if(by === "taxo") return (p, r) =>
    p.dataset.taxo.localeCompare(r.dataset.taxo) || p.dataset.name.localeCompare(r.dataset.name);
  return (p, r) => p.dataset.name.localeCompare(r.dataset.name);
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
function retally(ul, shown){
  const sec = ul.closest("section");
  if(!sec) return;
  const n = sec.querySelector("h2 .n");
  if(n) n.textContent = shown;
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

// One pass over the rendered rows: order, threshold, rank cutoff, renumber, band. Every
// control that touches visibility goes through here, so none of them can disagree about
// the list.
function relist(){
  const cmp = comparator(view.sort);
  document.querySelectorAll("#main ul").forEach(ul => {
    [...ul.querySelectorAll("li.fam")].forEach(li => li.remove());
    let shown = 0;
    [...ul.children].sort(cmp).forEach(li => {
      ul.appendChild(li);                          // moves, does not clone
      li.hidden = (+li.dataset.count) < view.min || rankHidden(li);
      if(!li.hidden) li.firstElementChild.textContent = ++shown;   // .num
    });
    retally(ul, shown);
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
  // `[data-by]` matters: the threshold's clear button lives in the same bar, and must not
  // be mistaken for a sort choice.
  const btns = [...document.querySelectorAll(".sortbar button[data-by]")];
  const nums = [...document.querySelectorAll(".sortbar .minObs")];
  if(!btns.length) return;

  btns.forEach(b => b.addEventListener("click", async () => {
    view.sort = b.dataset.by;
    btns.forEach(x => { x.className = x === b ? "on" : ""; });
    writeState({ sort: view.sort === "count" ? "" : view.sort });
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
  countEl.innerHTML = sub;
  refreshBtn.disabled = !!busy;
  refreshBtn.innerHTML = busy ? "Reading&hellip;" : "Refresh";
}

function failed(hint){
  paint(`<div class="state">
    <div class="state-lede">The list didn't come back.</div>
    <div class="state-hint">${hint}</div>
  </div>`, "failed");
}

// Family names cost their own requests, so they are fetched behind the finished list
// rather than in front of it. The headings appear when they land.
function afterPaint(buckets){
  wireSort();
  applyHideFrom();              // tier tab's sections; a no-op if nothing is cut and place-tab-safe
  if(view.min || view.hide != null) relist();   // a threshold or cutoff in the address applies to first paint
  familiesReady = loadFamilies(buckets).catch(() => {});
  familiesReady.then(() => {
    if(view.sort === "taxo") document.querySelectorAll("#main ul").forEach(ul => drawFamilies(ul, true));
  });
}

async function runTier(){
  paint(`<div class="state">
    <div class="state-lede">Compiling the list&hellip;</div>
    <div class="state-hint">Reading every species @${esc(view.user)} has recorded, then sorting them by the tags they carry.</div>
  </div>`, "reading&hellip;", true);
  try{
    const buckets = await speciesByTier(view.user);
    const total = buckets.reduce((n, rows) => n + rows.length, 0);
    paint(listHtml(buckets, view.user, view.sort), `${total} species`);
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
      view.user ? `, then checking them against @${esc(view.user)}'s own species` : ""}.</div>
  </div>`, "reading&hellip;", true);
  try{
    // All at once — none depends on another. `unseen` answers which of the area's species
    // this user is missing; `bestOf` answers what they hold on the ones they do have.
    const [rows, unseen, bestOf] = await Promise.all([
      speciesHere(),
      view.user ? unseenHere(view.user) : Promise.resolve(null),
      view.user ? standingLookup(view.user) : Promise.resolve(null)
    ]);
    // One lookup for the renderer: "" for a species they have never recorded, otherwise
    // their standing on it. Missing beats standing — a species absent from their list has
    // no tags to rank, whatever a stale tag search might say.
    const standing = unseen
      ? id => unseen.has(id) ? "" : (bestOf ? bestOf(id) : "seen")
      : null;
    const fresh = standing ? rows.filter(x => !standing(x.taxon.id)).length : 0;
    paint(placeListHtml(rows, standing, view.sort),
      standing ? `${fresh} / ${rows.length} species unobserved` : `${rows.length} species`);
    afterPaint([rows]);
  }catch(e){
    failed("iNaturalist may be rate-limiting, or that place may be too large to tally.");
  }
}

/* ---------------- place finder ---------------- */

// iNat's place search, debounced. Picking a hit is a navigation, not a state change: the
// place lands in the address, so the list it produces can be linked to like any other.
function wirePlaceFinder(){
  const input = document.getElementById("placeInput");
  const hits = document.getElementById("placeHits");
  let timer = null, seq = 0;

  const close = () => { hits.hidden = true; hits.innerHTML = ""; };

  const show = list => {
    if(!list.length){ close(); return; }
    hits.innerHTML = list.map(p =>
      `<button type="button" data-id="${p.id}" data-name="${esc(p.name)}">${esc(p.name)}${
        p.kind ? `<span>${esc(p.kind)}</span>` : ""}</button>`).join("");
    hits.hidden = false;
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if(text.length < 2){ close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try{
        const list = await findPlaces(text);
        if(mine === seq) show(list);
      }catch(e){ close(); }
    }, 300);
  });

  hits.addEventListener("click", e => {
    const b = e.target.closest("button[data-id]");
    if(!b) return;
    // A named place replaces any pin the map handed over — one area at a time.
    location.href = selfUrl({
      tab: "place", place_id: b.dataset.id, pname: b.dataset.name,
      lat: null, lng: null, radius: null
    });
  });

  document.addEventListener("click", e => {
    if(!e.target.closest(".finder")) close();
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

  document.getElementById("scope").textContent = scopeLabel();
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
  document.getElementById("note").innerHTML = NOTES[view.tab];
  document.getElementById("who").textContent = view.user ? "@" + view.user : "no user";

  // Quick groups sit on both tabs and stay put rather than only appearing when the scope
  // is empty: they are the filter, so changing group is one tap wherever the reader is.
  // Toggling, not choosing — the map allows several at once and so does this. The scope
  // is the same key on either tab, so a group survives switching between them.
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
    location.href = selfUrl({ iconic: next.join(",") });
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
    document.getElementById("title").textContent = "Species here";
    document.title = hasArea ? "Species — " + areaLabel() : "Species here";
    document.getElementById("scope").textContent =
      (hasArea ? areaLabel() : "no area") + " · " + scopeLabel();
    document.getElementById("placebar").hidden = false;
    wirePlaceFinder();

    // No username, no ticks — so offer the field rather than silently dropping the column.
    if(!view.user){
      document.getElementById("userBar").hidden = false;
      const uq = document.getElementById("userQuick");
      uq.addEventListener("keydown", e => {
        if(e.key !== "Enter" || !uq.value.trim()) return;
        location.href = selfUrl({ u: uq.value.trim() });
      });
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
          Pick a group above &mdash; or set a species on the map first.</div>
      </div>`, "pick a group");
      return;
    }
    runPlace();
    return;
  }

  document.getElementById("title").textContent = "Species by tier tag";
  document.title = view.user ? "Tier tags — @" + view.user : "Species by tier tag";
  // Refresh belongs to this tab only: the place tab's answer is a place's, not a person's,
  // and it changes on the timescale of other people's uploads.
  refreshBtn.hidden = false;

  if(!view.user){
    askUser("Which user?",
      "This tab reports one iNaturalist account's species by tier tag.",
      "nothing to read yet");
    return;
  }

  refreshBtn.addEventListener("click", runTier);
  runTier();
})();
