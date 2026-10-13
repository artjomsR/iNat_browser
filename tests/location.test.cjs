// Run: node --test --test-isolation=none tests/location.test.cjs (no packages or build step).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('index.js', 'utf8').split('/* ---------------- locate ---------------- */')[1].split('/* ---------------- boot ---------------- */')[0];
function setup({permission = 'prompt', queryReject = false, motion = 'granted', noGPS = false} = {}) {
  let now = 100000, next = 0, motionCalls = 0, queryChange;
  const active = new Map(), watches = [], singles = [], timers = new Map(), events = {}, wevents = {};
  const button = {dataset:{}, addEventListener: (_, f) => button.click = f};
  const status = {};
  const context = {
    Date: {now: () => now}, Number, Math, Promise, isFinite,
    setTimeout: (f, delay) => {timers.set(++next, {f, delay}); return next;},
    clearTimeout: id => timers.delete(id),
    document: {hidden:false, getElementById: id => id === 'locate' ? button : status, addEventListener:(e,f) => events[e] = f},
    window: {DeviceOrientationEvent:{requestPermission: () => {motionCalls++; return Promise.resolve(motion);}}, addEventListener:(e,f) => wevents[e] = f},
    navigator: {permissions:{query: async () => {if(queryReject) throw Error(); return context.permissionStatus;}}},
    permissionStatus: {state:permission, addEventListener:(_,f) => queryChange=f},
    meCone:null, meRing:null,
    map: {removeLayer(){}, setView(ll){context.lastView=ll;}, getZoom:()=>12},
    L:{divIcon:()=>({}), marker:()=>layer(), circleMarker:()=>layer()},
  };
  function layer(){return {addTo(){return this;}, setLatLng(){}, getElement:()=>null};}
  if(!noGPS) context.navigator.geolocation = {
    watchPosition(ok,fail,opts){ const w={ok,fail,opts,id:++next}; watches.push(w);active.set(w.id,w);return w.id; },
    clearWatch:id=>active.delete(id),
    getCurrentPosition(ok,fail,opts){singles.push({ok,fail,opts});}
  };
  vm.createContext(context); vm.runInContext(source,context);
  return {context,button,status,active,watches,singles,timers,
    run:s=>vm.runInContext(s,context), motionCalls:()=>motionCalls,
    pos:(age=0)=>({coords:{latitude:51,longitude:0},timestamp:now-age}),
    advance:n=>now+=n,
    hide(){context.document.hidden=true;events.visibilitychange();},
    show(){context.document.hidden=false;events.visibilitychange();},
    revoke(state='denied'){context.permissionStatus.state=state;queryChange();},
    events,wevents};
}
test('rapid taps share one watch, fallback and compass request; fresh fix reused',async()=>{
  const h=setup();h.button.click();h.button.click();
  assert.equal(h.watches.length,1);assert.equal(h.singles.length,1);assert.equal(h.motionCalls(),1);
  assert.equal(h.watches[0].opts.maximumAge,0);assert.equal(h.watches[0].opts.timeout,30000);
  assert.equal(h.singles[0].opts.maximumAge,30000);assert.equal(h.singles[0].opts.timeout,15000);
  h.watches[0].ok(h.pos());h.singles[0].ok(h.pos());h.button.click();
  assert.equal(h.singles.length,1);assert.equal(h.button.dataset.busy,'0');assert.equal(h.context.lastView[0],51);
});
test('expired positions are not used to centre and dot expires',()=>{
  const h=setup();h.button.click();h.singles[0].ok(h.pos());h.advance(30001);
  h.context.lastView=null;h.button.click();assert.equal(h.context.lastView,null);assert.equal(h.singles.length,2);
  h.singles[1].ok(h.pos(40000));assert.equal(h.context.lastView,null);
  h.watches[0].ok(h.pos());assert.ok(h.context.meRing);
  [...h.timers.values()][0].f();assert.equal(h.context.meRing,null);
});
test('background/foreground has at most one watch and ignores late callbacks',()=>{
  const h=setup();h.button.click();h.hide();assert.equal(h.active.size,0);assert.equal(h.button.dataset.busy,'0');
  h.show();h.show();assert.equal(h.active.size,1);assert.equal(h.watches.length,2);
  h.watches[0].ok(h.pos());h.singles[0].ok(h.pos());assert.equal(h.context.meRing,null);
  h.watches[1].ok(h.pos());assert.ok(h.context.meRing);
  h.wevents.pagehide();assert.equal(h.active.size,0);h.wevents.pageshow();assert.equal(h.active.size,1);
});
test('denial stops tracking and foreground does not retry; explicit tap can retry',()=>{
  const h=setup();h.button.click();h.watches[0].fail({code:1});assert.equal(h.active.size,0);
  h.hide();h.show();assert.equal(h.watches.length,1);assert.match(h.status.textContent,/denied/);
  h.singles[0].ok(h.pos());assert.equal(h.context.meRing,null);
  h.button.click();assert.equal(h.watches.length,2);
});
test('motion denial and synchronous sensor exceptions do not block location',async()=>{
  const h=setup({motion:'denied'});h.button.click();await new Promise(setImmediate);
  h.watches[0].ok(h.pos());h.button.click();assert.equal(h.motionCalls(),1);assert.equal(h.context.lastView[0],51);
  const x=setup();x.context.window.DeviceOrientationEvent.requestPermission=()=>{throw Error();};
  x.button.click();assert.equal(x.watches.length,1);
});
test('boot only starts for browser-reported grant, never for prompt or unsupported query',async()=>{
  for(const options of [{permission:'prompt'},{permission:'denied'},{queryReject:true}]){
    const h=setup(options);await h.run('bootLocation(() => {})');assert.equal(h.watches.length,0);assert.equal(h.motionCalls(),0);
  }
  const h=setup({permission:'granted'});await h.run('bootLocation(() => {})');assert.equal(h.watches.length,1);
  assert.equal(h.motionCalls(),0);h.watches[0].ok(h.pos());h.revoke('prompt');assert.equal(h.active.size,0);
  assert.equal(h.context.meRing,null);h.hide();h.show();assert.equal(h.watches.length,1);
  const x=setup();delete x.context.navigator.permissions;await x.run('bootLocation(() => {})');
  x.button.click();assert.equal(x.watches.length,1);
});
test('timeout and unavailable location provide feedback without creating extra watches',()=>{
  for(const code of [2,3]){const h=setup();h.button.click();h.singles[0].fail({code});
    assert.equal(h.button.dataset.busy,'0');assert.ok(h.status.textContent);assert.equal(h.watches.length,1);
    h.watches[0].ok(h.pos());assert.equal(h.status.hidden,true);
  }
  const h=setup({noGPS:true});h.button.click();assert.equal(h.button.dataset.busy,'0');assert.match(h.status.textContent,/unavailable/);
});

test('late boot query cannot override an explicit locate or start a second watch',async()=>{
  const h=setup({permission:'granted'});const pending=h.run('bootLocation(() => { throw Error("boot stole tap"); })');
  h.button.click();await pending;h.watches[0].ok(h.pos());assert.equal(h.watches.length,1);
  assert.equal(h.context.lastView[0],51);
});
test('shared-view boot observes permission without starting tracking',async()=>{
  const h=setup({permission:'granted'});await h.run('bootLocation(null)');assert.equal(h.watches.length,0);
  h.hide();h.show();assert.equal(h.watches.length,0);
});
