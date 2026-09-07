const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../lib/core');

const html = fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('species parser de-duplicates source records',()=>{
  assert.deepEqual(core.parseSpecies('Brook Trout; Brook Trout; Lake Trout'),['Brook Trout','Lake Trout']);
});

test('ARA filters escape apostrophes and normalize Ontario thermal casing',()=>{
  const where=core.araWhere({species:"Brook Trout",q:"O'Brien",fmz:'10',thermal:'cold'});
  assert.match(where,/Brook Trout/); assert.match(where,/O''Brien/); assert.match(where,/FISHERIES_MANAGEMENT_ZONE_ID=10/); assert.match(where,/Cold%/);
});

test('ARA normalization preserves Waterbody ID and lake evidence',()=>{
  const x=core.normalizeAra({attributes:{WATERBODY_LID:'WB1',OFFICIAL_WATERBODY_NAME:'Fork Lake',WATERBODY_TYPE:'Lake',FISH_SPECIES_SUMMARY:'Brook Trout; Lake Trout',FISHERIES_MANAGEMENT_ZONE_ID:10,THERMAL_REGIME:'Coldwater',SURFACE_AREA:22,MAXIMUM_DEPTH:14}});
  assert.equal(x.id,'WB1'); assert.equal(x.name,'Fork Lake'); assert.deepEqual(x.species,['Brook Trout','Lake Trout']); assert.equal(x.maximumDepthM,14);
});

test('duplicate ARA segments collapse to one Waterbody ID',()=>{
  const rows=core.dedupe([
    {id:'1',species:['Brook Trout'],surfaceAreaHa:4},
    {id:'1',species:['Lake Trout'],surfaceAreaHa:9}
  ]);
  assert.equal(rows.length,1); assert.deepEqual(new Set(rows[0].species),new Set(['Brook Trout','Lake Trout']));
});

test('lake fit rewards target species/coldwater/depth/recent stocking',()=>{
  const y=new Date().getUTCFullYear();
  const r=core.fitScore({species:['Brook Trout'],speciesSummary:'Brook Trout',thermalRegime:'Coldwater',maximumDepthM:14,surfaceAreaHa:5,latitude:47,longitude:-82,stocking:[{species:'Brook Trout',year:y-1}]},'Brook Trout');
  assert.ok(r.score>=90); assert.ok(r.reasons.some(x=>/stocked/i.test(x)));
});

test('lake fit does not fabricate target species evidence',()=>{
  const r=core.fitScore({species:['Walleye'],speciesSummary:'Walleye',thermalRegime:'Warmwater',maximumDepthM:8,surfaceAreaHa:5,latitude:47,longitude:-82,stocking:[]},'Brook Trout');
  assert.ok(r.score<70); assert.ok(r.reasons.some(x=>/not shown/i.test(x)));
});

test('trip score penalizes nearby fire and barrier without becoming catch probability',()=>{
  const r=core.tripScore(90,{access:[{distanceKm:1}],roads:{nearestRoad:{distanceKm:1},barriers:[{distanceKm:2}]},fires:{nearestFireKm:10},weather:{windKmh:40}});
  assert.ok(r.score<90); assert.match(r.semantics,/not a catch forecast/i);
});

test('distance helper is stable',()=>{
  const d=core.haversineKm(45,-80,46,-80); assert.ok(d>110&&d<112);
});

test('source manifest uses official Ontario and Canada endpoints',()=>{
  const s=core.sourceManifest();
  assert.match(s.aquaticResourceAreas.url,/lioservices/); assert.match(s.crownUnpatented.url,/lioservices/); assert.match(s.roads.url,/arcgis/); assert.match(s.activeFires.url,/lioservices/); assert.match(s.weather.url,/weather\.gc\.ca/); assert.match(s.regulations.url,/ontario\.ca/);
});

test('frontend keeps Lake Match separate from Trip Context and shows legal boundaries',()=>{
  assert.match(html,/Lake Match/); assert.match(html,/Trip Context/); assert.match(html,/not legal access permission/i); assert.match(html,/catch forecast/i); assert.match(html,/Straight-line distance filter is active/i); assert.match(html,/route-time estimate/i); assert.doesNotMatch(html,/chance of catching|catch probability|guaranteed catch/i);
});

test('frontend exposes regulation, 511 and fire verification links',()=>{
  assert.match(html,/Check regulations/); assert.match(html,/Ontario 511/); assert.match(html,/Fire info/); assert.match(html,/waterbody-specific exceptions/);
});
