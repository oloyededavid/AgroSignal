// Deterministic end-to-end check on fixed inputs: a small box of farmland near Bagwai (Kano), August–September 2011 against a
// 2001–2010 baseline (the shortest baseline the pipeline accepts), run through the whole pipeline with every network response replayed from tests/fixtures/kano-small/.
// CHIRPS rainfall is read from this repository's own archive. The live MODIS archive can be reprocessed; this test cannot
// change unless the code does.
//   node tests/fixture_kano.mjs                    replay and compare (serve the repository on BASE, default port 8765)
//   FIXTURE=record node tests/fixture_kano.mjs     re-record inputs and expected values (only after a deliberate change)
import { installFixtureFetch } from './fixture_fetch.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const DIR = fileURLToPath(new URL('./fixtures/kano-small/', import.meta.url)), MODE = process.env.FIXTURE || 'replay';
installFixtureFetch(DIR, MODE);
const { runAnalysis } = await import('../js/pipeline.js');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const b = [8.18, 12.18, 8.22, 12.22], ring = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]];
const r = await runAnalysis({ aoi: { type: 'Polygon', coordinates: [ring] }, season: { start: '08-01', end: '09-30' }, year: 2011, baseline: [2001, 2010],
  chirpsBase: `${BASE}/data/chirps/`, onProgress: () => {} });
const s = r.summary, h = a => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const got = { composites: r.meta.composites.length, pixelsAnalysed: s.pixelsAnalysed, ndvi: +s.target.ndvi.toFixed(6), regionalZ: +s.regionalZ.toFixed(6),
  baselineMean: +s.baseline.ndviMean.toFixed(6), rankBelow: s.target.rankBelow, rain: +s.climate.rain.toFixed(3), rainMean: +s.climate.rainMean.toFixed(3),
  zHash: h(r.z), anomHash: h(r.anom) };
const exp = `${DIR}/expected.json`;
if (MODE === 'record') { writeFileSync(exp, JSON.stringify(got, null, 1)); console.log('recorded', got); process.exit(0); }
const want = JSON.parse(readFileSync(exp, 'utf8')); let bad = 0;
for (const k of Object.keys(want)) { const ok = JSON.stringify(want[k]) === JSON.stringify(got[k]); if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${k}: ${JSON.stringify(got[k])}${ok ? '' : ` (expected ${JSON.stringify(want[k])})`}`); }
process.exit(bad ? 1 : 0);
