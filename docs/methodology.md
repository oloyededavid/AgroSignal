# AgroSignal methodology

Version 1.2.0 (the method is unchanged since 1.0.0). The code that implements each step is named in brackets. The browser engine (`js/`) and the independent Python references (`pipeline/reference.py`, `pipeline/reference_climate.py`) implement the same rules without sharing code; they are compared in `docs/test-report.md`.

## 1. Question

Was one growing season in a chosen area greener or browner than the same months in a set of baseline years, and was it wetter or drier?

AgroSignal measures **vegetation greenness (NDVI) relative to the area's own history**. Its outputs are not:
- a yield or production estimate;
- a measure of crop type or planted area;
- evidence that rainfall or anything else caused an anomaly.

The tool works anywhere MODIS observes land. Rainfall is available between 60° S and 60° N (CHIRPS coverage); outside that band the NDVI analysis runs and rainfall is reported as unavailable.

## 2. Inputs

| Input | Use | Access |
|---|---|---|
| MODIS/Terra MOD13Q1 v061, 16-day NDVI and pixel reliability, 250 m sinusoidal | Season NDVI | Microsoft Planetary Computer STAC `modis-13Q1-061`, COG windows, read token per storage container |
| MODIS/Aqua MYD13Q1 v061 | Alternative to Terra, chosen under "Satellite" in step 2 (`sensor: 'aqua'` in `runAnalysis`); used to check Terra | as above |
| ESA WorldCover 2021 v200, 10 m | Cropland share of each MODIS pixel | PC `esa-worldcover` |
| CHIRPS v3.0 monthly, 0.05° | Season rainfall | Averaged to 0.2° by `pipeline/build_chirps.py` and hosted in `data/chirps/` (the CHC server sends no CORS headers, so a browser cannot read it directly) |
| NASA POWER daily T2M (MERRA-2) | Season mean temperature at the area centre | POWER daily point API; optional |

## 3. Grid and area

1. **Grid.** The area's lon/lat ring is densified (20 points per edge), projected to the MODIS sinusoidal CRS (sphere of radius 6,371,007.181 m), and its bounding box is snapped outward to MODIS pixel edges (`engine.modisGrid`). Pixels are 231.656358 m, exactly the MOD13Q1 grid, so NDVI is read without resampling (`method: 'nearest'` on an identical grid).
2. **Inside.** A pixel is inside the area when its centre, converted back to lon/lat, lies inside the ring (even-odd rule).
3. **Size.** Areas over 2,500 km² are refused (`pipeline.MAX_KM2`); a box across the 180° meridian is refused in the page.

## 4. NDVI per composite and per season

1. **Composites.** All MOD13Q1 items intersecting the area's bounding box from the earlier of the first baseline season and the target season to the later of their ends (plus two days at each end) are listed; tiles with the same start date form one composite. MODIS composites start on fixed days of year (Terra 1, 17, 33, …; Aqua 9, 25, …; in leap years the same day of year falls one calendar day earlier after February). A composite belongs to a season when its whole 16-day period (up to day 365 for the year's last composite) lies inside the season, with the season taken as a range of days of year in a non-leap year (`engine.seasonDoys`, `engine.compositeInSeason`, `engine.seasonOf`). Every season therefore uses the same composite slots, leap year or not, and the NDVI period never runs past the season used for rainfall and temperature. Example: June to October uses the nine Terra composites starting 10 June to 16 October, the last ending on 31 October; June to September leaves out the composite starting 30 September because it runs into October.
2. **Screening** (`engine.screenNdvi`). NDVI = stored value × 0.0001, kept only where pixel reliability is 0 (good) or 1 (marginal) and NDVI is in [−0.2, 1]. Snow/ice (2), cloudy (3) and no data become missing.
3. **Season mean** (`engine.seasonMean`). The mean of a pixel's valid composites in the season, kept only when at least half of the composites expected in that season are valid (`minSeasonShare = 0.5`). Expected composites are those wholly inside the season (`engine.expectedComposites`). The start days match the archive listing for 2026 (Terra items dated 1 and 17 January, Aqua 9 and 25 January).
4. **Missing target composites.** If the archive holds fewer than half of the target season's expected composites, the run stops with a message naming the counts. Example: when checked on 23 November 2026, the Planetary Computer archive held no MOD13Q1 composites at the Kano example between 26 June and 17 November 2025 (and no MYD13Q1 between 18 June and 25 November 2025), so a June to October 2025 season cannot be analysed. The cause (processing, ingestion or the satellites' end-of-mission operations) was not established.

## 5. Baseline and anomalies

For each pixel, over the baseline years with a valid season mean (`engine.baselineStats`), kept only when at least two thirds of the baseline years are valid (`minBaselineShare`):

- mean and sample standard deviation (n − 1);
- minimum and maximum.

Then (`engine.anomalies`):

- **anomaly** = target − baseline mean;
- **z** = anomaly ÷ baseline SD (missing where the SD is 0);
- **VCI** = 100 × (target − baseline min) ÷ (baseline max − baseline min): the Vegetation Condition Index after Kogan, applied here to season-mean NDVI rather than to weekly values, and not clipped (values outside 0–100 mean the target lies outside the baseline range).

The baseline must span at least 10 seasons, start in 2001 or later (2003 for Aqua), exclude the target season and have finished; the target season may come before or after the baseline.

## 6. Cropland mask

The cropland share of each MODIS pixel is the mean of an indicator (WorldCover class 40 = 1, other classes = 0) over k × k sub-samples spread evenly inside the MODIS pixel, k being the number of 10 m pixels per MODIS pixel edge (about 23 at the equator). Each sub-sample is projected to the WorldCover grid and takes the 10 m pixel under it (`io.readToGrid`, `method: 'average'`). Sampling inside the MODIS pixel keeps its true shape, which in lon/lat is a slightly sheared quadrilateral. With "Cropland pixels only" (the default), a pixel is analysed when its share is at least 0.5 (`cropMin`).

WorldCover 2021 is a single year. Cropland that was converted before or after 2021 is mapped as it was in 2021.

## 7. Regional numbers

Regional values are means over a **fixed set of pixels**: inside the area, in the mask, and valid in both the target season and the baseline (`pipeline.runAnalysis`, `fixed`). The same pixels are used for every year, so a change in the yearly mean is not caused by a change in which pixels had data.

- **Season NDVI by year**: mean of the season mean over the fixed pixels; a year's mean uses the fixed pixels valid in that year (the count is reported).
- **Regional z** = (target regional NDVI − mean of the baseline regional NDVI) ÷ their sample SD. This differs from the mean of the pixel z-scores, which is also reported.
- **Rank**: the number of baseline seasons with a lower regional NDVI.
- **z classes**: share of fixed pixels with z < −1.5, −1.5 to −0.5, −0.5 to 0.5, 0.5 to 1.5, ≥ 1.5 (`engine.zClasses`).
- **Within-season curve**: for each composite slot (start day of year, labelled with its date in a non-leap year), the regional mean of the target composite, and the baseline mean, 10th and 90th percentiles (type 7) of the baseline years' composites for that slot. Slots that the target lacks and fewer than half of the baseline years have are not drawn.

## 8. Rainfall and temperature

**Rainfall archive** (`pipeline/build_chirps.py`). Each monthly CHIRPS v3.0 0.05° file (60° S to 60° N) is averaged in blocks of 4 × 4 cells to 0.2°: the block value is the mean of its valid cells (source no-data −9999), and a block with fewer than 8 valid cells is no-data. The 16 cells of a block differ in area by at most 0.6 % (at 60°; 0.06 % at 10°), so an unweighted mean is used. Values are stored as uint16 in steps of 0.2 mm (largest storable value 13,106.8 mm), one 12-band file per year. Months not yet published are no-data.

**Season rainfall** (`engine.rainCells`, `engine.cellMean`, `engine.rainSeason`). The 0.2° cells whose centre lies inside the area are used, weighted by cos(latitude). If no centre lies inside (areas smaller than a cell), the one cell containing the centre of the area's bounding box is used, and the page says so. For each calendar month the season touches, the weighted mean is taken over cells with data, provided they hold at least half of the weight. The season total is the sum of those monthly means; it is missing if any month is missing.

Seasons in the page start on the first day of a month and end on its last day, so the rainfall months cover the season exactly; the NDVI composites lie inside the same period (section 4), though the first composite may start up to 15 days after the season starts. February always ends on the 28th in the season window (the MOD13Q1 composites start on day 49 and day 65, so no composite starts on 29 February; temperature misses that one day in leap years).

**Temperature.** NASA POWER daily T2M at the centre of the area's bounding box, averaged over the season's days; missing if any day is missing. If the POWER service fails (it limits request rates), the analysis continues without temperature and says so.

**NASA POWER rainfall is not used.** At the Kano example, POWER PRECTOTCORR gave 677 and 565 mm for June to October 2001 and 2002, where CHIRPS gives about 1,170 and 1,115 mm, and POWER's recent seasons were erratic (1,840 mm in 2021, 288 mm in 2025). These figures are from checks made while building the tool and are recorded in `docs/test-report.md`.

**Association.** The Pearson correlation between regional NDVI and season rainfall across the baseline years is reported with its n. It describes co-variation in the baseline only.

## 9. Exports

| File | Content |
|---|---|
| GeoTIFF | 7 float32 bands on the MODIS sinusoidal grid (target NDVI, baseline mean, baseline SD, anomaly, z, VCI, cropland share), full GeoTIFF keys for the sinusoidal projection, NaN no-data, band names (`exports.sinusoidalGeoTiff`) |
| Years CSV | Per season: regional NDVI, pixel count, rainfall, temperature, days missing |
| Pixels CSV | Per analysed pixel (the same pixels as the regional figures): column, row, sinusoidal and lon/lat centre, cropland share, NDVI, baseline mean and SD, anomaly, z, VCI |
| JSON | Summary, yearly series, curve, climate, parameters, composite IDs, log, sources |
| Map PNG, Report | The current map with title and sources; a printable one-page report |

CSV cells that start with `=`, `+`, `−` or `@` are prefixed with an apostrophe so spreadsheets do not run them as formulas.

## 10. Known limits

- **Greenness is not yield.** Weeds, fallow regrowth and irrigation raise NDVI; a green season can still have a poor harvest.
- **Orbit drift.** Terra's last inclination manoeuvre was in February 2020 and its morning equator crossing time has moved earlier since; Aqua stopped orbit maintenance in 2021 and its afternoon crossing has moved later. The earlier or later overpass changes sun angle and shadow. Its effect on NDVI has not been quantified here, which is why `tests/sensor_check.mjs` compares Terra with Aqua for the same area and season (`docs/test-report.md`). Both satellites are near the end of their missions; the archive held Terra composites up to 1 November 2026 when checked.
- **MODIS 250 m mixes fields.** A pixel covers about 5.4 ha and usually several fields.
- **Single cropland year.** WorldCover 2021 is used for all years.
- **Rainfall is coarser than NDVI** (0.2° against 250 m), and CHIRPS is itself a satellite–gauge blend, not a gauge measurement.
- **No ground observations** were used anywhere in the tool.
