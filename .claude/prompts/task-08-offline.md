# Task 8 — Web app manifest and an offline shell

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative on conventions
— read it first, in particular the external-dependency section (Leaflet via unpkg, Google
Fonts) and the note that the pages can be opened directly from disk as well as served.

Run the site with:

```bash
python -m http.server 8731
```

(also the `static` entry in `.claude/launch.json`)

## The gap

The app is already built for a phone in a field and already behaves as an installed app —
without ever having been declared one.

- `index.html:5–11` carries `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`
  ("Field"), `apple-mobile-web-app-status-bar-style` and a `theme-color`.
  `gallery.html:5–9` carries most of the same. `species.html` carries none of it.
- Both `index.js:691` and `species.js:250` branch on standalone mode and change how links open,
  because in a chromeless view a `_blank` tab is a dead end.
- `apiGet` retries a dropped connection because on a phone in a field that is *"the ordinary
  case rather than the exotic one"* (index.js:18).

And yet: no `manifest.json`, no icons, no service worker anywhere in the repo. Installed to a
home screen, the app has a generated icon and cannot open at all without a signal — not even to
show the map furniture and say so.

## Goal

Two things, in this order:

1. **A web app manifest** with a name, icons, colours, `display: standalone` and a `start_url`,
   linked from all three pages.
2. **A service worker caching the static shell** — the nine HTML/CSS/JS files — so the app opens
   instantly and, with no connection, still opens to a working interface that fails honestly.

## What this task is not

- **Not offline data.** No API response is cached here, ever. Stale species counts presented as
  current are worse than a page that says it cannot reach iNaturalist. Response caching is
  `.claude/prompts/task-05-cache.md` and is a separate decision.
- **Not a retirement of `inat.map.last`.** The home-screen hash memory (index.js:720–751) solves
  a different problem — which *view* to launch into, not which *files* to load — and a fixed
  `start_url` does not solve it. Leave that mechanism exactly as it is.

## The design decisions you must make explicitly

**Cross-origin assets.** Leaflet's CSS and JS come from unpkg and the fonts from Google
(index.html:13–16, species.html:9–11). Without them the map page has no map. Your options:

- cache them at runtime as opaque responses (works, but you cannot tell a cached error from a
  cached asset);
- vendor Leaflet into the repo (most robust — and a change to a stated convention in
  `CLAUDE.md`, so **it needs the user's agreement before you write it**, the way
  `task-06-organization.md` requires);
- leave them uncached and accept that the map page offline is furniture without tiles.

Pick one, say why, and note that the gallery deliberately loads no fonts at all
(`CLAUDE.md`, external dependencies) so it is already the page that survives this best.

**Update policy.** Decide whether a new worker takes over immediately (`skipWaiting`) or on the
next cold start. Default to **not** taking over immediately and write down why: a field session
can stay open for hours, and swapping the JS under an HTML page already loaded is how you get a
version mismatch nobody can reproduce.

**Icons without a build step.** There are no image assets in the repo and no pipeline to make
any. iOS needs a real PNG `apple-touch-icon`; Chrome will take an SVG. Decide how you produce
them, keep the count minimal (192 and 512 is enough), and draw from the app's own palette —
`--mark` (`#FF3E7C`, index.js:95) and the panel/ink greens already used for `theme-color`. Do
not commit a large binary set.

## Requirements

- **`manifest.json` at the repo root**, linked from all three pages. `name`, `short_name`
  (match the existing "Field"), `start_url`, `scope`, `display: standalone`, `background_color`
  and `theme_color` consistent with the existing `theme-color` meta tags (note that the gallery
  is deliberately a darker room and uses `#17181c` against the map's `#0D1714` — decide which
  the installed app is and justify it).
- **`sw.js` at the repo root.** Precache exactly the shell: the three HTML files, the three CSS
  files, the three JS files, and the icons. Cache-first for those; **network-only for every
  `api.inaturalist.org` and `query.wikidata.org` request** — the worker must not sit in front of
  data.
- **A versioned cache name**, with `activate` deleting every cache that is not the current one.
  Getting a fix to a reader who has the old worker must not require them to know what a service
  worker is.
- **Registration must be safe to fail.** Wrapped in a check for `'serviceWorker' in navigator`
  and in `try/catch`, on all three pages. Opening the files from disk over `file://` — which
  `CLAUDE.md` says is a supported way to run this — has no worker and must be entirely
  unaffected. Same bargain as every storage call in this repo: **no worker, and the app simply
  works as it always did.**
- **An honest offline state.** With the shell cached and no connection, the map page must open
  and show that it cannot reach iNaturalist rather than sitting empty. Look at what the existing
  failure paths do (`failed`, species.js:1564; the gallery's `say`, gallery.js:130) and match
  that voice.
- **A way out.** Document — in a comment in `sw.js` — how to unregister and clear the caches. A
  service worker is sticky, and a bad one shipped to a phone is the one bug in this repo that
  cannot be fixed by editing a file.

## Guardrails

- **Do not** cache any API response, in any store, under any TTL.
- **Do not** change how the app currently behaves in a normal browser tab, online.
- **Do not** remove or alter the `inat.map.last` / `inat.map.session` mechanism
  (index.js:720–751) or the standalone link handling (index.js:691, species.js:250).
- **Do not** add a build step, a module, a framework, or a dependency. `sw.js` is hand-written
  and readable.
- **Do not** vendor Leaflet without the user agreeing to that convention change first.
- Match the surrounding comment style: substantial, explaining *why*.

## Verification

Use the browser preview tools — do not ask the user to check by hand.

1. Start the `static` server and open the map. Confirm the worker registers and the manifest is
   picked up without warnings.
2. Reload and confirm the shell is served from the cache, not the network.
3. Go offline. Confirm all three pages still open, and that each says something true about why
   there is no data rather than showing an empty frame.
4. Go back online and confirm normal behaviour resumes with no reload needed.
5. Bump the cache version, reload twice, and confirm the old cache is deleted and the new files
   are the ones being served.
6. Confirm the site still works with the worker unregistered and the caches cleared.
7. Confirm nothing changed for a page opened directly from disk over `file://`.
8. Check the console is clean throughout, on all three pages.

Report which cross-origin strategy you chose, what the offline map page actually shows, and the
unregister procedure.

## Also update

`CLAUDE.md`: a short section on the manifest and the worker — what is cached, what deliberately
is not, and the "no worker and it works as it always did" bargain, which is the same one already
written down for storage. Add the icons and the two new root files to the file inventory in the
voice of the surrounding document.
