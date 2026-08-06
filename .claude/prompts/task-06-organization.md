# Task 6 — Code organisation: shared helpers, and file size

## ⚠️ Read this first

**Both parts of this task contradict a stated convention in `CLAUDE.md`. Neither should be
started without the user explicitly agreeing to the convention change.** Confirm before
writing code. If the user has already agreed in the message that sent you here, proceed.

Part A is the one worth doing. Part B is genuinely optional and lower value.

## Project context

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm, no ES modules. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative
— read it in full first.

The specific convention in tension here:

> Each page is a plain `<link rel="stylesheet">` + `<script src>` pair — no modules, no
> imports, everything in one script file per page. Keep it that way; don't introduce a build
> step or split further unless a file becomes unwieldy again.

Run the site with:

```bash
python -m http.server 8731
```

---

## Part A — a shared `common.js`

### The gap

Four things are duplicated across page scripts, and the copies have **already drifted**:

| Thing | Where | Notes |
|---|---|---|
| `esc()` | `gallery.js`, `index.js`, `species.js` | HTML-escape helper |
| `ICONIC` | `gallery.js:52`, `index.js`, `species.js:56` | the iconic-taxa list |
| `userScope()` | `index.js:139`, `species.js:215` | |
| `speciesCounts()` | `index.js:148`, `species.js:229` | **drifted — see below** |

The `speciesCounts` drift is the important part, and it is **intentional on both sides**:

- `index.js:148` takes a `stale` callback and polls it between pages (`index.js:157`) so a
  superseded load can bail out early. `species.js` has no equivalent.
- `species.js:233` sets `verifiable=true` unless the caller passed `verifiable` itself — an
  override `speciesIdsWithTag` (species.js:254) relies on to reach into casual records,
  because a tier tag stands wherever the photograph sits. Read the comment at
  species.js:222–228 and 245–253 before touching this. `index.js`'s copy has no such
  override.

**A naive merge would be a behaviour change, not a refactor.** The unified version must
support both behaviours, and every call site on both pages must be checked against what it
relied on. This is the whole risk of Part A — treat it as the main work, not a detail.

### What to do

1. Create `common.js` at the repo root holding only what is genuinely shared.
2. Load it with a second plain `<script src="common.js">` **before** the page script in all
   three HTML files. Load order matters — everything stays global; there are no modules and
   no imports, and none may be introduced.
3. Reconcile `speciesCounts` deliberately, preserving both the `stale` polling and the
   `verifiable` override. Write a comment explaining that the unified function carries two
   callers' requirements and why each exists.
4. Verify `esc()` and `ICONIC` really are identical across the three files before merging
   them — check character by character, don't assume.

### Note on the related task

There is a higher-priority task to introduce a single `apiGet()` wrapper with 429 backoff and
a concurrency gate across all pages. `common.js` is its natural home. **Check whether that has
landed.** If it has, fold it in here rather than leaving two organisational schemes. If it has
not, do not implement it as part of this task — just leave `common.js` shaped so it fits.

### Guardrails

- **No build step, no bundler, no ES modules, no `import`/`export`, no dependency.** A second
  plain `<script src>` is not a module and not a build step — that is the entire basis on
  which this is arguable at all. Do not exceed it.
- The gallery deliberately **loads no fonts and keeps its own darker palette** (`CLAUDE.md`).
  Do not let sharing code become sharing style or sharing assets.
- Move only what is *actually* shared. Resist pulling in near-misses; two functions that
  merely look alike are not one function.
- **`CLAUDE.md` must be updated** if this lands — the "one script file per page" sentence
  becomes wrong, and the new arrangement needs describing in the voice of the document.

---

## Part B — file size (optional, lower value)

### The situation

- `species.js` — 1815 lines / ~95KB
- `index.js` — 1581 lines / ~74KB
- `gallery.js` — 964 lines / ~37KB

`CLAUDE.md` leaves a door open with "unless a file becomes unwieldy again". `species.js` is
arguably at that threshold. `index.js` is close. Neither is urgent, and both are unusually
well organised and commented for their size — this is a judgement call, not a defect.

### If the user wants it

The obvious seam in `species.js` is the **subspecies machinery** — a self-contained block with
its own documented invariants, roughly `species.js:390–540` (`parentOf`, `sspWaves`, `sspAsk`,
`sspStanding`, `taxaPaged`, `splitIntoSubspecies`). It has the clearest boundary and the
densest logic.

Before splitting, read the subspecies comment block in full and the corresponding section of
`CLAUDE.md`. The rule that waves hold at most one subspecies per parent is a correctness lock,
not a style preference; a split must not make it easier to violate.

Same guardrails as Part A: plain `<script src>` only, load order matters, everything global,
no modules, no build step, `CLAUDE.md` updated.

### Recommendation

Do Part A first and stop. Reassess Part B afterwards — extracting shared helpers will shrink
these files somewhat on its own, and may make the case for a further split weaker.

---

## Verification (both parts)

Use the browser preview tools — do not ask the user to check by hand. This is a refactor, so
the bar is **no observable change at all**.

1. Start the `static` server.
2. Exercise all three pages against real query strings before and after, and compare:
   - `index.html` — map loads, filter sheet works, taxon autocomplete works, accuracy layer
     renders
   - `species.html?u=<user>` — tier tab
   - `species.html?tab=place&place_id=<id>&pname=<name>&u=<user>&iconic=Aves` — place tab,
     including the sort controls, the threshold, family bands, the hide-cascade, grid layout,
     and the `Only subspecies` toggle
   - `gallery.html?user=<user>` — wall loads, full-screen viewer opens and steps
3. Confirm the console is clean on every page and no request pattern has changed.
4. Pay particular attention to anything that went through `speciesCounts` — that is where a
   silent behaviour change would hide. Verify the tier-tag bands specifically, since they
   depend on the `verifiable` override.

Report exactly what you exercised, and flag anything you could not verify.
