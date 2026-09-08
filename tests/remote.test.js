const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeTroutSpecies,minGeometryDistanceKm,scoreRemote}=require('../lib/remote');

test('remote finder accepts only supported trout species and defaults to Brook Trout',()=>{
  assert.equal(normalizeTroutSpecies('lake trout'),'Lake Trout');
  assert.equal(normalizeTroutSpecies('Walleye'),'Brook Trout');
  assert.equal(normalizeTroutSpecies(''),'Brook Trout');
});

test('geometry distance measures source geometry instead of inventing a route',()=>{
  const d=minGeometryDistanceKm(46,-83,[{geometry:{x:-83.01,y:46}}]);
  assert.ok(d>0.7&&d<0.9);
});

test('mapped remoteness context ranks a far-road lake above a roadside lake without changing Trout Fit',()=>{
  const lake={matchScore:88,stocking:[]};
  const far=scoreRemote(lake,{nearestRoadKm:12,nearestAccessKm:9,mappedRoadFeatures:2,mappedAccessFeatures:1,crownRecordsWithin2Km:4,roadBarriersWithin15Km:0});
  const near=scoreRemote(lake,{nearestRoadKm:.2,nearestAccessKm:.1,mappedRoadFeatures:100,mappedAccessFeatures:4,crownRecordsWithin2Km:0,roadBarriersWithin15Km:0});
  assert.equal(far.troutFit,88);
  assert.equal(near.troutFit,88);
  assert.ok(far.remoteContext>near.remoteContext);
  assert.ok(far.remoteScore>near.remoteScore);
});

test('missing mapped access does not become proof of no access',()=>{
  const scored=scoreRemote({matchScore:80,stocking:[]},{nearestRoadKm:5,nearestAccessKm:null,mappedRoadFeatures:5,mappedAccessFeatures:0,crownRecordsWithin2Km:0,roadBarriersWithin15Km:0});
  assert.ok(scored.confidence<100);
  assert.ok(scored.reasons.some(x=>/does not prove|unmapped access/i.test(x)));
});

test('Remote Trout UI keeps score meanings, legal boundaries and first-party API explicit',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','public','remote-trout-lake-finder','index.html'),'utf8');
  const api=fs.readFileSync(path.join(__dirname,'..','api','lakes.js'),'utf8');
  assert.match(html,/Trout Fit ≠ Remote Context/);
  assert.match(html,/not a legal-access or solitude guarantee/i);
  assert.match(html,/No recent stocking record means exactly that; it does not prove a wild population/i);
  assert.match(html,/straight-line only, not drive time/i);
  assert.match(html,/never becomes catch probability/i);
  assert.match(html,/const API='\/api\/lakes'/);
  assert.match(html,/const locationBtn=document\.getElementById\('location'\)/);
  assert.doesNotMatch(html,/\blocation\.addEventListener\(/);
  assert.match(api,/mode === 'remote'/);
  assert.match(api,/searchRemoteTrout/);
});
