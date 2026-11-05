'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const inline = html.match(/<script>\s*(\(\(\)=>\{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];

test('map supplies region navigation and source-bound coverage semantics without a province-wide marker request', () => {
  assert.ok(inline, 'executable inline explorer script must exist');
  assert.match(html, /aria-label="Browse Ontario lake areas"/);
  assert.match(html, /id="retry-map"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(inline, /if\(zoom<9\)/);
  assert.match(inline, /no partial lake list is passed off as complete/);
  assert.match(inline, /if\(pan&&!isNum\(l\.latitude\)\)map\.setView/);
});

function fakeElement(dataset = {}) {
  const attrs = {};
  return {
    dataset, value: '', textContent: '', innerHTML: '', hidden: false,
    disabled: false, onclick: null, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name] || null; },
    addEventListener(name, cb) { this.listeners[name] = cb; },
    appendChild(child) { (this.children ||= []).push(child); return child; },
    querySelectorAll() { return []; },
    click() { if (this.listeners.click) return this.listeners.click(); if (this.onclick) return this.onclick(); }
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function mount() {
  assert.ok(inline);
  const ids = ['form', 'q', 'species', 'fmz', 'thermal', 'depth', 'find', 'status', 'coverage',
    'results', 'count', 'detail', 'maplabel', 'listtitle', 'location', 'distance', 'maxdist',
    'clearFish', 'retry-map'];
  const elements = Object.fromEntries(ids.map(id => [id, fakeElement()]));
  const regions = [
    ['Algoma', '47.15', '-83.75', '10'], ['Temagami', '47.06', '-79.78', '10'],
    ['Nipigon', '49.03', '-88.26', '10'], ['Kenora', '49.76', '-94.49', '10'],
    ['Muskoka', '45.08', '-79.51', '10'], ['Ontario overview', '49.2', '-84.7', '5']
  ].map(([name, lat, lon, zoom]) => {
    const item = fakeElement({ lat, lon, zoom });
    item.textContent = name;
    return item;
  });
  const makeLayer = () => ({items: [], addTo() {return this;}, clearLayers() {this.items.length = 0;}});
  const map = {
    center: [49.2, -84.7], zoom: 5, listeners: {},
    setView(center, zoom) {this.center = center; this.zoom = zoom; if(this.listeners.moveend)this.listeners.moveend(); return this;},
    getZoom() {return this.zoom;},
    getBounds() {
      const width = this.zoom < 9 ? 8 : 0.22;
      return {
        getWest: () => this.center[1] - width,
        getEast: () => this.center[1] + width,
        getSouth: () => this.center[0] - width,
        getNorth: () => this.center[0] + width
      };
    },
    on(name, cb) {this.listeners[name] = cb; return this;}
  };
  const L = {
    map: () => map, tileLayer: () => ({addTo() {return this;}}),
    layerGroup: makeLayer,
    circleMarker: (coords, options) => ({
      coords, options, bindTooltip() {return this;}, on() {return this;},
      setStyle() {return this;},
      addTo(layer) {layer.items.push(this);return this;}
    })
  };
  const requests = [];
  let failMap = false;
  let oversized = false;
  const catalogLake = {
    id: 'ohn:1', name: 'Actual Lake', latitude: null, longitude: null,
    waterbodyType: 'Lake', matchReasons: ['Ontario Hydro Network lake polygon'],
    fishEvidenceAvailable: null, stocking: [], species: []
  };
  const selectedLake = {...catalogLake, latitude: 47.25, longitude: -83.64,
    fishEvidenceAvailable: false, regulationNote: 'Check current official regulations.'};
  async function fakeFetch(url) {
    const u = new URL(url, 'https://example.test');
    const mode = u.searchParams.get('mode') || 'search';
    requests.push({mode, url: u.toString(), bbox: u.searchParams.get('bbox')});
    if (mode === 'map') {
      if (failMap) throw new Error('source offline');
      const response = oversized
        ? {markers: [], catalogMode:'ohn_all_lakes',matchedInView:8000,displayedInView:0,coverageComplete:false,truncatedReason:'zoom_required'}
        : {markers:[selectedLake],catalogMode:'ohn_all_lakes',matchedInView:1,displayedInView:1,coverageComplete:true};
      return {ok:true,json:async()=>response};
    }
    if (mode === 'detail') return {ok:true,json:async()=>({lake:selectedLake})};
    return {ok:true,json:async()=>({lakes:[catalogLake],candidateCount:1,catalogMode:'ohn_all_lakes'})};
  }
  const injected = inline.replace('syncChips();loadMap();search();', `globalThis.__lakeTest = {loadMap,search,selectLake,map,coverage,retryMap,areaButtons,maplabel,status};syncChips();loadMap();search();`);
  assert.notEqual(injected, inline, 'test hook must be inserted at script bootstrap');
  const context = {
    L, document: {getElementById: id => elements[id], createElement: () => fakeElement(), querySelectorAll: selector =>
      selector === '.area-btn' ? regions : []},
    location: {origin:'https://example.test'}, navigator: {},
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch:fakeFetch, console:{error() {}}
  };
  context.globalThis = context;
  vm.runInNewContext(injected, context, {timeout: 2000});
  return {ui:context.__lakeTest,elements,requests,regions,map,
    failMap(value) {failMap=value;}, oversized(value) {oversized=value;}};
}

test('first load avoids province-scale queries, explores different regions, and exits safely to Ontario overview', async () => {
  const app = mount();
  await pause(25);
  assert.equal(app.map.zoom, 10, 'first visible map is a bounded Ontario lake area');
  assert.ok(app.requests.some(r => r.mode === 'map'), 'a local map query starts independently of the lake list');
  assert.ok(app.requests.filter(r => r.mode === 'map').every(r => {
    const b = r.bbox.split(',').map(Number);return b[2]-b[0]<2 && b[3]-b[1]<2;
  }), 'initial queries must be local, not a source-hostile province bbox');
  assert.match(app.elements.coverage.textContent, /Complete local coverage/);
  const before = app.requests.filter(r => r.mode === 'map').length;
  app.regions[5].click();
  await pause(10);
  assert.equal(app.map.zoom, 5);
  assert.match(app.elements.coverage.textContent, /Province-wide lake dots are not sampled/);
  assert.equal(app.requests.filter(r => r.mode === 'map').length, before,
    'province overview must never request all Ontario polygon markers');
  app.regions[1].click();
  await pause(25);
  assert.equal(app.map.zoom, 10);
  assert.ok(app.requests.filter(r => r.mode === 'map').length > before,
    'choosing another lake area starts a fresh local request');
  assert.equal(app.elements.coverage.classList?.contains?.('warn'), undefined);
});

test('a named lake with coordinates omitted from its catalog row is focused after source detail retrieval', async () => {
  const app = mount();
  await pause(25);
  await app.ui.selectLake('ohn:1', true);
  assert.equal(app.map.zoom, 11);
  assert.deepEqual(app.map.center, [47.25, -83.64]);
  assert.ok(app.requests.some(r => r.mode === 'detail'),
    'lake selection must fetch the full source record before focusing the map');
});

test('source failures and dense-area limits never fabricate markers; retry restores the local map', async () => {
  const app = mount();
  await pause(25);
  app.failMap(true);
  app.regions[2].click();
  await pause(25);
  assert.match(app.elements.coverage.textContent, /Retry the map/);
  assert.equal(app.elements['retry-map'].hidden, false);
  app.failMap(false);
  await app.ui.retryMap.onclick();
  assert.match(app.elements.coverage.textContent, /Complete local coverage/);
  assert.equal(app.elements['retry-map'].hidden, true);
  app.oversized(true);
  app.regions[3].click();
  await pause(25);
  assert.match(app.elements.coverage.textContent, /8,000 lakes/);
  assert.match(app.elements.coverage.textContent, /Zoom in/);
});
