// Unit tests for js/engine.js with hand-worked values. Run: node tests/engine_test.mjs
import { MODIS, modisGrid, seasonWindow, seasonOf, expectedComposites, screenNdvi, seasonMean, baselineStats, anomalies, maskedMean,
         zClasses, percentile, meanSd, pearson, tempSeason, indexPower, seasonMonths, rainCells, cellMean, rainSeason, pointInRing } from '../js/engine.js';
let fails = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info !== '' ? '  ' + info : ''}`); if (!cond) fails++; };
const near = (a, b, t) => Math.abs(a - b) <= t;

// grid aligned to MODIS pixels: tile h18v07 starts at x = 0, y = 2223901.039 (gdalinfo of a MOD13Q1 COG)
{ const g = modisGrid([10, 2223000, 1000, 2223800]);
  ok('MODIS grid x aligned', near((g.x0 - MODIS.x0) / MODIS.pixel, Math.round((g.x0 - MODIS.x0) / MODIS.pixel), 1e-6) && g.x0 <= 10);
  ok('MODIS grid tile origin reproduced', near(MODIS.y0 - 7 * 4800 * MODIS.pixel, 2223901.039, 0.01) && near(MODIS.x0 + 18 * 4800 * MODIS.pixel, 0, 0.01)); }
// seasons
{ const w = seasonWindow(2026, '06-01', '10-31');
  ok('season window', w.start.toISOString() === '2026-06-01T00:00:00.000Z' && w.end.toISOString() === '2026-10-31T23:59:59.000Z' && !w.crosses);
  ok('season crossing the year', seasonWindow(2020, '11-01', '03-31').end.toISOString().startsWith('2021-03-31'));
  ok('seasonOf inside', seasonOf('2026-07-12', '06-01', '10-31') === 2026); ok('seasonOf outside', seasonOf('2026-11-01', '06-01', '10-31') === null);
  ok('seasonOf crossing', seasonOf('2021-02-10', '11-01', '03-31') === 2020);
  // composites start on DOY 1, 17, ... ; 1 Jun - 31 Oct holds DOY 161 ... 289 = 9 in 2026; in leap year 2024 DOY 305 is 31 Oct, so 10
  // composites must lie wholly inside the season: Terra starts on day 1, 17, ...; Aqua on day 9, 25, ...
  ok('Jun-Oct: 9 Terra composites (10 Jun to 16 Oct, the last ending 31 Oct)', expectedComposites(2026, '06-01', '10-31') === 9);
  ok('Jun-Oct: 9 Aqua composites (the one starting 24 Oct runs into November)', expectedComposites(2026, '06-01', '10-31', 8) === 9, expectedComposites(2026, '06-01', '10-31', 8));
  ok('same count in a leap year', expectedComposites(2024, '06-01', '10-31') === 9);
  ok('Jun-Sep: the composite starting 30 Sep (day 273) runs into October and is left out', expectedComposites(2026, '06-01', '09-30') === 7 && seasonOf('2026-09-30', '06-01', '09-30') === null);
  ok('Nov-Mar across the year end: 9, the last starting 6 Mar', expectedComposites(2023, '11-01', '03-31') === 9 && seasonOf('2026-03-06', '11-01', '03-31') === 2025 && seasonOf('2026-03-22', '11-01', '03-31') === null);
  ok('the year\'s last composite (day 353) belongs to a season that crosses the year', seasonOf('2025-12-19', '11-01', '03-31') === 2025);
  ok('whole year: 23 composites', expectedComposites(2026, '01-01', '12-31') === 23);
  ok('leap-year composite on 31 October (day 305) is outside Jun-Oct', seasonOf('2024-10-31', '06-01', '10-31') === null);
  ok('and inside a season starting 1 November', seasonOf('2024-10-31', '11-01', '03-31') === 2024);
  ok('leap-year 9 June composite (day 161) is in Jun-Oct', seasonOf('2024-06-09', '06-01', '10-31') === 2024); }
// screening
{ const s = screenNdvi(Float32Array.from([5000, 5000, 5000, 5000, -3000, 12000]), Int8Array.from([0, 1, 2, 3, 0, 0]));
  ok('screen: good and marginal kept', near(s[0], 0.5, 1e-7) && near(s[1], 0.5, 1e-7));
  ok('screen: snow, cloud, fill and out of range dropped', [2, 3, 4, 5].every(i => Number.isNaN(s[i]))); }
// season mean with minimum share
{ const c = [Float32Array.from([0.2, 0.2, NaN]), Float32Array.from([0.4, NaN, NaN]), Float32Array.from([0.6, NaN, 0.5]), Float32Array.from([NaN, NaN, NaN])];
  const r = seasonMean(c, 3, 4, 0.5);
  ok('season mean: 3 of 4 valid', near(r.mean[0], 0.4, 1e-7)); ok('season mean: 1 of 4 below half', Number.isNaN(r.mean[1]) && Number.isNaN(r.mean[2])); }
// baseline and anomalies
{ const ys = [0.3, 0.5, 0.4, 0.6].map(v => Float32Array.from([v, NaN]));
  const b = baselineStats(ys, 2, 3);
  ok('baseline mean', near(b.mean[0], 0.45, 1e-7)); ok('baseline sample SD', near(b.sd[0], Math.sqrt(((0.15 ** 2) * 2 + 0.05 ** 2 * 2) / 3), 1e-6), b.sd[0]);
  ok('baseline min and max', near(b.min[0], 0.3, 1e-7) && near(b.max[0], 0.6, 1e-7)); ok('baseline too few years', Number.isNaN(b.mean[1]));
  const a = anomalies(Float32Array.from([0.39, 0.5]), b, 2);
  ok('anomaly', near(a.anom[0], -0.06, 1e-6)); ok('z', near(a.z[0], -0.06 / b.sd[0], 1e-5)); ok('VCI', near(a.vci[0], 100 * 0.09 / 0.3, 1e-4), a.vci[0]); ok('no baseline gives NaN', Number.isNaN(a.anom[1])); }
// summaries
{ ok('masked mean', near(maskedMean(Float32Array.from([1, 2, NaN, 100]), Uint8Array.from([1, 1, 1, 0])).mean, 1.5, 1e-12));
  const zc = zClasses(Float32Array.from([-2, -1, 0, 1, 2, 0.5]), Uint8Array.from([1, 1, 1, 1, 1, 1]));
  ok('z classes', zc.n === 6 && zc.share.every((s, i) => near(s, [1, 1, 1, 2, 1][i] / 6, 1e-12)), zc.share.map(x => x.toFixed(3)).join(','));
  ok('percentile type 7', near(percentile([1, 2, 3, 4], 0.1), 1.3, 1e-12) && near(percentile([1, 2, 3, 4], 0.9), 3.7, 1e-12));
  const ms = meanSd([1, 2, 3, 4]); ok('mean and sample SD', near(ms.mean, 2.5, 1e-12) && near(ms.sd, Math.sqrt(5 / 3), 1e-12));
  ok('pearson', near(pearson([1, 2, 3, 4], [2, 4, 6, 8.5]).r, 0.9983814394570298, 1e-12) && pearson([1, 2], [1, 2]).n === 2); }
// climate: temperature from POWER, rainfall months and cells
{ const P = { T2M: {} };
  for (let d = 1; d <= 30; d++) P.T2M[`202606${String(d).padStart(2, '0')}`] = 25 + (d % 2);
  const c = tempSeason(indexPower({ properties: { parameter: P } }), 2026, '06-01', '06-30');
  ok('season mean temperature', near(c.t2m, 25.5, 1e-9) && c.days === 30, c.t2m);
  P.T2M['20260615'] = -999; const c2 = tempSeason(indexPower({ properties: { parameter: P } }), 2026, '06-01', '06-30');
  ok('missing day makes the temperature missing', Number.isNaN(c2.t2m) && c2.missing === 1);
  ok('season months', JSON.stringify(seasonMonths(2026, '06-01', '10-31')) === '[[2026,6],[2026,7],[2026,8],[2026,9],[2026,10]]');
  ok('season months across the year end', JSON.stringify(seasonMonths(2025, '11-15', '02-28')) === '[[2025,11],[2025,12],[2026,1],[2026,2]]');
  ok('point in ring', pointInRing(0.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) && !pointInRing(1.5, 0.5, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]));
  const g = { x0: -180, y1: 60, res: 0.2, w: 1800, h: 600 };
  const rc = rainCells([[8, 12], [8.4, 12], [8.4, 12.4], [8, 12.4], [8, 12]], g);
  ok('rain cells: centres inside an 0.4 degree box', rc.cells.length === 4 && !rc.fallback && rc.win.join() === '940,238,943,241', JSON.stringify(rc.win) + ' ' + rc.cells.length);
  const small = rainCells([[8.01, 12.01], [8.05, 12.01], [8.05, 12.05], [8.01, 12.05], [8.01, 12.01]], g);
  ok('rain cells: small area falls back to the containing cell', small.fallback && small.cells.length === 1 && near(small.cells[0].lon, 8.1, 1e-9) && near(small.cells[0].lat, 12.1, 1e-9));
  const cells = [{ i: 0, w: 1 }, { i: 1, w: 1 }, { i: 2, w: 2 }];
  ok('cell mean weighted', near(cellMean(Uint16Array.from([10, 20, 30]), cells, 0.2, 65535), (2 + 4 + 12) / 4, 1e-12));
  ok('cell mean skips no-data', near(cellMean(Uint16Array.from([10, 65535, 30]), cells, 0.2, 65535), (2 + 12) / 3, 1e-12));
  ok('cell mean needs half the weight', Number.isNaN(cellMean(Uint16Array.from([10, 20, 65535]), cells, 0.2, 65535)) === false && Number.isNaN(cellMean(Uint16Array.from([65535, 65535, 30]), [{ i: 0, w: 1 }, { i: 1, w: 1 }, { i: 2, w: 0.9 }], 0.2, 65535)));
  const mo = new Map([['2026-6', 100], ['2026-7', 200]]);
  ok('season rainfall sums months', rainSeason(mo, [[2026, 6], [2026, 7]]) === 300 && Number.isNaN(rainSeason(mo, [[2026, 6], [2026, 8]]))); }
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
