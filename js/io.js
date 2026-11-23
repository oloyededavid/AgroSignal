/* AgroSignal data access (adapted from FloodScope): STAC search on Microsoft Planetary Computer, SAS signing, and reading Cloud Optimised
   GeoTIFF windows onto the analysis grid. Works in a browser worker and in Node 18+ (global fetch). */
import { fromUrl, proj4 } from '../vendor/geo-libs.mjs';

export const PC = 'https://planetarycomputer.microsoft.com/api';

// ---------------------------------------------------------------- CRS
// MODIS land products use a sinusoidal projection on a sphere of radius 6371007.181 m (no EPSG code)
export const MODIS_SINU = 'MODIS_SINU';
proj4.defs(MODIS_SINU, '+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs');
export function defineEpsg(code) {
  if (code === MODIS_SINU) return MODIS_SINU;
  const name = `EPSG:${code}`;
  if (code === 4326 || proj4.defs(name)) return name;
  if (code > 32600 && code < 32661) proj4.defs(name, `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`);
  else if (code > 32700 && code < 32761) proj4.defs(name, `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`);
  else throw new Error(`Unsupported CRS EPSG:${code}`);
  return name;
}
export const project = (from, to, pts) => {
  if (from === to) return pts.map(p => p.slice());
  const t = proj4(from, to); return pts.map(p => t.forward(p));
};

// ---------------------------------------------------------------- STAC
export async function stacSearch(body, { signal, maxItems = 500 } = {}) {
  const items = [];
  let req = { url: `${PC}/stac/v1/search`, body: { limit: 100, ...body } };
  while (req && items.length < maxItems) {
    const r = await fetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal });
    if (!r.ok) throw new Error(`STAC search failed (${r.status})`);
    const j = await r.json();
    items.push(...j.features);
    const next = (j.links || []).find(l => l.rel === 'next');
    req = next && next.body ? { url: next.href, body: next.body } : null;
  }
  return items;
}

const tokens = new Map();
/** Short-lived read token for a Planetary Computer blob container (no account needed), requested per storage account and
    container as the official planetary-computer client does; cached until 5 minutes before expiry. `collection` is kept
    as a fallback for hrefs that are not Azure blob URLs. */
export async function signedHref(href, collection, signal) {
  const m = href.match(/^https:\/\/([^.]+)\.blob\.core\.windows\.net\/([^/]+)\//);
  const key = m ? `${m[1]}/${m[2]}` : collection;
  let t = tokens.get(key);
  if (!t || Date.parse(t.expiry) - Date.now() < 5 * 60e3) {
    const r = await fetch(`${PC}/sas/v1/token/${key}`, { signal });
    if (!r.ok) throw new Error(`Could not get a read token for ${key} (${r.status})`);
    const j = await r.json(); t = { token: j.token, expiry: j['msft:expiry'] }; tokens.set(key, t);
  }
  return `${href}${href.includes('?') ? '&' : '?'}${t.token}`;
}

// ---------------------------------------------------------------- COG reading
const tiffCache = new Map();
async function openTiff(url) {
  // keyed by the full URL: a new read token gives a new key, so an expired token is never reused
  let p = tiffCache.get(url);
  if (!p) { p = fromUrl(url, { allowFullFile: false, cacheSize: 200 }); tiffCache.set(url, p); if (tiffCache.size > 60) tiffCache.delete(tiffCache.keys().next().value); }
  return p;
}
export function clearCache() { tiffCache.clear(); }

function imageEpsg(img, override) {
  if (override) return override;
  const g = img.getGeoKeys() || {};
  const c = g.ProjectedCSTypeGeoKey || g.GeographicTypeGeoKey;
  if (!c || c === 32767) throw new Error('GeoTIFF without an EPSG code');
  return c;
}

/** Read one band of a COG onto the grid.
    grid: from engine.makeGrid (projected CRS, metres). method: 'nearest' | 'bilinear' | 'average' (mean of source pixels inside each grid pixel). transform: optional function applied to each source value before resampling (e.g. class -> 0/1 indicator for a cover fraction). srcCrs: CRS name when the file has no EPSG code.
    Returns Float32Array (grid.n), NaN outside the file or at no-data. Coordinates of grid pixel centres are transformed
    to the file's CRS on a lattice every `step` pixels and interpolated in between (error well under one source pixel). */
export async function readToGrid(url, grid, { method = 'nearest', band = 0, into = null, step = 16, signal, fullRes = false, bandRows = 0, srcCrs: srcOverride = null, transform = null } = {}) {
  const out = into || new Float32Array(grid.n).fill(NaN);
  // 'average' reads the native resolution; large grids are processed in bands of rows to keep memory small
  if (method === 'average' && !bandRows) {
    const rows = Math.max(16, Math.floor(4e6 / Math.max(1, grid.w * (grid.res / 10) ** 2)));
    if (rows < grid.h) {
      for (let r0 = 0; r0 < grid.h; r0 += rows) {
        const h = Math.min(rows, grid.h - r0), sub = { ...grid, y1: grid.y1 - r0 * grid.res, h, n: grid.w * h };
        const part = await readToGrid(url, sub, { method, band, step, signal, bandRows: h, srcCrs: srcOverride, transform });
        out.set(part, r0 * grid.w);
      }
      return out;
    }
  }
  const tiff = await openTiff(url);
  const img0 = await tiff.getImage(0);
  const srcCrs = defineEpsg(imageEpsg(img0, srcOverride)), gridCrs = defineEpsg(grid.crs);
  const [rx0, ry0] = img0.getResolution(), W0 = img0.getWidth(), H0 = img0.getHeight();
  let [ox, oy] = img0.getOrigin();
  // GTRasterTypeGeoKey 2 = PixelIsPoint (e.g. Copernicus DEM): the tie point is a pixel centre, so move it to the corner,
  // as GDAL does by default
  if ((img0.getGeoKeys() || {}).GTRasterTypeGeoKey === 2) { ox -= rx0 / 2; oy -= ry0 / 2; }
  const nodata = img0.getGDALNoData();

  // source coordinates of grid pixel centres, on a lattice
  const lw = Math.ceil(grid.w / step) + 1, lh = Math.ceil(grid.h / step) + 1, lat = [];
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    const x = grid.x0 + (Math.min(i * step, grid.w - 1) + 0.5) * grid.res, y = grid.y1 - (Math.min(j * step, grid.h - 1) + 0.5) * grid.res;
    lat.push([x, y]);
  }
  const src = project(gridCrs, srcCrs, lat);
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const [x, y] of src) { if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; }
  // full-resolution pixel window, padded; stop if it misses the file
  // 'average' samples up to half a grid pixel beyond the pixel centres, so its window is padded by one grid pixel more
  const pad = 2 + (method === 'average' ? Math.ceil((srcCrs === 'EPSG:4326' ? grid.res / 100000 : grid.res) / Math.min(Math.abs(rx0), Math.abs(ry0))) : 0);
  const fx0 = Math.floor((sx0 - ox) / rx0) - pad, fx1 = Math.ceil((sx1 - ox) / rx0) + pad;
  const fy0 = Math.floor((sy1 - oy) / ry0) - pad, fy1 = Math.ceil((sy0 - oy) / ry0) + pad; // ry0 < 0
  if (fx1 < 0 || fy1 < 0 || fx0 >= W0 || fy0 >= H0) return out;

  // choose the coarsest overview that is still at least as fine as the grid
  const srcIsGeo = srcCrs === 'EPSG:4326';
  const midLat = (sy0 + sy1) / 2;
  const gridResInSrc = srcIsGeo ? grid.res / (111320 * Math.cos(midLat * Math.PI / 180)) : grid.res;
  let level = 0, scale = 1;
  const nImg = await tiff.getImageCount();
  for (let k = 1; k < nImg; k++) {
    const im = await tiff.getImage(k), s = W0 / im.getWidth();
    // 'average' keeps at least 2 x 2 source pixels per grid pixel so the mean is computed here, not inherited from an overview
    // 'average' always uses the full-resolution image: provider overviews use their own (unstated) resampling
    const limit = method === 'average' ? Math.abs(rx0) * 0.999 : gridResInSrc;
    if (!fullRes && Math.abs(rx0) * s <= limit * 1.0001) { level = k; scale = s; }
  }
  const img = level ? await tiff.getImage(level) : img0;
  const Wl = img.getWidth(), Hl = img.getHeight(), rx = rx0 * scale, ry = ry0 * scale;
  const wx0 = Math.max(0, Math.floor(fx0 / scale)), wx1 = Math.min(Wl, Math.ceil(fx1 / scale));
  const wy0 = Math.max(0, Math.floor(fy0 / scale)), wy1 = Math.min(Hl, Math.ceil(fy1 / scale));
  if (wx1 <= wx0 || wy1 <= wy0) return out;
  const ras = await img.readRasters({ window: [wx0, wy0, wx1, wy1], samples: [band], interleave: false, signal });
  const data = ras[0], ww = wx1 - wx0, wh = wy1 - wy0;
  const val = (c, r) => {
    if (c < 0 || r < 0 || c >= ww || r >= wh) return NaN;
    const v = data[r * ww + c];
    if (v === nodata || !(v === v)) return NaN;
    return transform ? transform(v) : v;
  };

  // lattice node k sits at pixel min(k * step, size - 1); interpolate between the two nodes around each pixel
  const frac = (p, size, nNodes) => {
    const k = Math.max(0, Math.min(Math.floor(p / step), nNodes - 2));   // p may be fractional (sub-samples); t extrapolates at the edges
    const a = Math.min(k * step, size - 1), b = Math.min((k + 1) * step, size - 1);
    return [k, b > a ? (p - a) / (b - a) : 0];
  };
  for (let y = 0; y < grid.h; y++) {
    const [ly, ty] = frac(y, grid.h, lh);
    for (let x = 0; x < grid.w; x++) {
      const [lx, tx] = frac(x, grid.w, lw);
      const a = src[ly * lw + lx], b = src[ly * lw + lx + 1], c = src[(ly + 1) * lw + lx], d = src[(ly + 1) * lw + lx + 1];
      const X = (1 - ty) * ((1 - tx) * a[0] + tx * b[0]) + ty * ((1 - tx) * c[0] + tx * d[0]);
      const Y = (1 - ty) * ((1 - tx) * a[1] + tx * b[1]) + ty * ((1 - tx) * c[1] + tx * d[1]);
      const fc = (X - ox) / rx - wx0, fr = (Y - oy) / ry - wy0; // continuous pixel coordinates in the window
      let v;
      if (method === 'average') {
        // mean over k x k sub-samples spread evenly inside the grid pixel, each projected to the source through the lattice
        // and taking the source pixel under it (NaN skipped). Sampling inside the grid pixel itself keeps its true shape in
        // the source CRS (a sinusoidal pixel is a sheared quadrilateral in lon/lat). k matches the source pixels per edge.
        const spanX = gridResInSrc / Math.abs(rx), spanY = (srcIsGeo ? grid.res / 110574 : grid.res) / Math.abs(ry);
        const kx = Math.max(1, Math.round(spanX)), ky = Math.max(1, Math.round(spanY));
        let s = 0, n = 0;
        for (let j = 0; j < ky; j++) {
          const yp = y + (j + 0.5) / ky - 0.5, [my, uy] = frac(yp, grid.h, lh);
          for (let i = 0; i < kx; i++) {
            const xp = x + (i + 0.5) / kx - 0.5, [mx, ux] = frac(xp, grid.w, lw);
            const a2 = src[my * lw + mx], b2 = src[my * lw + mx + 1], c2 = src[(my + 1) * lw + mx], d2 = src[(my + 1) * lw + mx + 1];
            const SX = (1 - uy) * ((1 - ux) * a2[0] + ux * b2[0]) + uy * ((1 - ux) * c2[0] + ux * d2[0]);
            const SY = (1 - uy) * ((1 - ux) * a2[1] + ux * b2[1]) + uy * ((1 - ux) * c2[1] + ux * d2[1]);
            const q = val(Math.floor((SX - ox) / rx - wx0), Math.floor((SY - oy) / ry - wy0));
            if (q === q) { s += q; n++; }
          }
        }
        v = n ? s / n : NaN;
      } else if (method === 'bilinear') {
        const c0 = Math.floor(fc - 0.5), r0 = Math.floor(fr - 0.5), u = fc - 0.5 - c0, t = fr - 0.5 - r0;
        const v00 = val(c0, r0), v10 = val(c0 + 1, r0), v01 = val(c0, r0 + 1), v11 = val(c0 + 1, r0 + 1);
        v = (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11)
          ? (1 - t) * ((1 - u) * v00 + u * v10) + t * ((1 - u) * v01 + u * v11)
          : val(Math.floor(fc), Math.floor(fr));
      } else v = val(Math.floor(fc), Math.floor(fr));
      if (v === v) out[y * grid.w + x] = v;
    }
  }
  return out;
}

/** Read several tiles (e.g. 1-degree DEM tiles) into one grid; later tiles only fill pixels still NaN. */
export async function readMosaic(urls, grid, opts = {}) {
  let out = new Float32Array(grid.n).fill(NaN);
  for (const u of urls) {
    const part = await readToGrid(u, grid, opts);
    for (let i = 0; i < out.length; i++) if (!(out[i] === out[i]) && part[i] === part[i]) out[i] = part[i];
  }
  return out;
}

/** All bands of a pixel window [col0, row0, col1, row1) of a (small, local) GeoTIFF, as one typed array per band. */
export async function readWindow(url, win, signal) {
  const img = await (await openTiff(url)).getImage();
  return img.readRasters({ window: win, interleave: false, signal });
}
