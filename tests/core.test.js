const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../lib/core');
const html = fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('species parser de-duplicates source records',()=>{
  assert.deepEqual(core.parseSpecies('Brook Trout; Lake Trout; Brook Trout'),['Brook Trout','Lake Trout']);
});

test('ARA filters escape apostrophes and preserve target filters',()=>{
  const w=core.araWhere({species:'Brook Trout',q:"O'Brien",fmz:'10',thermal:'cold'});
  assert.match(w,/Brook Trout/); assert.match(w,/O''Brien/); assert.match(w,/FISHERIES_MANAGEMENT_ZONE_ID=10/); assert.match(w,/THERMAL_REGIME LIKE 'cold%'/);
});

test('ARA normalization preserves Waterbody ID and lake evidence',()=>{
  const l=core.normalizeAra({attributes:{WATERBODY_LID:'123',OFFICIAL_WATERBODY_NAME:'Test Lake',WATERBODY_TYPE:'Lake',FISH_SPECIES_SUMMARY:'Brook Trout; Lake Trout',FISHERIES_MANAGEMENT_ZONE_ID:10,THERMAL_REGIME:'Coldwater',SURFACE_AREA:50,MAXIMUM_DEPTH:14}});
  assert.equal(l.id,'123'); assert.equal(l.name,'Test Lake'); assert.equal(l.fmz,10); assert.equal(l.maximumDepthM,14); assert.ok(l.species.includes('Brook Trout'));
});

test('duplicate ARA segments collapse to one Waterbody ID',()=>{
  const [l]=core.dedupe([{id:'1',surfaceAreaHa:10,species:['Brook Trout']},{id:'1',surfaceAreaHa:20,species:['Lake Trout']}]);
  assert.equal(l.surfaceAreaHa,20); assert.deepEqual(new Set(l.species),new Set(['Brook Trout','Lake Trout']));
});

test('lake fit rewards target species/coldwater/depth/recent stocking',()=>{
  const y=new Date().getUTCFullYear();
  const s=core.fitScore({speciesSummary:'Brook Trout',species:['Brook Trout'],thermalRegime:'Coldwater',maximumDepthM:12,surfaceAreaHa:40,latitude:47,longitude:-83,stocking:[{species:'Brook Trout',year:y-1}]},'Brook Trout');
  assert.equal(s.score,100); assert.ok(s.reasons.some(x=>/recorded/.test(x))); assert.ok(s.reasons.some(x=>/stocked/.test(x)));
});

test('lake fit does not fabricate target species evidence',()=>{
  const s=core.fitScore({speciesSummary:'Walleye',species:['Walleye'],thermalRegime:'Warmwater',maximumDepthM:10,surfaceAreaHa:40,latitude:47,longitude:-83,stocking:[]},'Brook Trout');
  assert.ok(s.score<50); assert.ok(s.reasons.some(x=>/not shown/.test(x)));
});

test('trip score penalizes nearby fire and barrier without becoming catch probability',()=>{
  const t=core.tripScore(90,{access:[{distanceKm:1}],roads:{nearestRoad:{distanceKm:1},barriers:[{distanceKm:2}]},fires:{nearestFireKm:10},weather:{windKmh:40}});
  assert.ok(t.score<90); assert.match(t.semantics,/not a catch forecast/); assert.match(t.semantics,/legal access/);
});

test('distance helper is stable',()=>{
  assert.equal(core.haversineKm(45,-80,45,-80),0); assert.ok(core.haversineKm(45,-80,46,-80)>100);
});

test('source manifest uses official Ontario and Canada endpoints',()=>{
  const s=core.sourceManifest();
  assert.match(s.aquaticResourceAreas.url,/lioservices/); assert.match(s.crownUnpatented.url,/lioservices/); assert.match(s.roads.url,/arcgis/); assert.match(s.activeFires.url,/lioservices/); assert.match(s.weather.url,/weather\.gc\.ca/); assert.match(s.regulations.url,/ontario\.ca/);
});

test('frontend keeps Lake Match separate from Trip Context and shows legal boundaries',()=>{
  assert.match(html,/Lake Match/); assert.match(html,/Trip Context/); assert.match(html,/not legal access permission/i); assert.match(html,/not a catch forecast/i); assert.match(html,/straight-line distance only/i); assert.doesNotMatch(html,/chance of catching|catch probability|guaranteed catch/i);
});

test('frontend exposes regulation, 511 and fire verification links',()=>{
  assert.match(html,/Check regulations/); assert.match(html,/Ontario 511/); assert.match(html,/Fire info/); assert.match(html,/waterbody-specific exceptions/);
});
