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

## Version 1.1.0 (interface upgrade), 25 November 2026

| # | Test | Expected | Result | Status | Evidence |
|---|---|---|---|---|---|
| 10 | `tests/fixture_kano.mjs`: whole pipeline, 4 × 4 km near Bagwai, Aug–Sep 2011 against 2001–2010, every MODIS response replayed from `tests/fixtures/kano-small/` (26 MB) | identical composites, pixels, NDVI, regional z, rank, rainfall, z and anomaly grid hashes | 10 of 10 identical, offline | Pass | test output |
| 11 | Kano example in headless Chromium, live archive | regional z and headline as before | z +2.97 (the test report's 2.83 of 23 November came from an earlier state of the live archive; code unchanged), "much greener than usual", drift caution shown | Pass | journey script |
| 12 | Link to the analysis opened in a new page | same figures | 0.525, +2.97, 20 of 20, +2 % | Pass | journey script |
| 13 | axe before and after a run; phone 390 px | 0 violations; purpose first; no overflow | 0; title 83 px, steps 754 px; 0 px | Pass | journey script |

### 1.1.1 (after the independent review)

| # | Check | Expected | Result | Status |
|---|---|---|---|---|
| 14 | Fixed-input Kano test after the 1.1.1 changes | all 10 values and both grid hashes unchanged | identical | Pass |
| 15 | Season 2025 at Kano, checked before a run | warning that the archive has too few composites | "3 of about 10 composites … fewer than the 5 a run needs" | Pass |
| 16 | Season 2024 at Kano | no warning | none | Pass |
| 17 | Shared link with `year=2027` | message, nothing run | "asks for season year 2027, which this page does not offer, so nothing was run" | Pass |

Planetary Computer was queried directly on 25 November 2026: at the Kano box, MOD13Q1 and MYD13Q1 both have no composites from July to October 2025 (Terra 15 and Aqua 14 composites for the whole of 2025, against 23 to 24 in 2023 and 2024). The gap is in the archive, not in one sensor, so the page checks the archive for the chosen season and place instead of disabling a year.

Changes in 1.1.1: the archive check above; shares below 1% in the Reading keep one decimal, so it agrees with the Pixels tab; the rainfall correlation is described as weak, moderate or strong; a shared link with values the page does not offer, or an area outside the limits, says so and runs nothing; the side-panel example button reads "Example". The analysis is unchanged; the engine's messages for an empty search and a season gap are clearer.

Phone map overlays (after 1.1.1, same version): at 860 px and below the scale bar sits bottom-left above the Legend chip, the map credits start closed behind the i button, and layer chips stay in one scrolling row. Checked at 390 px after an example run: no overlapping overlays; axe 0 violations.

## Version 1.2.0 (interface rebuilt), 27 November 2026

| # | Test | Expected | Result | Status |
|---|---|---|---|---|
| 18 | `tests/engine_test.mjs` | all pass | all pass | Pass |
| 19 | `tests/fixture_kano.mjs` | 10 values and both grid hashes unchanged | identical (z 1.062842, rank 8, rain 390.8 mm) | Pass |
| 20 | `tests/browser_e2e.cjs`, 1440 × 900: Kano example from the opening screen | result view, same figures as 1.1.1 | 71 s; "Much greener than usual", 0.525 against 0.453, 20 of 20, z +2.97, rain +2 % (896 against 879 mm), drift caution shown | Pass |
| 21 | Same run: map hover, five layers, both charts, seven exports | values and files | hover values shown; PNG, GeoTIFF, two CSVs and JSON written; link copied | Pass |
| 22 | Share link opened in a new page | same figures | identical | Pass |
| 23 | 390 px phone: search "Ludhiana", pick the first result, run with the preset season | season preset, no horizontal scroll, result | Jun–Oct 2026 preset; 0 px overflow on the opening, season and result screens; run completed | Pass |
| 24 | Console errors across both runs | none | none | Pass |

Not checked in 1.2.0: the printed report (headless print was not inspected), screen readers, real touch devices, and the Punjab and Saskatchewan examples from the opening screen (their settings ran in `global_check.mjs` on 23 November).
