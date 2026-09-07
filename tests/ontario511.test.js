const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, eventPenalty, applyRoadEventPenalty } = require('../lib/ontario511');

test('Ontario 511 event normalization calculates lake proximity', () => {
  const row = normalizeEvent({ ID: 1, RoadwayName: 'HWY 17', Latitude: 46.1, Longitude: -82, IsFullClosure: true, EventType: 'closures' }, 46, -82);
  assert.equal(row.roadway, 'HWY 17');
  assert.equal(row.fullClosure, true);
  assert.ok(row.distanceKm > 10 && row.distanceKm < 12);
});

test('nearby full closure receives a strong trip-context penalty', () => {
  const scored = eventPenalty([{ roadway: 'HWY 17', fullClosure: true, distanceKm: 8 }]);
  assert.equal(scored.penalty, 30);
  assert.match(scored.reasons[0], /full closure/);
});

test('distant traffic event does not manufacture a penalty', () => {
  const scored = eventPenalty([{ roadway: 'HWY 17', fullClosure: false, distanceKm: 45, severity: 'Unknown' }]);
  assert.equal(scored.penalty, 0);
});

test('Ontario 511 penalty changes Trip Context, not Lake Match', () => {
  const lake = {
    matchScore: 90,
    tripScore: 84,
    tripScoreBreakdown: {
      score: 84,
      evidenceScore: 90,
      tripContextScore: 72,
      reasons: ['mapped access nearby']
    },
    roads: {}
  };
  const adjusted = applyRoadEventPenalty(lake, { penalty: 30, reasons: ['Ontario 511 full closure 8 km from the lake'], events: [{ distanceKm: 8, fullClosure: true }] });
  assert.equal(adjusted.matchScore, 90);
  assert.equal(adjusted.tripScoreBreakdown.evidenceScore, 90);
  assert.equal(adjusted.tripScoreBreakdown.tripContextScore, 42);
  assert.ok(adjusted.tripScore < lake.tripScore);
  assert.match(adjusted.tripScoreBreakdown.semantics, /not a catch forecast/);
  assert.match(adjusted.tripScoreBreakdown.semantics, /route guarantee/);
});
