const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWhere, parseBbox, pagedArcgis } = require('../lib/catalog');

const apiText = fs.readFileSync(path.join(__dirname, '..', 'api', 'lakes.js'), 'utf8');

test('catalog WHERE pushes depth filtering into Ontario ARA instead of truncating then filtering', () => {
  const where = buildWhere({ species: 'Brook Trout', thermal: 'cold', minDepth: 10 });
  assert.match(where, /Brook Trout/);
  assert.match(where, /THERMAL_REGIME LIKE 'Cold%'/);
  assert.match(where, /MAXIMUM_DEPTH >= 10/);
});

test('bbox validation accepts Ontario bounds and rejects malformed or reversed bounds', () => {
  assert.deepEqual(parseBbox('-90,45,-80,50'), { west: -90, south: 45, east: -80, north: 50 });
  assert.equal(parseBbox('-80,45,-90,50'), null);
  assert.equal(parseBbox('bad'), null);
});

test('ArcGIS pagination retrieves beyond the 2,000-record service page limit', async () => {
  const total = 4500;
  const fakeFetch = async url => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get('resultOffset') || 0);
    const count = Number(u.searchParams.get('resultRecordCount') || 2000);
    const remaining = Math.max(0, total - offset);
    const n = Math.min(count, remaining);
    return {
      features: Array.from({ length: n }, (_, i) => ({ attributes: { OBJECTID: offset + i + 1 } })),
      exceededTransferLimit: offset + n < total
    };
  };
  const result = await pagedArcgis('https://example.com/layer', { where: '1=1' }, { fetchJson: fakeFetch, pageSize: 2000, maxRecords: 10000 });
  assert.equal(result.features.length, 4500);
  assert.equal(result.pages, 3);
  assert.equal(result.complete, true);
});

test('ArcGIS safety ceiling is explicit rather than silently pretending coverage is complete', async () => {
  const total = 9000;
  const fakeFetch = async url => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get('resultOffset') || 0);
    const count = Number(u.searchParams.get('resultRecordCount') || 2000);
    const n = Math.min(count, Math.max(0, total - offset));
    return {
      features: Array.from({ length: n }, (_, i) => ({ attributes: { OBJECTID: offset + i + 1 } })),
      exceededTransferLimit: offset + n < total
    };
  };
  const result = await pagedArcgis('https://example.com/layer', { where: '1=1' }, { fetchJson: fakeFetch, pageSize: 2000, maxRecords: 4000 });
  assert.equal(result.features.length, 4000);
  assert.equal(result.complete, false);
});

test('API has dedicated complete-viewport semantics for OHN and fisheries modes', () => {
  assert.match(apiText, /mode === 'map'/);
  assert.match(apiText, /candidateCount/);
  assert.match(apiText, /listCount/);
  assert.match(apiText, /Complete Ontario Hydro Network lake coverage for the current map viewport/);
  assert.match(apiText, /Complete matching fisheries-record lake coverage for the current map viewport/);
  assert.match(apiText, /does not silently sample lakes/i);
  assert.match(apiText, /mapOhn\(filters/);
  assert.match(apiText, /mapViewport\(filters/);
});
