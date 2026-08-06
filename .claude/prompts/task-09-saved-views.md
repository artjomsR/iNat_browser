# Task 9 — Saved views on the map

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative on conventions
— read it first, especially the section on what may live in storage and why, and the CSS
custom-property palette (`--ink`, `--raise`, `--rule`, `--text`, `--mute`, `--mark`,
`--verified`) which must be reused rather than hardcoding colours.

Run the site with:

```bash
python -m http.server 8731
```

(also the `static` entry in `.claude/launch.json`)

## The gap

The best structural decision in this codebase is that the map's entire state is one hash string:
`writeHash` (index.js:531) writes taxon, quick groups, username, mode, rank window, quality,
precision, dates, layer, basemap and viewport; `readHash` (index.js:554) reads them all back. Any
view the app can be in is a string that can be pasted anywhere.

Nothing exploits it. The only thing that ever keeps a hash is `rememberHash` (index.js:737),
which holds exactly one — the last — and only on the home screen, only to solve iOS relaunching
a baked-in URL (index.js:720).

So a reader with three or four standing questions — *my patch, birds, unobserved*; *the whole
region, S-tier missing*; *insects here, last fortnight* — rebuilds each one through the filter
sheet every time, even though each is a string the app already knows how to write.

## Goal

Named saved views on the map: save the current view under a name, see the list, restore one in a
tap, rename and delete. Stored in `localStorage`, because a saved view belongs to this reader and
this browser rather than to the link — the same distinction `CLAUDE.md` already draws for the
gallery's seen list and the eBird codes.

## Precedent to follow

Read these three before writing anything — they are the same bargain, three times:

- `readEbirdCodes` / `writeEbirdCodes` (species.js:739–752)
- `rememberHash` / `restoreHash` (index.js:737–751)
- the gallery's `readSeen` / `write` (gallery.js:189–208)

Every read and every write wrapped, and **with no storage the feature is absent and the app is
otherwise untouched.** A saved-view list that throws must never take the map down with it.

## The design decisions you must make explicitly

**How a view is restored.** Two options:

- **Set the hash and reload.** Honest and guaranteed correct: it is exactly the path a pasted
  link takes, so a saved view can never drift from a shared one. Costs a page load.
- **Re-read the hash in place** — call `readHash`, re-apply the basemap, re-render the label,
  re-run the layers. Faster, and a second restore path that has to be kept in step with boot
  forever.

**Take the first unless you can show the reload is a real problem**, and write down the choice.
Whatever you pick, a saved view must land in precisely the state the same hash produces when
pasted into the bar — that equivalence is the whole point.

**What a view holds.** The full hash includes `lat`/`lng`/`z`. A saved view is usually a place
*and* a set of filters, so including the viewport is probably right — but decide, and consider
whether the reader should be able to save filters alone. Do not build both without deciding
which is the default.

**Where it lives in the sheet.** `openSheet(view, html)` (index.js:627) already switches the
panel between named views, and the filter sheet (`filtersHtml`, index.js:762) is the one place
already about *what am I looking at*. A block at the top of the filter sheet is the obvious
home; a third sheet view is the other option. Pick one and say why.

## Requirements

- **Storage** under `inat.map.views`, following the key convention already in use. Store a list
  of `{ name, hash, saved }` — a name, the hash string verbatim, and when it was saved. Keep the
  hash as the app wrote it; do not parse it apart and reassemble it.
- **Bounded.** Cap the number of views and the total size, and handle a failed write silently and
  harmlessly (`QuotaExceededError` is a real outcome, not a theoretical one). Decide what happens
  at the cap — refuse, or drop the oldest — and say which.
- **Naming in keeping with the app.** `prompt()` works and is out of character; the sheet already
  has text inputs styled for it (`.input`, index.js:768). Prefer an inline field. Offer a
  sensible default name derived from what `renderLabel` (index.js:585) already composes — it
  exists to describe a view in a few words, which is the same job.
- **Rename and delete**, both reachable without leaving the sheet, and delete must not be a
  single unconfirmed tap next to restore.
- **Restore leaves no trace of itself.** After restoring, the address is the saved hash and the
  app is in the state that hash describes. No extra key, no marker in the URL saying it came from
  a saved view.
- **Escaping.** Names are reader-typed and are printed into `innerHTML`. Use `esc` (index.js:675)
  on every one, everywhere — the list, the rename field, any tooltip.
- **Map only, this task.** The species page's state is a query string rather than a hash
  (`selfUrl`, species.js:233), so a shared store would have to hold two shapes and know which
  page each belongs to. That is a bigger design question; note it in a comment as deliberately
  left, and do not half-build it.

## Guardrails

- **Do not** change what `writeHash` writes or what `readHash` reads. A saved view is a stored
  output of the existing mechanism, not a new state format.
- **Do not** touch `rememberHash` / `restoreHash` or the `inat.map.session` launch detection
  (index.js:720–751). Different problem, different lifetime, and it must keep working on the home
  screen exactly as it does.
- **Do not** sync, export or share the list. It is this browser's, like every other
  `localStorage` key in the project.
- **Do not** introduce a module, a framework, or a dependency.
- Both touch and mouse are in use here (`COARSE`, index.js:899). Restore, rename and delete must
  all be comfortably tappable.
- Match the surrounding comment style: substantial, explaining *why*.

## Verification

Use the browser preview tools — do not ask the user to check by hand.

1. Start the `static` server and open the map.
2. Build a distinctive view — a taxon, a username with a tier mode, a date range, a non-default
   layer — and save it under a name.
3. Change everything, then restore it. Confirm **every** filter, the layer, the basemap and the
   viewport come back, and that the address is now identical to the hash that was saved.
4. Copy that address into a fresh tab and confirm it lands in the same state — the saved path and
   the shared path must agree.
5. Save several, rename one, delete one; reload and confirm the list survives.
6. Save a view with `<script>` and quotes in the name and confirm it is printed, not run.
7. Stub `localStorage` to throw and confirm the map works normally with the feature simply
   absent — no console errors, nothing broken.
8. Confirm the home-screen launch memory still behaves (simulate standalone; a launch restores
   the last hash, a page opened from inside the app honours its link).
9. Check the console is clean throughout.

Report the restore strategy you chose and the result of steps 4, 7 and 8.

## Also update

`CLAUDE.md`: add `inat.map.views` to the storage section alongside `inat.gallery.seen.<user>`,
`inat.ebird.codes` and `inat.map.last`, saying what it holds and what happens without storage —
in the voice of the surrounding document. Mention the feature in the map bullet under **Pages**.
