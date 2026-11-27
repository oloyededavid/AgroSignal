/* AgroSignal page: welcome, three steps (place, season, result), export. Every number shown comes from the worker's run (js/pipeline.js). */
import { VERSION } from './version.js';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && v === v && Number.isFinite(v);
const fmt = (v, d = 2) => ok(v) ? new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : '–';
const sgn = (v, d = 2) => ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d) : '–';
const ordinal = k => k + (k % 100 >= 11 && k % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th');
const int = v => ok(v) ? Math.round(v).toLocaleString('en-GB') : '–';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LAST_DAY = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];   // February ends on the 28th in every year (see Method)
const PC = 'https://planetarycomputer.microsoft.com/api', LIMIT_KM2 = 2500, NOMINATIM = 'https://nominatim.openstreetmap.org', R_SINU = 6371007.181;
document.querySelectorAll('[data-ver]').forEach(e => { e.textContent = VERSION; });

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
worker.onerror = e => {
  const err = new Error(`The analysis engine stopped (${e.message || 'script error'}). Reload the page and try again.`);
  for (const [id, p] of pending) { pending.delete(id); p.reject(err); }
};
const ask = (cmd, payload = {}, onProgress) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ cmd, id, ...payload });
});

// ---------------------------------------------------------------- state and views
const S = { aoi: null, result: null, layer: 'z', running: false, view: 'place' };
const STEP_OF = { place: 'place', season: 'season', running: 'season', error: 'season', result: 'result' };
const ORDER = ['place', 'season', 'result'];
function show(v) {
  S.view = v;
  document.querySelectorAll('[data-view]').forEach(el => { el.hidden = el.dataset.view !== v; });
  syncStepper();
  $('app').querySelector('.panel').scrollTop = 0;
  const h = document.querySelector(`[data-view="${v}"] h2`); if (h && $('welcome').hidden) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}
function syncStepper() {
  const cur = ORDER.indexOf(STEP_OF[S.view]);
  const can = { place: !S.running, season: !S.running && !!(S.aoi && S.aoi.ok), result: !S.running && !!S.result };
  document.querySelectorAll('#stepper li').forEach(li => {
    const k = ORDER.indexOf(li.dataset.s), b = li.querySelector('button');
    li.classList.toggle('on', k === cur); li.classList.toggle('done', k < cur);
    b.disabled = !can[li.dataset.s]; b.setAttribute('aria-current', k === cur ? 'step' : 'false');
  });
}
document.querySelectorAll('#stepper button').forEach(b => b.addEventListener('click', () => show(b.parentElement.dataset.s)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));

// welcome: the front door; closing it reveals the app
function closeWelcome() { $('welcome').hidden = true; $('app').inert = false; $('home').hidden = false; document.body.classList.remove('welcoming'); map.resize(); }
function openWelcome() { if (S.running) return; $('welcome').hidden = false; $('app').inert = true; $('home').hidden = true; document.body.classList.add('welcoming'); $('w-q').value = ''; $('w-q').focus(); }
document.body.classList.add('welcoming'); $('app').inert = true;
$('w-skip').addEventListener('click', () => { closeWelcome(); show('place'); firstTour(); });
$('home').addEventListener('click', openWelcome);
$('how-open').addEventListener('click', () => openTour(0));

// onboarding: three short screens, shown once on first use (remembered in this browser) and from "How it works"
const TOUR = [
  { h: 'Choose a place', t: 'Search a district or town, or draw a box on the map. Any farming area from 1 to 2,500 km².',
    art: '<div class="mk"><div class="mk-field">Search a place</div><div class="mk-box"></div></div>' },
  { h: 'Set the season', t: 'Months and year are filled in for your latitude. Change them to match the crop, then press Analyse.',
    art: '<div class="mk"><div class="mk-row"><div class="mk-field sel">Jun<span>▾</span></div><div class="mk-field sel">Oct<span>▾</span></div><div class="mk-field sel">2026<span>▾</span></div></div><div class="mk-btn">Analyse season</div></div>' },
  { h: 'Read and export', t: 'A plain verdict against twenty years, a map of every field, charts, and files for reports or GIS.',
    art: '<div class="mk"><div class="mk-verdict">Greener than usual</div><div class="pv-scale"><i></i><i></i><i></i><i class="on"></i><i></i></div><div class="mk-chips"><span>Report</span><span>GeoTIFF</span><span>CSV</span><span>Map image</span><span>Share link</span></div></div>' },
];
let tourAt = 0;
function renderTour() {
  const T = TOUR[tourAt];
  $('tour-art').innerHTML = T.art; $('tour-n').textContent = `Step ${tourAt + 1} of ${TOUR.length}`; $('tour-h').textContent = T.h; $('tour-t').textContent = T.t;
  document.querySelectorAll('#tour-dots i').forEach((d, i) => d.classList.toggle('on', i === tourAt));
  $('tour-next').textContent = tourAt === TOUR.length - 1 ? 'Start' : 'Next';
  $('tour-skip').hidden = tourAt === TOUR.length - 1;
}
function openTour(k) { tourAt = k; renderTour(); if (!$('tour').open) $('tour').showModal(); $('tour-next').focus(); }
function closeTour() { $('tour').close(); try { localStorage.setItem('agrosignal.tour', '1'); } catch { /* storage may be blocked */ } }
function firstTour() { let seen = false; try { seen = localStorage.getItem('agrosignal.tour') === '1'; } catch { /* treat as not seen */ } if (!seen) openTour(0); }
$('tour-next').addEventListener('click', () => { if (tourAt < TOUR.length - 1) { tourAt++; renderTour(); } else closeTour(); });
$('tour-skip').addEventListener('click', closeTour);
$('tour').addEventListener('cancel', () => { try { localStorage.setItem('agrosignal.tour', '1'); } catch { /* ignore */ } });

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: [10, 15], zoom: 2.2,
  attributionControl: false, preserveDrawingBuffer: true });
const FALLBACK_STYLE = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9ecef' } }] };
let styleFallback = false;
map.on('error', e => { if (styleFallback || map.isStyleLoaded() || (e && e.sourceId)) return; styleFallback = true; $('mapnote').hidden = false; map.setStyle(FALLBACK_STYLE); });
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
const PHONE = matchMedia('(max-width: 860px)').matches;
if (!PHONE) map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
if (PHONE) map.once('load', () => document.querySelectorAll('.maplibregl-ctrl-attrib').forEach(e => { e.classList.remove('maplibregl-compact-show'); e.removeAttribute('open'); }));
const ready = new Promise(r => map.on('load', r));
const EMPTY = { type: 'FeatureCollection', features: [] };
ready.then(() => {
  const first = map.getStyle().layers.find(l => l.type === 'symbol');
  map.addSource('aoi', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi', paint: { 'fill-color': '#2b55c7', 'fill-opacity': 0.06 } });
  map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#15171c', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
  map.addSource('ras', { type: 'image', url: blankPng(), coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]] });
  map.addLayer({ id: 'ras', type: 'raster', source: 'ras', paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }, layout: { visibility: 'none' } }, first && first.id);
});
function blankPng() { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL(); }
const fit = b => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: PHONE ? 30 : { top: 70, bottom: 50, left: 50, right: 300 }, duration: 800, maxZoom: 11 });

// ---------------------------------------------------------------- place
const ringOf = b => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]];
const boxKm2 = b => { const R = 6371.0088, r = Math.PI / 180; return R * R * Math.abs((b[2] - b[0]) * r) * Math.abs(Math.sin(b[3] * r) - Math.sin(b[1] * r)); };
async function setAoi(b, label, note) {
  if (S.running) { worker.postMessage({ cmd: 'cancel', id: 0 }); runSeq++; S.running = false; }   // a new place ends the running analysis
  const shift = Math.round(((b[0] + b[2]) / 2) / 360) * 360;   // the map repeats sideways: bring the box back to -180..180
  b = [b[0] - shift, Math.max(-60, b[1]), b[2] - shift, Math.min(80, b[3])];
  const area = boxKm2(b), crosses = b[0] < -180 || b[2] > 180;
  const problem = crosses ? 'The box crosses the 180° meridian. Draw it on one side.'
    : area > LIMIT_KM2 ? `Larger than the ${int(LIMIT_KM2)} km² limit. Draw a smaller box.`
    : area < 1 ? 'Smaller than the 1 km² minimum. Draw a larger box.' : '';
  if (S.result && !S.running) clearResult();
  S.aoi = { bbox: b, ring: ringOf(b), area, label, ok: !problem };
  await ready;
  map.getSource('aoi').setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [S.aoi.ring] } });
  const c = $('chosen'); c.hidden = false; c.classList.toggle('bad', !!problem);
  c.innerHTML = `<b>${esc(label)}</b><span class="meta">${problem ? esc(problem) : `${fmt(area, area < 10 ? 1 : 0)} km²${note ? ` · ${esc(note)}` : ''}`}</span>`;
  $('to-season').disabled = !!problem;
  $('season-place').textContent = `${label} · ${fmt(area, area < 10 ? 1 : 0)} km²`;
  checkArchive(); syncStepper();
}
$('to-season').addEventListener('click', () => show('season'));

// drawing a box
let drawing = false, start = null;
$('draw').addEventListener('click', () => setDraw(!drawing));
function setDraw(on) {
  drawing = on; $('draw').setAttribute('aria-pressed', String(on)); $('draw').textContent = on ? 'Cancel drawing' : 'Draw a box on the map';
  $('map-hint').hidden = !on;
  map.getCanvas().style.cursor = on ? 'crosshair' : ''; on ? map.dragPan.disable() : map.dragPan.enable();
  if (on && PHONE) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const boxFrom = e => [Math.min(start.lng, e.lngLat.lng), Math.min(start.lat, e.lngLat.lat), Math.max(start.lng, e.lngLat.lng), Math.max(start.lat, e.lngLat.lat)];
map.on('mousedown', e => { if (drawing) start = e.lngLat; });
map.on('touchstart', e => { if (drawing && e.points.length === 1) { start = e.lngLat; e.preventDefault(); } });
const drag = e => { if (drawing && start) map.getSource('aoi').setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ringOf(boxFrom(e))] } }); };
map.on('mousemove', drag); map.on('touchmove', drag);
const finish = e => {
  if (!drawing || !start) return;
  const b = boxFrom(e); start = null; setDraw(false);
  if (b[2] - b[0] < 1e-3 || b[3] - b[1] < 1e-3) {   // a click, not a box
    map.getSource('aoi').setData(S.aoi ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [S.aoi.ring] } } : EMPTY);
    $('map-hint').hidden = false; $('map-hint').textContent = 'Press and drag to draw a box'; setTimeout(() => { if (!drawing) $('map-hint').hidden = true; $('map-hint').textContent = 'Drag across the map to draw your area'; }, 2200);
    return;
  }
  setAoi(b, 'Drawn area'); seasonDefaults((b[1] + b[3]) / 2);
};
map.on('mouseup', finish); map.on('touchend', finish);

// place search (welcome and step 1 share it)
function bindSearch(form, input, list, after) {
  const msg = t => { list.hidden = false; list.innerHTML = `<li class="msg">${t}</li>`; };
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const q = input.value.trim();
    if (!q) { msg('Type a place name, for example a district or town.'); input.focus(); return; }
    msg('Searching…');
    try {
      const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`search failed (${r.status})`);
      const found = await r.json();
      if (!found.length) { msg('No place found. Try a larger town or region nearby.'); return; }
      list.innerHTML = '';
      for (const p of found) {
        const li = document.createElement('li'), b = document.createElement('button'), parts = p.display_name.split(', ');
        b.type = 'button'; b.innerHTML = `<b>${esc(parts[0])}</b><span>${esc(parts.slice(1).join(', '))}</span>`;
        b.onclick = async () => {
          list.hidden = true; input.value = parts[0];
          const lat = +p.lat, lon = +p.lon, k = 0.15 / Math.cos(lat * Math.PI / 180);   // about 33 x 33 km around the place
          const box = [lon - k, lat - 0.15, lon + k, lat + 0.15], name = p.name || parts[0];
          const wide = ['country', 'state', 'region', 'province', 'county', 'administrative'].includes(p.addresstype || p.type);
          after();
          await setAoi(box, `${name}, ${parts[parts.length - 1]}`, wide ? 'a box at its centre; draw to choose fields' : 'a 33 km box around it');
          fit(box); seasonDefaults(lat);
          if (S.aoi.ok) show('season');
        };
        li.append(b); list.append(li);
      }
      list.querySelector('button').focus();
    } catch (e) { msg(`Place search is unavailable (${esc(e.message)}). Use the map to draw a box instead.`); }
  });
  document.addEventListener('click', e => { if (!form.contains(e.target)) list.hidden = true; });
}
bindSearch($('w-search'), $('w-q'), $('w-results'), () => { closeWelcome(); firstTour(); });
bindSearch($('search'), $('q'), $('results'), () => {});

// ---------------------------------------------------------------- season
const now = new Date(), thisYear = now.getUTCFullYear();
const opt = (v, t) => `<option value="${v}">${t}</option>`;
$('m0').innerHTML = MONTHS.map((m, i) => opt(i + 1, m.slice(0, 3))).join(''); $('m1').innerHTML = $('m0').innerHTML;
const yearsOpts = Array.from({ length: thisYear - 2000 }, (_, i) => 2001 + i);
$('year').innerHTML = yearsOpts.slice().reverse().map(y => opt(y, y)).join('');
$('b0').innerHTML = yearsOpts.map(y => opt(y, y)).join(''); $('b1').innerHTML = $('b0').innerHTML;
const setv = (id, v) => { $(id).value = String(v); };
setv('m0', 6); setv('m1', 10); setv('b0', 2001); setv('b1', 2020);
const pad = n => String(n).padStart(2, '0');
const seasonEnd = (year, m0, m1) => new Date(Date.UTC(year + (m1 < m0 ? 1 : 0), m1, 1));   // first day after the season
function latestYear(m0, m1) { for (let y = thisYear; y >= 2001; y--) if (seasonEnd(y, m0, m1) <= now) return y; return 2001; }
// default months by latitude: a starting point only, said so on the page
function seasonDefaults(lat) {
  const [m0, m1, what] = lat < -5 ? [11, 3, 'the southern summer season'] : lat > 40 ? [5, 8, 'the northern summer season'] : [6, 10, 'the northern rainy season'];
  setv('m0', m0); setv('m1', m1); setv('year', latestYear(m0, m1));
  $('season-hint').textContent = `Set to ${what}, the most recent one that has finished. Change it to match your crop.`;
  checkSeason();
}
function seasonArgs() {
  const m0 = +$('m0').value, m1 = +$('m1').value;
  return { season: { start: `${pad(m0)}-01`, end: `${pad(m1)}-${LAST_DAY[m1 - 1]}` }, year: +$('year').value, baseline: [+$('b0').value, +$('b1').value], crosses: m1 < m0, m0, m1 };
}
function seasonProblem() {
  const a = seasonArgs(), [b0, b1] = a.baseline;
  if (seasonEnd(a.year, a.m0, a.m1) > now) return `The ${a.year} season has not finished yet. Choose an earlier year.`;
  if (b1 - b0 < 9) return 'The comparison period needs at least 10 years (Advanced settings).';
  if ($('sensor').value === 'aqua' && (b0 < 2003 || a.year < 2003)) return 'Aqua seasons start in 2003.';
  if (a.year >= b0 && a.year <= b1) return `${a.year} is inside the comparison years ${b0}–${b1}. Choose a year outside them, or change them in Advanced settings.`;
  if (seasonEnd(b1, a.m0, a.m1) > now) return 'The last comparison season has not finished yet.';
  return '';
}
// a quick look at the archive before a run: some seasons have gaps (July to October 2025 had none at the places checked)
let archSeq = 0, archTimer = null;
function checkArchive() {
  clearTimeout(archTimer); const mine = ++archSeq; $('archive-msg').hidden = true;
  if (!S.aoi || !S.aoi.ok || seasonProblem()) return;
  archTimer = setTimeout(async () => {
    const a = seasonArgs(), endY = a.year + (a.crosses ? 1 : 0);
    const t0 = `${a.year}-${a.season.start}T00:00:00Z`, t1 = `${endY}-${a.season.end}T23:59:59Z`;
    const pre = $('sensor').value === 'aqua' ? 'MYD13Q1.' : 'MOD13Q1.', days = (Date.parse(t1) - Date.parse(t0)) / 864e5;
    const expected = Math.max(1, Math.round(days / 16)), need = Math.ceil(expected * 0.5);
    try {
      const r = await fetch(`${PC}/stac/v1/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ collections: ['modis-13Q1-061'], bbox: S.aoi.bbox, datetime: `${t0}/${t1}`, limit: 200 }) });
      if (!r.ok || mine !== archSeq) return;
      const f = (await r.json()).features || [], dates = new Set(f.filter(x => x.id.startsWith(pre)).map(x => x.properties.start_datetime.slice(0, 10)));
      if (mine !== archSeq || dates.size >= need) return;
      $('archive-msg').textContent = f.length === 0
        ? 'The satellite archive has no images for this place and season. Open sea has none; if this is land, choose another year.'
        : `The satellite archive has only ${dates.size} of about ${expected} images for this season here, too few to analyse. Choose another year.`;
      $('archive-msg').hidden = false;
    } catch (e) { /* advisory only; the run reports the same problem */ }
  }, 400);
}
function checkSeason() {
  if (!S.running && S.result) clearResult();
  const p = seasonProblem(), a = seasonArgs();
  $('season-msg').hidden = !p; $('season-msg').textContent = p;
  $('base-label').textContent = `${a.baseline[0]}–${a.baseline[1]}`;
  $('run').disabled = !!p || !(S.aoi && S.aoi.ok);
  checkArchive();
}
['m0', 'm1', 'year', 'b0', 'b1', 'crop'].forEach(id => $(id).addEventListener('change', checkSeason));
$('sensor').addEventListener('change', () => {   // Aqua starts in 2002: move the comparison start rather than show an error
  if ($('sensor').value === 'aqua' && +$('b0').value < 2003) { setv('b0', 2003); if (+$('b1').value - 2003 < 9) setv('b1', 2012); }
  checkSeason();
});
checkSeason();

// ---------------------------------------------------------------- examples (settings as in docs/validation/global-check.txt and the Kano tests)
const EXAMPLES = [
  { short: 'Kano', year: 2026, when: 'Jun–Oct 2026', label: 'Farmland near Bagwai, Kano, Nigeria', bbox: [8.0, 12.0, 8.4, 12.4], m0: 6, m1: 10, b0: 2001, b1: 2020 },
  { short: 'Hungary', year: 2022, when: 'Jun–Aug 2022', label: 'Farmland near Szentes, Hungary', bbox: [20.0, 46.5, 20.4, 46.8], m0: 6, m1: 8, b0: 2001, b1: 2020 },
  { short: 'Saskatchewan', year: 2021, when: 'May–Aug 2021', label: 'Farmland near Saskatoon, Saskatchewan, Canada', bbox: [-106.8, 51.9, -106.4, 52.2], m0: 5, m1: 8, b0: 2003, b1: 2020 },
];
$('examples').innerHTML = EXAMPLES.map((e, i) => `<button class="ex" type="button" data-ex="${i}" title="${e.label}, ${e.when}">${e.short}<span>${e.year}</span></button>`).join('');
document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => runExample(EXAMPLES[+b.dataset.ex])));
async function runExample(e) {
  closeWelcome();
  setv('sensor', 'terra'); $('crop').checked = true;
  await setAoi(e.bbox, e.label); fit(e.bbox);
  setv('m0', e.m0); setv('m1', e.m1); setv('year', e.year); setv('b0', e.b0); setv('b1', e.b1);
  $('season-hint').textContent = ''; checkSeason();
  runNow();
}

// ---------------------------------------------------------------- run
let runSeq = 0;
const STAGES = ['find', 'read', 'crop', 'weather'];
function stage(k) { const i = STAGES.indexOf(k); document.querySelectorAll('#stages li').forEach(li => { const j = STAGES.indexOf(li.dataset.k); li.className = j < i ? 'ok' : j === i ? 'on' : ''; }); }
const seasonText = (m0, m1, year) => `${MONTHS[m0 - 1].slice(0, 3)}–${MONTHS[m1 - 1].slice(0, 3)} ${year}${m1 < m0 ? `/${String(year + 1).slice(2)}` : ''}`;
$('run').addEventListener('click', () => runNow());
$('cancel').addEventListener('click', () => { worker.postMessage({ cmd: 'cancel', id: 0 }); });
async function runNow() {
  if (!S.aoi || !S.aoi.ok || seasonProblem()) { show(S.aoi && S.aoi.ok ? 'season' : 'place'); return; }
  const mine = ++runSeq, a = seasonArgs();
  if (S.result) clearResult();
  S.running = true; show('running'); stage('find'); $('bar').style.width = '3%'; $('read-n').textContent = '';
  $('run-what').textContent = `${S.aoi.label} · ${seasonText(a.m0, a.m1, a.year)} against ${a.baseline[0]}–${a.baseline[1]}`;
  if (PHONE) $('app').querySelector('.panel').scrollIntoView({ behavior: 'smooth' });
  const onProgress = msg => {
    if (mine !== runSeq) return;
    const n = msg.match(/^Read (\d+) of (\d+)/);
    if (n) { stage('read'); $('read-n').textContent = `${Math.round(100 * +n[1] / +n[2])}%`; $('bar').style.width = `${6 + 80 * (+n[1] / +n[2])}%`; }
    else if (/WorldCover/.test(msg)) { stage('crop'); $('read-n').textContent = ''; $('bar').style.width = '88%'; }
    else if (/CHIRPS|POWER/.test(msg)) { stage('weather'); $('bar').style.width = /POWER/.test(msg) ? '96%' : '92%'; }
  };
  try {
    const r = await ask('run', { args: { aoi: { type: 'Polygon', coordinates: [S.aoi.ring] }, season: a.season, year: a.year, baseline: a.baseline,
      cropOnly: $('crop').checked, label: S.aoi.label, sensor: $('sensor').value } }, onProgress);
    if (mine !== runSeq) return;
    S.result = r; S.running = false; $('bar').style.width = '100%';
    showResult(r);
  } catch (e) {
    if (mine !== runSeq) return;
    S.running = false;
    if (e.message === 'Cancelled') { show('season'); return; }
    $('err-msg').textContent = e.message; show('error');
  }
}

// ---------------------------------------------------------------- map layers
// Diverging brown – grey – teal (greener), kept apart for red–green colour-blind readers (project-notes/tools/colour_check.py)
const DIV = ['#8c510a', '#d8b365', '#f6e8c3', '#f2f2ee', '#c7eae5', '#5ab4ac', '#01665e'];
const SEQ = ['#f2f0e6', '#d7e3b9', '#a9cb88', '#73ad5c', '#3f8a37', '#1d5e23'];
const LAYERS = {
  z: { name: 'How unusual (z-score)', key: 'z', ramp: DIV, min: -2.5, max: 2.5, ends: ['Browner', 'Usual', 'Greener'], unit: '−2.5 to +2.5 standard deviations', d: 2 },
  anom: { name: 'Change in greenness', key: 'anom', ramp: DIV, min: -0.15, max: 0.15, ends: ['−0.15', '0', '+0.15'], unit: 'NDVI against the usual', d: 3 },
  vci: { name: 'Condition (VCI)', key: 'vci', ramp: SEQ, min: 0, max: 100, ends: ['Worst', '50', 'Best'], unit: 'within the comparison years, 0–100', d: 0 },
  target: { name: 'Greenness this season', key: 'target', ramp: SEQ, min: 0, max: 0.8, ends: ['0', '0.4', '0.8'], unit: 'mean NDVI', d: 3 },
  crop: { name: 'Cropland share', key: 'crop', ramp: SEQ, min: 0, max: 1, ends: ['0%', '50%', '100%'], unit: 'ESA WorldCover 2021', d: 0, all: true },
};
$('layer').innerHTML = Object.entries(LAYERS).map(([k, L]) => opt(k, L.name)).join('');
$('layer').addEventListener('change', () => { S.layer = $('layer').value; paint(); });
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function colour(ramp, t) {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1); const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i;
  const a = hex(ramp[i]), b = hex(ramp[i + 1]); return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
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
  $('legend').innerHTML = `<div class="ramp" style="background:linear-gradient(90deg, ${L.ramp.join(', ')})"></div>
    <div class="ends"><span>${L.ends[0]}</span><span>${L.ends[1]}</span><span>${L.ends[2]}</span></div>
    <div class="small">${esc(L.unit)}${L.all ? '' : r.meta.cropOnly ? ' · cropland only' : ''}</div>`;
  $('layer-card').hidden = false;
}
// hover values on the map
const tip = $('tip');
function placeTip(x, y) { tip.style.left = `${Math.min(x + 14, window.innerWidth - 230)}px`; tip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - 170))}px`; }
map.on('mousemove', e => {
  if (!S.result || drawing) { tip.hidden = true; return; }
  const r = S.result, i = cellAt(e.lngLat.lng, e.lngLat.lat);
  if (i < 0 || !r.inside[i]) { tip.hidden = true; return; }
  const v = a => a[i];
  tip.innerHTML = `<strong>${r.fixed[i] ? 'Analysed pixel' : r.mask[i] ? 'Too little valid data' : r.meta.cropOnly ? 'Not cropland' : 'Pixel'}</strong><dl>
    <dt>z-score</dt><dd>${sgn(v(r.z))}</dd><dt>Greenness ${r.meta.year}</dt><dd>${fmt(v(r.target), 3)}</dd><dt>Usual</dt><dd>${fmt(v(r.baseMean), 3)}</dd>
    <dt>Condition</dt><dd>${fmt(v(r.vci), 0)}</dd><dt>Cropland</dt><dd>${ok(v(r.crop)) ? fmt(100 * v(r.crop), 0) + '%' : '–'}</dd></dl>`;
  tip.hidden = false; placeTip(e.originalEvent.clientX, e.originalEvent.clientY);
});
map.getCanvas().addEventListener('mouseleave', () => { tip.hidden = true; });

// ---------------------------------------------------------------- result
const CLASS = [
  { t: 'Much browner', c: DIV[0] }, { t: 'Browner', c: DIV[1] }, { t: 'Usual', c: '#a9adb5' }, { t: 'Greener', c: DIV[5] }, { t: 'Much greener', c: DIV[6] }];
const classOf = z => !ok(z) ? -1 : z < -1.5 ? 0 : z < -0.5 ? 1 : z < 0.5 ? 2 : z < 1.5 ? 3 : 4;   // same edges as engine.zClasses
function seasonLabel(m) { return seasonText(+m.season.start.slice(0, 2), +m.season.end.slice(0, 2), m.year); }
function clearResult() {
  S.result = null; tip.hidden = true;
  if (map.getLayer('ras')) map.setLayoutProperty('ras', 'visibility', 'none');
  $('layer-card').hidden = true; syncStepper();
  if (location.search) history.replaceState(null, '', location.pathname);
}
const share = v => v === 0 ? '0%' : v < 0.001 ? 'under 0.1%' : v < 0.01 ? `${fmt(v * 100, 1)}%` : `${fmt(v * 100, 0)}%`;
const strength = r => { const a = Math.abs(r); return a < 0.3 ? 'weak' : a < 0.6 ? 'moderate' : 'strong'; };
function showResult(r) {
  const s = r.summary, t = s.target, cl = s.climate, m = r.meta, z = s.regionalZ, k = classOf(z), n = t.baselineSeasons;
  $('r-where').textContent = `${m.label || 'Area'} · ${seasonLabel(m)} against ${m.baseline[0]}–${m.baseline[1]}`;
  $('r-verdict').textContent = k < 0 ? 'No verdict for this season' : k === 2 ? 'A usual season' : `${CLASS[k].t} than usual`;
  $('r-scale').innerHTML = CLASS.map((c, i) => `<div style="--c:${c.c}" class="${i === k ? 'on' : ''}">${c.t}</div>`).join('');
  $('r-scale').setAttribute('aria-label', `Verdict scale; this season: ${k < 0 ? 'none' : CLASS[k].t}`);
  const rank = !n ? 'No comparison seasons had enough data' : t.rankBelow === n ? `Greener than all ${n} comparison seasons` : t.rankBelow === 0 ? `Browner than all ${n} comparison seasons` : `Greener than ${t.rankBelow} of ${n} comparison seasons`;
  let rain = '';
  if (ok(cl.rain) && ok(cl.rainPct)) {
    const rz = ok(cl.rainSd) && cl.rainSd > 0 ? (cl.rain - cl.rainMean) / cl.rainSd : NaN;
    rain = ` Rainfall (CHIRPS estimate) was ${fmt(Math.abs(cl.rainPct), 0)}% ${cl.rainPct >= 0 ? 'above' : 'below'} average${ok(rz) ? `, ${Math.abs(rz) < 0.5 ? 'within the usual range' : Math.abs(rz) < 1.5 ? (rz > 0 ? 'a wet season' : 'a dry season') : (rz > 0 ? 'a very wet season' : 'a very dry season')}` : ''}.`;
  }
  $('r-reading').textContent = `${rank}.${rain}`;
  const stat = (l, v, d) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  $('r-stats').innerHTML = stat('Greenness', fmt(t.ndvi, 3), `usual ${fmt(s.baseline.ndviMean, 3)}`)
    + stat('Rank', `${ordinal(n - t.rankBelow + 1)}<small>of ${n + 1}</small>`, 'seasons, by greenness')
    + stat('Rainfall estimate', ok(cl.rain) && ok(cl.rainPct) ? `${sgn(cl.rainPct, 0)}<small>%</small>` : '–', ok(cl.rain) ? `${int(cl.rain)} vs ${int(cl.rainMean)} mm` : 'not available');
  const drift = /terra/i.test(m.sensor) ? 2020 : 2021, recent = m.year > drift && m.baseline[1] <= drift;
  $('r-caution').hidden = !recent;
  if (recent) $('r-caution').textContent = `Check with care: the ${/terra/i.test(m.sensor) ? 'Terra' : 'Aqua'} satellite's orbit has drifted since ${drift}. Rerun with ${/terra/i.test(m.sensor) ? 'Aqua' : 'Terra'} in Advanced settings to confirm.`;
  // share of pixels in each class
  const zc = s.zClasses, cols = CLASS.map(c => c.c);
  const shares = zc.share.map(v => ok(v) ? v : 0);
  $('r-split').innerHTML = shares.map((v, i) => `<div style="width:${100 * v}%;background:${cols[i]}" title="${esc(zc.labels[i])}: ${share(v)}"></div>`).join('');
  $('r-splitkey').innerHTML = shares.map((v, i) => `<li><i style="background:${cols[i]}"></i>${CLASS[i].t}<b>${share(v)}</b></li>`).join('');
  renderRun(r);
  show('result'); paint(); shareUrl(); showChart('years');
  if (PHONE) window.scrollTo({ top: $('r-verdict').getBoundingClientRect().top + window.scrollY - 180, behavior: 'smooth' });
}
function renderRun(r) {
  const m = r.meta, s = r.summary, cl = s.climate, a = s.association;
  const rows = [
    ['Area', `${esc(m.label || '')}, ${fmt(m.aoiAreaKm2, 0)} km²`],
    ['Season', `${esc(m.season.start)} to ${esc(m.season.end)}, ${m.year}`],
    ['Compared with', `${m.baseline[0]}–${m.baseline[1]}${s.baseline.missingYears.length ? ` (no images in ${s.baseline.missingYears.join(', ')})` : ''}`],
    ['Greenness', `${fmt(s.target.ndvi, 3)}; usual ${fmt(s.baseline.ndviMean, 3)} ± ${fmt(s.baseline.ndviSd, 3)}; regional z-score ${sgn(s.regionalZ)}; mean pixel z ${sgn(s.target.z)}; change ${sgn(s.target.anomaly, 3)}; VCI ${fmt(s.target.vci, 0)}`],
    ['Pixels', `${s.pixelsInside.toLocaleString('en-GB')} in the area${m.cropOnly ? `, ${s.pixelsMasked.toLocaleString('en-GB')} at least half cropland` : ''}, ${s.pixelsAnalysed.toLocaleString('en-GB')} analysed (${fmt(s.pixelAreaKm2, 4)} km² each)`],
    ['Rainfall', ok(cl.rain) ? `${int(cl.rain)} mm over ${cl.rainMonths.length} months; usual ${int(cl.rainMean)} mm; ${cl.rainFallback ? 'the one CHIRPS cell containing the area (the area is smaller than a cell)' : `${cl.rainCells} CHIRPS cell${cl.rainCells === 1 ? '' : 's'}`}; CHIRPS is a satellite and station estimate${ok(a.ndviRainR) ? `. Greenness and rainfall correlate at r = ${fmt(a.ndviRainR, 2)} (${strength(a.ndviRainR)}) over the comparison years; that is association, not cause` : ''}` : esc(cl.rainNote || 'not available')],
    ['Temperature', ok(cl.t2m) ? `${fmt(cl.t2m, 1)} °C; usual ${fmt(cl.t2mMean, 1)} °C (NASA POWER)` : esc(cl.tempNote || 'not available')],
    ['Images', `${m.composites.length} composites from ${esc(m.sensor)}`],
    ['Rules', `quality 0–1 kept; a season needs ${Math.round(m.params.minSeasonShare * 100)}% of images valid; the comparison needs ${fmt(m.params.minBaselineShare * 100, 0)}% of years${m.cropOnly ? `; cropland share ≥ ${Math.round(m.params.cropMin * 100)}%` : ''}`],
    ['Software', `AgroSignal ${esc(m.version)}, run ${esc(m.runAt.slice(0, 16).replace('T', ' '))} UTC`],
    ['Sources', Object.values(m.sources).map(esc).join('; ')],
  ];
  $('r-run').innerHTML = `<table class="kv">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
}
function shareUrl() {
  const r = S.result; if (!r) return location.href;
  const u = new URL(location.href.split('#')[0]); u.search = '';
  const q = { bbox: S.aoi.bbox.map(v => (+v).toFixed(5)).join(','), label: S.aoi.label || '', m0: $('m0').value, m1: $('m1').value, year: $('year').value, b0: $('b0').value, b1: $('b1').value, crop: $('crop').checked ? 1 : 0, sensor: $('sensor').value };
  Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, v)); history.replaceState(null, '', u); return u.href;
}
$('new-run').addEventListener('click', () => show('place'));

// ---------------------------------------------------------------- charts
const INK = '#15171c', INK3 = '#7b8190', RULE = '#e7e9ee', BASE = '#a9adb5', HUE = '#2b55c7';
function showChart(t) {
  document.querySelectorAll('[data-chart]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.chart === t)));
  document.querySelectorAll('[data-chartpane]').forEach(p => { p.hidden = p.dataset.chartpane !== t; });
  if (S.result) t === 'years' ? renderYears(S.result) : renderCurve(S.result);
}
document.querySelectorAll('[data-chart]').forEach(b => b.addEventListener('click', () => showChart(b.dataset.chart)));
function setupCanvas(cv, h) {
  const w = cv.clientWidth || cv.parentElement.clientWidth || 360, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = `${h}px`;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = '12px Satoshi, system-ui, sans-serif';
  return { ctx, w, h };
}
function niceRange(vals, padFrac = 0.04) {
  const v = vals.filter(ok); let lo = Math.min(...v), hi = Math.max(...v); const p = (hi - lo || Math.abs(hi) || 1) * padFrac, nonneg = lo >= 0; lo -= p; hi += p; if (nonneg) lo = Math.max(0, lo);
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, Math.round((Math.ceil(hi / step) - Math.floor(lo / step)))];
}
function axisY(ctx, x0, x1, y, lo, hi, ticks, d) {
  ctx.strokeStyle = RULE; ctx.fillStyle = INK3; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= ticks; k++) { const v = lo + (hi - lo) * k / ticks, yy = y(v); ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.fillText(fmt(v, d), x0 - 6, yy); }
}
function hoverChart(cv, items, html) {
  cv.onmousemove = e => {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left;
    let best = null, bd = 1e9; for (const it of items) { const d = Math.abs(it.x - x); if (d < bd) { bd = d; best = it; } }
    if (!best || bd > 24) { tip.hidden = true; return; }
    tip.innerHTML = html(best); tip.hidden = false; placeTip(e.clientX, e.clientY - 90);
  };
  cv.onmouseleave = () => { tip.hidden = true; };
}
function yearTicks(ctx, yrs, x, w, h, B, target) {
  const every = Math.ceil(yrs.length / Math.max(3, Math.floor(w / 56)));
  const shown = new Set(yrs.filter((yr, k) => k % every === 0)); shown.add(target);
  ctx.fillStyle = INK3; ctx.textBaseline = 'top';
  [...shown].forEach(yr => { if (yr !== target && Math.abs(x(yr) - x(target)) < 32) return; ctx.textAlign = x(yr) > w - 30 ? 'right' : 'center'; ctx.fillStyle = yr === target ? INK : INK3; ctx.fillText(String(yr), x(yr) + (ctx.textAlign === 'right' ? 8 : 0), h - B + 6); });
}
function renderYears(r) {
  if ($('c-years').closest('[hidden]')) return;
  const s = r.summary, data = r.regional, yrs = data.map(d => d.year), m = r.meta;
  const { ctx, w, h } = setupCanvas($('c-years'), 180), L = 40, Rr = 10, T = 10, B = 22;
  const [lo, hi, nt] = niceRange([...data.map(d => d.ndvi), s.baseline.ndviMean - s.baseline.ndviSd, s.baseline.ndviMean + s.baseline.ndviSd]);
  const y = v => T + (hi - v) / (hi - lo) * (h - T - B);
  const x0 = yrs[0], x1 = yrs[yrs.length - 1], x = yr => L + 6 + (yr - x0) / Math.max(1, x1 - x0) * (w - L - Rr - 12);
  axisY(ctx, L, w - Rr, y, lo, hi, nt, 2);
  ctx.fillStyle = 'rgba(43,85,199,.08)'; ctx.fillRect(L, y(s.baseline.ndviMean + s.baseline.ndviSd), w - L - Rr, y(s.baseline.ndviMean - s.baseline.ndviSd) - y(s.baseline.ndviMean + s.baseline.ndviSd));
  ctx.strokeStyle = BASE; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, y(s.baseline.ndviMean)); ctx.lineTo(w - Rr, y(s.baseline.ndviMean)); ctx.stroke(); ctx.setLineDash([]);
  yearTicks(ctx, yrs, x, w, h, B, m.year);
  const items = [];
  for (const d of data) {
    if (!ok(d.ndvi)) continue;
    const tgt = d.year === m.year, xx = x(d.year), yy = y(d.ndvi);
    ctx.beginPath(); ctx.arc(xx, yy, tgt ? 6 : 3.5, 0, 7); ctx.fillStyle = tgt ? HUE : BASE; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    items.push({ x: xx, d });
  }
  const clim = yr => r.climate.find(c => c.year === yr) || {};
  hoverChart($('c-years'), items, it => `<strong>${it.d.year}${it.d.year === m.year ? ' (this season)' : ''}</strong><dl><dt>Greenness</dt><dd>${fmt(it.d.ndvi, 3)}</dd><dt>Rainfall</dt><dd>${ok(clim(it.d.year).rain) ? int(clim(it.d.year).rain) + ' mm' : '–'}</dd><dt>Pixels</dt><dd>${it.d.pixels.toLocaleString('en-GB')}</dd></dl>`);

  const rc = setupCanvas($('c-rain'), 110), c2 = rc.ctx, h2 = 110, B2 = 22;
  const rains = r.climate.map(c => c.rain).filter(ok), rItems = [];
  if (rains.length) {
    const [, rhi, rnt] = niceRange([0, ...rains]), yr2 = v => 8 + (rhi - v) / rhi * (h2 - 8 - B2);
    axisY(c2, L, w - Rr, yr2, 0, rhi, Math.min(rnt, 3), 0);
    const bw = Math.max(3, Math.min(12, (w - L - Rr) / yrs.length - 4));
    for (const c of r.climate) {
      if (!ok(c.rain)) continue;
      const xx = x(c.year), top = yr2(c.rain), bot = yr2(0);
      c2.fillStyle = c.year === m.year ? HUE : '#cfd3da'; c2.beginPath(); c2.roundRect(xx - bw / 2, top, bw, bot - top, [3, 3, 0, 0]); c2.fill();
      rItems.push({ x: xx, c });
    }
    c2.strokeStyle = BASE; c2.setLineDash([4, 3]); c2.beginPath(); c2.moveTo(L, yr2(s.climate.rainMean)); c2.lineTo(w - Rr, yr2(s.climate.rainMean)); c2.stroke(); c2.setLineDash([]);
    yearTicks(c2, yrs, x, w, h2, B2, m.year);
  } else { c2.fillStyle = INK3; c2.textBaseline = 'middle'; c2.fillText(s.climate.rainNote || 'Rainfall not available', L, 40); }
  hoverChart($('c-rain'), rItems, it => `<strong>${it.c.year}</strong><dl><dt>Rainfall</dt><dd>${int(it.c.rain)} mm</dd><dt>Temperature</dt><dd>${ok(it.c.t2m) ? fmt(it.c.t2m, 1) + ' °C' : '–'}</dd></dl>`);
}
function renderCurve(r) {
  if ($('c-curve').closest('[hidden]')) return;
  const cv = r.curve, m = r.meta, { ctx, w, h } = setupCanvas($('c-curve'), 220), L = 40, Rr = 10, T = 30, B = 22;
  const [lo, hi, nt] = niceRange(cv.flatMap(c => [c.target, c.p10, c.p90]));
  const y = v => T + (hi - v) / (hi - lo) * (h - T - B), x = k => L + 6 + k / Math.max(1, cv.length - 1) * (w - L - Rr - 12);
  axisY(ctx, L, w - Rr, y, lo, hi, nt, 2);
  ctx.fillStyle = 'rgba(169,173,181,.28)'; ctx.beginPath();
  cv.forEach((c, k) => { if (ok(c.p90)) ctx.lineTo(x(k), y(c.p90)); });
  for (let k = cv.length - 1; k >= 0; k--) if (ok(cv[k].p10)) ctx.lineTo(x(k), y(cv[k].p10));
  ctx.fill();
  const line = (key, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath(); let pen = false;
    cv.forEach((c, k) => { if (!ok(c[key])) { pen = false; return; } pen ? ctx.lineTo(x(k), y(c[key])) : ctx.moveTo(x(k), y(c[key])); pen = true; }); ctx.stroke(); ctx.setLineDash([]); };
  line('baselineMean', BASE, [4, 3]); line('target', HUE, []);
  cv.forEach((c, k) => { if (ok(c.target)) { ctx.beginPath(); ctx.arc(x(k), y(c.target), 3, 0, 7); ctx.fillStyle = HUE; ctx.fill(); } });
  const lab = md => `${+md.slice(3)} ${MONTHS[+md.slice(0, 2) - 1].slice(0, 3)}`;
  ctx.fillStyle = INK3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const every = Math.ceil(cv.length / Math.max(3, Math.floor((w - L) / 60)));
  cv.forEach((c, k) => { if (k % every === 0) ctx.fillText(lab(c.slot), x(k), h - B + 6); });
  // key, top left
  const ly = 10; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = HUE; ctx.fillRect(L, ly - 1, 14, 2.5); ctx.fillStyle = INK; ctx.fillText(String(m.year), L + 20, ly);
  ctx.strokeStyle = BASE; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L + 64, ly); ctx.lineTo(L + 78, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText('Usual', L + 84, ly);
  ctx.fillStyle = 'rgba(169,173,181,.5)'; ctx.fillRect(L + 128, ly - 5, 14, 10); ctx.fillStyle = INK; ctx.fillText('Usual range', L + 148, ly);
  hoverChart($('c-curve'), cv.map((c, k) => ({ x: x(k), c })), it => `<strong>From ${lab(it.c.slot)}</strong><dl><dt>${m.year}</dt><dd>${fmt(it.c.target, 3)}</dd><dt>Usual</dt><dd>${fmt(it.c.baselineMean, 3)}</dd><dt>Range</dt><dd>${fmt(it.c.p10, 3)}–${fmt(it.c.p90, 3)}</dd></dl>`);
}
let rz = null;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.result) { renderYears(S.result); renderCurve(S.result); } }, 150); });

// ---------------------------------------------------------------- export
const fileBase = () => { const m = S.result.meta; return `agrosignal_${m.year}_${m.season.start.slice(0, 2)}-${m.season.end.slice(0, 2)}`; };
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
$('export-open').addEventListener('click', () => { $('x-note').textContent = ''; $('export').showModal(); });
document.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', async () => {
  if (!S.result) return;
  const k = b.dataset.x, note = $('x-note');
  try {
    b.disabled = true;
    if (k === 'link') {
      const u = shareUrl();
      try { await navigator.clipboard.writeText(u); note.textContent = 'Link copied. Opening it reruns the same analysis.'; } catch { prompt('Copy this link:', u); }
      return;
    }
    if (k === 'print') { $('export').close(); return await printReport(); }
    if (k === 'png') { save(await mapPng(), `${fileBase()}_${S.layer}.png`); note.textContent = 'Map image saved.'; return; }
    const ext = { geotiff: '.tif', years: '_years.csv', pixels: '_pixels.csv', json: '.json' }[k];
    note.textContent = 'Preparing the file…';
    const { blob } = await ask('export', { kind: k }); save(blob, fileBase() + ext);
    note.textContent = `${b.querySelector('b').textContent} saved.`;
  } catch (e) { note.textContent = `Download failed: ${e.message}`; }
  finally { b.disabled = false; }
}));
async function mapPng() {
  // the exported image carries its colour scale, season, comparison years, sources and limits
  await new Promise(r => { map.once('render', r); map.triggerRepaint(); });
  const src = map.getCanvas(), c = document.createElement('canvas'), dpr = src.width / src.clientWidth || 1;
  const m = S.result.meta, L = LAYERS[S.layer], F = (px, w = 400) => `${w} ${px * dpr}px Satoshi, sans-serif`;
  const lines = [[F(13, 500), INK, 17, `AgroSignal · ${L.name} · ${seasonLabel(m)} against ${m.baseline[0]}–${m.baseline[1]} · ${m.label || ''}`],
    [F(10.5), '#4a505c', 14, `${L.all ? 'All pixels in the area' : m.cropOnly ? `Cropland pixels only (ESA WorldCover 2021, share ≥ ${Math.round(m.params.cropMin * 100)}%)` : 'All pixels in the area'}. MODIS ${m.sensor} v061, 16-day 250 m composites. AgroSignal ${m.version}.`],
    [F(10.5), '#4a505c', 14, 'Limits: NDVI measures greenness, not yield. Satellite overpass times have drifted since 2020–2021; recent seasons against older baselines need care.'],
    [F(10.5), '#4a505c', 14, 'Data: MODIS (NASA LP DAAC, via Planetary Computer); ESA WorldCover 2021. Basemap © OpenStreetMap contributors, OpenFreeMap.']];
  const meas = c.getContext('2d'), wrapped = [];
  for (const [font, col, lh, text] of lines) { meas.font = font; let cur = ''; for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (meas.measureText(t).width > src.width - 20 * dpr && cur) { wrapped.push([font, col, lh, cur]); cur = w; } else cur = t; } wrapped.push([font, col, lh, cur]); }
  const foot = (14 + wrapped.reduce((n, l) => n + l[2], 0)) * dpr;
  c.width = src.width; c.height = src.height + foot;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0);
  const bw = 210 * dpr, bh = 62 * dpr, bx = 10 * dpr, by = src.height - bh - 10 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = '#d5d9de'; ctx.lineWidth = dpr; ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = INK; ctx.font = F(11.5, 500); ctx.fillText(L.name, bx + 8 * dpr, by + 15 * dpr);
  const g = ctx.createLinearGradient(bx + 8 * dpr, 0, bx + bw - 8 * dpr, 0); L.ramp.forEach((col, i) => g.addColorStop(i / (L.ramp.length - 1), col));
  ctx.fillStyle = g; ctx.fillRect(bx + 8 * dpr, by + 21 * dpr, bw - 16 * dpr, 9 * dpr);
  ctx.fillStyle = '#4a505c'; ctx.font = F(10.5); ctx.textAlign = 'left'; ctx.fillText(L.ends[0], bx + 8 * dpr, by + 42 * dpr);
  ctx.textAlign = 'center'; ctx.fillText(L.ends[1], bx + bw / 2, by + 42 * dpr); ctx.textAlign = 'right'; ctx.fillText(L.ends[2], bx + bw - 8 * dpr, by + 42 * dpr); ctx.textAlign = 'left';
  ctx.font = F(10); ctx.fillText(L.unit, bx + 8 * dpr, by + 55 * dpr);
  const mpp = 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000], len = nice.reduce((b, v) => v <= 120 * mpp ? v : b, nice[0]);
  const sw = len / mpp * dpr, sx = c.width - sw - 16 * dpr, sy = src.height - 18 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.fillRect(sx - 8 * dpr, sy - 18 * dpr, sw + 16 * dpr, 26 * dpr);
  ctx.strokeStyle = INK; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(sx, sy - 4 * dpr); ctx.lineTo(sx, sy); ctx.lineTo(sx + sw, sy); ctx.lineTo(sx + sw, sy - 4 * dpr); ctx.stroke();
  ctx.fillStyle = INK; ctx.font = F(11); ctx.textAlign = 'center'; ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, sx + sw / 2, sy - 7 * dpr); ctx.textAlign = 'left';
  let y = src.height + 6 * dpr;
  for (const [font, col, lh, text] of wrapped) { y += lh * dpr; ctx.font = font; ctx.fillStyle = col; ctx.fillText(text, 10 * dpr, y); }
  return new Promise(res => c.toBlob(res, 'image/png'));
}
async function printReport() {
  const r = S.result, s = r.summary, m = r.meta, cl = s.climate, img = URL.createObjectURL(await mapPng());
  showChart('years');
  const yimg = $('c-years').toDataURL(), rimg = $('c-rain').toDataURL();
  $('report').innerHTML = `<h1>${esc($('r-verdict').textContent)}</h1><p>${esc(m.label || 'Area')} · ${fmt(m.aoiAreaKm2, 0)} km² · ${seasonLabel(m)} against ${m.baseline[0]}–${m.baseline[1]} · AgroSignal report generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
    <p>${esc($('r-reading').textContent)}</p>
    <img src="${img}" alt="Map: ${esc(LAYERS[S.layer].name)}">
    <h2>Result</h2><table>
    <tr><td>Season greenness (NDVI, area mean)</td><td>${fmt(s.target.ndvi, 3)}; usual ${fmt(s.baseline.ndviMean, 3)} ± ${fmt(s.baseline.ndviSd, 3)} (SD)</td></tr>
    <tr><td>Regional z-score</td><td>${sgn(s.regionalZ)}; greener than ${s.target.rankBelow} of ${s.target.baselineSeasons} comparison seasons</td></tr>
    <tr><td>Mean of pixel z-scores / change / VCI</td><td>${sgn(s.target.z)} / ${sgn(s.target.anomaly, 3)} / ${fmt(s.target.vci, 0)}</td></tr>
    <tr><td>Pixels analysed</td><td>${s.pixelsAnalysed.toLocaleString('en-GB')} ${m.cropOnly ? '(at least half cropland)' : ''}</td></tr>
    <tr><td>Rainfall (CHIRPS)</td><td>${ok(cl.rain) ? `${int(cl.rain)} mm; usual ${int(cl.rainMean)} mm (${sgn(cl.rainPct, 0)}%)` : esc(cl.rainNote || 'not available')}</td></tr>
    <tr><td>Temperature (NASA POWER)</td><td>${ok(cl.t2m) ? `${fmt(cl.t2m, 1)} °C; usual ${fmt(cl.t2mMean, 1)} °C` : esc(cl.tempNote || 'not available')}</td></tr></table>
    <h2>Greenness and rainfall by season</h2><img src="${yimg}" alt="Season greenness by year"><img src="${rimg}" alt="Season rainfall by year">
    <h2>Processing</h2><p>${m.composites.length} composites from ${esc(m.sensor)}; quality 0–1 kept; a season needs ${Math.round(m.params.minSeasonShare * 100)}% of images valid; the comparison needs ${fmt(m.params.minBaselineShare * 100, 0)}% of years. AgroSignal ${esc(m.version)}, run ${esc(m.runAt)}.</p>
    <p>${Object.values(m.sources).map(esc).join(' · ')}</p>
    <p>Limits: NDVI measures greenness, not yield. Orbit drift (Terra earlier since 2020, Aqua later since 2021) may affect recent seasons. No ground observations were used.</p>`;
  await Promise.all([...$('report').querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(res => { im.onload = res; })));
  window.print();
}

// ---------------------------------------------------------------- dialogs
$('about-open').addEventListener('click', () => $('about').showModal());
document.querySelectorAll('dialog').forEach(d => {
  const x = d.querySelector('[data-close]'); if (x) x.addEventListener('click', () => d.close());
  d.addEventListener('click', e => { if (e.target === d) d.close(); });   // a click on the backdrop
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawing) setDraw(false); });
document.addEventListener('click', e => { const mm = document.querySelector('.menu'); if (mm.open && !mm.contains(e.target)) mm.open = false; });
// the last month of the hosted rainfall archive, read from its index
fetch('data/chirps/index.json').then(r => r.json()).then(ix => {
  const y = Math.max(...Object.keys(ix.years).map(Number)), mm = Math.max(...ix.years[y].months);
  $('chirps-end').textContent = `; to ${MONTHS[mm - 1]} ${y}`;
}).catch(() => {});

// landing preview: figures from a real run (assets/preview.json, written by tools/make_preview.py)
fetch('assets/preview.json').then(r => r.json()).then(p => {
  const k = classOf(p.regionalZ), m0 = +p.season.start.slice(0, 2), m1 = +p.season.end.slice(0, 2);
  $('pv-place').textContent = p.label;
  $('pv-verdict').textContent = k === 2 ? 'A usual season' : `${CLASS[k].t} than usual`;
  document.querySelectorAll('.pv-scale i').forEach((x, i) => x.classList.toggle('on', i === k));
  $('pv-stats').innerHTML = `<div><b>${fmt(p.ndvi, 3)}</b>usual ${fmt(p.usual, 3)}</div><div><b>${ordinal(p.baselineSeasons - p.rankBelow + 1)}</b>of ${p.baselineSeasons + 1} seasons</div><div><b>${sgn(p.rainPct, 0)}%</b>rainfall</div>`;
  $('pv-cap').textContent = `A real result: ${seasonText(m0, m1, p.year)} against ${p.baseline[0]}–${p.baseline[1]}, AgroSignal ${p.version}. Map © OpenStreetMap contributors, OpenFreeMap.`;
}).catch(() => { document.querySelector('.preview').hidden = true; });

// ---------------------------------------------------------------- start
show('place');
(async () => {
  const q = new URLSearchParams(location.search); if (!q.get('bbox')) { $('w-q').focus(); return; }
  // a shared link: skip the welcome, restore the settings, run again
  closeWelcome();
  const b = q.get('bbox').split(',').map(Number);
  if (b.length !== 4 || b.some(v => !Number.isFinite(v))) { $('err-msg').textContent = 'The shared link has an area this page cannot read, so nothing was run. Choose a place instead.'; show('error'); return; }
  await setAoi(b, q.get('label') || 'Shared area'); fit(b);
  const NAMES = { m0: 'start month', m1: 'end month', year: 'season year', b0: 'comparison start', b1: 'comparison end', sensor: 'satellite' }, bad = [];
  for (const k of Object.keys(NAMES)) if (q.get(k) != null) { if ($(k).querySelector(`option[value="${CSS.escape(q.get(k))}"]`)) $(k).value = q.get(k); else bad.push(`${NAMES[k]} ${q.get(k)}`); }
  $('crop').checked = q.get('crop') !== '0';
  checkSeason();
  if (bad.length) { $('err-msg').textContent = `The shared link asks for ${bad.join(', ')}, which this page does not offer, so nothing was run. Check the season and press Analyse.`; show('error'); return; }
  if (!S.aoi.ok) { show('place'); return; }
  if (seasonProblem()) { show('season'); return; }
  runNow();
})();
