# AgroSignal: interface note

Version 1.1.0, November 2026. What changed in the interface, why, and what is still open. The analysis (`js/engine.js`, `js/pipeline.js`) is unchanged; `tests/fixture_kano.mjs` replays fixed inputs and checks the anomaly and z grids by hash, the regional figures and the rainfall.

| Change | Why (audit finding) |
|---|---|
| "Compare with care" beside the result whenever the target season is after the satellite's orbit drift began (Terra 2020, Aqua 2021) and the baseline ends before it, with the Aqua check suggested | The drift caveat was only in About, beside a record "much greener than usual" headline (AS-1) |
| A Reading: how unusual the season was, its rank and the share of much greener and much browner pixels; rainfall against its usual range; the correlation stated as association, not cause; greenness is not yield | Greenness and rainfall were not read together (AS-2) |
| "Run the Kano example" runs the analysis, like the other tools' examples | The example only filled the form (AS-3) |
| While running, the evidence panel says the archive is being read | It said "Choose an area and a season" during a one-minute run (AS-4) |
| Opening screen; on phones the purpose comes first | AS-5 |
| Anomaly maps use brown–teal; checked so the two sides stay apart for red–green colour-blind readers (ends 9.7 or more apart, against 2.8 before) | The sign of the anomaly was lost for deuteranopes (VZ-1) |
| VCI uses a sequential scale from 0 (driest baseline season) to 100 (greenest) | A neutral colour at 50 suggested a "normal" VCI that does not exist (VZ-5) |
| Rainfall figure marked as an estimate | CHIRPS is a satellite and station estimate (VZ-4) |
| Map image export: colour scale, units, scale bar, pixel selection, limits and full attribution | The image had no colour scale (EX-1) |
| "Link to this analysis": area, season, baseline and satellite in the address; opening it runs the analysis again | Runs could not be shared (EX-5) |
| A searched place is labelled "33 × 33 km around …", with an explanation for countries and regions | Same issue as FloodScope FS-4 |
| Chart tooltip inside the main region | axe `region` (AS-7) |
| Tools menu; "Back to portfolio" opens the tools | PI-1, PI-2 |

Still open: examples outside Nigeria. The test report's other regions (Free State, Saskatchewan, Punjab, southern Finland) ran correctly but were not compared with independent crop data, so they are not offered as validated examples.
