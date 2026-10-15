const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('index.js', 'utf8')
  .split('const handleBtn =')[1].split('// The list itself reads')[0];

function setup(mobile = true) {
  const events = {}, body = {dataset: {}}, state = {closes: 0};
  const handle = {addEventListener: (name, fn) => events[name] = fn, setPointerCapture() {}};
  vm.runInNewContext('const handleBtn =' + source, {
    document: {body, getElementById: () => handle},
    matchMedia: () => ({matches: mobile}), sheetView: 'results',
    closeSheet: () => state.closes++,
  });
  function fire(name, props = {}) {
    const event = {clientY: 100, pointerId: 1, isPrimary: true, button: 0, detail: 1,
      preventDefault() {this.prevented = true;}, stopPropagation() {this.stopped = true;}, ...props};
    events[name](event);
    return event;
  }
  return {fire, state, body};
}

test('tap keeps the panel in place until click, then consumes it and closes once', () => {
  const h = setup();
  h.fire('pointerdown');
  h.fire('pointerup');
  assert.equal(h.state.closes, 0, 'pointerup must not expose the map to the pending click');
  const click = h.fire('click');
  assert.equal(h.state.closes, 1);
  assert.equal(click.prevented, true);
  assert.equal(click.stopped, true);
});

test('resize and short drags consume their click without closing; next tap closes', () => {
  for (const dy of [-60, 60, 15]) {
    const h = setup();
    h.fire('pointerdown');
    h.fire('pointermove', {clientY: 100 + dy});
    h.fire('pointerup');
    assert.equal(h.fire('click').stopped, true);
    assert.equal(h.state.closes, 0);
    assert.equal(h.body.dataset.expanded, Math.abs(dy) >= 44 ? (dy < 0 ? '1' : '0') : undefined);
    h.fire('pointerdown');
    h.fire('pointerup');
    h.fire('click');
    assert.equal(h.state.closes, 1);
  }
});

test('cancelled gesture does not close; keyboard activation still works', () => {
  const h = setup();
  h.fire('pointerdown');
  h.fire('pointercancel');
  h.fire('pointerup');
  h.fire('click');
  assert.equal(h.state.closes, 0);
  h.fire('click', {detail: 0});
  assert.equal(h.state.closes, 1);
});

test('desktop drag does not resize or close', () => {
  const h = setup(false);
  h.fire('pointerdown');
  h.fire('pointermove', {clientY: 40});
  h.fire('pointerup');
  h.fire('click');
  assert.equal(h.state.closes, 0);
  assert.equal(h.body.dataset.expanded, undefined);
});
