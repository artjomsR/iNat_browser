# Task 3 — Add a no-build test page for the pure logic in `species.js`

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
node dependency, no npm install. Every file is served as-is. `CLAUDE.md` at the repo root is
authoritative on conventions — read it first.

Run the site with the existing static server:

```bash
python -m http.server 8731
```

(also configured as the `static` entry in `.claude/launch.json`)

## The gap

There is no test file anywhere in the repo. That's defensible for DOM wiring, but `species.js`
holds a body of pure, subtle, load-bearing logic with nothing locking it down.

## Goal

A `test.html` + `test.js` pair at the repo root, opened in a browser, that asserts the
behaviour of the pure functions in `species.js`. Hand-rolled assert harness, roughly 20–30
lines. **No test framework, no npm, no build step, no node.** The whole point is that it stays
inside the project's no-build constraint.

## The key mechanism — verify this before building on it

`species.js` is not a module. It declares everything at top level and boots itself from an
IIFE at the bottom of the file, and it reads the DOM at top level:

- `species.js:862` — `const main = document.getElementById("main");`
- `species.js:863` — `const countEl = document.getElementById("count");`

So a naive `<script src="species.js">` in a test page will run the boot and either throw or
fire network requests.

**The claimed way through:** with an *empty* query string, `species.js` resolves to the `tier`
tab with no user, and the boot short-circuits into `askUser(...)` — which paints a prompt and
fires **zero** network requests. So a test page that reproduces `species.html`'s body skeleton
(so every `getElementById` finds its element) can load `species.js` unmodified, let it settle
into that harmless state, and then call its top-level functions directly.

**Verify this claim yourself before relying on it.** Load the page, check the network panel is
empty and the console is clean. The ids `species.js` touches are:

```
backLink  count  galleryLink  groupPicks  main  note  placeClear  placeHits
placeInput  placebar  refresh  taxonClear  taxonHits  taxonInput  userBar
userInput  userQuick  who
```

`paint()` (species.js:1455) also needs a `.sub` element containing `#who`. The simplest robust
approach is to copy `species.html`'s `<body>` skeleton into `test.html` wholesale rather than
hand-picking ids.

If that approach turns out not to hold, the fallback is a one-line guard on the boot IIFE
(e.g. skip when a `__TEST__` flag is set) — but prefer zero changes to production code.

## What to cover

Prioritise in this order. Read each function and its surrounding comment block before writing
assertions — the comments state the intended behaviour precisely, and the tests should encode
what the comments claim.

1. **`sspWaves` (species.js:410)** — highest value. The entire subspecies feature rests on the
   invariant that **no wave holds two subspecies of the same parent species**; two subspecies
   of one species asked together come back merged from the API, so a violation silently
   corrupts results rather than erroring. Assert the invariant directly over a range of
   shapes: one parent with many races, many parents with one race each, mixed depths, rows
   using `x.parent` vs falling back to `x.taxon.id` (see `parentOf`, species.js:408).

2. **`comparator` (species.js:1177) and `sortRows` (species.js:1057)** — the tie-break rules
   under `rev` are the most carefully specified behaviour in `CLAUDE.md` and the easiest to
   break silently. Cover: `count` forward and reversed (reversed leads with the fewest but
   names still run A–Z on a draw); `tier` forward and reversed (bands turn over, count stays
   the tie-break so the heaviest still leads *inside* a band); `name` both ways; `taxo`
   (never reversed). The explicit claim to test is that **no reversed list is a plain mirror
   of its forward self.**

   **Note:** `comparator` compares **DOM elements** via `dataset` (`p.dataset.count`,
   `.name`, `.standing`, `.taxo`). Build real `<li>` elements with those data attributes in
   the test. **Do not refactor `comparator` to take plain objects** — running against real
   elements in a real browser is exactly what this harness is for.

3. **`idBatches` (species.js:593)** — batching by character budget. Cover: empty input, a
   single item larger than the budget, exact-boundary cases, and that no batch exceeds the
   budget while no item is dropped or duplicated.

4. **`taxoKey` (species.js:570)** — zero-pads ancestor ids to 9 characters so string
   comparison orders the tree correctly. Assert that a shorter id sorts against a longer one
   the way numeric order demands (this is the whole reason for the padding).

5. **Smaller ones:** `standingRank` / `tierRank` (species.js:802, 809), `fmtRadius`
   (species.js:277 — the metres/kilometres switch and its `Math.max(1, m)` floor), `esc`
   (species.js:138), `isSpeciesRow` (species.js:343).

## Guardrails

- **Do not** add `package.json`, a test runner, or any dependency.
- **Do not** restructure production code to make it testable beyond the absolute minimum. If
  a function genuinely cannot be reached without a change, prefer the smallest possible one
  and say why in the summary.
- **Do not** write tests that hit the network. Everything listed above is pure.
- Match the surrounding code's style: the codebase uses substantial explanatory comments that
  state *why*, not *what*. Test names should read as claims about behaviour.
- Keep `test.html` out of the three-page navigation — it is a dev tool, not a fourth page.

## Verification

Serve the repo, open `test.html`, and confirm: all assertions pass, the console is clean, and
the network panel shows no API requests. Then deliberately break one thing in `species.js`
(e.g. flip a comparator's operands), confirm the relevant test fails, and restore it. Report
the pass count and the deliberate-failure check.

## Also update

Add a short note to `CLAUDE.md` describing what `test.html` covers and how to run it, in the
voice of the surrounding document.
