const { sourceManifest } = require('../lib/core');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: 'ontario-fishing-lake-finder',
    version: '1.0.0',
    checkedAt: new Date().toISOString(),
    sourceFamilies: Object.keys(sourceManifest())
  });
};
