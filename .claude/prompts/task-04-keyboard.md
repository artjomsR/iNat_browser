# Task 4 — Keyboard navigation and ARIA for the autocomplete finders

## Project context (read before doing anything)

`iNat_browser` is a **static, no-build, three-page site**: no `package.json`, no bundler, no
npm. Every file is served as-is. `CLAUDE.md` at the repo root is authoritative on conventions
— read it first, in particular the CSS custom-property palette (`--ink`, `--raise`, `--rule`,
`--text`, `--mute`, `--mark`, `--verified`) which must be reused rather than hardcoding
colours.

Run the site with:

```bash
python -m http.server 8731
```

(also the `static` entry in `.claude/launch.json`)

## The gap

The type-ahead finders can only be operated with a pointer. `wireFinder` (`species.js:1563`)
binds exactly two things: an `input` listener (debounced at 300ms, with a `seq` counter
guarding against stale responses) and a `click` listener on the results container. There is:

- no ArrowDown / ArrowUp to move through results
- no Enter to take the highlighted (or first) result
- no Escape to dismiss the list
- no ARIA — the results container has no `role`, the input no `aria-expanded`

So on desktop the only way to choose a result is to click it. The debounce and the
stale-response guard are already correct; this is the missing half of the interaction.

For contrast, the gallery's keyboard handling (`gallery.js:886`) is in much better shape and
is a reasonable reference for house style.

## Scope

There are **two separate implementations** of the same idea:

1. **`species.js:1563` — `wireFinder({ input, hits, find, row, pick })`.** Shared by both the
   place finder (`wirePlaceFinder`, species.js:1605) and the taxon finder
   (`wireTaxonFinder`, species.js:1632). **Do this one first** — one change serves both.

2. **`index.js` ~950–1000 — an inline copy** for the map's taxon autocomplete (`#taxonInput`
   / `#ac`). Structurally the same but written out separately, with its own 280ms debounce
   and its own `seq` guard.

Do (1) properly. Then decide on (2) and say which you chose and why: mirroring the behaviour
is good for consistency, but the two are independent copies and merging them is a separate
question (see `.claude/prompts/task-06-organization.md`). Do **not** extract a shared helper
as part of this task.

## Markup you are working against

`species.html` (see lines ~32–50):

```html
<div class="finder">
  <input id="placeInput" type="text" ...>
  <button type="button" class="wipe" id="placeClear" aria-label="Clear the place">&times;</button>
  <div class="hits" id="placeHits" hidden></div>
</div>
```

The taxon finder is the same shape with `.hits.taxa`. Results are rendered by the `row`
callback into `hits.innerHTML` as **real `<button type="button" data-id="...">` elements** —
they are already focusable and already keyboard-activatable.

That last fact matters for the design decision: because the options are real buttons, you can
either move DOM focus between them (roving focus) or keep focus in the input and track a
highlighted option with `aria-activedescendant`. **Pick one and justify it.** Keeping focus in
the input is usually right for a combobox — the user must be able to keep typing to refine —
but that requires giving each option an id and managing `aria-activedescendant`, and the
existing click path must keep working either way.

## Requirements

- **ArrowDown / ArrowUp** move through results. Decide and document what happens at the ends
  (wrap, or stop). ArrowDown with the list closed but results available should reopen it.
- **Enter** takes the current selection. If nothing is highlighted, decide whether Enter takes
  the first result or does nothing — the taxon input is `type="search"` with
  `enterkeyhint="search"`, so a bare Enter currently has form semantics; check what it does
  today before changing it.
- **Escape** closes the list without clearing the typed text. A second Escape may clear the
  field if that reads well.
- **Tab** should not leave a dangling open list.
- **ARIA:** `role="listbox"` on the hits container, `role="option"` on each result,
  `aria-expanded` and `aria-controls` on the input, plus `aria-selected` / 
  `aria-activedescendant` per whichever model you chose. Consider `role="combobox"` on the
  input.
- **Visible highlight:** a highlighted option needs a style. Add a class and style it in
  `species.css` using the existing custom properties. It must be distinguishable from
  `:hover` and must survive both light interaction and touch.

## Guardrails

- **Do not** break the existing pointer path — click-to-pick and click-away-to-close
  (`species.js:1595`) must keep working exactly as they do.
- **Do not** touch the debounce or the `seq` stale-response guard (`species.js:1580`, `1583`).
  They are correct. A late response must still be discarded, and highlight state must reset
  sanely when a new result set lands.
- **Do not** introduce a framework, a module, or a dependency.
- Both pages are used on touch devices (`index.js` has a `COARSE` check). Nothing here should
  degrade touch behaviour or cause a mobile keyboard to open or close unexpectedly.
- Match the surrounding comment style: explain *why* a choice was made, not what the line does.

## Verification

Use the browser preview tools — do not ask the user to check by hand.

1. Start the `static` server and open `species.html`.
2. Type into the place finder, then drive it entirely from the keyboard: arrow to a result,
   Enter to select, confirm the page navigates to the right URL.
3. Repeat for the taxon finder on the same page.
4. Confirm Escape closes without clearing, and that clicking still works unchanged.
5. Read the accessibility tree and confirm the roles and states are actually present and
   correct — not just that the attributes were written.
6. Take a screenshot of the highlighted state.
7. Check the console is clean throughout.

Report what you verified and anything you deliberately left out.
