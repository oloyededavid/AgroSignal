/* AgroSignal analysis: MODIS NDVI season anomalies against a baseline, with cropland mask and NASA POWER climate context.
   Runs in a Web Worker in the browser and in Node for tests. Progress messages report steps actually done. */
import { stacSearch, signedHref, readMosaic, readWindow, project, clearCache, MODIS_SINU } from './io.js';
import { DEFAULTS, modisGrid, seasonOf, expectedComposites, screenNdvi, seasonMean, baselineStats, anomalies, maskedMean,
         zClasses, meanSd, pearson, percentile, tempSeason, indexPower, ringAreaKm2, seasonWindow,
         seasonMonths, rainCells, cellMean, rainSeason } from './engine.js';

import { VERSION } from './version.js';
export { VERSION };
export const MAX_KM2 = 2500;
const COLL = 'modis-13Q1-061', MAX_ITEMS = 8000;
// Terra (MOD13Q1) is the default; Aqua (MYD13Q1) is available as an independent check (its composites start 8 days later)
const SENSORS = { terra: { prefix: 'MOD13Q1.', offset: 0, name: 'Terra (MOD13Q1)' }, aqua: { prefix: 'MYD13Q1.', offset: 8, name: 'Aqua (MYD13Q1)' } };

/** Run up to `limit` async jobs at once, keeping order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Retry an async read up to `tries` times with growing waits (network errors and throttling happen over hundreds of reads). */
async function retry(fn, tries = 4, signal) {
  for (let k = 0; ; k++) {
    try { return await fn(k); }
    catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted) || k + 1 >= tries) throw e;
      clearCache();
      await new Promise(r => setTimeout(r, 1000 * 2 ** k));
    }
  }
}

/** opts: { aoi (GeoJSON Polygon, lon/lat), season: {start:'MM-DD', end:'MM-DD'}, year, baseline: [y0, y1], cropOnly, params,
    label, onProgress, signal, chirpsBase (folder of the hosted CHIRPS archive) } */
export async function runAnalysis({ aoi, season, year, baseline, cropOnly = true, params = {}, label = null, onProgress = () => {}, signal, sensor = 'terra',
                                   chirpsBase = new URL('../data/chirps/', import.meta.url).href }) {
  const p = { ...DEFAULTS, ...params }, t0 = Date.now(), log = [], SEN = SENSORS[sensor];
  if (!SEN) throw new Error(`Unknown sensor ${sensor}`);
  const step = m => { log.push({ t: (Date.now() - t0) / 1000, msg: m }); onProgress(m); };
  const ring = aoi.coordinates[0], area = ringAreaKm2(ring);
  if (area > MAX_KM2) throw new Error(`The area is ${area.toFixed(0)} km²; the limit is ${MAX_KM2.toLocaleString('en-GB')} km²`);
  const [b0, b1] = baseline;
  if (sensor === 'aqua' && b0 < 2003) throw new Error('Aqua seasons start in 2003');
  if (!(b0 >= 2001 && b1 >= b0 && b1 - b0 >= 9)) throw new Error('The baseline must start in 2001 or later and span at least 10 seasons');
  if (year >= b0 && year <= b1) throw new Error('The target season must lie outside the baseline period');
  const win = seasonWindow(year, season.start, season.end);
  if (win.end > new Date()) throw new Error(`The ${year} season (to ${win.end.toISOString().slice(0, 10)}) has not finished yet`);
  const lastBase = seasonWindow(b1, season.start, season.end);
  if (lastBase.end > new Date()) throw new Error(`The last baseline season (${b1}, to ${lastBase.end.toISOString().slice(0, 10)}) has not finished yet`);

  // grid on the MODIS sinusoidal pixels, from densely sampled edges of the lon/lat ring
  const dense = [];
  for (let i = 0; i + 1 < ring.length; i++) for (let k = 0; k < 20; k++) {
    const t = k / 20; dense.push([ring[i][0] + t * (ring[i + 1][0] - ring[i][0]), ring[i][1] + t * (ring[i + 1][1] - ring[i][1])]);
  }
  const sx = project('EPSG:4326', MODIS_SINU, dense);
  const grid = modisGrid([Math.min(...sx.map(q => q[0])), Math.min(...sx.map(q => q[1])), Math.max(...sx.map(q => q[0])), Math.max(...sx.map(q => q[1]))]);
  // pixels whose centre lies inside the lon/lat ring
  const centres = []; for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) centres.push([grid.x0 + (x + 0.5) * grid.res, grid.y1 - (y + 0.5) * grid.res]);
  const ll = project(MODIS_SINU, 'EPSG:4326', centres);
  const lons = ring.map(c => c[0]), lats = ring.map(c => c[1]);
  const inside = new Uint8Array(grid.n);
  for (let i = 0; i < grid.n; i++) { const [x, y] = ll[i]; let c = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a], [xb, yb] = ring[b]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c; }
    inside[i] = c ? 1 : 0; }
  step(`MODIS grid: ${grid.w} × ${grid.h} pixels of 231.7 m (sinusoidal), ${inside.reduce((s, v) => s + v, 0).toLocaleString('en-GB')} inside the area`);

  // composites (Terra MOD13Q1 only, one per 16 days)
  const bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  step('Searching the MODIS MOD13Q1 archive');
  const first = new Date(Math.min(seasonWindow(b0, season.start, season.end).start, win.start)), last = new Date(Math.max(lastBase.end, win.end));
  // two days' margin: membership is decided by day of year below, and in leap years a slot falls one calendar day earlier
  const pad2 = 2 * 864e5;
  const items = (await stacSearch({ collections: [COLL], bbox, datetime: `${new Date(first - pad2).toISOString()}/${new Date(+last + pad2).toISOString()}` }, { signal, maxItems: MAX_ITEMS }))
    .filter(it => it.id.startsWith(SEN.prefix));
  if (!items.length) throw new Error('The archive has no MODIS composites for this area. MOD13Q1 is a land product, so open sea has none');
  if (items.length >= MAX_ITEMS) step(`The archive search stopped at ${MAX_ITEMS} items; some seasons may be missing (see the missing years)`);
  const byDate = new Map();
  for (const it of items) {
    const d = it.properties.start_datetime.slice(0, 10), sy = seasonOf(d, season.start, season.end);
    if (sy === null || !((sy >= b0 && sy <= b1) || sy === year)) continue;
    if (!byDate.has(d)) byDate.set(d, { date: d, seasonYear: sy, items: [] });
    byDate.get(d).items.push(it);
  }
  const comps = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const years = [...new Set(comps.map(c => c.seasonYear))].sort((a, b) => a - b);
  const expected = Object.fromEntries([...years, year].map(y => [y, expectedComposites(y, season.start, season.end, SEN.offset)]));
  const missingYears = []; for (let y = b0; y <= b1; y++) if (!years.includes(y)) missingYears.push(y);
  const nTarget = comps.filter(c => c.seasonYear === year).length;
  if (nTarget < Math.ceil(expected[year] * p.minSeasonShare))
    throw new Error(`Only ${nTarget} of the ${expected[year]} MODIS composites for the ${year} season are in the archive; at least ${Math.ceil(expected[year] * p.minSeasonShare)} are needed. The archive has a gap for this season here: choose another year`);
  step(`${comps.length} ${SEN.name} composites: ${years.length - 1} baseline seasons and the ${year} season (${expected[year]} composites per season)`);

  // read NDVI and reliability for every composite
  let done = 0;
  let retries = 0;
  const screened = await pool(comps, 4, async c => {
    const [nd, rl] = await retry(async k => {
      if (k) retries++;
      const ndviUrls = await Promise.all(c.items.map(it => signedHref(it.assets['250m_16_days_NDVI'].href, COLL, signal)));
      const relUrls = await Promise.all(c.items.map(it => signedHref(it.assets['250m_16_days_pixel_reliability'].href, COLL, signal)));
      return [await readMosaic(ndviUrls, grid, { method: 'nearest', srcCrs: MODIS_SINU, signal }),
              await readMosaic(relUrls, grid, { method: 'nearest', srcCrs: MODIS_SINU, signal })];
    }, 4, signal);
    const s = screenNdvi(nd, rl);
    for (let i = 0; i < grid.n; i++) if (!inside[i]) s[i] = NaN;
    if (++done % 10 === 0 || done === comps.length) step(`Read ${done} of ${comps.length} composites`);
    return s;
  });

  // season means per year
  const seasonByYear = {};
  for (const y of years) {
    const idx = comps.map((c, i) => c.seasonYear === y ? i : -1).filter(i => i >= 0);
    seasonByYear[y] = seasonMean(idx.map(i => screened[i]), grid.n, expected[y], p.minSeasonShare);
  }
  const baseYears = years.filter(y => y >= b0 && y <= b1);
  const minYears = Math.ceil((b1 - b0 + 1) * p.minBaselineShare);
  const base = baselineStats(baseYears.map(y => seasonByYear[y].mean), grid.n, minYears);
  const target = seasonByYear[year].mean;
  const an = anomalies(target, base, grid.n);
  if (retries) step(`${retries} reads were retried after a network error`);
  step(`Baseline ${b0}–${b1}: pixels need ${minYears} of ${b1 - b0 + 1} seasons, each with at least ${Math.round(p.minSeasonShare * 100)}% of composites valid`);

  // cropland fraction from ESA WorldCover 2021 (class 40), averaged into each MODIS pixel
  step('Reading ESA WorldCover 2021 cropland');
  const wc = await stacSearch({ collections: ['esa-worldcover'], bbox, datetime: '2021-01-01/2021-12-31' }, { signal, maxItems: 60 });
  const crop = await retry(async () => readMosaic(await Promise.all(wc.map(it => signedHref(it.assets.map.href, 'esa-worldcover', signal))), grid,
    { method: 'average', transform: v => (v === 40 ? 1 : 0), signal }), 4, signal);
  const mask = new Uint8Array(grid.n);
  for (let i = 0; i < grid.n; i++) mask[i] = inside[i] && (!cropOnly || crop[i] >= p.cropMin) ? 1 : 0;
  const nMask = mask.reduce((s, v) => s + v, 0);
  if (!nMask) throw new Error(cropOnly ? 'No pixels in this area are at least half cropland (ESA WorldCover); switch to all land' : 'No pixels inside the area');

  // regional numbers over a fixed set of pixels: in the mask and valid in the target and the baseline
  const fixed = new Uint8Array(grid.n);
  for (let i = 0; i < grid.n; i++) fixed[i] = mask[i] && target[i] === target[i] && base.mean[i] === base.mean[i] ? 1 : 0;
  const nFixed = fixed.reduce((s, v) => s + v, 0);
  if (!nFixed) throw new Error(`No pixel has valid NDVI in both the ${year} season and the baseline (cloud or missing composites)`);
  const regional = years.map(y => { const m = maskedMean(seasonByYear[y].mean, fixed); return { year: y, ndvi: m.mean, pixels: m.n, baseline: y >= b0 && y <= b1 }; });
  const baseSeries = regional.filter(r => r.baseline).map(r => r.ndvi), bs = meanSd(baseSeries);
  const tgt = regional.find(r => r.year === year);
  const rank = baseSeries.filter(v => v < tgt.ndvi).length;

  // within-season curve: regional mean per composite slot. MODIS composites start on fixed days of year (1, 17, ...; Aqua 9,
  // 25, ...), so a slot is a day of year; in leap years the same slot falls one calendar day earlier. Slots are ordered from the
  // season start and labelled with the date of that day in a non-leap year.
  const doyOf = d => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.UTC(+d.slice(0, 4), 0, 1)) / 864e5) + 1;
  const startDoy = doyOf(`2001-${season.start}`);
  const slots = [...new Set(comps.map(c => doyOf(c.date)))].sort((a, b) => ((a - startDoy + 366) % 366) - ((b - startDoy + 366) % 366));
  const curve = slots.map(doy => {
    const vals = comps.filter(c => doyOf(c.date) === doy).map(c => ({ y: c.seasonYear, v: maskedMean(screened[comps.indexOf(c)], fixed).mean }));
    const bv = vals.filter(q => q.y >= b0 && q.y <= b1).map(q => q.v), tv = vals.find(q => q.y === year);
    return { doy, slot: new Date(Date.UTC(2001, 0, doy)).toISOString().slice(5, 10), target: tv ? tv.v : NaN, baselineMean: meanSd(bv).mean,
             p10: percentile(bv, 0.1), p90: percentile(bv, 0.9), n: bv.filter(v => v === v).length };
  }).filter(c => c.target === c.target || c.n >= baseYears.length / 2);   // drop slots that the target lacks and most baseline years lack

  // rainfall: hosted CHIRPS v3.0 monthly archive at 0.2 degrees (pipeline/build_chirps.py), area mean over the season's months
  step('Reading CHIRPS monthly rainfall');
  const monthsOf = Object.fromEntries(years.map(y => [y, seasonMonths(y, season.start, season.end)]));
  const monthly = new Map();
  let rainNote = null, cells = null, cidx = null;
  try {
    cidx = await retry(() => fetch(new URL('index.json', chirpsBase)).then(r => { if (!r.ok) throw new Error(`CHIRPS index not found (${r.status})`); return r.json(); }), 3, signal);
    cells = rainCells(ring, cidx.grid);
    const calYears = [...new Set(Object.values(monthsOf).flat().map(q => q[0]))];
    if (!cells) rainNote = 'The area lies outside CHIRPS coverage (60° S to 60° N)';
    else await pool(calYears.filter(y => cidx.years[y]), 4, async y => {
      const bands = await retry(() => readWindow(new URL(cidx.years[y].file, chirpsBase).href, cells.win, signal), 3, signal);
      for (const m of cidx.years[y].months) monthly.set(`${y}-${m}`, cellMean(bands[m - 1], cells.cells, cidx.scale, cidx.nodata));
    });
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
    rainNote = `Rainfall unavailable: ${e.message}`; step(rainNote); cells = null;
  }
  // temperature: NASA POWER daily T2M at the area centre; optional, the analysis continues without it
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2;
  step('Reading NASA POWER daily temperature');
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  let rec = null, power = null, tempNote = null;
  try {
    const pr = await retry(() => fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=AG&longitude=${cx.toFixed(4)}&latitude=${cy.toFixed(4)}&start=${fmt(first)}&end=${fmt(last)}&format=JSON`, { signal }).then(r => { if (!r.ok) throw new Error(`NASA POWER request failed (${r.status})`); return r; }), 3, signal);
    power = await pr.json(); rec = indexPower(power);
  } catch (e) {
    if (e.name === 'AbortError' || (signal && signal.aborted)) throw e;
    tempNote = `Temperature unavailable: ${e.message}`; step(tempNote);
  }
  const climate = years.map(y => ({ year: y, rain: rainSeason(monthly, monthsOf[y]), months: monthsOf[y].length,
    ...(rec ? tempSeason(rec, y, season.start, season.end) : { t2m: NaN, days: 0, missing: null }), baseline: y >= b0 && y <= b1 }));
  const rainB = meanSd(climate.filter(c => c.baseline).map(c => c.rain)), tB = meanSd(climate.filter(c => c.baseline).map(c => c.t2m));
  const cT = climate.find(c => c.year === year);
  if (cells && !rainNote && !(cT.rain === cT.rain)) rainNote = `CHIRPS rainfall is not yet available for every month of the ${year} season`;
  const assoc = pearson(regional.filter(r => r.baseline).map(r => r.ndvi), regional.filter(r => r.baseline).map(r => (climate.find(c => c.year === r.year) || {}).rain));

  const anomMean = maskedMean(an.anom, fixed), zMean = maskedMean(an.z, fixed), vciMean = maskedMean(an.vci, fixed);
  step(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return {
    grid, inside, mask, fixed, crop, target, base, ...an,
    summary: {
      pixelsInside: inside.reduce((s, v) => s + v, 0), pixelsMasked: nMask, pixelsAnalysed: nFixed, pixelAreaKm2: grid.res * grid.res / 1e6,
      target: { year, ndvi: tgt.ndvi, anomaly: anomMean.mean, z: zMean.mean, vci: vciMean.mean, rankBelow: rank, baselineSeasons: baseSeries.filter(v => v === v).length },
      baseline: { years: [b0, b1], ndviMean: bs.mean, ndviSd: bs.sd, missingYears },
      regionalZ: bs.sd > 0 ? (tgt.ndvi - bs.mean) / bs.sd : NaN,
      zClasses: zClasses(an.z, fixed),
      climate: { rain: cT.rain, rainMean: rainB.mean, rainSd: rainB.sd, rainAnomaly: cT.rain - rainB.mean, rainPct: (cT.rain / rainB.mean - 1) * 100,
                 rainSeasons: rainB.n, rainMonths: monthsOf[year].map(([y, m]) => `${y}-${String(m).padStart(2, '0')}`),
                 rainCells: cells ? cells.cells.length : 0, rainFallback: cells ? cells.fallback : null, rainNote,
                 t2m: cT.t2m, t2mMean: tB.mean, t2mSd: tB.sd, t2mAnomaly: cT.t2m - tB.mean, point: [cx, cy],
                 powerCell: power ? power.geometry : null, missingDays: cT.missing, tempNote },
      association: { ndviRainR: assoc.r, n: assoc.n },
    },
    regional, curve, climate,
    meta: {
      app: 'AgroSignal', version: VERSION, runAt: new Date().toISOString(), label, aoi, aoiAreaKm2: area, season, year, baseline,
      cropOnly, sensor: SEN.name, params: p, composites: comps.map(c => ({ date: c.date, seasonYear: c.seasonYear, ids: c.items.map(i => i.id) })), log,
      sources: {
        ndvi: `MODIS/${sensor === 'aqua' ? 'Aqua Vegetation Indices 16-Day L3 Global 250 m (MYD13Q1' : 'Terra Vegetation Indices 16-Day L3 Global 250 m (MOD13Q1'} v061), NASA LP DAAC, via Microsoft Planetary Computer`,
        cropland: 'ESA WorldCover 10 m 2021 v200, class 40 (cropland), CC BY 4.0',
        rainfall: `CHIRPS v3.0 monthly (Climate Hazards Center, UC Santa Barbara), averaged to 0.2° for this tool; archive built ${cidx ? cidx.built : 'unknown'}`,
        temperature: 'NASA POWER daily T2M (MERRA-2) at the area centre; data from the NASA Langley Research Center POWER Project',
      },
    },
  };
}
