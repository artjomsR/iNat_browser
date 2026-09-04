/* ---------------- page address ----------------

   The gallery is one person's photographs, so its whole input lives in the query string and
   it can be bookmarked, shared, and reloaded on its own:

     gallery.html?user=USER
     gallery.html?user=USER&tag=b&show=all
     gallery.html?user=USER&view=birds
     gallery.html?user=USER&obs=1
     gallery.html?user=USER&photo=PHOTO_ID

   `user` is the iNaturalist login. `u` and `user_id` are accepted as spellings of the same
   thing, because the species page uses one and iNaturalist's own addresses use the other.
   With no username at all the page asks for one and writes the answer back here rather than
   guessing at somebody.

   `tag` is the tier tag an observation must carry (default `s`), `grade` the quality grades
   to accept, and `show=all` turns the unseen filter off. The rest of the query is fixed:
   verifiable observations with photos, newest first.

   `obs=1` re-reads the same shelf rather than asking a new question: hang it observation by
   observation — each row carrying that observation's name and research grade on the left and
   that observation's photographs after them — instead of as one wall of photographs. Like the
   unseen filter it rearranges what has already been fetched, so it neither reloads nor
   refetches; the address only carries it because a shared link should land on the reading it
   was taken in.

   `view` is which shelf: `highlights`, the default, is the tagged one the gallery was built
   for; `view=birds` drops the tag and hangs this user's birds instead; `view=all` drops both
   the tag and the Aves scoping and hangs every verifiable observation. Changing it reloads the
   page rather than re-filtering, because it is a different question put to iNaturalist rather
   than a different slice of the same answer. What has been seen is remembered per photograph,
   so a picture met on one shelf is already seen on the other.

   `iconic` narrows either of those shelves to one or more iconic taxa (`Aves`, `Mammalia`,
   and so on — iNaturalist's own names, comma-separated), the same key and the same quick
   groups as the species report's. It is a slice of the answer already on the page rather
   than a new question, so it filters rather than reloads. It only applies outside the
   highlights shelf, which is one tag rather than a spread of kinds, so the row that sets it
   is hidden there too. Missing from the address it starts however the shelf is already
   scoped — just `Aves` on the birds shelf, every group on all's — so the address only has to
   say anything once that starting point is changed; switching shelves drops it, since one
   shelf's starting point is not the other's. A picked taxon (see `taxon` below) replaces
   that starting point rather than sitting inside it, so it starts unrestricted too, the same
   as all's — otherwise the birds shelf's own `Aves` default would silently filter out
   whatever the taxon search was asked for.

   `d1` and `d2` narrow either shelf to observations made from `d1` through `d2` (each
   YYYY-MM-DD, either end may be left off), and `place` narrows to observations whose place
   name contains that text, case-insensitive. Both dates and the place name arrive on every
   observation whether anyone asks to see them or not, so — like `iconic` — these read the
   shelf already on the page rather than putting a new question to iNaturalist, and so filter
   rather than reload. Same reasoning, same restriction: meaningless on the tagged shelf, so
   hidden there too. `place_id` is the precise form of `place`, an iNaturalist place-boundary
   id rather than a spelling of one — set when a suggestion is picked rather than typed (see
   the "place search" doc comment further down), and checked against `place_ids` rather than
   `place_guess`, since a canonical gazetteer name is not reliably a substring of what any
   given observation's own place text happens to say.

   `taxon` and `tname` are the odd one out in that list: a specific species or other exact
   taxon, picked from the same free-text search index.js offers as `taxonInput`. Unlike the
   three above, this can't be answered from what's already on the page — the shelf only ever
   learns a photo's scientific name and its coarse iconic class, and telling a genus's
   photographs apart from its neighbours' needs the ancestry iNaturalist keeps and this page
   doesn't. So picking one reloads the shelf scoped to `taxon_id`, the same as switching shelves
   does, rather than filtering what's already hanging. `tname` only ever rides along to save the
   page a lookup on load — it's what's shown, `taxon` (the id) is what's asked for.

   `photo` is one photograph on that shelf, named by its iNaturalist photo id — the same id
   "seen" is kept against, so it survives observations being edited or re-ordered. It is
   written into the address whenever the full-screen view is open and taken out again when it
   closes, so the address bar always names the picture on screen and can simply be copied. A
   link opened elsewhere hangs the same wall and opens that photograph on it, waiting for it to
   arrive if the wall is still being hung. Being named in the address outranks the unseen
   filter: if the reader here has already seen the picture that the sender had not, the shelf
   is shown whole rather than the link failing.

   What has already been seen is the one piece of state too long for an address, and it
   belongs to this browser rather than to the link, so it lives in localStorage — see
   "what has been seen" below. */

// Same quick groups as the species report's, so the two pages offer one vocabulary for
// "kind of thing" rather than two.
var ICONIC = [
  ['Plantae', 'Plants'], ['Aves', 'Birds'], ['Insecta', 'Insects'], ['Fungi', 'Fungi'],
  ['Arachnida', 'Arachnids'], ['Mammalia', 'Mammals'], ['Reptilia', 'Reptiles'],
  ['Amphibia', 'Amphibians'], ['Actinopterygii', 'Fish'], ['Mollusca', 'Molluscs']
];

/* ---------------- config from the URL ---------------- */

var qs    = new URLSearchParams(location.search);
var user  = (qs.get('user') || qs.get('u') || qs.get('user_id') || '').trim();
var tag   = (qs.get('tag') || 's').trim();
var grade = qs.get('grade') || 'needs_id,research';
// Which half of the shelf to show. Unseen is the default because the gallery is meant to be
// worked through rather than re-read; `?show=all` is the way back to the whole thing.
var mode  = qs.get('show') === 'all' ? 'all' : 'unseen';
// Whether the wall is hung observation by observation (`obs=1`, see the doc comment up top)
// rather than as one wall of photographs. A display choice over the photos already fetched,
// so toggling it rehangs without refetching — the same deal the unseen filter's own toggle
// makes, which is why it sits beside it.
var byobs = qs.get('obs') === '1';
// Which shelf. Anything unrecognised falls back to the tagged one this page was built around.
var view  = qs.get('view') === 'birds' ? 'birds' : qs.get('view') === 'all' ? 'all' : 'highlights';
// Switching shelves is a reload (see the doc comment above viewSel's change handler), so this
// is settled for the whole life of the page: birds and all get a header that scrolls off
// instead of staying pinned, since those two can grow tall enough to crowd the wall. The
// by-observation reading is the exception — a list of tall rows the reader is working through,
// and taking the filter bar away from it would mean scrolling back up every time. So once
// `obs=1` is on, the header stays pinned whatever the shelf.
document.body.classList.toggle('loose-header', view !== 'highlights');
document.body.classList.toggle('byobs', byobs);
// A specific taxon, picked from the free-text search rather than the ten quick groups. Read
// straight off the address on load because picking one is a reload, same as switching shelves —
// see the doc comment above for why this one can't just filter the shelf already on the page.
// Read before `iconic` below: picking a taxon replaces the shelf's own default scope, so that
// default (`Aves` on the birds shelf) needs to know a taxon is standing in for it already.
var taxon = view === 'highlights' ? '' : (qs.get('taxon') || '').trim();
var tname = view === 'highlights' ? '' : (qs.get('tname') || '').trim();
// Narrows the shelf to a set of iconic taxa; meaningless on the tagged shelf, so it is dropped
// there. Starts however each shelf is already scoped: birds is Aves and nothing else, since
// that's what iNaturalist was asked for; all has no scope of its own, so every group starts
// checked to match. A picked taxon is its own scope, replacing the shelf's, so it starts
// unrestricted the same as all does — the address only ever names an exception to that
// starting point.
var iconic = view === 'highlights' ? [] :
  qs.has('iconic') ? qs.get('iconic').split(',').filter(Boolean) :
  (view === 'birds' && !taxon) ? ['Aves'] : ICONIC.map(function (p) { return p[0]; });
// Date range and place text, the other two narrowings the row offers — same restriction as
// iconic, and for the same reason: the tagged shelf is one tag, not a spread of dates or places.
var dateFrom = view === 'highlights' ? '' : (qs.get('d1') || '').trim();
var dateTo   = view === 'highlights' ? '' : (qs.get('d2') || '').trim();
var place    = view === 'highlights' ? '' : (qs.get('place') || '').trim();
// A place picked from the suggestions list (see the "place search" doc comment further down)
// is pinned to iNaturalist's own boundary for it rather than trusted to reappear as text —
// `place` is what's shown, `place_id` is what's actually checked against each photo's own
// `place_ids`. Typed rather than picked, `place` carries no id and falls back to the plain
// substring search this field has always otherwise done.
var placeId   = view === 'highlights' ? null : (Number(qs.get('place_id')) || null);
// The exact text that id is honest for. If the field ever reads anything else the id no
// longer names what's on screen and is dropped — see the input handler below.
var placeName = placeId ? place : '';
// The photograph the link asks to have open, if any. Cleared once it has been opened, or once
// the reader has taken the wall somewhere of their own.
var wanted = (qs.get('photo') || '').trim();

var PER_PAGE = 200;
var MAX_PAGES = 50;

var all    = [];   // every photo fetched, whatever the filter says
var photos = [];   // the ones on screen — what the focus view steps through
var cursor = 0;
// True once load() has stopped asking for more — the shelf ran out, the connection failed,
// whatever. relist() checks this before calling nothingNew(): a filter picked while pages are
// still arriving can only honestly report what's true of the pages already in, not the shelf
// as a whole, and saying so anyway is what made a place picked mid-fetch look broken.
var loadDone = false;

var grid     = document.getElementById('grid');
var taxaFilter = document.getElementById('taxaFilter');
var taxonSearch  = document.getElementById('taxonSearch');
var taxonInput     = document.getElementById('taxonInput');
var taxonAc        = document.getElementById('taxonAc');
var taxonSel       = document.getElementById('taxonSel');
var taxonSelName   = document.getElementById('taxonSelName');
var taxonParentBtn = document.getElementById('taxonParent');
var taxonClear     = document.getElementById('taxonClear');
var narrowRow = document.getElementById('narrow');
var dateFromEl = document.getElementById('dateFrom');
var dateToEl   = document.getElementById('dateTo');
var placeEl    = document.getElementById('placeInput');
var placeWrap  = document.getElementById('placeWrap');
var placeAc    = document.getElementById('placeAc');
var filters  = document.getElementById('filters');
var forget   = document.getElementById('forget');
var obsCheck = document.getElementById('byObs');
var picker   = document.getElementById('picker');
var viewSel  = document.getElementById('view');
var loading  = document.getElementById('loading');
var statusEl = document.getElementById('status');
var tally    = document.getElementById('tally');
var focusEl  = document.getElementById('focus');
var lo       = document.getElementById('lo');
var hi       = document.getElementById('hi');
var counter  = document.getElementById('counter');
var binomialName = document.getElementById('binomialName');
var rgBadge = document.getElementById('rgBadge');
var idCountNum = document.getElementById('idCountNum');
var idCount = document.getElementById('idCount');
var metaline = document.getElementById('metaline');

/* ---------------- helpers ---------------- */

var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// iNaturalist serves one address per size, differing only in that word.
function sized(url, size) {
  if (!url) return '';
  return url.replace(/\/(square|small|medium|large|original)\./, '/' + size + '.');
}

function prettyDate(iso) {
  if (!iso) return '';
  var bits = String(iso).slice(0, 10).split('-');
  if (bits.length !== 3) return '';
  return Number(bits[2]) + ' ' + (MONTHS[Number(bits[1]) - 1] || '') + ' ' + bits[0];
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// The same five characters the map and the report escape, and the same reading of null. This
// page keeps its own copy rather than take a second script for eight lines — it is the page
// with nothing to wait for on load — but a copy that says something different about what is
// safe to write into a page is worse than no copy at all. Quotes matter even though every
// value here currently lands between tags: the next line that writes one into an attribute
// should not have to know that this page's escape was the weaker one. See common.js.
function esc(s) {
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; });
}

// The whole-page message: a heading in the serif, then a line of explanation which may carry
// its own markup, since every caller writes one.
function say(title, body) {
  statusEl.hidden = false;
  statusEl.innerHTML = '<strong></strong><span></span>';
  statusEl.querySelector('strong').textContent = title;
  statusEl.querySelector('span').innerHTML = body;
}

/* ---------------- the address ----------------

   `qs` is this page's memory, so every view it can be put into is written back into it and any
   link taken from the bar comes back to the same place. replaceState rather than a push:
   stepping along a wall of photographs is looking around one page, not a walk through several,
   and nobody wants forty presses of Back to get out of a gallery. */

var addrPending = null;

function writeAddress() {
  addrPending = null;
  var query = qs.toString();
  try {
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
  } catch (err) {
    /* A browser that won't rewrite the address here — the page still works, the bar is
       just a step behind. */
  }
}

// Batched, like the seen list: a fast run through the wall would otherwise rewrite the address
// once a keypress, and browsers put a ceiling on how often that may be done. The address only
// has to be right once the stepping stops.
function addressSoon() {
  if (addrPending) return;
  addrPending = setTimeout(writeAddress, 400);
}

function addressNow() {
  if (addrPending) clearTimeout(addrPending);
  writeAddress();
}

// The whole address as it stands, ready to be handed to somebody: the current query against
// this page, taken from `qs` rather than the bar, which may still be a moment behind it.
function shareLink() {
  return location.href.replace(/[?#].*$/, '') + '?' + qs.toString();
}

/* ---------------- what has been seen ----------------

   A photo counts as seen once it has been in front of the reader: scrolled into the grid, or
   opened full-screen. Kept per user in localStorage, so the next visit can start where this
   one stopped.

   `seenAtLoad` is the snapshot the filter reads, and `seen` is the live set that grows as the
   reader scrolls. Filtering against the live one would pull tiles out from under them
   mid-scroll: what is seen now is dropped next time the page is opened, not now. */

var STORE = 'inat.gallery.seen.';
var storeKey = STORE + user.toLowerCase();

function readSeen() {
  try {
    var raw = localStorage.getItem(storeKey);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (err) {
    return new Set();   // private mode, or somebody else's JSON: start clean
  }
}

var seen = readSeen();
var seenAtLoad = new Set(seen);
var pending = null;

function write() {
  try {
    localStorage.setItem(storeKey, JSON.stringify(Array.from(seen)));
  } catch (err) {
    /* No room, or no storage at all. The gallery still works, it just forgets. */
  }
}

// Batched: a flick of the thumb marks a screenful, and every mark rewrites the whole list.
function persist() {
  if (pending) return;
  pending = setTimeout(function () { pending = null; write(); }, 600);
}

function flush() {
  if (!pending) return;
  clearTimeout(pending);
  pending = null;
  write();
}

function markSeen(photo) {
  if (!photo || seen.has(photo.key)) return;
  seen.add(photo.key);
  if (forget.hidden) forget.hidden = false;
  persist();
}

// A phone can close this tab without ever firing `unload`, so the last few marks are written
// on the way out of sight instead.
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') flush();
});

// Half the tile on screen, so the row peeking above the fold is not ticked off before it has
// been looked at.
var watcher = 'IntersectionObserver' in window
  ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.intersectionRatio < 0.5) return;
        watcher.unobserve(entry.target);
        markSeen(entry.target._photo);
      });
    }, { threshold: 0.5 })
  : null;

function watch(tile, photo) {
  if (!watcher) return;   // no observer: opening a photo is then the only way to mark it
  tile._photo = photo;
  watcher.observe(tile);
}

/* ---------------- fetching ---------------- */

function endpoint(page) {
  var p = new URLSearchParams({
    user_id: user,
    verifiable: 'true',
    photos: 'true',
    reviewed: 'any',
    quality_grade: grade,
    order_by: 'observed_on',
    order: 'desc',
    per_page: String(PER_PAGE),
    page: String(page)
  });

  // The three shelves differ by: a tag search, a whole class of animal, or nothing at all.
  // Newest first either way, so "most recent" needs nothing added. Birds is Aves the way
  // `iconic` starts as ['Aves'] on that shelf (see the doc comment up top) — a default the
  // reader can narrow away from, not a hard scope stacked underneath whatever they pick next.
  // A taxon search is the more deliberate of the two, so it replaces the default rather than
  // joining it: search a lizard while sitting on the birds shelf and the answer is that
  // lizard's photos, not the empty set Aves + taxon_id would otherwise silently return.
  if (taxon) p.set('taxon_id', taxon);
  else if (view === 'birds') p.set('iconic_taxa', 'Aves');
  else if (view === 'all') { /* every verifiable observation, no further narrowing */ }
  else { p.set('q', tag); p.set('search_on', 'tags'); }

  return 'https://api.inaturalist.org/v1/observations?' + p.toString();
}

// One observation can carry several photos, and the gallery hangs each of them: this is a
// wall of pictures, not a list of records.
function collect(results) {
  var fresh = [];
  results.forEach(function (obs) {
    (obs.photos || []).forEach(function (ph) {
      if (!ph.url) return;
      fresh.push({
        // What "seen" is remembered against. The photo id is stable across observations being
        // edited or re-ordered; the url only stands in if the id ever goes missing.
        key: String(ph.id || ph.url),
        url: ph.url,
        obsId: obs.id,
        name: (obs.taxon && obs.taxon.name) || '',
        common: (obs.taxon && obs.taxon.preferred_common_name) || '',
        iconic: (obs.taxon && obs.taxon.iconic_taxon_name) || '',
        // iNaturalist's own verification state for the observation — 'research', 'needs_id',
        // or 'casual'. Not to be confused with `grade` above, which is what the *fetch itself*
        // was scoped to ask for.
        qualityGrade: obs.quality_grade || '',
        // How many identifications the observation has drawn — current ones only. Every
        // identification ever made stays in `obs.identifications` even after being withdrawn
        // (superseded by a later one from the same person), so `identifications_count` on its
        // own counts those too; filtering to `current` is what matches the number iNaturalist
        // itself shows.
        idCount: obs.identifications ?
          obs.identifications.filter(function (id) { return id.current; }).length :
          (obs.identifications_count || 0),
        date: obs.observed_on || (obs.observed_on_details && obs.observed_on_details.date) || '',
        place: obs.place_guess || '',
        // The boundaries iNaturalist itself has already worked out this observation falls
        // inside — arrives on every observation the same way place_guess does. A picked place
        // is checked against this, not against place_guess's free text (see matchesNarrow()).
        placeIds: obs.place_ids || []
      });
    });
  });
  return fresh;
}

/* ---------------- the grid ---------------- */

// Everything that arrives is kept, whatever the filter; the filter only decides which of it
// becomes a tile. A skipped photo never becomes an <img>, so its file is never asked for.
function paint(fresh) {
  for (var i = 0; i < fresh.length; i++) all.push(fresh[i]);
  render(fresh);
}

// Whether any of the when/where/kind row is narrowing the wall at all. All three are only
// offered off the highlights shelf, which is one tag rather than a spread of kinds, dates, or
// places: `iconic` reads empty there because the question was never put, not because every
// answer was unticked, and `dateFrom`/`dateTo`/`place` are forced empty at the top of the file
// for the same reason. Where the row is offered, an empty taxa list means the reader really has
// switched every group off, and an empty wall is the honest answer to that.
function refining() {
  return view !== 'highlights' &&
    (iconic.length < ICONIC.length || !!dateFrom || !!dateTo || !!place || !!placeId);
}

// One photo's answer to the whole row — taxa, date range, and place together, so render() and
// refinedCount() can never read "matches" two different ways. `view === 'highlights'` short-
// circuits the rest, same guard refining() uses, since none of the three fields are ever set
// there to begin with.
function matchesNarrow(photo) {
  if (view === 'highlights') return true;
  if (iconic.length < ICONIC.length && iconic.indexOf(photo.iconic) === -1) return false;
  // ISO dates compare correctly as strings; an undated photo fails either bound rather than
  // slipping through one, which is the honest read of "no date" against a range that was asked
  // for.
  if (dateFrom && (!photo.date || photo.date < dateFrom)) return false;
  if (dateTo && (!photo.date || photo.date > dateTo)) return false;
  if (placeId) {
    if (photo.placeIds.indexOf(placeId) === -1) return false;
  } else if (place && (!photo.place || photo.place.toLowerCase().indexOf(place.toLowerCase()) === -1)) {
    return false;
  }
  return true;
}

// One photograph as a tap target, wherever it hangs — the wall's uniform squares, or one in an
// observation's own run. `big` is the sole photograph of an observation filling the whole
// photos column, which asks for a fetch above the wall's standard small square; its rare case,
// so the usual tile stays exactly as cheap as it always was.
function tileFor(photo, index, big) {
  var tile = document.createElement('button');
  tile.className = 'tile' + (mode === 'all' && !seenAtLoad.has(photo.key) ? ' fresh' : '');
  tile.setAttribute('aria-label', photo.common || photo.name || 'Photo');

  var img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  img.src = sized(photo.url, big ? 'medium' : 'small');
  img.addEventListener('load', function () { img.classList.add('in'); });

  tile.appendChild(img);
  tile.addEventListener('click', function () { openPhoto(index); });
  watch(tile, photo);
  return tile;
}

// The identification count, shield-and-number — the same reading the full-screen label gives
// every photograph, built by the one function so the two never disagree about what a count
// looks like. (The label's own copy stays in the HTML, where the address bar's markup lives.)
function idBadge(n) {
  var badge = document.createElement('span');
  badge.className = 'idcount';
  badge.setAttribute('aria-label', n + (n === 1 ? ' identification' : ' identifications'));
  badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z"></path></svg>' +
    '<span>' + n + '</span>';
  return badge;
}

// One observation's label in the by-observation reading: what it is, then what the photos
// carry with them — iNaturalist's own grade, and the identification count beside it. Same
// voice as the full-screen label's, sized down to a caption that has to sit in a phone's
// width. All of an observation's photographs share these, so the first one standing in speaks
// for the row.
function obsHead(p) {
  var head = document.createElement('div');
  head.className = 'obs-head';

  // The name is the row's link to the observation it heads, same address and same new-tab
  // convention as the full-screen label's "View on iNaturalist".
  var name = document.createElement('a');
  name.href = 'https://www.inaturalist.org/observations/' + p.obsId;
  name.target = '_blank';
  name.rel = 'noopener';
  // A common name reads as a name; a scientific name with none reads as one too, but in the
  // serif italics the page reserves for science. "Unidentified" is the full-screen label's
  // own word for a photograph whose observation names nothing.
  name.className = 'obs-name' + (p.common ? '' : ' sci');
  name.textContent = p.common || p.name || 'Unidentified';
  head.appendChild(name);

  if (p.common && p.name) {
    var sci = document.createElement('div');
    sci.className = 'obs-sci';
    sci.textContent = p.name;
    head.appendChild(sci);
  }

  // When and where the observation was made — the same two facts the full-screen label's
  // metaline carries, read here off the row instead of a click into a photo.
  if (p.date || p.place) {
    var when = document.createElement('div');
    when.className = 'obs-when';
    when.textContent = [p.date ? prettyDate(p.date) : '', p.place || ''].filter(Boolean).join(' · ');
    head.appendChild(when);
  }

  var status = document.createElement('div');
  status.className = 'obs-status';
  var grade = document.createElement('span');
  if (p.qualityGrade === 'research') {
    grade.className = 'rg';
    grade.textContent = 'RG';
  } else {
    // Needs ID is the state this page is normally scoped to fetch, so it earns its own dim
    // spelling rather than going unmarked; casual is only reachable by asking for it.
    grade.className = 'nd';
    grade.textContent = p.qualityGrade === 'casual' ? 'Casual' : 'Needs ID';
  }
  status.appendChild(grade);
  status.appendChild(idBadge(p.idCount));
  head.appendChild(status);
  return head;
}

function render(list) {
  // The photographs that survive the filters, in their fetched order, with their place on the
  // on-screen list already settled — one pass, so the two readings of "what is here" (the
  // wall, and the rows of the by-observation mode) can never disagree about it.
  var shown = [];
  list.forEach(function (photo) {
    var old = seenAtLoad.has(photo.key);
    if (mode === 'unseen' && old) return;
    if (!matchesNarrow(photo)) return;
    shown.push({ photo: photo, at: photos.length });
    photos.push(photo);
  });

  var frag = document.createDocumentFragment();

  if (byobs) {
    // One observation's photographs arrive together (see collect()), so the shelf in date
    // order is already grouped: each run of a single observation id is one row. The row leads
    // with the observation's name and grade, then hangs that observation's own photographs
    // after it, wrapping at three to a line. Fewer than three photographs share the column
    // between them instead, so a one-photograph observation reads as one large picture beside
    // its label rather than as a lonely third of a row.
    var start = 0;
    for (var i = 1; i <= shown.length; i++) {
      if (i < shown.length && shown[i].photo.obsId === shown[start].photo.obsId) continue;

      var n = i - start;
      var row = document.createElement('div');
      row.className = 'obs';
      row.appendChild(obsHead(shown[start].photo));

      var pics = document.createElement('div');
      pics.className = 'obs-pics';
      pics.style.gridTemplateColumns = 'repeat(' + Math.min(n, 3) + ', minmax(0, 1fr))';
      for (var k = start; k < i; k++) {
        pics.appendChild(tileFor(shown[k].photo, shown[k].at, n === 1));
      }
      row.appendChild(pics);
      frag.appendChild(row);

      start = i;
    }
  } else {
    // The wall: one square after another, nothing between them.
    shown.forEach(function (it) { frag.appendChild(tileFor(it.photo, it.at)); });
  }

  grid.appendChild(frag);
  retally();
  drawRail();
  openWanted();
}

// How many of `all` match the when/where/kind row as it currently stands — the denominator the
// tally and the "show all" button both need once any of the three has narrowed the shelf.
function refinedCount(list) {
  if (!refining()) return list.length;
  var n = 0;
  for (var i = 0; i < list.length; i++) if (matchesNarrow(list[i])) n++;
  return n;
}

function retally() {
  // The unseen count needs its denominator to mean anything: how many are left, out of every
  // photo on the shelf (or the taxon, once one is picked). In the whole view those two numbers
  // are the same one.
  tally.textContent = mode === 'unseen'
    ? photos.length + ' / ' + refinedCount(all) + ' unseen'
    : photos.length + ' photos';
}

// Redraw from what has already been fetched: the filter changes what is on screen, never
// what has to be asked for again.
function relist() {
  if (watcher) watcher.disconnect();
  grid.innerHTML = '';
  photos = [];
  render(all);
  // An empty tag is not the filter's doing, so that message is left where it is.
  if (all.length) {
    statusEl.hidden = true;
    // Nothing matched — but only a finished load can say that honestly. Picked mid-fetch, the
    // photo that would have matched may simply not have arrived yet, and saying "nothing here"
    // over a wall still being hung is what made a place picked while it loaded look broken
    // rather than just early. load()'s own end-of-run check makes the real call once fetching
    // has actually stopped, and every page still to come renders into the grid same as ever
    // regardless of what this said.
    if (!photos.length && loadDone) nothingNew();
  }
}

async function load() {
  loading.hidden = false;

  for (var page = 1; page <= MAX_PAGES; page++) {
    var payload;
    var pageStart = Date.now();

    try {
      var res = await fetch(endpoint(page), { headers: { Accept: 'application/json' } });

      if (res.status === 429) {
        await sleep(4000);
        page--;
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      payload = await res.json();
    } catch (err) {
      loading.hidden = true;
      loadDone = true;
      // `all`, not `photos`: photos already fetched and then filtered out still mean the
      // connection was fine, and shouldn't be reported as a dead one.
      if (all.length === 0) {
        // The page itself may well have come out of a cache (see sw.js) — the wall never
        // does, so a dead line here means an empty wall and should say so in those words
        // rather than send the reader to check a username that is probably fine.
        if (navigator.onLine === false) {
          say('No connection',
              'The app is cached; the photographs aren&rsquo;t &mdash; they come from iNaturalist ' +
              'as you scroll. Reload when the signal is back.');
        } else {
          say('Could not reach iNaturalist',
              'The request failed &mdash; check the connection and reload. If it keeps failing, the username may be wrong.');
        }
      }
      return;
    }

    var results = payload.results || [];
    paint(collect(results));

    if (results.length < PER_PAGE) break;
    // iNaturalist paces requests by when each one goes out, not when it comes back, so the
    // wait only needs to cover what the fetch itself hasn't already spent — not a flat 1100ms
    // stacked on top of however long that took.
    await sleep(Math.max(0, 1100 - (Date.now() - pageStart)));
  }

  loadDone = true;
  loading.hidden = true;

  if (photos.length === 0) {
    if (all.length) nothingNew();
    // A picked taxon explains an empty shelf on its own terms, whichever of the three shelves
    // it was picked on top of.
    else if (taxon)
      say('Nothing found', 'No photographed observations of <b>' +
          esc(tname || ('taxon ' + taxon)) + '</b> found for <b>' + esc(user) + '</b>.');
    // The tag is the highlights shelf's doing, so only that shelf explains itself by it.
    else if (view === 'birds')
      say('No birds', 'No photographed bird observations found for <b>' + esc(user) + '</b>. ' +
                      'The username may be wrong.');
    else if (view === 'all')
      say('No observations', 'No photographed observations found for <b>' + esc(user) + '</b>. ' +
                      'The username may be wrong.');
    else say('Nothing tagged “' + tag + '”',
             'No observations found for <b>' + esc(user) + '</b> with that tag. ' +
             'Change the username or tag in the address:<br><code>?user=' + esc(user) +
             '&amp;tag=' + esc(tag) + '</code>');
  }
}

/* ---------------- the date rail ----------------

   The wall runs newest to oldest and every photograph arrived with its date on it, so where
   the years fall is already known: the rail is a reading of the page, not a second question
   put to iNaturalist. Nothing is fetched to draw it.

   Nor is anything measured tile by tile. The grid is a fixed number of squares to a row, so a
   photograph's place in the document is arithmetic on its index — two measurements draw the
   whole rail, however many thousand pictures are hanging on it. */

var rail    = document.getElementById('rail');
var track   = document.getElementById('track');
var nowChip = document.getElementById('now');
var masthead = document.querySelector('header');

var stops = [];    // one per month on the wall, newest first: where it starts, and what to call it
var span  = 0;     // how far the page scrolls, which is the length the rail stands for
var head  = 0;     // the pinned header's height on the highlights shelf, else 0 — see measure()

var MIN_LABEL = 18;   // px of rail a year needs to itself
var MIN_TICK  = 9;    // and a month dot, which never crowds a year out

// Where each month begins. Dates are ISO, so they compare as strings, and the wall being in
// descending order means anything not older than the last is a repeat or a stray — either way
// not the start of a month, and not a mark.
function findStops() {
  stops = [];
  var last = '';

  for (var i = 0; i < photos.length; i++) {
    var d = photos[i].date;
    if (!d || d.length < 7) continue;
    var month = d.slice(0, 7);
    if (last && month >= last) continue;
    last = month;
    stops.push({
      at: i,
      year: d.slice(0, 4),
      label: MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4)
    });
  }
}

// Each stop's place in the scroll: `y` is where it would sit under the header, and `f` is that
// as a fraction of the rail. Answers whether there is a rail worth drawing at all.
function measure() {
  var first = grid.firstElementChild;
  if (!first) return false;

  var style = getComputedStyle(grid);
  var cols  = style.gridTemplateColumns.split(/\s+/).filter(Boolean).length || 3;
  var box   = first.getBoundingClientRect();
  var pitch = box.height + (parseFloat(style.rowGap) || 0);
  var top   = box.top + scrollY;

  // Off the highlights shelf the header scrolls away with everything else, so nothing needs
  // to be held clear of it and a stop's row can go all the way to the top of the viewport.
  head = view === 'highlights' ? masthead.offsetHeight : 0;
  span = document.documentElement.scrollHeight - innerHeight;
  document.documentElement.style.setProperty('--railtop', head + 'px');

  // Half a screen of scroll, or a single month, is a wall with nothing to scrub through.
  if (span < 400 || pitch <= 0 || stops.length < 2) return false;

  stops.forEach(function (s) {
    s.y = top + Math.floor(s.at / cols) * pitch - head;
    // Clamped: the last screenful cannot be scrolled past, so what is in it shares the end of
    // the rail rather than running off it. `y` stays unclamped — the chip reads that instead.
    s.f = Math.max(0, Math.min(1, s.y / span));
  });

  return true;
}

function drawRail() {
  // A photograph is full-screen and the rail is display:none behind it, so it would measure
  // nothing and stack every mark at the top of a track no longer there. The wall goes on being
  // hung underneath; closing the view draws the rail against it then.
  if (document.body.classList.contains('focused')) return;

  // The rail is arithmetic over a fixed grid — so many squares to a row, so a photograph's
  // place in the scroll is its index divided by that count. The by-observation reading wraps
  // each row's own photographs (one alone, two to a line), which is no fixed grid, so there
  // is nothing honest to measure there and no ruler to draw.
  if (byobs) { rail.hidden = true; return; }

  findStops();
  rail.hidden = false;

  if (!measure()) { rail.hidden = true; return; }

  var h = track.clientHeight;
  var frag = document.createDocumentFragment();

  // Every year that begins on the wall, and how much of the rail it then owns — which is what
  // settles the argument when two of them want the same place.
  var years = [];
  var year = '';

  stops.forEach(function (s) {
    if (s.year === year) return;
    year = s.year;
    years.push({ year: s.year, y: s.f * h });
  });

  years.forEach(function (v, i) {
    v.owns = (i + 1 < years.length ? years[i + 1].y : h) - v.y;
  });

  // The years are what the rail is for and take the room first. Each needs a figure's height
  // to itself; two inside that is a wall too short to print both, and the one that keeps the
  // place is the one with more of the rail under it. A fortnight either side of New Year would
  // otherwise put a whole year off the ruler on the strength of being nearer the top.
  var labels = [];

  years.forEach(function (v) {
    var prev = labels[labels.length - 1];
    // Only ever swapped for a mark further down, so this can never crowd the one above.
    if (prev && v.y - prev.y < MIN_LABEL) {
      if (v.owns > prev.owns) labels[labels.length - 1] = v;
      return;
    }
    labels.push(v);
  });

  var taken = [];   // where the years landed, ascending, so the dots can keep out of them

  labels.forEach(function (v) {
    taken.push(v.y);
    var el = document.createElement('span');
    el.className = 'mark';
    el.textContent = v.year;
    el.style.top = v.y + 'px';
    frag.appendChild(el);
  });

  // Then the months, into whatever the years left. Both lists ascend, so one pointer walks
  // them together rather than each dot searching the whole rail.
  var k = 0;
  var lastTick = -MIN_TICK;

  stops.forEach(function (s) {
    var y = s.f * h;
    while (k < taken.length && taken[k] < y - MIN_TICK) k++;
    if (k < taken.length && taken[k] - y < MIN_TICK) return;
    if (y - lastTick < MIN_TICK) return;
    lastTick = y;

    var dot = document.createElement('i');
    dot.className = 'tick';
    dot.style.top = y + 'px';
    frag.appendChild(dot);
  });

  track.innerHTML = '';
  track.appendChild(frag);
  track.appendChild(nowChip);   // put back after the wipe, so it lives in the track's own space
  placeChip();
}

// Where the reader is, and what date is under the top of the screen. Read off the same stops
// the marks were drawn from, so the chip and the rail can never disagree. Named placeChip
// rather than place — `place` is now the location filter's own name, and a var declaration of
// that name below would otherwise silently overwrite this function the moment it ran.
function placeChip() {
  if (rail.hidden || !stops.length || span <= 0) return;

  var at = Math.max(0, Math.min(span, scrollY));
  nowChip.style.top = (at / span) * track.clientHeight + 'px';

  var label = stops[0].label;
  for (var i = 0; i < stops.length && stops[i].y <= at + 1; i++) label = stops[i].label;
  nowChip.textContent = label;
}

/* ---------------- reading the rail ---------------- */

var railTimer = null;
var scrubbing = false;
var ticking = false;

// Lit while the wall is moving, and settling back once it has stopped.
function wake() {
  rail.classList.add('live');
  clearTimeout(railTimer);
  railTimer = setTimeout(function () {
    if (!scrubbing) rail.classList.remove('live');
  }, 1100);
}

addEventListener('scroll', function () {
  if (rail.hidden) return;
  wake();
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(function () { ticking = false; placeChip(); });
}, { passive: true });

// A phone's address bar sliding away is a resize, and so is turning the thing sideways: both
// change how far the page scrolls, which is the one number the whole rail is drawn from.
var sizing = null;
addEventListener('resize', function () {
  clearTimeout(sizing);
  sizing = setTimeout(function () { if (photos.length) drawRail(); }, 150);
});

function scrubTo(clientY) {
  var box = track.getBoundingClientRect();
  var f = box.height ? (clientY - box.top) / box.height : 0;
  scrollTo(0, Math.max(0, Math.min(1, f)) * span);
}

rail.addEventListener('pointerdown', function (e) {
  if (span <= 0) return;
  scrubbing = true;
  try { rail.setPointerCapture(e.pointerId); } catch (err) {}
  e.preventDefault();   // no text selection, and no scroll started underneath the drag
  wake();
  scrubTo(e.clientY);
});

rail.addEventListener('pointermove', function (e) {
  if (scrubbing) scrubTo(e.clientY);
});

function endScrub(e) {
  if (!scrubbing) return;
  scrubbing = false;
  try { rail.releasePointerCapture(e.pointerId); } catch (err) {}
  wake();
}

rail.addEventListener('pointerup', endScrub);
rail.addEventListener('pointercancel', endScrub);

/* ---------------- the filter ---------------- */

function nothingNew() {
  // Nothing on this shelf matches the row as it stands at all — a different case from having
  // already seen everything that does, and one "show all" can't fix.
  var denom = refinedCount(all);
  if (denom === 0) {
    say('Nothing here', 'No photos matching that found for <b>' + esc(user) + '</b>.');
    return;
  }
  say('All caught up',
      'Every photo here has been seen already.' +
      '<button type="button" id="showAll">Show all ' + denom + '</button>');
  document.getElementById('showAll').addEventListener('click', function () { setMode('all'); });
}

function syncFilter() {
  Array.prototype.forEach.call(filters.querySelectorAll('button[data-show]'), function (b) {
    b.classList.toggle('on', b.dataset.show === mode);
  });
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  syncFilter();
  // A link carries the view it was read in; the photos are already here, so this is a rewrite
  // of the address rather than a reload.
  if (mode === 'all') qs.set('show', 'all');
  else qs.delete('show');
  addressNow();
  relist();
}

filters.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-show]');
  if (b) setMode(b.dataset.show);
});

// The row's second toggle, for a different question: not which photographs (Unseen / All
// above), but how the ones already fetched are hung — one wall, or observation by observation.
// Same shape of decision as setMode, so it takes the same path: the photos are already here,
// so this rewrites the address and rehangs rather than reloads, and the body class keeps the
// CSS in step with `byobs` for the whole life of the page.
function setByObs(on) {
  if (on === byobs) return;
  byobs = on;
  document.body.classList.toggle('byobs', on);
  obsCheck.checked = on;
  if (on) qs.set('obs', '1'); else qs.delete('obs');
  addressNow();
  relist();
}

obsCheck.addEventListener('change', function () { setByObs(obsCheck.checked); });

// Unhides the search field on both shelves the tagged one is skipped for — unlike the quick
// groups, a taxon search reloads rather than filters (see the doc comment up top), so it can
// ask iNaturalist for any class at all regardless of which shelf it was picked from, and stays
// useful on birds even though the quick groups above no longer offer themselves there. Run
// after buildTaxaFilter() so that when a taxon is already picked — arriving on the page, not
// just chosen from it — it can override that row's own hidden = false: a specific pick already
// says what to see, and the groups under it (on all, where they're built at all) would only be
// repeating the question.
function buildTaxonSearch() {
  if (view === 'highlights') return;
  taxonSearch.hidden = false;
  if (taxon) {
    taxonSel.hidden = false;
    taxonSelName.textContent = tname || ('Taxon ' + taxon);
    taxaFilter.hidden = true;
    loadTaxonParent();
  }
}

// The same quick groups as the species report's, built once — never hunted for in the data,
// since a group is worth offering whether or not this shelf happens to hold one yet. That
// reasoning holds on all, whose fetch asks for every class and might simply not have paged
// one in yet — a button sitting at zero there is a "not yet". It doesn't hold on birds, whose
// fetch is pinned to `iconic_taxa=Aves` (see endpoint()): nothing outside Aves is ever asked
// for, so a button there sits at zero forever, not "not yet" but "not ever" — offering it
// would just be a wrong answer with a button attached. So this only builds on all. Never
// built on the highlights shelf either, for the same shape of reason from the other side: one
// tag rather than a spread of kinds, the way birds is one class rather than a spread of them.
function buildTaxaFilter() {
  if (view !== 'all') return;

  taxaFilter.innerHTML = '<span class="lede">Taxa</span>' + ICONIC.map(function (pair) {
    return '<button type="button" data-iconic="' + pair[0] + '">' + esc(pair[1]) + '</button>';
  }).join('');
  taxaFilter.hidden = false;
  syncTaxaFilter();
}

// The date range and place text sit in their own row, unhidden the same way the taxa row is —
// static markup rather than built from a list, since there's no vocabulary to generate here,
// just three fields to prime with whatever the address already said.
function buildNarrow() {
  if (view === 'highlights') return;
  narrowRow.hidden = false;
  dateFromEl.value = dateFrom;
  dateToEl.value = dateTo;
  placeEl.value = place;
  syncPlaceLock();
}

function syncTaxaFilter() {
  Array.prototype.forEach.call(taxaFilter.querySelectorAll('button[data-iconic]'), function (b) {
    b.classList.toggle('on', iconic.indexOf(b.dataset.iconic) !== -1);
  });
}

// Toggling, not choosing — every group starts lit, so this switches one off rather than
// picking one on. Written out in full once touched, even down to nothing, rather than as an
// absence — an untouched address means "whatever this shelf starts with," which after a
// shelf switch is not the same list any longer.
function toggleIconic(v) {
  var i = iconic.indexOf(v);
  if (i === -1) iconic.push(v);
  else iconic.splice(i, 1);
  syncTaxaFilter();
  qs.set('iconic', iconic.join(','));
  addressNow();
  relist();
}

taxaFilter.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-iconic]');
  if (b) toggleIconic(b.dataset.iconic);
});

/* ---------------- taxon search ----------------

   A free search across all of iNaturalist's taxonomy, the same /taxa/autocomplete index.js
   already asks and the same shape of answer, read here without common.js's request gate —
   this is one request at a time behind a 280ms pause, not a burst, so the gate the paged
   fetches need would only be overhead here. Picking a result writes `taxon`/`tname` and
   reloads, same as picking a shelf from the select above it does; see the doc comment at the
   top of the file for why a specific taxon can't just filter what's already on the page. */

var taxonTimer = null, taxonSeq = 0, taxonActive = -1;

function closeTaxonAc() {
  taxonAc.hidden = true;
  taxonAc.innerHTML = '';
  taxonActive = -1;
}

// Keeps the highlighted row in step with `taxonActive`, whether it moved by arrow key or the
// list was just repainted — one place so the two can't fall out of sync, same reasoning as
// index.js's own highlight().
function highlightTaxonAc() {
  Array.prototype.forEach.call(taxonAc.children, function (el, i) {
    el.classList.toggle('hi', i === taxonActive);
  });
  if (taxonActive >= 0) taxonAc.children[taxonActive].scrollIntoView({ block: 'nearest' });
}

taxonInput.addEventListener('input', function () {
  var q = taxonInput.value.trim();
  clearTimeout(taxonTimer);
  if (q.length < 2) { closeTaxonAc(); return; }
  taxonTimer = setTimeout(function () {
    var mine = ++taxonSeq;
    fetch('https://api.inaturalist.org/v1/taxa/autocomplete?per_page=8&q=' + encodeURIComponent(q))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        // A slower search that lands after a faster one is a stale answer to a question
        // nobody's asking any longer, so it's dropped rather than drawn.
        if (mine !== taxonSeq || !d) return;
        var results = d.results || [];
        if (!results.length) { closeTaxonAc(); return; }
        taxonActive = -1;
        taxonAc.innerHTML = results.map(function (t) {
          var thumb = t.default_photo && t.default_photo.square_url;
          return '<button type="button" data-id="' + t.id + '" data-name="' + esc(t.name) + '">' +
            (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy">' : '<span class="ac-nophoto"></span>') +
            '<span class="ac-name">' +
              '<span class="ac-common">' + esc(t.preferred_common_name || t.name) + '</span>' +
              '<span class="ac-sci">' + esc(t.name) + '</span>' +
            '</span>' +
            '<span class="ac-rank">' + esc(t.rank || '') + '</span>' +
          '</button>';
        }).join('');
        taxonAc.hidden = false;
      })
      .catch(function () { closeTaxonAc(); });
  }, 280);
});

// Arrow keys move the highlight, Enter picks it — defaulting to the top row when nothing's
// been arrowed to yet, so Enter right after typing acts on the best match without an extra tap.
taxonInput.addEventListener('keydown', function (e) {
  if (taxonAc.hidden || !taxonAc.children.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    taxonActive = Math.min(taxonActive + 1, taxonAc.children.length - 1);
    highlightTaxonAc();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    taxonActive = Math.max(taxonActive - 1, 0);
    highlightTaxonAc();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    taxonAc.children[taxonActive < 0 ? 0 : taxonActive].click();
  } else if (e.key === 'Escape') {
    closeTaxonAc();
  }
});

// A tap outside the field closes the list without picking anything — the list itself stops
// its own clicks reaching here since pickTaxon() has already moved the page on by the time one
// would bubble.
document.addEventListener('click', function (e) {
  if (!taxonAc.hidden && !taxonSearch.contains(e.target)) closeTaxonAc();
});

// A new taxon is a new question, so this goes through the address and reloads — same path
// picking a shelf takes, and for the same reason (see the doc comment up top). The quick
// groups are dropped along with it: they'd otherwise carry over from whichever shelf this was
// picked on, narrowing a set that's already down to one taxon.
function pickTaxon(id, name) {
  qs.set('taxon', id);
  qs.set('tname', name);
  qs.delete('iconic');
  flush();
  location.search = qs.toString();
}

taxonAc.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-id]');
  if (b) pickTaxon(b.dataset.id, b.dataset.name);
});

taxonClear.addEventListener('click', function () {
  qs.delete('taxon');
  qs.delete('tname');
  flush();
  location.search = qs.toString();
});

/* ---------------- taxon parent ----------------

   One button in the picked chip, climbing the same tree the search above it descends. Not
   the /taxa/autocomplete index that search asks — stripped to what a hit list needs, and
   carrying no ancestors — but the plain taxon record, whose `ancestors` iNaturalist lists
   root-first, so the immediate parent is simply the last one before the taxon itself. Fired
   once, when a taxon is actually picked, so it goes through a plain fetch the same as the
   search above rather than through common.js's gate, which this file deliberately does
   without (see the doc comment up top). Not cached: unlike the report's version of this
   button, a session here only ever climbs one chip's worth of tree before the page reloads
   out from under it, so there is nothing to save an ask by keeping. */

var taxonParent = null;   // {id, name} once the lookup lands; the button stays disabled til then

function loadTaxonParent() {
  taxonParent = null;
  taxonParentBtn.disabled = true;
  taxonParentBtn.title = 'Set the taxon to its parent';
  taxonParentBtn.setAttribute('aria-label', taxonParentBtn.title);
  fetch('https://api.inaturalist.org/v1/taxa/' + taxon)
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (d) {
      var t = d && d.results && d.results[0];
      if (!t) return;
      var anc = t.ancestors || [];
      var parent = anc.length ? anc[anc.length - 1] : null;
      if (!parent) {
        taxonParentBtn.title = 'Already at the root of the tree';
        taxonParentBtn.setAttribute('aria-label', taxonParentBtn.title);
        return;
      }
      taxonParent = { id: parent.id, name: parent.name };
      taxonParentBtn.disabled = false;
      // Icon-only, so the title carries the actual destination -- and with it the accessible
      // name too, since there's no visible text left on the button to fall back on.
      var label = 'Set the taxon to ' + (parent.preferred_common_name || parent.name);
      taxonParentBtn.title = label;
      taxonParentBtn.setAttribute('aria-label', label);
    })
    // A failed ask just leaves the button disabled -- the chip's own name and its clear
    // button still work either way, so there is nothing else here to unwind.
    .catch(function () {});
}

taxonParentBtn.addEventListener('click', function () {
  if (!taxonParent) return;
  pickTaxon(taxonParent.id, taxonParent.name);
});

/* ---------------- place search ----------------

   The suggestions list stays live while typing — same /places/autocomplete index the taxon
   search above draws on, same 280ms debounce, same up/down/Enter/Escape handling — because a
   preview list costs nothing to keep current. What it's a preview of does not: the wall and
   the address only change once the reader has actually decided something, not on every pause
   mid-word. A pick decides it outright. Short of that, Enter or leaving the field both read as
   "this is what I meant" the same way finishing a sentence does, and either commits whatever
   text is sitting there as the plain substring search this field has always otherwise done —
   see commitPlace() below. Only clearing the field back to nothing jumps that queue, since
   emptying a filter is already a finished thought, not a letter more of one.

   Picking a row is where matching stops being just a spelling contest: a name off
   iNaturalist's own gazetteer ("Shetland Islands") is not reliably a substring of what any
   given observation's place_guess happens to say ("Shetland, UK", "Lerwick, Scotland", or a
   dozen other honest but differently-worded answers) — so a pick that only filled the text
   field in could sit there matching nothing, looking broken while doing exactly what it was
   told. What a pick actually hands over is a place id, checked against the `place_ids`
   iNaturalist has already worked out for every photo (see matchesNarrow()) — a boundary, not
   a spelling. `placeId` carries that; `placeName` is the exact text it's honest for, so
   commitPlace() can tell a fresh pick from a pick that's since been typed over and drop the id
   the moment the two disagree. Unlike a taxon pick, which is a new question put to
   iNaturalist and so reloads (see the doc comment above pickTaxon()), a place pick still just
   narrows the photos already on the page, so it applies immediately rather than waiting on
   any of the above — a pick is already the decision the rest of this section is waiting for. */

// Reflects whether the field's current value is a boundary or just a spelling, so the two
// look different rather than leaving the pick invisible once it's been made.
function syncPlaceLock() {
  placeWrap.classList.toggle('locked', !!placeId);
  placeEl.title = placeId ? 'Matched by iNaturalist place boundary, not by spelling' : '';
}

// The one place place/placeId actually reach the wall and the address bar — called only once
// the two already say what's meant, whether that's a pick, a commit, or a plain clear.
function applyPlace() {
  syncPlaceLock();
  if (place) qs.set('place', place); else qs.delete('place');
  if (placeId) qs.set('place_id', String(placeId)); else qs.delete('place_id');
  addressNow();
  relist();
}

// The decisive middle ground between a pick and doing nothing: Enter, leaving the field, or
// emptying it all read as "done" rather than "still typing" (see the doc comment above). A
// locked id is only honest for the exact text it was picked for, so if the field no longer
// reads that, the id is dropped back to the plain substring search instead of going on
// matching a boundary nobody typed.
function commitPlace() {
  var text = placeEl.value.trim();
  var nextId = (placeId && text === placeName) ? placeId : null;
  if (text === place && nextId === placeId) return;   // nothing has actually changed
  place = text;
  placeId = nextId;
  applyPlace();
}

var placeAcTimer = null, placeAcSeq = 0, placeAcActive = -1;

function closePlaceAc() {
  placeAc.hidden = true;
  placeAc.innerHTML = '';
  placeAcActive = -1;
}

function highlightPlaceAc() {
  Array.prototype.forEach.call(placeAc.children, function (el, i) {
    el.classList.toggle('hi', i === placeAcActive);
  });
  if (placeAcActive >= 0) placeAc.children[placeAcActive].scrollIntoView({ block: 'nearest' });
}

// The part of a place's full name not already said by its own name — "Lisboa, Portugal"
// under "Amadora", not "Amadora" repeated under itself.
function placeSub(t) {
  var full = t.display_name || '';
  if (full.indexOf(t.name) === 0) full = full.slice(t.name.length).replace(/^,\s*/, '');
  return full;
}

placeEl.addEventListener('input', function () {
  var q = placeEl.value.trim();
  clearTimeout(placeAcTimer);
  // Emptying the field reads as "never mind", not as a letter more of a place name — the one
  // exception to typing not touching the wall (see the doc comment above).
  if (!q && (place || placeId)) commitPlace();
  if (q.length < 2) { closePlaceAc(); return; }
  placeAcTimer = setTimeout(function () {
    var mine = ++placeAcSeq;
    fetch('https://api.inaturalist.org/v1/places/autocomplete?per_page=8&q=' + encodeURIComponent(q))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        // A slower search that lands after a faster one is a stale answer to a question
        // nobody's asking any longer, so it's dropped rather than drawn — same reasoning as
        // the taxon search above.
        if (mine !== placeAcSeq || !d) return;
        var results = d.results || [];
        if (!results.length) { closePlaceAc(); return; }
        placeAcActive = -1;
        placeAc.innerHTML = results.map(function (t) {
          var sub = placeSub(t);
          return '<button type="button" data-id="' + t.id + '" data-name="' + esc(t.name) + '">' +
            '<span class="ac-place-name">' +
              '<span class="ac-place-primary">' + esc(t.name) + '</span>' +
              (sub ? '<span class="ac-place-sub">' + esc(sub) + '</span>' : '') +
            '</span>' +
          '</button>';
        }).join('');
        placeAc.hidden = false;
      })
      .catch(function () { closePlaceAc(); });
  }, 280);
});

// Arrow keys move the highlight, Enter picks it — same defaulting-to-the-top-row reasoning
// as the taxon field's own keydown handler above. Enter with no list open has nothing to
// pick, so it commits the typed text instead (see commitPlace()).
placeEl.addEventListener('keydown', function (e) {
  if (!placeAc.hidden && placeAc.children.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      placeAcActive = Math.min(placeAcActive + 1, placeAc.children.length - 1);
      highlightPlaceAc();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      placeAcActive = Math.max(placeAcActive - 1, 0);
      highlightPlaceAc();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      placeAc.children[placeAcActive < 0 ? 0 : placeAcActive].click();
    } else if (e.key === 'Escape') {
      closePlaceAc();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    commitPlace();
  }
});

// A tap outside the field closes the list without picking anything, same as the taxon list.
document.addEventListener('click', function (e) {
  if (!placeAc.hidden && !placeWrap.contains(e.target)) closePlaceAc();
});

// Without this, clicking a suggestion would blur the field first (the default behaviour of
// any mousedown on something else) — closing the list and committing whatever was typed
// before the click handler below ever got to run its own, more specific answer.
placeAc.addEventListener('mousedown', function (e) { e.preventDefault(); });

placeAc.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-id]');
  if (!b) return;
  placeEl.value = b.dataset.name;
  closePlaceAc();
  place = placeEl.value.trim();
  placeId = Number(b.dataset.id);
  placeName = place;
  applyPlace();
  placeEl.focus();
});

// Leaving the field is the other decisive "done" alongside Enter (see the doc comment above
// the section) — whatever's typed is committed on the way out rather than left hanging.
placeEl.addEventListener('blur', function () {
  closePlaceAc();
  commitPlace();
});

// A native date input fires `change` once a value is actually committed, not per keystroke —
// the same "not while still deciding" reasoning the place field above now follows too, just
// given to date inputs natively rather than needing commitPlace()'s own handling of it.
dateFromEl.addEventListener('change', function () {
  dateFrom = dateFromEl.value;
  if (dateFrom) qs.set('d1', dateFrom); else qs.delete('d1');
  addressNow();
  relist();
});

dateToEl.addEventListener('change', function () {
  dateTo = dateToEl.value;
  if (dateTo) qs.set('d2', dateTo); else qs.delete('d2');
  addressNow();
  relist();
});

// Changing shelf is a new question for iNaturalist, not a new slice of the answer already
// here, so it goes through the address and the page comes back on the other one — same as
// answering "whose gallery?" does. Anything still unwritten goes to storage first.
viewSel.addEventListener('change', function () {
  // A new shelf starts with every group lit again, no date, place, or taxon set, whatever was
  // narrowed on the last one.
  qs.delete('iconic');
  qs.delete('d1');
  qs.delete('d2');
  qs.delete('place');
  qs.delete('taxon');
  qs.delete('tname');
  if (viewSel.value === 'highlights') qs.delete('view');
  else qs.set('view', viewSel.value);
  flush();
  location.search = qs.toString();
});

// The one way back out of a record that only this browser holds, so it asks first.
forget.addEventListener('click', function () {
  if (!confirm('Forget which of ' + user + '’s photos have been seen?')) return;
  if (pending) { clearTimeout(pending); pending = null; }
  seen = new Set();
  seenAtLoad = new Set();
  try { localStorage.removeItem(storeKey); } catch (err) {}
  forget.hidden = true;
  relist();
});

/* ---------------- focus view ---------------- */

// The neighbours, fetched while this one is being looked at, so a step lands on a picture
// rather than on a wait.
function preload(i) {
  if (i < 0 || i >= photos.length) return;
  var im = new Image();
  im.src = sized(photos[i].url, 'large');
}

function showPhoto(i) {
  cursor = i;
  var photo = photos[i];
  markSeen(photo);

  // A fresh picture starts at its own size — a zoom carried over from the last one would be
  // answering a gesture nobody made on this one.
  resetZoom();

  // What is on screen is what the address says, so the bar can be copied out of at any moment
  // without a button being pressed at all.
  qs.set('photo', photo.key);
  addressSoon();

  lo.src = sized(photo.url, 'small');
  hi.classList.remove('in');
  hi.src = sized(photo.url, 'large');

  counter.textContent = (i + 1) + ' / ' + photos.length;
  binomialName.textContent = photo.name || photo.common || 'Unidentified';

  rgBadge.hidden = photo.qualityGrade !== 'research';
  idCountNum.textContent = String(photo.idCount);
  idCount.setAttribute('aria-label', photo.idCount + (photo.idCount === 1 ? ' identification' : ' identifications'));

  var obsUrl = 'https://www.inaturalist.org/observations/' + photo.obsId;
  var parts = [];
  if (photo.common && photo.name) parts.push(esc(photo.common));
  if (photo.date) parts.push(prettyDate(photo.date));
  parts.push('<a href="' + obsUrl + '" target="_blank" rel="noopener">View on iNaturalist</a>');
  parts.push('<button type="button" class="copy" data-url="' + esc(shareLink()) + '">Copy Photo📋</button>');
  metaline.innerHTML = parts.join('<span class="sep">·</span>');

  preload(i + 1);
  preload(i - 1);
}

hi.addEventListener('load', function () { hi.classList.add('in'); });

// One listener survives every metaline.innerHTML rewrite in showPhoto(), rather than
// re-binding a fresh one per photo.
metaline.addEventListener('click', function (e) {
  var btn = e.target.closest('.copy');
  if (!btn) return;
  var url = btn.dataset.url;
  var label = btn.textContent;
  var reset = function () { btn.textContent = label; };
  navigator.clipboard.writeText(url).then(function () {
    btn.textContent = 'Copied';
    setTimeout(reset, 1200);
  }).catch(function () {});
});

function openPhoto(i) {
  focusEl.classList.add('on');
  focusEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('focused');
  showPhoto(i);
}

function closeFocus() {
  focusEl.classList.remove('on');
  focusEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('focused');
  hi.removeAttribute('src');
  lo.removeAttribute('src');
  resetZoom();
  // Nothing is open any longer, so the address stops naming a photograph — a link taken from
  // the bar now is the wall, which is what is being looked at.
  qs.delete('photo');
  addressNow();
  // Whatever arrived while the view was up is on the wall but not yet on the ruler.
  if (photos.length) drawRail();
}

/* ---------------- a photograph asked for by name ----------------

   `?photo=` is a link somebody was sent, so it is answered as soon as it can be: the wall
   arrives a page at a time and the picture may be a thousand of them down, so every batch is
   checked as it is hung rather than the whole load being waited out. */

function findWanted() {
  for (var i = 0; i < photos.length; i++) if (photos[i].key === wanted) return i;
  return -1;
}

function haveWanted() {
  for (var i = 0; i < all.length; i++) if (all[i].key === wanted) return true;
  return false;
}

function openWanted() {
  if (!wanted) return;

  // By now the reader may have started on the wall themselves. A link opens a photograph; it
  // does not snatch the page back off somebody already reading it.
  if (focusEl.classList.contains('on') || scrollY > 8) { wanted = ''; return; }

  var i = findWanted();

  if (i === -1) {
    // Fetched, but filtered off the wall: this reader has seen the picture that whoever sent
    // the link had not. Being named in the address outranks the filter, so the shelf is shown
    // whole — which hangs the picture, and comes back through here to open it.
    if (mode === 'unseen' && haveWanted()) setMode('all');
    return;
  }

  wanted = '';
  openPhoto(i);
}

function step(delta) {
  var next = cursor + delta;
  if (next < 0 || next >= photos.length) return;
  showPhoto(next);
}

document.getElementById('prevZone').addEventListener('click', function () { step(-1); });
document.getElementById('nextZone').addEventListener('click', function () { step(1); });
document.getElementById('close').addEventListener('click', closeFocus);

document.addEventListener('keydown', function (e) {
  if (!focusEl.classList.contains('on')) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  if (e.key === 'Escape')     { e.preventDefault(); closeFocus(); }
});

/* ---------------- zoom, pan, and swipe ----------------

   Two fingers pinch the picture in and out, the point between them held under the fingers
   as it grows or shrinks, the same as it would in Photos. One finger does one of two things
   depending on whether the picture is currently zoomed: dragged around it if it is, or read
   as a swipe if it isn't, since a swipe that moved to the next photograph or closed the view
   out from under someone mid-pan would be answering the wrong question. Both stay stateful
   across a change in finger count instead of resetting — lifting one finger out of a pinch
   keeps the picture at whatever size it had grown to and hands the remaining finger straight
   to panning, rather than dropping back to a plain swipe underneath it. */

var stage = focusEl.querySelector('.stage');
var prevZoneEl = document.getElementById('prevZone');
var nextZoneEl = document.getElementById('nextZone');

var ZOOM_MAX = 4;
var zoomScale = 1, panX = 0, panY = 0;

function touchDist(a, b) {
  var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
function touchMid(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

// Kept inside the screen rather than the picture's own rendered box — close enough, since
// object-fit: contain already holds it near that size, and it saves a layout read on every
// frame of the gesture.
function clampPan() {
  var maxX = (innerWidth  * (zoomScale - 1)) / 2;
  var maxY = (innerHeight * (zoomScale - 1)) / 2;
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function applyZoom(settling) {
  stage.style.transition = settling ? 'transform 150ms ease' : 'none';
  stage.style.transform = (zoomScale === 1 && !panX && !panY) ? ''
    : 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoomScale + ')';
  // The tap zones would otherwise steal a drag that starts on them once the picture is
  // zoomed in, sending the reader to the next photograph instead of panning this one.
  var zoomed = zoomScale > 1.001;
  prevZoneEl.style.pointerEvents = zoomed ? 'none' : '';
  nextZoneEl.style.pointerEvents = zoomed ? 'none' : '';
}

function resetZoom() {
  zoomScale = 1; panX = 0; panY = 0;
  applyZoom(false);
}

var sx = 0, sy = 0, tracking = false;
var pinch = null;   // set while two fingers are down
var pan   = null;   // set while one finger drags an already-zoomed picture

focusEl.addEventListener('touchstart', function (e) {
  if (e.touches.length === 2) {
    tracking = false;
    pan = null;
    var mid = touchMid(e.touches[0], e.touches[1]);
    pinch = {
      dist: touchDist(e.touches[0], e.touches[1]),
      scale0: zoomScale,
      // the point on the picture itself under the fingers, in its own unscaled terms, held
      // there as the scale changes rather than recomputed fresh each frame.
      cx: (mid.x - innerWidth / 2 - panX) / zoomScale,
      cy: (mid.y - innerHeight / 2 - panY) / zoomScale
    };
    return;
  }
  if (e.touches.length !== 1) { tracking = false; pan = null; return; }
  pinch = null;
  if (zoomScale > 1.001) {
    tracking = false;
    pan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  } else {
    pan = null;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    tracking = true;
  }
}, { passive: true });

focusEl.addEventListener('touchmove', function (e) {
  if (pinch && e.touches.length === 2) {
    e.preventDefault();
    var dist = touchDist(e.touches[0], e.touches[1]);
    var mid  = touchMid(e.touches[0], e.touches[1]);
    zoomScale = Math.max(1, Math.min(ZOOM_MAX, pinch.scale0 * (dist / pinch.dist)));
    panX = mid.x - innerWidth / 2 - pinch.cx * zoomScale;
    panY = mid.y - innerHeight / 2 - pinch.cy * zoomScale;
    clampPan();
    applyZoom(false);
    return;
  }
  if (pan && e.touches.length === 1) {
    e.preventDefault();
    var t = e.touches[0];
    panX += t.clientX - pan.x;
    panY += t.clientY - pan.y;
    pan.x = t.clientX;
    pan.y = t.clientY;
    clampPan();
    applyZoom(false);
  }
}, { passive: false });

focusEl.addEventListener('touchend', function (e) {
  if (e.touches.length >= 1) {
    // A finger lifted out of a pinch, one still down: that finger takes over panning at
    // whatever size the pinch had already reached, rather than the gesture ending here.
    if (e.touches.length === 1) {
      pinch = null;
      pan = zoomScale > 1.001 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    }
    return;
  }

  pinch = null;
  pan = null;

  // A pinch that lands back near 1x settles there exactly, rather than leaving the picture
  // a hair off its true size.
  if (zoomScale <= 1.02) resetZoom();
  else applyZoom(true);

  if (!tracking) return;
  tracking = false;
  var t = e.changedTouches[0];
  var dx = t.clientX - sx;
  var dy = t.clientY - sy;

  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
    step(dx < 0 ? 1 : -1);
  } else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
    closeFocus();
  }
}, { passive: true });

focusEl.addEventListener('touchcancel', function () {
  tracking = false; pinch = null; pan = null;
  if (zoomScale <= 1.02) resetZoom(); else applyZoom(true);
}, { passive: true });

/* ---------------- go ---------------- */

// Nothing in the address to go on, so ask rather than guess. The answer is written back into
// the address and the page reloads from it, which keeps the gallery a single kind of thing:
// a username in a link, shareable and reload-safe.
function ask() {
  say('Whose gallery?',
      'Enter an iNaturalist username.' +
      '<input id="userInput" type="text" placeholder="username" autocapitalize="none"' +
      ' autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="go">');

  var input = document.getElementById('userInput');
  input.focus();
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    // The other spellings are dropped so the address carries one name, not two.
    qs.delete('u');
    qs.delete('user_id');
    qs.set('user', input.value.trim());
    location.search = qs.toString();
  });
}

(function init() {
  // A reload would otherwise land where the last visit left off, and the observer would tick
  // off whatever the restored scroll happened to be sitting over — photos nobody looked at.
  // Every opening starts at the top of the wall instead.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);

  // With no user the masthead keeps its placeholder space, so it holds its height while the
  // page is asking who to show.
  if (!user) {
    ask();
    return;
  }

  document.getElementById('who').textContent = user;
  document.title = user + '\'s iNat gallery';

  viewSel.value = view;
  picker.hidden = false;
  filters.hidden = false;
  forget.hidden = seenAtLoad.size === 0;
  obsCheck.checked = byobs;
  syncFilter();
  buildTaxaFilter();
  buildTaxonSearch();
  buildNarrow();
  load();
})();
