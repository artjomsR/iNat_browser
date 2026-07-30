/* ---------------- page address ----------------

   The gallery is one person's photographs, so its whole input lives in the query string and
   it can be bookmarked, shared, and reloaded on its own:

     gallery.html?user=USER
     gallery.html?user=USER&tag=b&show=all
     gallery.html?user=USER&view=birds
     gallery.html?user=USER&photo=PHOTO_ID

   `user` is the iNaturalist login. `u` and `user_id` are accepted as spellings of the same
   thing, because the species page uses one and iNaturalist's own addresses use the other.
   With no username at all the page asks for one and writes the answer back here rather than
   guessing at somebody.

   `tag` is the tier tag an observation must carry (default `s`), `grade` the quality grades
   to accept, and `show=all` turns the unseen filter off. The rest of the query is fixed:
   verifiable observations with photos, newest first.

   `view` is which shelf: `highlights`, the default, is the tagged one the gallery was built
   for; `view=birds` drops the tag and hangs this user's birds instead; `view=all` drops both
   the tag and the taxon and hangs every verifiable observation. Changing it reloads the page
   rather than re-filtering, because it is a different question put to iNaturalist rather than
   a different slice of the same answer. What has been seen is remembered per photograph, so a
   picture met on one shelf is already seen on the other.

   `iconic` narrows either of those shelves to one or more iconic taxa (`Aves`, `Mammalia`,
   and so on — iNaturalist's own names, comma-separated), the same key and the same quick
   groups as the species report's. It is a slice of the answer already on the page rather
   than a new question, so it filters rather than reloads. It only applies outside the
   highlights shelf, which is one tag rather than a spread of kinds, so the row that sets it
   is hidden there too. Missing from the address it starts however the shelf is already
   scoped — just `Aves` on the birds shelf, every group on all's — so the address only has to
   say anything once that starting point is changed; switching shelves drops it, since one
   shelf's starting point is not the other's.

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
// Which shelf. Anything unrecognised falls back to the tagged one this page was built around.
var view  = qs.get('view') === 'birds' ? 'birds' : qs.get('view') === 'all' ? 'all' : 'highlights';
// Narrows the shelf to a set of iconic taxa; meaningless on the tagged shelf, so it is dropped
// there. Starts however each shelf is already scoped: birds is Aves and nothing else, since
// that's what iNaturalist was asked for; all has no scope of its own, so every group starts
// checked to match. The address only ever names an exception to that starting point.
var iconic = view === 'highlights' ? [] :
  qs.has('iconic') ? qs.get('iconic').split(',').filter(Boolean) :
  view === 'birds' ? ['Aves'] : ICONIC.map(function (p) { return p[0]; });
// The photograph the link asks to have open, if any. Cleared once it has been opened, or once
// the reader has taken the wall somewhere of their own.
var wanted = (qs.get('photo') || '').trim();

var PER_PAGE = 200;
var MAX_PAGES = 50;

var all    = [];   // every photo fetched, whatever the filter says
var photos = [];   // the ones on screen — what the focus view steps through
var cursor = 0;

var grid     = document.getElementById('grid');
var taxaFilter = document.getElementById('taxaFilter');
var filters  = document.getElementById('filters');
var forget   = document.getElementById('forget');
var picker   = document.getElementById('picker');
var viewSel  = document.getElementById('view');
var loading  = document.getElementById('loading');
var statusEl = document.getElementById('status');
var tally    = document.getElementById('tally');
var focusEl  = document.getElementById('focus');
var lo       = document.getElementById('lo');
var hi       = document.getElementById('hi');
var counter  = document.getElementById('counter');
var binomial = document.getElementById('binomial');
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

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  // Newest first either way, so "most recent" needs nothing added.
  if (view === 'birds') p.set('iconic_taxa', 'Aves');
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
        date: obs.observed_on || (obs.observed_on_details && obs.observed_on_details.date) || ''
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

// Whether the taxa row is narrowing the wall at all. It is only offered off the highlights
// shelf, which is one tag rather than a spread of kinds: `iconic` is empty there because the
// question was never put, not because every answer was unticked. Where the row is offered an
// empty list means the reader really has switched every group off, and an empty wall is the
// honest answer to that.
function narrowed() {
  return view !== 'highlights' && iconic.length < ICONIC.length;
}

function render(list) {
  var frag = document.createDocumentFragment();

  list.forEach(function (photo) {
    var old = seenAtLoad.has(photo.key);
    if (mode === 'unseen' && old) return;
    if (narrowed() && iconic.indexOf(photo.iconic) === -1) return;

    var index = photos.length;
    photos.push(photo);

    var tile = document.createElement('button');
    tile.className = 'tile' + (mode === 'all' && !old ? ' fresh' : '');
    tile.setAttribute('aria-label', photo.common || photo.name || 'Photo');

    var img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = sized(photo.url, 'small');
    img.addEventListener('load', function () { img.classList.add('in'); });

    tile.appendChild(img);
    tile.addEventListener('click', function () { openPhoto(index); });
    watch(tile, photo);
    frag.appendChild(tile);
  });

  grid.appendChild(frag);
  retally();
  drawRail();
  openWanted();
}

// How many of `all` belong to one of the chosen taxa — the denominator the tally and the
// "show all" button both need once the taxa row has narrowed the shelf.
function taxonCount(list) {
  if (!narrowed()) return list.length;
  var n = 0;
  for (var i = 0; i < list.length; i++) if (iconic.indexOf(list[i].iconic) !== -1) n++;
  return n;
}

function retally() {
  // The unseen count needs its denominator to mean anything: how many are left, out of every
  // photo on the shelf (or the taxon, once one is picked). In the whole view those two numbers
  // are the same one.
  tally.textContent = mode === 'unseen'
    ? photos.length + ' / ' + taxonCount(all) + ' unseen'
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
    if (!photos.length) nothingNew();
  }
}

async function load() {
  loading.hidden = false;

  for (var page = 1; page <= MAX_PAGES; page++) {
    var payload;

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
      // `all`, not `photos`: photos already fetched and then filtered out still mean the
      // connection was fine, and shouldn't be reported as a dead one.
      if (all.length === 0) {
        say('Could not reach iNaturalist',
            'The request failed &mdash; check the connection and reload. If it keeps failing, the username may be wrong.');
      }
      return;
    }

    var results = payload.results || [];
    paint(collect(results));

    if (results.length < PER_PAGE) break;
    await sleep(1100);   // iNaturalist asks for a second between calls; this stays inside it
  }

  loading.hidden = true;

  if (photos.length === 0) {
    if (all.length) nothingNew();
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
var head  = 0;     // the sticky header, which the rail hangs below and scrolling stops under

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

  head = masthead.offsetHeight;
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
  place();
}

// Where the reader is, and what date is under the top of the screen. Read off the same stops
// the marks were drawn from, so the chip and the rail can never disagree.
function place() {
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
  requestAnimationFrame(function () { ticking = false; place(); });
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
  // Nothing on this shelf carries the chosen taxon at all — a different case from having
  // already seen everything that does, and one "show all" can't fix.
  var denom = taxonCount(all);
  if (denom === 0) {
    say('Nothing here', 'No photos of that kind found for <b>' + esc(user) + '</b>.');
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

// The same quick groups as the species report's, built once — never hunted for in the data,
// since a group is worth offering whether or not this shelf happens to hold one yet.
// Never built at all on the highlights shelf, one tag rather than a spread of kinds.
function buildTaxaFilter() {
  if (view === 'highlights') return;

  taxaFilter.innerHTML = '<span class="lede">Taxa</span>' + ICONIC.map(function (pair) {
    return '<button type="button" data-iconic="' + pair[0] + '">' + esc(pair[1]) + '</button>';
  }).join('');
  taxaFilter.hidden = false;
  syncTaxaFilter();
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

// Changing shelf is a new question for iNaturalist, not a new slice of the answer already
// here, so it goes through the address and the page comes back on the other one — same as
// answering "whose gallery?" does. Anything still unwritten goes to storage first.
viewSel.addEventListener('change', function () {
  // A new shelf starts with every group lit again, whatever was unchecked on the last one.
  qs.delete('iconic');
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

  // What is on screen is what the address says, so the bar can be copied out of at any moment
  // without a button being pressed at all.
  qs.set('photo', photo.key);
  addressSoon();

  lo.src = sized(photo.url, 'small');
  hi.classList.remove('in');
  hi.src = sized(photo.url, 'large');

  counter.textContent = (i + 1) + ' / ' + photos.length;
  binomial.textContent = photo.name || photo.common || 'Unidentified';

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

// swipe: sideways to move, down to close
var sx = 0, sy = 0, tracking = false;

focusEl.addEventListener('touchstart', function (e) {
  if (e.touches.length !== 1) { tracking = false; return; }
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
  tracking = true;
}, { passive: true });

focusEl.addEventListener('touchend', function (e) {
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
  syncFilter();
  buildTaxaFilter();
  load();
})();
