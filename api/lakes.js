const { clean, num, lakeDetail, sourceManifest } = require('../lib/core');
const { searchComplete, mapViewport, catalogLakeDetail, hasFisheriesFilters } = require('../lib/catalog');
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
    maxDistanceKm: maxDistanceRaw === null ? null : maxDistanceRaw
  };
  const fisheriesMode = hasFisheriesFilters(filters);

  try {
    if (mode === 'detail') {
      let lake = await lakeDetail(req.query?.id, species);
      if (!lake) lake = await catalogLakeDetail(req.query?.id);
      if (!lake) return res.status(404).json({ error: 'Lake not found in Ontario Waterbody Location Identifier data' });
      if (Number.isFinite(lake.latitude) && Number.isFinite(lake.longitude) && lake.fishEvidenceAvailable !== false) {
        const [roadEvents, forecast] = await Promise.all([
          roadEventContext(lake.latitude, lake.longitude, 60),
          forecastContext(lake.latitude, lake.longitude)
        ]);
        lake = applyRoadEventPenalty(lake, roadEvents);
        lake = applyForecastToTrip(lake, forecast);
      }
      const sources = sourceManifest();
      sources.ontario511Events = { url: EVENTS_URL, role: 'current Ontario 511 traffic events and closures near the selected lake; proximity is not route proof' };
      sources.cityPageForecast = { url: CITYPAGE_ITEMS, role: 'nearest Environment Canada City Page hourly forecast used to identify an upcoming weather window; forecast location may be distant from remote lakes' };
      return res.status(200).json({ fetchedAt: new Date().toISOString(), lake, sources });
    }

    if (mode === 'map') {
      const map = await mapViewport(filters, req.query?.bbox, 12000);
      const allLakes = map.catalogMode === 'all_lakes';
      return res.status(200).json({
        fetchedAt: new Date().toISOString(),
        filters,
        ...map,
        resultSemantics: map.coverageComplete
          ? (allLakes
              ? 'Complete Ontario Waterbody Location Identifier lake coverage for the current map viewport. Fisheries evidence is an optional enrichment and does not determine whether a catalog lake exists.'
              : 'Complete matching fisheries-record lake coverage for the current map viewport, deduplicated by Ontario Waterbody Location Identifier.')
          : 'Viewport coverage hit a declared safety ceiling. Zoom in to retrieve complete lake coverage; lakes are never silently omitted.',
        sources: sourceManifest()
      });
    }

    const limit = Math.min(150, Math.max(25, Number(req.query?.limit) || 100));
    const result = await searchComplete(filters, limit);
    const allLakes = result.catalogMode === 'all_lakes';
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
      resultSemantics: allLakes
        ? `Ontario Waterbody Location Identifier reports ${result.candidateCount} catalog lakes for the active name/location filters. The list is a bounded discovery list; use the map for complete viewport coverage. Fisheries data is joined only when a fisheries filter is selected or a lake is opened.`
        : (result.coverageComplete
            ? `Ontario-wide fisheries-record candidate discovery is complete for the active filters. The list shows the best ${result.listCount} of ${result.candidateCount} matching lakes; use the map for complete viewport coverage.`
            : 'Ontario-wide fisheries-record discovery hit a declared source safety ceiling. The list is partial; map viewport queries provide complete coverage when zoomed in.'),
      lakes: result.lakes,
      sources: sourceManifest()
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Ontario fishing lake data is temporarily unavailable', detail: String(error?.message || error), fallbackUsed: false });
  }
};
