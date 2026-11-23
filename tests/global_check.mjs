// AgroSignal outside the Kano example: southern-hemisphere season across the new year, high northern latitude, South Asia,
// and a site north of CHIRPS coverage. Checks that each run completes with sensible counts, not what the anomaly should be.
// Serve the repository on port 8765 (rainfall archive) or set CHIRPS_BASE. Usage: node tests/global_check.mjs
import { runAnalysis } from '../js/pipeline.js';
const box = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const cases = [
  { name: 'Free State, South Africa (maize), Nov-Mar 2023/24', aoi: box(26.4, -27.6, 26.8, -27.2), season: { start: '11-01', end: '03-31' }, year: 2023, baseline: [2003, 2020] },
  { name: 'Saskatchewan, Canada (52 N), May-Aug 2021', aoi: box(-106.8, 51.9, -106.4, 52.2), season: { start: '05-01', end: '08-31' }, year: 2021, baseline: [2003, 2020] },
  { name: 'Punjab, India, Jun-Oct 2023', aoi: box(75.6, 30.6, 76.0, 30.9), season: { start: '06-01', end: '10-31' }, year: 2023, baseline: [2003, 2020] },
  { name: 'Southern Finland (61 N, outside CHIRPS), May-Aug 2023', aoi: box(23.0, 61.0, 23.4, 61.2), season: { start: '05-01', end: '08-31' }, year: 2023, baseline: [2003, 2020] },
];
const chirpsBase = process.env.CHIRPS_BASE || 'http://127.0.0.1:8765/data/chirps/';
let fails = 0;
for (const c of cases) {
  const t0 = Date.now();
  try {
    const r = await runAnalysis({ ...c, chirpsBase }), s = r.summary, cl = s.climate;
    const ok = s.pixelsAnalysed > 0 && Number.isFinite(s.target.ndvi) && s.target.baselineSeasons >= 12;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.meta.composites.length} composites, ${s.pixelsAnalysed} cropland pixels analysed,` +
      ` NDVI ${s.target.ndvi.toFixed(3)} vs ${s.baseline.ndviMean.toFixed(3)}, regional z ${s.regionalZ.toFixed(2)}, rank ${s.target.rankBelow}/${s.target.baselineSeasons};` +
      ` rain ${Number.isFinite(cl.rain) ? `${cl.rain.toFixed(0)} mm (${cl.rainPct.toFixed(0)}%), ${cl.rainCells} cells, months ${cl.rainMonths.join(' ')}` : cl.rainNote};` +
      ` temperature ${Number.isFinite(cl.t2m) ? `${cl.t2m.toFixed(1)} C` : cl.tempNote}`);
  } catch (e) { fails++; console.log(`FAIL  ${c.name}: ${e.message}`); }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
