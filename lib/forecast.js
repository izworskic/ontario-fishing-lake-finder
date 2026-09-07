const CITYPAGE_ITEMS = 'https://api.weather.gc.ca/collections/citypageweather-realtime/items';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function langValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Array.isArray(v)) {
    if (v.en !== undefined) return langValue(v.en);
    if (v.value !== undefined) return langValue(v.value);
  }
  return v;
}

function text(v) {
  const x = langValue(v);
  return x === null || x === undefined || String(x).trim() === '' ? null : String(x).trim();
}

function valueNum(v) {
  return num(langValue(v));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => !Number.isFinite(Number(v)))) return null;
  const R = 6371;
  const rad = x => Number(x) * Math.PI / 180;
  const dLat = rad(Number(lat2) - Number(lat1));
  const dLon = rad(Number(lon2) - Number(lon1));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeHourly(raw) {
  if (!raw) return null;
  const timestamp = text(raw.timestamp);
  if (!timestamp) return null;
  const wind = raw.wind || {};
  return {
    timestamp,
    condition: text(raw.condition),
    temperatureC: valueNum(raw.temperature),
    precipProbabilityPct: valueNum(raw.lop),
    windKmh: valueNum(wind.speed),
    windGustKmh: valueNum(wind.gust),
    windDirection: text(wind.direction),
    iconCode: valueNum(raw.iconCode)
  };
}

function hourScore(hour) {
  let score = 100;
  const reasons = [];
  const wind = hour.windKmh;
  const gust = hour.windGustKmh;
  const pop = hour.precipProbabilityPct;
  const condition = String(hour.condition || '').toLowerCase();

  if (Number.isFinite(wind)) {
    if (wind >= 40) { score -= 55; reasons.push(`wind ${Math.round(wind)} km/h`); }
    else if (wind >= 30) { score -= 35; reasons.push(`wind ${Math.round(wind)} km/h`); }
    else if (wind >= 20) { score -= 18; reasons.push(`wind ${Math.round(wind)} km/h`); }
    else if (wind >= 12) { score -= 7; reasons.push(`wind ${Math.round(wind)} km/h`); }
  }
  if (Number.isFinite(gust) && gust >= 45) { score -= 20; reasons.push(`gusts ${Math.round(gust)} km/h`); }
  else if (Number.isFinite(gust) && gust >= 35) { score -= 10; reasons.push(`gusts ${Math.round(gust)} km/h`); }

  if (Number.isFinite(pop)) {
    if (pop >= 80) { score -= 25; reasons.push(`${Math.round(pop)}% precipitation chance`); }
    else if (pop >= 60) score -= 16;
    else if (pop >= 40) score -= 9;
    else if (pop >= 20) score -= 4;
  }

  if (/thunder|squall|freezing rain|hail/.test(condition)) {
    score -= 45;
    reasons.push(hour.condition || 'hazardous weather');
  } else if (/heavy rain|snow at times heavy|blizzard/.test(condition)) {
    score -= 30;
    reasons.push(hour.condition || 'significant precipitation');
  } else if (/rain|showers|snow/.test(condition)) {
    score -= 8;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

function bestWindow(hours, windowHours = 3) {
  const usable = (hours || []).filter(h => h?.timestamp).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (usable.length < windowHours) return null;
  let best = null;
  for (let i = 0; i <= usable.length - windowHours; i++) {
    const slice = usable.slice(i, i + windowHours);
    const parsed = slice.map(h => new Date(h.timestamp).getTime());
    if (parsed.some(Number.isNaN)) continue;
    let continuous = true;
    for (let j = 1; j < parsed.length; j++) {
      if (Math.abs(parsed[j] - parsed[j - 1] - 3600000) > 300000) continuous = false;
    }
    if (!continuous) continue;
    const scored = slice.map(hourScore);
    const average = Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length);
    const maxWind = Math.max(...slice.map(h => Number.isFinite(h.windKmh) ? h.windKmh : -Infinity));
    const maxGust = Math.max(...slice.map(h => Number.isFinite(h.windGustKmh) ? h.windGustKmh : -Infinity));
    const maxPop = Math.max(...slice.map(h => Number.isFinite(h.precipProbabilityPct) ? h.precipProbabilityPct : -Infinity));
    const candidate = {
      score: average,
      start: slice[0].timestamp,
      end: slice[slice.length - 1].timestamp,
      hours: slice,
      maxWindKmh: maxWind === -Infinity ? null : maxWind,
      maxGustKmh: maxGust === -Infinity ? null : maxGust,
      maxPrecipProbabilityPct: maxPop === -Infinity ? null : maxPop,
      conditions: [...new Set(slice.map(h => h.condition).filter(Boolean))],
      semantics: 'Weather Window score describes forecast comfort/exposure using wind, gust, precipitation probability and significant-weather wording. It is not a fishing-success forecast or safety clearance.'
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

function normalizeFeature(feature, lakeLat, lakeLon) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates || [];
  const lon = num(coords[0]);
  const lat = num(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hourlyRaw = p.hourlyForecastGroup?.hourlyForecasts;
  const hourlyList = Array.isArray(hourlyRaw) ? hourlyRaw : hourlyRaw ? [hourlyRaw] : [];
  const now = Date.now() - 60 * 60 * 1000;
  const hours = hourlyList.map(normalizeHourly).filter(Boolean).filter(h => {
    const t = new Date(h.timestamp).getTime();
    return Number.isFinite(t) && t >= now;
  }).slice(0, 72);
  return {
    id: feature.id || p.id || null,
    name: text(p.name) || 'Environment Canada forecast location',
    region: text(p.region),
    url: text(p.url),
    lastUpdated: text(p.lastUpdated),
    latitude: lat,
    longitude: lon,
    distanceKm: Math.round(haversineKm(lakeLat, lakeLon, lat, lon) * 10) / 10,
    hours,
    best3HourWindow: bestWindow(hours, 3)
  };
}

async function forecastContext(lat, lon) {
  const out = {
    location: null,
    best3HourWindow: null,
    hours: [],
    source: CITYPAGE_ITEMS,
    note: 'Uses the nearest Environment Canada City Page forecast returned around the lake. The forecast point may be some distance from the lake, especially in remote Ontario.'
  };
  try {
    const span = 3.0;
    const bbox = [lon - span, lat - span, lon + span, lat + span].join(',');
    const url = `${CITYPAGE_ITEMS}?${new URLSearchParams({ bbox, limit: '100', f: 'json' })}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'ChrisIzworskiOntarioFishingLakeFinder/1.0' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Environment Canada forecast HTTP ${response.status}`);
    const data = await response.json();
    const candidates = (data.features || []).map(f => normalizeFeature(f, lat, lon)).filter(Boolean).sort((a, b) => a.distanceKm - b.distanceKm);
    const chosen = candidates.find(c => c.hours.length >= 3) || candidates[0];
    if (!chosen) return out;
    out.location = {
      id: chosen.id,
      name: chosen.name,
      region: chosen.region,
      url: chosen.url,
      lastUpdated: chosen.lastUpdated,
      latitude: chosen.latitude,
      longitude: chosen.longitude,
      distanceKm: chosen.distanceKm
    };
    out.hours = chosen.hours.slice(0, 48);
    out.best3HourWindow = chosen.best3HourWindow;
  } catch (error) {
    out.error = String(error?.message || error);
  }
  return out;
}

function windowReason(window, forecast, quality) {
  const bits = [];
  if (forecast?.location?.name) {
    bits.push(`${forecast.location.name}${Number.isFinite(forecast.location.distanceKm) ? ` (${forecast.location.distanceKm} km from lake)` : ''}`);
  }
  bits.push(`${window.start} to ${window.end}`);
  bits.push(`Weather Window ${window.score}/100`);
  if (Number.isFinite(window.maxWindKmh)) bits.push(`max wind ${Math.round(window.maxWindKmh)} km/h`);
  if (Number.isFinite(window.maxGustKmh)) bits.push(`max gust ${Math.round(window.maxGustKmh)} km/h`);
  if (Number.isFinite(window.maxPrecipProbabilityPct)) bits.push(`precipitation chance up to ${Math.round(window.maxPrecipProbabilityPct)}%`);
  if (window.conditions?.length) bits.push(window.conditions.slice(0, 2).join('/'));
  return `${quality} upcoming 3-hour weather window — ${bits.join(' · ')}`;
}

function applyForecastToTrip(lake, forecast) {
  if (!lake?.tripScoreBreakdown || !forecast?.best3HourWindow) return { ...lake, forecast };
  const evidence = Number(lake.tripScoreBreakdown.evidenceScore ?? lake.matchScore);
  const live = Number(lake.tripScoreBreakdown.tripContextScore);
  if (!Number.isFinite(evidence) || !Number.isFinite(live)) return { ...lake, forecast };

  const window = forecast.best3HourWindow;
  let adjustment = 0;
  let quality = 'mixed';
  if (window.score >= 85) { adjustment = 6; quality = 'excellent'; }
  else if (window.score >= 70) { adjustment = 3; quality = 'good'; }
  else if (window.score < 40) { adjustment = -12; quality = 'poor'; }
  else if (window.score < 55) { adjustment = -6; quality = 'limited'; }

  const adjustedLive = Math.max(0, Math.min(100, live + adjustment));
  const tripScore = Math.round(evidence * 0.65 + adjustedLive * 0.35);
  const forecastReason = windowReason(window, forecast, quality);
  return {
    ...lake,
    forecast,
    tripScore,
    tripScoreBreakdown: {
      ...lake.tripScoreBreakdown,
      score: tripScore,
      tripContextScore: adjustedLive,
      reasons: [...(lake.tripScoreBreakdown.reasons || []), forecastReason].slice(0, 10),
      semantics: 'Trip score combines lake-fit evidence with mapped access, roads/barriers, Ontario 511 events, active-fire proximity, current station observations and the best upcoming Environment Canada weather window. It is not a catch forecast, safety clearance, route guarantee, drive-time estimate, or legal access determination.'
    }
  };
}

module.exports = { CITYPAGE_ITEMS, langValue, normalizeHourly, hourScore, bestWindow, normalizeFeature, forecastContext, windowReason, applyForecastToTrip };
