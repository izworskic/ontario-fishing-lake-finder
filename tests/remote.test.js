const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SOURCES}=require('../lib/core');
const remote=require('../lib/remote');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public','remote-trout-lake-finder','index.html'),'utf8');
const api=fs.readFileSync(path.join(root,'api','lakes.js'),'utf8');
const builder=fs.readFileSync(path.join(root,'scripts','build-trout-index.js'),'utf8');

test('waterbody identity join uses Ontario current ArcGIS host',()=>{
  assert.equal(SOURCES.waterbody,'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/17');
  assert.doesNotMatch(SOURCES.waterbody,/arcgis1071a/);
});

test('V2 master builder unions all three supported trout evidence sources',()=>{
  assert.match(builder,/MapServer\/2/);
  assert.match(builder,/MapServer\/0/);
  assert.match(builder,/FishStockingDataForRecreationalPurposes/);
  assert.match(builder,/ara_summary/);
  assert.match(builder,/ara_survey/);
  assert.match(builder,/stocking/);
  assert.match(builder,/Union trout waterbody IDs/);
});

test('V2 does not use the old bounded candidate search',()=>{
  const code=fs.readFileSync(path.join(root,'lib','remote.js'),'utf8');
  assert.doesNotMatch(code,/candidateLimit/);
  assert.doesNotMatch(code,/slice\(0,candidateLimit\)/);
  assert.doesNotMatch(code,/searchFisheries/);
  assert.match(code,/candidateCount:rows\.length/);
  assert.match(code,/List pagination never changes candidateCount/);
});

test('supported trout species remain explicit',()=>{
  assert.deepEqual(remote.TROUT_SPECIES,['Brook Trout','Lake Trout','Rainbow Trout','Brown Trout','Splake']);
  assert.equal(remote.normalizeTroutSpecies('lake trout'),'Lake Trout');
  assert.equal(remote.normalizeTroutSpecies('Walleye'),'Brook Trout');
});

test('Remote Trout API exposes complete-index list, map and evidence-gap modes',()=>{
  assert.match(api,/mode === 'remote'/);
  assert.match(api,/mode === 'remote-map'/);
  assert.match(api,/mode === 'remote-explain'/);
  assert.match(api,/candidateCount: result\.candidateCount/);
  assert.match(api,/coverageComplete: true/);
  assert.match(api,/No top-candidate sampling is used/);
});

test('V2 UI states the coverage and evidence semantics directly',()=>{
  assert.match(html,/Start with every evidenced trout lake/i);
  assert.match(html,/No hidden top-candidate sampling/i);
  assert.match(html,/Why isn't my lake here\?/i);
  assert.match(html,/No record in those sources does not prove trout are absent/i);
  assert.match(html,/straight-line only, not drive time/i);
  assert.match(html,/does not prove legal access/i);
  assert.match(html,/const API='\/api\/lakes'/);
  assert.match(html,/mode:'remote-map'/);
  assert.match(html,/mode:'remote-explain'/);
});

test('generated V2 index meets minimum integrity when present',()=>{
  const file=path.join(root,'data','trout-index.json');
  if(!fs.existsSync(file)) return;
  const d=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(d.schemaVersion,2);
  assert.ok(d.lakes.length>=500);
  assert.ok(d.summary.araFeatures>0);
  assert.ok(d.summary.surveyFeatures>0);
  assert.ok(d.summary.stockingFeatures>0);
  assert.ok(d.lakes.every(x=>x.id&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)&&Array.isArray(x.species)&&x.species.length));
  assert.ok(d.lakes.every(x=>x.remote&&Object.prototype.hasOwnProperty.call(x.remote,'score')&&Object.prototype.hasOwnProperty.call(x.remote,'confidence')));
});
