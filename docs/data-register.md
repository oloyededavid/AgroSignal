# AgroSignal data register

| Dataset | Version | Provider | Licence / terms | Resolution | Coverage | How AgroSignal reads it |
|---|---|---|---|---|---|---|
| MOD13Q1 Vegetation Indices 16-Day | Collection 6.1 (v061) | NASA LP DAAC (MODIS/Terra) | NASA open data; cite Didan (2021), doi:10.5067/MODIS/MOD13Q1.061 | 250 m, 16 days | Global land, Feb 2000 onward | Planetary Computer STAC `modis-13Q1-061`, item IDs starting `MOD13Q1.`, assets `250m_16_days_NDVI` and `250m_16_days_pixel_reliability` |
| MYD13Q1 (optional, step 2 "Satellite") | v061 | NASA LP DAAC (MODIS/Aqua) | as above; doi:10.5067/MODIS/MYD13Q1.061 | 250 m, 16 days | Global land, July 2002 onward | same collection, IDs starting `MYD13Q1.` |
| ESA WorldCover | 2021 v200 | European Space Agency | CC BY 4.0; cite Zanaga et al. (2022), doi:10.5281/zenodo.7254221 | 10 m | Global land | Planetary Computer `esa-worldcover`, asset `map`, class 40 |
| CHIRPS | v3.0 monthly | Climate Hazards Center, UC Santa Barbara | copyright waived by the CHC (public domain); cite Funk et al. (2026), Scientific Data 13, 718, doi:10.1038/s41597-026-07096-4 (found through the USGS publication record; the article itself was not opened) | 0.05°, monthly | 60° S to 60° N; ocean cells are no-data in the files (28.1% of 0.2° cells hold data) | Downloaded and averaged to 0.2° by `pipeline/build_chirps.py`; hosted as `data/chirps/chirps-v3-0p2-YYYY.tif` with `index.json` (months present and the source file timestamp per month) |
| NASA POWER | daily point API, T2M (MERRA-2) | NASA Langley Research Center | NASA open data; credit the NASA Langley Research Center POWER Project and give service, version and access date | 0.5° latitude × 0.625° longitude | Global | `power.larc.nasa.gov/api/temporal/daily/point`, one request per run |
| OpenFreeMap positron | – | OpenFreeMap; data © OpenStreetMap contributors | ODbL (data) | vector tiles | Global | Basemap only |
| Nominatim | – | OpenStreetMap Foundation | usage policy: on submit only, no autocomplete | – | Global | Place search |

## Archive state

The hosted CHIRPS archive covers the years and months listed in `data/chirps/index.json`; the file records the build date. At build time (23 November 2026) the latest published month was October 2026. Later months need a rebuild: `python3 pipeline/build_chirps.py 2026 2027` (complete years are skipped).

## Gaps found

- Planetary Computer `modis-13Q1-061` holds no MOD13Q1 or MYD13Q1 composites at the Kano example between 26 June 2025 (Terra) / 18 June 2025 (Aqua) and mid-November 2025 (checked 23 November 2026). Seasons in that window cannot be analysed with this archive. The cause was not established.
- The MOD13Q1 pixel size, 231.656358 m, is derived from the MODIS grid: 10° on the 6,371,007.181 m sphere divided by 4,800 pixels per tile.
