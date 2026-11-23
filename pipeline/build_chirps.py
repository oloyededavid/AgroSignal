"""Build the hosted CHIRPS v3.0 monthly rainfall archive that AgroSignal reads in the browser.

The CHC server sends no CORS headers, so browsers cannot read CHIRPS directly. This script downloads each monthly
0.05 degree global COG (60 S to 60 N) one at a time, averages blocks of 4 x 4 cells to 0.2 degrees, and writes one
12-band GeoTIFF per calendar year to data/chirps/chirps-v3-0p2-YYYY.tif (band 1 = January).

Aggregation: the 0.2 degree value is the mean of the valid 0.05 degree cells in the block (the source is a regular
lat/lon grid, so the 16 cells of a block differ in area by at most 0.6 %, at 60 degrees); a block with fewer than 8
valid cells is no-data. Storage: uint16, 0.2 mm per unit (largest storable value 13,106.8 mm), no-data 65535.
Months not yet published are written as no-data. Source no-data is -9999 (not tagged in the files).

Usage: python3 pipeline/build_chirps.py FIRST_YEAR LAST_YEAR   (resumes: existing complete years are skipped)
Parallel runs: set CHIRPS_INDEX=index-NAME.json for each, then merge them into index.json with
       python3 pipeline/build_chirps.py --merge"""
import json, os, sys, time, datetime, tempfile
import numpy as np, requests, rasterio
from rasterio.transform import from_origin

SRC = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/cogs/chirps-v3.0.{y}.{m:02d}.cog"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "chirps")
SCALE, NODATA, F = 0.2, 65535, 4
W, H = 7200 // F, 2400 // F
os.makedirs(OUT, exist_ok=True)
idx_path = os.path.join(OUT, os.environ.get("CHIRPS_INDEX", "index.json"))  # parallel runs use separate index files, merged afterwards
index = json.load(open(idx_path)) if os.path.exists(idx_path) else {"years": {}}


def fetch(url, path):
    for k in range(6):
        try:
            with requests.get(url, stream=True, timeout=120) as r:
                if r.status_code == 404:
                    return False
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            return True
        except Exception as e:  # network errors and throttling: back off and retry
            print(f"  retry {k + 1} for {url}: {e}", flush=True)
            time.sleep(10 * 2 ** k)
    raise RuntimeError(f"could not download {url}")


def month(y, m, tmp):
    if not fetch(SRC.format(y=y, m=m), tmp):
        return None, None
    with rasterio.open(tmp) as s:
        t = s.transform
        assert (s.width, s.height) == (7200, 2400) and abs(t.a - 0.05) < 1e-6 and abs(t.e + 0.05) < 1e-6
        assert abs(t.c + 180) < 1e-9 and abs(t.f - 60) < 1e-9
        a = s.read(1).astype("float64")
        stamp = s.tags().get("TIFFTAG_DATETIME")
    os.remove(tmp)
    valid = a > -9000  # -9999 is the source no-data value
    if (a[valid] < 0).any():
        raise ValueError(f"negative rainfall in {y}-{m:02d}")
    a[~valid] = 0
    s4 = a.reshape(H, F, W, F).sum(axis=(1, 3)); n4 = valid.reshape(H, F, W, F).sum(axis=(1, 3))
    mean = np.where(n4 >= 8, s4 / np.maximum(n4, 1), np.nan)
    if np.nanmax(mean) > (NODATA - 1) * SCALE:
        raise ValueError(f"value too large to store in {y}-{m:02d}: {np.nanmax(mean)}")
    q = np.where(np.isnan(mean), NODATA, np.round(mean / SCALE)).astype("uint16")
    return q, stamp


if sys.argv[1] == "--merge":
    import glob
    main = json.load(open(os.path.join(OUT, "index.json"))) if os.path.exists(os.path.join(OUT, "index.json")) else {"years": {}}
    for part in sorted(glob.glob(os.path.join(OUT, "index-*.json"))):
        q = json.load(open(part)); main["years"].update(q["years"])
        for k in ("grid", "scale", "nodata", "units", "source"): main[k] = q[k]
        main["built"] = max(main.get("built", ""), q["built"])
    for y, rec in main["years"].items():
        assert os.path.exists(os.path.join(OUT, rec["file"])), rec["file"]
    main["years"] = dict(sorted(main["years"].items()))
    json.dump(main, open(os.path.join(OUT, "index.json"), "w"), indent=1)
    print("merged", len(main["years"]), "years:", ", ".join(main["years"])); sys.exit(0)

y0, y1 = int(sys.argv[1]), int(sys.argv[2])
today = datetime.date.today()
for y in range(y0, y1 + 1):
    rec = index["years"].get(str(y))
    if rec and len(rec["months"]) == 12:
        continue
    bands, months, stamps = [], [], {}
    for m in range(1, 13):
        if datetime.date(y, m, 1) > today:
            q = None
        else:
            fd, tmp = tempfile.mkstemp(suffix=".cog"); os.close(fd)
            q, stamp = month(y, m, tmp)
            if os.path.exists(tmp):
                os.remove(tmp)
            if q is not None:
                months.append(m); stamps[m] = stamp
            time.sleep(1)
        bands.append(q if q is not None else np.full((H, W), NODATA, "uint16"))
        print(y, m, "ok" if q is not None else "not published", flush=True)
    path = os.path.join(OUT, f"chirps-v3-0p2-{y}.tif")
    with rasterio.open(path, "w", driver="GTiff", width=W, height=H, count=12, dtype="uint16", nodata=NODATA,
                       crs="EPSG:4326", transform=from_origin(-180, 60, 0.2, 0.2), tiled=True, blockxsize=128,
                       blockysize=128, compress="deflate", predictor=2, interleave="pixel") as d:
        d.write(np.stack(bands))
        d.scales = [SCALE] * 12
        d.update_tags(source="CHIRPS v3.0 monthly (CHC, UC Santa Barbara)", aggregation="mean of valid 0.05 deg cells in 4x4 blocks, at least 8 valid",
                      units="mm per month", scale=str(SCALE))
        for b in range(12):
            d.set_band_description(b + 1, f"{y}-{b + 1:02d}")
    index["years"][str(y)] = {"file": os.path.basename(path), "months": months, "source_datetime": stamps}
    index.update(grid={"x0": -180, "y1": 60, "res": 0.2, "w": W, "h": H}, scale=SCALE, nodata=NODATA, units="mm",
                 source=SRC.replace("{y}.{m:02d}", "YYYY.MM"), built=today.isoformat())
    json.dump(index, open(idx_path, "w"), indent=1)
    print("wrote", path, os.path.getsize(path), "bytes", flush=True)
