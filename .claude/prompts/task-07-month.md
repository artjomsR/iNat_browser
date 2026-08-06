# Task 7 — Month-of-year filter (seasonality)

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative on conventions
— read it first, in particular the note that page state lives in the URL and that
`verifiable=true` is the default on every query.

Run the site with:

```bash
python -m http.server 8731
```

(also the `static` entry in `.claude/launch.json`)

## The gap

Both pages can only ask about a *stretch* of time, never about a *season*.

The map has an absolute window and nothing else: `state.d1` / `state.d2` (index.js:135),
defaulting to 45 days back (`defaultD1`, index.js:115), written into every query by
`obsParams` (index.js:148) and mirrored for unidentified records by `unknownParams`
(index.js:194).

The species page has no date scoping at all, and says why (species.js:358):

> Deliberately unfiltered by date or quality grade: the question is what has been recorded
> here, ever, and the map's default three-month window would quietly answer a much smaller
> one.

That reasoning is right and this task does not overturn it. A month-of-year filter is a
different question: it does not shrink the years, it slices the calendar. "What has been
recorded here in August, ever" is the question before a trip, and nothing in the app can ask
it today.

iNaturalist's `month=` parameter takes a comma-separated list of `1`–`12`, matches on the
observed date, and works on both `/observations` and `/observations/species_counts` — so this
is a filter, not a new query shape. `speciesCounts` (species.js:330, index.js:239) passes
params straight through and needs no change.

## Goal

A month-of-year filter on the map and on the species page's place tab, carried in the address
on both, and named in the label/heading so a list can never be silently narrower than it looks.

## The design decision you must make explicitly

**The map's default window will eat this filter alive.** `state.d1` defaults to 45 days back,
so a reader who picks "March" in August gets the intersection of March and the last 45 days,
which is nothing. They will read that as a broken filter, and they will be nearly right.

Weigh at least these, pick one, and write down why:

- **Clear the default window when months are chosen, leave an explicit one alone.** The best
  behaviour, and the fiddly one: `readHash` (index.js:566) substitutes `defaultD1()` when `d1`
  is absent, so by the time anything reads `state.d1` the default and a deliberate choice look
  identical. You would need to track which it is.
- **Clear `d1` outright whenever months are set.** Simple and predictable, at the cost of
  overriding a date the reader typed themselves.
- **Change nothing and say so loudly** — a hint under the month row when both are set, and the
  label naming both. Cheapest, and it puts the trap in front of the reader rather than removing
  it.

Whichever you choose, the specimen label must make the combination readable. Do not leave a
reader looking at an empty map with no way to see why.

## Requirements — the map

- **Control.** Twelve toggles in the filter sheet (`filtersHtml`, index.js:762), in the
  `Observed between` field or immediately after it. Follow the `iconicRow` chip idiom
  (index.js:779) — same markup shape, same `aria-pressed`, same multi-select behaviour as
  `qualityRow`'s handler (index.js:1123). Wire it in `wireFilters` (index.js:1036) and end in
  `commit()` like every other control there.
- **Address.** A new hash key — `m` is free. Write it only when set, the way `writeHash`
  (index.js:531) writes every non-default. Validate on the way back in `readHash`
  (index.js:554): keep only integers 1–12, drop anything else, and normalise the order so two
  spellings of the same selection produce one address.
- **Query.** One line in `obsParams` (index.js:148), and the matching line in `unknownParams`
  (index.js:194) — a record with no identification still has a date, so the month applies there
  exactly as the date range already does.
- **Label.** `renderLabel` (index.js:585) must name it. Decide how to phrase the three cases and
  say why: one month (`Aug`), a contiguous run (`Jun–Aug`, and note that a run may wrap the year
  — Nov–Feb is `11,12,1,2`), or a scatter (`3 months`). It sits alongside the year range that
  block already prints, not instead of it.
- **Carrying across.** `hereUrl` (index.js:1269) and `tierReportUrl` (index.js:868) hand the
  map's scope to the species page. Decide whether months ride along and say why — the pin, the
  taxon and the quick groups already do, and a reader who set "August" on the map and tapped
  through to the species list has every reason to expect it to hold.

## Requirements — the species page

- **Scope.** Add it to `areaScope` (species.js:365). Decide whether it also applies to
  `userScope` (species.js:316), which drives the tier tab: "my S-tier species recorded in
  August" is a coherent question but not the one that tab is for. Pick one, apply it
  consistently, and write down the reasoning.
- **Control.** The month filter refetches, which puts it with `Only subspecies` rather than in
  the sortbar: see the `.onlySub` checkbox rendered beside the bar (species.js:1224, wired at
  `wireOnlySub` species.js:1499) and the sortbar's own comment (species.js:1098) about only
  holding controls that re-read rows already on the page. Do not put it in the sortbar.
- **Address.** Same key as the map's, same spelling, for the same reason `ssp` keeps the map's
  spelling (species.js:47) — one vocabulary across two pages. Read it into `view`
  (species.js:187) with the same validation.
- **Heading.** `areaLabel` (species.js:382) is what the place tab claims to be showing, and the
  page's premise is "ever". A list narrowed to a month **must** say so in the heading, not only
  in the address.
- Update the page-address comment block at the top of `species.js` (species.js:1–52). It is the
  documented API of that page and a new key belongs in it.

## Guardrails

- **Do not** drop or weaken `verifiable=true` anywhere.
- **Do not** turn this into a date-range filter on the species page. The "ever" premise stands;
  months slice it, `d1`/`d2` would shrink it.
- **Do not** add a second rendering path, a module, a framework or a dependency.
- **Do not** touch the request gate (`apiGet`) or the paging helpers. This changes what is
  asked, not how.
- An empty selection means every month and must write nothing to the address.
- Match the surrounding comment style: substantial, explaining *why*.

## Verification

Use the browser preview tools — do not ask the user to check by hand.

1. Start the `static` server and open the map.
2. Pick a single month, confirm the request carries `month=`, and confirm the label names it.
3. Confirm the interaction with `d1`/`d2` behaves as you decided — including the case that
   motivated the decision (pick a month outside the default 45-day window and confirm the reader
   can tell what happened).
4. Reload and confirm the selection survives the address round-trip; edit the hash by hand with
   junk values (`m=0,13,foo`) and confirm they are dropped rather than sent.
5. Tap through to the species page and confirm months carry (or deliberately do not).
6. On the place tab, compare the species count for a known place with and without a month, and
   confirm the second is a strict subset — not merely smaller.
7. Confirm a contiguous selection that wraps the year (Nov–Feb) reads correctly in the label.
8. Check the console is clean.

Report the before/after species counts from step 6 and which resolution you chose for the
`d1` collision.

## Also update

`CLAUDE.md`: the map bullet under **Pages**, the species page's address list, and — importantly
— the "deliberately unfiltered by date" reasoning, which now needs its qualifier. Write it in
the voice of the surrounding document.
