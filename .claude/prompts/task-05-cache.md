# Task 5 — Cache expensive API answers in sessionStorage

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative on conventions
— read it first, especially the section on what may live in storage and why.

Run the site with:

```bash
python -m http.server 8731
```

(also the `static` entry in `.claude/launch.json`)

## The gap

Only one thing is cached today: eBird species codes, in `localStorage` under
`inat.ebird.codes`. Everything else is refetched on every load.

The species page is the heaviest asker in the project. A place-tab load with a username fans
out to roughly eight concurrent paged request chains:

- `species.js:1527` — three in parallel, one of which is
- `species.js:762` — `standingLookup`, four more in parallel, one of which is
- `species.js:746` — `audioOnlySpeciesIds`, two more

and each chain pages up to 20 requests (`speciesCounts`, species.js:229). The subspecies path
(`sspStanding`, species.js:455) then fires five parallel asks *per wave*.

None of that is reused. Reload the same report, hit back, or toggle `Only subspecies`
(`wireOnlySub`, species.js:1409 — the one sortbar control that refetches) and the whole set
runs again from cold.

## Goal

A `sessionStorage` cache in front of the expensive queries, so reloads, back/forward, and the
subspecies toggle are near-instant. **The page must display exactly what it displays today —
this changes only how fast, never what.**

## Precedent to follow

Read the eBird cache block first: `species.js:625–658` (the comment block, `readEbirdCodes`,
`writeEbirdCodes`). Copy its bargain exactly:

- every read and every write wrapped in `try/catch`
- **with no storage available, the page works and simply re-asks** — never a hard dependency
- a comment block explaining *why* this particular thing is safe to keep and for how long

Note the difference in lifetime, and say so in your comment: an eBird code never changes once
minted, so it lives in `localStorage` forever. Observation counts change constantly, so this
cache belongs in `sessionStorage` with a short TTL. That contrast is the justification for
using a different store, and it should be written down.

## Check first: has task 1 landed?

There is a related, higher-priority task — wrapping every iNat fetch in a single `apiGet()`
with 429 backoff and a concurrency gate. **Check whether that exists before you start.**

- If it does, hook the cache into that one choke point. That is by far the cleanest result.
- If it does not, add the cache at the paging helpers instead (`speciesCounts` species.js:229,
  `taxaPaged` species.js:479, and `speciesCounts` index.js:148), and leave a comment noting
  that it should move to `apiGet` if that wrapper ever appears.

Do **not** implement the `apiGet` wrapper as part of this task.

## The design decision you must make explicitly

`sessionStorage` is about 5MB per origin, and a `species_counts` response for a large place is
big — 500 rows per page, each with a full taxon object, up to 20 pages. Caching raw payloads
will blow the budget on a single query.

Weigh at least these, pick one, and write down why:

- **Cache the derived result, not the payload.** Most callers reduce immediately to a `Set` of
  taxon ids (`speciesIdsWithTag` species.js:254, `unseenHere` species.js:304, `sspAsk`
  species.js:425). An array of ids is a fraction of the size. This is probably the right
  answer, but it means caching at the caller rather than at the fetch, which is more code.
- **Cache payloads with a size guard and eviction.** Simpler to hook in one place, but needs a
  byte budget, an eviction policy, and a `QuotaExceededError` path.

Whatever you choose, a write that fails must be silent and harmless.

## Requirements

- **Key on the full query string** — the complete set of parameters actually sent. Two
  different questions must never collide. Include a short schema-version prefix in the key so
  a future change to what is stored invalidates old entries rather than misreading them.
- **Short TTL**, stored with the entry and checked on read. Pick a value and justify it; a few
  minutes is the right order of magnitude for a browsing session.
- **Correctness over hit rate.** When anything is uncertain — malformed entry, version
  mismatch, unparseable JSON — treat it as a miss and refetch. Never serve a half-entry.
- **Do not cache the autocompletes** (`findTaxa` species.js:311, `findPlaces` species.js:328,
  and the map's inline one at index.js:968). They are cheap, they are already debounced, and
  stale suggestions are user-visible in a way stale counts are not.
- Purging: `sessionStorage` clears itself with the tab, so no explicit purge is required — but
  say so in a comment rather than leaving the reader to wonder.

## Guardrails

- **Do not** change any rendering, sorting, filtering, or query-string behaviour.
- **Do not** add `localStorage` state that outlives the session for anything count-derived.
- **Do not** introduce a module, a framework, or a dependency.
- **Do not** cache failures. A 429 or a 500 must not be remembered as an answer.
- Match the surrounding comment style: substantial, explaining *why*.

## Verification

Use the browser preview tools — do not ask the user to check by hand.

1. Start the `static` server and open a place-tab report with a username and a taxon scope
   (e.g. `species.html?tab=place&place_id=<id>&pname=<name>&u=<user>&iconic=Aves`).
2. Record the request count and load time on the cold load via the network panel.
3. Reload. Confirm the request count drops sharply and the **rendered list is identical** —
   same rows, same order, same counts, same badges. Compare deliberately, don't eyeball.
4. Toggle `Only subspecies` off and on and confirm the second toggle is served from cache and
   still correct.
5. Confirm behaviour with storage unavailable: disable it (or stub `sessionStorage` to throw)
   and confirm the page still loads correctly, just slower.
6. Confirm the TTL expires as intended.
7. Check the console is clean.

Report the before/after request counts and the storage-unavailable result.

## Also update

Add a short paragraph to the storage section of `CLAUDE.md`, alongside the existing notes on
`inat.gallery.seen.<user>`, `inat.ebird.codes` and `inat.map.last`, in the voice of the
surrounding document.
