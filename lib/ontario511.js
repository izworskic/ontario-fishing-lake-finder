const EVENTS_URL = 'https://511on.ca/api/v2/get/event?format=json&lang=en';

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => !Number.isFinite(Number(v)))) return null;
  const R = 6371;
  const rad = x => Number(x) * Math.PI / 180;
  const dLat = rad(Number(lat2) - Number(lat1));
  const dLon = rad(Number(lon2) - Number(lon1));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizeEvent(event, lakeLat, lakeLon) {
  const latitude = Number(event?.Latitude);
  const longitude = Number(event?.Longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const distanceKm = haversineKm(lakeLat, lakeLon, latitude, longitude);
  if (distanceKm === null) return null;
  return {
    id: event.ID ?? null,
    roadway: event.RoadwayName || null,
    direction: event.DirectionOfTravel || null,
    description: event.Description || null,
    eventType: event.EventType || null,
    eventSubType: event.EventSubType || null,
    fullClosure: event.IsFullClosure === true,
    severity: event.Severity || null,
    impact: event.Impact || null,
    lanesAffected: event.LanesAffected || null,
    lastUpdated: Number.isFinite(Number(event.LastUpdated)) ? Number(event.LastUpdated) : null,
    latitude,
    longitude,
    distanceKm: Math.round(distanceKm * 10) / 10
  };
}

function eventPenalty(events) {
  let penalty = 0;
  const reasons = [];
  const nearest = events?.[0];
  const closure = (events || []).find(e => e.fullClosure && e.distanceKm <= 30);
  const serious = (events || []).find(e => e.distanceKm <= 20 && /high|major|severe/i.test(String(e.severity || e.impact || '')));

  if (closure) {
    penalty = Math.max(penalty, closure.distanceKm <= 10 ? 30 : closure.distanceKm <= 20 ? 22 : 14);
    reasons.push(`Ontario 511 full closure ${closure.distanceKm} km from the lake`);
  } else if (serious) {
    penalty = Math.max(penalty, 16);
    reasons.push(`Ontario 511 major traffic event ${serious.distanceKm} km from the lake`);
  } else if (nearest && nearest.distanceKm <= 10) {
    penalty = Math.max(penalty, 7);
    reasons.push(`Ontario 511 traffic event ${nearest.distanceKm} km from the lake`);
  } else if (nearest && nearest.distanceKm <= 30) {
    reasons.push(`nearest Ontario 511 event is ${nearest.distanceKm} km away`);
  }

  return { penalty, reasons };
}

async function roadEventContext(lat, lon, radiusKm = 60) {
  const out = {
    events: [],
    nearestEventKm: null,
    penalty: 0,
    reasons: [],
    source: EVENTS_URL,
    note: 'Ontario 511 events describe provincial traffic conditions. Proximity to a lake does not prove the event lies on the route you would actually drive.'
  };
  try {
    const response = await fetch(EVENTS_URL, {
      headers: { accept: 'application/json', 'user-agent': 'ChrisIzworskiOntarioFishingLakeFinder/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Ontario 511 HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.Events) ? payload.Events : [];
    out.events = rows.map(e => normalizeEvent(e, lat, lon)).filter(Boolean).filter(e => e.distanceKm <= radiusKm).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 12);
    out.nearestEventKm = out.events[0]?.distanceKm ?? null;
    const scored = eventPenalty(out.events);
    out.penalty = scored.penalty;
    out.reasons = scored.reasons;
  } catch (error) {
    out.error = String(error?.message || error);
  }
  return out;
}

function applyRoadEventPenalty(lake, roadEvents) {
  if (!lake?.tripScoreBreakdown || !roadEvents) return lake;
  const currentLive = Number(lake.tripScoreBreakdown.tripContextScore);
  const evidence = Number(lake.tripScoreBreakdown.evidenceScore ?? lake.matchScore);
  if (!Number.isFinite(currentLive) || !Number.isFinite(evidence)) return { ...lake, roadEvents };
  const adjustedLive = Math.max(0, Math.min(100, currentLive - (roadEvents.penalty || 0)));
  const reasons = [...(lake.tripScoreBreakdown.reasons || []), ...(roadEvents.reasons || [])].slice(0, 8);
  const tripScore = Math.round(evidence * 0.65 + adjustedLive * 0.35);
  return {
    ...lake,
    roadEvents,
    roads: { ...(lake.roads || {}), trafficEvents: roadEvents.events || [] },
    tripScore,
    tripScoreBreakdown: {
      ...lake.tripScoreBreakdown,
      tripContextScore: adjustedLive,
      score: tripScore,
      reasons,
      semantics: 'Trip score combines lake-fit evidence with mapped access, roads/barriers, Ontario 511 traffic events, active-fire proximity and current station observations. It is not a catch forecast, safety clearance, route guarantee, drive-time estimate, or legal access determination.'
    }
  };
}

module.exports = { EVENTS_URL, haversineKm, normalizeEvent, eventPenalty, roadEventContext, applyRoadEventPenalty };
