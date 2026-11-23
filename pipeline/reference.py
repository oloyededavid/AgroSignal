"""Independent reference implementation of the AgroSignal analysis, used to check the browser engine.

Shares no code with js/. Reads the same MOD13Q1 composites (listed in the browser result) with rasterio on the same MODIS
grid, screens them with numpy, and recomputes season means, baseline statistics, anomalies, VCI, the cropland fraction
(each 10 m WorldCover pixel assigned to the MODIS cell containing its centre, with pyproj). Season membership is recomputed
from each composite's start date by day of year and checked against the browser's. Rainfall has its own reference
(pipeline/reference_climate.py). Usage: python3 pipeline/reference.py BROWSER_RESULT.json OUT.json"""
import json, sys, math
import numpy as np, pandas as pd, rasterio, planetary_computer as pc, pystac_client
from rasterio.windows import Window
from pyproj import Transformer

res_js = json.load(open(sys.argv[1])); out = sys.argv[2]
g = res_js["grid"]; w, h, x0, y1, px = g["w"], g["h"], g["x0"], g["y1"], g["res"]
SINU = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
S0, S1, YEAR, B0, B1 = "06-01", "10-31", 2026, 2001, 2020
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)

def read_grid(href):
    """Window of a MODIS COG that matches the grid exactly (same sinusoidal pixels), NaN outside the tile."""
    a = np.full((h, w), np.nan, "float32")
    with rasterio.open(href) as src:
        T = src.transform
        c0 = round((x0 - T.c) / T.a); r0 = round((T.f - y1) / -T.e)
        cs, rs = max(0, c0), max(0, r0); ce, re_ = min(src.width, c0 + w), min(src.height, r0 + h)
        if ce <= cs or re_ <= rs: return a
        d = src.read(1, window=Window(cs, rs, ce - cs, re_ - rs)).astype("float32")
        if src.nodata is not None: d[d == src.nodata] = np.nan
        a[rs - r0:re_ - r0, cs - c0:ce - c0] = d
    return a

# inside mask: pixel centre inside the lon/lat box (the example is a rectangle)
to_ll = Transformer.from_crs(SINU, "EPSG:4326", always_xy=True)
xx, yy = np.meshgrid(x0 + (np.arange(w) + .5) * px, y1 - (np.arange(h) + .5) * px)
lon, lat = to_ll.transform(xx, yy)
inside = (lon >= 8.0) & (lon <= 8.4) & (lat >= 12.0) & (lat <= 12.4)

S_DOY = pd.Timestamp(f"2001-{S0}").dayofyear; E_DOY = pd.Timestamp(f"2001-{S1}").dayofyear

def season_year(date):
    """Season of a composite: its 16 days (up to day 365 for the year's last) must lie inside the season's day-of-year range,
    the season taken in a non-leap year. This reference handles seasons within one calendar year, as in the example."""
    d = pd.Timestamp(date); doy = d.dayofyear
    return d.year if S_DOY <= doy and min(doy + 15, 365) <= E_DOY else None

seasons = {}
mismatch = [c["date"] for c in res_js["composites"] if season_year(c["date"]) != c["seasonYear"]]
print("season membership mismatches:", mismatch, flush=True)
for c in res_js["composites"]:
    items = list(cat.search(ids=c["ids"], collections=["modis-13Q1-061"]).items())
    nd = np.full((h, w), np.nan, "float32"); rl = np.full((h, w), np.nan, "float32")
    for it in items:
        a = read_grid(it.assets["250m_16_days_NDVI"].href); b = read_grid(it.assets["250m_16_days_pixel_reliability"].href)
        m = np.isnan(nd) & ~np.isnan(a); nd[m] = a[m]; m = np.isnan(rl) & ~np.isnan(b); rl[m] = b[m]
    ok = np.isin(rl, [0, 1]) & (nd >= -2000) & (nd <= 10000) & inside
    seasons.setdefault(c["seasonYear"], []).append(np.where(ok, nd * 1e-4, np.nan))
    print("read", c["date"], flush=True)

def n_expected(year):
    """Terra composites start on days of year 1, 17, 33, ...; count those wholly inside the season."""
    return sum(S_DOY <= doy and min(doy + 15, 365) <= E_DOY for doy in range(1, 366, 16))

smean = {}
for y, arrs in seasons.items():
    st = np.stack(arrs); cnt = np.sum(~np.isnan(st), axis=0)
    with np.errstate(invalid="ignore"):
        m = np.nansum(st, axis=0) / cnt
    smean[y] = np.where(cnt >= math.ceil(n_expected(y) * 0.5), m, np.nan).astype("float32")
base = np.stack([smean[y] for y in range(B0, B1 + 1) if y in smean])
nb = np.sum(~np.isnan(base), axis=0); need = math.ceil((B1 - B0 + 1) * 2 / 3)
with np.errstate(invalid="ignore", divide="ignore"):
    bmean = np.where(nb >= need, np.nanmean(base, axis=0), np.nan)
    bsd = np.where(nb >= need, np.nanstd(base, axis=0, ddof=1), np.nan)
    bmin = np.where(nb >= need, np.nanmin(base, axis=0), np.nan); bmax = np.where(nb >= need, np.nanmax(base, axis=0), np.nan)
    tgt = smean[YEAR]; anom = tgt - bmean; z = np.where(bsd > 0, anom / bsd, np.nan)
    vci = np.where(bmax > bmin, 100 * (tgt - bmin) / (bmax - bmin), np.nan)

# cropland fraction: every 10 m WorldCover pixel goes to the MODIS cell containing its centre
crop_n = np.zeros((h, w)); all_n = np.zeros((h, w))
to_sinu = Transformer.from_crs("EPSG:4326", SINU, always_xy=True)
for it in cat.search(collections=["esa-worldcover"], bbox=[8.0, 12.0, 8.4, 12.4], datetime="2021-01-01/2021-12-31").items():
    with rasterio.open(it.assets["map"].href) as src:
        win = rasterio.windows.from_bounds(7.95, 11.95, 8.45, 12.45, src.transform).round_offsets().round_lengths()
        a = src.read(1, window=win, boundless=True, fill_value=0); T = src.window_transform(win)
    cc, rr = np.meshgrid(np.arange(a.shape[1]), np.arange(a.shape[0]))
    lo, la = T.c + (cc + .5) * T.a, T.f + (rr + .5) * T.e
    sx, sy = to_sinu.transform(lo.ravel(), la.ravel())
    ci = np.floor((sx - x0) / px).astype(int); ri = np.floor((y1 - sy) / px).astype(int)
    v = a.ravel(); ok = (ci >= 0) & (ci < w) & (ri >= 0) & (ri < h) & (v > 0)
    np.add.at(all_n, (ri[ok], ci[ok]), 1); np.add.at(crop_n, (ri[ok], ci[ok]), (v[ok] == 40).astype(float))
with np.errstate(invalid="ignore"):
    crop = crop_n / all_n
fixed = inside & (crop >= 0.5) & ~np.isnan(tgt) & ~np.isnan(bmean)
regional = {int(y): float(np.nanmean(np.where(fixed, smean[y], np.nan))) for y in sorted(smean)}

json.dump({"anom": np.where(np.isnan(anom), None, anom).ravel().tolist(), "z": np.where(np.isnan(z), None, z).ravel().tolist(),
           "vci": np.where(np.isnan(vci), None, vci).ravel().tolist(), "crop": np.where(np.isnan(crop), None, crop).ravel().tolist(),
           "fixed": fixed.ravel().astype(int).tolist(), "regional": regional, "membership_mismatches": mismatch}, open(out, "w"))
print("done", int(fixed.sum()), "pixels;", "target regional NDVI", regional[YEAR])
