/* ---------------- what this is ----------------

   The pure logic in `species.js`, asserted in a browser with no framework, no runner and no
   build step — the same constraint the three pages themselves keep. `test.html` reproduces
   `species.html`'s body skeleton and loads `species.js` unmodified with an empty query string,
   which resolves to the place tab with no place and short-circuits into the place prompt
   before any request leaves. So by the time this file runs, every top-level function in
   `species.js` is in scope and callable, and nothing has been asked of iNaturalist. That claim
   is not taken on trust — the network watch installed ahead of the boot is checked below like
   anything else.

   `species.js` is not a module: it declares at top level and boots from an IIFE at the bottom.
   Top-level `const`/`let` there are lexical globals, so a script loaded after it sees them
   directly — `view`, `sortRows`, `comparator` and the rest need no export and get none.

   What is covered is the logic that is subtle, load-bearing and silent when wrong: the
   subspecies wave invariant, the sort tie-breaks under `rev`, the batching budget and the
   taxonomic key. DOM wiring, the request gate and anything that talks to the network are out
   of scope — those want a live API, not assertions.

   Written as claims: a test's name is what the code is supposed to do, so a failure reads as
   the sentence that stopped being true. Where the surrounding comments in `species.js` state a
   behaviour, the test encodes that sentence rather than whatever the code happens to do. */

/* Everything below sits inside one function for the same reason: a classic script's top-level
   `const` is a lexical global, so a fixture named `order` or a counter named `failed` would
   collide with `species.js` — silently shadowing one of its helpers, or refusing to parse at
   all. Reading its globals needs no such thing, only declaring alongside them does. */
(function tests(){

/* ---------------- the harness ---------------- */

const report = document.getElementById("report");
const tally = document.createElement("div");
tally.className = "tally";
report.appendChild(tally);

let passes = 0, fails = 0, section = null;

function group(title){
  section = document.createElement("div");
  section.innerHTML = `<h2><code>${title}</code></h2>`;
  report.appendChild(section);
}

function claim(what, run){
  let err = null;
  try{ run(); }catch(e){ err = e; }
  err ? fails++ : passes++;
  const p = document.createElement("p");
  p.className = "claim " + (err ? "fail" : "pass");
  p.textContent = what;
  if(err) p.insertAdjacentHTML("beforeend", `<span class="why">${esc(err.message)}</span>`);
  section.appendChild(p);
}

function ok(cond, why){ if(!cond) throw new Error(why || "not true"); }
function is(got, want, why){
  if(!Object.is(got, want)) throw new Error(`${why || ""} got ${show(got)}, wanted ${show(want)}`);
}
// Deep enough for what is compared here — arrays of primitives, and arrays of those.
function same(got, want, why){
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if(a !== b) throw new Error(`${why || ""} got ${a}, wanted ${b}`);
}
function show(v){ return typeof v === "string" ? JSON.stringify(v) : String(v); }

/* ---------------- the boot ----------------

   The premise everything below stands on, so it is asserted rather than assumed: an empty
   query string leaves this page in a state that has asked for nothing. If this section ever
   fails, no other failure on the page means anything — the script did not settle where the
   tests expect it. */

group("boot");

claim("an empty query string asks iNaturalist nothing", () => {
  same(window.__calls, [], "requests left during boot:");
});

claim("an empty query string is the place tab with no place", () => {
  is(view.tab, "place");
  is(view.place, "");
});

claim("with no place the place tab paints the place prompt and stops", () => {
  ok(main.textContent.includes("Which place?"), "main holds: " + main.textContent.slice(0, 60));
});

/* ---------------- sspWaves ----------------

   The whole subspecies feature rests on one invariant: no wave may hold two subspecies of the
   same parent species. Two asked together come back merged under the species, indistinguishable
   — so a violation does not throw, it silently attributes one race's count to another. Nothing
   downstream can notice. That is why this is asserted directly over a range of shapes rather
   than sampled through one example. */

group("sspWaves");

let nextId = 1000;
// A split row as splitIntoSubspecies makes one: a real taxon of its own, carrying `parent` to
// say which species it came out of. Ids are arbitrary and distinct, which is all any of this
// reads.
const race = parent => ({ count: 1, taxon: { id: ++nextId }, parent });
// A whole-species row — no `parent`, so parentOf falls back to its own taxon id.
const whole = (id) => ({ count: 1, taxon: { id: id == null ? ++nextId : id } });

// [2,1,3] — three species carrying two, one and three races between them.
function shaped(perSpecies){
  const rows = [];
  perSpecies.forEach((n, i) => { for(let k = 0; k < n; k++) rows.push(race(500 + i)); });
  return rows;
}

// The invariant, plus the two things that would make holding it worthless: a row dropped, or a
// row dealt into two waves at once.
function checkWaves(rows, waves){
  waves.forEach((wave, n) => {
    ok(wave && wave.length, `wave ${n} is missing or empty`);
    const seen = new Set();
    wave.forEach(x => {
      const p = parentOf(x);
      ok(!seen.has(p), `wave ${n} holds two subspecies of species ${p}`);
      seen.add(p);
    });
  });
  const flat = waves.flat();
  is(flat.length, rows.length, "rows lost or duplicated —");
  rows.forEach(x => ok(flat.indexOf(x) >= 0, `row ${x.taxon.id} went missing from the waves`));
}

claim("no rows makes no waves", () => {
  same(sspWaves([]), []);
});

claim("one species' races are dealt one to a wave", () => {
  const rows = shaped([4]);
  const waves = sspWaves(rows);
  is(waves.length, 4, "wave count:");
  same(waves.map(w => w.length), [1, 1, 1, 1]);
  checkWaves(rows, waves);
});

claim("a race each shares one wave, however many species there are", () => {
  const rows = shaped([1, 1, 1, 1, 1]);
  const waves = sspWaves(rows);
  is(waves.length, 1, "wave count:");
  is(waves[0].length, 5, "wave size:");
  checkWaves(rows, waves);
});

claim("mixed depths make as many waves as the deepest species has races", () => {
  const rows = shaped([2, 3, 1]);
  const waves = sspWaves(rows);
  is(waves.length, 3, "wave count:");
  // Waves fill from the front, so they can only shrink: three species reach wave 0, two reach
  // wave 1, one reaches wave 2. A wave is never left empty with a later one filled.
  same(waves.map(w => w.length), [3, 2, 1]);
  checkWaves(rows, waves);
});

claim("no wave ever holds two races of one species, over a range of shapes", () => {
  [[], [1], [7], [1, 1, 1], [2, 3, 1], [5, 1, 1, 1, 1], [4, 4], [1, 2, 3, 4, 5], [2, 1, 3, 1, 2]]
    .forEach(shape => {
      const rows = shaped(shape);
      checkWaves(rows, sspWaves(rows));
    });
});

claim("a row with no parent stands as its own species", () => {
  const rows = [whole(), whole(), whole()];
  const waves = sspWaves(rows);
  is(waves.length, 1, "three distinct species are one wave —");
  checkWaves(rows, waves);
});

claim("a species row and a race pointing at it are one parent, so they never share a wave", () => {
  // The fallback in parentOf is not a separate namespace: a whole-species row keyed by its own
  // taxon id and a race carrying that id as `parent` are the same species asked two ways, and
  // asking for both at once is exactly the merge the waves exist to prevent.
  const rows = [whole(777), race(777)];
  const waves = sspWaves(rows);
  is(waves.length, 2, "wave count:");
  checkWaves(rows, waves);
});

/* ---------------- comparator ----------------

   The sortbar re-orders the rendered rows rather than re-rendering them, so `comparator`
   compares DOM elements through `dataset` — and is tested against real elements carrying the
   attributes `rowHtml` writes, because running against the real thing in a real browser is the
   whole reason this harness exists.

   The claim that matters most is the one CLAUDE.md states and nothing else enforces: reversing
   an order turns over only what that order is asking, never the tie-break inside it, so no
   reversed list is a plain mirror of its forward self. */

group("comparator");

function li(name, count, standing, taxo){
  const el = document.createElement("li");
  el.dataset.count = String(count);
  el.dataset.name = name;                       // rowHtml writes sortName(t), already lowercase
  el.dataset.standing = standing || "";
  el.dataset.taxo = taxo || "";
  return el;
}
const order = (els, by, rev) => els.slice().sort(comparator(by, rev)).map(e => e.dataset.name);
const mirror = list => list.slice().reverse();

// adder and buzzard are level on count, which is where the tie-break shows.
const counted = [li("adder", 5), li("buzzard", 5), li("crake", 9), li("dipper", 1)];

claim("count leads with the most observed, names A–Z on a draw", () => {
  same(order(counted, "count", false), ["crake", "adder", "buzzard", "dipper"]);
});

claim("count reversed leads with the fewest, but names still run A–Z on a draw", () => {
  same(order(counted, "count", true), ["dipper", "adder", "buzzard", "crake"]);
});

claim("count reversed is not a plain mirror of count forwards", () => {
  const back = order(counted, "count", true);
  same(back.slice(1, 3), ["adder", "buzzard"], "the tied pair should not have turned over —");
  ok(JSON.stringify(back) !== JSON.stringify(mirror(order(counted, "count", false))),
     "the reversed list is exactly the forward list backwards");
});

// Two rows with no standing at all and different counts, so the within-band order is visible on
// both readings; one audio, one S, so there are three bands to turn over.
const banded = [li("adder", 3, ""), li("buzzard", 8, ""), li("crake", 2, "s"), li("dipper", 4, "audio")];

claim("tier bands weakest first — never recorded, audio, then the tags — heaviest inside a band", () => {
  same(order(banded, "tier", false), ["buzzard", "adder", "dipper", "crake"]);
});

claim("tier reversed turns the bands over and nothing else: the heaviest still leads inside one", () => {
  same(order(banded, "tier", true), ["crake", "dipper", "buzzard", "adder"]);
});

claim("tier reversed is not a plain mirror of tier forwards", () => {
  const back = order(banded, "tier", true);
  same(back.slice(2), ["buzzard", "adder"], "the band of two should not have turned over —");
  ok(JSON.stringify(back) !== JSON.stringify(mirror(order(banded, "tier", false))),
     "the reversed list is exactly the forward list backwards");
});

claim("name runs A–Z forwards and Z–A reversed", () => {
  same(order(counted, "name", false), ["adder", "buzzard", "crake", "dipper"]);
  same(order(counted, "name", true), ["dipper", "crake", "buzzard", "adder"]);
});

// Keys as taxoKey mints them: two rows under ancestor 3, one under 26.
const treed = [
  li("crake", 1, "", "000000003.000000090"),
  li("adder", 1, "", "000000026.000000010"),
  li("buzzard", 1, "", "000000003.000000009")
];

claim("taxonomic reads the ancestor key, names A–Z on a draw", () => {
  same(order(treed, "taxo", false), ["buzzard", "crake", "adder"]);
});

claim("taxonomic never turns over — the tree's order is not a preference", () => {
  same(order(treed, "taxo", true), order(treed, "taxo", false));
});

/* ---------------- sortRows ----------------

   The same orders again, applied to the rows before the first paint rather than to the elements
   after it. Two readings of one intent that have to agree, since a reader flipping the sortbar
   after a load must not see a different list from one who arrived with `sort` in the address.
   Direction comes off `view.rev` here rather than as an argument, so the tests set it. */

group("sortRows");

const R = (id, name, count, ancestors) => ({
  count,
  taxon: {
    id, name, preferred_common_name: name, rank_level: 10,
    // iNat's ancestor_ids include the taxon itself, which ancestorsOf filters back out.
    ancestor_ids: (ancestors || []).concat(id)
  }
});
const names = rs => rs.map(x => x.taxon.preferred_common_name);

// As the API hands them over: heaviest first, with a pair level on count.
const arrived = [R(11, "crake", 9), R(12, "adder", 5), R(13, "buzzard", 5), R(14, "dipper", 1)];
const arrivedNames = names(arrived);

function withRev(rev, run){
  const was = view.rev;
  view.rev = rev;
  try{ return run(); }finally{ view.rev = was; }
}

claim("forwards, the count order is the order the rows already arrived in", () => {
  withRev(false, () => same(names(sortRows(arrived, "count")), ["crake", "adder", "buzzard", "dipper"]));
});

claim("and costs nothing — forwards, the count order hands back the very array it was given", () => {
  withRev(false, () => ok(sortRows(arrived, "count") === arrived, "the rows were copied and sorted"));
});

claim("count reversed leads with the fewest, names A–Z on a draw", () => {
  withRev(true, () => same(names(sortRows(arrived, "count")), ["dipper", "adder", "buzzard", "crake"]));
});

claim("count reversed is not a plain mirror of count forwards", () => {
  const back = withRev(true, () => names(sortRows(arrived, "count")));
  ok(JSON.stringify(back) !== JSON.stringify(mirror(arrivedNames)),
     "the reversed list is exactly the forward list backwards");
});

// The place tab's badge lookup: crake and adder unrecorded, buzzard tagged S, dipper audio-only.
const standing = x => ({ 11: "", 12: "", 13: "s", 14: "audio" })[x.taxon.id];

claim("tier bands the rows weakest first, heaviest inside each band", () => {
  withRev(false, () =>
    same(names(sortRows(arrived, "tier", standing)), ["crake", "adder", "dipper", "buzzard"]));
});

claim("tier reversed turns the bands over and leaves the count tie-break alone", () => {
  withRev(true, () =>
    same(names(sortRows(arrived, "tier", standing)), ["buzzard", "dipper", "crake", "adder"]));
});

claim("tier with nothing to band by falls back to the count, in whichever direction is set", () => {
  // The tier tab and any place tab without a username reach here: the order was asked for, but
  // no standing exists to read, so it must not silently scramble the list.
  withRev(false, () => same(names(sortRows(arrived, "tier")), arrivedNames));
  withRev(true, () => same(names(sortRows(arrived, "tier")), ["dipper", "adder", "buzzard", "crake"]));
});

claim("name runs A–Z forwards and Z–A reversed", () => {
  withRev(false, () => same(names(sortRows(arrived, "name")), ["adder", "buzzard", "crake", "dipper"]));
  withRev(true, () => same(names(sortRows(arrived, "name")), ["dipper", "crake", "buzzard", "adder"]));
});

const grown = [R(21, "crake", 1, [3, 90]), R(22, "adder", 1, [26, 10]), R(23, "buzzard", 1, [3, 9])];

claim("taxonomic reads the ancestor path, and never turns over", () => {
  const forward = withRev(false, () => names(sortRows(grown, "taxo")));
  same(forward, ["buzzard", "crake", "adder"]);
  withRev(true, () => same(names(sortRows(grown, "taxo")), forward));
});

claim("sorting never disturbs the rows it was handed", () => {
  same(names(arrived), ["crake", "adder", "buzzard", "dipper"], "the fixture was reordered in place —");
  same(names(grown), ["crake", "adder", "buzzard"], "the fixture was reordered in place —");
});

/* ---------------- idBatches ----------------

   iNat refuses a request past somewhere around 8,000 characters of query string, so id lists
   are cut by character budget rather than by count. Two things have to hold: no batch may go
   over the budget, and no id may be dropped or asked for twice — a dropped id is a missing
   family heading or, on the subspecies path, a race quietly losing its count. */

group("idBatches");

// What idBatches itself charges an id: its digits, plus the comma that joins it on.
const cost = batch => batch.reduce((n, id) => n + String(id).length + 1, 0);

claim("no ids, no batches", () => {
  same(idBatches([], 100), []);
});

claim("a single id wider than the whole budget is still asked for, alone", () => {
  // Nothing can be done about it but send it — dropping it would lose the row silently, which
  // is worse than a request that may be refused.
  same(idBatches([12345], 3), [[12345]]);
  same(idBatches([111, 222, 333], 2), [[111], [222], [333]]);
});

claim("a batch may fill the budget exactly", () => {
  // Four three-digit ids cost four characters each; eight is room for two of them.
  same(idBatches([111, 222, 333, 444], 8), [[111, 222], [333, 444]]);
});

claim("one character short of the budget splits", () => {
  same(idBatches([111, 222, 333, 444], 7), [[111], [222], [333], [444]]);
});

claim("across mixed id widths, no batch exceeds the budget and nothing is dropped or doubled", () => {
  const ids = [7, 42, 913, 5150, 66231, 1234567, 8, 91, 2024, 33333, 4, 121212, 55, 606];
  [8, 12, 20, 40, 1000].forEach(budget => {
    const batches = idBatches(ids, budget);
    same(batches.flat(), ids, `budget ${budget} changed the ids —`);
    batches.forEach(b => ok(cost(b) <= budget || b.length === 1,
      `budget ${budget}: a batch of ${b.length} costs ${cost(b)}`));
  });
});

/* ---------------- taxoKey ----------------

   The taxonomic order sorts on a string, so the ids in it are zero-padded to a fixed width —
   without which "3" would sort after "20" and the tree would come out in an order that looks
   almost right, which is the worst kind of wrong. */

group("taxoKey");

claim("a shorter ancestor id sorts against a longer one the way numeric order demands", () => {
  const shallow = taxoKey({ id: 101, ancestor_ids: [3, 101] });
  const deep = taxoKey({ id: 102, ancestor_ids: [20, 102] });
  ok(shallow.localeCompare(deep) < 0, `ancestor 3 must sort before 20: ${shallow} vs ${deep}`);
  // The counterfactual, which is the whole reason for the padding.
  ok("3" > "20", "unpadded, a plain string compare would already have got this right");
});

claim("each level is padded to nine characters", () => {
  is(taxoKey({ id: 2, ancestor_ids: [7] }), "000000007");
  is(taxoKey({ id: 2, ancestor_ids: [7, 481234] }), "000000007.000481234");
});

claim("a taxon's own id is not part of its key", () => {
  // Otherwise a species would be pushed around inside its own genus by its id, and a genus
  // could not sit at the head of the species under it.
  is(taxoKey({ id: 5, ancestor_ids: [1, 2, 5] }), taxoKey({ id: 9, ancestor_ids: [1, 2] }));
});

claim("a parent sorts ahead of everything under it", () => {
  const genus = taxoKey({ id: 2, ancestor_ids: [1] });
  const species = taxoKey({ id: 3, ancestor_ids: [1, 2] });
  ok(genus.localeCompare(species) < 0, `${genus} should sort before ${species}`);
});

claim("a taxon with no ancestry has an empty key rather than an error", () => {
  is(taxoKey({ id: 4 }), "");
  is(taxoKey({ id: 4, ancestor_ids: [] }), "");
});

/* ---------------- standingRank and tierRank ----------------

   The same five names read two ways on purpose, and the difference is entirely in what a blank
   means. To the hide-cascade a blank is a tier-tab row wearing the plain tick; to the sort it
   is a species the reader has nothing at all on, which is what the place tab is read for. */

group("standingRank / tierRank");

claim("the hide cascade ranks audio at the floor and S at the top", () => {
  same(STANDING_ORDER.map(standingRank), [0, 1, 2, 3, 4]);
});

claim("to the hide cascade a blank is the plain tick", () => {
  is(standingRank(""), standingRank("seen"));
  is(standingRank(null), standingRank("seen"));
  is(standingRank(undefined), standingRank("seen"));
});

claim("to the sort a blank is a species never recorded, below the floor", () => {
  is(tierRank(""), 0);
  ok(tierRank("") < tierRank("audio"), "never recorded must lead the tier order");
});

claim("the tier sort keeps the cascade's order, shifted up by one to make room", () => {
  same(STANDING_ORDER.map(tierRank), [1, 2, 3, 4, 5]);
});

/* ---------------- fmtRadius ----------------

   A pin dropped at deep zoom carries a radius of metres, and printing that in kilometres rounds
   the whole area away to "0.0 km" — a label that says the list is of nowhere. */

group("fmtRadius");

claim("kilometres above a kilometre, to one decimal", () => {
  is(fmtRadius(12), "12.0 km");
  is(fmtRadius(1.2), "1.2 km");
  is(fmtRadius(1.25), "1.3 km");
});

claim("the switch is at a kilometre exactly", () => {
  is(fmtRadius(1), "1.0 km");
  is(fmtRadius(0.999), "999 m");
});

claim("metres below it, whole", () => {
  is(fmtRadius(0.05), "50 m");
  is(fmtRadius(0.4), "400 m");
});

claim("and never nothing — a radius that rounds to zero metres still reads as one", () => {
  is(fmtRadius(0), "1 m");
  is(fmtRadius(0.0004), "1 m");
});

/* ---------------- esc ---------------- */

group("esc");

claim("the five characters that would break out of markup are escaped", () => {
  is(esc(`<a href="x" title='y'>&`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;");
});

claim("the ampersand is escaped as itself, so escaping twice is visible rather than silent", () => {
  is(esc("&amp;"), "&amp;amp;");
});

claim("nothing becomes an empty string, not \"null\"", () => {
  is(esc(null), "");
  is(esc(undefined), "");
  is(esc(""), "");
});

claim("a zero survives, being a count rather than an absence", () => {
  is(esc(0), "0");
});

/* ---------------- isSpeciesRow ----------------

   species_counts groups by leaf taxon, so an observation left at genus lands as its own row.
   rank_level: species and hybrid 10, subspecies 5, genus 20. An absent rank_level fails open —
   a row iNat did not label is kept rather than quietly dropped from the list. */

group("isSpeciesRow");

claim("a species is a species row, and so is a subspecies", () => {
  ok(isSpeciesRow({ taxon: { rank_level: 10 } }));
  ok(isSpeciesRow({ taxon: { rank_level: 5 } }));
});

claim("anything coarser than species is not", () => {
  ok(!isSpeciesRow({ taxon: { rank_level: 20 } }), "genus");
  ok(!isSpeciesRow({ taxon: { rank_level: 30 } }), "family");
});

claim("an unlabelled row fails open", () => {
  ok(isSpeciesRow({ taxon: {} }));
  ok(isSpeciesRow({ taxon: { rank_level: null } }));
});

/* ---------------- the tally ---------------- */

tally.className = "tally " + (fails ? "bad" : "good");
tally.textContent = fails
  ? `${fails} failed, ${passes} passed`
  : `${passes} passed, none failed`;
document.title = (fails ? `${fails} FAILED — ` : "") + "species.js tests";

})();
