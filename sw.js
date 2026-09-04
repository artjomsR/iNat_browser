"use strict";

/* ---------------- the shell, kept ----------------

   This app is read on a phone in a field, and until now being there meant it could not be
   opened at all: no signal, no HTML, no JS, nothing — not even the furniture, and not even to
   say why. This worker keeps the files the app is made of so that it always opens. It keeps
   nothing else, and that is the more important half of the sentence.

   NO API RESPONSE IS CACHED HERE, EVER. Every count, list, place and photograph on these three
   pages comes from iNaturalist and is asked for fresh. A species tally is a thing that moves
   all day; served back out of a cache it would be a photograph of an earlier day wearing
   today's face, and there is no line on any of these pages that would say so. A page that
   opens and admits it cannot reach iNaturalist is worth more than one that opens and lies
   quietly. (The species report does keep answers, for five minutes, in sessionStorage — see
   "keeping the answers" in species.js. That is a reader's own tab holding its own working set
   for the length of a reload, which is a different bargain from a worker holding everyone's.)

   THE SAME BARGAIN AS STORAGE. Every localStorage call in this repo is wrapped, and where the
   store refuses the app is exactly the app it was before that feature existed. This is that
   bargain again: no worker — a private window, a policy, an old browser, or the file:// path
   CLAUDE.md still calls a supported way to run this — and all three pages work as they always
   did, off the network, unchanged. Registration is six lines in each page's tail and is allowed
   to fail silently for that reason.

   WHAT IS CACHED is an allowlist and not a filter: SHELL below, and nothing else, ever, under
   any circumstance. A request the worker does not recognise is not answered by it — no
   respondWith, no interception, the browser does what it would have done. So the API, the
   Wikidata lookup behind the eBird links, every map tile and every photograph on the gallery
   wall are all network-only by construction rather than by a rule someone has to remember to
   keep exempting. Tiles are the near-miss and stay out: a cache of the tiles you happened to
   look at is an app that is a map in four places and a grey field everywhere else, and it fills
   a phone to do it. Offline the map is furniture with no tiles, and it says so.

   CROSS-ORIGIN. Leaflet comes from unpkg and the fonts from Google (see CLAUDE.md, external
   dependencies), and without Leaflet the map page is not furniture — it is a blank page, since
   index.js reaches for `L` on the way up. So Leaflet's CSS and JS are in the shell. They are
   fetched in cors mode rather than no-cors, deliberately: unpkg answers with
   Access-Control-Allow-Origin, which means a real status comes back and a 404, a 502 or a
   captive portal's sign-in page can be told from the library and never stored. An opaque
   response would have been fewer lines and would have made "the map is permanently broken and
   nobody can see why" a thing this file could do. Serving a cors-typed response back to the
   plain <script src> that asked for it is allowed — the restriction runs the other way.

   The fonts stay out. Their URLs vary by browser on two hosts, which is real machinery for a
   small return: both stylesheets ask with display=swap, so with no connection the type simply
   renders in the fallback stack the CSS already names and nothing waits. The gallery, which
   CLAUDE.md notes loads no fonts at all, is untouched by any of this and is the page that
   survives it best.

   UPDATE POLICY: NO skipWaiting AND NO clients.claim. A new worker installs, fills its cache,
   and then waits until every page using the old one is gone. A field session stays open for
   hours; swapping species.js under an HTML page that loaded an hour ago is how you get a
   version mismatch that only one person can reproduce and nobody can explain. The cost is that
   a change reaches the reader on the next cold start rather than the next reload, which on a
   home-screen app is the next time they open it. That is the right trade for a repo with no
   build step and no staging: correctness first, and a day's delay at most.

   ---------------- the way out ----------------

   A service worker is sticky, and a bad one shipped to a home screen is the one bug in this
   repo that cannot be fixed by editing a file and reloading. Two ways out, in order:

   1. From the reader's own browser console, on any page of this app:

        navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
        caches.keys().then(ks => ks.forEach(k => caches.delete(k)));

      then reload twice. In DevTools it is Application → Service workers → Unregister, and
      Application → Storage → Clear site data. On iOS, where there is no console: Settings →
      Safari → Advanced → Website Data, and remove the site (a home-screen app also lets go if
      it is deleted and re-added).

   2. From here, for a worker already out on phones you cannot reach — replace this whole file
      with the four lines below, serve it, and every browser that checks in defuses itself:

        self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", e => e.waitUntil((async () => {
          await Promise.all((await caches.keys()).map(k => caches.delete(k)));
          await self.registration.unregister();
        })()));

      This is the one place skipWaiting is right: taking over instantly is the point, and what
      it takes over with is nothing at all. */

const VERSION = "v5";
const CACHE = "inat-shell-" + VERSION;

/* Relative to this file, which is the repo root, so the app still works served from a
   subdirectory. Ten code files rather than the nine it is tempting to count — three HTML, three
   CSS, four JS — because common.js is loaded by the map and the report ahead of their own
   scripts, and a shell missing it is two pages that open to an exception. Then the manifest and
   the icons, which are the shell of the installed app in the same sense the CSS is. */
const OWN = [
  "index.html", "species.html", "gallery.html",
  "index.css", "species.css", "gallery.css",
  "common.js", "index.js", "species.js", "gallery.js",
  "manifest.json", "icon.svg", "icon-192.png", "icon-512.png"
];

/* Kept in step with index.html by hand — there is no build step to do it, and a version here
   that has drifted from the one in the page means the page loads a second copy from the network
   while this one sits unread. */
const BORROWED = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

const SHELL = new Set([...OWN, ...BORROWED].map(u => new URL(u, self.location.href).href));

/* One fetch for everything that goes into the cache, so there is one place where "is this
   actually the file?" is asked. cors rather than no-cors for the reason in the header: a status
   we can read. cache:"reload" goes past the browser's own HTTP cache, so filling a new version
   cannot quietly re-store the copy the old version was serving. Anything not ok is dropped
   rather than stored — a cached 404 is a file that is broken until someone clears a cache. */
async function stock(cache, url) {
  const res = await fetch(url, { mode: "cors", cache: "reload" });
  if (!res.ok) throw new Error(url + " — HTTP " + res.status);
  await cache.put(url, res);
}

/* The app's own files must all land: an activated worker holding this version's index.html and
   the last one's index.js is precisely the mismatch the update policy exists to prevent, and a
   failed install leaves the old worker in charge, which is the safe end of that.

   The borrowed two may fail. unpkg's temper is not this app's, and Leaflet missing costs the
   map page its tiles-and-furniture offline until the next online load picks it up (see the miss
   path in serve) — while a hard install failure over it would cost the reader every fix in the
   version, on all three pages, for as long as unpkg is having its afternoon. */
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(OWN.map(u => stock(cache, new URL(u, self.location.href).href)));
    await Promise.all(BORROWED.map(u => stock(cache, u).catch(() => {})));
  })());
});

/* Every cache that is not this version's, gone. A reader who has an old worker should not need
   to know what a service worker is to get a fix, and this origin is this app and nothing else —
   so if anything here ever caches for a second purpose (task-05's response cache is the one on
   the horizon), it has to be exempted here on purpose, in this line, where it can be seen. */
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
  })());
});

/* Which cached file, if any, a request is asking for — or null, meaning the worker has no
   business answering it. A path ending in "/" is the directory index, which for this app means
   the map. The hash never reaches here at all.

   The search goes for a document and stays for everything else, and the split is not fussiness.
   The query string is these three pages' whole state — species.html?place_id=7122&user=x and
   species.html?tab=tier are one file asked for two ways, and a cache keyed on the whole address
   would hold a hundred copies of that file and miss every new spelling. Nobody addresses a
   script that way, though, so a query on one is somebody going round this cache on purpose, and
   the one place that happens is test.html: the harness asks for common.js and species.js with a
   query so that a test run reads what is on disk. A test served the copy this worker filled
   itself with before the edit would pass and mean nothing, and it is the only safety net in
   the repo. */
function shellKey(u) {
  u.hash = "";
  if (u.pathname.endsWith("/")) u.pathname += "index.html";
  if (u.pathname.endsWith(".html")) u.search = "";
  return SHELL.has(u.href) ? u.href : null;
}

/* Cache first, and on a miss the network untouched — the request goes out exactly as it was
   made, and a verified copy is fetched separately for next time rather than the answer being
   grabbed on its way past. That separation is what keeps an opaque or half-read response out of
   the cache: everything stored here goes through stock().

   The cache is opened by name rather than matched across all of them, or a worker mid-update
   would happily serve the version it is in the middle of deleting. */
async function serve(event, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  event.waitUntil(stock(cache, key).catch(() => {}));
  return fetch(event.request);
}

/* Every request the three pages make comes through here, including eight hundred photographs on
   a scrolled gallery wall, so the address is parsed once and handed on rather than twice. */
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  /* Deliberately redundant: nothing on either host is in SHELL, so shellKey would return null
     two lines down and both would go to the network regardless. It is here because "the worker
     must never sit in front of the data" is the one rule in this file that must not break
     quietly, and a rule worth stating is worth being able to grep for. */
  if (url.host === "api.inaturalist.org" || url.host === "query.wikidata.org") return;
  const key = shellKey(url);
  if (!key) return;
  event.respondWith(serve(event, key));
});
