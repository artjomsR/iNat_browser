# Task 10 — Take the species list off the screen

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative on conventions
— read it first, in particular the species page's description and the CSS custom-property
palette (`--ink`, `--raise`, `--rule`, `--text`, `--mute`, `--mark`, `--verified`) which must be
reused rather than hardcoding colours.

Run the site with:

```bash
python -m http.server 8731
```

(also the `static` entry in `.claude/launch.json`)

## The gap

The place tab builds a genuine target list — every species in an area, ticked against one
reader, banded by tier, sorted four ways, thinned by a threshold and by the hide-cascade — and
it exists only as long as the tab is open. There is no way to put it in a notebook, print it,
take it somewhere with no signal, or tick it off on paper.

Everything needed is already computed. `relist` (species.js:1360) makes one pass that sorts,
hides and renumbers, and is the single place that decides what is showing; `retally`
(species.js:1321) counts the survivors; every row carries what it is in data attributes
(`rowHtml`, species.js:1066): `data-count`, `data-name`, `data-taxo`, `data-taxon`,
`data-standing`, `data-sci`.

The gallery already knows how to hand something over — the copy button and its delegated
listener, `gallery.js:795` and `gallery.js:806–816`: write to the clipboard, swap the label to
"Copied", reset after 1200ms, swallow a failure silently. That is the idiom to follow.

## Goal

A control on the species page that puts the list, exactly as it is currently showing, somewhere
the reader can keep it.

## The design decisions you must make explicitly

**Clipboard, file, or both.** A copy is the fastest path into a notes app and matches the
gallery's existing idiom. A download survives a phone reboot and opens in a spreadsheet. Decide;
if you build only one, build the copy.

**Note the trap either way:** `navigator.clipboard` needs a secure context. Served from
`http://localhost:8731` that is satisfied; served from a LAN address — `http://192.168.x.x:8731`,
which is exactly how this gets opened on a phone — it is not, and the call fails. The gallery
swallows that failure silently (gallery.js:815), which is defensible for one photo link and is
not defensible for a list the reader is trying to take into the field. Decide on a fallback (a
selectable textarea, a download, or a visible failure that says what happened) and implement it.

**Format.** Plain text reads best pasted into notes and prints as a checklist; TSV/CSV opens in a
spreadsheet; Markdown is neither. Pick one as the default and justify it against what the list is
*for* — someone standing in a field working through what they have not recorded. If you offer a
second format, it must not double the code that decides *what* goes in.

**Which columns.** At least: the number as shown, the common name, the scientific name, and the
area's count. Then decide on the standing/tier badge (it is the whole point of the place tab, so
it probably belongs, spelled as a word rather than as a glyph) and the iNaturalist URL (useful in
a spreadsheet, noise on a printed list).

## Requirements

- **Read the DOM, not the source rows.** Take `#main ul li:not([hidden])` in document order. That
  is the one representation that already reflects the sort, the threshold, the rank cascade, the
  subspecies split and the family bands — all of which `relist` has already applied. Recomputing
  any of that from the fetched arrays creates a second opinion about what is showing, and the two
  will disagree the first time anything changes.
- **Both tabs.** The tier tab is several `<section>`s (`listHtml`, species.js:1231) and the place
  tab is one (`placeListHtml`, species.js:1194). Include the section headings on the tier tab —
  a flat list of names loses the banding that tab exists to show — and skip the `li.fam` family
  headings or render them as headings too, but decide which and be consistent.
- **A header.** What this list is, so a printout found later still means something: the area or
  scope (`areaLabel`, species.js:382; `scopeLabel`, species.js:305), the username where there is
  one, the count as shown ("412 of 1,203 observed" — the pair `retally` already maintains), the
  date it was taken, and **the page's own URL**. The address is the state (`selfUrl`,
  species.js:233), so that one line makes the whole list reproducible, which no other export
  format would give you for free.
- **Placement.** It changes nothing about the list, so it can sit in the sortbar
  (`sortbarHtml`, species.js:1103) — but the sortbar's comment says it holds controls that
  *re-read rows already on the page*, and this reads them without changing anything at all. The
  `.onlySub` checkbox beside the bar (species.js:1224) is the precedent for "adjacent, not in
  it". Pick one, say why.
- **Rebinding.** The sortbar is destroyed and recreated on every paint, and its listeners with it
  — see the note at `wireSort` (species.js:1430). Either bind in the same place the other sortbar
  controls are bound, or delegate from `document` the way `wireHideToggle` (species.js:1413)
  does. Do not leave a control that stops working after the first re-sort.
- **Escaping is a different problem here.** These strings are going into a text file or a
  clipboard, not into `innerHTML`, so `esc` (species.js:239) is the wrong tool. If you choose
  CSV, quote and double-quote properly — common names contain commas, and scientific names
  contain nothing worse but the code must not assume it.
- **Feedback.** Follow the gallery: swap the label, restore it after a beat. No alert, no toast
  framework.

## Guardrails

- **Do not** refetch anything. Everything needed is on the page.
- **Do not** change the sort, the threshold, the cascade, the layout or the address. This is a
  read.
- **Do not** add a second source of truth about which rows are visible.
- **Do not** introduce a module, a framework, or a dependency. A download is a `Blob`, an object
  URL and an `<a download>` — and revoke the URL afterwards.
- The grid layout (`layout=grid`) is the same `<li>`s under a class on `#main`, so the export must
  work identically in both layouts. Confirm it, do not assume it.
- Match the surrounding comment style: substantial, explaining *why*.

## Verification

Use the browser preview tools — do not ask the user to check by hand.

1. Start the `static` server and open a place-tab report with a username and a taxon scope
   (e.g. `species.html?tab=place&place_id=<id>&pname=<name>&u=<user>&iconic=Aves`).
2. Set a threshold, hide a tier via the cascade, and sort taxonomically. Export, and compare the
   result against the visible rows **line by line** — same rows, same order, same numbering. Do
   not eyeball it; check the first row, the last row, and the total.
3. Flip to grid and confirm the export is unchanged.
4. Re-sort, then export again from the same paint, and confirm the control still works (the
   rebinding trap above).
5. Do the same on the tier tab and confirm the banding survives.
6. Turn on `Only subspecies` and confirm the split rows export as themselves.
7. Confirm the fallback path works where `navigator.clipboard` is unavailable — stub it to throw
   and confirm the reader still gets the list and can tell what happened.
8. Paste the exported header URL into a fresh tab and confirm it reproduces the same list.
9. Check the console is clean.

Report the format you chose, what the header line looks like, and the result of steps 2 and 7.

## Also update

`CLAUDE.md`: a line in the species page bullet under **Pages** saying what the control exports and
that it follows the visible rows rather than the fetched ones — that being the fact a future
change is most likely to break. Write it in the voice of the surrounding document.
