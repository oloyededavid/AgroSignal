// Runs the AgroSignal pipeline on the Kano example (farmland around Bagwai) and writes the result for pipeline/reference.py and
// pipeline/reference_climate.py. The rainfall archive is read over HTTP: serve the repository on port 8765 or set CHIRPS_BASE.
import { runAnalysis } from '../js/pipeline.js';
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const ring = [[8.0, 12.0], [8.4, 12.0], [8.4, 12.4], [8.0, 12.4], [8.0, 12.0]];
const r = await runAnalysis({ aoi: { type: 'Polygon', coordinates: [ring] }, season: { start: '06-01', end: '10-31' }, year: 2026, baseline: [2001, 2020],
  chirpsBase: process.env.CHIRPS_BASE || 'http://127.0.0.1:8765/data/chirps/', onProgress: m => console.log('  ·', m) });
console.log(JSON.stringify(r.summary, null, 1));
console.log('regional', r.regional.map(x => `${x.year}:${x.ndvi.toFixed(3)}`).join(' '));
writeFileSync(out, JSON.stringify({ grid: r.grid, summary: r.summary, regional: r.regional, climate: r.climate, curve: r.curve,
  anom: Array.from(r.anom), z: Array.from(r.z), vci: Array.from(r.vci), target: Array.from(r.target), crop: Array.from(r.crop), fixed: Array.from(r.fixed),
  composites: r.meta.composites, meta: r.meta }));
