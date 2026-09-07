const { searchLakes, lakeDetail } = require('../lib/core');
const { roadEventContext, applyRoadEventPenalty } = require('../lib/ontario511');

async function main() {
  console.log('Running live Ontario Fishing Lake Finder product smoke...');

  const lakes = await searchLakes({
    species: 'Brook Trout',
    q: '',
    fmz: '',
    thermal: 'cold',
    minDepth: null,
    originLat: null,
    originLon: null,
    maxDistanceKm: null
  }, 8);

  if (!Array.isArray(lakes) || lakes.length === 0) {
    throw new Error('Brook Trout search returned no source-backed lakes');
  }

  const first = lakes.find(l => l.id && Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  if (!first) throw new Error('Search returned no lake with a Waterbody ID and coordinates');
  if (!String(first.speciesSummary || '').toLowerCase().includes('brook trout') && !(first.species || []).some(s => /brook trout/i.test(s))) {
    throw new Error(`Top test lake ${first.name} lacks Brook Trout source evidence`);
  }

  console.log(`SEARCH PASS: ${lakes.length} Brook Trout matches; sample ${first.name} (${first.id}), Lake Match ${first.matchScore}`);

  let detail = await lakeDetail(first.id, 'Brook Trout');
  if (!detail) throw new Error(`Detail lookup failed for Waterbody ID ${first.id}`);
  if (detail.id !== first.id) throw new Error('Detail Waterbody ID did not match search Waterbody ID');
  if (!Number.isFinite(detail.matchScore)) throw new Error('Detail has no Lake Match score');

  const requiredContexts = ['access', 'crown', 'roads', 'fires', 'weather'];
  for (const key of requiredContexts) {
    if (!(key in detail)) throw new Error(`Detail omitted ${key} context`);
  }
  if (!detail.tripScoreBreakdown?.semantics) throw new Error('Detail omitted Trip Context score semantics');

  const roadEvents = await roadEventContext(detail.latitude, detail.longitude, 60);
  detail = applyRoadEventPenalty(detail, roadEvents);
  if (!detail.roadEvents) throw new Error('Ontario 511 context was not attached');
  if (!Number.isFinite(detail.tripScore)) throw new Error('Final Trip Context score missing');
  if (detail.matchScore !== first.matchScore) throw new Error('Live trip context mutated Lake Match score');

  console.log(`DETAIL PASS: ${detail.name}`);
  console.log(`- Lake Match: ${detail.matchScore}`);
  console.log(`- Trip Context: ${detail.tripScore}`);
  console.log(`- fishing access records within 12 km: ${(detail.access || []).length}`);
  console.log(`- Crown unpatented records within 2 km: ${detail.crown?.unpatentedRecordCount ?? 0}`);
  console.log(`- nearest mapped road: ${detail.roads?.nearestRoad?.distanceKm ?? 'none'} km`);
  console.log(`- MNR road barriers within 25 km: ${(detail.roads?.barriers || []).length}`);
  console.log(`- nearest active fire: ${detail.fires?.nearestFireKm ?? 'none within 150 km'} km`);
  console.log(`- nearest SWOB station: ${detail.weather?.station || 'none returned'}`);
  console.log(`- Ontario 511 events within 60 km: ${(detail.roadEvents?.events || []).length}`);
  console.log('PRODUCT SMOKE PASS');
}

main().catch(error => {
  console.error(`PRODUCT SMOKE FAIL: ${error.stack || error.message || error}`);
  process.exit(1);
});
