// Cropland fraction on the MODIS grid (browser reader) against the Python reference (each 10 m WorldCover pixel assigned to
// the MODIS cell containing its centre). Usage: node tests/crop_check.mjs REFERENCE.json BROWSER.json
import fs from 'fs';
import { stacSearch, signedHref, readMosaic } from '../js/io.js';
const py = JSON.parse(fs.readFileSync(process.argv[2])), js = JSON.parse(fs.readFileSync(process.argv[3]));
const grid = { ...js.grid, n: js.grid.w * js.grid.h };
const wc = await stacSearch({ collections: ['esa-worldcover'], bbox: [8, 12, 8.4, 12.4], datetime: '2021-01-01/2021-12-31' }, { maxItems: 60 });
const crop = await readMosaic(await Promise.all(wc.map(it => signedHref(it.assets.map.href, 'esa-worldcover'))), grid, { method: 'average', transform: v => (v === 40 ? 1 : 0) });
let n = 0, max = 0, sum = 0, flips = 0, maxI = -1;
for (let i = 0; i < grid.n; i++) {
  const a = crop[i], b = py.crop[i]; if (!(a === a) || b == null) continue;
  const d = Math.abs(a - b); n++; sum += d; if (d > max) { max = d; maxI = i; } if ((a >= 0.5) !== (b >= 0.5)) flips++;
}
console.log('pixels', n, 'mean abs diff', (sum / n).toFixed(5), 'max abs diff', max.toFixed(4), 'at', maxI, 'pixels on opposite sides of 0.5:', flips);
