"use strict";

const API  = "https://api.inaturalist.org/v1";
const MARK = "#FF3E7C";

const ICONIC = [
  ["Plantae","Plants"],["Aves","Birds"],["Insecta","Insects"],["Fungi","Fungi"],
  ["Arachnida","Arachnids"],["Mammalia","Mammals"],["Reptilia","Reptiles"],
  ["Amphibia","Amphibians"],["Actinopterygii","Fish"],["Mollusca","Molluscs"]
];
const QUALITY = [["research","Research"],["needs_id","Needs ID"],["casual","Casual"]];
const PRECISION = [["","Any"],["precise","Exact only"]];
const STYLES  = [["auto","Auto"],["points","Points"],["grid","Grid"],["heat","Heat"],["accuracy","Accuracy"]];
const BASES   = [["light", "Light"], ["dark","Dark"],["sat","Satellite"]];

// Two levels past every layer's tightest native ceiling (satellite's 19) — past that point
// every layer is upscaling anyway, so there's nothing left to gain by going further.
const MAX_ZOOM = 21;

function defaultD1(){
  const d = new Date();
  // 1.5 months as a fixed 45 days: setMonth only takes whole months, and calendar months
  // vary in length anyway, so a day count is the one way to make "a month and a half" mean
  // the same span every time this runs.
  d.setDate(d.getDate() - 45);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
// Fallback centre when the browser won't give us a position.
const LISBON = [38.7223, -9.1393];

function defaultQuality(){ return ["research","needs_id"]; }
function isDefaultQuality(){
  const d = defaultQuality();
  return state.quality.length === d.length && d.every(v => state.quality.includes(v));
}

const state = {
  taxon:null, tname:"", iconic:[], quality:defaultQuality(),
  d1:defaultD1(), d2:"", style:"accuracy", base:"light", unobs:"", precise:"precise",
  // dmode: "unobserved" | "s" | "b" | "c" | "own". The mode row toggles, so pressing the
  // mode already set turns it off — "own" is that no-button-pressed state, and it asks the
  // opposite question: not what this user is missing but what they have already recorded.
  dmode:"unobserved", tierExclude:null, cursor:"precise", ssp:""   // "" | "1" incl. | "only"
};

let map, overlay, accLayer, probeAccLayer, probeMark, probeRing, meRing, meCone, sheetView = null;

/* ---------------- query building ---------------- */

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
        // Level mode: hide species this user has already tagged at this level.
        p.set("without_taxon_id", state.tierExclude.join(","));
      }
      // Rank window on the results, driven by the two tickboxes. Unticked, the list is
      // floored at species: iNat treats a subspecies as its own leaf taxon, so without this
      // a ssp. of an already-recorded species still reads as "desired" (genus-and-coarser
      // IDs stay; only subspecies/variety/form go). "Include subspecies" drops the floor;
      // "Only subspecies" swaps it for a ceiling, leaving nothing but infraspecific taxa.
      if(state.ssp === "only") p.set("hrank", "subspecies");
      else if(!state.ssp)      p.set("lrank", "species");
      // Never show them their own shots. Redundant under Unobserved — a species they have
      // recorded is already gone whole — but in a level mode their untagged species are on
      // the map, and those pins lead back to ground they have already walked.
      p.set("not_user_id", state.unobs);
    }
  }
  if(state.quality.length) p.set("quality_grade", state.quality.join(","));
  if(state.precise){ p.set("geoprivacy", "open"); p.set("taxon_geoprivacy", "open"); }
  if(state.d1)      p.set("d1", state.d1);
  if(state.d2)      p.set("d2", state.d2);
  return p;
}

// Desired-species levels, best first — each value is both the button's mode and the
// observation tag it matches. The priority stacks: picking a level hides species already
// tagged at that level *or better*, so the exclusion set for level i is tags 0..i.
// Note the top tier is "s", not "a": iNat's search index treats "a" as an English
// stopword and silently drops it (search_on=tags&q=a matches nothing, site-wide).
const LEVELS = ["s","b","c"];

// Every mode the row can be in, including the one no button shows: "own", where nothing is
// pressed. Only a level mode costs a request, so this is what the callers that re-derive
// the exclusion set ask about.
const DMODES = ["own","unobserved",...LEVELS];
function isTierMode(){ return LEVELS.includes(state.dmode); }

// Scope a species_counts query to one user plus the panel's taxon / quick-group filters.
function userScope(user){
  const o = { user_id: user };
  if(state.taxon) o.taxon_id = state.taxon;
  if(state.iconic.length) o.iconic_taxa = state.iconic.join(",");
  return o;
}

// Page through species_counts and return the raw {taxon, count} rows. `stale`, when
// given, is polled between pages so a superseded caller can bail out early.
async function speciesCounts(params, stale){
  const out = [];
  for(let page = 1; page <= 20; page++){
    const p = new URLSearchParams(params);
    p.set("per_page", "500");
    p.set("page", String(page));
    const r = await fetch(`${API}/observations/species_counts?${p.toString()}`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    if(stale && stale()) return out;
    (d.results || []).forEach(x => { if(x.taxon && x.taxon.id) out.push(x); });
    if(page * 500 >= (d.total_results || 0)) break;
  }
  return out;
}

// The species carrying one tier's tag. One request per tag: the tags index matches a
// single term, so "s b" ORs nothing.
async function speciesIdsWithTag(user, tag, stale){
  const rows = await speciesCounts({ ...userScope(user), search_on:"tags", q:tag }, stale);
  return new Set(rows.map(x => x.taxon.id));
}

// The species a user has tagged at `level` or better. The tiers stack, so level i means
// tags 0..i.
//
// Only tags count here. A species recorded by sound alone carries no tag, so it stays on
// the map at every level — which is the point: no photograph of it exists yet, so it is
// still worth going after however the level row is set. The species report gives those
// their own band, but that is a way of reading a list, not a claim that the bird is done.
async function taggedSpeciesIds(user, level, stale){
  const ids = new Set();                     // a species may be tagged at several tiers
  for(const tag of LEVELS.slice(0, LEVELS.indexOf(level) + 1)){
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
  Arachnida:      { body: ["M7.7 12A4.3 4.3 0 1 0 16.3 12A4.3 4.3 0 1 0 7.7 12Z"],
                    limb: ["M14.9 11.1L19.6 9.5M13.9 9.6L16.9 5.7M10.1 9.6L7.1 5.7M9.2 11.1L4.4 9.5M9.2 12.9L4.4 14.5M10.1 14.4L7.1 18.3M13.9 14.4L16.9 18.3M14.9 12.9L19.6 14.5"],
                    w: 1.7 },
  // thorax and abdomen overlap into one blob, six legs off the thorax
  Insecta:        { body: ["M12 6.2A2.7 3.2 0 1 0 12 12.6A2.7 3.2 0 1 0 12 6.2Z",
                           "M12 11.2A3.4 4 0 1 0 12 19.2A3.4 4 0 1 0 12 11.2Z"],
                    limb: ["M10 7.4L4.8 4.8M9.4 9.8L3.8 9.6M10.2 12L5.4 15.2M14 7.4L19.2 4.8M14.6 9.8L20.2 9.6M13.8 12L18.6 15.2"],
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
  if(m == null || !isFinite(m)) return "No accuracy data";
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
  p.set("d1", state.d1);
  if(state.d2)      p.set("d2", state.d2);
  if(state.style !== "accuracy") p.set("s", state.style);
  if(state.base !== "light")  p.set("b", state.base);
  if(state.cursor !== "precise") p.set("cur", state.cursor);
  history.replaceState(null, "", "#" + p.toString());
}

function readHash(){
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  state.taxon   = p.get("taxon") || null;
  state.tname   = p.get("tname") || "";
  state.iconic  = (p.get("iconic") || "").split(",").filter(Boolean);
  state.unobs   = p.get("unobs") || "";
  // "own" rides in the hash like any other mode — an empty value would read back as the
  // default and quietly put a filter on a shared link that was made without one.
  state.dmode   = DMODES.includes(p.get("dmode")) ? p.get("dmode") : "unobserved";
  state.ssp     = ["1","only"].includes(p.get("ssp")) ? p.get("ssp") : "";
  state.quality = p.has("q") ? p.get("q").split(",").filter(Boolean) : defaultQuality();
  state.precise = p.has("precise") ? p.get("precise") : "precise";
  state.d1      = p.has("d1") ? p.get("d1") : defaultD1();
  state.d2      = p.get("d2") || "";
  state.style   = p.get("s") || "accuracy";
  state.base    = p.get("b") || "light";
  state.cursor  = p.get("cur") || "precise";
  const pinned = p.has("lat") && p.has("lng");
  return {
    z:   p.has("z")   ? +p.get("z")   : ACC_MIN_ZOOM,   // start where accuracy pins load
    zPinned: p.has("z"),                                // an explicit z is the user's, leave it be
    lat: pinned ? +p.get("lat") : LISBON[0],
    lng: pinned ? +p.get("lng") : LISBON[1],
    pinned                                              // a shared link — don't auto-locate over it
  };
}

/* ---------------- specimen label ---------------- */

function fmtYear(d){ return d ? d.slice(0,4) : ""; }

function renderLabel(){
  const bits = [];
  if(state.taxon){
    bits.push(`<span class="sci">${esc(state.tname || "Taxon " + state.taxon)}</span>`);
  } else if(state.iconic.length){
    bits.push(state.iconic.map(v => {
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
  if(state.d1 || state.d2){
    bits.push(esc(fmtYear(state.d1) + " – " + (fmtYear(state.d2) || "now")));
  }
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
  sheet.dataset.open = "1";
  sheetBody.scrollTop = 0;
}
function closeSheet(){
  sheet.dataset.open = "0";
  sheetView = null;
  if(probeMark){ map.removeLayer(probeMark); probeMark = null; }
  if(probeRing){ map.removeLayer(probeRing); probeRing = null; }
  if(probeAccLayer) probeAccLayer.clearLayers();
}
document.getElementById("handle").addEventListener("click", closeSheet);

function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

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

/* ---------------- filters panel ---------------- */

function segHtml(id, opts, current){
  const isActive = v => Array.isArray(current) ? current.includes(v) : v === current;
  return `<div class="seg" id="${id}">` + opts.map(([v,l]) =>
    `<button type="button" data-v="${esc(v)}" aria-pressed="${isActive(v)}">${esc(l)}</button>`
  ).join("") + `</div>`;
}

function filtersHtml(){
  return `
  <div class="eyebrow"><span>Filters</span><button class="linkish" id="reset">Reset all</button></div>

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
    <div class="chips" id="iconicRow">${ICONIC.map(([v,l]) =>
      `<button type="button" data-v="${v}" aria-pressed="${state.iconic.includes(v)}">${l}</button>`).join("")}</div>
  </div>

  <div class="field">
    <label for="unobsInput">Display species for</label>
    <input class="input" id="unobsInput" type="text" autocapitalize="none" autocorrect="off"
           spellcheck="false" placeholder="iNaturalist username" value="${esc(state.unobs)}">
    <div class="seg" id="unobsModeRow">
      <button type="button" data-mode="s" aria-pressed="${state.dmode === "s"}">S Tier</button>
      <button type="button" data-mode="b" aria-pressed="${state.dmode === "b"}">B Tier</button>
      <button type="button" data-mode="c" aria-pressed="${state.dmode === "c"}">C Tier + Audio Only</button>
      <button type="button" data-mode="unobserved" aria-pressed="${state.dmode === "unobserved"}">Unobserved</button>
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
              title="List every species this user has recorded, banded by its best tier tag"
              >List desired species</button>
    </div>
    <p class="field-hint" id="tierListHint" hidden></p>
  </div>

  <div class="field">
    <span class="field-label">Observed between</span>
    <div class="row2">
      <input class="input" id="d1Input" type="date" value="${esc(state.d1)}">
      <input class="input" id="d2Input" type="date" value="${esc(state.d2)}">
    </div>
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

function tierReportUrl(user){
  const p = new URLSearchParams({ u: user });
  if(state.taxon){
    p.set("taxon", state.taxon);
    if(state.tname) p.set("tname", state.tname);
  }
  if(state.iconic.length) p.set("iconic", state.iconic.join(","));
  const hash = location.hash.replace(/^#/, "");
  if(hash) p.set("back", hash);
  return "species.html?" + p.toString();
}

/* ---------------- accuracy pin layer ---------------- */

const accLegend = document.getElementById("accLegend");
const accStatus = document.getElementById("accStatus");
const accBar = document.getElementById("accBar");
const ACC_MIN_ZOOM = 9;

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
    accLayer.clearLayers();
    accStatus.textContent = `Zoom in to load pins (zoom ${zoom} of ${ACC_MIN_ZOOM}+)`;
    return;
  }
  const mine = ++accSeq;
  accStatus.textContent = "Loading…";
  const b = map.getBounds();
  const p = obsParams();
  p.set("swlat", b.getSouth().toFixed(6));
  p.set("swlng", b.getWest().toFixed(6));
  p.set("nelat", b.getNorth().toFixed(6));
  p.set("nelng", b.getEast().toFixed(6));
  p.set("per_page", "200");
  p.set("order_by", "id");
  p.set("order", "desc");

  try{
    const r = await fetch(`${API}/observations?${p.toString()}`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    if(mine !== accSeq || state.style !== "accuracy") return;

    accLayer.clearLayers();
    (d.results || []).forEach(o => {
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
      marker.bindTooltip(
        `${esc(t.preferred_common_name || t.name || "Unidentified")} — ${fmtAcc(known ? acc : null)}`,
        { direction: "top", offset: [0,-4], opacity: .95 }
      );
      marker.on("click", e => {
        L.DomEvent.stopPropagation(e);
        openOut("https://www.inaturalist.org/observations/" + o.id);
      });
      marker.addTo(accLayer);
    });

    const shown = d.results ? d.results.length : 0;
    const total = d.total_results || 0;
    accStatus.textContent = total > shown
      ? `${shown} of ${total.toLocaleString()} in view — zoom in for more`
      : `${shown} in view`;
  }catch(err){
    if(mine !== accSeq) return;
    accStatus.textContent = "Couldn't load pins — pan or zoom to retry.";
  }
}

function applyStyle(){
  if(state.style === "accuracy"){
    if(map.hasLayer(overlay)) map.removeLayer(overlay);
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

  $("doneBtn").addEventListener("click", closeSheet);

  $("reset").addEventListener("click", () => {
    Object.assign(state, { taxon:null, tname:"", iconic:[], quality:defaultQuality(), d1:defaultD1(), d2:"", unobs:"", precise:"precise", dmode:"unobserved", tierExclude:null, ssp:"" });
    commit();
    openFilters();
  });

  // taxon autocomplete
  const input = $("taxonInput"), ac = $("ac");
  let timer = null, seq = 0;

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if(q.length < 2){ ac.hidden = true; ac.innerHTML = ""; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try{
        const r = await fetch(`${API}/taxa/autocomplete?per_page=8&q=${encodeURIComponent(q)}`);
        const d = await r.json();
        if(mine !== seq) return;
        if(!d.results || !d.results.length){ ac.hidden = true; return; }
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
      }catch(e){ ac.hidden = true; }
    }, 280);
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

  $("iconicRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if(!b) return;
    const v = b.dataset.v;
    state.iconic = state.iconic.includes(v)
      ? state.iconic.filter(x => x !== v)
      : [...state.iconic, v];
    if(state.iconic.length){ state.taxon = null; state.tname = ""; }
    commit();
    if(isTierMode()) syncTierExclude().then(commit);
    openFilters();
  });

  // A mouse wheel only emits deltaY, which this single row would otherwise ignore —
  // translate it to horizontal movement. Trackpads sending deltaX are left alone, and
  // the event stays unclaimed at either end so the sheet can still scroll past it.
  $("iconicRow").addEventListener("wheel", e => {
    const row = e.currentTarget;
    if(Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const max = row.scrollWidth - row.clientWidth;
    if(max <= 0) return;
    const next = Math.max(0, Math.min(max, row.scrollLeft + e.deltaY));
    if(next === row.scrollLeft) return;
    e.preventDefault();
    row.scrollLeft = next;
  }, { passive:false });

  $("qualityRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-v]");
    if(!b) return;
    const v = b.dataset.v;
    state.quality = state.quality.includes(v)
      ? state.quality.filter(x => x !== v)
      : [...state.quality, v];
    commit();
    openFilters();
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
  $("unobsModeRow").addEventListener("click", e => {
    const b = e.target.closest("button[data-mode]");
    if(!b) return;
    state.dmode = state.dmode === b.dataset.mode ? "own" : b.dataset.mode;
    [...$("unobsModeRow").children].forEach(c =>
      c.setAttribute("aria-pressed", c.dataset.mode === state.dmode));
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

  const debounced = (el, key) => {
    let t = null;
    el.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { state[key] = el.value.trim(); commit(); }, 420);
    });
  };
  debounced($("d1Input"), "d1");
  debounced($("d2Input"), "d2");

  // Desired-species username: also re-derive level exclusions when it changes.
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

// Tap radius, in km. "precise" keeps a fixed 28px reach; "large" scales with the
// viewport so the circle spans ~80% of its shorter edge (0.4 = 80% diameter), which
// keeps the whole ring on screen at any zoom. The lower bound is only there to keep the
// radius the API sees above zero — deep zoom is exactly where a tap should stay a small
// ring rather than swell into a floor measured in metres.
const MIN_PROBE_KM = 0.001;
function probeRadiusKm(lat, zoom){
  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  const big = state.cursor === "large";
  const size = map.getSize();
  const px  = big ? Math.min(size.x, size.y) * 0.4 : 28;
  const cap = big ? 5000 : 60;
  return Math.min(cap, Math.max(MIN_PROBE_KM, mPerPx * px / 1000));
}

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function fmtDate(iso){
  if(!iso) return "No date";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if(!m) return iso;
  return `${+m[3]} ${MONTHS[+m[2]-1]} ${m[1]}`;
}
// time_observed_at carries the clock time in the observer's own UTC offset, so this reads
// out the hour and minute as written rather than converting to the viewer's timezone.
function fmtTime(iso){
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? `${m[1]}:${m[2]}` : "";
}

function speciesUrl(latlng, km){
  const p = obsParams();
  p.set("lat", latlng.lat.toFixed(6));
  p.set("lng", latlng.lng.toFixed(6));
  p.set("radius", km.toFixed(3));
  p.set("view", "species");
  return "https://www.inaturalist.org/observations?" + p.toString();
}

// The same circle on our own species page: the pin and its radius are the area, and the
// panel's username rides along so the list can tick off what it already holds.
function hereUrl(latlng, km){
  const p = new URLSearchParams({
    tab: "place",
    lat: latlng.lat.toFixed(6),
    lng: latlng.lng.toFixed(6),
    radius: km.toFixed(3)
  });
  if(state.unobs) p.set("u", state.unobs);
  if(state.taxon){
    p.set("taxon", state.taxon);
    if(state.tname) p.set("tname", state.tname);
  }
  if(state.iconic.length) p.set("iconic", state.iconic.join(","));
  const hash = location.hash.replace(/^#/, "");
  if(hash) p.set("back", hash);
  return "species.html?" + p.toString();
}

// The pin, centred in Google Maps — just the coordinates, since a search radius has no
// equivalent there and the tapped point is the only thing worth carrying across.
function gmapsUrl(latlng){
  const p = new URLSearchParams({ api: "1", query: `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}` });
  return "https://www.google.com/maps/search/?" + p.toString();
}

function resultsHtml(list, km, latlng){
  if(!list.length){
    return `<div class="eyebrow"><span>Nothing here</span><button class="linkish" id="toGmaps" data-url="${esc(gmapsUrl(latlng))}">Open in GMaps</button></div>
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
    const accDot = accKnown
      ? `<span class="acc-dot" style="background:${accuracyColor(acc)}"></span>`
      : `<span class="acc-dot acc-dot-unknown"></span>`;
    const meta = [];
    const time = fmtTime(o.time_observed_at);
    meta.push(fmtDate(o.observed_on) + (time ? ", " + time : ""));
    meta.push(`${accDot}${esc(fmtAcc(accKnown ? acc : null))}`);
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
  return `<div class="eyebrow"><span>${list.length} selected &middot; ${esc(fmtAcc(km * 1000))}</span>
    <span class="eyebrow-actions">
      <button class="linkish" id="toHere" data-url="${esc(hereUrl(latlng, km))}">Species here</button>
      <button class="linkish" id="toSpecies" data-url="${esc(speciesUrl(latlng, km))}">On iNat</button>
      <button class="linkish" id="toGmaps" data-url="${esc(gmapsUrl(latlng))}">Open in GMaps</button>
    </span></div>${rows}`;
}

function drawAccuracyCircles(list){
  probeAccLayer.clearLayers();
  if(!list.length || list.length > 3) return;
  list.forEach(o => {
    if(!o.location) return;
    const [lat, lng] = o.location.split(",").map(Number);
    if(!isFinite(lat) || !isFinite(lng)) return;
    const acc = o.public_positional_accuracy != null ? o.public_positional_accuracy : o.positional_accuracy;
    if(acc == null || !isFinite(acc) || acc <= 0) return;
    const col = accuracyColor(acc);
    L.circle([lat, lng], {
      radius: acc, color: col, weight: 1.5, opacity: .85,
      fillColor: col, fillOpacity: .12, interactive: false
    }).addTo(probeAccLayer);
  });
}

async function probe(latlng){
  const km = probeRadiusKm(latlng.lat, map.getZoom());

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

  openSheet("results", `<div class="eyebrow"><span>Reading&hellip;</span></div>
    <div class="state"><div class="state-hint">Fetching observations.</div></div>`);

  const p = obsParams();
  p.set("lat", latlng.lat.toFixed(6));
  p.set("lng", latlng.lng.toFixed(6));
  p.set("radius", km.toFixed(3));
  p.set("per_page", "20");
  p.set("order_by", "observed_on");
  p.set("order", "desc");

  try{
    const r = await fetch(`${API}/observations?${p.toString()}`);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    if(sheetView !== "results") return;
    openSheet("results", resultsHtml(d.results || [], km, latlng));
    wireResults();
    drawAccuracyCircles(d.results || []);
  }catch(err){
    openSheet("results", `<div class="eyebrow"><span>Not loaded</span></div>
      <div class="state">
        <div class="state-lede">The request didn't come back.</div>
        <div class="state-hint">Check the connection and tap the map again.</div>
      </div>`);
  }
}

function wireResults(){
  const toF = document.getElementById("toFilters");
  if(toF) toF.addEventListener("click", openFilters);
  // Three ways out of a pin: this app's own species list, the same circle on iNat, or the
  // bare coordinates in Google Maps.
  ["toHere", "toSpecies", "toGmaps"].forEach(id => {
    const b = document.getElementById(id);
    if(b) b.addEventListener("click", () => openOut(b.dataset.url));
  });
  sheetBody.querySelectorAll(".result").forEach(b => {
    b.addEventListener("click", () => {
      openOut("https://www.inaturalist.org/observations/" + b.dataset.id);
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
  accLayer = L.layerGroup().addTo(map);
  probeAccLayer = L.layerGroup().addTo(map);
  accBar.style.background = legendGradientCss();
  renderCursorRow();
  applyStyle();

  map.on("zoomend", () => { if(state.style === "auto") refreshOverlay(); });
  map.on("moveend", () => {
    writeHash();
    if(state.style === "accuracy") scheduleAccRefresh();
  });
  map.on("click", e => probe(e.latlng));

  renderLabel();
  writeHash();

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
