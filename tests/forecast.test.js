const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHourly, hourScore, bestWindow, applyForecastToTrip } = require('../lib/forecast');

test('hourly Environment Canada forecast normalization unwraps English values', () => {
  const h = normalizeHourly({
    timestamp: '2026-09-07T12:00:00Z',
    condition: { en: 'Chance of showers' },
    temperature: { value: { en: 15 } },
    lop: { value: { en: 30 } },
    wind: {
      speed: { value: { en: 20 } },
      gust: { value: { en: 35 } },
      direction: { value: { en: 'NW' } }
    }
  });
  assert.equal(h.condition, 'Chance of showers');
  assert.equal(h.temperatureC, 15);
  assert.equal(h.precipProbabilityPct, 30);
  assert.equal(h.windKmh, 20);
  assert.equal(h.windGustKmh, 35);
  assert.equal(h.windDirection, 'NW');
});

test('weather window penalizes strong wind and thunderstorms without claiming fishing success', () => {
  const calm = hourScore({ windKmh: 8, windGustKmh: 15, precipProbabilityPct: 10, condition: 'Partly cloudy' });
  const rough = hourScore({ windKmh: 40, windGustKmh: 55, precipProbabilityPct: 90, condition: 'Thunderstorms' });
  assert.ok(calm.score > rough.score);
  assert.ok(rough.score < 20);
});

test('best window chooses the strongest continuous three-hour block', () => {
  const base = Date.parse('2026-09-07T12:00:00Z');
  const hours = Array.from({ length: 6 }, (_, i) => ({
    timestamp: new Date(base + i * 3600000).toISOString(),
    windKmh: i < 3 ? 35 : 8,
    windGustKmh: i < 3 ? 45 : 15,
    precipProbabilityPct: i < 3 ? 70 : 10,
    condition: i < 3 ? 'Rain' : 'Partly cloudy'
  }));
  const window = bestWindow(hours, 3);
  assert.equal(window.start, hours[3].timestamp);
  assert.ok(window.score >= 80);
  assert.match(window.semantics, /not a fishing-success forecast/);
});

test('forecast changes Trip Context while leaving Lake Match untouched', () => {
  const lake = {
    matchScore: 92,
    tripScore: 82,
    tripScoreBreakdown: {
      evidenceScore: 92,
      tripContextScore: 64,
      reasons: ['mapped access nearby']
    }
  };
  const forecast = {
    best3HourWindow: {
      score: 92,
      start: '2026-09-07T12:00:00Z',
      end: '2026-09-07T14:00:00Z'
    }
  };
  const adjusted = applyForecastToTrip(lake, forecast);
  assert.equal(adjusted.matchScore, 92);
  assert.equal(adjusted.tripScoreBreakdown.evidenceScore, 92);
  assert.equal(adjusted.tripScoreBreakdown.tripContextScore, 70);
  assert.ok(adjusted.tripScore > lake.tripScore);
  assert.match(adjusted.tripScoreBreakdown.semantics, /not a catch forecast/);
});
