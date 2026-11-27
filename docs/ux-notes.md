# AgroSignal: interface notes

## Version 1.2.0: interface rebuilt as a guided product (27 November 2026)

The page was hard to use: a dense side rail of form steps, a results area full of text, four tabs and odd floating buttons. It was rebuilt around one path. The analysis (`js/engine.js`, `js/pipeline.js`, `js/io.js`, `js/exports.js`, `js/worker.js`) is unchanged; `tests/fixture_kano.mjs` still gives identical values and grid hashes.

| Before | Now |
|---|---|
| The map and a form rail on arrival | An opening screen: one question, a search box, three examples, and the three steps explained in one line each |
| Accordion steps with every setting visible | A stepper (Place, Season, Result). Picking a search result goes straight to Season; the months and year are preset from the latitude, with the reason stated |
| Baseline, satellite and cropland switch on the main form | Under Advanced settings; choosing Aqua moves the comparison start to 2003 instead of showing an error |
| A progress log of engine messages | Four plain stages with a progress bar and a Cancel button |
| A long Reading paragraph, a caution paragraph, four figure boxes and four tabs | A verdict on a five-step scale, one sentence, three figures, the drift caution only when it applies, two charts, the share of pixels per class; method and run details folded away |
| Layer chips that overflowed a phone by 6 px | One labelled select with the legend in a map card |
| A Downloads menu | One Export button opening a list of seven exports, each with a one-line description |
| Green accent throughout | Neutral surfaces and one cobalt accent; the brown–teal data ramp is kept (colour-blind check unchanged) |

Examples: Kano 2026 (the validated case), Punjab 2023 and Saskatchewan 2021. The last two use the settings that passed `tests/global_check.mjs`; they are run demonstrations, not validated against crop statistics. The example cards state no result; the result comes from each run.

Default months by latitude (south of 5° S: November to March; 5° S to 40° N: June to October; north of 40° N: May to August) are a starting point only. The page says so and asks the user to match their crop.

## Version 1.1.0
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
