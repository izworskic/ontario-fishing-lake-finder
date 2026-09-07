const { clean, num, searchLakes, lakeDetail, sourceManifest } = require('../lib/core');
const { roadEventContext, applyRoadEventPenalty, EVENTS_URL } = require('../lib/ontario511');
const { forecastContext, applyForecastToTrip, CITYPAGE_ITEMS } = require('../lib/forecast');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const mode = clean(req.query?.mode || 'search', 16);
  const species = clean(req.query?.species, 64);

  try {
    if (mode === 'detail') {
      let lake = await lakeDetail(req.query?.id, species);
      if (!lake) return res.status(404).json({ error: 'Lake not found in Ontario ARA data' });
      if (Number.isFinite(lake.latitude) && Number.isFinite(lake.longitude)) {
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

    const limit = Math.min(100, Math.max(10, Number(req.query?.limit) || 60));
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
    const lakes = await searchLakes(filters, limit);
    return res.status(200).json({
      fetchedAt: new Date().toISOString(),
      count: lakes.length,
      filters,
      resultSemantics: 'Ranked shortlist, not a claim of complete provincial inventory. Match score measures fit to selected filters and available source evidence, not fish abundance or catch probability.',
      lakes,
      sources: sourceManifest()
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Ontario fishing lake data is temporarily unavailable', detail: String(error?.message || error), fallbackUsed: false });
  }
};
