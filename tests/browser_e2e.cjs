// End-to-end check in headless Chromium: landing, the Kano example run, result drawer and tabs, hover, exports, phone width,
// console errors. Usage: node tests/browser_e2e.cjs OUT_DIR [smoke]   (smoke: stop before running the analysis)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2] || '.', smoke = process.argv[3] === 'smoke';
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/as_landing.png` });
  await page.click('#example');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/as_season.png` });
  console.log('run button disabled', await page.isDisabled('#run'), 'msg hidden', await page.isHidden('#season-msg'));
  if (smoke) { console.log('console errors:', errors.length ? errors : 'none'); await browser.close(); return; }
  const t0 = Date.now();
  await page.click('#run');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: `${out}/as_running.png` });
  await page.waitForSelector('#figs:not(.empty)', { timeout: 900000 });
  await page.waitForTimeout(2500);
  console.log('run seconds', (Date.now() - t0) / 1000);
  console.log('title:', await page.textContent('#r-title'));
  console.log('sub:', await page.textContent('#r-sub'));
  console.log('figures:', await page.$$eval('.kpi', fs => fs.map(f => f.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
  await page.screenshot({ path: `${out}/as_result.png` });
  const box = await page.$('#map').then(e => e.boundingBox());
  await page.mouse.move(box.width * 0.62, box.height * 0.45);
  await page.waitForTimeout(800);
  console.log('hover:', (await page.textContent('#tip')).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${out}/as_hover.png` });
  await page.screenshot({ path: `${out}/as_years.png` });
  console.log('years note:', await page.textContent('#years-note'));
  for (const t of ['curve', 'pixels', 'run']) { await page.click(`.tabs [data-tab="${t}"]`); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/as_${t}.png` }); }
  for (const l of ['anom', 'vci', 'target', 'crop']) { await page.click(`#layer-list label:has(input[value=${l}])`); await page.waitForTimeout(700); }
  await page.screenshot({ path: `${out}/as_layer_crop.png` });
  await page.click('#layer-list label:has(input[value=z])');
  for (const k of ['geotiff', 'years', 'pixels', 'json', 'png']) {
    await page.click('#dl-btn');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-x="${k}"]`)]);
    const p = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(p); console.log('export', k, fs.statSync(p).size, 'bytes', p);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  console.log('horizontal overflow at 390 px:', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  await page.screenshot({ path: `${out}/as_phone.png` });
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
