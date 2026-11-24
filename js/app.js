/* AgroSignal page: map, three steps, results drawer. Every number shown comes from the worker's run (js/pipeline.js). */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && v === v && Number.isFinite(v);
const fmt = (v, d = 2) => ok(v) ? new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : '–';
const sgn = (v, d = 2) => ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d) : '–';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LAST_DAY = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];   // February ends on the 28th in every year (see About)
import { VERSION } from './version.js';
document.querySelectorAll('[data-ver]').forEach(e => { e.textContent = VERSION; });
const LIMIT_KM2 = 2500, NOMINATIM = 'https://nominatim.openstreetmap.org', R_SINU = 6371007.181;

// ---------------------------------------------------------------- worker
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let seq = 0; const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (data.type === 'progress') { if (p && p.onProgress) p.onProgress(data.msg); return; }
  if (!p) return;
  pending.delete(data.id);
  data.type === 'error' ? p.reject(new Error(data.message)) : p.resolve(data);
};
worker.onerror = e => {   // the worker script itself failed to load or crashed: fail every waiting request with a message
  const err = new Error(`The analysis engine stopped (${e.message || 'script error'}). Reload the page and try again.`);
  for (const [id, p] of pending) { pending.delete(id); p.reject(err); }
};
const ask = (cmd, payload = {}, onProgress) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ cmd, id, ...payload });
});

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [8, 10], zoom: 3,
  attributionControl: false, preserveDrawingBuffer: true });
// if the basemap style cannot be fetched (host down, blocked network) fall back to a plain background so the tool still works
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9ecef' } }] };
let styleFallback = false;
map.on('error', e => { if (styleFallback || map.isStyleLoaded() || (e && e.sourceId)) return; styleFallback = true; $('mapnote').hidden = false; map.setStyle(FALLBACK_STYLE); });
function showLegend() { const L = $('legend'); L.hidden = false; if (!L.dataset.init) { L.dataset.init = '1'; L.open = !window.matchMedia('(max-width: 860px)').matches; } return $('legend-body'); }
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
const ready = new Promise(r => map.on('load', r));
const EMPTY = { type: 'FeatureCollection', features: [] };
ready.then(() => {
  const first = map.getStyle().layers.find(l => l.type === 'symbol');
  map.addSource('aoi', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#141412', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
  map.addSource('ras', { type: 'image', url: blankPng(), coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]] });
  map.addLayer({ id: 'ras', type: 'raster', source: 'ras', paint: { 'raster-opacity': 0.9, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }, layout: { visibility: 'none' } }, first && first.id);
});
function blankPng() { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL(); }

// ---------------------------------------------------------------- steps (accordion in the rail)
let step = 0;
const S = { aoi: null, result: null, layer: 'z', running: false };
const reach = k => k === 0 || (k === 1 && !!(S.aoi && S.aoi.ok));
const complete = k => k === 0 ? !!(S.aoi && S.aoi.ok) : !!S.result;
function summary(k, t) { $(`sum-${k}`).textContent = t; }
function go(n) {
  step = n;
  document.querySelectorAll('.step').forEach(el => {
    const k = +el.dataset.step, open = k === n;
    el.classList.toggle('open', open); el.querySelector('[data-pane]').hidden = !open; el.querySelector('.step-h').setAttribute('aria-expanded', String(open));
  });
  updateNext();
}
function updateNext() {
  $('next-0').disabled = !(S.aoi && S.aoi.ok);
  $('run').disabled = S.running || !(S.aoi && S.aoi.ok) || !!seasonProblem();
  document.querySelectorAll('.step').forEach(el => {
    const k = +el.dataset.step, h = el.querySelector('.step-h');
    el.classList.toggle('locked', !reach(k)); el.classList.toggle('done', k !== step && complete(k)); h.setAttribute('aria-disabled', String(!reach(k))); h.tabIndex = reach(k) ? 0 : -1;
  });
}
document.querySelectorAll('.step-h').forEach(h => h.addEventListener('click', () => { const k = +h.parentElement.dataset.step; if (reach(k)) go(k); }));
$('next-0').addEventListener('click', () => go(1));
$('run').addEventListener('click', () => runNow());

// ---------------------------------------------------------------- area
const ringOf = b => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]];
const boxKm2 = b => { const R = 6371.0088, r = Math.PI / 180; return R * R * Math.abs((b[2] - b[0]) * r) * Math.abs(Math.sin(b[3] * r) - Math.sin(b[1] * r)); };
async function setAoi(b, label) {
  // the map repeats the world sideways: bring the box back to -180..180; a box across the 180° meridian is not supported
  const shift = Math.round(((b[0] + b[2]) / 2) / 360) * 360;
  b = [b[0] - shift, Math.max(-60, b[1]), b[2] - shift, Math.min(80, b[3])];
  const crosses = b[0] < -180 || b[2] > 180;
  const area = boxKm2(b);
  const problem = crosses ? 'The box crosses the 180° meridian; draw it on one side'
    : area > LIMIT_KM2 ? `${fmt(area, 0)} km² is larger than the ${fmt(LIMIT_KM2, 0)} km² limit; draw a smaller box`
    : area < 1 ? `${fmt(area, 2)} km² is smaller than the 1 km² minimum (about 19 MODIS pixels); draw a larger box` : '';
  const good = !problem;
  S.aoi = { bbox: b, ring: ringOf(b), area, label, ok: good };
  await ready;
  map.getSource('aoi').setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [S.aoi.ring] } });
  const c = $('chosen'); c.hidden = false;
  summary(0, `${label}, ${fmt(area, area < 10 ? 2 : 0)} km²`);
  if (!S.running && S.result) clearResult();
  c.innerHTML = `<span>${esc(label)}</span><span class="num${good ? '' : ' warn'}">${fmt(area, area < 10 ? 2 : 0)} km²</span>` +
    (good ? '' : `<span class="warn">${esc(problem)}</span>`);
  updateNext();
}
const fit = b => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 60, bottom: 40, left: 40, right: 40 }, duration: 800 });

let drawing = false, start = null;
$('draw').addEventListener('click', () => setDraw(!drawing));
function setDraw(on) {
  drawing = on; $('draw').setAttribute('aria-pressed', String(on)); $('draw').textContent = on ? 'Drag on the map' : 'Draw a box';
  map.getCanvas().style.cursor = on ? 'crosshair' : ''; on ? map.dragPan.disable() : map.dragPan.enable();
}
const boxFrom = e => [Math.min(start.lng, e.lngLat.lng), Math.min(start.lat, e.lngLat.lat), Math.max(start.lng, e.lngLat.lng), Math.max(start.lat, e.lngLat.lat)];
map.on('mousedown', e => { if (drawing) start = e.lngLat; });
map.on('touchstart', e => { if (drawing && e.points.length === 1) { start = e.lngLat; e.preventDefault(); } });
const drag = e => { if (drawing && start) map.getSource('aoi').setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ringOf(boxFrom(e))] } }); };
map.on('mousemove', drag); map.on('touchmove', drag);
const finish = e => {
  if (!drawing || !start) return;
  const b = boxFrom(e); start = null; setDraw(false);
  if (b[2] - b[0] < 1e-3 || b[3] - b[1] < 1e-3) {   // a click or a line, not a box
    map.getSource('aoi').setData(S.aoi ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [S.aoi.ring] } } : { type: 'FeatureCollection', features: [] });
    const c = $('chosen'); c.hidden = false; c.innerHTML = '<span class="warn">That box has no area. Press Draw a box, then drag across the map.</span>'; return;
  }
  setAoi(b, 'Drawn box');
};
map.on('mouseup', finish); map.on('touchend', finish);

$('search').addEventListener('submit', async ev => {
  ev.preventDefault();
  const q = $('q').value.trim(); if (!q) return;
  const ul = $('results'); ul.hidden = false; ul.innerHTML = '<li class="small" style="padding:8px 10px">Searching…</li>';
  try {
    const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`search failed (${r.status})`);
    const list = await r.json();
    ul.innerHTML = list.length ? '' : '<li class="small" style="padding:8px 10px">No place found.</li>';
    for (const p of list) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = p.display_name;
      b.onclick = () => {
        ul.hidden = true;
        const lat = +p.lat, lon = +p.lon, k = 0.15 / Math.cos(lat * Math.PI / 180);   // about 33 x 33 km around the place
        const box = [lon - k, lat - 0.15, lon + k, lat + 0.15];
        setAoi(box, p.name || p.display_name.split(',')[0]); fit(box);
      };
      li.append(b); ul.append(li);
    }
  } catch (e) { ul.innerHTML = `<li class="small" style="padding:8px 10px">Place search is unavailable (${esc(e.message)}). Draw a box instead.</li>`; }
});

$('example').addEventListener('click', async () => {
  const b = [8.0, 12.0, 8.4, 12.4];
  await setAoi(b, 'Farmland around Bagwai, Kano State, Nigeria'); fit(b);
  $('m0').value = '6'; $('m1').value = '10'; $('year').value = '2026'; $('b0').value = '2001'; $('b1').value = '2020';
  checkSeason(); go(1);
});

// ---------------------------------------------------------------- season
const now = new Date(), thisYear = now.getUTCFullYear();
const opt = (v, t) => `<option value="${v}">${t}</option>`;
$('m0').innerHTML = MONTHS.map((m, i) => opt(i + 1, m)).join(''); $('m1').innerHTML = $('m0').innerHTML;
$('m0').value = '6'; $('m1').value = '10';
const yearsOpts = Array.from({ length: thisYear - 2000 }, (_, i) => 2001 + i);
$('year').innerHTML = yearsOpts.slice().reverse().map(y => opt(y, y)).join('');
$('b0').innerHTML = yearsOpts.map(y => opt(y, y)).join(''); $('b1').innerHTML = $('b0').innerHTML;
$('b0').value = '2001'; $('b1').value = '2020';
const pad = n => String(n).padStart(2, '0');
function seasonArgs() {
  const m0 = +$('m0').value, m1 = +$('m1').value;
  return { season: { start: `${pad(m0)}-01`, end: `${pad(m1)}-${LAST_DAY[m1 - 1]}` }, year: +$('year').value, baseline: [+$('b0').value, +$('b1').value], crosses: m1 < m0 };
}
function seasonProblem() {
  const a = seasonArgs(), [b0, b1] = a.baseline;
  const endYear = a.year + (a.crosses ? 1 : 0), end = new Date(Date.UTC(endYear, +$('m1').value, 1));
  if (end > now) return `The ${a.year} season has not finished yet. Choose an earlier year.`;
  if (b1 - b0 < 9) return 'The baseline needs at least 10 years.';
  if ($('sensor').value === 'aqua' && (b0 < 2003 || a.year < 2003)) return 'Aqua seasons start in 2003.';
  if (a.year >= b0 && a.year <= b1) return 'Choose a season outside the baseline years.';
  if (new Date(Date.UTC(b1 + (a.crosses ? 1 : 0), +$('m1').value, 1)) > now) return 'The last baseline season has not finished yet.';
  return '';
}
function checkSeason() {
  if (!S.running && S.result) clearResult();
  const p = seasonProblem(), a = seasonArgs(); $('season-msg').hidden = !p; $('season-msg').textContent = p;
  summary(1, `${MONTHS[+$('m0').value - 1].slice(0, 3)}–${MONTHS[+$('m1').value - 1].slice(0, 3)} ${a.year}, baseline ${a.baseline[0]}–${a.baseline[1]}`);
  updateNext();
}
['m0', 'm1', 'year', 'b0', 'b1', 'sensor'].forEach(id => $(id).addEventListener('change', checkSeason));
checkSeason();

// ---------------------------------------------------------------- run
let runSeq = 0;
const logEl = $('log');
function status(msg, cls = '', pct = null) {
  $('status').hidden = false; $('msg').textContent = msg; $('msg').className = cls === 'err' ? 'msg err' : 'msg';
  const li = document.createElement('li'); li.textContent = msg; if (cls) li.className = cls; logEl.append(li);
  if (pct !== null) $('bar').style.width = `${pct}%`;
}
async function runNow() {
  if (!S.aoi || seasonProblem()) return;
  const mine = ++runSeq, a = seasonArgs();
  S.running = true; clearResult(); updateNext(); logEl.innerHTML = ''; status('Starting', '', 2);
  const onProgress = msg => {
    if (mine !== runSeq) return;
    const m2 = msg.match(/^Read (\d+) of (\d+)/);
    status(msg, '', m2 ? 5 + 85 * (+m2[1] / +m2[2]) : /CHIRPS/.test(msg) ? 92 : /POWER/.test(msg) ? 96 : null);
  };
  try {
    const r = await ask('run', { args: { aoi: { type: 'Polygon', coordinates: [S.aoi.ring] }, season: a.season, year: a.year, baseline: a.baseline,
      cropOnly: $('crop').checked, label: S.aoi.label, sensor: $('sensor').value } }, onProgress);
    if (mine !== runSeq) return;
    S.result = r; $('bar').style.width = '100%';
    showResult(r);
  } catch (e) {
    if (mine !== runSeq) return;
    status(e.message, 'err');
  } finally {
    if (mine === runSeq) { S.running = false; updateNext(); }
  }
}

// ---------------------------------------------------------------- map layers
// Diverging brown (worse) – grey – green (better); sequential greens for NDVI and cropland.
const DIV = ['#8c4a0e', '#c98a4b', '#e9d3b4', '#e4e4df', '#bcd9a8', '#6fa857', '#2c6b1e'];
const SEQ = ['#f2f0e6', '#d7e3b9', '#a9cb88', '#73ad5c', '#3f8a37', '#1d5e23'];
const LAYERS = {
  z: { name: 'z-score', key: 'z', ramp: DIV, min: -2.5, max: 2.5, ends: ['−2.5', '0', '+2.5'], unit: 'SD from the baseline mean', d: 2 },
  anom: { name: 'Anomaly', key: 'anom', ramp: DIV, min: -0.15, max: 0.15, ends: ['−0.15', '0', '+0.15'], unit: 'NDVI difference', d: 3 },
  vci: { name: 'VCI', key: 'vci', ramp: DIV, min: -50, max: 150, ends: ['≤ −50', '50', '≥ 150'], unit: '0 = baseline minimum, 100 = maximum', d: 0 },
  target: { name: 'Season NDVI', key: 'target', ramp: SEQ, min: 0, max: 0.8, ends: ['0', '0.4', '0.8'], unit: 'mean NDVI', d: 3 },
  crop: { name: 'Cropland share', key: 'crop', ramp: SEQ, min: 0, max: 1, ends: ['0%', '50%', '100%'], unit: 'ESA WorldCover 2021', d: 0, pct: true, all: true },
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function colour(ramp, t) {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1); const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i;
  const a = hex(ramp[i]), b = hex(ramp[i + 1]); return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
$('layer-list').insertAdjacentHTML('beforeend', Object.entries(LAYERS).map(([k, L]) => `<label><input type="radio" name="layer" value="${k}"${k === 'z' ? ' checked' : ''}>${L.name}</label>`).join(''));
$('layer-list').addEventListener('change', e => { S.layer = e.target.value; paint(); });

// display raster: lon/lat columns, rows evenly spaced in Web Mercator so the image source is placed exactly
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const latOf = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
function cellAt(lon, lat) {
  const g = S.result.grid, x = R_SINU * lon * Math.PI / 180 * Math.cos(lat * Math.PI / 180), y = R_SINU * lat * Math.PI / 180;
  const c = Math.floor((x - g.x0) / g.res), r = Math.floor((g.y1 - y) / g.res);
  return c >= 0 && c < g.w && r >= 0 && r < g.h ? r * g.w + c : -1;
}
function paint() {
  const r = S.result; if (!r) return;
  const ring = r.meta.aoi.coordinates[0], lons = ring.map(q => q[0]), lats = ring.map(q => q[1]);
  const L = LAYERS[S.layer], arr = r[L.key], [w0, s0, e0, n0] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], mask = L.all ? null : r.fixed;
  const W = 600, ys = mercY(s0), yn = mercY(n0), H = Math.max(50, Math.min(900, Math.round(W * (yn - ys) / ((e0 - w0) * Math.PI / 180))));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const lat = latOf(yn - (py + 0.5) / H * (yn - ys));
    for (let px = 0; px < W; px++) {
      const lon = w0 + (px + 0.5) / W * (e0 - w0), i = cellAt(lon, lat), o = (py * W + px) * 4;
      if (i < 0 || !r.inside[i] || (mask && !mask[i])) continue;
      const v = arr[i]; if (!(v === v)) continue;
      const rgb = colour(L.ramp, (v - L.min) / (L.max - L.min));
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  map.getSource('ras').updateImage({ url: c.toDataURL(), coordinates: [[w0, n0], [e0, n0], [e0, s0], [w0, s0]] });
  map.setLayoutProperty('ras', 'visibility', 'visible');
  const grad = `linear-gradient(90deg, ${L.ramp.join(', ')})`;
  showLegend().innerHTML = `<strong>${L.name}</strong><div class="ramp" style="background:${grad}"></div>
    <div class="ends"><span>${L.ends[0]}</span><span>${L.ends[1]}</span><span>${L.ends[2]}</span></div>
    <div class="small" style="margin-top:4px">${esc(L.unit)}</div>${L.all ? '' : `<div class="small muted">${r.meta.cropOnly ? 'Cropland pixels only' : 'All pixels in the area'}</div>`}`;
}

// hover values
const tip = $('tip');
map.on('mousemove', e => {
  if (!S.result || drawing) { tip.hidden = true; return; }
  const r = S.result, i = cellAt(e.lngLat.lng, e.lngLat.lat);
  if (i < 0 || !r.inside[i]) { tip.hidden = true; return; }
  const v = a => a[i];
  tip.innerHTML = `<strong>${r.fixed[i] ? 'Analysed pixel' : r.mask[i] ? 'Not enough valid data' : r.meta.cropOnly ? 'Not cropland' : 'Pixel'}</strong><dl>
    <dt>z-score</dt><dd>${sgn(v(r.z))}</dd><dt>Anomaly</dt><dd>${sgn(v(r.anom), 3)}</dd><dt>VCI</dt><dd>${fmt(v(r.vci), 0)}</dd>
    <dt>NDVI ${r.meta.year}</dt><dd>${fmt(v(r.target), 3)}</dd><dt>Baseline mean</dt><dd>${fmt(v(r.baseMean), 3)}</dd>
    <dt>Cropland</dt><dd>${ok(v(r.crop)) ? fmt(100 * v(r.crop), 0) + '%' : '–'}</dd></dl>`;
  tip.hidden = false;
  const x = e.originalEvent.clientX, y = e.originalEvent.clientY;
  tip.style.left = `${Math.min(x + 14, window.innerWidth - 250)}px`; tip.style.top = `${Math.min(y + 14, window.innerHeight - 170)}px`;
});
map.getCanvas().addEventListener('mouseleave', () => { tip.hidden = true; });

// ---------------------------------------------------------------- results
const BLANK = { figs: $('figs').innerHTML, panes: Object.fromEntries([...document.querySelectorAll('[data-tabpane]')].map(p => [p.dataset.tabpane, p.innerHTML])) };
function clearResult() {
  S.result = null; tip.hidden = true;
  if (map.getLayer('ras')) map.setLayoutProperty('ras', 'visibility', 'none');
  $('legend').hidden = true; $('layer-list').hidden = true; syncExports();
  $('figs').classList.add('empty'); $('figs').innerHTML = BLANK.figs;
  document.querySelectorAll('[data-tabpane]').forEach(p => { p.innerHTML = BLANK.panes[p.dataset.tabpane]; delete p.dataset.fresh; });
  $('r-title').textContent = 'Season greenness against a baseline';
  $('r-sub').textContent = 'Was this growing season greener or browner than usual, and was it wetter or drier?';
  updateNext();
}
function seasonLabel(m) {
  const a = +m.season.start.slice(0, 2), b = +m.season.end.slice(0, 2);
  return `${MONTHS[a - 1].slice(0, 3)}–${MONTHS[b - 1].slice(0, 3)} ${m.year}${b < a ? `/${String(m.year + 1).slice(2)}` : ''}`;
}
// Download items are disabled until a result exists
function syncExports() {
  const has = !!S.result;
  document.querySelectorAll('[data-x]').forEach(b => { b.disabled = !has; });
  $('dl-note').hidden = has;
}
function showResult(r) {
  const s = r.summary, t = s.target, cl = s.climate, m = r.meta;
  syncExports();
  $('layer-list').hidden = false;
  paint();
  const word = !ok(s.regionalZ) ? 'compared with' : s.regionalZ >= 1.5 ? 'much greener than' : s.regionalZ >= 0.5 ? 'greener than' : s.regionalZ > -0.5 ? 'close to' : s.regionalZ > -1.5 ? 'browner than' : 'much browner than';
  $('r-title').textContent = `${seasonLabel(m)}: ${word} usual`;
  $('r-sub').textContent = `${m.label || ''}. Mean NDVI ${fmt(t.ndvi, 3)} over ${s.pixelsAnalysed.toLocaleString('en-GB')} ${m.cropOnly ? 'cropland ' : ''}pixels, against ${fmt(s.baseline.ndviMean, 3)} in ${m.baseline[0]}–${m.baseline[1]}. Higher than ${t.rankBelow} of ${t.baselineSeasons} baseline seasons.`;
  summary(1, `Done: ${seasonLabel(m)}, z ${sgn(s.regionalZ)}`);
  const k = [
    ['Season NDVI', fmt(t.ndvi, 3), `baseline ${fmt(s.baseline.ndviMean, 3)} ± ${fmt(s.baseline.ndviSd, 3)}`],
    ['Regional z-score', sgn(s.regionalZ), `mean of pixel z-scores ${sgn(t.z)}`],
    ['Rank', `${t.rankBelow}<small>of ${t.baselineSeasons}</small>`, `baseline seasons below ${m.year}`],
    ['Rainfall', ok(cl.rain) ? `${sgn(cl.rainPct, 0)}<small>%</small>` : '–', ok(cl.rain) ? `${fmt(cl.rain, 0)} mm against ${fmt(cl.rainMean, 0)} mm` : (cl.rainNote || 'unavailable')],
  ];
  $('figs').classList.remove('empty');
  $('figs').innerHTML = k.map(([l, v, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="d" title="${esc(d)}">${esc(d)}</div></div>`).join('');
  renderYears(r); renderCurve(r); renderPixels(r); renderRun(r); updateNext();
  if (window.innerWidth <= 860) document.querySelector('.main').scrollIntoView({ behavior: 'smooth' });
}
function showTab(t) {
  document.querySelectorAll('.tabs button').forEach(x => { x.setAttribute('aria-selected', String(x.dataset.tab === t)); x.tabIndex = x.dataset.tab === t ? 0 : -1; });
  document.querySelectorAll('[data-tabpane]').forEach(p => { p.hidden = p.dataset.tabpane !== t; });
  if (S.result) { renderYears(S.result); renderCurve(S.result); }
}
const tabBtns = [...document.querySelectorAll('.tabs button')];
tabBtns.forEach(b => {
  const pane = document.querySelector(`[data-tabpane="${b.dataset.tab}"]`);
  b.id = `tab-${b.dataset.tab}`; pane.id = `pane-${b.dataset.tab}`; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', b.id); b.setAttribute('aria-controls', pane.id);
  b.addEventListener('click', () => showTab(b.dataset.tab));
  b.addEventListener('keydown', e => {
    const i = tabBtns.indexOf(b), j = e.key === 'ArrowRight' ? (i + 1) % tabBtns.length : e.key === 'ArrowLeft' ? (i - 1 + tabBtns.length) % tabBtns.length : -1;
    if (j < 0) return; e.preventDefault(); tabBtns[j].focus(); showTab(tabBtns[j].dataset.tab);
  });
});

// ---------------------------------------------------------------- charts (canvas, one y-axis each, hover values)
const INK = '#141412', INK3 = '#6a6963', RULE = '#e6e6e2', BASE = '#a9a89f', HUE = '#3d7a1f';
function setupCanvas(cv, h) {
  const w = cv.clientWidth || cv.parentElement.clientWidth || 600, dpr = window.devicePixelRatio || 1;   // the canvas's own CSS width, so hover positions match
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = `${h}px`;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = '12px Satoshi, system-ui, sans-serif';
  return { ctx, w, h };
}
function niceRange(vals, padFrac = 0.04) {
  const v = vals.filter(ok); let lo = Math.min(...v), hi = Math.max(...v); const p = (hi - lo || Math.abs(hi) || 1) * padFrac, nonneg = lo >= 0; lo -= p; hi += p; if (nonneg) lo = Math.max(0, lo);
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, Math.round((Math.ceil(hi / step) - Math.floor(lo / step)))];
}

function axisY(ctx, x0, x1, y, lo, hi, ticks, d, h0, h1) {
  ctx.strokeStyle = RULE; ctx.fillStyle = INK3; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= ticks; k++) { const v = lo + (hi - lo) * k / ticks, yy = y(v); ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.fillText(fmt(v, d), x0 - 6, yy); }
}
function hoverChart(cv, items, html) {
  cv.onmousemove = e => {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left;
    let best = null, bd = 1e9; for (const it of items) { const d = Math.abs(it.x - x); if (d < bd) { bd = d; best = it; } }
    if (!best || bd > 24) { tip.hidden = true; return; }
    tip.innerHTML = html(best); tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 250)}px`; tip.style.top = `${e.clientY - 70}px`;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}
function renderYears(r) {
  const el = document.querySelector('[data-tabpane="years"]');
  if (!el.querySelector('canvas') || el.dataset.fresh !== String(runSeq)) el.dataset.fresh = String(runSeq), el.innerHTML = `<p class="small" style="margin:0 0 4px">Regional mean NDVI each season, same pixels every year. The band is the baseline mean ± 1 SD.</p>
    <canvas class="chart" id="c-years" role="img" aria-label="Season NDVI by year"></canvas>
    <p class="small" style="margin:14px 0 4px">Season rainfall (CHIRPS, area mean)</p>
    <canvas class="chart" id="c-rain" role="img" aria-label="Season rainfall by year"></canvas><p class="note" id="years-note"></p>
    <details class="more"><summary>Table</summary><div id="years-table"></div></details>`;
  if (el.hidden) return;
  const s = r.summary, data = r.regional, yrs = data.map(d => d.year), m = r.meta;
  const { ctx, w, h } = setupCanvas($('c-years'), 200), L = 44, Rr = 22, T = 12, B = 24;
  const [lo, hi, nt] = niceRange([...data.map(d => d.ndvi), s.baseline.ndviMean - s.baseline.ndviSd, s.baseline.ndviMean + s.baseline.ndviSd]);
  const y = v => T + (hi - v) / (hi - lo) * (h - T - B);
  const x0 = yrs[0], x1 = yrs[yrs.length - 1], x = yr => L + (yr - x0) / Math.max(1, x1 - x0) * (w - L - Rr);
  axisY(ctx, L, w - Rr, y, lo, hi, nt, 2);
  ctx.fillStyle = 'rgba(61,122,31,.10)'; ctx.fillRect(L, y(s.baseline.ndviMean + s.baseline.ndviSd), w - L - Rr, y(s.baseline.ndviMean - s.baseline.ndviSd) - y(s.baseline.ndviMean + s.baseline.ndviSd));
  ctx.strokeStyle = BASE; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, y(s.baseline.ndviMean)); ctx.lineTo(w - Rr, y(s.baseline.ndviMean)); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = INK3;
  const every = Math.ceil(yrs.length / Math.max(4, Math.floor((w - L) / 46)));
  const lastShown = new Set(yrs.filter((yr, k) => k % every === 0)); lastShown.add(m.year);
  [...lastShown].forEach(yr => { if (yr !== m.year && Math.abs(x(yr) - x(m.year)) < 30) return; ctx.textAlign = x(yr) > w - 30 ? 'right' : 'center'; ctx.fillText(String(yr), x(yr) + (ctx.textAlign === 'right' ? 6 : 0), h - B + 6); });
  ctx.textAlign = 'center';
  const items = [];
  for (const d of data) {
    if (!ok(d.ndvi)) continue;
    const tgt = d.year === m.year, xx = x(d.year), yy = y(d.ndvi);
    ctx.beginPath(); ctx.arc(xx, yy, tgt ? 6 : 4, 0, 7); ctx.fillStyle = tgt ? HUE : BASE; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    items.push({ x: xx, d });
  }
  const tg = data.find(d => d.year === m.year);
  if (tg && ok(tg.ndvi)) { ctx.fillStyle = INK; ctx.textAlign = x(tg.year) > w - 80 ? 'right' : 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${seasonLabel(m)}`, x(tg.year) + (ctx.textAlign === 'right' ? -10 : 10), y(tg.ndvi) - 4); }
  const clim = y => r.climate.find(c => c.year === y) || {};
  hoverChart($('c-years'), items, it => `<strong>${it.d.year}${it.d.year === m.year ? ' (target)' : ''}</strong><dl><dt>NDVI</dt><dd>${fmt(it.d.ndvi, 3)}</dd><dt>Pixels</dt><dd>${it.d.pixels.toLocaleString('en-GB')}</dd><dt>Rainfall</dt><dd>${ok(clim(it.d.year).rain) ? fmt(clim(it.d.year).rain, 0) + ' mm' : '–'}</dd></dl>`);

  // rainfall bars on their own axis
  const rc = setupCanvas($('c-rain'), 120), c2 = rc.ctx, h2 = 120, B2 = 22;
  const rains = r.climate.map(c => c.rain).filter(ok);
  const rItems = [];
  if (rains.length) {
    const [, rhi, rnt] = niceRange([0, ...rains]), yr2 = v => 8 + (rhi - v) / rhi * (h2 - 8 - B2);
    axisY(c2, L, w - Rr, yr2, 0, rhi, rnt, 0);
    const bw = Math.max(3, Math.min(14, (w - L - Rr) / yrs.length - 4));
    for (const c of r.climate) {
      if (!ok(c.rain)) continue;
      const xx = x(c.year), top = yr2(c.rain), bot = yr2(0);
      c2.fillStyle = c.year === m.year ? HUE : '#c8c7bf';
      c2.beginPath(); c2.roundRect(xx - bw / 2, top, bw, bot - top, [3, 3, 0, 0]); c2.fill();
      rItems.push({ x: xx, c });
    }
    c2.strokeStyle = BASE; c2.setLineDash([4, 3]); c2.beginPath(); c2.moveTo(L, yr2(s.climate.rainMean)); c2.lineTo(w - Rr, yr2(s.climate.rainMean)); c2.stroke(); c2.setLineDash([]);
    c2.fillStyle = INK3; c2.textAlign = 'center'; c2.textBaseline = 'top';
    [...lastShown].forEach(yr => { if (yr !== m.year && Math.abs(x(yr) - x(m.year)) < 30) return; c2.textAlign = x(yr) > w - 30 ? 'right' : 'center'; c2.fillText(String(yr), x(yr) + (c2.textAlign === 'right' ? 6 : 0), h2 - B2 + 6); });
  } else { c2.fillStyle = INK3; c2.fillText(s.climate.rainNote || 'Rainfall unavailable', L, 40); }
  hoverChart($('c-rain'), rItems, it => `<strong>${it.c.year}</strong><dl><dt>Rainfall</dt><dd>${fmt(it.c.rain, 0)} mm</dd><dt>Temperature</dt><dd>${ok(it.c.t2m) ? fmt(it.c.t2m, 1) + ' °C' : '–'}</dd></dl>`);

  const a = s.association, cl = s.climate;
  $('years-note').textContent = [
    ok(cl.rain) ? `Rainfall ${fmt(cl.rain, 0)} mm over ${cl.rainMonths.length} months against a baseline mean of ${fmt(cl.rainMean, 0)} mm (${sgn(cl.rainPct, 0)}%), from ${cl.rainCells} CHIRPS cell${cl.rainCells === 1 ? '' : 's'}${cl.rainFallback ? ' (the cell containing the area, which is smaller than one cell)' : ''}.` : (cl.rainNote || ''),
    ok(cl.t2m) ? `Mean temperature ${fmt(cl.t2m, 1)} °C (baseline ${fmt(cl.t2mMean, 1)} °C, NASA POWER).` : (cl.tempNote || ''),
    ok(a.ndviRainR) ? `Across the ${a.n} baseline seasons, NDVI and rainfall correlate at r = ${fmt(a.ndviRainR, 2)}; this describes the baseline only and does not show cause.` : '',
  ].filter(Boolean).join(' ');
  $('years-table').innerHTML = `<table class="t"><tr><th>Season</th><th>NDVI</th><th>Pixels</th><th>Rainfall (mm)</th><th>Temperature (°C)</th></tr>${data.map(d => {
    const c = clim(d.year); return `<tr><td>${d.year}${d.year === m.year ? ' (target)' : ''}</td><td class="n">${fmt(d.ndvi, 3)}</td><td class="n">${d.pixels.toLocaleString('en-GB')}</td><td class="n">${fmt(c.rain, 0)}</td><td class="n">${fmt(c.t2m, 1)}</td></tr>`; }).join('')}</table>`;
}
function renderCurve(r) {
  const el = document.querySelector('[data-tabpane="curve"]');
  if (!el.querySelector('canvas') || el.dataset.fresh !== String(runSeq)) el.dataset.fresh = String(runSeq), el.innerHTML = `<p class="small" style="margin:0 0 4px">Regional NDVI for each 16-day composite. Grey band: 10th to 90th percentile of the baseline years.</p>
    <canvas class="chart" id="c-curve" role="img" aria-label="NDVI through the season"></canvas>`;
  if (el.hidden) return;
  const cv = r.curve, m = r.meta, { ctx, w, h } = setupCanvas($('c-curve'), 240), L = 44, Rr = 12, T = 34, B = 24;
  const [lo, hi, nt] = niceRange(cv.flatMap(c => [c.target, c.p10, c.p90]));
  const y = v => T + (hi - v) / (hi - lo) * (h - T - B), x = k => L + k / Math.max(1, cv.length - 1) * (w - L - Rr);
  axisY(ctx, L, w - Rr, y, lo, hi, nt, 2);
  ctx.fillStyle = 'rgba(169,168,159,.28)'; ctx.beginPath();
  cv.forEach((c, k) => { if (ok(c.p90)) ctx.lineTo(x(k), y(c.p90)); });
  for (let k = cv.length - 1; k >= 0; k--) if (ok(cv[k].p10)) ctx.lineTo(x(k), y(cv[k].p10));
  ctx.fill();
  const line = (key, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath(); let pen = false;
    cv.forEach((c, k) => { if (!ok(c[key])) { pen = false; return; } pen ? ctx.lineTo(x(k), y(c[key])) : ctx.moveTo(x(k), y(c[key])); pen = true; }); ctx.stroke(); ctx.setLineDash([]); };
  line('baselineMean', BASE, [4, 3]); line('target', HUE, []);
  cv.forEach((c, k) => { if (ok(c.target)) { ctx.beginPath(); ctx.arc(x(k), y(c.target), 3, 0, 7); ctx.fillStyle = HUE; ctx.fill(); } });
  ctx.fillStyle = INK3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const lab = md => `${+md.slice(3)} ${MONTHS[+md.slice(0, 2) - 1].slice(0, 3)}`;
  const every = Math.ceil(cv.length / Math.max(3, Math.floor((w - L) / 60)));
  cv.forEach((c, k) => { if (k % every === 0) ctx.fillText(lab(c.slot), x(k), h - B + 6); });
  // legend, top left inside the plot
  const ly = 10; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = HUE; ctx.fillRect(L, ly - 1, 14, 2); ctx.fillStyle = INK; ctx.fillText(String(m.year), L + 20, ly);
  ctx.strokeStyle = BASE; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L + 62, ly); ctx.lineTo(L + 76, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText(`Baseline mean ${m.baseline[0]}–${m.baseline[1]}`, L + 82, ly);
  ctx.fillStyle = 'rgba(169,168,159,.45)'; ctx.fillRect(L + 82 + ctx.measureText(`Baseline mean ${m.baseline[0]}–${m.baseline[1]}`).width + 12, ly - 5, 14, 10);
  ctx.fillStyle = INK; ctx.fillText('10th–90th', L + 82 + ctx.measureText(`Baseline mean ${m.baseline[0]}–${m.baseline[1]}`).width + 32, ly);
  hoverChart($('c-curve'), cv.map((c, k) => ({ x: x(k), c })), it => `<strong>Composite starting ${lab(it.c.slot)}</strong><dl><dt>${m.year}</dt><dd>${fmt(it.c.target, 3)}</dd><dt>Baseline mean</dt><dd>${fmt(it.c.baselineMean, 3)}</dd><dt>10th–90th</dt><dd>${fmt(it.c.p10, 3)}–${fmt(it.c.p90, 3)}</dd><dt>Years</dt><dd>${it.c.n}</dd></dl>`);
}
function renderPixels(r) {
  const z = r.summary.zClasses, cols = [DIV[0], DIV[2], DIV[3], DIV[4], DIV[6]], s = r.summary;
  document.querySelector('[data-tabpane="pixels"]').innerHTML = `<p class="small" style="margin:0 0 8px">Share of the ${z.n.toLocaleString('en-GB')} analysed pixels in each z-score class.</p>
    <table class="t">${z.labels.map((l, i) => `<tr><td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${cols[i]};vertical-align:-1px;margin-right:8px"></span>${esc(l)}</td><td class="n">${fmt(100 * z.share[i], 1)}%</td></tr>`).join('')}</table>
    <p class="note">Pixels inside the area: ${s.pixelsInside.toLocaleString('en-GB')}. ${r.meta.cropOnly ? `At least half cropland: ${s.pixelsMasked.toLocaleString('en-GB')}.` : ''} Analysed (valid in the season and the baseline): ${s.pixelsAnalysed.toLocaleString('en-GB')}, each ${fmt(s.pixelAreaKm2, 4)} km².</p>`;
}
function renderRun(r) {
  const m = r.meta, s = r.summary;
  document.querySelector('[data-tabpane="run"]').innerHTML = `<table class="t">
    <tr><td>Area</td><td>${esc(m.label || '')} · ${fmt(m.aoiAreaKm2, 0)} km²</td></tr>
    <tr><td>Season</td><td>${esc(m.season.start)} to ${esc(m.season.end)}, ${m.year}; baseline ${m.baseline[0]}–${m.baseline[1]}${s.baseline.missingYears.length ? ` (no composites in ${s.baseline.missingYears.join(', ')})` : ''}</td></tr>
    <tr><td>Composites</td><td>${m.composites.length} composites, ${esc(m.sensor)}</td></tr>
    <tr><td>Rules</td><td>NDVI kept where pixel reliability is 0 or 1; a season mean needs ${Math.round(m.params.minSeasonShare * 100)}% of composites; the baseline needs ${fmt(m.params.minBaselineShare * 100, 0)}% of years${m.cropOnly ? `; cropland share ≥ ${Math.round(m.params.cropMin * 100)}%` : ''}</td></tr>
    <tr><td>Software</td><td>AgroSignal ${esc(m.version)}, run ${esc(m.runAt.slice(0, 16).replace('T', ' '))} UTC</td></tr>
    </table><details class="more"><summary>Log</summary><ol class="small">${m.log.map(l => `<li>${fmt(l.t, 1)} s · ${esc(l.msg)}</li>`).join('')}</ol></details>
    <p class="note">${Object.values(m.sources).map(esc).join(' · ')}</p>`;
}
window.addEventListener('resize', () => { if (S.result) { renderYears(S.result); renderCurve(S.result); } });

// ---------------------------------------------------------------- downloads
const fileBase = () => { const m = S.result.meta; return `agrosignal_${m.year}_${m.season.start.slice(0, 2)}-${m.season.end.slice(0, 2)}`; };
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
document.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', async () => {
  if (!S.result) return;
  const k = b.dataset.x;
  try {
    if (k === 'png') return save(await mapPng(), `${fileBase()}_${S.layer}.png`);
    if (k === 'print') return printReport();
    const ext = { geotiff: '.tif', years: '_years.csv', pixels: '_pixels.csv', json: '.json' }[k];
    b.disabled = true; const { blob } = await ask('export', { kind: k }); save(blob, fileBase() + ext);
  } catch (e) { status(`Download failed: ${e.message}`, 'err'); }
  finally { b.disabled = false; }
}));
async function mapPng() {
  await new Promise(r => { map.once('render', r); map.triggerRepaint(); });
  const src = map.getCanvas(), c = document.createElement('canvas'), dpr = window.devicePixelRatio || 1, foot = 48 * dpr;
  c.width = src.width; c.height = src.height + foot;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0);
  const m = S.result.meta, L = LAYERS[S.layer];
  ctx.fillStyle = INK; ctx.font = `${13 * dpr}px Satoshi, sans-serif`;
  ctx.fillText(`AgroSignal · ${L.name} · ${seasonLabel(m)} against ${m.baseline[0]}–${m.baseline[1]} · ${m.label || ''}`, 10 * dpr, src.height + 19 * dpr);
  ctx.fillStyle = '#55544e'; ctx.font = `${10 * dpr}px Satoshi, sans-serif`;
  ctx.fillText(`MODIS ${m.sensor} v061 (NASA LP DAAC, via Planetary Computer); ESA WorldCover 2021. Basemap © OpenStreetMap contributors, OpenFreeMap.`, 10 * dpr, src.height + 36 * dpr);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
async function printReport() {
  const r = S.result, s = r.summary, m = r.meta, cl = s.climate, img = URL.createObjectURL(await mapPng());
  document.querySelector('.tabs [data-tab="years"]').click();
  const yimg = $('c-years').toDataURL(), rimg = $('c-rain').toDataURL();
  $('report').innerHTML = `<h1>AgroSignal report</h1><p>${esc(m.label || 'Area')} · ${fmt(m.aoiAreaKm2, 0)} km² · ${seasonLabel(m)} against ${m.baseline[0]}–${m.baseline[1]} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
    <img src="${img}" alt="Map: ${esc(LAYERS[S.layer].name)}">
    <h2>Result</h2><table>
    <tr><td>Season NDVI (regional mean)</td><td>${fmt(s.target.ndvi, 3)}; baseline ${fmt(s.baseline.ndviMean, 3)} ± ${fmt(s.baseline.ndviSd, 3)} (SD)</td></tr>
    <tr><td>Regional z-score</td><td>${sgn(s.regionalZ)}; higher than ${s.target.rankBelow} of ${s.target.baselineSeasons} baseline seasons</td></tr>
    <tr><td>Mean of pixel z-scores / anomaly / VCI</td><td>${sgn(s.target.z)} / ${sgn(s.target.anomaly, 3)} / ${fmt(s.target.vci, 0)}</td></tr>
    <tr><td>Pixels analysed</td><td>${s.pixelsAnalysed.toLocaleString('en-GB')} ${m.cropOnly ? '(at least half cropland)' : ''}</td></tr>
    <tr><td>Rainfall (CHIRPS)</td><td>${ok(cl.rain) ? `${fmt(cl.rain, 0)} mm; baseline ${fmt(cl.rainMean, 0)} mm (${sgn(cl.rainPct, 0)}%)` : esc(cl.rainNote || 'unavailable')}</td></tr>
    <tr><td>Temperature (NASA POWER)</td><td>${ok(cl.t2m) ? `${fmt(cl.t2m, 1)} °C; baseline ${fmt(cl.t2mMean, 1)} °C` : esc(cl.tempNote || 'unavailable')}</td></tr></table>
    <h2>Season NDVI by year</h2><img src="${yimg}" alt="Season NDVI by year"><img src="${rimg}" alt="Season rainfall by year">
    <h2>Processing</h2><p>${m.composites.length} composites from ${esc(m.sensor)}; reliability 0–1 kept; season mean needs ${Math.round(m.params.minSeasonShare * 100)}% of composites; baseline needs ${fmt(m.params.minBaselineShare * 100, 0)}% of years. AgroSignal ${esc(m.version)}, run ${esc(m.runAt)}.</p>
    <p>${Object.values(m.sources).map(esc).join(' · ')}</p>
    <p>Limits: NDVI measures greenness, not yield. Orbit drift (Terra earlier since 2020, Aqua later since 2021) may affect recent seasons. No ground observations were used.</p>`;
  await Promise.all([...$('report').querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(res => { im.onload = res; })));
  window.print();
}

// ---------------------------------------------------------------- about
document.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => { $('dl-menu').open = false; }));
document.addEventListener('click', e => { if ($('dl-menu').open && !$('dl-menu').contains(e.target)) $('dl-menu').open = false; });
const aboutOpen = () => { $('about').hidden = false; $('about-close').focus(); }, aboutClose = () => { $('about').hidden = true; $('about-open').focus(); };
$('about-open').addEventListener('click', aboutOpen);
$('about-close').addEventListener('click', aboutClose);
$('about').addEventListener('click', e => { if (e.target === $('about')) aboutClose(); });
$('about').addEventListener('keydown', e => {   // keep Tab inside the open dialog
  if (e.key !== 'Tab') return;
  const f = [...$('about').querySelectorAll('a[href], button:not([disabled])')], first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('about').hidden) aboutClose(); $('dl-menu').open = false; if (drawing) setDraw(false); } });
syncExports();
go(0);
