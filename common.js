"use strict";

/* ---------------- common ground ----------------

   The one file the map and the species report both load, ahead of their own. Two plain
   <script src> tags rather than one, and that is the whole of the change: there is no build
   step here, no bundler and no module, and none is being introduced. Everything below is a
   global and the page scripts find it already declared, so load order is the arrangement —
   this file first, the page's own second.

   What earns a place here is what the two pages genuinely share, which is less than it looks:
   the address of the API and the gate every request to it goes through, the HTML escape, the
   quick-group list, the twelve months, and the species_counts paging loop. Nothing here reads
   a page's own state — this file knows about iNaturalist and about HTML, and nothing about a
   map or a report. That is the line, and it is what keeps a shared file from becoming a place
   things are put to get them out of the way.

   `userScope` looks like it belongs here and does not — and it has since stopped even looking
   like it. The two were once the same five lines over different ground: the map projects
   `state`, the report projects `view`, and the objects are nothing alike beyond the two fields
   each reads. The report's has since grown a branch the map has no counterpart for, the ground
   its `seen=here` switch puts in (see species.js), so the case is now made by the code rather
   than only by the argument. The argument stood on its own first: unifying them meant handing
   the state in at every call site to save five lines, which read worse on both pages than the
   duplication did. Two functions that look alike are not one function, and these two have
   stopped looking alike.

   The gallery does not load this, and should not be made to. It asks iNaturalist in a shape of
   its own — one shelf, paged in sequence, sleeping between pages — and it is deliberately the
   page with nothing to wait for on load; a second script to spare it eight lines is a bad
   trade. It keeps its own `esc` and its own `ICONIC`, kept in step with these by hand. */

const API = "https://api.inaturalist.org/v1";

/* ---------------- asking iNaturalist ----------------

   One door for every request to iNaturalist, from either page, because both ask in bursts
   rather than one at a time.

   The species report is the heavier of the two: a place-tab load fans out to eight paged
   chains at once — runPlace starts three, one of them standingLookup, which starts four more,
   one of THOSE audioOnlySpeciesIds, which starts two — and each chain is good for twenty
   pages. The map asks less at once but asks often: a tier mode walks the levels, the accuracy
   layer asks two questions at once, and a dragged map re-asks all of it on every settle. Fired
   flat out, either is well past what a free, shared, unauthenticated API will answer, and
   neither page had a reply to a refusal — every call site threw on the first non-ok status, so
   one 429 in the middle of a life list took the whole report down with it, and on the map the
   layer simply stayed empty.

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

   The counters below are one document's counters, which is one page's: the two scripts that
   load this are never in the same document, so sharing the file shares the code and not the
   queue.

   The Wikidata lookup behind the eBird links does not come through here. It is a different
   service with a different temper and a retry of its own (see ebirdCodesRetrying in
   species.js), and putting the two in one queue would only let a long species list hold up the
   links, or the reverse. The gallery's paging stays outside it for the reason given above. */

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

/* ---------------- writing it down ---------------- */

// Both pages build their markup as strings and hand it to innerHTML, so anything coming back
// from iNaturalist — a name, a note, a place — is escaped on the way in. Five characters
// rather than the three that suffice between tags: quotes are escaped too, so a value is safe
// in an attribute as well as in text, and no call site has to know which it is writing into.
// null and undefined come out empty rather than as the words.
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// The quick groups, in the order both pages offer them — one vocabulary for "kind of thing"
// rather than one per page. The gallery offers the same list from its own copy.
const ICONIC = [
  ["Plantae","Plants"],["Aves","Birds"],["Insecta","Insects"],["Fungi","Fungi"],
  ["Arachnida","Arachnids"],["Mammalia","Mammals"],["Reptilia","Reptiles"],
  ["Amphibia","Amphibians"],["Actinopterygii","Fish"],["Mollusca","Molluscs"]
];

// The twelve, once: the map's month chips and the label's reading of them, the report's month
// row and its heading — and, upper-cased, the date on every result row.
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ---------------- counting species ---------------- */

// Page through species_counts and return the raw {taxon, count} rows.
//
// This one loop now carries what each page separately asked of it, and the two asks are both
// still here because neither was decoration.
//
// `stale` is the map's. A dragged map re-asks everything on every settle, so a load nobody is
// waiting for should stop where it is rather than page politely to the end of a list that will
// be thrown away. It is polled between pages and the rows so far are handed back. The report
// has no equivalent — its tabs are asked for rather than dragged into being — and passes
// nothing, which leaves the poll unreached.
//
// `verifiable` is the report's, and it is three-valued rather than two. Say nothing and casual
// records are dropped: captive and cultivated plants, undated and unplaced records. A species
// known here only from those leaves the list entirely rather than sitting in it with a count of
// one. `verifiable` is iNat's own shorthand for research plus needs-ID and is what their
// species view applies, so it is the right default for a list of what is here.
//
// Pass a value to send that value instead — the report's tag lookup passes "any" to reach into
// casual records, because a tier tag is a judgement about a photograph and stands wherever that
// photograph sits. Pass it empty and no `verifiable` is sent at all, which is a third thing and
// not a spelling of either: it is what the map's tag lookup has always done, and it is kept
// doing it here rather than quietly acquiring a filter it never had. Empty meaning "not in the
// address" is the reading speciesUrl already gives it.
async function speciesCounts(params, stale){
  const out = [];
  for(let page = 1; page <= 20; page++){
    const p = new URLSearchParams(params);
    if(!p.has("verifiable")) p.set("verifiable", "true");
    else if(!p.get("verifiable")) p.delete("verifiable");
    p.set("per_page", "500");
    p.set("page", String(page));
    const d = await apiGet(`${API}/observations/species_counts?${p.toString()}`);
    if(stale && stale()) return out;
    (d.results || []).forEach(x => { if(x.taxon && x.taxon.id) out.push(x); });
    if(page * 500 >= (d.total_results || 0)) break;
  }
  return out;
}
