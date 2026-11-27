// End-to-end journey in headless Chromium: welcome, Kano example, charts, layers, every export, share link, method, and the phone search flow.
// Needs the page served at 127.0.0.1:8765 (npx http-server . -p 8765). Usage: node tests/browser_e2e.cjs [screenshot folder]
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] || require('os').tmpdir() + '/agrosignal_e2e';
fs.mkdirSync(OUT, { recursive: true });
const URL0 = 'http://127.0.0.1:8765/';
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } });
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push('pageerror ' + e.message)); };
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const waitView = (p, v, t = 600000) => p.waitForSelector(`[data-view="${v}"]:not([hidden])`, { timeout: t });

  // ---- desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL0); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/d1_welcome.png` });
  log('preview card:', (await page.textContent('.preview')).replace(/\s+/g, ' '));
  const t0 = Date.now();
  await page.click('[data-ex="0"]');
  await waitView(page, 'running', 20000); await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/d2_running.png` });
  await waitView(page, 'result');
  log('kano run s', ((Date.now() - t0) / 1000).toFixed(0));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/d3_result.png` });
  log('verdict:', await page.textContent('#r-verdict'));
  log('where:', await page.textContent('#r-where'));
  log('reading:', await page.textContent('#r-reading'));
  log('stats:', (await page.textContent('#r-stats')).replace(/\s+/g, ' '));
  log('caution:', await page.isVisible('#r-caution') ? await page.textContent('#r-caution') : '(none)');
  log('split:', (await page.textContent('#r-splitkey')).replace(/\s+/g, ' '));
  // hover the map centre
  const box = await page.$('#map').then(e => e.boundingBox());
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2); await page.waitForTimeout(400);
  log('map tip:', (await page.textContent('#tip')).replace(/\s+/g, ' '), 'visible', await page.isVisible('#tip'));
  await page.click('[data-chart="curve"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/d4_curve.png` });
  await page.click('[data-chart="years"]');
  for (const l of ['anom', 'vci', 'target', 'crop', 'z']) { await page.selectOption('#layer', l); await page.waitForTimeout(500); }
  // exports
  await page.click('#export-open'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/d5_export.png` });
  for (const k of ['png', 'geotiff', 'years', 'pixels', 'json']) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-x="${k}"]`)]);
    const f = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(f); log('download', k, dl.suggestedFilename(), fs.statSync(f).size, 'bytes');
  }
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL0 });
  await page.click('[data-x="link"]'); await page.waitForTimeout(300);
  log('link note:', await page.textContent('#x-note'));
  const shared = page.url(); log('shared url:', shared);
  await page.click('#export [data-close]');
  // about dialog
  await page.click('#about-open'); await page.waitForTimeout(500);
  log('chirps end:', await page.textContent('#chirps-end'));
  await page.screenshot({ path: `${OUT}/d6_method.png` });
  await page.click('#about [data-close]');
  // steps: back to place, then season, check stepper
  await page.click('#stepper [data-s="season"] button'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/d7_season.png` });
  // shared link in a new page
  const p2 = await ctx.newPage(); watch(p2);
  await p2.goto(shared); await waitView(p2, 'result');
  log('shared verdict:', await p2.textContent('#r-verdict'), '|', (await p2.textContent('#r-stats')).replace(/\s+/g, ' '));
  await p2.close();
  await ctx.close();

  // ---- phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await ph.newPage(); watch(pp);
  await pp.goto(URL0); await pp.waitForTimeout(2500);
  log('phone welcome overflow', await overflow(pp));
  await pp.screenshot({ path: `${OUT}/p1_welcome.png`, fullPage: false });
  await pp.fill('#w-q', 'Ludhiana'); await pp.click('#w-search .btn');
  await pp.waitForSelector('#w-results button', { timeout: 20000 });
  await pp.screenshot({ path: `${OUT}/p2_search.png` });
  await pp.click('#w-results li:first-child button');
  await pp.waitForSelector('#tour[open]', { timeout: 5000 }); log('tour shown on first entry');
  await pp.screenshot({ path: `${OUT}/p3_tour.png` }); await pp.click('#tour-skip');
  await waitView(pp, 'season', 20000); await pp.waitForTimeout(4000);
  log('phone season place:', await pp.textContent('#season-place'), '| hint:', await pp.textContent('#season-hint'), '| year', await pp.inputValue('#year'), '| run disabled', await pp.isDisabled('#run'));
  log('archive msg:', await pp.isVisible('#archive-msg') ? await pp.textContent('#archive-msg') : '(none)');
  log('phone season overflow', await overflow(pp));
  await pp.screenshot({ path: `${OUT}/p3_season.png`, fullPage: true });
  await pp.click('#run');
  await waitView(pp, 'result');
  await pp.waitForTimeout(2500);
  log('phone verdict:', await pp.textContent('#r-verdict'), '|', (await pp.textContent('#r-stats')).replace(/\s+/g, ' '));
  log('phone result overflow', await overflow(pp));
  await pp.screenshot({ path: `${OUT}/p4_result.png`, fullPage: true });
  await ph.close();
  await browser.close();
  log('errors:', errors.length ? errors : 'none');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
