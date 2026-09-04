"use strict";

/* The API's address, the request gate every call to it goes through, `esc`, `ICONIC`,
   `MONTH_NAMES` and the species_counts paging loop are in common.js, which the page loads
   ahead of this one. They are globals by the time anything here runs. */

const MARK = "#FF3E7C";
// --panel, the sheet the results list sits on. The palette lives in CSS, but a taxon glyph
// drawn flat in that list needs a real colour string to paint its halo out of sight — see
// the accuracy mark in resultsHtml.
const PANEL = "#14211D";

const QUALITY = [["research","Research"],["needs_id","Needs ID"],["casual","Casual"]];
const PRECISION = [["","Any"],["precise","Exact only"]];
const STYLES  = [["auto","Auto"],["points","Points"],["grid","Grid"],["heat","Heat"],["accuracy","Accuracy"]];
const BASES   = [["light", "Light"], ["dark","Dark"],["sat","Satellite"]];

// Two levels past every layer's tightest native ceiling (satellite's 19) — past that point
// every layer is upscaling anyway, so there's nothing left to gain by going further.
const MAX_ZOOM = 21;

// No default lower bound: the app asks about "recently" through the month chips
// (see defaultMonths), not through a date that quietly narrows every year to one.
function defaultD1(){ return ""; }

// The two months chips lit on a fresh load: this one and the one before it, so "recently"
// reads as a season out of the box rather than as an empty date field. Sorted ascending —
// monthsLabel/monthRunStart tell a run apart by set membership, not by array order, so
// December-into-January still reads as a run even though 12 sorts after 1.
function defaultMonths(){
  const now = new Date().getMonth() + 1;         // 1–12
  const prev = now === 1 ? 12 : now - 1;
  return [prev, now].sort((a, b) => a - b);
}
// Fallback centre when the browser won't give us a position.
const LISBON = [38.7223, -9.1393];

function defaultIconic(){ return ICONIC.map(([v]) => v).filter(v => v !== "Insecta"); }
function isDefaultIconic(){
  const d = defaultIconic();
  return state.iconic.length === d.length && d.every(v => state.iconic.includes(v));
}
function defaultQuality(){ return ["research","needs_id"]; }
function isDefaultQuality(){
  const d = defaultQuality();
  return state.quality.length === d.length && d.every(v => state.quality.includes(v));
}

// Months of the year, 1–12, as chosen in the filter sheet — a season rather than a stretch of
// time. Empty is every month, and writes nothing anywhere.
function readMonths(raw){
  const seen = new Set();
  String(raw == null ? "" : raw).split(",").forEach(v => {
    if(!/^\d{1,2}$/.test(v)) return;          // "3.5", "foo", "" — none of them a month
    const n = +v;
    if(n >= 1 && n <= 12) seen.add(n);
  });
  // Sorted and de-duplicated on the way in, so "8,3,3" and "3,8" are one address rather than
  // two spellings of the same question.
  return [...seen].sort((a, b) => a - b);
}

const state = {
  taxon:null, tname:"", iconic:defaultIconic(), quality:defaultQuality(),
  d1:defaultD1(), d2:"", months:defaultMonths(),
  // Whether that d1 is still the app's own (empty) default or something asked for — see
  // windowD1.
  d1auto:true,
  style:"accuracy", base:"light", unobs:"", precise:"precise",
  // dmode: "unobserved" | "s" | "b" | "c" | "own". The mode row toggles, so pressing the
  // mode already set turns it off — "own" is that no-button-pressed state, and it asks the
  // opposite question: not what this user is missing but what they have already recorded.
  dmode:"unobserved", tierExclude:null, cursor:"precise", ssp:""   // "" | "1" incl. | "only"
};

let map, overlay, accLayer, probeAccLayer, probeMark, probeRing, meRing, meCone, sheetView = null;

/* ---------------- query building ---------------- */

/* The lower end of the window, as the query should see it — and the one place the month
   filter and the date range are reconciled.

   They ask different questions. The window is a stretch of time, asked for on purpose or not
   at all — there is no default date. The months are a season: what is here in March, in any
   year, or here in Jul–Aug by default (see defaultMonths). With no default date to collide
   with a chosen season, the two only interact when a date was actually typed into either
   field, or carried in on a link — a deliberate one and stands: "March, between 2015 and
   2020" is a real question and this is the only way to ask it. The label prints whichever is
   in force (see renderLabel), so an empty map always says why.

   Telling an asked-for date apart from the still-empty default is what state.d1auto is for,
   and why an untouched d1 never rides in the hash: writeHash omits it while it is the app's
   own (empty) default, readHash hands back the same empty default, and so the address carries
   a date only when a date was meant. */
function windowD1(){
  return state.months.length && state.d1auto ? "" : state.d1;
}

function obsParams(){
  const p = new URLSearchParams();
  if(state.taxon)   p.set("taxon_id", state.taxon);
  if(state.iconic.length) p.set("iconic_taxa", state.iconic.join(","));
  if(state.unobs){
    if(state.dmode === "own"){
      // No mode pressed: the field stops asking what this user is missing and simply shows
      // what they have. Every other exclusion below belongs to the desired-species question
      // and would fight this one — `not_user_id` most of all, which would empty the map.
      // The rank window goes too: it exists to stop a subspecies of an already-recorded
      // species reading as desired, and nothing here is being called desired.
      p.set("user_id", state.unobs);
    }else{
      if(state.dmode === "unobserved"){
        p.set("unobserved_by_user_id", state.unobs);
      }else if(state.tierExclude && state.tierExclude.length){
        // Level mode: hide species this user has already tagged at a better level.
        p.set("without_taxon_id", state.tierExclude.join(","));
      }
      // Rank window on the results, driven by the two tickboxes. Unticked, the list is
      // floored at species: iNat treats a subspecies as its own leaf taxon, so without this
      // a ssp. of an already-recorded species still reads as "desired" (genus-and-coarser
      // IDs stay; only subspecies/variety/form go). "Include subspecies" drops the floor;
      // "Only subspecies" swaps it for a ceiling, leaving nothing but infraspecific taxa.
      if(state.ssp === "only") p.set("hrank", "subspecies");
      else if(!state.ssp)      p.set("lrank", "species");
      // Level tiers (s/b/c) ask what this user still hasn't found at species level, so
      // anything coarser than species — genus, family, order, and so on — shouldn't read as
      // desired there either. "Only subspecies" already sits inside that window (its ceiling
      // is finer than species), so it's left alone. Unobserved gets no such ceiling: a
      // genus-level record can still be the first sign of something this user hasn't seen,
      // so it stays visible there.
      if(isTierMode() && state.ssp !== "only") p.set("hrank", "species");
      // Never show them their own shots. Redundant under Unobserved — a species they have
      // recorded is already gone whole — but in a level mode their untagged species are on
      // the map, and those pins lead back to ground they have already walked.
      p.set("not_user_id", state.unobs);
    }
  }
  if(state.quality.length) p.set("quality_grade", state.quality.join(","));
  if(state.precise){ p.set("geoprivacy", "open"); p.set("taxon_geoprivacy", "open"); }
  const d1 = windowD1();
  if(d1)            p.set("d1", d1);
  if(state.d2)      p.set("d2", state.d2);
  // Months of the year, matched on the observed date — a slice of the calendar rather than a
  // shorter stretch of it, so it narrows every year at once instead of the last one.
  if(state.months.length) p.set("month", state.months.join(","));
  return p;
}

// Unobserved mode's rank window (above) floors results at species so a subspecies can be
// compared against its parent's rank — but a genuinely unidentified observation has no
// taxon at all, so it never clears that floor and silently never shows, even though
// "nothing identified yet" is the plainest case of something not yet observed. This mirrors
// obsParams()'s other filters for that one case: quality, date range, month and precision
// still apply — an unidentified record still has a date, so the season it was found in is as
// readable as anything else about it — and the target user's own uploads are still excluded,
// but nothing taxon-shaped (taxon_id, iconic_taxa, the rank window itself) can match a record
// that has no taxon.
function unknownParams(){
  const p = new URLSearchParams();
  p.set("identified", "false");
  if(state.unobs) p.set("not_user_id", state.unobs);
  if(state.quality.length) p.set("quality_grade", state.quality.join(","));
  if(state.precise){ p.set("geoprivacy", "open"); p.set("taxon_geoprivacy", "open"); }
  const d1 = windowD1();
  if(d1)            p.set("d1", d1);
  // Three days' grace before a record counts as genuinely unknown, rather than just not
  // yet looked at — the community needs time to weigh in first. Both dates matter here and
  // separately: d2 is when it happened, created_d2 is when it landed on iNat. This tightens
  // each window's end but never loosens it.
  const stale = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  p.set("d2", state.d2 && state.d2 < stale ? state.d2 : stale);
  p.set("created_d2", stale);
  if(state.months.length) p.set("month", state.months.join(","));
  return p;
}

// Desired-species levels, best first — each value is both the button's mode and the
// observation tag it matches. The priority stacks: picking a level hides species already
// tagged at a *better* level, so the exclusion set for level i is tags 0..i-1 — the level
// itself, and anything worse, stays on the map.
// Note the top tier is "s", not "a": iNat's search index treats "a" as an English
// stopword and silently drops it (search_on=tags&q=a matches nothing, site-wide).
const LEVELS = ["s","b","c"];

// Every mode the row can be in, including the one no button shows: "own", where nothing is
// pressed. Only a level mode costs a request, so this is what the callers that re-derive
// the exclusion set ask about.
const DMODES = ["own","unobserved",...LEVELS];
function isTierMode(){ return LEVELS.includes(state.dmode); }

// The mode row in the order it is drawn, widest question first. The modes nest: a level
// hides only what is tagged at that level or better, so S's map contains B's, which
// contains C's, which contains everything Unobserved would show. Lighting the whole tail
// says so — press S and all four light, press Unobserved and only it does. Nothing but
// state.dmode (the head of the tail) is ever queried; this is display only.
const MODE_ROW = [...LEVELS, "unobserved"];
function modeLit(mode){
  const head = MODE_ROW.indexOf(state.dmode);   // -1 in "own" mode: nothing lit
  return head !== -1 && MODE_ROW.indexOf(mode) >= head;
}

// Scope a species_counts query to one user plus the panel's taxon / quick-group filters.
function userScope(user){
  const o = { user_id: user };
  if(state.taxon) o.taxon_id = state.taxon;
  if(state.iconic.length) o.iconic_taxa = state.iconic.join(",");
  return o;
}

// The species carrying one tier's tag. One request per tag: the tags index matches a
// single term, so "s b" ORs nothing.
//
// The empty `verifiable` sends no `verifiable` at all, which is what this lookup has always
// done — shared, speciesCounts would otherwise default it to true and quietly drop a tag
// sitting on a casual record, putting that species back on the map as still wanted. The
// species report answers the same question with "any" rather than with silence; the two are
// worth reconciling one day, but not inside a move that is supposed to change nothing.
async function speciesIdsWithTag(user, tag, stale){
  const rows = await speciesCounts(
    { ...userScope(user), search_on:"tags", q:tag, verifiable:"" }, stale);
  return new Set(rows.map(x => x.taxon.id));
}

// The species a user has tagged at a level better than `level`. The tiers stack, so
// level i means tags 0..i-1.
//
// Only tags count here. A species recorded by sound alone carries no tag, so it stays on
// the map at every level — which is the point: no photograph of it exists yet, so it is
// still worth going after however the level row is set. The species report gives those
// their own band, but that is a way of reading a list, not a claim that the bird is done.
async function taggedSpeciesIds(user, level, stale){
  const ids = new Set();                     // a species may be tagged at several tiers
  for(const tag of LEVELS.slice(0, LEVELS.indexOf(level))){
    const tier = await speciesIdsWithTag(user, tag, stale);
    if(stale && stale()) return ids;
    tier.forEach(id => ids.add(id));
  }
  return ids;
}

// Cache the ids of species the "Desired species for" user has already tagged at the
// selected level or better, so obsParams can drop them via without_taxon_id. Clears the
// cache (no-op) for Unobserved and own-records mode, or when no user is set.
let tierSeq = 0;
async function syncTierExclude(){
  if(!isTierMode() || !state.unobs){ state.tierExclude = null; return; }
  const mine = ++tierSeq;
  const stale = () => mine !== tierSeq;       // a newer sync superseded this one
  try{
    const ids = await taggedSpeciesIds(state.unobs, state.dmode, stale);
    if(stale()) return;
    state.tierExclude = [...ids];
  }catch(e){
    if(stale()) return;
    state.tierExclude = [];                   // fail open: exclude nothing on error
  }
}

function activeStyle(){
  if(state.style === "heat")   return "colored_heatmap";
  if(state.style === "points") return "points";
  if(state.style === "grid")   return "grid";
  return map.getZoom() < 10 ? "grid" : "points";
}

function tileUrl(){
  const style = activeStyle();
  const p = obsParams();
  if(style === "points" || style === "grid") p.set("color", MARK);
  const qs = p.toString();
  return `${API}/${style}/{z}/{x}/{y}.png` + (qs ? "?" + qs : "");
}

function refreshOverlay(){
  const url = tileUrl();
  if(overlay._url !== url) overlay.setUrl(url);
}

/* ---------------- pins: loading indicator ---------------- */

// A count, not a flag, because two different things raise it — the tile overlay's own
// image requests (wired to it in init, below) and the accuracy layer's apiGet round
// trip in refreshAccuracyLayer — and the two can overlap, a debounced pan landing
// mid-fetch. The icon stays up until every request that raised it has come back down,
// not just the last one to try.
const loading = document.getElementById("loading");
let pinRequests = 0;
function pinsBusy(on){
  pinRequests = Math.max(0, pinRequests + (on ? 1 : -1));
  loading.hidden = pinRequests === 0;
}

/* ---------------- audio-only observations ---------------- */

// A sound recording with no photo. Both the map pins and the tap results swap their
// usual dot for a speaker so these read as listen-not-look records at a glance.
function isAudioOnly(o){
  return (o.sounds || []).length > 0 && !(o.photos || []).length;
}

// fill paints the cone, ring the outline and waves — pass the same colour for a flat
// monochrome icon (the results list), or contrasting ones for a map pin.
function speakerSvg(fill, ring){
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 9.5H6.7L11.5 6V18L6.7 14.5H3.5Z"
          fill="${fill}" stroke="${ring}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M14.6 9.6a4.2 4.2 0 010 4.8M17.6 7.6a8 8 0 010 8.8"
          fill="none" stroke="${ring}" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`;
}

/* ---------------- iconic taxon pin art ---------------- */

// One glyph per iconic taxon, drawn in a 24×24 box, so a pin says what kind of thing was
// found before you read the tooltip. Three roles, because the pin still has to carry the
// accuracy colour and stay legible over any base layer:
//   body — filled silhouette, painted in the accuracy colour
//   limb — strokes sitting behind the body (legs, wings, a tail), same colour
//   vein — interior lines (a midrib, a hinge), painted in the outline colour on top
//   dot  — interior marks (an eye, a pupil), same colour, filled rather than stroked
// Body and limb are each drawn twice: fattened in the outline colour as a halo, then in
// the accuracy colour on top. Overlapping subpaths therefore fuse into one silhouette with
// no seams, which is why a glyph can be built from plain circles and ellipses.
// Anything without its own glyph (Chromista, Protozoa, and whatever iNat adds next) falls
// back to Animalia's dot — the plain circle these pins have always been.
const TAXON_ART = {
  Plantae:        { body: ["M18.6 5.4C18.6 13.4 13.9 18.6 5.4 18.6 5.4 10.6 10.1 5.4 18.6 5.4Z"],
                    vein: ["M7.2 16.8L16.8 7.2"] },
  // a gull: two strokes, nothing else
  Aves:           { limb: ["M3.6 15.4C6.2 8.6 9.8 9 12 14.2 14.2 9 17.8 8.6 20.4 15.4"], w: 2.4 },
  // head and two ears, drawn as one outline
  Mammalia:       { body: ["M12 19.4C8.3 19.4 5.9 16.7 5.9 13.2 5.9 11.8 6.1 10.5 6.5 9.4L5.3 4.3 10.2 6.9C10.8 6.7 11.4 6.6 12 6.6 12.6 6.6 13.2 6.7 13.8 6.9L18.7 4.3 17.5 9.4C17.9 10.5 18.1 11.8 18.1 13.2 18.1 16.7 15.7 19.4 12 19.4Z"] },
  // a snake: one wriggling stroke, thickened to a head at the leading end. Legs were tried
  // and abandoned — four of them on a 22px pin read as a stick figure, not a lizard.
  Reptilia:       { limb: ["M3.4 20.2C7.2 20.2 6.6 14.2 10.4 14.2 14.2 14.2 13.6 8.2 17.2 8.2"],
                    body: ["M16 8.2A2.6 2 0 1 0 21.2 8.2A2.6 2 0 1 0 16 8.2Z"],
                    dot:  ["M18.9 7.2A0.75 0.75 0 1 0 20.4 7.2A0.75 0.75 0 1 0 18.9 7.2Z"],
                    w: 2.3 },
  // a frog head-on: dome plus two eyes
  Amphibia:       { body: ["M4.6 17.8C4.6 12.8 7.9 9.6 12 9.6 16.1 9.6 19.4 12.8 19.4 17.8Z",
                           "M5.5 9.4A2.9 2.9 0 1 0 11.3 9.4A2.9 2.9 0 1 0 5.5 9.4Z",
                           "M12.7 9.4A2.9 2.9 0 1 0 18.5 9.4A2.9 2.9 0 1 0 12.7 9.4Z"],
                    dot:  ["M7.4 9.4A1 1 0 1 0 9.4 9.4A1 1 0 1 0 7.4 9.4Z",
                           "M14.6 9.4A1 1 0 1 0 16.6 9.4A1 1 0 1 0 14.6 9.4Z"] },
  // an infinity laid on its side: round body loop, tail folded to a sharp point
  Actinopterygii: { body: ["M15 12C12 6.4 4.2 6.6 3.4 12 4.2 17.4 12 17.6 15 12L20.6 7.2 20.6 16.8Z"],
                    dot:  ["M5.9 10.6A1.1 1.1 0 1 0 8.1 10.6A1.1 1.1 0 1 0 5.9 10.6Z"] },
  // a bivalve: fan from the hinge, ears either side of it, and five scallops on the rim.
  // The scalloped rim is the whole tell — interior ribs only muddy it at pin size.
  Mollusca:       { body: ["M12 19.6L7.8 18.6 9.2 16.4 3.8 9.4A2.4 2.4 0 0 1 6.8 7.5A2.4 2.4 0 0 1 10.2 6.5A2.4 2.4 0 0 1 13.8 6.5A2.4 2.4 0 0 1 17.2 7.5A2.4 2.4 0 0 1 20.2 9.4L14.8 16.4 16.2 18.6Z"] },
  // the web, not the animal: eight radials over two rings, the radials poking out past the
  // outer ring as anchor threads. Any spider small enough for a pin is a blob with a fringe,
  // which is the insect's mark too, so the web carries the meaning instead. Threads have to
  // stay thin — the halo behind each one is 2.4 wider than the thread itself, so anything
  // heavier than about 1.5 closes the cells and the whole web fills in solid.
  Arachnida:      { limb: ["M21.4 12L2.6 12M18.6 18.6L5.4 5.4M12 21.4L12 2.6M5.4 18.6L18.6 5.4",
                           "M16.6 12L15.3 15.3L12 16.6L8.7 15.3L7.4 12L8.7 8.7L12 7.4L15.3 8.7Z",
                           "M20.6 12L18.1 18.1L12 20.6L5.9 18.1L3.4 12L5.9 5.9L12 3.4L18.1 5.9Z"],
                    w: 1.4 },
  // one blob and six legs, a beetle from above. Both of the fancier tries lost at 22px: a
  // separate thorax and abdomen merged into one lump anyway, and antennae read as a fourth
  // pair of legs.
  Insecta:        { body: ["M8.6 12A3.4 4.8 0 1 0 15.4 12A3.4 4.8 0 1 0 8.6 12Z"],
                    limb: ["M9.6 8.6L5.8 4.2M8.7 11.6L2.9 10.4M9.4 15.2L5.2 19.2",
                           "M14.4 8.6L18.2 4.2M15.3 11.6L21.1 10.4M14.6 15.2L18.8 19.2"],
                    w: 1.7 },
  // a crab, for the arthropods iNat leaves iconically homeless (see pinKind): carapace,
  // two raised claws, three legs a side. Crustaceans are the bulk of them and the claws are
  // the one arthropod silhouette that still reads at 22px — a millipede at this size is a
  // smudge with a fringe. Claw arms are limbs so they tuck behind the carapace; the pincers
  // themselves are body, or they'd taper away to nothing.
  Arthropoda:     { body: ["M6.2 14.6A5.8 3.4 0 1 0 17.8 14.6A5.8 3.4 0 1 0 6.2 14.6Z",
                           "M3.5 6.2A2.1 1.9 0 1 0 7.7 6.2A2.1 1.9 0 1 0 3.5 6.2Z",
                           "M16.3 6.2A2.1 1.9 0 1 0 20.5 6.2A2.1 1.9 0 1 0 16.3 6.2Z"],
                    limb: ["M8.8 12.2L6.6 8.2M7.6 13.4L3.0 12.4M7.0 15.4L2.8 16.2M8.2 17.0L5.6 20.0M15.2 12.2L17.4 8.2M16.4 13.4L21.0 12.4M17.0 15.4L21.2 16.2M15.8 17.0L18.4 20.0"],
                    vein: ["M3.7 4.9L6.0 6.3M20.3 4.9L18.0 6.3"],
                    dot:  ["M9.6 13.4A0.8 0.8 0 1 0 11.2 13.4A0.8 0.8 0 1 0 9.6 13.4Z",
                           "M12.8 13.4A0.8 0.8 0 1 0 14.4 13.4A0.8 0.8 0 1 0 12.8 13.4Z"],
                    w: 1.7 },
  // a T with the crossbar hollowed out from below
  Fungi:          { body: ["M3.6 12.8C3.6 8 7.4 4.8 12 4.8 16.6 4.8 20.4 8 20.4 12.8C17.6 11.4 14.8 10.8 12 10.8 9.2 10.8 6.4 11.4 3.6 12.8Z",
                           "M10.2 10.6L13.8 10.6 13.8 17.1C13.8 18.4 13 19.3 12 19.3 11 19.3 10.2 18.4 10.2 17.1Z"] },
  Animalia:       { body: ["M5.8 12A6.2 6.2 0 1 0 18.2 12A6.2 6.2 0 1 0 5.8 12Z"] },
  // nothing identified yet
  unknown:        { body: ["M10.6 17.6A1.4 1.4 0 1 0 13.4 17.6A1.4 1.4 0 1 0 10.6 17.6Z"],
                    limb: ["M8.3 9C8.3 6.5 9.9 5 12.1 5 14.4 5 15.9 6.4 15.9 8.4 15.9 11.3 12 11.8 12 14.7"],
                    w: 2.4 }
};

// Which glyph a pin takes. Almost always just the observation's iconic taxon, with one
// repair: iNat has no iconic taxon for the arthropods that are neither insects nor
// arachnids, so crabs, prawns, woodlice, barnacles, centipedes and springtails all arrive
// as bare Animalia and used to draw as the plain circle — the same mark as a jellyfish or a
// worm. Their ancestry still says Arthropoda, which is all it takes to give them their own.
// Insects and arachnids never reach this branch: their iconic name is their own, so they
// keep their own glyphs.
const ARTHROPODA = 47120;
function pinKind(t){
  const kind = t.iconic_taxon_name || "unknown";
  if(kind !== "Animalia") return kind;
  return (t.ancestor_ids || []).includes(ARTHROPODA) ? "Arthropoda" : kind;
}

// halo must be opaque: its strokes overlap, and a translucent one would seam where they do.
function taxonSvg(kind, fill, halo){
  const art = TAXON_ART[kind] || TAXON_ART.Animalia;
  const w = art.w || 1.9;
  const draw = list => (list || []).map(d => `<path d="${d}"/>`).join("");
  const body = draw(art.body), limb = draw(art.limb), vein = draw(art.vein), dot = draw(art.dot);
  const ends = `stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    ${limb ? `<g fill="none" stroke="${halo}" stroke-width="${(w + 2.4).toFixed(1)}" ${ends}>${limb}</g>` : ""}
    ${body ? `<g fill="${halo}" stroke="${halo}" stroke-width="2.8" ${ends}>${body}</g>` : ""}
    ${limb ? `<g fill="none" stroke="${fill}" stroke-width="${w}" ${ends}>${limb}</g>` : ""}
    ${body ? `<g fill="${fill}">${body}</g>` : ""}
    ${vein ? `<g fill="none" stroke="${halo}" stroke-width="1.4" ${ends}>${vein}</g>` : ""}
    ${dot  ? `<g fill="${halo}">${dot}</g>` : ""}
  </svg>`;
}

/* ---------------- accuracy color scale ---------------- */

const ACC_STOPS = [        // [meters, hex] — log-scale interpolated between stops
  [0,    "#FF2D2D"],
  [1,    "#FF2D2D"],
  [10,   "#FF8C00"],
  [50,   "#FFD400"],
  [150,  "#7ED321"],
  [400,  "#2D9CFF"],
  [1000, "#6A2DFF"]
];
const ACC_MAX_COLOR    = "#160026";  // beyond 1km, deepening toward black/purple
const ACC_UNKNOWN_FILL = "#FFFFFF";
const ACC_UNKNOWN_RING = "#101613";

function hexToRgb(hex){
  const n = hex.replace("#","");
  return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)];
}
function rgbToHex(r,g,b){
  return "#" + [r,g,b].map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
}
function lerpColor(a,b,t){
  const [r1,g1,b1] = hexToRgb(a), [r2,g2,b2] = hexToRgb(b);
  return rgbToHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
}

function accuracyColor(m){
  const last = ACC_STOPS[ACC_STOPS.length - 1];
  if(m >= last[0]){
    const t = Math.min(1, Math.log(m / last[0]) / Math.log(5));
    return lerpColor(last[1], ACC_MAX_COLOR, t);
  }
  for(let i=0;i<ACC_STOPS.length-1;i++){
    const [m0,c0] = ACC_STOPS[i], [m1,c1] = ACC_STOPS[i+1];
    if(m <= m1){
      const lo = Math.max(m0, 0.1), hi = Math.max(m1, 0.2);
      const mm = Math.max(m, lo);
      const t = Math.min(1, Math.max(0, (Math.log(mm) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
      return lerpColor(c0, c1, t);
    }
  }
  return last[1];
}

function legendGradientCss(){
  const stops = ACC_STOPS.map(s => s[1]).concat([ACC_MAX_COLOR]);
  const n = stops.length - 1;
  return "linear-gradient(to right, " + stops.map((c,i) => `${c} ${(i/n*100).toFixed(1)}%`).join(", ") + ")";
}

function fmtAcc(m){
  if(m == null || !isFinite(m)) return "? M";
  const r = Math.round(m);
  if(r < 1000) return r + " m";
  return (r/1000).toFixed(1) + " km";
}

/* ---------------- basemaps ---------------- */

const OSM_ATTR = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const INAT_ATTR = 'Observations &copy; <a href="https://www.inaturalist.org">iNaturalist</a>';

// Every layer's real tiles stop at 19 or 20; `maxNativeZoom` holds each at its true ceiling
// while `maxZoom` lets the map itself go two levels past the tightest of them (see
// MAX_ZOOM), Leaflet upscaling the last native tile rather than fetching nothing. A closely
// packed cluster of pins is the case this is for — there is nothing further to fetch, but
// there is still something to gain from a bigger picture of what's already on screen.
function makeBase(kind){
  if(kind === "sat"){
    return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxNativeZoom:19, maxZoom:MAX_ZOOM, attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics &middot; ' + INAT_ATTR });
  }
  const slug = kind === "light" ? "light_all" : "dark_all";
  return L.tileLayer(`https://{s}.basemaps.cartocdn.com/${slug}/{z}/{x}/{y}{r}.png`,
    { maxNativeZoom:20, maxZoom:MAX_ZOOM, subdomains:"abcd", attribution: OSM_ATTR + " &middot; " + INAT_ATTR });
}

let baseLayer;
function setBase(kind){
  state.base = kind;
  if(baseLayer) map.removeLayer(baseLayer);
  baseLayer = makeBase(kind).addTo(map);
  baseLayer.bringToBack();
}

/* ---------------- url hash ---------------- */

function writeHash(){
  const c = map.getCenter();
  const p = new URLSearchParams();
  p.set("z", map.getZoom());
  p.set("lat", c.lat.toFixed(5));
  p.set("lng", c.lng.toFixed(5));
  if(state.taxon){ p.set("taxon", state.taxon); if(state.tname) p.set("tname", state.tname); }
  if(state.iconic.length) p.set("iconic", state.iconic.join(","));
  if(state.unobs)   p.set("unobs", state.unobs);
  if(state.dmode !== "unobserved") p.set("dmode", state.dmode);
  if(state.ssp)     p.set("ssp", state.ssp);
  p.set("q", state.quality.join(","));
  p.set("precise", state.precise);
  // Only a date that was meant — see windowD1. Left out, readHash hands back the same empty
  // default, which is what an untouched window has always meant.
  if(!state.d1auto) p.set("d1", state.d1);
  if(state.d2)      p.set("d2", state.d2);
  if(state.months.length) p.set("m", state.months.join(","));
  if(state.style !== "accuracy") p.set("s", state.style);
  if(state.base !== "light")  p.set("b", state.base);
  if(state.cursor !== "precise") p.set("cur", state.cursor);
  // The dropped pin, so a trip out to species.html and back off the `back` link (which is
  // just this hash, ferried along — see tierReportUrl/hereUrl) lands with the pin still down
  // instead of asking the reader to tap the map again for ground they already picked.
  const pin = pinScope();
  if(pin){
    p.set("plat", pin.lat.toFixed(6));
    p.set("plng", pin.lng.toFixed(6));
    p.set("pr",   pin.km.toFixed(3));
  }
  const h = p.toString();
  history.replaceState(null, "", "#" + h);
  rememberHash(h);
}

function readHash(){
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  state.taxon   = p.get("taxon") || null;
  state.tname   = p.get("tname") || "";
  state.iconic  = p.has("iconic") ? p.get("iconic").split(",").filter(Boolean) : defaultIconic();
  state.unobs   = p.get("unobs") || "";
  // "own" rides in the hash like any other mode — an empty value would read back as the
  // default and quietly put a filter on a shared link that was made without one.
  state.dmode   = DMODES.includes(p.get("dmode")) ? p.get("dmode") : "unobserved";
  state.ssp     = ["1","only"].includes(p.get("ssp")) ? p.get("ssp") : "";
  state.quality = p.has("q") ? p.get("q").split(",").filter(Boolean) : defaultQuality();
  state.precise = p.has("precise") ? p.get("precise") : "precise";
  // A date in the address was asked for by somebody, whoever made the link; no date is the
  // app's own (empty) default. An empty `d1=` counts as asked for too — it is the field
  // cleared on purpose, which is "no lower bound at all".
  state.d1auto  = !p.has("d1");
  state.d1      = state.d1auto ? defaultD1() : p.get("d1");
  state.d2      = p.get("d2") || "";
  state.months  = p.has("m") ? readMonths(p.get("m")) : defaultMonths();
  state.style   = p.get("s") || "accuracy";
  state.base    = p.get("b") || "light";
  state.cursor  = p.get("cur") || "precise";
  const pinned = p.has("lat") && p.has("lng");
  // The dropped pin (probeMark/probeRing), distinct from the viewport centre above — see the
  // note in writeHash. All three or none: a partial write never happens, but a hand-edited
  // link might drop one, and that is worth treating as no pin rather than a broken one.
  const droppedPin = (p.has("plat") && p.has("plng") && p.has("pr"))
    ? { lat: +p.get("plat"), lng: +p.get("plng"), km: +p.get("pr") }
    : null;
  return {
    z:   p.has("z")   ? +p.get("z")   : ACC_MIN_ZOOM,   // start where accuracy pins load
    zPinned: p.has("z"),                                // an explicit z is the user's, leave it be
    lat: pinned ? +p.get("lat") : LISBON[0],
    lng: pinned ? +p.get("lng") : LISBON[1],
    pinned,                                             // a shared link — don't auto-locate over it
    droppedPin
  };
}

/* ---------------- specimen label ---------------- */

function fmtYear(d){ return d ? d.slice(0,4) : ""; }

// Where a selection of months begins, when it is one unbroken run — the month whose
// predecessor is not also chosen. Exactly one such month means a run; two or more mean a
// scatter. The predecessor of January is December, so a run reads across the year end and
// Nov–Feb (11,12,1,2) is a run rather than two: a winter is one season however the calendar
// is numbered. All twelve have no start at all, every month having a chosen predecessor.
function monthRunStart(months){
  const starts = months.filter(m => !months.includes(m === 1 ? 12 : m - 1));
  return starts.length === 1 ? starts[0] : null;
}

// Months as a season rather than a list: one is its own name, an unbroken run is a span, and
// anything else is a count — a label is a line of small caps a few words wide, and
// "Jan / Mar / Jun / Sep / Nov" is not something it can hold. Whoever prints this hangs the
// months themselves on the tooltip, so the count is never the only reading available.
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

// The label's words, before they are a label — each bit a phrase of HTML, in reading order.
// Split out because the saved-views block offers one of these as the default name for a view
// (see defaultViewName): describing a view in a few words is this function's whole job, and
// there is no sense in a second, quietly different, set of words for the same map.
function labelBits(){
  const bits = [];
  if(state.taxon){
    bits.push(`<span class="sci">${esc(state.tname || "Taxon " + state.taxon)}</span>`);
  } else if(state.iconic.length && !isDefaultIconic()){
    bits.push(state.iconic.length === ICONIC.length ? "Everything" : state.iconic.map(v => {
      const hit = ICONIC.find(i => i[0] === v);
      return esc(hit ? hit[1] : v);
    }).join(" + "));
  }
  // Grade and precision are only worth the width when they stray from the defaults.
  if(state.quality.length && !isDefaultQuality()){
    const names = state.quality.map(v => {
      const hit = QUALITY.find(q => q[0] === v);
      return esc(hit ? hit[1] : v);
    });
    bits.push(names.join(" + ") + " grade");
  }
  if(state.unobs){
    if(state.dmode === "own") bits.push("@" + esc(state.unobs) + "&#39;s own records");
    else if(state.dmode === "unobserved") bits.push("new for @" + esc(state.unobs));
    else bits.push("@" + esc(state.unobs) + " missing tier " + esc(state.dmode.toUpperCase()));
    // The rank window only applies to the desired-species modes, so it is only named there.
    if(state.dmode !== "own"){
      if(state.ssp === "only") bits.push("subspecies only");
      else if(state.ssp)       bits.push("incl. subspecies");
    }
  }
  if(!state.precise) bits.push("incl. obscured");
  // Season and window, in that order and both named: they are two filters, and where both are
  // in force the reader is looking at their intersection — which can easily be empty, and has
  // to be readable as such rather than as a map that stopped working. The window is the one
  // that may have stood aside (see windowD1), so it is printed as the query will run it: with
  // months chosen and no date asked for, there is no year range to print and the season is
  // being read across every year there is.
  if(state.months.length){
    bits.push(`<span title="${esc(state.months.map(m => MONTH_NAMES[m-1]).join(", "))}">${
      esc(monthsLabel(state.months))}</span>`);
  }
  const d1 = windowD1();
  if(d1 || state.d2){
    bits.push(esc(fmtYear(d1) + " – " + (fmtYear(state.d2) || "now")));
  }
  return bits;
}

function renderLabel(){
  const bits = labelBits();
  document.getElementById("labelText").innerHTML =
    bits.length ? bits.join('<span class="sep">/</span>')
                : '<span class="dim">All observations</span>';
}

/* ---------------- sheet plumbing ---------------- */

const sheet = document.getElementById("sheet");
const sheetBody = document.getElementById("sheetBody");

function openSheet(view, html){
  sheetView = view;
  sheetBody.innerHTML = html;
  document.body.dataset.sheet = view;
  syncSheetBox();            // after the view, which sets the results panel's floor, not before
  sheet.dataset.open = "1";
  setStow(false);            // a panel just filled is a panel to read, whatever the last one did
  sheetBody.scrollTop = 0;
}
function closeSheet(){
  sheet.dataset.open = "0";
  delete document.body.dataset.sheet;
  setStow(false);
  sheetView = null;
  if(probeMark){ map.removeLayer(probeMark); probeMark = null; }
  if(probeRing){ map.removeLayer(probeRing); probeRing = null; }
  if(probeAccLayer) probeAccLayer.clearLayers();
  writeHash();   // the pin just came off the map; take it out of the address too
}
document.getElementById("handle").addEventListener("click", closeSheet);

document.addEventListener("keydown", e => {
  if(e.key === "Escape" && sheetView === "results" && sheet.dataset.open === "1") closeSheet();
});

// Stowing is not closing: nothing is cleared and nothing is refetched. The panel slides off
// the side with its list intact and the probe still drawn on the map underneath, which is the
// point — the pin, its radius and the accuracy circles are what you stowed the list to see.
// The flag lives on the body because the button that flips it hangs beside the panel rather
// than inside it, so both have to read it. See the stow block in index.css.
//
// That button wears the panel's top-left corner without being in the panel, so it needs told
// where the corner is. offsetLeft/offsetTop and not getBoundingClientRect: the offsets are
// the box the panel was laid out in and a transform doesn't touch them, which is the whole
// trick — the panel slides away from a corner that stays where it was. The observer watches
// the body too, since a window widened without changing the panel's height still moves it.
function syncSheetBox(){
  document.body.style.setProperty("--sheet-x", sheet.offsetLeft + "px");
  document.body.style.setProperty("--sheet-y", sheet.offsetTop + "px");
}
{ const ro = new ResizeObserver(syncSheetBox);
  ro.observe(sheet);
  ro.observe(document.body);
}

const stowBtn = document.getElementById("stow");
function setStow(on){
  document.body.dataset.stow = on ? "1" : "0";
  stowBtn.setAttribute("aria-expanded", on ? "false" : "true");
  stowBtn.setAttribute("aria-label", on ? "Show the list again" : "Collapse the list");
}
stowBtn.addEventListener("click", () => setStow(document.body.dataset.stow !== "1"));

/* ---------------- outbound links ---------------- */

// Added to the home screen, this runs with no tab bar and no back button, and `_blank` has
// nowhere to put a second view but on top of the first one — chromeless, and with no way
// to dismiss it. When the address is one iNaturalist claims, iOS then hands off to their
// native app and that borrowed view is simply abandoned: the white page you come back to.
//
// Navigating the view we already have avoids making one. A claimed link is intercepted
// before it commits, so the native app opens and this app is left untouched behind it; an
// unclaimed one loads in place, where the edge-swipe still goes back. Only the home-screen
// case changes — in a real browser tab `_blank` behaves, so it keeps its new tab.
const STANDALONE = window.navigator.standalone === true ||
  (window.matchMedia && matchMedia("(display-mode: standalone)").matches);

function openOut(url){
  if(STANDALONE){ location.href = url; return true; }
  return !!window.open(url, "_blank", "noopener");
}

// The same two cases as openOut, decided in markup instead of in script — a real link, so
// that a tap is a tap. iOS only hands a claimed address to the native app when the reader
// activates a link; an address set from script is a navigation like any other and Safari
// keeps it, which is the difference between the app opening and a web page loading first.
// Worth it wherever a claimed address is on the other end.
function outAttrs(url){
  return `href="${esc(url)}"` + (STANDALONE ? "" : ` target="_blank" rel="noopener"`);
}

// Marks a results-row action as a hop off the map — On iNat, Missed, GMaps — so the reader
// knows before tapping that it leaves this page rather than opening one of the app's own
// views (Species here stays plain). Drawn in currentColor so it always matches the link.
function extIcon(){
  return `<svg class="ext-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-4"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M13 3h8v8M21 3L11 13"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* ---------------- the home screen's own memory ----------------

   The hash is this app's whole state, and on the home screen the address is not the reader's
   to keep: iOS bakes the URL into the shortcut the day it is made and launches that same one
   verbatim ever after, whatever the app did to it in between. So a filter changed here lasts
   until the app is closed and no longer — every cold launch hands back the map as it stood
   when the icon was made. Re-making the shortcut only re-bakes it a day later.

   So on the home screen the app keeps its own copy of the hash and launches from that
   instead. What separates a launch from a page opened inside the app — the species report and
   back again, which carries a hash that IS meant — is sessionStorage: it lives exactly as long
   as the app does, so finding it empty is what "this is a launch" looks like. None of it runs
   in a browser tab, where the address still belongs to whoever wrote the link. */

const LAST_HASH = "inat.map.last";
const APP_OPEN  = "inat.map.session";

function rememberHash(h){
  if(!STANDALONE) return;
  try { localStorage.setItem(LAST_HASH, h); }
  catch(err){ /* No room, or no storage: the shortcut's own address stands, as it used to. */ }
}

function restoreHash(){
  if(!STANDALONE) return;
  try {
    if(sessionStorage.getItem(APP_OPEN)) return;   // opened from inside the app — honour the link
    sessionStorage.setItem(APP_OPEN, "1");
    const last = localStorage.getItem(LAST_HASH);
    if(last) history.replaceState(null, "", "#" + last);
  } catch(err){ /* No storage at all: launch from the shortcut, and simply forget. */ }
}

/* ---------------- saved views ----------------

   A reader has three or four standing questions — my patch, birds, unobserved; the whole
   region, S tier missing — and each of them is already a string this app knows how to write.
   writeHash puts every filter, the layer, the basemap and the viewport into the address;
   readHash takes all of it back out. So a saved view is one of those strings kept under a
   name, and that is the whole of it: no second state format, nothing to keep in step, and no
   way for a saved view to drift from a shared link.

   RESTORING SETS THE HASH AND RELOADS. The other option — re-reading the hash in place, then
   re-applying the basemap, the label and the layers by hand — is faster and buys a second boot
   path that would have to be kept honest forever. The reload is the path a pasted link already
   takes, which is exactly the guarantee being made: a restored view lands where that address
   lands, because it *is* that address being opened. It also leaves nothing behind — afterwards
   the address is the saved hash and nothing else. There is no such thing here as a map that
   arrived from a saved view.

   WHAT A VIEW HOLDS is the hash verbatim, viewport and all. A standing question is nearly
   always a place as well as a filter — "my patch, birds, unobserved" is not the same question
   asked over the next valley — so the string is kept as writeHash wrote it and never parsed
   apart. Saving filters alone would mean taking the hash to pieces and putting it back
   together, which is the one thing that could make a saved view differ from the link it claims
   to be; a reader who wants these filters somewhere else pans there and saves again.

   WHERE IT LIVES is the top of the filter sheet, which is already the one panel about what am
   I looking at. A third sheet view would be a second place to go with the same question, and
   worse, a place to go *instead of* the filters — where the whole point is that restoring one
   view and building another are the same errand.

   localStorage, like the gallery's record of seen photos and the eBird codes: a saved view
   belongs to this reader and this browser rather than to the link. Every read and every write
   is wrapped, and where storage refuses outright the block is simply not drawn — the map is
   otherwise untouched.

   The species report is deliberately left out. Its state is a query string rather than a hash
   (see selfUrl in species.js), so a shared store would have to hold two shapes and know which
   page each one belonged to. That is a larger question than this one and is better answered
   whole than half-built here. */

const VIEWS_STORE = "inat.map.views";

// Two caps, and the second is the belt to the first one's braces: a hash is a few hundred
// characters, so twenty-four of them cannot reach 32KB unless something has gone wrong, and
// nothing here is worth a megabyte of somebody's storage.
//
// At the cap the save is REFUSED and says so, rather than dropping the oldest. These are
// things the reader named on purpose; quietly throwing one away to make room for another is
// not a trade anybody asked for, and delete is one tap away in the same list.
const MAX_VIEWS = 24;
const MAX_VIEW_BYTES = 32 * 1024;
const MAX_VIEW_NAME = 60;

// Whether the feature exists at all. A browser that refuses storage outright gets no block:
// there is nowhere to put a saved view, so offering to save one would be a lie.
function viewsAvailable(){
  try{ localStorage.getItem(VIEWS_STORE); return true; }
  catch(err){ return false; }
}

// A record is { name, hash, saved } and nothing else — the hash as writeHash wrote it. Anything
// that does not read back as one of those is dropped rather than guessed at: an older shape,
// somebody else's JSON, a half-written array. Read fresh at every use rather than held in a
// variable, so what is drawn is what is stored, whatever another tab has been doing.
function readViews(){
  try{
    const raw = JSON.parse(localStorage.getItem(VIEWS_STORE));
    if(!Array.isArray(raw)) return [];
    return raw
      .filter(v => v && typeof v.name === "string" && typeof v.hash === "string" && v.hash.length <= 4000)
      .slice(0, MAX_VIEWS)
      .map(v => ({ name: v.name.slice(0, MAX_VIEW_NAME), hash: v.hash, saved: +v.saved || 0 }));
  }catch(err){ return []; }     // private mode, or somebody else's JSON: nothing saved
}

// Says whether it landed, unlike every other write in the project, because this one answers a
// button the reader has just pressed: a save that quietly did not happen would leave a row on
// screen that is gone tomorrow. Still silent in the console and still harmless — the list is
// re-read from storage on the next paint, so a refused write simply means nothing changed, and
// the sheet says as much in its hint line.
function writeViews(list){
  try{
    const json = JSON.stringify(list);
    if(json.length > MAX_VIEW_BYTES) return false;
    localStorage.setItem(VIEWS_STORE, json);
    return true;
  }catch(err){ return false; }  // no room (QuotaExceededError), or no storage at all
}

// The inline editor, when one is open: what it is for, which row it belongs to, the name as
// typed so far, and whether Delete has been pressed once already. It lives out here rather
// than in the DOM because a filter tapped mid-name re-renders the whole sheet, and a
// half-typed name should survive that.
let viewEditor = null;   // null | { mode:"save"|"rename", at, name, confirm }

// The name the sheet offers: the specimen label's own words, which exist to describe a view in
// a few words and are the same job. They arrive as HTML — a scientific name in italics, the
// months wearing a tooltip — so each goes through a detached element to come back as the plain
// text a stored name has to be.
//
// Taken a whole phrase at a time rather than sliced at the cap, because a label that has run
// out of room should stop at something it has finished saying: "Aves / Research grade" and not
// "Aves / Research grade / @someone missing tier". Only a single phrase longer than the cap is
// ever cut mid-word, and the reader is typing over this anyway — it is a first offer, not a name.
function defaultViewName(){
  const box = document.createElement("div");
  const said = labelBits().map(html => {
    box.innerHTML = html;
    return (box.textContent || "").replace(/\s+/g, " ").trim();
  }).filter(Boolean);
  let name = "";
  for(const phrase of said){
    const next = name ? `${name} / ${phrase}` : phrase;
    if(next.length > MAX_VIEW_NAME) break;
    name = next;
  }
  return name || (said[0] || "All observations").slice(0, MAX_VIEW_NAME);
}

// When it was saved, in the label's own small caps. Today and yesterday by name because that
// is how a view saved this afternoon is actually thought of; anything older takes the date
// fmtDate writes for an observation. Read out of the local calendar rather than an ISO string,
// so a view saved at half past eleven at night is not dated tomorrow.
function savedWhen(ms){
  const d = new Date(ms);
  if(!ms || !isFinite(d.getTime())) return "";
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() &&
                            a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const now = new Date();
  if(sameDay(d, now)) return "Today";
  const yday = new Date(now);
  yday.setDate(yday.getDate() - 1);
  if(sameDay(d, yday)) return "Yesterday";
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}

function pencilSvg(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 20h4L18.5 9.5a2.8 2.8 0 10-4-4L4 16v4z"/><path d="M14 6l4 4"/>
  </svg>`;
}

function viewsHtml(){
  return viewsAvailable() ? `<div class="views" id="viewsBlock">${viewsInner()}</div>` : "";
}

// Names are the reader's own words printed into innerHTML, so every one of them goes through
// esc — in the row, in the tooltip the ellipsis makes necessary, in the editor's field, and in
// the label that tells a screen reader which view the pencil belongs to.
function viewsInner(){
  const list = readViews();
  const renaming = i => viewEditor && viewEditor.mode === "rename" && viewEditor.at === i;
  const rows = list.map((v, i) => renaming(i) ? viewEditorHtml() : `
    <li class="view-row">
      <button type="button" class="view-open" data-at="${i}" title="${esc(v.name)}">
        <span class="view-name">${esc(v.name)}</span>
        <span class="view-when">${esc(savedWhen(v.saved))}</span>
      </button>
      <button type="button" class="view-edit" data-edit="${i}"
              aria-label="Rename or delete ${esc(v.name)}">${pencilSvg()}</button>
    </li>`).join("");

  const saving = viewEditor && viewEditor.mode === "save";
  return `
  <div class="views-head">
    <span class="field-label">Saved views</span>
    ${saving ? "" : `<button type="button" class="linkish" id="viewSave">Save this view</button>`}
  </div>
  <ol class="view-list">${rows}${saving ? viewEditorHtml() : ""}</ol>
  ${list.length || saving ? "" :
    `<p class="field-hint">Nothing saved yet &mdash; keep this map, filters and all, and come
      back to it in a tap.</p>`}
  <p class="field-hint" id="viewHint" hidden></p>`;
}

function viewEditorHtml(){
  const saving = viewEditor.mode === "save";
  return `
  <li class="view-row view-editing">
    <input class="input" id="viewName" type="text" maxlength="${MAX_VIEW_NAME}"
           autocomplete="off" spellcheck="false" enterkeyhint="done"
           placeholder="Name this view" value="${esc(viewEditor.name)}">
    <div class="seg act view-acts">
      <button type="button" id="viewCommit">${saving ? "Save" : "Rename"}</button>
      ${saving ? "" : `<button type="button" id="viewDelete" ${viewEditor.confirm ? `data-armed="1"` : ""}
        >${viewEditor.confirm ? "Delete for good?" : "Delete"}</button>`}
      <button type="button" id="viewCancel">Cancel</button>
    </div>
  </li>`;
}

// Repainting the block rather than re-opening the sheet, for the same reason the month row
// paints itself: openFilters scrolls back to the top and this is a list to work in.
function repaintViews(focus){
  const block = document.getElementById("viewsBlock");
  if(!block) return;
  block.innerHTML = viewsInner();
  // Opened with the whole name selected, so the offer can be typed straight over — the label's
  // words are a starting point, and a reader with their own name for a view should not have to
  // clear a field before writing it. Tapping into the field still puts the caret where it landed.
  const field = document.getElementById("viewName");
  if(focus && field){
    field.focus();
    field.select();
  }
}

// A word to the reader in the block's own hint line — a refused save, a full list. It is set
// on the element rather than rendered, so the next repaint clears it: the message belongs to
// the tap that caused it and to nothing after.
function sayViews(msg){
  const hint = document.getElementById("viewHint");
  if(!hint) return;
  hint.textContent = msg;
  hint.hidden = !msg;
}

// The saved hash, opened — see the note at the top of this section on why this is a reload.
function openView(at){
  const v = readViews()[at];
  if(!v) return;
  history.replaceState(null, "", "#" + v.hash);
  location.reload();
}

function commitViewEditor(){
  if(!viewEditor) return;
  const name = viewEditor.name.trim().slice(0, MAX_VIEW_NAME) || defaultViewName();
  const list = readViews();
  if(viewEditor.mode === "save"){
    if(list.length >= MAX_VIEWS){
      // Refused, and the editor stays open with the name still in it — the reader has a view
      // to delete and can come straight back to this.
      sayViews(`${MAX_VIEWS} saved views is the limit. Delete one to make room for this.`);
      return;
    }
    // The address, as writeHash left it. Every commit and every settled drag writes it, so the
    // bar is always current — reading it here is what keeps a saved view and a shared link the
    // same string rather than two spellings of one.
    list.push({ name, hash: location.hash.replace(/^#/, ""), saved: Date.now() });
  }else{
    const row = list[viewEditor.at];
    if(!row){ viewEditor = null; repaintViews(); return; }   // deleted from under us, in another tab
    row.name = name;
  }
  const ok = writeViews(list);
  viewEditor = null;
  repaintViews();
  if(!ok) sayViews("This browser has no room left, so nothing was saved.");
}

// Two taps, and never beside Restore: the first arms the button in place — no repaint, so the
// finger and the keyboard both stay where they were — and only the second one takes the view
// away. Getting here at all means opening the editor first, so a mis-tap on the list can
// never delete anything.
function deleteEditingView(btn){
  if(!viewEditor || viewEditor.mode !== "rename") return;
  if(!viewEditor.confirm){
    viewEditor.confirm = true;
    btn.dataset.armed = "1";
    btn.textContent = "Delete for good?";
    return;
  }
  const list = readViews();
  list.splice(viewEditor.at, 1);
  const ok = writeViews(list);
  viewEditor = null;
  repaintViews();
  if(!ok) sayViews("This browser refused the write, so nothing was deleted.");
}

// Wired once per sheet render and delegated from the block, which survives every repaint of
// its own contents — so the handlers outlive the rows they act on.
function wireViews(){
  const block = document.getElementById("viewsBlock");
  if(!block) return;

  block.addEventListener("click", e => {
    const b = e.target.closest("button");
    if(!b) return;
    if(b.id === "viewSave"){
      viewEditor = { mode:"save", at:-1, name: defaultViewName(), confirm:false };
      repaintViews(true);
    }else if(b.id === "viewCommit"){
      commitViewEditor();
    }else if(b.id === "viewDelete"){
      deleteEditingView(b);
    }else if(b.id === "viewCancel"){
      viewEditor = null;
      repaintViews();
    }else if(b.dataset.at != null){
      openView(+b.dataset.at);
    }else if(b.dataset.edit != null){
      const at = +b.dataset.edit;
      const v = readViews()[at];
      if(!v) return;
      viewEditor = { mode:"rename", at, name: v.name, confirm:false };
      repaintViews(true);
    }
  });

  // The draft, kept in the editor rather than in the field, so a sheet re-rendered under a
  // half-typed name gives it back.
  block.addEventListener("input", e => {
    if(e.target.id === "viewName" && viewEditor) viewEditor.name = e.target.value;
  });

  block.addEventListener("keydown", e => {
    if(e.target.id !== "viewName") return;
    if(e.key === "Enter"){ e.preventDefault(); commitViewEditor(); }
    if(e.key === "Escape"){ viewEditor = null; repaintViews(); }
  });
}

/* ---------------- filters panel ---------------- */

function segHtml(id, opts, current){
  const isActive = v => Array.isArray(current) ? current.includes(v) : v === current;
  return `<div class="seg" id="${id}">` + opts.map(([v,l]) =>
    `<button type="button" data-v="${esc(v)}" aria-pressed="${isActive(v)}">${esc(l)}</button>`
  ).join("") + `</div>`;
}

// What the month row is asking, since the season alone doesn't say whether it's read across
// every year or narrowed to a stretch of them. Said here rather than left to the label, which
// has to be read on the map behind a sheet that is covering it.
function monthHint(){
  if(!state.months.length) return "";
  const season = esc(monthsLabel(state.months));
  return state.d1auto
    ? `Any year &mdash; ${season} in every year there is. Type a date below to ask about
       ${season} inside a stretch of years.`
    : `${season}, within the dates above. Clear them to read ${season} in any year.`;
}

function filtersHtml(){
  return `
  <div class="eyebrow"><span>Filters</span><button class="linkish" id="reset">Reset all</button></div>

  ${viewsHtml()}

  <div class="field ac-wrap">
    <label for="taxonInput">Species or group</label>
    <input class="input" id="taxonInput" type="search" autocomplete="off"
           placeholder="Search any taxon…" enterkeyhint="search">
    <div class="ac" id="ac" hidden></div>
    <div class="selected" id="taxonSel" ${state.taxon ? "" : "hidden"}>
      <span class="s-sci">${esc(state.tname || "")}</span>
      <button type="button" id="taxonClear" aria-label="Clear species">&times;</button>
    </div>
  </div>

  <div class="field">
    <span class="field-label">Quick groups</span>
    <div class="chips wrap" id="iconicRow">${ICONIC.map(([v,l]) =>
      `<button type="button" data-v="${v}" aria-pressed="${state.iconic.includes(v)}">${l}</button>`).join("")}</div>
  </div>

  <div class="field">
    <label for="unobsInput">Display species for</label>
    <input class="input" id="unobsInput" type="text" autocapitalize="none" autocorrect="off"
           spellcheck="false" placeholder="iNaturalist username" value="${esc(state.unobs)}">
    <div class="seg" id="unobsModeRow">
      <button type="button" data-mode="s" aria-pressed="${modeLit("s")}">S Tier</button>
      <button type="button" data-mode="b" aria-pressed="${modeLit("b")}">B Tier</button>
      <!-- The third line is the map's own speaker rather than the words, so the button
           stays the width of its neighbours. aria-label carries what the icon says. -->
      <button type="button" data-mode="c" aria-pressed="${modeLit("c")}"
              aria-label="C Tier + Untagged + Audio observations">C Tier+<br>Untagged+<br><span
        class="seg-ico" title="Audio observations">${speakerSvg("currentColor","currentColor")}</span></button>
      <button type="button" data-mode="unobserved" aria-pressed="${modeLit("unobserved")}">Unobserved</button>
    </div>
    <p class="field-hint" id="ownHint" ${state.dmode === "own" ? "" : "hidden"}>Nothing selected &mdash;
      the map shows this user&rsquo;s own observations instead of the ones they still want.</p>
    <div class="subrank" id="sspBlock" ${state.dmode === "own" ? "hidden" : ""}>
      <label class="check">
        <input type="checkbox" id="sspBox" ${state.ssp === "1" ? "checked" : ""}>Include subspecies?
      </label>
      <label class="check">
        <input type="checkbox" id="sspOnlyBox" ${state.ssp === "only" ? "checked" : ""}>Show only subspecies?
      </label>
    </div>
    <div class="seg act" id="tierListRow">
      <button type="button" id="tierListBtn"
              >View un/seen species in an area</button>
    </div>
    <p class="field-hint" id="tierListHint" hidden></p>
  </div>

  <div class="field">
    <span class="field-label">Observed between</span>
    <div class="row2">
      <!-- Deliberately no value attribute: the date rides in as a property (see wireFilters).
           iOS's date-picker Clear button resets the field to its defaultValue — the attribute
           it was rendered with — so a restored date written here could never be cleared: the
           button would put it straight back. An empty attribute means Clear lands on empty. -->
      <input class="input" id="d1Input" type="date">
      <input class="input" id="d2Input" type="date">
    </div>
    <!-- Months of the year, under the window they cut across rather than in a field of their
         own: the two are one question about time, and read together or not at all. -->
    <div class="field-label-row months-label">
      <span class="field-label">Months of the year</span>
      <button type="button" id="monthClear" aria-label="Clear months" ${state.months.length ? "" : "hidden"}>&times;</button>
    </div>
    <div class="chips months" id="monthRow">${MONTH_NAMES.map((l, i) =>
      `<button type="button" data-v="${i+1}" aria-pressed="${state.months.includes(i+1)}">${l}</button>`).join("")}</div>
    <p class="field-hint" id="monthHint" ${state.months.length ? "" : "hidden"}>${monthHint()}</p>
  </div>

  <div class="field">
    <span class="field-label">Identification quality</span>
    ${segHtml("qualityRow", QUALITY, state.quality)}
  </div>

  <div class="field">
    <span class="field-label">Location precision</span>
    ${segHtml("preciseRow", PRECISION, state.precise)}
    <p class="field-hint">Excludes observations with fuzzed or hidden coordinates (obscured for privacy or sensitive species).</p>
  </div>

  <div class="divider"></div>

  <div class="field">
    <span class="field-label">Observation layer</span>
    ${segHtml("styleRow", STYLES, state.style)}
  </div>

  <div class="field">
    <span class="field-label">Base map</span>
    ${segHtml("baseRow", BASES, state.base)}
  </div>

  <button class="done" id="doneBtn">Show on map</button>`;
}

function openFilters(){
  openSheet("filters", filtersHtml());
  wireFilters();
}

/* ---------------- tier tag report ---------------- */

// The report is its own page now (species.html), with the scope carried in its query
// string so the link can be bookmarked, shared, and reloaded on its own. Everything the
// list needs is in that address, so nothing here has to stay open behind it.
//
// `back` is this map's whole hash, ferried along untouched so the report's Map link
// returns to the filters, layer and viewport the reader left — the report never reads it.
//
// A pin still on the map goes too. This link opens the place tab — the default — which reads
// the pin straight off the address, so the reader who dropped it lands on their own patch of
// ground instead of being asked for a location. The tier tab is one tap away on the other
// side; naming a place over there replaces the pin. See wirePlaceFinder in species.js.
//
// The months ride along for that reason: the place tab reads them straight away, and a reader
// who set August on the map has every reason to expect August on the list it opens. Unread on
// the tier tab, in force again the moment they cross back to it.

function tierReportUrl(user){
  const p = new URLSearchParams({ u: user });
  if(state.taxon){
    p.set("taxon", state.taxon);
    if(state.tname) p.set("tname", state.tname);
  }
  if(state.iconic.length) p.set("iconic", state.iconic.join(","));
  if(state.months.length) p.set("m", state.months.join(","));
  const pin = pinScope();
  if(pin){
    p.set("lat", pin.lat.toFixed(6));
    p.set("lng", pin.lng.toFixed(6));
    p.set("radius", pin.km.toFixed(3));
  }
  const hash = location.hash.replace(/^#/, "");
  if(hash) p.set("back", hash);
  return "species.html?" + p.toString();
}

/* ---------------- accuracy pin layer ---------------- */

const accLegend = document.getElementById("accLegend");
const accStatus = document.getElementById("accStatus");
const accBar = document.getElementById("accBar");
const ACC_MIN_ZOOM = 9;

// A finger lands within a few pixels of where it aimed — but the browser then snaps the
// tap to the nearest small clickable thing, which is how a tap meant for the map beside a
// pin opens the pin instead. So on a coarse pointer the pins are drawn non-interactive
// (leaflet gives them pointer-events:none), every tap reaches the map untouched, and
// pinAt does the hit test itself against the icon's own circle. A mouse is already exact,
// so it keeps Leaflet's handling and the hover tooltips that come with it.
const COARSE = matchMedia("(pointer: coarse)").matches;

let accSeq = 0, accTimer = null;

// Tap radius sits in the legend, which is static DOM — so it is wired once here rather
// than on every sheet render. It only changes the next tap, so no refetch is needed.
const cursorRow = document.getElementById("cursorRow");
function renderCursorRow(){
  [...cursorRow.children].forEach(c => c.setAttribute("aria-pressed", c.dataset.v === state.cursor));
}
cursorRow.addEventListener("click", e => {
  const b = e.target.closest("button[data-v]");
  if(!b) return;
  state.cursor = b.dataset.v;
  renderCursorRow();
  writeHash();
});

function scheduleAccRefresh(){
  clearTimeout(accTimer);
  accTimer = setTimeout(refreshAccuracyLayer, 300);
}

async function refreshAccuracyLayer(){
  if(state.style !== "accuracy") return;
  const zoom = map.getZoom();
  if(zoom < ACC_MIN_ZOOM){
    // Below the pin floor, individual accuracy pins would mean fetching (and rendering)
    // an unbounded number of observations, so this stays on the density tiles instead —
    // the same grid/points overlay the other styles use — until zoom reaches the floor.
    accLayer.clearLayers();
    const url = tileUrl();
    if(overlay._url !== url) overlay.setUrl(url);
    if(!map.hasLayer(overlay)) overlay.addTo(map);
    accStatus.textContent = `Showing density — zoom in for individual pins (zoom ${zoom} of ${ACC_MIN_ZOOM}+)`;
    return;
  }
  if(map.hasLayer(overlay)) map.removeLayer(overlay);
  const mine = ++accSeq;
  accStatus.textContent = "Loading…";
  pinsBusy(true);
  const b = map.getBounds();
  const bbox = {
    swlat: b.getSouth().toFixed(6), swlng: b.getWest().toFixed(6),
    nelat: b.getNorth().toFixed(6), nelng: b.getEast().toFixed(6)
  };
  const p = obsParams();
  Object.entries(bbox).forEach(([k,v]) => p.set(k,v));
  p.set("per_page", "200");
  p.set("order_by", "id");
  p.set("order", "desc");

  // Unobserved mode only: fold in the taxon-blind unidentified query (see unknownParams)
  // alongside the usual one. Meaningless without a target user — "unobserved" is a question
  // about someone in particular.
  const up = (state.dmode === "unobserved" && state.unobs) ? unknownParams() : null;
  if(up){
    Object.entries(bbox).forEach(([k,v]) => up.set(k,v));
    up.set("per_page", "200");
    up.set("order_by", "id");
    up.set("order", "desc");
  }

  try{
    // The unidentified half is allowed to fail on its own, as it always was: it is an extra
    // question folded into the layer rather than the layer itself, so a refusal there costs
    // those pins and nothing else.
    const [d, ud] = await Promise.all([
      apiGet(`${API}/observations?${p.toString()}`),
      up ? apiGet(`${API}/observations?${up.toString()}`).catch(() => ({ results: [], total_results: 0 }))
         : Promise.resolve(null)
    ]);
    if(mine !== accSeq || state.style !== "accuracy") return;

    const results = ud ? (d.results || []).concat(ud.results || []) : (d.results || []);
    const total = (d.total_results || 0) + (ud ? (ud.total_results || 0) : 0);

    accLayer.clearLayers();
    results.forEach(o => {
      if(!o.location) return;
      const [lat, lng] = o.location.split(",").map(Number);
      if(!isFinite(lat) || !isFinite(lng)) return;

      const acc = o.public_positional_accuracy != null ? o.public_positional_accuracy : o.positional_accuracy;
      const known = acc != null && isFinite(acc);
      const t = o.taxon || {};

      const ring = known ? "rgba(255,255,255,.85)" : ACC_UNKNOWN_RING;
      const halo = known ? "#FFFFFF" : ACC_UNKNOWN_RING;   // taxon glyphs need it opaque
      const fill = known ? accuracyColor(acc) : ACC_UNKNOWN_FILL;
      const audio = isAudioOnly(o);

      // A sound recording stays a speaker whatever it is; everything else takes the glyph
      // for its iconic taxon, down to a question mark for the not-yet-identified.
      const marker = L.marker([lat, lng], {
        interactive: !COARSE,
        icon: audio
          ? L.divIcon({
              className: "snd-pin", html: speakerSvg(fill, ring),
              iconSize: [19,19], iconAnchor: [9.5,9.5]
            })
          : L.divIcon({
              className: "tax-pin", html: taxonSvg(pinKind(t), fill, halo),
              iconSize: [22,22], iconAnchor: [11,11]
            })
      });
      marker.obsId = o.id;                 // what pinAt opens when a tap lands on the icon
      if(!COARSE){
        marker.bindTooltip(
          `${esc(t.preferred_common_name || t.name || "Unidentified")} — ${fmtAcc(known ? acc : null)}`,
          { direction: "top", offset: [0,-4], opacity: .95 }
        );
        marker.on("click", e => {
          L.DomEvent.stopPropagation(e);
          openOut("https://www.inaturalist.org/observations/" + o.id);
        });
      }
      marker.addTo(accLayer);
    });

    const shown = results.length;
    accStatus.textContent = total > shown
      ? `${shown} of ${total.toLocaleString()} in view — zoom in for more`
      : `${shown} in view`;
  }catch(err){
    if(mine !== accSeq) return;
    accStatus.textContent = "Couldn't load pins — pan or zoom to retry.";
  }finally{
    // Every call that gets this far raised the count once, above, including a stale one
    // superseded by a newer pan — so every call lowers it once here, on its own outcome,
    // rather than only the winner clearing what every loser also raised.
    pinsBusy(false);
  }
}

function applyStyle(){
  if(state.style === "accuracy"){
    // Whether the overlay stays on or comes off now depends on zoom (see
    // refreshAccuracyLayer), so it's left alone here rather than forced off.
    accLegend.hidden = false;
    refreshAccuracyLayer();
  }else{
    accLegend.hidden = true;
    accLayer.clearLayers();
    if(!map.hasLayer(overlay)) overlay.addTo(map);
    refreshOverlay();
  }
}

function commit(){ applyStyle(); renderLabel(); writeHash(); }

function wireFilters(){
  const $ = id => document.getElementById(id);

  wireViews();

  $("doneBtn").addEventListener("click", closeSheet);

  $("reset").addEventListener("click", () => {
    Object.assign(state, { taxon:null, tname:"", iconic:defaultIconic(), quality:defaultQuality(), d1:defaultD1(), d1auto:true, d2:"", months:defaultMonths(), unobs:"", precise:"precise", dmode:"unobserved", tierExclude:null, ssp:"" });
    commit();
    openFilters();
  });

  // taxon autocomplete
  const input = $("taxonInput"), ac = $("ac");
  let timer = null, seq = 0, active = -1;

  // Keeps the highlighted row in sync with `active`, whether it moved by arrow key or the
  // list just repainted — a single place so the two never fall out of step.
  const highlight = () => {
    [...ac.children].forEach((el, i) => el.classList.toggle("hi", i === active));
    if(active >= 0) ac.children[active].scrollIntoView({ block: "nearest" });
  };

  const closeAc = () => { ac.hidden = true; ac.innerHTML = ""; active = -1; };

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if(q.length < 2){ closeAc(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try{
        const d = await apiGet(`${API}/taxa/autocomplete?per_page=8&q=${encodeURIComponent(q)}`);
        if(mine !== seq) return;
        if(!d.results || !d.results.length){ closeAc(); return; }
        active = -1;
        ac.innerHTML = d.results.map(t => {
          const thumb = t.default_photo && t.default_photo.square_url;
          return `<button type="button" data-id="${t.id}" data-name="${esc(t.name)}">
            ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : `<span class="ac-nophoto"></span>`}
            <span class="ac-name">
              <span class="ac-common">${esc(t.preferred_common_name || t.name)}</span>
              <span class="ac-sci">${esc(t.name)}</span>
            </span>
            <span class="ac-rank">${esc(t.rank || "")}</span>
          </button>`;
        }).join("");
        ac.hidden = false;
      }catch(e){ closeAc(); }
    }, 280);
  });

  // Arrow keys move the highlight, Enter picks it — defaulting to the top row when nothing's
  // been arrowed to yet, so Enter after typing acts on the best match without an extra tap.
  input.addEventListener("keydown", e => {
    if(ac.hidden || !ac.children.length) return;
    if(e.key === "ArrowDown"){
      e.preventDefault();
      active = Math.min(active + 1, ac.children.length - 1);
      highlight();
    }else if(e.key === "ArrowUp"){
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
    }else if(e.key === "Enter"){
      e.preventDefault();
      ac.children[active < 0 ? 0 : active].click();
    }else if(e.key === "Escape"){
      closeAc();
    }
  });

  ac.addEventListener("click", e => {
    const b = e.target.closest("button[data-id]");
    if(!b) return;
    state.taxon  = b.dataset.id;
    state.tname  = b.dataset.name;
    state.iconic = [];
    ac.hidden = true; input.value = "";
    commit();
    if(isTierMode()) syncTierExclude().then(commit);
    openFilters();
  });

  $("taxonClear").addEventListener("click", () => {
    state.taxon = null; state.tname = "";
    commit();
    if(isTierMode()) syncTierExclude().then(commit);
    openFilters();
  });

  // Repainted in place rather than by re-opening the sheet, like the month row below —
  // openFilters() scrolls the sheet back to the top, which would throw the reader off the
  // row after every tap on what is usually a run of several.
  $("iconicRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if(!b) return;
    const v = b.dataset.v;
    state.iconic = state.iconic.includes(v)
      ? state.iconic.filter(x => x !== v)
      : [...state.iconic, v];
    b.setAttribute("aria-pressed", state.iconic.includes(v));
    if(state.iconic.length && state.taxon){
      state.taxon = null; state.tname = "";
      $("taxonSel").hidden = true;
      $("taxonSel").querySelector(".s-sci").textContent = "";
    }
    commit();
    if(isTierMode()) syncTierExclude().then(commit);
  });

  // Repainted in place for the same reason as the quick groups above — see the comment there.
  $("qualityRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if(!b) return;
    const v = b.dataset.v;
    state.quality = state.quality.includes(v)
      ? state.quality.filter(x => x !== v)
      : [...state.quality, v];
    b.setAttribute("aria-pressed", state.quality.includes(v));
    commit();
  });

  // Months toggle like the quick groups and the quality row above — several at once, and
  // pressing a lit one turns it off — and is repainted in place for the same reason: twelve
  // toggles are meant to be worked in a handful of taps, and openFilters() scrolls the sheet
  // back to the top, which would throw the reader off the row after every one of them.
  $("monthRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if(!b) return;
    const v = +b.dataset.v;
    state.months = state.months.includes(v)
      ? state.months.filter(x => x !== v)
      : [...state.months, v].sort((a, x) => a - x);
    b.setAttribute("aria-pressed", state.months.includes(v));
    const hint = $("monthHint");
    hint.innerHTML = monthHint();
    hint.hidden = !state.months.length;
    $("monthClear").hidden = !state.months.length;
    commit();
  });

  $("monthClear").addEventListener("click", () => {
    state.months = [];
    [...$("monthRow").children].forEach(b => b.setAttribute("aria-pressed", "false"));
    $("monthHint").hidden = true;
    $("monthClear").hidden = true;
    commit();
  });

  const seg = (id, key) => $(id).addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if(!b) return;
    state[key] = b.dataset.v;
    [...$(id).children].forEach(c => c.setAttribute("aria-pressed", c === b));
    if(key === "base"){ setBase(b.dataset.v); writeHash(); }
    else commit();
  });
  seg("preciseRow","precise");
  seg("styleRow","style");
  seg("baseRow","base");

  // Rank window for the desired-species query. The two boxes are one setting wearing two
  // ticks, so each clears the other; both off is the floored-at-species default. Only the
  // map layer reads it, so no refetch of the level exclusions is needed — commit() repaints.
  {
    const incl = $("sspBox"), only = $("sspOnlyBox");
    const setSsp = v => {
      state.ssp = v;
      incl.checked = v === "1";
      only.checked = v === "only";
      commit();
    };
    incl.addEventListener("change", e => setSsp(e.target.checked ? "1" : ""));
    only.addEventListener("change", e => setSsp(e.target.checked ? "only" : ""));
  }

  // Desired-species mode (Unobserved vs a level). Selecting a level re-derives its exclude
  // set. The row toggles rather than merely choosing: pressing the mode already on turns it
  // off, leaving no button lit and the map on this user's own records. The rank ticks go
  // with it — they narrow a desired-species list, and there isn't one in that state.
  // Only the pressed button becomes the mode; the ones after it light with it (modeLit).
  $("unobsModeRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-mode]");
    if(!b) return;
    state.dmode = state.dmode === b.dataset.mode ? "own" : b.dataset.mode;
    [...$("unobsModeRow").children].forEach(c =>
      c.setAttribute("aria-pressed", modeLit(c.dataset.mode)));
    $("ownHint").hidden  = state.dmode !== "own";
    $("sspBlock").hidden = state.dmode === "own";
    syncTierExclude().then(commit);
  });

  // Reads the username straight off the field rather than state.unobs, which the 420ms
  // debounce below may not have committed yet. The report covers every tier regardless of
  // the mode row, so the username is all it needs.
  $("tierListBtn").addEventListener("click", function(){
    const hint = $("tierListHint"), user = $("unobsInput").value.trim();
    const say = msg => { hint.textContent = msg; hint.hidden = false; };
    if(!user){ say("Enter an iNaturalist username above first."); $("unobsInput").focus(); return; }
    hint.hidden = true;
    if(!openOut(tierReportUrl(user))){
      say("Allow pop-ups for this page to open the list.");
    }
  });

  // The dates ride in as properties rather than attributes — see the note in filtersHtml:
  // the attribute is the defaultValue iOS's Clear button resets to, so it must stay empty
  // even while the restored date is shown.
  $("d1Input").value = state.d1;
  $("d2Input").value = state.d2;

  const debounced = (el, key) => {
    let t = null;
    const settle = () => {
      clearTimeout(t);
      t = null;
      const v = el.value.trim();
      if(v === state[key]) return;
      state[key] = v;
      // Touched, so no longer the app's own window — including cleared, which is a
      // deliberate "no lower bound" and not a request for the default back. From here it
      // rides in the address and stands against a month filter (see windowD1), so the hint
      // under the months has to be redrawn with it.
      if(key === "d1") state.d1auto = false;
      $("monthHint").innerHTML = monthHint();
      commit();
    };
    el.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(settle, 420);
    });
    // iOS's date picker can change the value without an input event — its Clear button
    // famously fires nothing at all — so change and the field losing focus are read back
    // too, through the same settle: the field is the last word either way.
    el.addEventListener("change", settle);
    el.addEventListener("focusout", settle);
  };
  debounced($("d1Input"), "d1");
  debounced($("d2Input"), "d2");

  // Desired-species username: also re-derive level exclusions when it changes.
  $("unobsInput").addEventListener("keydown", e => {
    if(e.key === "Enter") $("tierListBtn").click();
  });
  { let t = null;
    $("unobsInput").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { state.unobs = $("unobsInput").value.trim(); syncTierExclude().then(commit); }, 420);
    });
  }
}

document.getElementById("labelBar").addEventListener("click", () => {
  if(sheetView === "filters") closeSheet(); else openFilters();
});

/* ---------------- probe: what's at this point ---------------- */

// Tap radius, as a fraction of the map's shorter edge — one number per cursor mode and
// nothing else to tune. Raise it for a wider reach, lower it for a tighter one. Both rings
// being screen-relative means each is drawn the same size at every zoom and the ground it
// covers falls out of the zoom level itself: zoom in for a small ring, out for a broad
// sweep. 0.4 puts "large" at 80% of the shorter edge across, so the whole ring stays on
// screen; "precise" is a fingertip.
const PROBE_SPAN = { precise: 0.15, large: 0.4 };
function probeRadiusKm(lat, zoom){
  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  const size = map.getSize();
  const px = Math.min(size.x, size.y) * PROBE_SPAN[state.cursor];
  // Floor is not a tuning knob: it just keeps the radius the API sees above zero, which
  // three decimal places can otherwise round away at full zoom.
  return Math.max(0.001, mPerPx * px / 1000);
}

// The pin currently on the map, read as an area — or null when there is none. The marker
// and its ring already hold that state, so this reads it back off them rather than keeping a
// second copy which would then have to be dropped in step with theirs (closeSheet clears the
// lot in one place). A pin the reader can no longer see is a pin no link should carry.
function pinScope(){
  if(!probeMark || !probeRing) return null;
  const ll = probeMark.getLatLng();
  return { lat: ll.lat, lng: ll.lng, km: probeRing.getRadius() / 1000 };
}

function fmtDate(iso){
  if(!iso) return "No date";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if(!m) return iso;
  return `${+m[3]} ${MONTH_NAMES[+m[2]-1].toUpperCase()} ${m[1]}`;
}
// time_observed_at carries the clock time in the observer's own UTC offset, so this reads
// out the hour and minute as written rather than converting to the viewer's timezone.
function fmtTime(iso){
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? `${m[1]}:${m[2]}` : "";
}

function speciesUrl(latlng, km){
  const p = obsParams();
  // The rank window (hrank/lrank) exists to keep subspecies from reading as "desired" in our
  // own list — a filter about how *we* count a match, not one iNat's own page should carry.
  // Sent along, it would quietly hide subspecies/genus-level records the reader can see fine
  // on iNat itself, for a distinction that only matters inside this tool.
  p.delete("hrank");
  p.delete("lrank");
  p.set("lat", latlng.lat.toFixed(6));
  p.set("lng", latlng.lng.toFixed(6));
  p.set("radius", km.toFixed(3));
  p.set("view", "species");
  return "https://www.inaturalist.org/observations?" + p.toString();
}

// The same circle on our own species page: the pin and its radius are the area, and the
// panel's username rides along so the list can tick off what it already holds. So does the
// season, which that page reads on this very tab — the dates do not, the list over there
// being about what has been recorded in a place ever, which is a premise a month slices
// without shortening. See the place-scope block in species.js.
function hereUrl(latlng, km){
  const p = new URLSearchParams({
    tab: "place",
    lat: latlng.lat.toFixed(6),
    lng: latlng.lng.toFixed(6),
    radius: km.toFixed(3),
    // Explicit rather than left to species.html's own default: that default (20) is sized for
    // an area-wide species list, but a reader arriving from a dropped pin is looking at
    // whatever is actually inside that circle, which is often nowhere near 20 observations
    // per species. `min=0` survives as "show everything" the same way a typed 0 would.
    min: "0"
  });
  if(state.unobs) p.set("u", state.unobs);
  if(state.taxon){
    p.set("taxon", state.taxon);
    if(state.tname) p.set("tname", state.tname);
  }
  if(state.iconic.length) p.set("iconic", state.iconic.join(","));
  if(state.months.length) p.set("m", state.months.join(","));
  const hash = location.hash.replace(/^#/, "");
  if(hash) p.set("back", hash);
  return "species.html?" + p.toString();
}

// The pin, centred in Google Maps — just the coordinates, since a search radius has no
// equivalent there and the tapped point is the only thing worth carrying across.
//
// Written as the canonical place address rather than the documented `/maps/search/?api=1`
// form, because every hop this link takes is one the reader sits through. A search has to
// be resolved before anything is drawn, and Maps then rewrites the address to exactly this
// one — asking for it directly skips both. `ucbcb=1` is what Google's own consent redirect
// appends on the way back; sent up front, the "before you continue" page never loads at
// all, which in Europe is a whole screen saved on every tap. Both `/maps/place/*` and
// `/maps/search/*` are addresses the Google Maps app claims, so nothing about the hand-off
// on a phone changes — it just happens without the detour.
function gmapsUrl(latlng){
  const ll = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
  return `https://www.google.com/maps/place/${ll}/@${ll},17z?ucbcb=1`;
}

// The same point as a doughnut on Easily Missed, which reads two circles against each other:
// species the wider ring has and the middle one doesn't, which is to say what this spot is
// missing that its own region holds. The pin's ring is the middle one — it is the ground just
// looked at — and the outer is five times it, keeping the 1:5 the tool itself defaults to.
//
// Both radii are clamped to what its own controls accept (0.25–20km inner, up to 100km
// outer). A fingertip tap at full zoom is a ring of a few dozen metres: as an inner circle
// that holds nothing, so every species in the region reads as missing from it and the list
// says nothing at all.
//
// The order of the four is load-bearing, not tidiness. That page picks lat/lng/i_rad/o_rad
// out of the query string by substring match and then drops them by count from the front,
// passing whatever is left to iNaturalist as extra filters — so all four have to come first,
// and anything else has to come after, or the wrong parameters go over. Hence the username
// and the panel's taxon filters at the back, where they survive the strip and arrive as the
// iNat filters they already are.
function easilyMissedUrl(latlng, km){
  const rad = n => String(+n.toFixed(3));
  const inner = Math.min(20, Math.max(0.25, km));
  const p = new URLSearchParams({
    lat: latlng.lat.toFixed(6),
    lng: latlng.lng.toFixed(6),
    i_rad: rad(inner),
    o_rad: rad(Math.min(100, inner * 5))
  });
  if(state.unobs) p.set("inat_username", state.unobs);
  if(state.taxon) p.set("taxon_id", state.taxon);
  if(state.iconic.length) p.set("iconic_taxa", state.iconic.join(","));
  return "https://simonrolph.github.io/easily_missed/?" + p.toString();
}

// The four ways out of a pin, factored out so every state of the results sheet -
// loading, error, empty, and populated - shows the same row in the same place,
// rather than the exits only appearing once a fetch happens to resolve.
function actionsHtml(latlng, km){
  return `<span class="eyebrow-actions">
    <button class="linkish" id="toHere" data-url="${esc(hereUrl(latlng, km))}">Species<br>here</button>
    <button class="linkish" id="toSpecies" data-url="${esc(speciesUrl(latlng, km))}">On<br>iNat${extIcon()}</button>
    <a class="linkish" ${outAttrs(easilyMissedUrl(latlng, km))}>Easily<br>Missed${extIcon()}</a>
    <a class="linkish" ${outAttrs(gmapsUrl(latlng))}>GMaps${extIcon()}</a>
  </span>`;
}

function resultsHtml(list, km, latlng){
  if(!list.length){
    return `<div class="eyebrow"><span>Nothing here</span>${actionsHtml(latlng, km)}</div>
      <div class="state">
        <div class="state-lede">No observations within ${esc(fmtAcc(km * 1000))}.</div>
        <div class="state-hint">Zoom out and tap again, or loosen the filters.</div>
      </div>`;
  }
  const rows = list.map(o => {
    const t = o.taxon || {};
    const photo = o.photos && o.photos[0] && o.photos[0].url ? o.photos[0].url.replace("square","small") : null;
    const acc = o.public_positional_accuracy != null ? o.public_positional_accuracy : o.positional_accuracy;
    const accKnown = acc != null && isFinite(acc);
    // The accuracy colour rides on the row's iconic-taxon glyph — the same drawing its pin
    // wears on the map — rather than a bare dot, so one mark says both what was found and
    // how well it was placed. Unknown accuracy keeps the pins' white, which is no accuracy
    // colour at all. A sound recording keeps its taxon here: the speaker is already in the
    // tile to the left saying listen-not-look, and swapping this one too would leave the row
    // with nothing saying what the thing was.
    const accMark = `<span class="acc-mark">${
      taxonSvg(pinKind(t), accKnown ? accuracyColor(acc) : ACC_UNKNOWN_FILL, PANEL)}</span>`;
    const meta = [];
    const time = fmtTime(o.time_observed_at);
    meta.push(fmtDate(o.observed_on) + (time ? ", " + time : ""));
    meta.push(`${accMark}${esc(fmtAcc(accKnown ? acc : null))}`);
    if(o.user && o.user.login) meta.push("@" + esc(o.user.login));
    let badges = "";
    if(o.quality_grade === "research") badges += `<span class="badge badge-rg">Research</span>`;
    if(o.obscured) badges += `<span class="badge badge-ob">Obscured</span>`;
    return `<button class="result" data-id="${o.id}">
      ${photo ? `<img class="result-photo" src="${esc(photo)}" alt="" loading="lazy">`
              : isAudioOnly(o)
                ? `<span class="result-nophoto result-audio" title="Sound only">${speakerSvg("currentColor","currentColor")}</span>`
                : `<span class="result-nophoto">&#9673;</span>`}
      <span class="result-main">
        <span class="result-common">${esc(t.preferred_common_name || t.name || "Unidentified")}</span>
        ${t.name ? `<span class="result-sci">${esc(t.name)}</span>` : ""}
        <span class="result-meta">${meta.join(" &middot; ")}${badges}</span>
      </span>
    </button>`;
  }).join("");
  return `<div class="eyebrow"><span class="eyebrow-label"><span>${list.length} selected</span><span class="eyebrow-dist">${esc(fmtAcc(km * 1000))}</span></span>${actionsHtml(latlng, km)}</div>${rows}`;
}

// Three circles, always the same three: the tightest accuracies the probe came back with,
// whatever the size of the catch. Drawing every one of twenty would be a wash of overlapping
// rings, and the loosest of them cover the whole screen anyway — the precise ones are the
// only ones that say something about where the animal actually was.
//
// ACC_CIRCLE_MIN is a preference, not a veto. Where there is a choice, a circle at or under
// it is passed over: at any zoom it reads as a pin, not an area, so it would spend one of the
// three slots on a ring nobody can see. Where there isn't — a pin over two observations, or
// twenty all recorded to the metre — the tight ones fill the rest of the three rather than
// leave the map bare, largest first, those being the only ones with a chance of showing.
const ACC_CIRCLE_MIN   = 10;   // metres — below this the circle is smaller than the pin on it
const ACC_CIRCLE_COUNT = 3;

function drawAccuracyCircles(list){
  probeAccLayer.clearLayers();
  const found = list.map(o => {
    if(!o.location) return null;
    const [lat, lng] = o.location.split(",").map(Number);
    if(!isFinite(lat) || !isFinite(lng)) return null;
    const acc = o.public_positional_accuracy != null ? o.public_positional_accuracy : o.positional_accuracy;
    if(acc == null || !isFinite(acc) || acc <= 0) return null;
    return { lat, lng, acc };
  }).filter(Boolean);

  const wide  = found.filter(o => o.acc >  ACC_CIRCLE_MIN).sort((a, b) => a.acc - b.acc);
  const tight = found.filter(o => o.acc <= ACC_CIRCLE_MIN).sort((a, b) => b.acc - a.acc);

  wide.concat(tight).slice(0, ACC_CIRCLE_COUNT).forEach(o => {
    const col = accuracyColor(o.acc);
    L.circle([o.lat, o.lng], {
      radius: o.acc, color: col, weight: 1.5, opacity: .85,
      fillColor: col, fillOpacity: .12, interactive: false
    }).addTo(probeAccLayer);
  });
}

// Which pin a tap actually landed on, if any: the nearest one whose own icon circle (half
// its icon size) covers the point. A tap outside every circle places a radius pin instead,
// and loses nothing by it — the panel that opens lists what's in reach, that pin included.
function pinAt(pt){
  let hit = null, best = Infinity;
  accLayer.eachLayer(l => {
    if(l.obsId == null) return;
    const r = L.point(l.options.icon.options.iconSize).x / 2;
    const d = pt.distanceTo(map.latLngToContainerPoint(l.getLatLng()));
    if(d <= r && d < best){ best = d; hit = l; }
  });
  return hit;
}

// `km` is only ever passed on restore — a fresh tap (the only other caller) always wants the
// live cursor-precision radius, not whatever it happened to be last time. Restoring the exact
// figure rather than recomputing it matters because the reader may have re-tapped since with a
// different cursor mode, or come back at a different zoom: recomputing would draw a circle
// that quietly doesn't match the one they left.
async function probe(latlng, km){
  if(km == null) km = probeRadiusKm(latlng.lat, map.getZoom());

  if(probeMark) map.removeLayer(probeMark);
  if(probeRing) map.removeLayer(probeRing);
  probeAccLayer.clearLayers();
  probeRing = L.circle(latlng, {
    radius: km * 1000, color: MARK, weight: 1, opacity: .7,
    fillColor: MARK, fillOpacity: .07, interactive: false
  }).addTo(map);
  probeMark = L.circleMarker(latlng, {
    radius: 4, color: MARK, weight: 2, fillColor: MARK, fillOpacity: 1, interactive: false
  }).addTo(map);
  // Down before the fetch, not after: hereUrl/tierReportUrl read the pin straight off this
  // hash the moment the results paint, and a reader tapping "Species here" before the request
  // lands should still get a link that knows where they tapped.
  writeHash();

  openSheet("results", `<div class="eyebrow"><span>Reading&hellip;</span>${actionsHtml(latlng, km)}</div>
    <div class="state"><div class="state-hint">Fetching observations.</div></div>`);
  wireResults();

  const p = obsParams();
  p.set("lat", latlng.lat.toFixed(6));
  p.set("lng", latlng.lng.toFixed(6));
  p.set("radius", km.toFixed(3));
  p.set("per_page", "20");
  p.set("order_by", "observed_on");
  p.set("order", "desc");

  try{
    const d = await apiGet(`${API}/observations?${p.toString()}`);
    if(sheetView !== "results") return;
    openSheet("results", resultsHtml(d.results || [], km, latlng));
    wireResults();
    drawAccuracyCircles(d.results || []);
  }catch(err){
    openSheet("results", `<div class="eyebrow"><span>Not loaded</span>${actionsHtml(latlng, km)}</div>
      <div class="state">
        <div class="state-lede">The request didn't come back.</div>
        <div class="state-hint">Check the connection and tap the map again.</div>
      </div>`);
    wireResults();
  }
}

function wireResults(){
  const toF = document.getElementById("toFilters");
  if(toF) toF.addEventListener("click", openFilters);
  // Four ways out of a pin: this app's own species list, the same circle on iNat, the
  // doughnut on Easily Missed, or the bare coordinates in Google Maps. The last two are
  // already real links and need no wiring — see outAttrs.
  ["toHere", "toSpecies"].forEach(id => {
    const b = document.getElementById(id);
    if(b) b.addEventListener("click", () => openOut(b.dataset.url));
  });
  sheetBody.querySelectorAll(".result").forEach(b => {
    const go = () => openOut("https://www.inaturalist.org/observations/" + b.dataset.id);
    b.addEventListener("click", go);
    // These rows are buttons, not links, so a middle click gets none of the free new-tab
    // handling a real <a> would get from the browser — auxclick is where it has to be
    // wired by hand. mousedown's preventDefault stops the middle-click autoscroll icon
    // from flashing up first, the same way it would over any ordinary page text.
    b.addEventListener("mousedown", e => { if(e.button === 1) e.preventDefault(); });
    b.addEventListener("auxclick", e => {
      if(e.button !== 1) return;
      e.preventDefault();
      go();
    });
  });
}

/* ---------------- locate ---------------- */

// Compass heading, in degrees clockwise from true north. Two sources: iOS exposes a
// ready-made webkitCompassHeading, everyone else reports alpha, which counts the other
// way round. Devices with no magnetometer send neither and the wedge simply never shows.
let headingDeg = null, headingWired = false;

function onOrient(e){
  let h = null;
  if(typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
  else if(e.absolute && typeof e.alpha === "number") h = 360 - e.alpha;
  if(h == null || !isFinite(h)) return;
  headingDeg = (h + 360) % 360;
  paintCone();
}

function wireHeading(){
  if(headingWired || !window.DeviceOrientationEvent) return;
  // iOS 13+ gates the sensor behind a prompt that only a user gesture may raise, so the
  // boot-time attempt is rejected there — the flag is set on success only, letting the
  // locate button (a real gesture) try again.
  const req = DeviceOrientationEvent.requestPermission;
  const listen = () => {
    headingWired = true;
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  };
  if(typeof req === "function") req.call(DeviceOrientationEvent).then(s => { if(s === "granted") listen(); }).catch(() => {});
  else listen();
}

function paintCone(){
  if(!meCone || headingDeg == null) return;
  const el = meCone.getElement();
  if(!el) return;
  const wedge = el.firstElementChild;
  // Unwrap the angle so 359° → 2° turns 3° the short way instead of spinning backwards.
  const prev = +wedge.dataset.deg || 0;
  wedge.dataset.deg = prev + ((((headingDeg - prev) % 360) + 540) % 360) - 180;
  wedge.style.transform = `rotate(${wedge.dataset.deg}deg)`;
  wedge.style.visibility = "visible";
}

// Moves the pair on every fix, and builds them only on the first. Moving rather than
// rebuilding is what keeps the wedge steady: its rotation accumulates on the element (see
// paintCone), so a fresh element would restart at 0 and spin the long way round on the
// next heading update — and the dot would blink on every step besides.
function showMe(ll){
  if(meCone && meRing){
    meCone.setLatLng(ll);
    meRing.setLatLng(ll);
  }else{
    // Under the dot, so the dot stays legible on top of the wedge.
    meCone = L.marker(ll, {
      interactive: false,
      icon: L.divIcon({ className: "me-cone", html: "<i></i>", iconSize: [88,88], iconAnchor: [44,44] })
    }).addTo(map);
    meRing = L.circleMarker(ll, {
      interactive: false,          // the dot does nothing on tap; it shouldn't swallow one
      radius: 6, color: "#6FD3A8", weight: 3, fillColor: "#2D9CFF", fillOpacity: 1
    }).addTo(map);
  }
  paintCone();
}

// One standing watch, shared by the locate button and the boot fix. A single reading per
// tap left the dot wherever it was taken, which is no use to someone walking — this keeps
// it under your feet. The map is deliberately not dragged along: the dot follows you, the
// view stays where you put it until you ask to be centred again.
//
// `onNextFix` lets one caller ride the next update to recentre exactly once, so a tap on
// locate reuses the fix already in flight instead of opening a second request beside it.
let meWatch = null, meAt = null, onNextFix = null;

function fixArrived(ll){
  const f = onNextFix;
  onNextFix = null;
  if(f) f(ll);
}

function watchMe(){
  if(meWatch !== null || !navigator.geolocation) return;
  meWatch = navigator.geolocation.watchPosition(pos => {
    meAt = [pos.coords.latitude, pos.coords.longitude];
    showMe(meAt);
    fixArrived(meAt);
  }, err => {
    // A refusal kills the watch for good, so drop the handle and let a later tap ask
    // again. A timeout indoors leaves it alive and simply retrying, which is what we want.
    if(err && err.code === 1){
      navigator.geolocation.clearWatch(meWatch);
      meWatch = null;
    }
    fixArrived(null);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

document.getElementById("locate").addEventListener("click", function(){
  if(!navigator.geolocation) return;
  wireHeading();
  const jump = ll => {
    this.dataset.busy = "0";
    if(ll) map.setView(ll, Math.max(map.getZoom(), 14));
  };
  // Already tracking: centre on the fix in hand rather than making them wait for the next.
  if(meAt){ jump(meAt); return; }
  this.dataset.busy = "1";
  onNextFix = jump;
  watchMe();
});

/* ---------------- boot ---------------- */

(function init(){
  restoreHash();          // home screen only: launch where this reader left off, not where iOS did
  const v = readHash();

  map = L.map("map", {
    center: [v.lat, v.lng],
    zoom: v.z,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    worldCopyJump: true,
    tap: false
  });

  setBase(state.base);

  overlay = L.tileLayer(tileUrl(), {
    maxNativeZoom: 19,
    maxZoom: MAX_ZOOM,
    opacity: 0.85,
    crossOrigin: true
  });
  // Leaflet's own batch-loading events: "loading" once a style/pan/zoom change sends a
  // fresh round of tiles out, "load" once every tile in that round has settled (loaded
  // or errored) — exactly the span the density-tile styles need the icon lit for.
  overlay.on("loading", () => pinsBusy(true));
  overlay.on("load",    () => pinsBusy(false));
  accLayer = L.layerGroup().addTo(map);
  probeAccLayer = L.layerGroup().addTo(map);
  accBar.style.background = legendGradientCss();
  renderCursorRow();
  applyStyle();

  const zoomIn = document.getElementById("zoomIn");
  const zoomOut = document.getElementById("zoomOut");
  const syncZoomButtons = () => {
    zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
    zoomOut.disabled = map.getZoom() <= map.getMinZoom();
  };
  zoomIn.addEventListener("click", () => map.zoomIn());
  zoomOut.addEventListener("click", () => map.zoomOut());
  map.on("zoomend", syncZoomButtons);
  syncZoomButtons();

  map.on("zoomend", () => { if(state.style === "auto") refreshOverlay(); });
  map.on("moveend", () => {
    writeHash();
    if(state.style === "accuracy") scheduleAccRefresh();
  });
  map.on("click", e => {
    const pin = COARSE ? pinAt(e.containerPoint) : null;
    if(pin) openOut("https://www.inaturalist.org/observations/" + pin.obsId);
    else probe(e.latlng);
  });

  renderLabel();
  writeHash();

  // A pin carried in on the hash — either the `back` link handed back from species.html, or
  // this reader's own last address restored by restoreHash above. Redo the tap so the marker,
  // ring and results list all come back exactly as left, rather than an empty map that quietly
  // dropped the one thing the reader went to species.html to look up in the first place.
  if(v.droppedPin) probe(L.latLng(v.droppedPin.lat, v.droppedPin.lng), v.droppedPin.km);

  // Fresh load with no coords in the hash: start tracking, staying on Lisbon if it is
  // denied, unavailable, or slow. Only the first fix recentres — after that the dot keeps
  // up on its own. moveend does the rest (hash + pin refresh).
  if(!v.pinned && navigator.geolocation){
    wireHeading();      // no-op on iOS, which only grants the sensor from a gesture
    let moved = false;               // never yank the map out from under a user gesture
    map.on("dragstart", () => { moved = true; });
    map.on("zoomstart", () => { moved = true; });
    onNextFix = ll => {
      if(!ll || moved) return;
      // A real position is worth two extra levels; the Lisbon fallback stays wide.
      const z = v.zPinned ? map.getZoom() : ACC_MIN_ZOOM + 2;
      map.setView(ll, z);
    };
    watchMe();
  }

  // If a shared link lands in a level mode, resolve its exclude set then refresh.
  if(isTierMode() && state.unobs) syncTierExclude().then(commit);
})();
