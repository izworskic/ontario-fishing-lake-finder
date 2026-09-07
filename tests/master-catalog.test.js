const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../lib/catalog');
const ohn = require('../lib/ohn');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'lakes.js'), 'utf8');

test('all-lakes discovery uses Ontario Hydro Network lake polygons, not fisheries-location records', () => {
  const where = ohn.ohnWhere({});
  assert.match(where, /WATERBODY_TYPE IN \('Lake','Kettle lake'\)/);
  assert.doesNotMatch(where, /WATERBODY_IDENT|FISH_SPECIES_SUMMARY/);
  assert.match(ohn.OHN_URL, /LIO_Open01\/MapServer\/25/);
});

test('OHN lake-name search escapes apostrophes', () => {
  const where = ohn.ohnWhere({ q: "St. John's" });
  assert.match(where, /OFFICIAL_NAME_LABEL LIKE/);
  assert.match(where, /St\. John''s/);
});

test('a name-only or empty search is all-lakes mode while fisheries evidence filters are explicit', () => {
  assert.equal(catalog.hasFisheriesFilters({}), false);
  assert.equal(catalog.hasFisheriesFilters({ q: 'Nipigon' }), false);
  assert.equal(catalog.hasFisheriesFilters({ species: 'Brook Trout' }), true);
  assert.equal(catalog.hasFisheriesFilters({ fmz: '10' }), true);
  assert.equal(catalog.hasFisheriesFilters({ thermal: 'cold' }), true);
  assert.equal(catalog.hasFisheriesFilters({ minDepth: 10 }), true);
});

test('OHN normalization creates a separate physical-lake identifier and no fake fish score', () => {
  const lake=ohn.normalizeOhn({attributes:{OGF_ID:123,WATERBODY_TYPE:'Lake',OFFICIAL_NAME_LABEL:'Test Lake'},geometry:{rings:[[[-80,45],[-79.8,45],[-79.8,45.2],[-80,45.2],[-80,45]]]}});
  assert.equal(lake.id,'ohn:123');
  assert.equal(lake.name,'Test Lake');
  assert.equal(lake.matchScore,null);
  assert.equal(lake.fishEvidenceAvailable,null);
  assert.ok(lake.latitude>45&&lake.latitude<45.2);
});

test('API routes all-lakes search/map/detail through OHN while retaining fisheries path', () => {
  assert.match(api, /searchOhn/);
  assert.match(api, /mapOhn/);
  assert.match(api, /ohnLakeDetail/);
  assert.match(api, /fisheriesMode \? await searchComplete\(filters, limit\) : await searchOhn\(filters, limit\)/);
  assert.match(api, /does not silently sample lakes/i);
});

test('frontend defaults to All lakes with no hidden Brook Trout auto-filter', () => {
  assert.match(html, /<option value="">All lakes<\/option>/);
  assert.match(html, /Start with every lake/);
  assert.match(html, /syncChips\(\);search\(\);/);
  assert.doesNotMatch(html, /species\.value\s*=\s*['"]Brook Trout['"]/);
});

test('catalog lakes without fisheries evidence are not rendered as zero-score lakes', () => {
  assert.match(html, /Fish evidence unavailable/);
  assert.match(html, /No joined ARA species record shown/);
  assert.match(html, /n!==null&&n!==''/);
  assert.match(html, /isNum\(l\.matchScore\)/);
});
