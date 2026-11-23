"""Independent check of AgroSignal's season rainfall: recomputes it from the original 0.05 degree CHIRPS v3.0 COGs on the
CHC server (range reads with GDAL), not from the hosted 0.2 degree archive, and compares with a browser result.

For a rectangular area: 0.2 degree blocks of 4 x 4 source cells whose block centre lies inside the area (or the block
containing the area centre when none does), each block the mean of its valid cells (at least 8 of 16), blocks weighted by
cos(latitude), summed over the season's calendar months.
Usage: CURL_CA_BUNDLE=... python3 pipeline/reference_climate.py BROWSER_RESULT.json W S E N"""
import json, math, sys, time
import numpy as np, rasterio
from rasterio.windows import Window

res = json.load(open(sys.argv[1])); W, S, E, N = map(float, sys.argv[2:6])
m = res["meta"]; m0, m1 = int(m["season"]["start"][:2]), int(m["season"]["end"][:2])
URL = "/vsicurl/https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/cogs/chirps-v3.0.{y}.{m:02d}.cog"

bc = [c for c in range(1800) if W <= -180 + (c + .5) * .2 <= E]; br = [r for r in range(600) if S <= 60 - (r + .5) * .2 <= N]
if not bc or not br:
    bc = [math.floor((((W + E) / 2) + 180) / .2)]; br = [math.floor((60 - (S + N) / 2) / .2)]
c0, r0 = min(bc) * 4, min(br) * 4; nc, nr = len(bc), len(br)
wts = np.cos(np.radians(60 - (np.array(br) + .5) * .2))[:, None] * np.ones((1, nc))

def month_mean(y, mo):
    for k in range(6):  # the CHC server throttles; wait and retry
        try:
            with rasterio.open(URL.format(y=y, m=mo)) as s:
                a = s.read(1, window=Window(c0, r0, nc * 4, nr * 4)).astype("float64")
            break
        except rasterio.errors.RasterioIOError:
            if k == 5: raise
            time.sleep(15 * 2 ** k)
    time.sleep(1)
    v = a > -9000; a[~v] = 0
    blk = a.reshape(nr, 4, nc, 4).sum(axis=(1, 3)); n = v.reshape(nr, 4, nc, 4).sum(axis=(1, 3))
    mean = np.where(n >= 8, blk / np.maximum(n, 1), np.nan); ok = ~np.isnan(mean)
    return float((mean[ok] * wts[ok]).sum() / wts[ok].sum()) if wts[ok].sum() >= wts.sum() / 2 else float("nan")

months = lambda y: [(y, k) for k in range(m0, m1 + 1)] if m1 >= m0 else [(y, k) for k in range(m0, 13)] + [(y + 1, k) for k in range(1, m1 + 1)]
worst = 0
for c in res["climate"]:
    ref = sum(month_mean(*q) for q in months(c["year"]))
    js = c["rain"]; d = abs(ref - js) if js is not None else float("nan"); worst = max(worst, d)
    print(c["year"], "reference", round(ref, 2), "browser", None if js is None else round(js, 2), "diff", round(d, 3), flush=True)
print("cells", nc * nr, "max abs diff mm", round(worst, 3))
