// European candidates for the opening-screen example (run 27 November 2026; output in docs/validation/europe-check.txt).
// Serve the repository on port 8765 for the rainfall archive. Usage: node tests/europe_check.mjs
import { runAnalysis } from '../js/pipeline.js';
const box = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const cases = [
  { name: 'Beauce, France, Apr-Jul 2022', aoi: box(1.4, 48.1, 1.8, 48.4), season: { start: '04-01', end: '07-31' }, year: 2022, baseline: [2001, 2020] },
  { name: 'Great Hungarian Plain, Jun-Aug 2022', aoi: box(20.0, 46.5, 20.4, 46.8), season: { start: '06-01', end: '08-31' }, year: 2022, baseline: [2001, 2020] },
];
for (const c of cases) {
  const t0 = Date.now();
  try {
    const r = await runAnalysis({ ...c, chirpsBase: 'http://127.0.0.1:8765/data/chirps/' }), s = r.summary, cl = s.climate;
    console.log(`${c.name}: ${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.meta.composites.length} composites, ${s.pixelsAnalysed} pixels, NDVI ${s.target.ndvi.toFixed(3)} vs ${s.baseline.ndviMean.toFixed(3)}, z ${s.regionalZ.toFixed(2)}, rank ${s.target.rankBelow}/${s.target.baselineSeasons}, missing ${s.baseline.missingYears}; rain ${Number.isFinite(cl.rain) ? cl.rain.toFixed(0) + ' mm (' + cl.rainPct.toFixed(0) + '%)' : cl.rainNote}; t ${Number.isFinite(cl.t2m) ? cl.t2m.toFixed(1) : cl.tempNote}`);
  } catch (e) { console.log(`FAIL ${c.name}: ${e.message}`); }
}
