/* AgroSignal engine: pure functions, no network, no DOM. Used in the browser worker and in Node tests.
   Every rule is described in docs/methodology.md, with the same names. */

// MODIS sinusoidal grid (MOD13Q1, 250 m): 4800 x 4800 pixels per 10-degree tile, global origin at the top-left of tile h00v00
export const MODIS = Object.freeze({ pixel: 231.656358263958, x0: -20015109.354, y0: 10007554.677 });

export const DEFAULTS = Object.freeze({
  minSeasonShare: 0.5,       // a pixel's season mean needs valid NDVI in at least half of the season's composites
  minBaselineShare: 2 / 3,   // and valid season means in at least two thirds of the baseline years
  cropMin: 0.5,              // cropland mask: at least half of the pixel is WorldCover cropland (class 40)
});

/** Grid aligned to MODIS pixels covering a sinusoidal bbox [minx, miny, maxx, maxy]. */
export function modisGrid(bbox) {
  const p = MODIS.pixel;
  const c0 = Math.floor((bbox[0] - MODIS.x0) / p), c1 = Math.ceil((bbox[2] - MODIS.x0) / p);
  const r0 = Math.floor((MODIS.y0 - bbox[3]) / p), r1 = Math.ceil((MODIS.y0 - bbox[1]) / p);
  const w = c1 - c0, h = r1 - r0;
  return { crs: 'MODIS_SINU', res: p, x0: MODIS.x0 + c0 * p, y1: MODIS.y0 - r0 * p, w, h, n: w * h };
}

// ---------------------------------------------------------------- season windows
const pad = n => String(n).padStart(2, '0');
/** Season of a given year as UTC dates. startMD/endMD are 'MM-DD'. A season whose end comes before its start in the
    calendar (e.g. 11-01 to 03-31) runs into the next year and is labelled by the year it starts in. */
export function seasonWindow(year, startMD, endMD) {
  const start = new Date(`${year}-${startMD}T00:00:00Z`);
  const crosses = endMD < startMD;
  const end = new Date(`${year + (crosses ? 1 : 0)}-${endMD}T23:59:59Z`);
  return { year, start, end, crosses };
}
/** Day of year (1-366) of an ISO date 'YYYY-MM-DD'. */
export function dayOfYear(date) { return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.UTC(+date.slice(0, 4), 0, 1)) / 864e5) + 1; }
/** The season as a range of days of year, taken in a non-leap year so that it is the same for every year. MODIS composites
    start on fixed days of year (Terra 1, 17, ...; Aqua 9, 25, ...), so membership by day of year gives every season the same
    composite slots; by calendar date, leap years would gain or lose a composite at the season's edges. */
export function seasonDoys(startMD, endMD) {
  const s = dayOfYear(`2001-${startMD}`), e = dayOfYear(`2001-${endMD === '02-29' ? '02-28' : endMD}`);
  return { s, e, crosses: e < s };
}
/** Whether a composite starting on day of year `doy` lies wholly inside the season (its 16 days, or up to day 365 for the
    year's last composite, all within the season's day-of-year range). A composite that runs past either end is left out,
    so the NDVI period matches the season used for rainfall and temperature. */
export function compositeInSeason(doy, startMD, endMD) {
  const { s, e } = seasonDoys(startMD, endMD), last = Math.min(doy + 15, 365);
  const pos = d => (d - s + 365) % 365, len = pos(e);
  return pos(doy) <= len && pos(last) <= len && pos(last) >= pos(doy);
}
/** The season year a composite belongs to, by its start date's day of year, or null if it is not wholly inside a season.
    A season that crosses the new year is labelled by the year it starts in. */
export function seasonOf(date, startMD, endMD) {
  const { s } = seasonDoys(startMD, endMD), d = dayOfYear(date), y = +date.slice(0, 4);
  if (!compositeInSeason(d, startMD, endMD)) return null;
  return d >= s ? y : y - 1;
}
/** Number of composites per season: start days of year (1 + offset, + 16 ...) wholly inside the season. Terra offset 0,
    Aqua 8. The same for every year. */
export function expectedComposites(year, startMD, endMD, offset = 0) {
  let n = 0;
  for (let doy = 1 + offset; doy <= 365; doy += 16) if (compositeInSeason(doy, startMD, endMD)) n++;
  return n;
}

// ---------------------------------------------------------------- NDVI per composite and per season
/** NDVI from MOD13Q1 int16 (scale 1e-4) and pixel reliability: kept only where reliability is 0 (good) or 1 (marginal)
    and NDVI is in [-0.2, 1]; snow/ice (2), cloudy (3), no data (-1, 255) and out-of-range values become NaN. */
export function screenNdvi(ndviRaw, reliability) {
  const out = new Float32Array(ndviRaw.length);
  for (let i = 0; i < out.length; i++) {
    const v = ndviRaw[i], r = reliability[i];
    out[i] = (v === v && (r === 0 || r === 1) && v >= -2000 && v <= 10000) ? v * 1e-4 : NaN;
  }
  return out;
}
/** Season mean NDVI per pixel from that season's screened composites; NaN where fewer than minShare of `expected` are valid. */
export function seasonMean(composites, n, expected, minShare) {
  const sum = new Float64Array(n), cnt = new Uint16Array(n), out = new Float32Array(n);
  for (const c of composites) for (let i = 0; i < n; i++) { const v = c[i]; if (v === v) { sum[i] += v; cnt[i]++; } }
  const need = Math.ceil(expected * minShare);
  for (let i = 0; i < n; i++) out[i] = cnt[i] >= need && cnt[i] > 0 ? sum[i] / cnt[i] : NaN;
  return { mean: out, count: cnt };
}

// ---------------------------------------------------------------- baseline and anomalies
/** Per-pixel baseline statistics over the season means of the baseline years: mean, sample SD (n-1), min, max, n.
    Pixels with fewer than minYears valid years get NaN. */
export function baselineStats(seasonMeans, n, minYears) {
  const mean = new Float32Array(n), sd = new Float32Array(n), mn = new Float32Array(n), mx = new Float32Array(n), cnt = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, k = 0, lo = Infinity, hi = -Infinity;
    for (const a of seasonMeans) { const v = a[i]; if (v === v) { s += v; k++; if (v < lo) lo = v; if (v > hi) hi = v; } }
    cnt[i] = k;
    if (k < minYears || k < 2) { mean[i] = sd[i] = mn[i] = mx[i] = NaN; continue; }
    const m = s / k; let q = 0;
    for (const a of seasonMeans) { const v = a[i]; if (v === v) q += (v - m) ** 2; }
    mean[i] = m; sd[i] = Math.sqrt(q / (k - 1)); mn[i] = lo; mx[i] = hi;
  }
  return { mean, sd, min: mn, max: mx, n: cnt };
}
/** Anomaly (target - mean), standardised anomaly ((target - mean) / sd) and VCI = 100 (target - min) / (max - min)
    (Kogan, 1995), per pixel. VCI is NaN where max = min; it is not clipped, so values outside 0-100 mean the target season is
    outside the baseline range. */
export function anomalies(target, base, n) {
  const anom = new Float32Array(n), z = new Float32Array(n), vci = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = target[i], m = base.mean[i];
    if (!(t === t) || !(m === m)) { anom[i] = z[i] = vci[i] = NaN; continue; }
    anom[i] = t - m;
    z[i] = base.sd[i] > 0 ? (t - m) / base.sd[i] : NaN;
    const r = base.max[i] - base.min[i];
    vci[i] = r > 0 ? 100 * (t - base.min[i]) / r : NaN;
  }
  return { anom, z, vci };
}

// ---------------------------------------------------------------- regional summaries
/** Mean of a per-pixel array over the mask (Uint8, 1 = included) where values are finite. */
export function maskedMean(a, mask) {
  let s = 0, k = 0;
  for (let i = 0; i < a.length; i++) if (mask[i] && a[i] === a[i]) { s += a[i]; k++; }
  return { mean: k ? s / k : NaN, n: k };
}
/** Share of masked pixels with a valid z in each class: below -1.5, -1.5 to -0.5, -0.5 to 0.5, 0.5 to 1.5, above 1.5 SD. */
export function zClasses(z, mask) {
  const edges = [-1.5, -0.5, 0.5, 1.5], cnt = [0, 0, 0, 0, 0]; let k = 0;
  for (let i = 0; i < z.length; i++) {
    const v = z[i]; if (!mask[i] || !(v === v)) continue;
    k++; let c = 0; while (c < 4 && v >= edges[c]) c++; cnt[c]++;
  }
  return { n: k, share: cnt.map(c => (k ? c / k : NaN)), labels: ['much below (< −1.5 SD)', 'below', 'near normal (±0.5 SD)', 'above', 'much above (> 1.5 SD)'] };
}
/** Linear-percentile of a numeric array (type 7, as numpy's default). */
export function percentile(arr, p) {
  const a = arr.filter(v => v === v).sort((x, y) => x - y); if (!a.length) return NaN;
  const h = (a.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return a[lo] + (h - lo) * (a[hi] - a[lo]);
}
/** Sample mean and SD of the finite values. */
export function meanSd(arr) {
  const a = arr.filter(v => v === v), n = a.length; if (n < 2) return { mean: n ? a[0] : NaN, sd: NaN, n };
  const m = a.reduce((s, v) => s + v, 0) / n; return { mean: m, sd: Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)), n };
}
/** Pearson correlation of two equal-length series, over pairs where both are finite. */
export function pearson(x, y) {
  const p = x.map((v, i) => [v, y[i]]).filter(([a, b]) => a === a && b === b), n = p.length; if (n < 3) return { r: NaN, n };
  const mx = p.reduce((s, q) => s + q[0], 0) / n, my = p.reduce((s, q) => s + q[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

// ---------------------------------------------------------------- climate (NASA POWER daily)
/** Point-in-polygon (even-odd rule) for a lon/lat ring. */
export function pointInRing(x, y, ring) {
  let c = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------- climate
/** Calendar months a season touches, in order, as [year, month] pairs (month 1-12). */
export function seasonMonths(year, startMD, endMD) {
  const w = seasonWindow(year, startMD, endMD), out = [];
  let y = w.start.getUTCFullYear(), m = w.start.getUTCMonth() + 1;
  const ye = w.end.getUTCFullYear(), me = w.end.getUTCMonth() + 1;
  while (y < ye || (y === ye && m <= me)) { out.push([y, m]); if (++m > 12) { m = 1; y++; } }
  return out;
}
/** Cells of a regular lon/lat grid g = {x0, y1, res, w, h} used for an area's rainfall: every cell whose centre lies in the
    ring, weighted by cos(latitude) (cell area on the sphere). If no centre lies inside (areas smaller than a cell), the one
    cell containing the centre of the ring's bounding box. Returns the pixel window [c0, r0, c1, r1) and, for each cell,
    its index in that window and its weight. */
export function rainCells(ring, g) {
  const lons = ring.map(p => p[0]), lats = ring.map(p => p[1]);
  const c0 = Math.max(0, Math.floor((Math.min(...lons) - g.x0) / g.res)), c1 = Math.min(g.w, Math.floor((Math.max(...lons) - g.x0) / g.res) + 1);
  const r0 = Math.max(0, Math.floor((g.y1 - Math.max(...lats)) / g.res)), r1 = Math.min(g.h, Math.floor((g.y1 - Math.min(...lats)) / g.res) + 1);
  if (c1 <= c0 || r1 <= r0) return null;
  const ww = c1 - c0, cells = [];
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
    const x = g.x0 + (c + 0.5) * g.res, y = g.y1 - (r + 0.5) * g.res;
    if (pointInRing(x, y, ring)) cells.push({ i: (r - r0) * ww + (c - c0), w: Math.cos(y * Math.PI / 180), lon: x, lat: y });
  }
  if (cells.length) return { win: [c0, r0, c1, r1], cells, fallback: false };
  const cx = (Math.min(...lons) + Math.max(...lons)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2;
  const c = Math.floor((cx - g.x0) / g.res), r = Math.floor((g.y1 - cy) / g.res);
  if (c < 0 || c >= g.w || r < 0 || r >= g.h) return null;
  const y = g.y1 - (r + 0.5) * g.res;
  return { win: [c, r, c + 1, r + 1], cells: [{ i: 0, w: 1, lon: g.x0 + (c + 0.5) * g.res, lat: y }], fallback: true };
}
/** Weighted mean of one stored month over the cells, in mm. NaN when cells holding less than half of the weight have data. */
export function cellMean(band, cells, scale, nodata) {
  let s = 0, wv = 0, wt = 0;
  for (const q of cells) { wt += q.w; const v = band[q.i]; if (v !== nodata) { s += v * scale * q.w; wv += q.w; } }
  return wv >= wt / 2 ? s / wv : NaN;
}
/** Season rainfall total: the sum of monthly area means over the season's months; NaN if any month is missing. */
export function rainSeason(monthly, months) {
  let s = 0;
  for (const [y, m] of months) { const v = monthly.get(`${y}-${m}`); if (!(v === v) || v === undefined) return NaN; s += v; }
  return s;
}
/** Season mean of NASA POWER daily 2 m temperature; NaN if any day is missing. */
export function tempSeason(rec, year, startMD, endMD) {
  const w = seasonWindow(year, startMD, endMD);
  const key = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  let t = 0, days = 0, missing = 0;
  for (let d = new Date(w.start); d <= w.end; d = new Date(d.getTime() + 864e5)) {
    const i = rec.index.get(key(d));
    if (i === undefined || rec.t2m[i] === -999) { missing++; continue; }
    t += rec.t2m[i]; days++;
  }
  return { t2m: missing ? NaN : t / days, days, missing };
}
export function indexPower(json) {
  const P = json.properties.parameter, dates = Object.keys(P.T2M).sort();
  return { dates, t2m: dates.map(d => P.T2M[d]), index: new Map(dates.map((d, i) => [d, i])) };
}

/** Area of a lon/lat ring in km^2 on a sphere of mean Earth radius. */
export function ringAreaKm2(ring) {
  const R = 6371.0088, rad = Math.PI / 180; let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n]; s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); }
  return Math.abs(s * R * R / 2);
}
