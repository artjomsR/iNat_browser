/* ---------------- page address ----------------

   The gallery is one person's photographs, so its whole input lives in the query string and
   it can be bookmarked, shared, and reloaded on its own:

     gallery.html?user=USER
     gallery.html?user=USER&tag=b&show=all
     gallery.html?user=USER&view=birds

   `user` is the iNaturalist login. `u` and `user_id` are accepted as spellings of the same
   thing, because the species page uses one and iNaturalist's own addresses use the other.
   With no username at all the page asks for one and writes the answer back here rather than
   guessing at somebody.

   `tag` is the tier tag an observation must carry (default `s`), `grade` the quality grades
   to accept, and `show=all` turns the unseen filter off. The rest of the query is fixed:
   verifiable observations with photos, newest first.

   `view` is which shelf: `highlights`, the default, is the tagged one the gallery was built
   for; `view=birds` drops the tag and hangs this user's birds instead. Changing it reloads the
   page rather than re-filtering, because it is a different question put to iNaturalist rather
   than a different slice of the same answer. What has been seen is remembered per photograph,
   so a picture met on one shelf is already seen on the other.

   What has already been seen is the one piece of state too long for an address, and it
   belongs to this browser rather than to the link, so it lives in localStorage — see
   "what has been seen" below. */

/* ---------------- config from the URL ---------------- */

var qs    = new URLSearchParams(location.search);
var user  = (qs.get('user') || qs.get('u') || qs.get('user_id') || '').trim();
var tag   = (qs.get('tag') || 's').trim();
var grade = qs.get('grade') || 'needs_id,research';
// Which half of the shelf to show. Unseen is the default because the gallery is meant to be
// worked through rather than re-read; `?show=all` is the way back to the whole thing.
var mode  = qs.get('show') === 'all' ? 'all' : 'unseen';
// Which shelf. Anything unrecognised falls back to the tagged one this page was built around.
var view  = qs.get('view') === 'birds' ? 'birds' : 'highlights';

var PER_PAGE = 200;
var MAX_PAGES = 50;

var all    = [];   // every photo fetched, whatever the filter says
var photos = [];   // the ones on screen — what the focus view steps through
var cursor = 0;

var grid     = document.getElementById('grid');
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

  // All the two shelves differ by: a tag search, or a whole class of animal. Newest first
  // either way, so "most recent" needs nothing added.
  if (view === 'birds') p.set('iconic_taxa', 'Aves');
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

function render(list) {
  var frag = document.createDocumentFragment();

  list.forEach(function (photo) {
    var old = seenAtLoad.has(photo.key);
    if (mode === 'unseen' && old) return;

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
}

function retally() {
  // The unseen count needs its denominator to mean anything: how many are left, out of every
  // photo on the shelf. In the whole view those two numbers are the same one.
  tally.textContent = mode === 'unseen'
    ? photos.length + ' / ' + all.length + ' unseen'
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
    else say('Nothing tagged “' + tag + '”',
             'No observations found for <b>' + esc(user) + '</b> with that tag. ' +
             'Change the username or tag in the address:<br><code>?user=' + esc(user) +
             '&amp;tag=' + esc(tag) + '</code>');
  }
}

/* ---------------- the filter ---------------- */

function nothingNew() {
  say('All caught up',
      'Every photo here has been seen already.' +
      '<button type="button" id="showAll">Show all ' + all.length + '</button>');
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
  // The address is this page's memory, same as the username: a link carries the view it was
  // read in. replaceState, not a reload — the photos are already here.
  if (mode === 'all') qs.set('show', 'all');
  else qs.delete('show');
  var query = qs.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
  relist();
}

filters.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-show]');
  if (b) setMode(b.dataset.show);
});

// Changing shelf is a new question for iNaturalist, not a new slice of the answer already
// here, so it goes through the address and the page comes back on the other one — same as
// answering "whose gallery?" does. Anything still unwritten goes to storage first.
viewSel.addEventListener('change', function () {
  if (viewSel.value === 'birds') qs.set('view', 'birds');
  else qs.delete('view');
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

  lo.src = sized(photo.url, 'small');
  hi.classList.remove('in');
  hi.src = sized(photo.url, 'large');

  counter.textContent = (i + 1) + ' / ' + photos.length;
  binomial.textContent = photo.name || photo.common || 'Unidentified';

  var parts = [];
  if (photo.common && photo.name) parts.push(esc(photo.common));
  if (photo.date) parts.push(prettyDate(photo.date));
  parts.push('<a href="https://www.inaturalist.org/observations/' + photo.obsId +
             '" target="_blank" rel="noopener">iNat</a>');
  metaline.innerHTML = parts.join('<span class="sep">·</span>');

  preload(i + 1);
  preload(i - 1);
}

hi.addEventListener('load', function () { hi.classList.add('in'); });

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
  load();
})();
