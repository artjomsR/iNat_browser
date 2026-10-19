const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('navigation.js', 'utf8');
function setup({standalone = true, blocked = false} = {}){
  const events = {}, store = new Map();
  const context = {
    navigator: {standalone}, URL, Date, Math,
    location: {pathname: '/index.html', href: 'https://example.org/index.html?user=private'},
    performance: {getEntriesByType: () => [{type: 'back_forward'}]},
    localStorage: {
      getItem(k){if(blocked) throw Error(); return store.get(k);},
      setItem(k,v){if(blocked) throw Error(); store.set(k,v);},
      removeItem(k){store.delete(k);}
    },
    document: {visibilityState: 'hidden', addEventListener: (name, cb) => events[name] = cb},
    addEventListener: (name, cb) => events[name] = cb
  };
  context.window = context;
  vm.runInNewContext(source, context);
  function click(overrides = {}, download = false){
    const a = {href:'https://www.inaturalist.org/observations/123?user=private#secret',
      target: '_blank', hasAttribute: () => download,
      removeAttribute(){throw Error('Diagnostics must not change targets');}};
    events.click({target:{closest:() => a}, button:0, isTrusted:true,
      preventDefault(){throw Error('Must preserve default activation');}, ...overrides});
    return a;
  }
  return {context, events, click, store};
}
test('home-screen links are logged without changing their activation or target', () => {
  const h = setup();
  assert.equal(h.click().target, '_blank');
  const entry = h.context.__navlog().at(-1);
  assert.equal(entry.destination, 'https://www.inaturalist.org/observations/123');
  assert.equal(entry.trusted, true);
});
test('browser tabs, modified clicks, downloads and cancelled clicks retain targets', () => {
  assert.equal(setup({standalone:false}).click().target, '_blank');
  const h = setup();
  for(const overrides of [{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true},
    {button:1}, {defaultPrevented:true}]) assert.equal(h.click(overrides).target, '_blank');
  assert.equal(h.click({}, true).target, '_blank');
});
test('blocked storage does not prevent handoff', () => {
  assert.equal(setup({blocked:true}).click().target, '_blank');
});
test('lifecycle events preserve diagnostic evidence without initiating navigation', () => {
  const h = setup();
  h.events.pageshow({persisted:true});
  h.events.pagehide({persisted:false});
  h.events.visibilitychange();
  h.events.popstate();
  const log = h.context.__navlog();
  assert.equal(log[1].navigationType, 'back_forward');
  assert.equal(log[1].persisted, true);
  assert.equal(log.at(-1).event, 'popstate');
});
test('logs are bounded, clearable and omit sensitive URL components', () => {
  const h = setup();
  for(let i=0;i<100;i++) h.click();
  assert.equal(h.context.__navlog().length, 80);
  assert.ok(!JSON.stringify(h.context.__navlog()).includes('private'));
  assert.equal(h.context.inatNavigation.destination('https://www.inaturalist.org/people/private?x=1'),
    'https://www.inaturalist.org/people');
  h.context.__clearNavlog();
  assert.equal(h.context.__navlog().length, 0);
});
