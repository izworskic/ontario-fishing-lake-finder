const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../lib/catalog');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'lakes.js'), 'utf8');

test('all-lakes discovery starts from Ontario Waterbody Location Identifier Lake records', () => {
  const where = catalog.waterbodyWhere({});
  assert.match(where, /WATERBODY_IDENT IS NOT NULL/);
  assert.match(where, /ENTITY_TYPE = 'Lake'/);
  assert.doesNotMatch(where, /FISH_SPECIES_SUMMARY/);
});

test('lake-name search uses master waterbody names and escapes apostrophes', () => {
  const where = catalog.waterbodyWhere({ q: "St. John's" });
  assert.match(where, /OFFICIAL_NAME LIKE/);
  assert.match(where, /OFFICIAL_ALTERNATE_NAME LIKE/);
  assert.match(where, /UNOFFICIAL_NAME LIKE/);
  assert.match(where, /St\. John''s/);
});

test('a name-only or empty search is catalog mode while fisheries evidence filters are explicit', () => {
  assert.equal(catalog.hasFisheriesFilters({}), false);
  assert.equal(catalog.hasFisheriesFilters({ q: 'Nipigon' }), false);
  assert.equal(catalog.hasFisheriesFilters({ species: 'Brook Trout' }), true);
  assert.equal(catalog.hasFisheriesFilters({ fmz: '10' }), true);
  assert.equal(catalog.hasFisheriesFilters({ thermal: 'cold' }), true);
  assert.equal(catalog.hasFisheriesFilters({ minDepth: 10 }), true);
});

test('API falls back to master catalog detail instead of declaring non-ARA lakes nonexistent', () => {
  assert.match(api, /catalogLakeDetail/);
  assert.match(api, /Lake not found in Ontario Waterbody Location Identifier data/);
  assert.match(api, /Fisheries evidence is an optional enrichment/);
});

test('frontend defaults to All lakes with no hidden Brook Trout auto-filter', () => {
  assert.match(html, /<option value="">All lakes<\/option>/);
  assert.match(html, /Start with every lake/);
  assert.match(html, /syncChips\(\);search\(\);/);
  assert.doesNotMatch(html, /species\.value\s*=\s*['"]Brook Trout['"]/);
  assert.doesNotMatch(html, /thermal\.value\s*=\s*['"]cold['"];document\.querySelector/);
});

test('catalog lakes without fisheries evidence are not rendered as zero-score lakes', () => {
  assert.match(html, /Fish evidence unavailable/);
  assert.match(html, /No joined ARA species record shown/);
  assert.match(html, /n!==null&&n!==''/);
  assert.match(html, /Ontario catalog/);
  assert.match(html, /isNum\(l\.matchScore\)/);
});
