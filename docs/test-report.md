# AgroSignal test report

Version 1.0.0, tested on 23 November 2026. Each row names the evidence file in `docs/validation/` or `docs/screenshots/`. Numbers are copied from those files.

| # | Test | Expected | Result | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Unit tests of the pure functions (`tests/engine_test.mjs`) | All pass | 46 checks pass, including season membership by whole composite (Jun–Oct 9 composites for Terra and Aqua, Jun–Sep 7, Nov–Mar 9, leap years the same) | Pass | `unit-tests.txt` |
| 2 | Browser engine against the independent Python reference, Kano example (box 8.0–8.4° E, 12.0–12.4° N, Jun–Oct 2026, baseline 2001–2020) | Same arrays | Anomaly max abs difference 1.8e-7, z 9.5e-6, VCI 2.9e-4; regional NDVI max difference 1.0e-5; season membership identical for every composite | Pass | `engine-vs-python.txt` |
| 3 | Cropland share against 10 m centre assignment in Python | Small differences only | Mean abs difference 0.0013, max 0.016; 30,583 against 30,589 analysed pixels (37,402 of 37,442 pixels classified the same; the rest lie within 0.016 of the 0.5 cut-off) | Pass | `engine-vs-python.txt`, `cropland-vs-python.txt` |
| 4 | Season rainfall from the hosted 0.2° archive against the original 0.05° CHIRPS files | Within rounding (0.5 mm per season) | 2001–2003: differences 0.067, 0.102 and 0.063 mm. The CHC server throttled further requests, so later seasons were not checked | Partial pass | `rainfall-vs-chirps-source.txt` |
| 5 | Terra against Aqua, Kano, Jun–Oct 2026, baseline 2003–2020 | Same direction | Both rank 2026 above all 18 baseline seasons; regional z 2.83 (Terra) and 1.89 (Aqua); Terra and Aqua regional NDVI correlate at r = 0.90 over the baseline; the 2026 Terra–Aqua gap is 1.31 SD above its baseline mean | Pass; size of the anomaly depends on the sensor | `terra-vs-aqua-kano-2026.txt` |
| 6 | Four other regions: Free State (Nov–Mar 2023/24, crossing the year), Saskatchewan 52° N (May–Aug 2021), Punjab (Jun–Oct 2023), southern Finland 61° N (outside CHIRPS) | Each run completes with valid figures; rainfall reported unavailable outside 60° S–60° N | All four pass; Finland reports "The area lies outside CHIRPS coverage" and still gives NDVI and temperature | Pass | `global-check.txt` |
| 7 | Whole page in headless Chromium, 1440 × 900 and 390 px | Example runs; figures, map layers, hover, tabs and five downloads work | Run in about 60 s; title "Jun–Oct 2026: much greener than usual"; five downloads written; no horizontal scrolling at 390 px | Pass | `docs/screenshots/` |
| 8 | Console errors during the browser run | None from the tool | One run of four logged a bare "Error" while the basemap aborted tile requests during a zoom; it did not recur and is not raised by the tool's code | Pass with note | test output |
| 9 | Missing archive data | Clear message, no blank result | The Planetary Computer archive has no Terra composites at Kano from 26 June to 17 November 2025; the run stops with the counts | Pass | `pipeline.js` |

## Findings that changed the code

- NASA POWER rainfall disagreed with CHIRPS by about half at Kano (677 and 565 mm against about 1,170 and 1,115 mm in 2001 and 2002) and was replaced by a hosted CHIRPS archive.
- The cropland share used an axis-aligned footprint; a sinusoidal pixel is sheared in lon/lat. Sampling inside the true pixel cut the maximum difference from 0.34 to 0.016.
- Season membership by calendar date gave leap years an extra late composite (31 October), which lowered their season means (2004: 0.457 against 0.474 after the fix). Membership is now by day of year and by whole composite.
- An independent code review found, among others: a target season before the baseline gave a reversed search window; the map raster could be placed on a newly drawn box; chart hover was offset; the pixels CSV listed masked rather than analysed pixels; the GeoTIFF image data could be misaligned for other band names. All were fixed.

## Not tested

- The rainfall reference beyond 2001–2003 (server throttling).
- The GeoTIFF export was checked with GDAL and rasterio earlier in development; it was not re-opened after the alignment fix.
- Seasons crossing the new year were run in the browser engine (Free State) but not compared with the Python reference, which handles seasons within one calendar year.
- Screen readers and touch devices.
