/* AgroSignal exports, written from the arrays of the actual run. */

/** Float32 GeoTIFF (uncompressed, one strip per row, pixel-interleaved bands) on the MODIS sinusoidal grid. geotiff.js only
    writes 8-bit images, so this small writer follows the TIFF 6.0 and GeoTIFF 1.1 specifications directly. No-data is NaN.
    bands: array of Float32Array (each grid.n long); names: band descriptions (written as GDAL metadata). */
export function sinusoidalGeoTiff(bands, grid, names) {
  const W = grid.w, H = grid.h, S = bands.length, rowBytes = W * S * 4;
  const geoKeys = [ // [key, location tag (0 = value, 34736 = doubles), count, value or index]
    [1024, 0, 1, 1],        // GTModelTypeGeoKey: projected
    [1025, 0, 1, 1],        // GTRasterTypeGeoKey: PixelIsArea
    [2048, 0, 1, 32767],    // GeographicTypeGeoKey: user-defined
    [2050, 0, 1, 32767],    // GeogGeodeticDatumGeoKey: user-defined
    [2054, 0, 1, 9102],     // GeogAngularUnitsGeoKey: degree
    [2056, 0, 1, 32767],    // GeogEllipsoidGeoKey: user-defined
    [2057, 34736, 1, 0],    // GeogSemiMajorAxisGeoKey = 6371007.181
    [2058, 34736, 1, 1],    // GeogSemiMinorAxisGeoKey = 6371007.181 (sphere)
    [3072, 0, 1, 32767],    // ProjectedCSTypeGeoKey: user-defined
    [3074, 0, 1, 32767],    // ProjectionGeoKey: user-defined
    [3075, 0, 1, 24],       // ProjCoordTransGeoKey: CT_Sinusoidal
    [3076, 0, 1, 9001],     // ProjLinearUnitsGeoKey: metre
    [3082, 34736, 1, 2],    // ProjFalseEastingGeoKey = 0
    [3083, 34736, 1, 3],    // ProjFalseNorthingGeoKey = 0
    [3088, 34736, 1, 4],    // ProjCenterLongGeoKey = 0
  ];
  const doubles = [6371007.181, 6371007.181, 0, 0, 0];
  const keyDir = [1, 1, 0, geoKeys.length, ...geoKeys.flat()];
  const meta = `<GDALMetadata>${names.map((n, i) => `<Item name="DESCRIPTION" sample="${i}" role="description">${n.replace(/[<&>]/g, '')}</Item>`).join('')}</GDALMetadata>\0`;
  // tags: [tag, type, count, values]; types: 3 SHORT, 4 LONG, 12 DOUBLE, 2 ASCII
  const tags = [
    [256, 4, 1, [W]], [257, 4, 1, [H]], [258, 3, S, Array(S).fill(32)], [259, 3, 1, [1]], [262, 3, 1, [1]],
    [273, 4, H, null], [277, 3, 1, [S]], [278, 4, 1, [1]], [279, 4, H, Array(H).fill(rowBytes)], [284, 3, 1, [1]],
    [339, 3, S, Array(S).fill(3)], ...(S > 1 ? [[338, 3, S - 1, Array(S - 1).fill(0)]] : []),
    [33550, 12, 3, [grid.res, grid.res, 0]], [33922, 12, 6, [0, 0, 0, grid.x0, grid.y1, 0]],
    [34735, 3, keyDir.length, keyDir], [34736, 12, doubles.length, doubles],
    [42112, 2, meta.length, meta], [42113, 2, 4, 'nan\0'],
  ].sort((a, b) => a[0] - b[0]);
  const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const ifdOff = 8, ifdLen = 2 + tags.length * 12 + 4;
  let extra = ifdOff + ifdLen; const extraOff = new Map();
  for (const t of tags) { const len = size[t[1]] * t[2]; if (len > 4) { extraOff.set(t[0], extra); extra += len + (len & 1); } }
  const dataOff = extra + ((4 - extra % 4) % 4), total = dataOff + rowBytes * H;   // image data aligned to 4 bytes for Float32Array
  const buf = new ArrayBuffer(total), dv = new DataView(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, tags.length, true);
  const put = (type, off, v, i) => {
    if (type === 3) dv.setUint16(off + 2 * i, v, true); else if (type === 4) dv.setUint32(off + 4 * i, v, true);
    else if (type === 12) dv.setFloat64(off + 8 * i, v, true); else dv.setUint8(off + i, v.charCodeAt ? v.charCodeAt(0) : v);
  };
  tags.forEach((t, k) => {
    const [tag, type, count] = t; let vals = t[3];
    if (tag === 273) vals = Array.from({ length: H }, (_, r) => dataOff + r * rowBytes);
    const e = ifdOff + 2 + k * 12; dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
    const len = size[type] * count, at = len > 4 ? extraOff.get(tag) : e + 8;
    if (len > 4) dv.setUint32(e + 8, at, true);
    if (type === 2) for (let i = 0; i < count; i++) dv.setUint8(at + i, vals.charCodeAt(i)); else for (let i = 0; i < count; i++) put(type, at, vals[i], i);
  });
  dv.setUint32(ifdOff + 2 + tags.length * 12, 0, true);
  const f32 = new Float32Array(buf, dataOff, W * H * S);
  for (let i = 0; i < W * H; i++) for (let b = 0; b < S; b++) f32[i * S + b] = bands[b][i];
  return buf;
}

const csvCell = v => { let s = v == null || (typeof v === 'number' && !(v === v)) ? '' : String(v); if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';

/** Year-by-year table: regional season NDVI (fixed pixel set), season rainfall and temperature. */
export function yearsCsv(r) {
  const rows = [['season_year', 'role', 'ndvi_regional_mean', 'pixels', 'rain_mm', 'temperature_c', 'climate_days_missing']];
  for (const x of r.regional) {
    const c = r.climate.find(q => q.year === x.year) || {};
    rows.push([x.year, x.year === r.meta.year ? 'target' : 'baseline', x.ndvi, x.pixels, c.rain, c.t2m, c.missing]);
  }
  return csv(rows);
}
/** Per-pixel values with pixel-centre coordinates (sinusoidal metres and WGS 84 degrees) for the analysed pixels (the same set as the regional figures). */
export function pixelsCsv(r, lonlat) {
  const rows = [['col', 'row', 'x_sinusoidal_m', 'y_sinusoidal_m', 'lon', 'lat', 'cropland_fraction', 'ndvi_target', 'ndvi_baseline_mean', 'ndvi_baseline_sd', 'anomaly', 'z', 'vci']];
  const g = r.grid;
  for (let i = 0; i < g.n; i++) {
    if (!r.fixed[i]) continue;   // the analysed pixels: in the mask and valid in the season and the baseline
    const c = i % g.w, y = (i - c) / g.w;
    rows.push([c, y, g.x0 + (c + 0.5) * g.res, g.y1 - (y + 0.5) * g.res, lonlat[i][0].toFixed(6), lonlat[i][1].toFixed(6), r.crop[i], r.target[i], r.base.mean[i], r.base.sd[i], r.anom[i], r.z[i], r.vci[i]]);
  }
  return csv(rows);
}
