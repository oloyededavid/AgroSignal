"""Build the landing-page preview card from a real run's exports.

Usage: python3 tools/make_preview.py RUN.json RUN_z.png
RUN.json and RUN_z.png are the "Full result" and "Map image" exports of one run (the Kano example).
Writes assets/preview.json (figures shown on the card) and assets/preview-map.webp (a crop of the map image).
"""
import json, sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
run = json.loads(Path(sys.argv[1]).read_text())
s, m = run["summary"], run["meta"]
out = {
    "label": m["label"], "year": m["year"], "season": m["season"], "baseline": m["baseline"],
    "ndvi": round(s["target"]["ndvi"], 3), "usual": round(s["baseline"]["ndviMean"], 3),
    "rankBelow": s["target"]["rankBelow"], "baselineSeasons": s["target"]["baselineSeasons"],
    "regionalZ": round(s["regionalZ"], 2), "rainPct": round(s["climate"]["rainPct"]),
    "version": m["version"], "runAt": m["runAt"],
}
(root / "assets/preview.json").write_text(json.dumps(out, indent=1) + "\n")
im = Image.open(sys.argv[2]).convert("RGB")
crop = im.crop((26, 36, 736, 600))          # inside the analysed box, above the legend and footer
crop.resize((600, round(600 * crop.height / crop.width)), Image.LANCZOS).save(root / "assets/preview-map.webp", quality=82)
print(json.dumps(out))
