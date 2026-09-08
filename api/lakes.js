const { clean, num, lakeDetail, sourceManifest } = require('../lib/core');
const { searchComplete, mapViewport, catalogLakeDetail, hasFisheriesFilters } = require('../lib/catalog');
const { searchOhn, mapOhn, ohnLakeDetail, OHN_URL } = require('../lib/ohn');
const { searchRemoteTrout } = require('../lib/remote');
const { roadEventContext, applyRoadEventPenalty, EVENTS_URL } = require('../lib/ontario511');
const { forecastContext, applyForecastToTrip, CITYPAGE_ITEMS } = require('../lib/forecast');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const mode = clean(req.query?.mode || 'search', 16);
  const species = clean(req.query?.species, 64);
  const originLat = num(req.query?.originLat);
  const originLon = num(req.query?.originLon);
  const minDepthRaw = num(req.query?.minDepth);
  const maxDistanceRaw = num(req.query?.maxDistanceKm);
  const filters = {
    species,
    q: clean(req.query?.q, 80),
    fmz: clean(req.query?.fmz, 2),
    thermal: clean(req.query?.thermal, 8).toLowerCase(),
    minDepth: minDepthRaw === null ? null : minDepthRaw,
    originLat,
    originLon,
    maxDistanceKm: maxDistanceRaw === null ? null : maxDistanceRaw,
    stocking: clean(req.query?.stocking, 16).toLowerCase()
  };
  const fisheriesMode = hasFisheriesFilters(filters);

  try {
    if (mode === 'remote') {
      const limit = Math.min(20, Math.max(6, Number(req.query?.limit) || 12));
      const result = await searchRemoteTrout(filters, limit);
      const sources = sourceManifest();
      sources.ohnWaterbody = { url: OHN_URL, role: 'physical lake geometry context; fisheries evidence remains separate' };
      return res.status(200).json({
        fetchedAt: new Date().toISOString(),
        filters: { ...filters, species: result.species, thermal: filters.thermal || 'cold' },
        count: result.lakes.length,
        listCount: result.listCount,
        candidateCount: result.candidateCount,
        fisheriesCoverageComplete: result.fisheriesCoverageComplete,
        remotenessEvaluatedCount: result.remotenessEvaluatedCount,
        resultSemantics: result.semantics,
        lakes: result.lakes,
        sources
      });
    }

    if (mode === 'detail') {
      const requestedId = clean(req.query?.id, 64);
      let lake = requestedId.startsWith('ohn:') ? await ohnLakeDetail(requestedId) : await lakeDetail(requestedId, species);
      if (!lake && !requestedId.startsWith('ohn:')) lake = await catalogLakeDetail(requestedId);
      if (!lake) return res.status(404).json({ error: 'Lake not found in Ontario source data' });
      if (Number.isFinite(lake.latitude) && Number.isFinite(lake.longitude) && lake.fishEvidenceAvailable !== false) {
        const [roadEvents, forecast] = await Promise.all([
          roadEventContext(lake.latitude, lake.longitude, 60),
          forecastContext(lake.latitude, lake.longitude)
        ]);
        lake = applyRoadEventPenalty(lake, roadEvents);
        lake = applyForecastToTrip(lake, forecast);
      }
      const sources = sourceManifest();
      sources.ohnWaterbody = { url: OHN_URL, role: 'province-wide Ontario Hydro Network polygon inventory used to establish physical lake presence in All lakes mode' };
      sources.ontario511Events = { url: EVENTS_URL, role: 'current Ontario 511 traffic events and closures near the selected lake; proximity is not route proof' };
      sources.cityPageForecast = { url: CITYPAGE_ITEMS, role: 'nearest Environment Canada City Page hourly forecast used to identify an upcoming weather window; forecast location may be distant from remote lakes' };
      return res.status(200).json({ fetchedAt: new Date().toISOString(), lake, sources });
    }

    if (mode === 'map') {
      const bboxRaw = clean(req.query?.bbox, 128);
      let map;
      if (fisheriesMode) {
        map = await mapViewport(filters, bboxRaw, 12000);
      } else {
        const parts = bboxRaw.split(',').map(Number);
        if (parts.length !== 4 || parts.some(v => !Number.isFinite(v)) || parts[0] >= parts[2] || parts[1] >= parts[3]) throw new Error('Invalid map bbox');
        map = await mapOhn(filters, { west: parts[0], south: parts[1], east: parts[2], north: parts[3] }, 12000);
      }
      const sources = sourceManifest();
      sources.ohnWaterbody = { url: OHN_URL, role: 'province-wide Ontario Hydro Network polygon inventory used for physical lake coverage' };
      return res.status(200).json({
        fetchedAt: new Date().toISOString(),
        filters,
        ...map,
        resultSemantics: map.coverageComplete
          ? (fisheriesMode
              ? 'Complete matching fisheries-record lake coverage for the current map viewport, deduplicated by Ontario Waterbody Location Identifier.'
              : 'Complete Ontario Hydro Network lake coverage for the current map viewport. Fisheries evidence is a separate enrichment and does not determine whether an OHN lake exists.')
          : (map.truncatedReason === 'zoom_required'
              ? `The current viewport contains ${map.matchedInView} OHN lakes, above the safe interactive marker ceiling. Zoom in; the tool does not silently sample lakes and call the result complete.`
              : 'Viewport coverage hit a declared source safety ceiling. Zoom in to retrieve complete lake coverage; lakes are never silently omitted.'),
        sources
      });
    }

    const limit = Math.min(150, Math.max(25, Number(req.query?.limit) || 100));
    const result = fisheriesMode ? await searchComplete(filters, limit) : await searchOhn(filters, limit);
    const sources = sourceManifest();
    sources.ohnWaterbody = { url: OHN_URL, role: 'province-wide Ontario Hydro Network polygon inventory used to establish physical lake presence in All lakes mode' };
    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: result.lakes.length,
      listCount: result.listCount,
      candidateCount: result.candidateCount,
      coverageComplete: result.coverageComplete,
      sourceFeatureCount: result.sourceFeatureCount,
      sourcePages: result.sourcePages,
      catalogMode: result.catalogMode,
      filters,
      resultSemantics: fisheriesMode
        ? (result.coverageComplete
            ? `Ontario-wide fisheries-record candidate discovery is complete for the active filters. The list shows the best ${result.listCount} of ${result.candidateCount} matching lakes; use the map for complete viewport coverage.`
            : 'Ontario-wide fisheries-record discovery hit a declared source safety ceiling. The list is partial; map viewport queries provide complete coverage when zoomed in.')
        : `Ontario Hydro Network reports ${result.candidateCount} lake polygons for the active name/location filters. The list is intentionally bounded for browsing; the map provides complete OHN coverage once the viewport is narrow enough to stay below the declared marker ceiling.`,
      lakes: result.lakes,
      sources
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Ontario fishing lake data is temporarily unavailable', detail: String(error?.message || error), fallbackUsed: false });
  }
};
