# AgroSignal

Was this growing season greener or browner than usual, and was it wetter or drier? AgroSignal compares one season's MODIS NDVI over cropland with the same months in a baseline of years, pixel by pixel, for any area up to 2,500 km² on Earth, and adds the season's CHIRPS rainfall. Everything runs in the browser on open data.

## Use it

1. **Place.** Search a region, district or town on the opening screen, draw a box on the map, or open one of three examples (Kano, Nigeria; the Great Hungarian Plain; Saskatchewan, Canada). A short three-screen tour explains the steps on first use; "How it works" reopens it.
2. **Season.** Months and year are set for you from the latitude (the latest finished season); change them to match the crop. Seasons may cross the new year. Advanced settings hold the comparison years (default 2001–2020), the satellite (Terra or Aqua) and the cropland-only switch.
3. **Result.** A plain verdict on a five-step scale, the season's rank, greenness and rainfall, a yearly chart and a within-season curve, and the share of pixels in each class. The map shows the z-score, change, condition (VCI), greenness or cropland share; hover for a pixel's values. Export: printable report, map PNG, GeoTIFF (7 bands on the MODIS sinusoidal grid), seasons CSV, pixels CSV, JSON, and a share link that reruns the analysis.

## What it measures, and what it does not

- Season NDVI is the mean of MOD13Q1 16-day composites, keeping good and marginal quality pixels only.
- Anomaly, z-score and VCI are relative to the area's own baseline years.
- NDVI is greenness. It is not yield, crop type or planted area, and a correlation with rainfall is not evidence of cause.
- Rainfall covers 60° S to 60° N (CHIRPS). Outside that band the NDVI analysis still runs.

Method: [`docs/methodology.md`](docs/methodology.md). Data sources and licences: [`docs/data-register.md`](docs/data-register.md). Tests and validation: [`docs/test-report.md`](docs/test-report.md).

## Run locally

Any static file server that supports HTTP range requests:

```
npx http-server . -p 8765 -s --cors -c-1
```

then open `http://127.0.0.1:8765/`.

Tests (Node 18+ with network access):

```
node tests/engine_test.mjs                 # unit tests of the pure functions
node tests/e2e_kano.mjs OUT.json           # full analysis for the Kano example
python3 pipeline/reference.py OUT.json REF.json          # independent Python reference
python3 pipeline/reference_climate.py OUT.json 8 12 8.4 12.4   # rainfall from the original CHIRPS files
node tests/sensor_check.mjs 2026           # Terra against Aqua
node tests/global_check.mjs                # four other regions, including one outside rainfall coverage
node tests/fixture_kano.mjs                # fixed-input regression test (page served on 8765)
node tests/europe_check.mjs                # the two European candidates for the Hungary example
node tests/crop_check.mjs REF.json OUT.json # cropland share against the Python reference
node tests/years_check.mjs                 # recent target years at Kano, to check for a post-2020 shift
# tests/fixture_fetch.mjs is the record-and-replay helper that fixture_kano.mjs uses
node tests/browser_e2e.cjs OUT_DIR         # whole page in headless Chromium, desktop and phone (page served on 8765)
```

Rebuild or extend the rainfall archive (downloads about 31 MB per month from the Climate Hazards Center):

```
python3 pipeline/build_chirps.py 2026 2027
```

## Files

| Path | Content |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | Page: welcome, three steps (place, season, result), map, export |
| `js/worker.js` | Web Worker that runs the analysis and writes exports |
| `js/pipeline.js` | Search, reading, season and baseline statistics, climate |
| `js/engine.js` | Pure functions (no network), unit-tested |
| `js/io.js` | STAC search, read tokens, Cloud Optimised GeoTIFF reading onto the analysis grid |
| `js/exports.js` | GeoTIFF writer and CSV files |
| `js/version.js` | The version number, used by the page and the exports |
| `assets/` | Fonts, icon, and the landing card (`preview.json`, `preview-map.webp`) |
| `tools/make_preview.py` | Builds the landing card from a real run's exports |
| `data/chirps/` | CHIRPS v3.0 monthly rainfall at 0.2°, one 12-band GeoTIFF per year, with `index.json` |
| `pipeline/` | Archive builder and independent Python references |
| `tests/` | Unit, end-to-end, reference, sensor and browser tests |
| `vendor/` | MapLibre GL JS, geotiff.js, proj4 (licences alongside) |

## Licence

Code: MIT (see `LICENSE`). Data keep their own licences (see the data register); the hosted rainfall files are derived from CHIRPS v3.0, Climate Hazards Center, UC Santa Barbara.
