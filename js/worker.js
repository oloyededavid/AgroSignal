/* AgroSignal Web Worker: runs the analysis and keeps the arrays of the current run for exports. */
import { runAnalysis } from './pipeline.js';
import { sinusoidalGeoTiff, yearsCsv, pixelsCsv } from './exports.js';
import { project, MODIS_SINU } from './io.js';

let run = null, controller = null;
const send = (type, data) => self.postMessage({ type, ...data });

self.onmessage = async ({ data: m }) => {
  try {
    if (m.cmd === 'run') {
      if (controller) controller.abort();
      controller = new AbortController(); run = null;
      run = await runAnalysis({ ...m.args, signal: controller.signal, onProgress: msg => send('progress', { id: m.id, msg }) });
      const { grid, inside, mask, fixed, crop, target, base, anom, z, vci, summary, regional, curve, climate, meta } = run;
      send('result', { id: m.id, grid, inside, mask, fixed, crop, target, baseMean: base.mean, anom, z, vci, summary, regional, curve, climate, meta });
    } else if (m.cmd === 'cancel') {
      if (controller) controller.abort();
    } else if (m.cmd === 'export') {
      if (!run) throw new Error('No analysis to export');
      let blob;
      if (m.kind === 'geotiff') blob = new Blob([sinusoidalGeoTiff([run.target, run.base.mean, run.base.sd, run.anom, run.z, run.vci, run.crop],
        run.grid, ['ndvi_target', 'ndvi_baseline_mean', 'ndvi_baseline_sd', 'anomaly', 'z', 'vci', 'cropland_fraction'])], { type: 'image/tiff' });
      else if (m.kind === 'years') blob = new Blob([yearsCsv(run)], { type: 'text/csv' });
      else if (m.kind === 'pixels') {
        const g = run.grid, pts = [];
        for (let i = 0; i < g.n; i++) { const c = i % g.w, r = (i - c) / g.w; pts.push([g.x0 + (c + 0.5) * g.res, g.y1 - (r + 0.5) * g.res]); }
        blob = new Blob([pixelsCsv(run, project(MODIS_SINU, 'EPSG:4326', pts))], { type: 'text/csv' });
      } else if (m.kind === 'json') {
        const { summary, regional, curve, climate, meta } = run;
        blob = new Blob([JSON.stringify({ summary, regional, curve, climate, meta }, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 1)], { type: 'application/json' });
      }
      send('export', { id: m.id, blob });
    }
  } catch (e) {
    send('error', { id: m.id, message: e.name === 'AbortError' ? 'Cancelled' : (e.message || String(e)) });
  }
};
