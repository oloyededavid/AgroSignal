// Terra against Aqua for the same area, season and baseline (2003-2020, Aqua's first full seasons), to check whether a target
// season's anomaly depends on the satellite. Usage: node tests/sensor_check.mjs YEAR
import { runAnalysis } from '../js/pipeline.js';
const ring = [[8.0, 12.0], [8.4, 12.0], [8.4, 12.4], [8.0, 12.4], [8.0, 12.0]], year = +process.argv[2] || 2026;
for (const sensor of ['terra', 'aqua']) {
  const r = await runAnalysis({ aoi: { type: 'Polygon', coordinates: [ring] }, season: { start: '06-01', end: '10-31' }, year, baseline: [2003, 2020], sensor,
    chirpsBase: 'http://127.0.0.1:8765/data/chirps/' });
  const s = r.summary;
  console.log(sensor, year, 'composites', r.meta.composites.length, 'pixels', s.pixelsAnalysed, 'NDVI', s.target.ndvi.toFixed(4), 'baseline', s.baseline.ndviMean.toFixed(4),
    'sd', s.baseline.ndviSd.toFixed(4), 'regional z', s.regionalZ.toFixed(2), 'rank', s.target.rankBelow, '/', s.target.baselineSeasons,
    'series', r.regional.map(x => `${x.year}:${x.ndvi.toFixed(3)}`).join(' '));
}
