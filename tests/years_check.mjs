// Regional NDVI and rainfall for recent target years, same area and baseline, to check for a post-2020 shift.
import { runAnalysis } from '../js/pipeline.js';
const ring = [[8.0, 12.0], [8.4, 12.0], [8.4, 12.4], [8.0, 12.4], [8.0, 12.0]];
for (const year of process.argv.slice(2).map(Number)) {
  const r = await runAnalysis({ aoi: { type: 'Polygon', coordinates: [ring] }, season: { start: '06-01', end: '10-31' }, year, baseline: [2001, 2020] });
  const s = r.summary; console.log(year, 'NDVI', s.target.ndvi.toFixed(3), 'regional z', s.regionalZ.toFixed(2), 'rain', s.climate.rain, s.climate.rainNote || '', s.climate.tempNote || '');
}
